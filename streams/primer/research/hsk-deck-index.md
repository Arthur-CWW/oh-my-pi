# hsk-deck docs index (for Primer)

**Status:** index, 2026-07-16. A map of the documentation, READMEs, and design
notes inside `streams/primer/decks/hsk-deck/` (symlink → `~/apps/hsk-deck`) so
Primer builders know *which doc to read for which decision*. This is an **index,
not a reorganization**: `hsk-deck` is Arthur's live app repo — **READ-ONLY, never
move/rename/rewrite its files in place.** Paths are relative to the hsk-deck root.

**Epistemics covenant:** rows that look dated, superseded, ephemeral, or
fast-decaying are flagged `⚠️STALE?` with the reason. A flag is a *recheck
prompt*, not a delete order (`PREFERENCES.md`: "Never silently delete stale
evidence ... Mark stale rather than deleting"). Model/provider/scraping detail
decays fastest.

Companion: `acquisition-doctrine.md` (the theory these docs ground).

---

## Read-first — acquisition & card-design keystones

| Doc | What it contains | Primer should read it for |
|---|---|---|
| `docs/mandarin-cantonese-card-design-report.md` | **The design keystone.** Arthur's first-person context (Cantonese heritage, Hanly failure, "English was the detour"), the reveal-cost card hierarchy (Mandarin primary → Canto bridge → zh-zh → char-repair → English last), Hanly data audit (coverage tables), definitions/pictures/pinyin policy, front/back card shape, leverage hierarchy. | **All four surfaces.** The source of the do/don't table in `acquisition-doctrine.md` §e. Read before designing reader popup, enrichment output, or review cards. |
| `docs/pleometric.md` | **Primary source.** Distilled Pleometric (= Arthur) acquisition doctrine + verbatim tweet transcripts: word→concept not word→word, Krashen/ALG, CN-CN-dictionary-only rule, no-output-until-comprehension, ~5 h/day input, the 便宜 debug walk, constrained HSK deck generator. | The acquisition theory itself; quote-grounding for enrichment/ask-panel language rules. |
| `docs/review-practice-guidelines.md` | How Arthur wants to *grade* review: `Hanzi ↔ Mandarin sound ↔ meaning ↔ Cantonese bridge`; Good/Hard/Again/Easy semantics; "Cantonese is a controlled crutch, not cheating"; the self-check (Canto clear but Mandarin still noise ⇒ mark Again); don't autoplay Canto on front. | Review-card grading logic and the Canto-bridge guardrail. |
| `README.md` (root) | Deck generator overview: **constrained sentence generation** (only previously-learned words + ~80 function-word seed + target = the 85%-rule machinery), two-stage cleaning, tone coloring, TTS, progressive difficulty, CLI table. | The comprehensibility-gate mechanism (doctrine §d); enrichment "generate through the known-word model". |
| `docs/anki-chinese-hover-dictionary-addon-design.md` | Reader-popup design: `Shift`-hover, longest-match lookup, compact popup = expression + pinyin + **zh definitions (English not shown)** + example + reused audio; JSONL dict format; CC-CEDICT is English-oriented so insufficient alone. | **Reader popup** surface directly — the monolingual-popup principle. |

---

## Card / sentence corpora (aligned examples & grammar)

| Doc | What it contains | Primer should read it for |
|---|---|---|
| `docs/hsk1_sentences.md` | HSK1 cards as **vertical M/C sentence pairs** (Mandarin pinyin+hanzi over Cantonese jyutping+hanzi). The literal "vertical alignment / one-to-one mapping" format. | The Canto-pivot alignment unit (doctrine §b). Example of the sentence-level, not char-level, stack. |
| `docs/Cantonese Translation Analysis.md` | Worked Canto↔Mando divergences (给/俾 placement, 把 disposal, aspect 咗/緊, negation 唔/未) with Arthur's own Q&A ("I am familiar with cantonese ... need help with mandarin"). | Why char-level alignment is impossible; where the pivot's grammar seams are. |
| `docs/grammar-drill-cards.md` | 49 sentences × 16 Canto→Mando grammar patterns, each with the word-order rule (Canto Traditional, Mando Simplified). | Grammar-pattern coverage for enrichment; the pivot's systematic divergences. |
| `docs/grammar_sentences_table.md`, `docs/grammar_sentences.md`, `docs/grammar_canto_sentences.md`, `docs/grammar_mando_sentences.md` | Rendered grammar-drill sentence sets (aligned table form / per-language lists). | Corpus reference; sample data for reader/review prototypes. |
| `canto_sentences.md`, `mando_sentences.md` (root) | Raw per-language sentence corpora (Canto Traditional / Mando Simplified). | Bulk sentence source; not design docs. |

---

## Pipeline / data / CLI conventions

| Doc | What it contains | Primer should read it for |
|---|---|---|
| `docs/DATA_CONVENTIONS.md` | Tracked-vs-gitignored artifact boundaries (source: vocab lists, prompts, template; generated: audio, `.apkg`, cleaned JSON, caches), env vars, provider keys. | Where card data lives; what's reproducible vs. source-of-truth before wiring hsk-deck data into the daemon ledger. |
| `docs/CLI_REFERENCE.md` | Command list from `pyproject.toml` (clean, generate, align, check, sync, audit, review, QC). | Which command produces which artifact; the `hsk-align --backend qwen` forced-alignment entrypoint for the shadowing lane. |
| `docs/prompt-tracking.md` | Sentence-generation prompts are versioned pipeline data (numbered immutable TOML snapshots + `ACTIVE` pointer + SQLite hash registry in `hsk_meta.db`). | The multi-model derivation/eval retrofit (`VISION.md` §Didactic quality); prompt provenance discipline. |
| `docs/sentence-difficulty-audit.md` | Sentence-difficulty outlier tagging (e.g. `canto:hard_bridge`, `target:bad_placement_candidate`) + keep/regenerate/defer recommendations. | The 85%-gate calibration signal; which sentences violate "≤1 unknown beyond target". |
| `docs/browser-review-feature.md` | SolidJS in-browser triage UI for difficulty outliers (keep/regen/defer), reusing the `Reader` component; why not a separate Python/iframe server (focus-steal, Qt-thread spam). | Prior art for a browser review/triage surface; the "iframe steals focus → shortcuts break" lesson. |

---

## Provider / audio detail — ⚠️ fast-decay

`PREFERENCES.md`: "Model names, routing recipes, generated config ... decay
fastest. Preserve the model-independent reason, not the residue." Read these for
*mechanism*, distrust the specific voice IDs / models / credit costs.

| Doc | What it contains | Flag |
|---|---|---|
| `docs/minimax.md` | MiniMax TTS voices (Bashful Girl = Mandarin, Wise Professor = Cantonese), batch/split-on-silence pipeline, pause tags. | ⚠️STALE? — provider/voice/model choices are operational, not doctrine. |
| `docs/minimax-migration-context.md` | Generator changes wiring MiniMax voice IDs + env vars for Mando/Canto sentence audio. | ⚠️STALE? — concrete voice IDs / `speech-2.8-turbo` model version will drift. |
| `docs/minimax-scraping-tactics.md` | Browser-frontend scraping tactics (Cloudflare handling, tab reuse, per-card credit costs). | ⚠️STALE? — scraping tactic tied to a provider UI; brittle. |
| `docs/audio-corruption-postmortem.md` (2026-05-31) | Root-cause postmortem: index-based media filenames caused cross-checkpoint audio swaps + stale forced alignment; fix = stable resume-key-hashed filenames, `--changed-only` realign, SQLite provenance. | Enduring lesson (stable identities / resumable pipelines, echoes `PREFERENCES.md` "auditable data pipelines"); the *dates/numbers* are a snapshot. |

---

## Hanly reverse-engineering (radical/root decomposition source)

`hanly-re/` — extraction of the Hanly macOS app's bundled content (the
radical/root decomposition corpus for doctrine rung 4). ⚠️ Dated ~4 months old;
the Hanly app may have changed since. Read for *what data exists*, re-extract
before relying on exact counts.

| Doc | What it contains | Primer should read it for |
|---|---|---|
| `hanly-re/README.md` | What was extracted → `output/hanly-content.sqlite` (characters, words, primitives, sentences, strokes, stories, etc.); XOR-obfuscation key; rebuild command; example queries; Firestore cache not yet extracted. | The character-repair data source (decomposition/etymology/primitives) for enrichment rung 4. |
| `hanly-re/docs/full-reverse-engineering-report.md` | Consolidated architecture/storage/decoding/extraction report. | Deep reference if re-extracting or extending the corpus. |
| `hanly-re/docs/how-hanly-is-made.md` | High-level app architecture notes (Flutter/iOS-on-Apple-Silicon). | Context for the RE; low Primer priority. |
| `hanly-re/docs/local-storage-and-data.md` | Local storage locations + what they contain (incl. the un-extracted Firestore edit-overlay/user cache). | If Primer ever wants Hanly's user-progress or edit overlays. |
| `hanly-re/docs/reverse-engineering-log.md` | Ongoing findings, artifacts, open questions. | RE provenance trail. |

> `docs/mandarin-cantonese-card-design-report.md` §"Hanly Data" is the *curated*
> verdict on what to use (decomposition, etymology, primitives, HSK1-4 usage
> sentences) and drop (English Heisig stories). Prefer that over raw RE docs for
> design decisions.

---

## Reader / dev surfaces

| Doc | What it contains | Flag |
|---|---|---|
| `reader/README.md` | **Current** SolidJS reader prototype: ruby pinyin, forced-alignment highlight, click-to-seek, Mando/Canto toggle, alignment backends (Qwen/Whisper/Linear/Off), 0.5–1.5× speed, word-fusion, 60fps highlight. Shared `Reader.tsx` inlined into the Anki build. | Prior art for the reader + shadowing (click-to-seek, alignment backends) surfaces. |
| `dev/README.md` | *Earlier* single-file `reader.html` prototype + Bun server + mobile visual-overflow checker. | ⚠️STALE? — predates/superseded by `reader/` (SolidJS); also references stale path `/Users/arthur/projects/HSK-deck` (repo is `~/apps/hsk-deck`). Use `reader/` for current behavior. |
| `docs/STATUS.md` (2026-05-28 handoff) | Session-handoff snapshot: quick-start commands, reviewer shortcuts, known issues (Canto alignment spot-checks, non-CDP reviewer webview). | ⚠️STALE? — dated handoff; verify each item against current repo before trusting. Good for the reviewer-shortcut conflict list (informs review keymap). |

---

## Source library (external research PDFs)

| Doc | What it contains | Primer should read it for |
|---|---|---|
| `docs/sources/language-acquisition/README.md` | Index of local PDFs + `.txt` extractions: **Krashen** (Principles & Practice; Optimal Input 2020), **Nation** (Four Strands 2007), **Webb/Yanagisawa/Uchihara** glossing + incidental-vocab meta-analyses, **Zhang & Roberts** Chinese-L2 reading meta-analysis, **Tong & Yip** character-acquisition; plus blocked-download DOIs. | The empirical backing for CI, glossing (L1>L2 gloss caveat), radical/character-acquisition claims cited in doctrine §a/§c. |

---

## Scratch / session artifacts — ⚠️ not specs

Real signal, but raw/ephemeral. Treat as leads, not doctrine.

| File | What it is | Flag |
|---|---|---|
| `todo.md` (root) | Arthur's raw scratch notes: "ripoff the radical tree/explorer from hanly", "add picture/radical to remember the meaning", "why are so many hsk cards filled with words (not focused) surrounding it which are high level" (= the progressive-disclosure-breaks complaint), indexing/punctuation bugs, font gripes. | ⚠️ Undated fragments; **primary intent signal** (esp. the radical-explorer wish + card-noise complaint) but not a spec. |
| `docs/card-issues.md` | 4-line scratch note: one card's word/sentence-vs-audio mismatch (`女`). | ⚠️STALE? — ephemeral bug jot (74 bytes). |
| `docs/019e7bec-7fdb-7d43-a521-ba2934ccf3f3.md` | UUID-named ad-hoc session note (audio regen + forced-alignment fix log). | ⚠️STALE? — one-off session artifact; superseded by `audio-corruption-postmortem.md`. |
| `docs/pi-session-2026-05-30…​.html` | 1.6MB exported Pi session transcript (HTML). | ⚠️ Not a doc — a session dump. Do not read as documentation. |
| `AGENTS.md` (root) | Agent conventions for working *in* the hsk-deck repo (already auto-loaded as dir-context when editing there). | Read only if you edit hsk-deck directly (you generally shouldn't — READ-ONLY). |
| `complete-hsk-vocabulary/README.md` | Vendored upstream HSK 3.0 word-list dataset README (drkameleon/complete-hsk-vocabulary). | Source-data provenance for the known-word model; upstream, not Arthur's design. |
