# Stream services

From `~/agents`, use `mise run up companion` to start a stream in dependency order, `mise run status [stream]` to inspect health, and `mise run down companion` to stop its tmux session. `mise run up all` starts every registered stream. The equivalent direct form is `bun scripts/streams.ts <command>`.

Logs are appended under `local/services/<stream>/<service>.log`. `mise run logs <stream> [service]` follows one with `tail -f` (the last non-shared service is the default); press Ctrl-C to leave the service running. `mise run attach <stream>` attaches to `svc-<stream>`, whose windows are named for services; detach with Ctrl-B then D.

To add a stream or service, edit root `services.yml`. Give each service a repo-relative `cwd`, `cmd`, `health` (`url`, `tcpPort`, or a narrowly scoped `command`, plus `timeoutSec`), optional `env`, and `dependsOn`. Dependencies must name services in the same stream; the runner rejects cycles and waits for each dependency's health before starting its dependents.

`portless-proxy` is a shared singleton. Streams that need named routes declare it with `shared: true` and TCP health on port 1355. `up` reuses it or starts the exact shared proxy command; it does not get a tmux window, and `down` never stops it.
