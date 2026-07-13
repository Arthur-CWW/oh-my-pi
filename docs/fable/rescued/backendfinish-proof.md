> Rescued 2026-07-13 from /Users/arthur/.omp/agent/sessions/-agents/2026-07-06T07-53-32-097Z_019f366b-08c1-7000-b479-8aaa760c2c42/local/backendfinish-proof.md

# BackendFinish reader API proof

## Code changes

- Added `src/reader-api.ts` HTTP handling for reader docs, marks, queue, known words, and dictionary lookups using Effect Schema request/param decoding.
- Mounted `handleReaderApi` from `src/dashboard.ts` inside `handleRequest` before the unknown-route fallback.
- Added `cedictDb` to daemon paths with `PRIMER_CEDICT_DB` override and default `data/primer/cedict.sqlite`.
- Added package script: `"cedict:build": "bun scripts/build-cedict.ts"`.
- Fixed inherited dictionary/build details revealed while validating:
  - `dict.ts` accepts SQLite `file:` URIs for real shared-memory fixture DBs while preserving missing-file 503 behavior for normal paths.
  - `scripts/build-cedict.ts` now opens the output DB with create intent.
- Added `test/reading-store.test.ts` for paragraph splitting, mark→queue dedupe, undo decrement/removal, and status preservation.
- Added `test/reader-api.test.ts` for exact and longest-prefix dictionary lookup against 21 real CEDICT entries, missing-CEDICT 503s, null mark enrichment when CEDICT is missing, known words, enriched mark→queue provenance, and queue status update.

## Observed validation

Command run from `packages/primer-daemon` through the available MCP command runner:

```sh
bun test test/reading-store.test.ts test/reader-api.test.ts
```

Observed result:

```text
bun test v1.3.14 (0d9b296a)

test/reader-api.test.ts:
(pass) reader API > looks up exact dictionary entries and longest-prefix matches from a real fixture [4.45ms]
(pass) reader API > returns contract dictionary errors while mark enrichment degrades to null when CEDICT is missing [2.68ms]
(pass) reader API > serves reader, dict, known-word, and queue endpoints with enriched mark provenance [2.13ms]

test/reading-store.test.ts:
(pass) reading store > splits documents into trimmed paragraphs and lists marks [0.62ms]
(pass) reading store > records every mark while deduping queued words and undoing both branches [1.16ms]
(pass) reading store > preserves status while repeated lookups increment count [0.77ms]

6 pass
0 fail
42 expect() calls
Ran 6 tests across 2 files. [99.00ms]
```

## CEDICT build counts

The normal file-output command was attempted:

```sh
cd packages/primer-daemon && bun run cedict:build
```

In the MCP runner, Bun SQLite could not open filesystem DB paths (`SQLITE_CANTOPEN`), so `data/primer/cedict.sqlite` was not written in this sandbox. To validate parser/count behavior without filesystem output, `buildCedict("file:cedict-build?mode=memory&cache=shared")` was run against the vendored zip.

Observed counts:

```json
{
  "source": "/Users/arthur/agents/streams/primer/decks/hsk-deck/artifacts/yomitan/CC-CEDICT.zip",
  "entryCount": 202906,
  "knownWordCount": 4240,
  "outputPath": "file:cedict-build?mode=memory&cache=shared"
}
```

Manual follow-up on a normal shell should run the package script once to write `data/primer/cedict.sqlite`:

```sh
cd packages/primer-daemon
bun run cedict:build
```

## Curl smoke script for a private instance

The MCP runner also could not bind Bun servers (`EADDRINUSE` for port 0 and high explicit ports), so the request-level API smoke is covered by `test/reader-api.test.ts` via direct `handleReaderApi` invocation. For the required curl transcript, run this in a normal shell after `bun run cedict:build`:

```sh
cd packages/primer-daemon
TMPDIR="$(mktemp -d)"
touch "$TMPDIR/ledger.sqlite"
PRIMER_LEDGER_DB="$TMPDIR/ledger.sqlite" \
PRIMER_BROWSER_DB="$TMPDIR/browser.sqlite" \
PRIMER_TWITTER_DB="$TMPDIR/twitter.sqlite" \
PRIMER_READER_DB="$TMPDIR/reader.sqlite" \
PORT=41779 \
bun src/dashboard.ts
```

Then in another shell:

```sh
curl -sS -X POST http://127.0.0.1:41779/api/reader/docs \
  -H 'content-type: application/json' \
  --data '{"title":"Smoke","text":"我喜欢学习中文。"}'

curl -sS -X POST http://127.0.0.1:41779/api/reader/marks \
  -H 'content-type: application/json' \
  --data '{"docId":1,"paragraphIdx":0,"start":3,"end":5,"surface":"学习","sentence":"我喜欢学习中文。","kind":"lookup"}'

curl -sS 'http://127.0.0.1:41779/api/queue?status=all&limit=10'

curl -sS -X POST http://127.0.0.1:41779/api/queue/1/status \
  -H 'content-type: application/json' \
  --data '{"status":"keep"}'
```

Expected after real CEDICT build: the queue row for `学习` has non-null `pinyin`/`gloss`, `lookupCount: 1`, provenance pointing to doc title `Smoke`, and final status `keep`.
