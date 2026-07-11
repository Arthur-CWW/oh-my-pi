# Tactile spatial grammar for explorable knowledge worlds

Retrieval date for all cited sources: 2026-07-11.

## Design stance

This grammar is for serious knowledge exploration, not decorative gamification. A world element may be playful only when it does representational work: it must encode a recoverable truth about the source material, the learner's authored structure, or the current state of inquiry. Every spatial choice needs declared semantics; otherwise it is ornament and should be removed.

The contract is:

1. **The authored source remains recoverable from every object.** Every node, room, road, fog boundary, quest, comparison, or snapshot carries a citation pointer: source URL or local source id, quote span or generated derivation span, transformation note, and author/user provenance.
2. **Spatial proximity is never generic similarity.** It must be one of a small set of explicit relations: same source neighborhood, shared mechanism, historical descent, evidential support/conflict, learner grouping, prerequisite route, or unresolved frontier.
3. **Edges are labels, not wires.** Every visible connection names the relation and its evidence: “motivates,” “depends on,” “rebuts,” “exemplifies,” “descends from,” “operationalizes,” “tensions with,” “asks,” or “authored grouping.”
4. **Camera motion is semantic.** Zoom, pan, and transitions answer “what changed in level of explanation?” not “how can this feel cinematic?”
5. **Learner-authored structure is first-class but marked.** The learner can place, group, annotate, route, and snapshot; these objects are visibly distinct from source-derived and system-inferred objects.
6. **The list view is not a fallback afterthought.** Every world has a linear, keyboard-navigable ledger with the same semantics and citations.

## Source-grounded principles

| Source | Type | Exact quoted wording | Design implication |
|---|---|---|---|
| Bret Victor, “Explorable Explanations” | Primary essay / project statement | “I want text to be used as an **environment to think in**.” | The world is not a map of content already understood; it is an environment for asking, testing, comparing, and rebutting. |
| Bret Victor, “Explorable Explanations” | Primary essay / project statement | “Most interactive widgets dump the user in a sandbox and say ‘figure it out for yourself’. *Those are not explanations.*” | Free manipulation must be held inside authored guidance: routes, prompts, landmarks, examples, and source recovery. |
| Bret Victor, “Explorable Explanations,” 2024 postscript | Primary essay / project statement | “a written *argument* whose assertions are backed by explorable computational models, whose *facts, assumptions, and calculations* are all visible and editable” | Argument World should expose assumptions and mechanisms, not just premise labels. Editable models need provenance and comparison. |
| Dynamicland 2017 website | Primary institutional statement | “real objects in the real world, not alone with virtual objects on a screen” | Even in 2D, interaction should feel like handling materials: grouping, moving, comparing, and remixing objects. |
| Dynamicland 2017 website | Primary institutional statement | “People spread out / walk around / compare possibilities.” | Large canvases should support spatial memory, simultaneous alternatives, and comparison, not force one modal panel. |
| Dynamicland 2017 website | Primary institutional statement | “Dynamicland is an authoring environment, and **everyone is an author.**” | The learner must author objects and structures, not only consume a prepared map. |
| Andy Matuschak, “Enabling environment” | Working note | “An *enabling environment* significantly expands its participants’ capacity to do things they find meaningful and important.” | The prototype should enable real inquiry practices: tracing evidence, forming questions, building models, and revising understanding. |
| Andy Matuschak, “Most games aren’t enabling environments” | Working note | “The primary purpose of most games is to create an aesthetic or emotional experience.” | Game-like affordances are acceptable only when subordinated to inquiry capacity. Rewards, badges, or decorative terrain are out. |
| Andy Matuschak, “Most games aren’t enabling environments” | Working note | “Minecraft is an interesting counter-example: the single-player experience contains extensive Cognitive scaffolding which later enables endless meaningful action in the ‘creative’ mode.” | Use game grammar as scaffold toward creative construction, not as a closed progression treadmill. |
| Shipman and Marshall, “Spatial Hypertext: An Alternative to Navigational and Semantic Links” | ACM Computing Surveys article | “relationships among different nodes or documents could be indicated simply on the basis of their relative location.” | Proximity can carry meaning, but the system must declare which meaning is active and preserve ambiguity when intended. |
| Shipman and Marshall | ACM Computing Surveys article | “constructive ambiguity” | Spatial layout should let uncertain relations exist without prematurely forcing formal edges. |
| Shipman and Marshall | ACM Computing Surveys article | “visual languages emerge as users’ understanding of the task and their method of approaching the task co-evolved” | Learners need mutable encodings: color, grouping, and regions can start informal and later be promoted to explicit relations. |
| Bederson and Hollan, “Pad++: A Zoomable Graphical Interface System” | CHI conference paper PDF | “Large information spaces are often difficult to access efficiently and intuitively.” | Pan/zoom is justified only as a way to manage scale and maintain orientation through semantic levels. |
| Bederson and Hollan, “Pad++: A Zoomable Graphical Interface System” | CHI conference paper PDF | “a graphical interface system based on zooming, as an alternative to traditional window and icon-based approaches” | Avoid window piles; use continuous scale, landmarks, and semantic zoom where appropriate. |
| Papert and Harel, “Situating Constructionism” | Book chapter, author-hosted | “learning-by-making” | Construction Studio must let learners build public artifacts: concept models, argument rooms, evidence neighborhoods, and routes. |
| Papert and Harel | Book chapter, author-hosted | “learning as ‘building knowledge structures’” | The system should make the learner’s knowledge structures visible, revisable, and source-linked. |
| Papert and Harel | Book chapter, author-hosted | “time to think, to dream, to gaze, to get a new idea and try it and drop it or persist” | Interaction pacing should allow lingering, revision, and partial attempts; avoid forced quest completion as the only progress model. |

## World ontology

### Object classes

- **Source shard:** quoted passage, figure, transcript segment, table, code excerpt, or image crop. Immutable except for user annotations. Always opens its source context.
- **Derived concept:** user- or system-authored summary of a source shard or cluster. Must list derivation spans.
- **Mechanism tile:** process, causal chain, algorithm, model, or explanatory machine. Contains steps and assumptions.
- **Example specimen:** concrete case, counterexample, worked example, analogy, or sensory demonstration.
- **Motivation tile:** why a concept was invented, what problem it solved, what frustration or aspiration shaped it.
- **Tension tile:** contradiction, tradeoff, incompatible framing, anomaly, or open interpretive fork.
- **Question tile:** learner-authored or source-authored question, with status: unanswered, partially answered, answered-by-source, answered-by-model, or deliberately open.
- **Evidence tile:** observation, dataset, citation, experiment, proof sketch, historical fact, or testimony. Evidence strength is represented textually, never by color alone.
- **Genealogy tile:** predecessor, influence, historical context, derivative, or response.
- **Authoring artifact:** learner-created route, room, grouping, snapshot, comparison, note, or model.

### Spatial primitives and legal semantics

- **Nearness:** declared relation selected from same source, same mechanism, evidential relation, historical descent, learner grouping, prerequisite, or unresolved comparison. No untyped nearness.
- **Size:** one declared scalar: source coverage, learner attention, evidential centrality, or abstraction level. Never “importance” without explaining by whose criterion.
- **Elevation/depth:** abstraction layer: quote → example → concept → mechanism → theory → worldview. If a camera zoom changes elevation, object labels must change accordingly.
- **Roads:** routes of recommended traversal, dependency, or argumentative flow. A road must be named and inspectable.
- **Rooms/regions:** scoped workspaces with an entry question and exit artifact. A room is not a category unless its boundary condition is explicit.
- **Fog/frontier:** known unknowns: source gap, unresolved question, unvisited branch, untested assumption, or learner-declared “not yet understood.” Fog never hides available source merely to create suspense.
- **Landmarks:** stable, persistent anchors: central problem, canonical example, key mechanism, author thesis, or user’s home base. Landmarks may not move automatically.
- **Edges:** explicit labeled propositions with support spans and confidence/author status.
- **Snapshots:** named saved states of layout, filters, selected sources, camera, and learner claims. Snapshots are citable objects.

## Candidate interaction grammar

| Interaction | Encoded truth | Learner benefit | Failure risk | Accessibility and list fallback |
|---|---|---|---|---|
| **Pan** | The knowledge space exceeds the current viewport; lateral motion preserves the same abstraction level. | Supports spatial memory and “spread out” comparison without losing context. | Endless canvas drift; users confuse location with relevance. | Arrow-key and screen-reader region navigation; list view exposes current region, neighboring regions, and “return to last landmark.” |
| **Zoom** | Movement between levels of granularity: source shard, example, concept, mechanism, theory, atlas. | Lets readers alternate detail and overview, like semantic focus rather than modal page changes. | Decorative zoom that hides information unpredictably; nausea or orientation loss. | Stepwise zoom controls, reduced-motion mode, breadcrumb of abstraction level; list view groups items by level. |
| **Stable landmarks** | Certain objects are durable orienting anchors: central question, canonical source, key mechanism, or learner home base. | Builds cognitive map; reduces fear of exploration. | Landmarks become arbitrary mascots or oversized “cool” icons. | Landmark index with quick-jump keys; text labels include why each landmark is stable. |
| **Roads** | A declared traversable relation: prerequisite path, historical route, argument flow, or learner-authored itinerary. | Gives guidance without collapsing the map into one sequence. | False linearity; learners assume the road is the only valid reading. | Ordered route list with relation labels, source spans, and alternatives at each fork. |
| **Rooms** | A bounded inquiry context with an entry question, working materials, and expected exit artifact. | Makes serious work feel place-like: evidence room, mechanism lab, argument chamber, comparison table. | Room metaphor becomes arbitrary category boxes; hidden cross-room dependencies. | Room outline: purpose, contents, incoming/outgoing relations, unresolved questions. |
| **Fog/frontiers** | A boundary of known unknowns: missing source, unvisited branch, unresolved contradiction, or untested assumption. | Makes inquiry state visible and invites purposeful exploration. | Manipulative game fog that withholds known material to create artificial progression. | Frontier ledger sorted by question, source gap, or dependency; each item has “why hidden/unknown.” |
| **Routes/quests** | A task is meaningful because it produces an inquiry artifact: answer a question, compare interpretations, test a mechanism, build a model. | Converts game quest grammar into scaffolded knowledge work. | Badge treadmill; completion replaces understanding. | Checklist view with artifacts, source evidence, and optional “skip/explain why” path. |
| **Minimap** | A compressed topology of landmarks, active room, roads, frontier, and selected filters. | Maintains orientation during pan/zoom and supports strategic planning. | Pretty radar with no semantic labels; inaccessible color-only status. | Textual table: current location, nearest landmarks, open roads, fogged frontiers, active filters. |
| **In-place expansion** | A compact object can unfold to reveal source quote, examples, assumptions, mechanism steps, or competing readings without leaving context. | Lowers cost of curiosity; preserves place while deepening. | Popover clutter; “accordion hell” where expanded states become unmanageable. | Expand/collapse keyboard controls; list item has nested sections and “open source context.” |
| **Object manipulation** | Moving, resizing, annotating, or pinning is a learner-authored claim about relation, attention, or working state. | Makes thinking tactile: learners construct knowledge structures rather than only read them. | Users mistake physical movement for objective truth; accidental drags corrupt meaning. | Every manipulation creates an undoable ledger entry: “user moved X near Y because …”; keyboard move/group commands. |
| **Grouping** | A cluster means one declared relation: shared source, same mechanism, analogy set, tension set, learner hypothesis, or work-in-progress pile. | Supports constructive ambiguity and evolving visual language. | Unlabeled piles become private, unrecoverable meaning. | Group list with title, relation type, members, provenance, and optional ambiguity flag. |
| **Edge labeling** | A link is a proposition, not a decoration: supports, rebuts, motivates, exemplifies, operationalizes, depends on, descends from, tensions with. | Clarifies why objects are connected and supports argument critique. | Hairball diagrams; labels too small; relation vocabulary overfits. | Edge table sorted by source/target/relation; each edge opens evidence quote and author. |
| **Snapshots** | A named state of interpretation at a moment: layout, camera, filters, selected route, learner claims, and source versions. | Lets learners compare before/after understanding and cite a view. | Snapshot spam; false sense that a snapshot is the source itself. | Snapshot list with timestamp, author, changed claims, and source version ids. |
| **Comparison** | Two or more objects/views are intentionally held together under a comparison question and dimensions. | Supports argument evaluation, mechanism contrast, and historical genealogy. | Split-screen as mere layout; cherry-picked dimensions. | Comparison matrix with rows as dimensions and cells linked to source spans; screen-reader announces differences. |
| **Semantic camera transitions** | A transition has a named relation: zoom to evidence, follow genealogy, descend to mechanism, widen to context, jump to contradiction. | Preserves orientation and teaches the structure of inquiry through movement. | Cinematic flourish, motion sickness, and hidden state changes. | Reduced-motion crossfade; transition log states “from X to Y by relation R.” |

## Three cohesive world metaphors for prototyping

### 1. Atlas of Inquiry: the cartographic field

**Best for:** broad conceptual development across sources, genealogy, examples, and open questions.

**Core metaphor.** Knowledge is a navigable atlas. Continents are domains or traditions; districts are mechanisms or problem families; landmarks are canonical examples or central questions; roads are reading/inquiry routes; fog marks known unknowns and unvisited source territory.

**Spatial semantics.**

- Distance means declared relation strength within the active map layer, never generic similarity.
- Borders mean interpretive boundary: tradition, author, method, or learner-declared frame.
- Roads mean traversal relation: historical sequence, prerequisite, or recommended inquiry route.
- Landmarks are stable anchors: source thesis, key example, or central problem.
- Fog means unresolved or unvisited, with reason inspectable.

**Prototype scene.** A learner studying “enabling environments” begins at a central landmark: Matuschak’s definition. A road branches to “games as scaffolding,” another to “Dynamicland as place,” another to “constructionism as making.” Fog appears over “empirical evidence for transfer” because no cited source yet supports it. The learner opens a mechanism district for “scaffold → creative action,” compares Minecraft and Dynamicland, then snapshots a route called “from game grammar to authoring environment.”

**Why it avoids decoration.** The atlas is useful only because every cartographic element corresponds to a declared inquiry relation. Mountains, rivers, and terrain are not aesthetic skins unless they encode source density, abstraction depth, or unresolved tension.

### 2. Argument World: the campaign map of claims, evidence, and tensions

**Best for:** serious argument exploration beyond axiomatic premise trees.

**Core metaphor.** An argument is a contested territory with supply lines, fronts, strongholds, unresolved borderlands, and observation posts. The point is not combat fantasy; it is strategic visibility into what each claim depends on, what evidence supplies it, where tensions accumulate, and where the learner can intervene.

**Spatial semantics.**

- Strongholds are central claims with multiple evidence supplies.
- Supply lines are labeled evidence/mechanism dependencies; a broken line means unsupported or contradicted.
- Fronts are tensions: competing interpretations, anomalies, or open questions.
- Observation posts are source shards that let the learner inspect exact wording.
- Routes are critique paths: “test assumption,” “trace genealogy,” “find counterexample,” “compare models.”

**Prototype scene.** Victor’s claim that text should be an “environment to think in” sits as a stronghold. Evidence lines connect to reactive documents, explorable examples, and contextual lookup. A front appears where the 2024 postscript rejects broad pedagogical widgets as insufficient. The learner drags a Matuschak note onto the front: enabling environments are about expanded capacity, not aesthetic experience. The system creates a tension tile: “fun exploration vs serious capacity.” The learner builds a critique route that tests each proposed interaction against this tension.

**Why it avoids decoration.** Strategy-game grammar is restricted to dependency, evidence, conflict, and intervention. There are no points, enemies, damage meters, or fake conquest. “Victory” means a citable comparison, revised claim, or clarified open question.

### 3. Construction Studio: the workshop of manipulable ideas

**Best for:** learner-authored synthesis, model building, mechanism construction, and comparison of alternatives.

**Core metaphor.** Knowledge objects are materials on benches. Rooms are studios for different kinds of making: evidence bench, mechanism bench, analogy bench, genealogy wall, question shelf, comparison table. Tools transform source shards into derived concepts, mechanisms, models, and routes while preserving provenance.

**Spatial semantics.**

- Benches are task contexts, not categories: compare, model, quote, critique, group, rehearse.
- Tools encode allowed transformations: quote → concept, examples → mechanism, claims → argument route, questions → frontier.
- Object placement on a bench means current working role.
- Grouping means learner-authored hypothesis or material pile, marked as provisional until promoted.
- Snapshots are studio states, like saving a workbench before trying a destructive rearrangement.

**Prototype scene.** The learner drags Papert’s “learning-by-making” quote, Dynamicland’s “everyone is an author,” and Matuschak’s “capacity to do things” onto a construction bench. They assemble a mechanism: tactile manipulation → authored artifact → public/revisable structure → expanded inquiry capacity. They then place Victor’s warning about sandbox widgets beside it as a constraint. The artifact becomes a mechanism tile linked to all source shards and can be moved into Atlas or Argument World.

**Why it avoids decoration.** The studio metaphor earns itself because the learner is literally constructing public knowledge artifacts with source-linked materials. It does not pretend reading is crafting; it gives crafting operations real epistemic consequences.

## Cross-prototype rules

### Atlas of Inquiry

- Prioritize stable orientation: landmarks, minimap, named regions, and reversible semantic camera moves.
- Good default objects: central questions, genealogies, examples, mechanisms, open questions.
- Avoid graph-engine default force layouts; they erase authored spatial claims.
- Use fog only for genuine source gaps, unresolved questions, or unvisited but available branches.

### Argument World

- Every road/edge must have a relation label and evidence pointer.
- Allow tensions to be first-class objects; do not force all contradictions into support/rebut edges.
- Model assumptions and mechanisms near claims; do not collapse argument into premise trees.
- Comparison view is mandatory for competing interpretations.

### Construction Studio

- Every transformation must preserve source recovery.
- Make learner-authored structure visible: “Arthur grouped these as mechanism candidates,” not “the system discovered a cluster.”
- Support partial, ambiguous piles, but require a label before sharing or snapshotting.
- Provide undo/history because manipulation is meaning-bearing.

## Accessibility baseline

- Full keyboard operation for pan, zoom, selection, grouping, edge creation, room entry/exit, route traversal, and snapshotting.
- Reduced-motion mode replaces camera travel with labeled crossfades and focus movement.
- Non-color encodings for all status: text labels, icons with labels, line style, and list fields.
- Every spatial view has a synchronized list ledger: objects, groups, rooms, roads, edges, frontiers, snapshots, and comparisons.
- Screen-reader announcements state semantic changes: “entered Evidence Room,” “zoomed from mechanism to source quote,” “created learner-authored grouping.”
- Spatial coordinates are never the only store of meaning; all relations are serialized as explicit semantic records.

## Anti-patterns to reject

- Decorative biomes, weather, avatars, particle effects, or rewards that do not encode inquiry state.
- Force-directed node-link maps without authored spatial semantics.
- Premise-tree argument diagrams that cannot represent motivation, historical development, examples, mechanisms, and tensions.
- Fog of war that hides accessible source merely to create suspense.
- Quest chains that reward clicking through material rather than producing an artifact.
- “Fun sandbox” widgets with no authored structure or source recovery.
- Edge colors without labels and evidence.
- Auto-layout that destroys learner-authored placement without an explicit diff and restore option.

## Minimal data contract for derived objects

```ts
type Provenance = {
  sourceId: string;
  sourceUrl?: string;
  sourceType: "primary" | "secondary" | "working-note" | "book-chapter" | "paper" | "local-artifact";
  retrievedAt: "2026-07-11";
  quote?: string;
  span?: { start?: string; end?: string };
  derivedBy: "source" | "system" | "learner";
  transform: string;
};

type SpatialObject = {
  id: string;
  kind: "source-shard" | "concept" | "mechanism" | "example" | "motivation" | "tension" | "question" | "evidence" | "genealogy" | "authoring-artifact";
  title: string;
  body: string;
  provenance: Provenance[];
  spatialSemantics: {
    region?: string;
    sizeMeans?: "source-coverage" | "learner-attention" | "evidential-centrality" | "abstraction-level";
    proximityMeans?: "same-source" | "shared-mechanism" | "historical-descent" | "evidential-relation" | "learner-grouping" | "prerequisite" | "unresolved-frontier";
    abstractionLevel?: "quote" | "example" | "concept" | "mechanism" | "theory" | "worldview";
  };
};

type SpatialRelation = {
  id: string;
  from: string;
  to: string;
  relation: "supports" | "rebuts" | "motivates" | "exemplifies" | "operationalizes" | "depends-on" | "descends-from" | "tensions-with" | "asks" | "learner-groups";
  label: string;
  provenance: Provenance[];
  confidence?: "source-stated" | "system-inferred" | "learner-hypothesis" | "contested";
};
```

This contract keeps spatial tactility honest: the world can feel like a map, strategy space, or workshop, but every move remains an inspectable knowledge claim rather than scenery.

## Source list

- Bret Victor, “Explorable Explanations,” primary essay/project statement, https://worrydream.com/ExplorableExplanations/, retrieved 2026-07-11.
- Dynamicland, “Dynamicland” 2017 website, primary institutional statement, https://dynamicland.org/2017/Website/, retrieved 2026-07-11.
- Dynamicland, “Dynamicland publications,” source index, https://dynamicland.org/publications/, retrieved 2026-07-11.
- Andy Matuschak, “Enabling environment,” working note, https://notes.andymatuschak.org/z492hGrHvRvJiEY9UfB4Mby, retrieved 2026-07-11.
- Andy Matuschak, “Most games aren’t enabling environments,” working note, https://notes.andymatuschak.org/zS7EYYnBEDPVcYdqCRTCi5Q, retrieved 2026-07-11.
- Frank M. Shipman III and Catherine C. Marshall, “Spatial Hypertext: An Alternative to Navigational and Semantic Links,” ACM Computing Surveys 31(4), December 1999, https://cs.brown.edu/memex/ACM_HypertextTestbed/papers/37.html, retrieved 2026-07-11.
- Benjamin B. Bederson and James D. Hollan, “Pad++: A Zoomable Graphical Interface System,” CHI conference paper PDF, https://www.cs.umd.edu/~bederson/images/pubs_pdfs/p23-bederson.pdf, retrieved 2026-07-11.
- Seymour Papert and Idit Harel, “Situating Constructionism,” book chapter, http://www.papert.org/articles/SituatingConstructionism.html, retrieved 2026-07-11.
