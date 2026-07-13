# Repository de-slop plan

Date: 2026-07-13

Scope: repository root, `packages/`, `streams/`, `docs/`, `catalog/`, and `local/`. This audit deliberately excludes `vendor/oh-my-pi` internals and active stream work.

## Executive summary

The repo has three different kinds of clutter that should not be cleaned with one broad sweep:

1. **Disposable execution residue**: scratch QA scripts and write probes. These can be removed when unreferenced; the verified cases are listed below.
2. **Useful but misplaced history**: proofs, completed tasks, one-off plans, screenshots, and generated reports. These need pointers and archival rules, not deletion.
3. **Real source with unclear ownership**: `playground/`, root wrappers, provider clients, and `fix.js`. These remain untouched until their owner or durable home is explicit.

## Root inventory

| Item | Evidence | Classification | Recommendation |
|---|---|---|---|
| `fix.js` | 800 bytes, modified 2026-07-11. It performs three literal replacements against one `vendor/oh-my-pi` durable-input-queue test and writes the file in place. No root script invokes it. | One-off migration/fix script; likely spent, but destructive and vendor-specific. | Do not run. Delete after confirming its intended changes are already represented in the fork history or move its rationale to the relevant ledger first. |
| `tmp-pw/` | One 16,953-byte Playwright script, modified 2026-07-11, hard-coded to `companion.localhost:1355` and `local/companion-ui-redesign/mobile`; no references in root manifests, tasks, docs, catalog, packages, streams, scripts, apps, or playground. | Disposable QA scratch. | Deleted in this audit. |
| `tmp-pw-qa/` | Empty directory, modified 2026-07-11; no references in the same scoped search. | Disposable scratch. | Deleted in this audit. |
| `playground/` | 96 KB. Contains maintained-looking prose, a Fable notebook/scenes/prompts subtree, and `harness-runtime-map.html`; `TASKS.md` names the HTML as the interactive explainer for active task T-2026-07-11-001. | Mixed durable creative work and an active generated/interactive artifact. | Keep. Split later into an owned package/app for runnable work, `docs/fable/` for durable prose, and `local/` or an artifact location for generated previews only after references are migrated. |
| `TASKS.md` | 104,885 bytes / 229 lines. Sections are Active, Next, Blocked, and Done; the Done table starts at line 87 and dominates the file. Some rows in Next are already marked DONE or ACTIVE in prose. | Canonical tracker with accumulated history and status drift. | Keep a small canonical `TASKS.md` containing Active/Next/Blocked plus links. Move Done rows to date-sharded history such as `docs/state/tasks/done-2026-06.md` and `done-2026-07.md`. Before splitting, normalize rows whose section and inline status disagree. Preserve stable IDs and backlinks. |

## `local/` proof-artifact sprawl

Measured state: **139 top-level entries/directories and 9.7 GB**. Only 14 top-level directory names literally contain `proof`, so naming is not a reliable retention signal. Proof families also appear as `*-e2e`, `*-diagnosis`, `*-benchmark`, `*-smoke`, screenshots at the root, and multi-round directories.

High-churn examples:

- `local/restart-live-proof/`: at least `round2` through `round6`, `round3`, `round3-built`, `round3-final`, `work`, `final-work`, `agent`, and `final-agent`.
- `local/companion-voice-e2e/`: at least 26 timestamped runs plus `live-ws-smoke-2026-07-12.json`.
- `local/canary-slice-a/`: multiple copied OMP binaries around 155 MB each.
- Root-level screenshot runs for OpenAI support, Gmail, and Westpac coexist with feature folders, including obvious duplicate names also nested under `openai-cyber-abuse-cases/`.

### Proposed retention contract

1. Give every feature a stable directory: `local/proofs/<feature>/`.
2. Keep one immutable accepted run and a small `latest.json` pointer containing run id, date, source revision, command/runbook, result, and artifact hashes. A symlink may be convenient locally, but the JSON pointer is portable.
3. Keep the most recent failed run only when it explains an open blocker; link it from the active task/ledger.
4. Archive superseded runs as a compressed, checksum-named bundle outside the working tree. Delete the unpacked copy only after checksum verification and pointer update.
5. Never retain copied binaries when a build hash, promotion receipt, and reproducible build command are sufficient. Keep a binary only for an accepted release/canary that cannot be reproduced.
6. Default time windows: accepted latest indefinitely while referenced; open-blocker failure 30 days; unreferenced intermediate runs 7 days; logs/PIDs/empty stdout 3 days.
7. Do not archive personal/support evidence mechanically. First separate it from engineering proofs and apply a privacy-specific retention decision.

No `local/` content was deleted in this audit: current ledger coverage and acceptance status are not uniformly machine-readable.

## Documentation and catalog

Potential overlap, not yet proven duplicate content:

| Area | Evidence | Recommendation |
|---|---|---|
| Harness direction | `docs/fable/{harness-brief,harness-slimming,harness-runtime-contract,harness-request-register,...}` coexists with `docs/state/{harness-friction,harness-issue-taxonomy,harness-hot-reload}` and `docs/plans/harness-control-primitives.md`. | Add a single harness index declaring charter, current contract, active queue, issue ledger, and historical material. Archive only after backlinks are checked. |
| Product/design state | `docs/state/` contains multiple product-specific design-language/direction files while related plans and QA live elsewhere. | Keep state only for current durable decisions; move superseded snapshots to dated history after owner review. |
| QA history | `docs/qa/` has 60+ reports and directories, many date-suffixed. | Introduce per-feature QA indexes pointing to the accepted/latest proof; archive superseded reports by month, without rewriting evidence. |
| Empty/stale-looking docs | Root `docs/prompts.md` is 11 bytes; `docs/drafts/rork-ios-pipeline.wait.log` is 0 bytes and its adjacent wait JSON/164-byte Markdown look like interrupted work. | Treat as questions, not deletion candidates, until references and ownership are checked. |
| `catalog/` | Only `workspaces.yml` (6.7 KB) and `data-stores.yml` (27 KB). These are structured inventories, not duplicates of one another. | Keep as the machine-readable catalog boundary. Add generated validation/last-reviewed metadata rather than copying their facts into more prose. |

## Root scripts to review, not migrate now

The root manifest has 80 scripts. The main hygiene issue is centralized wrappers around self-contained packages, not proven dead code. No scripts were changed.

| Scripts | Why they are suspect under the self-contained-packages rule | Recommendation |
|---|---|---|
| `typecheck`, `test` | Hard-coded `cd` chain across many packages/apps. It duplicates package ownership and must be edited whenever packages change. | Replace later with workspace-aware orchestration or a generated package list; do not hand-maintain the chain. |
| `slotok:*`, `ugc:*`, `twitter-archive:*`, `jimeng:*`, `dynamic-workflows:*`, `market-lab:*`, `proxy-lab:*`, `library-assistant:*`, `bench-harness:*`, `remotion-renderer:*`, `hyperframes-renderer:*`, `realtime-avatar:*`, `ast-grep-guard:*`, `ios-qa:*` | Root aliases duplicate package-local commands and make the root a second command registry. | Retain only a short curated operator surface; package validation/dev commands belong in each package manifest. Inventory actual usage before removal. |
| `tiktok-recreate:minimax-tts` | Invokes `../apps/hsk-deck/...`, outside this repository root. | Confirm whether the external checkout is intentional; otherwise remove the alias or move the workflow into its owning repository. |
| `open-design:*` | Crosses into vendored code and embeds environment/toolchain setup. | Keep only if this repo intentionally owns operation of that vendor workspace; otherwise document the external operator entrypoint and remove aliases in a dedicated change. |
| `web-access:boundary:check` | Encodes a temporary no-move split policy and duplicated manifest assumptions. | Keep while T-2026-06-09-005 is active; delete with that migration, not before. |

## Provider/client duplication feeding gateway design

Counts are physical file LOC (`wc -l`), intentionally coarse: these files mix schemas, planning, CLI, and transport. The final column distinguishes actual client code from wrappers.

| Capability/provider | Location | File LOC | What is duplicated / gateway relevance |
|---|---|---:|---|
| LLM, OpenAI-compatible analysis | `packages/ugc-cli/src/codex.ts` | 237 | Direct `api.openai.com/v1/chat/completions`, API-key resolution, multimodal payload construction, fetch/error handling. Actual provider client. |
| LLM, Gemini | `packages/web-access/src/gemini.ts` | 270 | Direct Gemini REST plus separate authenticated Gemini Web transport, model mapping, timeout/cookie/upload handling. Actual provider clients with two auth modes. |
| LLM via OMP subscription route | `packages/primer-daemon/src/ask-synthesis.ts` | 184 | Spawns OMP, selects model, builds argv, streams stdout, handles timeout/stderr. Not a direct provider client, but duplicates model invocation/stream normalization concerns a gateway must expose. |
| Image/video generation, KIE | `packages/ugc-cli/src/kie.ts` | 483 | Direct KIE task create/status/credits, API-key/env loading, task input normalization, result URL parsing. Actual async provider client. |
| Image/video/TTS, Jimeng core | `packages/jimeng-client/src/client.ts` | 614 | Shared signed/session fetch, polling/download, risk-control cooldown. Actual provider client. |
| TTS/lip sync, Jimeng | `packages/jimeng-client/src/lip-sync.ts` | 638 | Provider-specific request schemas/plans/normalization; relies on Jimeng transport. Mostly capability adapter, not a second transport. |
| TTS/voice clone, Jimeng | `packages/jimeng-client/src/voice-clone.ts` | 693 | Voice lifecycle schemas/plans and provider endpoint behavior; capability adapter atop Jimeng transport. |
| TTS, TikTok recreation | `scripts/tiktok-recreate-tts.boundary.ts` | 568 | Root workflow boundary duplicates provider selection/execution and artifact concerns outside a self-contained package. Wrapper/orchestrator; inspect before gateway cutover. |

`streams/` contains no TypeScript/JavaScript provider clients in the scoped scan; the only executable source found there was two Python media-recovery utilities under Primer research. Stream documents may describe providers, but there is no additional repeated client implementation to count.

### Gateway implication

The shared seam is not a universal lowest-level HTTP wrapper. It is a job contract: capability and model selection, credential/auth mode, bounded submit, async status/stream events, artifact references, usage/cost/quota metadata, cancellation, and normalized provider errors. Keep provider-specific request schemas and signing in adapters. Avoid forcing Gemini Web cookies, OMP subscription execution, KIE jobs, and Jimeng signed browser sessions through one fake homogeneous transport.

## Mechanical cleanup applied

| Deleted | Safety evidence |
|---|---|
| `tmp-pw/mobile-companion-qa.mjs` and now-empty `tmp-pw/` | Single hard-coded one-off QA runner; outputs already target `local/companion-ui-redesign/mobile`; no scoped references; directory was 20 KB and named scratch. |
| Empty `tmp-pw-qa/` | 0 bytes; no scoped references. |
| `data/primer/backendfinish-write-test.tmp` | Two-byte file containing only `ok`; filename identifies a write probe; no references in root manifest, tasks, docs, catalog, packages, streams, scripts, or apps. |

Generated `.tmp` directories inside package tests/builds, vendored trees, `.venv`, and active stream work were not touched. The `whisper.cpp` generated Metal `.tmp` files were also left alone because they are build outputs in a separately governed subtree, not root stray files.

## Questions requiring ownership decisions

1. **May `fix.js` be deleted?** Recommendation: yes, after verifying its three edits are already present in the intended fork revision; it should never remain as an unversioned in-place vendor mutator.
2. **Is `playground/` a durable product namespace or a staging area?** Recommendation: declare it durable and split runnable pieces into owned packages/apps; do not bulk-move the active harness explainer.
3. **Who approves proof acceptance and archival?** Recommendation: the owning feature ledger must name the accepted run before cleanup; absence of that pointer blocks deletion.
4. **Should personal/support screenshots remain under engineering `local/`?** Recommendation: move them to a private, access-controlled evidence store with a separate retention policy; do not archive or delete them as build residue.
5. **Is `TASKS.md` still authoritative, or is a SQLite/control-plane ledger authoritative?** Recommendation: choose one writer. Until then, keep active Markdown but archive only Done rows and preserve IDs/backlinks.
6. **Are root script aliases a supported operator API?** Recommendation: publish a small allowlist (for example `check`, lint guards, and genuinely cross-workspace operations); remove unused package aliases only after usage evidence is collected.
7. **Are the 11-byte `docs/prompts.md` and interrupted `docs/drafts/rork-ios-pipeline.*` artifacts still owned?** Recommendation: owner review, then delete if unreferenced; their names/sizes alone are insufficient proof.
8. **Should the gateway own OMP-subscription execution as a provider adapter?** Recommendation: yes at the job/event contract, but keep OMP process/auth semantics distinct from API-key HTTP adapters.

## Executed 2026-07-13: durable-doc rescue

- Inventoried and classified all 135 files in session-scoped `local/` directories and all 11 root-level Markdown files in repo-local `local/`.
- Copied durable session documents and moved durable repo-local documents into `docs/fable/rescued/` or `docs/fable/handoffs/`, preserving provenance on every rescued copy.
- Left scratch artifacts in place and recorded personal OpenAI/cyber-abuse material as requiring a private store; none was copied into the repository.
- Full source, destination, classification, checksum, stream, and disposition inventory: [rescue manifest](../fable/rescued/MANIFEST.md).

## Executed 2026-07-13: log + proof compression

- Added `scripts/sessions-gc.ts`; dry-run remains the default and `--apply` performs checksum-verified `zstd` compression for session JSONL/log files whose session directory is older than 14 days.
- Applied it to 4,469 files: 1,313,968,252 bytes became 222,253,847 bytes, reclaiming 1,091,714,405 bytes. Per-file original SHA-256 and byte counts are in `~/.omp/agent/sessions-archive-manifest.jsonl`.
- Archived superseded restart proofs (658,694,647 bytes reclaimed), 25 older companion voice E2E runs (40,490,706), four copied canary binaries (352,705,121), and the detached heap snapshot (26,841,974).
- Proof archive source mappings, archive SHA-256 values, internal per-file checksum manifests, and the canary archive retention decision are in `local/ARCHIVE-MANIFEST.md`.
- Total reclaimed: 2,170,446,853 bytes. Sessions older than 14 days now require manual decompression before OMP resume.

## Executed 2026-07-13: ratchet re-baseline after gated wave

`file-size-baseline.json` regenerated once at wave end (122 frozen files): six files legitimately grew inside union-gated, reviewed slices (twitter full-sync worker +15, input-controller +1, builtin-registry +13 for /feeds, task executor +3 / index +39 for admission+revive, tui editor +37 for paste expansion) and agent-hub.ts's ceiling DROPPED 3397→3387 after the roster extraction. Re-baselining is a coordinator-gated, dated action — never done silently per-slice.

## Executed 2026-07-13 (2nd): interactive-mode re-baseline

`interactive-mode.ts` re-frozen at 4030 (+5 over the earlier freeze) for the reviewed `/inspect <category>` wiring after a real -1 import fold; no 6-line compaction existed without style churn. Debt recorded: interactive-mode.ts is the NEXT extraction target on touch (selector/overlay bridge cluster is the candidate boundary). Second dated exception today — a third in one day means the ratchet default is wrong, revisit then.
