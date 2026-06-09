# UGC Studio Style Direction

Durable UI/style direction for the AI UGC creative workspace.

## North Star

```txt
Native agent workbench for creative search
```

The product should feel like a Mac-native creative operations tool: calm, compact, text-first, agent-aware, and built for moving through many candidates quickly. It should not feel like a SaaS marketing dashboard, a toy onboarding flow, or a manual-only video editor.

## Primary References

- Chorus by Melty Labs: `docs/design/ugc-studio/references/chorus-screenshot.png`
- Conductor by Melty Labs: [conductor.build](https://www.conductor.build/)
- Recovered UGC concepts: `docs/design/ugc-studio/recovered/contact-sheet-labeled.png`
- Korean-beauty/ABG genre reference: `docs/design/ugc-studio/references/abg-cmo-korean-beauty-flow-reference.png`
- Existing high-signal UGC concepts:
  - `docs/design/ugc-studio/recovered/generated-01.png` — strongest final layer-editor direction.
  - `docs/design/ugc-studio/recovered/generated-06.png` — useful developer graph mode.
  - `docs/design/ugc-studio/recovered/generated-07.png` — useful batch-review information architecture, weak visual polish.

## Visual Language

- Light-native shell by default: off-white canvas, pale sidebars, thin borders, low-contrast dividers.
- Use dark mode only for video/layer/editor surfaces where media inspection benefits from it.
- Compact typography, closer to Chorus/Conductor/Geist than glossy SaaS. Small labels, restrained weights, no oversized hero type in the app.
- Medium radii, usually 6-10px. Avoid bubbly 16-24px SaaS cards.
- Shadows should be rare and shallow. Prefer borders and surface tint over floating card soup.
- Accent color should be sparse: selection rings, active branch, agent status, warnings, and primary action.
- Prefer native toolbar density: icon buttons, folder rows, breadcrumbs, inspector panes, command bars.
- Avoid decorative gradients, bokeh/orbs, neon cyberpunk, purple-dominant palettes, and onboarding-step marketing screens.
- For the polished web demo stack, bias toward React + Tailwind + shadcn-style primitives. Solid can stay as a route/baseline, but do not spend product energy rebuilding shadcn-quality primitives in Solid unless the side-by-side comparison proves it is worth it.

## Product Layout Principles

- The center should show the current creative object at the highest useful fidelity: playable persona clips, candidate grids, branch map, or final timeline.
- Left rail is project/profile/campaign navigation, not a brand-heavy marketing sidebar.
- Right inspector is context and edits for the selected object: persona, branch, candidate, note, metrics, prompt, or JSON.
- The floating command/prompt surface is important, but it should behave like a workspace command bar, not a giant chatbot panel.
- Secondary controls belong in modals/popovers/inspectors and should not crowd the default exploration view.
- Always leave raw JSON/manifests reachable, but do not make raw JSON the primary creative surface.

## Core Views

These are views/focus modes, not necessarily hard routes:

1. **Persona Atlas** — whole synthetic influencer/profile objects with appearance, voice, interests, niche, sample clips, notes, and branch history.
2. **Exploration Board** — stages of creative search: persona, format, hook, script, CTA, non-CTA posts, proof/demo slot, edit style.
3. **Batch Review Player** — keyboard-fast review of generated candidates, with play/reject/star/fork/annotate and selected-set agent commands.
4. **Campaign Branch Map** — snapshot/fork/checkpoint history across personas, formats, hooks, CTAs, and dead-end branches.
5. **Final Layer Editor** — layer stack, video timeline, captions, audio, b-roll, product demo, and final polish.
6. **Developer Graph** — ComfyUI-like pipeline graph and provider routing, hidden behind a developer/debug toggle.
7. **Reference Profile Remix** — ingest a rights-cleared/public profile as a style source, extract pose/timing/template/hooks, and swap in a synthetic persona/product/voice.

## Information Architecture To Preserve

- Users are mostly directing one agent, not manually editing every attribute.
- Early workflow is babble-and-prune: generate many options, inspect quickly, annotate, fork, and revise selected sets.
- Later workflow is fine-tuning: layer editing, captions, timeline, CTA wording, voice, and export.
- Personas are collections/profiles, not single figures: voice, accent, mannerisms, interests, niche, product lane, posting strategy, non-ad posts, ad posts, and continuity all matter.
- Campaigns need both CTA/conversion tests and non-CTA persona-building posts.
- The system needs snapshot/fork history so users can abandon dead ends and return to promising branches.
- Reference-profile workflows should expose what is preserved vs swapped: preserved pose/timing/shot rhythm/template grammar; swapped synthetic persona, voice, hook copy, caption template, product/demo/CTA.

## What To Avoid

- A three-step onboarding/paywall-style ABG flow as the main app model.
- Treating the product as one final ad clip rather than a creative search process.
- Making the ComfyUI graph the default surface.
- Making the layer timeline the first thing users see when they are still exploring personas/formats.
- Overly constrained cards that make the workspace feel like a dashboard instead of an open workbench.

## Dated Notes

### 2026-06-09

Arthur liked Chorus/Conductor's style direction: native, compact, restrained, clean spacing, good font feel, and agent/workspace state presented without generic SaaS dashboard energy. Preserve that direction for UGC Studio. The ABG paywall/onboarding screenshot is only a weak reference for what ABG means, not a product UX target.

Arthur wants the current Solid implementation and the React/shadcn/Tailwind implementation available on separate routes for before/after and stack comparison. React is the pragmatic default for the polished route because shadcn gives better component leverage; Solid remains useful as a baseline until screenshots decide the direction.

After comparing the live routes, Arthur prefers the **default visual style** of the React/shadcn route, but not its current content density or information architecture. The React route is too under-detailed, and the exploration board/campaign surfaces do not match the stronger generated workspace-view references. Treat `docs/design/ugc-studio/workspace-views/01-persona-atlas.png` through `04-campaign-branch-map.png` as the canonical UX references for view detail, spacing, density, and layout. The implementation target is: React/shadcn base styling plus the generated workspace-view IA/detail.

Arthur clarified that the ABG example was really a Korean-beauty/K-pop-idol-like influencer genre reference, not a request for the ugly onboarding/paywall flow. The future product should also support reference-profile remixing: take a TikTok/influencer/faceless profile, archive/decompose its public style, preserve pose/timing/template mechanics, and swap in a synthetic persona, new hooks, new product, new caption/text template, and new voice.
