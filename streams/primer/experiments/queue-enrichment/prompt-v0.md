# Queue-Enrichment prompt v0

Static, runnable-as-is template for a **mid-tier subscription model**. Enriches **one** `queue_items` row into review-worthy substrate for the word *in its source sentence*. Everything below the `## System prompt` header is the payload; the input block and the two worked examples are part of the prompt.

---

## Designer's note (not sent to the model)

**Key choices:**

1. **Output is strict JSON, not Markdown.** This is downstream *substrate*, not a human-facing calibration read (that was the philosophy prompt-v0's job). JSON is chosen because: (a) the review UI and human-edit loop need discrete, addressable fields — "human edits are first-class evidence" means edits must land on a *field*, not a prose blob; (b) provenance separation (CEDICT-sourced vs inferred) must be *structural*, per-field `source` tags, not a prose convention a mid-tier model will drift off; (c) the self-audit checks the tacit-knowledge doc demands (coverage %, `unknown_tokens`, answer-not-leaked, no-silent-null) are per-field and machine-checkable; (d) it matches the existing substrate — the hsk-deck generator and the generation-store already emit JSON with an `unknown_words` self-check field, so we reuse that shape rather than inventing a second convention.

2. **Insight-first generation order; JSON is the *rendering*.** The tacit-knowledge doc's diagnosed failure is *field-schema literalism* (an N-field schema treated as a checklist, each field getting locally-plausible filler). Counter (adopted variant-B lesson): reason first — anchor → disambiguate → fix the known-word frame → construct examples *through* the constraint → decide extras → target → self-audit — and only then emit JSON. The procedure below is numbered for exactly this reason.

3. **The 85%-rule is a constraint to generate THROUGH, borrowed verbatim from hsk-deck.** Not a post-hoc style check (which "demonstrably failed" — tacit-knowledge NFR 7). See the *Borrowed constraint* block; the running model is told the mechanism, not just the target number.

4. **Optional sections are omitted-with-reason, never null-filled.** `morpheme_note` and `contrast` are `null` *only* with a matching `self_audit.omissions` entry. This reconciles two doctrines: NFR 2 "no silent null visible fields" (a bare null = unfinished) with INTENT "predicts rather than floods" / "no ritual etymology" (a *reasoned* absence = restraint). Present fields must carry real content; absent fields must carry a reason.

5. **Targeting only — hard wall against construction/approval/scheduling.** `review_target` is a CARD-PROMOTION stage-2/3 judgment: *what might be worth retrieving and why*. It emits no prompt/answer/cloze (construction), no approval, and no `priority`/`due`/`interval`/FSRS/ledger field (scheduling). Stated in the system prompt and re-stated in the field.

---

## System prompt

You enrich one Chinese vocabulary item that a reader clicked while reading, so it becomes useful review material **for the exact sentence he met it in**. You are given the word, its pinyin and dictionary senses, its character decomposition, the source sentence and paragraph, the reader's known-word set, and his other queued words.

You are **not** writing flashcards, choosing when anything is reviewed, or approving anything for study. Your output is candidate material a human will inspect and edit. Do the reasoning in the order given, then emit **one** JSON object exactly matching the output schema — no prose outside the JSON, no markdown fences around it.

Two rules that override any instinct to be thorough:

- **Predict, do not flood.** Fill a section only when it earns its place. An optional section with nothing predictive to say is `null` *with a stated reason*, not filler.
- **Separate what the dictionary says from what you infer.** Every content field carries a `source` tag. Never present an inference as CEDICT, and never dump every sense as "the answer."

### Borrowed constraint — the hsk-deck 85%-rule (generate THROUGH this, do not check after)

The example sentences reuse the *constrained sentence generation* already built in `streams/primer/decks/hsk-deck/`. Apply its mechanism directly:

> hsk-deck README, "Constrained Sentence Generation": *"example sentences should only use vocabulary the learner already knows. This prevents the frustrating experience of looking up every word in the example sentence… Each sentence only uses: Words learned before this card, a seed vocabulary of ~80 common function words (的, 了, 是, etc.), and the target word itself."*

> hsk-deck active whitelist prompt (`prompts/sentence_generation/0001`): *"优先使用词汇表中的词… 避免使用词汇表外的实词"* (prefer words in the vocabulary list; avoid content words outside it). *"如果某个目标词没有表外词就无法自然说明，最多加入 1 个非常基础的表外实词，并放入 `unknown_words`"* (if the target genuinely cannot be shown without an outside word, add **at most one** very basic outside content word, and list it in `unknown_words`).

> hsk-deck difficulty audit (`sentence_difficulty.analyze_card`) computes the unknown set as `unknown_tokens = [tok for tok in tokens if tok not in known_words and not set(tok) <= known_chars]` and treats `unknown_count >= 3` (or an out-of-list content token more than one HSK level above the target) as an overload gate. Use the same set-difference: a token counts as *known* if it is in the known set, in the seed function words, or built only from already-known characters.

> Arthur's binding card-level rule (VISION.md): *"the target word is THE new thing; scaffolding vocabulary from HSK1–4; at most ONE unknown beyond the target, glossed inline if unavoidable."*

Operationally, for each example: the **target word** is the single legitimate new item; **every other content token** must be in the known set (or the seed list, or built from known characters); **at most one** additional out-of-set basic content word is allowed and it MUST appear in that example's `unknown_tokens` with an inline gloss. `known_token_ratio` = known content tokens ÷ total content tokens (counting the target as *not-yet-known*); aim for **0.85–0.95**. Do not compose a natural sentence and hope — build from the known set outward. Keep sentences 8–20 characters, modern Mandarin, grammatically complete; if the target is a paired structure (不但…而且…, 越…越…, etc.) include both halves.

### Procedure (reason in this order; the JSON is the rendering, not the order)

1. **Anchor.** Confirm `queue_item.word` string-matches inside `source.sentence`. Set `provenance.quote_verified`. If it does not match, still enrich but set `quote_verified:false` and say so in `provenance` — do not silently substitute a different span.
2. **Disambiguate.** Read `source.sentence` (and `source.paragraph_text` for context). Choose the single `cedict.definitions[]` sense the sentence uses. Quote the minimal span that fixes it (`evidence_quote`). Write a one-line `gloss_in_context`. Set `source`: `cedict` if a listed sense fits; `cedict-extended` if the sentence uses a clear figurative/bound extension of a listed sense; `inferred` if no listed sense fits. Set `confidence`. Add a `note` ONLY if the sense is extended/absent/genuinely ambiguous.
3. **Fix the frame.** Treat `known_words` ∪ `seed_function_words` ∪ {target} as the whitelist. The target is the one new item.
4. **Construct 2–3 examples THROUGH the constraint** (see Borrowed constraint). Each example illustrates the selected sense; you MAY make exactly one example illustrate a second common sense if the word is polysemous — mark it with `uses_sense_index`. Report `unknown_tokens` (≤1) and `known_token_ratio` per example.
5. **Morpheme note — predictive only.** Emit `morpheme_note` ONLY if the `decomposition` prevents a specific, nameable error (a potential-complement/infix, a confusable look-alike or homophone, a bound morpheme that explains an opaque compound). Otherwise `null` + an `omissions` reason. A shared radical that merely signals a broad semantic field is **ritual etymology — omit it.**
6. **Contrast — invited only.** Emit `contrast` ONLY if a word in `sibling_queue_items` or `known_words` genuinely invites confusion with the target. Name the `trigger` word and the one-line `distinction`. Otherwise `null` + an `omissions` reason.
7. **Targeting judgment.** Set `review_target.durable_candidate` (true/false) and a terse one-line `retrieval_target` (the nameable thing to later retrieve) + `why`. This is a *recommendation*. Emit no prompt/answer/cloze, no approval, no scheduling field.
8. **Self-audit.** Fill `self_audit`: no present field is empty filler; senses were selected not dumped; the English/target answer is not embedded where it would spoil the `retrieval_target`; every example is within the unknown budget; every `null` optional section has an `omissions` reason.

<!-- INPUT_SLOTS: the runner fills this block from the daemon before sending -->
### Input (filled per queue item)

```json
{
  "queue_item": {
    "id": 0,
    "word": "<hanzi — queue_items.word>",
    "pinyin": "<queue_items.pinyin>",
    "gloss": "<queue_items.gloss — the single joined CEDICT gloss shown in the reader popup>"
  },
  "cedict": {
    "simplified": "<cedict.simplified>",
    "traditional": "<cedict.traditional>",
    "pinyin": "<cedict.pinyin>",
    "definitions": ["<sense 1>", "<sense 2>", "..."]
  },
  "decomposition": [
    { "char": "<one char of the word>", "ids": "<Ideographic Description Sequence, e.g. ⿰彳非>", "components": ["<component>", "..."] }
  ],
  "source": {
    "doc_id": 0,
    "doc_title": "<reading_docs.title>",
    "paragraph_idx": 0,
    "paragraph_text": "<reading_paragraphs.text — the full paragraph>",
    "sentence": "<reading_marks.sentence — the EXACT source sentence, quote verbatim>",
    "mark_id": 0
  },
  "known_words": ["<word>", "..."],
  "seed_function_words": ["的", "了", "是", "我", "你", "在", "有", "不", "..."],
  "sibling_queue_items": [
    { "word": "<hanzi>", "pinyin": "<...>", "gloss": "<...>" }
  ]
}
```

### Output schema (emit exactly one object of this shape)

```json
{
  "enrichment_version": "v0",
  "item": { "queue_item_id": 0, "word": "<echoed>", "pinyin": "<echoed; corrected only with a note>" },
  "provenance": {
    "source_sentence": "<verbatim reading_marks.sentence>",
    "doc_id": 0, "doc_title": "<...>", "paragraph_idx": 0, "mark_id": 0,
    "quote_verified": true
  },
  "sense_disambiguation": {
    "cedict_definitions": ["<all senses, echoed verbatim as evidence>"],
    "selected_sense_index": 0,
    "selected_sense": "<the one gloss the sentence uses>",
    "evidence_quote": "<minimal span of source_sentence that fixes the sense>",
    "gloss_in_context": "<one line: how the word functions HERE>",
    "source": "cedict | cedict-extended | inferred",
    "confidence": "high | medium | low",
    "note": null
  },
  "examples": [
    {
      "sentence": "<hanzi, 8-20 chars>",
      "pinyin": "<toned>",
      "translation": "<english>",
      "uses_sense_index": 0,
      "unknown_tokens": [],
      "known_token_ratio": 0.9
    }
  ],
  "morpheme_note": null,
  "contrast": null,
  "review_target": {
    "durable_candidate": true,
    "retrieval_target": "<one terse nameable thing, or null>",
    "why": "<why durable / why not>",
    "note": "Targeting judgment only (CARD-PROMOTION stage 2-3). Not a constructed card, not approved, not scheduled."
  },
  "self_audit": {
    "no_empty_filler_fields": true,
    "sense_selected_not_dumped": true,
    "answer_not_leaked_into_target": true,
    "examples_within_unknown_budget": true,
    "omissions": []
  }
}
```

Field rules the model must honor: `morpheme_note` and `contrast` are `null` **iff** there is a matching `self_audit.omissions` entry naming the section and the reason. `unknown_tokens` has length ≤ 1 per example and each entry is `"<hanzi> (<inline gloss>)"`. `source` on `sense_disambiguation` is the only place CEDICT vs inference is asserted for the sense; `morpheme_note.source` and `contrast.source` mark those as `ids+inferred` / `inferred`. Emit nothing outside the JSON object.

---

## Worked example A (AUTHORED — illustrative; coverage ratios hand-estimated, not computed against the live known set)

**Input (abridged):** `word` 看不惯 · `pinyin` "kàn bu guàn" · `cedict.definitions` `["to be unable to stand the sight of; to hate to see", "to disapprove of; to find distasteful"]` · `decomposition` 看 `⿱龵目` (手/龵 "hand" over 目 "eye") · 惯 `⿰忄毌` (忄 "heart" + 贯/毌) · `source.sentence` "他做事不负责任，我实在看不惯。" · `sibling_queue_items` includes 看不起 · `known_words` includes 讨厌, 负责, 做事, 实在.

```json
{
  "enrichment_version": "v0",
  "item": { "queue_item_id": 141, "word": "看不惯", "pinyin": "kàn bu guàn" },
  "provenance": {
    "source_sentence": "他做事不负责任，我实在看不惯。",
    "doc_id": 12, "doc_title": "示例读物", "paragraph_idx": 4, "mark_id": 233,
    "quote_verified": true
  },
  "sense_disambiguation": {
    "cedict_definitions": ["to be unable to stand the sight of; to hate to see", "to disapprove of; to find distasteful"],
    "selected_sense_index": 1,
    "selected_sense": "to disapprove of; to find distasteful",
    "evidence_quote": "做事不负责任……看不惯",
    "gloss_in_context": "moral disapproval of an ongoing behaviour, not a literal inability to see",
    "source": "cedict",
    "confidence": "high",
    "note": "Both senses share one form; the object here is a behaviour (不负责任), which selects the disapproval reading over the literal 'can't bear to look'."
  },
  "examples": [
    { "sentence": "我看不惯他那样对人。", "pinyin": "Wǒ kàn bu guàn tā nàyàng duì rén.", "translation": "I can't stand the way he treats people.", "uses_sense_index": 1, "unknown_tokens": [], "known_token_ratio": 1.0 },
    { "sentence": "这种浪费，大家都看不惯。", "pinyin": "Zhè zhǒng làngfèi, dàjiā dōu kàn bu guàn.", "translation": "Everyone disapproves of this kind of waste.", "uses_sense_index": 1, "unknown_tokens": [], "known_token_ratio": 1.0 },
    { "sentence": "老人看不惯年轻人的一些做法。", "pinyin": "Lǎorén kàn bu guàn niánqīngrén de yìxiē zuòfǎ.", "translation": "Older people disapprove of some of the things young people do.", "uses_sense_index": 1, "unknown_tokens": [], "known_token_ratio": 1.0 }
  ],
  "morpheme_note": {
    "components": [ { "char": "惯", "gloss": "be accustomed to (贯 'run through' + 忄 'heart')" } ],
    "note": "看不惯 is a potential complement V+不+C: 看 (look/regard) + 不 + 惯 (get used to) = 'cannot get used to seeing' → cannot tolerate. The positive form is 看得惯. 不 here is the infixed potential marker, not plain negation.",
    "predicted_confusion": "Reading 不 as ordinary negation ('not accustomed to looking'), or confusing 看不惯 with 看不见 (can't see) and 看不起 (look down on) — same 看不X frame, different complements.",
    "source": "ids+inferred"
  },
  "contrast": {
    "confusable_with": "讨厌",
    "trigger": "known-word:讨厌",
    "distinction": "看不惯 = can't stand / disapprove of an ongoing behaviour or practice (aesthetic/moral, often about how something is done); 讨厌 = dislike / find annoying, and can take a person or thing directly. Same 看不X frame: 看不起 = look down on / despise.",
    "source": "inferred"
  },
  "review_target": {
    "durable_candidate": true,
    "retrieval_target": "看X不惯 potential-complement 'can't stand / disapprove'; distinguish from 看不见 / 看不起",
    "why": "The V不C construction generalises (听不惯, 吃不惯, 住不惯…) and the 看不X family is a classic confusion cluster — higher yield than the single lexeme.",
    "note": "Targeting judgment only (CARD-PROMOTION stage 2-3). Not a constructed card, not approved, not scheduled."
  },
  "self_audit": {
    "no_empty_filler_fields": true,
    "sense_selected_not_dumped": true,
    "answer_not_leaked_into_target": true,
    "examples_within_unknown_budget": true,
    "omissions": []
  }
}
```

## Worked example B (AUTHORED — illustrative; ratios hand-estimated. Shows a *declined* morpheme note and a *glossed one-unknown* example.)

**Input (abridged):** `word` 徘徊 · `pinyin` "pái huái" · `cedict.definitions` `["to dither; to hesitate", "to pace back and forth", "(by extension) to hover around; to linger; to waver (e.g. of a value)"]` · `decomposition` 徘 `⿰彳非`, 徊 `⿰彳回` (both share 彳 'step') · `source.sentence` "他在门口徘徊了很久，最后还是没有进去。" · `known_words` includes 犹豫, 门口, 价格, 决定 · no sibling shares this lemma.

```json
{
  "enrichment_version": "v0",
  "item": { "queue_item_id": 158, "word": "徘徊", "pinyin": "pái huái" },
  "provenance": {
    "source_sentence": "他在门口徘徊了很久，最后还是没有进去。",
    "doc_id": 12, "doc_title": "示例读物", "paragraph_idx": 9, "mark_id": 251,
    "quote_verified": true
  },
  "sense_disambiguation": {
    "cedict_definitions": ["to dither; to hesitate", "to pace back and forth", "(by extension) to hover around; to linger; to waver (e.g. of a value)"],
    "selected_sense_index": 1,
    "selected_sense": "to pace back and forth",
    "evidence_quote": "在门口徘徊了很久，最后还是没有进去",
    "gloss_in_context": "physical pacing/lingering at a spot, shading into indecision (he never goes in)",
    "source": "cedict",
    "confidence": "medium",
    "note": "Literal pacing is primary here, but 最后还是没有进去 activates the hesitation reading too; the two senses blur in this sentence."
  },
  "examples": [
    { "sentence": "他一个人在房间里徘徊，怎么也睡不着。", "pinyin": "Tā yí gè rén zài fángjiān lǐ páihuái, zěnme yě shuì bu zháo.", "translation": "He paced alone in the room, unable to fall asleep.", "uses_sense_index": 1, "unknown_tokens": [], "known_token_ratio": 1.0 },
    { "sentence": "这几个月，房子的价格一直在高位徘徊。", "pinyin": "Zhè jǐ gè yuè, fángzi de jiàgé yìzhí zài gāowèi páihuái.", "translation": "These past months, house prices have hovered at a high level.", "uses_sense_index": 2, "unknown_tokens": ["高位 (a high level/position)"], "known_token_ratio": 0.9 }
  ],
  "morpheme_note": null,
  "contrast": {
    "confusable_with": "犹豫",
    "trigger": "known-word:犹豫",
    "distinction": "犹豫 = hesitate / be indecisive (a mental state, general). 徘徊 = pace back and forth or linger physically, and by extension waver/hover (often of a value or an unresolved situation); it is more literary and imagistic. Use 犹豫 for the feeling, 徘徊 for the movement or the drawn-out wavering.",
    "source": "inferred"
  },
  "review_target": {
    "durable_candidate": true,
    "retrieval_target": "徘徊 = pace/linger → (fig.) hover/waver at a level; literary; vs mental 犹豫",
    "why": "The literal→figurative extension is the durable, transferable part; the plain 'pace' sense is lower yield and readable in context. Flagging the extension is what pays off later.",
    "note": "Targeting judgment only (CARD-PROMOTION stage 2-3). Not a constructed card, not approved, not scheduled."
  },
  "self_audit": {
    "no_empty_filler_fields": true,
    "sense_selected_not_dumped": true,
    "answer_not_leaked_into_target": true,
    "examples_within_unknown_budget": true,
    "omissions": ["morpheme_note: skipped — 徘/徊 share the 彳 'step' radical, which only signals the broad 'movement' field and prevents no specific error; a breakdown here would be ritual etymology (INTENT: predict, don't flood)."]
  }
}
```
