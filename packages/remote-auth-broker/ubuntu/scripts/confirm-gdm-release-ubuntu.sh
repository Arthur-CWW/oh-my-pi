#!/bin/bash
set -Eeuo pipefail
SCRIPT_DIR=$(cd -- "${BASH_SOURCE[0]%/*}" && pwd -P)
# shellcheck source=ubuntu-common.sh
source "${SCRIPT_DIR}/ubuntu-common.sh"

[[ $# -eq 0 ]] || rab_die 'confirm accepts no arguments'
rab_require_root
rab_require_tools
rab_require_target
[[ -x /usr/bin/flock ]] || rab_die 'a required fixed confirmation tool is unavailable'
/bin/mkdir -p -m 0700 -- "${RAB_RUN}"
exec 9>"${RAB_RUN}/gdm-deploy.lock"
/usr/bin/flock -n 9 || rab_die 'another fixed GDM deployment action is running'
rab_require_owner_mode "${PAM_CURRENT}" 0 0 600
transaction=$(rab_read_state_value transaction "${PAM_CURRENT}")
[[ ${transaction} =~ ^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$ ]] ||
  rab_die 'invalid pending PAM transaction metadata'
/usr/bin/systemctl is-active --quiet remote-auth-gdmd.service || rab_die 'GDM verifier service is not active'
[[ -S ${RAB_RUN}/gdm/ingest.sock && -S ${RAB_RUN}/gdm/gdm-claim.sock ]] ||
  rab_die 'GDM verifier sockets are not ready'
confirm_pam=${SCRIPT_DIR}/confirm-pam-ubuntu.sh
if [[ ! -x ${confirm_pam} ]]; then
  confirm_pam=${RAB_CURRENT}/scripts/confirm-pam-ubuntu.sh
fi
rab_require_owner_mode "${confirm_pam}" 0 0 755
"${confirm_pam}" "${transaction}"
