# Justin Skycak / Math Academy — Pedagogy Distillation

Compiled: 2026-07-06  
Scope: Skycak / Math Academy artifacts found in the local estate, emphasizing the in-repo primer research archive plus feedstock/library/browser substrate.

## Findings

- The strongest local substrate is already in-repo at `streams/primer/wrapped-commentary-reader/docs/research/justin-math-learning/`: 54 cataloged JustinMath/Math Academy source items in `corpus.json`, 32 podcast/interview entries in `source-urls.md`, a cleaned corpus under `cleaned/`, raw graph artifacts under `raw/`, and local apparatus notes translating the pedagogy into a boundary-frontier card loop.
- The Math Academy content graph exists locally in both raw and SQLite forms: `streams/primer/wrapped-commentary-reader/docs/research/justin-math-learning/raw/math-academy-content-graph.json` and `streams/primer/wrapped-commentary-reader/artifacts/learning-card-system/math-academy-graph.sqlite`. The SQLite DB has `courses` (8 rows), `topics` (194), `edges` (285), and `page_captures` (194), sampled via the read tool.
- The full book/PDF feedstock is present as `streams/primer/feedstock/Books_Papers_Research/books/the-math-academy-way.txt` and `streams/primer/feedstock/Books_Papers_Research/books/the-math-academy-way.pdf`; a duplicate PDF exists at `streams/primer/feedstock/Books_Papers_Research/nietzsche/the-math-academy-way.pdf`. Library indexes point to the vault copy at `streams/primer/feedstock/library/books/Math Physics Statistics/The Math Academy Way.pdf`.
- Browser context confirms visited/recovered web sources including `https://www.justinmath.com/files/introduction-to-algorithms-and-machine-learning.pdf` at `/Users/arthur/state/browser-context/browser_context.sqlite:events:91049`, but I did not find that algorithms PDF as a local feedstock file.

## 1. Inventory

| Artifact | Path / evidence | Notes |
|---|---|---|
| Research goal note | `streams/primer/wrapped-commentary-reader/docs/research/justin-math-learning/goal.md` | States archive goal: efficient learning, math relearning, spaced repetition, retrieval, interleaving, automaticity, cognitive load, knowledge graphs. |
| Learning-system synthesis | `streams/primer/wrapped-commentary-reader/docs/research/justin-math-learning/learning-system-implications-for-arthur.md` | 15-point distillation for Arthur’s apparatus; cites diagnostics, deliberate practice, FIRe/encompassings, reference reliance, concrete examples. |
| Boundary-frontier playbook | `streams/primer/wrapped-commentary-reader/docs/research/justin-math-learning/boundary-frontier-query-playbook.md` | Operational SQL loop: `attempt_log` → `concept_mastery` → `learner_frontier`; downgrades correct answers for time/reference reliance. |
| Graph DB / X search note | `streams/primer/wrapped-commentary-reader/docs/research/justin-math-learning/max-paperclips-graphdb-x-search.md` | One `@max_paperclips` graph DB post; supports SQLite-first graph handling. |
| Math Academy graph SQLite doc | `streams/primer/wrapped-commentary-reader/docs/research/justin-math-learning/math-academy-graph-sqlite.md` | Documents 8 courses, 194 topics, 285 edges, 182 accessible topic captures, 12 not found. |
| Learning-card SQLite doc | `streams/primer/wrapped-commentary-reader/docs/research/justin-math-learning/learning-card-system-sqlite.md` | Seed DB schema combining graph courses/topics/edges, concept nodes, tacit moves, card candidates, attempt log, frontier views. |
| AI card ontology | `streams/primer/wrapped-commentary-reader/docs/research/justin-math-learning/ai-assisted-card-system-ontology.md` | AI as card compiler, not untrusted teacher; concept graph, tacit knowledge, attempt telemetry, critique rules. |
| Card compiler schema | `streams/primer/wrapped-commentary-reader/docs/research/justin-math-learning/card-compiler-schema.md` | Schema for `concept_node`, `tacit_move`, `card_candidate`, `attempt`; hard rejections include no provenance/concrete example/diagnostic value. |
| Tacit Golden Nuggets extraction | `streams/primer/wrapped-commentary-reader/docs/research/justin-math-learning/tacit-knowledge-golden-nuggets.md` | 43 operational moves from Golden Nuggets #37/#39/#40 plus ontology. |
| Card candidate critique | `streams/primer/wrapped-commentary-reader/docs/research/justin-math-learning/card-candidate-critique.md` | 20 candidate cards/problems; 17 keep, 3 reject. |
| AI teacher harness synthesis | `streams/primer/wrapped-commentary-reader/docs/research/justin-math-learning/ai-teacher-harness-synthesis.md` | Boundary-aware tutor loop: choose task, observe attempt, diagnose miss, repair prerequisite, schedule retrieval. |
| OMP/Pi teaching harness | `streams/primer/wrapped-commentary-reader/docs/research/justin-math-learning/omp-pi-teaching-agent-harness.md` | Local agent/operator bridge over the learning-card DB. |
| Teaching interaction log | `streams/primer/wrapped-commentary-reader/docs/research/justin-math-learning/teaching-harness-interaction-log.md` | Empty template for live tutor friction entries. |
| HSK deck lessons | `streams/primer/wrapped-commentary-reader/docs/research/justin-math-learning/hsk-deck-lessons-for-card-system.md` | Non-Skycak transfer note applying boundary/frontier lessons to language cards. |
| Curriculum next goal | `streams/primer/wrapped-commentary-reader/docs/research/justin-math-learning/curriculum-apparatus-next-goal.md` | Converts principles into diagnostics, prerequisite graph, active reps, spaced/interleaved review. |
| Subscription triage | `streams/primer/wrapped-commentary-reader/docs/research/justin-math-learning/math-academy-subscription-triage.md` | Later calibration lane; do not copy proprietary problem-bank content. |
| Source URL catalog | `streams/primer/wrapped-commentary-reader/docs/research/justin-math-learning/source-urls.md` | 25 core written essay URLs and 32 podcast/interview entries. |
| Corpus catalog | `streams/primer/wrapped-commentary-reader/docs/research/justin-math-learning/corpus.json` | Structured catalog: `count: 54`, cleaned paths and URLs. |
| Golden Nuggets catalog | `streams/primer/wrapped-commentary-reader/docs/research/justin-math-learning/golden-nuggets-source-urls.md` | Golden Nuggets #35/#37/#39/#40 Justin entries plus related episodes #36/#38/#42. |
| Cleaned source corpus | `streams/primer/wrapped-commentary-reader/docs/research/justin-math-learning/cleaned/` | Blog essays, podcast transcripts, YouTube transcripts, graph extraction, consolidated recent posts. |
| Recent micro-post archive | `streams/primer/wrapped-commentary-reader/docs/research/justin-math-learning/cleaned/justinmath-recent-learning-posts-2025-06-to-2026-06.md` | 2.2 MB archive; key lines cited below for deliberate practice, spacing, diagnostics, graph/encompassing model. |
| Raw content graph JSON | `streams/primer/wrapped-commentary-reader/docs/research/justin-math-learning/raw/math-academy-content-graph.json` | Public graph snapshot feeding SQLite. |
| Raw content graph DOT | `streams/primer/wrapped-commentary-reader/docs/research/justin-math-learning/raw/math-academy-content-graph.dot` | Graphviz form. |
| Raw content graph HTML | `streams/primer/wrapped-commentary-reader/docs/research/justin-math-learning/raw/math-academy-content-graph.html` | Source capture from `https://www.justinmath.com/files/content-graph.html`. |
| Raw Golden Nuggets corpus | `streams/primer/wrapped-commentary-reader/docs/research/justin-math-learning/raw/golden-nuggets-corpus.json` | Small source bundle for Golden Nuggets extraction. |
| Raw recent posts JSON | `streams/primer/wrapped-commentary-reader/docs/research/justin-math-learning/raw/justinmath-posts-2025-06-to-2026-06.json` | Source JSON for recent-post archive. |
| Topic page captures | `streams/primer/wrapped-commentary-reader/docs/research/justin-math-learning/graph-pages/` | 182 accessible captured JustinMath topic pages; 12 graph slugs not found per `math-academy-graph-sqlite.md`. |
| Math Academy graph DB | `streams/primer/wrapped-commentary-reader/artifacts/learning-card-system/math-academy-graph.sqlite` | Read-tool schema/sample: tables `courses`, `topics`, `edges`, `page_captures`; 8/194/285/194 rows. |
| The Math Academy Way text | `streams/primer/feedstock/Books_Papers_Research/books/the-math-academy-way.txt` | 21,177-line text extraction; authored by Justin Skycak, advised by Jason Roberts; updated 2025-08-08. |
| The Math Academy Way PDF | `streams/primer/feedstock/Books_Papers_Research/books/the-math-academy-way.pdf` | Primary local PDF. |
| The Math Academy Way duplicate PDF | `streams/primer/feedstock/Books_Papers_Research/nietzsche/the-math-academy-way.pdf` | Exact duplicate per library manifests. |
| Library index entry | `streams/primer/feedstock/library/book-index.md` | Lines 236 and 491 list The Math Academy Way copies. |
| Library book index entry | `streams/primer/feedstock/library/books/INDEX.md` | Line 153 points to vault copy of The Math Academy Way. |
| Library vault copy | `streams/primer/feedstock/library/books/Math Physics Statistics/The Math Academy Way.pdf` | Synced library PDF. |
| Browser context algorithms URL | `/Users/arthur/state/browser-context/browser_context.sqlite:events:91049` | `https://www.justinmath.com/files/introduction-to-algorithms-and-machine-learning.pdf`, title `introduction-to-algorithms-and-machine-learning.pdf`. |
| Browser context Math Academy Way URL | `/Users/arthur/state/browser-context/browser_context.sqlite:events:96411` | Google Docs title `The Math Academy Way - Google Docs`. |
| Browser context podcast URLs | `/Users/arthur/state/browser-context/browser_context.sqlite:events:108258`, `:109966`, `:110397`, `:110398` | Yacine, Golden Nuggets #35, Podbean Chalk & Talk, YouTube Chalk & Talk visits. |

## 2. Pedagogy model in these sources

### Mastery learning over a prerequisite graph

Skycak’s system is not “take a course and review later”; it is a fine-grained graph model. In *The Math Academy Way*, the knowledge graph is an “interconnected structure of thousands of topics” used to place each student at their “knowledge frontier,” fill foundational gaps, provide spaced/remedial reviews, and use encompassing relationships for “turbo-boosted learning speed” (`the-math-academy-way.txt` lines 3770-3776). The graph stores prerequisite edges: “Each linkage between topics indicates a relationship between them, such as one topic being a prerequisite for another topic” (lines 3797-3800). The course graph is only a human summary; “The knowledge graph is the ultimate source of truth” (lines 3893-3896).

Mastery is enforced at the topic/knowledge-point level: “Math Academy’s knowledge graph enables us to implement mastery learning, in which students demonstrate proficiency on prerequisites before moving on to more advanced topics” (`the-math-academy-way.txt` lines 3901-3906). Each topic has worked examples and questions, and a student must answer enough questions correctly in successive knowledge points before advanced topics open (lines 3914-3933). The Yacine transcript summary records the operational loop: adaptive diagnostic, custom graph, “minimum effective doses of instruction followed immediately by problem-solving, mastery before advancing” (`justinmath-recent-learning-posts-2025-06-to-2026-06.md` lines 3263-3267).

### Deliberate practice at scale

The model treats practice as surgical error exposure, not time spent. Skycak’s recent post says: “Deliberate practice is not merely trying hard… It is individualized training designed to improve specific components of performance, with feedback sharp enough to expose errors and difficulty calibrated tightly enough to force adaptation” (`justinmath-recent-learning-posts-2025-06-to-2026-06.md` lines 963-969). The loop is explicit: “Find the bottleneck. Design the rep. Attempt it. Get feedback. Correct. Repeat until the bottleneck moves” (line 970).

The book’s shorter formulation matches: deliberate practice should center on individualized training activities chosen to improve specific performance aspects “through repetition and successive refinement” (`the-math-academy-way.txt` lines 1775-1777). On Math Academy, students spend their time solving problems with feedback on new topics and topics most in need of review; instruction appears in “minimum effective doses” immediately before use (`the-math-academy-way.txt` lines 6292-6295).

### Diagnostic placement and timed leveling

Placement is diagnostic, not aspirational. The graph-backed diagnostic “quickly identify[ies] their knowledge frontier,” and subsequent lessons “always cover topics that are on the student’s knowledge frontier” (`the-math-academy-way.txt` lines 4066-4072). It also reaches into lower-grade foundations because students commonly enter excited for a course while missing prerequisites (lines 4076-4079; continued at 4080 in the source).

Golden Nuggets #39 makes timing a first-class signal: “For diagnostics, we measure time… If someone takes five minutes to solve a quadratic equation, they’re not ready to go far beyond that” (`cleaned/golden-nuggets-podcast-39.md` lines 64-66). The goal is foundational skills “quickly, without occupying a lot of mental effort” (line 66). Adults often misuse diagnostics by grinding beyond their ability; Skycak says the diagnostic should test whether the learner can do it “comfortably, quickly, and correctly” without reference, otherwise they need more practice (lines 88-90).

### Spaced repetition integrated with graph/encompassing relationships

Skycak’s review model is not flat flashcards. The book says advanced mathematical problems implicitly “encompass” simpler skills, so Math Academy can keep students learning new material while also practicing old material (`the-math-academy-way.txt` lines 3992-3998). When a student is due for multiple reviews, the system serves “the smallest possible set of learning tasks that encompasses all the due review” (lines 4002-4005). The content graph has a forward prerequisite side and a backward encompassing side: the Yacine transcript summary says Skycak encodes “what skills encompass what other skills” so a review on an advanced skill implicitly practices many subskills (`justinmath-recent-learning-posts-2025-06-to-2026-06.md` lines 3377-3380).

The technical deep dive names this FIRe: “Fractional Implicit Repetition.” FIRe generalizes spaced repetition to hierarchical knowledge where repetitions on advanced topics “trickle down” to simpler topics through encompassing relationships, and simpler topics receiving implicit repetitions discount those reps appropriately (`the-math-academy-way.txt` lines 15605-15617). The empirical efficiency claim is strong: most math courses can be learned with “roughly only one explicit review per topic on average” because the graph has enough encompassings (`the-math-academy-way.txt` lines 16375-16378).

### Automaticity and cognitive load

Automaticity is a prerequisite for higher-level thought, not a rote side quest. The book’s at-a-glance principles say low-level skills must be practiced enough to be carried out without conscious effort, freeing mental processing power (`the-math-academy-way.txt` lines 1782-1787). In the recent-post archive, missing algebra/trig/unit-circle automaticity turns a calculus problem that should take minutes into “this massive research project that takes like an hour” (`justinmath-recent-learning-posts-2025-06-to-2026-06.md` lines 1556-1558).

Cognitive congestion is the graph-design failure mode: if a topic pulls in ten unpracticed prerequisites, cognitive load inflates (`justinmath-recent-learning-posts-2025-06-to-2026-06.md` lines 3388-3390). Good sequencing compresses learning time not by skipping work but by removing “confusion from bad sequencing, time wasted on already-mastered material, and frustration from being thrown into topics too early” (lines 1112-1115).

### Concrete examples and reference-reliance discipline

Skycak’s content-development standard is concrete production. Golden Nuggets #39: “The first thing that pops into my head is just having a concrete example… actual numbers is key” (`cleaned/golden-nuggets-podcast-39.md` lines 43-46). Writing a concrete example exposes missing prerequisite steps; if an explanation takes pages, the topic is too big and must be split/offloaded to lower-level prerequisite nodes (lines 50-51).

Reference behavior is part of mastery. Skycak says going back to examples for every question is a crutch; the system should not give as much spaced-repetition credit or XP when a learner defaults to the reference (`cleaned/golden-nuggets-podcast-39.md` lines 70-71). He recommends the worked example as a gym spotter: use it only when stuck, and only for the stuck point (`cleaned/golden-nuggets-podcast-39.md` lines 92-94, 110-112). He explicitly recommends against reusable notes because they make lookup too tempting: “You want to make it annoying to look up material” (lines 119-123).

### Makeshift tutor when no full adaptive system exists

When no Math Academy-like system exists, Skycak’s workaround is still Math Academy-shaped: bite-sized instruction, production, diagnostics, feedback, and a dated transcript. In Q&A #4 he says learners cannot come with a spectator mentality; “Most of the time that you spend in your learning session should be doing exercises,” and information should be consumed “with the purpose of enabling you to produce” (`cleaned/q-and-a-4.md` lines 48-52). In the follow-up essay, he threw GPT-4o the Math Academy Way PDF, corrected it away from essay prompts, and kept a dated text transcript for continuity/spaced review (`cleaned/how-i-would-go-about-learning-a-subject-where-no-full-fledged-adaptive-learning-system-is-available.md` lines 32-40, 42-43, 68-71).

## 3. Implications for the Primer spine (`read → mark → queue → review`)

1. **Read must be short and instrumental.** Skycak’s loop uses minimum effective instruction before production; a long read-first spine conflicts unless each read segment immediately creates a production attempt.
2. **Mark must separate recognition from production.** A marked passage is not mastery. Add fields for “can solve closed-book,” “time-to-solve,” and “reference used,” otherwise marking will reward familiarity.
3. **Queue needs prerequisite gates.** The queue should not be a FIFO list of interesting cards; it should reject over-frontier tasks whose prerequisites are not demonstrated solid.
4. **Review needs encompassing credit.** One harder problem should review several subskills when the graph says it encompasses them; independent-card review wastes the compression Skycak’s model depends on.
5. **Correct-but-slow is not solid.** The existing apparatus fields (`time_to_solve_seconds`, `reference_reliance`) should gate progression, not merely annotate attempts.
6. **Diagnostic comes before review population.** Self-selected review queues conflict with adaptive diagnostic placement; start with a mini diagnostic that can reach back into stale prerequisites.
7. **Reference UX should have friction.** A polished always-open reference notebook conflicts with Skycak’s warning against crutch notes. Scratch thinking is fine; persistent lookup should not be one click away during attempts.
8. **The queue must schedule, not just store.** Without spaced intervals and reset/advance rules, `queue → review` is a todo list, not spaced repetition; even a simplified FIRe-like encompassing model is closer to the evidence.

## 4. NOT-FOUND / partial recovery

| Item | Evidence / searched location | Status |
|---|---|---|
| Standalone algorithms PDF file | Searched `streams/primer/feedstock/Books_Papers_Research`, `streams/primer/feedstock/papers`, `streams/primer/feedstock/algorithms`, `streams/primer/feedstock/youtube-transcripts`; browser event `/Users/arthur/state/browser-context/browser_context.sqlite:events:91049` has URL `https://www.justinmath.com/files/introduction-to-algorithms-and-machine-learning.pdf`. | URL found in browser context; no local feedstock file found. |
| Podcast download as audio/video | Searched feedstock filename/text for Skycak/Math Academy; browser events show podcast pages (`:108258`, `:109966`, `:110397`, `:110398`). | Transcripts/show notes found in `cleaned/`; no discrete local audio/video download found. |
| Skycak clippings | Searched `streams/primer/feedstock/Clippings` for `Skycak`, `Math Academy`, `JustinMath`, `justinmath`. | No clipping file found. |
| Skycak library items besides The Math Academy Way | Searched `streams/primer/feedstock/library` for Skycak/Math Academy terms. | Only The Math Academy Way PDF/index/manifest entries found. |
| Raw YouTube transcript downloads | Searched `streams/primer/feedstock/youtube-transcripts` for Skycak/Math Academy terms. | No raw feedstock transcript found; cleaned YouTube transcripts exist at `cleaned/q-and-a-4-youtube.md` and `cleaned/chalk-and-talk-podcast-42-youtube.md`. |
| Browser-downloaded content-graph artifact | In-repo graph files exist at `raw/math-academy-content-graph.{json,dot,html}` and SQLite exists at `artifacts/learning-card-system/math-academy-graph.sqlite`. | Content graph recovered in repo; no separate browser-download file identified in feedstock. |
