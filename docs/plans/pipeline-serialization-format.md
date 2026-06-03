# Pipeline Serialization Format Plan

## Decision

Use a **versioned YAML recipe** for human-authored creative pipelines, validated by a **JSON Schema**, and emit immutable **JSON run manifests** for executed runs.

Why:

- YAML is easier for prompts, dialogue, subtitles, provider knobs, and comments.
- JSON Schema keeps the format machine-checkable and lets us validate YAML after parsing.
- JSON manifests are better for reproducibility, caching, and downstream tools.

Constraint: use a **JSON-compatible YAML subset** only:

- no YAML anchors/aliases
- no custom tags
- quote dates/times instead of relying on implicit YAML types
- maps/lists/scalars only
- UTF-8 text

## File layout proposal

```txt
workflows/
  recipes/                         # committed human-authored specs, later
    talking-seal-underclass.yaml
  schemas/                         # committed JSON Schema files, later
    workflow.recipe.schema.json
    workflow.run-manifest.schema.json

data/workflow-runs/                # ignored runtime outputs
  <run-id>/
    recipe.yaml                    # exact resolved recipe snapshot
    manifest.json                  # machine run manifest
    logs/
    artifacts/
    provider-raw/                  # redacted if copied into docs/tests
```

Do not add `workflows/` yet unless implementation starts. For now this doc defines the target shape.

## Core concepts

- **Recipe**: desired creative pipeline, authored/reviewed by humans.
- **Stage**: one executable unit, e.g. TTS, Jimeng video generation, lipsync, ffmpeg subtitles, Gemini analysis.
- **Asset**: typed file/URL/artifact reference.
- **Provider**: external/local system used by a stage.
- **Run manifest**: exact resolved inputs, outputs, timings, provider versions, costs, and errors.

## Minimal recipe shape

```yaml
schemaVersion: pi.workflow/v1alpha1
kind: VideoPipelineRecipe
id: talking-seal-underclass
name: Talking Seal Underclass

metadata:
  createdBy: arthur
  tags: [pleometric-inspired, seal, post-labor, brainrot]
  notes: >
    Generate visuals only in the video model. Add readable subtitles in post.

policy:
  maxConcurrentStages: 3
  quotaMode: confirm-before-paid-submit
  allowNetwork: true
  allowPaidGeneration: false
  stopOnRiskControl: true

vars:
  dialogue: "Automation ate the market. By 2040, labor is a fossil. The underclass is permanent, anon."
  durationSec: 6
  aspectRatio: "9:16"

assets:
  seal_reference:
    kind: image
    uri: file://data/dreamina/reference/talking-seal-underclass.png
    role: visual-reference

prompts:
  jimeng_visual_zh:
    language: zh-CN
    text: |
      超现实后现代脑腐风格的竖屏短视频，一只海豹像脱口秀主持人一样面对镜头，
      背景有抽象数学符号、火箭、资本市场图表和冰冷未来城市。
      只生成画面，不要任何可读文字、字幕、标牌或水印。
      嘴部可以自然运动，但不要要求模型渲染英文字幕。

stages:
  - id: generate_visual
    kind: video.generate
    provider: jimeng
    needs: []
    input:
      prompt: $prompts.jimeng_visual_zh
      references: [$assets.seal_reference]
      durationSec: $vars.durationSec
      aspectRatio: $vars.aspectRatio
      mode: image-to-video
    output:
      video: base_video

  - id: synth_voice
    kind: audio.tts
    provider: tts.best_available
    needs: []
    input:
      text: $vars.dialogue
      voice: dry-british-documentary
      format: wav
    output:
      audio: narration_wav

  - id: make_subtitles
    kind: subtitle.generate
    provider: local
    needs: []
    input:
      text: $vars.dialogue
      durationSec: $vars.durationSec
      style: bottom-brainrot-readable
    output:
      subtitles: subtitles_ass

  - id: lipsync
    kind: video.lipsync
    provider: lipsync.best_available
    needs: [generate_visual, synth_voice]
    input:
      video: $outputs.generate_visual.video
      audio: $outputs.synth_voice.audio
    output:
      video: lipsynced_video

  - id: burn_subtitles
    kind: video.ffmpeg
    provider: local
    needs: [lipsync, make_subtitles]
    input:
      video: $outputs.lipsync.video
      audio: $outputs.synth_voice.audio
      subtitles: $outputs.make_subtitles.subtitles
    output:
      video: final_video

  - id: analyze_final
    kind: video.analyze
    provider: gemini-cli
    needs: [burn_subtitles]
    input:
      video: $outputs.burn_subtitles.video
      rubric: surreal-talking-head-quality-v1
    output:
      report: gemini_analysis_json
```

## Parallelism model

The DAG is encoded by `needs`.

For the seal pipeline:

- `generate_visual`, `synth_voice`, and `make_subtitles` can run in parallel.
- `lipsync` waits for visual + audio.
- `burn_subtitles` waits for lipsync + subtitle file.
- `analyze_final` waits for final video.

Provider policy can further serialize risky stages:

```yaml
providers:
  jimeng:
    maxConcurrency: 1
    minPollIntervalMs: 2500
    stopOnErrors: [risk_control, auth]
  gemini-cli:
    copyVideoToTmpFirst: true
```

## Stage kind taxonomy, v1alpha1

Initial stage kinds:

| Kind | Purpose |
|---|---|
| `image.generate` | Text/reference image to image |
| `video.generate` | Text/image/multimodal to video |
| `audio.tts` | Dialogue to voice audio |
| `video.lipsync` | Video/image + audio to talking-head video |
| `subtitle.generate` | Dialogue/timing to `.srt`/`.ass` |
| `video.ffmpeg` | Local transform/mux/burn subtitles |
| `video.analyze` | Gemini/GPT/Grok analysis of result |
| `archive.query` | Pull source inspiration records from local archive |
| `script.generate` | LLM script/dialogue generation |

Keep stage kinds provider-agnostic. Provider-specific knobs go under `input.providerOptions`.

## Asset reference rules

Supported URI schemes:

- `file://...` for local files relative to repo root unless absolute.
- `artifact://<stage-id>/<name>` in manifests after a stage runs.
- `https://...` only for source/provenance URLs or short-lived provider downloads.
- `x-tweet://<tweet-id>` later for local archive provenance.

Every materialized artifact should have:

```json
{
  "id": "final_video",
  "kind": "video",
  "path": "data/workflow-runs/2026-06-03T.../artifacts/final.mp4",
  "sha256": "...",
  "mimeType": "video/mp4",
  "createdByStage": "burn_subtitles"
}
```

## Run manifest shape

`manifest.json` should be append-only for reproducibility:

```json
{
  "schemaVersion": "pi.workflow.run/v1alpha1",
  "recipeId": "talking-seal-underclass",
  "runId": "2026-06-03T120000Z-talking-seal-underclass-a1b2c3",
  "startedAt": "2026-06-03T12:00:00Z",
  "finishedAt": null,
  "status": "running",
  "recipeSha256": "...",
  "stages": [
    {
      "id": "synth_voice",
      "kind": "audio.tts",
      "provider": "cartesia",
      "status": "succeeded",
      "startedAt": "...",
      "finishedAt": "...",
      "inputsResolved": {},
      "outputs": {},
      "cost": { "currency": "USD", "estimated": 0.02 },
      "logs": ["logs/synth_voice.log"]
    }
  ],
  "artifacts": [],
  "errors": []
}
```

## What must be serializable

For good iteration and auditability, the recipe/manifest must capture:

- source tweet/video provenance
- prompts in original language
- final spoken dialogue
- subtitle style and timing strategy
- reference images and hashes
- provider/model/version/options
- random seeds if available
- quotas/cost estimates
- local commands used, especially ffmpeg/Gemini CLI invocations
- all output artifact hashes
- analysis rubric and scores

## Open questions for the serialization lane

1. Should recipes live under committed `workflows/recipes/` or `docs/workflows/` until stable?
2. Use JSON Pointer-style references instead of `$outputs.stage.asset` strings?
3. Should provider auth/session references be external names only, e.g. `sessionRef: jimeng.chrome.default`, never paths?
4. How strict should schema validation be during early experiments?
5. Should local archive queries be embedded in recipes or resolved before recipe creation?

## Implementation milestones

1. Write JSON Schema for the minimal recipe and run manifest.
2. Add a small validator CLI that parses YAML and validates against schema.
3. Add a dry-run planner that prints the DAG and parallel stages.
4. Add local-only executors for `subtitle.generate`, `video.ffmpeg`, and `video.analyze`.
5. Add provider adapters after Jimeng/TTS/lipsync lanes identify stable APIs.
