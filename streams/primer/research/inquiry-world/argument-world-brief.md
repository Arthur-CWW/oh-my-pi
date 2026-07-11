# Argument World: implementation brief

Argument World is a source-recoverable environment for disciplined disagreement. The current implementation target is **desktop 1440 × 900 only**. It is not a dashboard, a tab collection, a premise-tree renderer, or a generic graph with argumentative colors. It is one continuous issue-centered world in which a learner can move from why an idea arose, through how it becomes intelligible and operational, to what it claims, what licenses it, what contests it, and what remains unknown.

The canonical durable model is `inquiry-world-contract.md`. This renderer consumes and changes only `Workspace` records through `InquiryWorldApi`; it must not add position, assumption, argument-node, evidence-cell, consequence, layout, history, or selection schemas beside that contract. Renderer state is transient and must point back to canonical stable IDs.

---

## 1. Product promise and epistemic stance

The world answers nine connected questions:

1. **Issue:** What `focus-question` or `open-question` are we trying to answer?
2. **Position:** Which thesis or interpretation claims currently `answers` it?
3. **Development:** What motivation, intuition, example, historical pressure, or source sequence made each position thinkable?
4. **Mechanism:** What moving parts, steps, and stated assumptions make the account work?
5. **Formal claim:** What exactly is asserted, qualified, or hypothetical?
6. **License:** Which typed evidence and inferential relations support or contest it?
7. **Consequence:** Which downstream records depend on it through recorded relations, and which merely sit nearby?
8. **Plurality:** Where do source, editorial, learner, and procedural-candidate interpretations diverge?
9. **Recovery:** What locator, transformation, authoring event, and source version justifies every mark and edge?

A position is not a new object kind. It is a `claim` with `claimRole: "thesis" | "interpretation"` connected by `answers` to the active question. An assumption is not a new durable record: it is either a hypothetical warrant claim, a string in `mechanism.assumptions` addressed by mechanism ID plus exact array index, or a learner artifact that has not yet been promoted. A consequence is an existing claim or mechanism reached through licensed relations, never a generated sentence.

The aesthetic is an **editorial argument terrain**: a finite, quiet field of issue thresholds, position terraces, labeled inferential roads, source observation posts, objection fronts, mechanism cutaways, uncertainty frontiers, and a historical river. The metaphors are functional, not theatrical. There are no sidebars full of KPIs, global app tabs, card-grid menus, avatars, scores, damage, conquest, decorative fog, or force-directed drift.

---

## 2. One world, four coordinated grammars

Argument World is a semantic-camera hybrid rather than four applications placed in panels.

### 2.1 Camera levels

| Semantic level | Primary grammar | What occupies the world | Enter / leave |
| --- | --- | --- | --- |
| `work` | issue world | active question, all positions, interpretation territories, unresolved frontiers | Home / breadcrumb |
| `region` | argument DAG | one position and its claims, objections, development paths, source endpoints | select position / Escape |
| `room` | mechanism or comparison room | mechanism steps and assumptions, co-premise group, or two interpretations held together | Enter / Escape |
| `evidence` | typed matrix laid into the terrain | canonical `Matrix` and complete `MatrixCell` set | `E` on claim or matrix landmark |
| `source` | in-place source recovery | exact locator context and provenance chain beside the selected record | `S` / Escape |

`CameraState.semanticLevel`, `sourceGranularity`, `focusedObjectId`, and `breadcrumb` are the only durable camera vocabulary. Transitions are named: **enter argument**, **compare interpretations**, **descend to mechanism**, **audit evidence**, **recover source**, **follow genealogy**, and **widen to issue**. At reduced motion, travel becomes an immediate layout change, focus transfer, and announcement; no meaning depends on animation.

### 2.2 Persistent world composition at 1440 × 900

The document viewport does not scroll horizontally. The world surface owns pan/zoom; matrix and source passages own local overflow.

- **Question threshold, 64 px high:** the active question is physically anchored at the top edge of the world, with its status, active lens name, current source-revision conflict count, and unsupported-claim count. This is a landmark, not generic toolbar chrome.
- **World viewport, remaining height:** finite authored plane from active placements plus margin. It contains position territories, DAG roads, context objects, genealogy river, frontiers, and matrix rooms.
- **Coordinate ledger, docked 320 px when opened:** a semantic peer that overlays the right edge and reduces the world viewport. It is not always-visible dashboard chrome. `L` opens it; the selected world record and ledger row remain synchronized.
- **Source leaf, 480 px when opened:** replaces the ledger dock and unfolds beside the selected object. It is opaque, keyboard-contained while modal, Escape-closeable, and never navigates away from the world.
- **Path ribbon, 48–128 px at bottom when active:** shows a mixed-semantics developmental or critique route. It disappears when no route is active.

At 1440 × 900 the default world has at least 24 px outer breathing room, an 860–1040 px usable terrain depending on the dock, and no component that assumes a second screen. Mobile anatomy and acceptance are intentionally outside the current implementation.

### 2.3 Declared default lens

The default `ViewLens` has `prototype: "argument-world"`, `projection: "argument-map"`, and declares:

| Channel | Required `PlacementSemantics` value | Meaning |
| --- | --- | --- |
| position | `topological-layer` for the argument DAG; `room-local` inside mechanism/comparison rooms; `source-order` in source river | only the declared local grammar |
| proximity | `evidence-neighborhood` in DAG; `historical-descent` in river; `compare-now` in comparison room | never similarity or support strength |
| size | `constant` | no importance claim |
| color | `object-kind` | redundant with shape and text |
| containment | `argument-group`, `mechanism-module`, or `room-membership` | named boundary only |
| edge style | `relation-type` | redundant with full edge label |

A single placement cannot silently mix these meanings. A different local grammar requires a separate lens/placement or an explicitly entered room. Every visible lens exposes all `ViewLens.legend` fields, including what roads, rooms, and ambiguity mean. Missing or contradictory semantics are a blocking validation state, not a renderer default.

---

## 3. World ontology and mark semantics

### 3.1 Issue and position

The active issue is the focus landmark. Positions are thesis/interpretation claims reached by `answers`. Position territory is a named argument-group room only if a canonical `inquiry-room` and evidenced `contains` relations exist; otherwise the renderer draws no enclosure.

Multiple positions may answer one issue. They are arranged in manually authored order or declared topological order, never ranked by link count. Source-derived, editorial, learner-authored, and procedural-candidate records are not separate truth lanes; authorship is a visible facet that can be compared without merging records.

### 3.2 Claim, evidence, objection, and tension

| Object | Mark | Declared meaning |
| --- | --- | --- |
| claim | clipped rectangle with role label | one atomic thesis, premise, warrant, interpretation, or synthesis; modality printed |
| evidence | document-notch tile | an evidence object whose `evidenceKind` is printed; not strength by quantity |
| objection | inward-notch tile pointing toward its target | a typed challenge; `objectionKind` and target printed |
| counterexample | specimen tile with boundary mark | challenges applicability through `challenges` and/or `objects-to` only when those records exist |
| tension | two-pole bracket | unresolved/productive/adjudicated/scope-limited pressure; never automatically contradiction |
| source shard | observation-post glyph | recoverable source endpoint; opening it does not promote it to evidence for a claim |
| frontier | hatched edge with a textual reason | missing source, contested, not-yet-collected, deliberately open, or unsupported claim |

Accepted records use a solid shell, proposed/procedural candidates a dashed shell plus `candidate` text, learner-authored records a double corner mark plus `learner-authored`, and rejected/superseded records appear only when history is requested. Confidence is always text. Color is restrained and tokenized by object kind; no meaning is color-only.

### 3.3 Development objects stay outside proof

Motivation, intuition, example, mechanism, genealogy, and tension remain first-class objects.

- `motivates` says why a concept, claim, mechanism, or artifact matters or arose. It does not support truth.
- `builds-intuition-for` says an intuition/example helps a learner grasp a target. It does not entail it.
- `exemplifies` illustrates a target. It contributes inference only if a separate legal `supports` relation exists.
- `operationalizes` says a mechanism makes a concept, claim, or intuition inspectable as machinery. It participates in sandbox propagation only under the strict rule in section 7.
- `precedes` preserves source, chronology, publication, or route order. Order is not influence.
- `influences` is shown only with its `influenceScope` and evidence. Influence is not support.
- `tensions-with` preserves pressure without deciding truth.

### 3.4 Edge inventory

Every edge is an `InquiryRelation`; its visible label is `relation.label`, never a renderer abbreviation alone. On focus, it exposes relation ID, typed endpoints, relation-specific fields, authorship, review state, confidence, provenance, and nonempty evidence.

| Relation | Visual sentence | Logical propagation |
| --- | --- | --- |
| `answers` | “A answers issue Q” | no |
| `raises` | “A raises question Q” | no |
| `derived-from` | “A is derived from source S” | source recovery only |
| `defines` | “A defines concept C” | no implicit support |
| `elaborates` | “A elaborates C” | no implicit support |
| `motivates` | “M motivates A” | no |
| `builds-intuition-for` | “I builds intuition for A” | no |
| `exemplifies` / `challenges` | “E exemplifies/challenges A” | no unless a separate `supports` / `objects-to` exists |
| `contrasts-with` | “A contrasts with B” | no; symmetric meaning, one stored edge |
| `supports` | “A supports claim C as direct/co-premise/warrant/background” | yes, within licensed support DAG |
| `objects-to` | “O objects to A on truth/scope/method/interpretation” | contest overlay, never automatic falsification |
| `tensions-with` | “T tensions with A as …” | no |
| `operationalizes` | “M operationalizes A” | only when a recorded assumption toggle explicitly licenses it |
| `causes` / `enables` / `inhibits` | full causal label and basis | only in a separately declared causal/mechanism room; never inferred from the argument DAG |
| `depends-on` | “A depends on B” | prerequisite display, not automatically inferential support |
| `precedes` / `influences` / `cites` | full order/scope/role label | no argument propagation |
| `same-as` | identity scope and rationale | identity highlight only |
| `contains` | boundary membership and rationale | no |
| `learner-associates` | provisional association and rationale | no |

An edge cannot be saved without a label, exact legal endpoint kinds, provenance, and evidence. Draft creation still must satisfy the contract’s nonempty evidence invariant; “I noticed this while reading locator X” can ground a learner hypothesis, but the interface must never relabel it source-stated.

---

## 4. Motivation → intuition → mechanism → formal claim → consequence

This is a **mixed-semantics path**, not a proof ribbon. `PathInspector` resolves an existing `Route` or a transient query result over canonical records. Each segment carries one of six display families derived from its actual relation type:

- **development:** `motivates`, `precedes`, evidenced `influences`;
- **intuition:** `builds-intuition-for`, `exemplifies`, `contrasts-with`;
- **operation:** `operationalizes`, and explicit causal/mechanism relations;
- **inference:** `supports` only;
- **pressure:** `objects-to`, `challenges`, `tensions-with`;
- **source:** `derived-from`, `cites`, `defines` when used for recovery.

The persistent notice reads: **“This path mixes development, intuition, operation, inference, pressure, and source recovery. Only segments labeled support are inferential support.”**

A path can skip a missing stage. It renders `No recorded motivation`, `No recorded intuition`, `No licensed mechanism path`, or `No recorded downstream support` rather than generating a bridge. Learners may author the missing canonical object/relation, with provenance and review state, through an `AuthoringEvent`; the renderer itself supplies no prose.

A formal claim’s consequences are existing downstream claims/mechanisms reached through accepted or explicitly included proposed `supports` edges and licensed `operationalizes` edges. “Consequence” is a query role, not a durable object kind.

---

## 5. Multiple interpretations and comparison room

Comparison is spatially side-by-side under one question, not a filter that makes alternatives disappear.

1. Resolve all thesis/interpretation claims whose `answers.to.id` equals the active question ID.
2. Keep each record independent, even when titles or source locators overlap.
3. Entering comparison creates no durable state. Saving it requires a canonical `inquiry-room` or `AuthoredGroup`, placements, and `AuthoringEvent` records.
4. Cross-highlighting means exact object identity or a displayed typed relation. Shared source is shown through each claim’s `derived-from` relation or matrix cell, not by visually merging claims.
5. Conflicting support/objection edges remain separate relation records with their own authorship and evidence.
6. Corrected and superseded claims remain available in history but are never composited into the current accepted text.
7. Absence of an objection is labeled **“No recorded objection in the current projection”**, never “agreed.”

The comparison room has fixed columns for the selected interpretations and horizontal rows for: claim wording, modality, development path, mechanism, evidence cells, objections/tensions, genealogy, assumptions, and open frontiers. A missing row is an honest state, not an empty decorative slot.

---

## 6. Typed evidence matrix

The evidence room renders canonical `Matrix` and `MatrixCell` records exactly. It does not synthesize sparse cells, evidence-kind columns, author columns, or assumption strings into a second durable matrix.

### 6.1 Legal matrices

For the default claim × source matrix:

- `purpose: "evidence"`;
- row axis allows `claim` and contains typed `Endpoint<"claim">` members;
- column axis allows `source-shard` and contains typed `Endpoint<"source-shard">` members;
- order is a legal `MatrixAxis.order` value with an authored rationale;
- the cell set equals the full row × column Cartesian product.

Other legal views may use claim × evidence, claim × objection, interpretation-claim × source, or claim × mechanism only when both axes are canonical object references permitted by their `allowedKinds`. “Evidence kind,” “author,” and “assumption text” are filters/group labels over records, not axis members unless represented by canonical objects for an independently justified reason.

### 6.2 Exact cell rendering

| `MatrixCell.state.kind` | Mark and required text |
| --- | --- |
| `present` | filled square; list every `MatrixEvidenceRef`; “Evidence recorded” |
| `absent-by-review` | open square with check stroke; list `reviewedSources`; “Not found in reviewed sources; not proven false” |
| `not-yet-collected` | centered dot; print `collectionNeed`; “Not yet collected” |
| `contested` | split square; independently list supporting and contesting refs |
| `not-applicable` | diagonal slash; print `applicabilityRule` |

Every cell exposes its stable ID, row and column typed refs, rationale, authorship, review state, evidence, provenance, and recovery actions. No blank cell exists. A missing coordinate, duplicate coordinate, unresolved ref, or missing provenance is a blocking `matrix-shape`/validation error shown in place.

Selecting a claim in terrain highlights its matrix row. Selecting a cell highlights its referenced relations/evidence objects and source observation posts. Matrix sorting may use only legal axis orders and never changes epistemic state; saving a new order updates the canonical `Matrix` through an event.

---

## 7. Assumption sandbox: licensed propagation only

The sandbox is a non-mutating counterfactual view over existing records. It may suppress records/relations for inspection but cannot invent a consequence, dependency, causal edge, truth value, or revised claim.

### 7.1 Toggle targets

- a claim ID for a premise/warrant claim;
- a relation ID for `supports`;
- `{ mechanismId, assumptionIndex }` for an exact `mechanism.assumptions` entry;
- an interpretation claim ID to compare a lane.

These targets are transient. Saving the investigative state creates a canonical immutable `Snapshot` with filters, camera, selected IDs, frontiers, source versions, and layout refs. It does **not** serialize sandbox toggles as a parallel model; a learner who wants to assert a changed argument must author canonical record updates/relations through events.

### 7.2 Dependency query

1. Start with projected relations after filters.
2. Include `supports` when accepted, or proposed only after the learner explicitly enables proposed records.
3. Include `operationalizes` for a mechanism-assumption toggle only if its relation evidence or rationale explicitly names the exact mechanism assumption and target dependency. A mere edge from that mechanism is insufficient.
4. Treat `supportKind: "co-premise"` as jointly required only when the participating relations are bound by a canonical `AuthoredGroup` or `inquiry-room` with rationale. Otherwise report `co-premise grouping unresolved` and do not propagate jointly.
5. Reject the propagation subgraph if it contains a cycle; report the ordered relation IDs in the cycle and calculate no downstream state through it.
6. Traverse only directed included edges.
7. Never traverse `answers`, `derived-from`, `defines`, `elaborates`, `motivates`, `builds-intuition-for`, `exemplifies`, `challenges`, `contrasts-with`, `objects-to`, `tensions-with`, causal edges, `depends-on`, `precedes`, `influences`, `cites`, `same-as`, `contains`, or `learner-associates` as inferential support.
8. Objections add `contested by <relation IDs>`; they never output false.

### 7.3 Honest outputs

- **directly weakened:** an included incoming support/operationalization edge was toggled;
- **indirectly weakened:** reachable only through explicit included edges;
- **surviving support:** one or more independent included paths remain;
- **contested, not falsified:** one or more visible objections apply;
- **context unaffected:** developmental, intuitive, genealogical, source, or tension record;
- **no recorded propagation:** no licensed edge names the dependency;
- **calculation blocked:** cycle, missing relation evidence, unresolved endpoint, or ambiguous assumption reference.

Every row names the exact object and relation IDs used. The terrain dims toggled edges, outlines weakened claims in amber, marks surviving paths, and leaves contextual objects fully legible. Reset restores the projection without an event. No consequence prose is model-generated.

---

## 8. Historical and genealogy river

The river is embedded along the lower world edge and can be entered as a semantic-camera region. It renders canonical `genealogy-event` and `source-shard` placements only.

- Horizontal position means `temporal.date`, interval, ordered label, or declared source order according to the active placement.
- Width means interval only; otherwise constant.
- Branches require visible `influences` edges and their `influenceScope`; chronology, citation, term overlap, and similarity never create a branch.
- `precedes` edges print `orderKind`.
- Missing dates occupy a labeled **undated / ordered only** reach, not an estimated date.
- Candidate or learner-hypothesis influence is dashed and explicitly labeled; accepted chronology does not promote it.
- A tension marker can connect historical pressure to a claim/mechanism only through a legal `tensions-with` record.

Brushing a river record highlights only exact identity and typed neighboring relations in terrain. `G` follows an existing genealogy relation or reports `No recorded genealogy path`. Publication order, source sequence, and learner route are different overlays and never blended.

---

## 9. In-place source recovery

`SourceRecoveryLeaf` opens beside the selected object, relation, matrix cell, placement, route, group, or snapshot while retaining the world and selection.

It shows:

- stable record ID and semantic kind;
- every `Provenance` entry, uncollapsed;
- locator discriminant and all available fields;
- `quotePolicy`; reviewed short quote only when actually stored;
- transform, creator, created time, and confidence;
- relation evidence separately from relation provenance;
- parent IDs, source versions/content hashes, and authoring-event lineage;
- source context action for Reader IR, graph index, archive source, or manual-v0.

Honest states are exact:

| Condition | Required copy |
| --- | --- |
| locator, no loaded text | “Source range is known; text is not loaded in this projection.” |
| `quotePolicy: "not-copied"` | “Recoverable by locator; no quotation is stored.” |
| source hash changed | “Source changed since this record was authored.” |
| locator missing | “Source locator cannot be resolved. Promotion is blocked.” |
| candidate evidence | “Procedural candidate; not accepted evidence.” |
| citation-only | “Citation pointer only; this does not license inferential support.” |
| no relation | “No reviewed relation is recorded; do not infer support, opposition, or absence.” |

The leaf never fabricates excerpts, auto-scrolls to an approximate semantic match, or silently substitutes a newer source version.

---

## 10. Coordinated ledger

The canonical `Workspace.ledger` is equal in authority to the world. Each semantic record has exactly one `LedgerRow`; ephemeral sandbox-result rows reference canonical records but are visually and programmatically marked transient and never inserted into the durable ledger.

Required sections are authored `LedgerSection` records, not hard-coded storage categories. The initial Argument World lens should expose rows for questions, positions/claims, development objects, mechanisms, evidence/source shards, objections/tensions, genealogy, relations, placements, groups, matrices/cells, routes, snapshots, and frontiers where those records exist. `ViewLens.ledgerColumns` controls displayed columns.

Coordination rules:

- world selection focuses the corresponding row and all touching relation rows;
- ledger selection moves the semantic camera to the canonical placement or reports `unplaced record` when `includeUnplaced` permits it;
- matrix-cell selection focuses its exact row and referenced evidence;
- source recovery can be completed entirely from ledger rows;
- spatial and keyboard authoring invoke the same `InquiryWorldApi.applyEvent` path;
- after every semantic change, a canonical `sync-ledger` event restores parity;
- row sorting is transient; durable order changes require a ledger update event;
- a renderer that cannot provide parity must refuse the spatial change.

---

## 11. Tactile interaction grammar

| Interaction | Semantic effect | Persistence |
| --- | --- | --- |
| click / Enter object | select and inspect exact canonical record | transient |
| drag empty ground | pan at same semantic level | snapshot only if saved |
| step zoom | change `semanticLevel` and source granularity | snapshot only if saved |
| drag object | propose manual-authored `SpatialPlacement` change; rationale required before commit | `update` event; learner lock preserved |
| drag legal relation handle | preview typed edge; target filtering uses endpoint kinds | canonical relation `create` event after label/evidence |
| lasso records | select for comparison; no implied relation | transient |
| group selection | create provisional `AuthoredGroup` with title and rationale | `create` event; promotion is separate transform |
| fold group | visual collapse only; ledger members remain | snapshot layout if saved |
| open matrix cell | inspect review judgment and evidence | transient |
| toggle assumption | run licensed non-mutating propagation | snapshot only; no semantic mutation |
| follow edge | semantic camera transition named by relation | transient / snapshot camera |
| save view | immutable canonical `Snapshot` with source versions/frontiers | `create` or `route-to-snapshot` event |
| undo semantic edit | apply an explicit compensating canonical event | event history retained |

Drag previews never become durable merely on pointer-up. A compact commit strip requests relation label/rationale and provenance. Illegal drops explain the endpoint-kind rule and offer legal types without changing data.

---

## 12. Desktop component contract

```ts
type ArgumentWorldProps = {
  dataset: InquiryDataset;
  request: ProjectionRequest;
  api: InquiryWorldApi;
  dispatchEvent(event: AuthoringEvent): void;
};

type TransientArgumentState = {
  selectedRecord?: RecordRef<SemanticRecordKind>;
  comparedClaimIds: readonly StableId[];
  openSurface: "none" | "ledger" | "source" | "legend" | "matrix" | "sandbox";
  pathRelationIds: readonly StableId[];
  sandbox: {
    disabledClaimIds: readonly StableId[];
    disabledRelationIds: readonly StableId[];
    disabledMechanismAssumptions: readonly { mechanismId: StableId; assumptionIndex: number }[];
    includeProposed: boolean;
  };
};
```

`TransientArgumentState` is renderer memory only. It is never exported and every ID resolves against the current `InquiryProjection`.

### `ArgumentWorld`

Calls `api.project`, owns transient selection/open surfaces, computes no durable records, and renders one `ArgumentWorldSurface`. On projection/validation failure it renders `WorldBlocker`, not a partial misleading map.

### `QuestionThreshold`

Props: resolved focus question, answering position claims, active lens, unsupported claims, source-version conflicts. Emits selection, legend, ledger, and snapshot intents. It never displays aggregate “strength” or progress.

### `ArgumentWorldSurface`

Props: projected objects, relations, placements, groups, route, camera. Renders finite ground, records, typed edges, frontiers, river, and room portals. DOM order follows ledger/topological order; SVG/canvas marks have ledger equivalents.

### `ArgumentRecordMark`

Props: one `InquiryObject`, placement, incoming/outgoing relation IDs, selected/focused state. Exhaustive switch on `object.kind`; no default generic card. Shows kind, title, role-specific state, authorship, review state, confidence, and source availability.

### `TypedRelationRoad`

Props: one `InquiryRelation`, resolved endpoints/placements, active/disabled state. Exhaustive switch on `relation.type`; edge label is visible at normal level and a focusable text row at compact level. Never renders when endpoints/evidence fail validation.

### `MixedPathRibbon`

Props: ordered canonical object/relation IDs and relation-family derivation. Refuses discontinuous paths. Prints the non-entailment warning and missing-stage states.

### `EvidenceRoom`

Props: canonical matrix, full cells, resolved axis objects. Validates Cartesian completeness before rendering; supports roving-grid keyboard focus and local overflow. No synthesized blank cells.

### `AssumptionSandbox`

Props: canonical projection plus transient toggle set. Calls pure `querySandboxConsequences`; renders exact IDs and blocked/no-recorded states. Save delegates to canonical snapshot creation.

### `GenealogyRiver`

Props: genealogy/source objects, `precedes`/`influences`/relevant tension relations, placements. Never estimates dates or infers influence.

### `SourceRecoveryLeaf`

Props: `RecordRef`, resolved durable record, source versions, related events. Exhaustive locator display; stale/missing/no-copy states; focus returns to invoker on close.

### `CoordinatedLedgerDock`

Props: canonical ledger and record resolver. Uses the lens’s columns, exposes unplaced and invalid rows, and mirrors all selection/authoring actions.

### `LegendLeaf` and `WorldBlocker`

`LegendLeaf` reads only lens/placement semantics and names forbidden inferences. `WorldBlocker` renders `ValidationIssue[]` with affected IDs and recovery actions; it never silently drops invalid marks.

---

## 13. Exact query contract

Queries are pure projections over `InquiryProjection`; they create no durable IDs or prose.

```ts
type ArgumentPosition = {
  claim: Extract<InquiryObject, { kind: "claim" }>;
  answer: Extract<InquiryRelation, { type: "answers" }>;
};

type MixedPathStep =
  | { kind: "object"; objectId: StableId }
  | { kind: "relation"; relationId: StableId; family: "development" | "intuition" | "operation" | "inference" | "pressure" | "source" };

type SandboxResult = {
  directlyWeakened: readonly { objectId: StableId; viaRelationIds: NonEmptyArray<StableId> }[];
  indirectlyWeakened: readonly { objectId: StableId; pathRelationIds: NonEmptyArray<StableId> }[];
  survivingSupport: readonly { objectId: StableId; pathRelationIds: NonEmptyArray<StableId> }[];
  contested: readonly { objectId: StableId; objectionRelationIds: NonEmptyArray<StableId> }[];
  unaffectedContextIds: readonly StableId[];
  noRecordedPropagation: readonly { targetId: StableId; rationale: string }[];
  blocked: readonly { kind: "cycle" | "missing-evidence" | "unresolved-endpoint" | "ambiguous-assumption"; recordIds: NonEmptyArray<StableId>; detail: string }[];
};

type ArgumentWorldQueries = {
  positionsForIssue(projection: InquiryProjection, questionId: StableId): readonly ArgumentPosition[];
  mixedPaths(projection: InquiryProjection, fromId: StableId, toId?: StableId): readonly (readonly MixedPathStep[])[];
  evidenceMatrix(projection: InquiryProjection, matrixId: StableId): { matrix: Matrix; cells: readonly MatrixCell[] };
  genealogyFor(projection: InquiryProjection, objectId: StableId): { objects: readonly InquiryObject[]; relations: readonly InquiryRelation[] };
  sandboxConsequences(projection: InquiryProjection, state: TransientArgumentState["sandbox"]): SandboxResult;
  ledgerRowsFor(projection: InquiryProjection, record: RecordRef<SemanticRecordKind>): readonly LedgerRow[];
};
```

Determinism requirements:

- preserve explicit axis, route, ledger, and placement order;
- otherwise tie-break by stable ID;
- resolve endpoint kind and ID exactly;
- return an empty list plus an honest UI state when no path exists;
- never use embeddings, title similarity, citation count, proximity, or model output to complete a path;
- never mutate, promote, or create candidates during a query.

Canonical writes are only `api.applyEvent(workspace, event)`. Before dispatch the UI validates the proposed complete canonical event; after dispatch it consumes the returned `WorkspaceDiff`, then projects the new revision. Replacement uses remove plus create as the contract requires. Snapshot restore uses `api.restoreSnapshot` and surfaces every conflict.

---

## 14. Keyboard, screen reader, and motion

### Keyboard map

| Key | Action |
| --- | --- |
| Tab / Shift+Tab | move among named regions and controls |
| Arrow keys | rove within current DAG layer, matrix grid, river, or ledger section |
| Option+Arrow | move to adjacent semantic region; announcement names it |
| `+` / `-` | step semantic camera level and announce level |
| Enter | inspect/enter selected object, room, edge, or cell |
| Space | select; in sandbox only, toggle focused licensed target |
| `R` | begin typed relation creation from focused legal endpoint |
| `E` | enter evidence matrix for focused claim |
| `S` | open source recovery for focused record |
| `G` | follow recorded genealogy or announce none |
| `L` | open/close coordinated ledger |
| `[` / `]` | previous/next mixed-path step |
| Escape | cancel preview, close leaf, or rise one camera breadcrumb |
| `?` | open legend and shortcut help |

Every world region has a heading and landmark. Object announcements include kind, title, role, authorship, review state, confidence, source availability, and relation count. Relation roads are duplicated as focusable semantic rows. Matrix cells announce row, column, exact state, evidence-reference count, and rationale. Sandbox result changes use a polite live region and link to the full report; they do not announce every dimmed mark.

Focus is never lost during semantic transitions. Focus indicators and text meet WCAG AA; state is never color-only. Pointer targets are at least 44 × 44 CSS px even though the current target is desktop. Drawers have opaque surfaces and visible dimming, close with Escape, and return focus. The world has no document-level horizontal overflow.

Motion uses a named 220 ms ease-out-quart semantic transition for same-level pan and 280 ms for enter/leave. No bounce, parallax, particles, or animated edge flow. `prefers-reduced-motion: reduce` sets duration to zero, moves focus, updates the breadcrumb, and announces `Moved from <source> to <target> by <named relation/camera action>`.

---

## 15. Honest empty, unsupported, and invalid states

- **No focus question:** “Choose or author a focus question. Argument World will not render a universal claim graph.”
- **No positions:** preserve source/open-question landmarks; “No thesis or interpretation currently answers this issue.”
- **No mixed path:** “No recorded path connects these records under the current projection.”
- **No accepted evidence:** show the complete canonical matrix, including `not-yet-collected`; never hide it.
- **No matrix:** “No evidence matrix has been authored for this issue.” Offer canonical matrix authoring, not a fake empty grid.
- **Only candidates:** show dashed records and “Procedural candidates are not accepted knowledge.”
- **No recorded dependency:** sandbox result remains unknown; offer to author a typed relation.
- **Dependency cycle:** list relation IDs and block propagation through the cycle.
- **Illegal edge:** name endpoint kinds and legal relation choices; save nothing.
- **Missing relation evidence:** hide the road from the accepted layer, show validation blocker and its record ID.
- **Unresolved source:** show locator/conflict if present; never approximate or quote.
- **Incomplete matrix:** block the evidence-room visualization and list missing/duplicate coordinates.
- **Unplaced record:** keep it in the ledger and expose `includeUnplaced`; do not invent coordinates.
- **Unsupported claim:** render a `FrontierState`/lens warning with missing requirements and related IDs; do not materialize it as a claim object.
- **Changed source version:** restore/snapshot conflict remains explicit and non-destructive.

---

## 16. Three Machinic walkthroughs using canonical real IDs

These scenarios use only IDs established in the shared contract. Bodies are editorial paraphrases or locator descriptions; the UI must not invent quotations. Where the contract names a relation semantically but gives no stable relation ID, the query resolves it by exact typed endpoints and relation type and displays the stored relation’s actual ID.

### Walkthrough A — development is not entailment

1. Enter `focus-question:meltdown:u-07-machinic:what-is-machinic-synthesis`.
2. Select position `claim:meltdown:annotation:8:compression-curve` (`qualified`, editorial interpretation).
3. Open a mixed path beginning at `motivation:meltdown:annotation:6:why-schizoanalysis`.
4. The world can include `concept:meltdown:1`, `intuition:manual-v0:machinic:parts-with-whole`, and `mechanism:manual-v0:machinic:diagrammatic-immanence` only where stored typed relations connect consecutive records.
5. The known relation `rel:meltdown:intuition-parts:builds-intuition-for:mechanism` is labeled **intuition**, not inference.
6. The mechanism remains procedural-candidate/proposed; the claim remains a qualified editorial interpretation.
7. Open source recovery for `source-shard:meltdown:b-010` and `source-shard:meltdown:b-011`; show locator-only content if quotes are not stored.
8. If no licensed support path reaches the claim, the final path stage reads `No recorded inferential bridge` rather than drawing one.
9. Saving creates a snapshot of route/camera/source versions, not a new proof relation.

**Pass:** the learner can name which stages develop, illuminate, operationalize, support, or merely locate the reading. **Fail:** one arrow style makes the whole sequence look deductive.

### Walkthrough B — an assumption cannot manufacture a consequence

1. Enter mechanism `mechanism:manual-v0:machinic:diagrammatic-immanence`.
2. The mechanism cutaway lists its exact stored assumptions and the warning that its semantics are an editorial reading, not a source-stated causal law.
3. Toggle one assumption by `{ mechanismId: "mechanism:manual-v0:machinic:diagrammatic-immanence", assumptionIndex }`.
4. The query includes an `operationalizes` relation only if its stored evidence/rationale explicitly names that assumption dependency.
5. `intuition:manual-v0:machinic:parts-with-whole`, `motivation:meltdown:annotation:6:why-schizoanalysis`, `tension:meltdown:annotation:7:top-down-vs-diagrams`, and shards `source-shard:meltdown:b-009` through `source-shard:meltdown:b-012` remain context/source records.
6. If no explicit dependency reaches `claim:meltdown:annotation:8:compression-curve`, output `no recorded propagation`; do not mark the claim false or weakened.
7. If a licensed path exists in the actual workspace, list every stored relation ID and any surviving independent support path.
8. Reset changes nothing durable; Save creates an immutable snapshot with a learner rationale and unresolved frontier.

**Pass:** every changed state is derived from stored IDs and edges. **Fail:** proximity, tags, or plausible prose creates a cascade.

### Walkthrough C — interpretations coexist under historical pressure

1. Select `tension:meltdown:annotation:7:top-down-vs-diagrams` and inspect its stored poles.
2. Enter comparison for answering interpretations of `focus-question:meltdown:u-07-machinic:what-is-machinic-synthesis`, including `claim:meltdown:annotation:8:compression-curve` and any actual learner-authored alternatives.
3. The genealogy river renders source sequence `source-shard:meltdown:b-009` → `source-shard:meltdown:b-010` → `source-shard:meltdown:b-011` → `source-shard:meltdown:b-012` through the stored `precedes` relations. It preserves the `b-009` unit-boundary ambiguity.
4. Sequence does not produce influence. If no `influences` record exists, the river says `No recorded influence claim`.
5. The learner may author a draft interpretation claim, a legal `answers` edge, and an interpretation-scope `objects-to` edge, each with actual generated stable IDs, locator provenance, rationale, and separate create events.
6. A canonical claim × source matrix shows every cell; unreviewed pairs are `not-yet-collected`.
7. The tension remains between interpretations until an explicit adjudication changes its canonical status. No consensus is inferred.
8. Ledger parity records the new object, relations, placements, matrix changes if any, and sync events.

**Pass:** source order, editorial interpretation, learner hypothesis, tension, and evidence gaps remain distinct and recoverable. **Fail:** chronology becomes influence, alternatives merge, or a blank cell implies absence.

---

## 17. Implementation and acceptance gate

The implementation is ready when all of the following hold at 1440 × 900:

1. `InquiryWorldApi.validateWorkspace` passes before the world renders accepted semantics.
2. Every object mark resolves to one canonical object and placement; every visible edge resolves to one legal relation with evidence.
3. The lens declares position, proximity, size, color, containment, and edge meanings; the legend states forbidden inferences.
4. The issue → positions → claims/evidence/objections grammar is navigable without flattening motivation, intuition, example, mechanism, tension, genealogy, or uncertainty.
5. Mixed paths label every segment and reserve inference for `supports`.
6. Multiple interpretations compare without merging objects, evidence, authorship, or review history.
7. Evidence rooms use canonical `Matrix`/`MatrixCell`, validate the full Cartesian product, and display all five states honestly.
8. Sandbox propagation traverses only licensed explicit edges, lists relation IDs, blocks cycles, and reports unknown/no-recorded states without generated consequences.
9. Source recovery remains in place and displays exact locators, quote policy, transformations, source versions, and unavailable states.
10. Genealogy shows chronology/order/influence as different semantics and never turns sequence into support.
11. The canonical ledger has parity with every semantic record and supports the same authoring operations as the world.
12. Drag, grouping, relation authoring, matrix inspection, semantic camera, snapshot, and recovery work by pointer and keyboard through the same event path.
13. Reduced motion preserves context through focus, breadcrumb, and announcements with no camera travel.
14. No document horizontal overflow, color-only state, invisible focus, browser-default control styling, translucent source surface, or inaccessible overlay remains.
15. No renderer-local durable schema, generic `related` edge, fake quote, invented relationship, implicit sparse cell, force layout, model-completed path, dashboard KPI, tab pile, or current mobile requirement appears.

The first demo should deliberately retain the proposed Machinic mechanism, sparse-but-explicit matrix states, the unresolved tractor-fields question, `b-009` boundary ambiguity, and at least one no-recorded-propagation result. Those limits are not defects to hide; they are the argument world’s proof of honesty.
