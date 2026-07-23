#!/bin/bash
set -euo pipefail

umask 077

readonly script_dir="$(cd "$(/usr/bin/dirname "$0")" && /bin/pwd -P)"
readonly package_root="$(cd "$script_dir/../.." && /bin/pwd -P)"
readonly signed_root="$package_root/dist/macos/signed"
readonly policy_source="$package_root/config/policy-inactive.json"
readonly plist_template="$script_dir/com.arthur.remote-authd.plist.template"
readonly uid="$(/usr/bin/id -u)"
readonly home="${HOME:-}"

if [[ $# -ne 0 ]]; then
  printf 'usage: %s\n' "$0" >&2
  exit 64
fi
if [[ "$(/usr/bin/uname -s)" != "Darwin" ]]; then
  printf 'error: macOS is required\n' >&2
  exit 69
fi
if [[ "$uid" == "0" ]]; then
  printf 'error: install must run as the target GUI user, never as root\n' >&2
  exit 77
fi
if [[ "$home" != /* || ! -d "$home" || -L "$home" || "$(/usr/bin/stat -f '%u' "$home")" != "$uid" ]]; then
  printf 'error: HOME must be an owned absolute directory\n' >&2
  exit 77
fi

readonly support_root="$home/Library/Application Support/RemoteAuthBroker"
readonly versions_root="$support_root/versions"
readonly config_root="$support_root/config"
readonly state_root="$support_root/state"
readonly run_root="$support_root/run"
readonly log_root="$support_root/log"
readonly rollback_root="$support_root/rollback"
readonly journals_root="$rollback_root/journals"
readonly current_link="$support_root/current"
readonly installed_policy="$config_root/policy.json"
readonly launch_agents_root="$home/Library/LaunchAgents"
readonly installed_plist="$launch_agents_root/com.arthur.remote-authd.plist"

fail() {
  printf 'error: %s\n' "$1" >&2
  exit 65
}

ensure_private_directory() {
  local path="$1"
  if [[ -e "$path" || -L "$path" ]]; then
    [[ -d "$path" && ! -L "$path" ]] || fail "not a real directory: $path"
    [[ "$(/usr/bin/stat -f '%u' "$path")" == "$uid" ]] || fail "directory has the wrong owner: $path"
    [[ "$(/usr/bin/stat -f '%Lp' "$path")" == "700" ]] || fail "directory is not mode 0700: $path"
  else
    /bin/mkdir -m 0700 -- "$path"
  fi
}

assert_owned_regular() {
  local path="$1"
  local mode
  [[ -f "$path" && ! -L "$path" ]] || fail "not a regular file: $path"
  [[ "$(/usr/bin/stat -f '%u' "$path")" == "$uid" ]] || fail "file has the wrong owner: $path"
  mode="$(/usr/bin/stat -f '%Lp' "$path")"
  (( (8#$mode & 8#022) == 0 )) || fail "file is group/world writable: $path"
}

validate_inactive_policy() {
  local path="$1"
  /usr/bin/python3 -I -S - "$path" <<'PY' || fail "invalid inactive policy JSON"
import json
import sys

EXPECTED_KEYS = frozenset({
    "schemaVersion",
    "version",
    "canonicalStatus",
    "active",
    "policyId",
    "policyDigest",
    "policyDigestState",
    "maximumBiometricAgeMilliseconds",
    "brokerIdentity",
    "caller",
    "sockets",
    "reviewer",
    "jetKVM",
    "verifiers",
    "authorityKeys",
    "trustedOmpCallers",
    "operations",
    "actions",
    "credentialTargets",
})
ZERO_DIGEST = "0" * 64

def reject_duplicate_keys(pairs):
    value = {}
    for key, member in pairs:
        if key in value:
            raise ValueError("duplicate key")
        value[key] = member
    return value

def reject_constant(_constant):
    raise ValueError("non-JSON numeric constant")

try:
    with open(sys.argv[1], "rb") as policy_file:
        policy = json.load(
            policy_file,
            object_pairs_hook=reject_duplicate_keys,
            parse_constant=reject_constant,
        )
    if type(policy) is not dict or frozenset(policy) != EXPECTED_KEYS:
        raise ValueError("invalid top-level object")
    if policy["canonicalStatus"] != "DESIGN/INACTIVE":
        raise ValueError("policy is not DESIGN/INACTIVE")
    if policy["active"] is not False:
        raise ValueError("policy is active")
    if (
        policy["policyDigest"] != ZERO_DIGEST
        or policy["policyDigestState"] != "inactive-placeholder"
    ):
        raise ValueError("policy digest is not an inactive placeholder")
except (OSError, UnicodeError, json.JSONDecodeError, TypeError, ValueError):
    raise SystemExit("invalid inactive policy JSON")
PY
}

verify_signed_binary() {
  local binary="$1"
  local requirement_file="$2"
  local requirement
  assert_owned_regular "$binary"
  assert_owned_regular "$requirement_file"
  requirement="$(<"$requirement_file")"
  [[ -n "$requirement" && "$requirement" != *$'\n'* && "$requirement" != *$'\r'* ]] || fail "invalid designated requirement file"
  /usr/bin/codesign --verify --strict --verbose=2 "$binary"
  /usr/bin/codesign --verify --strict --verbose=2 -R="$requirement" "$binary"
}

atomic_copy() {
  local source="$1"
  local destination="$2"
  local mode="$3"
  local temporary="${destination}.tmp.$$"
  /usr/bin/install -m "$mode" "$source" "$temporary"
  /bin/mv -f -- "$temporary" "$destination"
}

rollback_remove_created_version() {
  local created_version
  local created_path
  local path
  local -a created_directories
  local -a created_files

  created_version="$(<"$journal/created-version")"
  if [[ ! "$created_version" =~ ^[0-9a-f]{64}$ ]]; then
    printf 'error: refusing unsafe created-version cleanup\n' >&2
    return 1
  fi

  created_path="$versions_root/$created_version"
  if [[ ! -e "$created_path" && ! -L "$created_path" ]]; then
    return 0
  fi

  created_directories=(
    "$created_path"
    "$created_path/bin"
    "$created_path/requirements"
  )
  created_files=(
    "$created_path/manifest.sha256"
    "$created_path/release-digest"
    "$created_path/source-build-digest"
    "$created_path/bin/remote-authd"
    "$created_path/bin/remote-authctl"
    "$created_path/requirements/remote-authd.designated-requirement"
    "$created_path/requirements/remote-authctl.designated-requirement"
  )

  for path in "${created_directories[@]}"; do
    if [[ ! -d "$path" || -L "$path" || "$(/usr/bin/stat -f '%u' "$path")" != "$uid" ]]; then
      printf 'error: refusing unsafe created-version directory cleanup: %s\n' "$path" >&2
      return 1
    fi
  done
  for path in "${created_files[@]}"; do
    if [[ ! -f "$path" || -L "$path" || "$(/usr/bin/stat -f '%u' "$path")" != "$uid" ]]; then
      printf 'error: refusing unsafe created-version file cleanup: %s\n' "$path" >&2
      return 1
    fi
  done

  /bin/chmod -h u+w -- "${created_directories[@]}" "${created_files[@]}" || return 1
  /bin/rm -f -- "${created_files[@]}" || return 1
  /bin/rmdir -- "$created_path/bin" "$created_path/requirements" "$created_path"
}

restore_journal() {
  set +e
  local rollback_failed=0

  if [[ -f "$journal/previous-current.present" ]]; then
    local previous_current
    previous_current="$(<"$journal/previous-current")"
    if ! { /bin/ln -s "$previous_current" "$support_root/.current.restore.$$" && /bin/mv -fh -- "$support_root/.current.restore.$$" "$current_link"; }; then
      rollback_failed=1
    fi
  elif ! /bin/rm -f -- "$current_link"; then
    rollback_failed=1
  fi

  if [[ -f "$journal/previous-plist.present" ]]; then
    if ! { /bin/cp -p "$journal/previous-plist" "$launch_agents_root/.com.arthur.remote-authd.plist.restore.$$" && /bin/mv -f -- "$launch_agents_root/.com.arthur.remote-authd.plist.restore.$$" "$installed_plist"; }; then
      rollback_failed=1
    fi
  elif ! /bin/rm -f -- "$installed_plist"; then
    rollback_failed=1
  fi

  if [[ -f "$journal/previous-policy.present" ]]; then
    if ! { /bin/cp -p "$journal/previous-policy" "$config_root/.policy.restore.$$" && /bin/mv -f -- "$config_root/.policy.restore.$$" "$installed_policy"; }; then
      rollback_failed=1
    fi
  elif ! /bin/rm -f -- "$installed_policy"; then
    rollback_failed=1
  fi

  if [[ -f "$journal/created-version" ]] && ! rollback_remove_created_version; then
    rollback_failed=1
  fi

  if [[ -f "$journal/previous-journal.present" ]]; then
    if ! { /bin/ln -s "$(<"$journal/previous-journal")" "$rollback_root/.current.restore.$$" && /bin/mv -fh -- "$rollback_root/.current.restore.$$" "$rollback_root/current"; }; then
      rollback_failed=1
    fi
  elif ! /bin/rm -f -- "$rollback_root/current"; then
    rollback_failed=1
  fi
  if ! /bin/rm -f -- "$journal/armed"; then
    rollback_failed=1
  fi
  if ! printf 'failed\n' > "$journal/failed"; then
    rollback_failed=1
  fi
  return "$rollback_failed"
}


stage=""
journal=""
rollback_armed=0
cleanup() {
  local status=$?
  local cleanup_failed=0
  trap - EXIT HUP INT TERM
  if (( rollback_armed == 1 )) && [[ -n "$journal" ]] && ! restore_journal; then
    cleanup_failed=1
  fi
  if [[ -n "$stage" ]] && ! /bin/rm -rf -- "$stage"; then
    cleanup_failed=1
  fi
  if ! /bin/rm -f -- \
    "$support_root/.current.tmp.$$" \
    "$support_root/.current.restore.$$" \
    "$config_root/.policy.tmp.$$" \
    "$config_root/.policy.restore.$$" \
    "$launch_agents_root/.com.arthur.remote-authd.plist.tmp.$$" \
    "$launch_agents_root/.com.arthur.remote-authd.plist.restore.$$" \
    "$rollback_root/.current.tmp.$$" \
    "$rollback_root/.current.restore.$$"; then
    cleanup_failed=1
  fi
  if (( cleanup_failed != 0 )); then
    printf 'error: install cleanup incomplete\n' >&2
  fi
  exit "$status"
}
trap cleanup EXIT
trap 'exit 130' HUP INT TERM

[[ -L "$signed_root/latest" ]] || fail "sign.sh has not published a signed release"
readonly release_name="$(/usr/bin/readlink "$signed_root/latest")"
[[ "$release_name" =~ ^[0-9a-f]{64}$ ]] || fail "signed latest pointer is invalid"
readonly release="$signed_root/$release_name"
[[ -d "$release" && ! -L "$release" ]] || fail "signed release directory is invalid"
for artifact in manifest.sha256 release-digest source-build-digest requirements/remote-authd.designated-requirement requirements/remote-authctl.designated-requirement; do
  assert_owned_regular "$release/$artifact"
done
verify_signed_binary "$release/bin/remote-authd" "$release/requirements/remote-authd.designated-requirement"
verify_signed_binary "$release/bin/remote-authctl" "$release/requirements/remote-authctl.designated-requirement"
readonly daemon_digest="$(/usr/bin/shasum -a 256 "$release/bin/remote-authd" | /usr/bin/awk '{print $1}')"
readonly ctl_digest="$(/usr/bin/shasum -a 256 "$release/bin/remote-authctl" | /usr/bin/awk '{print $1}')"
readonly daemon_requirement_digest="$(/usr/bin/shasum -a 256 "$release/requirements/remote-authd.designated-requirement" | /usr/bin/awk '{print $1}')"
readonly ctl_requirement_digest="$(/usr/bin/shasum -a 256 "$release/requirements/remote-authctl.designated-requirement" | /usr/bin/awk '{print $1}')"
readonly source_build_digest="$(/usr/bin/shasum -a 256 "$release/source-build-digest" | /usr/bin/awk '{print $1}')"
readonly expected_manifest="${daemon_digest}  bin/remote-authd
${ctl_digest}  bin/remote-authctl
${daemon_requirement_digest}  requirements/remote-authd.designated-requirement
${ctl_requirement_digest}  requirements/remote-authctl.designated-requirement
${source_build_digest}  source-build-digest"
[[ "$(<"$release/manifest.sha256")" == "$expected_manifest" ]] || fail "signed manifest verification failed"
[[ "$(<"$release/release-digest")" == "$release_name" ]] || fail "signed release identity does not match its directory"
[[ "$(/usr/bin/shasum -a 256 "$release/manifest.sha256" | /usr/bin/awk '{print $1}')" == "$release_name" ]] || fail "signed release digest verification failed"
[[ "$(<"$release/source-build-digest")" =~ ^[0-9a-f]{64}$ ]] || fail "source build digest is invalid"

assert_owned_regular "$policy_source"
assert_owned_regular "$plist_template"
validate_inactive_policy "$policy_source"

if [[ -e "$launch_agents_root" || -L "$launch_agents_root" ]]; then
  [[ -d "$launch_agents_root" && ! -L "$launch_agents_root" ]] || fail "LaunchAgents is not a real directory"
  [[ "$(/usr/bin/stat -f '%u' "$launch_agents_root")" == "$uid" ]] || fail "LaunchAgents has the wrong owner"
  mode="$(/usr/bin/stat -f '%Lp' "$launch_agents_root")"
  (( (8#$mode & 8#022) == 0 )) || fail "LaunchAgents is group/world writable"
else
  /bin/mkdir -m 0700 -- "$launch_agents_root"
fi

if [[ -e "$support_root" || -L "$support_root" ]]; then
  ensure_private_directory "$support_root"
else
  /bin/mkdir -m 0700 -- "$support_root"
fi
for directory in "$versions_root" "$config_root" "$state_root" "$run_root" "$log_root" "$rollback_root" "$journals_root"; do
  ensure_private_directory "$directory"
done

for log_file in remote-authd.out.log remote-authd.err.log; do
  if [[ -e "$log_root/$log_file" || -L "$log_root/$log_file" ]]; then
    assert_owned_regular "$log_root/$log_file"
    /bin/chmod 0600 "$log_root/$log_file"
  else
    /usr/bin/install -m 0600 /dev/null "$log_root/$log_file"
  fi
done

readonly journal_id="$(/bin/date -u '+%Y%m%dT%H%M%SZ')-$$"
journal="$journals_root/$journal_id"
/bin/mkdir -m 0700 -- "$journal"
if [[ -e "$rollback_root/current" || -L "$rollback_root/current" ]]; then
  [[ -L "$rollback_root/current" ]] || fail "rollback current pointer is not a symlink"
  previous_journal="$(/usr/bin/readlink "$rollback_root/current")"
  [[ "$previous_journal" =~ ^journals/[A-Za-z0-9._-]+$ ]] || fail "previous rollback pointer is invalid"
  printf '%s\n' "$previous_journal" > "$journal/previous-journal"
  /usr/bin/touch "$journal/previous-journal.present"
fi
previous_current=""
if [[ -e "$current_link" || -L "$current_link" ]]; then
  [[ -L "$current_link" ]] || fail "installed current pointer is not a symlink"
  previous_current="$(/usr/bin/readlink "$current_link")"
  [[ "$previous_current" =~ ^versions/[0-9a-f]{64}$ ]] || fail "installed current pointer is invalid"
  [[ -d "$support_root/$previous_current" && ! -L "$support_root/$previous_current" ]] || fail "installed current version is missing"
  printf '%s\n' "$previous_current" > "$journal/previous-current"
  /usr/bin/touch "$journal/previous-current.present"
fi
if [[ -e "$installed_plist" || -L "$installed_plist" ]]; then
  assert_owned_regular "$installed_plist"
  /usr/bin/plutil -lint "$installed_plist" > /dev/null
  [[ -n "$previous_current" ]] || fail "existing LaunchAgent has no installed current version"
  [[ "$(/usr/bin/plutil -extract ProgramArguments.0 raw -o - "$installed_plist")" == "$support_root/$previous_current/bin/remote-authd" ]] || fail "existing LaunchAgent daemon path is not the fixed installed version"
  [[ "$(/usr/bin/plutil -extract ProgramArguments.1 raw -o - "$installed_plist")" == "serve" ]] || fail "existing LaunchAgent did not serve"
  [[ "$(/usr/bin/plutil -extract Disabled raw -o - "$installed_plist")" == "true" ]] || fail "existing LaunchAgent is not disabled"
  [[ "$(/usr/bin/plutil -extract RunAtLoad raw -o - "$installed_plist")" == "false" ]] || fail "existing LaunchAgent would run at load"
  [[ "$(/usr/bin/plutil -extract KeepAlive raw -o - "$installed_plist")" == "false" ]] || fail "existing LaunchAgent would be kept alive"
  /bin/cp -p "$installed_plist" "$journal/previous-plist"
  /usr/bin/touch "$journal/previous-plist.present"
fi
if [[ -e "$installed_policy" || -L "$installed_policy" ]]; then
  assert_owned_regular "$installed_policy"
  validate_inactive_policy "$installed_policy"
  /bin/cp -p "$installed_policy" "$journal/previous-policy"
  /usr/bin/touch "$journal/previous-policy.present"
fi
printf '%s\n' "$release_name" > "$journal/installed-release"
printf 'DESIGN/INACTIVE\n' > "$journal/installed-status"
/usr/bin/touch "$journal/armed"

/bin/ln -s "journals/$journal_id" "$rollback_root/.current.tmp.$$"
/bin/mv -fh -- "$rollback_root/.current.tmp.$$" "$rollback_root/current"
rollback_armed=1

readonly installed_version="$versions_root/$release_name"
if [[ -e "$installed_version" || -L "$installed_version" ]]; then
  [[ -d "$installed_version" && ! -L "$installed_version" ]] || fail "installed version path is not a real directory"
  verify_signed_binary "$installed_version/bin/remote-authd" "$installed_version/requirements/remote-authd.designated-requirement"
  verify_signed_binary "$installed_version/bin/remote-authctl" "$installed_version/requirements/remote-authctl.designated-requirement"
  for artifact in manifest.sha256 release-digest source-build-digest bin/remote-authd bin/remote-authctl requirements/remote-authd.designated-requirement requirements/remote-authctl.designated-requirement; do
    /usr/bin/cmp -s "$release/$artifact" "$installed_version/$artifact" || fail "existing immutable version differs from signed release: $artifact"
  done
else
  stage="$(/usr/bin/mktemp -d "$versions_root/.install.XXXXXX")"
  /bin/mkdir -m 0700 -- "$stage/bin" "$stage/requirements"
  /usr/bin/install -m 0555 "$release/bin/remote-authd" "$stage/bin/remote-authd"
  /usr/bin/install -m 0555 "$release/bin/remote-authctl" "$stage/bin/remote-authctl"
  /usr/bin/install -m 0444 "$release/manifest.sha256" "$stage/manifest.sha256"
  /usr/bin/install -m 0444 "$release/release-digest" "$stage/release-digest"
  /usr/bin/install -m 0444 "$release/source-build-digest" "$stage/source-build-digest"
  /usr/bin/install -m 0444 "$release/requirements/remote-authd.designated-requirement" "$stage/requirements/remote-authd.designated-requirement"
  /usr/bin/install -m 0444 "$release/requirements/remote-authctl.designated-requirement" "$stage/requirements/remote-authctl.designated-requirement"
  verify_signed_binary "$stage/bin/remote-authd" "$stage/requirements/remote-authd.designated-requirement"
  verify_signed_binary "$stage/bin/remote-authctl" "$stage/requirements/remote-authctl.designated-requirement"
  /bin/chmod 0555 "$stage/bin" "$stage/requirements" "$stage"
  /bin/mv -- "$stage" "$installed_version"
  stage=""
  printf '%s\n' "$release_name" > "$journal/created-version"
fi

readonly daemon_path="$installed_version/bin/remote-authd"
readonly rendered_plist="$journal/rendered-plist"
/usr/bin/install -m 0600 "$plist_template" "$rendered_plist"
[[ "$(/usr/bin/plutil -extract ProgramArguments.0 raw -o - "$rendered_plist")" == "__REMOTE_AUTHD_PATH__" ]] || fail "LaunchAgent template daemon placeholder is invalid"
/usr/bin/plutil -remove ProgramArguments.0 "$rendered_plist"
/usr/bin/plutil -insert ProgramArguments.0 -string "$daemon_path" "$rendered_plist"
/usr/bin/plutil -replace WorkingDirectory -string "$state_root" "$rendered_plist"
/usr/bin/plutil -replace StandardOutPath -string "$log_root/remote-authd.out.log" "$rendered_plist"
/usr/bin/plutil -replace StandardErrorPath -string "$log_root/remote-authd.err.log" "$rendered_plist"
/usr/bin/plutil -lint "$rendered_plist" > /dev/null
[[ "$(/usr/bin/plutil -extract ProgramArguments raw -expect array -o - "$rendered_plist")" == "2" ]] || fail "rendered LaunchAgent must have exactly two arguments"
[[ "$(/usr/bin/plutil -extract ProgramArguments.0 raw -o - "$rendered_plist")" == "$daemon_path" ]] || fail "rendered daemon path verification failed"
[[ "$(/usr/bin/plutil -extract ProgramArguments.1 raw -o - "$rendered_plist")" == "serve" ]] || fail "rendered daemon argv verification failed"
[[ "$(/usr/bin/plutil -extract Disabled raw -o - "$rendered_plist")" == "true" ]] || fail "rendered LaunchAgent is not disabled"
[[ "$(/usr/bin/plutil -extract RunAtLoad raw -o - "$rendered_plist")" == "false" ]] || fail "rendered LaunchAgent would run at load"
[[ "$(/usr/bin/plutil -extract KeepAlive raw -o - "$rendered_plist")" == "false" ]] || fail "rendered LaunchAgent would be kept alive"

atomic_copy "$policy_source" "$installed_policy" 0600
atomic_copy "$rendered_plist" "$installed_plist" 0600
/bin/ln -s "versions/$release_name" "$support_root/.current.tmp.$$"
/bin/mv -fh -- "$support_root/.current.tmp.$$" "$current_link"

[[ "$(/usr/bin/readlink "$current_link")" == "versions/$release_name" ]] || fail "current version pointer verification failed"
verify_signed_binary "$current_link/bin/remote-authd" "$current_link/requirements/remote-authd.designated-requirement"
verify_signed_binary "$current_link/bin/remote-authctl" "$current_link/requirements/remote-authctl.designated-requirement"
validate_inactive_policy "$installed_policy"
printf '%s\n' "$(/usr/bin/shasum -a 256 "$installed_plist" | /usr/bin/awk '{print $1}')" > "$journal/installed-plist.sha256"
printf '%s\n' "$(/usr/bin/shasum -a 256 "$installed_policy" | /usr/bin/awk '{print $1}')" > "$journal/installed-policy.sha256"
/bin/chmod 0600 "$journal/installed-plist.sha256" "$journal/installed-policy.sha256"
/bin/mv -- "$journal/armed" "$journal/committed"
rollback_armed=0

printf 'Installed macOS release %s with canonical policy DESIGN/INACTIVE (active=false).\n' "$release_name"
printf 'LaunchAgent artifacts remain unregistered and inactive.\n'
