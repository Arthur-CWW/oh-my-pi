# OpenAI Codex plugin vendor snapshot

This directory intentionally tracks only the small Pi-facing subset of local OpenAI Codex plugin material:

- `codex-plugin-catalog.json`
- `codex-plugin-router-skills/`

The large local checkouts/caches under `vendor/openai/codex`, `vendor/openai/plugins`, `vendor/openai/codex-plugin-cache`, and direct `vendor/openai/codex-pi-skills` remain ignored unless explicitly selected later.

## Source snapshot

Local sources used when creating this subset:

```txt
openai/codex repo:   https://github.com/openai/codex @ 0beb5c7f32
openai/plugins repo: https://github.com/openai/plugins @ cd0fccd4
```

The router skills are distilled Pi wrappers around plugin-level workflows, not a full import of every direct Codex plugin skill.

## Current use

`.pi/extensions/codex-plugin-manager/index.ts` reads this catalog and exposes `/codex-plugins`. By default it enables the macOS and iOS app router skills, which are the Codex plugin material currently relevant to this repo and VoiceInk work.
