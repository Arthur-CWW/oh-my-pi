#!/bin/bash
set -Eeuo pipefail
SCRIPT_DIR=$(cd -- "${BASH_SOURCE[0]%/*}" && pwd -P)
# shellcheck source=ubuntu-common.sh
source "${SCRIPT_DIR}/ubuntu-common.sh"

[[ $# -eq 1 ]] || rab_die 'usage: confirm-pam-ubuntu.sh TRANSACTION_ID'
transaction=$1
[[ ${transaction} =~ ^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$ ]] ||
  rab_die 'invalid PAM transaction identifier'
rab_require_root
rab_require_tools
rab_require_target
[[ -x /usr/bin/flock ]] || rab_die 'a required fixed confirmation tool is unavailable'
if [[ -e ${RAB_RUN}/rollback || -L ${RAB_RUN}/rollback ]]; then
  [[ -d ${RAB_RUN}/rollback && ! -L ${RAB_RUN}/rollback &&
    $(/usr/bin/stat -c '%u:%g:%a' -- "${RAB_RUN}/rollback") == 0:0:700 ]] ||
    rab_die 'the PAM transaction lock directory is unsafe'
else
  /bin/mkdir -m 0700 -- "${RAB_RUN}/rollback"
fi
exec 8>"${RAB_RUN}/rollback/pam-transaction.lock"
/usr/bin/flock -n 8 || rab_die 'another PAM transaction action is running'
rab_require_owner_mode "${PAM_CURRENT}" 0 0 600
[[ $(rab_read_state_value transaction "${PAM_CURRENT}") == "${transaction}" ]] ||
  rab_die 'confirmation does not name the currently armed PAM transaction'
state=$(rab_read_state_value state "${PAM_CURRENT}")
[[ ${state} == installed || ${state} == confirmed ]] ||
  rab_die 'PAM transaction is not installed and cannot be confirmed'
before_digest=$(rab_read_state_value before_sha256 "${PAM_CURRENT}")
[[ ${before_digest} =~ ^[0-9a-f]{64}$ ]] || rab_die 'invalid original PAM digest metadata'
after_digest=$(rab_read_state_value after_sha256 "${PAM_CURRENT}")
[[ ${after_digest} =~ ^[0-9a-f]{64}$ ]] || rab_die 'invalid installed PAM digest metadata'
rab_require_owner_mode "${PAM_FILE}" 0 0 644
[[ $(rab_sha256 "${PAM_FILE}") == "${after_digest}" ]] ||
  rab_die 'gdm-password changed after installation; rollback instead of confirming'
/usr/bin/python3 -I -S -c '
import sys
with open(sys.argv[1], "rb") as stream:
    lines = stream.read().splitlines()
inject = b"auth optional pam_gdm_broker.so mode=inject socket=/run/remote-auth-broker/gdm/gdm-claim.sock"
clear = b"auth optional pam_gdm_broker.so mode=clear socket=/run/remote-auth-broker/gdm/gdm-claim.sock"
order = [
 b"auth    requisite       pam_nologin.so",
 b"auth\trequired\tpam_succeed_if.so user != root quiet_success",
 inject,
 b"@include common-auth",
 b"auth    optional        pam_gnome_keyring.so",
 clear,
 b"@include common-account",
]
positions = []
for line in order:
    if lines.count(line) != 1:
        raise SystemExit(1)
    positions.append(lines.index(line))
if positions != sorted(positions) or sum(b"pam_gdm_broker.so" in line for line in lines) != 2:
    raise SystemExit(1)
' "${PAM_FILE}" || rab_die 'installed PAM policy no longer has the exact reviewed broker layout'
rab_json_must_be_inactive "${RAB_ETC}/gdm.json"

backup="${PAM_BACKUPS}/${transaction}"
[[ -d ${backup} && ! -L ${backup} && $(/usr/bin/stat -c '%u:%g:%a' -- "${backup}") == 0:0:700 ]] ||
  rab_die 'PAM confirmation backup directory is unsafe'
receipt="${backup}/confirmation.receipt.tmp"
if [[ -e ${receipt} || -L ${receipt} ]]; then
  rab_require_owner_mode "${receipt}" 0 0 600
  /bin/rm -f -- "${receipt}"
fi
printf 'transaction=%s\nresult=confirmed\ninstalled_sha256=%s\nactive=false\n' \
  "${transaction}" "${after_digest}" >"${receipt}"
/usr/bin/chown root:root "${receipt}"
/usr/bin/chmod 0600 "${receipt}"
/bin/sync -f "${receipt}"

confirmed_tmp="${RAB_STATE}/.pam-current.${transaction}.confirmed"
if [[ -e ${confirmed_tmp} || -L ${confirmed_tmp} ]]; then
  rab_require_owner_mode "${confirmed_tmp}" 0 0 600
  /bin/rm -f -- "${confirmed_tmp}"
fi
printf 'transaction=%s\nstate=confirmed\nbefore_sha256=%s\nafter_sha256=%s\n' \
  "${transaction}" "${before_digest}" "${after_digest}" >"${confirmed_tmp}"
/usr/bin/chown root:root "${confirmed_tmp}"
/usr/bin/chmod 0600 "${confirmed_tmp}"
/bin/sync -f "${confirmed_tmp}"
/usr/bin/mv -Tf -- "${confirmed_tmp}" "${PAM_CURRENT}"
/bin/sync -f "${RAB_STATE}"

/usr/bin/systemctl disable --now remote-auth-pam-rollback.timer >/dev/null
/usr/bin/mv -Tf -- "${receipt}" "${backup}/confirmation.receipt"
/bin/sync -f "${backup}"
/bin/rm -f -- "${PAM_CURRENT}"
/bin/sync -f "${RAB_STATE}"
printf 'PAM transaction %s confirmed; broker policy remains active=false\n' "${transaction}"
