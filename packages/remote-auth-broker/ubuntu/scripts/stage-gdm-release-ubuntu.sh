#!/bin/bash
set -Eeuo pipefail
IFS=$'\n\t'
umask 077
export PATH=/home/arthur/.cargo/bin:/usr/bin:/bin
export LC_ALL=C
unset BASH_ENV ENV CDPATH GLOBIGNORE

readonly OWNER=arthur
readonly OWNER_HOME=/home/arthur
readonly STATE_ROOT=/home/arthur/.local/state/remote-auth-broker-gdm
readonly STAGE_ROOT=${STATE_ROOT}/staged
readonly CARGO=/home/arthur/.cargo/bin/cargo
SCRIPT_DIR=$(cd -- "${BASH_SOURCE[0]%/*}" && pwd -P)
readonly UBUNTU_ROOT=$(cd -- "${SCRIPT_DIR}/.." && pwd -P)
readonly IDENTITY_SOURCE=${UBUNTU_ROOT}/identity/remote-auth-gdm-ingest.pub

die() {
  printf 'remote-auth-gdm-stage: %s\n' "$1" >&2
  exit 1
}

[[ $# -eq 0 ]] || die 'staging accepts no arguments'
[[ ${EUID} -ne 0 ]] || die 'staging must run as the unprivileged owner'
[[ $(/usr/bin/id -un) == "${OWNER}" && ${HOME:-} == "${OWNER_HOME}" ]] ||
  die 'staging requires the fixed deployment owner'
[[ -r /etc/os-release ]] || die 'target identity is unavailable'
os_id='' version_id=''
while IFS='=' read -r key value; do
  value=${value#\"}
  value=${value%\"}
  case ${key} in
    ID) os_id=${value} ;;
    VERSION_ID) version_id=${value} ;;
  esac
done </etc/os-release
[[ ${os_id} == ubuntu && ${version_id} == 24.04 && $(/usr/bin/dpkg --print-architecture) == amd64 && $(/usr/bin/uname -m) == x86_64 ]] ||
  die 'staging requires Ubuntu 24.04 amd64'
[[ -x ${CARGO} ]] || die 'the pinned Rust build tool is unavailable'
for tool in /usr/bin/install /usr/bin/python3 /usr/bin/readelf /usr/bin/sha256sum /usr/bin/ssh-keygen; do
  [[ -x ${tool} ]] || die 'a required fixed staging tool is unavailable'
done
[[ -f ${UBUNTU_ROOT}/Cargo.lock && ! -L ${UBUNTU_ROOT}/Cargo.lock ]] || die 'the locked Ubuntu workspace is unavailable'
[[ -f ${IDENTITY_SOURCE} && ! -L ${IDENTITY_SOURCE} ]] || die 'the fixed GDM ingestion public identity is unavailable'
[[ $(/usr/bin/stat -c '%u:%a' -- "${IDENTITY_SOURCE}") == "${EUID}:600" ]] ||
  die 'the GDM ingestion public identity must be owner-only'
/usr/bin/python3 -I -S -c '
import base64, pathlib, sys
raw = pathlib.Path(sys.argv[1]).read_bytes()
if len(raw) > 256 or not raw.endswith(b"\n") or raw.count(b"\n") != 1:
    raise SystemExit(1)
parts = raw[:-1].split(b" ")
if len(parts) != 2 or parts[0] != b"ssh-ed25519":
    raise SystemExit(1)
key = base64.b64decode(parts[1], validate=True)
if len(key) != 51 or key[:4] != b"\x00\x00\x00\x0b" or key[4:15] != b"ssh-ed25519":
    raise SystemExit(1)
' "${IDENTITY_SOURCE}" || die 'the GDM ingestion public identity is malformed'
/usr/bin/ssh-keygen -l -f "${IDENTITY_SOURCE}" >/dev/null || die 'the GDM ingestion public identity is invalid'

if ! "${CARGO}" build --quiet --locked --release --manifest-path "${UBUNTU_ROOT}/Cargo.toml" \
  -p remote-auth-gdmd -p remote-auth-gdm-ingest -p pam-gdm-broker \
  -p remote-auth-broker-verifierctl >/dev/null 2>&1; then
  die 'the locked GDM release build failed'
fi
readonly BUILD_ROOT=${UBUNTU_ROOT}/target/release
for artifact in remote-auth-gdmd remote-auth-gdm-ingest remote-auth-verifierctl libpam_gdm_broker.so; do
  [[ -f ${BUILD_ROOT}/${artifact} && ! -L ${BUILD_ROOT}/${artifact} ]] || die 'a required GDM build artifact is missing'
  /usr/bin/readelf -h -- "${BUILD_ROOT}/${artifact}" | /usr/bin/awk '
    $1 == "Class:" { class_count++; class_ok = ($2 == "ELF64" && NF == 2) }
    $1 == "Machine:" { machine_count++; machine = $0; sub(/^[^:]*:[[:space:]]*/, "", machine); machine_ok = (machine == "Advanced Micro Devices X86-64") }
    END { exit !(class_count == 1 && class_ok && machine_count == 1 && machine_ok) }
  ' || die 'a GDM build artifact has the wrong architecture'
done

candidate=${STATE_ROOT}/.staged-candidate
/bin/mkdir -p -m 0700 -- "${STATE_ROOT}"
[[ $(/usr/bin/stat -c '%u:%a' -- "${STATE_ROOT}") == "${EUID}:700" ]] || die 'the staging root is not owner-only'
/bin/rm -rf -- "${candidate}"
/bin/mkdir -m 0700 -- "${candidate}"
/bin/mkdir -m 0700 -- "${candidate}/assets" "${candidate}/bin" "${candidate}/identity" "${candidate}/lib" "${candidate}/scripts"
/usr/bin/install -m 0700 -- "${BUILD_ROOT}/remote-auth-gdmd" "${candidate}/bin/remote-auth-gdmd"
/usr/bin/install -m 0700 -- "${BUILD_ROOT}/remote-auth-gdm-ingest" "${candidate}/bin/remote-auth-gdm-ingest"
/usr/bin/install -m 0700 -- "${BUILD_ROOT}/remote-auth-verifierctl" "${candidate}/bin/remote-auth-verifierctl"
/usr/bin/install -m 0600 -- "${BUILD_ROOT}/libpam_gdm_broker.so" "${candidate}/lib/pam_gdm_broker.so"

assets=(
  71-remote-auth-gdm-ingest.conf
  gdm-password.ubuntu-24.04.baseline
  gdm.inactive.template.json
  remote-auth-gdm.authorized-key-options
  remote-auth-gdm.tmpfiles.conf
  remote-auth-gdmd.service
  remote-auth-pam-rollback.service
  remote-auth-pam-rollback.timer
)
scripts=(
  activate-gdm-ubuntu.sh
  confirm-gdm-release-ubuntu.sh
  confirm-pam-ubuntu.sh
  deploy-gdm-release-ubuntu.sh
  deactivate-gdm-ubuntu.sh
  install-pam-ubuntu.sh
  rollback-pam-ubuntu.sh
  status-gdm-ubuntu.sh
  ubuntu-common.sh
)
for asset in "${assets[@]}"; do
  [[ -f ${UBUNTU_ROOT}/assets/${asset} && ! -L ${UBUNTU_ROOT}/assets/${asset} ]] || die 'a required reviewed GDM asset is missing'
  /usr/bin/install -m 0600 -- "${UBUNTU_ROOT}/assets/${asset}" "${candidate}/assets/${asset}"
done
for script in "${scripts[@]}"; do
  [[ -f ${UBUNTU_ROOT}/scripts/${script} && ! -L ${UBUNTU_ROOT}/scripts/${script} ]] || die 'a required reviewed deployment action is missing'
  /usr/bin/install -m 0700 -- "${UBUNTU_ROOT}/scripts/${script}" "${candidate}/scripts/${script}"
done
/usr/bin/install -m 0600 -- "${IDENTITY_SOURCE}" "${candidate}/identity/remote-auth-gdm-ingest.pub"

expected=(
  assets/71-remote-auth-gdm-ingest.conf
  assets/gdm-password.ubuntu-24.04.baseline
  assets/gdm.inactive.template.json
  assets/remote-auth-gdm.authorized-key-options
  assets/remote-auth-gdm.tmpfiles.conf
  assets/remote-auth-gdmd.service
  assets/remote-auth-pam-rollback.service
  assets/remote-auth-pam-rollback.timer
  bin/remote-auth-gdm-ingest
  bin/remote-auth-gdmd
  bin/remote-auth-verifierctl
  identity/remote-auth-gdm-ingest.pub
  lib/pam_gdm_broker.so
  scripts/activate-gdm-ubuntu.sh
  scripts/confirm-gdm-release-ubuntu.sh
  scripts/confirm-pam-ubuntu.sh
  scripts/deploy-gdm-release-ubuntu.sh
  scripts/deactivate-gdm-ubuntu.sh
  scripts/install-pam-ubuntu.sh
  scripts/rollback-pam-ubuntu.sh
  scripts/status-gdm-ubuntu.sh
  scripts/ubuntu-common.sh
)
(
  cd -- "${candidate}"
  /usr/bin/sha256sum -- "${expected[@]}" >manifest.sha256
)
/usr/bin/chmod 0600 -- "${candidate}/manifest.sha256"
release_digest=$(/usr/bin/sha256sum -- "${candidate}/manifest.sha256")
release_digest=${release_digest%% *}
/bin/rm -rf -- "${STAGE_ROOT}"
/usr/bin/mv -- "${candidate}" "${STAGE_ROOT}"
printf 'component=gdm-broker\nstaged_release_sha256=%s\nstaging=ready\n' "${release_digest}"
