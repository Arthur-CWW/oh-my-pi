# Atlas as a Three.js knowledge world

**Status:** chosen direction for the next Atlas exploration  
**Recorded:** 2026-07-12

## Decision

Move the Atlas world renderer from a React/DOM/SVG composition toward raw Three.js. React remains a thin shell for compact controls, routing, source inspection, and an accessibility mirror. Do not use React Three Fiber initially: the world should use an imperative scene and render loop so interaction and visual experimentation are not constrained by component conventions.

This is a functional exploration, not a commitment to Wonderland or any unified visual style.

## Target feeling

A dense, legible, game-like extended-mind environment:

- continuous camera with pan, zoom, momentum, and strong focus feedback;
- world extends beyond the viewport in both axes;
- cluttered but readable rather than sparse or manicured;
- stable landmarks and learner-pinned objects;
- automatic local settling after movement;
- abundant peripheral notes visible without opening drawers;
- Japanese editorial information density: asymmetric composition, micro-labels, simultaneous type scales, compact controls, and minimal wasted gutters;
- direct manipulation without requiring every knowledge object to become a web card.

## Architecture

```text
Graph construction
  → sparse edge policy
  → layout adapter
  → group contours
  → obstacle-aware edge routing
  → Three.js scene
```

### Application shell

React owns only compact controls, routing, source recovery, ledger/inspector surfaces, and accessible keyboard/screen-reader mirrors.

### World renderer

`AtlasWorld` owns an orthographic camera, continuous input, raycast picking, semantic zoom, scene layers, transition/motion state, and the render loop. Use slight 2.5D depth/parallax for hierarchy while preserving a fundamentally spatial 2D world.

### Layout remains renderer-independent

Compare authored placement, typed local relaxation, and WebCoLa. Layout output is transient display geometry, never epistemic truth. Fixed landmarks and learner pins remain identical across systems.

### Sparse graph policy

Do not show every edge globally. Preserve every stored relation, but render a high-value backbone by default, expand a type-diverse local neighborhood around focus, and reserve all-edges mode for diagnosis. LLM- or vector-proposed edges remain provenance-bearing candidates until accepted. Similarity proposes adjacency; it does not determine spatial truth.

### Groups

Render explicit chapter, authored, community, and learner groups as organic Bubble Set contours rather than boxes. Group backgrounds never intercept input. Overlap and uncertain membership remain visible.

### Edges

Route around inflated node and label bounds. Clip endpoints to visible object boundaries. Score deterministic candidate routes by obstacle crossings, label collisions, length, bends, and displacement. Round selected routes into organic curves.

Relation families have distinct grammars: containment as fields/hulls; evidence as short solid attachments; genealogy as directional streams; tension as doubled or fault-line paths; provisional relations as quiet dotted paths; learner associations as visibly authored marks.

### Dense typography

Use `troika-three-text` for crisp SDF text, wrapping, and many labels. Maintain screen-space minimum sizes. Semantic zoom changes detail rather than existence:

- far: glyph and title;
- middle: title, kind, relation role, and short cue;
- near: body fragments and typed roads;
- focus: provenance and full annotation.

Text, nodes, edge labels, and borders participate in collision scoring. Use opacity, halos, backplates, and depth hierarchy before hiding information.

## Candidate technologies

- Three.js: imperative world renderer and camera.
- `troika-three-text`: readable SDF typography.
- WebCoLa: constrained layout, fixed nodes, rectangle overlap avoidance, groups, and GridRouter.
- `bubblesets-js`: organic contours over explicit set membership.
- Existing typed relaxation: lightweight local settle comparison.

Three.js does not replace layout, graph construction, routing, or grouping algorithms. It renders their outputs.

## Implementation order

1. Build renderer-neutral graph/layout/routing contracts.
2. Render the current 31 objects and sparse relation backbone in a raw Three.js orthographic world.
3. Add semantic zoom and readable text.
4. Add drag, pins, local settle, and layout switching.
5. Add obstacle-routed typed edges and labels.
6. Add Bubble Set group contours.
7. Compare feel and legibility before committing to a visual skin.

## Current non-goals

- No mobile implementation.
- No 3D spectacle for its own sake.
- No automatic mapping of vector distance to spatial truth.
- No dense everything-to-everything graph.
- No premature persistence of generated layout.
- No style-system commitment before the interaction and information hierarchy feel right.
