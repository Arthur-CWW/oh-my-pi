#!/usr/bin/env -S nu --no-config-file

use ../../scripts/macos/install-gdm-remote.nu *

const fixture_path = "fixtures/install-gdm-remote.json"

def require [condition: bool, message: string] {
    if not $condition { error make {msg: $message} }
}

def require-error [operation: closure, fragment: string] {
    let caught: record<failed: bool, message: string> = try {
        do $operation | ignore
        {failed: false, message: ""}
    } catch {|error|
        {failed: true, message: ($error.msg? | default ($error | to text))}
    }
    require $caught.failed $"expected failure containing: ($fragment)"
    require ($caught.message | str contains $fragment) $"unexpected failure: ($caught.message)"
}

def main [] {
    let fixture = (open ($env.FILE_PWD | path join $fixture_path))

    let key = (parse-public-key $fixture.publicKeys.validCommentFree.raw)
    require ($key.normalized == $fixture.publicKeys.validCommentFree.normalized) "public key must retain its canonical two-field form"
    require-error { parse-public-key $fixture.publicKeys.fishLikeComment } "comment-free"
    require-error { parse-public-key $fixture.publicKeys.malformedComment } "comment-free"
    require-error { parse-public-key $fixture.publicKeys.malformedWireKey } "wire key"
    require-error { parse-public-key $fixture.publicKeys.malformedKeyLength } "length field"

    let completed = (decode-process-result "fixture process" {stdout: "ready", stderr: "", exit_code: 0})
    require ($completed.stdout == "ready") "completed process output must be returned directly"
    require-error { decode-process-result "fixture process" {stdout: "", stderr: "denied", exit_code: 23} } "exit code 23"

    let stage = (decode-stage-output $fixture.stage.valid)
    require ($stage.staging == "ready") "stage readiness must be exact"
    require-error { decode-stage-output $fixture.stage.duplicate } "duplicate"
    require-error { decode-stage-output $fixture.stage.missing } "exactly three"
    require-error { decode-stage-output $fixture.stage.uppercaseDigest } "lowercase"

    let stale = (decode-preflight-output $fixture.preflight.staleCleanup)
    require ($stale.cleanup == "stale-source-removed") "stale staging must be represented explicitly"
    require-error { decode-preflight-output $fixture.preflight.unexpectedField } "malformed closed record"

    require ((decode-transfer-state $fixture.transfer.verified).transfer == "verified") "verified rsync state must decode"
    require-error { decode-transfer-state $fixture.transfer.rsyncModeDrift } "rejected staged modes"

    let sha = (parse-sha-output $fixture.sha.valid $fixture.sha.path)
    require ($sha.digest == ("a" | fill --width 64 --alignment right --character "a")) "SHA digest must be preserved"
    require-error { parse-sha-output $fixture.sha.wrongPath $fixture.sha.path } "unexpected path"
    require-error { parse-sha-output $fixture.sha.malformed $fixture.sha.path } "malformed"

    let readiness = (decode-readiness-results $fixture.readiness.retryThenReady)
    require ($readiness.attempt_count == 2) "readiness retry count must be retained"
    require-error { decode-readiness-results $fixture.readiness.continuedAfterSuccess } "stop at the first success"

    require ((validate-leaf-contract $fixture.leafContract.valid).root_snapshot_mode == "0700") "fixed noexec/root-owned leaf contract must decode"
    require-error { validate-leaf-contract $fixture.leafContract.noexecViolated } "leaf execution contract"

    for action in ["prepare" "activate" "deactivate" "status"] {
        require ((validate-action $action) == $action) $"($action) must remain a closed action"
    }
    require-error { validate-action "install" } "exactly prepare"
    require-error { validate-action "rollback" } "exactly prepare"
    require-error { validate-action "status; echo fish-owned" } "exactly prepare"

    {component: "gdm-broker", suite: "install-gdm-remote", status: "passed"}
}
