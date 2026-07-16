# Lane services + zellij workspace — spec

2026-07-16 · direction spec, not an implementation plan. Owner: harness stream.

## The vibe

Everything that should be running is just… running. Arthur never babysits a server, never wonders "is the companion stack up?", never opens yet another cmux window to check. There is **one place to look**: a zellij workspace that feels like his tmux — same muscle memory, same shortcuts — but nicer, more custom, and with a fleet view where every lane's services (companion, xanadu, primer, playground, portless, desktop GPU queue) show green, with logs a keystroke away and restart one key. Agents get the same view through a CLI, so orchestrators stop groveling through `lsof`/`tmux ls`/ssh like tonight.

## What we actually want

1. **Always-on lanes.** Lane servers/daemons survive crashes, logouts, reboots. Nobody "starts the dev server" anymore.
2. **One home: zellij.** Finish the tmux→zellij port that's already half-done in the dotfiles (`local/dotfiles-mise-shims/docs/zellij-tmux-migration.md`, tmuxish plugins). Priority: **muscle memory first** — the tmux prefix/bindings, session switching, copy-mode habits get ported before any new fanciness. Then the custom config gets to grow (own bar, own layouts, per-stream tabs).
3. **One fleet view inside that home.** A dedicated tab showing all services + health + logs. Not a separate app, not another window.
4. **One registry.** Services declared once, in one file. The registry drives the supervisor, the fleet view, and the agent CLI. No second convention, no per-app bespoke watchdog scripts (the `com.companion.stack` one from tonight gets absorbed and deleted).
5. **Agent seam.** `status / logs / restart <service>` callable by agents and scripts; later this becomes `omp services` in the harness.

## The shape (three thin layers, each replaceable)

- **Supervisor** (owns processes, restarts, health): `process-compose` — compose-style semantics that fit the ask: probes, dependencies, restart policies, detached mode, API. It's Go; that's the accepted cost.
- **Boot glue** (starts the supervisor at login): one launchd agent on the Mac, one systemd-user unit on the desktop. That's all launchd does — everything else lives in the registry.
- **Workspace** (the human surface): zellij, with the ported-tmux config; the fleet tab is just `process-compose attach` (or the supervisor's TUI) living in the layout.

## What exists already

- Dotfiles zellij migration: tmuxish + tmuxish-bar WASM plugins, compact layout, fish wrappers, Ctrl-a navigation — built but not daily-driven; the port-my-shortcuts pass is the unfinished part.
- Tonight's interim: launchd `com.companion.stack` keeps the companion stack alive (works, but bespoke — fold into the registry then delete); `motion-oracle` + `soak-watch` in Mac tmux; five desktop tmux sessions incl. the gpu-queue daemon.
- Installed: zellij 0.44.3, process-compose 1.94. (mprocs rejected and uninstalled — Arthur, 2026-07-16.)

## Taste calls (Arthur)

- **Supervisor:** process-compose (right semantics, Go) vs "zellij panes + tiny watchdog" (most native, most DIY). Default if unpicked: process-compose.
- **How much zellij customization** before diminishing returns — port shortcuts only, or go full custom bar/layout land?
- **Desktop now or later** — Mac first is the default; desktop keeps tmux until the Mac shape feels right.

## Order of work (each step usable on its own)

1. Port tmux muscle memory → zellij config; daily-drive it. (dotfiles workstream, respect its AGENTS.md)
2. One registry file with the Mac lane services; supervisor runs detached; boot glue on.
3. Fleet tab in the zellij layout; kill the bespoke companion watchdog + stray tmux sessions.
4. Desktop: same registry pattern, systemd-user, gpu-queue absorbed.
5. `omp services` seam (harness request register; not now).

## Control-plane seam: ownership and lifetimes (decided 2026-07-16)

Arthur asked whether lane/dev services should merge into the OMP control plane / service daemons. Direction:

- **Two lifetimes, never conflated.** Lane services (dev servers, daemons, dashboards) are machine-scoped: they live with the login session and must survive any OMP session death, promote waves, and TUI restarts. OMP session runners (HR-026 per-session runner daemon) are session-scoped and die with their session's purpose. Dev servers therefore NEVER run inside an OMP daemon.
- **Merge the surface, not the supervisor.** process-compose stays the sole process owner (registry-driven, launchd/systemd-user boot glue). OMP gets a read/act seam over its API: `omp services` CLI + a Control Plane services pane (status / health / logs / restart). The control plane is a projection and actuator, never a second writer or owner of processes (HR-162).
- **Ownership.** The registry file declares services; each stream owns its entries; the harness stream owns the supervisor + seam. Per-stream always-on dev servers (the "check progress anytime" ask) are registry entries; bespoke `dev:up` restart loops and watchdogs get absorbed into supervisor restart policies and deleted.
- **Lifetimes.** Supervisor = login session (KeepAlive). Services = restart-on-crash per registry policy. OMP sessions = ephemeral clients. Agent QA still boots its own instances — registry services are Arthur's review surfaces, not QA fixtures.
- **Two views, one API.** The zellij fleet tab remains the human home (step 3 above); the Control Plane services pane is the agent/operator view. Both read the same process-compose API — no second convention.
