> Rescued 2026-07-13 from /Users/arthur/.omp/agent/sessions/-agents/2026-07-10T00-06-24-364Z_019f4958-cd6c-7000-b731-fd40d40b2e74/local/primer-annotation-intent-brief.md

# Annotation intent brief — what Arthur is actually after

Synthesized 2026-07-11 from correction sequence, existing prompts, source references, and reader profile.

## 1. What Arthur is trying to achieve

Arthur wants to calibrate a model's **reading judgment** on dense philosophical text — specifically, whether the model can:

- Read a chapter *as a whole argument* before doing anything local.
- Identify where a reader with Arthur's profile would genuinely get stuck or misread.
- Explain the missing context at the right level: not a dictionary definition, not a full canon tour — the minimum that unlocks the passage.
- Distinguish different *kinds* of difficulty (historical compression, philosophical machinery, neologism construction, genealogy, structural roles of passages) and treat them differently.
- Be conservative: propose an intervention only when it earns attention, not to fill a quota.

The immediate deliverable is a **single calibration run** on one Meltdown chapter (`u-07-machinic`), inspected by Arthur through OMP, with full provenance so he can see exactly what the model was given and what it decided.

**Evidence:**
- Intent source: "high-level model first, then low-level explanation informed by that high-level model."
- Intent source: "Explanations need empathy/theory of mind: anticipate where Arthur's mental model breaks."
- Intent source: "Do not treat examples as a checklist."
- Intent source: "The immediate experiment: one chapter, editable static prompt, raw result, provenance, comparison, Arthur labels."
- Agent-context: "Good marginalia reads the whole unit/chapter first. Extracts the local unit thesis. Explains the anchor in relation to that thesis."

## 2. What evidence supports each inference

| Inference | Supporting evidence |
|---|---|
| Whole-chapter model must precede local interventions | Intent source §2: "break down understanding 'in its entirety'" |
| Theory of mind about reader confusion, not a fixed checklist | Intent source §3; Sanderson transcript §01:07:07 ("recognizing that asking a certain kind of question reveals that the student's mental structures are not the same as the explainer's") |
| Reader profile is provisional and should not be hardcoded | Intent source: "Do not assume the reader profile is fixed... The system should update from interaction rather than encode permanent assumptions." |
| The Claude/Fable conversation is evidence of *question shape*, not a topic list | Intent source §1, §10: the prior meltdown-deep pass "incorrectly copied its topics into a coverage checklist." |
| Different genres need different density | Intent source: "Philosophy is especially dense; fiction may require less annotation." |
| Explain inherited ideas in place; do not require full-canon reading | Intent source: "Arthur does not want to read the entire philosophical canon... Explain relevant inherited ideas in place and point to original sources." |
| Inspirations (Skycak, Matuschak, Memory Machines) are inputs, not requirements for v0 | Intent source: "Do not cram all later learning-system machinery into prompt v0." |
| Variant B's process order (ledger → thesis → target → fields) works structurally | Tacit-knowledge doc: 82% keep rate vs 43% baseline; "wording was not the bottleneck; process was." |
| Provenance must be visible | Intent source: "Arthur wants prompt/output provenance visible: exact prompt, where it came from, model, source passage/context, and lineage/forks." |
| Static prompt first | Intent source: "Static prompt first; dynamic prompting only after evidence that it is needed." |

## 3. Unknowns the system must not pretend to know

- **Arthur's actual confusion on u-07-machinic.** The reader profile describes general gaps (Marx, D&G, US politics, philosophical genealogy). We do not know which specific passages trip Arthur up. The model must simulate plausible confusion shapes, explicitly label them as hypotheses, and not assert them as facts.
- **How much context is too much.** The reader profile says "terse and compressed," but Arthur also wants enough context to unlock the passage. The line is not known in advance; this is what the calibration run is for.
- **Whether Arthur wants Socratic co-reader, expert explainer, or research companion mode for this text.** Intent source lists all three as possible; the prompt should not lock one in.
- **The right intervention density for this unit.** Arthur said "no quota" and "conservative selection." We do not know his tolerance threshold.
- **What Arthur's learning path looks like.** We know he is a software engineer with some math but uneven philosophy/history. We do not know his reading speed, review habits, or which D&G/Marx ideas he has already encountered elsewhere.
- **How the model's attention will behave on Land's prose.** Land's writing is intentionally dense, neologism-heavy, and argument-compressed. Whether the model grasps the unit thesis correctly is itself an object of calibration.

## 4. Anti-goals and prior failure analysis

### Anti-goals
- **No flashcard/annotation generation.** The prompt should analyze and propose interventions, not emit import-ready JSON. Card construction is a separate later concern (Memory Machines targeting vs. construction split).
- **No coverage checklist.** The prior meltdown-deep pass treated Claude/Fable conversation examples as a required-targets list. This explicitly failed and must not recur.
- **No fixed reader ontology.** The reader profile is provisional input, not a permanent identity. The model should use it as initial hypotheses, not axioms.
- **No knowledge graph, scheduler, or flashcard machinery.** Skycak's scheduling primitives and Matuschak's construction rules constrain later review-extraction steps, not this calibration prompt.
- **No polished UI assumptions.** The output goes through OMP for Arthur's inspection; it is not rendered in a margin view.
- **No dynamic prompting.** Static prompt, one run, human labels. Dynamic compilation would obscure what the model actually did.
- **No batch processing.** One chapter only; no processing other books or chapters.

### Prior failure analysis

1. **Checklist overfitting (meltdown-deep pass).** The Claude/Fable conversation provided examples of Arthur's question style. The prior system treated each example as a required annotation target. Result: coverage-driven, quota-filling annotations that missed the point. The conversation demonstrates *confusion shape and question style*, not a content inventory.

2. **Field-schema literalism (Variant B audit).** The 8-field annotation schema was treated as a generation order, producing locally-plausible filler for each field. Counter: Variant B's process order (ledger → thesis → target → fields) solved this structurally. But Variant B is a *generation* prompt; the calibration prompt here is different — it analyzes and proposes rather than emitting fields.

3. **Scale collapse (tacit-knowledge doc).** Cards shrank civilizational claims into local metaphors because the unit thesis dropped out of working context. Counter: the thesis must be materially present during analysis.

4. **Boilerplate explanations (54-card audit).** "Not decorative," "locates the passage," generic why-reference phrases. These signal that the model was satisfying a field contract, not actually thinking about what the reader needs.

5. **Per-card myopia (tacit-knowledge doc).** Cards written without holding previous cards, producing duplicate retrieval targets. Relevant to the calibration prompt because proposed interventions should be aware of each other.

## 5. Design principles for the calibration loop

1. **Whole before parts.** The model reads and models the entire chapter/unit before identifying any local intervention site. The chapter model is an explicit deliverable, not an internal step.

2. **Hypothesize, don't assert.** Every claim about reader confusion is a hypothesis. The model must distinguish: claims about the text (verifiable from source), hypotheses about the reader (derived from profile, could be wrong), and teaching interventions (the model's judgment, open to override).

3. **Conservative selection.** An intervention site must earn attention by adding a missing relation that the reader cannot reconstruct from the source text and general knowledge. No quota, no flooding.

4. **Layered intervention types.** Separate and label: orientation (what role does this passage play?), structural/clause unpacking (what does this sentence actually say?), prerequisite/context (what do you need to know first?), genealogy/source (where does this idea come from?), review candidates (what might be worth retaining long-term?). These are different cognitive operations; the model should not conflate them.

5. **Provenance and reproducibility.** The output records: prompt version, model, exact source text supplied, any external sources used, assumptions made, uncertainties. Arthur can inspect exactly what the model saw and decided.

6. **Editability.** The prompt must be short enough and plain enough that Arthur can read it, understand every instruction, and change any of them. No hidden assumptions, no implicit conventions, no reference to external documents the prompt does not quote.

7. **Separation of concerns.** This calibration prompt is about the model's *attention and explanatory judgment.* It is not a card-generation prompt, a flashcard-construction prompt, or a knowledge-graph builder. Those are later.

8. **No example overfitting.** The prompt must explicitly state that examples from prior conversations demonstrate style and confusion shape, not required coverage targets. Any example included in the prompt is illustrative, not binding.
