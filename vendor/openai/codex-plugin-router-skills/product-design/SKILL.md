---
name: "codex-plugin-product-design"
description: "Turn early product ideas into reviewable prototypes: confirm the brief, explore product directions, audit user flows, research user friction, prototype from a URL, and make static screenshots interactive."
---

# Product Design (Codex plugin router)

This is a Pi router skill for a vendored OpenAI Codex plugin. Use it when the task matches the plugin description, then load the most relevant detailed skill below with the `read` tool. Do not assume all subskills are in context.

## How to use

1. Pick the narrowest subskill that matches the user task.
2. Read that subskill's `SKILL.md` before acting.
3. Resolve relative references against that subskill directory.
4. If no subskill fits, use the plugin-level description as general guidance and say what is missing.

## Subskills

- `audit` — Audit or critique a product flow, journey, workflow, funnel, onboarding path, checkout path, settings path, screen, or multi-step product experience by capturing screenshots first, placing them in Figma or a local folder, then reporting UX, design, and accessibility findings from that evidence. Use when the user asks to audit, critique, review, inspect, assess, or evaluate a product experience.
  - Path: `vendor/openai/codex-plugin-cache/plugins/product-design/skills/audit/SKILL.md`
- `design-qa` — Internal prototype QA helper. Use only after a Product Design prototype, URL-to-code build, or image-to-code build has a source visual target and a rendered implementation to compare before handoff. Do not use for broad UX critique, design critique, product audits, or flow reviews; route those user-facing requests to audit.
  - Path: `vendor/openai/codex-plugin-cache/plugins/product-design/skills/design-qa/SKILL.md`
- `get-context` — Mandatory design-brief gate for Product Design build and design workflows. Use before ideation, prototyping, image-to-code builds, redesigns, or product UI work to clarify missing product, visual, and interactivity context or play back the supplied brief before proceeding.
  - Path: `vendor/openai/codex-plugin-cache/plugins/product-design/skills/get-context/SKILL.md`
- `ideate` — Generate image-based visual alternatives, remixes, or concept directions after Product Design get-context has confirmed the design brief. Use when the user asks for design variants, visual exploration, remixes, or image-generated approaches from provided context.
  - Path: `vendor/openai/codex-plugin-cache/plugins/product-design/skills/ideate/SKILL.md`
- `image-to-code` — Implement a selected image, screenshot, mockup, or Image Gen reference as a faithful responsive frontend after Product Design get-context has confirmed the design brief.
  - Path: `vendor/openai/codex-plugin-cache/plugins/product-design/skills/image-to-code/SKILL.md`
- `index` — Use to discover specific skills for the Product Design plugin, when it is at-mentioned directly, or for any mentions of potentially relevant work, including: UX research; product, screen, or flow audits; visual ideation; app or interface design, redesign, cloning, prototyping, or implementation from ideas, URLs, images, Figma, or code; design QA; and prototype sharing or deployment.
  - Path: `vendor/openai/codex-plugin-cache/plugins/product-design/skills/index/SKILL.md`
- `prototype` — Route coded prototype requests after Product Design get-context has confirmed the design brief. Use for building prototypes from URLs, images, mockups, Figma, existing code, or ideas that need visual exploration before build.
  - Path: `vendor/openai/codex-plugin-cache/plugins/product-design/skills/prototype/SKILL.md`
- `research` — Run fast, source-grounded UX research on the highest-signal problems users are experiencing with a user-specified digital product. Use when the user asks to research user pain, UX friction, onboarding issues, docs/help problems, developer experience friction, support pain, product workflow issues, or current user complaints for a named product.
  - Path: `vendor/openai/codex-plugin-cache/plugins/product-design/skills/research/SKILL.md`
- `share` — Share a runnable prototype using the user's preferred deployment tool.
  - Path: `vendor/openai/codex-plugin-cache/plugins/product-design/skills/share/SKILL.md`
- `url-to-code` — Clone a live URL as a runnable frontend-only local app using Browser/Chrome source evidence after Product Design get-context has confirmed the design brief.
  - Path: `vendor/openai/codex-plugin-cache/plugins/product-design/skills/url-to-code/SKILL.md`
- `user-context` — Load or manage Product Design's saved user context. Use when the user asks to set up Product Design, get started, onboard, save product or design sources, see what Product Design remembers, update saved context, or remember Product Design preferences. Examples include product URLs, Figma files, screenshots, reference images, codebase paths, Storybook, tokens, design systems, brand assets, and general product/design notes.
  - Path: `vendor/openai/codex-plugin-cache/plugins/product-design/skills/user-context/SKILL.md`

## Plugin source

- Vendored plugin: `vendor/openai/codex-plugin-cache/plugins/product-design`
- Direct Pi-compatible generated subskills, if enabled in all-skills mode: `vendor/openai/codex-pi-skills/product-design`
