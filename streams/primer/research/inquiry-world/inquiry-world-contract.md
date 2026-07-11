# Inquiry World Contract

This is the canonical durable contract shared by **Atlas of Inquiry**, **Argument World**, and **Construction Studio**. The three products are renderers and authoring surfaces over one workspace; they must not invent parallel object, relation, matrix, snapshot, provenance, layout, or ledger schemas.

The current implementation gate is the desktop **1440 × 900** runtime. Mobile remains deferred design research only: it is not a current acceptance gate and does not weaken the keyboard, reduced-motion, or list-ledger requirements on desktop.

## 1. Non-negotiable semantics

1. Every durable record has a stable ID, explicit authorship and review state where judgment is involved, and recoverable provenance.
2. Source text is never invented. A source-backed record carries a canonical locator. Examples in this contract are locator-only or clearly marked paraphrases; they contain no copied or fabricated quotation.
3. There is no generic `related` relation and no untyped endpoint. Relation types determine legal source and target kinds.
4. Evidence is typed. Causal, inferential, genealogical, prerequisite, contradiction, and absence claims cannot be inferred from proximity, sequence, co-occurrence, citation count, embeddings, or model confidence.
5. Position, proximity, containment, size, color, and edge style have declared meanings. Embeddings may retrieve candidates but never license epistemic geography.
6. Intuition, motivation, mechanism, example, tension, genealogy, and question are first-class objects, not metadata on claims.
7. Learner placements, groupings, rejections, routes, matrices, cells, snapshots, and artifacts are knowledge-work records, not disposable UI state.
8. Every spatial projection has synchronized list-ledger parity. Coordinates are never the only representation of meaning.
9. A missing matrix cell is invalid. Each row × column pair has exactly one explicit review state.
10. Manual authorship precedes procedural assistance. Generated records remain candidates until an editor or learner explicitly promotes them.

## 2. Canonical TypeScript-shaped schema

The following is one closed schema. Implementations may split it into modules, but must preserve these discriminants and must not introduce `any`, `unknown`, stringly typed endpoints, or renderer-local durable substitutes.

```ts
type SchemaVersion = "inquiry-world.v1";
type StableId = string;
type IsoDateTime = string;
type ContentHash = string;
type NonEmptyArray<T> = readonly [T, ...T[]];

type Actor = "source" | "editor" | "learner" | "system";
type Authorship = "source-derived" | "editorial" | "learner-authored" | "procedural-candidate";
type ReviewState = "draft" | "proposed" | "accepted" | "rejected" | "corrected" | "superseded";
type Confidence =
  | "source-stated"
  | "editorial-judgment"
  | "deterministic"
  | "heuristic"
  | "learner-hypothesis"
  | "contested"
  | "not-assessed";

type SourceLocator =
  | { kind: "reader-ir"; workId: StableId; unitKey?: string; blockKey?: string; annotationId?: number; conceptId?: number; conceptAnchorIndex?: number; pageStart?: number; pageEnd?: number; startOffset?: number; endOffset?: number; offsetEncoding?: "utf-16" }
  | { kind: "graph-index"; recordId: StableId; assertionId?: StableId }
  | { kind: "archive-source"; sourceId: StableId; canonicalUrl: string; localPath: string; heading?: string }
  | { kind: "manual-v0"; file: string; pointer: string };

type SourceRangeProvenance =
  | { kind: "source-range"; id: StableId; locator: SourceLocator; quotePolicy: "not-copied"; transform: string; createdBy: Actor; createdAt: IsoDateTime; confidence: Confidence }
  | { kind: "source-range"; id: StableId; locator: SourceLocator; quotePolicy: "reviewed-short-quote"; reviewedQuote: string; transform: string; createdBy: Actor; createdAt: IsoDateTime; confidence: Confidence };

type Provenance =
  | SourceRangeProvenance
  | { kind: "commentary-rationale"; id: StableId; locator: SourceLocator; rationaleField: "note" | "why_reference" | "front_claim" | "reader_question" | "anchor_note" | "seed_why"; transform: string; createdBy: "editor" | "learner" | "system"; createdAt: IsoDateTime; confidence: Confidence }
  | { kind: "algorithmic-derivation"; id: StableId; inputIds: NonEmptyArray<StableId>; algorithm: "stored-foreign-key" | "sequence-order" | "literal-match" | "ref-tokenization" | "candidate-extraction" | "layout"; transform: string; createdBy: "system"; createdAt: IsoDateTime; confidence: "deterministic" | "heuristic" }
  | { kind: "authoring-event"; id: StableId; eventId: StableId; transform: string; createdBy: "editor" | "learner"; createdAt: IsoDateTime; confidence: "editorial-judgment" | "learner-hypothesis" };

type ObjectKind =
  | "focus-question" | "inquiry-region" | "inquiry-room" | "source-shard"
  | "concept" | "intuition" | "motivation" | "mechanism" | "example"
  | "counterexample" | "tension" | "claim" | "evidence" | "objection"
  | "genealogy-event" | "open-question" | "learner-artifact";

type Endpoint<K extends ObjectKind> = { kind: K; id: StableId };
type ObjectRef = { [K in ObjectKind]: Endpoint<K> }[ObjectKind];

type BaseObject<K extends ObjectKind, A extends Authorship> = {
  schemaVersion: SchemaVersion;
  id: StableId;
  kind: K;
  title: string;
  body: string;
  authorship: A;
  reviewState: ReviewState;
  confidence: Confidence;
  provenance: NonEmptyArray<Provenance>;
  parents: readonly ObjectRef[];
  tags: readonly string[];
};

type InquiryObject =
  | (BaseObject<"source-shard", "source-derived"> & { sourceRole: "passage" | "annotation" | "concept-anchor" | "external-excerpt" })
  | (BaseObject<"focus-question", "editorial" | "learner-authored" | "procedural-candidate"> & { questionStatus: "active" | "parked" | "answered" | "superseded" })
  | (BaseObject<"inquiry-region", "editorial" | "learner-authored" | "procedural-candidate"> & { entryQuestion: Endpoint<"focus-question"> | Endpoint<"open-question">; boundaryRule: string })
  | (BaseObject<"inquiry-room", "editorial" | "learner-authored" | "procedural-candidate"> & { entryQuestion: Endpoint<"focus-question"> | Endpoint<"open-question">; boundaryRule: string; exitArtifact?: Endpoint<"learner-artifact"> })
  | (BaseObject<"concept", Authorship> & { conceptRole: "definition" | "distinction" | "family" | "term" | "model-part" })
  | (BaseObject<"intuition", Authorship> & { representation: "analogy" | "manipulable-case" | "felt-sense" | "contrast" | "concrete-image"; forObjects: NonEmptyArray<ObjectRef> })
  | (BaseObject<"motivation", Authorship> & { motivationFor: ObjectRef; motiveKind: "source-problem" | "learner-salience" | "historical-pressure" | "design-stake" })
  | (BaseObject<"mechanism", Authorship> & { variables: readonly ObjectRef[]; steps: NonEmptyArray<ObjectRef>; assumptions: readonly string[] })
  | (BaseObject<"example", Authorship> & { illustrates: ObjectRef; exampleKind: "concrete" | "worked" | "analogy" | "boundary-case" })
  | (BaseObject<"counterexample", Authorship> & { challenges: ObjectRef; boundaryNote: string })
  | (BaseObject<"tension", Authorship> & { poles: readonly [ObjectRef, ObjectRef]; tensionStatus: "unresolved" | "productive" | "adjudicated" | "scope-limited" })
  | (BaseObject<"claim", Authorship> & { claimRole: "thesis" | "premise" | "warrant" | "interpretation" | "synthesis"; modality: "asserted" | "qualified" | "hypothetical" })
  | (BaseObject<"evidence", Authorship> & { evidenceKind: "source-passage" | "citation" | "observation" | "dataset" | "proof-sketch" | "commentary" | "model-output" })
  | (BaseObject<"objection", Authorship> & { target: ObjectRef; objectionKind: "counterexample" | "missing-evidence" | "scope-challenge" | "alternative-reading" | "method-challenge" })
  | (BaseObject<"genealogy-event", Authorship> & { temporal: { kind: "date"; date: string } | { kind: "interval"; start: string; end: string } | { kind: "ordered"; label: string; order: number }; eventKind: "predecessor" | "influence" | "response" | "mutation" | "context" | "reception" })
  | (BaseObject<"open-question", Authorship> & { questionStatus: "open" | "partially-answered" | "answered-by-source" | "answered-by-learner" | "deliberately-open" | "blocked-by-missing-source" })
  | (BaseObject<"learner-artifact", "learner-authored"> & { artifactKind: "note" | "map" | "model" | "comparison" | "essay" | "prompt" | "glossary" | "rejected-alternative" | "public-artifact"; audience?: string });

type RelationBase<T extends string, F extends ObjectKind, To extends ObjectKind> = {
  schemaVersion: SchemaVersion;
  id: StableId;
  type: T;
  from: Endpoint<F>;
  to: Endpoint<To>;
  label: string;
  authorship: Authorship;
  reviewState: ReviewState;
  confidence: Confidence;
  provenance: NonEmptyArray<Provenance>;
  evidence: NonEmptyArray<Provenance>;
};

type CausalRelation<T extends "causes" | "enables" | "inhibits"> =
  RelationBase<T, "mechanism" | "claim", "mechanism" | "claim"> & {
    causalBasis: "source-assertion" | "empirical-result" | "model-assumption" | "editorial-model" | "learner-conjecture";
    conditions: readonly ObjectRef[];
  };

type InquiryRelation =
  | RelationBase<"derived-from", Exclude<ObjectKind, "source-shard">, "source-shard">
  | RelationBase<"answers", "claim" | "concept" | "mechanism" | "example" | "learner-artifact", "focus-question" | "open-question">
  | RelationBase<"raises", "source-shard" | "claim" | "tension" | "learner-artifact", "open-question">
  | RelationBase<"defines", "source-shard" | "concept" | "claim", "concept">
  | RelationBase<"elaborates", "source-shard" | "concept" | "intuition" | "example" | "mechanism" | "claim", "concept" | "mechanism" | "claim">
  | RelationBase<"motivates", "motivation", "concept" | "claim" | "mechanism" | "learner-artifact">
  | RelationBase<"builds-intuition-for", "intuition" | "example", "concept" | "mechanism" | "claim">
  | RelationBase<"exemplifies", "example", "concept" | "mechanism" | "claim">
  | RelationBase<"challenges", "counterexample", "concept" | "mechanism" | "claim">
  | RelationBase<"contrasts-with", "concept" | "example" | "counterexample" | "mechanism" | "claim" | "source-shard", "concept" | "example" | "counterexample" | "mechanism" | "claim" | "source-shard">
  | (RelationBase<"supports", "evidence" | "claim", "claim"> & { supportKind: "direct" | "co-premise" | "warrant" | "background" })
  | (RelationBase<"objects-to", "objection" | "counterexample" | "claim", "claim" | "mechanism" | "evidence"> & { objectionScope: "truth" | "scope" | "method" | "interpretation" })
  | (RelationBase<"tensions-with", "tension", "concept" | "claim" | "mechanism" | "motivation" | "genealogy-event"> & { tensionKind: "tradeoff" | "contradiction-candidate" | "ambiguity" | "historical-shift" | "scope-conflict" })
  | RelationBase<"operationalizes", "mechanism", "concept" | "claim" | "intuition">
  | CausalRelation<"causes">
  | CausalRelation<"enables">
  | CausalRelation<"inhibits">
  | RelationBase<"depends-on", "concept" | "mechanism" | "claim" | "learner-artifact", "concept" | "mechanism" | "claim" | "source-shard">
  | (RelationBase<"precedes", "source-shard", "source-shard"> & { orderKind: "source-sequence" | "publication" | "learner-route" })
  | (RelationBase<"precedes", "genealogy-event", "genealogy-event"> & { orderKind: "chronology" | "publication" | "learner-route" })
  | (RelationBase<"influences", "genealogy-event" | "source-shard" | "concept", "concept" | "claim" | "mechanism" | "genealogy-event"> & { influenceScope: "author-stated" | "editorial-with-source" | "learner-hypothesis" })
  | (RelationBase<"cites", "source-shard" | "claim" | "evidence" | "genealogy-event", "source-shard" | "evidence"> & { citationRole: "citation-only" | "evidence-pointer" | "bibliographic-context" })
  | (RelationBase<"same-as", "source-shard", "source-shard"> & { identityScope: "same-record"; identityRationale: string })
  | (RelationBase<"same-as", "concept", "concept"> & { identityScope: "same-concept"; identityRationale: string })
  | (RelationBase<"same-as", "claim", "claim"> & { identityScope: "same-claim"; identityRationale: string })
  | RelationBase<"contains", "inquiry-region" | "inquiry-room", Exclude<ObjectKind, "inquiry-region">>
  | (RelationBase<"learner-associates", "learner-artifact", Exclude<ObjectKind, "learner-artifact">> & { authorship: "learner-authored"; associationStatus: "provisional" | "promoted" | "rejected"; rationale: string });
```

### Relation evidence invariants

- `evidence` is always nonempty and is independent of the relation record's own provenance.
- `derived-from`, `defines`, source-sequence `precedes`, `cites`, and `author-stated` influence require at least one `source-range` or `commentary-rationale` item containing a canonical locator.
- `supports` and `objects-to` evidence must identify what licenses the inference; a `cites` record with `citationRole: "citation-only"` is never inferential support.
- `causes`, `enables`, and `inhibits` require a declared `causalBasis`; co-occurrence, chronology, citation, proximity, and model prose do not license them.
- `depends-on` means an explicitly authored prerequisite/dependency, never mere helpful background.
- `influences` cannot be accepted from chronology, citation, or similarity alone. `learner-hypothesis` influence must be learner-authored or procedural-candidate and visibly non-accepted until reviewed.
- `same-as` requires an explicit identity scope and rationale; shared labels or embeddings are insufficient.
- `contrasts-with` is symmetric in meaning but stored once in canonical ID order. It does not imply contradiction.
- `contains` evidence is the authored boundary rationale. Containment never follows from coordinates alone.
- Endpoint kind and referenced object kind must match exactly. Self-relations are illegal except `tensions-with` when two distinct tension poles justify the record.

## 3. Geometry, lenses, routes, and declared layout

```ts
type Geometry =
  | { kind: "point"; x: number; y: number; z?: number }
  | { kind: "rect"; x: number; y: number; width: number; height: number; z?: number }
  | { kind: "polygon"; points: NonEmptyArray<readonly [number, number]> }
  | { kind: "matrix-cell"; matrixId: StableId; cellId: StableId }
  | { kind: "dag-layer"; layer: number; order: number }
  | { kind: "list-row"; sectionId: StableId; order: number };

type DeclaredAxis =
  | { kind: "ordinal"; label: string; lowLabel: string; highLabel: string; criteria: NonEmptyArray<string> }
  | { kind: "numeric"; label: string; unit: string; minimum: number; maximum: number }
  | { kind: "temporal"; label: string; calendar: string; earliest: string; latest: string };
type GeometryDeclaration =
  | { kind: "cartesian-2d"; origin: "focus-question" | "world-zero"; xAxis: DeclaredAxis; yAxis: DeclaredAxis; worldUnitPixelsAtDefaultZoom: number; extent: "placement-bounds-plus-margin" }
  | { kind: "matrix"; matrixIds: NonEmptyArray<StableId>; rowMeans: string; columnMeans: string }
  | { kind: "dag"; direction: "top-to-bottom" | "left-to-right"; layerMeans: "dependency" | "build-order" | "source-order" | "generation-order"; orderRationale: string }
  | { kind: "list"; sectionOrderMeans: string; rowOrderMeans: string };
type CoordinateSpace =
  | { kind: "lens"; lensId: StableId }
  | { kind: "room-local"; lensId: StableId; room: Endpoint<"inquiry-room"> };

type PlacementSemantics = {
  positionMeans: "manual-authored" | "declared-axis" | "source-order" | "route-order" | "topological-layer" | "matrix-membership" | "room-local";
  proximityMeans: "none" | "same-source" | "compare-now" | "shared-mechanism" | "evidence-neighborhood" | "historical-descent" | "learner-grouping" | "prerequisite-route" | "unresolved-frontier";
  sizeMeans: "constant" | "source-coverage" | "evidence-count" | "learner-attention" | "abstraction-level" | "uncertainty";
  colorMeans: "none" | "authorship" | "review-state" | "object-kind" | "evidence-kind" | "matrix-state";
  containmentMeans: "none" | "room-membership" | "source-scope" | "mechanism-module" | "argument-group" | "learner-pile";
  edgeStyleMeans: "none" | "relation-type" | "review-state" | "evidence-kind";
  rationale: string;
};
type LensChannelDefaults = PlacementSemantics & {
  roadsMean: "none" | "authored-route" | "declared-relation-path";
  roomsMean: "none" | "inquiry-room-boundary";
  ambiguityMeans: "none" | "review-state" | "frontier-status" | "unsupported-claim";
};

type SpatialPlacement = {
  schemaVersion: SchemaVersion;
  id: StableId;
  object: ObjectRef;
  lensId: StableId;
  geometry: Geometry;
  coordinateSpace: CoordinateSpace;
  semantics: PlacementSemantics;
  lockedByLearner: boolean;
  authorship: Authorship;
  reviewState: ReviewState;
  provenance: NonEmptyArray<Provenance>;
};

type ProjectionKind = "atlas" | "argument-map" | "evidence-matrix" | "genealogy" | "dag" | "semantic-zoom" | "construction-board" | "list-ledger";
type ViewLens = {
  schemaVersion: SchemaVersion;
  id: StableId;
  name: string;
  prototype: "atlas-of-inquiry" | "argument-world" | "construction-studio" | "shared";
  projection: ProjectionKind;
  focusQuestion: Endpoint<"focus-question">;
  objectKinds: readonly ObjectKind[];
  relationTypes: readonly InquiryRelation["type"][];
  geometry: GeometryDeclaration;
  defaults: LensChannelDefaults;
  legend: { position: string; proximity: string; size: string; color: string; containment: string; edgeStyle: string; roads: string; rooms: string; ambiguity: string };
  ledgerColumns: readonly LedgerColumn[];
  unsupportedClaims: readonly UnsupportedClaim[];
  authorship: "editorial" | "learner-authored" | "procedural-candidate";
  reviewState: ReviewState;
  provenance: NonEmptyArray<Provenance>;
};

type RouteStep = { order: number; object: ObjectRef; relation?: RecordRef<"relation">; instruction: string; exitCheck?: string };
type Route = { schemaVersion: SchemaVersion; id: StableId; title: string; authorship: "editorial" | "learner-authored" | "procedural-candidate"; reviewState: ReviewState; focusQuestion: Endpoint<"focus-question">; lensId: StableId; steps: NonEmptyArray<RouteStep>; provenance: NonEmptyArray<Provenance> };
```

A lens has exactly one typed default meaning for each visual channel and a declared geometry. Its human-readable `legend` is derived from `defaults` and `geometry`; it explains those records but cannot override them. `none` is explicit, never omission. Manual placement is the initial authority. Procedural layout may propose a new placement only after a lens declares semantics; it cannot move learner-locked records, and its manifest must name its algorithm, inputs, adjustments, and limits. Force-directed or embedding-distance layout is not a legal epistemic layout.

## 4. Durable matrices

Matrices are workspace records, not renderer configuration. Rows and columns are typed references to canonical objects. A `MatrixCell` exists for every row × column pair and has exactly one of the five states below—no truthy/falsy shorthand and no implicit state from sparsity.

```ts
type MatrixAxis = {
  id: StableId;
  label: string;
  allowedKinds: NonEmptyArray<ObjectKind>;
  members: NonEmptyArray<ObjectRef>;
  order: "manual" | "source" | "chronological" | "confidence" | "authorship" | "review-state";
  rationale: string;
};

type Matrix = {
  schemaVersion: SchemaVersion;
  id: StableId;
  title: string;
  purpose: "evidence" | "contrast" | "transfer" | "coverage" | "comparison";
  rowAxis: MatrixAxis;
  columnAxis: MatrixAxis;
  authorship: "editorial" | "learner-authored" | "procedural-candidate";
  reviewState: ReviewState;
  provenance: NonEmptyArray<Provenance>;
};

type MatrixEvidenceRef =
  | { kind: "relation"; relationId: StableId }
  | { kind: "evidence-object"; object: Endpoint<"evidence"> }
  | { kind: "source-version"; source: SourceVersion };

type MatrixCellState =
  | { kind: "present"; evidenceRefs: NonEmptyArray<MatrixEvidenceRef> }
  | { kind: "absent-by-review"; reviewedSources: NonEmptyArray<SourceVersion> }
  | { kind: "not-yet-collected"; collectionNeed: string }
  | { kind: "contested"; supporting: NonEmptyArray<MatrixEvidenceRef>; contesting: NonEmptyArray<MatrixEvidenceRef> }
  | { kind: "not-applicable"; applicabilityRule: string };

type MatrixCell = {
  schemaVersion: SchemaVersion;
  id: StableId;
  matrixId: StableId;
  row: ObjectRef;
  column: ObjectRef;
  state: MatrixCellState;
  evidence: NonEmptyArray<Provenance>;
  rationale: string;
  authorship: "editorial" | "learner-authored" | "procedural-candidate";
  reviewState: ReviewState;
  provenance: NonEmptyArray<Provenance>;
};
```

`absent-by-review` means the named `reviewedSources` were inspected and the relation was not found; it never means false. `not-yet-collected` is the default epistemic gap, but still requires an authored cell record and collection need. `contested` preserves typed evidence references for both sides. `not-applicable` requires a declared applicability rule. Cell evidence is nonempty even for negative/gap states because the review, collection need, contest, or applicability judgment must be recoverable.

Validation resolves every axis member's `{ kind, id }` against the workspace, requires its kind to appear in `allowedKinds`, and rejects duplicate members. It resolves every cell coordinate against its matrix axes, rejects duplicate coordinates, and requires the cell set to equal the unique Cartesian product of row members × column members. `present` and `contested` refs must resolve to the declared relation, evidence object, or source version; renderer-local cell IDs or implicit sparse cells are illegal.

## 5. Durable authored groups

Provisional piles and promoted groups are workspace records. Their proximity is never itself a relation.

```ts
type AuthoredGroup = {
  schemaVersion: SchemaVersion;
  id: StableId;
  title: string;
  members: NonEmptyArray<ObjectRef>;
  groupKind: "provisional-pile" | "comparison-set" | "mechanism-candidates" | "tension-set" | "learner-hypothesis";
  status: "provisional" | "promoted" | "rejected";
  rationale: string;
  promotionTarget: "typed-relations" | "inquiry-room" | "matrix" | "none";
  authorship: "editorial" | "learner-authored" | "procedural-candidate";
  reviewState: ReviewState;
  provenance: NonEmptyArray<Provenance>;
};
```

Sharing or snapshotting a group requires a title and rationale. Promotion creates typed relations, a room, or a matrix through an `AuthoringEvent`; it never mutates the original group out of history.

## 6. Typed snapshots and workspace ownership

A snapshot is a citable immutable record of a workspace state. It is not an `InquiryObject` indirection. The workspace owns full snapshots, matrices, and cells.

```ts
type SourceVersion = { sourceId: StableId; locatorKind: SourceLocator["kind"]; contentHash: ContentHash; versionLabel?: string };
type EncodingOverride<T> = { kind: "lens-default" } | { kind: "snapshot-override"; value: T };
type LensState = {
  lensId: StableId;
  lensHash: ContentHash;
  position: EncodingOverride<PlacementSemantics["positionMeans"]>;
  proximity: EncodingOverride<PlacementSemantics["proximityMeans"]>;
  size: EncodingOverride<PlacementSemantics["sizeMeans"]>;
  color: EncodingOverride<PlacementSemantics["colorMeans"]>;
  containment: EncodingOverride<PlacementSemantics["containmentMeans"]>;
  edgeStyle: EncodingOverride<PlacementSemantics["edgeStyleMeans"]>;
  roads: EncodingOverride<LensChannelDefaults["roadsMean"]>;
  rooms: EncodingOverride<LensChannelDefaults["roomsMean"]>;
  ambiguity: EncodingOverride<LensChannelDefaults["ambiguityMeans"]>;
};
type CameraBreadcrumb =
  | { kind: "world" }
  | { kind: "region"; object: Endpoint<"inquiry-region"> }
  | { kind: "room"; object: Endpoint<"inquiry-room"> }
  | { kind: "object"; object: ObjectRef }
  | { kind: "source"; sourceId: StableId; locator: SourceLocator };
type CameraState = {
  centerX: number;
  centerY: number;
  zoom: number;
  semanticLevel: "work" | "region" | "room" | "evidence" | "source";
  sourceGranularity: "work" | "reading-unit" | "block-or-passage" | "occurrence-or-source-span";
  focusedObjectId?: StableId;
  breadcrumb: readonly CameraBreadcrumb[];
};
type FilterState = {
  visibleObjectKinds: readonly ObjectKind[];
  visibleRelationTypes: readonly InquiryRelation["type"][];
  authorship: readonly Authorship[];
  reviewStates: readonly ReviewState[];
  sourceIds: readonly StableId[];
  tags: readonly string[];
  query: string;
  includeUnplaced: boolean;
};
type RouteState =
  | { kind: "inactive" }
  | { kind: "active"; routeId: StableId; routeHash: ContentHash; activeStepOrder: number };
type FrontierState =
  | { kind: "object-frontier"; object: Endpoint<"open-question">; status: "open" | "blocked-by-missing-source" | "deliberately-open" | "contested" | "not-yet-collected"; rationale: string }
  | { kind: "unsupported-claim-frontier"; claim: UnsupportedClaim; relatedObjects: readonly ObjectRef[]; rationale: string };
type VersionedRecordId = { id: StableId; contentHash: ContentHash };
type LayoutState = {
  placements: readonly VersionedRecordId[];
  lockedPlacementIds: readonly StableId[];
  expandedRooms: readonly Endpoint<"inquiry-room">[];
  visibleGroups: readonly VersionedRecordId[];
  visibleMatrices: readonly VersionedRecordId[];
  ledgerHash: ContentHash;
  activeLedgerSectionId?: StableId;
};

type ArgumentSandboxToggle = {
  id: StableId;
  version: number;
  target: { kind: "mechanism-assumption"; mechanism: Endpoint<"mechanism">; assumptionIndex: number; assumptionHash: ContentHash };
  value: boolean;
};
type ProjectionState =
  | { prototype: "atlas-of-inquiry"; genealogyOverlay: "hidden" | "visible" }
  | { prototype: "argument-world"; activeSurface: "argument-map" | "evidence-matrix" | "comparison" | "mechanism-sandbox"; sandbox: { kind: "inactive" } | { kind: "active"; toggles: readonly ArgumentSandboxToggle[] } }
  | { prototype: "construction-studio"; activeGroup?: VersionedRecordRef<"group">; activeMatrix?: VersionedRecordRef<"matrix"> }
  | { prototype: "shared"; projection: ProjectionKind };

type Snapshot = {
  schemaVersion: SchemaVersion;
  id: StableId;
  title: string;
  capturedAt: IsoDateTime;
  workspaceRevision: number;
  authorship: "editorial" | "learner-authored" | "procedural-candidate";
  reviewState: ReviewState;
  lens: LensState;
  camera: CameraState;
  filters: FilterState;
  route: RouteState;
  sourceVersions: NonEmptyArray<SourceVersion>;
  frontiers: readonly FrontierState[];
  layout: LayoutState;
  projectionState: ProjectionState;
  selectedObjects: readonly ObjectRef[];
  learnerClaims: readonly Endpoint<"claim">[];
  provenance: NonEmptyArray<Provenance>;
};

type SourceSnapshot = { readerIrHash: ContentHash; sourceBlocksHash?: ContentHash; graphIndexHash?: ContentHash; editorialLayerHash?: ContentHash; learnerEventLogHash?: ContentHash };
type WorkspaceMetadata = {
  schemaVersion: SchemaVersion;
  id: StableId;
  title: string;
  sourceSnapshot: SourceSnapshot;
  updatedBy: "editor" | "learner" | "system";
  provenance: NonEmptyArray<Provenance>;
};

type Workspace = {
  schemaVersion: SchemaVersion;
  id: StableId;
  revision: number;
  metadata: WorkspaceMetadata;
  objects: readonly InquiryObject[];
  relations: readonly InquiryRelation[];
  lenses: readonly ViewLens[];
  routes: readonly Route[];
  placements: readonly SpatialPlacement[];
  matrices: readonly Matrix[];
  matrixCells: readonly MatrixCell[];
  snapshots: readonly Snapshot[];
  groups: readonly AuthoredGroup[];
  events: readonly AuthoringEvent[];
  commits: readonly WorkspaceCommit[];
  ledger: Ledger;
};
```

Snapshot IDs never point to mutable UI state. Restoring a snapshot resolves only IDs in the same workspace revision lineage, reports missing or changed sources as conflicts, and creates a new atomic authoring commit rather than rewriting history. `Snapshot.projectionState.prototype` must equal the resolved lens prototype; its state is durable, while consequence reports derived from revisioned objects and relations are not duplicated.

## 7. Authoring ledger and list-ledger parity

```ts
type RecordPayloadByKind = {
  object: InquiryObject;
  relation: InquiryRelation;
  lens: ViewLens;
  route: Route;
  placement: SpatialPlacement;
  group: AuthoredGroup;
  matrix: Matrix;
  "matrix-cell": MatrixCell;
  snapshot: Snapshot;
  "workspace-metadata": WorkspaceMetadata;
  ledger: Ledger;
};
type RecordKind = keyof RecordPayloadByKind;
type RecordRef<K extends RecordKind = RecordKind> = { [P in K]: { kind: P; id: StableId } }[K];
type VersionedRecordRef<K extends RecordKind = RecordKind> = { [P in K]: { kind: P; id: StableId; contentHash: ContentHash } }[K];
type DurableRecord<K extends RecordKind = RecordKind> = { [P in K]: { kind: P; value: RecordPayloadByKind[P] } }[K];
type MutableRecordKind = Exclude<RecordKind, "snapshot">;
type SemanticRecordKind = Exclude<RecordKind, "workspace-metadata" | "ledger">;
type ReviewableRecordKind = Exclude<MutableRecordKind, "workspace-metadata" | "ledger">;
type RemovableRecordKind = Exclude<ReviewableRecordKind, "snapshot">;
type RecordChange<K extends MutableRecordKind = MutableRecordKind> = { [P in K]: { before: VersionedRecordRef<P>; record: DurableRecord<P> } }[K];

type LedgerColumn = "id" | "record-kind" | "semantic-kind" | "title" | "authorship" | "review-state" | "provenance" | "endpoints" | "placement" | "rationale" | "matrix-state" | "source-version";
type LedgerSemanticKind = ObjectKind | InquiryRelation["type"] | ProjectionKind | Geometry["kind"] | AuthoredGroup["groupKind"] | Matrix["purpose"] | MatrixCellState["kind"] | "route" | "snapshot";
type LedgerRow = { id: StableId; sectionId: StableId; order: number; record: RecordRef<SemanticRecordKind>; label: string; semanticKind: LedgerSemanticKind; provenance: NonEmptyArray<Provenance>; rationale: string };
type LedgerSection = { id: StableId; title: string; order: number; rowIds: readonly StableId[] };
type Ledger = { schemaVersion: SchemaVersion; id: StableId; columns: readonly LedgerColumn[]; sections: readonly LedgerSection[]; rows: readonly LedgerRow[] };

type EventEnvelope = { schemaVersion: SchemaVersion; id: StableId; commitId: StableId; afterRevision: number; createdAt: IsoDateTime; rationale: string; provenance: NonEmptyArray<Provenance> };
type AuthoringEvent = EventEnvelope & (
  | { type: "create"; actor: "editor" | "learner"; record: DurableRecord }
  | ({ type: "update"; actor: "editor" | "learner" } & RecordChange)
  | { type: "remove"; actor: "editor" | "learner"; target: VersionedRecordRef<RemovableRecordKind> }
  | ({ type: "promote" | "reject"; actor: "editor" | "learner" } & RecordChange<ReviewableRecordKind>)
  | { type: "transform"; actor: "editor" | "learner"; transform: "shard-to-concept" | "shard-to-claim" | "claims-to-argument" | "examples-to-mechanism" | "events-to-genealogy" | "claims-sources-to-matrix" | "pile-to-group" | "group-to-room" | "route-to-snapshot"; inputRecords: NonEmptyArray<RecordRef<SemanticRecordKind>>; outputRecords: NonEmptyArray<DurableRecord<SemanticRecordKind>> }
  | { type: "restore-snapshot"; actor: "editor" | "learner"; snapshotId: StableId; createdRecords: readonly DurableRecord<Exclude<SemanticRecordKind, "snapshot">>[]; conflicts: readonly Conflict[] }
  | { type: "deterministic-import"; actor: "system"; record: DurableRecord<"object" | "relation" | "workspace-metadata"> }
  | { type: "candidate-create"; actor: "system"; record: DurableRecord<SemanticRecordKind> }
  | ({ type: "candidate-update"; actor: "system" } & RecordChange<ReviewableRecordKind>)
  | ({ type: "sync-ledger"; actor: "system"; causedByEventIds: NonEmptyArray<StableId> } & RecordChange<"ledger">)
);
type WorkspaceCommit = { schemaVersion: SchemaVersion; id: StableId; fromRevision: number; toRevision: number; events: NonEmptyArray<AuthoringEvent>; createdAt: IsoDateTime; provenance: NonEmptyArray<Provenance> };
```

For every `RecordChange`, `before.kind`, `record.kind`, `before.id`, and `record.value.id` must identify the same record; replacement is an explicit remove plus create. A snapshot can be created or emitted by `route-to-snapshot`, but never updated, promoted, rejected, or removed: a revised capture receives a new stable ID. `deterministic-import` may create only source-derived records or advance `WorkspaceMetadata.sourceSnapshot`. `candidate-create` and `candidate-update` may write only `procedural-candidate` / `proposed` records and never accepted or learner-locked records; a collision emits `Conflict` rather than a mutation.

Events apply only as an atomic `WorkspaceCommit`: every event's `commitId` equals the commit ID, every `afterRevision` equals `toRevision`, and `fromRevision` equals the current workspace revision. A commit containing semantic changes also contains one `sync-ledger` event caused by those event IDs. `applyCommit` recomputes the expected parity ledger, rejects a mismatching supplied ledger, and exposes no member event or intermediate workspace; therefore no parity-invalid revision is observable.

Every semantic workspace record has exactly one ledger row in an appropriate section, including every relation, placement, group, matrix, matrix cell, route, and snapshot. Workspace metadata and the ledger are control records and do not recursively receive ledger rows. Metadata/source-snapshot changes and durable ledger column, section, or row-order changes pass through events and diffs. The ledger exposes endpoint kinds, evidence/provenance, group status and rationale, matrix state and rationale, placement semantics, route order, frontier status, and snapshot source versions. Keyboard and screen-reader operations must create the same commits as spatial operations. If a renderer cannot express a spatial claim in this ledger, the spatial claim is illegal.

## 8. Manual-first, then procedural pipeline

The canonical pipeline is deliberately ordered:

```text
manual-v0 authored workspace
  -> validate IDs, locators, endpoints, evidence, matrix completeness, and ledger parity
  -> deterministic import from Reader IR / GraphIndex
  -> heuristic candidate generation (optional)
  -> explicit editorial or learner promotion/rejection
  -> declared layout proposal and diff
  -> immutable export + GenerationManifest
```

Manual-v0 establishes workspace metadata and the first accepted objects, relations, lenses, routes, placements, groups, matrices, cells, snapshots, ledger, and replayable events. Deterministic import may add source-derived records using stored IDs, foreign keys, source order, literal matches, and declared reference tokens. It cannot infer support, contradiction, causality, influence, prerequisites, importance, motivation, or mastery.

Heuristics may propose every non-source semantic record, including groups, matrices, cells, snapshots, and placements. All remain `procedural-candidate` / `proposed`, carry algorithmic provenance and limitations, and cannot replace accepted manual or learner-locked records. Deterministic writes append `deterministic-import` events; heuristic writes append `candidate-create` or candidate-safe `candidate-update` events; ledger parity appends `sync-ledger`. Only editors or learners may promote or reject. Rejection is retained to prevent unsupported regeneration.

```ts
type CandidateGenerator =
  | { kind: "rule"; ruleId: StableId }
  | { kind: "model"; modelId: string; promptId: StableId };

type ManifestStage =
  | { stage: "manual-v0"; inputFile: string; commitIds: readonly StableId[]; eventIds: readonly StableId[]; outputRecords: readonly RecordRef[] }
  | { stage: "deterministic-import"; transform: string; commitIds: readonly StableId[]; eventIds: readonly StableId[]; outputRecords: readonly RecordRef[] }
  | { stage: "heuristic-candidates"; transform: string; generator: CandidateGenerator; commitIds: readonly StableId[]; eventIds: readonly StableId[]; outputRecords: readonly RecordRef[]; limitations: NonEmptyArray<string> }
  | { stage: "promotion-review"; commitIds: readonly StableId[]; eventIds: readonly StableId[]; accepted: readonly RecordRef[]; rejected: readonly RecordRef[] }
  | { stage: "declared-layout"; lensId: StableId; algorithm: "manual" | "axis" | "source-order" | "route-order" | "topological" | "matrix"; inputRecords: readonly RecordRef[]; commitIds: readonly StableId[]; eventIds: readonly StableId[]; outputPlacements: readonly StableId[]; adjustments: readonly string[]; semanticLimits: NonEmptyArray<string> }
  | { stage: "export"; format: "inquiry-world-json"; commitIds: readonly StableId[]; eventIds: readonly StableId[]; workspaceRevision: number; workspaceHash: ContentHash };

type UnsupportedClaim = { id: StableId; claim: string; missing: NonEmptyArray<string>; relatedObjects: readonly ObjectRef[]; authorship: "editorial" | "learner-authored" | "procedural-candidate"; reviewState: ReviewState; provenance: NonEmptyArray<Provenance> };
type GenerationManifest = { schemaVersion: SchemaVersion; id: StableId; generatedAt: IsoDateTime; inputs: { manualV0Hash: ContentHash; readerIr?: { id: StableId; hash: ContentHash }; graphIndex?: { version: string; hash: ContentHash }; editorialLayerHash?: ContentHash; learnerEventLogHash?: ContentHash }; stages: NonEmptyArray<ManifestStage>; unsupportedClaims: readonly UnsupportedClaim[]; outputs: { workspaceId: StableId; revision: number; records: readonly RecordRef[]; commitIds: readonly StableId[]; eventIds: readonly StableId[]; workspaceHash: ContentHash } };

type AddedChange = { kind: "added"; record: RecordRef; afterHash: ContentHash };
type RemovedChange = { kind: "removed"; record: RecordRef; beforeHash: ContentHash };
type UpdatedChange = { kind: "updated"; record: RecordRef; beforeHash: ContentHash; afterHash: ContentHash };
type Conflict = { record: RecordRef; reason: "source-changed" | "locator-missing" | "record-removed" | "learner-lock" | "concurrent-edit" | "matrix-incomplete"; detail: string };
type WorkspaceDiff = { schemaVersion: SchemaVersion; fromRevision: number; toRevision: number; added: readonly AddedChange[]; removed: readonly RemovedChange[]; changed: readonly UpdatedChange[]; unchanged: readonly RecordRef[]; conflicted: readonly Conflict[] };

type InquiryManualV0 = { format: "manual-v0"; schemaVersion: SchemaVersion; datasetId: StableId; workspace: Workspace; generationManifest?: GenerationManifest };
type InquiryExport = { format: "inquiry-world-json"; schemaVersion: SchemaVersion; exportedAt: IsoDateTime; workspace: Workspace; manifest: GenerationManifest; parentExportHash?: ContentHash; exportHash: ContentHash };
type InquiryImportResult = { workspace: Workspace; diff: WorkspaceDiff; conflicts: readonly Conflict[]; manifest: GenerationManifest };
```

Diffs and versioning cover every `RecordKind`, including workspace metadata, ledger order, groups, matrices, matrix cells, and snapshots. Import/export is lossless for provenance, events, source versions, learner locks, matrix states, and ledger order. Conflicts are records, never silent deletion or overwrite.

## 9. Stable Meltdown / Machinic example

These observed IDs and Reader IR locators are stable. Bodies below are editorial paraphrases or locator descriptions, not source quotations.

```ts
const pB010: Provenance = {
  kind: "source-range",
  id: "prov:meltdown:b-010",
  locator: { kind: "reader-ir", workId: "work:meltdown", unitKey: "u-07-machinic", blockKey: "b-010", pageStart: 2, pageEnd: 2 },
  quotePolicy: "not-copied",
  transform: "manual-v0 source shard locator",
  createdBy: "source",
  createdAt: "2026-07-11T00:00:00Z",
  confidence: "source-stated"
};

const machinicConcept: InquiryObject = {
  schemaVersion: "inquiry-world.v1",
  id: "concept:meltdown:1",
  kind: "concept",
  title: "Deleuze and Guattari: schizoanalysis",
  body: "Source-derived concept anchor for the machinery used in this unit.",
  authorship: "source-derived",
  reviewState: "accepted",
  confidence: "source-stated",
  provenance: [{ ...pB010, id: "prov:meltdown:concept:1:anchor:0", locator: { kind: "reader-ir", workId: "work:meltdown", unitKey: "u-07-machinic", conceptId: 1, conceptAnchorIndex: 0, pageStart: 2, pageEnd: 3 }, transform: "manual-v0 concept anchor locator" }],
  parents: [{ kind: "source-shard", id: "source-shard:meltdown:b-009" }, { kind: "source-shard", id: "source-shard:meltdown:b-010" }],
  tags: ["deleuze", "guattari", "schizoanalysis"],
  conceptRole: "model-part"
};

const machinicIntuition: InquiryObject = {
  schemaVersion: "inquiry-world.v1",
  id: "intuition:manual-v0:machinic:parts-with-whole",
  kind: "intuition",
  title: "Parts with, not into, a whole",
  body: "Editorial contrast for an additive and immanent rather than subsumptive reading; this is a paraphrase.",
  authorship: "editorial",
  reviewState: "accepted",
  confidence: "editorial-judgment",
  provenance: [pB010],
  parents: [{ kind: "source-shard", id: "source-shard:meltdown:b-010" }],
  tags: ["intuition", "immanence"],
  representation: "contrast",
  forObjects: [{ kind: "concept", id: "concept:meltdown:1" }]
};

const machinicRelation: InquiryRelation = {
  schemaVersion: "inquiry-world.v1",
  id: "rel:meltdown:intuition-parts:builds-intuition-for:mechanism",
  type: "builds-intuition-for",
  from: { kind: "intuition", id: "intuition:manual-v0:machinic:parts-with-whole" },
  to: { kind: "mechanism", id: "mechanism:manual-v0:machinic:diagrammatic-immanence" },
  label: "contrast helps readers inspect the candidate mechanism",
  authorship: "editorial",
  reviewState: "accepted",
  confidence: "editorial-judgment",
  provenance: [pB010],
  evidence: [pB010]
};

const machinicRouteId = "route:manual-v0:machinic-orientation";
const machinicFocusId = "focus-question:meltdown:u-07-machinic:what-is-machinic-synthesis";
const retainedShardIds = [
  "source-shard:meltdown:b-009",
  "source-shard:meltdown:b-010",
  "source-shard:meltdown:b-011",
  "source-shard:meltdown:b-012"
] as const;
```

The complete retained manual-v0 example uses this durable record catalog:

| Epistemic role | Stable ID | Grounding / status |
| --- | --- | --- |
| Focus question | `focus-question:meltdown:u-07-machinic:what-is-machinic-synthesis` | Editorial orientation question grounded in annotation rationale. |
| Boundary shard | `source-shard:meltdown:b-009` | Reader IR block `b-009`, stored under `u-07-opening`; boundary ambiguity is preserved. |
| Main shard | `source-shard:meltdown:b-010` | Reader IR block `b-010`, `u-07-machinic`, page 2. |
| Compression shard | `source-shard:meltdown:b-011` | Reader IR block `b-011`, `u-07-machinic`, page 2. |
| Closing shard | `source-shard:meltdown:b-012` | Reader IR block `b-012`, `u-07-machinic`, page 2. |
| Concept | `concept:meltdown:1` | Source-derived concept anchor `conceptId: 1`, anchor index `0`, pages 2–3. |
| Intuition | `intuition:manual-v0:machinic:parts-with-whole` | Editorial contrast, accepted; not source wording. |
| Motivation | `motivation:meltdown:annotation:6:why-schizoanalysis` | Editorial rationale derived from annotation 6. |
| Mechanism | `mechanism:manual-v0:machinic:diagrammatic-immanence` | Procedural candidate; assumptions state that mechanism semantics are an editorial reading, not a source-stated causal law. |
| Tension | `tension:meltdown:annotation:7:top-down-vs-diagrams` | Accepted editorial tension grounded in annotation 7 and `b-010`. |
| Claim | `claim:meltdown:annotation:8:compression-curve` | Qualified editorial interpretation grounded in annotation 8 and `b-011`; not quoted source text. |
| Open question | `open-question:manual-v0:machinic:tractor-fields` | Proposed open question anchored to `b-010`; no answer is supplied. |
| Lens | `lens:manual-v0:machinic-atlas` | Atlas projection with explicit `same-source` / `compare-now` semantics and constant size. |
| Route | `route:manual-v0:machinic-orientation` | Six-step editorial route; it is not a personalized recommendation or mastery claim. |

The retained legal relation spine is:

1. `concept:meltdown:1` `derived-from` `source-shard:meltdown:b-010`.
2. `source-shard:meltdown:b-009` `precedes` `b-010`, which `precedes` `b-011`, which `precedes` `b-012`; every edge has `orderKind: "source-sequence"` and both source locators as evidence.
3. `motivation:meltdown:annotation:6:why-schizoanalysis` `motivates` `concept:meltdown:1`.
4. `intuition:manual-v0:machinic:parts-with-whole` `builds-intuition-for` `mechanism:manual-v0:machinic:diagrammatic-immanence`.
5. The mechanism candidate `operationalizes` the concept but remains proposed and heuristic.
6. `tension:meltdown:annotation:7:top-down-vs-diagrams` `tensions-with` the mechanism.
7. `claim:meltdown:annotation:8:compression-curve` `answers` the focus question.
8. `source-shard:meltdown:b-010` `raises` `open-question:manual-v0:machinic:tractor-fields`.

Manual placement retains the focus question at `(0, 0)`, `b-009` at `(-2, 0)`, `b-010` at `(-1, 0)`, and the open question at `(2, 1)`. Each placement declares its position, proximity, size, color, containment, and edge-style semantics; the frontier placement uses `unresolved-frontier`. The six-step route proceeds through the focus question, boundary shard, concept, main shard, compression interpretation, and open question, ending with a check that the learner can distinguish source locator, editorial interpretation, procedural mechanism candidate, and unresolved question.

If this material is shown as a source × claim evidence matrix, the `Matrix` and every row × column `MatrixCell` live in the workspace; an unreviewed pairing is `not-yet-collected`, never an omitted or false cell. Saving the view creates a full `Snapshot` containing the Machinic lens and any encoding override, camera and breadcrumb, active filters and selected sources, route step, source hashes, frontier records, and versioned layout references. The manifest preserves the mechanism-review limitation, the unanswered question, and the `b-009` boundary ambiguity.

The `b-009` unit-boundary ambiguity remains explicit: it begins the Machinic Synthesis heading paragraph while its stored source-block assignment is `u-07-opening`. No importer may normalize that discrepancy away.

## 10. Minimal shared API

```ts
type InquiryDataset = { schemaVersion: SchemaVersion; workspace: Workspace; manifest: GenerationManifest };
type ProjectionRequest =
  | { kind: "live"; lensId: StableId; camera: CameraState; filters: FilterState; route: RouteState }
  | { kind: "snapshot"; snapshotId: StableId };
type InquiryProjection = { request: ProjectionRequest; lens: ViewLens; objects: readonly InquiryObject[]; relations: readonly InquiryRelation[]; placements: readonly SpatialPlacement[]; groups: readonly AuthoredGroup[]; matrices: readonly Matrix[]; matrixCells: readonly MatrixCell[]; resolvedRoute?: Route; resolvedSnapshot?: Snapshot; ledger: Ledger; unsupportedClaims: readonly UnsupportedClaim[] };
type BuildManualInput = { manual: InquiryManualV0 };
type BuildProceduralInput = { base: Workspace; readerIr?: { id: StableId; hash: ContentHash }; graphIndex?: { version: string; hash: ContentHash }; commits: readonly WorkspaceCommit[] };
type ValidationIssue =
  | { kind: "missing-record"; record: RecordRef; referencedBy: RecordRef }
  | { kind: "object-reference-kind"; owner: RecordRef<"object">; field: string; expected: NonEmptyArray<ObjectKind>; actual: ObjectKind }
  | { kind: "endpoint-kind"; relationId: StableId; detail: string }
  | { kind: "invalid-locator"; provenanceId: StableId; locator: SourceLocator; detail: string }
  | { kind: "missing-evidence"; record: RecordRef; detail: string }
  | { kind: "matrix-shape"; matrixId: StableId; detail: string }
  | { kind: "snapshot-version"; snapshotId: StableId; detail: string }
  | { kind: "undeclared-geometry"; placementId: StableId; detail: string }
  | { kind: "ledger-parity"; record: RecordRef<SemanticRecordKind>; detail: string }
  | { kind: "event-precondition"; eventId: StableId; detail: string }
  | { kind: "commit-precondition"; commitId: StableId; detail: string };
type ValidationResult = { valid: true } | { valid: false; issues: NonEmptyArray<ValidationIssue> };
type CommitApplicationResult =
  | { kind: "applied"; workspace: Workspace; diff: WorkspaceDiff }
  | { kind: "rejected"; originalWorkspace: Workspace; issues: NonEmptyArray<ValidationIssue>; conflicts: readonly Conflict[] };
type SnapshotRestoreResult =
  | { kind: "restored"; workspace: Workspace; commit: WorkspaceCommit; diff: WorkspaceDiff }
  | { kind: "conflict"; originalWorkspace: Workspace; conflicts: NonEmptyArray<Conflict> };

type InquiryWorldApi = {
  validateWorkspace(workspace: Workspace): ValidationResult;
  buildManualWorkspace(input: BuildManualInput): InquiryDataset;
  importProcedural(input: BuildProceduralInput): InquiryImportResult;
  importWorkspace(input: InquiryExport, current?: Workspace): InquiryImportResult;
  project(workspace: Workspace, request: ProjectionRequest): InquiryProjection;
  applyCommit(workspace: Workspace, commit: WorkspaceCommit): CommitApplicationResult;
  diffWorkspaces(before: Workspace, after: Workspace): WorkspaceDiff;
  restoreSnapshot(workspace: Workspace, snapshotId: StableId, actor: "editor" | "learner"): SnapshotRestoreResult;
  exportWorkspace(workspace: Workspace, manifest: GenerationManifest): InquiryExport;
};
```

Validation resolves every typed object reference against the declared object kind, every relation endpoint against its legal variant, and every `SourceLocator` against its canonical Reader IR, GraphIndex, archive, or manual-v0 target. An unresolved or structurally invalid locator yields `invalid-locator`; it cannot be downgraded to an empty provenance record.

Atlas may render a cartographic field, Argument World an inferential/evidence projection, and Construction Studio a tactile authoring surface. All three consume and emit the same `Workspace`; all durable changes pass through atomic `WorkspaceCommit`s containing typed `AuthoringEvent`s; all geometry is declared; all matrices and snapshots round-trip; and the synchronized `Ledger` remains the semantic peer of every spatial view.
