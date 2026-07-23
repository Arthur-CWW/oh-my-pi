#!/bin/bash
set -Eeuo pipefail
SCRIPT_DIR=$(cd -- "${BASH_SOURCE[0]%/*}" && pwd -P)
# shellcheck source=ubuntu-common.sh
source "${SCRIPT_DIR}/ubuntu-common.sh"

[[ $# -eq 0 ]] || rab_die 'rollback-pam accepts no arguments'

rab_require_root
rab_require_tools
rab_require_target
[[ -x /usr/bin/flock ]] || rab_die 'a required fixed rollback tool is unavailable'
if [[ -e ${RAB_RUN}/rollback || -L ${RAB_RUN}/rollback ]]; then
  [[ -d ${RAB_RUN}/rollback && ! -L ${RAB_RUN}/rollback &&
    $(/usr/bin/stat -c '%u:%g:%a' -- "${RAB_RUN}/rollback") == 0:0:700 ]] ||
    rab_die 'the PAM transaction lock directory is unsafe'
else
  /bin/mkdir -m 0700 -- "${RAB_RUN}/rollback"
fi
exec 8>"${RAB_RUN}/rollback/pam-transaction.lock"
/usr/bin/flock -n 8 || rab_die 'another PAM transaction action is running'

[[ -e ${PAM_CURRENT} || -L ${PAM_CURRENT} ]] || exit 0
rab_require_owner_mode "${PAM_CURRENT}" 0 0 600
transaction=$(rab_read_state_value transaction "${PAM_CURRENT}")
state=$(rab_read_state_value state "${PAM_CURRENT}")
[[ ${transaction} =~ ^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$ ]] ||
  rab_die 'invalid PAM transaction identifier'
[[ ${state} != confirmed ]] || exit 0
[[ ${state} == armed || ${state} == installed || ${state} == rollback-in-progress ]] ||
  rab_die 'PAM transaction is not rollback-eligible'
before_state_digest=$(rab_read_state_value before_sha256 "${PAM_CURRENT}")
after_state_digest=$(rab_read_state_value after_sha256 "${PAM_CURRENT}")
[[ ${before_state_digest} =~ ^[0-9a-f]{64}$ && ${after_state_digest} =~ ^[0-9a-f]{64}$ ]] ||
  rab_die 'invalid PAM transaction digest metadata'

backup="${PAM_BACKUPS}/${transaction}"
[[ -d ${backup} && ! -L ${backup} ]] || rab_die 'PAM transaction backup directory is unsafe'
[[ $(/usr/bin/stat -c '%u:%g:%a' -- "${backup}") == 0:0:700 ]] || rab_die 'PAM backup directory metadata is unsafe'

rab_require_owner_mode "${backup}/gdm-password.before" 0 0 600
rab_require_owner_mode "${backup}/before.sha256" 0 0 600
rab_require_owner_mode "${backup}/before.stat" 0 0 600
rab_require_owner_mode "${backup}/before.acl" 0 0 600
rab_require_owner_mode "${backup}/before.xattrs.json" 0 0 600

before_digest=$(rab_read_state_value sha256 "${backup}/before.sha256")
[[ ${before_digest} == "${before_state_digest}" ]] || rab_die 'PAM backup digest does not match transaction state'
[[ $(rab_sha256 "${backup}/gdm-password.before") == "${before_digest}" ]] || rab_die 'PAM backup bytes failed SHA-256 verification'
uid=$(rab_read_state_value uid "${backup}/before.stat")
gid=$(rab_read_state_value gid "${backup}/before.stat")
mode=$(rab_read_state_value mode "${backup}/before.stat")
[[ ${uid} =~ ^[0-9]+$ && ${gid} =~ ^[0-9]+$ && ${mode} =~ ^[0-7]{3,4}$ ]] || rab_die 'invalid PAM backup ownership metadata'

rollback_state_tmp="${RAB_STATE}/.pam-current.${transaction}.rollback-in-progress"
if [[ -e ${rollback_state_tmp} || -L ${rollback_state_tmp} ]]; then
  rab_require_owner_mode "${rollback_state_tmp}" 0 0 600
  /bin/rm -f -- "${rollback_state_tmp}"
fi
printf 'transaction=%s\nstate=rollback-in-progress\nbefore_sha256=%s\nafter_sha256=%s\n' \
  "${transaction}" "${before_state_digest}" "${after_state_digest}" >"${rollback_state_tmp}"
/usr/bin/chown root:root "${rollback_state_tmp}"
/usr/bin/chmod 0600 "${rollback_state_tmp}"
/bin/sync -f "${rollback_state_tmp}"
/usr/bin/mv -Tf -- "${rollback_state_tmp}" "${PAM_CURRENT}"
/bin/sync -f "${RAB_STATE}"

rollback_status=0
if ! /usr/bin/systemctl disable --now remote-auth-pam-rollback.timer >/dev/null; then
  printf 'remote-auth-broker: failed to disarm the PAM rollback timer\n' >&2
  rollback_status=1
fi

temporary="/etc/pam.d/.gdm-password.remote-auth-restore.${transaction}"
set +e
(
  set -Eeuo pipefail
  trap '/bin/rm -f -- "${temporary}"' EXIT
  /bin/rm -f -- "${temporary}"
  /usr/bin/cp --preserve=all --no-dereference -- "${backup}/gdm-password.before" "${temporary}"
  /usr/bin/chown "${uid}:${gid}" -- "${temporary}"
  /usr/bin/chmod "${mode}" -- "${temporary}"
  /usr/bin/python3 -I -S -c '
import base64, json, os, stat, sys
metadata_path, target = sys.argv[1], sys.argv[2]
st = os.lstat(target)
if not stat.S_ISREG(st.st_mode):
    raise SystemExit(1)
with open(metadata_path, "rb") as stream:
    entries = json.load(stream)
if type(entries) is not list or len(entries) > 64:
    raise SystemExit(1)
for name in os.listxattr(target, follow_symlinks=False):
    os.removexattr(target, name, follow_symlinks=False)
seen = set()
for entry in entries:
    if type(entry) is not dict or set(entry) != {"name", "value"}:
        raise SystemExit(1)
    name = entry["name"]
    value = entry["value"]
    if type(name) is not str or not name or name in seen or "\x00" in name or type(value) is not str:
        raise SystemExit(1)
    seen.add(name)
    os.setxattr(target, name, base64.b64decode(value, validate=True), follow_symlinks=False)
' "${backup}/before.xattrs.json" "${temporary}"
  /usr/bin/setfacl --set-file="${backup}/before.acl" -- "${temporary}"

  [[ $(rab_sha256 "${temporary}") == "${before_digest}" ]] || rab_die 'restored PAM candidate bytes differ from backup'
  [[ $(/usr/bin/stat -c '%u' -- "${temporary}") == "${uid}" ]] || rab_die 'restored PAM candidate owner differs from backup'
  [[ $(/usr/bin/stat -c '%g' -- "${temporary}") == "${gid}" ]] || rab_die 'restored PAM candidate group differs from backup'
  [[ $(/usr/bin/stat -c '%a' -- "${temporary}") == "${mode}" ]] || rab_die 'restored PAM candidate mode differs from backup'
  /usr/bin/getfacl -cpn -- "${temporary}" >"${backup}/restore.acl"
  /usr/bin/chown root:root "${backup}/restore.acl"
  /usr/bin/chmod 0600 "${backup}/restore.acl"
  /usr/bin/cmp -s -- "${backup}/before.acl" "${backup}/restore.acl" || rab_die 'restored PAM candidate ACL differs from backup'
  /usr/bin/python3 -I -S -c '
import base64, json, os, sys
metadata_path, target = sys.argv[1], sys.argv[2]
with open(metadata_path, "rb") as stream:
    expected = json.load(stream)
actual = [{"name": name, "value": base64.b64encode(os.getxattr(target, name, follow_symlinks=False)).decode("ascii")} for name in sorted(os.listxattr(target, follow_symlinks=False))]
if actual != expected:
    raise SystemExit(1)
' "${backup}/before.xattrs.json" "${temporary}"

  /bin/sync -f "${temporary}"
  /usr/bin/mv -Tf -- "${temporary}" "${PAM_FILE}"
  /bin/sync -f /etc/pam.d
  [[ $(rab_sha256 "${PAM_FILE}") == "${before_digest}" ]] || rab_die 'atomic PAM restoration did not preserve backup bytes'
  trap - EXIT
)
restore_status=$?
set -e
if [[ ${restore_status} -ne 0 ]]; then
  printf 'remote-auth-broker: exact PAM restoration failed\n' >&2
  rollback_status=1
fi

if [[ ${rollback_status} -ne 0 ]]; then
  printf 'remote-auth-broker: PAM rollback remains durably marked rollback-in-progress\n' >&2
  exit 1
fi

receipt="${backup}/rollback.receipt.tmp"
printf 'transaction=%s\nresult=restored\nrestored_sha256=%s\n' "${transaction}" "${before_digest}" >"${receipt}"
/usr/bin/chown root:root "${receipt}"
/usr/bin/chmod 0600 "${receipt}"
/bin/sync -f "${receipt}"
/usr/bin/mv -Tf -- "${receipt}" "${backup}/rollback.receipt"
/bin/sync -f "${backup}"
/bin/rm -f -- "${PAM_CURRENT}"
/bin/sync -f "${RAB_STATE}"
printf 'PAM transaction %s restored exactly\n' "${transaction}"
