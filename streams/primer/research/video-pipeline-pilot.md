# Video → aligned reader pilot

Date: 2026-07-16

## Target and history grounding

Arthur corrected the pilot target during execution to the Chinese cartoon **大耳朵图图**, specifically season 2 episode 15, **第十五集【伟大的妈妈】**. I queried the supplied SQLite at `~/state/browser-context/browser_context.sqlite` (both `tabs` and `tab_entries`; schema has no `history` table). Exact counts were zero for `bilibili.com`, `peppa`, `小猪佩奇/佩奇`, `大耳朵图图`, and `电视剧` in URL/title fields. No browser-history candidate therefore grounded the choice; the requested exact Bilibili search target was used instead.

## Source and asset

- Source: https://www.bilibili.com/video/BV17Qjg6KEmZ/
- Title from yt-dlp metadata: `第十五集【伟大的妈妈】大耳朵图图第二季超清修复`
- Direct-page uploader from yt-dlp metadata: `香萍哔哩` (`697215493`). (Search indexing displayed `赤石动漫`; the downloaded page metadata is the provenance used here.)
- Download method: one yt-dlp Bilibili episode request, cookie-backed public-page access, max 720p format (`30066` HEVC 1268×720 + `30280` audio). The first audio representation decoded corruptly after 7:55, so the same episode's alternate public audio representation (`30232`) was fetched once and used for the 16 kHz alignment WAV; the final asset retains only the MP4.
- Runtime/dimensions: 825.333 seconds, 1268×720, 45,127,035 bytes.
- Asset: `data/primer/reader-media-inbox/tutu-s2e15-great-mom/`
- Final files: `episode.mp4`, `alignment.json`, `episode.ai-zh.srt`, `episode.info.json`. Temporary WAV and alternate M4A were removed so the importer sees exactly one media file.

An earlier Peppa fallback probe/download remains separately at `data/primer/reader-media-inbox/peppa-s1e01-muddy-puddles/`; it is not the deliverable target.

## Transcript

Bilibili exposed `ai-zh` SRT subtitles; no local ASR was needed for the Tutu deliverable. The SRT was cleaned into 275 timed simplified-Chinese sentence cues (whitespace/ASCII artifacts removed, `佩琪` normalized to `佩奇`, punctuation added where absent). Cues through 620 seconds were retained; the later long non-dialogue/outro subtitle artifacts were excluded. The original SRT is retained in the asset for auditability. `alignment.media.asr` is honestly recorded as `bilibili-ai-zh-subtitles`.

## Alignment contract and quality

`scripts/align-media.py` drives `Qwen/Qwen3-ForcedAligner-0.6B` from the hsk-deck uv environment, slicing each subtitle span with 120 ms context, aligning in batches of eight, and offsetting token times back to absolute media milliseconds. It excludes punctuation from forced alignment while preserving punctuation in `sentence.text`/sentence timing. It compares the ordered Hanzi emitted by Qwen against the expected Hanzi; mismatches log to stderr and use per-sentence interpolation with `charTiming: "interpolated"` rather than silently drifting. Pinyin is generated with tone marks via pypinyin.

Validation observed:

- 275 sentences; 2,200 expected Han characters; 2,200 emitted character entries (100% coverage).
- Every emitted Han-character sequence exactly matches its sentence text.
- Sentence and character start times are monotonic; all character intervals are positive and within sentence bounds.
- `alignment.json` has `version: 1`, `media.file: "episode.mp4"`, duration `825333`, `lang: "zh"`, `asr`, `kind: "video"`, and the required sentence/character fields.
- Qwen emitted identity-safe spans for the remaining cues; 74 cues had context-padding spans outside their rough subtitle bounds and were explicitly marked `charTiming: "interpolated"` rather than clipped. No character-identity mismatches occurred.

### Three spot checks

I extracted the corresponding absolute spans from the clean alternate audio stream and ran faster-whisper-small as an independent listen/transcription check:

1. Sentence 0, `840–3440 ms`, `伟大的妈妈。`; independent ASR: `伟大的妈妈`.
2. Sentence 60, `138540–141160 ms`, `老公你说该怎么办呢？`; independent ASR: `老公 你说该怎么办呢`.
3. Sentence 250, `562080–563480 ms`, `为你和图图争光。`; independent ASR: `为你和图图争光`.

All three independent snippets recover the expected sentence content within the aligned span. Qwen character spans for these checks were respectively `1040–2400 ms`, `138820–140820 ms`, and `562200–563240 ms`.

## Runtime and GPU handoff

Observed wall times on the local M4 Max:

- Initial yt-dlp video + ai-zh subtitle + metadata download: 161.40 s.
- Alternate audio representation download: 5.54 s.
- WAV extraction from alternate audio: 0.84 s.
- Final Qwen model load plus 275-cue alignment: 88.06 s (the first unbounded run was 78.35 s; the final contract-safe rerun was 88.06 s).
- Structural validation and cleanup: 0.13 s.

The GPU box should take over batch work once this path scales beyond a pilot: long-form/batch ASR (especially subtitles unavailable), Qwen forced alignment over many episodes, and re-alignment retries for low-confidence or identity-mismatch cues. The dominant pilot wall time was network acquisition; among local compute stages, Qwen model load/alignment was the largest repeatable cost.

## Import

The importer landed and succeeded:

```text
docId=42 slug=大耳朵图图-s2e15-伟大的妈妈-b4703d7719
```

Exact command run:

```bash
bun packages/primer-daemon/src/cli.ts media import data/primer/reader-media-inbox/tutu-s2e15-great-mom --title '大耳朵图图 S2E15 伟大的妈妈' --kind video
```

The asset directory is complete and imported into the Primer reader.
## Overnight batch

Date: 2026-07-16

### 《庆余年》S1E1

- Source: official/public YouTube playlist `https://www.youtube.com/playlist?list=PLMQ0lvZ3plNORNw9xWKYN5cS64VbqoipH`, episode URL `https://www.youtube.com/watch?v=_Lg6BJ1gBDo`.
- Provenance: uploader `优优独播剧场 YoYo Television Series Exclusive` (`UCteBLoijWzlVFSR5BBtS_2Q`); fetched 2026-07-16.
- `yt-dlp --list-subs` found no native Chinese track. The only `zh-*` entries were translated tracks such as `zh-Hans-en` (Chinese from English), not source Chinese captions.
- Downloaded sequentially at 720p maximum (`398+251`, merged to `episode.mp4`); runtime 2,685,774 ms. Work dir: `data/primer/reader-media-inbox/qy-s1e01/`.
- FireRedASR2S was infeasible: checkpoint is 4,731,558,506 bytes (4.41 GiB) with only 2.9 GiB free, and the published CUDA torch pins have no arm64 wheels. Fallback used the cached `faster-whisper-large-v3` Mandarin transcription; `alignment.media.asr` is honestly `faster-whisper-large-v3`.
- Imported with `bun packages/primer-daemon/src/cli.ts media import data/primer/reader-media-inbox/qy-s1e01 --title '庆余年 S1E1 · 第一集' --kind video`; docId `53`, slug `庆余年-s1e1-第一集-a96a0755fd`.
- API verification (`GET /api/reader/docs/53/media`): `file=episode.mp4`, `kind=video`, `durationMs=2685774`, `asr=faster-whisper-large-v3`, `sentenceCount=525`. Every generated sentence has explicit `charTiming: "interpolated"`.

Spot checks against independent `faster-whisper-small` audio snippets:

1. Sentence 0, `7020–12520 ms`, `你可曾听说过雪山悬崖`; snippet transcription: `你可曾聽說過雪山炫耀` (traditional/character error, sentence content recovered).
2. Sentence 260, `1332920–1335060 ms`, `你父亲在京都啊`; snippet transcription includes `你父亲在京东啊`.
3. Sentence 520, `2506880–2508280 ms`, `命会长些`; snippet transcription includes `命会长些`.

### 习近平·2025新年贺词

- Source: official CCTV YouTube channel, `https://www.youtube.com/watch?v=iOm7nPRx-io`; uploader `CCTV中国中央电视台`; fetched 2026-07-16. The 720p DASH request returned HTTP 403, so the public progressive 360p format 18 was used (within the ≤720p rule); runtime 657,636 ms.
- Work dir: `data/primer/reader-media-inbox/xi-2025-new-year/`. Known transcript is `streams/primer/feedstock/zh-corpus/xi-2025-new-year.md`; its text matches doc 19 exactly. Sentence-split into 45 cues and aligned to extracted 16 kHz mono audio with Qwen forced alignment; `alignment.media.asr` is honestly `known-transcript-qwen-forced-alignment`.
- `media attach 19 ...` was attempted and returned the exact contract error `alignment sentences do not exactly match reading document paragraphs` because doc 19 has 14 paragraph rows while the required sentence split has 45 cues. Fresh sentence-granular import succeeded with `bun packages/primer-daemon/src/cli.ts media import data/primer/reader-media-inbox/xi-2025-new-year --title '习近平·2025新年贺词 · 官方视频' --kind video`; docId `54`, slug `习近平-2025新年贺词-官方视频-cf2097175e`.
- API verification (`GET /api/reader/docs/54/media`): `file=episode.mp4`, `kind=video`, `durationMs=657636`, `asr=known-transcript-qwen-forced-alignment`, `sentenceCount=45`. All 45 sentences have explicit `charTiming` (`native` or `interpolated`).

Spot checks against independent `faster-whisper-small` audio snippets:

1. Sentence 0, `48240–49020 ms`, `大家好。`; snippet recovered `大家好` and continued into the next known sentence.
2. Sentence 22, `377390–387510 ms`, `我们隆重庆祝新中国成立75周年，深情回望共和国的沧桑巨变。`; snippet recovered both clauses (`我们隆重...七十五周年` and `深情回望...共和国的...`).
3. Sentence 44, `638310–645310 ms`, `祝大家所愿皆所成，多喜乐、长安宁。`; snippet recovered `祝大家所愿皆所成 / 多喜乐 / 长安宁`.
- Uploader check: `yt-dlp --playlist-end 1000 --match-filter 'title~="图图"'` against source uploader `697215493` found only the existing S2E15 (one public Tutu entry); nearest public consecutive S2E13/E14/E16 uploads were therefore taken from series uploader 赤石动漫 (`531115965`), with the mismatch preserved in each asset's provenance.
- 大耳朵图图 S2E13 · 小怪的超能力 — source https://www.bilibili.com/video/BV1uqktY6EPb/; uploader 赤石动漫 (531115965); fetched 2026-07-16; work dir `data/primer/reader-media-inbox/tutu-s2e13-supercat/`; download 345.93s, alignment 71.08s; 224 sentences / 1,821 Han chars / 100% coverage, identity and bounded-monotonic timing checks pass, explicit `charTiming` native/interpolated; imported docId 55; `GET /api/reader/docs/55/media` verified `episode.mp4`, 810864ms, 224 sentences.
- 大耳朵图图 S2E14 · 神奇的隐身衣 — source https://www.bilibili.com/video/BV1xEkiYRELw/; uploader 赤石动漫 (531115965); fetched 2026-07-16; work dir `data/primer/reader-media-inbox/tutu-s2e14-invisible-coat/`; download 364.09s plus clean alternate audio 39.97s after a 60s pause, final alignment 114.34s; 209 sentences / 1,720 Han chars / 100% coverage, identity and bounded-monotonic timing checks pass, explicit `charTiming` native/interpolated; imported docId 56; `GET /api/reader/docs/56/media` verified `episode.mp4`, 806058ms, 209 sentences.
- 大耳朵图图 S2E16 · 图图家的非常时期 — source https://www.bilibili.com/video/BV1FGC3Y2Eor/; uploader 赤石动漫 (531115965); fetched 2026-07-16; work dir `data/primer/reader-media-inbox/tutu-s2e16-family-crisis/`; download 286.79s plus clean alternate audio 47.02s after a 60s pause, alignment 65.26s; 195 sentences / 1,483 Han chars / 100% coverage, identity and bounded-monotonic timing checks pass, explicit `charTiming` native/interpolated; imported docId 57; `GET /api/reader/docs/57/media` verified `episode.mp4`, 811192ms, 195 sentences.
