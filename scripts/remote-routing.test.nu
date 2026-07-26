#!/usr/bin/env -S nu --no-config-file

use std/assert
use remote-workspace.nu [routing-projection-program routing-publish-program]

let sandbox = (^mktemp -d | str trim)
let home = $"($sandbox)/home"
let root = $"($home)/agents"
let omp_dir = $"($root)/.omp"
mkdir $omp_dir

let secret_config = $"($sandbox)/secret-config.yml"
[
    "modelRoles:"
    "  default: openai-codex/gpt-5.6-sol:med"
    "task:"
    "  agentModelOverrides:"
    "    reviewer: openai-codex/gpt-5.6-luna:xhigh"
    "retry:"
    "  fallbackChains:"
    "    openai-codex/gpt-5.6-sol:"
    "      - anthropic/claude-opus-5:medium"
    "auth:"
    "  token: must-not-escape"
    "extensions:"
    "  - /secret/extension.ts"
] | str join "\n" | save $secret_config
let projection_result = (with-env {ROUTING_CONFIG: $secret_config} {
    ^nu --no-config-file -c (routing-projection-program) | complete
})
assert equal $projection_result.exit_code 0
let projection = ($projection_result.stdout | from json)
assert equal $projection.modelRoles.default "openai-codex/gpt-5.6-sol:med"
assert equal $projection.task.agentModelOverrides.reviewer "openai-codex/gpt-5.6-luna:xhigh"
assert equal $projection.retry.fallbackChains."openai-codex/gpt-5.6-sol".0 "anthropic/claude-opus-5:medium"
assert ("auth" not-in ($projection | columns))
assert ("extensions" not-in ($projection | columns))
assert not (($projection | to json) | str contains "must-not-escape")

let root_remote = $"($omp_dir)/config.yml"
let stream_remote = $"($omp_dir)/companion-config.yml"
let root_stage = $"($root_remote).stage"
let stream_stage = $"($stream_remote).stage"
let root_backup = $"($root_remote).backup"
let stream_backup = $"($stream_remote).backup"
let lock_dir = $"($root)/.routing-sync.lock"
"old-root" | save $root_remote
"old-stream" | save $stream_remote
"new-root" | save $root_stage
"new-stream" | save $stream_stage
mkdir $lock_dir
let success_boundary = {
    rootRemote: $root_remote
    rootStage: $root_stage
    rootBackup: $root_backup
    rootExpected: (open --raw $root_stage | hash sha256)
    streamRemote: $stream_remote
    streamStage: $stream_stage
    streamBackup: $stream_backup
    streamExpected: (open --raw $stream_stage | hash sha256)
    lockDir: $lock_dir
    changeRoot: true
    changeStream: true
}
let success = ((routing-publish-program $success_boundary) | ^/bin/sh -s | complete)
assert equal $success.exit_code 0
assert equal (open --raw $root_remote) "new-root"
assert equal (open --raw $stream_remote) "new-stream"
assert not ($root_stage | path exists)
assert not ($stream_stage | path exists)
assert not ($root_backup | path exists)
assert not ($stream_backup | path exists)
assert not ($lock_dir | path exists)

"stable-root" | save -f $root_remote
let stream_target_dir = $"($sandbox)/stream-target"
mkdir $stream_target_dir
rm -f $stream_remote
^ln -s $stream_target_dir $stream_remote
"candidate-root" | save -f $root_stage
"candidate-stream" | save -f $stream_stage
mkdir $lock_dir
let rollback_boundary = {
    rootRemote: $root_remote
    rootStage: $root_stage
    rootBackup: $root_backup
    rootExpected: (open --raw $root_stage | hash sha256)
    streamRemote: $stream_remote
    streamStage: $stream_stage
    streamBackup: $stream_backup
    streamExpected: (open --raw $stream_stage | hash sha256)
    lockDir: $lock_dir
    changeRoot: true
    changeStream: true
}
let failure = ((routing-publish-program $rollback_boundary) | ^/bin/sh -s | complete)
assert ($failure.exit_code != 0)
assert equal (open --raw $root_remote) "stable-root"
assert not ($root_stage | path exists)
assert not ($stream_stage | path exists)
assert not ($root_backup | path exists)
assert not ($stream_backup | path exists)
assert not ($lock_dir | path exists)

rm -rf $sandbox
print "remote routing projection and atomic publish checks passed"
