# OMP system overhaul handoff — 2026-07-14

Read this first in the next orchestrator session. Then read:

1. [`../agent-system-overview.md`](../agent-system-overview.md) — current critique / sync surface.
2. [`../shared-workspace-brief.md`](../shared-workspace-brief.md) — Arthur's rendering, navigation, validation, and peripheral-field intent.
3. [`../automations-life-queue-brief.md`](../automations-life-queue-brief.md) — automations + life-queue design.
4. [`../../state/harness-friction.md`](../../state/harness-friction.md) — live papercuts and systemic failures.

## Arthur's operating intent

- OMP is a shared workspace. Agent transcript/journal is truth; Arthur sees switchable, prettified, interactive projections.
- Prefer direct manipulation and playable proof over logs. For high-dimensional/nondeterministic work: distributions, pairwise tournaments, metamorphic properties, pinned probes, seeded simulations, interactive maps.
- TUI grammar is normal-mode-first on viewer surfaces: writable full-TUI/editor surfaces use `i` for insert; `Esc` unwinds one level; `j`/`k` move one line, `J`/`K` move five lines, `g`/`G` jump ends, `za` folds, `[`/`]` cycle siblings, `/` searches, `?` teaches, and `:` opens TUI commands. The read-only Hub preview accepts no message input or follow-up—no `i`, `Ctrl-Enter`, or queued follow-up; `Enter` attaches the selected session in the full TUI. `u`/`d` and `Ctrl-U`/`Ctrl-D` are half-page aliases there, while `PgUp`/`PgDn` remain full-page actions.
- Agent Hub is "tmux for agents": nested child tree, `[`/`]` sibling cycling, `.` toggles historical agents, click/`gd` navigation, durable model badges, selected-child streaming preview, rollout state, and contextual help.
- Widescreen right half is a Matuschak-style **peripheral field**, not a detail inspector: stable handles, preattentive pulses, focus-following bloom, residue trail, "what wants me".
- Roles, providers, model IDs, APIs, and execution lanes remain distinct. Gemini Antigravity is reserved for video understanding/decomposition; native inline video uses only `google-antigravity/gemini-3.5-flash` and strict `<100MB` payloads.
- Do not let durable handoffs/research live only in `local://`; it is session-scoped. Durable docs go under `docs/`.

## Current git / binary state

- Current branch: `main`.
- Previously promoted fork-touching source remains `492695a5`; installed binary remains `omp/16.0.1+fork.492695a5acfc`, digest `0e4534c2e1be33c995e4b85296d2919092c1ca115bd2a04aabc469c81d685d62`.
- The focused overhaul changes documented below are current source/working-tree status, not a claim that the installed blessed binary already contains them; promotion follows the final focused proof gate.
- Final promotion succeeded in 106.81s. Receipt: `vendor/oh-my-pi/local/readiness-receipt-0e4534c2e1be33c995e4b85296d2919092c1ca115bd2a04aabc469c81d685d62.json` (receipt SHA-256 `5648b36c…`). Rollout correctly skipped this working session and another working dotfiles session; one legacy dotfiles peer needs one manual restart.
- Promotion bug fixed at `492695a5`: ambient `RUSTUP_TOOLCHAIN=1.97.0` overrode `vendor/oh-my-pi/rust-toolchain.toml` (nightly-2026-04-29), causing `#![feature(alloc_error_hook)]` failure. Promotion now removes the ambient override for native builds; 10 promotion tests and ratchets pass.
- Prior blessed releases are retained additively under `~/.bun/bin/.omp-releases/`; rollback remains available.

## Landed functional slices (selected commits)

### Agent Hub / navigation

- `.` toggles historical/finished agents, with a visible hidden-count indicator; nested spawn trees preserve parent lineage and durable model badges.
- Selected-child preview streams a byte-bounded assistant tail without finalized-prefix rescans; selected state and rollout phases are journal-backed projections, not a second authority.
- Hub preview is strictly read-only: no `i`, message input, `Ctrl-Enter`, or follow-up. `Enter` attaches the selected session in the full TUI; `j`/`k` move one line, `J`/`K` five lines, `u`/`d` and `Ctrl-U`/`Ctrl-D` half a page, `PgUp`/`PgDn` a full page, `g`/`G` to the ends, `/` search, `?` help, `v` rich/plain, `za` fold, and `[`/`]` cycle siblings.
- `v` switches rich/plain preview; roster rows remain intentionally single-line while transcript and tool-result bodies honor the shared display state.
- `agent-hub.ts` remains below its line-count ratchet after roster extraction.

### Main TUI / editor

- Vim visual-mode duplicate first/last rows are fixed; normal-mode `za` folds `[Paste #N]` pills and preserves edits through re-collapse.
- The registry-backed `:` popup now exposes `:commands`, `:wrap`, `:rich`, and `:version`; completion, focus restoration, and unknown-command feedback are explicit. Colon is for TUI/view-local projection commands and shortcuts; slash remains the durable/mixed/session/runtime/model/queue namespace.
- `:wrap` and `:rich` cover IRC communication and tool-result body surfaces; receipts, errors, metadata, and roster rows remain bounded single-line projections.
- `Ctrl-Q` is the direct cancellation cutover for active work (including focused children); `Ctrl-Enter` is the follow-up queue action. The old global `interruptMode` explanation is no longer the binding contract.
- `/version` and `/inspect` retain their durable/runtime surfaces; `?` and `:commands` project help from the shared interaction registry.
### Native video

- Typed media now flows through startup/file mentions, prompts, durable queues, session persistence, compaction, and provider conversion.
- Native inline video is strict: only the Antigravity provider/model lane accepts it, payloads must be valid allowed-MIME base64 under `100MB`, and oversized or unsupported input fails explicitly. Frame-sampling evaluation remains a separate fallback, not native video.

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
- Vendor sync is manifest-v2 and typed: the current manifest has 21 entries (NCode removed), pins are a no-I/O boundary, and tracked entries require exact upstream/remote/branch identity with clean fast-forward proof. The typed daily `--apply` path is active; the latest live apply updated codex, plugins, cua, chrome-devtools, and whisper, left cmux blocked by a dirty tree, and left pins untouched. Unit Git fixtures remain blocked by Bun-test EBADF.

### Feeds / Twitter / data visibility

- `packages/availability-watcher`: generic feeds registry (`feeds.yml`, nitter/rss/page-hash, classifier profiles). Tibo + Anthropic availability are first profile.
- `/feeds list|add|sync`; `feed://<name>` digest surface.
- Twitter content boundary: canonical tweet content in `data/twitter-archive/twitter-archive.sqlite`; watcher SQLite is cursor/classification/delivery state only.
- Tiered policy (`b04fc563`):
  - `corpus`: cared-about accounts, exhaustive timeline + yearly windows + Wayback + threads/media + token-bucket pacing spread through day.
  - `news`: recent-only, cadence-based, no thread/media archaeology (thsottiaux belongs here).
- Corpus seeds recovered from prior sessions: pleometric, teortaxestex, repligate, max_paperclips, voooooogel, _xjdr, ludwigABAP, lumpenspace, deepfates.
- Full-sync proof: thsottiaux 1→591 (historical work was done before the policy clarification; do not repeat it), pleometric 85→655 +163 media.
- `33879563` — `scripts/vendor-sync.ts`, `catalog/vendors.yml`, and the manifest-v2 policy. The current manifest has 21 entries (NCode removed); `vendor/oh-my-pi` remains pinned forever. The latest live `--apply` updated codex, plugins, cua, chrome-devtools, and whisper, while cmux was blocked by a dirty tree and pins were untouched. Unit Git fixtures remain a Bun-test EBADF residual.

### Automations / life queue

- `ef330a32`, `eb933c87`: `omp automations list|run|status|daemon`, strict YAML registry, interval/daily schedules, stable resumable journals, JSONL ledgers, cheap-lane default, clean one-shot exit.
- Automations in `~/.omp/agent/automations.yml`:
  - twitter-sync every 45m, enabled, Luna.
  - availability-sync every 1h, enabled, Luna.
  - omp-immutable-promotion every 2h, enabled, Luna (backstop to post-commit hook).
  - vendor-sync daily@06:00, enabled with typed `--apply` active; the latest live apply updated codex, plugins, cua, chrome-devtools, and whisper, while cmux was blocked by a dirty tree and pins were untouched. Unit Git fixtures remain blocked by Bun-test EBADF.
  - refund-pursuit daily@09:00, disabled pending Arthur review; case and packet are private at `local/refund-case/`.
- `682b052b`: life queue in `packages/control-plane`; abandoned-session intake recovered 43 paused/resumable items.

## Verification summary

Latest observed focused evidence:

- `packages/catalog`, `packages/ai`, and `packages/agent` typechecks passed.
- `packages/coding-agent` typecheck passed after the final fix.
- Consolidated focused gate: 400 pass, 1 skip; automations: 15/15; all focused TUI and video suites passed.
- Native-video live transport proof is complete: 3/3 structured JSON results parsed with exact MP4 byte/SHA-256 verification, `attachmentVerified=true`, `framesPassed=0`, and `rawMediaCopied=false`; see `data/provider-evals/video-understanding/runs/antigravity-native-sam-20260714e/combined-summary.json`. This proves transport and attachment handling, not semantic quality: `semanticQualityReleaseGrade=false` with 0/3 semantic passes because of impossible timestamps, source-ID drift, and hallucinated numeric claims; see `data/provider-evals/video-understanding/runs/antigravity-native-sam-20260714e/quality-report.md`.
- Selector availability flicker is fixed by auth-generation/CAS fencing and stale-refresh suppression.
- Agent resource/error aggregation is landed: failed non-cancelled children aggregate in typed `ErrorInbox` records with transcript/final-output recovery links; `agent://` retains a `history://` pointer and invalid `agents://` suggests the singular protocol.
- Vendor unit Git fixtures still fail under Bun-test with EBADF; cmux apply remains blocked by a dirty tree; pins remain untouched.

## Primary unresolved work (priority order)

1. **Native-video semantic quality gate:** `semanticQualityReleaseGrade=false` (0/3 semantic passes); impossible timestamps, source-ID drift, and hallucinated numeric claims remain in `data/provider-evals/video-understanding/runs/antigravity-native-sam-20260714e/quality-report.md`. Fix prompt/schema/evidence grounding before release.
2. **Vendor residuals:** typed daily `--apply` is active for the 21-entry manifest, but cmux remains blocked by a dirty tree and unit Git fixtures remain blocked by Bun-test EBADF; pins remain untouched.
3. **Current session fleet bootstrap:** sessions started before the fixed restart/promotion revisions still need one manual restart; working sessions remain safely skipped.
4. **Revived-agent wake-drop:** parked-agent IRC revival can still consume a turn without work/reply; fresh spawns remain the workaround.
5. **Peripheral field + browser component layer:** design is captured, not built. Recommended first browser component: side-by-side subagent run comparison (prompt/packet/route/timeline/outcome).
6. **Worker-pool echo stub:** still incomplete and misleading under `vendor/oh-my-pi/packages/coding-agent/src/task/subagent-worker-*`; either delete or extract the real TaskTool execution contract. Do not present it as implemented.
7. **cmux nine-finding slice:** preserved but not independently reverified in this session.
8. **Storage decisions requiring Arthur:** `local/voiceink-store-backup-20260713` (~8.3GB); personal screenshots → private store; root `fix.js`; worker-pool stub deletion.
9. **NCode external residual:** active NCode integrations are removed from the agents repo and user-local OMP surfaces; an external dotfiles residual remains until its owner responds.
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
