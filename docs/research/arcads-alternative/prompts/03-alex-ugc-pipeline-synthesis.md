# GPT Pro Prompt 03 — Alex Nguyen AI UGC / content-farm pipeline synthesis

Use the project sources, especially `source-digest.md` and the Alex Nguyen article archive summaries. Browse the public X/article URLs if needed.

You are analyzing Alex Nguyen's public AI UGC / AI influencer / TikTok slideshow / content automation pipelines and converting them into a clean-room product/engineering blueprint.

Important constraints:

- Extract high-level mechanics, not exact private identities or protected posts.
- Do not propose platform-evasion or fake-geography tooling. If account-warmup material appears, treat it only as risk/context. Build safe principles: manual review, drafts, low volume, quality, transparency, compliance.
- The goal is to build a modular AI UGC production system, not a spam bot.

## Context from local archive

The archived Alex articles cover:

- AI influencer realism with Grok Imagine + Arcads.
- OpenClaw/Claude/Hermes agents orchestrating Arcads + Postiz.
- Persona blueprints, content pillars, hooks, CTAs.
- Slideshow decomposition: find viral examples, extract slide text/style, create mini-hooks, compose text in post.
- AI influencer farms: many personas/actors for organic product promotion.
- Arcads/Kling Motion Control / reference-video matching for before/after and app/product narratives.
- Cost routing/caching/model selection.

## Deliverables

### 1. Executive summary

What are the reusable principles behind these pipelines? What is actually valuable vs guru-noise?

### 2. Pipeline taxonomy

Create a taxonomy of content pipelines:

- slideshow format cloning;
- AI influencer talking-head ads;
- before/after transformation ads;
- app/product UGC demo;
- brainrot/studytok/professor debate formats;
- reference-video-to-variant workflows;
- content-calendar/agent orchestration;
- distribution/scheduling/manual review.

For each:

- inputs;
- outputs;
- steps;
- required models/APIs;
- reusable templates;
- what should be metadata in an asset catalog;
- failure modes;
- product/scope constraints.

### 3. Product features to extract

Convert the Alex workflows into product features for our Arcads alternative:

Feature | Source mechanic | User-facing workflow | Internal graph nodes | MVP implementation | Better implementation | Risk

Include:

- persona blueprint builder;
- content pillar generator;
- hook bank and hook mutator;
- viral format decomposer;
- slideshow compositor;
- AI influencer image generator;
- influencer consistency library;
- product/app reason insertion;
- batch script variant generator;
- visual proof/B-roll generator;
- Postiz/draft/export integration;
- performance feedback loop.

### 4. Format template schema

Design a JSON/YAML schema for reusable shortform templates that can represent both slideshows and UGC videos.

It should include:

- hook structure;
- scene/slide slots;
- visual references;
- text/caption style;
- persona/voice constraints;
- product slot;
- CTA slot;
- proof/authority slot;
- pacing/rhythm;
- generation prompts;
- rendering instructions;
- remix knobs;
- safety/provenance fields.

Give 2-3 concrete examples.

### 5. Implementation plan in this repo

Give concrete engineering tasks to implement a first safe version:

- data model;
- CLI commands;
- provider adapters;
- compositor/rendering;
- asset catalog;
- queue;
- evaluation loop.

### 6. What to ignore

Explicitly list the Alex ideas/tactics not worth implementing or unsafe to implement.

Be opinionated, concrete, and implementation-focused.
