# Task Index

Canonical task tracker. Stable IDs remain authoritative; completed history is sharded below.

Status values: `active`, `next`, `blocked`, `done`, `parked`.

## Active

| ID | Task | Owner | Notes |
|---|---|---|---|
| T-2026-06-24-003 | Define vphone red/blue detectability workstream | Codex | Active; follow the canonical plan or source named in the task history. |
| T-2026-06-27-004 | Build clean-room local-first AI companion realtime testbed | Codex | Active; canonical continuation: `streams/companion/HANDOFF-BEHAVIOR.md`. 2026-07-19 milestone: momentum-aware phrase-finish interruption and silent-thinking performance implemented; focused tests 69/69 and real Kokoro/STT proof pass at `local/proofs/ai-companion-rtc/full-duplex-PASS-2026-07-19T13-43-27-498Z.json`. Architecture: `apps/ai-companion-rtc/docs/duplex-embodiment-architecture.md`; model gate: `streams/companion/notes/open-realtime-models-2026-07.md`. Package-wide typecheck remains blocked by unrelated concurrent provider-track/rigging errors. |
| T-2026-06-23-001 | Build OMP/SymphonyX control-plane and Dream promotion workstreams | Codex | Active; follow the canonical plan or source named in the task history. |
| T-2026-06-15-001 | Research cheap/free residential proxy sourcing | Codex | Active; (unverified 2026-07-15: this ID collides with the completed OMP Kagi browser-session task under the same ID in `docs/state/tasks/done-2026-06.md`; proxy-task source/evidence not located.) |
| T-2026-06-09-003 | Keep task tracking and durable preferences synchronized | Codex | Active; follow the canonical plan or source named in the task history. |
| T-2026-06-09-024 | Reverse/catalog useful Jimeng GenAI frontend APIs | Codex | Active; follow the canonical plan or source named in the task history. |
| T-2026-06-10-071 | Continue Slotok V1 done-goal implementation loop | Codex | Active; follow the canonical plan or source named in the task history. |
| T-2026-06-19-001 | Build OMP Discord agent-server bridge | Codex | Active; follow the canonical plan or source named in the task history. |
| T-2026-06-09-005 | Split `packages/web-access` into focused agent-tool/skill packages | Codex | Active; follow the canonical plan or source named in the task history. |
| T-2026-07-11-001 | Stabilize OMP runtime before further feature work | Arthur conversation / Harness | Active. Fleet rollout continues in the concurrent fleet-owner session (recovery-identity fix committed `668288734`, promoted; canary cycles in flight). Parallel Main landed in working tree 2026-07-15 (all focused gates green, 360 tests + typecheck; checkpoint pending): Ctrl-Q/durable-followup wedge fix (abort-gated drains, depth-counted abort gate, exactly-once follow-up delivery, notice dedup — root cause of the 019f643a session loss), Enter-on-empty-prompt submits queued follow-up, HR-122 responsibility routing (catch-all `task` retired to deprecated alias), HR-129 Slice 1 policy journal/apply/CLI substrate, Agent Hub stale-projection fix. Wave 2 (2026-07-15, commits `dc0a754e2`+`80f525be2`, blessed `16.0.1+fork.dc0a754e24ad`): HR-136 revive tool retention + yield propagation + history:// fix; HR-132 `:route` inspector slice 1; HR-124 nested spawn provenance in Hub/picker; fleet rollout typed TARGET_ERROR receipts + disposable-view prepare-rollout bridge (root cause of the canary freeze — canary needs one manual restart onto a bridged build, then live rollout closes). Overnight goal (2026-07-16, commits 911b0594a→2d684fca4, blessed `16.0.1+fork.2d684fca444b`): HR-113/121/122/124/126/127/128/130/132/135/136 + HR-035/040/063/047(partial)/033/134 IMPLEMENTED; HR-129 slices 1-2 landed; HR-125 grammar + HR-133 paging drafts await Arthur; new findings HR-137 (/restart reexecs stale execPath) + HR-138 (idle peers drop from roster). CONTINUATION HANDOFF: docs/fable/handoffs/2026-07-17-harness-continuation.md (read first in new sessions). Live ledger: docs/fable/handoffs/2026-07-16-overnight-harness-goal.md. Prior handoff: [2026-07-15 fleet-control continuation](docs/fable/handoffs/2026-07-15-omp-fleet-control-continuation.md). **Overnight session live handoff: `docs/fable/handoffs/2026-07-17-hr164-overnight.md` (supersedes the 07-17 continuation handoff as the live one).** |
| T-2026-07-03-003 | Bootstrap sharded Fable session: Primer | Fable | Active 2026-07-15. Chinese loop scheduler (FSRS + priority + interleave), promotion bridge, enrichment prompt v0, dependency-gating brief, calibration sheet. Live handoff: `streams/primer/HANDOFF-LIVE-2026-07-15.md`. |
| T-2026-07-17-001 | Email workstream: gmail census → purge → standing triage | Arthur conversation / Email | Active. Charter `streams/email/GOAL.md`; infra `packages/email-agent` (IMAP census CLI, in-package check green); dossiers `streams/email/accounts/`. Blocked-on-Arthur step: app passwords into `~/.config/email-agent/accounts.json`. Backlog inside charter: chunai.dev off Squarespace/Workspace. |
| T-2026-07-17-002 | Intake workstream: unified triage ledger + dashboard | Arthur conversation / Intake | Next. Charter `streams/intake/GOAL.md`; first sources decided (OMP agent-questions + reading queue); Twitter via existing stema/`packages/twitter-archive`. Parked until email census is running. |
| T-2026-07-19-004 | Gardener workstream (vault tending): coherent digestion, inline review, consolidation | Arthur conversation / Gardener | Active. Migration + true consolidation DONE 2026-07-19: 105 source files → 9 coherent `~/vault/topics/` notes (9,611→1,719 lines; raw at `a9196d0`, coherent at `87a0582`); hot actionables → `0-triage.md` with 32 inline fable questions (`f419bdef`); nvim `:VaultReview` loop installed (`22c2bf7`). Corpus/index/model/distillations/lexicon under `streams/gardener/`. Remaining: Arthur reviews comments; gardener resolves replies; later digest loop into Intake + periodic cmux gardener. |
| T-2026-07-18-001 | Devices workstream: one secure Android/iPhone execution core | Arthur conversation / Devices | Active. Charter `streams/devices/GOAL.md`; owns `packages/device-control`, stream-local research/operations, and `skills/fleet/mobile-device-control/SKILL.md`. Mac gateway/Desktop compute; Android scrcpy; iPhone CoreDevice iOS 27 HID gate with WDA fallback. |
| T-2026-07-19-001 | Primer/browser-context: end-to-end local browser context system | Arthur conversation / Primer | Done · No input needed · 2026-07-19. Proof: `streams/primer/browser-context/qa/ACCEPTANCE-MATRIX.md`; `local/proofs/primer-browser-context/fixture-proof/manifest.json`; `local/proofs/primer-browser-context/idle-soak/manifest.json`; `local/proofs/primer-browser-context/live-ui/report.json`; `local/proofs/primer-browser-context/live-chrome-final/result.json`; `local/proofs/primer-browser-context/live-firefox-final/result.json`. Deferred sibling systems remain out of scope; HR-234 remains separate requested harness work. |

## Retired

| ID | Task | Date | Rationale |
|---|---|---|---|
| T-2026-07-03-001 | Bootstrap sharded Fable session: Companion | 2026-07-15 | Retired; this ID is already used by the completed Fable-advisor task in `docs/state/tasks/done-2026-07.md`; current Companion continuation is tracked by `streams/companion/HANDOFF-BEHAVIOR.md` and `streams/companion/notes/overnight-program-2026-07-15.md`. |

## Next

| ID | Task | Source | Notes |
|---|---|---|---|
| T-2026-07-10-001 | Build domain-scoped trusted-source atlas | Arthur conversation / Primer | Queued; consult the named source and repository history before starting. |
| T-2026-07-03-002 | Bootstrap sharded Fable session: Playground | Fable | Queued; consult the named source and repository history before starting. |
| T-2026-07-03-004 | Bootstrap sharded Fable session: Harness | Fable | Queued; consult the named source and repository history before starting. |
| T-2026-07-08-001 | Add OMP event-driven pause/resume hooks | Arthur triage | Queued; consult the named source and repository history before starting. |
| T-2026-07-03-005 | Build speech-to-speech streaming testbed | `docs/plans/speech-to-speech-testbed.md` (queued from playground session) | Queued; consult the named source and repository history before starting. |
| T-2026-07-19-002 | Harness attention control plane: freeze metadata/lifecycle projection contract | Arthur conversation / Harness | Deferred/Next; bounded first slice documents the shared projection boundary: attention metadata is Now/Next/Waiting/Later/Hidden plus snooze/tags/bookmark/note, while Park/Continue/Fork/Tangent/Converge are epoch-fenced journal commands whose receipts derive lifecycle. Point of truth: `streams/harness/attention-control-plane.md`; implementation remains deferred. |
| T-2026-07-19-003 | Harness cmux stream-workspace routing and reconciliation proof | `docs/fable/harness-request-register.md` HR-215 + `streams/harness/attention-control-plane.md` | Implemented first slice 2026-07-19: `packages/cmux-reconcile` provides launcher targeting, pinned-workspace left/right reconciliation, conservative fixture planning/apply receipts, and a read-only live smoke against workspace:5. `bun run typecheck` and focused package tests pass (10/0); background daemon/event consumer remains deferred. |
| T-2026-06-24-002 | Design Pleometric artifact library and ASMR universe system | Conversation | Queued; consult the named source and repository history before starting. |
| T-2026-06-09-004 | Redesign async frontend LLM/Oracle runner | Conversation | Queued; consult the named source and repository history before starting. |
| T-2026-06-09-008 | Add UI snapshot tests when React UI tests are added or materially changed | Arthur preference | Queued; consult the named source and repository history before starting. |
| T-2026-06-09-015 | Add writable Slotok annotations and dry-run action endpoints | `docs/plans/slotok-workbench.md` | Queued; consult the named source and repository history before starting. |
| T-2026-06-09-022 | Plan niche research and winning-template mining | Conversation | Queued; consult the named source and repository history before starting. |
| T-2026-06-09-023 | Implement reference-profile archive and pose/template extraction | `docs/plans/ugc-studio-workstreams.md` | Queued; consult the named source and repository history before starting. |
| T-2026-06-09-025 | Capture Jimeng reference/persona/video/canvas API flows | Conversation | Queued; consult the named source and repository history before starting. |
| T-2026-06-10-064 | Migrate UGC React route onto the owned shadcn-style design system | Conversation | Queued; consult the named source and repository history before starting. |
| T-2026-06-13-001 | Generalize packetized agent workflow SOPs | Conversation | Queued; consult the named source and repository history before starting. |
| T-2026-06-13-002 | Add Effect CLI, Schema, and UI-test lint checks | Conversation | Queued; consult the named source and repository history before starting. |
| T-2026-06-13-003 | Extract private Refactoring UI design skill | Conversation | Queued; consult the named source and repository history before starting. |
| T-2026-06-13-004 | Split QA into reviewer personas | Conversation | Queued; consult the named source and repository history before starting. |
| T-2026-06-13-005 | Design centralized task metadata ledger | Conversation | Queued; consult the named source and repository history before starting. |
| T-2026-06-14-005 | Extend market-lab trading bot workstream | Conversation | Queued; consult the named source and repository history before starting. |
| T-2026-06-14-006 | Distill public momentum strategy sources | Conversation | Queued; consult the named source and repository history before starting. |
| T-2026-06-14-007 | Build ban-safe high-quality Twitter scraper | `docs/plans/twitter-archive-goal.md`; `docs/plans/twitter-archive-ui-goal.md`; `docs/twitter-archive-workstreams.md` | Queued; consult the named source and repository history before starting. |
| T-2026-06-20-033 | Continue TikTok recreation pipeline and decomposition workflow | `workflows/tiktok-recreate/`; `data/video-recreation/samuelszuchan/bootstrap-20260620/`; `packages/remotion-renderer/`; `packages/hyperframes-renderer/`; `apps/slotok-workbench/`; `docs/qa/tiktok-recreate-bootstrap-20260620.md` | Queued; consult the named source and repository history before starting. |

## Blocked

| ID | Task | Blocker | Next action |
|---|---|---|---|
| T-2026-06-09-002 | Verify Grok Twitter search through `llm_frontend_browser` | Dedicated Helium profile `~/.pi/pi-web-access/helium-grok-profile` is the only valid target; no agent-side login/challenge handling is allowed. Non-login status check found the Grok CDP port running with zero tabs, so verification still depends on Arthur completing or confirming login in that profile. Code now treats visible `Sign in` / `Log in` / `Sign up`, auth challenge, and terms prompts as manual-only `needsHuman` states, and blocked attempts persist `blocker_reason` / `recovery_step` in the frontend session ledger. | Blocked; use the recorded recovery action in repository history before retrying. |

## Completed task history

- [June 2026 completed tasks](docs/state/tasks/done-2026-06.md)
- [July 2026 completed tasks](docs/state/tasks/done-2026-07.md)

## Related Planning Docs

- `docs/plans/repo-open-tasks-and-cleanup.md`
- `streams/harness/attention-control-plane.md`
- `docs/plans/symphony-lite-rust-runner.md`
- `docs/plans/slotok-workbench.md`
- `docs/state/agent-tooling-preferences.md`
