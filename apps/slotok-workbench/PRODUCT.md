# Product

## Register

product

## Users

Slotok is for Arthur and local AI/video workflow operators building, debugging, and reviewing UGC/brainrot creative pipelines. They work in long, iterative sessions with background agents, local assets, workflow events, provider jobs, candidates, references, and generated artifacts. They need to understand what happened, what is selected, what can be safely changed, and what will spend money.

## Product Purpose

Slotok is a local-first creative operations workbench for turning reference material, workflow telemetry, and provider outputs into usable shortform/video ad artifacts. The interface should make the workflow legible: show the run/chat/event stream, expose selected artifacts and candidates, keep provenance visible, and help the user iterate without confusing demo, dry-run, local, and live-provider states.

Success means the user can open the workbench and quickly answer: what workflow is active, what the agents/providers did, what artifact or candidate is selected, what needs review, what can be rerun or exported, and whether an action is local/dry-run or spendful/live.

## Brand Personality

Chorus-inspired, Slotok-owned product UI: calm, sharp, dense, precise, native. It should feel like a high-quality workbench for creative engineering, not a marketing page and not a generic analytics dashboard.

## Anti-references

- Dark AI-dashboard shells with neon/cyberpunk accents.
- Chunky card soup, giant metric cards, and BI-dashboard layouts.
- Warm beige/cream AI-default surfaces unless a specific content artifact requires warmth.
- Decorative glassmorphism, ornamental gradients, and brand-heavy chrome.
- Side panels that compete with the central work area.
- Collapsible controls that are clever but not obvious.

## Design Principles

1. Workflow first: the center should make the active workflow/chat/event stream legible before secondary metadata.
2. Context is supportive: left navigation and right inspector are useful, optionally collapsible, and secondary to the center workbench.
3. Preserve provenance and risk: local/dry-run/live, provider cost, reference-only status, and import/export state must be visible where decisions happen.
4. Dense but calm: show lots of information with native restraint, strong hierarchy, and local scrolling instead of oversized cards.
5. Interaction over decoration: every visual treatment should clarify selection, state, affordance, or next action.

## Accessibility & Inclusion

Target WCAG AA contrast for text and controls. Keyboard navigation and shortcuts matter, but shortcuts should not add visual noise. Responsive behavior must avoid document-level overflow on desktop, tablet, and phone widths; if a full workbench view cannot fit on mobile, provide a usable fallback with primary navigation and readable state. Respect reduced-motion preferences for any animation.