# Atlas of Inquiry: Design Brief
Implementation scope note: the first implementation targets the desktop 1440x900 layout; mobile requirements remain design research and are deferred, not deleted.

This document specifies the Atlas of Inquiry prototype in implementation-ready detail. The Atlas is a continuous 2D world for knowledge exploration, built on the Inquiry World contract (`inquiry-world-contract.md`). It is not a dashboard, not a graph skin, and not cards on a big canvas. It is a place one inhabits to orient, trace conceptual development, compare adjacent ideas, and recover authored source at every level.

The Atlas uses the `atlas` projection from `ViewLens`, consumes the full `InquiryObject` and `InquiryRelation` union, and serializes all spatial meaning through `SpatialPlacement` records with explicit `semantics` fields. Every visual mark has a legend entry. Every spatial convention is inspectable and switchable.

---

## 1. Macro world composition

The Atlas world is a finite authored plane, not an infinite canvas. Its extent is determined by the union of all `SpatialPlacement` records for the active `ViewLens`, plus a declared margin. There is no procedural terrain, no decorative biome, and no ornamental geography.

### 1.1 World layers

The world composes four layers, rendered bottom-to-top:

| Layer | What it contains | Data source |
|---|---|---|
| **Ground** | Region boundaries, room outlines, frontier fog, road spines | `inquiry-region` and `inquiry-room` placements, `Route` steps, `open-question` objects with `blocked-by-missing-source` or `deliberately-open` status |
| **Objects** | All `InquiryObject` placements: source shards, concepts, intuitions, motivations, mechanisms, examples, counterexamples, tensions, claims, evidence, objections, genealogy events, open questions, learner artifacts | `SpatialPlacement` records where `geometry.kind === "point"` or `"rect"` |
| **Roads** | Route paths rendered as named traversal lines connecting step objects | `Route.steps` mapped through `SpatialPlacement` coordinates |
| **Overlay** | Active lens legend, minimap, breadcrumb, selection inspector, genealogy/time overlay when toggled | UI state; not persisted as `SpatialPlacement` |

### 1.2 World bounds and density

- **Extent:** The renderer computes the bounding box of all placements for the active lens, adds 20% margin on each side. Objects beyond the margin are errors in the dataset, not hidden content.
- **Density contract:** No two objects may overlap at the default zoom level. The layout algorithm (or manual-v0 author) must satisfy this. When procedural layout would create overlap, objects are pushed apart along the axis declared by `proximityMeans`, and the manifest records the adjustment.
- **Empty space is meaningful:** Gaps between regions are not wasted canvas. They signal that no authored relation connects the regions. The gap width is proportional to the weakest inter-region relation, or a constant gutter if no relation exists.

### 1.3 No force layout

The Atlas does not use force-directed layout. Positions are either:
1. **Manual-v0 authored:** An editor or learner placed the object at explicit coordinates with a rationale.
2. **Procedural with declared semantics:** The layout algorithm optimizes for the active `proximityMeans` (e.g., objects sharing `same-source` are placed near each other). The algorithm and its semantic are recorded in the `GenerationManifest`.
3. **Learner-locked:** A learner dragged an object to a position. `lockedByLearner: true` survives regeneration.

Force layout is rejected because it produces positions with no inspectable meaning. An object's position must answer the question "why is this here?" with a specific authored or declared reason.

---

## 2. Question-centered regions

### 2.1 Region anatomy

An `inquiry-region` is rendered as a named bounded area on the ground layer. Its visual form is a closed shape (rounded rectangle or convex hull of its contained placements) with:

| Element | Rendering | Data field |
|---|---|---|
| Region title | Large text label at the top-left interior corner, left-aligned | `InquiryObject.title` where `kind === "inquiry-region"` |
| Entry question | Subtitle text below the title, prefixed with "?" glyph | `entryQuestionId` resolved to the `focus-question` object's `title` |
| Boundary | 1px solid stroke; color from `colorMeans` encoding | `boundaryRule` field determines shape algorithm |
| Boundary rule tooltip | On hover/focus of boundary stroke, shows the authored reason for this boundary | `boundaryRule` text |
| Authorship badge | Small glyph at top-right: pen (editorial), hand (learner-authored), dashed-circle (procedural-candidate) | `authorship` field |
| Review state | Thin secondary stroke: solid (accepted), dashed (proposed), dotted (draft) | `reviewState` field |

### 2.2 Region nesting

Regions may contain rooms but not other regions. If the dataset has `inquiry-region` objects with `parentIds` pointing to other regions, the renderer treats them as siblings with a shared group label, not nested containers. This prevents containment ambiguity.

### 2.3 Region as semantic neighborhood

A region's position relative to other regions encodes the active `proximityMeans`:
- `same-source`: regions sharing source material are adjacent.
- `shared-mechanism`: regions connected by `operationalizes` relations are adjacent.
- `historical-descent`: regions with `precedes` or `influences` relations are ordered left-to-right or top-to-bottom by temporal order.
- `learner-grouping`: the learner placed them where they wanted them.

The active proximity semantic is displayed in the legend and applies uniformly to all inter-region distances.

---

## 3. Stable landmarks

Landmarks are objects designated as persistent orientation anchors. They do not move during pan/zoom, re-layout, or lens switching unless the learner explicitly drags them.

### 3.1 Landmark designation

An object becomes a landmark when any of:
- It is the `focusQuestionId` of the active `ViewLens`.
- It is tagged `"landmark"` in its `tags` array.
- The learner pins it via the landmark action (see interaction grammar).

### 3.2 Landmark rendering

| Property | Rendering |
|---|---|
| Shape | Larger than non-landmark objects of the same kind (1.5x default size) |
| Border | Double stroke |
| Label | Always visible regardless of zoom level; never culled by LOD |
| Minimap | Landmarks are the only individually labeled objects on the minimap |
| Keyboard | `L` cycles through landmarks in declared order; `Shift+L` reverses |

### 3.3 Landmark stability contract

- Landmarks have `lockedByLearner: true` or are locked by the lens declaration.
- Procedural re-layout must not move landmarks. Other objects are placed relative to landmarks.
- If a landmark is removed from the dataset (source hash change), the system shows a "landmark removed" ghost at the old position with the removal reason, until the learner acknowledges it.

---

## 4. Concept rooms that expand in place

### 4.1 Room anatomy

An `inquiry-room` is a bounded workspace inside a region (or standalone). It has two states: **collapsed** and **expanded**.

#### Collapsed state

A compact rectangle showing:
- Room title (left-aligned, medium weight).
- Entry question (single line, truncated with ellipsis at 80 characters).
- Object count badge: e.g., "7 objects, 3 relations."
- Authorship glyph and review-state stroke (same encoding as regions).
- A door icon indicating expandability.

Size: fixed width (200px at default zoom), height determined by title + question text.

#### Expanded state

The room opens in place, pushing surrounding objects outward with an animated transition (see motion continuity, section 14). The expanded room reveals:

- Full entry question text.
- All contained objects at their declared `SpatialPlacement` positions, rendered at the room's local coordinate system.
- Internal roads (route steps that connect objects within the room).
- Exit artifact slot: if `exitArtifactId` is set, a distinct "exit" object is rendered at the bottom of the room with a checkmark or empty-circle glyph.
- Room boundary rule: displayed as a footer line at the bottom of the expanded room.

#### Expansion mechanics

1. The room's collapsed rectangle becomes the room's expanded bounding box.
2. Objects outside the room are pushed outward by the expansion delta. Push direction follows the nearest edge of the room. Push is animated over 300ms with ease-out-quart easing.
3. The room's internal coordinate system maps its contained `SpatialPlacement` records to pixel positions within the expanded bounding box.
4. Collapsing reverses the animation. Internal object positions are preserved in their `SpatialPlacement` records; they are not destroyed by collapse.

#### Nested expansion

If a room contains another room (via `contains` relation), the inner room renders as a collapsed room inside the outer expanded room. The inner room can expand further, triggering another push. Maximum nesting depth for rendering: 3 levels. Deeper nesting is accessible via the list ledger.

### 4.2 Room entry/exit

- **Enter:** Click/tap the collapsed room, or keyboard `Enter` when focused.
- **Exit:** Click/tap the room boundary border, or keyboard `Escape`. The camera pulls back to show the room in its regional context.
- **Breadcrumb:** Entering a room adds it to the breadcrumb trail (see semantic camera, section 10).

---

## 5. Labeled roads

### 5.1 Road rendering

A road is a `Route` rendered as a path connecting its step objects in order. Roads are drawn on the Roads layer, above ground but below objects.

| Element | Rendering |
|---|---|
| Path | Polyline connecting step object centers, with 4px stroke. Routing avoids object collision using orthogonal segments with rounded corners (not straight-line overlap). |
| Road name | Text label along the first segment, reading left-to-right or top-to-bottom. Font: 11px, medium weight. |
| Step markers | Small numbered circles (12px diameter) at each step object's edge, numbered by `RouteStep.order`. |
| Active step | When traversing a route, the current step marker fills solid; others are outlined. The path behind the current step renders at full opacity; the path ahead renders at 50% opacity. |
| Direction arrows | Small chevrons along the path every 80px, pointing in traversal direction. |
| Authorship color | Editorial routes: warm gray. Learner-authored routes: the learner's chosen color or a tinted blue. Procedural-candidate routes: dashed stroke. |
| Fork indicator | If the current step's `instruction` mentions alternatives, a small branch glyph appears at the step marker. Clicking it reveals the alternative in a tooltip. |

### 5.2 Road interaction

- **Start traversal:** Click the road name label or the first step marker. The camera smoothly pans to center step 1.
- **Advance:** `N` or right-arrow moves to the next step; `P` or left-arrow moves to the previous. The camera pans to center the new step.
- **Inspect step:** When a step is active, the instruction text appears in a floating panel below the step object. The panel also shows the relation label (from `RouteStep.relationId`) and the exit check if present.
- **Exit traversal:** `Escape` or clicking outside the route. The camera stays at the current position.
- **Route comparison:** When two routes share objects, their paths render simultaneously with distinct colors. Shared steps show both route markers.

### 5.3 Road-to-ledger parity

Every road appears in the list ledger as an ordered sequence of rows: step number, object title, relation label, instruction, and exit check. The ledger representation is the primary form; the spatial rendering is a visual convenience.

---

## 6. Frontiers and open questions

### 6.1 Frontier rendering

Frontiers are spatial representations of open, unresolved, or missing-source areas. They are not decorative fog.

A frontier is rendered when:
- An `open-question` object has `questionStatus` of `open`, `blocked-by-missing-source`, or `deliberately-open`.
- A region or room has no objects with `reviewState: "accepted"` for a declared entry question.
- An `unsupportedClaims` entry in the `ViewLens` identifies a gap.

| Frontier type | Visual treatment |
|---|---|
| Open question | Object rendered with a hatched background pattern (diagonal lines at 45 degrees, 4px spacing). The hatching color follows the `colorMeans` encoding but at 30% opacity. |
| Blocked by missing source | Object rendered with a dashed border and a "source needed" icon (broken chain link). Tooltip shows the specific missing source description from the object's `body`. |
| Deliberately open | Object rendered normally but with a small "intentionally open" glyph (an open padlock). No hatching, because the openness is a feature, not a gap. |
| Unsupported claim region | A translucent overlay (8% opacity warm gray) over the area where the unsupported claim's related objects are placed. The overlay carries a text label: the unsupported claim text from `ViewLens.unsupportedClaims`. |

### 6.2 Frontier inspection

- Click/focus a frontier object to see: question text, status, why it is open (from `body`), what would resolve it (from `exitCheck` if on a route step), and related objects via `raises` relations.
- Frontiers are sorted to the top of the list ledger's "Open Questions" section, ordered by status: `blocked-by-missing-source` first, then `open`, then `deliberately-open`.

---

## 7. Guided routes

Routes are the Atlas's answer to "where do I start?" and "what should I look at next?" They are editorial or learner-authored traversal plans, not system-inferred recommendations.

### 7.1 Route activation

- The active lens may declare a default route via its `focusQuestionId` matching a `Route.focusQuestionId`.
- The learner can activate any route from the route picker (a dropdown in the toolbar, or `R` to open the route list).
- Only one route is active at a time. Activating a new route deactivates the old one.

### 7.2 Route HUD

When a route is active, a persistent route HUD appears at the bottom of the viewport:

```
[Route: Machinic Synthesis orientation route]  Step 3/6: "Recover the schizoanalysis concept anchor..."  [< Prev] [Next >] [Exit]
```

- The HUD shows: route title, current step number/total, truncated instruction text, and navigation controls.
- Clicking the route title expands the HUD to show all steps as a vertical list with the current step highlighted.
- The HUD is keyboard-navigable: `Tab` into the HUD, arrow keys to navigate steps, `Enter` to jump to a step.

### 7.3 Route and camera

Advancing a step triggers the semantic camera (section 10) to transition to the next step's object. The transition type depends on the spatial relationship:
- Same room: smooth pan.
- Different room: current room collapses, target room expands, camera pans to the target.
- Different region: camera zooms out to show both regions, then zooms in to the target region and room.

### 7.4 Route authoring

The learner can create a new route:
1. Enter route-authoring mode (`Ctrl+Shift+R`).
2. Click objects in desired order. Each click adds a step.
3. For each step, a prompt appears for the instruction text (optional; defaults to the object title).
4. End route authoring with `Escape` or the "Finish route" button.
5. The system creates a `Route` object with `authorship: "learner-authored"`, `reviewState: "draft"`, and an `AuthoringEvent` of type `create-object`.

---

## 8. Genealogy and time overlays

### 8.1 Genealogy overlay

The genealogy overlay is a togglable layer that renders `genealogy-event` objects and `precedes`/`influences` relations as a time-ordered arrangement superimposed on the current spatial layout.

When activated (toggle: `G` key or toolbar button):

1. Objects with `genealogy-event` kind or with `precedes`/`influences` relations gain a secondary position along a horizontal time axis rendered at the top of the viewport.
2. The time axis shows `temporal.date`, `temporal.orderLabel`, or `temporal.intervalStart`/`intervalEnd` as tick marks.
3. Thin vertical leader lines connect each object's main spatial position to its time-axis position.
4. `influences` relations render as curved arrows between time-axis positions, with the arrow labeled by `influenceScope` (`author-stated`, `editorial-with-source`, `learner-hypothesis`).
5. `precedes` relations render as straight horizontal arrows, labeled by `orderKind` (`source-sequence`, `chronology`, `publication`, `learner-route`).

### 8.2 Time overlay behavior

- The time axis is an overlay; it does not move objects from their spatial positions. The leader lines make the dual encoding visible.
- Objects without temporal data are not placed on the time axis. They remain at their spatial positions with no leader line.
- The time axis is scrollable independently of the main canvas if it exceeds viewport width.
- Hovering a time-axis position highlights the corresponding spatial object and dims others.
- The genealogy overlay respects `reviewState`: candidate genealogy relations render as dashed arrows with a "candidate" label.

### 8.3 Genealogy in the ledger

The list ledger gains a "Genealogy" tab when genealogy-event objects exist. This tab shows a flat chronological list: date/order, event title, event kind, related objects, influence scope, and provenance. It is the canonical representation; the overlay is a visual aid.

---

## 9. Declared lens switching

### 9.1 Lens model

A `ViewLens` declares what the Atlas shows and what its spatial encodings mean. Switching lenses changes:
- Which object kinds are visible (`objectKinds`).
- Which relation types are rendered (`relationTypes`).
- What proximity, size, color, containment, and edge style mean (`legend`).
- Which columns appear in the list ledger (`ledgerColumns`).

### 9.2 Lens switcher UI

A lens picker lives in the top-left toolbar:

```
[Lens: Machinic Synthesis Atlas v] [Legend] [Ledger]
```

- Clicking the dropdown shows all available lenses for the current workspace, grouped by `prototype` (`atlas-of-inquiry`, `shared`).
- Each lens entry shows: name, focus question, object kind count, relation type count.
- Selecting a lens triggers a crossfade transition (200ms). Object positions are read from `SpatialPlacement` records for the new `lensId`. Objects not placed in the new lens fade out; newly visible objects fade in at their declared positions.

### 9.3 Legend panel

The legend panel (toggled by clicking "Legend" or pressing `?`) displays the active lens's `legend` fields:

| Legend entry | Display |
|---|---|
| Position | `legend.position` text, e.g., "Manual-v0 editorial placement around the focus question." |
| Proximity | `legend.proximity` text + the active `proximityMeans` value highlighted |
| Size | `legend.size` text + the active `sizeMeans` value if nonconstant |
| Color | `legend.color` text + a color swatch key showing the active `colorMeans` encoding |
| Containment | `legend.containment` text |
| Roads | `legend.roads` text |
| Rooms | `legend.rooms` text |
| Ambiguity | `legend.ambiguity` text |

The legend panel is always available. It is not a tooltip; it is a persistent reference panel that can be pinned open.

### 9.4 Encoding switching

Within a single lens, the learner can switch the active encoding for proximity, size, and color without changing the lens itself. This produces a temporary view state that is not persisted to the `ViewLens` unless the learner explicitly saves it as a snapshot.

- **Proximity switch:** Dropdown in the legend panel. Options: `same-source`, `compare-now`, `shared-mechanism`, `evidence-neighborhood`, `historical-descent`, `learner-grouping`, `prerequisite-route`, `unresolved-frontier`. Switching proximity triggers a re-layout animation: objects slide to new positions over 400ms with ease-out-quart. Learner-locked objects do not move.
- **Size switch:** Dropdown. Options: `constant`, `source-coverage`, `evidence-count`, `learner-attention`, `abstraction-level`, `uncertainty`. Objects smoothly scale over 300ms.
- **Color switch:** Dropdown. Options: `authorship`, `review-state`, `object-kind`, `evidence-kind`, `none`. Color transitions are instant (no animation; animated color changes cause accessibility issues with motion sensitivity).

Each switch updates the legend panel text to reflect the new encoding and adds a "Modified from lens default" indicator.

---

## 10. Semantic camera behavior

The camera is the viewport into the Atlas world. Camera behavior is semantic: every camera motion has a named reason.

### 10.1 Camera states

| Camera state | Trigger | Behavior |
|---|---|---|
| **World overview** | Initial load, or `Home` key | Shows the full extent of all placements with padding. Zoom level fits everything. |
| **Region focus** | Click a region title, or arrive via route | Zoom to fit the region bounding box with 10% padding. |
| **Room focus** | Enter a room | Zoom to fit the expanded room with 10% padding. Room expands in place. |
| **Object focus** | Click/select an object, or arrive via route step | Pan to center the object. Zoom does not change unless the object is smaller than 10% of viewport, in which case zoom in to make it 20% of viewport. |
| **Evidence focus** | Click "show source" on an object | If the source shard is on-canvas, pan to it and highlight both the derived object and the source shard with a connecting line. If not on-canvas (different lens or filtered out), open the source panel (section 12). |
| **Source recovery** | Click source locator in inspector | Open the source text in a side panel without leaving the Atlas canvas. The canvas dims to 70% opacity but does not scroll. |

### 10.2 Camera transitions

All camera transitions follow these rules:
- **Duration:** 300ms for pan-only; 400ms for zoom+pan; 200ms for crossfade (lens switch).
- **Easing:** ease-out-quart for spatial movement; ease-out for opacity changes.
- **Reduced motion:** When `prefers-reduced-motion: reduce` is active, all spatial transitions are replaced by instant cuts with a 100ms opacity crossfade. No sliding, no scaling animation.
- **Breadcrumb:** Every camera transition appends to a breadcrumb stack: `[World] > [Region: Machinic Synthesis] > [Room: Source passages] > [Object: b-010]`. The breadcrumb is displayed below the toolbar. Clicking any breadcrumb entry returns the camera to that state.

### 10.3 Semantic camera across zoom levels

The Atlas has five semantic zoom levels. Each level changes what is visible and interactive, not just the scale:

| Zoom level | Name | Visible objects | Visible labels | Interactions |
|---|---|---|---|---|
| Z1 | **Work** | Region outlines, landmark labels, road spines, frontier areas | Region titles, landmark titles | Click region to enter; see world-level stats |
| Z2 | **Region** | Region contents: rooms (collapsed), standalone objects, roads within region, frontiers | Room titles, object titles for non-room objects, road names | Click room to enter; select objects; start routes |
| Z3 | **Room** | Room contents: all objects at full detail, internal roads, exit artifact | All object titles, relation labels on hover, road step numbers | Select objects; inspect relations; follow roads; expand objects |
| Z4 | **Evidence** | Single object expanded: body text, provenance summary, relation list, source locator links | Full object detail | Read body text; click provenance; navigate relations; recover source |
| Z5 | **Source** | Source panel open: Reader IR block text, annotation context, concept anchor spans | Source text with highlights | Read source; compare with derived object; close panel to return |

Zoom level transitions are smooth when not in reduced-motion mode. The renderer interpolates between levels, progressively revealing or hiding elements based on viewport scale.

---

## 11. Pan, zoom, keyboard, and minimap

### 11.1 Pan

- **Mouse:** Click and drag on empty canvas space. Cursor changes to grab hand.
- **Trackpad:** Two-finger drag.
- **Touch:** Single-finger drag (when not on an object).
- **Keyboard:** Arrow keys pan by 100px per press; hold `Shift` for 400px jumps.
- **Constraint:** Pan is bounded to the world extent plus margin. No infinite scrolling.

### 11.2 Zoom

- **Mouse wheel:** Scroll to zoom. Zoom is centered on the cursor position.
- **Trackpad:** Pinch to zoom.
- **Touch:** Two-finger pinch.
- **Keyboard:** `+`/`=` to zoom in, `-` to zoom out. Zoom is centered on the current viewport center, or on the focused object if one is focused.
- **Zoom range:** Minimum zoom shows the full world extent. Maximum zoom makes a single object fill 50% of the viewport width. There are no zoom levels beyond these bounds.
- **Snap levels:** The zoom snaps gently to the five semantic zoom levels (Z1-Z5) with a 10% hysteresis band. The learner can zoom freely between snap levels, but the LOD transition points align with the snap levels.

### 11.3 Keyboard navigation

| Key | Action |
|---|---|
| `Tab` | Cycle focus through objects in the current viewport, left-to-right, top-to-bottom. `Shift+Tab` reverses. |
| `Enter` | Open/expand the focused object or room. |
| `Escape` | Close/collapse the current context. If in a room, exit room. If in route traversal, exit route. If object inspector is open, close it. |
| `Arrow keys` | Pan canvas (no focused object) or move between related objects (when an object is focused, arrows follow relation edges). |
| `L` | Cycle through landmarks. |
| `R` | Open route picker. |
| `G` | Toggle genealogy overlay. |
| `?` | Toggle legend panel. |
| `/` | Open search (searches object titles and bodies). |
| `Ctrl+Shift+L` | Toggle list ledger panel. |
| `H` | Open object history (selection history). |
| `I` | Open/close inspector for focused object. |
| `S` | Save snapshot of current view state. |
| `1`-`5` | Jump to semantic zoom levels Z1-Z5. |
| `Home` | Return to world overview (Z1). |
| `N`/`P` | Next/previous route step (during route traversal). |

### 11.4 Minimap

The minimap is a persistent panel in the bottom-right corner of the viewport. It shows a compressed view of the entire world.

**Minimap contents:**
- Region outlines as filled rectangles with region colors.
- Landmark positions as labeled dots (the only individually labeled objects on the minimap).
- The current viewport as a semi-transparent rectangle.
- Active route path as a thin line.
- Frontier areas as hatched regions.
- The current focused object as a pulsing dot.

**Minimap interactions:**
- Click anywhere on the minimap to pan the main viewport to that position.
- Drag the viewport rectangle on the minimap to pan the main viewport.
- The minimap cannot be zoomed independently; it always shows the full world extent.

**Minimap sizing:** 200x150px on desktop, 120x90px on mobile. Collapsible via a toggle button on its corner.

**Accessibility fallback:** When minimap is not useful (screen reader, very small viewport), the same information is available as a textual "Location summary": current region, nearest landmarks, open roads, and frontier count. This summary is announced on camera transitions.

---

## 12. Object selection, inspection, and history

### 12.1 Object rendering

Every `InquiryObject` placed in the Atlas has a consistent visual anatomy:

| Element | Rendering by object kind |
|---|---|
| **Shape** | Rounded rectangle for all kinds. Corner radius: 4px. |
| **Kind glyph** | Top-left corner, 16x16px. Glyphs: `?` (focus-question), `[ ]` (source-shard), `{ }` (concept), `~` (intuition), `!` (motivation), `gears` (mechanism), `specimen` (example/counterexample), `><` (tension), `claim` (claim), `evidence-flask` (evidence), `!?` (objection), `timeline-dot` (genealogy-event), `?+` (open-question), `pen` (learner-artifact), `road-sign` (route), `camera` (snapshot). |
| **Title** | To the right of the kind glyph. Font: 13px, semibold. Truncated at object width with ellipsis. |
| **Authorship indicator** | Right edge, vertical strip: 3px wide. Colors: Source-derived: neutral warm gray. Editorial: a slate blue. Learner-authored: a tinted teal. Procedural-candidate: a muted amber with dashed pattern. |
| **Review state** | Border style: solid 1px (accepted), dashed 1px (proposed), dotted 1px (draft), red dashed (rejected), double-line 1px (corrected), faded 1px (superseded). |
| **Size** | When `sizeMeans` is `constant`: all objects are 180x48px at default zoom. When nonconstant, objects scale between 0.7x and 1.8x of default, with the scalar mapped to the declared size semantic. |
| **Color fill** | Determined by `colorMeans`. See encoding legend (section 15). Default: a very light tint of the kind's base hue, never saturated. |

### 12.2 Object selection

- **Select:** Click an object, or `Tab` to it and press `Enter`. Selected objects gain a 2px highlight ring (the ring color is the complement of the object's fill, ensured to meet 4.5:1 contrast).
- **Multi-select:** `Shift+Click` to add to selection. `Ctrl+Click` (`Cmd+Click` on Mac) to toggle. Lasso selection by holding `Shift` and dragging on empty space.
- **Selection inspector:** When one object is selected, an inspector panel slides in from the right side of the viewport. When multiple objects are selected, the inspector shows a comparison summary (see section 12.4).

### 12.3 Inspector panel

The inspector panel shows full detail for the selected object:

| Section | Content |
|---|---|
| **Header** | Kind glyph + kind label, title, authorship badge, review state label |
| **Body** | Full `body` text, rendered as markdown. Max height 200px with scroll. |
| **Provenance** | Ordered list of provenance records. Each shows: kind icon, locator summary (work/unit/block/annotation IDs), transform text, confidence badge, created-by label, and created-at timestamp. Clicking a provenance entry triggers source recovery (section 12.6). |
| **Relations** | Grouped by relation type. Each row: relation type label, direction arrow (from/to), connected object title (clickable to select that object), relation label text, review state, confidence. |
| **Placement** | Current geometry (x, y), active semantics summary (proximity, size, color, containment meanings), locked-by-learner toggle. |
| **Tags** | Tag list, each clickable to filter the atlas to objects sharing that tag. |
| **Unsupported claims** | If this object is referenced by `ViewLens.unsupportedClaims`, those claims are shown with a warning icon. |

### 12.4 Multi-object comparison

When 2-5 objects are selected, the inspector switches to comparison mode:

- A horizontal table with objects as columns and fields as rows: kind, authorship, review state, tag intersection, shared relations, differing relations.
- Shared relations are highlighted; unique relations are marked.
- A "Compare in ledger" button opens the list ledger filtered to the selected objects.

Selecting more than 5 objects shows only a count summary and a "View in ledger" button.

### 12.5 Selection history

The Atlas maintains a selection history stack (last 50 selections). The learner can:
- Press `H` to open the history panel.
- Click any history entry to re-select that object and return the camera to its position.
- History entries show: object title, kind glyph, timestamp of selection, and the camera state at the time of selection.

Selection history is session-local (not persisted to the workspace). It survives lens switching within the same session.

### 12.6 In-place source recovery

Source recovery is the ability to trace any object back to its authored source material. It is the Atlas's most important capability.

**Recovery flow:**

1. Select an object.
2. In the inspector's Provenance section, click a provenance entry.
3. The system resolves the `SourceLocator`:
   - `reader-ir`: Opens the Reader IR block/unit/annotation/concept-anchor in a side panel, with the relevant span highlighted.
   - `graph-index`: Opens the graph record/assertion in the side panel.
   - `archive-source`: Opens the archived external source at the specified heading/section.
   - `manual-v0`: Opens the manual-v0 file at the specified pointer.
4. The side panel shows the source text with the derived object's relationship highlighted: which spans were used, what transform was applied, and what the confidence level is.
5. The main canvas dims to 70% opacity but maintains its position. The learner can close the side panel to return.

**Source panel anatomy:**

```
+------------------------------------------+
| Source: Meltdown block b-010             |
| Unit: u-07-machinic  Page: 2            |
| [Close X]                                |
|------------------------------------------|
| [highlighted source text passage]        |
|                                          |
| Transform: "manual-v0 source shard       |
|   locator"                               |
| Confidence: source-stated                |
| Created by: source                       |
| Quote policy: not-copied                 |
+------------------------------------------+
```

**Recovery from any zoom level:** Source recovery is available at every zoom level. At Z1-Z2, the learner must first select an object (which zooms to Z3+), then recover. At Z4-Z5, recovery is one click away.

---

## 13. List ledger

### 13.1 Ledger purpose

The list ledger is not a fallback. It is a synchronized, keyboard-navigable representation of the same world with the same semantics. Every spatial encoding has a column equivalent.

### 13.2 Ledger layout

The ledger is a panel that slides in from the left side of the viewport, taking 40% of the viewport width (desktop) or the full viewport (mobile). It contains:

**Tabs:**
- **Objects:** All `InquiryObject` records in the active lens, sorted by kind, then by title.
- **Relations:** All `InquiryRelation` records, sorted by type, showing from/to object titles.
- **Routes:** All `Route` records, expandable to show steps.
- **Placements:** All `SpatialPlacement` records, showing object, geometry, semantics.
- **Frontiers:** All open-question and unsupported-claim entries.
- **Genealogy:** Chronological list of genealogy-event objects (visible when genealogy-event objects exist).
- **Snapshots:** All snapshot objects with metadata.

### 13.3 Ledger columns

Columns are determined by the active lens's `ledgerColumns` field. The renderer maps each column key:

| Column key | Cell content |
|---|---|
| `id` | Stable ID, monospace, truncated to last segment |
| `kind` | Kind glyph + label |
| `title` | Object title, clickable (selects object on canvas and pans camera) |
| `authorship` | Authorship label + color indicator |
| `reviewState` | Review state label + style indicator |
| `provenance` | Count of provenance records; expandable to show locator summaries |
| `relations` | Count of incoming + outgoing relations; expandable to show relation type, direction, and connected object |
| `placement` | Geometry summary (x, y or "not placed") + semantics summary |
| `rationale` | The `rationale` text from the most recent `AuthoringEvent` for this object |

### 13.4 Ledger-canvas synchronization

- Selecting a row in the ledger selects the corresponding object on the canvas (if placed) and pans the camera to it.
- Selecting an object on the canvas scrolls the ledger to the corresponding row and highlights it.
- Filtering the ledger (by kind, authorship, review state, or tag) applies the same filter to the canvas: non-matching objects render at 20% opacity.
- Sorting the ledger does not change canvas positions. The ledger and canvas are independent representations of the same data.

---

## 14. Desktop and mobile layouts

### 14.1 Desktop (1440x900 and wider)

```
+-------------------------------------------------------+
| [Lens picker] [Legend] [Ledger] [Route HUD]   [Search]|
|-------------------------------------------------------|
|                                                  |Insp.|
|                                                  |ector|
|           Atlas Canvas (remaining space)         |     |
|                                                  |     |
|                                                  |     |
|                                                  |     |
|              [Breadcrumb trail]                  |     |
| [Minimap]                            [Route HUD bar]  |
+-------------------------------------------------------+
```

- Toolbar: top, full width, 48px height.
- Canvas: fills remaining space.
- Inspector: right panel, 320px width, slides in when an object is selected. Canvas resizes.
- Ledger: left panel, 40% width (max 560px), slides in on toggle. Canvas resizes.
- Minimap: bottom-right, 200x150px, overlays the canvas.
- Route HUD: bottom bar, 48px height, overlays the canvas. Appears only during route traversal.
- Breadcrumb: bottom-left, overlays the canvas, above the minimap.
- Source panel: right side, replaces inspector, 400px width.

### 14.2 Mobile (390x844 and narrower)

```
+-------------------+
| [Lens] [Leg] [Led]|
|-------------------|
|                   |
|   Atlas Canvas    |
|   (full width)    |
|                   |
|                   |
| [Minimap toggle]  |
| [Breadcrumb]      |
| [Route HUD]       |
+-------------------+
```

- Toolbar: top, compressed. Lens picker is a single icon that opens a sheet. Legend and Ledger are icon-only buttons.
- Canvas: full viewport below toolbar.
- Inspector: bottom sheet, slides up from the bottom, takes 60% of viewport height. Drag handle to resize. Drag down to dismiss.
- Ledger: full-screen overlay, slides in from the left. Close button to dismiss.
- Minimap: collapsed by default. Toggle button at bottom-right.
- Route HUD: bottom bar, 56px height (taller touch target). Swipe left/right to advance/retreat route steps.
- Source panel: full-screen overlay, slides in from the right.
- Object selection: Tap to select. Long-press to multi-select.
- Pan/zoom: Standard touch gestures.

### 14.3 Breakpoints

| Width | Layout |
|---|---|
| >= 1024px | Desktop layout |
| 600-1023px | Tablet: desktop layout but inspector and ledger are overlays instead of resizing panels |
| < 600px | Mobile layout |

---

## 15. Visual hierarchy and encoding legend

### 15.1 Color encoding

When `colorMeans` is `authorship`:

| Authorship | Fill | Border accent |
|---|---|---|
| Source-derived | `hsl(40, 8%, 96%)` (warm off-white) | `hsl(40, 12%, 70%)` |
| Editorial | `hsl(215, 15%, 95%)` (cool slate tint) | `hsl(215, 25%, 60%)` |
| Learner-authored | `hsl(170, 14%, 94%)` (teal tint) | `hsl(170, 30%, 55%)` |
| Procedural-candidate | `hsl(35, 20%, 94%)` (amber tint) | `hsl(35, 35%, 60%)` dashed |

When `colorMeans` is `review-state`:

| State | Fill | Border |
|---|---|---|
| Accepted | `hsl(145, 10%, 95%)` | Solid `hsl(145, 20%, 65%)` |
| Proposed | `hsl(45, 12%, 95%)` | Dashed `hsl(45, 25%, 60%)` |
| Draft | `hsl(0, 0%, 96%)` | Dotted `hsl(0, 0%, 70%)` |
| Rejected | `hsl(0, 15%, 95%)` | Dashed `hsl(0, 30%, 60%)` |
| Corrected | `hsl(210, 12%, 95%)` | Double `hsl(210, 20%, 60%)` |
| Superseded | `hsl(0, 0%, 96%)` | Faded `hsl(0, 0%, 80%)` |

When `colorMeans` is `object-kind`:

Each kind has a subtle tint based on a 18-step hue ring. All fills remain below 15% saturation and above 92% lightness to avoid the AI slop palette. Borders use the same hue at 25% saturation and 60% lightness. The kind glyph provides redundant encoding for color-blind accessibility.

When `colorMeans` is `none`:

All objects use `hsl(40, 5%, 96%)` fill with `hsl(40, 8%, 75%)` border.

### 15.2 Size encoding

When `sizeMeans` is `constant`: all objects are 180x48px.

When nonconstant, the scalar is read from the object's data:
- `source-coverage`: count of `derived-from` relations where this object is `from` endpoint.
- `evidence-count`: count of `supports` + `objects-to` relations involving this object.
- `learner-attention`: count of `AuthoringEvent` records where this object is referenced.
- `abstraction-level`: mapped from `conceptRole`, `claimRole`, or kind hierarchy (source-shard=1, example=2, concept=3, mechanism=4, claim=5).
- `uncertainty`: count of provenance records with confidence `contested` or `not-assessed`.

The scalar is linearly mapped to a size multiplier range of [0.7, 1.8]. Objects at the minimum have a floor of 126x34px; objects at the maximum have a ceiling of 324x86px. The mapping function and range are displayed in the legend.

### 15.3 Typography

| Element | Font | Size | Weight | Color |
|---|---|---|---|---|
| Region title | System sans-serif | 18px | 600 | `hsl(0, 0%, 15%)` |
| Room title | System sans-serif | 14px | 600 | `hsl(0, 0%, 20%)` |
| Object title | System sans-serif | 13px | 500 | `hsl(0, 0%, 20%)` |
| Object body (inspector) | System sans-serif | 14px | 400 | `hsl(0, 0%, 25%)` |
| Relation label | System sans-serif | 11px | 400 | `hsl(0, 0%, 40%)` |
| Road name | System sans-serif | 11px | 500 | `hsl(0, 0%, 35%)` |
| Legend text | System sans-serif | 12px | 400 | `hsl(0, 0%, 30%)` |
| Provenance text | System monospace | 12px | 400 | `hsl(0, 0%, 35%)` |
| Breadcrumb | System sans-serif | 12px | 400 | `hsl(215, 30%, 45%)` (clickable) |
| Minimap label | System sans-serif | 8px | 500 | `hsl(0, 0%, 25%)` |

No decorative fonts. System stack only: `-apple-system, BlinkMacSystemFont, "Segoe UI", system-ui, sans-serif`. Monospace for provenance: `"SF Mono", "Cascadia Code", "Fira Code", ui-monospace, monospace`.

### 15.4 Spacing

- Object-to-object minimum gap: 16px at default zoom.
- Region padding: 24px interior.
- Room padding: 16px interior.
- Road clearance from objects: 8px minimum.
- Inspector panel padding: 16px all sides.
- Ledger row height: 36px.
- Toolbar height: 48px desktop, 56px mobile.

### 15.5 Relation edge rendering

| Relation type | Stroke style | Color | Arrow |
|---|---|---|---|
| `derived-from` | Solid 1.5px | Warm gray `hsl(40, 8%, 60%)` | Arrow to source shard |
| `answers` | Solid 1.5px | Slate `hsl(215, 15%, 55%)` | Arrow to question |
| `raises` | Dashed 1.5px | Amber `hsl(35, 20%, 55%)` | Arrow to question |
| `defines` | Solid 1.5px | Neutral `hsl(0, 0%, 55%)` | Arrow to concept |
| `motivates` | Dotted 1.5px | Warm `hsl(25, 15%, 55%)` | Arrow to target |
| `builds-intuition-for` | Wavy 1.5px | Teal `hsl(170, 15%, 50%)` | Arrow to target |
| `exemplifies` | Dashed 1.5px | Green `hsl(145, 15%, 50%)` | Arrow to target |
| `supports` | Solid 2px | Green `hsl(145, 20%, 50%)` | Arrow to claim |
| `objects-to` | Solid 2px | Red `hsl(0, 20%, 50%)` | Arrow to target |
| `tensions-with` | Zigzag 1.5px | Orange `hsl(25, 25%, 50%)` | Double arrow |
| `operationalizes` | Solid 1.5px | Blue `hsl(215, 20%, 50%)` | Arrow to concept |
| `precedes` | Solid 1px | Gray `hsl(0, 0%, 65%)` | Arrow in order direction |
| `influences` | Dashed 1.5px | Purple `hsl(270, 15%, 55%)` | Arrow to target |
| `contains` | None (containment is spatial) | N/A | N/A |
| `learner-associates` | Dotted 1px | Teal `hsl(170, 10%, 60%)` | No arrow |

Edge labels are shown on hover/focus. At Z1-Z2 zoom, edges are not individually rendered; only road paths are visible. Edges appear at Z3+.

Candidate relations (`reviewState: "proposed"` or `"draft"`) render with 50% opacity and a "candidate" label suffix.

---

## 16. Motion continuity

### 16.1 Principles

- Every motion has a semantic reason logged in the transition system.
- No motion is purely decorative.
- All durations respect `prefers-reduced-motion`.

### 16.2 Transition catalog

| Transition | Duration | Easing | Reduced-motion fallback |
|---|---|---|---|
| Pan to object | 300ms | ease-out-quart | Instant jump |
| Zoom level change | 400ms | ease-out-quart | Instant jump |
| Room expand | 300ms | ease-out-quart | Instant expand, no push animation |
| Room collapse | 250ms | ease-out | Instant collapse |
| Lens switch | 200ms crossfade | ease-out | Instant switch |
| Object appear (lens/filter change) | 150ms fade-in | ease-out | Instant appear |
| Object disappear (lens/filter change) | 100ms fade-out | ease-out | Instant disappear |
| Proximity re-layout | 400ms | ease-out-quart | Instant re-position |
| Size re-scale | 300ms | ease-out | Instant re-scale |
| Inspector panel slide | 200ms | ease-out | Instant appear |
| Ledger panel slide | 200ms | ease-out | Instant appear |
| Route step advance | 300ms (same room) / 500ms (cross-room) | ease-out-quart | Instant jump |
| Genealogy overlay toggle | 200ms | ease-out | Instant toggle |
| Selection highlight | 100ms | linear | Instant highlight |
| Source panel open | 250ms | ease-out | Instant open |

### 16.3 Interruption

Any transition can be interrupted by a new user action. The interrupted transition completes to its current interpolation point (no rubber-banding), and the new transition begins from there.

---

## 17. Manual-v0 authoring workflow

### 17.1 Purpose

The Atlas must be authorable by hand before procedural generation exists. The manual-v0 format (contract section 6) is the authoring substrate.

### 17.2 Authoring steps

1. **Create a dataset file:** A JSON file conforming to `InquiryManualV0`. The author writes `objects`, `relations`, `lenses`, `routes`, `placements`, and `events` by hand.
2. **Assign stable IDs:** Following the contract's ID conventions: `concept:meltdown:1`, `source-shard:meltdown:b-010`, etc.
3. **Write placements:** Each object gets a `SpatialPlacement` with `geometry: { kind: "point", x: N, y: N }` and explicit `semantics`. The coordinate system is world-space with (0,0) at the focus question. Positive x is right; positive y is down.
4. **Declare a lens:** The author writes a `ViewLens` with all legend fields filled. The lens declares which object kinds and relation types are visible, and what every encoding means.
5. **Write routes:** The author creates `Route` objects with ordered steps, instructions, and exit checks.
6. **Record events:** Every authoring action is logged as an `AuthoringEvent` with rationale.

### 17.3 Renderer obligations for manual-v0

- The renderer must not re-layout manual-v0 placements. It reads coordinates directly.
- If an object has no placement for the active lens, it appears in the ledger but not on the canvas. The ledger marks it as "not placed."
- If a relation connects two objects where one is not placed, the relation appears in the ledger but not as a canvas edge. The ledger marks it as "partially placed."
- The renderer validates that every placed object has `semantics` fields. Missing semantics is a rendering error shown in the console and in the ledger's "Warnings" section.

### 17.4 Manual-v0 coordinate conventions

For the Machinic Synthesis example dataset:
- Focus question at `(0, 0)`.
- Source shards arranged left of the focus question, ordered by `precedes` relations: `b-009` at `(-2, 0)`, `b-010` at `(-1, 0)`, etc.
- Derived concepts and mechanisms placed above or below the source shards they derive from.
- Open questions placed at the right edge, near the frontier.
- Each unit of distance is approximately 240px at default zoom (enough for one object plus gap).

---

## 18. Procedural generation boundaries

### 18.1 What procedural generation may do

- Propose `SpatialPlacement` records for objects that have no manual placement, using the active lens's declared `proximityMeans`.
- Propose `Route` objects based on `precedes` and `derived-from` relation chains.
- Propose `inquiry-room` boundaries around clusters of objects sharing a `contains` relation.
- Propose `open-question` objects based on gaps in the relation graph (missing `answers` endpoints for focus questions).

### 18.2 What procedural generation must not do

- Move learner-locked placements.
- Create `accepted` relations without an `AuthoringEvent`.
- Use embedding distance as a placement input.
- Infer importance, mastery, recommendation, or prerequisite from source order, co-occurrence, or navigation patterns.
- Generate source text.

### 18.3 Procedural output marking

- All procedurally generated objects have `authorship: "procedural-candidate"` and `reviewState: "proposed"`.
- All procedurally generated placements have `provenance` with `kind: "algorithmic-derivation"`.
- The renderer must visually distinguish procedural candidates (amber tint, dashed authorship strip) from editorial and source-derived objects.
- A "Review candidates" action in the toolbar shows only procedural candidates, with accept/reject controls.

### 18.4 Regeneration behavior

When source hashes change and the pipeline regenerates:
1. Source-derived objects are recreated from the new Reader IR.
2. Manual-v0 editorial objects are preserved via the editorial layer.
3. Learner-locked placements are preserved.
4. New procedural candidates appear at proposed placements.
5. Conflicting objects (old locator points to removed source) are flagged with a "conflict" badge and listed in the ledger's "Conflicts" section.
6. The `GenerationManifest` records all additions, removals, and conflicts.

---

## 19. Data queries

### 19.1 Queries the Atlas renderer must support

| Query | Input | Output | Used by |
|---|---|---|---|
| **Objects for lens** | `lensId` | `InquiryObject[]` filtered to `ViewLens.objectKinds` | Canvas rendering |
| **Relations for lens** | `lensId` | `InquiryRelation[]` filtered to `ViewLens.relationTypes` | Edge rendering |
| **Placements for lens** | `lensId` | `SpatialPlacement[]` filtered to `lensId` | Object positioning |
| **Routes for lens** | `lensId` | `Route[]` filtered to `lensId` | Road rendering, route HUD |
| **Object by ID** | `objectId` | `InquiryObject` | Inspector |
| **Relations for object** | `objectId` | `InquiryRelation[]` where `from.id` or `to.id` matches | Inspector relations section |
| **Provenance chain** | `objectId` | `Provenance[]` from the object, plus transitive provenance from `parentIds` | Source recovery |
| **Source locator resolve** | `SourceLocator` | Source text content (Reader IR block, graph record, archive source, or manual-v0 pointer) | Source panel |
| **Objects in region** | `regionId` | `InquiryObject[]` connected by `contains` relations from the region | Region rendering |
| **Objects in room** | `roomId` | `InquiryObject[]` connected by `contains` relations from the room | Room expansion |
| **Route steps resolved** | `routeId` | `RouteStep[]` with resolved `InquiryObject` and `SpatialPlacement` for each step | Route traversal |
| **Genealogy events** | `lensId` | `InquiryObject[]` where `kind === "genealogy-event"`, plus `precedes` and `influences` relations | Genealogy overlay |
| **Frontier objects** | `lensId` | `InquiryObject[]` where `kind === "open-question"` and `questionStatus` is `open`, `blocked-by-missing-source`, or `deliberately-open` | Frontier rendering |
| **Search objects** | `query: string` | `InquiryObject[]` where `title` or `body` contains the query (case-insensitive substring) | Search feature |
| **Unsupported claims** | `lensId` | `string[]` from `ViewLens.unsupportedClaims` | Legend, frontier overlay |
| **Authoring events for object** | `objectId` | `AuthoringEvent[]` where event references the object | Inspector history |
| **Snapshot restore** | `snapshotId` | Full workspace state: objects, relations, placements, routes, lens, camera position | Snapshot feature |

### 19.2 Query performance expectations

- All queries except search and provenance chain should complete in under 16ms for datasets of up to 500 objects and 2000 relations (one frame budget).
- Search may take up to 100ms.
- Provenance chain traversal (following `parentIds`) may take up to 50ms for chains up to 10 levels deep.
- Source locator resolution may involve async I/O (reading Reader IR); the UI must show a loading state during resolution.

---

## 20. Accessibility

### 20.1 Keyboard operation

All interactions listed in section 11.3 are keyboard-accessible. No interaction requires a mouse.

### 20.2 Screen reader support

- The canvas is an ARIA `application` region with a descriptive label: "Atlas of Inquiry: [lens name]."
- Each object is a focusable element with `role="button"` and an `aria-label` composed of: kind label, title, authorship, review state. Example: "Concept: Deleuze and Guattari schizoanalysis, source-derived, accepted."
- Regions and rooms are `role="group"` with `aria-label` including title and entry question.
- Camera transitions announce the destination: "Navigated to Region: Machinic Synthesis."
- Room expansion announces: "Expanded room: [title]. Contains [N] objects."
- Route step advancement announces: "Step [N] of [total]: [instruction text]."
- The legend panel, inspector, and ledger are standard ARIA landmarks.

### 20.3 Color independence

- Every color encoding has a redundant non-color encoding: kind glyph, authorship strip pattern (solid/dashed), review state border style, and text labels.
- The encoding legend includes text descriptions alongside color swatches.
- Edge relation types use distinct stroke styles (solid, dashed, dotted, wavy, zigzag) in addition to color.

### 20.4 Reduced motion

- All animations respect `prefers-reduced-motion: reduce`.
- Fallback behavior for each transition is specified in section 16.2.
- No flashing, parallax, or looping animation exists in the Atlas.

### 20.5 Touch targets

- All interactive elements have a minimum touch target of 44x44px on mobile.
- Object selection targets expand to 44x44px on mobile even if the object renders smaller.
- Minimap click target is the entire minimap area, not individual elements.

---

## 21. Edge cases

### 21.1 Empty states

| Condition | Behavior |
|---|---|
| No objects for active lens | Canvas shows centered text: "No objects match the current lens. Switch lenses or add objects." Ledger shows the same message. |
| No placements for active lens | Ledger populates normally. Canvas shows: "Objects exist but have no spatial placement in this lens. Use the ledger to inspect them." |
| No routes for active lens | Route picker shows: "No routes available." Route HUD is hidden. |
| No genealogy events | `G` key has no effect. Toolbar button is disabled with tooltip: "No genealogy events in this dataset." |
| Focus question has no answers | The focus question object shows a frontier indicator. The ledger's Frontiers tab lists it. |

### 21.2 Conflict states

| Condition | Behavior |
|---|---|
| Object references removed source | Object renders with a "broken link" icon overlay. Inspector shows: "Source locator points to [locator summary], which is no longer available. Source hash mismatch." Ledger Conflicts section lists the object. |
| Placement references nonexistent object | Placement is ignored. Ledger Warnings section lists: "Placement [id] references missing object [objectId]." |
| Route step references nonexistent object | Step is rendered as a gap in the road with a "missing step" marker. Route HUD shows: "Step [N]: object not found." |
| Two objects share the same placement coordinates | Both render with a 50% offset (8px horizontal) and a "collision" badge. Ledger Warnings section lists both objects. |
| Lens references nonexistent focus question | Lens renders without a focus question landmark. Legend shows: "Focus question not found in dataset." |

### 21.3 Performance edge cases

| Condition | Behavior |
|---|---|
| > 500 objects in a single lens | Enable viewport culling: only render objects whose placements fall within the viewport plus 200px bleed. Off-viewport objects are rendered as simplified dots at Z1-Z2 zoom. |
| > 50 relations for a single object | Inspector Relations section paginates: first 20 shown, "Show all [N]" button. Canvas edges for this object render only the 10 strongest (by relation type priority). |
| > 10 routes | Route picker shows a scrollable list. Only the active route renders on-canvas. |

---

## 22. Success and failure criteria

### 22.1 Success criteria

1. **Source recoverability.** From any object at any zoom level, the learner can reach the authored source passage within 3 interactions (select, open provenance, click locator).
2. **Semantic inspectability.** For every spatial encoding (position, size, color, containment, edge), the learner can discover what it means within 1 interaction (open legend or hover the legend entry).
3. **Encoding switchability.** The learner can change proximity, size, and color encoding within 2 interactions (open legend, select dropdown) and see the result immediately.
4. **List-ledger parity.** Every object, relation, route, placement, frontier, and snapshot visible on the canvas has a corresponding row in the list ledger with the same semantic information.
5. **Route traversal.** The learner can complete a route from start to end, reading each instruction, inspecting each object, and recovering source at each step.
6. **Orientation within 30 seconds.** A learner arriving at a new Atlas can identify: the focus question, the major regions, the available routes, and the frontier areas within 30 seconds of loading.
7. **Keyboard completeness.** Every interaction achievable by mouse is achievable by keyboard.
8. **Mobile usability.** All features are usable at 390x844. Inspector, ledger, and source panel use full-screen sheets. Touch targets meet 44px minimum.
9. **No unlabeled edges.** Every rendered edge has a relation type, label text, and evidence pointer accessible on hover/focus.
10. **No embedding geography.** No object position is determined by embedding similarity. Every position is manual, declared-semantic procedural, or learner-locked.

### 22.2 Failure criteria

The Atlas fails if any of these are true:

1. An object exists on the canvas with no path to its source material.
2. A spatial encoding is active without a legend entry explaining it.
3. The list ledger omits objects, relations, or semantic information present on the canvas.
4. A procedural-candidate object is rendered identically to an accepted object.
5. Force layout determines object positions.
6. Decorative elements (terrain, weather, particles, biomes) exist that do not encode inspectable inquiry state.
7. A route is presented as a recommendation or mastery path rather than an authored traversal plan.
8. An `influences` or `supports` relation exists without evidence provenance.
9. The minimap uses color as the sole encoding for any status.
10. Camera motion occurs without a semantic reason logged in the transition system.

---

## 23. Walkthroughs: Machinic Synthesis

These three walkthroughs use the concrete Meltdown/Machinic Synthesis dataset from the contract (section 7). They demonstrate the Atlas at work, not as a diagram.

### 23.1 Walkthrough A: Orientation

**Scenario.** A learner opens the Atlas for the first time with the `lens:manual-v0:machinic-atlas` lens active. They want to understand the shape of the Machinic Synthesis inquiry space before reading anything closely.

**Step 1: World overview (Z1).** The Atlas loads at the world overview zoom level. The learner sees:
- One region outline: the Machinic Synthesis source room, containing all placed objects.
- The focus question landmark at the center: "What is Machinic Synthesis doing in Meltdown?" rendered at 1.5x size with a double border and `?` glyph.
- Four source shards to the left of the focus question, arranged in source sequence (`b-009` through `b-012`).
- Derived objects (concept, intuition, motivation, mechanism, tension, claim) clustered around `b-010`.
- One open-question object ("What should the reader do with tractor fields?") at the right edge with hatched background, marking the frontier.
- One road: the Machinic Synthesis orientation route, drawn as a path from the focus question through source shards, concept, and back to the open question.
- The minimap in the bottom-right shows the full layout as a compact rectangle.
- The legend panel is closed but accessible via `?`.

**Step 2: Read the legend.** The learner presses `?`. The legend panel opens, showing:
- Position: "Manual-v0 editorial placement around the focus question."
- Proximity: "same-source and compare-now only; no generic similarity."
- Size: "constant."
- Color: "authorship and review-state."
- The learner now knows that nearby objects share a source, not a generic "relatedness."

**Step 3: Identify authorship.** The learner notices the color encoding. Source shards have warm gray fills (source-derived). The concept has a warm gray fill too (source-derived via concept anchor). The mechanism has an amber tint with a dashed authorship strip (procedural-candidate, proposed). The learner can immediately distinguish what comes from the text versus what is an editorial or procedural interpretation.

**Step 4: Spot the frontier.** The open question at the right edge has hatched background. The learner tabs to it and reads: "What should the reader do with tractor fields?" Status: open. The learner knows this is an unresolved area of the inquiry, not hidden content.

**Step 5: Start a route.** The learner presses `R`, sees the single available route: "Machinic Synthesis orientation route" (6 steps, editorial). They click it. The camera pans to step 1 (the focus question), and the route HUD appears at the bottom: "Step 1/6: Start with the editorial question; do not treat the route as a personalized recommendation."

**Orientation complete.** Within 30 seconds, the learner has identified the focus question, the source material layout, the authorship of each object, the frontier, and a guided traversal. They have not yet read any source text.

### 23.2 Walkthrough B: Tracing one conceptual development

**Scenario.** The learner wants to understand how the concept "schizoanalysis" develops from its source anchor through editorial interpretation to a candidate mechanism. They want to trace the authored chain and recover the source at each step.

**Step 1: Select the concept.** The learner clicks "Deleuze and Guattari: schizoanalysis" (the `concept:meltdown:1` object). The inspector panel slides in from the right, showing:
- Kind: concept (model-part).
- Authorship: source-derived. Review state: accepted.
- Body: "Source-derived concept anchor for the schizoanalysis machinery used in this unit."
- Provenance: 1 record. Kind: source-range. Locator: `reader-ir`, `work:meltdown`, `u-07-machinic`, `conceptId: 1`, pages 2-3. Confidence: source-stated. Quote policy: not-copied.
- Relations:
  - `derived-from` -> `source-shard:meltdown:b-010` (accepted, source-derived).
  - `motivates` <- `motivation:meltdown:annotation:6:why-schizoanalysis` (accepted, editorial).
  - `operationalizes` <- `mechanism:manual-v0:machinic:diagrammatic-immanence` (proposed, procedural-candidate).

**Step 2: Recover the source.** The learner clicks the provenance entry. The source panel opens on the right, showing the Reader IR locator summary for concept anchor 1 in unit `u-07-machinic`. The transform reads: "manual-v0 concept anchor locator." The confidence is source-stated. The quote policy shows "not-copied," telling the learner the exact text is available in the Reader but was not embedded here. The main canvas dims to 70%.

**Step 3: Follow the derivation.** The learner closes the source panel and clicks the `derived-from` relation to `source-shard:meltdown:b-010`. The camera pans to `b-010`. The inspector updates to show the source shard: "Source shard locator for the main Machinic Synthesis paragraph." The learner clicks its provenance to recover the actual source block. They see: locator `b-010`, unit `u-07-machinic`, page 2.

**Step 4: Trace the motivation.** Back on the concept, the learner clicks the `motivates` relation from `motivation:meltdown:annotation:6:why-schizoanalysis`. The camera pans to the motivation object. Inspector shows: "Why schizoanalysis matters here." Body: "Motivation derived from annotation 6 rationale fields: the reference locates the passage in Land's compressed map of philosophy, cybernetics, political economy, and theory-fiction." Provenance points to annotation 6. The learner clicks the provenance and sees the commentary-rationale locator: annotation 6, rationale field "note."

**Step 5: Inspect the candidate mechanism.** The learner returns to the concept (via breadcrumb or selection history `H`) and clicks the `operationalizes` relation from `mechanism:manual-v0:machinic:diagrammatic-immanence`. The camera pans to the mechanism object. The inspector shows:
- Authorship: procedural-candidate. Review state: proposed. The amber tint and dashed authorship strip are visible.
- Body: "Editorial candidate mechanism: diagrams, parts-with-whole composition, and immanent circuits are treated as explanatory machinery."
- Assumptions: "The mechanism label is an editorial reading, not a source-stated causal law."
- Variables: links to `concept:meltdown:1` and `intuition:manual-v0:machinic:parts-with-whole`.
- Steps: links to `source-shard:meltdown:b-010`.

The learner now sees the complete authored chain: source text -> source-derived concept anchor -> editorial motivation from commentary -> candidate mechanism assembling concept + intuition + source passage. Every link carries provenance and declared confidence. The mechanism is explicitly marked as a candidate, not an accepted fact.

**Step 6: Note the tension.** The learner sees the `tensions-with` relation from `tension:meltdown:annotation:7:top-down-vs-diagrams` to the mechanism. They click it. The tension object reads: "Top-down order versus diagrammatic immanence." Status: productive. The learner understands that this tension is not a bug to resolve but a deliberate friction preserved in the Atlas.

**Tracing complete.** The learner has followed one conceptual development from source anchor through editorial interpretation to candidate mechanism, recovering the source at each step. The chain is: source passage (b-010) -> concept anchor (schizoanalysis) -> motivation (annotation 6) -> candidate mechanism (diagrammatic immanence) -> tension (top-down vs. diagrams). Every link is labeled, every authorship is visible, and every candidate is marked.

### 23.3 Walkthrough C: Comparing two adjacent concepts

**Scenario.** The learner wants to compare the source-derived concept "schizoanalysis" with the editorial intuition "parts with, not into, a whole" to understand how the editorial reading relates to the source-derived concept anchor.

**Step 1: Multi-select.** The learner clicks `concept:meltdown:1` ("Deleuze and Guattari: schizoanalysis"), then `Shift+Click` on `intuition:manual-v0:machinic:parts-with-whole` ("Parts with, not into, a whole"). Both objects gain highlight rings. The inspector switches to comparison mode.

**Step 2: Read the comparison.** The comparison table shows:

| Field | Schizoanalysis | Parts with, not into, a whole |
|---|---|---|
| Kind | concept (model-part) | intuition (contrast) |
| Authorship | source-derived | editorial |
| Review state | accepted | accepted |
| Tags | deleuze, guattari, schizoanalysis | intuition, immanence |
| Shared relations | Both relate to `source-shard:meltdown:b-010` | |
| Unique relations | `derived-from` b-010; `motivates` from annotation 6; `operationalizes` from mechanism | `builds-intuition-for` mechanism |

**Step 3: Inspect the proximity encoding.** The learner opens the legend and checks: proximity means `same-source`. Both objects are placed near `b-010` because they both derive from or relate to the same source passage. The proximity is not claiming they are "the same idea" - it is claiming they share a source.

**Step 4: Inspect the connection.** The concept and the intuition both connect to the candidate mechanism via different relation types: `operationalizes` (mechanism operationalizes the concept) and `builds-intuition-for` (intuition builds intuition for the mechanism). The learner sees that the intuition is not a weaker version of the concept; it serves a different epistemic role. The concept is a source-derived anchor; the intuition is an editorial reading aid.

**Step 5: Switch the proximity encoding.** The learner opens the legend panel's proximity dropdown and switches from `same-source` to `shared-mechanism`. The Atlas re-layouts: now the concept and intuition move closer together (both relate to the same mechanism), while `b-010` and `b-011` move further apart (they share a source but not a mechanism). The learner sees how the same objects rearrange under a different spatial claim.

**Step 6: Check in the ledger.** The learner opens the list ledger (`Ctrl+Shift+L`). They filter to show only `concept` and `intuition` kinds. Two rows appear. Each row shows: ID, kind, title, authorship, review state, provenance count, relation count, placement semantics. The placement column for the intuition reads: `(x: -0.5, y: 1), proximity: shared-mechanism (modified from lens default: same-source)`. The learner confirms the spatial encoding matches the ledger record.

**Step 7: Recover both sources.** The learner clicks the concept's provenance link: concept anchor in unit `u-07-machinic`, pages 2-3. Then they navigate back and click the intuition's provenance link: source range for block `b-010`, page 2. Both trace to the same Machinic Synthesis paragraph, but the concept points to the concept anchor (a source-declared entity) while the intuition points to the passage itself (an editorial reading of the passage). The distinction is preserved in the provenance: `createdBy: "source"` vs. `createdBy: "editor"`.

**Comparison complete.** The learner has compared two adjacent objects, discovered their different epistemic roles (source-derived anchor vs. editorial reading aid), traced their shared mechanism connection, switched the spatial encoding to see a different arrangement, confirmed ledger parity, and recovered the source for both. The Atlas did not collapse these into a "related concepts" bucket; it preserved the distinction between derivation from source and editorial interpretation.

---

## 24. Component anatomy summary

| Component | Owns | Data reads | User events emitted |
|---|---|---|---|
| **AtlasCanvas** | Viewport, camera state, zoom level, pan position | All placements, all objects, all relations for active lens | `camera-transition`, `object-click`, `region-click`, `room-click`, `canvas-pan`, `canvas-zoom` |
| **ObjectNode** | Single object rendering, kind glyph, color fill, size, border, authorship strip | One `InquiryObject`, one `SpatialPlacement`, `colorMeans`/`sizeMeans` from lens | `select`, `hover`, `focus` |
| **RegionBoundary** | Region outline, title, entry question, boundary rule tooltip | One `inquiry-region` object, contained object placements | `region-enter`, `boundary-hover` |
| **RoomContainer** | Collapsed/expanded state, internal object layout, push animation | One `inquiry-room` object, contained objects and placements | `room-expand`, `room-collapse`, `room-enter`, `room-exit` |
| **RoadPath** | Route polyline, step markers, direction arrows, road name label | One `Route`, resolved step placements | `route-start`, `route-advance`, `route-retreat`, `route-exit` |
| **FrontierMarker** | Hatched background, status icon, unsupported claim overlay | `open-question` objects, `ViewLens.unsupportedClaims` | `frontier-inspect` |
| **LegendPanel** | Legend field display, encoding dropdowns, "modified" indicator | Active `ViewLens.legend`, current encoding overrides | `encoding-switch` |
| **InspectorPanel** | Object detail, provenance list, relation list, placement info, tags | Selected `InquiryObject`, its relations, its provenance, its placement | `provenance-click`, `relation-click`, `tag-filter` |
| **ComparisonPanel** | Multi-object table, shared/unique relations | 2-5 selected `InquiryObject`s and their relations | `compare-in-ledger` |
| **LedgerPanel** | Tabbed list view, column rendering, filtering, sorting | All objects/relations/routes/placements/frontiers/genealogy/snapshots for active lens | `ledger-row-click`, `ledger-filter`, `ledger-sort` |
| **SourcePanel** | Source text display, locator resolution, transform/confidence display | Resolved `SourceLocator` content | `source-close` |
| **RouteHUD** | Active route bar, step display, navigation controls | Active `Route`, current step index | `route-advance`, `route-retreat`, `route-exit`, `route-step-jump` |
| **GenealogyOverlay** | Time axis, leader lines, influence/precedes arrows | `genealogy-event` objects, `precedes`/`influences` relations | `genealogy-toggle`, `time-axis-hover` |
| **Minimap** | Compressed world view, viewport rectangle, landmark labels | All placements, landmarks, active route, frontiers | `minimap-click`, `minimap-drag` |
| **Breadcrumb** | Camera history trail | Camera state stack | `breadcrumb-click` |
| **LensPicker** | Lens dropdown, lens metadata display | All `ViewLens` records for the workspace | `lens-switch` |
| **SearchOverlay** | Search input, results list | All objects (title + body search) | `search-select` |
| **Toolbar** | Layout container for lens picker, legend toggle, ledger toggle, search, route picker, genealogy toggle | UI state only | Delegates to child components |

---

## 25. Inspectable and switchable semantics: size, proximity, containment, roads

This section consolidates the inspectability and switchability contract for the four major spatial semantics. Every encoding is a claim about the data. Every claim is inspectable (the learner can ask "what does this mean?") and switchable (the learner can change what it means and see the result).

### 25.1 Proximity

| Value | What it means | How objects are arranged | Inspect action | Switch cost |
|---|---|---|---|---|
| `same-source` | Objects sharing a source shard are near each other | Cluster by shared `derived-from` endpoints | Hover gap between objects: tooltip says "proximity = same source: both derive from [source title]" | Re-layout: 400ms animation |
| `compare-now` | Objects placed for active comparison | Learner-arranged; no algorithmic constraint | Tooltip: "proximity = compare-now: learner-placed for comparison" | No animation (positions are learner-locked) |
| `shared-mechanism` | Objects connected to the same mechanism are near | Cluster by shared `operationalizes` or `builds-intuition-for` endpoints | Tooltip: "proximity = shared mechanism: both relate to [mechanism title]" | Re-layout: 400ms animation |
| `evidence-neighborhood` | Objects sharing evidence are near | Cluster by shared `supports` or `objects-to` endpoints | Tooltip: "proximity = evidence neighborhood" | Re-layout: 400ms animation |
| `historical-descent` | Objects ordered by genealogical time | Left-to-right or top-to-bottom by `temporal` fields | Tooltip: "proximity = historical descent: [date/order]" | Re-layout: 400ms animation |
| `learner-grouping` | Learner placed them here | No algorithmic constraint | Tooltip: "proximity = learner grouping" | No animation |
| `prerequisite-route` | Objects ordered by route dependency | Along the active route path | Tooltip: "proximity = prerequisite route: step [N] before step [M]" | Re-layout: 400ms animation |
| `unresolved-frontier` | Open questions cluster at edges | Open questions pushed to periphery; answered questions stay central | Tooltip: "proximity = unresolved frontier" | Re-layout: 400ms animation |

### 25.2 Size

Every size encoding maps a scalar to the [0.7, 1.8] multiplier range. The legend shows the mapping function and range endpoints.

- Inspect: hover any object and see a tooltip: "size = [sizeMeans]: [value] ([scalar description])."
- Switch: legend dropdown. Size change animates over 300ms.

### 25.3 Containment

Containment is rendered as spatial nesting (objects inside region/room boundaries). The boundary meaning is declared by `containmentMeans`:
- `room-membership`: object is in this room's working set.
- `source-scope`: object derives from the same source scope.
- `mechanism-module`: object is part of the same mechanism.
- `argument-group`: object is in the same argument cluster.
- `learner-pile`: learner grouped these together.

Inspect: click the room/region boundary to see the `boundaryRule` text and the `containmentMeans` value. Switch: not switchable per-object (containment is structural). To see a different containment, switch the lens.

### 25.4 Roads

Roads are traversal records, not decorative paths. Each road declares:
- `Route.title`: the road's name.
- `Route.authorship`: who created it.
- `Route.focusQuestionId`: what question the road addresses.
- Each `RouteStep`: order, instruction, exit check.

Inspect: click the road name label to see title, authorship, focus question, step count. Click a step marker to see the instruction and exit check. Switch: activate a different route via the route picker. Only one route renders at a time (others are available in the picker). Comparing routes renders both paths simultaneously with distinct colors.

---

*End of Atlas of Inquiry design brief.*
