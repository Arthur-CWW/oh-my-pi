#!/bin/bash
set -Eeuo pipefail
SCRIPT_DIR=$(cd -- "${BASH_SOURCE[0]%/*}" && pwd -P)
# shellcheck source=ubuntu-common.sh
source "${SCRIPT_DIR}/ubuntu-common.sh"

[[ $# -eq 0 ]] || rab_die 'install-pam accepts no arguments'
rab_require_root
rab_require_tools
rab_require_target
[[ ! -e ${PAM_CURRENT} && ! -L ${PAM_CURRENT} ]] || rab_die 'a PAM transaction is already pending; confirm or roll it back first'
rab_require_owner_mode "${PAM_FILE}" 0 0 644
rab_require_owner_mode "${RAB_CURRENT}/assets/gdm-password.ubuntu-24.04.baseline" 0 0 644
/usr/bin/cmp -s -- "${PAM_FILE}" "${RAB_CURRENT}/assets/gdm-password.ubuntu-24.04.baseline" ||
  rab_die 'gdm-password does not exactly match the reviewed Ubuntu 24.04 baseline'

multiarch=$(/usr/bin/dpkg-architecture -qDEB_HOST_MULTIARCH)
[[ ${multiarch} == x86_64-linux-gnu ]] || rab_die 'PAM multiarch discovery changed: expected exactly x86_64-linux-gnu'
module_source="${RAB_CURRENT}/lib/pam_gdm_broker.so"
module_directory="/usr/lib/${multiarch}/security"
module_target="${module_directory}/pam_gdm_broker.so"
rab_require_owner_mode "${module_source}" 0 0 644
LC_ALL=C /usr/bin/readelf -h -- "${module_source}" | /usr/bin/awk '
  $1 == "Class:" { class_count++; class_ok = ($2 == "ELF64" && NF == 2) }
  $1 == "Machine:" {
    machine_count++
    machine = $0
    sub(/^[^:]*:[[:space:]]*/, "", machine)
    machine_ok = (machine == "Advanced Micro Devices X86-64")
  }
  END { exit !(class_count == 1 && class_ok && machine_count == 1 && machine_ok) }
' || rab_die 'PAM module must be exactly ELF64 for Advanced Micro Devices X86-64'
if [[ -e ${module_target} || -L ${module_target} ]]; then
  rab_require_owner_mode "${module_target}" 0 0 644
  /usr/bin/cmp -s -- "${module_source}" "${module_target}" || rab_die 'an unrecognized PAM module already occupies the target path'
  module_preexisted=1
else
  module_preexisted=0
fi

transaction=$(rab_transaction_id)
backup="${PAM_BACKUPS}/${transaction}"
/bin/mkdir -m 0700 -- "${backup}"
/usr/bin/chown root:root "${backup}"
/usr/bin/cp --preserve=all --no-dereference -- "${PAM_FILE}" "${backup}/gdm-password.before"
/usr/bin/chown root:root "${backup}/gdm-password.before"
/usr/bin/chmod 0600 "${backup}/gdm-password.before"
before_digest=$(rab_sha256 "${PAM_FILE}")
printf 'sha256=%s\n' "${before_digest}" >"${backup}/before.sha256"
printf 'uid=%s\ngid=%s\nmode=%s\n' \
  "$(/usr/bin/stat -c '%u' -- "${PAM_FILE}")" \
  "$(/usr/bin/stat -c '%g' -- "${PAM_FILE}")" \
  "$(/usr/bin/stat -c '%a' -- "${PAM_FILE}")" >"${backup}/before.stat"
/usr/bin/getfacl -cpn -- "${PAM_FILE}" >"${backup}/before.acl"
/usr/bin/python3 -I -S -c '
import base64, json, os, sys
path, output = sys.argv[1], sys.argv[2]
entries = [{"name": name, "value": base64.b64encode(os.getxattr(path, name, follow_symlinks=False)).decode("ascii")} for name in sorted(os.listxattr(path, follow_symlinks=False))]
with open(output, "x", encoding="ascii") as stream:
    json.dump(entries, stream, separators=(",", ":"), ensure_ascii=True)
    stream.write("\n")
    stream.flush()
    os.fsync(stream.fileno())
' "${PAM_FILE}" "${backup}/before.xattrs.json"
for metadata in before.sha256 before.stat before.acl before.xattrs.json; do
  /usr/bin/chown root:root "${backup}/${metadata}"
  /usr/bin/chmod 0600 "${backup}/${metadata}"
done
/bin/sync -f "${backup}"

candidate="/etc/pam.d/.gdm-password.remote-auth.${transaction}"
/usr/bin/cp --preserve=all --no-dereference -- "${PAM_FILE}" "${candidate}"
/usr/bin/python3 -I -S -c '
import os, sys
path = sys.argv[1]
inject = b"auth optional pam_gdm_broker.so mode=inject socket=/run/remote-auth-broker/gdm/gdm-claim.sock\n"
clear = b"auth optional pam_gdm_broker.so mode=clear socket=/run/remote-auth-broker/gdm/gdm-claim.sock\n"
root_anchor = b"auth\trequired\tpam_succeed_if.so user != root quiet_success\n"
auth_include = b"@include common-auth\n"
keyring_anchor = b"auth    optional        pam_gnome_keyring.so\n"
account_include = b"@include common-account\n"
with open(path, "rb") as stream:
    data = stream.read(65537)
if len(data) > 65536 or b"\x00" in data:
    raise SystemExit(1)
if data.count(root_anchor) != 1 or data.count(auth_include) != 1 or data.count(keyring_anchor) != 1 or data.count(account_include) != 1:
    raise SystemExit(1)
if data.index(root_anchor) > data.index(auth_include) or data.index(keyring_anchor) > data.index(account_include):
    raise SystemExit(1)
data = data.replace(root_anchor + auth_include, root_anchor + inject + auth_include, 1)
data = data.replace(keyring_anchor + account_include, keyring_anchor + clear + account_include, 1)
if data.count(inject) != 1 or data.count(clear) != 1:
    raise SystemExit(1)
with open(path, "wb", buffering=0) as stream:
    stream.write(data)
    os.fsync(stream.fileno())
' "${candidate}" || rab_die 'failed to render the exact reviewed PAM candidate'
/usr/bin/chown 0:0 -- "${candidate}"
/usr/bin/chmod 0644 -- "${candidate}"

/usr/bin/python3 -I -S -c '
import sys
path = sys.argv[1]
with open(path, "rb") as stream:
    lines = stream.read().splitlines()
inject = b"auth optional pam_gdm_broker.so mode=inject socket=/run/remote-auth-broker/gdm/gdm-claim.sock"
clear = b"auth optional pam_gdm_broker.so mode=clear socket=/run/remote-auth-broker/gdm/gdm-claim.sock"
required = [
 b"auth    requisite       pam_nologin.so",
 b"auth\trequired\tpam_succeed_if.so user != root quiet_success",
 inject,
 b"@include common-auth",
 b"auth    optional        pam_gnome_keyring.so",
 clear,
 b"@include common-account",
]
positions = []
for item in required:
    if lines.count(item) != 1:
        raise SystemExit(1)
    positions.append(lines.index(item))
if positions != sorted(positions):
    raise SystemExit(1)
if sum(b"pam_gdm_broker.so" in line for line in lines) != 2:
    raise SystemExit(1)
' "${candidate}" || rab_die 'PAM candidate failed exact order validation'
after_digest=$(rab_sha256 "${candidate}")
printf 'sha256=%s\n' "${after_digest}" >"${backup}/after.sha256"
/usr/bin/chown root:root "${backup}/after.sha256"
/usr/bin/chmod 0600 "${backup}/after.sha256"

state_tmp="${RAB_STATE}/.pam-current.${transaction}.tmp"
printf 'transaction=%s\nstate=armed\nbefore_sha256=%s\nafter_sha256=%s\n' \
  "${transaction}" "${before_digest}" "${after_digest}" >"${state_tmp}"
/usr/bin/chown root:root "${state_tmp}"
/usr/bin/chmod 0600 "${state_tmp}"
/bin/sync -f "${state_tmp}"
/usr/bin/mv -Tf -- "${state_tmp}" "${PAM_CURRENT}"
/bin/sync -f "${RAB_STATE}"

rollback_on_error() {
  trap - ERR INT TERM HUP
  set +e
  "${SCRIPT_DIR}/rollback-pam-ubuntu.sh" >/dev/null
  if [[ ${module_preexisted} -eq 0 && ! -e ${PAM_CURRENT} ]]; then
    /bin/rm -f -- "${module_target}"
  fi
  exit 1
}
trap rollback_on_error ERR INT TERM HUP

/bin/mkdir -p -m 0755 -- "${module_directory}"
if [[ ${module_preexisted} -eq 0 ]]; then
  rab_atomic_install "${module_source}" "${module_target}" 0644
fi
rab_require_owner_mode "${module_target}" 0 0 644
/usr/bin/systemctl enable --now remote-auth-pam-rollback.timer >/dev/null
/usr/bin/systemctl is-active --quiet remote-auth-pam-rollback.timer || rab_die 'automatic PAM rollback timer did not arm'

/bin/sync -f "${candidate}"
/usr/bin/mv -Tf -- "${candidate}" "${PAM_FILE}"
/bin/sync -f /etc/pam.d
[[ $(rab_sha256 "${PAM_FILE}") == "${after_digest}" ]] || rab_die 'atomic PAM installation produced unexpected bytes'
state_tmp="${RAB_STATE}/.pam-current.${transaction}.installed"
printf 'transaction=%s\nstate=installed\nbefore_sha256=%s\nafter_sha256=%s\n' \
  "${transaction}" "${before_digest}" "${after_digest}" >"${state_tmp}"
/usr/bin/chown root:root "${state_tmp}"
/usr/bin/chmod 0600 "${state_tmp}"
/bin/sync -f "${state_tmp}"
/usr/bin/mv -Tf -- "${state_tmp}" "${PAM_CURRENT}"
/bin/sync -f "${RAB_STATE}"
trap - ERR INT TERM HUP
printf 'PAM transaction %s installed; automatic exact rollback remains armed\n' "${transaction}"
