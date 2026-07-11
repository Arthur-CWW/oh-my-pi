# Primer lineage

**Status:** durable provenance map, revisable as evidence is recovered. This document describes intellectual and document lineage. It does **not** claim that sessions share consciousness, identity, or hidden memory.

## Two ontologies that must not be confused

### Intellectual/document lineage

Ideas and artifacts can be related across time. Primer uses these nouns:

- **durable doctrine** — a revisable project-level interpretation intended to survive episodes;
- **episode** — a bounded conversation, reading session, experiment, or implementation interval;
- **evidence** — a quote, correction, artifact, observed behavior, source, or result supporting a claim;
- **correction** — high-value evidence that changes the interpretation of an earlier claim or output;
- **delta** — the explicit difference between a predecessor and successor artifact;
- **fork** — an alternative interpretation or experiment sharing a predecessor;
- **merge** — a deliberate synthesis that preserves the contributing lineages and conflicts.

Relationship labels:

- `derived_from` — transformed from named evidence or predecessor;
- `corrects` — fixes a false or misleading claim while preserving its history;
- `supersedes` — becomes the current authority for the same scope;
- `implements_slice_of` — realizes a bounded part of a larger doctrine;
- `evidence_for` — supports a claim without making it doctrine;
- `counterevidence_to` — weakens or bounds a claim;
- `deferred_by` — intentionally postponed by a later decision or experiment;
- `unrecovered_from` — known or reported predecessor whose contents are unavailable or incomplete.

These are provenance relations, not claims about ancestry of minds.

### Runtime session identity

A runtime session has an execution context, transcript, model, tools, and artifacts it can actually read. A successor session may inherit files or receive a handoff. It does not become the prior session, remember unrecorded thoughts, or gain access to unavailable transcripts. “Progeny” is safe shorthand only for artifact inheritance with explicit edges.

A session lineage record should therefore say:

- which artifacts were available;
- which doctrine and handoff were read;
- which episode produced the delta;
- which corrections were applied;
- which sources were missing;
- what status the output had when left behind.

## Durable doctrine graph

| Artifact | Status and scope | Principal relationships |
|---|---|---|
| [`INTENT.md`](INTENT.md) | Current durable, revisable theory of Arthur’s aims | `derived_from` Primer intuitions, GOAL, VISION, handoffs, learning synthesis, and 2026-07-11 dossier; future corrections should `corrects` or `supersedes` scoped claims |
| [`GOAL.md`](GOAL.md) | Stream charter and ownership boundary | `derived_from` early Primer episodes; `evidence_for` externalized tutor and structured-memory aims |
| [`VISION.md`](VISION.md) | Living design-space/vibe record, with dated binding decisions | `derived_from` 2026-07-03/06 episodes; `evidence_for` the loop and reader-first medium; some sequencing is `supersedes`-sensitive |
| [`DESIGN-LOG.md`](DESIGN-LOG.md) | Append-oriented dated hypotheses, decisions, alternatives, and debt | each entry names status and evidence; entries do not silently become doctrine |
| [`HANDOFF-LIVE-2026-07-10.md`](HANDOFF-LIVE-2026-07-10.md) | Current implementation/experiment state as of 2026-07-11 continuation | `supersedes` 2026-07-09 for live status; current workbench `implements_slice_of` INTENT/VISION |
| [`research/learning-sources/system-synthesis.md`](research/learning-sources/system-synthesis.md) | Situated synthesis for the one-chapter workbench | `derived_from` Skycak, Matuschak, Memory Machines, Sanderson, and recovered handoffs; explicitly not universal pedagogy |
| [`docs/plans/primer-intuitions.md`](../../docs/plans/primer-intuitions.md) | Earlier distillation with direct quotes and recovery inventory | `evidence_for` externalized intuition, reader ontology, source trust, and high-level-first posture |
| [`docs/fable/charter.md`](../../docs/fable/charter.md) | Fable collaboration doctrine | adjacent durable doctrine; informs stewardship but does not establish Primer product intent by itself |
| [`docs/fable/handoff.md`](../../docs/fable/handoff.md) and [`docs/fable/session-index.md`](../../docs/fable/session-index.md) | Fable handoff/session records | evidence about orchestration lineage; not a substitute for unavailable transcripts |
| [`docs/fable/harness-runtime-contract.md`](../../docs/fable/harness-runtime-contract.md) | Runtime contract | describes session mechanics; must not be confused with intellectual lineage |

## Known predecessor episodes

The following exact OMP JSONL paths were sampled for [`docs/plans/primer-intuitions.md`](../../docs/plans/primer-intuitions.md) and are the strongest currently named predecessor evidence:

1. `~/.omp/agent/sessions/-exploratory/2026-06-28T02-54-42-069Z_019f0c26-9195-7000-8055-86edb42b78bc.jsonl`
   - Reader origin: Talmud/PreTeXt-style wrapped commentary request.
   - Relation: `evidence_for` the authored-center, spatial-margin reader.
2. `~/.omp/agent/sessions/-exploratory/2026-06-28T03-08-17-738Z_019f0c33-03ca-7000-afbf-8674ca7e98c8.jsonl`
   - Browser-context-sync / Arthur Primer origin and ontology.
   - Relation: `evidence_for` the externalized-intuition layer and plural prior; `counterevidence_to` profile/dashboard framings.
3. `~/.omp/agent/sessions/-exploratory-systems-wrapped-commentary-reader/2026-06-29T07-43-05-571Z_019f1254-f563-7000-96c6-97cb8f4bb595.jsonl`
   - Main reader build-out, library downloads, and annotation pipeline.
   - Relation: artifacts `implement_slice_of` the reader intent.
4. `~/.omp/agent/sessions/-exploratory-systems-wrapped-commentary-reader/2026-06-30T00-10-44-907Z_019f15dd-2f2b-7000-b27f-c78c0a6542b2.jsonl`
   - Reader/library continuation and Borges skill hardening.
   - Relation: `derived_from` the prior reader episode.
5. `~/.omp/agent/sessions/-exploratory-systems-wrapped-commentary-reader/2026-06-30T12-52-14-922Z_019f1896-5bca-7000-a7f9-290669e05e1d.jsonl`
   - Culture/Accelerando, Borges/4chan reading-order exploration, and download pipeline work.
   - Relation: `evidence_for` source acquisition and reading-list lineage.

The intuition dossier also notes, but did not deeply sample, these incomplete names:

- `~/.omp/agent/sessions/-exploratory-systems-wrapped-commentary-reader/2026-06-30T07-33-50-754Z_...`
- `~/.omp/agent/sessions/-exploratory-systems-wrapped-commentary-reader/2026-06-30T07-46-37-732Z_...`
- `~/.omp/agent/sessions/-exploratory-systems-wrapped-commentary-reader/2026-06-30T12-57-51-153Z_...`
- `~/.omp/agent/sessions/-exploratory-systems-wrapped-commentary-reader/2026-06-30T13-08-40-830Z_...`

Because their identifiers are truncated and their contents were not recovered into the dossier, any claim attributed to them must be marked `unrecovered_from`, not quoted or treated as verified.

## Predecessor documents and deltas

### Wrapped-commentary lineage

The earlier external documents named in the intuition dossier include:

- `~/exploratory/systems/wrapped-commentary-reader/annotation-format.md`
- `~/exploratory/systems/wrapped-commentary-reader/annotation-guide.md`
- `~/exploratory/systems/wrapped-commentary-reader/manifest.md`
- `~/exploratory/systems/wrapped-commentary-reader/references/agent-context.md`
- `~/exploratory/systems/wrapped-commentary-reader/references/workstreams.md`
- `~/exploratory/systems/wrapped-commentary-reader/references/project-conversation-brief.md`

Their central delta from ordinary e-readers was stable source chunks plus typed, provenance-bearing commentary spatially subordinate to the source. Current reader work `derived_from` that line. The 2026-07-11 context-chip cutover `corrects` the fake side-chat interpretation: selection now exports structured reference evidence to OMP instead of implying an embedded agent already exists.

### Browser-context / Arthur Primer lineage

Named predecessors:

- `~/exploratory/browser-context-sync/docs/vision.md`
- `~/exploratory/browser-context-sync/docs/collaboration-preferences.md`
- `~/exploratory/browser-context-sync/docs/arthur-primer-seed-context.md`
- `~/exploratory/browser-context-sync/docs/attention-datamine-2026-06-28.md`
- `~/exploratory/browser-context-sync/docs/source-trust-ontology.md`
- `~/exploratory/browser-context-sync/docs/arthur-primer-ontology-v0.md`
- `~/exploratory/browser-context-sync/docs/primer-agent-use-contract-v0.md`
- `~/exploratory/browser-context-sync/docs/source-card-template-v0.md`
- `~/exploratory/browser-context-sync/agent_skill/browser_context_sync.md`
- `~/.omp/agent/managed-skills/browser-context-sync/SKILL.md`

This line supplies the doctrine-plus-index model, local provenance, domain-scoped trust, and the warning that explicit specification can collapse a plural prior. It is `evidence_for` Primer’s agent-facing context layer, but browser capture is substrate rather than the product.

### Learning-system lineage

The [learning-system synthesis](research/learning-sources/system-synthesis.md) keeps five sources in their own scopes:

- Matuschak: prompt construction heuristics and revision through use.
- Kirkby + Matuschak’s Memory Machines: targeting versus construction, limits of model judgment, and human labels as evidence.
- Skycak / Math Academy: prerequisite/scheduling ideas, especially for later structured practice.
- Sanderson: preserve authored motivational sequence and respond to the learner’s actual structure.
- Borretti / Hashcards: human-owned approved card artifacts separated from machine-owned review state; a scheduler and CLI reference, not Primer’s global architecture.

Their agreement supports small, provenance-rich interventions. Their tensions are intentional. Hashcards is a downstream/reference influence, not the ancestor or global architecture of Primer.

## Recovery gaps and unavailable evidence

- No claim in these docs should imply access to unrecovered Fable transcripts. The available Fable charter, handoff, session index, and harness contract are document evidence only. Any idea reported as originating in an unavailable Fable conversation is `unrecovered_from` until a transcript or correction is attached.
- The exact Firefox episode in which the Talmud video was first encountered was not recovered.
- The named “Talmud Pretext JavaScript library” was not identified; the custom reader is a later implementation choice, not proof of the original referent.
- Some Arthur × Claude extraction omitted collapsed tool calls and contained a merged-response seam; it is partial episode evidence.
- Skycak reply discussions and images were not recovered in the local capture.
- Older annotation batches lack complete per-card model provenance.
- The remembered “third author” is not confirmed; Fernando Borretti is only a medium-confidence candidate.

Absence is not negative evidence. Record the gap; do not fill it with a coherent story.

## How successors should record lineage

For any durable artifact, record:

```text
artifact: <relative path or stable identifier>
status: hypothesis | experiment | accepted-local | durable-doctrine | superseded
scope: <book/chapter/domain/product-wide>
episode: <date and session/artifact reference>
relationships:
  - <label>: <predecessor or claim>
evidence: <quotes, corrections, results, or source links>
gaps: <unavailable or conflicting evidence>
```

A merge should preserve both parent edges and name the conflict it resolves. A fork should state its alternative. A correction should retain the original evidence and show the delta. A handoff should never promote a dated experiment into doctrine merely because it is newest.
