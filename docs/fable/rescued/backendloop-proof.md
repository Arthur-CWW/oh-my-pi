> Rescued 2026-07-13 from /Users/arthur/.omp/agent/sessions/-agents/2026-07-06T07-53-32-097Z_019f366b-08c1-7000-b479-8aaa760c2c42/local/backendloop-proof.md

# BackendLoop proof

## CEDICT build

Observed command:

```text
bun run cedict:build
```

Output:

```text
CEDICT source: /Users/arthur/agents/streams/primer/decks/hsk-deck/artifacts/yomitan/CC-CEDICT.zip
CEDICT entries: 202906
Known words: 4240
Output: file:cedict-build-fallback-1783328768806?mode=memory&cache=shared
```

Stderr:

```text
Unable to write /Users/arthur/agents/data/primer/cedict.sqlite; built in-memory fallback file:cedict-build-fallback-1783328768806?mode=memory&cache=shared
```

The build parsed the real vendored Yomitan CC-CEDICT zip and HSK cleaned JSONs. The fallback fired because Bun child processes in this harness cannot write repo data directories.

## Targeted verification

```text
bun test test/reading-store.test.ts test/reader-api.test.ts
```

Output:

```text
6 pass
0 fail
42 expect() calls
Ran 6 tests across 2 files.
```

```text
bun run typecheck
```

Output:

```text
tsc --noEmit
exit 0
```

## Request-level smoke transcript

Literal `Bun.serve` listening failed in the child-process sandbox (`EADDRINUSE` for port 0 and high ports), so this transcript used the same route handler with real `Request` objects, a fresh shared in-memory ledger, and a real sqlite CEDICT fixture. The command strings below show the equivalent curl calls; the responses are the observed handler responses.

```text
curl -s -X POST http://127.0.0.1:48231/api/reader/docs -H 'content-type: application/json' -d '{"title":"课堂","text":"学生喜欢3D打印机。"}'
```

```json
{"id":1,"paragraphCount":1}
```

```text
curl -s -X POST http://127.0.0.1:48231/api/reader/marks -H 'content-type: application/json' -d '{"docId":1,"paragraphIdx":0,"start":4,"end":9,"surface":"3D打印机","sentence":"学生喜欢3D打印机。"}'
```

```json
{"markId":1,"queueItem":{"id":1,"word":"3D打印机","pinyin":"sānddǎyìnjī","gloss":"3D printer","status":"new","lookupCount":1,"createdAt":"2026-07-06T09:02:51.120Z","updatedAt":"2026-07-06T09:02:51.120Z","provenance":{"docId":1,"docTitle":"课堂","paragraphIdx":0,"start":4,"end":9,"sentence":"学生喜欢3D打印机。"}}}
```

```text
curl -s -X GET 'http://127.0.0.1:48231/api/queue?status=new&limit=10'
```

```json
[{"id":1,"word":"3D打印机","pinyin":"sānddǎyìnjī","gloss":"3D printer","status":"new","lookupCount":1,"createdAt":"2026-07-06T09:02:51.120Z","updatedAt":"2026-07-06T09:02:51.120Z","provenance":{"docId":1,"docTitle":"课堂","paragraphIdx":0,"start":4,"end":9,"sentence":"学生喜欢3D打印机。"}}]
```

```text
curl -s -X POST http://127.0.0.1:48231/api/queue/1/status -H 'content-type: application/json' -d '{"status":"keep"}'
```

```json
{"id":1,"word":"3D打印机","pinyin":"sānddǎyìnjī","gloss":"3D printer","status":"keep","lookupCount":1,"createdAt":"2026-07-06T09:02:51.120Z","updatedAt":"2026-07-06T09:02:51.122Z","provenance":{"docId":1,"docTitle":"课堂","paragraphIdx":0,"start":4,"end":9,"sentence":"学生喜欢3D打印机。"}}
```
