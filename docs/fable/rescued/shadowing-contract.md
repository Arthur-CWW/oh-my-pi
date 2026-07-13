> Rescued 2026-07-13 from /Users/arthur/.omp/agent/sessions/-agents/2026-07-06T07-53-32-097Z_019f366b-08c1-7000-b479-8aaa760c2c42/local/shadowing-contract.md

# Shadowing tool v1 — alignment contract (primer stream)

The shadowing loop: media in → char-aligned transcript out → surface lets Arthur replay from any point, loop sentences, slow down, toggle pinyin/hanzi. This contract binds the pipeline (producer) and the dashboard shadowing surface (consumer).

## Alignment JSON (v1)

One JSON file per media asset. UTF-8. All times in integer milliseconds.

```jsonc
{
  "version": 1,
  "media": {
    "file": "relative/or/absolute/path.mp3",   // audio or video the times refer to
    "durationMs": 12345,
    "lang": "zh",
    "asr": "fireredasr2s"                       // engine id actually used
  },
  "sentences": [
    {
      "idx": 0,
      "text": "今天天气很好。",
      "pinyin": "jīntiān tiānqì hěn hǎo",       // whole-sentence pinyin, space-separated words
      "startMs": 0,
      "endMs": 2100,
      "chars": [
        {
          "ch": "今",
          "pinyin": "jīn",
          "startMs": 0,
          "endMs": 210,
          "phones": [                             // OPTIONAL (v1.5, MFA forced alignment)
            { "p": "j",   "startMs": 0,  "endMs": 90 },
            { "p": "in1", "startMs": 90, "endMs": 210 }
          ]
        }
      ]
    }
  ]
}
```

Rules:
- `sentences[].chars` covers every CJK char in `text` in order; non-speech punctuation appears in `text` but NOT in `chars`.
- Sentence boundaries: ASR segment boundaries, then split on 。！？；?!; when a segment holds multiple sentences.
- Char times must be monotonic non-decreasing and within the sentence span. When the engine only gives word/segment times, interpolate char times within the word span and mark `"charTiming": "interpolated"` on the sentence.
- `phones` omitted entirely in v1 unless MFA alignment ran.
- Pinyin: tone-marked (nǐ hǎo), derived via pypinyin or engine output.

## Pipeline CLI (producer)

`packages/shadowing-pipeline/` — self-contained uv Python project.

```bash
uv run shadow-align <media.(wav|mp3|mp4|m4a)> -o <out.json> [--engine fireredasr2s]
```

- Video inputs: extract mono 16k wav via ffmpeg to a temp file.
- Engine: FireRedASR2S (github.com/FireRedTeam/FireRedASR2S) — clone/weights cached OUTSIDE the repo (~/.cache/shadowing-pipeline/). Repo carries code + pyproject only, never model weights.
- Output validates against the schema above (a `validate` subcommand or pydantic model).

## Storage/serving (later wiring)

Aligned assets land as `data/primer/shadowing/<slug>/{media file, alignment.json}` — the dashboard will serve and render them (#/shadow route, separate task). Not the pipeline's job beyond writing files there when `--publish` is passed.
