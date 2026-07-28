# Deferred harness ideas — noted, deliberately not built

> **Provenance — 2026-07-28.** Landed from `review/deferred-ideas` (`streams/harness/DEFERRED-IDEAS.md`), authored by Arthur's harness lane on 2026-07-27. The branch's stacked cmux-direction and nixbox-profile predecessors were deduplicated into [`cmux-interface-direction.md`](cmux-interface-direction.md) and [`nixbox-execution-policy.md`](nixbox-execution-policy.md), not copied here.

Status: parked
Owner: harness stream

These are ideas Arthur raised and explicitly did *not* ask to action at the time. Nothing here is a commitment. Each entry names the conditions required before it graduates.

## 1. Fork primitive instead of reload

**Raised:** Arthur, 2026-07-27, tier A; explicitly a tangent: “just note it down, don't go with this.”

### Idea

Replace live config/harness *reload* with a deliberate **fork**. An agent reaches a good checkpoint, then forks onto new harness code:

- predecessor and successor receive distinct prompts;
- the predecessor idles by default and watches the successor's health;
- if the successor fails, the predecessor remains alive and warm for rollback, live debugging, and regression recording.

### Why it is attractive

Live reload once took out the orchestrator and every subagent together. A fork has a surviving witness by construction and tolerates unknown retainers because predecessor and successor do not share an address space.

Restart-into-same-session is the weaker cousin: it recycles one process rather than retaining two. Its checkpoint, restart manifest, and child-policy machinery would also support a later fork primitive.

### Graduation gates

- Real crash/restart proof is green, so the successor's health signal is trustworthy.
- Ownership/epoch fencing is proven, preventing two live processes from fighting over one journal.
- Health can distinguish slow from wedged without false-positive rollback.
- Host-wide admission makes the cost of two coordinators affordable and bounded.

**Taste question for later:** should the predecessor be a passive witness or an active supervisor? The passive version is the obviously correct first experiment.

## 2. Subagent Hub keyboard grammar

**Raised:** Arthur, 2026-07-27, tier A; “we can do that later.” He had asked before, so this is recurring rather than passing.

The Hub's Vim grammar has useless keys; `[` was named specifically. Its bindings are not yet a coherent navigation language.

This is grammar design, not a piecemeal bug fix. Do it once alongside the read-only Dock `omp hub` in [`cmux-interface-direction.md`](cmux-interface-direction.md#6-navigation-reuses-one-keyboard-grammar), so the two surfaces do not acquire conflicting keyboard languages. Transcript reachability, HUD layout, and other concrete defects remain independent and must not wait for this redesign.

## 3. Queryable observability on nixbox

**Raised:** Arthur, 2026-07-27, tier A~; “would be nice,” not a priority call.

Emit structured Effect observability into a queryable store such as ClickHouse on nixbox. Fault cells, load runs, and process-forest snapshots already produce structured manifests keyed by stable `RunId`; a queryable store would enable cross-run questions that isolated proof files cannot answer.

This must not become the generic-dashboard failure mode. It graduates only when:

- the manifest schema is stable enough that ingestion does not merely create migration work;
- specific recurring questions are named first;
- retention and storage cost are bounded up front;
- service exposure follows the authoritative nixbox infrastructure policy rather than embedding addresses or network assumptions here.
