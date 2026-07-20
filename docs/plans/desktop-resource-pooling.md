# Desktop resource pooling and coordinator reclamation

## Priority

This is higher priority than the remaining prompt/roster polish. The Mac stays the interactive orchestration and native-macOS boundary. The Ubuntu desktop should own sustained browser/scraping pools, fuzz/property campaigns, full TUI stress suites, and other non-Mac-specific heavy QA whenever its health contract passes.

## Incident evidence — 2026-07-20

The Mac reboot was a watchdog panic during severe memory pressure, not a Yazi failure.

Panic process snapshot:

- Zed: 41.3 GiB resident.
- OMP processes: 6.76 GiB and 5.56 GiB for the two largest sessions, plus several smaller sessions.
- Multiple Difftastic processes: roughly 4.0–4.6 GiB each while jjui previewed the inherited whole-repo dirty diff.

The current resumed coordinator later reached 17.85 GiB RSS with descendants totaling only about 0.27 GiB. `vmmap -summary` attributed 11.0 GiB resident to WebKit Malloc and 6.9 GiB to JS VM Gigacage. This means the dominant cost is retained/coarsely reclaimed coordinator/Bun JavaScript memory, not live child processes. GC cannot free referenced transcript/tool/cache state, and the allocator may retain freed pages; `/restart` is currently the reliable reclamation boundary.

Immediate guardrails already applied:

- jjui no longer renders the giant intake diff through Difftastic.
- `task.maxConcurrency: 8`, `task.maxLiveChildren: 6`.
- `browser.maxTabsPerSession: 2`.
- New OMP version `16.0.1+fork.0bc2a7bf8184` only injects interrupted children on restart; full child discovery remains tool-driven.
- Heavy non-Mac work is recorded as desktop-first in `docs/state/agent-tooling-preferences.md`.

## Required changes

### Coordinator memory

Add a bounded `:memory` report:

- coordinator RSS, heap used/total, external/array buffers;
- owned child worker RSS;
- browser/app process RSS;
- other owned subprocess RSS grouped by tool;
- retained transcript/tool-result/cache estimates where measurable;
- total and explicit reclaim action.

Add configurable automatic checkpoint/restart for session-backed coordinators at an idle turn boundary. It must never restart during a tool call, pending child settlement, active browser transaction, or unsaved in-memory-only session. Provide warning, grace, opt-out, and durable reason/evidence. Do not rely on blind forced GC.

### Desktop parity and dispatch

Dotfiles/mise are authority. Add one read-only parity report for:

- pinned mise tools;
- agents/dotfiles revisions or immutable source artifact;
- required runtimes/packages;
- disk/RAM/GPU health;
- remote Chrome and worker-service health.

Add explicit dispatch profiles for browser/scrape, fuzz/property, TUI stress/full QA, and GPU. Refuse dirty/mismatched source unless given an immutable commit/change artifact. Every run owns a remote process group, durable manifest/log, status/cancel command, and artifact retrieval.

### Browser pool

Use the existing dedicated Ubuntu Chrome contract, not profile copying:

- official Chrome; owner-only dedicated profile;
- visible graphical session, GNOME Keyring/Libsecret;
- CDP only on remote loopback through an owner-only SSH tunnel;
- attach-only, background targets, no local fallback;
- task-group ownership for tabs so a group can be hidden/closed/reclaimed together;
- Gmail/X login is completed manually by Arthur in the visible Ubuntu session; never inspect/export cookies, passwords, tokens, or browser userdata.

Live preflight on 2026-07-20 failed safely: `setup-remote-chrome.sh check` reported `DISPLAY does not identify a local X11 graphical session`. Recovery must use the dotfiles setup script's documented graphical-login workflow; do not improvise or weaken the keyring/display boundary.

## Execution notes

Isolated subagent attempts failed because the inherited dirty colocated repository could not provision an isolated Git task and reported OOM. Resume after coordinator restart using one non-isolated writable worker per described jj change, sequentially if necessary. Workers never move bookmarks; coordinator lands after focused verification.

## Low-priority follow-ups

- Bound unknown `history://agent` errors: never enumerate hundreds of known agents; return a count, a few close matches, and point to bare `history://`/IRC list pagination.
- Finish session naming from the first task/prompt so IRC shows semantic names rather than `agents-xxxxxx`.
- A background polling agent is the wrong default while memory is unstable. Prefer event-driven ownership manifests and a lightweight mechanical daemon only after resource accounting exists.
