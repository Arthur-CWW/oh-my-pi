# Didactic jobs for explorable knowledge environments

Retrieval date for all web sources: 2026-07-11. This is a design input for Primer prototypes, not a literature review. It treats sources as constraints and precedents, then marks Primer-specific inferences separately.

## Source register

- **Bret Victor, “Explorable Explanations” (2011; 2024 postscript), essay / design precedent.** Canonical URL: <https://worrydream.com/ExplorableExplanations/>. Exact source wording: “An active reader asks questions, considers alternatives, questions assumptions, and even questions the trustworthiness of the author.” Also: “People currently think of text as information to be consumed. I want text to be used as an environment to think in.” In the 2024 postscript Victor clarifies that he meant “a written argument whose assertions are backed by explorable computational models, whose facts, assumptions, and calculations are all visible and editable.”
- **Bret Victor, “Up and Down the Ladder of Abstraction” (2011), essay / interactive visualization precedent.** Canonical URL: <https://worrydream.com/LadderOfAbstraction/>. Exact source wording: “the most powerful way to gain insight into a system is by moving between levels of abstraction” and “this dance is where the deepest insights are born — not at any one level of abstraction, but in the transitions between them.”
- **Andy Matuschak and Michael Nielsen, “How can we develop transformative tools for thought?” (2019), essay / prototype report.** Canonical URL: <https://numinous.productions/ttft/>. Exact source wording: “a new medium for thought” can create “a powerful immersive context, a context in which the user can have new kinds of thought, thoughts that were formerly impossible for them.” Also: learning quantum mechanics is difficult partly because people are “imbibing an entire new language,” and the mnemonic medium addresses only one core difficulty, not all learning.
- **Andy Matuschak, “A primitive for enabling environments: early work on machine-generated prompts” (2024), essay / research-in-progress.** Canonical URL: <https://andymatuschak.org/situated-idea-memory-system/>. Exact source wording: “Most of the time, I don’t just want to remember; I want to learn.” Also: a situated idea would store “a pointer to relevant context, with full text,” “a range (or ranges?) within that context,” and “an optional extra comment clarifying your intent or interest.” He warns that “today’s models aren’t automatically good at generating effective tasks for content beyond simple facts.”
- **Joseph D. Novak and Alberto J. Cañas, “The Theory Underlying Concept Maps and How to Construct and Use Them” (IHMC Technical Report, rev. 2008), technical report / concept mapping precedent.** Canonical URL: <https://cmap.ihmc.us/docs/theory-of-concept-maps>. Exact source wording: “Concept maps are graphical tools for organizing and representing knowledge,” where “linking words or linking phrases, specify the relationship between the two concepts.” Also: “Every concept map responds to a focus question,” and “cross-links often represent creative leaps.”
- **Martin Davies, Ashley Barnett, and Tim van Gelder, “Using Computer-Aided Argument Mapping to Teach Reasoning” (open textbook chapter), pedagogical/research synthesis.** Canonical URL: <https://ecampusontario.pressbooks.pub/criticalthinking1234/chapter/introduction/>. Exact source wording: “Argument mapping is a way of diagramming the logical structure of an argument to explicitly and concisely represent reasoning.” The chapter distinguishes mapping types: argument mapping is “principally concerned with inferential or logical relationships between claims.”
- **Frank M. Shipman III and Catherine C. Marshall, “Spatial Hypertext: An Alternative to Navigational and Semantic Links” (ACM Computing Surveys, 1999), research synthesis / spatial hypertext precedent.** Canonical URL: <https://cs.brown.edu/memex/ACM_HypertextTestbed/papers/37.html>. Exact source wording: users “avoided the explicit linking mechanisms in favor of the more implicit expression of relationships through spatial proximity and visual attributes.” Benefits include “constructive ambiguity,” and visual languages can change as “users’ understanding of the task and their method of approaching the task co-evolved.”
- **Seymour Papert and Idit Harel, “Situating Constructionism” (1991), chapter / constructionist theory.** Canonical URL: <http://www.papert.org/articles/SituatingConstructionism.html>. Exact source wording: constructionism can be formulated as “learning-by-making,” but the richer claim adds that learning happens “especially felicitously in a context where the learner is consciously engaged in constructing a public entity, whether it’s a sand castle on the beach or a theory of the universe.”
- **National Research Council, “How People Learn,” Chapter 3: “Learning and Transfer” (2000), research synthesis.** Canonical URL: <https://www.nationalacademies.org/read/9853/chapter/6>. Exact source wording: transfer is “the ability to extend what has been learned in one context to new contexts”; “Transfer is best viewed as an active, dynamic process rather than a passive end-product”; and “Transfer can be improved by helping students become more aware of themselves as learners who actively monitor their learning strategies and resources.”

## Ontology of learner/researcher jobs

Each job below has two layers: **precedent** is directly grounded in the cited sources; **Primer inference** is the proposed design consequence for Atlas of Inquiry, Argument World, or Construction Studio.

### 1. Orient in a problematic territory

- **Learner question:** What kind of thing am I looking at, where am I in it, and what should I attend to first?
- **Useful representation:** A focus-question-centered landscape: source spine, local glossary, landmarks, open regions, and “why this matters” beacons. Spatial position means reading/work context, not truth or importance unless separately encoded.
- **Productive interaction:** Ask or choose a focus question; pin exact source passages; collapse/expand from overview to quoted source; mark “I am here,” “I need background,” and “this is the current puzzle.”
- **Failure mode:** Pretty node-link atlas with no declared semantics; learner mistakes visual centrality for conceptual centrality; system orients to its own taxonomy rather than the learner’s live question.
- **Required data/evidence:** Exact source range; learner question or selection; document hierarchy; local glossary provenance; explicit semantics for regions, proximity, size, color, and edges.
- **What cannot be inferred:** Importance, difficulty, or prerequisite status from frequency, page order, hyperlink count, embedding similarity, or model confidence alone.
- **Precedent:** Novak and Cañas require a focus question; Victor asks for reading environments that encourage active questioning.
- **Primer inference:** Atlas of Inquiry should begin with a question-bearing map, not a universal concept graph. It must keep the authored source recoverable from every object.
- **Tradeoff:** Too much orientation becomes a syllabus and suppresses exploration; too little becomes a foggy canvas. Prefer a small map plus visible uncertainty over a comprehensive map with hidden assumptions.

### 2. Sustain motivation and personal salience

- **Learner question:** Why should I care enough to keep working through this?
- **Useful representation:** A salience ledger: learner-authored reasons, surprising passages, stakes, desired capabilities, and social/public commitments.
- **Productive interaction:** Convert highlights into “because I care about…” notes; compare authored motivation with learner motivation; let the learner defer or reject system-suggested paths.
- **Failure mode:** Gamified progress, recall streaks, or graph completion replaces the learner’s purpose; motivation is inferred as a property of content rather than a relationship between learner, context, and goal.
- **Required data/evidence:** Learner comment, chosen project, past accepted/rejected prompts, source stakes, and optionally audience or intended artifact.
- **What cannot be inferred:** Desire, identity-level relevance, or long-term worth from a highlight alone. A highlight may mean confusion, disagreement, aesthetic pleasure, or future use.
- **Precedent:** Matuschak says adult readers want different things from a text; the NRC chapter notes that learners are more motivated when they can use learning to do something with impact.
- **Primer inference:** Primer should treat salience as authored metadata and feedback, not as an automatic score.
- **Tradeoff:** Asking for intent every time creates friction; never asking loses the target. Use lightweight optional marginalia and later correction rather than mandatory up-front goal forms.

### 3. Form intuition by moving among representations

- **Learner question:** What does this idea feel like in operation, not just in definition?
- **Useful representation:** Multiple linked representations: concrete example, abstraction, diagram, counterexample, parameter sweep, analogy, and source quote. Visual proximity means “compare now”; it does not mean same cause, same level, or entailment.
- **Productive interaction:** Scrub variables, step up to patterns, step down to concrete instances, contrast cases, and ask “show me a case where this breaks.”
- **Failure mode:** Static summaries or decorative interactives. The learner sees a claim but never gets a manipulable situation in which the claim becomes discriminable.
- **Required data/evidence:** Mechanism variables; example/counterexample pairs; authored explanation; known range of applicability; trace from representation back to source.
- **What cannot be inferred:** A learner’s intuition has formed because they manipulated a widget, spent time, or correctly recalled a term.
- **Precedent:** Victor’s abstraction ladder says insight comes from transitions among levels; Novak and Cañas emphasize examples and cross-links; NRC emphasizes contrasting cases.
- **Primer inference:** Construction Studio should make “step up / step down” a primitive operation on any model or explanation, not an optional chart mode.
- **Tradeoff:** Rich representations can overload working memory. Start with one concrete case and one abstraction, then reveal more views only when they answer a learner action.

### 4. Understand mechanisms and causal structure

- **Learner question:** What makes this happen, and what would change if an assumption changed?
- **Useful representation:** A model card: variables, assumptions, causal arrows, calculations or transformations, outputs, and confidence/authority. Edges mean declared causal, inferential, temporal, or analogical relations; mixed edge semantics are prohibited.
- **Productive interaction:** Edit an assumption; inspect downstream consequences; compare authored model with alternative model; jump from any variable to the quoted source or data that justifies it.
- **Failure mode:** The system gives an explanation without exposing the mechanism; or exposes a spreadsheet/model without authored interpretation.
- **Required data/evidence:** Explicit model, source of each parameter, update rule or inference rule, observed examples, and unresolved assumptions.
- **What cannot be inferred:** Causality from co-occurrence, spatial closeness, citation adjacency, or model-generated narrative.
- **Precedent:** Victor’s 2024 clarification requires facts, assumptions, and calculations to be visible and editable; his original essay says a spreadsheet is not an explanation because an explanation requires an author.
- **Primer inference:** Argument World can borrow model-grounded argument for claims involving mechanisms, but must not turn every conceptual relation into a causal diagram.
- **Tradeoff:** Mechanism views are powerful where models exist and misleading where they do not. Use them for claims with explicit moving parts; use argument/evidence or genealogy views for interpretive claims.

### 5. Discriminate concepts, cases, and failure boundaries

- **Learner question:** How do I tell this from nearby ideas, false friends, and seductive misreadings?
- **Useful representation:** Contrast table plus boundary cases: similar concepts, decisive features, examples, non-examples, common confusions, and “not enough information” states.
- **Productive interaction:** Sort cases; explain a distinction; request nearest counterexample; mark a feature as relevant/irrelevant; see how an argument changes if a distinction collapses.
- **Failure mode:** Taxonomy without use; definitions that encourage recognition but not discrimination; false precision around categories that sources leave contested.
- **Required data/evidence:** Source definitions, examples and non-examples, learner errors, expert contrasts, and evidence for contested boundaries.
- **What cannot be inferred:** A stable concept boundary from a single passage, keyword overlap, or one expert’s phrasing.
- **Precedent:** NRC says contrasting cases help learners notice relevant and irrelevant features; Novak and Cañas warn that linking words reveal whether relationships are understood.
- **Primer inference:** Atlas should represent distinctions as authored discriminations with evidence, not as permanent ontology classes.
- **Tradeoff:** Excessive boundary-work can stall reading. Trigger this job when the learner flags confusion, transfer fails, or two nodes are being used interchangeably.

### 6. Trace genealogy and conceptual development

- **Learner question:** Where did this idea come from, how did it mutate, and what alternatives were left behind?
- **Useful representation:** Source genealogy: chronological strata, influence claims, term changes, debates, revisions, and local reception. Edges mean “claims influence/response/descent,” each with quoted support.
- **Productive interaction:** Follow a term backward; compare two historical moments; annotate “this author inherits,” “rejects,” “misreads,” or “reframes”; attach uncertainty to genealogy edges.
- **Failure mode:** Timeline as decoration; automatic citation graph mistaken for intellectual descent; anachronistic merging of terms with different historical uses.
- **Required data/evidence:** Dated sources, exact quotes, bibliographic metadata, authorial claims of influence, secondary scholarship, and uncertainty notes.
- **What cannot be inferred:** Intellectual influence from chronology, citation, semantic similarity, or co-appearance in a bibliography without evidence.
- **Precedent:** Novak’s original concept maps emerged to trace changes in children’s knowledge; spatial hypertext supports evolving interpretation and ambiguous relations.
- **Primer inference:** Source Genealogy views should preserve uncertain, partial, and contested descent rather than forcing a clean lineage graph.
- **Tradeoff:** Genealogy can become antiquarian. Use it when present meaning depends on inherited vocabulary, controversy, or a compressed reference.

### 7. Inspect argument and evidence

- **Learner question:** What is being claimed, what supports it, what opposes it, and how strong is the support?
- **Useful representation:** Argument map plus evidence neighborhood: claims, reasons, co-premises, objections, warrants, evidence records, source credibility, and missing premises. Edge types must distinguish support, opposition, warrant, evidence-for, and citation-only.
- **Productive interaction:** Split prose into claims; add/withdraw an objection; test whether a premise is necessary; open the exact source evidence; compare rival argument maps.
- **Failure mode:** Concept map used as an argument map; every association becomes support; bad reasons are counted instead of evaluating strongest reasons.
- **Required data/evidence:** Atomic claim text, source quote, reason grouping, objection source, evidence type, provenance, and evaluator notes.
- **What cannot be inferred:** Support strength from number of links, sentiment, citation count, or visual centrality.
- **Precedent:** Davies/Barnett/van Gelder define argument mapping as logical/inferential representation, distinct from concept mapping’s relational connections.
- **Primer inference:** Argument World should be a separate mode from Atlas, with stricter edge semantics and claim granularity.
- **Tradeoff:** Argument maps clarify reasoning but can flatten rhetorical, historical, or experiential material. Use them where the learner is evaluating a contention, not when they are gathering associations.

### 8. Prepare for transfer and flexible use

- **Learner question:** Can I use this idea elsewhere, and under what conditions would it fail?
- **Useful representation:** Transfer matrix: source context, target contexts, invariant structure, variable surface features, near/far examples, negative transfer warnings, and prompts for adaptation.
- **Productive interaction:** Generate a new case; ask learner to map structure; compare failed and successful transfers; record help needed before transfer succeeds.
- **Failure mode:** Treating recall, recognition, or one solved example as transfer; overgeneralizing a poetic or philosophical idea into a universal rule.
- **Required data/evidence:** Initial understanding evidence, multiple contexts, contrasting cases, learner attempt, feedback, and record of prompts/help used.
- **What cannot be inferred:** Transfer from card review success, time spent, or the existence of an abstract summary.
- **Precedent:** NRC defines transfer and says it is active/dynamic; Matuschak says transfer requires surprise and cannot be supplied fully by a static task.
- **Primer inference:** Primer should store transfer attempts and prompt history as first-class evidence, not just accepted notes or cards.
- **Tradeoff:** Transfer practice is costly. Prioritize ideas the learner explicitly wants to use, ideas central to a project, and ideas with high risk of false analogy.

### 9. Synthesize across sources without erasing disagreement

- **Learner question:** What can I responsibly say after reading across these sources?
- **Useful representation:** Synthesis board: source claims, agreements, tensions, scope conditions, unresolved questions, and candidate synthesis statements with provenance.
- **Productive interaction:** Drag claims into agreement/tension/open-question lanes; write a synthesis claim; require source-backed support and counter-support; mark “design inference” separately from “source says.”
- **Failure mode:** Literature dump, forced consensus, or model-generated synthesis that launders uncertainty into confident prose.
- **Required data/evidence:** Source quotes, claim extraction notes, disagreements, scope limits, learner-authored synthesis, and explicit inference labels.
- **What cannot be inferred:** Consensus from semantic similarity, repeated terminology, or the absence of a visible objection in the current corpus.
- **Precedent:** Spatial hypertext supports constructive ambiguity and evolving visual languages; concept maps support cross-links that may represent creative leaps.
- **Primer inference:** Atlas of Inquiry should preserve tensions and open questions as objects, not treat them as missing edges to resolve.
- **Tradeoff:** Too much ambiguity prevents action; too much synthesis hides disagreement. Require each synthesis object to carry both a claim and its unresolved tensions.

### 10. Monitor uncertainty and regulate inquiry

- **Learner question:** What do I know, what do I merely suspect, where am I confused, and what is the next best check?
- **Useful representation:** Epistemic state layer: known / inferred / contested / unknown / learner-confused / model-uncertain / source-missing, with evidence and next-check suggestions.
- **Productive interaction:** Mark confidence separately for source claim, learner understanding, and system inference; request “what would change your mind?”; choose a next verification move.
- **Failure mode:** Confidence as decoration; model uncertainty conflated with scholarly uncertainty; learner confusion treated as content defect rather than state of inquiry.
- **Required data/evidence:** Provenance, source type, exact quote, learner self-rating or note, system derivation, contradiction records, and next-check options.
- **What cannot be inferred:** Learner understanding from silence; truth from confidence; uncertainty from lack of local sources when external sources were not checked.
- **Precedent:** NRC emphasizes monitoring strategies/resources; Matuschak’s situated-idea workflow grades targeting and construction failure modes rather than trusting generation.
- **Primer inference:** Every derived object should store whether it is source-grounded, learner-authored, or design/model inference.
- **Tradeoff:** Visible uncertainty can clutter the workspace. Use progressive disclosure, but never hide the provenance and confidence fields from inspection.

### 11. Construct public artifacts and learner-authored structure

- **Learner question:** What am I building with this knowledge, and how does the artifact reshape my understanding?
- **Useful representation:** Construction Studio artifact: essay, map, model, prompt set, glossary, debate, lesson, or simulation, with lineage from source fragments and learner decisions.
- **Productive interaction:** Assemble source-backed components; revise structure; fork alternatives; expose the artifact to critique; record design choices and rejected paths.
- **Failure mode:** The environment only stores annotations and paths; learner never makes a public object. Or the system auto-builds the object and deprives the learner of construction.
- **Required data/evidence:** Artifact version, source lineage, learner edits, rationale, feedback, audience, and rejected alternatives.
- **What cannot be inferred:** Ownership, understanding, or changed capability from the existence of a generated artifact.
- **Precedent:** Papert and Harel emphasize constructing a public entity; Matuschak frames enabling environments as expanding what people can think and do; Victor wants text to become an environment to think in.
- **Primer inference:** Construction Studio should make learner-authored structure the end state of inquiry, not only the navigation layer around sources.
- **Tradeoff:** Construction is slower than consumption and may produce messy artifacts. That mess is evidence of thinking; the system should support versioned refinement rather than premature polish.

## Cross-cutting representation rules

1. **Declared spatial semantics.** Proximity means one declared relation at a time: comparison, same source region, temporal adjacency, argumentative dependency, genealogy, or learner workspace grouping. If the meaning changes, the view must say so.
2. **Declared visual semantics.** Size, color, opacity, and edge weight must state whether they encode source count, learner confidence, recency, uncertainty, salience, or priority. Never use visual prominence as implicit truth.
3. **Recoverable authorship.** Every node, edge, model parameter, claim, synthesis, and prompt must link back to: source URL or local source id, exact quote/range when applicable, retrieval date, creator (source / learner / system), and transformation step.
4. **Mode separation.** Concept maps, argument maps, spatial workspaces, genealogies, and construction boards answer different jobs. They may interoperate, but one view must not silently borrow another view’s semantics.
5. **Learner-authored structure is data.** Marginalia, rejected suggestions, uncertainty marks, and rearrangements are not UI residue; they are evidence about target, salience, and state of understanding.

## Priority order for Primer

1. **Recoverable source-grounded objects first.** Without provenance, every later graph or synthesis becomes untrustworthy.
2. **Orientation around learner focus questions.** Atlas of Inquiry should answer “where am I and why does this matter?” before expanding into graph richness.
3. **Uncertainty and authorship layer.** Distinguish source claim, learner note, and system inference from the beginning.
4. **Argument/evidence mode with strict edge semantics.** Build Argument World as a disciplined claim/reason/evidence workspace, not as a general association graph.
5. **Discrimination and contrasting cases.** These are the fastest path from recall/navigation to understanding and transfer readiness.
6. **Intuition/mechanism views where models exist.** Use Victor-style manipulability only when assumptions and consequences can be made inspectable.
7. **Synthesis board preserving tensions.** Add cross-source synthesis after enough grounded claims and objections exist.
8. **Construction Studio artifacts.** Make learner-authored outputs durable once provenance, uncertainty, and synthesis primitives are stable.
9. **Genealogy views.** Add when source domains have real historical compression; do not fake lineage from citation networks.
10. **Transfer practice.** Highest learning value but highest evidentiary cost; prioritize after selected ideas have construction or project relevance.

The practical cut: Primer should not try to be “a better knowledge graph.” It should be a source-recoverable inquiry environment where the learner can orient, discriminate, test arguments, form intuition, preserve uncertainty, and finally construct something that changes what they can think and do.
