#!/bin/bash
set -euo pipefail

umask 077

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
  printf 'error: rollback must run as the target GUI user, never as root\n' >&2
  exit 77
fi
if [[ "$home" != /* || ! -d "$home" || -L "$home" || "$(/usr/bin/stat -f '%u' "$home")" != "$uid" ]]; then
  printf 'error: HOME must be an owned absolute directory\n' >&2
  exit 77
fi

readonly support_root="$home/Library/Application Support/RemoteAuthBroker"
readonly versions_root="$support_root/versions"
readonly config_root="$support_root/config"
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

assert_private_directory() {
  local path="$1"
  [[ -d "$path" && ! -L "$path" ]] || fail "not a real directory: $path"
  [[ "$(/usr/bin/stat -f '%u' "$path")" == "$uid" ]] || fail "directory has the wrong owner: $path"
  [[ "$(/usr/bin/stat -f '%Lp' "$path")" == "700" ]] || fail "directory is not mode 0700: $path"
}

assert_owned_regular() {
  local path="$1"
  local mode
  [[ -f "$path" && ! -L "$path" ]] || fail "not a regular file: $path"
  [[ "$(/usr/bin/stat -f '%u' "$path")" == "$uid" ]] || fail "file has the wrong owner: $path"
  mode="$(/usr/bin/stat -f '%Lp' "$path")"
  (( (8#$mode & 8#022) == 0 )) || fail "file is group/world writable: $path"
}

assert_private_directory "$support_root"
assert_private_directory "$versions_root"
assert_private_directory "$config_root"
assert_private_directory "$rollback_root"
assert_private_directory "$journals_root"
[[ -d "$launch_agents_root" && ! -L "$launch_agents_root" ]] || fail "LaunchAgents is not a real directory"
[[ "$(/usr/bin/stat -f '%u' "$launch_agents_root")" == "$uid" ]] || fail "LaunchAgents has the wrong owner"
launch_agents_mode="$(/usr/bin/stat -f '%Lp' "$launch_agents_root")"
(( (8#$launch_agents_mode & 8#022) == 0 )) || fail "LaunchAgents is group/world writable"
[[ -L "$rollback_root/current" ]] || fail "there is no rollback journal"
readonly journal_target="$(/usr/bin/readlink "$rollback_root/current")"
[[ "$journal_target" =~ ^journals/[A-Za-z0-9._-]+$ ]] || fail "rollback journal pointer is invalid"
readonly journal="$rollback_root/$journal_target"
assert_private_directory "$journal"
readonly transaction="$journal/rollback-transaction"

restore_transaction() {
  local current_target
  local status=0
  set +e
  if [[ -f "$transaction/plist.present" ]]; then
    /bin/cp -p "$transaction/plist" "$launch_agents_root/.com.arthur.remote-authd.plist.rollback.$$" &&
      /bin/mv -f -- "$launch_agents_root/.com.arthur.remote-authd.plist.rollback.$$" "$installed_plist" || status=1
  else
    /bin/rm -f -- "$installed_plist" || status=1
  fi
  if [[ -f "$transaction/policy.present" ]]; then
    /bin/cp -p "$transaction/policy" "$config_root/.policy.rollback.$$" &&
      /bin/mv -f -- "$config_root/.policy.rollback.$$" "$installed_policy" || status=1
  else
    /bin/rm -f -- "$installed_policy" || status=1
  fi
  if [[ -f "$transaction/current.present" ]]; then
    current_target="$(<"$transaction/current-target")"
    /bin/ln -s "$current_target" "$support_root/.current.rollback.$$" &&
      /bin/mv -f -- "$support_root/.current.rollback.$$" "$current_link" || status=1
  else
    /bin/rm -f -- "$current_link" || status=1
  fi
  /bin/ln -s "$journal_target" "$rollback_root/.current.rollback.$$" &&
    /bin/mv -f -- "$rollback_root/.current.rollback.$$" "$rollback_root/current" || status=1
  if (( status == 0 )); then
    /bin/rm -rf -- "$transaction" || status=1
  fi
  set -e
  return "$status"
}

if [[ -e "$transaction" || -L "$transaction" ]]; then
  assert_private_directory "$transaction"
  assert_owned_regular "$transaction/armed"
  if [[ -f "$transaction/plist.present" ]]; then
    assert_owned_regular "$transaction/plist.present"
    assert_owned_regular "$transaction/plist"
  fi
  if [[ -f "$transaction/policy.present" ]]; then
    assert_owned_regular "$transaction/policy.present"
    assert_owned_regular "$transaction/policy"
  fi
  if [[ -f "$transaction/current.present" ]]; then
    assert_owned_regular "$transaction/current.present"
    assert_owned_regular "$transaction/current-target"
    interrupted_current_target="$(<"$transaction/current-target")"
    [[ "$interrupted_current_target" =~ ^versions/[0-9a-f]{64}$ ]] || fail "interrupted rollback current pointer is invalid"
  fi
  restore_transaction || fail "could not recover the interrupted rollback transaction"
fi
if [[ ! -f "$journal/committed" && ! -f "$journal/armed" ]]; then
  fail "rollback journal is not committed or recoverable"
fi
assert_owned_regular "$journal/installed-release"
assert_owned_regular "$journal/installed-status"
readonly installed_release="$(<"$journal/installed-release")"
[[ "$installed_release" =~ ^[0-9a-f]{64}$ ]] || fail "journal release identity is invalid"
[[ "$(<"$journal/installed-status")" == "DESIGN/INACTIVE" ]] || fail "journal does not describe an inactive install"

if [[ -f "$journal/committed" ]]; then
  assert_owned_regular "$journal/installed-plist.sha256"
  assert_owned_regular "$journal/installed-policy.sha256"
  assert_owned_regular "$installed_plist"
  assert_owned_regular "$installed_policy"
  [[ "$(/usr/bin/shasum -a 256 "$installed_plist" | /usr/bin/awk '{print $1}')" == "$(<"$journal/installed-plist.sha256")" ]] || fail "installed LaunchAgent changed after install"
  [[ "$(/usr/bin/shasum -a 256 "$installed_policy" | /usr/bin/awk '{print $1}')" == "$(<"$journal/installed-policy.sha256")" ]] || fail "installed policy changed after install"
  [[ "$(/usr/bin/plutil -extract ProgramArguments.0 raw -o - "$installed_plist")" == "$versions_root/$installed_release/bin/remote-authd" ]] || fail "installed LaunchAgent daemon path changed after install"
  [[ "$(/usr/bin/plutil -extract ProgramArguments.1 raw -o - "$installed_plist")" == "serve" ]] || fail "installed LaunchAgent did not serve"
  [[ "$(/usr/bin/plutil -extract Disabled raw -o - "$installed_plist")" == "true" ]] || fail "installed LaunchAgent is not disabled"
  [[ "$(/usr/bin/plutil -extract RunAtLoad raw -o - "$installed_plist")" == "false" ]] || fail "installed LaunchAgent would run at load"
  [[ "$(/usr/bin/plutil -extract KeepAlive raw -o - "$installed_plist")" == "false" ]] || fail "installed LaunchAgent would be kept alive"
  [[ "$(/usr/bin/plutil -extract canonicalStatus raw -o - "$installed_policy")" == "DESIGN/INACTIVE" ]] || fail "installed policy is no longer DESIGN/INACTIVE"
  [[ "$(/usr/bin/plutil -extract active raw -o - "$installed_policy")" == "false" ]] || fail "installed policy is no longer inactive"
  [[ -L "$current_link" ]] || fail "installed current pointer changed after install"
  [[ "$(/usr/bin/readlink "$current_link")" == "versions/$installed_release" ]] || fail "installed current pointer changed after install"
fi

if [[ -f "$journal/previous-current.present" ]]; then
  assert_owned_regular "$journal/previous-current"
  readonly previous_current="$(<"$journal/previous-current")"
  [[ "$previous_current" =~ ^versions/[0-9a-f]{64}$ ]] || fail "journal previous version pointer is invalid"
  [[ -d "$support_root/$previous_current" && ! -L "$support_root/$previous_current" ]] || fail "journal previous version is missing"
fi
if [[ -f "$journal/previous-plist.present" ]]; then
  assert_owned_regular "$journal/previous-plist"
  /usr/bin/plutil -lint "$journal/previous-plist" > /dev/null
  [[ -f "$journal/previous-current.present" ]] || fail "journal previous LaunchAgent has no previous current version"
  [[ "$(/usr/bin/plutil -extract ProgramArguments.0 raw -o - "$journal/previous-plist")" == "$support_root/$previous_current/bin/remote-authd" ]] || fail "journal previous LaunchAgent daemon path is not the fixed prior version"
  [[ "$(/usr/bin/plutil -extract ProgramArguments.1 raw -o - "$journal/previous-plist")" == "serve" ]] || fail "journal previous LaunchAgent did not serve"
  [[ "$(/usr/bin/plutil -extract Disabled raw -o - "$journal/previous-plist")" == "true" ]] || fail "journal previous LaunchAgent was not disabled"
  [[ "$(/usr/bin/plutil -extract RunAtLoad raw -o - "$journal/previous-plist")" == "false" ]] || fail "journal previous LaunchAgent would run at load"
  [[ "$(/usr/bin/plutil -extract KeepAlive raw -o - "$journal/previous-plist")" == "false" ]] || fail "journal previous LaunchAgent would be kept alive"
fi
if [[ -f "$journal/previous-policy.present" ]]; then
  assert_owned_regular "$journal/previous-policy"
  /usr/bin/plutil -lint "$journal/previous-policy" > /dev/null
  [[ "$(/usr/bin/plutil -extract canonicalStatus raw -o - "$journal/previous-policy")" == "DESIGN/INACTIVE" ]] || fail "journal previous policy was not DESIGN/INACTIVE"
  [[ "$(/usr/bin/plutil -extract active raw -o - "$journal/previous-policy")" == "false" ]] || fail "journal previous policy was not inactive"
fi
if [[ -f "$journal/previous-journal.present" ]]; then
  assert_owned_regular "$journal/previous-journal"
  readonly previous_journal="$(<"$journal/previous-journal")"
  [[ "$previous_journal" =~ ^journals/[A-Za-z0-9._-]+$ ]] || fail "journal previous rollback pointer is invalid"
  assert_private_directory "$rollback_root/$previous_journal"
fi

transaction_stage=""
rollback_armed=0
cleanup() {
  local status=$?
  trap - EXIT HUP INT TERM
  if (( rollback_armed == 1 )); then
    if ! restore_transaction; then
      printf 'error: rollback failed and automatic restoration is incomplete; rerun rollback to recover the transaction\n' >&2
      status=74
    fi
  fi
  /bin/rm -rf -- "$transaction_stage"
  /bin/rm -f -- \
    "$support_root/.current.rollback.$$" \
    "$config_root/.policy.rollback.$$" \
    "$launch_agents_root/.com.arthur.remote-authd.plist.rollback.$$" \
    "$rollback_root/.current.rollback.$$"
  exit "$status"
}
trap cleanup EXIT
trap 'exit 130' HUP INT TERM

transaction_stage="$(/usr/bin/mktemp -d "$journal/.rollback-transaction.XXXXXX")"
if [[ -e "$installed_plist" || -L "$installed_plist" ]]; then
  assert_owned_regular "$installed_plist"
  /bin/cp -p "$installed_plist" "$transaction_stage/plist"
  /usr/bin/touch "$transaction_stage/plist.present"
fi
if [[ -e "$installed_policy" || -L "$installed_policy" ]]; then
  assert_owned_regular "$installed_policy"
  /bin/cp -p "$installed_policy" "$transaction_stage/policy"
  /usr/bin/touch "$transaction_stage/policy.present"
fi
if [[ -e "$current_link" || -L "$current_link" ]]; then
  [[ -L "$current_link" ]] || fail "installed current pointer is not a symlink"
  transaction_current_target="$(/usr/bin/readlink "$current_link")"
  [[ "$transaction_current_target" =~ ^versions/[0-9a-f]{64}$ ]] || fail "installed current pointer is invalid"
  printf '%s\n' "$transaction_current_target" > "$transaction_stage/current-target"
  /usr/bin/touch "$transaction_stage/current.present"
fi
/usr/bin/touch "$transaction_stage/armed"
/bin/chmod 0600 "$transaction_stage"/*
/bin/mv -- "$transaction_stage" "$transaction"
transaction_stage=""
rollback_armed=1

if [[ -f "$journal/previous-plist.present" ]]; then
  /bin/cp -p "$journal/previous-plist" "$launch_agents_root/.com.arthur.remote-authd.plist.rollback.$$"
  /bin/mv -f -- "$launch_agents_root/.com.arthur.remote-authd.plist.rollback.$$" "$installed_plist"
  /usr/bin/cmp -s "$journal/previous-plist" "$installed_plist" || fail "LaunchAgent restoration verification failed"
else
  /bin/rm -f -- "$installed_plist"
fi

if [[ -f "$journal/previous-policy.present" ]]; then
  /bin/cp -p "$journal/previous-policy" "$config_root/.policy.rollback.$$"
  /bin/mv -f -- "$config_root/.policy.rollback.$$" "$installed_policy"
  /usr/bin/cmp -s "$journal/previous-policy" "$installed_policy" || fail "policy restoration verification failed"
else
  /bin/rm -f -- "$installed_policy"
fi

if [[ -f "$journal/previous-current.present" ]]; then
  /bin/ln -s "$previous_current" "$support_root/.current.rollback.$$"
  /bin/mv -f -- "$support_root/.current.rollback.$$" "$current_link"
else
  /bin/rm -f -- "$current_link"
fi


if [[ -f "$journal/previous-journal.present" ]]; then
  /bin/ln -s "$previous_journal" "$rollback_root/.current.rollback.$$"
  /bin/mv -f -- "$rollback_root/.current.rollback.$$" "$rollback_root/current"
else
  /bin/rm -f -- "$rollback_root/current"
fi
rollback_armed=0
/bin/rm -rf -- "$transaction"
/bin/rm -f -- "$journal/armed"
/usr/bin/touch "$journal/rolled-back"
if [[ -f "$journal/created-version" ]]; then
  assert_owned_regular "$journal/created-version"
  created_version="$(<"$journal/created-version")"
  [[ "$created_version" =~ ^[0-9a-f]{64}$ ]] || fail "journal created-version identity is invalid"
  if [[ ! -L "$current_link" || "$(/usr/bin/readlink "$current_link")" != "versions/$created_version" ]]; then
    /bin/rm -rf -- "$versions_root/$created_version"
  fi
fi

printf 'Rollback restored the exact prior inactive artifacts (DESIGN/INACTIVE); no activation was performed.\n'
printf 'No LaunchAgent registration or process control was performed.\n'
