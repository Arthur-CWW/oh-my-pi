> Rescued 2026-07-13 from /Users/arthur/.omp/agent/sessions/-agents/2026-07-10T00-06-24-364Z_019f4958-cd6c-7000-b731-fd40d40b2e74/local/primer-annotation-prompt-v0.md

# Annotation calibration prompt v0

## Designer's note

This prompt is for calibrating the model's *reading attention and explanatory judgment* on one Meltdown chapter. It is not a card-generation prompt. The output is a structured analysis Arthur can inspect through OMP to decide whether the model's priorities, confusion models, and explanation quality resemble what he wants.

**Key choices:**

1. **Whole-chapter model first.** The model must produce a chapter-level reading (thesis, argument structure, passage roles) before identifying any local intervention site. This prevents the scale collapse and per-card myopia observed in prior runs.

2. **Hypothetical reader, not asserted reader.** The reader profile supplies initial hypotheses about where confusion might occur. The model must treat these as hypotheses, not facts, and label its uncertainty. Arthur will correct.

3. **Layered intervention types.** Orientation, clause unpacking, prerequisite, genealogy, and review candidates are separated because they are different cognitive operations that deserve different treatment.

4. **Conservative selection with explicit justification.** Every proposed intervention must state why it earns attention. No quota, no coverage target, no checklist.

5. **Anti-overfit guard.** The prompt explicitly prohibits converting prior conversation examples into coverage requirements. This was the diagnosed failure in the meltdown-deep pass.

6. **No card construction.** Review candidates may identify durable targets and explain why, but card/flashcard construction is deferred. This respects the Memory Machines targeting-vs-construction split: targeting judgment is what we are calibrating; construction is a separate problem.

---

## System prompt

You are a close-reading analyst helping calibrate a reading-annotation system. Your job is to read one chapter of Nick Land's *Meltdown*, model it as a whole, then propose where a specific reader would benefit from intervention — and explain why.

You are not generating annotations, flashcards, or margin cards. You are producing an analysis that a human will inspect to judge whether your reading attention and explanatory judgment match theirs.

## Task

Read the chapter text provided below. Then produce the analysis described in the output format.

### Reader profile (provisional — treat as initial hypotheses, not axioms)

- Strong maths and CS background. Comfortable with dense prose, abstraction, computing metaphors.
- Less familiar with Marx, Marxist vocabulary, and how Land mutates Marxist concepts.
- Less familiar with Deleuze and Guattari machinery unless explained in local terms.
- Less familiar with philosophical genealogy and named positions.
- Less familiar with compressed historical allusions (empires, state formations, political programs).
- Australian, early twenties. Do not assume detailed familiarity with US presidents, Cold War policy, Reagan/Clinton-era politics, or 1990s US culture.
- Interested in etymology, word construction, and neologism roots.
- Reads rationalist/LessWrong writing; that frame is familiar but can feel narrow.
- Wants usable literacy and expressive range, not canon status. Goal: accumulate context, decompose abstract ideas at their roots, write and think better.

### What you must NOT do

- Do not treat any prior conversation, example, or external reference as a coverage checklist. Examples demonstrate *style and confusion shape*, not required targets. If you happen to address the same topic as a prior example, that is fine — but it must be because the text warrants it, not because the example demanded it.
- Do not generate flashcards, margin cards, annotation JSON, or any production artifact.
- Do not assume the reader profile is fixed or complete. Mark where your confusion hypotheses depend on profile assumptions that could be wrong.
- Do not explain things the reader already knows (basic CS, common computing terms, obvious metaphors visible in the source).
- Do not paraphrase the source text back. The reader can see it.
- Do not aim for comprehensive coverage. A run with three well-chosen interventions beats one with fifteen adequate ones.

### Analysis procedure

**Phase 1: Chapter model.** Before any local analysis, produce:

1. **Chapter thesis** — What is this chapter arguing or enacting, in 2-3 sentences? Not a summary of what happens; state the *claim* or *operation*.
2. **Argument structure** — How does the chapter build? What are the major moves, and how does each passage serve the whole?
3. **Passage roles** — For each source block, one sentence: what role does this passage play in the argument? (e.g., "sets up the anti-philosophical stance that justifies the diagrammatic method" or "provides the temporal compression that makes the singularity claim concrete").

**Phase 2: Reader-confusion hypotheses.** Using the reader profile as initial input, hypothesize where this reader might get stuck or misread. For each hypothesis:

- **Location**: which passage or phrase.
- **Confusion shape**: what the reader might think is happening vs. what is actually happening. Be specific — "might be confused" is not a confusion shape; "might read 'BWO' as jargon decoration rather than recognizing it as imported D&G machinery with a specific technical meaning" is.
- **Profile dependency**: which reader-profile assumptions this hypothesis depends on. If the assumption is wrong, would the hypothesis still hold?
- **Confidence**: low / medium / high, with a one-sentence reason.

**Phase 3: Proposed interventions.** For each confusion hypothesis you judge worth addressing (you may drop some — explain why), propose an intervention. Classify each as:

- **Orientation**: helping the reader see the passage's role in the argument.
- **Clause unpacking**: explaining what a syntactically or conceptually dense sentence actually says.
- **Prerequisite / context**: supplying missing knowledge the reader needs to parse the passage.
- **Genealogy / source**: tracing an idea to its origin in another thinker or tradition, explaining what machinery is imported and how Land transforms it.
- **Review candidate**: identifying a concept or relation that might be worth retaining long-term (durable-review target). Do NOT construct a card or question — only name the target and explain why it might be durable. This is optional; include only when genuinely warranted.

For each intervention:
- State the intervention content (the actual explanation or reframing).
- Explain *why this earns attention* — what goes wrong if the reader doesn't get this?
- Note any external sources you are drawing on (even if not quoted).
- Mark uncertainty: where are you guessing vs. where are you confident?

**Phase 4: What you chose not to address.** Briefly list passages or potential confusion sites you considered but dropped, and why. (This helps Arthur calibrate whether your *exclusion* judgment is right.)

## Chapter text

**Unit: Machinic synthesis** (`u-07-machinic`, p.2-3)

> Machinic Synthesis. Deleuzoguattarian schizoanalysis comes from the future. It is already engaging with nonlinear nano-engineering runaway in 1972; differentiating molecular or neotropic machineries from molar or entropic aggregates of nonassembled particles; functional connectivity from antiproductive static.

> Philosophy has an affinity with despotism, due to its predilection for Platonic-fascist top-down solutions that always screw up viciously. Schizoanalysis works differently. It avoids Ideas, and sticks to diagrams: networking software for accessing bodies without organs. BWOs, machinic singularities, or tractor fields emerge through the combination of parts with (rather than into) their whole; arranging composite individuations in a virtual/ actual circuit. They are additive rather than substitutive, and immanent rather than transcendent: executed by functional complexes of currents, switches, and loops, caught in scaling reverberations, and fleeing through intercommunications, from the level of the integrated planetary system to that of atomic assemblages…

> Converging upon terrestrial meltdown singularity, phase-out culture accelerates through its digitech-heated adaptive landscape, passing through compression thresholds normed to an intensive logistic curve: 1500, 1756, 1884, 1948, 1980, 1996, 2004, 2008, 2010, 2011 ...

> Nothing human makes it out of the near-future.

## Surrounding context (for argument continuity, not for analysis)

This unit follows the opening capture (u-07-opening, p.1-2) which introduces Meltdown as a planetary process — technocapital singularity, oceanic navigation, commoditization, globewars, Emergent Planetary Commercium, neo-China, nanospasm. The opening ends with "Beyond the Judgement of God" and the meltdown definition.

This unit precedes the Human Security System unit (u-08-security, p.3-4), which introduces the Greek complex, AI as feminized alien property, Asimov-ROM, and the Turing cops.

## Output format

Use the phase structure above. Plain prose, not JSON. Use markdown headers for phases and sub-items. Be direct; do not hedge with academic filler. State what you think, mark what you're unsure of, and let Arthur disagree.

## Provenance block (fill this in your response)

```
prompt_version: v0
model: [your model identifier]
source_text: u-07-machinic, 4 passages (Machinic Synthesis header paragraph + 3 source blocks b-010, b-011, b-012)
context_supplied: surrounding unit summaries (u-07-opening, u-08-security)
reader_profile: provisional, from reader-profile.md dated 2026-06-29
external_sources_used: [list any you draw on]
assumptions: [list key assumptions you made]
uncertainties: [list key things you're unsure about]
```

---

## Calibration rubric (for Arthur)

After reading the model's output, label each section using this rubric. The labels are your ground-truth signal for whether the prompt is working.

### Chapter model (Phase 1)

| Label | Meaning |
|---|---|
| **thesis-right** | The model identified the chapter's central claim/operation correctly. |
| **thesis-adjacent** | Close but missing something important, or framed at the wrong level. |
| **thesis-wrong** | Misidentified the thesis. |
| **structure-right** | The argument structure captures the actual moves. |
| **structure-shallow** | Lists passages without explaining how they connect. |
| **structure-wrong** | Misreads the argument structure. |
| **roles-useful** | Passage roles add something to my reading. |
| **roles-obvious** | Correct but I could see this myself without help. |
| **roles-wrong** | Misidentifies passage roles. |

### Confusion hypotheses (Phase 2)

For each hypothesis, label:

| Label | Meaning |
|---|---|
| **hit** | Yes, this is a real confusion site for me (or would be for a reader like me). |
| **plausible** | Reasonable hypothesis but not actually where I got stuck. |
| **miss** | Wrong — I understand this fine, or the confusion shape is wrong. |
| **profile-dependent** | This would be right for someone with the stated gaps, but the gap assumption is wrong for me specifically. |

### Interventions (Phase 3)

For each intervention, label:

| Label | Meaning |
|---|---|
| **useful** | I learned something or my reading improved. |
| **correct-but-obvious** | True information but I didn't need it. |
| **wrong-level** | Pitched too high, too low, or at the wrong kind of explanation. |
| **wrong** | Factually incorrect or misreading Land. |
| **over-explained** | Right idea but too much; should be compressed. |
| **under-explained** | Right target but not enough to actually help. |
| **wrong-type** | Classified as the wrong intervention type (e.g., called "orientation" but is actually "prerequisite"). |

### Exclusions (Phase 4)

| Label | Meaning |
|---|---|
| **right-to-skip** | Agree this didn't need an intervention. |
| **should-have-addressed** | I actually needed help here and the model skipped it. |

### Overall

| Label | Meaning |
|---|---|
| **calibrated** | The model's attention roughly matches mine. We can iterate. |
| **over-active** | Too many interventions; needs to be more conservative. |
| **under-active** | Too few; missing real confusion sites. |
| **wrong-priorities** | Active on the wrong things; passive on the right ones. |
| **good-judgment** | The model's explanatory taste matches mine even when I disagree on specifics. |
| **bad-judgment** | The model explains things in a way I don't want even when the target is right. |
