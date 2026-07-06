# Primer vision — the dynamic learning medium

Idea-exploration document, distilled from the 2026-07-03/06 working sessions with Arthur. This is the *vibe record*: what we're trying to elicit, decided constraints, and the design space still open. Companion to `GOAL.md` (contract) and `docs/plans/primer-intuitions.md` (earlier distillation). A fresh session should read HANDOFF → GOAL → this.

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

## Vertical one: Chinese

**Learner state (ground truth, from Arthur's own tweet, `twitter:tweets:2064403866054168705`):** HSK1–5 word list *finished* after 185 days; the bottleneck is reading volume and speaking practice, not word lists. Exam intent ~6 months out. Design for a reader who needs *comprehensible input at volume*, not a beginner.

Ideas in play:
- **Reading environment**: paste/import Chinese web novels & books; mark unknown spans; popup dictionary (CEDICT + radical decomposition view); every mark → learning queue with sentence-context provenance.
- **The 85% rule / comprehensible input**: generate or select sentences calibrated to known vocabulary so unknowns are inferable from context (extensive-reading threshold literature — Arthur saved research on this; recover it, see Open Recoveries). Generated sentences come *from the learner model* (known-word set), not canned decks.
- **Tree-view expansion**: click an opaque span → it expands into scaffolded sub-sentences / decompositions, dynamically generated — "dynamic sentences, like Dynamicland."
- **Radical decomposition** as a first-class view, not a footnote.
- **Text scarcity is real** ("I can't find that much text"): sourcing pipeline for level-appropriate material is part of the vertical, and generation-from-known-vocab partially routes around it.
- **Audio/Cantonese lane**: Arthur uses Cantonese as a crutch (partial comprehension). Wants: better ASR (he found a specific better model — name not yet recovered; see Open Recoveries), aligned transcript playback with **click-a-span to seek/pause**, popup dictionary over the transcript. This is the wrapped-commentary listening UX generalized to language learning.
- **Current HSK flashcards judged not good** — regenerate against the didactic quality model below once the surface exists.

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

## Open recoveries (fresh session, cheap)

1. **The better ASR model** Arthur found (Cantonese-capable) — not in Mac browser substrate; check vault clippings, phone-side history, or ask him last.
2. **Comprehensible-input research he saved** (85%-rule adjacent) — same recovery paths.
3. HSK deck folder's own methodology notes — ScoutDecks locates; read before designing decks.
4. Arthur's Codex-session annotation critiques beyond what ScoutCritiques recovered.

## Sequencing (proposed)

1. **Close the loop skeleton**: reader ingests pasted Chinese text → mark → queue (ledger) → minimal review view with provenance-linked context. Popup dictionary (CEDICT) inside the reader.
2. **Scheduler**: hashcards/FSRS behind the queue.
3. **Derivation quality**: multi-model annotation/card generation + rubric eval harness; regenerate HSK cards.
4. **Audio lane**: aligned transcript + click-to-seek + dict popup (new ASR model).
5. **Malleable margins**: agent-generated cells (diagrams/simulations/tree expansions) on the anchor system.
6. **Mobile via Tailscale**; vertical two (math/PreTeXt) after Chinese proves the loop.

*Metric for the whole vertical: time-to-comprehension of the next chapter, trending down.*
