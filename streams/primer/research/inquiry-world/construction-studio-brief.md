# Construction Studio brief

## Product position

Construction Studio is a desktop learner-authoring environment in which organizing is the learning act. A learner handles recoverable source shards, holds ambiguity in provisional piles, names groups, draws room boundaries, completes typed relation sentences, builds mechanisms and matrices, lays routes, and publishes immutable versions of what they have made.

It is one renderer and authoring surface over the canonical `Workspace` in `inquiry-world-contract.md`. It does not define a second document model. Every durable object, relation, placement, group, matrix, cell, route, snapshot, artifact, and ledger row is a shared-contract record; every durable change passes through an exact `AuthoringEvent` variant and increments the workspace revision. Atlas of Inquiry and Argument World can open the result without conversion.

The first implementation is the 1440 × 900 desktop surface described here. This brief contains no current mobile component or acceptance requirement.

## What the studio is—and is not

The studio is a coherent workshop: materials arrive on a source table; the learner spreads them across one continuous floor; provisional boundaries can harden into rooms; constructions remain beside the materials that license them; saved states can be compared like two versions pinned side by side.

It is not Trello with epistemic labels. Piles are not backlog columns and objects do not advance through a status pipeline. It is not Figma with graph handles. Free-form position has no intrinsic truth, connector lines cannot remain untyped, and visual polish is subordinate to recoverable meaning. It is not a dashboard: no metric cards, activity panels, completion percentages, streaks, points, badges, mastery scores, quests, avatars, or decorative terrain.

System assistance may notice contract violations, surface missing evidence, or create visibly procedural candidates. It does not finish a learner's sentence, infer understanding, manufacture relationships, or provide the answer to its own challenge.

## Design DNA

### Aesthetic direction: a serious working table

- **Material, quiet, and inspectable.** A warm neutral floor, paper-like source shards, graphite learner marks, bookplate-like editorial marks, and dashed procedural candidates. No glass effects, gradients, neon graph glow, or nested card chrome.
- **One field, not a panel pile.** The floor is the dominant surface. The source table, tool shelf, inspector, and ledger are edges of the same workspace and collapse when not needed.
- **Constructive ambiguity.** An untidy pile is legitimate evidence of thinking. Its boundary is soft and incomplete until the learner titles it and states why the members are being held together.
- **Authorship before status.** Source, editorial, learner, and system provenance are visible on every material before review state. Color is never the only distinction.
- **Public construction.** The natural culmination is a citable `learner-artifact` and immutable `Snapshot`, not a congratulatory screen.

### Token plan for implementation

Use the host product's existing token names and primitives. If a required semantic token is absent, add the minimal alias at the design-system layer rather than hardcoding values in components.

| Role | Required semantic token behavior |
| --- | --- |
| Studio floor | tinted neutral canvas with enough contrast for room boundaries |
| Source material | neutral paper surface plus solid source stripe and locator footer |
| Editorial material | restrained bookplate glyph plus editorial stroke |
| Learner material | warm graphite/umber stroke plus explicit “learner” text |
| Procedural candidate | cool dashed stroke plus “system candidate” text |
| Accepted / proposed / draft / rejected / corrected / superseded | distinct text and border patterns; never color-only |
| Focus | high-contrast double ring outside the object boundary |
| Motion | named fast/standard durations with ease-out-quart; no bounce |

Type hierarchy is compact and editorial: workspace/focus question, room title, object title, body, provenance/locator. Spacing uses the existing scale. Room and pile shapes are modestly rounded; source cards remain nearly square. Shadows indicate physical overlap only, never importance.

## Canonical construction grammar

The learner moves through a reversible grammar rather than a prescribed funnel:

```text
recoverable source shards + visible source ambiguities
  → provisional AuthoredGroup piles
  → named/promoted AuthoredGroup records
  → inquiry-room boundaries and typed contains relations
  → typed InquiryRelation sentences
  → mechanism / Matrix + complete MatrixCell set / Route
  → immutable Snapshot + learner-authored public artifact
  → the same Workspace opened in Atlas or Argument World
```

The learner may step down to sources at any stage, fork an alternative, reject a candidate, or restore an earlier snapshot into a new revision. Nothing requires every pile to become a room or every room to become an artifact.

### 1. Source shards and ambiguity piles

`source-shard` cards are immutable source-derived `InquiryObject`s. Their display can be folded, but source identity, body, locator, authorship, and source provenance cannot be edited in Studio. “Recover source” opens the canonical `SourceLocator` in context and preserves the floor position and selection.

Lassoing or keyboard-grouping selected cards opens a small in-place pile label—not a modal. Before committing, the learner supplies:

- a title (an explicitly temporary title is allowed),
- a `groupKind`, initially usually `provisional-pile`,
- a rationale answering “why hold these together now?”,
- a `promotionTarget`, initially often `none`, and
- authorship/review state (`learner-authored`, usually `draft`).

Commit creates an `AuthoredGroup` with stable ID and nonempty provenance through `AuthoringEvent.type: "create"` with `record.kind: "group"`. Moving another card across its boundary previews membership; dropping commits an `update` event whose `before` hash and replacement `DurableRecord<"group">` identify the same group. Mere overlap does nothing durable. Proximity means `learner-grouping` only when the active placement semantics say so; it never creates an `InquiryRelation`.

A source-assignment discrepancy or interpretive ambiguity is shown on the pile edge and in the ledger, not normalized away. The system may ask, “Are these together because the source places them together, because you want to compare them, or because you suspect a mechanism?” It supplies no selection or answer.

### 2. Authored groups and reversible promotion

A pile can become a second, promoted `AuthoredGroup` through a `transform` event with `transform: "pile-to-group"`. The original provisional group remains in event history; the output group has its own stable ID, rationale, inherited provenance, explicit `groupKind`, status, and promotion target.

Available group kinds are exactly the contract values:

- `provisional-pile`
- `comparison-set`
- `mechanism-candidates`
- `tension-set`
- `learner-hypothesis`

Promotion is reversible in the historical sense, not destructive mutation. The learner may reject a reviewable group using `AuthoringEvent.type: "reject"`, or promote it with `type: "promote"`; both use a valid `RecordChange` and preserve the prior content hash. Undo applies the inverse as a new event rather than deleting history. System candidates remain `procedural-candidate` / `proposed` until the learner promotes, corrects, or rejects them. Rejection is retained so the same unsupported suggestion is not silently regenerated.

### 3. Rooms

Promoting a group to a room uses a single `transform` event with `transform: "group-to-room"`. Its input includes the source `group` record; outputs include:

- an `InquiryObject` of kind `inquiry-room`,
- one legal `contains` relation per admitted member,
- the room `SpatialPlacement` with `geometry.kind: "rect"`, and
- any required member placement updates for room-local geometry.

The room requires a title, an existing `focus-question` or `open-question` as its `entryQuestionId`, a plain-language `boundaryRule`, and an optional `exitArtifactId`. Each `contains` relation carries the learner's boundary rationale as evidence; containment never follows from coordinates.

A room expands in place on the floor. Its header contains the entry question; its boundary footer states the rule; a frontier shelf holds open, contested, blocked, or not-yet-collected work; its exit edge shows the current artifact slot. Cross-room relations remain visible as labeled doors/threads, so rooms do not become isolated tabs.

The system challenges boundaries without resolving them: “Which member fails this rule?”, “Is this boundary source scope or your current working frame?”, “What would belong just outside?” The learner can revise the room through `update`, create a corrected alternative, or restore a prior arrangement from a snapshot.

### 4. Typed relation sentence completion

Dragging from an object relation handle to another object opens an inline sentence between the endpoints. Keyboard users invoke the same editor from the command shelf. Endpoint kinds filter the menu to legal `InquiryRelation` variants.

The learner completes a proposition such as:

- “This motivation **motivates** that concept because …”
- “This intuition **builds intuition for** that mechanism by …”
- “This mechanism **operationalizes** that concept through …”
- “This tension **tensions with** that mechanism over …”
- “This source shard **raises** that open question because …”
- “This evidence **supports** that claim as [direct / co-premise / warrant / background] because …”

Save is disabled until the record has legal typed endpoints, readable label, authorship, review state, confidence, nonempty provenance, and nonempty evidence. Causal relations additionally require `causalBasis` and conditions; influence, support, identity, dependency, and source-derived relations obey all contract evidence invariants. There is no generic `related`, no unlabeled wire, and no relation inferred from proximity.

Commit uses `AuthoringEvent.type: "create"`, `record.kind: "relation"`. Editing uses `update` with the prior versioned ref. A system-suggested edge arrives only through `candidate-create`, stays dashed and proposed, and can be promoted, corrected, or rejected by a learner event. The system can say “A support relation needs evidence that licenses the inference”; it cannot author the missing inference.

### 5. Step up and step down the ladder of abstraction

Step-down is source recovery and discrimination, not zoom decoration:

```text
public artifact → route/matrix/mechanism → mechanism step or relation
→ concept/claim/example/intuition → source shard → exact SourceLocator
```

Each step names the destination level in the breadcrumb and announces it. A step down that only changes focus/camera is transient view state. If the learner authors a new lower-level object, it is a durable create or legal transform.

Step-up creates a new authored interpretation while leaving its parents intact:

- shard → concept or claim: `transform: "shard-to-concept"` or `"shard-to-claim"`
- selected claims → argument structure: `"claims-to-argument"`
- examples → mechanism: `"examples-to-mechanism"`
- events → genealogy: `"events-to-genealogy"`
- claims and sources → matrix: `"claims-sources-to-matrix"`
- route → snapshot: `"route-to-snapshot"`

Before commit, the promotion preview lists input record IDs, all output durable records, inherited provenance, learner-authored rationale, and claims the operation does **not** establish. This prevents abstraction from laundering an interpretation into source fact.

### 6. Mechanisms

A mechanism is an `InquiryObject` of kind `mechanism`, not a decorative flow diagram. Its construction rail exposes exactly:

- `variableIds`, resolved to workspace objects,
- ordered, nonempty `stepIds`,
- explicit `assumptions`,
- related examples/intuition/claims through legal typed relations, and
- causal basis and conditions on any `causes`, `enables`, or `inhibits` relation.

Examples promoted through `examples-to-mechanism` produce a mechanism and any explicitly chosen typed relations as output records in one `transform` event. The learner can reorder steps by drag or keyboard; persistence is an `update` to the mechanism. Expanding a step descends to its object and provenance. Two mechanism snapshots can be compared without overwriting either.

System challenges are interrogative and source-safe: “Which step does explanatory work?”, “Is this causal or only sequential?”, “Which assumption is learner-authored?”, “What counterexample would narrow the mechanism?” No challenge includes a proposed answer.

### 7. Matrices and cells

A matrix is the shared contract `Matrix`; every coordinate is a shared contract `MatrixCell`. The builder has typed row and column shelves whose members are `{kind, id}` references allowed by each `MatrixAxis.allowedKinds`. The learner names each axis and writes its rationale.

Creating a claims × sources comparison uses `AuthoringEvent.type: "transform"` with `transform: "claims-sources-to-matrix"`. Outputs include the `Matrix` and the complete Cartesian product of `MatrixCell` records. There are no sparse implicit cells. Each cell has exactly one state:

- `present` with nonempty evidence refs,
- `absent-by-review` with named reviewed source versions,
- `not-yet-collected` with a collection need,
- `contested` with both supporting and contesting refs,
- `not-applicable` with an applicability rule.

Every cell also carries evidence, rationale, authorship, review state, and provenance. “Absent by review” never means false, and an untouched pairing starts as an explicit `not-yet-collected` record—not a blank. Changing a cell uses an `update` event on `record.kind: "matrix-cell"`. The spatial cell and ledger row are two synchronized controls over the same ID.

A cell may seed a new tension, evidence, counterexample, or open question only through a previewed create/transform with provenance inherited from the matrix, cell, and referenced sources. The matrix never invents a relationship by crossing two axes.

### 8. Routes

A route is the contract `Route`: a titled, authored, reviewable sequence tied to a focus question and lens. Each `RouteStep` has order, object ID, optional typed relation ID, instruction, and optional exit check. Ordering cards on the route shelf previews steps; commit creates or updates the route via an `AuthoringEvent`.

Routes are authored traversals, not recommendations, assignments, or mastery paths. Unresolved items may be included with explicit instructions such as “inspect why this remains open.” Alternate routes can coexist. In Atlas they render as roads; in Argument World they render as critique/evidence traversals; in Studio they remain manipulable step strips.

### 9. Immutable snapshots, comparison, and public artifacts

A `Snapshot` is an immutable workspace-owned durable record, never an `InquiryObject` wrapper and never mutable UI state. Capture includes the contract fields directly: lens hashes and encoding overrides, camera and breadcrumb, filters, route state, source versions, frontiers, versioned placements/groups/matrices, ledger hash, selections, and learner claim IDs.

Creation uses `AuthoringEvent.type: "create"` with `record.kind: "snapshot"`, or `transform: "route-to-snapshot"`. A revised capture gets a new stable ID. Snapshot records cannot be updated, promoted, rejected, removed, or overwritten.

“Compare snapshots” pins two resolved states side by side in the floor's comparison bay. A center gutter shows the contract `WorkspaceDiff`: added, removed, changed, unchanged, and conflicted records across objects, relations, placements, groups, matrices, cells, routes, ledger order, source versions, and snapshots. Filters switch among structural, authorship, provenance/source-version, and interpretation changes. Selecting a diff row focuses the same record in both sides; missing records retain an explicit gap. Restore creates a `restore-snapshot` event with new records and surfaced `Conflict[]`; it never rolls workspace history backward.

Publishing creates a learner-authored `learner-artifact` with `artifactKind: "public-artifact"` (or the appropriate map/model/comparison kind), title, body, audience, parent IDs, and complete provenance through a `create` event. The publication references an immutable snapshot and preserves unresolved frontiers, source versions, and rejected alternatives in its lineage. “Public” means citable and inspectable, not automatically uploaded.

## Provenance and authorship rules

Every constructed output carries a nonempty provenance chain. A learner transform must:

1. retain relevant source-range or commentary-rationale provenance from each input;
2. append an `authoring-event` provenance item pointing to the learner `AuthoringEvent.id`;
3. preserve input IDs through the event and appropriate `parentIds` on output objects;
4. preserve source versions in snapshots and matrices where referenced;
5. keep system candidate provenance and limitations when corrected or rejected; and
6. expose “recover source” at every derived object, relation, cell, route step, and artifact.

Authorship is explicit and visually redundant:

| Authorship | Surface treatment | Required wording |
| --- | --- | --- |
| `source-derived` | solid source stripe, locked body, locator footer | “source-derived” |
| `editorial` | bookplate mark, solid editorial stroke | “editorial” |
| `learner-authored` | graphite/umber authored stroke | “learner-authored” |
| `procedural-candidate` | dashed cool stroke | “system candidate — proposed” |

A `source` actor may appear in provenance but never authors learner events. The system may append only `deterministic-import`, `candidate-create`, `candidate-update`, and `sync-ledger` as allowed by the contract. Learner and editor promotions do not rewrite a candidate's origin.

## Direct desktop implementation anatomy (1440 × 900)

### Spatial shell

```text
┌────────────────────────────────────────────────────────────────────────────┐
│ 48 top rail: workspace / focus / lens legend / undo / compare / publish   │
├──────────────┬───────────────────────────────────────────────┬─────────────┤
│ 256 source   │                                               │ 320 context │
│ table        │            continuous studio floor            │ inspector   │
│              │   piles · rooms · constructions · routes      │ / challenge │
│ collapsible  │                                               │ collapsible │
├──────────────┴───────────────────────────────────────────────┴─────────────┤
│ 40 ledger handle; expanded ledger replaces lower 320 px of the floor      │
└────────────────────────────────────────────────────────────────────────────┘
```

The top rail and side edges are restrained tools around the floor, not independent dashboards. Opening source context replaces the inspector; it does not create another panel. The challenge view is a mode within the inspector, not a parallel feed.

### Component/data boundaries

| Component | Contract records rendered | Durable actions |
| --- | --- | --- |
| `StudioFloor` | active-lens `SpatialPlacement[]`, objects, relations, groups, matrices, routes | delegates create/update/remove/transform; transient pan/selection is not persisted until snapshot |
| `SourceTable` | source-derived objects, candidates, unplaced ledger records | placement create/update; source recovery; candidate promote/reject |
| `StudioCard` | one `InquiryObject` plus placement and provenance | object/placement update, legal transform initiation |
| `PileBoundary` | one `AuthoredGroup` plus member placements | group create/update/promote/reject; pile-to-group transform |
| `RoomBoundary` | `inquiry-room`, `contains` relations, local placements | group-to-room transform; room/relation/placement updates |
| `RelationSentence` | one draft or proposed `InquiryRelation` | relation create/update/promote/reject |
| `MechanismRail` | mechanism object and resolved variable/step IDs | examples-to-mechanism transform; mechanism update |
| `MatrixBoard` | one `Matrix` and its complete `MatrixCell[]` | matrix/cell create or update through exact events |
| `RouteStrip` | one `Route` and resolved steps/relations | route create/update; route-to-snapshot transform |
| `SnapshotCompare` | two `Snapshot`s and a resolved `WorkspaceDiff` | snapshot create; restore-snapshot |
| `SourceContext` | resolved `SourceLocator` and transform/confidence | no source mutation |
| `ContextInspector` | selected record, provenance, review state, event history | exact record update/promote/reject/remove where legal |
| `ChallengeMode` | validation issues, unsupported claims, procedural candidates | focus, park locally, or explicit candidate reject; never auto-answer |
| `Ledger` | canonical `Workspace.ledger` rows and columns | same commands/events as floor plus deterministic `sync-ledger` |

### Floor behavior

- **Drag.** Pointer capture begins only from a move handle, not selectable text. During drag, a ghost and prospective semantic result appear. Drop first previews the placement/group change; commit appends the exact event. Escape cancels. Learner-locked placements cannot be moved by procedural layout.
- **Group.** Shift-select or lasso, then `G`, opens the in-place pile label. Boundary membership, title, intent, rationale, and provenance are keyboard editable.
- **Resize.** Resize handles remain hidden until selection. First durable resize requires choosing `sizeMeans`; `constant` disables semantic resize. Commit updates the `SpatialPlacement.geometry` and semantics together. Size never silently means importance.
- **Connect.** `E` starts edge mode from the focused object; searchable legal targets and relation types are announced. Sentence, evidence, and review fields must be complete before save.
- **Room entry.** Enter expands the focused room in place; Escape returns to its parent floor. The breadcrumb states world → room → object → source.
- **Source recovery.** `O` opens the focused record's locator context. Derived wording remains beside source wording with authorship labels; no quotation is synthesized.
- **Undo/redo.** Operates on authoring events and creates an auditable inverse/new event. Snapshots remain immutable.

### Inspector and challenge states

The inspector has one record header, body, typed fields, provenance chain, evidence, source recovery, event history, and available legal actions. It never hides candidate status behind an icon.

A system challenge has: question, affected record IDs, why it was raised, missing contract evidence/field if applicable, and actions “show records,” “show source,” “park,” or “reject candidate.” It has no answer field, score, success animation, or “fix for me.” Examples:

- “What makes this a mechanism rather than a sequence?”
- “Which reviewed source version licenses ‘absent by review’?”
- “Does the room boundary describe source scope or a learner frame?”
- “What evidence licenses this influence claim?”
- “What would make these two examples stop belonging together?”

### Explicit interface states

- **Loading:** floor skeleton preserves shell geometry; announce workspace loading; no fake cards.
- **Empty workspace:** offer “Open source table” and “Create focus question,” not metrics.
- **No placed records:** ledger remains populated; floor explains that records need authored placement.
- **Validation error:** keep the draft visible, focus the first illegal field, and preserve learner text locally until corrected or parked.
- **Source conflict:** show locator/hash conflict in card, inspector, diff, and ledger; never substitute new text silently.
- **Disabled:** control includes a textual reason, such as “Choose size meaning before resize.”
- **Candidate:** dashed and explicitly proposed; never visually conflated with accepted material.
- **Snapshot compare:** both sides are read-only; restoration is a separate labeled action.

## List-ledger parity

The ledger is a semantic peer, not an accessibility fallback. Every semantic workspace record has exactly one canonical `LedgerRow`: objects, relations, placements, groups, matrices, every matrix cell, routes, and snapshots. The active lens declares columns; rows expose IDs, semantic kind, authorship, review state, provenance, endpoints, placement semantics, rationale, matrix state, source version, route order, and frontier status as applicable.

Selecting a floor object focuses its row. Selecting a row focuses its floor representation or says “not placed” without inventing coordinates. Editing a group member list, relation sentence, matrix cell, route order, or placement from the ledger dispatches the same `AuthoringEvent` constructor as the tactile path. The resulting semantic event is followed by the contract `sync-ledger` event with `causedByEventId`; the renderer never maintains a second ledger schema.

Ledger parity includes operations, not only visibility:

- create/update/reject/promote a group;
- create a room and inspect its `contains` relations;
- complete or revise a typed edge sentence;
- reorder mechanism steps or route steps;
- set every matrix cell state and evidence;
- create, compare, and restore snapshots;
- recover every source locator.

## Keyboard, screen reader, and reduced motion

### Keyboard map

| Key | Action |
| --- | --- |
| `Tab` / `Shift+Tab` | move through top rail, source table, floor objects, inspector, and ledger |
| Arrow keys | move spatial focus; with move mode active, nudge placement on the declared grid |
| `Space` | add/remove focused record from selection |
| `Enter` | open focused object/room or commit the active inline editor |
| `Escape` | cancel drag/edge/edit, exit source context, or step out of room |
| `G` | group current selection into a provisional pile |
| `E` | start typed edge sentence from focused object |
| `R` | resize focused placement after choosing size semantics |
| `[` / `]` | step down / step up abstraction |
| `O` | recover source for focused record |
| `M` | open matrix builder for selection |
| `T` | start or edit a route from selection |
| `S` | create a named immutable snapshot |
| `D` | open side-by-side snapshot comparison |
| `Ctrl+Shift+L` | open/close ledger without losing floor focus |
| `Ctrl+Z` / `Ctrl+Shift+Z` | event-based undo/redo |

All focusable materials use semantic elements and concise labels containing kind, title, authorship, and review state. Live announcements describe meaning-bearing results: “Created learner-authored provisional pile with four members,” “Relation not saved: evidence is required,” “Stepped down from mechanism to source shard b-010,” and “Matrix cell set to not yet collected.” Drag has no mouse-only information.

With `prefers-reduced-motion: reduce`, room expansion, pile regrouping, semantic camera movement, snapshot comparison, and source recovery use an instant state change plus a short opacity crossfade. Focus moves to the destination and the breadcrumb/live region names it. No parallax, spring, elastic, or continuous pulsing is permitted.

## Shared-world interoperability

Studio does not “export cards” into renderer-specific formats. It writes the shared `Workspace`:

- **Open in Atlas** selects or creates a `ViewLens` whose prototype is `atlas-of-inquiry`; rooms, placements, routes, groups, frontiers, snapshots, and learner artifacts remain the same IDs. The Atlas may render routes as roads and rooms as cartographic regions without changing their records.
- **Open in Argument World** selects or creates an `argument-map` / `evidence-matrix` lens over the same claims, evidence, objections, mechanisms, tensions, relations, matrices, cells, routes, and snapshots. Only legal inferential relations appear as argument edges; learner grouping never becomes support.
- **Return to Studio** preserves learner locks, source versions, event history, ledger order, matrix completeness, and snapshot IDs. Renderer-only camera state is durable only when captured in a `Snapshot`.

Lossless external publication uses the contract `InquiryExport` and `GenerationManifest`, preserving workspace revision, hashes, records, event IDs, provenance, rejected candidates, conflicts, and unsupported claims.

## Three Machinic walkthroughs using retained IDs

All body descriptions below are interface labels or paraphrases. Source text is recovered from the real Reader IR locators; the walkthroughs do not invent quotations or relations.

### Walkthrough 1 — preserve ambiguity, then author a room

**Starting records:**

- `focus-question:meltdown:u-07-machinic:what-is-machinic-synthesis`
- `source-shard:meltdown:b-009`
- `source-shard:meltdown:b-010`
- `source-shard:meltdown:b-011`
- `source-shard:meltdown:b-012`

1. The source table shows the four shards in source order. The learner opens `b-009`; the context view states that it begins the Machinic Synthesis heading paragraph while its stored unit is `u-07-opening`. The discrepancy remains visible.
2. The learner places `b-009` and `b-010` near one another. The preview says “placement only; no relation.” They select both and press `G`.
3. They create an `AuthoredGroup` titled “Opening boundary to inspect,” `groupKind: "provisional-pile"`, `status: "provisional"`, `promotionTarget: "inquiry-room"`, with a learner rationale that explicitly preserves the unit-boundary uncertainty. A `create` event writes the group and a `sync-ledger` event establishes parity.
4. The system asks, “Does the room include b-009 because of source assignment, heading continuity, or your working comparison?” It supplies no answer. The learner keeps the discrepancy in the boundary rule.
5. `pile-to-group` creates a promoted comparison set without overwriting the pile. `group-to-room` then outputs a room, legal `contains` relations for the chosen members, and declared room-local placements. The entry question is the retained focus question ID.
6. From the ledger, the learner removes `b-009` from a forked alternative room and compares both boundaries. Canvas and ledger create the same update events. Both constructions retain `b-009` provenance and the ambiguity rationale.

**Observable result:** a real ambiguity becomes an inspectable learner-authored boundary decision, not a silently cleaned source hierarchy. No typed epistemic relation was inferred from proximity or containment.

### Walkthrough 2 — build and challenge a mechanism without accepting the system's reading

**Starting records:**

- `concept:meltdown:1`
- `intuition:manual-v0:machinic:parts-with-whole`
- `mechanism:manual-v0:machinic:diagrammatic-immanence`
- `tension:meltdown:annotation:7:top-down-vs-diagrams`
- `source-shard:meltdown:b-010`
- `rel:meltdown:intuition-parts:builds-intuition-for:mechanism`

1. Authorship marks distinguish the source-derived concept, editorial intuition and tension, and proposed procedural mechanism. The accepted relation label states only that the contrast helps inspect the candidate mechanism.
2. The learner presses `[` on the mechanism. Focus descends to its step IDs and then to `b-010`; source context opens at the retained locator. The proposed mechanism remains visibly procedural and does not become source wording.
3. The learner presses `]` from selected examples/intuition and previews `examples-to-mechanism`. The preview lists inputs, the new learner mechanism output, variables, ordered steps, assumptions, inherited `prov:meltdown:b-010`, and a new authoring-event provenance item.
4. The system asks, “Which step is causal, and which is an editorial ordering?” It does not suggest a step or causal basis. The learner records the construction as a noncausal mechanism unless they can supply a legal causal relation with evidence.
5. They complete a typed sentence from `tension:meltdown:annotation:7:top-down-vs-diagrams` to the new mechanism using `tensions-with`, a readable label, and source-backed evidence. Save creates the relation; a nearby placement by itself does not.
6. They snapshot before and after revising an assumption. Side-by-side diff shows the changed mechanism hash, unchanged source shard and concept, added learner relation, and unchanged proposed system mechanism.

**Observable result:** the learner authors explanatory structure while the studio keeps source, editorial aid, learner hypothesis, and procedural candidate distinct. The challenge sharpens judgment without answering it.

### Walkthrough 3 — complete a matrix, author a route, and publish across worlds

**Starting records:**

- `claim:meltdown:annotation:8:compression-curve`
- `source-shard:meltdown:b-010`
- `source-shard:meltdown:b-011`
- `source-shard:meltdown:b-012`
- `open-question:manual-v0:machinic:tractor-fields`
- `route:manual-v0:machinic-orientation`
- `focus-question:meltdown:u-07-machinic:what-is-machinic-synthesis`

1. The learner selects the claim and three shards and invokes the matrix builder. `claims-sources-to-matrix` previews one `Matrix` plus every row × column `MatrixCell` output.
2. The learner marks only a reviewed, licensed pairing `present` with an evidence reference. Unreviewed pairings are explicit `not-yet-collected` cells with collection needs. They cannot choose `absent-by-review` without naming nonempty reviewed `SourceVersion`s and rationale.
3. The system asks, “Which source version did you inspect?” and “Is this absence, or have you not collected it?” It does not choose a state. The complete matrix validates and appears identically in the ledger.
4. The learner forks `route:manual-v0:machinic-orientation` into a learner-authored route that visits the focus question, the claim, the contested or unknown cells, and `open-question:manual-v0:machinic:tractor-fields`. The final exit check asks the learner to distinguish source evidence, editorial interpretation, and unresolved question; it does not claim the question is answered.
5. `route-to-snapshot` creates an immutable snapshot containing the active route hash/step, lens and camera, filters, source hashes, frontiers, complete matrix references, placements, ledger hash, selection, and learner claim IDs.
6. Publishing creates a learner `public-artifact` with the snapshot and matrix/route lineage. “Open in Atlas” renders the route as a road and the open question as a frontier. “Open in Argument World” renders the claim/evidence projection and the same matrix cells. IDs, authorship, review states, provenance, and unresolved status do not change.

**Observable result:** a complete, source-honest comparison becomes a citable learner artifact that round-trips through the shared workspace rather than being flattened into an image or renderer-local board.

## Desktop acceptance gates

1. At 1440 × 900, the source table, continuous floor, context inspector, and ledger can be used without document-level horizontal scrolling. Large matrices own local scroll.
2. The three Machinic walkthroughs complete end to end through pointer/tactile controls and through list-ledger/keyboard controls, producing equivalent exact `AuthoringEvent` variants.
3. Every durable action round-trips through `InquiryWorldApi.applyEvent`; workspace validation confirms IDs, endpoint kinds, relation evidence, matrix Cartesian completeness, immutable snapshots, declared geometry, ledger parity, and event preconditions.
4. A provisional pile is an `AuthoredGroup`; promotion preserves the original history and uses `pile-to-group` or `group-to-room` as applicable. No pile silently creates relations.
5. Relation edges cannot persist without legal endpoint kinds, a typed relation, sentence label, authorship, review state, confidence, provenance, and evidence.
6. Mechanisms expose variables, nonempty ordered steps, assumptions, source recovery, and the distinction between causal and noncausal structure.
7. Every matrix coordinate has one explicit contract `MatrixCellState`; unknown, contested, absent-by-review, and not-applicable are distinguishable in canvas, ledger, and screen-reader output.
8. Snapshots are immutable full `Snapshot` records. Side-by-side comparison exposes `WorkspaceDiff`, source-version changes, and conflicts. Restore creates a new event/revision.
9. Source-derived, editorial, learner-authored, and procedural-candidate records remain distinguishable without color. System challenges never contain answers or auto-promote candidates.
10. Atlas and Argument World open the same IDs and contract records without renderer-local export schemas or inferred relations.
11. Focus rings, contrast, semantic labels, Escape behavior, keyboard reachability, and reduced-motion substitutions are verified for pile, room, relation, matrix, route, source recovery, ledger, and snapshot comparison states.
12. Loading, empty, unplaced, draft-invalid, disabled, candidate, source-conflict, and snapshot-compare states are explicit and do not fabricate content.
13. There are no dashboard metrics, backlog columns, gamified progress, force layouts, generic related edges, decorative resizing, fake source text, inferred mastery, or current mobile components/gates.

Construction Studio succeeds when the learner can point to a public artifact and recover not only its sources, but the sequence of grouping, boundary, relation, matrix, route, rejection, and revision decisions through which they made it.