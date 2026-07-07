# Primer vision — the dynamic learning medium

Idea-exploration document, distilled from the 2026-07-03/06 working sessions with Arthur. This is the *vibe record*: what we're trying to elicit, decided constraints, and the design space still open. Companion to `GOAL.md` (contract) and `docs/plans/primer-intuitions.md` (earlier distillation). A fresh session should read HANDOFF → GOAL → this.

**Status: LIVING DOCUMENT — not set in stone.** Arthur (2026-07-06): don't one-shot this; read all the saved research first and iterate — while still exploring and implementing in parallel. Each session should leave this doc better-grounded than it found it.

## The spine (everything is one loop)

**read → friction → mark → agent enriches with context → queue → review near the source.**

Every idea below is a station on this loop. The failure mode of this stream is building six half-instruments instead of one deep one. When a feature idea appears, place it on the spine or park it.

## Vibes we are trying to get at

- **Extended mind, not flashcard app.** The medium answers back. Margins are alive. "Is this an extended reader? An extended mind?"
- **Locality of visuals.** Questions, diagrams, simulations, translations live *next to* the text they serve — margin-anchored, wrap-around when dense (the smart-wrap margin problem), 2D not 1D.
- **Malleable medium (Dynamicland / Bret Victor).** The agent can put *behavior* in the margin, not just text: a graph, a simulation, a code visualizer, dynamic sentence expansions. Sandboxed cells (iframe-ish) whose content the agent generates. The reader itself is agent-editable surface.
- **Effortless capture.** Marking something unknown must cost one gesture. The queue fills itself; categorization/labeling is automatic; the system optimizes what surfaces over time.
- **Agentic context (RLM-flavored).** Don't pre-engineer retrieval. The floating composer (command palette) hands the agent *the current page* plus the affordance to pull more — chapter, book, library, substrate — like a filesystem it can grep. The model manages its own context; it may ask follow-ups; it may leave **semantic question-anchors** in the margin.
- **Atomic cards, contextual review.** Cards stay atomic (Matuschak), but every card carries provenance edges back to the moment it came from; review can re-open that context. The mnemonic-medium insight, on our own surface.
- **Bret Victor rule for artifacts** (charter): every finished thing is experienceable in one click — dashboard, reader, playable.

## Decisions (recorded, binding until Arthur reverses)

1. **Own the SRS surface.** Reverses the earlier "feed Anki/mochi" leaning. Rationale: every observed pain (no popup dictionary, dead shortcuts, atomicity without context, deck-format ceilings) is a surface limitation; the substrate/moat argument is unaffected. Mochi + HSK decks migrate into this stream and become the design surface.
2. **Scheduler is borrowed, not invented.** Arthur's pick: the **hashcards** scheduler (eudoxia0/hashcards — plain-text SRS, Rust, simple; in the substrate at `browser:events:239`). Evaluate embedding it vs. porting its rule set vs. `ts-fsrs`; the decision is "boring existing scheduler," not which one.
3. **No Yomitan fork.** We need dictionaries (CC-CEDICT et al.) + an in-reader popup where we control the DOM and know the sentence, chapter, and known-word set. In-reader lookup beats a general-site extension at a tenth the cost.
4. **Chinese is vertical one.** Math/PreTeXt/simulations is vertical two and inherits the margin system. Chinese has the honest metric: *does Arthur read the next chapter faster, with fewer lookups?*
5. **Tailscale for mobile v1.** Website served over tailnet; no auth code; no public UUID URLs (the surface carries reading/browsing life). iOS app later.
6. **Paste-first reading environment.** V1 ingests text (paste a chapter / import a book) into our reader rather than annotating arbitrary sites in place. (Default pending Arthur's veto.)
7. **Product LLM calls on subscription lanes** (gemini-flash default, kimi fallback), never the orchestrator model. Already enforced in primer-daemon.
8. **Browser-rendered surface, Electron when it needs to be an app.** Anki-extension stopgap considered and rejected: Anki is not Electron, agents can't iterate/drive/test it well. Our surfaces render in the browser (agents test via CDP/headless; CuaDriver for app QA) — the dashboard/reader already comply; an Electron shell comes when a desktop app is warranted.
9. **The reader carries known UX debt** — "small UX issues everywhere." A deliberate polish pass over the wrapped-commentary reader is scheduled work, not implied; its sweat-equity UX is the asset we build on, so it must feel good.

## Vertical zero (standing): deep philosophy reading

The reader's original purpose stays a first-class goal: read Nick Land and Nietzsche *deeper* — actually appreciate the reference genealogy (Marx, D&G, Kaufmann's Nietzsche, CCRU lineage) — with "creative graph understanding": the concept graph and margin annotations as instruments for seeing structure, not decoration. The 40-book philosophy library and meltdown annotation corpus are its substrate. Chinese is vertical *one* because its metric is honest; philosophy depth is the standing vertical the annotation-quality work ultimately serves.

Taste anchors (Arthur, 2026-07-06 rant, recorded): modern academic philosophy prose is "myopic and boring" — the wanted lens is **sci-fi-flavored philosophy**; Land is the ideal, Nietzsche the other pole. Annotation effort is MOST valuable on philosophy books ("not sure annotations help much with math books — start with the philosophy ones"). Also queued in this vertical: a **China history book** he wants to read (title unrecovered — search downloads/library), and 4chan-lit acquisitions (`artifacts/4chan-lit-charts/` maps that corpus).

**Shakespeare lane (new, long-horizon)**: Arthur wants to eventually *understand* Shakespeare and *write like* him. Key companion text identified from his description ("conservative Shakespeare critic, long book, basically annotations, Shakespeare invented consciousness"): **Harold Bloom, *Shakespeare: The Invention of the Human*** — being acquired (Bloom argues the plays invented modern personality/inwardness; structured play-by-play, i.e. native margin-annotation material). Bloom + a complete-works edition make Shakespeare a natural reader vertical after the philosophy loop proves out: original text in the center column, Bloom + glossary + genealogy in the margins. "Write like Shakespeare" implies production exercises eventually (imitation drills on the anchor system), not just reading.

## Vertical one: Chinese

**Learner state (ground truth, from Arthur's own tweet, `twitter:tweets:2064403866054168705`):** HSK1–5 word list *finished* after 185 days; the bottleneck is reading volume and speaking practice, not word lists. Exam intent ~6 months out. Design for a reader who needs *comprehensible input at volume*, not a beginner.

Ideas in play:
- **Reading environment**: paste/import Chinese web novels & books; mark unknown spans; popup dictionary (CEDICT + radical decomposition view); every mark → learning queue with sentence-context provenance.
- **The 85% rule / comprehensible input**: generate or select sentences calibrated to known vocabulary so unknowns are inferable from context (extensive-reading threshold literature — Arthur saved research on this; recover it, see Open Recoveries). Generated sentences come *from the learner model* (known-word set), not canned decks.
- **Tree-view expansion**: click an opaque span → it expands into scaffolded sub-sentences / decompositions, dynamically generated — "dynamic sentences, like Dynamicland."
- **Radical decomposition** as a first-class view, not a footnote.
- **Text scarcity is real** ("I can't find that much text"): sourcing pipeline for level-appropriate material is part of the vertical, and generation-from-known-vocab partially routes around it. New lane (2026-07-06): **micro-dramas** — Arthur wants shadowing on the phone to "spam micro-dramas"; ASR'd drama subtitles are both comprehensible input at volume and a text source (hard subs make ASR errors verifiable).
- **Audio/shadowing lane — BUILD TARGET (Arthur, 2026-07-06): no shadowing tool exists; we implement it.** His words: "we want to make something like the shadowing tool in the vid too… the point of pouring so much effort into [alignment] is so I can replay specific phonemes and replay from points in the sentence." Requirements (from the tweet demo `2073920351541588446` + directive): char-wise ASR subtitles (**FireRedASR2S**), replay from any point in a sentence, replay specific phonemes (MFA-style forced alignment — bablefish's `forced-alignment-chinese` and hsk-deck's `hsk-align --backend qwen` are the in-house prior art), audio slow-down, sentence repeat/jump, pinyin/hanzi/both toggle. Arthur uses Cantonese as a crutch (partial comprehension); aligned transcript + click-a-span to seek/pause + popup dictionary over the transcript = the wrapped-commentary listening UX generalized.
- **Current HSK flashcards judged not good** — regenerate against the didactic quality model below once the surface exists. **Concrete failure named (Arthur, 2026-07-06): progressive disclosure breaks — cards introduce several unknowns at once ("too many unknown words, and I get confused"). Card-level comprehensible-input rule now binding: the target word is THE new thing; scaffolding vocabulary from HSK1–4; at most ONE unknown beyond the target, glossed inline if unavoidable.** The constrained-sentence-generation machinery in hsk-deck is the enforcement tool — cards should be *generated through* the known-word model, not just checked against it.
- **Cantonese vocabulary mismatch (new lane)**: Arthur's listening Cantonese fails not from phonology but vocabulary — he knows "HSK Cantonese" (Mandarin-HSK cognates read with Canto pronunciation) + conversational basics, while real Cantonese media runs on colloquial vocabulary that doesn't overlap HSK. Needed: a colloquial-Cantonese frequency lane (media-derived vocab, CC-CEDICT.Canto is vendored in hsk-deck) diffed against his HSK-cognate set — the shadowing tool + cdrama subtitles are the natural harvester.

## Didactic annotation quality (the derivation redesign)

Grounded corpus already exists — use it, don't re-derive:
- `streams/primer/wrapped-commentary-reader/references/` — annotation-generation prompt (the one in use: `scripts/prepare-book-ir.ts:517-620`), reader-profile.md ("do not explain ROM" — respect what the reader knows), agent-context.md, flashcard-design-notes.md (T0–T3 card taxonomy), chapter-enrichment-prompt.md, andy-matuschak-prompts.html.
- `sideline-annotation-card` skill + `docs/plans/primer-intuitions.md`: reject T1 (on-topic but vague/unstable); target T2 (precise conceptual link); T3 (cross-unit synthesis) only when invited; word-golf compression ("Kennedy → Apollo → Star Wars → information superhighway"); whole-unit-first; never paraphrase ("if a note could be inferred by rereading the source sentence, omit it"); add *missing* context (genealogy, mechanism, prerequisite), anchored to an exact phrase.
- Known model failure (Memory Machines eval, Matuschak & Kirkby 2026, `browser:events:206005`): frontier LLMs write poor flashcards and newer ≠ better (GPT 5.4 < 5.2, Opus 4.7 < 4.6). Consequence: **multi-model derivation with a rubric-scored eval harness** on subscription lanes, not faith in the newest model. Pipeline exists to retrofit: prepare-book-ir → omp batch runners (kimi-k2.5 / gpt-5.5 today) → import → export IR.

## Surfaces (current estate this lands on)

| Surface | State |
|---|---|
| `packages/primer-daemon` | Query path + streaming synthesis + ledger (notes/cards/progress) + dashboard (React/shadcn, vim nav) at `primer.localhost:1355` |
| Wrapped-commentary reader | Talmudic 3-column canvas, marks/selections/graph, served at `meltdown.localhost:1355`; annotation pipeline scripts; **to be tracked in-repo** (integration decision) |
| Ledger | `data/primer/daemon-ledger.sqlite` — becomes the learning-queue/inbox substrate |
| Learning-card-system.sqlite | HSK budget + concept graph — wire as 4th daemon substrate |
| `decks/hsk-deck` → `~/apps/hsk-deck` | Deck generator with **constrained sentence generation** (progressive difficulty = the 85%-rule machinery), cleaned HSK1–4 decks, Canto/Mando grammar drills, `hsk_meta.db`, vendored CC-CEDICT, Yomitan enrichment + Firefox setup scripts |
| `decks/mochi` → `~/Documents/mochi` | Three .apkg exports (~790MB, 2025-06) |
| `decks/yomitan` → `~/apps/yomitan` | Yomitan source (the fork attempt — superseded by in-reader dictionary decision) |

## Skycak absorbed (2026-07-06 corpus pass — full distillation: `research/skycak-pedagogy.md`)

The Skycak corpus turned out to be already IN-REPO and large: 54 cataloged sources + cleaned transcripts + the full *Math Academy Way* text at `wrapped-commentary-reader/docs/research/justin-math-learning/` and `feedstock/Books_Papers_Research/books/the-math-academy-way.txt`; content graph in `artifacts/learning-card-system/math-academy-graph.sqlite` (8 courses / 194 topics / 285 edges). His model, compressed: mastery learning over a fine-grained prerequisite graph; deliberate practice = surgical error exposure ("find the bottleneck, design the rep"); diagnostics measure TIME, not just correctness; FIRe — reviews on advanced topics "trickle down" implicit credit through encompassing edges (most topics need ~1 explicit review); automaticity frees cognitive load; concrete examples with actual numbers; reference lookup is a crutch to be made *annoying* during practice.

Spine implications we adopt (tensions recorded, not papered over):
- **Recognition ≠ production.** Marking a word is familiarity, not mastery. Queue items grow attempt fields (`time_to_solve`, `reference_used`) when the scheduler lands — correct-but-slow is not solid.
- **Mode asymmetry on lookup friction.** Skycak's "make lookup annoying" applies to REVIEW, not reading: in the reader, one-gesture lookup IS the capture mechanism (input volume is the goal); in review, no popup dictionary — production first.
- **The queue must schedule, not store.** Without intervals it's a todo list. Phase-2 scheduler is load-bearing, not polish.
- **Encompassing credit fits language.** Reading a sentence containing five due words IS a FIRe-style implicit review — the 85%-rule generation machinery and the review scheduler should eventually share the known-word model.
- **Diagnostic before queue-stuffing.** HSK1–5 "known" list is self-reported; a timed mini-diagnostic can true it up later.

## Research corpus (state after 2026-07-06 pass — reports in `research/`)

- **Andy Matuschak** — prompts essay (vault clipping + `references/andy-matuschak-prompts.html`), mnemonic medium, Memory Machines eval. Still the annotation-quality anchor.
- **Justin Skycak** — LOCATED + distilled (section above). Only the standalone algorithms PDF wasn't downloaded locally (URL in `browser:events:91049`).
- **The 85% rule** — RECOVERED: Wilson et al. 2019, "The Eighty Five Percent Rule for optimal learning", `feedstock/Zotero/storage/2DKELXFD/`, queued in Arthur's own `feedstock/library/papers/queues/read-next.md`. Note the distinction: Wilson = optimal *error rate* in training; lexical-coverage reading research (Hu & Nation 98%) is adjacent but separate — treat both as calibration inputs for constrained generation.
- **Comprehensible-input sources are already in hsk-deck**: `~/apps/hsk-deck/docs/sources/language-acquisition/` has Krashen (Principles & Practice; Optimal Input 2020), Nation (Four Strands 2007), plus Webb meta-analyses (incidental vocabulary; glossing) per `feedstock/library/book-index.md:219-221`. The `feedstock/Clippings/Methods of Mandarin.md` clipping carries Arthur's live threshold debate (95% recommended; deliberately reading at 70–85% discussed at lines 1049–1065). Hu & Nation 2000 itself is NOT local.
- **A third author** — best candidate **Fernando Borretti** (hashcards author; `browser:events:96369`, `events:239`; local repo `~/github/hashcards`; an EPUB of his in the library index). Confidence medium — Nielsen/Wozniak appear only as citations inside Matuschak clippings. Confirm with Arthur casually sometime.
- **Pleometric voice** (Arthur, 2026-07-06): @pleometric is Arthur's own X account; the specific saved language-learning writing is `feedstock/Clippings/Thread by @pleometric.md` (x.com/pleometric/status/2027034632273699100) — his Yomitan hover-dictionary → Anki vocab-mining workflow + 61k-word Edge-TTS audio generation. 84 of his tweets are in the twitter archive (`username='pleometric'`); keep capturing (the shadowing-tool tweet was not yet archived).
- **Corpus triage** (`research/corpus-triage.md`): gay-primer = a PDF margin-annotation prototype (prior art for read→mark UX); Hacking Chinese (Olle Linge) + HSK Standard Course 1–2 textbooks in `feedstock/library/books/Language Learning/`; plasticity papers (Dohare et al.) as review-decay analogies; Zotero reader-state files as resume/review-state modeling reference.

## Open recoveries

1. ~~The better ASR model~~ **SOLVED (2026-07-06): FireRedASR2S** (`github.com/FireRedTeam/FireRedASR2S`, Mandarin-tuned; NVIDIA Parakeet for other languages — Arthur's own reply). Evidence: his tweet `x.com/pleometric/status/2073920351541588446`.
2. ~~Locate the shadowing tool repo~~ **RESOLVED (Arthur, 2026-07-06): it doesn't exist — we implement it** (see Audio/shadowing build target above). The tweet showed the concept. Local search record in `research/recoveries.md` §5; useful adjacent assets found: `~/github/Mandarin-Subtitles-Archive`, `~/apps/bablefish` (MFA forced alignment), hsk-deck `hsk-align` + real Mandarin sentence audio under `~/apps/hsk-deck/audio/sentences/`.
3. ~~Comprehensible-input research~~ **RECOVERED** (Wilson et al. — see corpus section; lexical-coverage literature still worth importing deliberately).
4. HSK deck methodology notes — README read (constrained sentence generation = the 85%-rule machinery); deeper `data/validation/` review notes remain unmined.
5. Arthur's Codex-session annotation critiques beyond what ScoutCritiques recovered.
6. The third author (see corpus section).

## Sequencing (proposed)

1. **Close the loop skeleton**: reader ingests pasted Chinese text → mark → queue (ledger) → minimal review view with provenance-linked context. Popup dictionary (CEDICT) inside the reader. *(landing 2026-07-06)*
2. **Shadowing tool v1** (promoted per Arthur, 2026-07-06): alignment pipeline (FireRedASR2S → char-level timestamps JSON; MFA phones v1.5) + shadowing surface in the dashboard — click char/word to seek, replay from any point, sentence A–B loop, speed 0.5–1×, pinyin/hanzi/both. Feeds on hsk-deck sentence audio first, then cdrama clips.
3. **Scheduler**: hashcards/FSRS behind the queue.
4. **Derivation quality**: multi-model annotation/card generation + rubric eval harness; regenerate HSK cards.
5. **Malleable margins**: agent-generated cells (diagrams/simulations/tree expansions) on the anchor system.
6. **Mobile via Tailscale** (shadowing on the phone is the pull); vertical two (math/PreTeXt) after Chinese proves the loop.

*Metric for the whole vertical: time-to-comprehension of the next chapter, trending down.*
