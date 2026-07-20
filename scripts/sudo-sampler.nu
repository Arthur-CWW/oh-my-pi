#!/usr/bin/env -S nu --no-config-file
# Fast sudo-invocation sampler (HR-168 evidence). Catches short-lived sudo processes the
# 5m reaper misses: samples every 2s for 12h, logging command + full parent chain.
# Started via nohup; self-terminates. No sudo, read-only.
#
# Snapshot source is the external `/bin/ps`, not Nushell's builtin `ps`: on macOS the
# builtin (sysinfo) cannot see euid=0 processes, and `sudo` runs euid=0 during its
# Touch-ID/auth phase — the exact window this sampler must catch. All filtering and
# parent-chain traversal below is done with idiomatic Nushell structured tables.

const OUT = "/Users/arthur/agents/local/night/sudo-sampler.log"

# Local ISO-8601 timestamp with tz offset, matching `date -Iseconds` (e.g. 2026-07-17T00:31:38+10:00).
def now-iso []: nothing -> string {
    date now | format date "%Y-%m-%dT%H:%M:%S%:z"
}

# Snapshot every process as a structured table: {pid, ppid, command} (all strings).
def snapshot []: nothing -> table {
    ^/bin/ps -axo pid=,ppid=,command=
    | lines
    | parse --regex '\s*(?<pid>\d+)\s+(?<ppid>\d+)\s+(?<command>.*)'
}

# Build the "  <-  pid:cmd" parent chain for one process, bounded to 5 hops.
# Stops at an empty/root (0 or 1) ancestor or when the ancestor is no longer in the snapshot.
def parent-chain [start_ppid: string, by_pid: record]: nothing -> string {
    mut chain = ""
    mut cur = $start_ppid
    for _ in 1..5 {
        if ($cur == "" or $cur == "0" or $cur == "1") { break }
        let info = ($by_pid | get --optional $cur)
        if $info == null { break }
        let cmd = ($info.command | str substring ..<140)
        $chain = $chain + $"  <-  ($cur):($cmd)"
        $cur = $info.ppid
    }
    $chain
}

# Given a process snapshot and a timestamp, return one CAUGHT log line per sudo process.
def catch-sudo [procs: table, ts: string]: nothing -> list<string> {
    let hits = ($procs | where {|p| $p.command == "sudo" or ($p.command | str starts-with "sudo ") })
    if ($hits | is-empty) { return [] }
    let by_pid = ($procs | reduce --fold {} {|row, acc| $acc | upsert $row.pid {ppid: $row.ppid, command: $row.command} })
    $hits | each {|h|
        let chain = (parent-chain $h.ppid $by_pid)
        $"($ts) CAUGHT ($h.pid) ($h.ppid) ($h.command)($chain)"
    }
}

# Append one line (with trailing newline) to the evidence log.
def append-line [line: string]: nothing -> nothing {
    $"($line)\n" | save --append $OUT
}

def main []: nothing -> nothing {
    let end = (date now) + 12hr
    append-line $"=== sampler start (now-iso) pid=($nu.pid) ==="
    while (date now) < $end {
        let hits = (catch-sudo (snapshot) (now-iso))
        if not ($hits | is-empty) {
            for line in $hits { append-line $line }
            sleep 5sec
        }
        sleep 2sec
    }
    append-line $"=== sampler end (now-iso) ==="
}
