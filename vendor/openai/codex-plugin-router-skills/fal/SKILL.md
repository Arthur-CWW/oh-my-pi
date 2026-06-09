---
name: "codex-plugin-fal"
description: "AI image and media generation workflows using Fal models. Use as a reference for building local video/image pipelines and future KIE/Kier AI replacements."
---

# Fal (Codex plugin router)

This is a Pi router skill for a vendored OpenAI Codex plugin. Use it when the task matches the plugin description, then load the most relevant detailed skill below with the `read` tool. Do not assume all subskills are in context.

## How to use

1. Pick the narrowest subskill that matches the user task.
2. Read that subskill's `SKILL.md` before acting.
3. Resolve relative references against that subskill directory.
4. If no subskill fits, use the plugin-level description as general guidance and say what is missing.

## Subskills


## Plugin source

- Vendored plugin: `vendor/openai/codex-plugin-cache/plugins/fal`
- Direct Pi-compatible generated subskills, if enabled in all-skills mode: `vendor/openai/codex-pi-skills/fal`
