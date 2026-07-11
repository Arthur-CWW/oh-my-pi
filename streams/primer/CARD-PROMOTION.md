# Card Promotion Contract

**Status:** design contract; implementation status is stated explicitly below  
**Scope:** Primer learning-card lifecycle, from source-local friction through downstream review  
**As of:** 2026-07-11  
**Authority:** durable product boundary, subordinate to [`INTENT.md`](INTENT.md) for product intent and to the current handoff for shipped-state details

This contract prevents five different acts from collapsing into one: annotation generation, card construction, human approval, artifact export, and review scheduling. A useful explanation is not automatically a review item. A plausible review item is not automatically an approved card. An approved card is not automatically exported or scheduled.

## Lifecycle and gates

| Stage | What exists | Required transition |
| --- | --- | --- |
| 1. Source friction / context reference | A learner encounters friction or deliberately attaches a stable source span. The reference may be used for an explanation without implying future review. | Capture source identity and span; no card semantics yet. |
| 2. Reader-local intervention / candidate | The reader presents an explanation, glossary entry, note, or a learner/agent marks a possible review target. These are source-local and revisable. | An explicit targeting act identifies what might merit retrieval practice. Generation alone does not promote it. |
| 3. Optional durable target | A durable statement of the thing to learn: term, distinction, relation, procedure, or prediction target. It can outlive one explanation and can relate equivalent occurrences. Not every intervention needs one. | Human or later validated workflow elects to retain the target, with provenance and relation metadata. |
| 4. Constructed card | A concrete prompt/answer or cloze is authored from a target. Construction chooses retrieval conditions, wording, scope, and answer criteria. Multiple cards may serve one target. | Construction records its parent target/candidate and content version. It is still not approved. |
| 5. Global daemon candidate | A provenance-bearing card candidate enters Primer’s canonical global ledger/inbox. | Explicit creation or a defined promotion bridge; no automatic annotation/rubric promotion. |
| 6. Approved / rejected | A human makes an explicit disposition. Approval means this version is fit to become a human-owned study artifact; rejection preserves the decision and provenance. | Human decision with status, actor, time, and optional rationale/edit record. |
| 7. Downstream human-owned Markdown artifact | The approved content is materialized in an inspectable, editable artifact. Primer remains able to relate the artifact and later edits to the approved version. | Explicit export/materialization. Approval does not imply export. |
| 8. Scheduler / review state | Machine-owned scheduling state and append-only review events refer to a stable Primer card and a specific content version. | Explicit enrollment in review; scheduling policy consumes, but does not redefine, approved content. |

Transitions are one-way only as historical events, not as irreversible product state. A later design must support reversible state changes and content-version migration while retaining every prior decision, parent relation, and review event. “Reversible” means a new event or version supersedes an earlier one; it does not mean deleting history.

## Distinctions that must remain visible

### Explanation is not a review atom

An explanation helps comprehension now and may be open-book, expansive, contextual, or temporary. A review atom specifies something Arthur should later retrieve or discriminate under controlled conditions. The reader may offer a selective pre-read glossary for terms such as “K-tactics,” “schizotechnics,” or “Kuang contagion” when they are predictively useful; unfamiliarity or coined terminology alone is not evidence that every term deserves durable review.

### Targeting is not construction

Targeting answers **what should become retrievable and why**. Construction answers **what prompt, answer, cue, and granularity will test it**. One target can produce several card versions or sibling cards; one explanation can contain no viable target; repeated source occurrences can point to the same target family without becoming duplicate cards.

### Construction is not approval

Mechanical validation, model confidence, annotation rubric tiers, and provenance completeness may help triage. None is the human decision that a particular content version should enter the durable study corpus.

### Approval is not export or scheduling

Approval is a content decision. Markdown export is a materialization step. Scheduler enrollment and review events are operational state. Each needs its own observable transition.

## Minimum provenance by stage

Provenance should be additive: later stages retain or reference earlier records rather than copying lossy text blobs.

| Stage | Minimum provenance |
| --- | --- |
| Source friction / context reference | Stable source span; `work`, `unit`, and `block`; page when the format has pages; start/end offsets and offset encoding; exact quoted text or source-version reference sufficient to verify it. |
| Reader-local intervention / candidate | Source reference above; intervention/candidate kind; creation time and actor; parent context reference; reader-local stable ID and content hash/version. |
| Workbench-generated intervention | Everything above plus immutable workbench run ID; exact prompt hash; model/provider identifier and model hash or immutable model-version identifier where available; source/input hash; output hash. A run lineage records parent run when forked. |
| Durable target | Stable target ID; parent reader candidate/intervention; target type; family/lemma/concept relations; human edits and status history. |
| Constructed card | Stable Primer card ID; parent target or candidate ID; card version; versioned content hash; constructor actor/run; prompt/answer/cloze representation; family/lemma/concept relations; human edit history. |
| Global daemon candidate | All construction provenance by reference; ledger record ID; ingestion/promotion path and time; status history. A bridge also records its source record ID and source version. |
| Approval/rejection | Explicit decision; human actor; time; exact decided card version/content hash; resulting status; optional rationale. Later edits create a new version requiring an explicit policy decision, not silent inheritance. |
| Markdown artifact | Stable Primer card ID and approved content version/hash in machine-readable metadata; artifact path/revision; exporter/version; human edits represented as a new content version rather than severing provenance. |
| Scheduler/review | Stable card ID plus reviewed content version; append-only event ID; device/client ID; event time and monotonic ordering aid; grade/action; prior-state reference; derived scheduler-state version. Sync provenance must make replay and duplicate detection possible. |

A source locator is format-aware. `work/unit/block/page/offsets` means preserve every applicable coordinate, not invent page numbers for a format without pages. Offsets must identify their unit and encoding so the same text can be joined without ambiguous substring matching.

## Identity and relations

- Every promoted Primer card has a **stable Primer ID** independent of wording.
- Every content revision has a **version number and content hash**. The hash verifies a version; it is not the card’s durable identity.
- A **family relation** groups sibling prompts or clozes derived from the same learning object.
- A **lemma relation** connects lexical variants without asserting that their meanings or review histories are interchangeable.
- A **concept relation** connects cards and targets to a shared concept while preserving their distinct retrieval demands.
- Parent links name the exact candidate, target, card version, and (when generated) workbench run from which a record was derived.

Primer deliberately does not copy Hashcards’ raw-content-hash identity or automatic progress-reset semantics. Hashcards remains useful downstream and as scheduler/reference prior art; Primer needs stable identity across auditable edits and an explicit later policy for carrying, partitioning, or resetting review state between content versions. See the [source-grounded Hashcards notes](research/learning-sources/cleaned/hashcards-design-notes.md) and [learning-source synthesis](research/learning-sources/system-synthesis.md).

## Promotion and approval policy

### Hard gate against automatic annotation promotion

No annotation, explanation, rubric tier, or workbench output may automatically become a global daemon candidate until there is a collision-safe provenance join. The join must identify the exact source version/span, annotation/candidate version, workbench run, and constructed card version without relying on quoted-text equality, array position, or a tier label. Existing annotation and rubric batches do not yet prove this join.

HSK promotion is a narrow, implemented bridge for HSK generation-store records. It is evidence that an explicit domain bridge can create ledger candidates; it is not authorization to treat generic annotations as cards or to generalize its join assumptions.

### Candidate admission

A global candidate must have:

1. an identifiable learning target, not merely interesting prose;
2. a verifiable source or explicit human-authored origin;
3. a constructed retrieval prompt and answer criteria;
4. stable identity, content version/hash, and parent provenance;
5. no unresolved identity collision with an existing card/target family.

Admission means “ready for human judgment,” not “good enough to study.”

### Human approval

Approval is explicit and version-specific. The reviewer should be able to determine that:

- the target is worth retaining rather than merely explaining in place;
- the prompt tests the intended target and does not leak the answer;
- the answer is correct, bounded, and supported by its source;
- the card is appropriately scoped and not a duplicate masquerading as a new item;
- provenance is sufficient to revisit the source and construction history;
- any human edits are recorded in the approved content version.

Rejection is also explicit and retained. Rejection may cite wrong target, explanation-only material, bad construction, duplicate/family collision, unsupported answer, or insufficient provenance, but no detailed verdict is presumed when the human did not provide one.

A post-approval content edit creates a new version. Whether it keeps, partitions, or resets accumulated scheduler state is an open migration policy; it must never happen implicitly from a hash mismatch. Status changes and version migrations should later be represented as append-only, reversible events with current state derived from history.

## System boundaries and current implementation

### Implemented as of 2026-07-11

- `primer card add --front --back --source-ref --url` creates a candidate in the canonical daemon SQLite ledger. This is the implemented manual shortcut from human card construction to stage 5; it does not imply that reader-local targeting or generic construction/promotion exists.
- `primer card list` lists ledger cards.
- `primer card status <id> candidate|approved|rejected` makes the ledger disposition explicit.
- The HSK-specific generation-store promotion bridge has promoted HSK cards into ledger **candidates**. It does not approve them.
- Reader-local marks/candidates and source context references exist, but there is no generic promotion bridge from them to constructed global cards.

### Not implemented

- Generic annotation/intervention → durable target → constructed-card promotion.
- A collision-safe annotation/rubric/workbench provenance join.
- Approved-card export to human-owned Markdown.
- FSRS scheduling or scheduler enrollment in this Primer lifecycle.
- Mobile review-event synchronization or any general sync protocol.
- Automatic review-state migration across edited card versions.

These absences are boundaries, not invitations to collapse stages in the meantime.

## Relationship between stores and surfaces

- **Reader-local candidates** are close to the reading act. They preserve friction, context, interventions, and possible targets without polluting the global study inbox.
- **The global daemon ledger** is Primer’s canonical cross-reader candidate and approval inbox. It owns stable Primer identity and status; it is not replaced by Markdown.
- **Hashcards downstream** may supply a human-owned Markdown format and boring FSRS/reference implementation after explicit approval/export. Its collection layout and hash identity are not Primer’s ontology.
- **Mobile review** should eventually append atomic review events locally and sync events/content safely. It must not synchronize a hot SQLite file or make end-of-session persistence the only durability boundary. Current scheduler and sync behavior are unimplemented.

The intended separation follows existing Primer doctrine: human-owned approved content can be inspectable Markdown, while machine-owned review events and derived scheduler state remain operational records. The authoritative current-state summary is the [live handoff](HANDOFF-LIVE-2026-07-10.md); the rationale is recorded in the [design log](DESIGN-LOG.md).

## Open decisions

1. What exact stable-ID namespaces and version rules should reader candidates, targets, cards, and artifacts use?
2. What collision-safe key joins source spans, workbench annotations, rubric verdicts, targets, and card construction across re-ingestion?
3. Is a durable target always a first-class stored record, or may a human-created card point directly to a reader candidate while retaining equivalent semantics?
4. Which edits require reapproval, and which may inherit approval with an explicit human migration decision?
5. How should prior review evidence carry across content versions: retain, partition, partially credit, or reset?
6. What Markdown metadata is minimal but sufficient for round-trip identity and human editing?
7. Does Hashcards consume exported Primer artifacts directly, or does Primer borrow/port only its scheduling rules?
8. What event identity, ordering, conflict, and replay rules make mobile append-only review sync safe?
9. How should family, lemma, and concept collisions be surfaced to a reviewer without forcing false equivalence?
10. What evidence beyond provenance completeness is required before any narrowly scoped automatic candidate admission is reconsidered?
