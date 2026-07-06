# Primer — Chinese reading loop skeleton (2026-07-06)

The spine's first full pass: **paste a chapter → click any word → popup dictionary → mark auto-queues with sentence provenance → review near the source.** VISION.md §Sequencing 1, delivered.

## What shipped

- **Reading store** (`packages/primer-daemon/src/reading-store.ts`): `reading_docs` / `reading_paragraphs` / `reading_marks` / `queue_items` in the daemon ledger (`data/primer/daemon-ledger.sqlite`). Every lookup is recorded; queue items dedupe by word (`lookup_count` tracks friction frequency); undo removes the queue item only when its last mark goes.
- **CC-CEDICT service** (`src/dict.ts`, `scripts/build-cedict.ts`): parses the vendored Yomitan CC-CEDICT zip from the HSK deck → `data/primer/cedict.sqlite`. **202,906 entries; 4,240 known words** (HSK1–5 cleaned lists = Arthur's known set). Exact + longest-prefix lookup.
- **Reader API** (`src/reader-api.ts`, mounted in `dashboard.ts`): docs CRUD, marks with server-side pinyin/gloss enrichment, dict lookup, known-words, queue list/status. Effect Schema on every boundary.
- **4th substrate**: `learning-card-system.sqlite` (Skycak concept graph / tacit moves / card candidates) wired into ask evidence as `cards:*` provenance ids; `/api/status` now reports 4 substrates.
- **Reading surface** (`web/src`): `#/read` library + paste, `#/read/:id` reader (Intl.Segmenter zh word segmentation, unknown-word tinting against the known set, click-word popup with tone-colored pinyin, auto-queue chip + `u` undo, `?mark=` scroll+flash), `#/review` queue with sentence context and provenance jump. Vim keys throughout, documented in the `?` overlay.

## Evidence

Integrated smoke on a private instance (`PORT=4979`, fresh ledger), Daodejing ch. 1 pasted:

- `POST /api/reader/docs` → `{id:1, paragraphCount:2}`
- Mark 天地 → queue item enriched: `tiāndì / "heaven and earth; world; scope; field of activity"`, provenance sentence `无名天地之始；有名万物之母。`
- Repeat mark → same item, `lookupCount: 2` (dedupe)
- `GET /api/dict/徼` → both pronunciations (jiào "boundary; to go around" / jiǎo "by mere luck")
- `GET /api/reader/known-words` → 4,240
- `POST /api/queue/1/status {keep}` → transition persisted
- `/api/status` → browser/twitter/reader/cards all `exists: true`

Screenshots (live browser, integrated): [reader](primer-chinese-loop/qa-reader.png) · [popup + auto-queue](primer-chinese-loop/qa-after-click.png) · [review queue](primer-chinese-loop/qa-review.png)

Defect found in gate and fixed: header nav highlight used a prefix match (`#/read` matched `#/review`) and a mount-time snapshot; now segment-exact and prop-driven from the route hook.

## Rerun

```bash
cd packages/primer-daemon
bun run cedict:build        # 202906 entries / 4240 known words
bun run check               # typecheck + web:build + 106 tests, 0 fail
PORT=4979 PRIMER_LEDGER_DB=/tmp/primer-smoke/ledger.sqlite bun src/dashboard.ts
# open http://127.0.0.1:4979/#/read — paste any Chinese text, click words
```

Live instance: http://primer.localhost:1355 (web dist rebuilt; hard-reload to pick up the new bundle).

## Not in v1 (deliberate)

Scheduler (hashcards/FSRS — phase 2, load-bearing per Skycak notes in VISION), radical decomposition view, review-mode dictionary friction, mini-diagnostic to true up the known-word set.
