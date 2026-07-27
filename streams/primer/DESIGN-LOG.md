# Primer design log

Append-oriented record of dated decisions, hypotheses, alternatives, corrections, and debt. Entries are evidence in context, not automatic durable doctrine. If a later entry changes one, preserve both and connect them with `corrects` or `supersedes`; use [`LINEAGE.md`](LINEAGE.md) terminology.

## Entry template

```text
## YYYY-MM-DD — Short title
Status: hypothesis | experiment | accepted-local | decision | deferred | superseded
Scope: product-wide | domain | work | chapter | interface
Relationships: <label> → <artifact/entry>
Evidence: <episode, source, observation, or correction>

Decision or hypothesis, rationale, alternatives, and falsifier.
```

## 2026-07-11 — Calibrate one chapter before bulk generation

**Status:** experiment; not universal doctrine  
**Scope:** *Meltdown*, `u-07-machinic`, annotation workbench  
**Relationships:** `implements_slice_of` → [`INTENT.md`](INTENT.md); `deferred_by` → Arthur calibration gate for bulk generation/import  
**Evidence:** [current handoff](HANDOFF-LIVE-2026-07-10.md), [learning-system synthesis](research/learning-sources/system-synthesis.md)

Use one chapter, a static editable prompt, and explicit OMP interaction before regenerating annotations across books. The uncertainty is not whether the pipeline can produce volume; it is whether the intervention targets Arthur’s actual snag, adds non-obvious context, and is worth keeping. A small fixed scope makes prompt deltas and Arthur’s accept/edit/reject evidence attributable. Bulk generation would multiply an uncalibrated targeting error and make prompt, model, text, and learner-state effects difficult to distinguish.

Alternative deferred: multi-book/multi-model generation and import. Advance only after Arthur labels the first run and a calibrated prompt transfers to an unseen text.

## 2026-07-11 — Pre-read glossary predicts blockers selectively

**Status:** hypothesis  
**Scope:** chapter-level reading assistance  
**Relationships:** `implements_slice_of` → predictive helpfulness in [`INTENT.md`](INTENT.md); `evidence_for` → read-before-friction intervention  
**Evidence:** Arthur’s “explain Foucault, do not explain ROM” correction pattern in [`docs/plans/primer-intuitions.md`](../../docs/plans/primer-intuitions.md)

Before a chapter, offer a short glossary of terms, imported concepts, people, or historical machinery likely to block this reader. It should be predictive and selective, not an exhaustive named-entity list. Each item should expose why it was selected, source provenance, and uncertainty; Arthur can dismiss or correct it. The glossary must not summarize away the chapter’s authored sequence.

Falsifier: it delays entry into the chapter, explains mostly known material, or causes more interruption than the friction it prevents.

## 2026-07-11 — Predictive reference companion acquires exact sources

**Status:** hypothesis  
**Scope:** reference expansion around authored text  
**Relationships:** `implements_slice_of` → local provenance and source acquisition; `deferred_by` → one-chapter calibration  
**Evidence:** Arthur’s request to explain imported machinery and the existing Borges/source-acquisition lineage

When a chapter depends on another work, suggest the exact relevant chapter or excerpt—not merely a title or generic web search. The companion may download, extract, and clean the source (for example, the relevant Foucault chapter), while retaining bibliographic/source provenance, acquisition provenance, and confidence about relevance. Recommendations remain optional and dismissible; a reader can continue without opening them.

Alternatives rejected for now: automatically inserting whole books, mandatory prerequisite reading, or uncited generated summaries. Philosophy references are usually explained in place first; “expand reference” is a reader choice.

## 2026-07-11 — Tactile two-dimensional reference scraps

**Status:** design hypothesis  
**Scope:** reader interface  
**Relationships:** `derived_from` → wrapped-commentary/Talmudic layout; `implements_slice_of` → authored-work-as-spine  
**Evidence:** [`VISION.md`](VISION.md) locality-of-visuals doctrine and reader predecessor episodes

Display exact reference excerpts as tactile 2D scraps anchored beside the source, closer to newspaper cutouts than stacked chat messages. A scrap should visibly belong to its cited source, support moving/dismissing/expanding, and retain an anchor to the passage that summoned it. Side materials remain subordinate in hierarchy and screen area to the authored central text.

Alternative deferred: a linear chat transcript or a side panel that becomes the primary reading surface. Validate legibility and interruption cost before adding behavioral widgets.

## 2026-07-11 — Context chip and OMP cutover

**Status:** accepted-local decision  
**Scope:** current reader interaction  
**Relationships:** `corrects` → fake in-reader side chat; `implements_slice_of` → structured context reference  
**Evidence:** shipped state and browser QA in the [current handoff](HANDOFF-LIVE-2026-07-10.md)

Remove the fake Agent sidebar and `/api/chat` frontend flow. An exact block-local selection now becomes a removable Zed-style context chip and deterministic OMP request packet containing source identity, UTF-16 offsets, exact quote, surrounding text, and capture provenance. This tells the truth about the current system: the reader can package evidence for a capable external agent, but it does not yet host a reliable autonomous tutor.

Alternative rejected: retain a familiar chat shell whose apparent agency exceeds its runtime integration. A richer embedded interaction can return later only with genuine shared context and write-back semantics.

## 2026-07-11 — Test annotation transfer on unseen Nietzsche

**Status:** experiment sequence  
**Scope:** prompt calibration and transfer  
**Relationships:** `derived_from` → one-chapter *Meltdown* calibration; `counterevidence_to` → claims that one successful chapter generalizes  
**Evidence:** current product exploration and learning-system synthesis caveats

First calibrate annotation diversity and usefulness on *Meltdown*. Then freeze the relevant prompt and apply it to an unseen Nietzsche chapter. The second text should test transfer across prose, genealogy, and conceptual texture rather than reward memorization of one chapter’s existing annotation ecology. Compare intervention kinds, omissions, Arthur edits, and false-positive explanations—not only card counts or rubric scores.

Passing one transfer check supports another bounded experiment; it does not establish a universal philosophy prompt.

## 2026-07-11 — Expanded composer UI debt is accepted temporarily

**Status:** deferred design debt  
**Scope:** reader interface  
**Relationships:** `deferred_by` → proof of useful read→mark→OMP loop  
**Evidence:** [current handoff](HANDOFF-LIVE-2026-07-10.md) notes visual weight and reading overlay

The expanded context composer is visually heavy and can overlay the reading surface. Defer a dedicated polish pass until the interaction proves useful. The likely later work is dock/collapse behavior, hiding the raw packet behind details, clarifying UTF-16 range labels, and moving secondary actions into overflow.

This is not approval of the current aesthetics. It prevents interface polish from masking an unproven product loop. Native selection and composer behavior must remain usable during calibration.

## 2026-07-11 — Vim shortcuts deferred

**Status:** deferred  
**Scope:** reader keyboard interaction  
**Relationships:** `deferred_by` → native selection/composer correctness and calibration  
**Evidence:** [current handoff](HANDOFF-LIVE-2026-07-10.md)

Do not add Vim-style reader shortcuts during the current experiment. They are desirable but can conflict with native text selection, editing, and composer keys. Revisit after the core interaction and focus model stabilize.

## 2026-07-11 — Hashcards is downstream/reference, not architecture

**Status:** decision  
**Scope:** queue/review integration  
**Relationships:** `corrects` → any reading of Hashcards as Primer’s global data model; `deferred_by` → calibration and promotion-contract work  
**Evidence:** [current handoff](HANDOFF-LIVE-2026-07-10.md), [`VISION.md`](VISION.md)

Use Hashcards as downstream approved-content format, scheduler/reference implementation, or source of boring existing scheduling rules. Primer’s canonical inbox remains the global daemon ledger; reader-local candidates need an explicit promotion contract before becoming global cards. Hashcards Markdown and SQLite do not define Primer’s product ontology, reader architecture, Arthur prior, or universal storage layer.

Alternative rejected: reshape all annotations and context artifacts around Hashcards merely because it already implements spaced repetition.

## 2026-07-11 — Corrections are candidate prediction targets

**Status:** long-horizon hypothesis  
**Scope:** learner-model evidence  
**Relationships:** `evidence_for` → plural Arthur prior; `deferred_by` → sufficient correction corpus and consentful design  
**Evidence:** repeated Arthur examples and Memory Machines targeting/construction distinction

Preserve accepts, dismissals, edits, and rewrites as provenance-rich correction edges. Later, the system may predict what Arthur is likely to delete, compress, challenge, or request before presenting an intervention. Prediction must remain scoped and inspectable; it should reduce nuisance, not harden a personality model. Silent personalization without visible evidence would defeat the purpose.

## 2026-07-11 — Experiment runs are immutable, inspectable artifacts

**Status:** accepted-local decision  
**Scope:** annotation workbench  
**Relationships:** `implements_slice_of` → calibration-first experiment; `corrects` → ephemeral prompt runs without exact provenance  
**Evidence:** `wrapped-commentary-reader/scripts/annotation-workbench.ts` and its focused tests

Each run freezes the exact request, source snapshot, response, provenance, and Arthur labels in its own directory. A fork names its `parent_run_id`; a comparison links two immutable runs rather than overwriting either. Prompt experiments remain outside the production annotation database until a separate promotion decision.

The durable prompt v0 and intent brief are already project-local at `wrapped-commentary-reader/experiments/meltdown-machinic/`; session-local `local://` copies are not authorities.

## 2026-07-11 — Explanation and durable review are different products

**Status:** decision  
**Scope:** comprehension and review  
**Relationships:** `corrects` → annotation-equals-flashcard assumptions; `evidence_for` → targeting/construction separation  
**Evidence:** Memory Machines, Matuschak, first Machinic Synthesis calibration run

Orientation, clause parsing, prerequisite context, genealogy, and source excerpts may resolve reading friction without deserving scheduled recall. A durable review candidate identifies a stable target; card construction and later scheduling are separate gates. Prompt runs must expose what they chose not to explain so Arthur can judge both intervention and exclusion.

## 2026-07-11 — Multi-book surfaces share one reader substrate

**Status:** accepted-local decision  
**Scope:** reader navigation and review  
**Relationships:** `supersedes` → single-book-only reader shell; `implements_slice_of` → authored work remains the spine  
**Evidence:** shipped multi-book reader and release QA

The current surface uses `#/` for the library, `#/book/<slug>` for reading, `#/review` for Anki-like annotation review, and `#/scan` for data triage. Book/unit provenance follows every write-back through `work_slug`. This routing is implementation state, not a claim that every future learning mode belongs in one application.

## 2026-07-11 — Themes are token-driven and system-aware

**Status:** accepted-local decision  
**Scope:** reader presentation  
**Relationships:** `implements_slice_of` → readable, inspectable local surface  
**Evidence:** Arthur’s system-theme request and shipped browser QA

Theme colors use CSS custom properties selected by `data-theme` on the root. `auto` follows `prefers-color-scheme`; manual light, dark, and terminal modes remain available. The terminal theme is a tactile/TUI exploration, not the single target aesthetic.

## 2026-07-11 — Variant B is local annotation doctrine, not universal pedagogy

**Status:** accepted-local process  
**Scope:** staged annotation batches  
**Relationships:** `derived_from` → prompt A/B evidence; `deferred_by` → Arthur calibration before further bulk generation  
**Evidence:** `wrapped-commentary-reader/references/prompt-craft-tacit-knowledge.md`

The local annotation contract uses a unit identity, exact block and verbatim anchor, title/front claim, kind/category/ontology, question, note, why-reference, references, verdict, and retrieval-target reason. Generation proceeds whole-unit thesis → coverage ledger/dedupe → target before fields → adversarial self-audit. This prevents known anchor drift and generic field-first cards; it does not prove that Variant B selects what Arthur should learn.

## 2026-07-11 — One global card inbox, explicit lifecycle

**Status:** accepted-local decision  
**Scope:** card capture and approval  
**Relationships:** `corrects` → fragmented Markdown/annotation/local-candidate stores; `deferred_by` → downstream export and scheduler design  
**Evidence:** `packages/primer-daemon/src/ledger.ts`, CLI tests, Hashcards synthesis

`primer card add` creates a provenance-bearing candidate in the canonical daemon SQLite ledger; `primer card status` moves it among candidate, approved, and rejected. Reader-local candidates and generated annotations require an explicit promotion/construction step before entering that inbox. HSK has a dedicated promotion bridge; general annotation promotion, approved Markdown export, review scheduling, and mobile sync do not yet exist.

## 2026-07-11 — Existing Meltdown annotations are useful; audit selection bias, not prose wholesale

**Status:** Arthur correction  
**Scope:** current Meltdown annotation corpus  
**Relationships:** `corrects` → “too basic” being interpreted as a request to discard or regenerate everything; `evidence_for` → provenance-visible calibration  
**Evidence:** Arthur reading the live annotations on 2026-07-11: “the annotations are pretty nice,” with concern that selection may over-rely on the recovered Claude/Fable-adjacent conversation

Keep the existing live and staged annotations available for review. The next question is whether their chosen targets represent the chapter as a whole or disproportionately mirror one conversation’s examples. Compare them against the chapter-level model, selective pre-read glossary, and Arthur’s actual selections. Revise or add only where a concrete omission, duplication, or wrong-level explanation appears.

## 2026-07-11 — Design work uses model portfolios, not a single-model assumption

**Status:** Arthur preference / active experiment  
**Scope:** UI/UX design and implementation  
**Relationships:** `corrects` → routing all taste work to Opus by default; `evidence_for` → inspectable proof before model preference hardens  
**Evidence:** Arthur requested parallel Opus 4.6, GPT-5.6 Terra, and GPT-5.6 Sol implementations of the same reader brief, each available under a distinct portless surface with cost and QA evidence

For consequential design work, a useful evaluation pattern is:

1. freeze one baseline screenshot and source snapshot;
2. give multiple models the same high-level brief, constraints, and acceptance rubric;
3. keep proposals private rather than allowing shared-tree collisions;
4. build proposals sequentially, then serve all bundles concurrently;
5. compare visual intuition, functional preservation, correction burden, latency, and cost;
6. preserve the first attempts rather than silently repairing them before comparison;
7. record Arthur’s choice and the specific ideas worth merging.

Current live comparison:

- `http://reader-compare.localhost:1355`
- Opus: `http://reader-opus.localhost:1355`
- Terra: `http://reader-terra.localhost:1355`
- Sol: `http://reader-sol.localhost:1355`

The first reader portfolio suggests Terra and Sol can perform real design work and should not be treated only as logic lanes. Terra is the preferred next experiment when a single non-portfolio design worker is needed; this is a dated preference, not a permanent capability claim. Actual billing telemetry was unavailable, so the comparison reports public API-equivalent estimates separately from actual spend.

## 2026-07-11 — Graph views are bounded evidence instruments, not spatial decoration

**Status:** implemented / active default  
**Scope:** reader knowledge views and cross-stream visual research  
**Relationships:** `corrects` → global force-layout graph as the default knowledge model; `evidence_for` → question-specific projections with deterministic provenance  
**Evidence:** typed graph substrate and five live projections at `http://meltdown.localhost:1355/#/graph`; source studies and reusable primitives under `docs/research/style-studies/`

The creation engine answers bounded reader questions through distinct projections: Passage Lens, Recurrence Trail, Authored Spine, Source Genealogy, and Evidence Neighborhood. A visible edge must be backed by a typed assertion with method, evidence, provenance transform, and confidence. Missing reader-specific blockers, prerequisites, or citation identity remain explicit unsupported claims. Semantic zoom changes the query and representation rather than merely scaling a force layout.

Style Studies are evidence, not templates. Poet Engineer and Nous Research sources are archived with coverage gaps, then distilled into motion, typography, diagram, and interaction principles. Projects may consume the machine-readable registry and studies, but must not copy motifs without a product-specific reason.

The first model portfolio selected GPT-5.6 Sol as the default UI/UX implementation lane for Primer: its restraint and editorial hierarchy survived blind review best. This supersedes the earlier provisional Terra preference while remaining a dated, evidence-specific routing decision.

## 2026-07-15 — One review stream: FSRS borrowed, priority as admission order, gating designed fail-open

**Status:** accepted-local decision (scheduler/priority/bridge shipped); design hypothesis (dependency gating)  
**Scope:** review scheduling across queue words and ledger cards  
**Relationships:** `implements_slice_of` → Arthur 2026-07-10 scheduler directive; `implements_slice_of` → [`CARD-PROMOTION.md`](CARD-PROMOTION.md) stage 8; `deferred_by` → knowledge-graph generation (gating brief only)  
**Evidence:** `docs/qa/primer-scheduler.md`, isolated browser QA report, 131-test package gate

Scheduling math is `ts-fsrs`, never hand-rolled. Priority is an admission-order concept: user-pushed words jump NEW-item introduction but never touch FSRS due timing. Review events are append-only with prior/derived state versions. Queue words and explicitly enrolled approved cards share one stream via `item_kind`/`item_id`; approval does not auto-enroll (explicit `primer review enroll`). Same-headword interleave guard separates sibling words in session order.

Dependency gating (Skycak primitives) is designed as a **fail-open admission filter** over the NEW branch only — an unvalidated or absent graph edge has no gating effect, so a sparse graph degrades to today's shipped behavior (`experiments/scheduler-dependency-gating/design-brief-v0.md`). Alternative rejected: encoding prerequisites inside FSRS parameters or hiding overdue reviews behind gates.

Companion experiment: enrichment prompt v0 (`experiments/queue-enrichment/`) treats enrichment output as CARD-PROMOTION stage 2–4 material — sense disambiguation against the quoted source sentence, constrained examples through the hsk-deck 85%-rule, targeting judgment without construction or approval. First 10 enrichments require Arthur per-field labels before any batch run.

## 2026-07-19 — Stretch-don't-mirror tutoring posture; prerequisite-DAG direction

**Status:** decision (posture) + hypothesis (knowledge graphs)
**Scope:** product-wide
**Relationships:** `implements_slice_of` → [`INTENT.md`](INTENT.md) tutoring posture; `evidence_for` → generators ledger rows 41/44/45/53 (`docs/fable/generators.md`)
**Evidence:** Arthur, live exocortex session 2026-07-19: "I'd like to learn new words, concepts, ideas and not be reduced to caricature of myself by reflecting my register"; same session resolved the earlier garbled intake reference to Justin Skycak's knowledge-graph/mastery-learning writing and asked for it as curriculum inspiration.

Tutor prose holds register half a step beyond Arthur's (ZPD) and never mirrors his idiolect back; every stretched term carries a one-line cash-out. Curriculum direction for hard domains (stats/probability first): a prerequisite DAG determines what is currently learnable; practice and review sequence against graph edges rather than topic lists. Falsifier for the posture: stretched register measurably increases abandonment or friction without retention gains. Knowledge-graph implementation stays deferred pending the one-chapter calibration lineage.

## 2026-07-27 — Validation cells prove Primer state across process restart

**Status:** implemented package contract and first cell  
**Scope:** Primer daemon reader, card intake, review scheduler, SQLite durability, and process evidence  
**Relationships:** `verifies` → 2026-07-15 review-stream decision; `implements_slice_of` → repository validation ladder  
**Evidence:** `packages/primer-daemon/validation/cells/chinese-reading-review.v1.json`, `bun run validate`, receipt from nixbox run at branch `review/primer-validation-cell-v3` — 27 assertions passed / 0 failed, 21 loopback HTTP requests, 9 SQLite writes, 3 process starts, 1 actual restart within the manifest cap (pid 1020640 → 1020654), persisted and observed due `2026-01-15T12:10:06.000Z`, `errors.log` and `server.stderr.log` both 0 bytes

Primer owns a small versioned validation-cell runner rather than a cross-stream test framework. Each manifest declares its state/process/browser layers, controlled entropy, oracle, budget, artifacts, cleanup, and negative control. Receipts are replayable metadata: schema and cell versions, relational assertions, process identifiers, counts, bounded artifact paths, restart due-time equality, and the invariant observed by the negative control.

The first cell uses authored Chinese text and an `example.invalid` source, real temp SQLite, production reader/card/review APIs, three grades across scheduler branches, and a full server stop/restart. A copied database with the enrolled card's scheduler row deleted must fail the due-time persistence invariant. Provider access is rejected and HTTP is loopback-only. The browser layer is explicitly deferred because this package has no reliable browser harness dependency; the next cell layer must add a real Chromium path rather than manufacture browser evidence.

Two consequences of running against trunk are worth recording. First, `packages/primer-daemon` does not compile on `main` at all: `dashboard.ts`, `index.ts`, `reader-api.ts`, and `enrich-runner.ts` import `error-log`, `review-feed`, `tabs-api`, `tabs-cli`, `browser-context/*`, and `anki-profile`, none of which trunk carries — they exist only on the unlanded `primer-h11-handoff` lineage. A plain `tsc --noEmit` on `main` reports 14 diagnostics; this branch reports 12 and adds none. `anki-profile.ts` is restored verbatim (blob `03feb3fd`) because the reader API cannot load without it; the browser-context and tabs modules are deliberately not dragged in.

Second, because `startDashboard` also boots the browser-context runtime, the validation server mounts the production route handlers directly instead. Card listing, approval, and enrollment moved out of the dashboard aggregate into `card-api.ts`, so the dashboard and the cell execute byte-identical production code for every route the cell touches. The clock is the only new production seam: an optional `now: Date` on the reading, review, and ledger writers plus a `PrimerClock` parameter on the reader and card handlers. There is no test-only session or secret seam.

The cell is not vacuous: rewriting the scheduler `INSERT … ON CONFLICT DO UPDATE` in `review-store.ts` to `DO NOTHING` makes it fail at `scheduler-grade-transition` with exit 1 and no receipt.

The review follow-up makes the manifest budgets executable rather than descriptive. The total timeout supplies the remaining deadline to each process and HTTP operation; HTTP requests, process starts, and actual positive restarts are counted before the operation crosses its cap. A real zero-restart run fails with typed `ValidationCellBudgetExceededError`, leaves `receipt.json` absent, and writes the failure to `errors.log`. A required browser layer likewise fails with typed `ValidationCellLayerNotImplementedError`; only an optional browser layer may emit the explicit skipped receipt. The runner unlinks any old receipt before touching logs or invoking the executor. After restart, both the queue API and a direct SQLite join assert the mark's paragraph index, start/end span, and sentence rather than relying on ids and surface text alone.
