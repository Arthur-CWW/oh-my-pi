# Agent company — operating model & execution plan (DRAFT)

Status: PLANNED THIS SESSION per Arthur, 2026-07-18 ("maybe we'll plan it out first in this session, and then we'll continue in the next session with all of these"). Implementation is HELD until he lifts it; the next session executes from §7 in order.

Provenance: Arthur voice memos 2026-07-17/18 (fleet coordination, summarizer, org shape, sampling+reporting, morning brief), synthesized against what already shipped (HR-165..194) and what is filed-and-held (HR-195..204). Companion doc: `2026-07-18-capability-architecture.md` (the four layers; this doc is the layer-3 operating model).

## 1. Why (Arthur's stated objectives — the design must serve exactly these)

- **Latency**: "how fast we can accomplish everything if we do it as parallel as we want" — maximum parallelism bounded only by real dependencies.
- **Token efficiency**: "plan with one agent and then implement with another, cheaper agent — get most of the benefits of the stronger agent."
- **Context sharding**: useful context lives IN the subagent; the system must move compressed context, never raw transcripts.

## 2. The org shape

```
Arthur
  └─ Chief of staff (Arthur's naming TBD; rejected: "meta orchestrator")
       — maintains the picture, routes decisions pre-compressed, owns the triage ledger (HR-182B)
  └─ Project leads — one per workstream (harness, companion, primer, email, …)
       — leave durable artifacts (STATUS/contracts/proofs), orchestrate their hands,
         own their stream's paths (streams/GOAL.md is the charter)
       └─ Hands — cheaper/weaker agents implementing bounded packets
            — never own synthesis; adversarially reviewed
```

Rules of the shape:
- **Exactly one lead per workstream** (DRI). Cross-stream reusables graduate to packages (existing AGENTS.md law).
- **Leads leave artifacts, not memories**: a lead's death must cost nothing that isn't already in its stream's STATUS/contracts/ledger. This is the GC enabler.
- **Plan-with-strong / implement-with-cheap** is the default packet economy; the lane split already practiced (Sol plans/reviews, Luna hands) becomes doctrine with HR-201 provenance making every routing decision explainable.

## 3. Status flows up — WITHOUT worker burden (Arthur's key refinement)

Rejected: subagents writing their own status reports ("we don't want to add extra responsibility for the sub-agent"). Their context is the value; taxing them corrupts the work.

Adopted: **the observer pattern** (HR-199 fleet summarizer). A smol background agent:
- watches `fleet overview --json` + journal deltas; change-detection threshold, never fixed-interval LLM burn;
- refreshes each peer's summary / display name / workstream in `label_json`;
- maintains each thread's **rolling digest** — the institutional memory row (also = HR-181 digest, HR-195 delta packet: one daemon, three consumers);
- never writes to journals, never sends control commands; rename keeps spawn-id provenance.

The worker just works. Compression is externalized to an agent whose ONLY job is compression.

## 4. Native patterns we keep; human patterns we reject (for now)

KEEP — patterns that are native to agents, not skeuomorphic:
- **Handoff** (context exhaustion → durable self-resume doc): already load-bearing (HR-166 autostamps provenance). This is agent-native — humans don't page out their working memory; agents must.
- **Adversarial review** (second agent, independent context, checks the first): proven repeatedly this session (trial loop caught 7 P1s; Sol-on-Opus review caught 5). Two contexts = the value; keep the cross-family requirement where lanes allow.
- **Sampling (gemba)**: watching threads live catches what reports structurally cannot ("issues that might not surface from telling the agent to do the end-to-end task").

REJECT for v1: scheduled stand-ups / daily self-reports as primary truth ("reports lie" applies double to self-reports from the worker being evaluated). Exception Arthur carved out himself: the **morning brief** — after overnight runs, concat ALL workstreams: where each is, what he must unlock. That is pull-at-a-cadence over observer-written digests, not worker self-reporting: `/brief` generalized to fleet scope, reading digests the summarizer already maintains. Cheap once §3 exists.

## 5. Sampling + reporting combined: the error-intelligence ladder

Arthur's observation: low levels can only surface crude signals; error SHAPES need aggregation across many samples/environments before the meta-level issue is visible ("might appear as many distinct issues... collect different traces... the meta-level issue might be: this agent doesn't have the tool it needs / this model is worse at nuance / makes mistakes unless effort is high").

Design — a report ladder with a different question per level:
- **Hand level**: crude, cheap, structured: "tool X failed", "instruction unclear", "capability missing". The `report_tool_issue` tool already exists for exactly this — generalize to `report_friction(class, note)` with a closed class enum (tool-defect, capability-gap, model-trait, instruction-gap, environment).
- **Lead level**: per-workstream quirk aggregation — the lead (or its observer) tags recurring hand-reports with stream context before they roll up.
- **Chief-of-staff level**: cross-stream trace aggregation → meta-level classification: capability gap (route to HR-196 contract pipeline) | model trait (route to routing doctrine / lane notes with provenance, e.g. "Luna wraps-instead-of-replaces", "needs effort=high for careful work" — tonight's trial produced exactly such rows) | harness defect (route to the register).
- **Storage**: every report is a typed row with the metadata that debugging needs — session, agent, model+effort, lane-resolution chain (HR-201), tools available, binary version+digest, environment. "We need to keep track of metadata. Institutional memory."

This is the behaviorist→root-cause bridge Arthur described: symptoms accumulate as typed rows until the shape is visible, then one meta-fix replaces N symptom patches (the guardrail-ladder rule, systematized).

## 6. Non-functional requirements (the frame Arthur named as the starting point)

The company exists to satisfy these; every slice in §7 must name which it serves:
- **N1 Latency**: dependency-bounded parallelism; no serial waterfalls where IRC could resolve a contract.
- **N2 Token economy**: strong-plans/cheap-hands; observer compression instead of transcript reads; digests instead of re-briefing.
- **N3 Legibility**: any thread's purpose/state readable in ≤5s (labels+digests); any model choice explainable (HR-201); any version visible (overview/board).
- **N4 Recoverability**: any agent's death loses nothing not already durable (digests, handoffs, artifacts); pause/GC any thread post-digest.
- **N5 Error intelligence**: frictions become typed rows; shapes become meta-fixes; nothing relies on Arthur noticing twice.
- **N6 Non-interference**: observation never mutates work (read-only observers, no control commands, no journal writes).

## 7. Execution plan for the next session (in order; each slice gated/committed per the ritual)

0. **HR-188+204 vim-lite→core with undo/paste correctness** — held P1, first pickup, independent of everything below.
1. **HR-198 global `history://`** — the reference primitive (fully-qualified, read-only). Small; unblocks 2/3/5.
2. **HR-199 observer/summarizer v1** — smol lane, change-detection threshold, label write-back + rolling digest per thread. Registered service (services.yml). Acceptance: overview names/summaries stay honest for a day of mixed work with ≤N smol calls; digests exist for every live thread. (N2, N3, N4)
3. **Morning brief** — `/brief --fleet` (or `omp brief`): concat workstream digests + global decision queue. Acceptance: Arthur's morning sync is one command, under 60 lines. (N3)
4. **Report ladder v1** — `report_friction` tool + typed store + `omp friction` list/aggregate views; chief-of-staff classification pass stays manual (Fable) in v1. Acceptance: a planted capability-gap symptom across 3 sessions aggregates into one visible shape row. (N5)
5. **HR-200 Kanban control panel v1** — board over overview+digests+register cards; version/digest column; click-through to thread. Two views: board + watch. (N3)
6. **HR-182B chief-of-staff thread** — long-lived session owning the triage ledger + overlay routing; consumes 2/3/4/5. Naming decision Arthur's.
7. **HR-181 ownership claims + GC** — durable claims; park-after-digest sweeps (HR-203 janitor integration).

Explicitly deferred beyond this plan: standups/scheduled self-reports; automated meta-fix application (classification stays human/Fable in v1); Effect-migration fan-out (own program, gated on the H1 contract read — Arthur has signaled intent to scale parallel agents at it after test hardening; the DST/fuzz suite is that program's §7-equivalent).

## 8. Open questions for Arthur (answer in next session's first message)

1. Name for the top agent (chief of staff / assistant / leader-orchestrator?) — it appears in UI and IRC ids, so it's worth choosing once.
2. Observer rename authority: may HR-199 rename ANY session's display name, or only subagents (leads keep self-naming)?
3. Morning brief delivery: in-session on demand only, or also pushed (cmux inbox / HR-184 phone bridge) at a fixed hour?
4. `report_friction` visibility: do hands see each other's reports (bias risk) or write-only up the ladder?
5. Confirm §7 order or reorder — especially whether the board (5) should jump ahead of the report ladder (4).
