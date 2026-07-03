---
name: "codex-plugin-computer-use"
description: "Control desktop apps through Codex Computer Use: screenshots, accessibility-driven app operation, and scoped GUI tasks on macOS. Review before enabling because it can affect host apps."
hide: true
---

# Computer Use (Codex plugin router)

This is a Pi router skill for a vendored OpenAI Codex plugin. Use it when the task matches the plugin description, then load the most relevant detailed skill below with the `read` tool. Do not assume all subskills are in context.

## How to use

1. Pick the narrowest subskill that matches the user task.
2. Read that subskill's `SKILL.md` before acting.
3. Resolve relative references against that subskill directory.
4. If no subskill fits, use the plugin-level description as general guidance and say what is missing.

## Subskills

- `computer-use` — Control local Mac apps through Computer Use. Use for tasks that require reading or operating app UI by clicking, typing, scrolling, dragging, pressing keys, or setting values.
  - Path: `vendor/openai/codex-plugin-cache/plugins/computer-use/skills/computer-use/SKILL.md`

## Plugin source

- Vendored plugin: `vendor/openai/codex-plugin-cache/plugins/computer-use`
- Direct Pi-compatible generated subskills, if enabled in all-skills mode: `vendor/openai/codex-pi-skills/computer-use`
