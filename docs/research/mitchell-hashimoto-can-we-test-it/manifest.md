# Archive manifest: Can we test it? Yes, we can!

## Provenance

- **Talk:** “Can we test it? Yes, we can!” — Mitchell Hashimoto
- **Event shown in source:** Big GABASH 2025
- **Publisher/channel:** Antithesis (`UCz4hzKOYqRA9tBrvbw_fQjg`)
- **Canonical URL:** https://www.youtube.com/watch?v=MqC3tudPH6w
- **YouTube video ID:** `MqC3tudPH6w`
- **Upload date:** 2025-06-13
- **Retrieved:** 2026-07-27 (public source; no cookies or authentication)
- **Source duration:** 2614.474 seconds (43:34.474)
- **Local evidence root:** `/Users/arthur/agents/local/proofs/mitchell-hashimoto-can-we-test-it/`
- **Local source video:** `/Users/arthur/agents/local/proofs/mitchell-hashimoto-can-we-test-it/source.mp4` (not tracked)
- **Source video SHA-256:** `70e3f78605cf9c5ddbac70b25040a8d9e77d456e05188331dfde0e2852326010`
- **Source video size:** 369,457,435 bytes
- **Video stream:** AV1, 1920×1080, 24000/1001 fps, BT.709, square pixels
- **Audio stream:** Opus, 48 kHz, stereo
- **Downloader:** yt-dlp `2026.07.04`
- **Media tools:** ffmpeg/ffprobe `8.1.2`

## Captions and cleaned transcript

The YouTube metadata exposes `en` under `subtitles`, so `source.en.vtt` is the publisher-provided/manual English WebVTT track. The separately downloaded `source.en-orig.vtt` is an automatic-caption artifact and was retained only as local evidence; it was not used for the transcript.

- Manual WebVTT: `/Users/arthur/agents/local/proofs/mitchell-hashimoto-can-we-test-it/source.en.vtt`
- Manual WebVTT SHA-256: `ccdff54731e6527febaad9782d38ea0499945e0692ec9b4cd76123a9ae5bbc50`
- Automatic `en-orig` WebVTT SHA-256: `876df3a4647107864dbdb3ae2ff3649a34b1880544a285bcab0c279a4f659ed5`
- Cleaned transcript: `cleaned/transcript.md`

Normalization decodes HTML entities (including `&nbsp;`), removes VTT markup, collapses whitespace, removes immediately repeated words case-insensitively, and removes exact multiword suffix/prefix overlap between adjacent cues. It does not paraphrase the spoken captions. Cues are grouped into readable timestamped paragraphs and split at slide appearances so slide context remains aligned.

Each final slide was OCRed with macOS Vision `VNRecognizeTextRequest` using `recognitionLevel = .accurate`, `usesLanguageCorrection = true`, and `en-US`. OCR is inserted as a clearly marked slide-context block at the slide’s first stable appearance and is kept separate from spoken captions. OCR output was not silently reconstructed: lines below 0.70 confidence are marked per slide, and every block notes that images, diagrams, decorative marks, and unrecognized text are not reconstructed. Dense code, screenshots, and decorative/UI text remain the least reliable OCR cases.

## Crop geometry

Representative 1920×1080 source frames at 00:01:00, 00:20:00, and 00:42:00 were extracted to the proof root and visually inspected. The conference composite has a 3:2 slide viewport on the left and Mitchell’s camera panel on the right. The observed slide viewport is:

- **Crop:** `crop=1248:832:4:124`
- **Source rectangle:** x=4…1251, y=124…955
- **Output:** 1248×832 (3:2), lossless RGB PNG
- **Excluded:** top/bottom conference branding and the right-side speaker panel beginning immediately after the slide viewport

This keeps the complete native slide canvas, including its rounded edge pixels, without rescaling. The final contact sheet shows no remaining right-side camera panel.

## Slide-region detection, selection, and OCR alignment

A 1 fps analysis proxy was generated from the crop only, then downscaled to 240×160. Adjacent-frame grayscale mean absolute differences were computed on the slide region, avoiding false changes caused by Mitchell’s movement. Material transitions were identified at a mean difference greater than 2/255. Candidate stable segments were contact-sheeted and manually reviewed in chronological order.

Near-identical transition frames and repeated animation/build states were removed. For progressive builds, the final stable state was preferred. Live/demo output was retained only when it materially differed from the surrounding explanatory slide. The NixOS overview and “Step one” slide briefly toggle at 37:50–37:54; each distinct slide appears once, and its OCR block uses its first appearance rather than its later stable reappearance. Blank/loading/outro frames were excluded.

| Slide | First stable appearance | Extracted frame | Notes |
|---:|---:|---:|---|
| 001 | 00:14 | 00:48 | Opening statement, final stable build |
| 002 | 00:50 | 02:10 | “Yet” example clip |
| 003 | 02:12 | 03:48 | Background |
| 004 | 03:50 | 04:58 | 2017 talk reference |
| 005 | 05:00 | 05:28 | Taught expectation |
| 006 | 05:30 | 05:53 | Reality expansion |
| 007 | 05:55 | 06:39 | Reality is messy |
| 008 | 06:41 | 07:54 | Strategy/testability |
| 009 | 07:56 | 09:05 | Snapshot testing |
| 010 | 10:50 | 10:50 | Material final snapshot/demo output |
| 011 | 10:52 | 13:25 | Snapshot formats |
| 012 | 13:29 | 13:29 | Keep context close, final code state |
| 013 | 13:32 | 15:17 | Isolate side-effects |
| 014 | 15:19 | 19:00 | Before/after diagram |
| 015 | 19:02 | 21:06 | Key encoder code example |
| 016 | 21:08 | 21:35 | GPU divider |
| 017 | 21:37 | 25:27 | GPU pipeline |
| 018 | 25:29 | 28:46 | CPU-side testing |
| 019 | 28:48 | 29:53 | GPU-side general method |
| 020 | 29:55 | 34:32 | GPU-side practical method |
| 021 | 34:34 | 35:06 | VM testing divider |
| 022 | 35:08 | 35:49 | NixOS VM testing intro |
| 023 | 35:51 | 36:58 | Full-system reproducibility |
| 024 | 37:00 | 38:35 | NixOS testing overview; first appeared before brief toggle |
| 025 | 37:50 | 39:12 | Step one; first appeared briefly before stable reappearance |
| 026 | 39:14 | 39:59 | Step two |
| 027 | 40:01 | 40:50 | Step three |
| 028 | 40:52 | 42:33 | In practice |
| 029 | 42:35 | 43:03 | Resources |
| 030 | 43:05 | 43:28 | Thank you/review |

## PDF assembly

`slides/mitchell-hashimoto-can-we-test-it-slides.pdf` has 30 pages at 936×624 points. The assembler embeds each PNG’s original zlib-compressed IDAT stream directly as a PDF image XObject with PNG predictor 15. It does not decode, resize, or recompress the slide pixels.

## Review evidence

Local proof artifacts include:

- `representative/frame-0060.png`, `frame-1200.png`, `frame-2520.png` — crop-boundary inspection
- `contact-sheet-1.jpg` through `contact-sheet-3.jpg` — candidate review
- `timing-contact-sheet.jpg` and `timing-contact-sheet-later.jpg` — transition/first-appearance review
- `final-contact-sheet.jpg` — all 30 final outputs in order
- `slide-ocr.json` — Vision OCR text, confidence, and coordinates for all slides
- `normalize_vtt.py`, `merge_transcript_ocr.py`, `ocr_slides.swift`, `pngs_to_pdf.py` — exact local processing helpers

The final contact sheet and native first/middle/last outputs were visually reviewed for legibility, chronology, duplicate builds, blank/loading frames, and speaker-panel leakage. All 30 slides are 1248×832; no blank/loading frame or speaker panel remains. Required `inspect_image` calls were attempted on the contact sheet and slides 001, 015, and 030, but the harness returned `Configured vision model openai-codex/gpt-5.6-luna:med is unavailable` for every call; the proof images above preserve the review surface for rerun.

## Tracked output checksums (SHA-256)

The manifest omits its own checksum because a file cannot stably contain its own digest.

```text
6e416aa483bbbb91094ad6208291f2125ec545d2113851faedde633ce2312eda  cleaned/transcript.md
80ff3f69abed292954d295ac76291f400b6640c8cd0340962125c1212bb05243  slides/slide-001.png
eecc17235014271ab43105561e7e3b8dbb01c6237b646ed40408e1b53acd5886  slides/slide-002.png
7b5b976936f7b4d292ac85280988c99280483fee01ed134c0980f787d3949c93  slides/slide-003.png
d5fb58f3f07e51859691ae78c87919d24cb9d481c19db306f19f9e86c1db4cb9  slides/slide-004.png
724744541971c19a12c677454befb31239efa190fde31fc0d37547257bd3f6aa  slides/slide-005.png
5856e222c7a730270257d876f11e0233e490359b6205a05312b1a9a5fcdefcf0  slides/slide-006.png
a32666da6da863f13cf1713f12c19a39ecdec9fcf4d55ea4761569339d20b281  slides/slide-007.png
6c4914f341cefebcff7a6bed991be23cb671fef8da1229abea8a58a15da56d1d  slides/slide-008.png
1c5258536bfe1f03c6d516e935f16ff57efad453db1cf7e217c169986ab04d86  slides/slide-009.png
c9bfdd5e2465946b94c009982433163549a1a70c2bbbadc89776b60ec9001221  slides/slide-010.png
c2e585545ecca608b2c748eb48220fbb8be43e2b0e47dd3022478b3f804c6e21  slides/slide-011.png
7ab67ec8304fa5317f6b2d41a6dc4ea048714ed2653015e213d4f8740d21f03c  slides/slide-012.png
d0b94780b09f7a8825d955036d33ff1b9db865767dc214118b59f9d5695736e5  slides/slide-013.png
6527ddf8090601ca845223abffbbfaef608355887768a92650659c5e7cefc44d  slides/slide-014.png
489610e51bef8b90829ec9eff254a00f89e80d328e1430c37725c176db1e1917  slides/slide-015.png
0feb0c61482c370c2d736d13a7656b436eb9bcfb3b80cdc87900ea3921e53324  slides/slide-016.png
78dbe657173f49a31edebed1c3b1ba8d35eb5335277d2182e3f9c02b9489623d  slides/slide-017.png
3e5904bc0de54cb936ecd83716958eff09eed696b05ed72e0483fe1455d98c60  slides/slide-018.png
b853c2c9b7a9c1855c3cdf57a966de3ec11f9e12919c2f025f2c7969e6fcf40f  slides/slide-019.png
775918ca181de9c6c20053cda9a53f16f79bdfac82c0a5e0530e2101cc4c251f  slides/slide-020.png
de16700c75fc2605a526a4244436595f50414adfa8b1ff29d9d29b54f90e9167  slides/slide-021.png
d7761060da91009d881b14e817030e26dea53c2f4b44df521dafbbc8dfae3ec8  slides/slide-022.png
9a485d27e35cc44972072e97fe177c6d8d74b712770d6137b3356134a4eaa0a3  slides/slide-023.png
69f846677ad8c97645109ef9fc1c08ea150876e5da78b9121c89740621f5cc2e  slides/slide-024.png
025689b4565504f1a1ca78d233be4a6ad09fd743a447de41b47540523da38e19  slides/slide-025.png
90accbc548d3a27631f9eb086820d688205555939b6a407552971aef5b61d498  slides/slide-026.png
ada855b5db9ee872e303346ab9d2008fec1db64aa72d447059b72669bf1c125c  slides/slide-027.png
25f068d309902c12d4e317cb3da4fce02511c4dc2d6accb4033c7f2bbbb01cda  slides/slide-028.png
701ca33b7eafcbf53129ad6140388c806ec9f59cc543aa44deddb26957c7e7fd  slides/slide-029.png
d59112bfd6fec60a06d36ed61711f7430aedde2be8fdba950f0da0d4565caff4  slides/slide-030.png
321ebed3ec582bf6a15818b5a51f775dfc5b0f3f0b2b3f923201f257919334c1  slides/mitchell-hashimoto-can-we-test-it-slides.pdf
```

## Exact rerun commands

Run from the repository root. These commands intentionally keep raw media and processing evidence outside tracked docs.

```bash
mkdir -p /Users/arthur/agents/local/proofs/mitchell-hashimoto-can-we-test-it

yt-dlp --no-playlist --write-info-json --write-description --write-thumbnail --write-subs --write-auto-subs --sub-langs 'en,en-orig' --sub-format vtt -f 'bv*[height<=1080]+ba/b[height<=1080]' --merge-output-format mp4 -o '/Users/arthur/agents/local/proofs/mitchell-hashimoto-can-we-test-it/source.%(ext)s' 'https://www.youtube.com/watch?v=MqC3tudPH6w'

cd /Users/arthur/agents/local/proofs/mitchell-hashimoto-can-we-test-it
shasum -a 256 source.mp4
stat -f '%z bytes' source.mp4
ffprobe -v error -show_entries format=duration,size:stream=index,codec_type,codec_name,width,height,r_frame_rate -of json source.mp4

mkdir -p representative sample-1fps
ffmpeg -y -ss 00:01:00 -i source.mp4 -frames:v 1 -update 1 representative/frame-0060.png
ffmpeg -y -ss 00:20:00 -i source.mp4 -frames:v 1 -update 1 representative/frame-1200.png
ffmpeg -y -ss 00:42:00 -i source.mp4 -frames:v 1 -update 1 representative/frame-2520.png
ffmpeg -y -i source.mp4 -vf 'fps=1,crop=1248:832:4:124,scale=240:160:flags=area' -q:v 4 sample-1fps/%05d.jpg

cd /Users/arthur/agents/local/mitchell-testing-talk
mkdir -p docs/research/mitchell-hashimoto-can-we-test-it/cleaned docs/research/mitchell-hashimoto-can-we-test-it/slides

times=(48 130 228 298 328 353 399 474 545 650 805 809 917 1140 1266 1295 1527 1726 1793 2072 2106 2149 2218 2315 2352 2399 2450 2553 2583 2608)
i=1
for t in "${times[@]}"; do
  printf -v n '%03d' "$i"
  ffmpeg -y -loglevel error -ss "$t" -i /Users/arthur/agents/local/proofs/mitchell-hashimoto-can-we-test-it/source.mp4 -vf 'crop=1248:832:4:124' -frames:v 1 -update 1 "docs/research/mitchell-hashimoto-can-we-test-it/slides/slide-${n}.png"
  i=$((i+1))
done

swift /Users/arthur/agents/local/proofs/mitchell-hashimoto-can-we-test-it/ocr_slides.swift /Users/arthur/agents/local/proofs/mitchell-hashimoto-can-we-test-it/slide-ocr.json docs/research/mitchell-hashimoto-can-we-test-it/slides/slide-*.png

/Users/arthur/agents/local/proofs/mitchell-hashimoto-can-we-test-it/merge_transcript_ocr.py /Users/arthur/agents/local/proofs/mitchell-hashimoto-can-we-test-it/source.en.vtt /Users/arthur/agents/local/proofs/mitchell-hashimoto-can-we-test-it/slide-ocr.json docs/research/mitchell-hashimoto-can-we-test-it/cleaned/transcript.md

/Users/arthur/agents/local/proofs/mitchell-hashimoto-can-we-test-it/pngs_to_pdf.py docs/research/mitchell-hashimoto-can-we-test-it/slides/mitchell-hashimoto-can-we-test-it-slides.pdf docs/research/mitchell-hashimoto-can-we-test-it/slides/slide-*.png

pdfinfo docs/research/mitchell-hashimoto-can-we-test-it/slides/mitchell-hashimoto-can-we-test-it-slides.pdf
shasum -a 256 docs/research/mitchell-hashimoto-can-we-test-it/cleaned/transcript.md docs/research/mitchell-hashimoto-can-we-test-it/slides/slide-*.png docs/research/mitchell-hashimoto-can-we-test-it/slides/mitchell-hashimoto-can-we-test-it-slides.pdf
```
