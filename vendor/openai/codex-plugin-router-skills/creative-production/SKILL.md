---
name: "codex-plugin-creative-production"
description: "Explore campaign ideas, concept images, mood boards, product placements, ad directions, listing images, social posts, launch assets, and reusable visual styles."
---

# Creative Production (Codex plugin router)

This is a Pi router skill for a vendored OpenAI Codex plugin. Use it when the task matches the plugin description, then load the most relevant detailed skill below with the `read` tool. Do not assume all subskills are in context.

## How to use

1. Pick the narrowest subskill that matches the user task.
2. Read that subskill's `SKILL.md` before acting.
3. Resolve relative references against that subskill directory.
4. If no subskill fits, use the plugin-level description as general guidance and say what is missing.

## Subskills

- `ads-explorer` — Explore a supplied product, service, venue, or offer across a diverse 25-family image-ad prompt library. Use when the user wants Ads Explorer, ad directions, image ad prompts, paid social ideas, broad campaign ad exploration, or a review wall before final production.
  - Path: `vendor/openai/codex-plugin-cache/plugins/creative-production/skills/ads-explorer/SKILL.md`
- `explore` — Use when a broad business creative brief needs the Creative Production Explore front door: a compact chooser for Positioning, Mood boards, Scenes, Offers, Ads, Shots, Logos, or active production Assets.
  - Path: `vendor/openai/codex-plugin-cache/plugins/creative-production/skills/explore/SKILL.md`
- `generative-polish` — >-
  - Path: `vendor/openai/codex-plugin-cache/plugins/creative-production/skills/generative-polish/SKILL.md`
- `logo-explorer` — Use when a brand brief needs identity concepts, wordmarks, lockups, identity-system routes, or a logo review board before vector production or final brand polish.
  - Path: `vendor/openai/codex-plugin-cache/plugins/creative-production/skills/logo-explorer/SKILL.md`
- `moodboard-explorer` — Use when a user asks Creative Production to generate several concept images, image options, visual directions, mood boards, visual territories, audience feel, campaign references, or brand direction before mood-board remixing, asset production, or polish.
  - Path: `vendor/openai/codex-plugin-cache/plugins/creative-production/skills/moodboard-explorer/SKILL.md`
- `offer-explorer` — Use when a product, digital product, service, venue, experience, or campaign brief needs 25-family offer-led prompt exploration, contact sheets, review galleries, or coverage checks before remix, asset production, or polish.
  - Path: `vendor/openai/codex-plugin-cache/plugins/creative-production/skills/offer-explorer/SKILL.md`
- `positioning-explorer` — Explore commercially useful positioning routes before visual generation. Use when the user needs to clarify audience, occasion, growth goal, proof, or market angle before mood boards, scenes, business assets, ads, menus, cards, one-pagers, listings, or social posts.
  - Path: `vendor/openai/codex-plugin-cache/plugins/creative-production/skills/positioning-explorer/SKILL.md`
- `scene-explorer` — Explore business, service, customer, retail, and point-of-sale scenes that place a product, venue, service, or offer inside realistic commercial contexts. Use when the user wants scene prompts, product-in-environment exploration, service moments, consumer decision contexts, or reusable scene libraries before mood, style, asset, or polish work.
  - Path: `vendor/openai/codex-plugin-cache/plugins/creative-production/skills/scene-explorer/SKILL.md`
- `shot-explorer` — Explore selected-count camera-angle, crop, zoom, and macro-detail variants from an uploaded image. Use when the user wants a Shot Explorer, product shot variants, alternate views, closeups, pan/zoom exploration, or camera/composition options before polish.
  - Path: `vendor/openai/codex-plugin-cache/plugins/creative-production/skills/shot-explorer/SKILL.md`

## Plugin source

- Vendored plugin: `vendor/openai/codex-plugin-cache/plugins/creative-production`
- Direct Pi-compatible generated subskills, if enabled in all-skills mode: `vendor/openai/codex-pi-skills/creative-production`
