# OMP system overhaul handoff — 2026-07-14

Read this first in the next orchestrator session. Then read:

1. [`../agent-system-overview.md`](../agent-system-overview.md) — current critique / sync surface.
2. [`../shared-workspace-brief.md`](../shared-workspace-brief.md) — Arthur's rendering, navigation, validation, and peripheral-field intent.
3. [`../automations-life-queue-brief.md`](../automations-life-queue-brief.md) — automations + life-queue design.
4. [`../../state/harness-friction.md`](../../state/harness-friction.md) — live papercuts and systemic failures.

## Arthur's operating intent

- OMP is a shared workspace. Agent transcript/journal is truth; Arthur sees switchable, prettified, interactive projections.
- Prefer direct manipulation and playable proof over logs. For high-dimensional/nondeterministic work: distributions, pairwise tournaments, metamorphic properties, pinned probes, seeded simulations, interactive maps.
- TUI grammar should be globally vim-native: normal-mode first, `i` to insert, `Esc` unwinds one level, `:` for long-tail TUI commands, `?` teaches everything.
- Agent Hub is "tmux for agents": nested child tree, `[`/`]` sibling cycling, `.` toggles historical agents, click/`gd` navigation, durable model badges, streaming preview.
- Widescreen right half is a Matuschak-style **peripheral field**, not a detail inspector: stable handles, preattentive pulses, focus-following bloom, residue trail, "what wants me".
- Route by decision entropy × blast radius × mistake legibility. Sol owns core/integral/taste-heavy work. Luna handles low-entropy, cheap, legible peripheral work and may be spawned by Sol. Other weak subscriptions are use-up lanes. Gemini Pro/Flash reserved for video understanding/decomposition.
- Do not let durable handoffs/research live only in `local://`; it is session-scoped. Durable docs go under `docs/`.

## Current git / binary state

- Current branch: `main`.
- Handoff-writing HEAD: `492695a5` — `fix(release): honor fork nightly toolchain in isolated promotion builds`.
- Installed binary before the final promotion run: `omp/16.0.1+fork.185d65765f13`, digest `b4199937…`.
- A corrected explicit promotion is running as background job `bg_1` (`mise run omp-promote`). **Do not claim HEAD is installed until that job completes and `omp --version` confirms it.**
- Promotion bug fixed at `492695a5`: ambient `RUSTUP_TOOLCHAIN=1.97.0` overrode `vendor/oh-my-pi/rust-toolchain.toml` (nightly-2026-04-29), causing `#![feature(alloc_error_hook)]` failure. Promotion now removes the ambient override for native builds; 10 promotion tests and ratchets pass.
- Prior blessed releases are retained additively under `~/.bun/bin/.omp-releases/`; rollback remains available.

## Landed functional slices (selected commits)

### Agent Hub / navigation

- `f5f45008` — `.` toggles historical/finished agents, visible hidden-count indicator.
- `9a214d23` + `851bd597` — nested spawn tree; automation rows; parked/grandchild model badges fall back to durable journal metadata.
- `c699e9b5` — selected child's live assistant tail streams in preview through the real component, byte-bounded, no finalized-prefix rescans. Live proof: `local/proofs/agent-hub-stream/`.
- `3af911f3` / related Hub slice — live `N.N tok/s`, editor-free preview, `/` search/backspace fix, normal-mode default, `v` rich/plain, help overlay. Live proof: `local/proofs/agent-hub-tokrate/round2/` (36.8 / 21.4 tok/s).
- `agent-hub.ts` shrank below the ratchet after roster extraction.

### Main TUI / editor

- `3937cb29` — fixed vim visual-mode duplicate first/last rows; test first reproduced Arthur's exact `[1,1,2,3,3]` rendering. Live extension is a symlink to source.
- `f09c4a0d` — normal-mode `za` toggles `[Paste #N]` fold expansion; edits survive re-collapse; undo-safe; helpers extracted to `vim-lite-paste.ts`; 23/23 tests; vim-lite shrank to 1714 lines.
- `7ae59d86` — `:` command mode with `:wrap`, `:rich`, `:version`; unknown-command feedback. Current honest wrap scope: main IRC transcript cards only; IRC tool send/await/wait/roster/pending-result and final result rows still truncate. Proof: `local/proofs/command-mode/`.
- Ctrl+Q issue diagnosed: Arthur's global config had `interruptMode: wait`; reset to `immediate`. Remaining design issue: session selector persists this globally without telling the user (friction row).
- `3f4f6d22` — `/version` view model / command; blessed status, source commit, digest, session start time.
- `eeda0a0f` + `1e490931` — `/inspect`; categories Tools / Skills / Feeds / Memories / Stores / Session; `/inspect tools`, `/inspect feeds` jump directly. Proof: `local/proofs/primitives-inspector/`.

### Memory / performance

- Cold-park verified, not guessed: 39.9× child heap-slope reduction, 297/300 WeakRefs collected. Evidence: `docs/fable/rescued/subagent-memory-profile.md`.
- The 30GB symptom is mainly JSC page high-water retention, not a strong-object leak.
- Admission cap / revive path landed (`task.maxLiveChildren`, default 0 preserves prior behavior); revive uses bounded wait with no-wedge fallback.
- Transcript finalized-prefix scans: 2,002 → 1 for 2,000 streaming tail updates; independent review approved, no findings.
- RSS watermark status segment; main-session tok/s repaired.
- `/restart` process-control path fixed at `50ec6048`: control restart previously stopped the host, released ownership, then failed writing handoff; errors were swallowed and process exited 0. Fix prepares host transition, resumes ownership/session file correctly, carries explicit target executable, and surfaces errors. Round3 proof: two peers restarted same PID onto target digest; see `local/proofs/omp-rollout/round3/`.
- Bootstrap caveat: sessions started on pre-`50ec6048` binaries need one manual restart; after that, managed rollouts work.

### Promotion / rollout

- `ea5a5d45` — immutable promotion pipeline (`scripts/omp-promote.ts`), readiness gates, receipts, rollback retention, mise task.
- `1a35eabb` — post-commit hook triggers background promotion for commits touching `vendor/oh-my-pi/`; 2h automation is the backstop. Global `core.hooksPath=~/.config/git/hooks` had shadowed local hooks; global post-commit is now a dispatcher to repo-local hooks.
- `8c7de0dd`, `185d6576`, `2a1fc555`, `50ec6048` — `omp rollout`, external-peer build/version metadata, sequential safe rollout, working/legacy skips, honest `BLESSED` vs `ROLLOUT incomplete` reporting, fixed same-PID restart.
- `492695a5` — promotion native build honors fork nightly toolchain.
- Important transient seen earlier: post-commit promotions sometimes failed `git worktree add` with `.git/index: Not a directory` during concurrent git activity; a direct retry succeeded. The shared promotion lock prevents duplicate promoters but does not serialize unrelated git operations. If this recurs, make worktree snapshot creation retry boundedly on transient index errors.

### Feeds / Twitter / data visibility

- `packages/availability-watcher`: generic feeds registry (`feeds.yml`, nitter/rss/page-hash, classifier profiles). Tibo + Anthropic availability are first profile.
- `/feeds list|add|sync`; `feed://<name>` digest surface.
- Twitter content boundary: canonical tweet content in `data/twitter-archive/twitter-archive.sqlite`; watcher SQLite is cursor/classification/delivery state only.
- Tiered policy (`b04fc563`):
  - `corpus`: cared-about accounts, exhaustive timeline + yearly windows + Wayback + threads/media + token-bucket pacing spread through day.
  - `news`: recent-only, cadence-based, no thread/media archaeology (thsottiaux belongs here).
- Corpus seeds recovered from prior sessions: pleometric, teortaxestex, repligate, max_paperclips, voooooogel, _xjdr, ludwigABAP, lumpenspace, deepfates.
- Full-sync proof: thsottiaux 1→591 (historical work was done before the policy clarification; do not repeat it), pleometric 85→655 +163 media.
- `33879563`: `scripts/vendor-sync.ts`, `catalog/vendors.yml`, ff-only/dry-run default. 22 entries. `vendor/oh-my-pi` pinned forever. Daily automation remains dry-run until Arthur reviews the manifest.

### Automations / life queue

- `ef330a32`, `eb933c87`: `omp automations list|run|status|daemon`, strict YAML registry, interval/daily schedules, stable resumable journals, JSONL ledgers, cheap-lane default, clean one-shot exit.
- Automations in `~/.omp/agent/automations.yml`:
  - twitter-sync every 45m, enabled, Luna.
  - availability-sync every 1h, enabled, Luna.
  - omp-immutable-promotion every 2h, enabled, Luna (backstop to post-commit hook).
  - vendor-sync daily@06:00, enabled but prompt is dry-run pending manifest approval.
  - refund-pursuit daily@09:00, disabled pending Arthur review; case and packet are private at `local/refund-case/`.
- `682b052b`: life queue in `packages/control-plane`; abandoned-session intake recovered 43 paused/resumable items.

## Verification summary

Latest observed union before the handoff:

- Coding-agent: 120 pass, 0 fail, 389 expectations across 12 focused files; package typecheck clean.
- vim-lite: 23 pass, 0 fail, 84 expectations.
- vendor/promote: 12 pass, 0 fail; promotion tests later expanded to 10 and passed after toolchain fix.
- Ratchets: file-size, root-litter, twin-parser all green.
- Agent Hub streaming preview: 83/83 Hub tests; real preview frames changed 6 seconds apart.
- Restart path: 56 focused tests + live round3 same-PID two-peer proof.

## Primary unresolved work (priority order)

1. **Confirm final promotion result.** Background job `bg_1` must finish. Record new `omp --version`, digest, receipt. If it fails again, stable is preserved; diagnose from the exact log before claiming rollout.
2. **Current session fleet bootstrap:** every session started before `50ec6048` needs one manual restart. Thereafter, post-bless rollout manages capable idle/waiting sessions; working sessions are skipped (no deferred safe-boundary command exists yet).
3. **120-request child decapitation:** PrimitivesInspector, WrapRichCommands, VendorSync, AutomationsDefectFix, and RestartPathDebugger all hit the soft request budget after useful work, often yielding no final output. Fresh finisher pattern recovered disk work, but this is a systemic tax. Need checkpoint-before-budget / automatic partial-yield, or raise/request-budget based on packet class. Taxonomy class: child cancellation output loss.
4. **Revived-agent wake-drop:** 2/2 parked agents read injected directives then silently parked without work/reply; fresh spawns succeeded. Likely injection-to-turn boundary / revive handling. High-severity friction row.
5. **Wrap coverage:** extend `:wrap` from main IRC transcript cards to the remaining transcript/tool-result render surfaces; do not wrap roster single-line rows unless designed separately.
6. **Peripheral field + browser component layer:** design is captured, not built. Recommended first browser component: side-by-side subagent run comparison (prompt/packet/route/timeline/outcome).
7. **Worker-pool echo stub:** still incomplete and misleading under `vendor/oh-my-pi/packages/coding-agent/src/task/subagent-worker-*`; either delete (recommended) or extract the real TaskTool execution contract. Do not present it as implemented.
8. **cmux nine-finding slice:** preserved but not independently reverified in this session.
9. **Storage decisions requiring Arthur:** `local/voiceink-store-backup-20260713` (~8.3GB); personal screenshots → private store; root `fix.js`; worker-pool stub deletion.
10. **Refund automation:** enable only after Arthur reviews `local/refund-case/automation-packet.md`; it is draft-gated and must never send without explicit approval.

## Systemic lessons from this session

- Unit-green is not live proof. The first Hub tok/s implementation passed synthetic tests but never rendered for a real child; the live PTY proof caught the false `isStreaming` gate.
- A promotion can bless successfully while rollout fails. Report these as separate states. Never relabel rollout failure as promotion failure.
- Every per-slice ratchet exception must be dated. `interactive-mode.ts` was re-frozen at 4030 for `/inspect <category>` after a real import fold; next touch should extract overlay/selector bridge logic.
- Cheap-lane work is successful when error legibility is high: Luna delivered `/feeds`, inspector finishing, hook wiring, vim folding, vendor sync, and multiple recovery passes.
- Background agent outputs need automatic salvage. The filesystem often contained finished work even when the 120-request job reported `(no output)`.
- Durable docs and manifests matter: 146 stranded local files were triaged; 61 rescued; session logs/proofs reclaimed ~2.17GB via verified compression.

## First commands for the next session

```bash
cd ~/agents
omp --version
git log --oneline -25
mise run omp-promote              # only if HEAD is not blessed and no promotion is active
bun run lint:ratchets
cd vendor/oh-my-pi/packages/coding-agent && bun run check:types
```

Then run `/version` inside the new session and compare it to `git rev-parse --short=12 HEAD` for fork-touching commits.
