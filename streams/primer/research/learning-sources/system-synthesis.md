# Primer learning-system synthesis — what each source constrains and what to defer

Synthesized 2026-07-11 for future Primer agents working on the one-chapter *Meltdown* (`u-07-machinic`) OMP workbench. This is a decision map, not a universal pedagogy; the sources address different layers and mostly do not validate one another’s strongest claims.

**Binding rule:** Arthur’s examples and source claims are situated evidence about this learner, text, and workflow. Never turn them into rigid universal rules. Follow the local and canonical citations below when a claim affects a design decision.

## Source map

| Source | What it actually contributes | Phase constrained | Use now |
|---|---|---|---|
| Justin Skycak / Math Academy | A system-level model: prerequisite graph, measured mastery, small active tasks, closed-book retrieval, interleaving, and implicit credit when an advanced task exercises prerequisites. The two focal posts leave the credit formula and task-priority function unspecified. | Scheduling / knowledge graph; secondarily intervention targeting | Use only the lightweight targeting intuition: distinguish “interesting passage” from a demonstrated learner gap, keep interventions small, and capture attempt/feedback evidence. Do not build the graph or scheduler for one chapter. |
| Andy Matuschak (2020), “How to write good prompts” | Prompt design as recurring task design. Retrieval prompts should usually be focused, precise, consistent, tractable, and effortful; prompt scope follows the knowledge one intends to reinforce. Prompt writing and revision are iterative and personal, not exhaustive. Matuschak explicitly calls these properties heuristics rather than laws. | Durable prompt construction | Use as the construction lens for candidate annotations/cards: name one retrieval target, prevent answer giveaway, include enough context to avoid multiple reasonable answers, and prefer a few meaningful candidates over exhaustive coverage. |
| Ozzie Kirkby & Andy Matuschak, “Memory Machines” | Separates **targeting** (did the prompt preserve what this reader cared about?) from **construction** (will it cue stable recall months later?). Highlights carry useful interest signal, while model judgments and generation remain weak at the plausible-but-broken T1/T2 boundary. Same-highlight labeled grounding improved precision, but did not solve the problem. | Comprehension / intervention targeting and durable prompt construction | Treat the selected passage plus Arthur’s feedback as targeting evidence. Generate conservatively, expose candidates for human acceptance/edit/rejection, and preserve local examples and run artifacts. Do not treat an LLM rubric score as durable-quality proof. |
| Grant Sanderson interview | A learner-interaction caution: good exposition has an authored motivational sequence; a learner’s question can reveal a different mental structure; an excellent teacher may reframe or productively use that structure rather than placate it. Sanderson presents this as experience and speculation, not a controlled result, and recommends human-authored sources as the organizing spine with LLM help around them. | Learner interaction; secondarily comprehension targeting | Keep *Meltdown* and its cited context as the spine. Export selected text and surrounding context to OMP so the agent can respond to the learner’s actual snag. Do not present the reader as an autonomous tutor with reliable theory of mind. |
| Fernando Borretti / Hashcards | A storage and review-boundary reference: human-owned Markdown cards, machine-owned SQLite review state, minimal Q/A and cloze notation, content and cloze-family hashes, inspectable orphan/integrity commands, keyboard review/undo, and FSRS scheduling. Its `Cards`/`Inbox`/`Sources`/`Scripts` layout is Borretti’s personal collection convention, not the application schema. | Approved card artifact and review-state lifecycle; later scheduling/sync | Use the boundary and inspectability now: approved Markdown may become a downstream artifact only after explicit promotion, while provenance/status stay in Primer’s ledger. Borrow family/lemma grouping. Do not imply that the current inbox/workbench exports decks or schedules reviews. |

### Local and canonical sources

- Skycak: [`../skycak-scheduling-primitives-distilled.md`](../skycak-scheduling-primitives-distilled.md), with verbatim captures [`../skycak-knowledge-graph-thread-2074331548342538696.md`](../skycak-knowledge-graph-thread-2074331548342538696.md) and [`../skycak-knowledge-graph-thread-2074376893067911436.md`](../skycak-knowledge-graph-thread-2074376893067911436.md); canonical posts [part 1](https://x.com/justinskycak/status/2074331548342538696) and [part 2](https://x.com/justinskycak/status/2074376893067911436). The broader local inventory is [`../skycak-pedagogy.md`](../skycak-pedagogy.md).
- Matuschak 2020: [`cleaned/matuschak-prompts.md`](cleaned/matuschak-prompts.md); canonical [andymatuschak.org/prompts](https://andymatuschak.org/prompts).
- Memory Machines: [`cleaned/memory-machines-report.md`](cleaned/memory-machines-report.md); canonical [report](https://memory-machines.com/report), [code](https://github.com/laddermedia/memory-machines), and [dataset](https://huggingface.co/datasets/laddermedia/srs-prompts). The earlier research trail is [`cleaned/matuschak-ml-prompts-notes.md`](cleaned/matuschak-ml-prompts-notes.md) and its [canonical note](https://notes.andymatuschak.org/Using_machine_learning_to_generate_good_spaced_repetition_prompts_from_explanatory_text).
- Sanderson: [`../dwarkesh-grant-sanderson-ai-future-math-transcript.md`](../dwarkesh-grant-sanderson-ai-future-math-transcript.md), especially 01:07:07 and 01:16:02; canonical [Dwarkesh transcript](https://www.dwarkesh.com/p/grant-sanderson-2) and [YouTube](https://youtu.be/TfyPshgMbug).
- Hashcards: [`cleaned/hashcards-design-notes.md`](cleaned/hashcards-design-notes.md); canonical [repository](https://github.com/eudoxia0/hashcards), pinned [revision `91fecff`](https://github.com/eudoxia0/hashcards/tree/91fecff2dd7339398be0bdca8c23823e6f262622), and Borretti’s [design essay](https://borretti.me/article/hashcards-plain-text-spaced-repetition). Exact local evidence includes [`../../repos/hashcards/README.md`](../../repos/hashcards/README.md), [`../../repos/hashcards/src/types/card.rs`](../../repos/hashcards/src/types/card.rs), [`../../repos/hashcards/src/schema.sql`](../../repos/hashcards/src/schema.sql), and the personal collection convention in [`../../repos/hashcards/flashcards/README.md`](../../repos/hashcards/flashcards/README.md).

Prior local doctrine is also part of the evidence base: [`../../wrapped-commentary-reader/references/flashcard-design-notes.md`](../../wrapped-commentary-reader/references/flashcard-design-notes.md) maps Matuschak’s qualities and Memory Machines’ tiers into reader-specific validation criteria; [`../../wrapped-commentary-reader/references/prompt-craft-tacit-knowledge.md`](../../wrapped-commentary-reader/references/prompt-craft-tacit-knowledge.md) records the later local audit and structural A/B result. These are derivatives, not substitutes for the cleaned sources.

## Agreements, tensions, and unknowns

### Agreements

1. **Recognition is not the target.** Matuschak distinguishes retrieval from rereading; Skycak emphasizes active production and measured mastery; Memory Machines distinguishes a highlight from a durable prompt. A selection is evidence of attention, not evidence of understanding or mastery.
2. **The task must preserve the learner’s target.** Memory Machines’ targeting axis and Sanderson’s theory-of-mind discussion both warn against replacing the learner’s question with a generic explanation. Arthur’s selection, note, edit, or rejection is therefore stronger local evidence than a generic annotation rubric.
3. **Small, concrete interventions are safer.** Matuschak recommends tightly scoped prompts; Skycak argues for working-memory-bounded pieces and concrete production. For this workbench that supports one clear response or retrieval target per selected snag, not comprehensive chapter atomization.
4. **Quality emerges through use.** Matuschak expects revision during later reviews; Memory Machines finds that long-horizon construction taste does not reliably transfer to models. Preserve feedback and provenance rather than claiming a candidate is permanently good at generation time.
5. **Authorship and operational state should stay legible.** Hashcards’ split between editable Markdown content and SQLite review state complements Memory Machines’ insistence on preserving human judgment: Primer can keep approved learning content inspectable without flattening candidate provenance, approval, and later review history into one file. This is a Primer design recommendation, not a demonstrated learning outcome.

### Tensions

- **Personal salience vs curriculum authority.** Matuschak and Memory Machines foreground what matters to this reader. Skycak’s mastery graph chooses tasks from modeled prerequisites. For the exploratory workbench, learner selection wins; a later curriculum system would need evidence before overriding it.
- **Reference access vs contextual help.** Skycak favors closed-book attempts and friction around references during retrieval. Sanderson favors high-quality authored resources and LLM pruning around them. These apply at different moments: context is appropriate while comprehending *Meltdown*; reference reliance becomes a signal only during an explicit retrieval attempt.
- **Graph efficiency vs literary reading.** Skycak’s encompassing-credit model concerns structured skill hierarchies, especially mathematics. A philosophical text’s allusions and interpretations are not automatically prerequisite edges. Do not infer a universal knowledge graph from annotation links.
- **Prompt heuristics vs model confidence.** Matuschak’s properties help humans inspect prompts, but Memory Machines shows that rubrics and few-shot instructions did not reliably transfer construction taste. Mechanical checks can reject obvious defects; they cannot certify long-horizon usefulness.
- **Content addressability vs durable identity.** Hashcards deliberately identifies cards by content hash and resets progress after edits. Primer should retain a stable card ID and versioned content hashes so a wording correction is auditable without automatically destroying review history. Cloze-family hashing is still useful as inspiration for a broader family/lemma relation.

### Unknowns

- Whether `u-07-machinic` selections predict what Arthur will want to recall months later, rather than what he wants explained now.
- Whether the reader needs retrieval prompts at all for every annotation; Arthur’s examples establish desired compression and context, not a mandate that every margin item become a question ([`../../wrapped-commentary-reader/references/agent-context.md`](../../wrapped-commentary-reader/references/agent-context.md)).
- How to measure a successful OMP intervention: resolved confusion, better paraphrase, changed question, later recall, or some combination.
- How literary/conceptual dependencies should be represented, if at all; Skycak’s posts do not supply a transfer rule from math skills to philosophy.
- The correct implicit-review credit, scheduling function, and priority tie-breakers; the focal Skycak posts state the need but not algorithms.
- Whether model improvements after the cited experiments materially change the T1/T2 result. The local evidence supports conservative workflow design, not a timeless model incapacity claim.
- Whether and when approved Primer content should be rendered to Markdown at all; the current global inbox and one-chapter workbench establish candidate/status flows, not an implemented export or scheduler.

## One-chapter workbench boundary

### Use now

- Make `u-07-machinic` the sole source scope.
- Let a structured selection carry exact quoted text, stable location, nearby context, and optional learner note into OMP. This is a context export, not an in-reader chat agent.
- Ask OMP to diagnose the selected snag before proposing an intervention: missing referent, unfamiliar term/genealogy, compressed inference, disputed interpretation, or recall target.
- Keep outputs candidate-level and provenance-rich. Human accept/edit/reject feedback is the local ground truth.
- For any durable prompt candidate, use the adopted local process: unit thesis → coverage ledger → one-line retrieval target → fields → adversarial self-audit. The evidence and caveats live in [`../../wrapped-commentary-reader/references/prompt-craft-tacit-knowledge.md`](../../wrapped-commentary-reader/references/prompt-craft-tacit-knowledge.md) and [`../../wrapped-commentary-reader/references/prompt-ab-protocol.md`](../../wrapped-commentary-reader/references/prompt-ab-protocol.md).
- Keep comprehension assistance distinct from retrieval review: open context while interpreting; closed-book conditions only when the learner explicitly attempts recall.
- If an approved card artifact is introduced, make promotion explicit and keep Markdown downstream of the existing ledger. Provide inspectable CLI integrity/orphan views, and relate sibling cards with a family/lemma identifier; do not bypass candidate approval.

### Defer

- Automatic annotation generation or import; bulk/all-book processing.
- FSRS or another scheduler, implicit prerequisite credit, interleaving policy, priority scoring, and mastery gates.
- A generalized philosophy knowledge graph or multi-model edge validation.
- Claims that timing, reference use, or one successful answer establishes mastery for literary concepts.
- Autonomous tutoring, personalized theory-of-mind claims, or a reader UI that implies a reliable embedded agent.
- Training/fine-tuning a judge, arena benchmarking, or reproducing Memory Machines at system scale. Keep reproducible local prompt runs and feedback first.
- Hashcards-inspired review machinery beyond the artifact boundary: stable Primer card IDs plus versioned content hashes; atomic append-only review events; due timing combined with new-card priority, dependencies, and due/new interleaving; separate synchronization of Markdown content and review events.
- Raw hashes as sole durable identity, automatic state reset on every edit, end-of-session-only persistence, random shuffle as a complete ordering policy, and hot SQLite-file synchronization. These are explicit non-goals for a later Primer review system, not criticisms of Hashcards’ local-first design.

## Prior-session recovery appendix

### Canonical handoffs

Read the canonical boot handoff first, then the live handoffs newest-first:

1. [`../../HANDOFF.md`](../../HANDOFF.md) — canonical Primer boot/ownership handoff; useful for project orientation, but its implementation sequencing predates the live handoffs below.
2. [`../../HANDOFF-LIVE-2026-07-10.md`](../../HANDOFF-LIVE-2026-07-10.md) — current shipped/staged state, Arthur corrections, the 45-card deep pass, and unresolved import gates.
3. [`../../HANDOFF-LIVE-2026-07-09.md`](../../HANDOFF-LIVE-2026-07-09.md) — corrects earlier completeness claims and records how the A/B result was computed after the judge produced no arm-level recommendation.
4. [`../../HANDOFF-LIVE-2026-07-06.md`](../../HANDOFF-LIVE-2026-07-06.md) — initial 54-card audit, experiment setup, and then-current routing; historical, not current policy.
5. [`../../../../docs/qa/primer-annotation-factory.md`](../../../../docs/qa/primer-annotation-factory.md) — consolidated counts, validation evidence, model attribution, QA, and remaining gates.

### Prompt A/B evidence

The durable doctrine is [`../../wrapped-commentary-reader/references/prompt-craft-tacit-knowledge.md`](../../wrapped-commentary-reader/references/prompt-craft-tacit-knowledge.md). It reports 82 per-card verdicts on matched units: baseline 13/30 kept, v2 22/30, variant B 18/22; variant B’s smaller output reflects set-level deduplication. Raw judgments are in `streams/primer/wrapped-commentary-reader/artifacts/generation/prompt-ab-2026-07-06/judge-verdicts.jsonl`. The judge did **not** produce an arm recommendation; the 2026-07-09 handoff documents the subsequent calculation and adoption. This is local comparative evidence, not proof that the process generalizes to every text, learner, or model.

### Staged *Meltdown* deep pass

Arthur’s recovered reading session is [`../../wrapped-commentary-reader/references/arthur-meltdown-claude-chat-2026-07.md`](../../wrapped-commentary-reader/references/arthur-meltdown-claude-chat-2026-07.md), canonical session URL [Claude Cowork](https://claude.ai/cowork/cse_015UrqKpVXb9M8CM49xBa48D). It records concrete confusions and desired background around schizoanalysis, D&G, metaphysics, lumpen, feedback/futurity, and Land’s compression. Those gaps drove `streams/primer/wrapped-commentary-reader/artifacts/generation/meltdown-deep-2026-07-10/`: 12 validated batches, 45 staged cards, explicitly not imported. The 2026-07-10 handoff and QA document are authoritative for status; importer semantics replace whole units, so staging must never be mistaken for live annotation state.

### Known provenance gaps

- The Skycak captures exclude reply discussions (33 shown on part 1, 1 on part 2) because the authenticated offscreen view did not render them; embedded images were not visually inspected. Claims here use only captured author posts and the embedded quote tweet.
- The Arthur × Claude DOM extraction omits collapsed assistant tool-call queries/results and identifies a UI-merged response seam. It is evidence of Arthur’s questions and visible replies, not a complete tool trace.
- The prompt A/B arm choice was calculated from raw per-card judgments after the judge failed to return an overall recommendation; preserve that distinction.
- Earlier handoffs contain superseded routing and at least one corrected completeness claim. Treat 2026-07-10 plus the QA document as current state, not all handoffs as mutually consistent.
- [`../recoveries.md`](../recoveries.md) records adjacent unresolved provenance: Hu & Nation 2000 / Laufer were not recovered as standalone local files, and Fernando Borretti is only the best-supported candidate for the remembered “third author,” not a confirmed identification. Neither gap should be used as evidence for this workbench’s behavior.
- The Sanderson section timestamps are publisher navigation labels; use the surrounding transcript rather than treating them as exact evidentiary boundaries.
- Matuschak’s ML research-trail capture links note-ID subpages that were not independently consolidated here; follow the canonical note URLs when a subclaim matters.
- Source claims and Arthur’s examples remain situated evidence. Do not silently promote them into universal rules; record future counterexamples and learner feedback alongside the run that produced them.
