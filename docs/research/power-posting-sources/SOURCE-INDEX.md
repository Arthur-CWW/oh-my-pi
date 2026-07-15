# Power-Posting Source Index

Path-first map of the literary/theory feedstock for the Playground **power-posting** video lane
(oral-medium narration videos — accelerationist/rationalist theoryposting, pleometric-style).
Use this to locate a corpus in seconds and know who owns it and what it is good for.

**Ownership legend**

- **PLAYGROUND** — in-repo research feedstock for this lane; editable here.
- **PRIMER (read-only)** — processed book artifacts owned by the Primer stream; *inputs only*, never edit/move from this lane.
- **LOCAL SHELF (read-only originals)** — Arthur's local libraries; source epubs/PDFs, quote/analyze only.

All repo-relative paths are from the repo root (`~/agents`). Home-dir paths use `~`.

---

## 1. Playground-native research (PLAYGROUND)

Verbatim archives, ontology/vibe distillation, and the pleometric corpus. In-repo, editable.

### `docs/research/power-posting-sources/`

| Path | What it is |
|---|---|
| `meltdown.md` | Nick Land, *Meltdown* (1994) — **complete verbatim**, provenance-checked (CCRU ccru.net edition, one encoding artifact normalized). Tonal north star; primary verbatim-quote source. |
| `ontology.md` | "Theoryposting" ontology — genre invariants, the account "wings", why it is an oral medium. Fable synthesis. |
| `vibe-brief.md` | Creative direction for the narration lane, corrected against the **spoken** record (39 pleometric whisper transcripts). Register, structure, script guidance. |
| `influences.md` | Literary/anime influence stack (Borges, Nietzsche, Lain/GitS/Eva) with local-copy pointers + narration-use notes. |
| `theoryposters-sample.md` | Verbatim long posts: @repligate (j⧉nus) + @xenocosmography. Abstract/theory-poster voice. |
| `teortaxes-longposts.md` | @teortaxesTex verbatim longposts — geopolitical China/AI-race voice. |
| `apralky-posts.md` | @apralky ("yung macro") verbatim posts — rationalist/accelerationist macro-longpost voice. |
| `pleometric-longposts.md` | @pleometric verbatim text threads — practitioner (process/technique) + concept posts. |
| `yungmacro-posts.md` | Pointer stub → `apralky-posts.md` (kept only because deletion is EPERM-blocked). |
| `README.md` | Verbatim-archive provenance, scope history, and walls-hit caveats for all of the above. |

### Pleometric corpus (video + transcripts + catalog)

| Path | What it is |
|---|---|
| `docs/research/pleometric-reference-catalog.md` | Visual/textual reference catalog across a 30-video slice — per-video references, techniques, style tags. Visual-concept mining. |
| `data/inspiration/pleometric/transcripts.json` | Whisper transcripts of pleometric's own videos — the **spoken** record (narration cadence). |
| `data/inspiration/pleometric/manifest.json` | Corpus manifest (`pleometric-corpus.v1`): tweetId, date, text, media file, source URL, dims, duration. |
| `data/inspiration/pleometric/leads.json` | Additional lead pointers for the corpus. |
| `data/inspiration/pleometric/*.mp4` | ~130 downloaded pleometric videos (visual grammar / kineticslop reference). |

### Wider X archive

| Path | What it is |
|---|---|
| `docs/research/twitter-x/assets/` | Per-tweet media assets (pleometric, bubbleboi, and others). |
| `docs/research/twitter-x/bubbleboi-2026-06-23-market-commentary/` | Captured thread (`all-tweets.md`, `assets/`, `raw/`, `source-urls.txt`). |
| `docs/research/twitter-x/thegreatest_sv-22yo-372k.md` | Single-poster capture. |

---

## 2. Primer processed books (PRIMER — read-only inputs)

Owned by the **Primer** stream and produced by its wrapped-commentary reader pipeline.
Treat as **read-only inputs** to this lane: block-level structure + annotations for chunk analysis.
**Do not edit, move, or re-process from the power-posting lane.**

Base: `streams/primer/wrapped-commentary-reader/`

### Meltdown (cleaned / normalized / annotations)

| Path | What it is |
|---|---|
| `cleaned/meltdown.md` | Cleaned Meltdown text. |
| `site/meltdown-normalized.md` | Normalized markdown. |
| `site/meltdown-reader-ir.json` | Reader IR (units/blocks) — chunk-level structure. |
| `site/meltdown-source-blocks.json` | Source block map. |
| `site/meltdown-annotations.json` / `.csv` / `.sqlite` | Annotation set (multiple formats). |
| `site/books/meltdown-deep/reader-ir.json` | Deep-pass staged annotation IR. |
| `raw/1_melt.html` · `pretext/meltdown-full.ptx` · `pretext/meltdown-annotated.ptx` · `site/land_meltdown.pdf` | Raw/PreTeXt/PDF renditions. |

### Nietzsche (processed reader books)

Base: `streams/primer/wrapped-commentary-reader/artifacts/books/`. Each dir holds `reader-ir.json`, `<slug>.sqlite`, `manifest.json`, `prompts/`, and `annotation-range-*.jsonl`.

| Path | Title |
|---|---|
| `nietzsche-will-to-power/` | *The Will to Power* (trans. Kaufmann & Hollingdale). |
| `nietzsche-basic-writings/` | *Basic Writings of Nietzsche* (trans./ed. Kaufmann). |
| `nietzsche-gay-science-book-one/` | *The Gay Science*, Book One (partial). *(also `nietzsche-gay-science-test/` small fixture.)* |
| `nietzsche-genealogy-of-morals/` · `nietzsche-birth-of-tragedy/` | Adjacent processed Nietzsche (Genealogy, Birth of Tragedy). |

### Accelerando (chapters)

| Path | What it is |
|---|---|
| `artifacts/books/accelerando-v2/` | Current processed reader book (`reader-ir.json` + `.sqlite`), 9 units. |
| `artifacts/books/accelerando/` | Legacy-sections processed reader book. |
| `artifacts/library/accelerando-chapters-plain.md` | Plain-text chapters (narration-ready source text). |
| `artifacts/library/accelerando-chapters.md` | Formatted chapters. |
| `artifacts/library/_David,_Charles_Stross,_George_-_Accelerando_(2005)_-_libgen.li.epub` | Source epub. |

---

## 3. Local shelves (read-only originals)

### Calibre Library — `~/Calibre Library/`

| Path | Contents |
|---|---|
| `~/Calibre Library/Jorge Luis Borges/Collected Ficciones (10)/Collected Ficciones - Jorge Luis Borges.epub` | Collected Ficciones (primary epub). |
| `~/Calibre Library/Jorge Luis Borges/Ficciones (8)/Ficciones - Jorge Luis Borges.epub` | Ficciones. |
| `~/Calibre Library/Jorge Luis Borges/Collected Ficciones (13)/` | Metadata + cover only (no epub). |
| `~/Calibre Library/Friedrich Nietzsche/Beyond Good & Evil (42)/Beyond Good & Evil - Friedrich Nietzsche.epub` | Beyond Good & Evil. |
| `~/Calibre Library/Charles David George Stross/Accelerando (43)/Accelerando - Charles David George Stross.epub` | Accelerando (original epub; matches Primer's processed copy). |

Note: additional Nietzsche is filed under its translator at `~/Calibre Library/Walter Kaufmann/On the Genealogy of Morals and Ecce Homo (41)/`.

### Borges Library downloads — `~/.borges-library/downloads/`

| Path | Contents |
|---|---|
| `~/.borges-library/downloads/deleuze-guattari/` | **Durable Deleuze/Guattari shelf** — both requested complete English editions acquired and byte-validated. |

Validated on-shelf (2026-07-15):
- `_Gilles_Deleuze,_Felix_Guattari_-_A_Thousand_Plateaus_Capitalism_and_Schizophrenia_(1987,_University_of_Minnesota_Press)_-_libgen.li.pdf` — Brian Massumi translation, complete 629-page PDF, 3,390,982 bytes.
- `_Gilles_Deleuze,_Felix_Guattari_-_Anti-Oedipus_Capitalism_and_Schizophrenia_(0)_-_libgen.li.epub` — Robert Hurley / Mark Seem / Helen R. Lane translation, complete English EPUB, 542,864 bytes.

---

## 4. Usage guidance

| Need | Best source(s) |
|---|---|
| **Verbatim quotation** | `power-posting-sources/meltdown.md` (complete, provenance-checked). Nietzsche originals (public domain). Verbatim tweet captures: `teortaxes-longposts.md`, `apralky-posts.md`, `theoryposters-sample.md`, `pleometric-longposts.md` — each carries URL + date. |
| **Chunk-level analysis** | Primer reader IRs + annotations: Meltdown (`site/meltdown-reader-ir.json`, `site/meltdown-source-blocks.json`, `site/meltdown-annotations.*`); Nietzsche & Accelerando `artifacts/books/<slug>/reader-ir.json` + `.sqlite` + `annotation-range-*.jsonl` (block-addressable). |
| **Narration scripts** | `data/inspiration/pleometric/transcripts.json` (spoken cadence) + `vibe-brief.md` (creative direction) + `ontology.md` (register). Incantatory feedstock: `meltdown.md`, Nietzsche (Zarathustra/Gay Science §125/Twilight cadence per `influences.md`), `accelerando-chapters-plain.md`. |
| **Visual concept mining** | `docs/research/pleometric-reference-catalog.md` (references/techniques/style tags per video) + `data/inspiration/pleometric/*.mp4` + `manifest.json`; `docs/research/twitter-x/assets/`. |

### Copyright / public-domain caution

- **Nietzsche** — original German texts are **public domain**, so his register/ideas are first-class narration feedstock. **But the Kaufmann/Hollingdale English translations held here (Calibre epubs and Primer processed books) are copyrighted** — quote those translations sparingly (short excerpts / analysis only), or paraphrase / use a public-domain translation for long verbatim reads.
- **Borges, Deleuze & Guattari, Stross** — **copyrighted**. Short quotations and analysis only; do not reproduce chapters or large spans. Use for register, structure, and concept mining.
- **Tweets / CCRU Meltdown** — third-party / author-copyrighted content published on the open web. Attribute (URL + date, already recorded) and keep to fair-use snippets.
- **PRIMER artifacts** are derived from the above originals — the same copyright constraints flow through; consume as read-only inputs.

---

## 5. Missing / next acquisitions

The requested Deleuze/Guattari pair is complete. No other missing title is currently confirmed; add entries here only when a concrete gap is identified.
