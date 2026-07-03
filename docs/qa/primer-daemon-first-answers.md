# Primer dæmon — first answers (proof)

First-goal acceptance for `streams/primer/GOAL.md`: three real questions answered from the substrate with provenance, one write-back, rerun commands. All runs 2026-07-03 against live local substrates.

## Setup

- Query path: `packages/primer-daemon` (`bun run cli <cmd>` inside the package, or `bun packages/primer-daemon/src/cli.ts <cmd>` from repo root).
- Substrates (read-only): `~/state/browser-context/browser_context.sqlite` (synced to 2026-07-03 10:23 before the runs; firefox lane — chrome importer unimplemented upstream), `data/twitter-archive/twitter-archive.sqlite` (994 tweets), `streams/primer/wrapped-commentary-reader/site/meltdown-annotations.sqlite` (54 annotations, 8 concepts).
- Write-back (only writable surface): `data/primer/daemon-ledger.sqlite` (gitignored, local-first).
- Gate at time of proof: `bun run check` inside `packages/primer-daemon` clean (typecheck + 19 tests) across 7 files.

## Q1 — "What have I been reading about Nick Land and Meltdown?"

Rerun: `bun packages/primer-daemon/src/cli.ts ask "what have I been reading about Nick Land and Meltdown?" --limit 12`

Answer (synthesized from the evidence pack): an active Meltdown reading thread across three substrates — the ccru.net source text (`browser:events:107830`), dmvaldman's AI-annotated Meltdown (`browser:events:108665`), the AllPoetry mirror (`browser:events:33284`), *A Nick Land Reader* and *Fanged Noumena* PDFs (`browser:events:107831`, `browser:events:93450`), the local wrapped-commentary Meltdown Reader itself (`browser:events:44295`, `127.0.0.1:5173`), and reader-substrate annotations from the annotation pipeline: "Education System Meltdown" (`reader:annotations:35`) and "Meltdown References" (`reader:annotations:36`).

Known noise floor: single-term OR retrieval admits e.g. AliExpress "landing" URLs; coverage-weighted ranking keeps real hits on top.

## Q2 — "What have I been reading about HSK and Chinese learning?"

Rerun: `bun packages/primer-daemon/src/cli.ts ask "what have I been reading about HSK and Chinese learning?" --limit 10`

Answer: the Mac browser substrate shows the *learning* frontier concentrated on Math Academy / Justin Skycak (`browser:events:203934` content-graph artifact, `browser:events:204495` podcast, `browser:events:118880` algorithms PDF) and "Chinese" mostly as Chinese-LLM discourse on X (Teortaxes, yifei, Sichu Lu — `browser:events:185818-19`, `196644`). Almost no HSK-titled pages: **substrate gap confirmed** — phone-based Chinese study never reaches Mac browser history (already flagged in `docs/plans/primer-intuitions.md` §3), and `learning-card-system.sqlite` (which has `hsk_unknown_word_budget`) is not yet a wired substrate. Honest answer, useful gap signal.

## Q3 — "What have I been reading about spaced repetition and flashcards?"

Rerun: `bun packages/primer-daemon/src/cli.ts ask "what have I been reading about spaced repetition and flashcards?" --limit 10`

Answer: a tight, high-signal thread — Matuschak's prompt-writing essay (`browser:events:241`, andymatuschak.org/prompts), eudoxia0/hashcards plain-text SRS (`browser:events:239`), and the fresh **Memory Machines** eval (memory-machines.com, `browser:events:145616`) with Matuschak's announcement (`browser:events:96394`) and Kirkby's result thread (`browser:events:206005`): frontier LLMs still write poor flashcards from reader highlights, and newer models regress. This is the exact problem the Primer's card-compiler lane exists to beat.

## Write-back

Rerun of the records: `bun packages/primer-daemon/src/cli.ts note list && bun packages/primer-daemon/src/cli.ts card list`

- `note #1` — Q3 answered, with 3 provenance sources (`browser:events:241`, `145616`, `206005`).
- `card #1` [candidate] — "What did the Memory Machines eval (Matuschak & Kirkby, 2026) find about frontier LLMs writing flashcards from readers' highlights?" → "They still write poor flashcards; quality is not improving with newer models (GPT 5.4 < 5.2, Opus 4.7 < 4.6 on their eval)." Source `browser:events:206005`.

Card candidates accrete in the ledger for later export to mochi-lite/anki (GOAL.md leaning: feed existing apps; substrate is the moat).

## Invariants exercised

- Substrate DBs opened strictly read-only; WAL-mode browser DB required an `immutable=1` fallback probe (`src/substrate/open.ts`) — plain readonly opens fail post-sync with SQLITE_CANTOPEN at first prepare.
- `ask` = deterministic OR-retrieval + coverage-weighted rank (no LLM in the loop); `search` keeps strict AND semantics.
- Missing substrate degrades to a skip notice, exit 0.

## Follow-ups surfaced

1. Wire `learning-card-system.sqlite` (HSK budget, concept graph) as a fourth substrate.
2. Chrome importer unimplemented in browser-context-sync — Mac Chrome history invisible.
3. Noise floor: consider domain blocklist or per-substrate term-coverage minimum for `ask`.
4. Ledger → mochi-lite export loop (accretion loop step 3 in HANDOFF).
