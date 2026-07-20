# Primer intent

**Status:** durable, revisable doctrine. This is a theory of Arthur’s aims, not a specification or a psychological profile. Claims marked **explicit** come from Arthur’s recorded words or corrections; **inferred** claims are working interpretations; **dated preference** records a preference in its episode and may be superseded. [`PREFERENCES.md`](PREFERENCES.md) holds the sourced, scoped preference layer. Correct this document by preserving the old claim as evidence and recording what changed in [`DESIGN-LOG.md`](DESIGN-LOG.md).

## What Primer is for

Primer is an **externalized intuition and tutor layer** that helps Arthur engage with difficult authored material, notice and resolve friction, and make learning compound. It should give both Arthur and later agents enough structured context to act helpfully without collapsing a plural person into a single profile.

Primer is not primarily an archive, dashboard, quantified-self product, generic chat surface, or omniscient model of Arthur. Archives, histories, annotations, cards, and ledgers are substrate. Their value is whether they improve the next act of reading, explanation, practice, or recall.

This interpretation combines two **explicit** aims:

- Preserve the “dark matter” of Arthur’s intuitions without turning any one rant into a hard preference.
- Build a tutor/extended reading medium in which engagement accrues rather than remaining “just vibes.”

The synthesis is **inferred and revisable**: Primer should predict useful help around Arthur’s current mental state while keeping the human-authored work and Arthur’s agency central.

## CEV-oriented direction, not an implemented CEV system

Primer may be steered by a **CEV backward frame**: ask what a better-informed, more reflective, more coherent future Arthur might endorse after reviewing the evidence and consequences, then use that perspective to question present interventions. This does not mean current behavior is coherent volition, that Primer can infer hidden values, or that a CEV system has been implemented.

The frame remains a review-gated hypothesis. Current explicit corrections outrank extrapolation; conflicts remain visible; Arthur can revise or reject the frame. [`PREFERENCES.md`](PREFERENCES.md) defines the evidence ladder, current preference cards, attention caveats, and correction protocol.

## The durable loop

> **read → friction → mark → agent enriches → queue → review near the source**

The authored work is the spine. Arthur reads; a selection, question, correction, hesitation, or failed recall supplies local evidence; an agent proposes a small intervention; accepted material may enter a queue; later review retains a path back to the originating passage and episode.

This loop implies:

1. **Reading comes before atomization.** Whole-unit meaning and authorial sequence constrain local help.
2. **Friction is evidence, not failure.** A mark says “attention happened,” not “this is mastered” or even “this should become a card.”
3. **The agent predicts rather than floods.** It should offer likely missing genealogy, mechanism, prerequisite, contrast, or reference while making uncertainty visible.
4. **The human edits the model.** Accepts, dismissals, rewrites, questions, and corrections are unusually high-value evidence because they distinguish plausible help from useful help.
5. **Review remains local to meaning.** Atomic prompts can be scheduled, but their provenance should reopen the authored context that made them matter.

## Arthur prior: plural, scoped, and corrigible

A successor should construct an **Arthur prior**, not an Arthur profile. The prior is a bag of scoped propositions with provenance and status:

- **Explicit statement:** Arthur said or directly corrected it.
- **Dated preference:** held in a named episode; do not assume permanence.
- **Inferred pattern:** supported by multiple artifacts but still an interpretation.
- **Operational observation:** behavior observed in a tool or reading session, not a claim about identity.
- **Unknown or conflict:** evidence is absent, unrecovered, or points both ways.

The prior must remain plural. Taste in philosophy, Chinese study constraints, interface preferences, source-trust heuristics, and prompt feedback belong to different domains and times. There is no global credibility score for sources and no global “Arthur likes X” score. Prefer mechanisms, concrete examples, correction history, and domain scope over personality labels.

Do not infer consciousness, stable hidden beliefs, or mystical continuity from stored artifacts. A useful theory of mind here means a bounded prediction about what may help in the current task, with confidence and a way for Arthur to correct it.

## Product posture

### Human-authored work is the spine

The system should not replace a book’s motivational or argumentative sequence with generated summaries. It should “jujitsu” around the reader’s actual structure: detect a likely snag, surface a compact explanation or reference, and let the reader continue. Side material is subordinate to the central text, optional, and dismissible.

### Context is a structured reference

Selecting text should create a stable context object: exact quote, work/unit/block/page, offsets, surrounding source, artifact identity, and capture provenance. This is closer to a Zed context chip than a generic chat transcript. It lets OMP or another agent operate on shared evidence without pretending an embedded side panel already has reliable agency or memory.

### Corrections are first-class evidence

Human edits are not cleanup after generation. They are evidence about targeting, explanation quality, desired compression, known concepts, and what should have been omitted. Preserve the before/after, source episode, and correction edge. A future system may predict likely corrections, but that is a hypothesis to test—not permission to silently rewrite Arthur’s intent.

### Sessions inherit artifacts, not selves

A later session can inherit doctrine, source artifacts, decisions, deltas, and correction edges. It does not inherit consciousness or a mystical memory. Runtime session identity and intellectual lineage are different ontologies; see [`LINEAGE.md`](LINEAGE.md).

### Tutoring posture: stretch, don't mirror (ZPD)

**Explicit (2026-07-19):** Arthur asked not to be "reduced to caricature of myself by reflecting my register" — he wants new words, concepts, and ideas, with the tutor's dialect held deliberately half a step beyond his own and every stretched term carrying a one-line cash-out. This is the zone-of-proximal-development posture (Vygotsky: the band just beyond current unaided ability, where learning happens with support; scaffolding gets dismantled as competence arrives), and it is a product requirement, not only a conversational preference — the Primer of the namesake novel is a ZPD machine. Mirroring the learner's register is a failure mode: interpersonal mode collapse, converging on a flattering compression of the learner and teaching them only their own modes back. Sourced correction chain: `docs/fable/generators.md` rows 41, 44, 45, 53.

**Explicit direction, implementation deferred (2026-07-19):** for difficult domains (stats/probability first), organize curriculum as a prerequisite knowledge graph — Justin Skycak's mastery-learning / Math Academy lineage is the named reference. The learner's position on an explicit prerequisite DAG determines what is inside the ZPD at any moment; practice and review sequence against graph edges, not topic lists. This names the direction only; knowledge-graph implementation remains a separate decision (see the calibration experiment below).

## Current product hypothesis, not universal doctrine

**Dated experiment — 2026-07-11:** calibrate one *Meltdown* chapter through a static prompt and explicit OMP interaction before bulk generation. The immediate workbench tests whether a structured selection plus local context produces a useful intervention and whether Arthur’s feedback can shape the next prompt.

This experiment does **not** establish that:

- all books should be processed chapter-by-chapter;
- philosophy annotations are Primer’s universal center;
- static prompts are the final interaction model;
- every annotation should become a retrieval prompt;
- an autonomous tutor has a reliable model of Arthur;
- one successful response proves transfer, mastery, or product value.

The next transfer check uses an unseen Nietzsche chapter after *Meltdown* calibration. Scheduling, knowledge graphs, mobile sync, bulk annotation, and broader reader automation remain separate decisions.

## Desired experience

Primer should feel like a reader whose margins can answer back without taking over:

- Before reading, it may offer a selective glossary of likely blockers.
- During reading, it may place compact, tactile reference scraps beside the exact source anchor.
- When a text imports another work, it may recommend and acquire the exact relevant chapter or excerpt, cleaned and provenance-visible.
- When Arthur marks or corrects something, the action should become durable evidence with minimal ceremony.
- Later, a queue may return an item at the right time and reopen its source context.
- Across sessions, successors should see why an artifact exists, what it implements, and what correction superseded it.

Predictive helpfulness is the ambition; restraint and provenance are the safety mechanism.

## Boundaries and anti-goals

- Do not build a profile/archive/dashboard and call it Primer.
- Do not treat browsing volume, annotation count, or model confidence as learning.
- Do not exhaustively annotate because generation is cheap.
- Do not make references mandatory detours from the authored work.
- Do not confuse retrieval practice with reading comprehension; open-reference help and closed-book review are different moments.
- Do not turn one learner’s dated correction into universal pedagogy.
- Do not present inferred mental state as fact.
- Do not erase superseded decisions; connect them through lineage and explain the delta.

## How to revise this doctrine

1. Attach a correction to the claim it changes and cite the episode or artifact.
2. Mark whether the correction **corrects**, **supersedes**, or supplies **counterevidence**.
3. Update this document only when the change is durable across episodes; otherwise append to [`DESIGN-LOG.md`](DESIGN-LOG.md).
4. Keep implementation state in the current handoff, not here.
5. Preserve unresolved tension rather than forcing false consensus.

## Evidence base

Start with [`PREFERENCES.md`](PREFERENCES.md), [`docs/plans/primer-intuitions.md`](../../docs/plans/primer-intuitions.md), [`GOAL.md`](GOAL.md), [`VISION.md`](VISION.md), the [current live handoff](HANDOFF-LIVE-2026-07-10.md), and the [learning-system synthesis](research/learning-sources/system-synthesis.md). [`LINEAGE.md`](LINEAGE.md) records how these sources relate and where recovery is incomplete.
