# Task Index

Canonical task tracker. Stable IDs remain authoritative; completed history is sharded below.

Status values: `active`, `next`, `blocked`, `done`, `parked`.

## Active

| ID | Task | Owner | Notes |
|---|---|---|---|
| T-2026-06-24-003 | Define vphone red/blue detectability workstream | Codex | Active; follow the canonical plan or source named in the task history. |
| T-2026-06-27-004 | Build clean-room local-first AI companion realtime testbed | Codex | Active; follow the canonical plan or source named in the task history. |
| T-2026-06-23-001 | Build OMP/SymphonyX control-plane and Dream promotion workstreams | Codex | Active; follow the canonical plan or source named in the task history. |
| T-2026-06-15-001 | Research cheap/free residential proxy sourcing | Codex | Active; follow the canonical plan or source named in the task history. |
| T-2026-06-09-003 | Keep task tracking and durable preferences synchronized | Codex | Active; follow the canonical plan or source named in the task history. |
| T-2026-06-09-024 | Reverse/catalog useful Jimeng GenAI frontend APIs | Codex | Active; follow the canonical plan or source named in the task history. |
| T-2026-06-10-071 | Continue Slotok V1 done-goal implementation loop | Codex | Active; follow the canonical plan or source named in the task history. |
| T-2026-06-19-001 | Build OMP Discord agent-server bridge | Codex | Active; follow the canonical plan or source named in the task history. |
| T-2026-06-09-005 | Split `packages/web-access` into focused agent-tool/skill packages | Codex | Active; follow the canonical plan or source named in the task history. |
| T-2026-07-11-001 | Stabilize OMP runtime before further feature work | Arthur conversation / Harness | Active; follow the canonical plan or source named in the task history. |
| T-2026-07-03-001 | Bootstrap sharded Fable session: Companion | Fable | Active; follow the canonical plan or source named in the task history. |

## Next

| ID | Task | Source | Notes |
|---|---|---|---|
| T-2026-07-10-001 | Build domain-scoped trusted-source atlas | Arthur conversation / Primer | Queued; consult the named source and repository history before starting. |
| T-2026-07-03-002 | Bootstrap sharded Fable session: Playground | Fable | Queued; consult the named source and repository history before starting. |
| T-2026-07-03-003 | Bootstrap sharded Fable session: Primer | Fable | Queued; consult the named source and repository history before starting. |
| T-2026-07-03-004 | Bootstrap sharded Fable session: Harness | Fable | Queued; consult the named source and repository history before starting. |
| T-2026-07-08-001 | Add OMP event-driven pause/resume hooks | Arthur triage | Queued; consult the named source and repository history before starting. |
| T-2026-07-03-005 | Build speech-to-speech streaming testbed | `docs/plans/speech-to-speech-testbed.md` (queued from playground session) | Queued; consult the named source and repository history before starting. |
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
- `docs/plans/pi-agent-control-plane.md`
- `docs/plans/symphony-lite-rust-runner.md`
- `docs/plans/slotok-workbench.md`
- `docs/state/agent-tooling-preferences.md`
