> Rescued 2026-07-13 from /Users/arthur/.omp/agent/sessions/-agents/2026-07-10T00-06-24-364Z_019f4958-cd6c-7000-b731-fd40d40b2e74/local/primer-annotation-intent-source.md

# Arthur intent source — annotation workbench calibration

This packet preserves the recent correction sequence. Treat these statements as evidence of intent, not as an implementation checklist.

## Arthur’s corrections and preferences

- The Claude/Fable conversation was supplied as an example of Arthur’s *style of questioning while reading*, not an exhaustive list of what annotations should cover. The previous pass incorrectly copied its topics into a coverage checklist.
- Before low-level annotations, the system needs to break down understanding "in its entirety": high-level model first, then low-level explanation informed by that high-level model.
- Explanations need empathy/theory of mind: anticipate where Arthur’s mental model breaks, at both high and low levels.
- Arthur can provide more examples, but does not want a system overfit to one transcript or one book.
- Philosophy is especially dense; fiction may require less annotation. Do not assume a single density or strategy across genres.
- Arthur does not want to read the entire philosophical canon merely because a text references earlier works. Explain relevant inherited ideas in place and point to original sources; full-canon reading is optional/later.
- Do not assume the reader profile is fixed. Arthur is a software engineer with mathematical exposure but rusty knowledge; philosophy/history familiarity is uneven. The system should update from interaction rather than encode permanent assumptions.
- Desired tutor modes may include Socratic co-reader, expert explainer, and research companion; do not force one persona.
- The book should be deeply analyzed before annotations are generated, potentially through iterative/multi-context research rather than one blind pass. But the current experiment should stay minimal.
- Current scope: ONE Meltdown chapter only, no processing all books/annotations.
- Give up the embedded side chat for now; interact through OMP.
- Avoid polishing the finished UI. Build the smallest experimental loop that is easy to iterate.
- Arthur wants prompt/output provenance visible: exact prompt, where it came from, model, source passage/context, and lineage/forks.
- Static prompt first; dynamic prompting only after evidence that it is needed.
- Gathered inspirations are inputs, not binding requirements:
  - Justin Skycak: knowledge graph, prerequisites, interleaving, scheduling, implicit review credit.
  - Andy Matuschak: durable prompt construction.
  - Kirkby + Matuschak Memory Machines: targeting vs construction and long-horizon prompt failure.
  - Grant Sanderson/Dwarkesh: theory of mind, motivation, curation, reframing a learner’s question.
- Do not cram all later learning-system machinery into prompt v0. Skycak and Memory Machines mostly constrain later review extraction and scheduling.
- The immediate experiment: one chapter, editable static prompt, raw result, provenance, comparison, Arthur labels. No batch generation, no automatic knowledge graph, no production import.

## Existing prompt/reference paths

- streams/primer/wrapped-commentary-reader/references/annotation-prompt-variant-b.md
- streams/primer/wrapped-commentary-reader/references/prompt-craft-tacit-knowledge.md
- streams/primer/research/learning-sources/manifest.md
- streams/primer/research/dwarkesh-grant-sanderson-ai-future-math-transcript.md
- streams/primer/research/skycak-scheduling-primitives-distilled.md
- streams/primer/wrapped-commentary-reader/site/meltdown-normalized.md

## Assignment constraints

- Do not implement code or UI.
- Do not generate annotations.
- Do not treat examples as a checklist.
- Design for rapid calibration through OMP on one Meltdown chapter.
- Keep prompt v0 minimal enough that Arthur can understand and edit it.
