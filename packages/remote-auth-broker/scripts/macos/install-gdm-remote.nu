#!/usr/bin/env -S nu --no-config-file

const fixed_config: record = {
    component: "gdm-broker"
    host: "desktop"
    user: "arthur"
    local_home: "/Users/arthur"
    local_ubuntu_root: "/Users/arthur/agents/packages/remote-auth-broker/ubuntu"
    local_public_key: "/Users/arthur/.ssh/remote-auth-gdm-ingest.pub"
    touch_id_helper: "/Users/arthur/dotfiles/server/ubuntu-remote/framework-remote-sudo-askpass.sh"
    remote_nu: "/home/arthur/.local/share/mise/shims/nu"
    remote_root: "/home/arthur/.local/state/remote-auth-broker-gdm"
    remote_source: "/home/arthur/.local/state/remote-auth-broker-gdm/source.incoming"
    remote_stage: "/home/arthur/.local/state/remote-auth-broker-gdm/source.incoming/scripts/stage-gdm-release-ubuntu.sh"
    installed_action: "/usr/libexec/remote-auth-broker/remote-auth-gdm-deploy"
}
const component: string = $fixed_config.component
const fixed_host: string = $fixed_config.host
const fixed_user: string = $fixed_config.user
const fixed_home: string = $fixed_config.local_home
const local_ubuntu_root: string = $fixed_config.local_ubuntu_root
const local_public_key: string = $fixed_config.local_public_key
const touch_id_helper: string = $fixed_config.touch_id_helper
const remote_nu: string = $fixed_config.remote_nu
const remote_root: string = $fixed_config.remote_root
const remote_source: string = $fixed_config.remote_source
const remote_stage: string = $fixed_config.remote_stage
const installed_action: string = $fixed_config.installed_action
const local_current: string = "/Users/arthur/Library/Application Support/RemoteAuthBroker/current"
const local_cli: string = "/Users/arthur/Library/Application Support/RemoteAuthBroker/current/bin/remote-authctl"
const local_bundle: string = "/Users/arthur/Library/Application Support/RemoteAuthBroker/config/gdm-activation-bundle.json"
const remote_activation_root: string = "/home/arthur/.local/state/remote-auth-broker-gdm/activation"
const remote_activation_bundle: string = "/home/arthur/.local/state/remote-auth-broker-gdm/activation/gdm-activation-bundle.json"
const ssh_options = [
    -x
    -o ForwardX11=no
    -o BatchMode=yes
    -o ConnectTimeout=5
    -o ServerAliveInterval=5
    -o ServerAliveCountMax=2
]
const required_sources = [
    "Cargo.toml"
    "Cargo.lock"
    "scripts/stage-gdm-release-ubuntu.sh"
    "scripts/deploy-gdm-release-ubuntu.sh"
    "scripts/ubuntu-common.sh"
]
const leaf_contract = {
    transferred_script_mode: "0600"
    user_staging_executable: false
    root_snapshot_mode: "0700"
    execution_origin: "authenticated-root-owned-snapshot"
}

# These fixed programs run as the unprivileged remote owner. Root/PAM/systemd
# mutation remains in the separately audited Bash leaf actions.
const remote_preflight_program = r#'
const root = "/home/arthur/.local/state/remote-auth-broker-gdm"
const source = "/home/arthur/.local/state/remote-auth-broker-gdm/source.incoming"

def checked [label: string, command: closure] {
    let result = (do $command | complete)
    if $result.exit_code != 0 {
        error make {msg: $"($label) failed: ($result.stderr | str trim)"}
    }
    $result.stdout | str trim
}

def metadata [path: string] {
    let raw = (checked $"Inspect ($path)" { ^/usr/bin/stat -c "%U|%G|%a|%F" -- $path })
    let fields = ($raw | split row "|")
    if ($fields | length) != 4 { error make {msg: $"Malformed metadata for ($path)"} }
    {owner: $fields.0, group: $fields.1, mode: $fields.2, kind: $fields.3}
}

def require-directory [path: string, owner: string, mode: string] {
    let value = (metadata $path)
    if $value.kind != "directory" or $value.owner != $owner {
        error make {msg: $"Unsafe directory metadata: ($path)"}
    }
    if $mode != "" and $value.mode != $mode {
        error make {msg: $"Unsafe directory mode: ($path)"}
    }
    if $mode == "" and not ($value.mode =~ "^[0-7]?[0-7][0-5][0-5]$") {
        error make {msg: $"Directory is writable by an untrusted principal: ($path)"}
    }
    if (checked $"Resolve ($path)" { ^/usr/bin/readlink -f -- $path }) != $path {
        error make {msg: $"Directory does not resolve exactly: ($path)"}
    }
}

if (checked "Read remote user" { ^/usr/bin/id -un }) != "arthur" or ($env.HOME? | default "") != "/home/arthur" {
    error make {msg: "Fixed unprivileged staging identity is invalid"}
}
if (checked "Read remote uid" { ^/usr/bin/id -u }) == "0" {
    error make {msg: "Remote preflight must not run as root"}
}
require-directory "/" "root" ""
require-directory "/home" "root" ""
require-directory "/home/arthur" "arthur" ""
require-directory "/home/arthur/.local" "arthur" ""
require-directory "/home/arthur/.local/state" "arthur" ""

let state_entries = (ls -a "/home/arthur/.local/state" | get name | each {|path| $path | path basename })
if "remote-auth-broker-gdm" not-in $state_entries {
    checked "Create staging root" { ^/bin/mkdir -m 0700 -- $root } | ignore
}
require-directory $root "arthur" "700"
let allowed = ["staged" "source.incoming" "activation"]
let entries = (ls -a $root | get name | each {|path| $path | path basename } | where {|name| $name not-in ["." ".."] })
for entry in $entries {
    if $entry not-in $allowed { error make {msg: $"Unexpected staging entry: ($entry)"} }
}
if "staged" in $entries { require-directory ($root | path join "staged") "arthur" "700" }
if "activation" in $entries { require-directory ($root | path join "activation") "arthur" "700" }
if "activation" not-in $entries { checked "Create activation staging" { ^/bin/mkdir -m 0700 -- ($root | path join "activation") } | ignore }
mut cleanup = "none"
if "source.incoming" in $entries {
    require-directory $source "arthur" ""
    checked "Normalize stale transfer staging" { ^/bin/chmod 0700 -- $source } | ignore
    rm --recursive $source
    $cleanup = "stale-source-removed"
}
checked "Create transfer staging" { ^/bin/mkdir -m 0700 -- $source } | ignore
checked "Create identity staging" { ^/bin/mkdir -m 0700 -- ($source | path join "identity") } | ignore
{component: "gdm-broker", staging_root: $root, cleanup: $cleanup, source_ready: true} | to json --raw
'#

const remote_audit_program = r#'
const source = "/home/arthur/.local/state/remote-auth-broker-gdm/source.incoming"

def checked [label: string, command: closure] {
    let result = (do $command | complete)
    if $result.exit_code != 0 { error make {msg: $"($label) failed: ($result.stderr | str trim)"} }
    $result.stdout | str trim
}

let owner = (checked "Read uid" { ^/usr/bin/id -u })
let raw = (checked "Inventory transfer" { ^/usr/bin/find $source -xdev -printf "%P|%y|%U|%m\n" })
mut files = 0
mut directories = 0
mut violations = []
for line in ($raw | lines) {
    let fields = ($line | split row "|")
    if ($fields | length) != 4 {
        $violations = ($violations | append "malformed-inventory-row")
        continue
    }
    let relative = $fields.0
    let kind = $fields.1
    let uid = $fields.2
    let full = if $relative == "" { $source } else { $source | path join $relative }
    mut safe = true
    if $relative != "" and not ($relative =~ "^[A-Za-z0-9._/-]+$") {
        $violations = ($violations | append $"unsupported-path:($relative)")
        $safe = false
    }
    if $uid != $owner {
        $violations = ($violations | append $"wrong-owner:($relative)")
        $safe = false
    }
    let expected_mode = if $kind == "d" {
        $directories = $directories + 1
        "700"
    } else if $kind == "f" {
        $files = $files + 1
        "600"
    } else {
        $violations = ($violations | append $"unsupported-type:($relative):($kind)")
        $safe = false
        ""
    }
    if $safe {
        checked $"Normalize ($relative)" { ^/bin/chmod $expected_mode -- $full } | ignore
        let final = (checked $"Verify ($relative)" { ^/usr/bin/stat -c "%u|%a|%F" -- $full } | split row "|")
        if ($final | length) != 3 or $final.0 != $owner or $final.1 != $expected_mode or (($kind == "d") != ($final.2 == "directory")) {
            $violations = ($violations | append $"post-normalization-metadata:($relative)")
        }
    }
}
for required in ["Cargo.toml" "Cargo.lock" "scripts/stage-gdm-release-ubuntu.sh" "scripts/deploy-gdm-release-ubuntu.sh" "scripts/ubuntu-common.sh" "identity/remote-auth-gdm-ingest.pub"] {
    if not (($raw | lines) | any {|line| $line | str starts-with $"($required)|f|" }) {
        $violations = ($violations | append $"missing:($required)")
    }
}
{
    component: "gdm-broker"
    transfer: (if ($violations | is-empty) { "verified" } else { "rejected" })
    files: $files
    directories: $directories
    violations: $violations
} | to json --raw
'#

const remote_cleanup_program = r#'
const root = "/home/arthur/.local/state/remote-auth-broker-gdm"
const source = "/home/arthur/.local/state/remote-auth-broker-gdm/source.incoming"

def checked [label: string, command: closure] {
    let result = (do $command | complete)
    if $result.exit_code != 0 { error make {msg: $"($label) failed: ($result.stderr | str trim)"} }
    $result.stdout | str trim
}

def metadata [path: string] {
    let raw = (checked $"Inspect ($path)" { ^/usr/bin/stat -c "%U|%a|%F" -- $path })
    let fields = ($raw | split row "|")
    if ($fields | length) != 3 { error make {msg: "Malformed cleanup metadata"} }
    {owner: $fields.0, mode: $fields.1, kind: $fields.2}
}

let root_value = (metadata $root)
if $root_value != {owner: "arthur", mode: "700", kind: "directory"} or (checked "Resolve staging root" { ^/usr/bin/readlink -f -- $root }) != $root {
    error make {msg: "Remote staging root changed before cleanup"}
}
let entries = (ls -a $root | get name | each {|path| $path | path basename })
if "source.incoming" in $entries {
    let source_value = (metadata $source)
    if $source_value.owner != "arthur" or $source_value.kind != "directory" or not ($source_value.mode =~ "^[0-7]?[0-7][0-5][0-5]$") or (checked "Resolve staging source" { ^/usr/bin/readlink -f -- $source }) != $source {
        error make {msg: "Remote staging source changed before cleanup"}
    }
    checked "Normalize staging source for cleanup" { ^/bin/chmod 0700 -- $source } | ignore
    rm --recursive $source
}
{component: "gdm-broker", cleanup: "complete"} | to json --raw
'#

def decoder-error [message: string, input: any, help: string] {
    error make {
        msg: $message
        label: {
            text: $message
            span: (metadata $input).span
        }
        help: $help
    }
}

def exact-columns [value: record, expected: list<string>]: nothing -> bool {
    (($value | columns | sort) == ($expected | sort))
}

export def decode-process-result [label: string, process: record]: nothing -> record<stdout: string, stderr: string, exit_code: int> {
    if not (exact-columns $process ["stdout" "stderr" "exit_code"]) {
        decoder-error $"($label) returned a malformed subprocess record" $process "Expected exactly stdout, stderr, and exit_code from `complete`."
    }
    if ($process.stdout | describe) != "string" or ($process.stderr | describe) != "string" or ($process.exit_code | describe) !~ "^int" {
        decoder-error $"($label) returned invalid subprocess field types" $process "stdout and stderr must be strings and exit_code must be an integer."
    }
    if $process.exit_code != 0 {
        let detail = ($process.stderr | str trim)
        decoder-error $"($label) failed with exit code ($process.exit_code)(if ($detail | is-empty) { '' } else { $': ($detail)' })" $process "Inspect the completed process stderr and transaction audit before retrying."
    }
    {
        stdout: $process.stdout
        stderr: $process.stderr
        exit_code: $process.exit_code
    }
}

export def decode-readiness-results [attempts: list<record>]: nothing -> record<attempt_count: int, process: record<stdout: string, stderr: string, exit_code: int>> {
    if ($attempts | is-empty) or ($attempts | length) > 3 {
        decoder-error "readiness requires one through three bounded attempts" $attempts "Provide only the attempts made by the fixed three-attempt readiness loop."
    }
    for attempt in ($attempts | drop 1) {
        if not (exact-columns $attempt ["stdout" "stderr" "exit_code"]) or ($attempt.stdout | describe) != "string" or ($attempt.stderr | describe) != "string" or ($attempt.exit_code | describe) !~ "^int" or $attempt.exit_code == 0 {
            decoder-error "readiness attempts must stop at the first success" $attempts "Every attempt before the final success must be a well-formed failed process."
        }
    }
    {
        attempt_count: ($attempts | length)
        process: (decode-process-result "Remote readiness" ($attempts | last))
    }
}

export def decode-stage-output [text: string]: nothing -> record<component: string, staged_release_sha256: string, staging: string> {
    if ($text | str contains "\r") or ($text | is-empty) {
        decoder-error "staging returned malformed line endings" $text "Expected three non-empty LF-delimited metadata lines."
    }
    let body = if ($text | str ends-with "\n") { $text | str substring 0..<-1 } else { $text }
    let lines = ($body | split row "\n")
    if ($lines | length) != 3 {
        decoder-error "staging metadata must contain exactly three lines" $text "Expected component, staged_release_sha256, and staging exactly once."
    }
    mut fields = {}
    for line in $lines {
        let parsed = ($line | parse --regex '^(?<key>[a-z0-9_]+)=(?<value>[^=]*)$')
        if ($parsed | length) != 1 {
            decoder-error "staging returned malformed metadata" $text "Each line must be a lowercase key followed by one equals sign and its value."
        }
        let row = ($parsed | first)
        if $row.key in ($fields | columns) {
            decoder-error $"staging returned duplicate ($row.key) metadata" $text "Every closed-record field must appear exactly once."
        }
        $fields = ($fields | insert $row.key $row.value)
    }
    if not (exact-columns $fields ["component" "staged_release_sha256" "staging"]) {
        decoder-error "staging returned missing or unexpected metadata" $text "Only component, staged_release_sha256, and staging are accepted."
    }
    if $fields.component != $component or $fields.staging != "ready" {
        decoder-error "staging returned an invalid closed state" $text "The component must be gdm-broker and staging must be ready."
    }
    if not ($fields.staged_release_sha256 =~ "^[0-9a-f]{64}$") {
        decoder-error "staging returned an invalid lowercase release digest" $text "The staged release digest must be exactly 64 lowercase hexadecimal characters."
    }
    {
        component: $fields.component
        staged_release_sha256: $fields.staged_release_sha256
        staging: $fields.staging
    }
}

export def decode-preflight-output [text: string]: nothing -> record<component: string, staging_root: string, cleanup: string, source_ready: bool> {
    let parsed = try {
        $text | from json
    } catch {
        decoder-error "remote preflight returned malformed JSON" $text "Expected one closed JSON object from the fixed remote preflight."
    }
    if ($parsed | describe) !~ "^record" or not (exact-columns $parsed ["component" "staging_root" "cleanup" "source_ready"]) {
        decoder-error "remote preflight returned a malformed closed record" $text "Only component, staging_root, cleanup, and source_ready are accepted."
    }
    if ($parsed.component | describe) != "string" or ($parsed.staging_root | describe) != "string" or ($parsed.cleanup | describe) != "string" or ($parsed.source_ready | describe) != "bool" {
        decoder-error "remote preflight returned invalid field types" $text "component, staging_root, and cleanup must be strings and source_ready must be a boolean."
    }
    if $parsed.component != $component or $parsed.staging_root != $remote_root or $parsed.cleanup not-in ["none" "stale-source-removed"] or $parsed.source_ready != true {
        decoder-error "remote preflight returned an invalid state" $text "The fixed staging root must be ready after either no cleanup or safe stale-source cleanup."
    }
    {
        component: $parsed.component
        staging_root: $parsed.staging_root
        cleanup: $parsed.cleanup
        source_ready: $parsed.source_ready
    }
}

export def decode-cleanup-output [text: string]: nothing -> record<component: string, cleanup: string> {
    let parsed = try {
        $text | from json
    } catch {
        decoder-error "remote cleanup returned malformed JSON" $text "Expected one closed cleanup JSON object."
    }
    if ($parsed | describe) !~ "^record" or not (exact-columns $parsed ["component" "cleanup"]) {
        decoder-error "remote cleanup returned a malformed closed record" $text "Only component and cleanup are accepted."
    }
    if $parsed != {component: "gdm-broker", cleanup: "complete"} {
        decoder-error "remote cleanup returned an invalid state" $text "Cleanup must report the exact complete state."
    }
    {component: $parsed.component, cleanup: $parsed.cleanup}
}

export def decode-transfer-state [text: string]: nothing -> record<component: string, transfer: string, files: int, directories: int, violations: list<string>> {
    let parsed = try {
        $text | from json
    } catch {
        decoder-error "remote transfer audit returned malformed JSON" $text "Expected one closed transfer-audit JSON object."
    }
    if ($parsed | describe) !~ "^record" or not (exact-columns $parsed ["component" "transfer" "files" "directories" "violations"]) {
        decoder-error "remote transfer audit returned a malformed closed record" $text "Only component, transfer, files, directories, and violations are accepted."
    }
    if ($parsed.component | describe) != "string" or ($parsed.transfer | describe) != "string" or ($parsed.files | describe) !~ "^int" or ($parsed.directories | describe) !~ "^int" or ($parsed.violations | describe) !~ "^list" or not ($parsed.violations | all {|violation| ($violation | describe) == "string" }) {
        decoder-error "remote transfer audit returned invalid field types" $text "component and transfer must be strings, counts must be integers, and every violation must be a string."
    }
    if $parsed.transfer != "verified" or not ($parsed.violations | is-empty) {
        decoder-error $"remote transfer audit rejected staged modes or types: ($parsed.violations | str join ', ')" $text "Correct every staged ownership, mode, type, and required-file violation before activation."
    }
    {
        component: $parsed.component
        transfer: $parsed.transfer
        files: $parsed.files
        directories: $parsed.directories
        violations: $parsed.violations
    }
}

export def parse-public-key [raw: string]: nothing -> record<kind: string, normalized: string> {
    if ($raw | str length) > 256 or ($raw | str contains "\r") or ($raw | str contains "\u{0000}") {
        decoder-error "public key contains unsupported bytes" $raw "Provide one short LF-terminated OpenSSH public-key record."
    }
    let line = if ($raw | str ends-with "\n") { $raw | str substring 0..<-1 } else { $raw }
    if ($line | str contains "\n") {
        decoder-error "public key must contain exactly one line" $raw "Remove every extra line."
    }
    let parsed = ($line | parse --regex '^(?<kind>ssh-ed25519) (?<payload>[A-Za-z0-9+/]+={0,2})$')
    if ($parsed | length) != 1 {
        decoder-error "public key must be a strict comment-free ssh-ed25519 record" $raw "Use exactly `ssh-ed25519 BASE64` with no comment or shell text."
    }
    let row = ($parsed | first)
    let decoded = try {
        $row.payload | decode base64
    } catch {
        decoder-error "public key payload is not canonical base64" $raw "Replace the payload with canonical OpenSSH base64."
    }
    if ($decoded | bytes length) != 51 or (($decoded | bytes at 0..14 | encode hex | str lowercase) != "0000000b7373682d65643235353139") {
        decoder-error "public key payload is not an Ed25519 wire key" $raw "The wire value must contain the ssh-ed25519 algorithm string and one 32-byte public key."
    }
    if (($decoded | bytes at 15..18 | encode hex | str lowercase) != "00000020") {
        decoder-error "public key payload has an invalid Ed25519 key length field" $raw "The second SSH string length must be exactly 00 00 00 20."
    }
    {
        kind: $row.kind
        normalized: $"($row.kind) ($row.payload)\n"
    }
}

export def parse-sha-output [text: string, expected_path: string]: nothing -> record<digest: string, path: string, binary: bool> {
    if ($text | str contains "\r") {
        decoder-error "SHA output contains unsupported line endings" $text "Expected one LF-terminated shasum record."
    }
    let body = if ($text | str ends-with "\n") { $text | str substring 0..<-1 } else { $text }
    if ($body | str contains "\n") {
        decoder-error "SHA output must contain exactly one line" $text "Expected one digest for the fixed source path."
    }
    let parsed = ($body | parse --regex '^(?<digest>[0-9a-f]{64}) (?<marker>[ *])(?<path>.+)$')
    if ($parsed | length) != 1 {
        decoder-error "SHA output is malformed" $text "Expected the canonical lowercase `shasum -a 256` output format."
    }
    let row = ($parsed | first)
    if $row.path != $expected_path {
        decoder-error "SHA output names an unexpected path" $text $"Expected the fixed path ($expected_path)."
    }
    {digest: $row.digest, path: $row.path, binary: ($row.marker == "*")}
}

export def validate-leaf-contract [contract: record]: nothing -> record<transferred_script_mode: string, user_staging_executable: bool, root_snapshot_mode: string, execution_origin: string> {
    if not (exact-columns $contract ["transferred_script_mode" "user_staging_executable" "root_snapshot_mode" "execution_origin"]) or $contract != $leaf_contract {
        decoder-error "root leaf execution contract is invalid" $contract "Transferred scripts must remain non-executable until copied into the authenticated root-owned snapshot."
    }
    {
        transferred_script_mode: $contract.transferred_script_mode
        user_staging_executable: $contract.user_staging_executable
        root_snapshot_mode: $contract.root_snapshot_mode
        execution_origin: $contract.execution_origin
    }
}

export def validate-action [action: string]: nothing -> string {
    match $action {
        "prepare" | "activate" | "deactivate" | "status" => $action
        _ => {
            decoder-error "action must be exactly prepare, activate, deactivate, or status" $action "Choose one closed lifecycle action; arbitrary command text is not accepted."
        }
    }
}

def transaction-scope [action: string]: nothing -> record {
    {
        component: $component
        action: $action
        scope: {
            local_temporary: "owned-key-staging-only"
            remote_staging: $remote_source
            durable_root: "fixed-authenticated-leaf-only"
        }
        recovery: {
            local_temporary_cleanup: "not-required"
            remote_staging_cleanup: "not-required"
            durable_root_compensation: "delegated-to-fixed-leaf"
        }
        external_steps: []
    }
}

def observe-process [intent: record, process: record]: record -> record {
    let transaction = $in
    let result = if (exact-columns $process ["stdout" "stderr" "exit_code"]) {
        {
            status: (if $process.exit_code == 0 { "succeeded" } else { "failed" })
            exit_code: $process.exit_code
            stdout: $process.stdout
            stderr: $process.stderr
        }
    } else {
        {status: "malformed", exit_code: null, stdout: "", stderr: "malformed subprocess record"}
    }
    $transaction | upsert external_steps ($transaction.external_steps | append {intent: $intent, result: $result})
}

def require-fixed-file [path: string, label: string] {
    if not ($path | path exists) or ($path | path type) != "file" {
        error make {msg: $"($label) is unavailable or is not a regular file"}
    }
}

def validate-local-owner []: nothing -> record {
    let identity = (decode-process-result "Read local owner" (^/usr/bin/id -un | complete))
    if ($identity.stdout | str trim) != $fixed_user or ($env.HOME? | default "") != $fixed_home {
        error make {msg: "the fixed local deployment owner is required"}
    }
    require-fixed-file $touch_id_helper "Pinned Touch ID helper"
    $identity
}

def source-inventory []: nothing -> record {
    if ($local_ubuntu_root | path type) != "dir" or ($local_ubuntu_root | path expand --strict) != $local_ubuntu_root {
        error make {msg: "the reviewed Ubuntu source root is unavailable or does not resolve exactly"}
    }
    let root_entries = (ls -a $local_ubuntu_root | get name | each {|path| $path | path basename } | where {|name| $name not-in ["." ".."] })
    for entry in $root_entries {
        if $entry not-in ["Cargo.toml" "Cargo.lock" "assets" "crates" "scripts" "target" ".DS_Store"] {
            error make {msg: $"unexpected Ubuntu source root entry: ($entry)"}
        }
    }
    for required in $required_sources { require-fixed-file ($local_ubuntu_root | path join $required) $"Required source ($required)" }

    mut inventory = []
    for base in ["assets" "crates" "scripts"] {
        for path in (glob $"($local_ubuntu_root)/($base)/**/*") {
            let path_text = ($path | into string)
            if ($path_text | path basename) == ".DS_Store" { continue }
            let relative = ($path_text | path relative-to $local_ubuntu_root)
            let kind = ($path_text | path type)
            if not ($relative =~ "^[A-Za-z0-9._/-]+$") or $kind not-in ["file" "dir"] {
                error make {msg: $"unsupported source inventory entry: ($relative)"}
            }
            $inventory = ($inventory | append {path: $relative, kind: $kind})
        }
    }
    for cargo in ["Cargo.toml" "Cargo.lock"] { $inventory = ($inventory | append {path: $cargo, kind: "file"}) }

    mut metadata = []
    mut hash_processes = []
    for relative in $required_sources {
        let path = ($local_ubuntu_root | path join $relative)
        let process = (^/usr/bin/shasum -a 256 -- $path | complete)
        $hash_processes = ($hash_processes | append {path: $relative, process: $process})
        let output = (decode-process-result $"Hash ($relative)" $process).stdout
        let parsed = (parse-sha-output $output $path)
        $metadata = ($metadata | append {path: $relative, sha256: $parsed.digest})
    }
    {
        inventory: {
            root: $local_ubuntu_root
            files: ($inventory | where kind == "file" | length)
            directories: ($inventory | where kind == "dir" | length)
            required: $metadata
            leaf_contract: $leaf_contract
        }
        hash_processes: $hash_processes
    }
}

def local-temporary-root []: nothing -> string {
    (($env.TMPDIR? | default "/tmp") | str trim --right --char "/")
}

def cleanup-local-key [directory: string] {
    let root = (local-temporary-root)
    if ($directory | path dirname) != $root or not (($directory | path basename) =~ "^remote-auth-gdm\\.[A-Za-z0-9]+$") {
        error make {msg: "refusing to clean an unexpected local temporary path"}
    }
    if ($directory | path exists) {
        if ($directory | path type) != "dir" { error make {msg: "local temporary staging changed type before cleanup"} }
        rm --recursive $directory
    }
}

def public-key []: nothing -> record {
    require-fixed-file $local_public_key "Fixed GDM ingestion public identity"
    let parsed = (parse-public-key (open --raw $local_public_key))
    let temporary = (^/usr/bin/mktemp -d $"((local-temporary-root))/remote-auth-gdm.XXXXXXXX" | complete)
    let directory = ((decode-process-result "Create local key staging" $temporary).stdout | str trim)
    let root = (local-temporary-root)
    if ($directory | path dirname) != $root or not (($directory | path basename) =~ "^remote-auth-gdm\\.[A-Za-z0-9]+$") or ($directory | path type) != "dir" {
        error make {msg: "mktemp returned an unexpected local staging path"}
    }
    let path = ($directory | path join "remote-auth-gdm-ingest.pub")
    try {
        $parsed.normalized | save --raw $path
    } catch {|error|
        cleanup-local-key $directory
        error make {msg: $"failed to stage the normalized public key: ($error.msg? | default ($error | to text))"}
    }
    {directory: $directory, path: $path, normalized: $parsed.normalized, process: $temporary}
}

def remote-nu [program: string]: nothing -> record {
    let encoded = ($program | encode base64)
    let inner = ('let code = ("__ENCODED__" | decode base64 | decode utf-8); ^__NU__ --no-config-file -c $code' | str replace "__ENCODED__" $encoded | str replace "__NU__" $remote_nu)
    let command = $"($remote_nu) --no-config-file -c '($inner)'"
    ^/usr/bin/ssh ...$ssh_options -l $fixed_user -- $fixed_host $command | complete
}

def remote-preflight []: nothing -> record {
    mut attempts = []
    for attempt in 1..3 {
        let process = (remote-nu $remote_preflight_program)
        $attempts = ($attempts | append $process)
        if $process.exit_code == 0 { break }
        if $attempt < 3 { sleep 200ms }
    }
    let readiness = (decode-readiness-results $attempts)
    {
        attempts: $attempts
        attempt_count: $readiness.attempt_count
        state: (decode-preflight-output $readiness.process.stdout)
    }
}

def remote-cleanup []: nothing -> record<process: record, status: string, error: string> {
    let process = (remote-nu $remote_cleanup_program)
    let cleanup: record<status: string, error: string> = try {
        let completed = (decode-process-result "Remote staging cleanup" $process)
        decode-cleanup-output $completed.stdout | ignore
        {status: "complete", error: ""}
    } catch {|error|
        {status: "failed", error: ($error.msg? | default ($error | to text))}
    }
    {
        process: $process
        status: $cleanup.status
        error: $cleanup.error
    }
}

def orchestration-error [message: string, transaction: record] {
    error make {
        msg: $message
        help: $"Transaction audit: ($transaction | to json --raw)"
    }
}

def install-release [inventory: record, initial_transaction: record]: nothing -> record {
    mut transaction = $initial_transaction
    mut key = {directory: "", path: "", normalized: "", process: {stdout: "", stderr: "", exit_code: 0}}
    mut key_created = false
    mut remote_attempted = false

    let outcome: record<status: string, staged: any, error: string> = try {
        $key = (public-key)
        $key_created = true
        $transaction = ($transaction
            | update recovery.local_temporary_cleanup "pending"
            | observe-process {
                step: "create-local-key-staging"
                argv: ["/usr/bin/mktemp" "-d" "<fixed-temporary-template>"]
                scope: "local-temporary"
            } $key.process)

        $remote_attempted = true
        let preflight = (remote-preflight)
        for attempt in ($preflight.attempts | enumerate) {
            $transaction = ($transaction | observe-process {
                step: "remote-preflight"
                attempt: ($attempt.index + 1)
                argv: ["/usr/bin/ssh" "<fixed-options>" $"($fixed_user)@($fixed_host)" "<base64-encoded-fixed-nu-program>"]
                scope: "remote-staging"
            } $attempt.item)
        }
        $transaction = ($transaction | update recovery.remote_staging_cleanup "pending")

        let ssh_transport = "/usr/bin/ssh -x -o ForwardX11=no -o BatchMode=yes -o ConnectTimeout=5 -o ServerAliveInterval=5 -o ServerAliveCountMax=2"
        let source_result = (^/usr/bin/rsync -a --delete --exclude target/ --exclude identity/ --exclude ".DS_Store" --exclude "*/.DS_Store" --chmod=Du=rwx,Dgo=,Fu=rw,Fgo= -e $ssh_transport -- $"($local_ubuntu_root)/" $"($fixed_user)@($fixed_host):($remote_source)/" | complete)
        $transaction = ($transaction | observe-process {
            step: "transfer-reviewed-source"
            argv: ["/usr/bin/rsync" "<fixed-owner-only-source-transfer>"]
            scope: "remote-staging"
        } $source_result)
        decode-process-result "Transfer reviewed Ubuntu source" $source_result | ignore

        let key_result = (^/usr/bin/rsync -a --chmod=Fu=rw,Fgo= -e $ssh_transport -- $key.path $"($fixed_user)@($fixed_host):($remote_source)/identity/remote-auth-gdm-ingest.pub" | complete)
        $transaction = ($transaction | observe-process {
            step: "transfer-comment-free-public-key"
            argv: ["/usr/bin/rsync" "<fixed-owner-only-key-transfer>"]
            scope: "remote-staging"
        } $key_result)
        decode-process-result "Transfer normalized ingestion identity" $key_result | ignore

        let audit_process = (remote-nu $remote_audit_program)
        $transaction = ($transaction | observe-process {
            step: "audit-remote-transfer"
            argv: ["/usr/bin/ssh" "<fixed-options>" $"($fixed_user)@($fixed_host)" "<base64-encoded-fixed-nu-program>"]
            scope: "remote-staging"
        } $audit_process)
        let audit_output = (decode-process-result "Audit remote transfer" $audit_process).stdout
        let audit = (decode-transfer-state $audit_output)

        let stage_process = (^/usr/bin/ssh ...$ssh_options -l $fixed_user -- $fixed_host /bin/bash $remote_stage | complete)
        $transaction = ($transaction | observe-process {
            step: "build-staged-release"
            argv: ["/usr/bin/ssh" "<fixed-options>" $"($fixed_user)@($fixed_host)" "/bin/bash" $remote_stage]
            scope: "remote-staging-to-durable-leaf"
        } $stage_process)
        let stage_output = (decode-process-result "Build staged GDM release" $stage_process).stdout
        let stage = (decode-stage-output $stage_output)
        {
            status: "staged"
            staged: {preflight: $preflight.state, transfer: $audit, stage: $stage}
            error: ""
        }
    } catch {|error|
        {
            status: "failed"
            staged: null
            error: ($error.msg? | default ($error | to text))
        }
    }

    let remote_cleanup = if $remote_attempted {
        remote-cleanup
    } else {
        {
            process: {stdout: "", stderr: "", exit_code: 0}
            status: "not-required"
            error: ""
        }
    }
    if $remote_attempted {
        $transaction = ($transaction | observe-process {
            step: "cleanup-remote-staging"
            argv: ["/usr/bin/ssh" "<fixed-options>" $"($fixed_user)@($fixed_host)" "<base64-encoded-fixed-nu-program>"]
            scope: "remote-staging"
        } $remote_cleanup.process)
    }
    let remote_recovery = match $remote_cleanup.status {
        "complete" => {state: "complete", errors: []}
        "failed" => {state: "failed", errors: [$remote_cleanup.error]}
        "not-required" => {state: "not-required", errors: []}
        _ => {state: "failed", errors: ["remote cleanup returned an unknown recovery state"]}
    }
    $transaction = ($transaction | update recovery.remote_staging_cleanup $remote_recovery.state)

    let local_cleanup: record<status: string, error: string> = if $key_created {
        try {
            cleanup-local-key $key.directory
            {status: "complete", error: ""}
        } catch {|error|
            {status: "failed", error: ($error.msg? | default ($error | to text))}
        }
    } else {
        {status: "not-required", error: ""}
    }
    let local_recovery = match $local_cleanup.status {
        "complete" => {state: "complete", errors: []}
        "failed" => {state: "failed", errors: [$local_cleanup.error]}
        "not-required" => {state: "not-required", errors: []}
        _ => {state: "failed", errors: ["local cleanup returned an unknown recovery state"]}
    }
    $transaction = ($transaction | update recovery.local_temporary_cleanup $local_recovery.state)
    let cleanup_errors = ($remote_recovery.errors | append $local_recovery.errors)

    if not ($cleanup_errors | is-empty) {
        let prior = if $outcome.status == "failed" { $"($outcome.error); " } else { "" }
        orchestration-error $"($prior)cleanup failed: ($cleanup_errors | str join '; ')" $transaction
    }
    match $outcome.status {
        "failed" => { orchestration-error $outcome.error $transaction }
        "staged" => {}
        _ => { orchestration-error "install preparation returned an unknown state" $transaction }
    }

    let staged = $outcome.staged
    let helper_argv = [$touch_id_helper "--install-gdm-release" $staged.stage.staged_release_sha256]
    let helper_process = (^$touch_id_helper --install-gdm-release $staged.stage.staged_release_sha256 | complete)
    $transaction = ($transaction | observe-process {
        step: "install-authenticated-release"
        argv: $helper_argv
        scope: "fixed-authenticated-leaf"
    } $helper_process)
    let helper_transaction = $transaction
    let helper = try {
        decode-process-result "Install authenticated GDM release" $helper_process
    } catch {|error|
        orchestration-error ($error.msg? | default ($error | to text)) $helper_transaction
    }
    {
        component: $component
        action: "install"
        release_sha256: $staged.stage.staged_release_sha256
        source: $inventory
        preflight: $staged.preflight
        transfer: $staged.transfer
        helper: $helper
        transaction: $transaction
    }
}
def decode-json [label: string, text: string, expected: list<string>]: nothing -> record {
    let parsed = try { $text | from json } catch { decoder-error $"($label) returned malformed JSON" $text "Expected one closed JSON object." }
    if ($parsed | describe) !~ "^record" or not (exact-columns $parsed $expected) {
        decoder-error $"($label) returned an unexpected closed record" $text $"Expected exactly: ($expected | str join ', ')." 
    }
    $parsed
}

def decode-public-export [text: string]: nothing -> record {
    let parsed = (decode-json "Ubuntu public export" $text ["schemaVersion" "generationId" "ubuntuReleaseDigest" "sshHostKeyDigest" "recipientKeyId" "recipientPublicKey" "subjectUsername" "subjectUid" "gdmIngestUid" "gdmIngestGid"])
    if $parsed.schemaVersion != 1 or $parsed.subjectUsername != "arthur" or not ($parsed.ubuntuReleaseDigest =~ "^[0-9a-f]{64}$") or not ($parsed.sshHostKeyDigest =~ "^[0-9a-f]{64}$") {
        decoder-error "Ubuntu public export has invalid identity metadata" $text "The fixed verifier export must be schema 1, arthur-owned, and digest-bound."
    }
    $parsed
}

def decode-bootstrap-output [text: string]: nothing -> record {
    let parsed = (decode-json "Mac GDM bootstrap" $text ["operation" "status" "cloudBootstrap" "policyDigest" "bundleDigest" "ubuntuReleaseDigest" "macReleaseDigest" "gdmSigningKeyId" "preparedPolicyPath" "activationBundlePath" "deviceId"])
    if $parsed.operation != "gdm-bootstrap-cloud" or $parsed.status != "prepared" or not ($parsed.policyDigest =~ "^[0-9a-f]{64}$") or not ($parsed.bundleDigest =~ "^[0-9a-f]{64}$") or not ($parsed.ubuntuReleaseDigest =~ "^[0-9a-f]{64}$") or not ($parsed.macReleaseDigest =~ "^[0-9a-f]{64}$") or $parsed.activationBundlePath != $local_bundle {
        decoder-error "Mac GDM bootstrap returned an invalid prepared state" $text "The generated bundle and digests must be fixed, lowercase, and owner-only."
    }
    $parsed
}

def decode-mac-status [text: string]: nothing -> record {
    decode-json "Mac GDM status" $text ["bundleDigest" "gdmSigningKeyId" "macReleaseDigest" "policyDigest" "schemaVersion" "state" "ubuntuReleaseDigest"]
}

def decode-verifier-status [text: string]: nothing -> record {
    let parsed = (decode-json "Ubuntu GDM verifier status" $text ["bundleDigest" "gdmSigningKeyId" "macReleaseDigest" "policyDigest" "schemaVersion" "state" "ubuntuReleaseDigest"])
    if $parsed.schemaVersion != 1 or $parsed.state not-in ["installed" "prepared" "active" "drift"] {
        decoder-error "Ubuntu GDM verifier status has an invalid state" $text "Status must report the actual fixed verifier state."
    }
    $parsed
}

def decode-deploy-status [text: string]: nothing -> record {
    mut fields = {}
    for line in ($text | lines | where {|value| not ($value | is-empty) }) {
        let parsed = ($line | parse --regex '^(?<key>[a-z0-9_]+)=(?<value>[^=]*)$')
        if ($parsed | length) != 1 { decoder-error "Ubuntu deploy status is malformed" $text "Expected closed key=value metadata." }
        let row = ($parsed | first)
        if $row.key in ($fields | columns) { decoder-error "Ubuntu deploy status has duplicate metadata" $text "Each deployment field must appear once." }
        $fields = ($fields | insert $row.key $row.value)
    }
    if not (exact-columns $fields ["component" "release_sha256" "deployment" "policy" "pam" "daemon" "ssh_ingest" "ingest_socket" "claim_socket"]) {
        decoder-error "Ubuntu deploy status is missing integrity fields" $text "The fixed deploy status must include every integrity field."
    }
    if $fields.component != $component or not ($fields.release_sha256 =~ "^[0-9a-f]{64}$") {
        decoder-error "Ubuntu deploy status has invalid release metadata" $text "The deployment digest must be lowercase SHA-256."
    }
    $fields
}

def run-helper [flag: string, reason: string, transaction: record]: nothing -> record {
    let argv = [$touch_id_helper $flag]
    let process = (^$touch_id_helper $flag | complete)
    let next = ($transaction | observe-process {step: $"helper-($flag | str trim --left --char '-')" argv: $argv scope: "fixed-root-action"} $process)
    let completed = (decode-process-result $"Fixed helper ($flag)" $process)
    {process: $completed, transaction: $next}
}

def run-cli [argv: list<string>, transaction: record]: nothing -> record {
    let process = (^$local_cli ...$argv | complete)
    let next = ($transaction | observe-process {step: "mac-generated-gdm-cli", argv: ($argv | prepend $local_cli), scope: "local-authenticated-cli"} $process)
    let completed = (decode-process-result "Mac generated GDM CLI" $process)
    {process: $completed, transaction: $next}
}

def transfer-bundle [transaction: record]: nothing -> record {
    require-fixed-file $local_bundle "Generated GDM activation bundle"
    let digest_process = (^/usr/bin/shasum -a 256 -- $local_bundle | complete)
    let digest = (parse-sha-output (decode-process-result "Hash generated activation bundle" $digest_process).stdout $local_bundle).digest
    let transport = "/usr/bin/ssh -x -o ForwardX11=no -o BatchMode=yes -o ConnectTimeout=5 -o ServerAliveInterval=5 -o ServerAliveCountMax=2"
    let process = (^/usr/bin/rsync -a --chmod=Fu=rw,Fgo= -e $transport -- $local_bundle $"($fixed_user)@($fixed_host):($remote_activation_bundle)" | complete)
    let next = ($transaction | observe-process {step: "transfer-generated-activation-bundle" argv: ["/usr/bin/rsync" "<fixed-owner-only-activation-bundle>"] scope: "remote-activation"} $process)
    decode-process-result "Transfer generated activation bundle" $process | ignore
    {digest: $digest, transaction: $next}
}

def prepare-gdm [inventory: record, initial_transaction: record]: nothing -> record {
    let installed = (install-release $inventory $initial_transaction)
    let install_tx = $installed.transaction
    let exported = (run-helper "--export-gdm-public" "Export Ubuntu verifier metadata" $install_tx)
    let export = (decode-public-export $exported.process.stdout)
    let temp = ((^/usr/bin/mktemp -d $"((local-temporary-root))/remote-auth-gdm.XXXXXXXX" | complete).stdout | str trim)
    let input = ($temp | path join "ubuntu-export.json")
    try {
        $exported.process.stdout | save --raw $input
        chmod 600 $input
        require-fixed-file $local_cli "Installed Mac GDM CLI"
        let cli = (run-cli ["gdm" "bootstrap-cloud" "--ubuntu-export" $input "--endpoint" $"ssh://($fixed_user)@($fixed_host)" "--approve-observed-attestation"] $exported.transaction)
        let metadata = (decode-bootstrap-output $cli.process.stdout)
        let transferred = (transfer-bundle $cli.transaction)
        rm --recursive $temp
        {
            component: $component
            action: "prepare"
            status: "prepared"
            release_sha256: $installed.release_sha256
            policy_digest: $metadata.policyDigest
            bundle_digest: $metadata.bundleDigest
            ubuntu_release_digest: $metadata.ubuntuReleaseDigest
            mac_release_digest: $metadata.macReleaseDigest
            activation_bundle_sha256: $transferred.digest
            transaction: $transferred.transaction
        }
    } catch {|error|
        if ($temp | path exists) { rm --recursive $temp }
        orchestration-error ($error.msg? | default ($error | to text)) $exported.transaction
    }
}

def activate-gdm [initial_transaction: record]: nothing -> record {
    let root = (run-helper "--activate-gdm" "Activate fixed Ubuntu GDM verifier" $initial_transaction)
    try {
        let mac = (run-cli ["gdm" "activate"] $root.transaction)
        let result = (decode-mac-status $mac.process.stdout)
        {
            component: $component
            action: "activate"
            status: "active"
            ubuntu: $root.process.stdout
            mac: $result
            transaction: $mac.transaction
        }
    } catch {|error|
        let compensated = try { run-helper "--deactivate-gdm" "Compensate failed Mac GDM activation" $root.transaction } catch {|_| null }
        let audit = if $compensated == null { $root.transaction } else { $compensated.transaction }
        orchestration-error $"Mac activation failed; Ubuntu deactivation compensation attempted: (($error.msg?) | default ($error | to text))" $audit
    }
}

def deactivate-gdm [initial_transaction: record]: nothing -> record {
    let mac = (run-cli ["gdm" "deactivate"] $initial_transaction)
    let mac_result = (decode-mac-status $mac.process.stdout)
    let root = (run-helper "--deactivate-gdm" "Deactivate fixed Ubuntu GDM verifier" $mac.transaction)
    {
        component: $component
        action: "deactivate"
        status: "inactive"
        ubuntu: $root.process.stdout
        mac: $mac_result
        transaction: $root.transaction
    }
}

def status-gdm [initial_transaction: record]: nothing -> record {
    let deploy = (run-helper "--status-gdm-deploy" "Inspect fixed Ubuntu deployment integrity" $initial_transaction)
    let verifier = (run-helper "--status-gdm" "Inspect fixed Ubuntu GDM verifier status" $deploy.transaction)
    let mac = (run-cli ["gdm" "status"] $verifier.transaction)
    {
        component: $component
        action: "status"
        status: "observed"
        deployment: (decode-deploy-status $deploy.process.stdout)
        ubuntu: (decode-verifier-status $verifier.process.stdout)
        mac: (decode-mac-status $mac.process.stdout)
        transaction: $mac.transaction
    }
}

def main [action: string, --dry-run]: nothing -> record {
    let action = (validate-action $action)
    mut transaction = (transaction-scope $action)
    let identity = (validate-local-owner)
    $transaction = ($transaction | observe-process {step: "validate-local-owner" argv: ["/usr/bin/id" "-un"] scope: "local-read-only"} $identity)
    let source = if $action == "prepare" { source-inventory } else { null }
    let inventory = if $source == null { null } else { $source.inventory }
    if $source != null {
        for hashed in $source.hash_processes {
            $transaction = ($transaction | observe-process {step: "hash-reviewed-source" argv: ["/usr/bin/shasum" "-a" "256" "--" ($local_ubuntu_root | path join $hashed.path)] scope: "local-read-only"} $hashed.process)
        }
    }
    if $dry_run {
        return {
            component: $component
            action: $action
            dry_run: true
            mutation: "none"
            network: "none"
            helper_invocations: 0
            fixed_target: {host: $fixed_host, user: $fixed_user}
            source: $inventory
            leaf_contract: $leaf_contract
            transaction: $transaction
            planned_root_actions: (match $action {
                "prepare" => ["install-authenticated-digest" "export-gdm-public" "transfer-activation-bundle"]
                "activate" => ["activate-gdm" "mac-gdm-activate"]
                "deactivate" => ["mac-gdm-deactivate" "deactivate-gdm"]
                "status" => ["status-gdm-deploy" "status-gdm" "mac-gdm-status"]
            })
        }
    }
    return (match $action {
        "prepare" => (prepare-gdm $inventory $transaction)
        "activate" => (activate-gdm $transaction)
        "deactivate" => (deactivate-gdm $transaction)
        "status" => (status-gdm $transaction)
    })
}
