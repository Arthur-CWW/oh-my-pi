# Harness hot reload

Status: CURRENT operator note; lifecycle authority and target behavior are defined by the [canonical harness runtime contract](../fable/harness-runtime-contract.md).

`/reload-config` rereads supported settings in the running process. Runtime overrides may still shadow disk, and existing sessions are not reconstructed; route provenance must be inspected rather than assuming the disk edit became active.

`/restart` is process replacement, not hot reload and not a view reattachment. It flushes the current JSONL, clears the editor draft, spawns a detached replacement with inherited executable prefix, cwd, environment, stdio, config/model flags, and `--resume <session-id>`, then shuts down the old process. JSONL and artifacts persist. JS heap objects, child/job registries, in-flight subagents, MCP runtime, queued swaps, editor buffers, and other process-local state do not.

**BROKEN/GAP:** the current sequence spawns the replacement before shutdown releases the existing session ownership lease. The replacement can observe a live external owner and fail to resume while the old process then exits. Inherited stdio and a surviving cmux pane do not provide a release/acquire/readiness handshake and must not be described as reliable continuity.

Use rebuild plus `/restart` only with that limitation understood. If replacement fails, respawn the pane and resume the same session manually after the old owner is gone. A second resume targets the same identity; it must acquire the lease or attach as an observer, never silently fork.

**TARGET:** ordinary UI reload is detach/reattach to a long-lived `SessionRunner`; view disposal never disposes the session. Process replacement remains separate and is **DEFERRED** until it has an explicit old-owner release, new-owner acquire, readiness acknowledgement, and failure rollback. Continuing an in-flight provider turn across replacement is also **DEFERRED**.
