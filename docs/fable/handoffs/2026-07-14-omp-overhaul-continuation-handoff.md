# OMP overhaul continuation handoff — 2026-07-14

Read this first in the next orchestrator session, then:

1. [`2026-07-14-omp-system-overhaul-handoff.md`](./2026-07-14-omp-system-overhaul-handoff.md)
2. [`../shared-workspace-brief.md`](../shared-workspace-brief.md)
3. [`../harness-request-register.md`](../harness-request-register.md)
4. [`../../state/harness-friction.md`](../../state/harness-friction.md)

## Stop point

This session is intentionally stopping at a recoverable boundary:

- No direct child is running; all children are parked or terminal.
- Do **not** create `NameResume`/`Name-2` replacements blindly. Check `irc list`; DM a parked child to revive it. `RespawnPatternFix` now enforces this in source, but the installed binary is older.
- Installed binary: `omp/16.0.1+fork.d7e6b0ed373d`, SHA-256 `ddd87cbeebc8fcccd85314b5a042d6e470542b416bcae08b250ebeb6283d3754`.
- The working source contains many later unpromoted edits. Do not treat installed-binary behavior as proof of current source behavior.
- Do not run promotion until the pending source slices below are finished and the focused union is green.

## Immediate live repair: Codex 5.6 subscription access

Arthur repeatedly saw GPT-5.6 Luna/Sol/Terra disappear from `/model`, sometimes leaving only models through GPT-5.4 or GPT-5.5.

Observed cause:

- The live ChatGPT subscription `/models` response currently returns 16 models ending at `gpt-5.5`; it omits all GPT-5.6 models.
- Official Codex treats a nonempty visible ChatGPT response as authoritative and replaces the bundled picker catalog. Direct GPT-5.6 requests still work.
- OMP's live cache therefore lost 5.6 even though generated `packages/catalog/src/models.json` contained it.

Urgent local repair already applied:

- `/Users/arthur/.omp/agent/models.yml` pins GPT-5.6 Luna/Sol/Terra as custom `openai-codex-responses` models with `auth: oauth`. This uses the existing ChatGPT/Codex subscription; **no API key is required**.
- A malformed intermediate edit briefly placed `auth: oauth` under `models:`. That caused:
  `Provider openai-codex: "apiKey" is required when defining custom models unless auth is "none".`
  The file is now valid. Fresh processes no longer report this error. An already-running session that cached the error must reopen `/model` (registry refresh) or restart once.
- `/Users/arthur/.omp/agent/models.db` was seeded with the three GPT-5.6 entries so current installed OMP can resolve them.
- Live proof passed:
  `omp --model openai-codex/gpt-5.6-sol --thinking low --mode json --print --no-session --no-tools -- 'Reply exactly OK'`
  returned `OK` through provider `openai-codex`, model `gpt-5.6-sol`.

Official upstream metadata, verified against `openai/codex` main commit `5bed6447998c754d154dbd796517310b8f04d4ce`:

- GPT-5.6 Sol/Terra/Luna raw context: `372000`.
- Effective Codex input window: `353400` (95%).
- Derived auto-compact threshold: `334800` (90%).
- GPT-5.5 raw/effective/compact: `272000` / `258400` / `244800`.
- Codex model metadata and normal Responses requests expose **no max-output field** and send no `max_output_tokens`. OMP's `128000` is only an OMP fallback and must be marked as such; `omitMaxOutputTokens: true` is set in the local pin.
- Research with exact upstream permalinks: `agent://OfficialCodexLimits` or `history://OfficialCodexLimits`.

Next source fix:

1. Mechanically import `vendor/openai/codex/codex-rs/models-manager/models.json` during catalog generation.
2. Record the vendored Codex commit SHA in generated provenance.
3. Keep three layers explicit: Codex bundled metadata, live account eligibility, and OMP policy (pricing/output fallback/direct-only visibility).
4. OMP intentionally should keep directly callable 5.6 entries visible as `bundled/direct-only` even when the live account catalog omits them. Do not mislabel that as endpoint truth or official picker parity.
5. Add a vendor-bump/generated-catalog check so model metadata stays in sync.

`CodexPricing` could not write because its revived worker sandbox was read-only. Its requested alias/pricing/backfill/source-sync work is still incomplete despite generated JSON currently containing prices.

## Model degradation policy — urgent and incomplete

Arthur's decision:

- GPT-5.4 is **not** an acceptable fallback for GPT-5.6 on the main/orchestrator thread or high-entropy/core work. Prefer waiting or failing.
- Subagents may propose Kimi or Opus only after the parent orchestrator explicitly approves with its task context.
- Approval options should be: wait/retry source model with timeout, approve proposed model, choose another explicit model, or abort.
- Approval must resume the same child id/context; never respawn it.

`FallbackApprovalGate` was spawned but made no implementation progress. Its full assignment remains in `history://FallbackApprovalGate`.

Current `.omp/fable-config.yml` still has automatic fallback settings. Fix this before claiming policy compliance.

## Network/DNS outage resilience — landed in source, not promoted

The simultaneous `getaddrinfo ENOTFOUND chatgpt.com` failures were a transient Tailscale MagicDNS (`100.100.100.100`) blip. System DNS later recovered; ChatGPT and Claude failures were simultaneous because DNS, not provider auth, failed.

Source now contains:

- Shared transient-network classifier covering ENOTFOUND, EAI_AGAIN, ECONNREFUSED, ECONNRESET, ETIMEDOUT, EHOSTUNREACH, ENETUNREACH, fetch failures, and socket hangups.
- Same-model retry hold with jitter/backoff for configurable `networkHoldMs` (default 180s); no fallback during the hold.
- Network failures do not disable credentials.
- Retry cause is typed as network/rate-limit/provider and rendered distinctly in EventController/Agent Hub.
- Fleet incident detection: 3 distinct-agent failures within 120s opens one incident in shared session-control SQLite, broadcasts once, records ErrorInbox state, probes recovery, and auto-revives matching owned children once.

Focused evidence:

- `NetworkHoldFinisher`: AI and coding-agent focused retry/auth/UI suites all green.
- `FleetIncidentSalvage`: 19 tests / 110 assertions green; settings test green.

## Subagent revive ergonomics — landed in source, not promoted

`RespawnPatternFix` landed:

- Spawn refuses exact or Resume/Retry/Continue/Redo/Finish matches only when the existing idle/parked agent is genuinely resumable.
- Running duplicates get a strong warning but may proceed; terminated agents point to `history://` salvage rather than false IRC guidance.
- Failed job delivery distinguishes addressable vs terminal agents.
- Restart recovery notices list revivable ids.
- Task prompt now puts revive-first guidance at the spawn decision point.

Evidence scan (last 14 days): 1,197 spawns, 19 suffix-shaped ids, 5 same-prefix duplicate spawns across 3 orchestrator sessions; one original was explicitly parked, one idle, two still running, one failed.

Tests: task spawn/output-manager/batch, 27 pass / 111 assertions.

## Agent resource/error aggregation — landed in source, not promoted

- `agent://<id>` remains finalized-output-only.
- Missing output now should explain live/parked status and point to `history://<id>`; `agents://` gets a did-you-mean hint, not an alias.
- Non-cancelled subagent failures persist once into ErrorInbox v2 with typed facets/history URI for `:errors` aggregation.
- Current installed binary still has the older opaque `agent://` error; source behavior requires promotion.

## Native video understanding — transport works; semantic quality is not release-grade

Landed source:

- `vision -> google-antigravity/gemini-3.5-flash`.
- Typed native video survives CLI/file mentions, durable queue/session persistence, compaction/retry, and Google inlineData serialization.
- Exact proven Antigravity family is the only generated Antigravity entry advertising video.

Live transport proof:

- 1,685-byte red MP4 -> one Cloud Code Assist request -> HTTP 200 -> response exactly `red`.
- Three real Sam Szuchan MP4s produced 3/3 parsed, attachment-verified native outputs with `framesPassed=0`, no raw media copied, after 4 total calls (one preserved parser failure).
- Canonical artifacts:
  `data/provider-evals/video-understanding/runs/antigravity-native-sam-20260714e/combined-summary.json`
  `quality-evaluation.json`
  `quality-report.md`

Quality verdict:

- `semanticQualityReleaseGrade=false`.
- 0/3 clips passed deterministic semantics.
- Impossible timestamps beyond source duration occurred on all clips; clip 3 included unsupported unemployment numbers.
- Native average latency ~76.5s vs frame+VTT ~15.9s (~4.8x slower), though frame lane had transcript/context advantages.
- Final rubric now has 7 cited checks per clip, `hit|partial|miss|unsupported`, five dimensions, and same-rubric native/frame comparison.

## TUI/Hub/command UX already landed in source

- `:` completion panel and `:commands`; colon namespace for TUI/view-local projection commands, slash namespace for durable/mixed actions.
- Complete IRC body wrap/rich coverage; headers/receipts/rosters remain one line.
- Hub selected sibling streaming state, error/input/rollout summary, nested tree, `za`, siblings, history, wrap/rich.
- Hub preview is strictly read-only; Enter attaches to full TUI.
- Viewer grammar: j/k one line; J/K five lines; u/d and Ctrl-U/D half page; PgUp/PgDn full page; g/G; `/`; `?`; `v`; `za`.
- Ctrl-Q is direct interrupt/cancel; Ctrl-Enter remains follow-up.
- NCode active integrations, wrappers, install task, completion, catalog entry, and external dotfiles residuals were removed.

`gj`/`gk` display-row movement was requested later. `WrappedLineMotion` did not land it; WaveGate found no focused test. This remains pending.

## Performance — diagnosed, largely not implemented

The lag is not a TypeScript-vs-Rust problem. The observed input starvation comes from synchronous work on child progress:

1. Every child progress event invalidates/rebuilds the status border; that can synchronously stat/read Git HEAD.
2. Session observer changes repeatedly sort all sessions and rebuild todo/subagent HUDs.
3. Open Hub repeatedly projects/sorts all agents and synchronously reads up to 256 KiB of selected journal data.
4. IRC bursts request one full paint per message.

Map: `agent://TuiPerfMap`.

Pending implementation:

- `StatusEventPerf` could not write because its revived worker sandbox returned EPERM. No coalescing test exists.
- `SwarmObserverPerf` did not land its requested observer coalescing test/slice.
- `HubPreviewPerf` has existing green Hub/journal tests and `agent-hub.ts` was 3148 lines, but the requested burst/read/age perf assertions were not independently identified.

Start next session with these three slices before more UI features. Add 100–130 child synthetic swarm proof measuring input latency, render count, git HEAD resolution count, projection rebuilds, and journal reads.

## Stats/cost/dashboard — partially present, robustness pending

Current generated catalog has API-equivalent costs:

- Luna: input/output/cache-read/cache-write = `1 / 6 / 0.1 / 1.25` dollars per million tokens.
- Sol: `5 / 30 / 0.5 / 6.25`.
- Terra: `2.5 / 15 / 0.25 / 3.125`.
- GPT-5.5: `5 / 30 / 0.5 / 0`.

But source work remains:

- Generalized alias/family pricing resolver and versioned stats backfill sentinel were not completed by `CodexPricing` (read-only sandbox).
- `/stats` still lacks verified `/healthz` and `/version` routes in WaveGate's source inspection.
- Stats CLI/server lifecycle, param validation, single-flight DB init, client error states, and shutdown wiring remain unfinished.
- `StatsRobustness` did not produce verifiable source/tests.
- `/stats` browser-open paths already exist, but robust health/version handshake is pending.

## Rubric label viewer — server APIs work; root page needs repair

`packages/video-eval-viewer` exists. WaveGate observed:

- server booted;
- `/healthz` 200;
- `/api/data` 200;
- POST label appended a JSONL row;
- `errors.log` remained empty;
- GET `/` returned 404.

Fix root static page serving, then keep it running through:

`bunx portless video-eval bun run dev`

Expected review URL: `http://video-eval.localhost:1355`.

## Vendor synchronization

- Manifest schema v2, exact track metadata, pin no-I/O boundary, fail-closed locks/preflight, explicit branch refs, atomic per-success `lastSync`, and typed direct-command automation are landed.
- Live apply updated codex, plugins, cua, chrome-devtools, and whisper; cmux was correctly blocked dirty; pins untouched.
- Daily external automation is typed `command: [bun, scripts/vendor-sync.ts, --apply]`.
- Real-Git unit fixtures remain blocked under Bun test by `posix_spawn /usr/bin/git` EBADF, even though direct live dry-run/apply works. Preserve this honest proof boundary.

## Current focused verification boundary

Last observed green after selector wiring:

- catalog, ai, agent, coding-agent typechecks green.
- Model selector 11/11; registry 91/91; automations 15/15; durable queue 48/48; retry fallback 21/21; Hub queue 3/3; agent protocol 4/4; subagent ErrorInbox 2/2.
- Network hold/fleet incident/respawn focused suites green as listed above.
- Root file-size had one unrelated concurrent residual in `packages/twitter-archive/src/backfill-worker.ts`; do not edit that stream from the harness continuation.

After later unverified/pending edits, rerun focused union before promotion.

## OMP component vocabulary

Use these names consistently:

- **Runner/host** — owning process, session ownership, restarts/rollouts.
- **TUI** — terminal renderer/input scheduler.
- **InteractiveMode** — main TUI composition/orchestration object.
- **Editor** — bottom prompt/input component.
- **Command line** — colon-mode `CommandLineComponent`; completion panel above it.
- **Transcript** — user/assistant/tool rows; journal-backed projection.
- **EventController** — turns agent/session events into transcript/status updates.
- **InputController** — editor submission, interrupt, follow-up, focused-child controls.
- **SelectorController** — model/session/settings/overlay selectors.
- **Status line/border** — session/model/git/context state around the editor.
- **Agent Hub** — overlay roster/tree + read-only selected-agent preview.
- **AgentRegistry** — live/idle/parked child references.
- **AgentSession** — turn/retry/queue/compaction model-facing session state.
- **SessionManager/journal** — durable JSONL source of truth.
- **SessionObserverRegistry** — live progress projection across children.
- **IRC bus** — in-process/cross-session agent messaging and wake path.
- **ModelRegistry** — bundled/configured/discovered model catalog and availability.
- **ErrorInbox** — durable `ui_error` ledger exposed via `:errors`.
- **Internal URL router** — `agent://`, `history://`, `artifact://`, etc.

## First actions in the next session

1. Read this handoff and current `TASKS.md` row `T-2026-07-11-001`.
2. Confirm `/Users/arthur/.omp/agent/models.yml` parses and `omp --model openai-codex/gpt-5.6-sol ...` still succeeds.
3. Implement mechanical Codex bundle sync and correct generated context/output provenance.
4. Implement fallback-approval gate before changing retry chains.
5. Finish the three performance slices with swarm/input-latency proof.
6. Finish stats robustness and viewer `/` route.
7. Add `gj`/`gk` wrapped display-row motion.
8. Run focused union + file-size/typechecks; only then promote/roll out.
9. When a parked agent already owns context, DM it. Spawn fresh only when it is genuinely terminal/unaddressable.
