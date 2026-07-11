# Representation landscape for Primer inquiry-world

Retrieval date for every external source below: 2026-07-11.

## Hard stance

Primer should not build a generic semantic geography where embeddings decide where things live. It should also reject unlabeled edges. A learner should be able to ask of every mark: what does this position, size, color, boundary, or edge mean, and what authored source supports it? If there is no answer, the mark is decoration or a hidden model opinion.

Every derived object should carry provenance: source URL or local source id, quoted span or source range, transformation note, confidence, author/user/system attribution, and the representation grammar that licensed the derivation. Spatial proximity can be a claim only when the grammar says what proximity means: prerequisite distance, temporal nearness, analogy, contradiction, evidential co-citation, mechanism adjacency, or learner-authored association.

Legend used below:
- **[EVIDENCE]** = directly grounded in the cited source.
- **[INFERENCE]** = design implication for Primer from source semantics and Primer’s observed data shape.

## Source anchors

- **Concept maps.** Alberto J. Cañas and Joseph D. Novak, “What is a Concept Map?”, IHMC Cmap, web page. Canonical URL: https://cmap.ihmc.us/docs/conceptmap.php. Exact wording: “Concept maps are graphical tools for organizing and representing knowledge”; “Words on the line, referred to as linking words or linking phrases, specify the relationship between the two concepts”; “Every concept map responds to a focus question.”
- **Argument maps.** Martin Davies, Ashley Barnett, and Tim van Gelder, “Using Computer-Aided Argument Mapping to Teach Reasoning,” open textbook chapter. Canonical URL: https://ecampusontario.pressbooks.pub/criticalthinking1234/chapter/introduction/. Exact wording: “Argument mapping is a way of diagramming the logical structure of an argument to explicitly and concisely represent reasoning”; “argument mapping is principally concerned with inferential or logical relationships between claims.”
- **Dependency DAGs.** NetworkX guide, “Directed Acyclic Graphs & Topological Sort.” Canonical URL: https://networkx.org/nx-guides/content/algorithms/dag/index.html. Exact wording: “A directed edge (u, v) in the example indicates that garment u must be donned before garment v”; “Dependency graphs without circular dependencies form DAGs”; “a topological sort gives an order in which to perform the jobs.”
- **Causal graphs.** Philip Dawid, “What Is a Causal Graph?”, arXiv:2402.09429v1. Canonical URL: https://arxiv.org/html/2402.09429v1. Exact wording: “there is no necessary relationship between a geometric object, such as a graph, and a probabilistic or causal model”; “Any such relationship must therefore be specified externally”; “It is important to distinguish between the syntax of a graph … and its semantics.”
- **Time-oriented visualization.** Wolfgang Aigner, Silvia Miksch, Heidrun Schumann, and Christian Tominski, Visualization of Time-Oriented Data, Springer open-access book. Canonical URL: https://link.springer.com/book/10.1007/978-1-4471-7527-8. Exact wording: “Time is an exceptional dimension with high relevance in medicine, engineering, business, science, biography, history, planning, or project management”; the book gives a “Structured survey of more than 150 classic and contemporary visualization techniques.”
- **Spatial hypertext.** Frank M. Shipman III and Catherine C. Marshall, “Spatial Hypertext: An Alternative to Navigational and Semantic Links.” Canonical URL: https://cs.brown.edu/memex/ACM_HypertextTestbed/papers/37.html. Exact wording: “Users avoided the explicit linking mechanisms in favor of the more implicit expression of relationships through spatial proximity and visual attributes”; spatial hypertext supports “constructive ambiguity”; “placement of a node close but not quite with others can imply some indecision or potential for a relation.”
- **IBIS/gIBIS.** Hypermedia review chapter, “Decision Support Systems and Issue Based Information Systems,” summarizing gIBIS. Canonical URL: https://luon.net/~paul/hypermedia/chapter7/supportInfoSystems.html. Exact wording: “Issue Based Information Systems (IBIS) help members of a project team discuss issues related to a problem and come to a consensus on a solution”; “participants … argue about design issues by taking positions and making arguments for and against those positions”; represented with “three types of nodes: issues, positions, and arguments.” Primary bibliographic root: Werner Kunz and Horst W. J. Rittel, Issues as Elements of Information Systems, 1970; eScholarship canonical page https://escholarship.org/uc/item/5cj786v8 was human-verification gated during retrieval, so quoted wording above is from the accessible secondary hypermedia review.
- **Executable/reactive explanations.** Bret Victor, “Explorable Explanations.” Canonical URL: https://worrydream.com/ExplorableExplanations/. Exact wording: “A reactive document allows the reader to play with the author’s assumptions and analyses, and see the consequences”; “The reactive document integrates spreadsheet-like models into authored text”; “the explorable is integrated with the explanation”; “Those are not explanations” for widgets that dump the user into a sandbox.
- **Statecharts.** Statecharts.dev, “What is a statechart?” Canonical URL: https://statecharts.dev/what-is-a-statechart.html. Exact wording: “states can be organized in a hierarchy”; statecharts “react to events”; “A compound state can be split up into completely separate (‘orthogonal’) regions”; “Transitions can be guarded.” Primary bibliographic root: David Harel, “Statecharts: A Visual Formalism for Complex Systems,” 1987; Harel’s PDF was retrieved from https://www.weizmann.ac.il/math/harel/sites/math.harel/files/users/user50/Statecharts.pdf but text extraction was unavailable in this harness.
- **BPMN/process maps.** Camunda BPMN 2.0 symbol reference. Canonical URL: https://camunda.com/en/bpmn/reference/. Exact wording: “In BPMN, you can answer this question with lanes”; “BPMN calls this form of visualization a collaboration diagram. It shows two independent processes collaborating”; a subprocess “describes a detailed sequence” while taking “no more space in the diagram of the parent process than does a task.” Primary standard root: Object Management Group, BPMN 2.0.
- **Web annotation/atlases.** W3C Web Annotation Data Model. Canonical URL: https://www.w3.org/TR/annotation-model/. Exact wording from abstract: “a structured model and format to enable annotations to be shared and reused across different hardware and software platforms.”
- **Conceptual/contrast spaces.** Peter Gärdenfors, Conceptual Spaces: The Geometry of Thought, MIT Press canonical page https://mitpress.mit.edu/9780262572194/conceptual-spaces/ was blocked by 403; source search excerpt from MIT Press described “geometrical structures based on a number of quality dimensions.” [INFERENCE] Treat this family as a design lineage, not a quoted primary source, until a clean copy is archived.
- **Matrices.** Jacques Bertin’s reorderable matrix lineage; accessible source search pointed to Inria/HAL summary and dataphys.org notes. [INFERENCE] Use as a design lineage for explicit row-column relation spaces; do not claim direct Bertin wording until archived.
- **Coordinated multiple views.** Jonathan C. Roberts and related CMV literature; accessible source search for “Coordinated & Multiple Views in Exploratory Visualization” identified linked views, and North/Shneiderman Snap-Together Visualization reported overview/detail performance benefits in accessible search excerpts. [INFERENCE] Use as a design lineage for linked selections, not as pedagogical proof for Primer.

## Representation families

### 1. Concept maps with linking phrases

- **Core semantics.** [EVIDENCE] Nodes are concepts; edges are not generic links but propositions completed by concise linking phrases, often verbs. Hierarchical placement usually means general-to-specific, top-to-bottom, but IHMC explicitly warns that a concept map does not have to be graphically hierarchical. Cross-links mean relationships across domains.
- **Geometry / size / edge grammar.** Edge label is mandatory and forms a readable sentence: Concept A — linking phrase — Concept B. Vertical position may encode conceptual generality only when the map declares that convention. Node size should encode learner/source salience only if backed by counts or authored priority; otherwise keep size uniform. Spatial clusters may encode subdomains named by the learner or source.
- **Learning question answered.** “What propositions do I currently believe about this domain, and which focus question do they answer?”
- **Tactile interactions.** Drag a concept under a broader one; type the linking phrase before an edge can be saved; read aloud a path as sentences; highlight cross-links; switch focus question and gray propositions that no longer answer it; promote a source quote into a concept or proposition.
- **Strengths.** Captures conceptual development better than a mind map because relationships are verbalized. Supports novice-to-expert comparison through missing propositions and weak linking phrases.
- **Epistemic risks.** False fluency: a neat proposition may hide weak evidence. Hierarchy can imply settled taxonomy when the source is exploratory. Propositions spanning too many concepts become unreadable.
- **Fit for Primer real data.** Strong for commentary-reader extracts: concepts, definitions, distinctions, and “X matters because Y” claims can become recoverable propositions. Good for Atlas of Inquiry overview and Construction Studio authoring. Poor for adversarial argument validity unless paired with argument maps.

### 2. Argument maps

- **Core semantics.** [EVIDENCE] Nodes are claims; grouped reasons support a conclusion; objections oppose claims or inferences; linked premises can function together as co-premises. The grammar is inferential, not associational.
- **Geometry / size / edge grammar.** Top position commonly encodes main conclusion; green/support and red/oppose may encode polarity. Edges encode inferential support/attack, not topical relatedness. Group envelopes encode premises that must work together. Edge thickness may encode assessed strength only when derived from explicit evaluation, not model confidence.
- **Learning question answered.** “What would have to be true for this conclusion to stand, and where can I attack it?”
- **Tactile interactions.** Split a prose paragraph into atomic claims; drag claims into co-premise envelopes; flip support to objection; attach evidence endpoints; collapse subarguments; test “if this premise fails, what conclusions lose support?”
- **Strengths.** Makes disagreement tractable and depersonalized. Excellent for Argument World because it exposes inference steps and objections.
- **Epistemic risks.** Can over-axiomatize texts that are actually building intuition or motivation. It may amputate examples, historical genealogy, and mechanisms if every object must become a premise.
- **Fit for Primer real data.** Use for explicit claims, objections, and warrants in commentary. Do not force exploratory annotations into argument form; route them to concept development, genealogy, or evidence neighborhoods.

### 3. Dependency DAGs and prerequisite graphs

- **Core semantics.** [EVIDENCE] Directed edge means u must precede v or v depends on u; cycles are disallowed when the graph is a DAG; topological sort gives a feasible order.
- **Geometry / size / edge grammar.** Direction encodes prerequisite, dependency, or build-before relation. Layers encode topological generations: all prerequisites satisfied by earlier layers. Size may encode effort, uncertainty, or number of dependent downstream items if declared.
- **Learning question answered.** “What must I understand, read, or build before this object makes sense?”
- **Tactile interactions.** Ask “why is this locked?”; reveal unmet prerequisites; reorder a reading path and surface cycle errors; compare system-suggested order with learner-authored order; mark a dependency as hard prerequisite vs helpful background.
- **Strengths.** Produces actionable routes through source material. Good for staged learning and Construction Studio build plans.
- **Epistemic risks.** Dependency is often softer than the graph implies. A DAG cannot represent reciprocal co-development without either cycles or a different primitive. Topological order may become an authority claim.
- **Fit for Primer real data.** Strong for “read this before that,” definitions before usage, and implementation prerequisites. Weak for dialectical or historical influence unless separate edge types are declared.

### 4. Causal and mechanism diagrams

- **Core semantics.** [EVIDENCE] Dawid’s warning is central: graph syntax and causal semantics are different things; interpretation must be externally specified. Causal/mechanism diagrams should encode variables, interventions, mechanisms, conditions, and evidential status, not merely arrows that feel causal.
- **Geometry / size / edge grammar.** Directed edge encodes declared causal influence, mechanism step, enabling condition, inhibitory relation, or evidence-supported association. Use distinct glyphs: causes, mediates, moderates, enables, inhibits, observes, intervenes. Node type distinguishes variable, process, actor, material substrate, and observation. Spatial grouping can encode mechanism module.
- **Learning question answered.** “What is supposed to make this happen, through which intermediate mechanism, and under what conditions?”
- **Tactile interactions.** Toggle observational vs interventional evidence; simulate perturbing a variable; expand a mechanism edge into steps; attach source quotes to mechanism claims; ask “what would falsify this edge?”
- **Strengths.** Represents mechanisms and conditions that argument maps flatten. Helps learners inspect causal overreach.
- **Epistemic risks.** Arrows invite reification. Correlation can masquerade as cause. Mechanism diagrams can imply quantitative precision they do not have.
- **Fit for Primer real data.** Useful where sources explain systems, institutions, models, or cognitive processes. Require explicit edge semantics and evidence labels; never infer causal geography from embeddings.

### 5. Timelines and genealogical rivers

- **Core semantics.** [EVIDENCE] Time-oriented visualization is a large family because time matters for “science, biography, history, planning, or project management.” Events, periods, lineages, and branching influence should be distinct.
- **Geometry / size / edge grammar.** Horizontal or vertical position encodes time. Width encodes duration; branching encodes descent, influence, or divergence only when labeled; river thickness may encode volume of citations, adoption, or corpus frequency. Color bands can encode tradition or domain.
- **Learning question answered.** “How did this idea, controversy, or artifact develop, and what came before what?”
- **Tactile interactions.** Scrub time; braid sources into lineages; split a river when a concept forks; inspect anachronism warnings; drag a quote onto a date with provenance; compare publication date, claimed historical period, and learner encounter date.
- **Strengths.** Restores genealogy, priority, and historical contingency. Excellent for Atlas of Inquiry when concepts were not born simultaneously.
- **Epistemic risks.** Rivers imply smooth continuity and causal descent. Timelines can privilege what is datable over what is conceptually important.
- **Fit for Primer real data.** Strong if commentary-reader has source dates and references. Needs missing-date handling and uncertainty bands.

### 6. Contrast spaces and conceptual dimensions

- **Core semantics.** [INFERENCE grounded in conceptual-spaces lineage] Axes are named quality dimensions selected by an author or learner: formal/informal, descriptive/normative, mechanistic/phenomenological, novice/expert, concrete/abstract. Position means degree along declared dimensions, not embedding similarity.
- **Geometry / size / edge grammar.** X/Y axes must be labeled with endpoints and units or ordinal criteria. Distance means contrast under those axes only. Regions encode families or prototypes. Edges can encode “contrasts with,” “bridges,” or “moves toward.”
- **Learning question answered.** “What are the important distinctions in this domain, and where does this source sit relative to alternatives?”
- **Tactile interactions.** Pick axes from source-derived distinctions; drag an idea and state why; show contested placements; overlay examples; rotate from one pair of dimensions to another; annotate a boundary case.
- **Strengths.** Represents intuition, contrast, and family resemblance without pretending every relation is a premise.
- **Epistemic risks.** Axis choice is powerful and subjective. Two-dimensional layout can erase higher-dimensional nuance. Users may mistake a design lens for objective ontology.
- **Fit for Primer real data.** Good for learner-authored structure and comparing interpretations. Require each axis to be declared and optionally backed by source phrases.

### 7. Matrices and reorderable tables

- **Core semantics.** [INFERENCE grounded in Bertin/reorderable matrix lineage] Rows and columns are typed sets; cells encode explicit relationships, attributes, evidence, or ratings. Reordering is analysis, not decoration.
- **Geometry / size / edge grammar.** Row position and column position encode membership in two ordered sets. Cell mark encodes relation value: present/absent, strength, type, quote count, agreement, contradiction. Clusters emerge from row/column ordering and must be labeled before treated as claims.
- **Learning question answered.** “Which concepts, sources, claims, or examples share which attributes, and where are the gaps?”
- **Tactile interactions.** Sort rows by chronology, author, confidence, or learner priority; pivot claims × sources; brush cells to reveal quotes; mark unknown vs not-applicable; promote a column into a concept-map proposition.
- **Strengths.** Excellent for comparison, coverage audits, and evidence matrices. Prevents vague spatial association by forcing typed dimensions.
- **Epistemic risks.** Sparse cells can be misread as absence rather than uncollected evidence. Numeric-looking encodings can imply measurement where there is only judgment.
- **Fit for Primer real data.** Very strong for Primer’s source-grounded claims, annotations, cards, and evidence coverage. Use in Construction Studio as a workbench primitive.

### 8. State machines and statecharts

- **Core semantics.** [EVIDENCE] States can be hierarchical; transitions react to events; guards condition transitions; orthogonal regions encode concurrent substates.
- **Geometry / size / edge grammar.** Node/container = state. Nesting = substate hierarchy. Edge = transition on event, optionally guarded by condition and producing action. Parallel lanes/regions = simultaneously active state machines. Size should not encode importance unless declared.
- **Learning question answered.** “What mode is this system or learner in, what can happen next, and what conditions change the path?”
- **Tactile interactions.** Step through events; hover to see guards; run a scenario; collapse/expand compound states; compare actual learner path with authored expected path; attach source quote to each transition rule.
- **Strengths.** Great for interactive prototypes, reader modes, annotation lifecycles, and conceptual processes with thresholds.
- **Epistemic risks.** Discrete states can oversimplify gradual understanding. Guards may look deterministic even when evidence is interpretive.
- **Fit for Primer real data.** Strong for Construction Studio workflows and learner-authored exploration states. Use sparingly for conceptual content unless state transitions are explicit in the source.

### 9. Process maps and swimlane diagrams

- **Core semantics.** [EVIDENCE] Lanes answer who is responsible; BPMN collaboration diagrams show independent processes collaborating; subprocesses encapsulate detail.
- **Geometry / size / edge grammar.** Horizontal sequence encodes process order; lanes encode responsibility or system/actor; gateways encode branching logic; message flows encode inter-participant communication; collapsed subprocesses encode available detail behind a compact node.
- **Learning question answered.** “Who does what, in what order, with what handoffs, decisions, and exceptions?”
- **Tactile interactions.** Follow the token; expand a subprocess; switch lane labels from person to role to tool; inspect exception paths; annotate a handoff with evidence or learner friction.
- **Strengths.** Represents mechanisms in procedural domains and keeps actors visible. Better than a generic graph for workflows.
- **Epistemic risks.** BPMN formality can overfit human inquiry into business-process logic. Sequence diagrams can erase reflection, backtracking, and discovery.
- **Fit for Primer real data.** Good for modeling Primer/reader workflows, research routines, and authoring processes. Less appropriate for philosophical or literary conceptual landscapes unless the source describes a process.

### 10. Spatial hypertext workspaces

- **Core semantics.** [EVIDENCE] Spatial proximity and visual attributes can express implicit, transient relationships; ambiguity is a feature when interpretation is forming.
- **Geometry / size / edge grammar.** Proximity means “possibly related under the current workspace lens,” not semantic truth. Color, shape, border, and piles are learner-authored cues whose legend can evolve. Ambiguous placement is allowed but must be tagged as provisional.
- **Learning question answered.** “What am I gathering, comparing, and not yet ready to formalize?”
- **Tactile interactions.** Pile notes; nudge a card near but not into a cluster; lasso and name emergent groups; convert a spatial group into a concept map, matrix, or argument map; preserve abandoned arrangements as inquiry history.
- **Strengths.** Supports intuition, motivation, and early-stage sensemaking better than rigid schemas. Lets learner-authored structure exist before formalization.
- **Epistemic risks.** Private visual language can become illegible. Proximity may silently harden into an asserted relation. A screenshot is not provenance.
- **Fit for Primer real data.** Excellent as the “pre-formal” surface in Construction Studio and Atlas of Inquiry. Must include legends and promotion paths into typed primitives.

### 11. Issue-Based Information Systems (IBIS)

- **Core semantics.** [EVIDENCE] Issues/questions organize inquiry; positions answer issues; arguments support or oppose positions. The unit is a design or policy question, not a topic blob.
- **Geometry / size / edge grammar.** Issue node = question; position node = candidate answer; argument node = pro/con support. Edges are typed: responds-to, supports, objects-to, raises. Clusters encode issue neighborhoods.
- **Learning question answered.** “What question are we trying to resolve, what positions exist, and what reasons have been offered?”
- **Tactile interactions.** Open a new issue from a confusing quote; attach positions; add pro/con arguments; mark accepted, parked, or unresolved; navigate from an argument to the source passage.
- **Strengths.** Keeps inquiry question-centered and handles open questions better than an argument tree alone.
- **Epistemic risks.** Consensus framing can underplay productive pluralism. Prematurely phrasing everything as a resolvable issue may distort exploratory learning.
- **Fit for Primer real data.** Strong for Argument World and Atlas open-question layers. Pair with source quotes and status labels: answered by source, learner question, disputed by source, system-suggested.

### 12. Executable/reactive diagrams and explorable explanations

- **Core semantics.** [EVIDENCE] A reactive document lets readers play with assumptions and see consequences; the model is integrated into authored text; the author still guides the explanation.
- **Geometry / size / edge grammar.** Controls encode variables/assumptions; linked outputs encode computed consequences; visual marks update under a declared model. Edges encode dataflow, formula dependency, or causal/model dependency, not general association.
- **Learning question answered.** “If I change this assumption, parameter, or interpretation, what follows?”
- **Tactile interactions.** Drag parameters inline; edit a model cell; compare two authors’ models; reveal formulas; reset to source default; annotate a surprising consequence; fork a learner scenario.
- **Strengths.** Represents mechanism, tradeoff, and intuition through action. Makes assumptions inspectable.
- **Epistemic risks.** Executability can create false authority. A model can be transparent yet wrong. Widgets without authorial guidance are sandboxes, not explanations.
- **Fit for Primer real data.** High-value for Construction Studio when a source contains quantities, causal models, or operational definitions. Do not fake execution for purely qualitative claims; instead use state/process/argument primitives.

### 13. Annotated maps and atlases

- **Core semantics.** [EVIDENCE] Web Annotation’s model is meant to make annotations shared and reused across platforms. For Primer, an atlas page is a base layer plus anchored annotations and overlays. The base layer might be text, time, source genealogy, concept space, or mechanism diagram.
- **Geometry / size / edge grammar.** Base coordinates must be declared. Pins/annotations point to exact source ranges, regions, events, or derived objects. Overlay opacity can encode layer visibility, not truth. Annotation type distinguishes definition, objection, example, motivation, evidence, question, and learner note.
- **Learning question answered.** “Where in the source-world did this interpretation come from, and what layers can I place over it?”
- **Tactile interactions.** Pin a quote; trace from derived node back to source; toggle evidence/motivation/examples; compare learner and author layers; export a path through the atlas.
- **Strengths.** Keeps the authored source recoverable and supports multiple lenses without forcing one master graph.
- **Epistemic risks.** Atlas metaphors can imply territorial completeness. Too many overlays become visual noise. Pins without typed annotation are just bookmarks.
- **Fit for Primer real data.** Essential infrastructure for all three prototypes. Atlas of Inquiry should use this as provenance substrate, not just visual style.

### 14. Coordinated multiple views

- **Core semantics.** [INFERENCE grounded in CMV literature] Multiple views show the same source-grounded objects under different grammars; selection in one view highlights corresponding objects in others. Coordination relation itself is typed: same object, derived-from, cites, contradicts, answers, prerequisite-of.
- **Geometry / size / edge grammar.** Each pane owns its own geometry semantics. Cross-view brushing encodes identity or declared correspondence. Size/color scales must be local to a view or globally declared.
- **Learning question answered.** “How does the same material look as argument, genealogy, evidence, mechanism, and learner workspace?”
- **Tactile interactions.** Brush a claim in an argument map and see source quote, concept proposition, timeline event, and evidence matrix cell; pin views side by side; save a composed investigative layout; define a custom correspondence.
- **Strengths.** Avoids twelve disconnected tabs while preserving specialized grammars. Lets learners move from intuition to formal structure without losing provenance.
- **Epistemic risks.** Cross-highlighting can imply equivalence when the relation is derivation or analogy. Cognitive overload if views compete.
- **Fit for Primer real data.** Strongest architectural pattern: Primer data is heterogeneous. Coordinated views let one source object participate in several epistemic roles.

## Cross-family selection guide

| If the learner asks… | Prefer… | Avoid… |
| --- | --- | --- |
| “What does this idea mean and how does it relate?” | Concept map, contrast space | Unlabeled node-link map |
| “Is this conclusion supported?” | Argument map, evidence matrix | Concept map pretending to evaluate inference |
| “What should I read/build first?” | Dependency DAG | Embedding-nearest recommendations |
| “How does this mechanism work?” | Causal/mechanism diagram, reactive model | Bare arrows labeled “affects” |
| “How did it develop historically?” | Timeline/genealogical river | Static taxonomy |
| “What differs across sources?” | Matrix, contrast space, coordinated views | One blended summary node |
| “What state or process am I in?” | Statechart, process map | Freeform graph with temporal arrows |
| “I’m still figuring it out.” | Spatial hypertext | Premature argument tree |
| “What question is unresolved?” | IBIS | Generic “open question” pile |
| “Where did this come from?” | Annotated atlas/provenance layer | Detached derived card |

## Composable primitives for prototypes

Instead of twelve tabs, Primer should expose six primitives that can compose into Atlas of Inquiry, Argument World, and Construction Studio.

### Primitive 1: Source-anchored object

A derived object can be a claim, concept, example, mechanism step, event, question, model variable, annotation, or learner note. Required fields: stable id, object type, source anchors, exact quote or range, creator, transformation note, confidence, created time, and “evidence” vs “inference” label. This is the substrate for recoverability.

### Primitive 2: Typed relation with readable semantics

Every edge must have a relation type and, where appropriate, a linking phrase. Minimum relation families: supports, objects-to, elaborates, exemplifies, defines, contrasts-with, depends-on, causes/enables/inhibits, precedes, answers, raises, derives-from, same-as, and learner-associates-with. Generic “related” is forbidden except as a temporary spatial-hypertext cue explicitly marked provisional.

### Primitive 3: Declared layout grammar

A view declares what position, containment, size, color, edge style, and proximity mean. Examples: topological layer = prerequisite depth; x-axis = chronology; y-axis = abstraction; containment = substate; cell = source × claim relation. If a layout is algorithmic, it must expose the algorithm and the semantic limits. Generic embedding geography is rejected because distance lacks inspectable, source-grounded semantics.

### Primitive 4: Evidence layer and uncertainty controls

Any view can toggle evidence: source quotes, annotation types, confidence, disagreement, missing data, and inferred status. Unknown is distinct from false or absent. Mechanism and causal edges require evidence type: textual assertion, empirical result, model assumption, learner conjecture, or system inference.

### Primitive 5: Tactile transformation pipeline

Learners should be able to promote and transform structure: spatial pile -> named cluster -> concept propositions; source quote -> claim -> argument node; event list -> timeline; claim × source set -> matrix; mechanism paragraph -> process/causal diagram; variables -> reactive model. Transformations preserve originals and record the operation.

### Primitive 6: Coordinated workspace, not view silo

A saved workspace is a bundle of views over the same objects. Brushing an object reveals its roles across views: a quote may be evidence in Argument World, an event in a genealogy, a definition in a concept map, and a cell in a matrix. Cross-view links must declare whether they mean identity, derivation, analogy, contradiction, prerequisite, or learner association.

## Prototype implications

- **Atlas of Inquiry.** Use annotated atlas + timeline/genealogy + concept maps + contrast spaces. Its promise is orientation: source recoverability, conceptual neighborhoods with declared semantics, and visible open questions. It must not look like an embedding scatterplot with pretty labels.
- **Argument World.** Use argument maps + IBIS + evidence matrices. Its promise is disciplined disagreement: issue-centered questions, positions, claims, objections, evidence endpoints, and consequence of premise failure. It should preserve examples and motivations as attachable context rather than forcing them into premises.
- **Construction Studio.** Use spatial hypertext + matrices + state/process diagrams + reactive models + coordinated views. Its promise is authoring: turn messy gathered material into typed structures, with provenance and transformation history.

## Non-negotiable design rules

1. No unlabeled edges in durable representations.
2. No embedding-distance maps as epistemic claims. Embeddings may retrieve candidates, but layout must be declared and source-checkable.
3. Every spatial convention needs a legend: proximity, order, size, color, containment, and edge shape.
4. Every derived object traces back to authored source or is explicitly learner-authored inference.
5. The system should support ambiguity, but ambiguity must be marked as provisional, not smuggled in as a finished graph.
6. Prefer coordinated primitives over representation silos: the learner moves among grammars while the source-grounded object graph remains stable.
