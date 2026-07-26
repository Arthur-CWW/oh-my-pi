#!/usr/bin/env -S nu --no-config-file

use std/assert

let root = ($env.FILE_PWD | path dirname)
let runner = $"($root)/scripts/remote-workspace.nu"
let catalog_path = $"($root)/catalog/remote-workspaces.yml"
let catalog = (open $catalog_path)
let desktop = $catalog.workspaces.desktop-agents
let h11 = ($desktop | merge ($catalog.workspaces.h11dsi-agents | reject extends))

assert equal $desktop.omp /home/arthur/.local/bin/omp
assert equal $h11.routingRoots.companion /home/arthur/agents-companion
assert equal $h11.routingRoots.primer /home/arthur/agents-primer
assert equal $h11.routingRoots.playground /home/arthur/agents-playground

let sandbox = (^mktemp -d | str trim)
let home = $"($sandbox)/home"
let fixture_bin = $"($sandbox)/bin"
let remote_root = $"($sandbox)/remote"
let remote_home = $"($remote_root)/home/arthur"
let remote_lane = $"($remote_home)/agents-companion"
let call_log = $"($sandbox)/calls.log"
let shell_log = $"($sandbox)/remote-shell.log"
let models_json_path = $"($sandbox)/models.json"
mkdir $home $fixture_bin $"($remote_lane)/.omp" $"($remote_home)/.local/bin" $"($remote_home)/.local/share/mise/shims"
cp $"($root)/.omp/config.yml" $"($remote_lane)/.omp/config.yml"
cp $"($root)/.omp/companion-config.yml" $"($remote_lane)/.omp/companion-config.yml"
"" | save -f $call_log
"" | save -f $shell_log
{
    models: [
        {provider: anthropic, id: claude-opus-5, name: "Claude Opus"}
        {provider: anthropic, id: claude-opus-4-6, name: "Claude Opus 4.6"}
        {provider: google, id: gemini-unreferenced, name: "Unreferenced"}
        {provider: openai-codex, id: gpt-5.6-luna, name: "Luna"}
        {provider: openai-codex, id: gpt-5.6-sol, name: "Sol"}
    ]
} | to json --raw | save $models_json_path

let nu_executable = $nu.current-exe

([
    "#!/bin/sh"
    $'exec "($nu_executable)" "$@"'
] | str join "\n") | save -f $"($remote_home)/.local/share/mise/shims/nu"

([
    "#!/bin/sh"
    'if test "${1:-}" = "--version"; then printf "omp 9.9.0\\n"; exit 0; fi'
    'if test "${1:-}" = "models"; then'
    '  /bin/cat "$TEST_MODELS_JSON"'
    '  exit 0'
    'fi'
    'exit 64'
] | str join "\n") | save -f $"($remote_home)/.local/bin/omp"

([
    "#!/bin/sh"
    'if test "${1:-}" = "/etc/machine-id"; then printf "5c864a609a404027871b30d4262645c7\\n"; exit 0; fi'
    'exec /bin/cat "$@"'
] | str join "\n") | save -f $"($fixture_bin)/cat"

([
    "#!/bin/sh"
    'shasum -a 256 "$1" | cut -d " " -f 1'
] | str join "\n") | save -f $"($fixture_bin)/sha256sum"

([
    "#!/bin/bash"
    'printf "ssh %s\\n" "$*" >> "$TEST_CALL_LOG"'
    'script=$(/bin/cat)'
    'printf "%s\\n---\\n" "$script" >> "$TEST_SHELL_LOG"'
    'script=${script//\/home\/arthur/$TEST_REMOTE_ROOT\/home\/arthur}'
    'printf "debug1: Server host key: ssh-ed25519 SHA256:G3Uw3/GY7XjgHmKIU7W/t2H0y0SFeuS7SjzAIKL+Bes\\n" >&2'
    'printf "%s" "$script" | /bin/sh'
] | str join "\n") | save -f $"($fixture_bin)/ssh"

([
    "#!/bin/bash"
    'printf "rsync %s\\n" "$*" >> "$TEST_CALL_LOG"'
    'source="$2"'
    'destination="$3"'
    'remote_path=${destination#*:}'
    'remote_path=${remote_path/#\/home\/arthur/$TEST_REMOTE_ROOT\/home\/arthur}'
    '/bin/cp "$source" "$remote_path"'
    'if test -n "${TEST_CORRUPT_UPLOAD:-}" && [[ "$remote_path" == *"$TEST_CORRUPT_UPLOAD"* ]]; then printf "corrupt\\n" >> "$remote_path"; fi'
] | str join "\n") | save -f $"($fixture_bin)/rsync"

^chmod +x $"($remote_home)/.local/share/mise/shims/nu" $"($remote_home)/.local/bin/omp" $"($fixture_bin)/cat" $"($fixture_bin)/sha256sum" $"($fixture_bin)/ssh" $"($fixture_bin)/rsync"

let fixture_environment = {
    HOME: $home
    PATH: ([$fixture_bin] | append $env.PATH)
    OMP_IRC_EXTERNAL_BUS_DB: $"($sandbox)/irc.sqlite"
    OMP_SESSION_CONTROL_DB: $"($sandbox)/session-control.sqlite"
    TEST_CALL_LOG: $call_log
    TEST_SHELL_LOG: $shell_log
    TEST_REMOTE_ROOT: $remote_root
    TEST_MODELS_JSON: $models_json_path
}

def run-routing [environment: record, runner: string, catalog_path: string, action: string] {
    with-env $environment {
        ^nu --no-config-file $runner $action companion --workspace h11dsi-agents --catalog $catalog_path | complete
    }
}

# Inspection is a single fixed identity-fenced SSH probe: it never installs or uploads the runner or catalog.
"" | save -f $call_log
"" | save -f $shell_log
let inspect_result = (run-routing $fixture_environment $runner $catalog_path routing:inspect)
assert equal $inspect_result.exit_code 0
let inspection = ($inspect_result.stdout | from json)
assert equal $inspection.workspace h11dsi-agents
assert equal $inspection.host h11dsi
assert equal $inspection.stream companion
assert equal $inspection.root /home/arthur/agents-companion
assert equal $inspection.binary.path /home/arthur/.local/bin/omp
assert equal $inspection.files.root.path .omp/config.yml
assert equal $inspection.files.stream.path .omp/companion-config.yml
assert equal $inspection.files.root.exists true
assert equal $inspection.files.stream.exists true
let inspect_calls = (open --raw $call_log | lines | where {|line| not ($line | is-empty) })
assert equal ($inspect_calls | length) 1
assert ($inspect_calls.0 | str starts-with "ssh ")
assert not ($inspect_calls | any {|line| $line | str starts-with "rsync " })
assert not ((open --raw $shell_log) | str contains "remote-workspace.nu")
assert not ((open --raw $shell_log) | str contains "remote-workspaces.yml")
assert ((open --raw $shell_log) | str contains "expected_machine_id")

# Only routing fields survive either projection; unrelated real config fields never cross the public JSON boundary.
let allowed_top = [model modelRoles task retry disabledProviders disabledModels enabledModels modelProviderOrder]
for projection in [$inspection.routing.root $inspection.routing.stream $inspection.routing.effective] {
    assert (($projection | columns) | all {|key| $key in $allowed_top })
}
assert not ("setupVersion" in ($inspection.routing.root | columns))
assert not ("extensions" in ($inspection.routing.root | columns))
assert not ("serviceTier" in ($inspection.routing.stream | columns))
assert not ("advisor" in ($inspection.routing.stream | columns))
assert equal ($inspection.routing.root.task | columns) [agentModelOverrides]
assert (($inspection.routing.root.retry | columns) | all {|key| $key in [fallbackChains modelFallback fallbackRevertPolicy] })
assert equal ($inspection.models | length) 3
assert ($inspection.models | all {|row| $"($row.provider)/($row.id)" in [anthropic/claude-opus-4-6 openai-codex/gpt-5.6-luna openai-codex/gpt-5.6-sol] })
assert not ($inspection.models | any {|row| $row.provider == "google" })

# Matching hashes are a routing-only no-op.
"" | save -f $call_log
let noop_result = (run-routing $fixture_environment $runner $catalog_path routing:sync)
assert equal $noop_result.exit_code 0
let noop_receipt = ($noop_result.stdout | from json)
assert equal $noop_receipt.changedFiles []
assert equal $noop_receipt.before $noop_receipt.after
let noop_calls = (open --raw $call_log | lines | where {|line| not ($line | is-empty) })
assert not ($noop_calls | any {|line| $line | str starts-with "rsync " })

# A one-file drift transfers only that exact file.
"stale stream only\n" | save -f $"($remote_lane)/.omp/companion-config.yml"
"" | save -f $call_log
let subset_result = (run-routing $fixture_environment $runner $catalog_path routing:sync)
assert equal $subset_result.exit_code 0
let subset_receipt = ($subset_result.stdout | from json)
assert equal $subset_receipt.changedFiles [.omp/companion-config.yml]
let subset_calls = (open --raw $call_log | lines | where {|line| $line | str starts-with "rsync " })
assert equal ($subset_calls | length) 1
assert ($subset_calls.0 | str contains ".omp/companion-config.yml")
assert not ($subset_calls.0 | str contains ".omp/config.yml.routing-sync")

# Drift stages exactly the two named routing files, verifies both before either rename, and publishes each atomically.
"stale root\n" | save -f $"($remote_lane)/.omp/config.yml"
"stale stream\n" | save -f $"($remote_lane)/.omp/companion-config.yml"
"" | save -f $call_log
"" | save -f $shell_log
let sync_result = (run-routing $fixture_environment $runner $catalog_path routing:sync)
assert equal $sync_result.exit_code 0
let sync_receipt = ($sync_result.stdout | from json)
assert equal $sync_receipt.changedFiles [.omp/config.yml .omp/companion-config.yml]
assert equal (open --raw $"($remote_lane)/.omp/config.yml") (open --raw $"($root)/.omp/config.yml")
assert equal (open --raw $"($remote_lane)/.omp/companion-config.yml") (open --raw $"($root)/.omp/companion-config.yml")
let sync_calls = (open --raw $call_log | lines | where {|line| $line | str starts-with "rsync " })
assert equal ($sync_calls | length) 2
assert ($sync_calls.0 | str contains ".omp/config.yml")
assert ($sync_calls.1 | str contains ".omp/companion-config.yml")
let sync_shell = (open --raw $shell_log)
assert ($sync_shell | str contains 'sha256sum "$root_stage"')
assert ($sync_shell | str contains 'sha256sum "$stream_stage"')
assert ($sync_shell | str contains 'mv -f "$root_stage" "$root_remote"')
assert ($sync_shell | str contains 'mv -f "$stream_stage" "$stream_remote"')
assert not (($sync_calls | str join "\n") | str contains "remote-workspace.nu")
assert not (($sync_calls | str join "\n") | str contains "remote-workspaces.yml")

# A verification failure occurs before any rename, preserves both destinations, and removes every staging file.
let old_root = "destination root stays\n"
let old_stream = "destination stream stays\n"
$old_root | save -f $"($remote_lane)/.omp/config.yml"
$old_stream | save -f $"($remote_lane)/.omp/companion-config.yml"
"" | save -f $call_log
let failed_sync = (run-routing ($fixture_environment | merge {TEST_CORRUPT_UPLOAD: "companion-config.yml.routing-sync"}) $runner $catalog_path routing:sync)
assert ($failed_sync.exit_code != 0)
assert equal (open --raw $"($remote_lane)/.omp/config.yml") $old_root
assert equal (open --raw $"($remote_lane)/.omp/companion-config.yml") $old_stream
assert equal (glob $"($remote_lane)/.omp/*.routing-sync.*" | length) 0

rm -rf $sandbox
print "remote routing inspection and synchronization boundary checks passed"
