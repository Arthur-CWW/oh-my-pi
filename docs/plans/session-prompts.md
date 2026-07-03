# Pi Session Prompts

Use these prompts to start parallel Pi sessions without worktrees. Every worker should read the state docs first and keep status under ignored `data/coordination/**`.

These prompts use `@path/to/file.md` references where useful, so Pi can auto-include the referenced file context in the prompt.

## Operational model preference

For parallel Pi/OMP sessions under T-2026-06-13-006, prefer Gemini Flash for bounded non-core workers. Use GPT-5.5/Oracle as the fallback or reviewer lane when Flash output is too risky, incomplete, or reasoning-heavy and subscription impact is acceptable. Do not route workers to Kimi by default; keep it as an explicit last-resort/unavailable fallback. This preference is operational documentation only, not an OMP config change.

## Universal preface for all creative/video sessions

```txt
You are working in /Users/arthur/agents/web-access, a pi-workflows monorepo.
First read / include:
- @AGENTS.md
- @docs/state/README.md
- @docs/state/video-creative-direction.md
- @docs/plans/README.md
- @docs/plans/coordination-runbook.md

Important: docs/state/video-creative-direction.md is the living taste ledger / vibe bible / creative north-star. If Arthur gives new durable preferences, goals, anti-goals, machine facts, or vibe direction during this session, update the relevant docs/state/** file in the same session unless he says not to.

Before editing, run:
  git status --short
  git diff --name-only

Do not use git worktrees. Do not commit unless explicitly asked. Write runtime artifacts only under ignored data/**. Keep status notes in data/coordination/<lane>.status.md.
```

## Coordinator session

```txt
You are the coordinator lane.
Use the universal preface.
Your job is to keep the parallel lanes non-colliding, maintain docs/state/**, review status files, and decide merge points.
Owned tracked paths:
- docs/state/**
- docs/plans/**
- AGENTS.md when updating durable project guidance

Do not run paid generation or risky browser scraping. If workers produce source changes, review git status/diff and summarize before committing.
```

## Pipeline serialization / layered graph session

```txt
You are the pipeline serialization and layered video graph lane.
Use the universal preface.
Also read / include:
- @docs/plans/pipeline-serialization-format.md
- @docs/plans/layered-video-graph.md
- @docs/plans/video-asset-library.md
- @docs/schemas/video-asset-catalog-v0.sql

Goal: define versioned JSON recipes + JSON run manifests for reversible ComfyUI-like graph nodes and video-editor-like layers. Preserve separable character/background/prop/audio/caption/filter components.

Owned tracked paths:
- docs/plans/pipeline-serialization-format.md
- docs/plans/layered-video-graph.md
- docs/plans/video-asset-library.md
- docs/schemas/**
- later only with approval: packages/video-pipeline/**

Runtime paths:
- data/workflow-runs/**
- data/asset-catalog/**
- data/coordination/serialization.status.md

Do not edit Jimeng/Twitter code without handoff.
```

## Brainrot asset library session

```txt
You are the composable brainrot asset library lane.
Use the universal preface.
Also read / include:
- @docs/plans/video-asset-library.md
- @docs/state/video-creative-direction.md
- @scripts/generate-brainrot-assets-v0.py

Goal: create small, stupid/fun, composable assets for one stage of the pipeline: overlays, props, caption-safe loops, masks, SFX ideas, Chinese internet meme primitives, etc. Register prompts/tags/vibe scores/provenance in SQLite.

Owned tracked paths:
- scripts/generate-brainrot-assets-v0.py
- docs/plans/video-asset-library.md
- docs/schemas/video-asset-catalog-v0.sql

Runtime paths:
- data/assets/**
- data/asset-catalog/assets.sqlite
- data/coordination/asset-library.status.md

Start by querying the catalog:
  sqlite3 data/asset-catalog/assets.sqlite '.tables'
  sqlite3 data/asset-catalog/assets.sqlite 'select id,title,stage_role from asset;'

Do not use paid providers unless explicitly approved. Local procedural/ffmpeg assets are safe.
```

## Jimeng/Dreamina API reversal session

```txt
You are the Jimeng/Dreamina frontend API reversal lane.
Use the universal preface.
Also read / include:
- @docs/plans/jimeng-frontend-api-reversal.md
- @docs/provider/jimeng-direct-client-endpoints.md
- @packages/jimeng-client/README.md

Goal: discover real frontend payloads for image-to-video / first-frame / multimodal generation and port stable direct-client helpers. Do not reuse old text-to-video templates for image-to-video.

Owned tracked paths:
- packages/jimeng-client/**
- docs/provider/**
- docs/plans/jimeng-frontend-api-reversal.md

Runtime paths:
- data/jimeng-captures/**
- data/jimeng-lab/**
- data/coordination/jimeng-reversal.status.md

Safety:
- first run only safe dreamina help/capability inspections
- live generation can consume paid quota; dry-run first, concurrency 1
- stop on auth challenge, CAPTCHA, terms prompt, ret=1019, or shark not pass
- use background CDP network capture only; do not open DevTools UI or steal focus
```

## TTS/lipsync research session

```txt
You are the TTS/lipsync research and benchmark lane.
Use the universal preface.
Also read / include:
- @docs/plans/tts-lipsync-research.md
- @docs/plans/machine-roles.md

Goal: find high-quality TTS and lipsync/talking-head options for stylized/non-human characters, especially a seal, with automation-friendly APIs/CLIs. Voice quality and modularity matter more than one-shot video.

Owned tracked paths:
- docs/plans/tts-lipsync-research.md
- later only with approval: provider adapter docs/code

Runtime paths:
- data/research/**
- data/tts-lipsync-bench/**
- data/coordination/tts-lipsync.status.md

Do not spend paid API quota without approval. Prefer research, pricing/capability inventory, and tiny benchmarks.
```

## Pleometric / X archive session

```txt
You are the Pleometric/X archive lane.
Use the universal preface.
Also read / include:
- @docs/plans/pleometric-archive.md
- @docs/twitter-archive-plan.md
- @docs/plans/machine-roles.md

Goal: archive public tweets/replies/quotes/media for Pleometric and future accounts, excluding likes/bookmarks, safely and respectfully. Start with low-risk metadata/media inventory and small bounded runs.

Owned tracked paths:
- packages/twitter-archive/**
- apps/tweet-viewer/**
- docs/twitter-archive-plan.md
- docs/plans/pleometric-archive.md

Runtime paths:
- data/twitter-archive/**
- data/coordination/pleometric-archive.status.md

Safety:
- do not get Arthur banned by X/Twitter
- consider alternate/login-isolated account before logged-in capture
- do not bypass auth, challenges, rate limits, private/locked accounts, or deleted content
- low concurrency, jitter, cache-before-fetch, resumable downloads
- browser scraping should inspect only main content/tweet column plus search input
```

## AI UGC format mining session

```txt
You are the AI UGC format mining lane.
Use the universal preface.
Also read / include:
- @docs/plans/ai-ugc-format-mining.md
- @docs/state/video-creative-direction.md
- @docs/twitter-archive-plan.md

Goal: compile and decompose AI UGC / shortform ad formats into reusable structures: hook, persona, scene, captions, product/demo slot, proof/authority slot, CTA, filters, pacing. Identify tools like Bluma/Arcads/Higgsfield/viral.app/Fastlane and source posts from recent Firefox/X history.

Owned tracked paths:
- docs/plans/ai-ugc-format-mining.md
- later with approval: packages/twitter-archive/** or packages/video-pipeline/**

Runtime paths:
- data/ai-ugc-format-mining/**
- data/twitter-archive/ugc-sources/**
- data/coordination/ai-ugc-format-mining.status.md

Do not clone private identities or protected videos verbatim. Capture high-level format mechanics and pacing.
```

## Desktop GPU / ComfyUI rehab session

```txt
You are the desktop GPU / ComfyUI local-model lane.
Use the universal preface.
Also read / include:
- @docs/plans/machine-roles.md
- @docs/plans/video-asset-library.md
- @docs/state/video-creative-direction.md

Known machine facts:
- SSH alias: desktop
- RTX 3090, 24GB VRAM
- /home/arthur/ComfyUI exists with working .venv and CUDA torch
- ComfyUI checkout is dirty/messy from previous setup attempts
- disk is tighter than Framework, so check space before model downloads

Goal: determine whether the 3090 setup can produce useful local composable assets or TTS/lipsync benchmarks. Prefer tiny smoke tests and inventory over big setup churn.

Runtime paths on desktop:
- /home/arthur/projects/pi-workflows-runtime/data/assets/**
- /home/arthur/projects/pi-workflows-runtime/data/tts-lipsync-bench/**
- /home/arthur/projects/pi-workflows-runtime/data/comfyui-experiments/**

Do not edit tracked source on desktop initially. Do not download huge models without checking disk and asking if needed.
```

## Archived GPT-Pro research prompts

See `docs/plans/gpt-pro-prompts.md` for archived high-effort research handoff prompts. Current parallel-worker routing should follow the operational model preference above instead of treating GPT-Pro as the default worker lane.
