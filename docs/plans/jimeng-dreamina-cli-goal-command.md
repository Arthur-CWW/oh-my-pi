# Jimeng/Dreamina Goal Command

Copy/paste this into Codex when restarting the long-running Jimeng/Dreamina workstream:

```txt
/goal Drive the Jimeng/Dreamina client extraction workstream to completion from @docs/plans/jimeng-dreamina-cli-goal.md, @docs/plans/jimeng-fast-contract-extraction.md, @docs/provider/jimeng-api-triage.md, @docs/plans/jimeng-workers/README.md, @docs/qa/jimeng-live-effect-generation-20260613.md, and @TASKS.md.

You are mainly the main GPT-5.5 orchestrator. Own completion end-to-end: select the next packet, brief subagents, integrate/review their work, run validation, update the SQLite ledger/dashboard/docs, commit reviewed waves, and continue automatically until every high-value Jimeng/Dreamina keep-family is either implemented through typed client/CLI or classified with exact evidence as blocked/skipped/unknown. Do not stop at planning, scaffolding, partial proof, or a phase boundary.

Use OMP as the operating environment. Prefer OMP task subagents for implementation by default; use task isolation/APFS CoW worktrees when available so worker edits are reviewable before integration. Keep the main context thin: the parent is mainly an orchestrator, not the default implementation worker. The parent selects packets, resolves shared contracts, performs small integration fixes, validates, updates the source of truth, and decides blockers. Delegate bounded implementation packets to subagents; delegate fresh review of each non-trivial worker result to a separate reviewer subagent before integrating. Use Gemini 3.5 Flash for simple/non-core implementation and mechanical packet work. Use GPT-5.5 `task` / `reviewer` subagents for trickier, higher-risk, or more architecture-sensitive bounded implementations because they are smarter. Use latest Kimi only as a fallback when Gemini and GPT-5.5 subagent capacity are unavailable. If Gemini starts rate-limiting or thrashing on a bounded slice, fall back to a GPT-5.5 `task` or `reviewer` subagent before absorbing that slice into the parent. Prefer rolling pseudo-waves over rigid batches: keep independent implementation/review tasks in flight, integrate each accepted slice as it finishes, and do not wait for unrelated blocked packets before advancing the next claimable packet.

Use the SQLite packet/artifact ledger as the single source of truth. First command in every continuation: `bun packages/jimeng-client/src/artifact-dashboard.ts packet next --db data/jimeng-lab/artifact-log.sqlite`.

Treat `data/jimeng-lab/artifact-log.sqlite` as authoritative live state. Docs are policy and durable summaries only. Before doing work, read the next packet from SQLite. Do not re-check packets already marked `done`. Do not revisit `blocked` packets unless the `unblock_condition` changed or you can run the listed safe prep. Every worker wave must update the packet row first, then `TASKS.md` and QA docs.

Work packet protocol:
1. Pick the highest-value claimable packet from SQLite/triage, not the easiest no-spend endpoint.
2. If the packet needs samples, gather the smallest useful live/passive/replay matrix. Arthur has approved spending when it directly proves the API/CLI; do not create dry-run detours to avoid spend. Still record exact commands/actions, artifact paths, expected credit/account risk, and keep mutating/generation concurrency at 1. Stop on `1019`, `shark not pass`, auth drift, CAPTCHA, terms gates, or account-risk prompts.
3. Run or improve `contract-infer` before hand-writing repeated schema/client/test code. Generate Effect Schema IR, typed service/client drafts, Effect CLI flag sketches, replay fixtures, endpoint-registry patches, Vitest snapshots, QA note skeletons, and dashboard artifact logging from saved samples where possible.
4. Promote generated drafts in coherent value packets: generation parity, persona/voice, lip-sync/digital-human, reference controls, template mining, then supporting reads only when they unblock higher-value workflows.
5. Use Effect APIs, Effect Schema, Effect CLI, Drizzle over Bun SQLite for ledger/run DB code, and the shared cached HTTP transport with `live`/`record`/`replay`/`fixture` modes. Decode external API/process/file data at typed boundaries. Do not add ad-hoc flags, duplicated argument parsing, one-off planners, or assertion walls when shared generators/snapshots can cover the behavior.
6. For every implementation worker: give exact target files, non-goals, acceptance commands, and instruct it not to run project-wide gates. After completion, spawn a fresh reviewer over the worker output/transcript and touched files. Parent integrates only reviewer-accepted work, fixes small integration issues, and runs the focused acceptance plus package-level validation.
7. Use the artifact dashboard as the proof surface. Workers and CLI commands should write runs/artifacts/status to `data/jimeng-lab/artifact-log.sqlite` with `--artifact-db data/jimeng-lab/artifact-log.sqlite --worker <id> --artifact-notes <text>` where supported. Keep the dashboard available at `http://127.0.0.1:4188/`.
8. After a reviewed wave validates, make a scoped commit for only the relevant files before starting the next wave. Never stage unrelated dirty files. If the worktree contains unrelated changes, inspect the exact scope and commit only the packet wave.
9. Continue to the next claimable packet immediately after ledger/docs/commit. If one packet is blocked, update its blocker/unblock condition and keep moving on other nonblocked packets; do not wait for exact waves to finish if independent work can proceed.

Current known state to honor:
- `persona-voice`, `reference-controls`, and `template-mining` are `done` in the SQLite ledger after fresh reviewer passes.
- `gen-parity` is blocked only on a fresh background Jimeng UI text-to-image submit capture; no-spend diagnostics already confirmed valid session/credits/model (`total_credit=3954`, `high_aes_general_v50` available) and stale capture mismatch.
- `lip-sync-human` is blocked on a real UI submit capture/live proof for talking-head output.
- `jimeng-dreamina` and `jimeng-browser-proxy` both support direct artifact DB logging; prefer that over post-hoc ingest.

Completion definition:
- Every high-value keep-family in @docs/provider/jimeng-api-triage.md is implemented through typed services/CLI/tests/dashboard proof, or classified in SQLite plus endpoint registry/triage as blocked/skipped/unknown with exact evidence, unblock condition, next command, and artifact path.
- Live generation/mutation paths that claim to work have actual live proof artifacts or provider responses, not dry-run substitutes.
- Package validation passes for affected Jimeng code; replay/snapshot tests cover contract/report outputs; playable/listenable artifacts are recorded for media-generating paths.
- SQLite ledger is current; TASKS and QA docs summarize only durable outcomes; each reviewed wave has a scoped commit.
```
