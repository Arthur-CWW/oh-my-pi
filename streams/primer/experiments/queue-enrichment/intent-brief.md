# Queue-Enrichment — Intent Brief

**Status:** design-only experiment (no code, no daemon wiring). Subordinate to [`../../INTENT.md`](../../INTENT.md) and [`../../CARD-PROMOTION.md`](../../CARD-PROMOTION.md).
**Spine position:** `read → friction → mark → **agent enriches** → queue → review near the source`.

## What enrichment is for

When Arthur clicks an unknown word while reading, the reader auto-queues a raw `queue_items` row: `word`, `pinyin`, a single joined CEDICT `gloss`, and sentence provenance (`mark_id → reading_marks.sentence`, `doc_id`, `paragraph_idx`). That row is a *pointer to friction*, not review-worthy material. Enrichment is the one LLM pass that turns that pointer into inspectable substrate for the word **in the sentence Arthur actually met it in**, cheaply, on a mid-tier subscription lane.

Its whole job, for **one** queue item:

- **Sense disambiguation with the quote as evidence** — pick *which* CEDICT `definitions[]` sense the source sentence uses; quote the span that fixes it; separate `cedict` / `cedict-extended` / `inferred`.
- **2–3 comprehensible examples** at ~85–95% known-token coverage, generated *through* the hsk-deck constrained-generation constraint (the target is THE one new item; scaffolding from the known set; ≤1 glossed extra). Coverage and `unknown_tokens` are reported, not asserted.
- **Predictive-only extras** — a character/morpheme note or a same-lemma/false-friend contrast **only when it heads off a real, nameable confusion**. Absent otherwise, with a reason.
- **A targeting judgment** — `durable_candidate: yes/no + why`. A recommendation about *what might be worth retrieving*, never a card.
- **Provenance everywhere** — source sentence quoted verbatim; CEDICT-sourced content structurally separated from inferred content.

## What it must NOT do (failure modes)

- **Flooding.** It does not enrich every field for every word. It *predicts* the missing piece and stays silent elsewhere (INTENT: "the agent predicts rather than floods"). Optional sections default to omitted-with-reason, not filled.
- **Sense-dumping.** It never pastes all CEDICT senses as "the answer." All senses are echoed once as evidence; exactly one is *selected* against the quote. A word looked up in a sentence has one operative sense there.
- **Fake etymology.** No ritual character breakdown. A morpheme note exists only when the decomposition prevents a specific error (e.g., a potential-complement infix, a misread homophone) — mirroring the sideline-annotation rule "reject paraphrase; if it could be inferred by rereading, omit."
- **Auto-promotion.** Output is CARD-PROMOTION **stage 2–4 material only** (candidate → optional durable target → possible construction input). It is never a constructed card, an approved card, an export, or a scheduler enrollment. The prompt carries **zero** `priority` / `due` / `interval` / FSRS / ledger-admission vocabulary. Targeting ≠ construction ≠ approval.
- **Scale/anchor drift.** It quotes the exact `reading_marks.sentence` and verifies the target string-matches inside it before anything else; a failed match is reported, not silently repaired.

## Calibration plan

The first **10 enrichments** run as a hand-labeled calibration batch **before any batch/bulk run**.

1. Pick 10 real queue items spanning easy (single clear sense) → hard (polysemous / literary / compound with a confusable neighbor).
2. Arthur labels **per field**, not per item: `keep` / `cut` / `edit` on each of {selected sense, each example, morpheme note, contrast, durable-candidate call}. Per-field labels tell us *which sections earn their place*, which per-item verdicts hide.
3. His edits are the ground truth (INTENT: "corrections are first-class evidence"), the same role the meltdown margin labels played for annotation-v2.
4. Only after the 10 are labeled do we write prompt-v1 — changing **structure/order/constraints**, never wording (per [`prompt-craft-tacit-knowledge.md`](../../wrapped-commentary-reader/references/prompt-craft-tacit-knowledge.md): wording is a null dimension; exhortation is free and worthless).
5. Track per-field `keep`/`cut`/`edit` rates; a section with a high `cut` rate is a candidate for removal, not more prompt polish.

## Open questions for Arthur (≤5)

1. **Known-set boundary.** Known = `known_words` (HSK1–5) ∪ review-marked-known. Fold in HSK6/7 words you already know? And do words you just marked "known" in review count as scaffolding *immediately*, or only after a lag?
2. **Coverage target.** Is 85–95% right for *reading-derived* words (whose real source sentence is often harder than an HSK deck sentence), or should examples run easier (looser) to stay comprehensible?
3. **Second-sense examples.** For a polysemous word, do you want one example of a *second* common sense (broader coverage of the word), or strictly examples of the sense the source sentence used (fidelity to the moment)?
4. **Contrast reach.** Should contrast only fire on confusables already in your sibling-queue or known set, or may it surface a high-confusion neighbor you *haven't* met yet (e.g., 扔 vs 丢, 看不惯 vs 看不起)?
5. **Durable-candidate default.** May enrichment ever assert `durable_candidate: yes` on its own, or should it always *propose with reasons* and leave every yes/no to you (never a self-issued targeting decision)?
