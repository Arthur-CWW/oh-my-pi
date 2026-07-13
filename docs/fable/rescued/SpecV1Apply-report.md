> Rescued 2026-07-13 from /Users/arthur/.omp/agent/sessions/-agents/2026-07-04T06-00-08-576Z_019f2bb6-8080-7000-8a22-156408ea1a65/local/SpecV1Apply-report.md

# Spec v1 apply report

Target: `docs/plans/pi-agent-control-plane.md`
Applied: 2026-07-04

## Process

- Read `local://control-plane-spec-brief.md` in full first.
- Read `agent://SpecV1Draft` in full second.
- Read the current v0 document top-to-bottom in ranges.
- Landed the revision as one full-document replacement to avoid line drift and request-cap churn.
- Final search checks confirmed only parked/non-goal Elixir mentions remain and required v1 anchors are present.

## Plan entries

| # | Plan range | Status | Reason / landing section |
|---:|---|---|---|
| 1 | 1-5 | Applied | Header now has `Status: spec v1`, date 2026-07-04, owner/scope, and one-line changelog. |
| 2 | 7-83 | Applied | Preserved and tightened `Why this exists`, problem statement, and key insight around local control plane vs terminal cosmetics. |
| 3 | 21-35 | Applied | Replaced three-layer core idea with L0-L4 layer table and vocabulary. |
| 4 | 37-52 | Applied | Reframed as `Steer channel / collaboration boundary`; IRC/collab surfaced through L2 and excluded from durable truth. |
| 5 | 85-113 | Applied | Preserved work-routing quadrant; replaced Symphony framing with autonomous supervised orchestration. |
| 6 | 115-126 | Applied | Rewrote as harness facts; OMP/Pi/Codex are L1 publishers/clients, never authorities; removed runtime spike claim. |
| 7 | 128-158 | Applied | Product/inspiration became terse local SQLite-first, harness-agnostic framing; references subordinate only. |
| 8 | 159-169 | Applied | Design principles are represented across settled decisions, architecture, monitoring, guardrails, and code-first sections. |
| 9 | 172-279 | Applied | V0 diagram/component list replaced by layer-by-layer architecture mapping L0-L4. |
| 10 | 281-336 | Applied | Narrow TS interfaces replaced with ledger row families, telemetry schemas, commits, packets, spawn/fork/hot-swap/steer contracts. |
| 11 | 367-514 | Applied | UI/navigation/review material moved under L4 monitoring/review surfaces; HTML primary, TUI glance-only. |
| 12 | 527-552, 944-964, 1042-1052 | Applied | Runtime sections replaced with settled Bun + Effect v4 and Elixir/OTP parked/non-goal language. |
| 13 | 554-602 | Applied | Storage decision updated to SQLite one-machine, libSQL/Turso escape hatch, federation preference, Dan Luu rationale. |
| 14 | 604-741 | Applied | Task metadata concepts rewritten under L3 packets with spawn packet fields, ownership/proofs/events, boring JSON/CLI parity. |
| 15 | 743-820 | Applied | Zellij/current pilot condensed into existing donor code/current pilot section. |
| 16 | 821-899 | Applied | Small local pilot decision path removed; terminal multiplexers retained only as optional L1/L4 attach adapters. |
| 17 | 901-941 | Applied | Non-functional requirements merged into monitoring, durability, crash-safety, open-union, and supervised-task requirements. |
| 18 | 965-1008 | Applied | Dream-memory/control-plane workstreams condensed into telemetry purposes and future loops; no coequal v1 workstream. |
| 19 | 1009-1018 | Applied | Open questions replaced with the four brief-required open questions. |
| 20 | 1054-1189 | Applied | Symphony breakdown removed; kept one reference note only, not runtime/UX frame. |
| 21 | 1191-1293 | Applied | Runner abstraction modernized into L1 adapters and fork/hot-swap/steer contracts; `pi --mode rpc`, Codex app-server, cold/warm fork, APFS clonefile included. |
| 22 | 1295-1315 | Applied | Near-term sketch replaced with M1-M4 milestones and click/run acceptance proofs. |
| 23 | 1318-1336 | Applied | References kept subordinate; Dan Luu and Lopopolo lifecycle notes included. |

Skipped entries: none.

## Verification checks performed

- Searched final document for `Elixir`, superseded v0 phrases, and runtime-spike claims. Remaining Elixir mentions are parked/non-goal only.
- Searched final document for required anchors: status header/changelog, L0-L4, Bun + Effect v4, SQLite/libSQL/Turso, open unions, no OTel, `model_calls`, session-mutation events, per-turn telemetry, affect, hypothesis queries, commit trailers, APFS clonefile, hot-swap, steer channel, HTML viewers, TaggedErrorClass, library + CLI parity, M1-M4, and open questions.

## Files changed

- `docs/plans/pi-agent-control-plane.md`
- `local://SpecV1Apply-report.md`
