#!/bin/bash
set -Eeuo pipefail
IFS=$'\n\t'
umask 077
export PATH=/usr/sbin:/usr/bin:/sbin:/bin
export LC_ALL=C
unset BASH_ENV ENV CDPATH GLOBIGNORE

SCRIPT_DIR=$(cd -- "${BASH_SOURCE[0]%/*}" && pwd -P)
readonly BOOTSTRAP_ENTRYPOINT_NAME=deploy-gdm-release-ubuntu.sh
readonly INSTALLED_ENTRYPOINT_NAME=remote-auth-gdm-deploy
readonly COMMON_NAME=ubuntu-common.sh
readonly ENTRYPOINT_PATH=${SCRIPT_DIR}/${BASH_SOURCE[0]##*/}
case ${BASH_SOURCE[0]##*/} in
  "${BOOTSTRAP_ENTRYPOINT_NAME}"|"${INSTALLED_ENTRYPOINT_NAME}") ;;
  *)
    printf 'remote-auth-broker: the fixed deployment entrypoint name is invalid\n' >&2
    exit 1
    ;;
esac
for bootstrap_file in "${ENTRYPOINT_PATH}" "${SCRIPT_DIR}/${COMMON_NAME}"; do
  [[ -f ${bootstrap_file} && ! -L ${bootstrap_file} ]] || {
    printf 'remote-auth-broker: a root-owned deployment bootstrap source is unavailable\n' >&2
    exit 1
  }
  [[ $(/usr/bin/stat -c '%u:%g:%a:%h' -- "${bootstrap_file}") == 0:0:700:1 ]] || {
    printf 'remote-auth-broker: deployment bootstrap source metadata is invalid\n' >&2
    exit 1
  }
done
# shellcheck source=ubuntu-common.sh
source "${SCRIPT_DIR}/${COMMON_NAME}"

readonly DEPLOY_OWNER=arthur
readonly DEPLOY_HOME=/home/arthur
readonly USER_STAGE_ROOT=/home/arthur/.local/state/remote-auth-broker-gdm/staged
readonly RELEASES=${RAB_ROOT}/releases
readonly DEPLOY_STATE=${RAB_STATE}/gdm-release-current
readonly DEPLOY_STATIC=${RAB_ROOT}/remote-auth-gdm-deploy
readonly ACTIVATE_STATIC=${RAB_ROOT}/remote-auth-gdm-activate
readonly DEACTIVATE_STATIC=${RAB_ROOT}/remote-auth-gdm-deactivate
readonly STATUS_STATIC=${RAB_ROOT}/remote-auth-gdm-status
readonly CONFIRM_STATIC=${RAB_ROOT}/remote-auth-gdm-confirm
readonly COMMON_STATIC=${RAB_ROOT}/ubuntu-common.sh
readonly GDM_USER=remote-auth-gdm-ingest
readonly GDM_GROUP=remote-auth-gdm-ingest
readonly GDM_CONFIG=${RAB_ETC}/gdm.json
readonly VERIFIER_MANIFEST=${RAB_ETC}/key-manifest.json
readonly SUDO_REGISTRY=${RAB_ETC}/sudo-registry.json
readonly VERIFIER_KEYS=${RAB_ETC}/keys
readonly GDM_KEYS=${RAB_ETC}/gdm-ingest.authorized_keys
readonly GDM_UNIT=/etc/systemd/system/remote-auth-gdmd.service
readonly PAM_ROLLBACK_UNIT=/etc/systemd/system/remote-auth-pam-rollback.service
readonly PAM_ROLLBACK_TIMER=/etc/systemd/system/remote-auth-pam-rollback.timer
readonly TMPFILES_CONFIG=/etc/tmpfiles.d/remote-auth-gdm.conf
readonly SSHD_CONFIG=/etc/ssh/sshd_config.d/71-remote-auth-gdm-ingest.conf
readonly MODULE_TARGET=/usr/lib/x86_64-linux-gnu/security/pam_gdm_broker.so
readonly ACTIVATION_BUNDLE=${DEPLOY_HOME}/.local/state/remote-auth-broker-gdm/activation/gdm-activation-bundle.json

case ${1:-} in
  install)
    [[ $# -eq 2 && $2 =~ ^[0-9a-f]{64}$ ]] ||
      rab_die 'usage: root-owned deploy-gdm-release-ubuntu.sh install EXPECTED_RELEASE_SHA256'
    action=install
    readonly expected_stage_release=$2
    [[ ${BASH_SOURCE[0]##*/} == "${BOOTSTRAP_ENTRYPOINT_NAME}" ]] ||
      rab_die 'install requires the fixed bootstrap entrypoint name'
    [[ ${SCRIPT_DIR} =~ ^/run/remote-auth-gdm-bootstrap\.[A-Za-z0-9]{8}$ ]] ||
      rab_die 'install requires the fresh fixed root-owned bootstrap entrypoint'
    [[ $(/usr/bin/stat -c '%u:%g:%a' -- "${SCRIPT_DIR}") == 0:0:700 ]] ||
      rab_die 'the install bootstrap directory metadata is invalid'
    ;;
  status|rollback)
    [[ $# -eq 1 ]] || rab_die 'usage: remote-auth-gdm-deploy {status|rollback}'
    action=$1
    readonly expected_stage_release=''
    [[ ${BASH_SOURCE[0]##*/} == "${INSTALLED_ENTRYPOINT_NAME}" ]] ||
      rab_die 'status and rollback require the installed entrypoint name'
    [[ ${SCRIPT_DIR} == "${RAB_ROOT}" ]] ||
      rab_die 'status and rollback require the installed root-owned entrypoint'
    ;;
  *)
    rab_die 'action must be exactly install, status, or rollback'
    ;;
esac
rab_require_root
rab_require_tools
rab_require_target
for tool in \
  /usr/bin/flock /usr/bin/getent /usr/bin/mount /usr/bin/readlink \
  /usr/bin/systemd-tmpfiles /usr/bin/unshare \
  /usr/sbin/groupdel /usr/sbin/userdel; do
  [[ -x ${tool} ]] || rab_die 'a required fixed deployment tool is unavailable'
done
/bin/mkdir -p -m 0700 -- "${RAB_RUN}"
exec 9>"${RAB_RUN}/gdm-deploy.lock"
/usr/bin/flock -n 9 || rab_die 'another fixed GDM deployment action is running'

deploy_state_value() {
  rab_read_state_value "$1" "${DEPLOY_STATE}"
}

require_deploy_state() {
  rab_require_owner_mode "${DEPLOY_STATE}" 0 0 600
  release_id=$(deploy_state_value release)
  [[ ${release_id} =~ ^[0-9a-f]{64}$ ]] || rab_die 'installed release metadata is invalid'
  release_dir=${RELEASES}/${release_id}
  [[ -d ${release_dir} && ! -L ${release_dir} ]] || rab_die 'installed release directory is unavailable'
  [[ $(/usr/bin/stat -c '%u:%g:%a' -- "${release_dir}") == 0:0:755 ]] || rab_die 'installed release directory metadata is invalid'
  [[ $(rab_sha256 "${release_dir}/manifest.sha256") == "${release_id}" ]] ||
    rab_die 'installed release directory is not bound to its deployment digest'
}

verify_release_manifest() {
  local root=$1 expected_owner=$2 directory_mode=$3 executable_mode=$4 data_mode=$5 layout=${6:-current}
  /usr/bin/python3 -I -S - "${root}" "${expected_owner}" "${directory_mode}" "${executable_mode}" "${data_mode}" "${layout}" <<'PY'
import hashlib, os, pathlib, stat, sys
root = pathlib.Path(sys.argv[1])
owner = int(sys.argv[2])
dir_mode = int(sys.argv[3], 8)
exec_mode = int(sys.argv[4], 8)
data_mode = int(sys.argv[5], 8)
layout = sys.argv[6]
if layout == "legacy":
    expected = [
        "assets/71-remote-auth-gdm-ingest.conf",
        "assets/gdm-password.ubuntu-24.04.baseline",
        "assets/gdm.inactive.template.json",
        "assets/remote-auth-gdm.authorized-key-options",
        "assets/remote-auth-gdm.tmpfiles.conf",
        "assets/remote-auth-gdmd.service",
        "assets/remote-auth-pam-rollback.service",
        "assets/remote-auth-pam-rollback.timer",
        "bin/remote-auth-gdm-ingest",
        "bin/remote-auth-gdmd",
        "identity/remote-auth-gdm-ingest.pub",
        "lib/pam_gdm_broker.so",
        "scripts/confirm-gdm-release-ubuntu.sh",
        "scripts/confirm-pam-ubuntu.sh",
        "scripts/deploy-gdm-release-ubuntu.sh",
        "scripts/install-pam-ubuntu.sh",
        "scripts/rollback-pam-ubuntu.sh",
        "scripts/ubuntu-common.sh",
    ]
elif layout == "current":
    expected = [
        "assets/71-remote-auth-gdm-ingest.conf",
        "assets/gdm-password.ubuntu-24.04.baseline",
        "assets/gdm.inactive.template.json",
        "assets/remote-auth-gdm.authorized-key-options",
        "assets/remote-auth-gdm.tmpfiles.conf",
        "assets/remote-auth-gdmd.service",
        "assets/remote-auth-pam-rollback.service",
        "assets/remote-auth-pam-rollback.timer",
        "bin/remote-auth-gdm-ingest",
        "bin/remote-auth-gdmd",
        "bin/remote-auth-verifierctl",
        "identity/remote-auth-gdm-ingest.pub",
        "lib/pam_gdm_broker.so",
        "scripts/activate-gdm-ubuntu.sh",
        "scripts/confirm-gdm-release-ubuntu.sh",
        "scripts/confirm-pam-ubuntu.sh",
        "scripts/deploy-gdm-release-ubuntu.sh",
        "scripts/deactivate-gdm-ubuntu.sh",
        "scripts/install-pam-ubuntu.sh",
        "scripts/rollback-pam-ubuntu.sh",
        "scripts/status-gdm-ubuntu.sh",
        "scripts/ubuntu-common.sh",
    ]
else:
    raise SystemExit(1)
expected_dirs = {"assets", "bin", "identity", "lib", "scripts"}
root_stat = os.lstat(root)
if not stat.S_ISDIR(root_stat.st_mode) or root_stat.st_uid != owner or stat.S_IMODE(root_stat.st_mode) != dir_mode:
    raise SystemExit(1)
actual_files = set()
actual_dirs = set()
for base, dirs, files in os.walk(root, topdown=True, followlinks=False):
    base_path = pathlib.Path(base)
    for name in dirs:
        path = base_path / name
        rel = path.relative_to(root).as_posix()
        st = os.lstat(path)
        if not stat.S_ISDIR(st.st_mode) or st.st_uid != owner or stat.S_IMODE(st.st_mode) != dir_mode:
            raise SystemExit(1)
        actual_dirs.add(rel)
    for name in files:
        path = base_path / name
        rel = path.relative_to(root).as_posix()
        st = os.lstat(path)
        mode = 0o600 if rel.startswith("generated/") else (exec_mode if rel.startswith("bin/") or rel.startswith("scripts/") else data_mode)
        if not stat.S_ISREG(st.st_mode) or st.st_uid != owner or stat.S_IMODE(st.st_mode) != mode or st.st_nlink != 1:
            raise SystemExit(1)
        actual_files.add(rel)
generated_files = {"generated/gdm-ingest.authorized_keys"}
if layout == "legacy":
    generated_files.add("generated/gdm.json")
plain_dirs = expected_dirs
plain_files = set(expected) | {"manifest.sha256"}
generated_dirs = expected_dirs | {"generated"}
if not (
    (actual_dirs == plain_dirs and actual_files == plain_files)
    or (owner == 0 and actual_dirs == generated_dirs and actual_files == plain_files | generated_files)
):
    raise SystemExit(1)
manifest = (root / "manifest.sha256").read_bytes()
if len(manifest) > 8192 or not manifest.endswith(b"\n"):
    raise SystemExit(1)
lines = manifest.splitlines()
if len(lines) != len(expected):
    raise SystemExit(1)
for line, wanted in zip(lines, expected):
    parts = line.split(b"  ")
    if len(parts) != 2 or parts[1].decode("ascii", "strict") != wanted:
        raise SystemExit(1)
    digest = parts[0].decode("ascii", "strict")
    if len(digest) != 64 or any(c not in "0123456789abcdef" for c in digest):
        raise SystemExit(1)
    actual = hashlib.sha256((root / wanted).read_bytes()).hexdigest()
    if actual != digest:
        raise SystemExit(1)
PY
}

create_authenticated_stage_snapshot() {
  deploy_uid=$(/usr/bin/id -u "${DEPLOY_OWNER}")
  deploy_gid=$(/usr/bin/id -g "${DEPLOY_OWNER}")
  [[ $(/usr/bin/getent passwd "${DEPLOY_OWNER}" | /usr/bin/cut -d: -f6) == "${DEPLOY_HOME}" ]] ||
    rab_die 'the fixed deployment owner has an unexpected home'
  local path
  for path in "${DEPLOY_HOME}" "${DEPLOY_HOME}/.local" "${DEPLOY_HOME}/.local/state" "${DEPLOY_HOME}/.local/state/remote-auth-broker-gdm"; do
    [[ -d ${path} && ! -L ${path} && $(/usr/bin/stat -c '%u' -- "${path}") == "${deploy_uid}" ]] ||
      rab_die 'the fixed owner staging chain is unsafe'
  done
  [[ $(/usr/bin/stat -c '%a' -- "${DEPLOY_HOME}/.local/state/remote-auth-broker-gdm") == 700 ]] ||
    rab_die 'the fixed staging root is not owner-only'

  snapshot_root=$(/usr/bin/mktemp -d /run/remote-auth-gdm-snapshot.XXXXXXXX)
  [[ ${snapshot_root} =~ ^/run/remote-auth-gdm-snapshot\.[A-Za-z0-9]{8}$ ]] ||
    rab_die 'the root-owned stage snapshot path is invalid'
  [[ $(/usr/bin/stat -c '%u:%g:%a' -- "${snapshot_root}") == 0:0:700 ]] ||
    rab_die 'the root-owned stage snapshot metadata is invalid'

  /usr/bin/python3 -I -S - "${USER_STAGE_ROOT}" "${snapshot_root}" "${deploy_uid}" "${deploy_gid}" "${expected_stage_release}" <<'PY'
import hashlib
import os
import stat
import sys

source, target, owner_text, group_text, expected_release = sys.argv[1:]
owner = int(owner_text)
group = int(group_text)
ordered_files = [
    "assets/71-remote-auth-gdm-ingest.conf",
    "assets/gdm-password.ubuntu-24.04.baseline",
    "assets/gdm.inactive.template.json",
    "assets/remote-auth-gdm.authorized-key-options",
    "assets/remote-auth-gdm.tmpfiles.conf",
    "assets/remote-auth-gdmd.service",
    "assets/remote-auth-pam-rollback.service",
    "assets/remote-auth-pam-rollback.timer",
    "bin/remote-auth-gdm-ingest",
    "bin/remote-auth-gdmd",
    "bin/remote-auth-verifierctl",
    "identity/remote-auth-gdm-ingest.pub",
    "lib/pam_gdm_broker.so",
    "scripts/activate-gdm-ubuntu.sh",
    "scripts/confirm-gdm-release-ubuntu.sh",
    "scripts/confirm-pam-ubuntu.sh",
    "scripts/deploy-gdm-release-ubuntu.sh",
    "scripts/deactivate-gdm-ubuntu.sh",
    "scripts/install-pam-ubuntu.sh",
    "scripts/rollback-pam-ubuntu.sh",
    "scripts/status-gdm-ubuntu.sh",
    "scripts/ubuntu-common.sh",
]
expected_dirs = ("assets", "bin", "identity", "lib", "scripts")
expected_by_dir = {
    name: {path.split("/", 1)[1] for path in ordered_files if path.startswith(name + "/")}
    for name in expected_dirs
}
expected_top = set(expected_dirs) | {"manifest.sha256"}

def metadata_signature(value):
    return (
        value.st_dev,
        value.st_ino,
        value.st_mode,
        value.st_uid,
        value.st_gid,
        value.st_nlink,
        value.st_size,
        value.st_mtime_ns,
        value.st_ctime_ns,
    )

def require_directory(value, expected_uid, expected_gid, expected_mode):
    if (
        not stat.S_ISDIR(value.st_mode)
        or value.st_uid != expected_uid
        or value.st_gid != expected_gid
        or stat.S_IMODE(value.st_mode) != expected_mode
    ):
        raise SystemExit("stage directory metadata mismatch")

def require_regular(value, expected_uid, expected_gid, expected_mode):
    if (
        not stat.S_ISREG(value.st_mode)
        or value.st_uid != expected_uid
        or value.st_gid != expected_gid
        or stat.S_IMODE(value.st_mode) != expected_mode
        or value.st_nlink != 1
    ):
        raise SystemExit("stage file metadata mismatch")

source_fd = os.open(source, os.O_RDONLY | os.O_DIRECTORY | os.O_NOFOLLOW)
target_fd = os.open(target, os.O_RDONLY | os.O_DIRECTORY | os.O_NOFOLLOW)
directory_fds = {}
try:
    source_before = os.fstat(source_fd)
    require_directory(source_before, owner, group, 0o700)
    require_directory(os.fstat(target_fd), 0, 0, 0o700)
    if set(os.listdir(source_fd)) != expected_top:
        raise SystemExit("stage top-level set mismatch")

    directory_before = {}
    for name in expected_dirs:
        directory_fd = os.open(
            name, os.O_RDONLY | os.O_DIRECTORY | os.O_NOFOLLOW, dir_fd=source_fd
        )
        directory_fds[name] = directory_fd
        value = os.fstat(directory_fd)
        require_directory(value, owner, group, 0o700)
        directory_before[name] = metadata_signature(value)
        if set(os.listdir(directory_fd)) != expected_by_dir[name]:
            raise SystemExit("stage directory set mismatch")
        os.mkdir(name, 0o700, dir_fd=target_fd)

    def stable_read(parent_fd, name, mode, maximum_size):
        path_before = os.stat(name, dir_fd=parent_fd, follow_symlinks=False)
        require_regular(path_before, owner, group, mode)
        if path_before.st_size > maximum_size:
            raise SystemExit("stage file exceeds its fixed size bound")
        descriptor = os.open(name, os.O_RDONLY | os.O_NOFOLLOW, dir_fd=parent_fd)
        try:
            opened = os.fstat(descriptor)
            if metadata_signature(opened) != metadata_signature(path_before):
                raise SystemExit("stage file changed before read")
            chunks = []
            total = 0
            while True:
                chunk = os.read(descriptor, min(65536, maximum_size + 1 - total))
                if not chunk:
                    break
                total += len(chunk)
                if total > maximum_size:
                    raise SystemExit("stage file exceeds its fixed size bound")
                chunks.append(chunk)
            after = os.fstat(descriptor)
            if metadata_signature(after) != metadata_signature(opened):
                raise SystemExit("stage file changed during read")
        finally:
            os.close(descriptor)
        path_after = os.stat(name, dir_fd=parent_fd, follow_symlinks=False)
        if metadata_signature(path_after) != metadata_signature(path_before):
            raise SystemExit("stage file changed across read")
        return b"".join(chunks)

    manifest = stable_read(source_fd, "manifest.sha256", 0o600, 8192)
    if hashlib.sha256(manifest).hexdigest() != expected_release:
        raise SystemExit("stage manifest does not match the authenticated release")
    if len(manifest) > 8192 or not manifest.endswith(b"\n"):
        raise SystemExit("stage manifest encoding mismatch")
    lines = manifest.splitlines()
    if len(lines) != len(ordered_files):
        raise SystemExit("stage manifest length mismatch")
    expected_hashes = {}
    for line, wanted in zip(lines, ordered_files):
        parts = line.split(b"  ")
        if len(parts) != 2 or parts[1].decode("ascii", "strict") != wanted:
            raise SystemExit("stage manifest path mismatch")
        digest = parts[0].decode("ascii", "strict")
        if len(digest) != 64 or any(c not in "0123456789abcdef" for c in digest):
            raise SystemExit("stage manifest digest encoding mismatch")
        expected_hashes[wanted] = digest

    manifest_out = os.open(
        "manifest.sha256",
        os.O_WRONLY | os.O_CREAT | os.O_EXCL,
        0o600,
        dir_fd=target_fd,
    )
    try:
        view = memoryview(manifest)
        while view:
            view = view[os.write(manifest_out, view):]
        os.fsync(manifest_out)
    finally:
        os.close(manifest_out)

    for relative in ordered_files:
        directory, name = relative.split("/", 1)
        source_parent = directory_fds[directory]
        mode = 0o700 if directory in {"bin", "scripts"} else 0o600
        source_path_before = os.stat(name, dir_fd=source_parent, follow_symlinks=False)
        require_regular(source_path_before, owner, group, mode)
        source_file = os.open(
            name, os.O_RDONLY | os.O_NOFOLLOW, dir_fd=source_parent
        )
        target_parent = os.open(
            directory, os.O_RDONLY | os.O_DIRECTORY | os.O_NOFOLLOW, dir_fd=target_fd
        )
        try:
            opened = os.fstat(source_file)
            if metadata_signature(opened) != metadata_signature(source_path_before):
                raise SystemExit("stage file changed before snapshot copy")
            target_file = os.open(
                name,
                os.O_WRONLY | os.O_CREAT | os.O_EXCL,
                mode,
                dir_fd=target_parent,
            )
            digest = hashlib.sha256()
            try:
                while True:
                    chunk = os.read(source_file, 1024 * 1024)
                    if not chunk:
                        break
                    digest.update(chunk)
                    view = memoryview(chunk)
                    while view:
                        view = view[os.write(target_file, view):]
                os.fsync(target_file)
            finally:
                os.close(target_file)
            after = os.fstat(source_file)
            if metadata_signature(after) != metadata_signature(opened):
                raise SystemExit("stage file changed during snapshot copy")
        finally:
            os.close(source_file)
            os.close(target_parent)
        source_path_after = os.stat(name, dir_fd=source_parent, follow_symlinks=False)
        if metadata_signature(source_path_after) != metadata_signature(source_path_before):
            raise SystemExit("stage file changed across snapshot copy")
        if digest.hexdigest() != expected_hashes[relative]:
            raise SystemExit("stage file hash mismatch")

    if set(os.listdir(source_fd)) != expected_top:
        raise SystemExit("stage top-level changed during snapshot copy")
    if metadata_signature(os.fstat(source_fd)) != metadata_signature(source_before):
        raise SystemExit("stage root changed during snapshot copy")
    for name, directory_fd in directory_fds.items():
        if set(os.listdir(directory_fd)) != expected_by_dir[name]:
            raise SystemExit("stage directory changed during snapshot copy")
        if metadata_signature(os.fstat(directory_fd)) != directory_before[name]:
            raise SystemExit("stage directory metadata changed during snapshot copy")
        target_directory_fd = os.open(
            name, os.O_RDONLY | os.O_DIRECTORY | os.O_NOFOLLOW, dir_fd=target_fd
        )
        try:
            os.fsync(target_directory_fd)
        finally:
            os.close(target_directory_fd)
    os.fsync(target_fd)
finally:
    for descriptor in directory_fds.values():
        os.close(descriptor)
    os.close(source_fd)
    os.close(target_fd)
PY

  STAGE_ROOT=${snapshot_root}
  verify_release_manifest "${STAGE_ROOT}" 0 0700 0700 0600 ||
    rab_die 'the root-owned GDM snapshot failed exact manifest verification'
  stage_release=$(/usr/bin/sha256sum -- "${STAGE_ROOT}/manifest.sha256")
  stage_release=${stage_release%% *}
  [[ ${stage_release} == "${expected_stage_release}" ]] ||
    rab_die 'the root-owned GDM snapshot release digest changed'
  for artifact in bin/remote-auth-gdmd bin/remote-auth-gdm-ingest bin/remote-auth-verifierctl lib/pam_gdm_broker.so; do
    LC_ALL=C /usr/bin/readelf -h -- "${STAGE_ROOT}/${artifact}" | /usr/bin/awk '
      $1 == "Class:" { class_count++; class_ok = ($2 == "ELF64" && NF == 2) }
      $1 == "Machine:" { machine_count++; machine = $0; sub(/^[^:]*:[[:space:]]*/, "", machine); machine_ok = (machine == "Advanced Micro Devices X86-64") }
      END { exit !(class_count == 1 && class_ok && machine_count == 1 && machine_ok) }
    ' || rab_die 'a snapshotted GDM artifact has the wrong ELF architecture'
  done
}

verify_socket() {
  local path=$1 expected_gid=$2 expected_mode=$3
  [[ -S ${path} ]] || return 1
  [[ $(/usr/bin/stat -c '%u:%g:%a' -- "${path}") == "0:${expected_gid}:${expected_mode}" ]]
}

verify_ssh_policy() {
  /usr/sbin/sshd -t >/dev/null 2>&1 || return 1
  /usr/sbin/sshd -T -C user=remote-auth-gdm-ingest,host=localhost,addr=127.0.0.1 2>/dev/null | /usr/bin/awk '
    $1 == "forcecommand" && $2 == "/usr/libexec/remote-auth-broker/current/bin/remote-auth-gdm-ingest" { force++ }
    $1 == "authorizedkeysfile" && $2 == "/etc/remote-auth-broker/gdm-ingest.authorized_keys" { keys++ }
    $1 == "authenticationmethods" && $2 == "publickey" { methods++ }
    $1 == "pubkeyauthentication" && $2 == "yes" { pubkey++ }
    $1 == "passwordauthentication" && $2 == "no" { password++ }
    $1 == "kbdinteractiveauthentication" && $2 == "no" { keyboard++ }
    $1 == "permittty" && $2 == "no" { tty++ }
    END { exit !(force == 1 && keys == 1 && methods == 1 && pubkey == 1 && password == 1 && keyboard == 1 && tty == 1) }
  '
}

verify_pam_layout() {
  /usr/bin/python3 -I -S - "${PAM_FILE}" <<'PY'
import pathlib, sys
lines = pathlib.Path(sys.argv[1]).read_bytes().splitlines()
inject = b"auth optional pam_gdm_broker.so mode=inject socket=/run/remote-auth-broker/gdm/gdm-claim.sock"
clear = b"auth optional pam_gdm_broker.so mode=clear socket=/run/remote-auth-broker/gdm/gdm-claim.sock"
if lines.count(inject) != 1 or lines.count(clear) != 1 or lines.index(inject) >= lines.index(clear):
    raise SystemExit(1)
if sum(b"pam_gdm_broker.so" in line for line in lines) != 2:
    raise SystemExit(1)
PY
}

require_installed_identical() {
  local installed=$1 reviewed=$2 mode=$3
  rab_require_owner_mode "${installed}" 0 0 "${mode}"
  /usr/bin/cmp -s -- "${installed}" "${reviewed}" || rab_die 'an installed GDM transaction artifact differs from its release'
}

print_status() {
  require_deploy_state
  verify_release_manifest "${release_dir}" 0 0755 0755 0644 || rab_die 'installed release bytes do not match the reviewed manifest'
  [[ -L ${RAB_CURRENT} && $(/usr/bin/realpath -e -- "${RAB_CURRENT}") == "${release_dir}" ]] || rab_die 'the installed release is not current'
  "${release_dir}/bin/remote-auth-verifierctl" validate ||
    rab_die 'installed verifier state is invalid or drifted'
  require_installed_identical "${GDM_KEYS}" "${release_dir}/generated/gdm-ingest.authorized_keys" 600
  require_installed_identical "${GDM_UNIT}" "${release_dir}/assets/remote-auth-gdmd.service" 644
  require_installed_identical "${PAM_ROLLBACK_UNIT}" "${release_dir}/assets/remote-auth-pam-rollback.service" 644
  require_installed_identical "${PAM_ROLLBACK_TIMER}" "${release_dir}/assets/remote-auth-pam-rollback.timer" 644
  require_installed_identical "${TMPFILES_CONFIG}" "${release_dir}/assets/remote-auth-gdm.tmpfiles.conf" 644
  require_installed_identical "${SSHD_CONFIG}" "${release_dir}/assets/71-remote-auth-gdm-ingest.conf" 644
  require_installed_identical "${DEPLOY_STATIC}" "${release_dir}/scripts/deploy-gdm-release-ubuntu.sh" 700
  require_installed_identical "${ACTIVATE_STATIC}" "${release_dir}/scripts/activate-gdm-ubuntu.sh" 700
  require_installed_identical "${DEACTIVATE_STATIC}" "${release_dir}/scripts/deactivate-gdm-ubuntu.sh" 700
  require_installed_identical "${STATUS_STATIC}" "${release_dir}/scripts/status-gdm-ubuntu.sh" 700
  require_installed_identical "${CONFIRM_STATIC}" "${release_dir}/scripts/confirm-gdm-release-ubuntu.sh" 700
  require_installed_identical "${COMMON_STATIC}" "${release_dir}/scripts/ubuntu-common.sh" 700
  require_installed_identical "${MODULE_TARGET}" "${release_dir}/lib/pam_gdm_broker.so" 644
  verify_pam_layout || rab_die 'the installed PAM layout is invalid'
  /usr/bin/systemctl is-active --quiet remote-auth-gdmd.service || rab_die 'the GDM verifier service is not active'
  /usr/bin/systemctl is-active --quiet ssh.service || rab_die 'the SSH service is not active'
  ingest_gid=$(/usr/bin/id -g "${GDM_USER}")
  verify_socket "${RAB_RUN}/gdm/ingest.sock" "${ingest_gid}" 660 || rab_die 'the GDM ingestion socket is not ready'
  verify_socket "${RAB_RUN}/gdm/gdm-claim.sock" 0 600 || rab_die 'the GDM claim socket is not ready'
  verify_ssh_policy || rab_die 'the forced GDM SSH policy is not effective'
  if [[ -e ${PAM_CURRENT} || -L ${PAM_CURRENT} ]]; then
    rab_require_owner_mode "${PAM_CURRENT}" 0 0 600
    pam_transaction_state=$(rab_read_state_value state "${PAM_CURRENT}")
    case ${pam_transaction_state} in
      installed)
        /usr/bin/systemctl is-active --quiet remote-auth-pam-rollback.timer || rab_die 'the PAM rollback timer is not armed'
        pam_state=armed
        ;;
      confirmed)
        pam_state=confirmed
        ;;
      *)
        rab_die 'the PAM rollback transaction has an invalid status state'
        ;;
    esac
  else
    ! /usr/bin/systemctl is-active --quiet remote-auth-pam-rollback.timer || rab_die 'the PAM rollback timer remained active after confirmation'
    pam_state=confirmed
  fi
  printf 'component=gdm-broker\nrelease_sha256=%s\ndeployment=installed\npolicy=inactive\npam=%s\ndaemon=active\nssh_ingest=ready\ningest_socket=ready\nclaim_socket=ready\n' "${release_id}" "${pam_state}"
}

ensure_root_directory() {
  local directory=$1 mode=$2
  if [[ -e ${directory} || -L ${directory} ]]; then
    [[ -d ${directory} && ! -L ${directory} ]] ||
      rab_die "a fixed deployment directory is not a real directory: ${directory}"
    [[ $(/usr/bin/stat -c '%u:%g:%a' -- "${directory}") == "0:0:${mode}" ]] ||
      rab_die "a fixed deployment directory has unsafe metadata: ${directory}"
  else
    /bin/mkdir -m "${mode}" -- "${directory}"
  fi
}

install_release_copy() {
  local source target relative mode
  release_dir=${RELEASES}/${stage_release}
  [[ ! -e ${release_dir} && ! -L ${release_dir} ]] || rab_die 'an untracked release already occupies the staged digest'
  ensure_root_directory "${RAB_ROOT}" 755
  ensure_root_directory "${RELEASES}" 755
  target=${RELEASES}/.incoming-${stage_release}
  [[ ! -e ${target} && ! -L ${target} ]] ||
    rab_die 'an untracked incoming release already occupies the staged digest'
  release_incoming=${target}
  /bin/mkdir -m 0755 -- "${target}"
  /bin/mkdir -m 0755 -- "${target}/assets" "${target}/bin" "${target}/identity" "${target}/lib" "${target}/scripts"
  while IFS= read -r relative; do
    [[ ${relative} == bin/* || ${relative} == scripts/* ]] && mode=0755 || mode=0644
    /usr/bin/install -o root -g root -m "${mode}" -- "${STAGE_ROOT}/${relative}" "${target}/${relative}"
  done < <(/usr/bin/awk '{print $2}' "${STAGE_ROOT}/manifest.sha256")
  /usr/bin/install -o root -g root -m 0644 -- "${STAGE_ROOT}/manifest.sha256" "${target}/manifest.sha256"
  verify_release_manifest "${target}" 0 0755 0755 0644 || rab_die 'root-owned release copy failed manifest verification'
  /usr/bin/mv -T -- "${target}" "${release_dir}"
  release_incoming=''
}

write_deploy_state() {
  local temporary=${RAB_STATE}/.gdm-release-current.tmp
  printf 'release=%s\ncreated_user=%s\ncreated_group=%s\nmodule_preexisted=%s\n' \
    "${stage_release}" "${created_user}" "${created_group}" "${module_preexisted}" >"${temporary}"
  /usr/bin/chown root:root "${temporary}"
  /usr/bin/chmod 0600 "${temporary}"
  /bin/sync -f "${temporary}"
  /usr/bin/mv -Tf -- "${temporary}" "${DEPLOY_STATE}"
  /bin/sync -f "${RAB_STATE}"
}

render_generated_assets() {
  /bin/mkdir -m 0755 -- "${release_dir}/generated"
  /usr/bin/python3 -I -S - "${release_dir}/assets/remote-auth-gdm.authorized-key-options" "${release_dir}/identity/remote-auth-gdm-ingest.pub" "${release_dir}/generated/gdm-ingest.authorized_keys" <<'PY'
import os, pathlib, sys
options = pathlib.Path(sys.argv[1]).read_bytes()
key = pathlib.Path(sys.argv[2]).read_bytes()
if not options.endswith(b"\n") or options.count(b"\n") != 1 or not key.endswith(b"\n") or key.count(b"\n") != 1:
    raise SystemExit(1)
line = options[:-1] + b" " + key
fd = os.open(sys.argv[3], os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o600)
with os.fdopen(fd, "wb", buffering=0) as stream:
    stream.write(line)
    os.fsync(stream.fileno())
PY
  /usr/bin/chown -R root:root "${release_dir}/generated"
  /usr/bin/chmod 0755 "${release_dir}/generated"
  /usr/bin/chmod 0600 "${release_dir}/generated/gdm-ingest.authorized_keys"
}

remove_if_identical() {
  local installed=$1 reviewed=$2 strict=$3
  if [[ -e ${installed} || -L ${installed} ]]; then
    if [[ -f ${installed} && ! -L ${installed} && -f ${reviewed} ]] &&
      /usr/bin/cmp -s -- "${installed}" "${reviewed}"; then
      /bin/rm -f -- "${installed}"
    elif [[ ${strict} -eq 1 ]]; then
      rab_die 'an installed transaction artifact changed; refusing rollback removal'
    fi
  fi
}

require_identical_if_present() {
  local installed=$1 reviewed=$2
  if [[ -e ${installed} || -L ${installed} ]]; then
    [[ -f ${installed} && ! -L ${installed} && -f ${reviewed} ]] ||
      rab_die 'an installed transaction artifact changed; refusing rollback'
    /usr/bin/cmp -s -- "${installed}" "${reviewed}" ||
      rab_die 'an installed transaction artifact changed; refusing rollback'
  fi
}

require_clean_managed_targets() {
  local target
  for target in \
    "${GDM_CONFIG}" "${GDM_KEYS}" "${GDM_UNIT}" \
    "${PAM_ROLLBACK_UNIT}" "${PAM_ROLLBACK_TIMER}" \
    "${TMPFILES_CONFIG}" "${SSHD_CONFIG}" \
    "${DEPLOY_STATIC}" "${ACTIVATE_STATIC}" "${DEACTIVATE_STATIC}" "${STATUS_STATIC}" \
    "${CONFIRM_STATIC}" "${COMMON_STATIC}"; do
    [[ ! -e ${target} && ! -L ${target} ]] ||
      rab_die "an untracked artifact already occupies a fixed GDM deployment path: ${target}"
  done
}

verify_inactive_verifier_status() {
  local control=$1 expected_release=$2 output
  output=$("${control}" status) || return 1
  verify_inactive_verifier_status_output "${output}" "${expected_release}"
}

verify_confirmed_deploy_state_record() {
  /usr/bin/python3 -I -S - "${DEPLOY_STATE}" "${release_id}" <<'PY'
import pathlib, re, sys
path, expected = sys.argv[1:]
raw = pathlib.Path(path).read_bytes()
if not raw.endswith(b"\n") or raw.count(b"\n") != 4 or b"\0" in raw:
    raise SystemExit(1)
lines = raw.decode("ascii", "strict").splitlines()
if lines[0] != f"release={expected}":
    raise SystemExit(1)
if [line.split("=", 1)[0] for line in lines[1:]] != [
    "created_user", "created_group", "module_preexisted"
]:
    raise SystemExit(1)
if any(not re.fullmatch(r"[01]", line.split("=", 1)[1]) for line in lines[1:]):
    raise SystemExit(1)
PY
}

verify_legacy_confirmed_inactive_current() {
  verify_release_manifest "${release_dir}" 0 0755 0755 0644 legacy ||
    rab_die 'the confirmed legacy release bytes do not match its reviewed manifest'
  [[ -L ${RAB_CURRENT} && $(/usr/bin/realpath -e -- "${RAB_CURRENT}") == "${release_dir}" ]] ||
    rab_die 'the confirmed legacy release is not current'
  require_installed_identical "${GDM_CONFIG}" "${release_dir}/generated/gdm.json" 600
  require_installed_identical "${GDM_KEYS}" "${release_dir}/generated/gdm-ingest.authorized_keys" 600
  require_installed_identical "${GDM_UNIT}" "${release_dir}/assets/remote-auth-gdmd.service" 644
  require_installed_identical "${PAM_ROLLBACK_UNIT}" "${release_dir}/assets/remote-auth-pam-rollback.service" 644
  require_installed_identical "${PAM_ROLLBACK_TIMER}" "${release_dir}/assets/remote-auth-pam-rollback.timer" 644
  require_installed_identical "${TMPFILES_CONFIG}" "${release_dir}/assets/remote-auth-gdm.tmpfiles.conf" 644
  require_installed_identical "${SSHD_CONFIG}" "${release_dir}/assets/71-remote-auth-gdm-ingest.conf" 644
  require_installed_identical "${DEPLOY_STATIC}" "${release_dir}/scripts/deploy-gdm-release-ubuntu.sh" 700
  require_installed_identical "${CONFIRM_STATIC}" "${release_dir}/scripts/confirm-gdm-release-ubuntu.sh" 700
  require_installed_identical "${COMMON_STATIC}" "${release_dir}/scripts/ubuntu-common.sh" 700
  require_installed_identical "${MODULE_TARGET}" "${release_dir}/lib/pam_gdm_broker.so" 644
  local path
  for path in \
    "${VERIFIER_MANIFEST}" "${SUDO_REGISTRY}" "${VERIFIER_KEYS}" \
    "${ACTIVATE_STATIC}" "${DEACTIVATE_STATIC}" "${STATUS_STATIC}"; do
    [[ ! -e ${path} && ! -L ${path} ]] ||
      rab_die 'the confirmed legacy deployment contains untracked verifier state'
  done
  rab_json_must_be_inactive "${GDM_CONFIG}"
  verify_pam_layout || rab_die 'the confirmed legacy PAM layout is invalid'
  /usr/bin/systemctl is-active --quiet remote-auth-gdmd.service ||
    rab_die 'the confirmed legacy GDM verifier service is not active'
  /usr/bin/systemctl is-active --quiet ssh.service ||
    rab_die 'the SSH service is not active'
  ingest_gid=$(/usr/bin/id -g "${GDM_USER}")
  verify_socket "${RAB_RUN}/gdm/ingest.sock" "${ingest_gid}" 660 ||
    rab_die 'the confirmed legacy GDM ingestion socket is not ready'
  verify_socket "${RAB_RUN}/gdm/gdm-claim.sock" 0 600 ||
    rab_die 'the confirmed legacy GDM claim socket is not ready'
  verify_ssh_policy || rab_die 'the confirmed legacy forced SSH policy is not effective'
}

verify_confirmed_inactive_current() {
  verify_confirmed_deploy_state_record ||
    rab_die 'the confirmed deployment state record has drifted'
  if [[ -f ${release_dir}/bin/remote-auth-verifierctl && ! -L ${release_dir}/bin/remote-auth-verifierctl ]]; then
    upgrade_old_layout=current
    print_status >/dev/null
    rab_json_must_be_inactive "${GDM_CONFIG}"
    verify_inactive_verifier_status "${release_dir}/bin/remote-auth-verifierctl" "${release_id}" ||
      rab_die 'the current GDM verifier policy is active, prepared, or drifted'
  else
    upgrade_old_layout=legacy
    verify_legacy_confirmed_inactive_current
  fi
  [[ ! -e ${PAM_CURRENT} && ! -L ${PAM_CURRENT} ]] ||
    rab_die 'the current GDM release does not have fully confirmed PAM state'
  ! /usr/bin/systemctl is-active --quiet remote-auth-pam-rollback.timer ||
    rab_die 'the PAM rollback timer is active'
  ! /usr/bin/systemctl is-enabled --quiet remote-auth-pam-rollback.timer ||
    rab_die 'the PAM rollback timer is enabled'
  /usr/bin/systemctl is-enabled --quiet remote-auth-gdmd.service ||
    rab_die 'the GDM verifier service is not enabled'
  [[ ! -e ${ACTIVATION_BUNDLE} && ! -L ${ACTIVATION_BUNDLE} ]] ||
    rab_die 'a GDM activation bundle is present while policy must be inactive'
  rab_require_owner_mode "${PAM_FILE}" 0 0 644
  [[ $(/usr/bin/stat -c '%h' -- "${PAM_FILE}") == 1 &&
     $(/usr/bin/stat -c '%h' -- "${MODULE_TARGET}") == 1 ]] ||
    rab_die 'confirmed PAM or module metadata has drifted'
}

snapshot_upgrade_file() {
  local source=$1 name=$2 mode=$3
  rab_require_owner_mode "${source}" 0 0 "${mode}"
  /usr/bin/install -o root -g root -m "${mode}" -- "${source}" "${upgrade_snapshot_root}/old/${name}"
  /usr/bin/cmp -s -- "${source}" "${upgrade_snapshot_root}/old/${name}" ||
    rab_die 'an installed GDM artifact changed during upgrade snapshot'
}

snapshot_confirmed_upgrade() {
  upgrade_snapshot_root=${RAB_RUN}/gdm-upgrade.$(rab_transaction_id)
  /bin/mkdir -m 0700 -- "${upgrade_snapshot_root}"
  /bin/mkdir -m 0700 -- "${upgrade_snapshot_root}/old" "${upgrade_snapshot_root}/new-etc"
  upgrade_old_release_id=${release_id}
  upgrade_old_release_dir=${release_dir}
  upgrade_old_current_target=$(/usr/bin/readlink -- "${RAB_CURRENT}")
  [[ ${upgrade_old_current_target} == "${upgrade_old_release_dir}" ]] ||
    rab_die 'the current release link target is not the exact confirmed release path'
  upgrade_gdmd_enabled=$(/usr/bin/systemctl is-enabled remote-auth-gdmd.service || true)
  upgrade_gdmd_active=$(/usr/bin/systemctl is-active remote-auth-gdmd.service || true)
  upgrade_ssh_active=$(/usr/bin/systemctl is-active ssh.service || true)
  [[ ${upgrade_gdmd_enabled} == enabled && ${upgrade_gdmd_active} == active && ${upgrade_ssh_active} == active ]] ||
    rab_die 'the confirmed GDM or SSH service state has drifted'

  snapshot_upgrade_file "${DEPLOY_STATE}" deploy-state 600
  snapshot_upgrade_file "${GDM_CONFIG}" gdm.json 600
  if [[ ${upgrade_old_layout} == current ]]; then
    snapshot_upgrade_file "${VERIFIER_MANIFEST}" key-manifest.json 600
    snapshot_upgrade_file "${SUDO_REGISTRY}" sudo-registry.json 600
    snapshot_upgrade_file "${VERIFIER_KEYS}/sudo-signing-private.key" sudo-signing-private.key 600
    snapshot_upgrade_file "${VERIFIER_KEYS}/gdm-signing-private.key" gdm-signing-private.key 600
    snapshot_upgrade_file "${VERIFIER_KEYS}/gdm-hpke-private.key" gdm-hpke-private.key 600
  fi
  snapshot_upgrade_file "${GDM_KEYS}" gdm-ingest.authorized_keys 600
  snapshot_upgrade_file "${GDM_UNIT}" remote-auth-gdmd.service 644
  snapshot_upgrade_file "${PAM_ROLLBACK_UNIT}" remote-auth-pam-rollback.service 644
  snapshot_upgrade_file "${PAM_ROLLBACK_TIMER}" remote-auth-pam-rollback.timer 644
  snapshot_upgrade_file "${TMPFILES_CONFIG}" remote-auth-gdm.conf 644
  snapshot_upgrade_file "${SSHD_CONFIG}" 71-remote-auth-gdm-ingest.conf 644
  snapshot_upgrade_file "${DEPLOY_STATIC}" remote-auth-gdm-deploy 700
  if [[ ${upgrade_old_layout} == current ]]; then
    snapshot_upgrade_file "${ACTIVATE_STATIC}" remote-auth-gdm-activate 700
    snapshot_upgrade_file "${DEACTIVATE_STATIC}" remote-auth-gdm-deactivate 700
    snapshot_upgrade_file "${STATUS_STATIC}" remote-auth-gdm-status 700
  fi
  snapshot_upgrade_file "${CONFIRM_STATIC}" remote-auth-gdm-confirm 700
  snapshot_upgrade_file "${COMMON_STATIC}" ubuntu-common.sh 700
  upgrade_pam_digest=$(rab_sha256 "${PAM_FILE}")
  upgrade_module_digest=$(rab_sha256 "${MODULE_TARGET}")
  /bin/sync -f "${upgrade_snapshot_root}/old"
  /bin/sync -f "${upgrade_snapshot_root}"
}

write_upgrade_candidate_state() {
  local state=${upgrade_snapshot_root}/new-deploy-state
  printf 'release=%s\ncreated_user=%s\ncreated_group=%s\nmodule_preexisted=%s\n' \
    "${stage_release}" "${created_user}" "${created_group}" "${module_preexisted}" >"${state}"
  /usr/bin/chown root:root "${state}"
  /usr/bin/chmod 0600 "${state}"
  /bin/sync -f "${state}"
}

verify_isolated_verifier_tree() {
  /usr/bin/python3 -I -S - "${upgrade_snapshot_root}/new-etc" <<'PY'
import os, pathlib, stat, sys
root = pathlib.Path(sys.argv[1])
expected_files = {
    "gdm.json", "key-manifest.json", "sudo-registry.json",
    "keys/sudo-signing-private.key", "keys/gdm-signing-private.key",
    "keys/gdm-hpke-private.key",
}
expected_dirs = {"keys"}
files, dirs = set(), set()
for base, names, entries in os.walk(root, topdown=True, followlinks=False):
    base_path = pathlib.Path(base)
    for name in names:
        path = base_path / name
        rel = path.relative_to(root).as_posix()
        value = os.lstat(path)
        if not stat.S_ISDIR(value.st_mode) or value.st_uid != 0 or value.st_gid != 0 or stat.S_IMODE(value.st_mode) != 0o700:
            raise SystemExit(1)
        dirs.add(rel)
    for name in entries:
        path = base_path / name
        rel = path.relative_to(root).as_posix()
        value = os.lstat(path)
        if not stat.S_ISREG(value.st_mode) or value.st_uid != 0 or value.st_gid != 0 or stat.S_IMODE(value.st_mode) != 0o600 or value.st_nlink != 1:
            raise SystemExit(1)
        files.add(rel)
if dirs != expected_dirs or files != expected_files:
    raise SystemExit(1)
PY
}

create_isolated_verifier_generation() {
  local output
  write_upgrade_candidate_state
  output=$(
    /usr/bin/unshare --mount --propagation private /bin/bash -Eeuo pipefail -c '
      /usr/bin/mount --bind "$1" /etc/remote-auth-broker
      /usr/bin/mount --bind "$2" /var/lib/remote-auth-broker/gdm-release-current
      "$3" init-inactive
      "$3" validate
      "$3" status
    ' upgrade-verifier \
      "${upgrade_snapshot_root}/new-etc" \
      "${upgrade_snapshot_root}/new-deploy-state" \
      "${release_dir}/bin/remote-auth-verifierctl"
  ) || rab_die 'isolated verifier generation failed'
  verify_inactive_verifier_status_output "${output}" "${stage_release}" ||
    rab_die 'isolated verifier status was not exactly inactive'
  verify_isolated_verifier_tree || rab_die 'isolated verifier generation metadata is invalid'
  /bin/sync -f "${upgrade_snapshot_root}/new-etc/keys"
  /bin/sync -f "${upgrade_snapshot_root}/new-etc"
  /bin/sync -f "${upgrade_snapshot_root}"
}

verify_inactive_verifier_status_output() {
  local output=$1 expected_release=$2
  /usr/bin/python3 -I -S - "${expected_release}" "${output}" <<'PY'
import json, sys
expected, raw = sys.argv[1:]
value = json.loads(raw)
if type(value) is not dict or set(value) != {
    "schemaVersion", "state", "ubuntuReleaseDigest", "policyDigest",
    "bundleDigest", "macReleaseDigest", "gdmSigningKeyId",
}:
    raise SystemExit(1)
if (
    value["schemaVersion"] != 1
    or value["state"] != "installed"
    or value["ubuntuReleaseDigest"] != expected
    or any(value[name] is not None for name in (
        "policyDigest", "bundleDigest", "macReleaseDigest", "gdmSigningKeyId"
    ))
):
    raise SystemExit(1)
PY
}

probe_candidate_verifier_status() {
  local output
  output=$(
    /usr/bin/unshare --mount --propagation private /bin/bash -Eeuo pipefail -c '
      /usr/bin/mount --bind "$1" /var/lib/remote-auth-broker/gdm-release-current
      "$2" validate
      "$2" status
    ' probe-verifier \
      "${upgrade_snapshot_root}/new-deploy-state" \
      "${release_dir}/bin/remote-auth-verifierctl"
  ) || rab_die 'candidate verifier validation failed before deployment commit'
  verify_inactive_verifier_status_output "${output}" "${stage_release}" ||
    rab_die 'candidate verifier status was not exactly inactive before deployment commit'
}

install_candidate_verifier_state() {
  ensure_root_directory "${VERIFIER_KEYS}" 700
  rab_atomic_install "${upgrade_snapshot_root}/new-etc/gdm.json" "${GDM_CONFIG}" 0600
  rab_atomic_install "${upgrade_snapshot_root}/new-etc/key-manifest.json" "${VERIFIER_MANIFEST}" 0600
  rab_atomic_install "${upgrade_snapshot_root}/new-etc/sudo-registry.json" "${SUDO_REGISTRY}" 0600
  rab_atomic_install "${upgrade_snapshot_root}/new-etc/keys/sudo-signing-private.key" "${VERIFIER_KEYS}/sudo-signing-private.key" 0600
  rab_atomic_install "${upgrade_snapshot_root}/new-etc/keys/gdm-signing-private.key" "${VERIFIER_KEYS}/gdm-signing-private.key" 0600
  rab_atomic_install "${upgrade_snapshot_root}/new-etc/keys/gdm-hpke-private.key" "${VERIFIER_KEYS}/gdm-hpke-private.key" 0600
}

install_candidate_managed_files() {
  rab_atomic_install "${release_dir}/generated/gdm-ingest.authorized_keys" "${GDM_KEYS}" 0600
  rab_atomic_install "${release_dir}/assets/remote-auth-gdmd.service" "${GDM_UNIT}" 0644
  rab_atomic_install "${release_dir}/assets/remote-auth-pam-rollback.service" "${PAM_ROLLBACK_UNIT}" 0644
  rab_atomic_install "${release_dir}/assets/remote-auth-pam-rollback.timer" "${PAM_ROLLBACK_TIMER}" 0644
  rab_atomic_install "${release_dir}/assets/remote-auth-gdm.tmpfiles.conf" "${TMPFILES_CONFIG}" 0644
  rab_atomic_install "${release_dir}/assets/71-remote-auth-gdm-ingest.conf" "${SSHD_CONFIG}" 0644
  rab_atomic_install "${release_dir}/scripts/deploy-gdm-release-ubuntu.sh" "${DEPLOY_STATIC}" 0700
  rab_atomic_install "${release_dir}/scripts/activate-gdm-ubuntu.sh" "${ACTIVATE_STATIC}" 0700
  rab_atomic_install "${release_dir}/scripts/deactivate-gdm-ubuntu.sh" "${DEACTIVATE_STATIC}" 0700
  rab_atomic_install "${release_dir}/scripts/status-gdm-ubuntu.sh" "${STATUS_STATIC}" 0700
  rab_atomic_install "${release_dir}/scripts/confirm-gdm-release-ubuntu.sh" "${CONFIRM_STATIC}" 0700
  rab_atomic_install "${release_dir}/scripts/ubuntu-common.sh" "${COMMON_STATIC}" 0700
}

switch_current_release() {
  local temporary=${RAB_ROOT}/.current-${stage_release}
  [[ ! -e ${temporary} && ! -L ${temporary} ]] || rab_die 'a stale current-release switch link exists'
  /usr/bin/ln -s -- "${release_dir}" "${temporary}"
  /usr/bin/mv -Tf -- "${temporary}" "${RAB_CURRENT}"
  /bin/sync -f "${RAB_ROOT}"
}

restore_upgrade_file() {
  local name=$1 target=$2 mode=$3
  rab_atomic_install "${upgrade_snapshot_root}/old/${name}" "${target}" "${mode}"
}

verify_upgrade_snapshot_restored() {
  local name target path
  while IFS='|' read -r name target; do
    /usr/bin/cmp -s -- "${upgrade_snapshot_root}/old/${name}" "${target}" || return 1
  done <<EOF
deploy-state|${DEPLOY_STATE}
gdm.json|${GDM_CONFIG}
gdm-ingest.authorized_keys|${GDM_KEYS}
remote-auth-gdmd.service|${GDM_UNIT}
remote-auth-pam-rollback.service|${PAM_ROLLBACK_UNIT}
remote-auth-pam-rollback.timer|${PAM_ROLLBACK_TIMER}
remote-auth-gdm.conf|${TMPFILES_CONFIG}
71-remote-auth-gdm-ingest.conf|${SSHD_CONFIG}
remote-auth-gdm-deploy|${DEPLOY_STATIC}
remote-auth-gdm-confirm|${CONFIRM_STATIC}
ubuntu-common.sh|${COMMON_STATIC}
EOF
  if [[ ${upgrade_old_layout} == current ]]; then
    while IFS='|' read -r name target; do
      /usr/bin/cmp -s -- "${upgrade_snapshot_root}/old/${name}" "${target}" || return 1
    done <<EOF
key-manifest.json|${VERIFIER_MANIFEST}
sudo-registry.json|${SUDO_REGISTRY}
sudo-signing-private.key|${VERIFIER_KEYS}/sudo-signing-private.key
gdm-signing-private.key|${VERIFIER_KEYS}/gdm-signing-private.key
gdm-hpke-private.key|${VERIFIER_KEYS}/gdm-hpke-private.key
remote-auth-gdm-activate|${ACTIVATE_STATIC}
remote-auth-gdm-deactivate|${DEACTIVATE_STATIC}
remote-auth-gdm-status|${STATUS_STATIC}
EOF
  else
    for path in \
      "${VERIFIER_MANIFEST}" "${SUDO_REGISTRY}" "${VERIFIER_KEYS}" \
      "${ACTIVATE_STATIC}" "${DEACTIVATE_STATIC}" "${STATUS_STATIC}"; do
      [[ ! -e ${path} && ! -L ${path} ]] || return 1
    done
  fi
  [[ $(/usr/bin/readlink -- "${RAB_CURRENT}") == "${upgrade_old_current_target}" ]] || return 1
  [[ $(rab_sha256 "${PAM_FILE}") == "${upgrade_pam_digest}" ]] || return 1
  [[ $(rab_sha256 "${MODULE_TARGET}") == "${upgrade_module_digest}" ]] || return 1
}

restore_confirmed_upgrade() {
  /usr/bin/systemctl stop remote-auth-gdmd.service >/dev/null
  /usr/bin/install -o root -g root -m 0644 -- "${upgrade_old_release_dir}/lib/pam_gdm_broker.so" "${MODULE_TARGET}"
  restore_upgrade_file gdm.json "${GDM_CONFIG}" 0600
  if [[ ${upgrade_old_layout} == current ]]; then
    restore_upgrade_file key-manifest.json "${VERIFIER_MANIFEST}" 0600
    restore_upgrade_file sudo-registry.json "${SUDO_REGISTRY}" 0600
    restore_upgrade_file sudo-signing-private.key "${VERIFIER_KEYS}/sudo-signing-private.key" 0600
    restore_upgrade_file gdm-signing-private.key "${VERIFIER_KEYS}/gdm-signing-private.key" 0600
    restore_upgrade_file gdm-hpke-private.key "${VERIFIER_KEYS}/gdm-hpke-private.key" 0600
  else
    /bin/rm -f -- \
      "${VERIFIER_MANIFEST}" "${SUDO_REGISTRY}" \
      "${VERIFIER_KEYS}/sudo-signing-private.key" \
      "${VERIFIER_KEYS}/gdm-signing-private.key" \
      "${VERIFIER_KEYS}/gdm-hpke-private.key"
    if [[ -e ${VERIFIER_KEYS} || -L ${VERIFIER_KEYS} ]]; then
      [[ -d ${VERIFIER_KEYS} && ! -L ${VERIFIER_KEYS} ]] ||
        return 1
      /bin/rmdir -- "${VERIFIER_KEYS}"
    fi
  fi
  restore_upgrade_file gdm-ingest.authorized_keys "${GDM_KEYS}" 0600
  restore_upgrade_file remote-auth-gdmd.service "${GDM_UNIT}" 0644
  restore_upgrade_file remote-auth-pam-rollback.service "${PAM_ROLLBACK_UNIT}" 0644
  restore_upgrade_file remote-auth-pam-rollback.timer "${PAM_ROLLBACK_TIMER}" 0644
  restore_upgrade_file remote-auth-gdm.conf "${TMPFILES_CONFIG}" 0644
  restore_upgrade_file 71-remote-auth-gdm-ingest.conf "${SSHD_CONFIG}" 0644
  restore_upgrade_file remote-auth-gdm-deploy "${DEPLOY_STATIC}" 0700
  if [[ ${upgrade_old_layout} == current ]]; then
    restore_upgrade_file remote-auth-gdm-activate "${ACTIVATE_STATIC}" 0700
    restore_upgrade_file remote-auth-gdm-deactivate "${DEACTIVATE_STATIC}" 0700
    restore_upgrade_file remote-auth-gdm-status "${STATUS_STATIC}" 0700
  else
    /bin/rm -f -- "${ACTIVATE_STATIC}" "${DEACTIVATE_STATIC}" "${STATUS_STATIC}"
  fi
  restore_upgrade_file remote-auth-gdm-confirm "${CONFIRM_STATIC}" 0700
  restore_upgrade_file ubuntu-common.sh "${COMMON_STATIC}" 0700
  local current_temporary=${RAB_ROOT}/.current-rollback-${upgrade_old_release_id}
  /bin/rm -f -- "${current_temporary}"
  /usr/bin/ln -s -- "${upgrade_old_current_target}" "${current_temporary}"
  /usr/bin/mv -Tf -- "${current_temporary}" "${RAB_CURRENT}"
  /bin/sync -f "${RAB_ROOT}"
  restore_upgrade_file deploy-state "${DEPLOY_STATE}" 0600
  /usr/bin/systemctl daemon-reload >/dev/null
  /usr/bin/systemd-tmpfiles --create "${TMPFILES_CONFIG}" >/dev/null
  [[ ${upgrade_gdmd_enabled} == enabled ]] &&
    /usr/bin/systemctl enable remote-auth-gdmd.service >/dev/null
  [[ ${upgrade_gdmd_active} == active ]] &&
    /usr/bin/systemctl restart remote-auth-gdmd.service >/dev/null
  [[ ${upgrade_ssh_active} == active ]] &&
    /usr/bin/systemctl reload ssh.service >/dev/null
  release_id=${upgrade_old_release_id}
  release_dir=${upgrade_old_release_dir}
  verify_upgrade_snapshot_restored
  verify_confirmed_inactive_current
  [[ -z ${release_incoming:-} ]] || /bin/rm -rf -- "${release_incoming}"
  [[ ! -e ${RELEASES}/${stage_release} && ! -L ${RELEASES}/${stage_release} ]] ||
    /bin/rm -rf -- "${RELEASES}/${stage_release}"
  /bin/sync -f "${RELEASES}"
}

rollback_failed_upgrade() {
  trap - EXIT ERR INT TERM HUP
  if ! (
    set -Eeuo pipefail
    restore_confirmed_upgrade
  ); then
    printf 'remote-auth-broker: confirmed inactive GDM upgrade failed and exact rollback failed\n' >&2
    trap cleanup_authenticated_inputs EXIT
    exit 1
  fi
  printf 'remote-auth-broker: confirmed inactive GDM upgrade failed; exact rollback completed\n' >&2
  trap cleanup_authenticated_inputs EXIT
  exit 1
}

verify_upgrade_pam_state() {
  [[ $(rab_sha256 "${PAM_FILE}") == "${upgrade_pam_digest}" ]] || return 1
  require_installed_identical "${MODULE_TARGET}" "${release_dir}/lib/pam_gdm_broker.so" 644 || return 1
  [[ ! -e ${PAM_CURRENT} && ! -L ${PAM_CURRENT} ]] || return 1
  ! /usr/bin/systemctl is-active --quiet remote-auth-pam-rollback.timer || return 1
  ! /usr/bin/systemctl is-enabled --quiet remote-auth-pam-rollback.timer
}

perform_confirmed_upgrade() {
  snapshot_confirmed_upgrade
  created_user=$(deploy_state_value created_user)
  created_group=$(deploy_state_value created_group)
  module_preexisted=$(deploy_state_value module_preexisted)
  [[ ${created_user} =~ ^[01]$ && ${created_group} =~ ^[01]$ && ${module_preexisted} =~ ^[01]$ ]] ||
    rab_die 'confirmed deployment metadata is invalid'
  [[ ! -e ${RELEASES}/${stage_release} && ! -L ${RELEASES}/${stage_release} ]] ||
    rab_die 'an untracked release already occupies the staged upgrade digest'
  [[ ! -e ${RELEASES}/.incoming-${stage_release} && ! -L ${RELEASES}/.incoming-${stage_release} ]] ||
    rab_die 'an untracked incoming release already occupies the staged upgrade digest'
  release_dir=''
  release_incoming=''
  trap rollback_failed_upgrade EXIT ERR INT TERM HUP
  install_release_copy
  render_generated_assets
  /usr/bin/install -o root -g root -m 0644 -- "${release_dir}/lib/pam_gdm_broker.so" "${MODULE_TARGET}"
  create_isolated_verifier_generation
  install_candidate_verifier_state
  install_candidate_managed_files
  switch_current_release
  /usr/bin/systemd-analyze verify "${GDM_UNIT}" "${PAM_ROLLBACK_UNIT}" "${PAM_ROLLBACK_TIMER}" >/dev/null 2>&1 ||
    rab_die 'upgraded systemd units failed verification'
  verify_ssh_policy || rab_die 'upgraded forced SSH policy failed preflight'
  /usr/bin/systemctl daemon-reload >/dev/null
  /usr/bin/systemd-tmpfiles --create "${TMPFILES_CONFIG}" >/dev/null
  /usr/bin/systemctl restart remote-auth-gdmd.service >/dev/null
  /usr/bin/systemctl reload ssh.service >/dev/null
  local ready=0
  for _ in {1..50}; do
    if /usr/bin/systemctl is-active --quiet remote-auth-gdmd.service &&
       verify_socket "${RAB_RUN}/gdm/ingest.sock" "${ingest_gid}" 660 &&
       verify_socket "${RAB_RUN}/gdm/gdm-claim.sock" 0 600; then
      ready=1
      break
    fi
    /usr/bin/sleep 0.1
  done
  ((ready == 1)) || rab_die 'upgraded GDM verifier sockets did not become ready'
  /usr/bin/systemctl is-active --quiet ssh.service || rab_die 'SSH service is not active after upgrade'
  verify_ssh_policy || rab_die 'upgraded forced SSH policy is not effective'
  probe_candidate_verifier_status
  verify_upgrade_pam_state ||
    rab_die 'PAM layout, module generation, or confirmed rollback state changed during upgrade'
  write_deploy_state
  "${release_dir}/bin/remote-auth-verifierctl" validate ||
    rab_die 'committed verifier state is invalid'
  verify_inactive_verifier_status "${release_dir}/bin/remote-auth-verifierctl" "${stage_release}" ||
    rab_die 'committed verifier status is not exactly inactive'
  /bin/sync -f "${RAB_ETC}"
  /bin/sync -f "${RAB_ROOT}"
  /bin/sync -f "${RAB_STATE}"
  /bin/sync -f /etc/systemd/system
  /bin/sync -f /etc/tmpfiles.d
  /bin/sync -f /etc/ssh/sshd_config.d
  verify_upgrade_pam_state ||
    rab_die 'PAM layout, module generation, or confirmed rollback state changed before durability commit'
  trap - ERR INT TERM HUP
  trap cleanup_authenticated_inputs EXIT
  /bin/rm -rf -- "${upgrade_old_release_dir}"
  /bin/sync -f "${RELEASES}"
  release_id=${stage_release}
  printf 'component=gdm-broker\nrelease_sha256=%s\ndeployment=upgraded\npam=confirmed\npolicy=inactive\ndaemon=active\nssh_ingest=ready\ningest_socket=ready\nclaim_socket=ready\n' "${stage_release}"
}


perform_rollback() {
  local strict=$1 created_user_local created_group_local module_preexisted_local current_target='' pam_state='' rollback_status=0
  require_deploy_state
  created_user_local=$(deploy_state_value created_user)
  created_group_local=$(deploy_state_value created_group)
  module_preexisted_local=$(deploy_state_value module_preexisted)
  [[ ${created_user_local} =~ ^[01]$ && ${created_group_local} =~ ^[01]$ && ${module_preexisted_local} =~ ^[01]$ ]] ||
    rab_die 'installed release transaction metadata is invalid'
  if [[ -e ${PAM_CURRENT} || -L ${PAM_CURRENT} ]]; then
    rab_require_owner_mode "${PAM_CURRENT}" 0 0 600
    pam_state=$(rab_read_state_value state "${PAM_CURRENT}")
    if [[ ${pam_state} == confirmed ]]; then
      printf 'component=gdm-broker\nrelease_sha256=%s\ndeployment=confirmed\npam=confirmed\n' "${release_id}"
      return 0
    fi
  fi
  if [[ -L ${RAB_CURRENT} ]]; then
    current_target=$(/usr/bin/realpath -e -- "${RAB_CURRENT}" || true)
  fi
  [[ ${current_target} == "${release_dir}" || ${strict} -eq 0 ]] || rab_die 'a different release is current; refusing rollback'
  if [[ ${strict} -eq 1 ]]; then
    require_identical_if_present "${GDM_KEYS}" "${release_dir}/generated/gdm-ingest.authorized_keys"
    require_identical_if_present "${GDM_UNIT}" "${release_dir}/assets/remote-auth-gdmd.service"
    require_identical_if_present "${PAM_ROLLBACK_UNIT}" "${release_dir}/assets/remote-auth-pam-rollback.service"
    require_identical_if_present "${PAM_ROLLBACK_TIMER}" "${release_dir}/assets/remote-auth-pam-rollback.timer"
    require_identical_if_present "${TMPFILES_CONFIG}" "${release_dir}/assets/remote-auth-gdm.tmpfiles.conf"
    require_identical_if_present "${SSHD_CONFIG}" "${release_dir}/assets/71-remote-auth-gdm-ingest.conf"
    require_identical_if_present "${DEPLOY_STATIC}" "${release_dir}/scripts/deploy-gdm-release-ubuntu.sh"
    require_identical_if_present "${ACTIVATE_STATIC}" "${release_dir}/scripts/activate-gdm-ubuntu.sh"
    require_identical_if_present "${DEACTIVATE_STATIC}" "${release_dir}/scripts/deactivate-gdm-ubuntu.sh"
    require_identical_if_present "${STATUS_STATIC}" "${release_dir}/scripts/status-gdm-ubuntu.sh"
    require_identical_if_present "${CONFIRM_STATIC}" "${release_dir}/scripts/confirm-gdm-release-ubuntu.sh"
    require_identical_if_present "${COMMON_STATIC}" "${release_dir}/scripts/ubuntu-common.sh"
    if [[ ${module_preexisted_local} -eq 0 ]]; then
      require_identical_if_present "${MODULE_TARGET}" "${release_dir}/lib/pam_gdm_broker.so"
    fi
  fi
  if [[ -e ${PAM_CURRENT} || -L ${PAM_CURRENT} ]]; then
    "${release_dir}/scripts/rollback-pam-ubuntu.sh" >/dev/null
  elif [[ ${strict} -eq 1 ]]; then
    rab_die 'the PAM rollback transaction is no longer armed'
  fi
  if ! /usr/bin/systemctl disable --now remote-auth-gdmd.service >/dev/null; then
    printf 'remote-auth-broker: failed to disable or stop remote-auth-gdmd.service during rollback\n' >&2
    rollback_status=1
  fi
  if [[ ${current_target} == "${release_dir}" ]]; then
    /bin/rm -f -- "${RAB_CURRENT}"
  fi
  for verifier_file in \
    "${GDM_CONFIG}" "${VERIFIER_MANIFEST}" "${SUDO_REGISTRY}" \
    "${VERIFIER_KEYS}/sudo-signing-private.key" \
    "${VERIFIER_KEYS}/gdm-signing-private.key" \
    "${VERIFIER_KEYS}/gdm-hpke-private.key"; do
    if [[ -e ${verifier_file} || -L ${verifier_file} ]]; then
      rab_require_owner_mode "${verifier_file}" 0 0 600
      /bin/rm -f -- "${verifier_file}"
    fi
  done
  if [[ -d ${VERIFIER_KEYS} && ! -L ${VERIFIER_KEYS} ]]; then
    /bin/rmdir -- "${VERIFIER_KEYS}" || rab_die 'verifier key directory contains unmanaged state'
  fi
  remove_if_identical "${GDM_KEYS}" "${release_dir}/generated/gdm-ingest.authorized_keys" "${strict}"
  remove_if_identical "${GDM_UNIT}" "${release_dir}/assets/remote-auth-gdmd.service" "${strict}"
  remove_if_identical "${PAM_ROLLBACK_UNIT}" "${release_dir}/assets/remote-auth-pam-rollback.service" "${strict}"
  remove_if_identical "${PAM_ROLLBACK_TIMER}" "${release_dir}/assets/remote-auth-pam-rollback.timer" "${strict}"
  remove_if_identical "${TMPFILES_CONFIG}" "${release_dir}/assets/remote-auth-gdm.tmpfiles.conf" "${strict}"
  remove_if_identical "${SSHD_CONFIG}" "${release_dir}/assets/71-remote-auth-gdm-ingest.conf" "${strict}"
  remove_if_identical "${CONFIRM_STATIC}" "${release_dir}/scripts/confirm-gdm-release-ubuntu.sh" "${strict}"
  remove_if_identical "${ACTIVATE_STATIC}" "${release_dir}/scripts/activate-gdm-ubuntu.sh" "${strict}"
  remove_if_identical "${DEACTIVATE_STATIC}" "${release_dir}/scripts/deactivate-gdm-ubuntu.sh" "${strict}"
  remove_if_identical "${STATUS_STATIC}" "${release_dir}/scripts/status-gdm-ubuntu.sh" "${strict}"
  remove_if_identical "${COMMON_STATIC}" "${release_dir}/scripts/ubuntu-common.sh" "${strict}"
  remove_if_identical "${DEPLOY_STATIC}" "${release_dir}/scripts/deploy-gdm-release-ubuntu.sh" "${strict}"
  if [[ ${module_preexisted_local} -eq 0 ]]; then
    remove_if_identical "${MODULE_TARGET}" "${release_dir}/lib/pam_gdm_broker.so" "${strict}"
  fi
  if ! /usr/bin/systemctl daemon-reload >/dev/null; then
    printf 'remote-auth-broker: systemd daemon-reload failed during rollback\n' >&2
    rollback_status=1
  fi
  if ! /usr/bin/systemctl reload ssh.service >/dev/null; then
    printf 'remote-auth-broker: SSH service reload failed during rollback\n' >&2
    rollback_status=1
  fi
  /bin/rm -f -- "${RAB_RUN}/gdm/ingest.sock" "${RAB_RUN}/gdm/gdm-claim.sock"
  if [[ ${created_user_local} -eq 1 ]] && /usr/bin/id "${GDM_USER}" >/dev/null 2>&1; then
    [[ $(/usr/bin/getent passwd "${GDM_USER}" | /usr/bin/cut -d: -f6-7) == '/nonexistent:/bin/sh' || ${strict} -eq 0 ]] ||
      rab_die 'the installed forced principal changed; refusing removal'
    /usr/sbin/userdel "${GDM_USER}" >/dev/null
  fi
  if [[ ${created_group_local} -eq 1 ]] && /usr/bin/getent group "${GDM_GROUP}" >/dev/null; then
    /usr/sbin/groupdel "${GDM_GROUP}" >/dev/null
  fi
  /bin/rm -f -- "${DEPLOY_STATE}"
  /bin/rm -rf -- "${release_dir}"
  if [[ ${rollback_status} -ne 0 ]]; then
    printf 'remote-auth-broker: rollback restoration completed with service-manager failures\n' >&2
    return 1
  fi
  printf 'component=gdm-broker\nrelease_sha256=%s\ndeployment=rolled-back\npam=restored\n' "${release_id}"
}

if [[ ${action} == status ]]; then
  print_status
  exit 0
fi

if [[ ${action} == rollback ]]; then
  perform_rollback 1
  exit 0
fi

snapshot_root=''
upgrade_snapshot_root=''
readonly bootstrap_root=${SCRIPT_DIR}
cleanup_authenticated_inputs() {
  local cleanup_status=$?
  trap - EXIT
  set +e
  if [[ -n ${snapshot_root} && ${snapshot_root} =~ ^/run/remote-auth-gdm-snapshot\.[A-Za-z0-9]{8}$ ]]; then
    /bin/rm -rf -- "${snapshot_root}"
  fi
  if [[ -n ${upgrade_snapshot_root} && ${upgrade_snapshot_root} =~ ^/run/remote-auth-broker/gdm-upgrade\.[0-9a-f-]{36}$ ]]; then
    /bin/rm -rf -- "${upgrade_snapshot_root}"
  fi
  if [[ ${bootstrap_root} =~ ^/run/remote-auth-gdm-bootstrap\.[A-Za-z0-9]{8}$ ]]; then
    /bin/rm -rf -- "${bootstrap_root}"
  fi
  exit "${cleanup_status}"
}
trap cleanup_authenticated_inputs EXIT
create_authenticated_stage_snapshot
if [[ -e ${DEPLOY_STATE} || -L ${DEPLOY_STATE} ]]; then
  require_deploy_state
  if [[ -e ${PAM_CURRENT} || -L ${PAM_CURRENT} ]]; then
    recovery_pam_state=$(rab_read_state_value state "${PAM_CURRENT}")
    case ${recovery_pam_state} in
      armed|rollback-in-progress)
        /bin/bash "${STAGE_ROOT}/scripts/rollback-pam-ubuntu.sh" >/dev/null ||
          rab_die 'failed to restore the interrupted PAM transaction'
        perform_rollback 0 || rab_die 'failed to remove the interrupted GDM deployment'
        printf 'remote-auth-broker: interrupted PAM and GDM deployment restored; rerun install from a clean state\n' >&2
        exit 75
    esac
  fi
  if [[ -e ${DEPLOY_STATE} || -L ${DEPLOY_STATE} ]]; then
    require_deploy_state
    if [[ ${release_id} == "${stage_release}" ]]; then
      print_status
      exit 0
    fi
    verify_confirmed_inactive_current
    ingest_gid=$(/usr/bin/id -g "${GDM_USER}")
    [[ ${ingest_gid} =~ ^[0-9]+$ && ${ingest_gid} -ne 0 ]] ||
      rab_die 'the fixed GDM group is invalid'
    perform_confirmed_upgrade
    exit 0
  fi
fi
[[ ! -e ${RAB_CURRENT} && ! -L ${RAB_CURRENT} ]] || rab_die 'an untracked broker release is already current'
require_clean_managed_targets

created_group=0
created_user=0
module_preexisted=0
release_dir=''
release_incoming=''
cleanup_before_state() {
  trap - ERR INT TERM HUP
  set +e
  [[ -n ${release_dir} ]] && /bin/rm -rf -- "${release_dir}"
  [[ -n ${release_incoming} ]] && /bin/rm -rf -- "${release_incoming}"
  if [[ ${created_user} -eq 1 ]]; then /usr/sbin/userdel "${GDM_USER}" >/dev/null; fi
  if [[ ${created_group} -eq 1 ]]; then /usr/sbin/groupdel "${GDM_GROUP}" >/dev/null; fi
  exit 1
}
rollback_failed_install() {
  local rollback_status
  trap - ERR INT TERM HUP
  if [[ -e ${DEPLOY_STATE} && ! -L ${DEPLOY_STATE} ]]; then
    set +e
    (
      set -Eeuo pipefail
      perform_rollback 0 >/dev/null
    )
    rollback_status=$?
    set -e
    if [[ ${rollback_status} -ne 0 ]]; then
      printf 'remote-auth-broker: GDM release verification failed and exact rollback failed\n' >&2
      exit 1
    fi
  else
    cleanup_before_state
  fi
  printf 'remote-auth-broker: GDM release verification failed; exact rollback completed\n' >&2
  exit 1
}
trap cleanup_before_state ERR INT TERM HUP

if /usr/bin/getent group "${GDM_GROUP}" >/dev/null; then
  [[ $(/usr/bin/getent group "${GDM_GROUP}" | /usr/bin/cut -d: -f1) == "${GDM_GROUP}" ]] || rab_die 'the fixed GDM group is ambiguous'
else
  /usr/sbin/groupadd --system "${GDM_GROUP}"
  created_group=1
fi
ingest_gid=$(/usr/bin/getent group "${GDM_GROUP}" | /usr/bin/cut -d: -f3)
[[ ${ingest_gid} =~ ^[0-9]+$ && ${ingest_gid} -ne 0 ]] || rab_die 'the fixed GDM group is invalid'
if /usr/bin/id "${GDM_USER}" >/dev/null 2>&1; then
  passwd_record=$(/usr/bin/getent passwd "${GDM_USER}")
  [[ $(printf '%s' "${passwd_record}" | /usr/bin/cut -d: -f4) == "${ingest_gid}" && $(printf '%s' "${passwd_record}" | /usr/bin/cut -d: -f6-7) == '/nonexistent:/bin/sh' ]] ||
    rab_die 'the existing fixed GDM principal is incompatible'
  shadow_password=$(/usr/bin/getent shadow "${GDM_USER}" | /usr/bin/cut -d: -f2)
  [[ ${shadow_password} =~ ^[\!\*] ]] ||
    rab_die 'the existing fixed GDM principal must already have a locked password'
else
  /usr/sbin/useradd --system --gid "${GDM_GROUP}" --home-dir /nonexistent --no-create-home --shell /bin/sh "${GDM_USER}"
  created_user=1
  /usr/sbin/usermod -L "${GDM_USER}"
fi
ingest_uid=$(/usr/bin/id -u "${GDM_USER}")
[[ ${ingest_uid} =~ ^[0-9]+$ && ${ingest_uid} -ne 0 ]] || rab_die 'the fixed GDM principal is invalid'

install_release_copy
render_generated_assets
if [[ -e ${MODULE_TARGET} || -L ${MODULE_TARGET} ]]; then
  rab_require_owner_mode "${MODULE_TARGET}" 0 0 644
  /usr/bin/cmp -s -- "${MODULE_TARGET}" "${release_dir}/lib/pam_gdm_broker.so" || rab_die 'an unrelated PAM module occupies the fixed target'
  module_preexisted=1
fi
ensure_root_directory "${RAB_ETC}" 700
ensure_root_directory "${RAB_STATE}" 700
ensure_root_directory "${PAM_BACKUPS}" 700
write_deploy_state
trap rollback_failed_install ERR INT TERM HUP

"${release_dir}/bin/remote-auth-verifierctl" init-inactive ||
  rab_die 'root-owned inactive verifier state initialization failed'
rab_atomic_install "${release_dir}/generated/gdm-ingest.authorized_keys" "${GDM_KEYS}" 0600
rab_atomic_install "${release_dir}/assets/remote-auth-gdmd.service" "${GDM_UNIT}" 0644
rab_atomic_install "${release_dir}/assets/remote-auth-pam-rollback.service" "${PAM_ROLLBACK_UNIT}" 0644
rab_atomic_install "${release_dir}/assets/remote-auth-pam-rollback.timer" "${PAM_ROLLBACK_TIMER}" 0644
rab_atomic_install "${release_dir}/assets/remote-auth-gdm.tmpfiles.conf" "${TMPFILES_CONFIG}" 0644
rab_atomic_install "${release_dir}/assets/71-remote-auth-gdm-ingest.conf" "${SSHD_CONFIG}" 0644
rab_atomic_install "${release_dir}/scripts/deploy-gdm-release-ubuntu.sh" "${DEPLOY_STATIC}" 0700
rab_atomic_install "${release_dir}/scripts/activate-gdm-ubuntu.sh" "${ACTIVATE_STATIC}" 0700
rab_atomic_install "${release_dir}/scripts/deactivate-gdm-ubuntu.sh" "${DEACTIVATE_STATIC}" 0700
rab_atomic_install "${release_dir}/scripts/status-gdm-ubuntu.sh" "${STATUS_STATIC}" 0700
rab_atomic_install "${release_dir}/scripts/confirm-gdm-release-ubuntu.sh" "${CONFIRM_STATIC}" 0700
rab_atomic_install "${release_dir}/scripts/ubuntu-common.sh" "${COMMON_STATIC}" 0700
current_tmp=${RAB_ROOT}/.current-${stage_release}
/usr/bin/ln -s -- "${release_dir}" "${current_tmp}"
/usr/bin/mv -Tf -- "${current_tmp}" "${RAB_CURRENT}"

/usr/bin/systemd-analyze verify "${GDM_UNIT}" "${PAM_ROLLBACK_UNIT}" "${PAM_ROLLBACK_TIMER}" >/dev/null 2>&1 ||
  rab_die 'installed systemd units failed verification'
verify_ssh_policy || rab_die 'installed forced SSH policy failed preflight'
/usr/bin/systemctl daemon-reload >/dev/null || rab_die 'systemd daemon reload failed'
/usr/bin/systemd-tmpfiles --create "${TMPFILES_CONFIG}" >/dev/null || rab_die 'runtime directory creation failed'
/usr/bin/systemctl enable --now remote-auth-gdmd.service >/dev/null || rab_die 'GDM verifier service start failed'
/usr/bin/systemctl reload ssh.service >/dev/null || rab_die 'SSH policy reload failed'
gdm_ready=0
for _ in {1..50}; do
  if /usr/bin/systemctl is-active --quiet remote-auth-gdmd.service &&
     verify_socket "${RAB_RUN}/gdm/ingest.sock" "${ingest_gid}" 660 &&
     verify_socket "${RAB_RUN}/gdm/gdm-claim.sock" 0 600; then
    gdm_ready=1
    break
  fi
  /usr/bin/sleep 0.1
done
((gdm_ready == 1)) || rab_die 'GDM verifier sockets did not become ready'
/usr/bin/systemctl is-active --quiet ssh.service || rab_die 'SSH service is not active'
verify_ssh_policy || rab_die 'installed forced SSH policy is not effective'
"${release_dir}/scripts/install-pam-ubuntu.sh" >/dev/null || rab_die 'PAM transaction install failed'
verify_pam_layout || rab_die 'installed PAM layout failed verification'
/usr/bin/systemctl is-active --quiet remote-auth-pam-rollback.timer ||
  rab_die 'PAM rollback timer is not active'
trap - ERR INT TERM HUP
print_status
