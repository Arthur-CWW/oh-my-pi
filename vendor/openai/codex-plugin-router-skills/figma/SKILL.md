---
name: "codex-plugin-figma"
description: "Figma workflows for design-to-code, file inspection, Code Connect templates, variables/tokens, design system generation, diagrams, FigJam, Slides, and component library work."
---

# Figma (Codex plugin router)

This is a Pi router skill for a vendored OpenAI Codex plugin. Use it when the task matches the plugin description, then load the most relevant detailed skill below with the `read` tool. Do not assume all subskills are in context.

## How to use

1. Pick the narrowest subskill that matches the user task.
2. Read that subskill's `SKILL.md` before acting.
3. Resolve relative references against that subskill directory.
4. If no subskill fits, use the plugin-level description as general guidance and say what is missing.

## Subskills

- `figma-code-connect` — Creates and maintains Figma Code Connect template files that map Figma components to code snippets. Use when the user mentions Code Connect, Figma component mapping, design-to-code translation, or asks to create/update .figma.ts or .figma.js files.
  - Path: `vendor/openai/codex-plugin-cache/plugins/figma/skills/figma-code-connect/SKILL.md`
- `figma-create-new-file` — **MANDATORY prerequisite** — you MUST invoke this skill BEFORE every `create_new_file` tool call. NEVER call `create_new_file` directly without loading this skill first. Trigger whenever the user wants a new blank Figma file — a new design, FigJam, or Slides file — or when you need a fresh file before calling `use_figma`. Usage — /figma-create-new-file [editorType] [fileName] (e.g. /figma-create-new-file figjam My Whiteboard, /figma-create-new-file slides Q3 Review)
  - Path: `vendor/openai/codex-plugin-cache/plugins/figma/skills/figma-create-new-file/SKILL.md`
- `figma-generate-design` — Use this skill alongside figma-use when the task involves translating an application page, view, or multi-section layout into Figma. Triggers: 'write to Figma', 'create in Figma from code', 'push page to Figma', 'take this app/page and build it in Figma', 'create a screen', 'build a landing page in Figma', 'update the Figma screen to match code', 'convert this modal/dialog/drawer/panel to Figma'. This is the preferred workflow skill whenever the user wants to build or update a full page, modal, dialog, drawer, sidebar, panel, or any composed multi-section view in Figma from code or a description. Discovers design system components, variables, and styles from Code Connect files, existing screens, and library search, then imports them and assembles views incrementally section-by-section using design system tokens instead of hardcoded values.
  - Path: `vendor/openai/codex-plugin-cache/plugins/figma/skills/figma-generate-design/SKILL.md`
- `figma-generate-diagram` — MANDATORY prerequisite — load this skill BEFORE every `generate_diagram` tool call. NEVER call `generate_diagram` directly without loading this skill first. Trigger whenever the user asks to create, generate, draw, render, sketch, or build a diagram — flowchart, architecture diagram, sequence diagram, ERD or entity-relationship diagram, state diagram or state machine, gantt chart, or timeline. Also trigger when the user mentions Mermaid syntax or wants a system architecture, decision tree, dependency graph, API call flow, auth handshake, schema, or pipeline visualized in FigJam. Routes to type-specific guidance, sets universal Mermaid constraints, and tells you when to use a different diagram type or skip the tool entirely (mindmaps, pie charts, class diagrams, etc.).
  - Path: `vendor/openai/codex-plugin-cache/plugins/figma/skills/figma-generate-diagram/SKILL.md`
- `figma-generate-library` — Build or update a professional-grade design system in Figma from a codebase. Use when the user wants to create variables/tokens, build component libraries, create individual components with proper variant sets and variable bindings, set up theming (light/dark modes), document foundations, or reconcile gaps between code and Figma. Also use when the user asks to create or generate any component in Figma — even a single one — since components require proper variable foundations, variant states, and design token bindings to be production-quality. This skill teaches WHAT to build and in WHAT ORDER — it complements the `figma-use` skill which teaches HOW to call the Plugin API. Both skills should be loaded together.
  - Path: `vendor/openai/codex-plugin-cache/plugins/figma/skills/figma-generate-library/SKILL.md`
- `figma-use` — **MANDATORY prerequisite** — you MUST invoke this skill BEFORE every `use_figma` tool call. NEVER call `use_figma` directly without loading this skill first. Skipping it causes common, hard-to-debug failures. Trigger whenever the user wants to perform a write action or a unique read action that requires JavaScript execution in the Figma file context — e.g. create/edit/delete nodes, set up variables or tokens, build components and variants, modify auto-layout or fills, bind variables to properties, or inspect file structure programmatically.
  - Path: `vendor/openai/codex-plugin-cache/plugins/figma/skills/figma-use/SKILL.md`
- `figma-use-figjam` — This skill helps agents use Figma's use_figma MCP tool in the FigJam context. Can be used alongside figma-use which has foundational context for using the use_figma tool.
  - Path: `vendor/openai/codex-plugin-cache/plugins/figma/skills/figma-use-figjam/SKILL.md`
- `figma-use-slides` — This skill helps agents use Figma's use_figma MCP tool in the Slides context. Can be used alongside figma-use which has foundational context for using the use_figma tool.
  - Path: `vendor/openai/codex-plugin-cache/plugins/figma/skills/figma-use-slides/SKILL.md`

## Plugin source

- Vendored plugin: `vendor/openai/codex-plugin-cache/plugins/figma`
- Direct Pi-compatible generated subskills, if enabled in all-skills mode: `vendor/openai/codex-pi-skills/figma`
