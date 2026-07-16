# Primer media reader QA

Environment: isolated `primer-qa5` daemon, copied ledger DB at `/tmp/primer-media-ledger-NF7W8U`.

## Results

1. **Doc 42 media reader — PASS with defect.** Opened `#/read`, loaded 大耳朵图图 S2E15 伟大的妈妈. DOM contained 275 transcript paragraphs, pinyin ruby, and a sticky `<video>` served by `/api/reader/docs/42/media/file` (duration 825.333s). Screenshot: `01-doc42-loaded.png`.
2. **Character seek/focus — PASS seek/play; FAIL native amber indicator.**
   - Alignment GET `/api/reader/docs/42/media/alignment`: 275 sentences; 74 explicit `charTiming:"interpolated"`; 201 omit `charTiming` and there are zero explicit `"native"` values.
   - Native-intended sample idx 103 (`大名远扬的那个武林第一美人儿`), char 103:3: click sought to 230.780s (alignment startMs 230780), playing, sentence 103 focused, but no amber character class. Screenshot: `02-native-click-no-amber.png`.
   - Interpolated sample idx 101 (`身怀绝技。`), char 101:1: click sought to 228.619s vs 228550ms (69ms delta), playing, sentence 101 focused, no amber character class as expected. Screenshot: `13-interpolated-focus.png`.
3. **Keyboard media controls — PASS.** Space changed playing → paused → playing. P changed 2,200 `<rt>` nodes to zero and back to 2,200. `]` changed playbackRate 1 → 1.25; `[` restored 1.0. Verified through media-element evaluation.
4. **ZhDictCard/queue — PASS.** Ctrl-clicking cached 学习 opened Chinese gloss, synonyms, four graded examples with highlighted 学习, 字形拆解, collapsed `··· en`, and queued footer. Expanding `summary` exposed English definitions (`to learn`, `to study`); pressing `p` changed footer to `priority ↑1 p` and `/api/events` recorded `priority_push` id 71. Screenshot: `14-media-zhdict.png`.
5. **Uncached generation — PASS.** Ctrl-clicking uncached 武林 showed `生成释义`; one generation was triggered, showed disabled `生成中…`, then returned Chinese gloss `练习功夫和武术的人们组成的世界。` plus synonyms/register note. No further generation calls were made.
6. **No-media doc 9 — PASS.** Opened `#/read/9` (论语 · 学而第一), rendered normal 16-paragraph reader with no video/audio. Ctrl-clicking 学 opened ZhDictCard with examples, 字形拆解, and collapsed English disclosure. Screenshots: `11-no-media-popup.png`, `12-no-media-zhdict.png`.
7. **Errors/logs/telemetry/teardown — PASS.** In-page error/unhandled-rejection hooks were installed and had no captured entries. Daemon stdout showed successful listen on port 4073; stderr contained only Bun dependency-resolution startup output, no runtime errors. GET `/api/events` returned media rows from this session: `media_seek` ids 65 (230780ms) and 67 (228550ms), `media_play` ids 66 and 69, plus `media_pause` ids 68/72 and `priority_push` id 71. Processes were terminated; final GET to the alias failed with HTTP 502 (non-200).

## Defects

### D1 — Native `charTiming` is not represented consistently (blocks amber active-character pill)

**Repro:**
1. GET `/api/reader/docs/42/media/alignment`.
2. Count sentence `charTiming`: 74 `interpolated`, 201 missing, 0 explicit `native`.
3. Open doc 42 and click `ruby[data-media-char="103:3"]`.
4. Observe seek/play and focused sentence, but no `bg-amber-300` active-character class.

**Expected:** Native-timed sentence has `charTiming:"native"` and the active character gets the amber pill. `Reader.tsx` gates the amber class on exact `sentence.charTiming === "native"`, so omitted native metadata never qualifies.

**Evidence:** `02-native-click-no-amber.png`; alignment API counts above.

## Verdict

**FAIL — media reader, dictionary, controls, telemetry, no-media fallback, and teardown pass, but native timing metadata/amber active-character behavior is defective.**
