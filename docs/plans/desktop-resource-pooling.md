# Desktop resource pooling and coordinator reclamation

## Priority

This is higher priority than the remaining prompt/roster polish. The Mac stays the interactive orchestration and native-macOS boundary. The Ubuntu desktop should own sustained browser/scraping pools, fuzz/property campaigns, full TUI stress suites, and other non-Mac-specific heavy QA whenever its health contract passes.

## Incident evidence — 2026-07-20

The Mac reboot was a watchdog panic during severe memory pressure, not a Yazi failure.

Panic process snapshot:

- Zed: 41.3 GiB resident.
- OMP processes: 6.76 GiB and 5.56 GiB for the two largest sessions, plus several smaller sessions.
- Multiple Difftastic processes: roughly 4.0–4.6 GiB each while jjui previewed the inherited whole-repo dirty diff.

The resumed coordinator later reached 17.85 GiB RSS with descendants totaling only about 0.27 GiB. `vmmap` was explicitly incomplete because macOS could not inspect Bun's allocator zone, so its category totals are not additive ground truth; it reported an 8.3 GiB physical footprint and 12.9 GiB peak. Two forced-GC heap snapshots sharpened the diagnosis: before report bundling, reachable JavaScript self-size was only 220.9 MiB despite 14–18 GiB RSS, strongly implicating native/JSC allocator retention in addition to application references. The second report grew reachable self-size to 692.2 MiB because it retained the first 165.4 MiB snapshot string, a 53.3 MiB Difftastic output string, and several whole session JSONL strings through the in-memory `Record<string,string>` report archive path. `/restart` remains the reliable reclamation boundary.

Immediate guardrails already applied:

- jjui no longer renders the giant intake diff through Difftastic.
- `task.maxConcurrency: 8`, `task.maxLiveChildren: 6`.
- `browser.maxTabsPerSession: 2`.
- New OMP version `16.0.1+fork.0bc2a7bf8184` only injects interrupted children on restart; full child discovery remains tool-driven.
- Heavy non-Mac work is recorded as desktop-first in `docs/state/agent-tooling-preferences.md`.
- `cmux memory --all --groups 15` already supplies bounded process-group attribution; the OMP report should complement it with in-process JSC/native categories rather than duplicate process-tree accounting.

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
Human login/setup sequence:

1. Arthur enters the desktop's visible local/VNC graphical session and opens a terminal there; a plain SSH shell is insufficient because `DISPLAY`, D-Bus, Secret Service, and the unlocked GNOME Keyring must belong to that login.
2. In that graphical terminal, inspect `~/dotfiles/server/ubuntu-remote/setup-remote-chrome.sh --help`, then run `install-user --dry-run`; if correct, Arthur runs `install-user`, `start --dry-run`, and `start`. Automation never runs these mutating verbs.
3. Arthur signs into Gmail and X manually in the visible dedicated Chrome profile, completing account selection, CAPTCHA, 2FA, passkeys, consent, and optional Chrome Sync himself. The profile persists remotely; no cookie/profile transfer is required.
4. From the Mac, rerun `check` and `status`. Only then may OMP establish a fresh owner-only loopback tunnel and create background targets. Any login boundary stops automation and returns control to Arthur.


## Execution notes

Isolated subagent attempts failed because the inherited dirty colocated repository could not provision an isolated Git task and reported OOM. Resume after coordinator restart using one non-isolated writable worker per described jj change, sequentially if necessary. Workers never move bookmarks; coordinator lands after focused verification.

## Low-priority follow-ups

- Bound unknown `history://agent` errors: never enumerate hundreds of known agents; return a count, a few close matches, and point to bare `history://`/IRC list pagination.
- Finish session naming from the first task/prompt so IRC shows semantic names rather than `agents-xxxxxx`.
- A background polling agent is the wrong default while memory is unstable. Prefer event-driven ownership manifests and a lightweight mechanical daemon only after resource accounting exists.
