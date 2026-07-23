#!/bin/bash
set -Eeuo pipefail
IFS=$'\n\t'
umask 077
export PATH=/usr/sbin:/usr/bin:/sbin:/bin
export LC_ALL=C
unset BASH_ENV ENV CDPATH GLOBIGNORE

readonly RAB_ROOT=/usr/libexec/remote-auth-broker
readonly RAB_CURRENT=/usr/libexec/remote-auth-broker/current
readonly RAB_ETC=/etc/remote-auth-broker
readonly RAB_STATE=/var/lib/remote-auth-broker
readonly RAB_RUN=/run/remote-auth-broker
readonly PAM_FILE=/etc/pam.d/gdm-password
readonly PAM_CURRENT=/var/lib/remote-auth-broker/pam-current
readonly PAM_BACKUPS=/var/lib/remote-auth-broker/pam-backups
readonly PAM_INJECT_LINE='auth optional pam_gdm_broker.so mode=inject socket=/run/remote-auth-broker/gdm/gdm-claim.sock'
readonly PAM_CLEAR_LINE='auth optional pam_gdm_broker.so mode=clear socket=/run/remote-auth-broker/gdm/gdm-claim.sock'

rab_die() {
  printf 'remote-auth-broker: %s\n' "$1" >&2
  exit 1
}

rab_require_root() {
  [[ ${EUID} -eq 0 ]] || rab_die 'this fixed-purpose deployment action requires root'
  [[ -z ${SUDO_USER:-} || ${SUDO_USER} != root ]] || rab_die 'refusing a malformed sudo caller identity'
}

rab_require_tools() {
  local tool
  for tool in \
    /bin/bash /bin/mkdir /bin/rm /bin/sync \
    /usr/bin/awk /usr/bin/cmp /usr/bin/cp /usr/bin/cut /usr/bin/diff \
    /usr/bin/dpkg /usr/bin/dpkg-architecture /usr/bin/dpkg-query \
    /usr/bin/find /usr/bin/getfacl /usr/bin/id \
    /usr/bin/install /usr/bin/ln /usr/bin/mv /usr/bin/python3 \
    /usr/bin/readelf /usr/bin/realpath /usr/bin/setfacl \
    /usr/bin/sha256sum /usr/bin/sleep /usr/bin/ssh-keygen /usr/bin/stat \
    /usr/bin/systemctl /usr/bin/systemd-analyze /usr/bin/uname \
    /usr/sbin/groupadd /usr/sbin/sshd /usr/sbin/useradd /usr/sbin/usermod; do
    [[ -x ${tool} ]] || rab_die "required fixed tool is unavailable: ${tool}"
  done
}

rab_require_target() {
  local os_id='' version_id='' key value package
  [[ -r /etc/os-release ]] || rab_die 'unsupported target: /etc/os-release is unreadable'
  while IFS='=' read -r key value; do
    value=${value#\"}
    value=${value%\"}
    case ${key} in
      ID) os_id=${value} ;;
      VERSION_ID) version_id=${value} ;;
    esac
  done </etc/os-release
  [[ ${os_id} == ubuntu && ${version_id} == 24.04 ]] ||
    rab_die 'unsupported target: exactly Ubuntu 24.04 is required'
  [[ $(/usr/bin/dpkg --print-architecture) == amd64 ]] ||
    rab_die 'unsupported target: dpkg architecture must be exactly amd64'
  [[ $(/usr/bin/dpkg-architecture -qDEB_HOST_MULTIARCH) == x86_64-linux-gnu ]] ||
    rab_die 'unsupported target: Debian multiarch must be exactly x86_64-linux-gnu'
  [[ $(/usr/bin/uname -m) == x86_64 ]] ||
    rab_die 'unsupported target: kernel architecture must be exactly x86_64'
  [[ -r /proc/1/comm ]] || rab_die 'unsupported target: PID 1 identity is unavailable'
  IFS= read -r value </proc/1/comm
  [[ ${value} == systemd ]] || rab_die 'unsupported target: systemd must be PID 1'
  for package in gdm3 libpam-gnome-keyring libpam0g openssh-server acl; do
    [[ $(/usr/bin/dpkg-query -W -f='${db:Status-Abbrev}' "${package}" 2>/dev/null) == ii\  ]] ||
      rab_die "required installed package is missing or unconfigured: ${package}"
  done
}

rab_require_regular() {
  local path=$1
  [[ -f ${path} && ! -L ${path} ]] || rab_die "required regular non-symlink file is missing: ${path}"
}

rab_require_owner_mode() {
  local path=$1 expected_uid=$2 expected_gid=$3 expected_mode=$4
  rab_require_regular "${path}"
  [[ $(/usr/bin/stat -c '%u' -- "${path}") == "${expected_uid}" ]] || rab_die "wrong owner for ${path}"
  [[ $(/usr/bin/stat -c '%g' -- "${path}") == "${expected_gid}" ]] || rab_die "wrong group for ${path}"
  [[ $(/usr/bin/stat -c '%a' -- "${path}") == "${expected_mode}" ]] || rab_die "wrong mode for ${path}"
}

rab_sha256() {
  local output digest
  output=$(/usr/bin/sha256sum -- "$1")
  digest=${output%% *}
  [[ ${digest} =~ ^[0-9a-f]{64}$ ]] || rab_die "invalid SHA-256 output for $1"
  printf '%s' "${digest}"
}

rab_json_must_be_inactive() {
  /usr/bin/python3 -I -S -c '
import json, os, stat, sys
path = sys.argv[1]
st = os.lstat(path)
if not stat.S_ISREG(st.st_mode) or st.st_uid != 0 or st.st_gid != 0 or stat.S_IMODE(st.st_mode) != 0o600:
    raise SystemExit(1)
with open(path, "rb") as stream:
    raw = stream.read(262145)
if len(raw) > 262144:
    raise SystemExit(1)
doc = json.loads(raw)
if type(doc) is not dict or doc.get("active") is not False:
    raise SystemExit(1)
' "$1" || rab_die "configuration is not a bounded root-owned active=false JSON object: $1"
}

rab_transaction_id() {
  local id
  [[ -r /proc/sys/kernel/random/uuid ]] || rab_die 'kernel UUID source is unavailable'
  IFS= read -r id </proc/sys/kernel/random/uuid
  [[ ${id} =~ ^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$ ]] ||
    rab_die 'kernel returned an invalid transaction identifier'
  printf '%s' "${id}"
}

rab_read_state_value() {
  local wanted=$1 file=$2 key value found=''
  rab_require_owner_mode "${file}" 0 0 600
  while IFS='=' read -r key value; do
    if [[ (${key} == before_sha256 || ${key} == sha256) &&
          ${value} =~ ^([0-9a-f]{64})[[:space:]]+/etc/pam.d/gdm-password$ ]]; then
      value=${BASH_REMATCH[1]}
    elif [[ (${key} == after_sha256 || ${key} == sha256) &&
            ${value} =~ ^([0-9a-f]{64})[[:space:]]+/etc/pam.d/\.gdm-password\.remote-auth\.[0-9a-f-]+$ ]]; then
      value=${BASH_REMATCH[1]}
    fi
    [[ ${key} =~ ^[a-z][a-z0-9_]*$ && ${value} =~ ^[A-Za-z0-9._:/+-]+$ ]] || rab_die "invalid state record: ${file}"
    if [[ ${key} == "${wanted}" ]]; then
      [[ -z ${found} ]] || rab_die "duplicate ${wanted} in ${file}"
      found=${value}
    fi
  done <"${file}"
  [[ -n ${found} ]] || rab_die "missing ${wanted} in ${file}"
  printf '%s' "${found}"
}

rab_atomic_install() {
  local source=$1 target=$2 mode=$3 directory temporary
  directory=${target%/*}
  temporary="${directory}/.remote-auth-broker.$(rab_transaction_id).tmp"
  /usr/bin/install -o root -g root -m "${mode}" -- "${source}" "${temporary}"
  /bin/sync -f "${temporary}"
  /usr/bin/mv -Tf -- "${temporary}" "${target}"
  /bin/sync -f "${directory}"
}

rab_stop_rollback_timer() {
  /usr/bin/systemctl disable --now remote-auth-pam-rollback.timer >/dev/null
  /usr/bin/systemctl stop remote-auth-pam-rollback.service >/dev/null || true
}
