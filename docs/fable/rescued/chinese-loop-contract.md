> Rescued 2026-07-13 from /Users/arthur/.omp/agent/sessions/-agents/2026-07-06T07-53-32-097Z_019f366b-08c1-7000-b479-8aaa760c2c42/local/chinese-loop-contract.md

# Chinese reading-loop skeleton — shared contract (primer stream)

The spine: read → friction → mark → enrich → queue → review. This contract binds the backend worker and the frontend designer. Deviations require IRC coordination with Main.

## Stores

### Daemon ledger (data/primer/daemon-ledger.sqlite) — new tables
Owned by NEW file `packages/primer-daemon/src/reading-store.ts` (its own `ensureReadingTables(db)`, called lazily; do NOT touch `openLedger` in ledger.ts).

```sql
CREATE TABLE IF NOT EXISTS reading_docs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  title TEXT NOT NULL,
  lang TEXT NOT NULL DEFAULT 'zh',
  source TEXT,
  created_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS reading_paragraphs (
  doc_id INTEGER NOT NULL REFERENCES reading_docs(id),
  idx INTEGER NOT NULL,
  text TEXT NOT NULL,
  PRIMARY KEY (doc_id, idx)
);
CREATE TABLE IF NOT EXISTS reading_marks (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  doc_id INTEGER NOT NULL REFERENCES reading_docs(id),
  paragraph_idx INTEGER NOT NULL,
  start INTEGER NOT NULL,          -- UTF-16 code-unit offset within paragraph text (JS string semantics)
  end INTEGER NOT NULL,
  surface TEXT NOT NULL,           -- the marked word/span
  sentence TEXT NOT NULL,          -- containing sentence, extracted client-side
  kind TEXT NOT NULL DEFAULT 'lookup',   -- 'lookup' | 'manual'
  created_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS queue_items (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  mark_id INTEGER REFERENCES reading_marks(id),   -- first-provenance mark
  word TEXT NOT NULL UNIQUE,
  pinyin TEXT,
  gloss TEXT,                      -- definitions joined at capture time
  status TEXT NOT NULL DEFAULT 'new',   -- 'new' | 'keep' | 'discarded' | 'known'
  lookup_count INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
```

Dedupe rule: a mark for an already-queued word increments `lookup_count` + updates `updated_at` (status untouched); the mark row is still inserted (all friction is recorded). Deleting a mark (undo): remove the mark; if it was the queue item's only mark, remove the queue item, else decrement `lookup_count`.

### Dictionary DB (data/primer/cedict.sqlite) — built, gitignored
Built by `packages/primer-daemon/scripts/build-cedict.ts` (idempotent, `bun run cedict:build` in package.json):
- Primary source: `streams/primer/decks/hsk-deck/artifacts/yomitan/CC-CEDICT.zip` (Yomitan term-bank JSON format). Fallback if unusable: download CC-CEDICT from mdbg (`cedict_1_0_ts_utf-8_mdbg.zip`), parse the .u8 line format. Record which source was used.
- Table `cedict(simplified TEXT, traditional TEXT, pinyin TEXT, definitions TEXT /* JSON string[] */)` with indexes on simplified and traditional.
- Table `known_words(word TEXT PRIMARY KEY, hsk_level INTEGER)` loaded from `streams/primer/decks/hsk-deck/data/cleaned/{1,2,3,4,5}_cleaned.json` (HSK1–5 = Arthur's known set; inspect the JSON shape, take simplified forms; include `fill_cleaned.json` only if it is clearly HSK≤5 vocabulary).

## HTTP API (mounted in dashboard.ts `handleRequest`, implemented in NEW `packages/primer-daemon/src/reader-api.ts`)

All request bodies decoded with Effect Schema (repo rule). Errors: `{error}` JSON + status, matching existing `jsonError`.

- `POST /api/reader/docs` `{title, text, lang?}` → splits text into paragraphs on blank lines / newlines, trims empties → `{id, paragraphCount}`
- `GET /api/reader/docs` → `[{id, title, lang, createdAt, paragraphCount, markCount}]`
- `GET /api/reader/docs/:id` → `{id, title, lang, createdAt, paragraphs: string[], marks: Mark[]}` where Mark = `{id, paragraphIdx, start, end, surface, kind}`
- `POST /api/reader/marks` `{docId, paragraphIdx, start, end, surface, sentence, kind?}` → inserts mark, upserts queue item enriched server-side from cedict (pinyin, gloss) → `{markId, queueItem}`
- `DELETE /api/reader/marks/:id` → undo semantics above → `{ok: true}`
- `GET /api/dict/:word` → `{word, entries: [{simplified, traditional, pinyin, definitions: string[]}]}` (exact match on simplified OR traditional; empty entries array when unknown; 503 `{error: "cedict not built — run bun run cedict:build"}` when DB missing)
- `GET /api/dict/best?text=<run>` → same shape; longest-prefix match of `text` against the dictionary (for when client segmentation over-merges)
- `GET /api/reader/known-words` → `{words: string[]}` (~5k entries; client caches)
- `GET /api/queue?status=new|keep|discarded|known|all&limit=N` (default status=new, limit=100) → `[{id, word, pinyin, gloss, status, lookupCount, createdAt, provenance: {docId, docTitle, paragraphIdx, start, end, sentence} | null}]`
- `POST /api/queue/:id/status` `{status: 'new'|'keep'|'discarded'|'known'}` → updated row

## UI contract (dashboard web app, hash routing)

- `#/` — existing dashboard, unchanged.
- `#/read` — doc list (j/k nav, / filter, Enter open) + paste form (title + textarea → POST docs).
- `#/read/:docId` — the reader. Client-side `Intl.Segmenter('zh', {granularity:'word'})` segments each paragraph. Han-script segments not in known-words and not already queued get a subtle tint/underline. Click ANY word → popup: pinyin + definitions (GET /api/dict/:word, fallback /api/dict/best), and the lookup AUTO-RECORDS a mark (kind 'lookup', sentence extracted client-side by splitting on 。！？；?!;) with a visible "queued" chip + one-click/keystroke undo. Esc closes popup. Marks from the server render as persistent subtle highlights. Support `?mark=<markId>` — scroll to and flash that mark (review provenance links).
- `#/review` — queue browser: rows show word, pinyin, gloss, sentence (word highlighted), doc title. Vim keys: j/k move, Enter/o open provenance (`#/read/:docId?mark=N`), x discard, m mark known, K keep (final bindings = designer's call, documented in the existing ? KeymapOverlay).
- Reading surface typography: Chinese text ≥1.35rem, relaxed leading; sans/serif choice is the designer's taste. Existing shadcn/theme conventions.

## Non-goals (v1 skeleton)
No scheduler (hashcards/FSRS is phase 2). No radical decomposition view. No agent-enrichment cells. No mobile/Tailscale work. No polish pass on the meltdown reader. No edits to the existing #/ dashboard panels beyond adding navigation.

## QA rules
NEVER touch the live instance at primer.localhost:1355 (Arthur's pane). Boot your own: `PRIMER_DASHBOARD_PORT=<free port>` or `bunx portless primer-qa-<yourname> ...` (check src/dashboard.ts for the env/option shape it actually honors). Real data only — no mocks; use temp sqlite + tiny real fixtures in tests.
