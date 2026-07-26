#!/usr/bin/env -S nu --no-config-file

const default_workspace = "desktop-agents"
const local_manifest = "../catalog/remote-workspaces.yml"
const no_stream = "__workspace__"
const ssh_options = [
    -x
    -o BatchMode=yes
    -o ConnectTimeout=10
    -o ForwardX11=no
    -o ForwardX11Trusted=no
    -o ServerAliveInterval=15
    -o ServerAliveCountMax=3
]

# This runner accepts only catalog-backed identifiers and fixed actions.
def valid-id [value: string, label: string] {
    if not ($value =~ '^[a-z][a-z0-9-]*$') {
        error make {msg: $"Invalid ($label): ($value)"}
    }
}

def review-local-alias [capability: record, stream_name: string, alias_suffix: string] {
    let suffix = if $alias_suffix == $stream_name { $stream_name } else { $"($stream_name)-($alias_suffix)" }
    let alias = $"($capability.aliasPrefix)-($suffix)"
    valid-id $alias "local review alias"
    $alias
}

def valid-root [root: string, user: string] {
    let home = $"/home/($user)"
    if not ($root =~ '^/home/[a-z][a-z0-9_-]*/[A-Za-z0-9._/-]+$') or not ($root | str starts-with $"($home)/") or ($root | str contains "..") or $root == $home {
        error make {msg: $"Unsafe remote workspace root: ($root)"}
    }
}

def valid-relative-path [value: string, label: string] {
    if ($value | is-empty) or ($value | str starts-with "/") or ($value | str ends-with "/") or not ($value =~ '^[A-Za-z0-9._-]+(?:/[A-Za-z0-9._-]+)*$') or ($value | path split | any {|part| $part in ["." ".."] }) {
        error make {msg: $"Unsafe ($label): ($value)"}
    }
}
def valid-routing-config [stream_name: string, value: string] {
    let expected = $".omp/($stream_name)-config.yml"
    if $value != $expected {
        error make {msg: $"Routing actions require the exact stream config ($expected), got ($value)"}
    }
}

def valid-lane-root [value: string, workspace: record, label: string] {
    valid-root $value $workspace.user
    if ($value | str starts-with $"($workspace.root)/") or $value == $workspace.root {
        error make {msg: $"($label) must be outside the canonical workspace root: ($value)"}
    }
}

def resolve-workspace-config [catalog: record, workspace_name: string] {
    if $workspace_name not-in ($catalog.workspaces | columns) {
        error make {msg: $"Unknown workspace: ($workspace_name)"}
    }
    let raw = ($catalog.workspaces | get $workspace_name)
    let base_name = ($raw.extends? | default null)
    if $base_name == null { return $raw }
    valid-id $base_name "base workspace"
    if $base_name == $workspace_name or $base_name not-in ($catalog.workspaces | columns) {
        error make {msg: $"Invalid base workspace for ($workspace_name): ($base_name)"}
    }
    let base = ($catalog.workspaces | get $base_name)
    if ($base.extends? | default null) != null {
        error make {msg: $"Nested workspace inheritance is not supported: ($workspace_name)"}
    }
    $base | merge ($raw | reject extends)
}

def validate-catalog [catalog: record] {
    if ($catalog.version? | default 0) != 1 { error make {msg: "Unsupported remote workspace catalog version"} }
    if ($catalog.workspaces? | describe) !~ '^record' { error make {msg: "Catalog workspaces must be a record"} }
    let lane_shared_paths = ($catalog.shared.laneSharedPaths? | default null)
    if (($lane_shared_paths | describe) !~ '^list') or ($lane_shared_paths | is-empty) {
        error make {msg: "shared.laneSharedPaths must be a non-empty list"}
    }
    for lane_path in $lane_shared_paths { valid-relative-path $lane_path "shared lane path" }

    mut local_ports = []
    mut local_aliases = []
    for workspace_name in ($catalog.workspaces | columns) {
        valid-id $workspace_name "workspace"
        let workspace = (resolve-workspace-config $catalog $workspace_name)
        let declared_capabilities = (($catalog.workspaces | get $workspace_name).capabilities? | default {})
        let declared_profile = ($declared_capabilities.healthProfile? | default null)
        if $declared_profile not-in ["workstation-maintenance" "unprivileged-server"] {
            error make {msg: $"healthProfile must be workstation-maintenance or unprivileged-server for ($workspace_name)"}
        }
        let health_profile = $workspace.capabilities.healthProfile
        if $health_profile == "unprivileged-server" {
            let health = ($workspace.health? | default null)
            if ($health | describe) !~ '^record' {
                error make {msg: $"health must be a record for unprivileged-server workspace ($workspace_name)"}
            }
            if not ($health.machineId =~ '^[0-9a-f]{32}$') {
                error make {msg: $"Invalid health.machineId for ($workspace_name)"}
            }
            if not ($health.hostKeyFingerprint =~ '^SHA256:[A-Za-z0-9+/=]+$') {
                error make {msg: $"Invalid health.hostKeyFingerprint for ($workspace_name)"}
            }
            if ($health.operatingSystem? | describe) != "string" or ($health.operatingSystem | is-empty) {
                error make {msg: $"Invalid health.operatingSystem for ($workspace_name)"}
            }
            if ($health.architecture? | describe) != "string" or not ($health.architecture =~ '^[A-Za-z0-9_-]+$') {
                error make {msg: $"Invalid health.architecture for ($workspace_name)"}
            }
            if ($health.minimumDiskAvailableKiB? | describe) != "int" or $health.minimumDiskAvailableKiB < 1048576 {
                error make {msg: $"Invalid health.minimumDiskAvailableKiB for ($workspace_name)"}
            }
        }
        valid-id $workspace.host "host"
        let capabilities = ($workspace.capabilities? | default null)
        if ($capabilities | describe) !~ '^record' { error make {msg: $"capabilities must be a record for ($workspace_name)"} }
        let platforms = ($capabilities.platforms? | default null)
        if (($platforms | describe) !~ '^list') or ($platforms | is-empty) {
            error make {msg: $"capabilities.platforms must be a non-empty list for ($workspace_name)"}
        }
        for platform in $platforms { valid-id $platform $"platform capability for ($workspace_name)" }
        if ($capabilities.remoteWorkspace? | describe) != "bool" {
            error make {msg: $"capabilities.remoteWorkspace must be a boolean for ($workspace_name)"}
        }
        let review_forwarding = ($capabilities.reviewForwarding? | default null)
        if ($review_forwarding | describe) !~ '^record' {
            error make {msg: $"capabilities.reviewForwarding must be a record for ($workspace_name)"}
        }
        if ($review_forwarding.enabled? | describe) != "bool" {
            error make {msg: $"reviewForwarding.enabled must be a boolean for ($workspace_name)"}
        }
        valid-id $review_forwarding.aliasPrefix $"review alias prefix for ($workspace_name)"
        if ($review_forwarding.localPortOffset? | describe) != "int" or $review_forwarding.localPortOffset < 0 or $review_forwarding.localPortOffset > 40000 {
            error make {msg: $"Invalid reviewForwarding.localPortOffset for ($workspace_name)"}
        }
        let lane_only = ($workspace.laneOnly? | default false)
        if not ($workspace.user =~ '^[a-z][a-z0-9_-]*$') { error make {msg: $"Invalid user for ($workspace_name)"} }
        valid-root $workspace.root $workspace.user
        for absolute_path in [$workspace.remoteNu $workspace.remoteRunner $workspace.remoteManifest $workspace.bun $workspace.omp] {
            if not ($absolute_path =~ '^/[A-Za-z0-9._/-]+$') or ($absolute_path | str contains "..") {
                error make {msg: $"Unsafe remote executable path: ($absolute_path)"}
            }
        }
        let routing_roots = ($workspace.routingRoots? | default {})
        if ($routing_roots | describe) !~ '^record' {
            error make {msg: $"routingRoots must be a record for ($workspace_name)"}
        }
        for routing_stream in ($routing_roots | columns) {
            valid-id $routing_stream $"routing root stream for ($workspace_name)"
            if $routing_stream not-in ($workspace.streams | columns) {
                error make {msg: $"Unknown routing root stream for ($workspace_name): ($routing_stream)"}
            }
            valid-root ($routing_roots | get $routing_stream) $workspace.user
        }
        let lane_root = ($workspace.laneRoot? | default null)
        if $lane_root != null {
            valid-lane-root $lane_root $workspace "laneRoot"
            valid-lane-root $workspace.laneBundleRoot $workspace "laneBundleRoot"
            valid-lane-root ($workspace.laneManifest | path dirname) $workspace "laneManifest parent"
            for cache_root in $workspace.sharedCacheRoots {
                valid-lane-root $cache_root $workspace "shared cache root"
            }
            if ($workspace.laneStreams? | describe) !~ '^record' {
                error make {msg: $"laneStreams must be a record for ($workspace_name)"}
            }
            for lane_stream_name in ($workspace.laneStreams | columns) {
                if $lane_stream_name not-in ($workspace.streams | columns) {
                    error make {msg: $"Unknown lane stream for ($workspace_name): ($lane_stream_name)"}
                }
                let owned_roots = ($workspace.laneStreams | get $lane_stream_name | get ownedRoots)
                if (($owned_roots | describe) !~ '^list') or ($owned_roots | is-empty) {
                    error make {msg: $"Lane ownedRoots must be a non-empty list for ($lane_stream_name)"}
                }
                for lane_path in $owned_roots { valid-relative-path $lane_path $"lane owned root for ($lane_stream_name)" }
            }
        }
        if $workspace.bunChannel not-in ["canary" "stable"] { error make {msg: $"Invalid Bun channel for ($workspace_name)"} }
        if $workspace.bunMinimumMajor < 1 or $workspace.bunMinimumMinor < 0 { error make {msg: $"Invalid Bun minimum for ($workspace_name)"} }
        let rust_toolchain = ($workspace.rustToolchain? | default null)
        if (($rust_toolchain | describe) != "string") or not ($rust_toolchain =~ '^[A-Za-z0-9.-]+$') {
            error make {msg: $"Invalid Rust toolchain for ($workspace_name)"}
        }
        for stream_name in ($workspace.streams | columns) {
            valid-id $stream_name "stream"
            let stream = ($workspace.streams | get $stream_name)
            let omp_config = ($stream.ompConfig? | default null)
            let canonical_omp_config = $".omp/($stream_name)-config.yml"
            let allowed_harness_config = $stream_name == "harness" and $omp_config == ".omp/desktop-config.yml"
            if (($omp_config | describe) != "string") or ($omp_config != $canonical_omp_config and not $allowed_harness_config) {
                error make {msg: $"Invalid ompConfig for ($workspace_name)/($stream_name): ($omp_config)"}
            }
            let setup_dirs = ($stream.setupDirs? | default null)
            if (($setup_dirs | describe) !~ '^list') or ($setup_dirs | is-empty) {
                error make {msg: $"setupDirs must be a non-empty list for ($stream_name)"}
            }
            for setup_dir in $setup_dirs {
                if (($setup_dir | describe) != "string") or ($setup_dir | is-empty) or ($setup_dir | str starts-with "/") or ($setup_dir | str ends-with "/") or not ($setup_dir =~ '^[A-Za-z0-9._-]+(?:/[A-Za-z0-9._-]+)*$') or ($setup_dir | path split | any {|part| $part in ["." ".."] }) {
                    error make {msg: $"Unsafe setup directory for ($stream_name): ($setup_dir)"}
                }
            }
            let error_log = ($stream.errorLog? | default null)
            if $error_log != null {
                if (($error_log | describe) != "string") or ($error_log | is-empty) or ($error_log | str starts-with "/") or ($error_log | str ends-with "/") or not ($error_log =~ '^[A-Za-z0-9._-]+(?:/[A-Za-z0-9._-]+)*$') or ($error_log | path split | any {|part| $part in ["." ".."] }) {
                    error make {msg: $"Unsafe error log path for ($stream_name): ($error_log)"}
                }
            }
            let services_enabled = ($stream.servicesEnabled? | default null)
            if ($services_enabled | describe) != "bool" {
                error make {msg: $"servicesEnabled must be a boolean for ($stream_name)"}
            }
            let blocked_reason = ($stream.servicesBlockedReason? | default null)
            if $services_enabled and $blocked_reason != null {
                error make {msg: $"servicesBlockedReason is only valid when services are disabled for ($stream_name)"}
            }
            if not $services_enabled and ((($blocked_reason | describe) != "string") or ($blocked_reason | str trim | is-empty)) {
                error make {msg: $"Disabled services require servicesBlockedReason for ($stream_name)"}
            }
            for source_path in ([$stream.ompConfig] | append $stream.promptRefs) {
                if not ($source_path =~ '^[A-Za-z0-9._/-]+$') or ($source_path | str contains "..") or ($source_path | str starts-with "/") {
                    error make {msg: $"Unsafe catalog source path: ($source_path)"}
                }
            }
            let review_targets = ($stream.review? | default null)
            if ($review_targets | describe) !~ '^(list|table)' { error make {msg: $"review must be a list for ($stream_name)"} }
            let review_workspace = ($stream.reviewWorkspace? | default null)
            if not ($review_workspace =~ '^workspace:[1-9][0-9]*$') {
                error make {msg: $"Invalid reviewWorkspace for ($stream_name): ($review_workspace)"}
            }
            for target in $review_targets {
                valid-id $target.name "review target"
                valid-id $target.aliasSuffix "local review alias suffix"
                if $target.kind not-in ["direct" "portless"] { error make {msg: $"Invalid review kind for ($target.name)"} }
                let effective_port = ($target.localPort + $review_forwarding.localPortOffset)
                if $effective_port < 1024 or $effective_port > 65535 { error make {msg: $"Invalid effective local review port for ($target.name)"} }
                if $review_forwarding.enabled {
                    $local_ports = ($local_ports | append $effective_port)
                    $local_aliases = ($local_aliases | append (review-local-alias $review_forwarding $stream_name $target.aliasSuffix))
                }
                if $target.kind == "direct" and (($target.remotePort? | default 0) < 1 or $target.remotePort > 65535) {
                    error make {msg: $"Invalid remote review port for ($target.name)"}
                }
                if $target.kind == "portless" { valid-id $target.route "portless route" }
            }
        }
    }
    if ($local_ports | uniq | length) != ($local_ports | length) {
        error make {msg: "Effective review local ports must be unique across the catalog"}
    }
    if ($local_aliases | uniq | length) != ($local_aliases | length) {
        error make {msg: "Effective review aliases must be unique across the catalog"}
    }
}

def load-catalog [path: string] {
    if not ($path | path exists) { error make {msg: $"Remote workspace catalog not found: ($path)"} }
    let catalog = (open $path)
    validate-catalog $catalog
    $catalog
}

def select-workspace [catalog: record, workspace_name: string] {
    valid-id $workspace_name "workspace"
    resolve-workspace-config $catalog $workspace_name
}

def select-stream [workspace: record, stream_name: string] {
    valid-id $stream_name "stream"
    if $stream_name not-in ($workspace.streams | columns) {
        error make {msg: $"Unknown stream: ($stream_name)"}
    }
    $workspace.streams | get $stream_name
}

def target [workspace: record] { $"($workspace.user)@($workspace.host)" }

export def checked-external [label: string, command: closure, --stream] {
    if $stream {
        do $command
        let exit_code = $env.LAST_EXIT_CODE
        if $exit_code != 0 {
            error make {msg: $"($label) failed with exit code ($exit_code)"}
        }
        return
    }

    let result = (do $command | complete)
    if $result.exit_code != 0 {
        let detail = ($result.stderr | str trim)
        let suffix = if ($detail | is-empty) { "" } else { $": ($detail)" }
        error make {msg: $"($label) failed with exit code ($result.exit_code)($suffix)"}
    }
    $result.stdout
}

def resolve-portless [root: string] {
    do {
        cd $root
        let node = (checked-external "Resolve mise Node executable" { ^mise which node } | str trim)
        let portless = (checked-external "Resolve mise Portless script" { ^mise which portless } | str trim)
        {node: $node, portless: $portless}
    }
}

def local-portless-runtime [] {
    resolve-portless ($env.FILE_PWD | path dirname)
}

def install-runner [workspace: record, manifest_path: string] {
    let destination = (target $workspace)
    let runner_dir = ($workspace.remoteRunner | path dirname)
    let manifest_dir = ($workspace.remoteManifest | path dirname)
    checked-external "Create remote runner directories" { ^ssh ...$ssh_options $destination mkdir -p $runner_dir $manifest_dir } | ignore
    checked-external "Install remote workspace runner" { ^rsync -a $"($env.FILE_PWD)/remote-workspace.nu" $"($destination):($workspace.remoteRunner)" } | ignore
    checked-external "Install remote workspace manifest" { ^rsync -a $manifest_path $"($destination):($workspace.remoteManifest)" } | ignore
}

# No arbitrary command text crosses SSH: action names and arguments are catalog validated.
def remote-action [workspace: record, workspace_name: string, action: string, stream_name: string, manifest_path: string, --stream-output] {
    install-runner $workspace $manifest_path
    let destination = (target $workspace)
    let remote_nu = $workspace.remoteNu
    let remote_runner = $workspace.remoteRunner
    let remote_manifest = $workspace.remoteManifest
    if $stream_output {
        if $stream_name == $no_stream {
            checked-external --stream "Remote workspace action ($action)" { ^ssh ...$ssh_options $destination $remote_nu --no-config-file $remote_runner $action --workspace $workspace_name --catalog $remote_manifest }
        } else {
            checked-external --stream "Remote workspace action ($action)" { ^ssh ...$ssh_options $destination $remote_nu --no-config-file $remote_runner $action $stream_name --workspace $workspace_name --catalog $remote_manifest }
        }
        return
    }
    if $stream_name == $no_stream {
        checked-external "Remote workspace action ($action)" { ^ssh ...$ssh_options $destination $remote_nu --no-config-file $remote_runner $action --workspace $workspace_name --catalog $remote_manifest }
    } else {
        checked-external "Remote workspace action ($action)" { ^ssh ...$ssh_options $destination $remote_nu --no-config-file $remote_runner $action $stream_name --workspace $workspace_name --catalog $remote_manifest }
    }
}

def remote-lane-action [workspace: record, workspace_name: string, action: string, arguments: list<string>, manifest_path: string] {
    install-runner $workspace $manifest_path
    let destination = (target $workspace)
    let remote_nu = $workspace.remoteNu
    let remote_runner = $workspace.remoteRunner
    let remote_manifest = $workspace.remoteManifest
    checked-external "Remote lane action ($action)" {
        ^ssh ...$ssh_options $destination $remote_nu --no-config-file $remote_runner $"_($action)" ...$arguments --workspace $workspace_name --catalog $remote_manifest
    }
}

def remote-attach [workspace: record, workspace_name: string, stream_name: string, manifest_path: string] {
    install-runner $workspace $manifest_path
    let destination = (target $workspace)
    let remote_nu = $workspace.remoteNu
    checked-external --stream "Remote workspace attach" { ^ssh -t ...$ssh_options $destination $remote_nu --no-config-file $workspace.remoteRunner _attach $stream_name --workspace $workspace_name --catalog $workspace.remoteManifest }
}

def probe-value [output: string, key: string] {
    let prefix = $"($key)="
    let matches = ($output | lines | where {|line| $line | str starts-with $prefix })
    if ($matches | length) != 1 {
        error make {msg: $"Unprivileged server health probe returned invalid ($key) evidence"}
    }
    $matches | first | split row "=" | skip 1 | str join "="
}

def unprivileged-server-doctor [workspace: record, workspace_name: string] {
    let destination = (target $workspace)
    let sqlite_roots = (
        [$workspace.root]
        | append ([$workspace.laneRoot? | default null] | where {|path| $path != null })
        | append ($workspace.sharedCacheRoots? | default [])
        | uniq
        | str join " "
    )
    let root_parent = ($workspace.root | path dirname)
    let probe = ([
        "set -eu"
        $"root='($workspace.root)'"
        $"root_parent='($root_parent)'"
        $"bun='($workspace.bun)'"
        $"remote_nu='($workspace.remoteNu)'"
        $"sqlite_roots='($sqlite_roots)'"
        "actual_user=$(id -un)"
        "hostname_value=$(hostname)"
        "machine_id=$(cat /etc/machine-id)"
        "os_value=$(uname -s)"
        "arch_value=$(uname -m)"
        'disk_available_kib=$(df -Pk "$root_parent" | awk "NR == 2 { print \$4 }")'
        "missing_tools=''"
        "for tool in git jj mise rustc cargo tmux rsync nu; do"
        '  if ! command -v "$tool" >/dev/null 2>&1; then'
        '    if test -n "$missing_tools"; then missing_tools="$missing_tools,$tool"; else missing_tools="$tool"; fi'
        "  fi"
        "done"
        'if test -x "$bun"; then bun_ready=true; bun_version=$("$bun" --version 2>/dev/null || true); else bun_ready=false; bun_version=""; fi'
        'if test -x "$remote_nu"; then remote_nu_ready=true; else remote_nu_ready=false; fi'
        'if test -d "$root"; then root_present=true; else root_present=false; fi'
        'if { test -d "$root" && test -w "$root"; } || { test ! -e "$root" && test -d "$root_parent" && test -w "$root_parent"; }; then root_ready=true; else root_ready=false; fi'
        "writable_sqlite=''"
        "for base in $sqlite_roots; do"
        '  if test -d "$base"; then'
        '    writable_sqlite=$(find "$base" -xdev \( -path "$base/.git" -o -path "$base/.jj" -o -path "$base/node_modules" -o -path "$base/target" \) -prune -o -type f -writable \( -name "*.sqlite" -o -name "*.sqlite3" -o -name "*.db" \) -print -quit)'
        '    if test -n "$writable_sqlite"; then break; fi'
        "  fi"
        "done"
        'printf "user=%s\nhostname=%s\nmachine_id=%s\nos=%s\narch=%s\ndisk_available_kib=%s\nmissing_tools=%s\nbun_ready=%s\nbun_version=%s\nremote_nu_ready=%s\nroot_present=%s\nroot_ready=%s\nwritable_sqlite=%s\n" "$actual_user" "$hostname_value" "$machine_id" "$os_value" "$arch_value" "$disk_available_kib" "$missing_tools" "$bun_ready" "$bun_version" "$remote_nu_ready" "$root_present" "$root_ready" "$writable_sqlite"'
    ] | str join "\n")
    let probe_result = (
        $probe
        | ^ssh -T -v ...$ssh_options
            -o ClearAllForwardings=yes
            -o ConnectionAttempts=1
            -o ControlMaster=no
            -o ControlPath=none
            -o ForwardAgent=no
            -o PermitLocalCommand=no
            -o StrictHostKeyChecking=yes
            -o UpdateHostKeys=no
            $destination /bin/sh -s
        | complete
    )
    if $probe_result.exit_code != 0 {
        print ({
            workspace: $workspace_name,
            profile: $workspace.capabilities.healthProfile,
            evidence: {destination: $destination, probe: "failed"}
        } | to json --indent 2)
        let detail = ($probe_result.stderr | str trim)
        error make {msg: $"Unprivileged server health probe failed with exit code ($probe_result.exit_code): ($detail)"}
    }

    let host_key_matches = (
        $probe_result.stderr
        | lines
        | parse -r 'Server host key: [^ ]+ (?<fingerprint>SHA256:[A-Za-z0-9+/=]+)'
    )
    let observed_host_key = if ($host_key_matches | is-empty) { "" } else { $host_key_matches | last | get fingerprint }
    let observed_user = (probe-value $probe_result.stdout "user")
    let observed_machine_id = (probe-value $probe_result.stdout "machine_id")
    let observed_os = (probe-value $probe_result.stdout "os")
    let observed_arch = (probe-value $probe_result.stdout "arch")
    let disk_available_kib = (try { probe-value $probe_result.stdout "disk_available_kib" | into int } catch { -1 })
    let missing_tools_value = (probe-value $probe_result.stdout "missing_tools")
    let missing_tools = if ($missing_tools_value | is-empty) { [] } else { $missing_tools_value | split row "," }
    let bun_executable = (probe-value $probe_result.stdout "bun_ready") == "true"
    let bun_version = (probe-value $probe_result.stdout "bun_version")
    let bun_runtime_ready = $bun_executable and ($bun_version =~ '^[0-9]+\.[0-9]+(?:\.[0-9]+)?(?:[-+].*)?$')
    let writable_sqlite = (probe-value $probe_result.stdout "writable_sqlite")
    let evidence = {
        destination: $destination,
        host_key_fingerprint: $observed_host_key,
        hostname: (probe-value $probe_result.stdout "hostname"),
        machine_id: $observed_machine_id,
        user: $observed_user,
        operating_system: $observed_os,
        architecture: $observed_arch,
        disk: {
            path: $root_parent,
            available_kib: $disk_available_kib,
            minimum_kib: $workspace.health.minimumDiskAvailableKiB
        },
        tools: {
            missing: $missing_tools,
            bun: $workspace.bun,
            bun_version: $bun_version,
            bun_ready: $bun_runtime_ready,
            remote_nu: $workspace.remoteNu,
            remote_nu_ready: ((probe-value $probe_result.stdout "remote_nu_ready") == "true")
        },
        root: {
            path: $workspace.root,
            present: ((probe-value $probe_result.stdout "root_present") == "true"),
            ready: ((probe-value $probe_result.stdout "root_ready") == "true")
        },
        writable_shared_live_sqlite: $writable_sqlite
    }
    print ({workspace: $workspace_name, profile: $workspace.capabilities.healthProfile, evidence: $evidence} | to json --indent 2)

    mut failures = []
    if $observed_host_key != $workspace.health.hostKeyFingerprint { $failures = ($failures | append "SSH host key fingerprint mismatch") }
    if $observed_machine_id != $workspace.health.machineId { $failures = ($failures | append "machine identity mismatch") }
    if $observed_user != $workspace.user { $failures = ($failures | append "remote user mismatch") }
    if $observed_os != $workspace.health.operatingSystem { $failures = ($failures | append "operating system mismatch") }
    if $observed_arch != $workspace.health.architecture { $failures = ($failures | append "architecture mismatch") }
    if $disk_available_kib < $workspace.health.minimumDiskAvailableKiB { $failures = ($failures | append "insufficient disk headroom") }
    if not ($missing_tools | is-empty) { $failures = ($failures | append $"missing remote tools: ($missing_tools | str join ', ')") }
    if not $bun_runtime_ready { $failures = ($failures | append "Bun runtime is missing or unusable") }
    if (probe-value $probe_result.stdout "remote_nu_ready") != "true" { $failures = ($failures | append "catalog remote Nu runtime is missing") }
    if (probe-value $probe_result.stdout "root_ready") != "true" { $failures = ($failures | append "remote workspace root is not ready") }
    if not ($writable_sqlite | is-empty) { $failures = ($failures | append $"writable shared/live SQLite detected: ($writable_sqlite)") }
    if not ($failures | is-empty) {
        error make {msg: $"Unprivileged server health check failed: ($failures | str join '; ')"}
    }
}

# Workstation maintenance invokes this after the privileged host gate.
def remote-doctor [workspace: record] {
    let required = [git jj mise rustc cargo tmux rsync nu]
    let missing = ($required | where {|tool| which $tool | is-empty })
    let bun_ready = ($workspace.bun | path exists)
    let root_present = ($workspace.root | path exists)
    let writable_base = (if $root_present { $workspace.root } else { $env.HOME })
    let root_writable = ((^test -w $writable_base | complete).exit_code == 0)
    let result = {
        host: (sys host | get hostname),
        root: $workspace.root,
        root_present: $root_present,
        root_ready: $root_writable,
        missing_tools: $missing,
        bun: $workspace.bun,
        bun_ready: $bun_ready,
        remote_nu: (which nu | first | get path)
    }
    $result | to json --indent 2
    if not ($missing | is-empty) { error make {msg: $"Missing remote tools: ($missing | str join ', ')"} }
    if not $bun_ready { error make {msg: $"Bun runtime is missing: ($workspace.bun)"} }
    if not $root_writable { error make {msg: "Remote workspace root is not ready"} }
}

def routing-root [workspace: record, stream_name: string] {
    let roots = ($workspace.routingRoots? | default {})
    $roots | get --optional $stream_name | default $workspace.root
}

def routing-file-paths [workspace: record, stream_name: string] {
    let stream = (select-stream $workspace $stream_name)
    valid-routing-config $stream_name $stream.ompConfig
    let root = (routing-root $workspace $stream_name)
    {
        root: $root
        rootConfig: $"($root)/.omp/config.yml"
        streamConfig: $"($root)/($stream.ompConfig)"
        streamRelative: $stream.ompConfig
    }
}

def deep-merge-routing [base: record, overlay: record] {
    mut merged = $base
    for key in ($overlay | columns) {
        let incoming = ($overlay | get $key)
        let current = ($merged | get --optional $key)
        let value = if (($incoming | describe) =~ '^record') and (($current | describe) =~ '^record') {
            deep-merge-routing $current $incoming
        } else {
            $incoming
        }
        $merged = ($merged | upsert $key $value)
    }
    $merged
}

def collect-routing-model-selectors [value: any] {
    let kind = ($value | describe)
    if $kind == "string" {
        if $value =~ '^[A-Za-z0-9._-]+/[A-Za-z0-9._:-]+$' { [$value] } else { [] }
    } else if $kind =~ '^list' {
        $value | each {|entry| collect-routing-model-selectors $entry } | flatten
    } else if $kind =~ '^record' {
        let keys = ($value | columns | where {|entry| $entry =~ '^[A-Za-z0-9._-]+/[A-Za-z0-9._:-]+$' })
        $keys | append ($value | values | each {|entry| collect-routing-model-selectors $entry } | flatten)
    } else {
        []
    }
}

export def routing-projection-program [] {
    [
        'let input = (open $env.ROUTING_CONFIG)'
        'mut output = {}'
        'for key in [model modelRoles disabledProviders disabledModels enabledModels modelProviderOrder] { let value = ($input | get --optional $key); if $value != null { $output = ($output | upsert $key $value) } }'
        'mut task = {}; let agent_overrides = ($input.task? | default {} | get --optional agentModelOverrides); if $agent_overrides != null { $task = ($task | upsert agentModelOverrides $agent_overrides) }; if not ($task | is-empty) { $output = ($output | upsert task $task) }'
        'mut retry = {}; let retry_input = ($input.retry? | default {}); for key in [fallbackChains modelFallback fallbackRevertPolicy] { let value = ($retry_input | get --optional $key); if $value != null { $retry = ($retry | upsert $key $value) } }; if not ($retry | is-empty) { $output = ($output | upsert retry $retry) }'
        '$output | to json --raw'
    ] | str join "; "
}

def routing-probe [workspace: record, workspace_name: string, stream_name: string] {
    let paths = (routing-file-paths $workspace $stream_name)
    let destination = (target $workspace)
    let health = ($workspace.health? | default {})
    let expected_machine_id = ($health.machineId? | default "")
    let expected_host_key = ($health.hostKeyFingerprint? | default "")
    let projection_program = (routing-projection-program)
    let probe = ([
        "set -eu"
        $"expected_user='($workspace.user)'"
        $"expected_machine_id='($expected_machine_id)'"
        $"root='($paths.root)'"
        $"root_config='($paths.rootConfig)'"
        $"stream_config='($paths.streamConfig)'"
        $"omp='($workspace.omp)'"
        $"remote_nu='($workspace.remoteNu)'"
        'actual_user=$(id -un)'
        'if test "$actual_user" != "$expected_user"; then echo "remote user identity mismatch" >&2; exit 41; fi'
        'machine_id=$(cat /etc/machine-id 2>/dev/null || true)'
        'if test -n "$expected_machine_id" && test "$machine_id" != "$expected_machine_id"; then echo "remote machine identity mismatch" >&2; exit 42; fi'
        'if test ! -x "$omp"; then echo "compiled omp is missing or not executable" >&2; exit 43; fi'
        'if test ! -x "$remote_nu"; then echo "catalog remote Nu is missing or not executable" >&2; exit 44; fi'
        'root_exists=false; root_hash=""; if test -f "$root_config"; then root_exists=true; root_hash=$(sha256sum "$root_config" | cut -d " " -f 1); fi'
        'stream_exists=false; stream_hash=""; if test -f "$stream_config"; then stream_exists=true; stream_hash=$(sha256sum "$stream_config" | cut -d " " -f 1); fi'
        (['root_projection={}; root_valid=false; if test -f "$root_config"; then if root_projection=$(ROUTING_CONFIG="$root_config" "$remote_nu" --no-config-file -c ' "'" $projection_program "'); then root_valid=true; else root_projection={}; fi; fi"] | str join "")
        (['stream_projection={}; stream_valid=false; if test -f "$stream_config"; then if stream_projection=$(ROUTING_CONFIG="$stream_config" "$remote_nu" --no-config-file -c ' "'" $projection_program "'); then stream_valid=true; else stream_projection={}; fi; fi"] | str join "")
        'set -- models --json --no-extensions'
        'if test "$root_valid" = true; then set -- "$@" --config "$root_config"; fi'
        'if test "$stream_valid" = true; then set -- "$@" --config "$stream_config"; fi'
        'models_json=$(cd "$root" && "$omp" "$@")'
        'omp_version=$("$omp" --version)'
        'omp_hash=$(sha256sum "$omp" | cut -d " " -f 1)'
        'printf "user=%s\nmachine_id=%s\nroot_exists=%s\nroot_hash=%s\nroot_valid=%s\nstream_exists=%s\nstream_hash=%s\nstream_valid=%s\nroot_projection=%s\nstream_projection=%s\nmodels_json=%s\nomp_version=%s\nomp_hash=%s\n" "$actual_user" "$machine_id" "$root_exists" "$root_hash" "$root_valid" "$stream_exists" "$stream_hash" "$stream_valid" "$root_projection" "$stream_projection" "$models_json" "$omp_version" "$omp_hash"'
    ] | str join "\n")
    let result = (
        $probe
        | ^ssh -T -v ...$ssh_options
            -o ClearAllForwardings=yes
            -o ConnectionAttempts=1
            -o ControlMaster=no
            -o ControlPath=none
            -o ForwardAgent=no
            -o PermitLocalCommand=no
            -o StrictHostKeyChecking=yes
            -o UpdateHostKeys=no
            $destination /bin/sh -s
        | complete
    )
    if $result.exit_code != 0 {
        let detail = ($result.stderr | str trim)
        error make {msg: $"Routing inspection failed with exit code ($result.exit_code): ($detail)"}
    }
    let observed_user = (probe-value $result.stdout "user")
    if $observed_user != $workspace.user {
        error make {msg: "Routing inspection remote user identity mismatch"}
    }
    if not ($expected_machine_id | is-empty) and (probe-value $result.stdout "machine_id") != $expected_machine_id {
        error make {msg: "Routing inspection remote machine identity mismatch"}
    }
    if not ($expected_host_key | is-empty) {
        let host_key_matches = (
            $result.stderr
            | lines
            | parse -r 'Server host key: [^ ]+ (?<fingerprint>SHA256:[A-Za-z0-9+/=]+)'
        )
        let observed_host_key = if ($host_key_matches | is-empty) { "" } else { $host_key_matches | last | get fingerprint }
        if $observed_host_key != $expected_host_key {
            error make {msg: "Routing inspection SSH host key fingerprint mismatch"}
        }
    }
    let root_projection = (probe-value $result.stdout "root_projection" | from json)
    let stream_projection = (probe-value $result.stdout "stream_projection" | from json)
    let effective_projection = (deep-merge-routing $root_projection $stream_projection)
    let referenced_models = (collect-routing-model-selectors $effective_projection | uniq)
    let compiled_models = (probe-value $result.stdout "models_json" | from json | get --optional models | default [])
    let selected_models = (
        $compiled_models
        | where {|row|
            let model_id = $"($row.provider)/($row.id)"
            $referenced_models | any {|selector| $selector == $model_id or ($selector | str starts-with $"($model_id):") }
        }
        | sort-by provider id
    )
    let root_exists = (probe-value $result.stdout "root_exists") == "true"
    let stream_exists = (probe-value $result.stdout "stream_exists") == "true"
    {
        workspace: $workspace_name
        host: $workspace.host
        stream: $stream_name
        root: $paths.root
        binary: {
            path: $workspace.omp
            version: (probe-value $result.stdout "omp_version")
            sha256: (probe-value $result.stdout "omp_hash")
        }
        files: {
            root: {
                path: ".omp/config.yml"
                exists: $root_exists
                sha256: (if $root_exists { probe-value $result.stdout "root_hash" } else { null })
                valid: ((probe-value $result.stdout "root_valid") == "true")
            }
            stream: {
                path: $paths.streamRelative
                exists: $stream_exists
                sha256: (if $stream_exists { probe-value $result.stdout "stream_hash" } else { null })
                valid: ((probe-value $result.stdout "stream_valid") == "true")
            }
        }
        routing: {
            root: $root_projection
            stream: $stream_projection
            effective: $effective_projection
        }
        models: $selected_models
    }
}

def local-routing-hash [path: string] {
    if not ($path | path exists) { error make {msg: $"Local routing config not found: ($path)"} }
    open --raw $path | hash sha256
}

export def routing-publish-program [boundary: record] {
    [
        "set -eu"
        $"root_remote='($boundary.rootRemote)'"
        $"root_stage='($boundary.rootStage)'"
        $"root_backup='($boundary.rootBackup)'"
        $"root_expected='($boundary.rootExpected)'"
        $"stream_remote='($boundary.streamRemote)'"
        $"stream_stage='($boundary.streamStage)'"
        $"stream_backup='($boundary.streamBackup)'"
        $"stream_expected='($boundary.streamExpected)'"
        $"lock_dir='($boundary.lockDir)'"
        $"change_root='($boundary.changeRoot)'"
        $"change_stream='($boundary.changeStream)'"
        'committed=false'
        'root_had=false'
        'stream_had=false'
        'root_published=false'
        'stream_published=false'
        'cleanup() { rm -f "$root_stage" "$root_backup" "$stream_stage" "$stream_backup"; rmdir "$lock_dir" 2>/dev/null || true; }'
        'rollback() {'
        '  if test "$committed" != true; then'
        '    if test "$root_published" = true; then if test "$root_had" = true; then mv -f "$root_backup" "$root_remote"; else rm -f "$root_remote"; fi; fi'
        '    if test "$stream_published" = true; then if test "$stream_had" = true; then mv -f "$stream_backup" "$stream_remote"; else rm -f "$stream_remote"; fi; fi'
        '  fi'
        '  cleanup'
        '}'
        'trap rollback EXIT HUP INT TERM'
        'if test "$change_root" = true; then test -f "$root_stage"; test "$(sha256sum "$root_stage" | cut -d " " -f 1)" = "$root_expected"; fi'
        'if test "$change_stream" = true; then test -f "$stream_stage"; test "$(sha256sum "$stream_stage" | cut -d " " -f 1)" = "$stream_expected"; fi'
        'if test "$change_root" = true && test -f "$root_remote"; then cp -p "$root_remote" "$root_backup"; root_had=true; fi'
        'if test "$change_stream" = true && test -f "$stream_remote"; then cp -p "$stream_remote" "$stream_backup"; stream_had=true; fi'
        'if test "$change_root" = true; then mv -f "$root_stage" "$root_remote"; root_published=true; fi'
        'if test "$change_stream" = true; then mv -f "$stream_stage" "$stream_remote"; stream_published=true; fi'
        'if test "$change_root" = true; then test "$(sha256sum "$root_remote" | cut -d " " -f 1)" = "$root_expected"; fi'
        'if test "$change_stream" = true; then test "$(sha256sum "$stream_remote" | cut -d " " -f 1)" = "$stream_expected"; fi'
        'committed=true'
        'trap - EXIT HUP INT TERM'
        'cleanup'
    ] | str join "\n"
}
def routing-sync [workspace: record, workspace_name: string, stream_name: string, source_root_override: string] {
    let stream = (select-stream $workspace $stream_name)
    let paths = (routing-file-paths $workspace $stream_name)
    let source_root = if ($source_root_override | is-empty) { $env.FILE_PWD | path dirname } else { $source_root_override | path expand }
    let root_source = $"($source_root)/.omp/config.yml"
    let stream_source = $"($source_root)/($stream.ompConfig)"
    let root_hash = (local-routing-hash $root_source)
    let stream_hash = (local-routing-hash $stream_source)
    let before = (routing-probe $workspace $workspace_name $stream_name)
    let candidates = [
        {
            name: ".omp/config.yml"
            source: $root_source
            remote: $paths.rootConfig
            expected: $root_hash
            before: $before.files.root.sha256
            stage: $"($paths.rootConfig).routing-sync.($nu.pid)"
        }
        {
            name: $stream.ompConfig
            source: $stream_source
            remote: $paths.streamConfig
            expected: $stream_hash
            before: $before.files.stream.sha256
            stage: $"($paths.streamConfig).routing-sync.($nu.pid)"
        }
    ]
    let changed = ($candidates | where {|file| $file.before != $file.expected })
    if not ($changed | is-empty) {
        let destination = (target $workspace)
        let root_stage = ($candidates | get 0 | get stage)
        let stream_stage = ($candidates | get 1 | get stage)
        let change_root = ($changed | any {|file| $file.name == ".omp/config.yml" })
        let change_stream = ($changed | any {|file| $file.name == $stream.ompConfig })
        let transaction_suffix = $"routing-sync.($nu.pid)"
        let boundary = {
            rootDir: ($paths.rootConfig | path dirname)
            rootRemote: $paths.rootConfig
            rootStage: $root_stage
            rootBackup: $"($paths.rootConfig).($transaction_suffix).backup"
            rootExpected: $root_hash
            streamRemote: $paths.streamConfig
            streamStage: $stream_stage
            streamBackup: $"($paths.streamConfig).($transaction_suffix).backup"
            streamExpected: $stream_hash
            lockDir: $"($paths.root)/.routing-sync.lock"
            changeRoot: $change_root
            changeStream: $change_stream
        }
        let prepare = ([
            "set -eu"
            $"root_dir='($boundary.rootDir)'"
            $"root_stage='($boundary.rootStage)'"
            $"root_backup='($boundary.rootBackup)'"
            $"stream_stage='($boundary.streamStage)'"
            $"stream_backup='($boundary.streamBackup)'"
            $"lock_dir='($boundary.lockDir)'"
            'mkdir -p "$root_dir"'
            'mkdir "$lock_dir"'
            'rm -f "$root_stage" "$root_backup" "$stream_stage" "$stream_backup"'
        ] | str join "\n")
        let cleanup = ([
            "set -eu"
            $"root_stage='($boundary.rootStage)'"
            $"root_backup='($boundary.rootBackup)'"
            $"stream_stage='($boundary.streamStage)'"
            $"stream_backup='($boundary.streamBackup)'"
            $"lock_dir='($boundary.lockDir)'"
            'rm -f "$root_stage" "$root_backup" "$stream_stage" "$stream_backup"'
            'rmdir "$lock_dir" 2>/dev/null || true'
        ] | str join "\n")
        let finalize = (routing-publish-program $boundary)
        checked-external "Prepare routing staging boundary" { $prepare | ^ssh -T ...$ssh_options $destination /bin/sh -s } | ignore
        let failure = (try {
            for file in $changed {
                checked-external $"Stage routing file ($file.name)" { ^rsync -a $file.source $"($destination):($file.stage)" } | ignore
            }
            checked-external "Verify and publish routing files" { $finalize | ^ssh -T ...$ssh_options $destination /bin/sh -s } | ignore
            null
        } catch {|problem| $problem })
        if $failure != null {
            try { checked-external "Clean failed routing staging boundary" { $cleanup | ^ssh -T ...$ssh_options $destination /bin/sh -s } | ignore }
            error make $failure
        }
    }
    let after = (routing-probe $workspace $workspace_name $stream_name)
    {
        workspace: $workspace_name
        host: $workspace.host
        stream: $stream_name
        root: $paths.root
        sourceRoot: $source_root
        changedFiles: ($changed | each {|file| $file.name })
        before: (
            {".omp/config.yml": $before.files.root.sha256}
            | upsert $stream.ompConfig $before.files.stream.sha256
        )
        after: (
            {".omp/config.yml": $after.files.root.sha256}
            | upsert $stream.ompConfig $after.files.stream.sha256
        )
        inspection: $after
    }
}

def sync-source [catalog: record, workspace: record, workspace_name: string, stream_name: string, manifest_path: string] {
    let stream = (select-stream $workspace $stream_name)
    remote-action $workspace $workspace_name _mkdir $no_stream $manifest_path
    let includes = ($catalog.shared.syncIncludes | append $stream.syncIncludes | uniq)
    let excludes = $catalog.shared.syncExcludes
    let include_args = ($includes | each {|pattern| [--include $pattern] } | flatten)
    let exclude_args = ($excludes | each {|pattern| [--exclude $pattern] } | flatten)
    let destination = (target $workspace)
    let source_root = ($env.FILE_PWD | path dirname)
    do {
        cd $source_root
        checked-external --stream "Remote workspace source sync" { ^rsync -a --delete-delay ...$exclude_args ...$include_args --exclude '*' ./ $"($destination):($workspace.root)/" }
    }
}

# Initialize local VCS metadata without inventing source history, then build source OMP.
def remote-setup [workspace: record, stream: record] {
    cd $workspace.root
    let bun = $workspace.bun
    let rust_tool = $"rust@($workspace.rustToolchain)"
    checked-external --stream "Upgrade remote Bun canary runtime" { ^$bun upgrade --canary }
    let bun_version = (checked-external "Read remote Bun version" { ^$bun --version } | str trim)
    let version_parts = ($bun_version | split row "-" | first | split row "." | each {|part| $part | into int })
    if ($version_parts | length) < 2 or ($version_parts | first) < $workspace.bunMinimumMajor or (($version_parts | first) == $workspace.bunMinimumMajor and ($version_parts | get 1) < $workspace.bunMinimumMinor) {
        error make {msg: $"Bun ($bun_version) is below the required ($workspace.bunMinimumMajor).($workspace.bunMinimumMinor)"}
    }
    checked-external "Probe Bun memoryPressure capability" { ^$bun --expose-internals -e 'const {emitMemoryPressure}=require("bun:internal-for-testing");const got=[];process.on("memoryPressure",x=>got.push(x));emitMemoryPressure("warning");emitMemoryPressure("critical");if(JSON.stringify(got)!=="[\"warning\",\"critical\"]")process.exit(1);' } | ignore
    if not (".git" | path exists) { checked-external --stream "Initialize remote Git repository" { ^git init --initial-branch=main } }
    if not (".jj" | path exists) { checked-external --stream "Initialize remote Jujutsu repository" { ^jj git init --colocate . } }
    checked-external --stream "Trust remote mise configuration" { ^mise trust mise.toml }
    checked-external --stream "Install remote workspace runtimes" { ^mise install node npm:portless cargo:jj-cli cargo:jj-starship }
    checked-external --stream "Install remote Rust toolchain" { ^mise install $rust_tool }
    let rustup_path = (checked-external "Resolve remote rustup executable" { ^mise which rustup --tool $rust_tool } | str trim)
    if not ($rustup_path =~ '^/[A-Za-z0-9._/-]+$') or ($rustup_path | str contains "..") {
        error make {msg: $"Unsafe remote rustup executable path: ($rustup_path)"}
    }
    let rustup_file_check = (^test -f $rustup_path | complete)
    let rustup_executable_check = (^test -x $rustup_path | complete)
    if $rustup_file_check.exit_code != 0 or $rustup_executable_check.exit_code != 0 {
        error make {msg: $"Remote rustup is not an executable file: ($rustup_path)"}
    }
    let rust_selector = $workspace.rustToolchain
    let native_runtime_dir = $"($workspace.root)/.runtime/remote-workspace"
    checked-external "Create remote native-build runtime directory" { ^mkdir -p $native_runtime_dir }
    let compiler_wrappers = ([cargo rustc] | each {|compiler|
        let wrapper_path = $"($native_runtime_dir)/($compiler)"
        let temporary_path = (checked-external $"Create temporary remote ($compiler) wrapper" { ^mktemp $"($wrapper_path).tmp.XXXXXX" } | str trim)
        [
            "#!/bin/sh"
            ($"exec '($rustup_path)' run '($rust_selector)' ($compiler) " ++ '"$@"')
            ""
        ] | str join "\n" | save -f $temporary_path
        checked-external $"Make remote ($compiler) wrapper executable" { ^chmod 0700 $temporary_path }
        checked-external $"Install remote ($compiler) wrapper" { ^mv -f $temporary_path $wrapper_path }
        $wrapper_path
    })
    let cargo_path = ($compiler_wrappers | get 0)
    let rustc_path = ($compiler_wrappers | get 1)
    let native_path = if (($env.PATH | describe) =~ '^list') {
        [$native_runtime_dir] | append $env.PATH
    } else {
        [$native_runtime_dir $env.PATH] | str join (char esep)
    }
    let portless_runtime = (resolve-portless $workspace.root)
    let bun_dir = ($bun | path dirname)
    $env.PATH = if (($env.PATH | describe) =~ '^list') {
        [$bun_dir] | append $env.PATH
    } else {
        [$bun_dir $env.PATH] | str join (char esep)
    }

    checked-external --stream "Install root workspace packages" { ^$bun install --frozen-lockfile }
    for setup_dir in $stream.setupDirs {
        let package_manifest = $"($workspace.root)/($setup_dir)/package.json"
        if not ($package_manifest | path exists) {
            error make {msg: $"Declared setup directory has no package.json: ($setup_dir)"}
        }
    }

    cd $"($workspace.root)/vendor/oh-my-pi"
    checked-external --stream "Install source OMP packages" { ^$bun install --frozen-lockfile }
    with-env {
        PATH: $native_path,
        RUSTC: $rustc_path,
        CARGO: $cargo_path
    } {
        let rustc_version = (checked-external "Verify selector-bound remote Rust compiler" { ^$rustc_path --version } | str trim)
        let cargo_version = (checked-external "Verify selector-bound remote Cargo" { ^$cargo_path --version } | str trim)
        let selector_date = ($rust_selector | str replace --regex '^nightly-' '')
        let compiler_date = (($selector_date | into datetime) - 1day | format date '%Y-%m-%d')
        if not ($rustc_version | str contains "nightly") or not (($rustc_version | str contains $selector_date) or ($rustc_version | str contains $compiler_date)) {
            error make {msg: $"Remote Rust compiler does not match ($rust_selector): ($rustc_version)"}
        }
        if not ($cargo_version | str contains "nightly") {
            error make {msg: $"Remote Cargo is not nightly for ($rust_selector): ($cargo_version)"}
        }
        checked-external --stream "Build source OMP native dependencies" { ^$bun run build:native }
    }
    checked-external --stream "Generate source OMP assets" { ^$bun --cwd=packages/coding-agent run generate }
    checked-external --stream "Typecheck source OMP" { ^$bun ./node_modules/.bin/tsgo -p packages/coding-agent/tsconfig.json --noEmit }
    cd $workspace.root
    checked-external --stream "Link source OMP" { ^mise run omp-link }

    let git_head_result = (^git -C $workspace.root rev-parse HEAD | complete)
    let jj_change_result = (^jj -R $workspace.root log -r @ --no-graph -T 'change_id.short()' | complete)
    {
        setup: "ready",
        root: $workspace.root,
        setup_dirs: $stream.setupDirs,
        node: $portless_runtime.node,
        portless: $portless_runtime.portless,
        bun: (checked-external "Read remote Bun revision" { ^$bun --revision } | str trim),
        source_history_transferred: false,
        git_head: (if $git_head_result.exit_code == 0 { $git_head_result.stdout | str trim } else { null }),
        jj_change: (if $jj_change_result.exit_code == 0 { $jj_change_result.stdout | str trim } else { null })
    } | to json --indent 2
}

def require-lane-workspace [workspace: record] {
    if ($workspace.laneRoot? | default null) == null {
        error make {msg: $"Workspace does not define lane lifecycle storage: ($workspace.root)"}
    }
}

def lane-manifest-empty [workspace: record] {
    {
        version: 1
        repository_root: $workspace.root
        lane_root: $workspace.laneRoot
        bundle_root: $workspace.laneBundleRoot
        shared_cache_roots: $workspace.sharedCacheRoots
        lanes: {}
    }
}

def validate-lane-manifest [manifest: record, workspace: record] {
    if ($manifest.version? | default 0) != 1 { error make {msg: "Unsupported lane manifest version"} }
    if $manifest.repository_root != $workspace.root or $manifest.lane_root != $workspace.laneRoot or $manifest.bundle_root != $workspace.laneBundleRoot {
        error make {msg: "Lane manifest does not match the selected workspace"}
    }
    if ($manifest.shared_cache_roots? | describe) !~ '^list' or $manifest.shared_cache_roots != $workspace.sharedCacheRoots {
        error make {msg: "Lane manifest shared cache roots do not match the catalog"}
    }
    if ($manifest.lanes? | describe) !~ '^record' { error make {msg: "Lane manifest lanes must be a record"} }
    for lane_name in ($manifest.lanes | columns) {
        valid-id $lane_name "lane"
        let lane = ($manifest.lanes | get $lane_name)
        if $lane.lane != $lane_name { error make {msg: $"Lane manifest key mismatch for ($lane_name)"} }
        valid-id $lane.stream "stream"
        valid-id $lane.workspace "lane workspace"
        if not ($lane.change_id =~ '^[a-z]+$') { error make {msg: $"Invalid lane change ID for ($lane_name)"} }
        if not ($lane.commit_id =~ '^[0-9a-f]+$') { error make {msg: $"Invalid lane commit ID for ($lane_name)"} }
        if ($lane.sparse_patterns? | describe) !~ '^list' or ($lane.sparse_patterns | is-empty) {
            error make {msg: $"Lane sparse patterns must be a non-empty list for ($lane_name)"}
        }
        for lane_path in $lane.sparse_patterns { valid-relative-path $lane_path $"sparse pattern for ($lane_name)" }
        if not ($lane.root | str starts-with $"($workspace.laneRoot)/") {
            error make {msg: $"Lane root escapes the catalog lane root: ($lane.root)"}
        }
        let bundle = ($lane.bundle? | default null)
        if $bundle != null {
            if not ($bundle.commit_id =~ '^[0-9a-f]+$') or not ($bundle.change_id =~ '^[a-z]+$') {
                error make {msg: $"Invalid bundle identity for ($lane_name)"}
            }
            if not ($bundle.path | str starts-with $"($workspace.laneBundleRoot)/") or not ($bundle.receipt | str starts-with $"($workspace.laneBundleRoot)/") {
                error make {msg: $"Bundle paths escape the catalog bundle root for ($lane_name)"}
            }
        }
    }
}

def load-lane-manifest [workspace: record] {
    if not ($workspace.laneManifest | path exists) { return (lane-manifest-empty $workspace) }
    let manifest = (open $workspace.laneManifest)
    validate-lane-manifest $manifest $workspace
    $manifest
}

def save-lane-manifest [workspace: record, manifest: record] {
    validate-lane-manifest $manifest $workspace
    mkdir ($workspace.laneManifest | path dirname)
    let temporary = $"($workspace.laneManifest).tmp.($nu.pid).(random chars -l 8)"
    $manifest | to json --indent 2 | save -f $temporary
    checked-external "Publish lane manifest" { ^mv -f $temporary $workspace.laneManifest } | ignore
}

def with-lane-lock [workspace: record, action: closure] {
    let lock_path = $"($workspace.laneManifest).lock"
    mkdir ($lock_path | path dirname)
    mut acquired = false
    for attempt in 0..100 {
        if (^mkdir $lock_path | complete).exit_code == 0 {
            $acquired = true
            break
        }
        sleep 50ms
    }
    if not $acquired { error make {msg: $"Timed out acquiring lane manifest lock: ($lock_path)"} }
    let outcome = (try {
        {ok: true, value: (do $action)}
    } catch {|problem|
        {ok: false, problem: $problem}
    })
    rm -rf $lock_path
    if not $outcome.ok { error make $outcome.problem }
    $outcome.value
}

def lane-record [manifest: record, lane_name: string] {
    valid-id $lane_name "lane"
    if $lane_name not-in ($manifest.lanes | columns) { error make {msg: $"Unknown lane: ($lane_name)"} }
    $manifest.lanes | get $lane_name
}

def current-lane-identity [lane: record] {
    if not ($lane.root | path exists) { error make {msg: $"Lane workspace is missing: ($lane.root)"} }
    let change_id = (checked-external "Read lane change ID" { ^jj -R $lane.root log -r @ --no-graph -T change_id } | str trim)
    let commit_id = (checked-external "Read lane commit ID" { ^jj -R $lane.root log -r @ --no-graph -T commit_id } | str trim)
    {change_id: $change_id, commit_id: $commit_id}
}

def lane-sparse-patterns [catalog: record, stream: record, owned_paths: list<string>] {
    for owned_path in $owned_paths {
        valid-relative-path $owned_path "owned path"
        let allowed = ($stream.laneOwnedRoots | any {|root|
            $owned_path == $root or ($owned_path | str starts-with $"($root)/")
        })
        if not $allowed {
            error make {msg: $"Owned path is outside the stream manifest: ($owned_path)"}
        }
    }
    ($catalog.shared.laneSharedPaths | append $stream.ompConfig | append $stream.promptRefs | append $owned_paths | uniq | sort)
}

export def lane-new [catalog: record, workspace_name: string, stream_name: string, lane_name: string, owned_paths: list<string>] {
    let workspace = (select-workspace $catalog $workspace_name)
    require-lane-workspace $workspace
    let stream = (select-stream $workspace $stream_name)
    if $stream_name not-in ($workspace.laneStreams | columns) {
        error make {msg: $"Stream is not enabled for lanes: ($stream_name)"}
    }
    let lane_profile = ($workspace.laneStreams | get $stream_name)
    let lane_stream = ($stream | merge {laneOwnedRoots: $lane_profile.ownedRoots})
    valid-id $lane_name "lane"
    let patterns = (lane-sparse-patterns $catalog $lane_stream $owned_paths)
    with-lane-lock $workspace {
        let manifest = (load-lane-manifest $workspace)
        if $lane_name in ($manifest.lanes | columns) { error make {msg: $"Lane already exists: ($lane_name)"} }
        let workspace_id = $"harness-lane-($lane_name)"
        let lane_root = $"($workspace.laneRoot)/($lane_name)"
        if ($lane_root | path exists) { error make {msg: $"Lane root already exists: ($lane_root)"} }
        mkdir $workspace.laneRoot
        checked-external "Create sparse lane workspace" {
            ^jj -R $workspace.root workspace add --name $workspace_id --revision @ --message $"harness lane ($stream_name)/($lane_name)" --sparse-patterns empty $lane_root
        } | ignore
        let sparse_args = ($patterns | each {|pattern| [--add $pattern] } | flatten)
        let sparse_problem = (try {
            checked-external "Materialize lane sparse patterns" { ^jj -R $lane_root sparse set --clear ...$sparse_args } | ignore
            null
        } catch {|problem| $problem })
        if $sparse_problem != null {
            try { ^jj -R $workspace.root workspace forget $workspace_id | complete | ignore } catch { }
            if ($lane_root | path exists) { rm -rf $lane_root }
            error make $sparse_problem
        }
        let identity = (current-lane-identity {
            root: $lane_root
        })
        let record = {
            lane: $lane_name
            stream: $stream_name
            change_id: $identity.change_id
            commit_id: $identity.commit_id
            workspace: $workspace_id
            root: $lane_root
            sparse_patterns: $patterns
            shared_cache_roots: $workspace.sharedCacheRoots
            bundle: null
        }
        let updated = ($manifest | upsert lanes ($manifest.lanes | upsert $lane_name $record))
        let save_problem = (try {
            save-lane-manifest $workspace $updated
            null
        } catch {|problem| $problem })
        if $save_problem != null {
            try { ^jj -R $workspace.root workspace forget $workspace_id | complete | ignore } catch { }
            if ($lane_root | path exists) { rm -rf $lane_root }
            error make $save_problem
        }
        $record | to json --indent 2
    }
}

export def lane-list [catalog: record, workspace_name: string] {
    let workspace = (select-workspace $catalog $workspace_name)
    require-lane-workspace $workspace
    let manifest = (load-lane-manifest $workspace)
    $manifest | to json --indent 2
}

export def lane-bundle [catalog: record, workspace_name: string, lane_name: string] {
    let workspace = (select-workspace $catalog $workspace_name)
    require-lane-workspace $workspace
    with-lane-lock $workspace {
        let manifest = (load-lane-manifest $workspace)
        let lane = (lane-record $manifest $lane_name)
        let identity = (current-lane-identity $lane)
        if $identity.change_id != $lane.change_id {
            error make {msg: $"Lane workspace moved to a different change: ($lane_name)"}
        }
        let parent_commit = (checked-external "Read lane parent commit ID" { ^jj -R $lane.root log -r '@-' --no-graph -T commit_id } | str trim)
        let stamp = (date now | format date '%Y%m%dT%H%M%SZ')
        let basename = $"($lane_name)-($identity.change_id | str substring 0..7)-($stamp)"
        mkdir $workspace.laneBundleRoot
        let bundle_path = $"($workspace.laneBundleRoot)/($basename).bundle"
        let receipt_path = $"($workspace.laneBundleRoot)/($basename).receipt.json"
        let temporary_bundle = $"($bundle_path).tmp"
        let bookmark = $"harness-lane-bundle-($lane_name)-($nu.pid)"
        let bundle_problem = (try {
            checked-external "Create temporary lane bundle bookmark" { ^jj -R $workspace.root bookmark create -r $identity.change_id $bookmark } | ignore
            checked-external "Export lane bookmark to Git" { ^jj -R $workspace.root git export } | ignore
            checked-external "Create durable lane Git bundle" {
                ^git -C $workspace.root bundle create $temporary_bundle $"($parent_commit)..refs/heads/($bookmark)"
            } | ignore
            checked-external "Verify durable lane Git bundle" { ^git -C $workspace.root bundle verify $temporary_bundle } | ignore
            null
        } catch {|problem| $problem })
        try { ^jj -R $workspace.root bookmark delete $bookmark | complete | ignore } catch { }
        try { ^jj -R $workspace.root git export | complete | ignore } catch { }
        if $bundle_problem != null {
            if ($temporary_bundle | path exists) { rm -f $temporary_bundle }
            error make $bundle_problem
        }
        checked-external "Publish lane bundle" { ^mv -f $temporary_bundle $bundle_path } | ignore
        let bundle_ref = $"refs/heads/($bookmark)"
        let restore_ref = $"refs/heads/harness-lane-restore-($lane_name)"
        let receipt = {
            version: 1
            lane: $lane_name
            stream: $lane.stream
            change_id: $identity.change_id
            commit_id: $identity.commit_id
            parent_commit_id: $parent_commit
            bundle: $bundle_path
            bundle_ref: $bundle_ref
            receipt: $receipt_path
            sparse_patterns: $lane.sparse_patterns
            restore_steps: [
                $"git -C ($workspace.root) fetch ($bundle_path) ($bundle_ref):($restore_ref)"
                $"jj -R ($workspace.root) git import"
            ]
        }
        $receipt | to json --indent 2 | save -f $receipt_path
        let bundle = {
            change_id: $identity.change_id
            commit_id: $identity.commit_id
            path: $bundle_path
            receipt: $receipt_path
            bundled_at: $stamp
            bytes: ((ls $bundle_path | first | get size) | into int)
        }
        let updated_lane = ($lane | upsert commit_id $identity.commit_id | upsert bundle $bundle)
        let updated = ($manifest | upsert lanes ($manifest.lanes | upsert $lane_name $updated_lane))
        save-lane-manifest $workspace $updated
        $receipt | merge {bytes: $bundle.bytes} | to json --indent 2
    }
}

export def lane-drop [catalog: record, workspace_name: string, lane_name: string] {
    let workspace = (select-workspace $catalog $workspace_name)
    require-lane-workspace $workspace
    with-lane-lock $workspace {
        let manifest = (load-lane-manifest $workspace)
        let lane = (lane-record $manifest $lane_name)
        let bundle = ($lane.bundle? | default null)
        if $bundle == null {
            error make {msg: $"Refusing to drop unbundled lane: ($lane_name)"}
        }
        let identity = (current-lane-identity $lane)
        if $identity.change_id != $bundle.change_id or $identity.commit_id != $bundle.commit_id {
            error make {msg: $"Refusing to drop dirty lane changed after bundle: ($lane_name)"}
        }
        if not ($bundle.path | path exists) or not ($bundle.receipt | path exists) {
            error make {msg: $"Refusing to drop lane without durable bundle artifacts: ($lane_name)"}
        }
        checked-external "Forget lane workspace" { ^jj -R $workspace.root workspace forget $lane.workspace } | ignore
        rm -rf $lane.root
        let remaining = ($manifest.lanes | reject $lane_name)
        save-lane-manifest $workspace ($manifest | upsert lanes $remaining)
        {
            dropped: $lane_name
            change_id: $identity.change_id
            bundle: $bundle.path
            receipt: $bundle.receipt
        } | to json --indent 2
    }
}

def remote-errors [workspace: record, stream: record, stream_name: string] {
    let error_log = ($stream.errorLog? | default null)
    if $error_log == null {
        print $"no error log configured for ($stream_name)"
        return
    }
    let error_log_path = $"($workspace.root)/($error_log)"
    if not ($error_log_path | path exists) or ($error_log_path | path type) != "file" {
        print $"no error log for ($stream_name): ($error_log) is unavailable"
        return
    }
    checked-external --stream $"Read error log for ($stream_name)" { ^cat -- $error_log_path }
}

def require-services-enabled [stream: record, action: string] {
    if not $stream.servicesEnabled {
        error make {msg: $"Cannot ($action) services: ($stream.servicesBlockedReason)"}
    }
}

def remote-service [workspace: record, stream: record, action: string, stream_name: string] {
    require-services-enabled $stream $action
    cd $workspace.root
    let bun_dir = ($workspace.bun | path dirname)
    $env.PATH = if (($env.PATH | describe) =~ '^list') {
        [$bun_dir] | append $env.PATH
    } else {
        [$bun_dir $env.PATH] | str join (char esep)
    }
    match $action {
        "up" => {
            let portless_runtime = (resolve-portless $workspace.root)
            let node = $portless_runtime.node
            let portless = $portless_runtime.portless
            checked-external --stream "Prune remote Portless routes" { ^$node $portless prune }
            checked-external --stream "Start services for ($stream_name)" { ^mise run up $stream_name }
        }
        "down" => {
            checked-external --stream "Stop services for ($stream_name)" { ^mise run down $stream_name }
            let portless_runtime = (resolve-portless $workspace.root)
            let node = $portless_runtime.node
            let portless = $portless_runtime.portless
            checked-external --stream "Prune remote Portless routes" { ^$node $portless prune }
        }
        "status" => { checked-external --stream "Read service status for ($stream_name)" { ^mise run status $stream_name } }
        _ => { error make {msg: "Unknown service action"} }
    }
}

# Resolve active portless backends on the remote host; direct ports are catalog data.
def remote-review [workspace: record, stream: record] {
    cd $workspace.root
    let bun_dir = ($workspace.bun | path dirname)
    $env.PATH = if (($env.PATH | describe) =~ '^list') {
        [$bun_dir] | append $env.PATH
    } else {
        [$bun_dir $env.PATH] | str join (char esep)
    }
    let needs_portless = ($stream.review | any {|target| $target.kind == "portless" })
    let portless_runtime = (resolve-portless $workspace.root)
    let node = $portless_runtime.node
    let portless = $portless_runtime.portless
    let listing = if $needs_portless {
        checked-external "Remote Portless doctor" { ^$node $portless doctor } | ignore
        checked-external "List remote Portless routes" { ^$node $portless list }
    } else {
        ""
    }
    let lines = ($listing | ansi strip | lines)
    $stream.review | each {|review_target|
        let remote_port = if $review_target.kind == "direct" {
            $review_target.remotePort
        } else {
            let route_url = $"($review_target.route).localhost"
            let route_lines = ($lines | where {|line| $line | str contains $route_url })
            if ($route_lines | length) != 1 { error make {msg: $"Expected one active portless route for ($review_target.route)"} }
            let parsed = ($route_lines | first | parse -r '.*->\s+(?:localhost|127\.0\.0\.1):(?P<port>[0-9]+).*')
            if ($parsed | is-empty) { error make {msg: $"Could not resolve backend port for ($review_target.route)"} }
            $parsed | first | get port | into int
        }
        $review_target | merge {remotePort: $remote_port}
    } | to json --indent 2
}

def launcher-path [workspace: record, stream_name: string] {
    $"($workspace.root)/.runtime/remote-workspace/launch-($stream_name).nu"
}

def remote-launch [workspace: record, stream: record, stream_name: string] {
    let tmux_name = $"agent-($stream_name)"
    if (^tmux has-session -t $tmux_name | complete).exit_code == 0 {
        {launched: false, reason: "already-running", tmux: $tmux_name} | to json --indent 2
        return
    }
    let launcher = (launcher-path $workspace $stream_name)
    mkdir ($launcher | path dirname)
    let prompt = ($stream.promptRefs | each {|ref| $"@($ref)" } | str join " ")
    let bun_dir = ($workspace.bun | path dirname)
    [
        "#!/usr/bin/env -S nu --no-config-file"
        $"use '($workspace.remoteRunner)' checked-external"
        $"cd ($workspace.root)"
        $"let bun = '($workspace.bun)'"
        $"let bun_dir = '($bun_dir)'"
        "$env.PATH = if (($env.PATH | describe) =~ '^list') { [$bun_dir] | append $env.PATH } else { [$bun_dir $env.PATH] | str join (char esep) }"
        $"checked-external --stream 'Source OMP agent' { ^$bun vendor/oh-my-pi/packages/coding-agent/src/cli.ts --config ($stream.ompConfig) --workstream ($stream_name) '($prompt)' }"
    ] | str join "\n" | save -f $launcher
    let remote_nu = $workspace.remoteNu
    let command = $"($remote_nu) --no-config-file ($launcher)"
    checked-external --stream "Launch agent tmux session ($tmux_name)" { ^tmux new-session -d -s $tmux_name -n orchestrator -c $workspace.root $command }
    sleep 2sec
    if (^tmux has-session -t $tmux_name | complete).exit_code != 0 {
        error make {msg: $"Agent tmux session failed to start: ($tmux_name)"}
    }
    {launched: true, tmux: $tmux_name, root: $workspace.root, prompt_refs: $stream.promptRefs} | to json --indent 2
}

def remote-probe [workspace: record, stream: record, stream_name: string] {
    cd $workspace.root
    let bun = $workspace.bun
    let stdout = (checked-external "Source OMP probe" { ^$bun vendor/oh-my-pi/packages/coding-agent/src/cli.ts --config $stream.ompConfig --workstream $stream_name --print "Reply exactly READY" })
    {
        exit_code: 0,
        stdout: ($stdout | str trim),
        stderr: ""
    } | to json --indent 2
}

def forward-state-root [] {
    $"($env.HOME)/.local/state/remote-workspace/forwards"
}

def forward-config-path [workspace_name: string, stream_name: string] {
    $"(forward-state-root)/($workspace_name)-($stream_name)/config.json"
}

def command-path [name: string] {
    let commands = (which $name)
    if ($commands | is-empty) { error make {msg: $"Required command is unavailable: ($name)"} }
    $commands | first | get path | into string
}

def write-forward-config [workspace: record, workspace_name: string, stream_name: string] {
    let stream = (select-stream $workspace $stream_name)
    let capability = $workspace.capabilities.reviewForwarding
    if not $workspace.capabilities.remoteWorkspace {
        error make {msg: $"Workspace does not permit remote actions: ($workspace_name)"}
    }
    if not $capability.enabled {
        error make {msg: $"Review forwarding is disabled for ($workspace_name)"}
    }
    if ($stream.review | is-empty) {
        error make {msg: $"No review targets are configured for ($workspace_name)/($stream_name)"}
    }
    let portless_runtime = (local-portless-runtime)
    let config_path = (forward-config-path $workspace_name $stream_name)
    let state_dir = ($config_path | path dirname)
    let targets = ($stream.review | each {|review_target|
        {
            name: $review_target.name
            alias: (review-local-alias $capability $stream_name $review_target.aliasSuffix)
            localPort: ($review_target.localPort + $capability.localPortOffset)
            path: $review_target.path
        }
    })
    let config = {
        version: 1
        id: $"($workspace_name)-($stream_name)"
        workspace: $workspace_name
        stream: $stream_name
        host: $workspace.host
        user: $workspace.user
        remoteNu: $workspace.remoteNu
        remoteRunner: $workspace.remoteRunner
        remoteManifest: $workspace.remoteManifest
        ssh: (command-path ssh)
        sshOptions: $ssh_options
        node: $portless_runtime.node
        portless: $portless_runtime.portless
        cmux: (command-path cmux)
        cmuxWorkspace: $stream.reviewWorkspace
        stateDir: $state_dir
        refreshMs: 2000
        maxBackoffMs: 30000
        targets: $targets
    }
    mkdir $state_dir
    let temporary = $"($config_path).tmp-(random uuid)"
    $config | to json --indent 2 | save -f $temporary
    mv -f $temporary $config_path
    $config_path
}

def forward-supervisor [] {
    let path = $"($env.FILE_PWD)/remote-forward-supervisor.ts" | path expand
    if not ($path | path exists) { error make {msg: $"Forward supervisor not found: ($path)"} }
    $path
}

def run-forward-action [workspace: record, workspace_name: string, stream_name: string, action: string, --preserve-config] {
    let config_path = (forward-config-path $workspace_name $stream_name)
    if not $preserve_config or not ($config_path | path exists) {
        write-forward-config $workspace $workspace_name $stream_name | ignore
    }
    let bun = (command-path bun)
    let supervisor = (forward-supervisor)
    checked-external $"Review forward ($action) for ($workspace_name)/($stream_name)" { ^$bun $supervisor $action --config $config_path } | print
}

def ensure-forward [workspace: record, workspace_name: string, stream_name: string] {
    let portless_runtime = (local-portless-runtime)
    checked-external "Local Portless health check" { ^$portless_runtime.node $portless_runtime.portless doctor } | ignore
    run-forward-action $workspace $workspace_name $stream_name start
}

def stop-forward [workspace: record, workspace_name: string, stream_name: string] {
    let config_path = (forward-config-path $workspace_name $stream_name)
    if not ($config_path | path exists) {
        print ({version: 1, id: $"($workspace_name)-($stream_name)", running: false, phase: "stopped", targets: []} | to json --indent 2)
        return
    }
    run-forward-action --preserve-config $workspace $workspace_name $stream_name stop
}

def review [workspace: record, workspace_name: string, stream_name: string] {
    ensure-forward $workspace $workspace_name $stream_name
    run-forward-action --preserve-config $workspace $workspace_name $stream_name open
}

def doctor [workspace: record, workspace_name: string, manifest_path: string] {
    match $workspace.capabilities.healthProfile {
        "workstation-maintenance" => {
            let maintenance = $"($env.HOME)/dotfiles/server/ubuntu-remote/desktop-maintenance.sh"
            print ({
                workspace: $workspace_name,
                profile: $workspace.capabilities.healthProfile,
                evidence: {maintenance_wrapper: $maintenance, remote_doctor: true}
            } | to json --indent 2)
            if not ($maintenance | path exists) { error make {msg: $"Desktop maintenance wrapper not found: ($maintenance)"} }
            checked-external --stream "Desktop health check" { ^$maintenance --host $workspace.host health-check }
            remote-action $workspace $workspace_name _doctor $no_stream $manifest_path | print
        }
        "unprivileged-server" => { unprivileged-server-doctor $workspace $workspace_name }
        _ => { error make {msg: $"Unsupported healthProfile for ($workspace_name): ($workspace.capabilities.healthProfile)"} }
    }
}

def require-stream [workspace: record, stream_name: string] {
    if $stream_name == $no_stream { error make {msg: "This action requires a stream"} }
    select-stream $workspace $stream_name | ignore
}

def main [
    action: string
    ...arguments: string
    --workspace: string = $default_workspace
    --catalog: string = ""
    --source-root: string = ""
] {
    let manifest_path = if ($catalog | is-empty) {
        $"($env.FILE_PWD)/($local_manifest)" | path expand
    } else {
        $catalog | path expand
    }
    let manifest = (load-catalog $manifest_path)
    let workspace_config = (select-workspace $manifest $workspace)
    let stream_name = if $action == "forward" { $arguments | get --optional 1 | default $no_stream } else { $arguments | get --optional 0 | default $no_stream }

    if ($action | str starts-with "_") {
        match $action {
            "_doctor" => { remote-doctor $workspace_config | print }
            "_mkdir" => { mkdir $workspace_config.root }
            "_setup" => { let stream_config = (select-stream $workspace_config $stream_name); remote-setup $workspace_config $stream_config | print }
            "_up" => { let stream_config = (select-stream $workspace_config $stream_name); remote-service $workspace_config $stream_config up $stream_name }
            "_down" => { let stream_config = (select-stream $workspace_config $stream_name); remote-service $workspace_config $stream_config down $stream_name }
            "_status" => { let stream_config = (select-stream $workspace_config $stream_name); remote-service $workspace_config $stream_config status $stream_name }
            "_review" => { let stream_config = (select-stream $workspace_config $stream_name); remote-review $workspace_config $stream_config | print }
            "_errors" => { let stream_config = (select-stream $workspace_config $stream_name); remote-errors $workspace_config $stream_config $stream_name }
            "_launch" => { let stream_config = (select-stream $workspace_config $stream_name); remote-launch $workspace_config $stream_config $stream_name | print }
            "_screen" => { require-stream $workspace_config $stream_name; checked-external --stream "Capture agent tmux screen" { ^tmux capture-pane -p -t $"agent-($stream_name):orchestrator" -S -80 } }
            "_attach" => { require-stream $workspace_config $stream_name; checked-external --stream "Attach agent tmux session" { ^tmux attach-session -t $"agent-($stream_name)" } }
            "_probe" => { let stream_config = (select-stream $workspace_config $stream_name); remote-probe $workspace_config $stream_config $stream_name | print }
            "_lane:new" => {
                if ($arguments | length) < 2 { error make {msg: "_lane:new requires <stream> <lane> [owned-paths...]"} }
                lane-new $manifest $workspace ($arguments | get 0) ($arguments | get 1) ($arguments | skip 2) | print
            }
            "_lane:list" => {
                if not ($arguments | is-empty) { error make {msg: "_lane:list takes no arguments"} }
                lane-list $manifest $workspace | print
            }
            "_lane:bundle" => {
                if ($arguments | length) != 1 { error make {msg: "_lane:bundle requires <lane>"} }
                lane-bundle $manifest $workspace ($arguments | first) | print
            }
            "_lane:drop" => {
                if ($arguments | length) != 1 { error make {msg: "_lane:drop requires <lane>"} }
                lane-drop $manifest $workspace ($arguments | first) | print
            }
            _ => { error make {msg: "Unknown internal action"} }
        }
        return
    }

    if not $workspace_config.capabilities.remoteWorkspace { error make {msg: $"Catalog workspace does not permit autonomous remote actions: ($workspace)"} }
    if ($workspace_config.laneOnly? | default false) and $action not-in ["doctor" "sync" "setup" "routing:inspect" "routing:sync" "lane:new" "lane:list" "lane:bundle" "lane:drop"] {
        error make {msg: $"Workspace only permits setup and lane lifecycle actions: ($workspace)"}
    }
    match $action {
        "lane:new" => {
            if ($arguments | length) < 2 { error make {msg: "lane:new requires <stream> <lane> [owned-paths...]"} }
            valid-id ($arguments | get 0) "stream"
            valid-id ($arguments | get 1) "lane"
            for owned_path in ($arguments | skip 2) { valid-relative-path $owned_path "owned path" }
            remote-lane-action $workspace_config $workspace "lane:new" $arguments $manifest_path | print
        }
        "lane:list" => {
            if not ($arguments | is-empty) { error make {msg: "lane:list takes no arguments"} }
            remote-lane-action $workspace_config $workspace "lane:list" [] $manifest_path | print
        }
        "lane:bundle" => {
            if ($arguments | length) != 1 { error make {msg: "lane:bundle requires <lane>"} }
            valid-id ($arguments | first) "lane"
            remote-lane-action $workspace_config $workspace "lane:bundle" $arguments $manifest_path | print
        }
        "lane:drop" => {
            if ($arguments | length) != 1 { error make {msg: "lane:drop requires <lane>"} }
            valid-id ($arguments | first) "lane"
            remote-lane-action $workspace_config $workspace "lane:drop" $arguments $manifest_path | print
        }
        "routing:inspect" => {
            if ($arguments | length) != 1 { error make {msg: "routing:inspect requires <stream>"} }
            require-stream $workspace_config $stream_name
            routing-probe $workspace_config $workspace $stream_name | to json --indent 2 | print
        }
        "routing:sync" => {
            if ($arguments | length) != 1 { error make {msg: "routing:sync requires <stream>"} }
            require-stream $workspace_config $stream_name
            routing-sync $workspace_config $workspace $stream_name $source_root | to json --indent 2 | print
        }
        "doctor" => { doctor $workspace_config $workspace $manifest_path }
        "sync" => { require-stream $workspace_config $stream_name; sync-source $manifest $workspace_config $workspace $stream_name $manifest_path }
        "setup" => {
            require-stream $workspace_config $stream_name
            doctor $workspace_config $workspace $manifest_path
            sync-source $manifest $workspace_config $workspace $stream_name $manifest_path
            remote-action $workspace_config $workspace _setup $stream_name $manifest_path | print
        }
        "up" => {
            let stream_config = (select-stream $workspace_config $stream_name)
            require-services-enabled $stream_config "up"
            remote-action $workspace_config $workspace _up $stream_name $manifest_path | print
            ensure-forward $workspace_config $workspace $stream_name
        }
        "down" => {
            let stream_config = (select-stream $workspace_config $stream_name)
            require-services-enabled $stream_config "down"
            let local_failure = (try {
                stop-forward $workspace_config $workspace $stream_name
                null
            } catch {|problem| $problem })
            let remote_failure = (try {
                remote-action $workspace_config $workspace _down $stream_name $manifest_path | print
                null
            } catch {|problem| $problem })
            if $remote_failure != null {
                if $local_failure == null { error make $remote_failure }
                let local_message = ($local_failure.msg? | default "unknown error")
                let original_inner = ($remote_failure.inner? | default [])
                error make ($remote_failure | upsert inner ($original_inner | append {msg: $"Local forward cleanup failed: ($local_message)"}))
            }
            if $local_failure != null { error make $local_failure }
        }
        "forward" => {
            if ($arguments | length) != 2 { error make {msg: "forward requires <status|restart|down> <stream>"} }
            require-stream $workspace_config $stream_name
            match ($arguments | first) {
                "status" => { run-forward-action --preserve-config $workspace_config $workspace $stream_name status }
                "restart" => { run-forward-action $workspace_config $workspace $stream_name restart }
                "down" => { stop-forward $workspace_config $workspace $stream_name }
                _ => { error make {msg: "forward requires <status|restart|down> <stream>"} }
            }
        }
        "status" => {
            let stream_config = (select-stream $workspace_config $stream_name)
            require-services-enabled $stream_config "status"
            remote-action $workspace_config $workspace _status $stream_name $manifest_path | print
        }
        "errors" => { require-stream $workspace_config $stream_name; remote-action --stream-output $workspace_config $workspace _errors $stream_name $manifest_path }
        "review" => { require-stream $workspace_config $stream_name; review $workspace_config $workspace $stream_name }
        "launch" => {
            require-stream $workspace_config $stream_name
            remote-action $workspace_config $workspace _launch $stream_name $manifest_path | print
            ensure-forward $workspace_config $workspace $stream_name
        }
        "screen" => { require-stream $workspace_config $stream_name; remote-action $workspace_config $workspace _screen $stream_name $manifest_path | print }
        "attach" => { require-stream $workspace_config $stream_name; remote-attach $workspace_config $workspace $stream_name $manifest_path }
        "probe" => { require-stream $workspace_config $stream_name; remote-action $workspace_config $workspace _probe $stream_name $manifest_path | print }
        _ => { error make {msg: "Usage: remote-workspace.nu <doctor|sync|setup|routing:inspect|routing:sync|up|down|status|errors|review|launch|screen|attach|probe|forward|lane:new|lane:list|lane:bundle|lane:drop> [arguments...]"} }
    }
}
