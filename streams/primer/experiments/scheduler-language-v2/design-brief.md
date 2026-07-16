# Language Scheduler Layer over FSRS — Design Brief v2

**Status:** design hypothesis (DESIGN ONLY — no code, no schema migration, no implementation).
**implements_slice_of:** Arthur's 2026-07-15 scheduler directives (transcribed this session; cited `[Arthur 2026-07-15]`) — the *language-specific* review-selection quadrant of "scheduling within scheduling," as distinct from the graph-driven admission quadrant owned by the gating brief.
**Subordinate to:** [`../../INTENT.md`](../../INTENT.md), [`../../CARD-PROMOTION.md`](../../CARD-PROMOTION.md) (esp. stage 8: *"scheduling policy consumes, but does not redefine, approved content"*), [`../../DESIGN-LOG.md`](../../DESIGN-LOG.md) (2026-07-15 entry *"One review stream: FSRS borrowed, priority as admission order, gating designed fail-open"*).
**Consistent with:** [`../scheduler-dependency-gating/design-brief-v0.md`](../scheduler-dependency-gating/design-brief-v0.md) (cited *gating brief §N*). This brief occupies the complementary lane: gating governs the **doorway** (which NEW items enter); this governs **due-review selection, observation, and annotation** for already-enrolled items. They never touch the same code path.
**Grounds every scheduling claim in one of:** the Skycak distillation [`../../research/skycak-scheduling-primitives-distilled.md`](../../research/skycak-scheduling-primitives-distilled.md) (cited *distilled §N*; T1/T2 = the two source posts); a named **FSRS property** in `packages/primer-daemon/node_modules/ts-fsrs` (`forgetting_curve`, `next_recall_stability`, `next_forget_stability`); or an Arthur quote.
**Reads existing scheduler in:** `packages/primer-daemon/src/review-store.ts` (`buildReviewSession` due branch `ORDER BY datetime(rs.due) ASC`, `review_state(item_kind,item_id)`, append-only `review_events(…, prior_state_version, derived_state_version)`, `interleaveReviewItems`/`sharesGuardFamily`, `ts-fsrs` with `enable_fuzz:false`) and reader tables in `src/reading-store.ts` (`reading_paragraphs(doc_id,idx,text)`, `reading_marks(surface,sentence,paragraph_idx)`, `queue_items(word,status,lookup_count)`).
**Concurrency:** §1 (retrievability ordering) is being implemented in parallel by the **SchedulerRetrievability** slice. This brief owns the **WHY + the parameters**, not the code.

**Provenance tiers** (per PREFERENCES evidence discipline): `[A]` Arthur verbatim · `[A~]` Arthur paraphrase / his @pleometric written voice (dated) · `[I]` inference · `[M]` model judgment. Distilled/FSRS citations carry their own anchor and are not Arthur-tiered.

---

## 0. One-sentence thesis

The language layer adds **three observation-first instruments over the shipped FSRS/gating stream** — retrievability-ordered due selection, reading-exposure logging, and a failure-reason tag — each of which **re-orders what FSRS already ranks, records what the reader already sees, or labels why a card failed, and none of which invents a scheduling number or touches FSRS due-date math.**

The doctrine, inherited once from VISION decision 2 (*"Scheduler is borrowed, not invented"*) and the gating brief: **layered over FSRS, never inside it.** Ordering, observation, and annotation only. Where the gating brief's one prohibition is *"never invent a scheduling number,"* this brief's is the same, plus *"never write FSRS state from a passive signal."*

---

## 1. Retrievability as the ordering spine

### 1.1 The FSRS property the whole section stands on

FSRS stores, per card, a **stability** `S` (the interval at which predicted recall = the requested retention) and computes **retrievability** — the predicted probability of successful recall right now — from the forgetting curve (ts-fsrs `forgetting_curve`, `FSRSAlgorithm.forgetting_curve`):

> `R(t, S) = (1 + FACTOR · t / (9·S))^DECAY`  (ts-fsrs `index.d.ts` L195/L316; DECAY, FACTOR fixed by the algorithm)

Two properties are load-bearing:

- **At the due moment, every card sits at ≈ `request_retention`** (default 0.9): FSRS sets each due date precisely where `R` crosses the target. So the *due set itself* is not differentiated by `R` at the instant of becoming due.
- **Differentiation appears the moment you fall behind.** For elapsed `t` past the due date, `R` collapses fast for **low `S`** (young cards) and barely moves for **high `S`** (mature cards). This is the exact mechanism distilled §3 states verbally — *"the more reviews are completed (with appropriate spacing), the longer the memory will be retained"* (T1) — now read as a computable number rather than a schedule side effect.

### 1.2 Arthur's two asks are one knob turned opposite directions `[I]`

| Ask | Arthur's words `[A 2026-07-15]` | Mechanism | Grounded in |
|---|---|---|---|
| **Post-lapse: young cards first** | *"prioritize newly added cards … less steep decay as fast as possible … for longer-term cards it doesn't matter as much if we miss a day"* | Due set ordered by **`R` ascending**. Newly added ⇒ low `S` ⇒ steepest forgetting curve ⇒ **lowest `R` after a gap**. Ordering ascending surfaces exactly the young, most-decayed cards Arthur names; mature high-`S` cards (whose `R` barely moved over a missed day) correctly sort last. | FSRS forgetting curve (low `S` → fast `R` decay) + distilled §3 (expanding intervals: high-`S` cards tolerate a missed day). |
| **Tired mode: quick sweep** | *"late at night … I want to quickly review all the easy cards, the cards I'll probably get"* | Due set ordered by **`R` descending**, optionally capped to `R ≥ threshold`. *"cards I'll probably get"* = high predicted recall = high `R`. Highest-`R` first = the fast, low-effort sweep. | FSRS retrievability = predicted probability of recall (ts-fsrs `forgetting_curve` return value is `r`). |

**The unification:** both are a single computed quantity — `R` on the due set — sorted in opposite directions. Post-lapse is `R`-asc (attack the fragile); tired-sweep is `R`-desc (harvest the certain). One instrument, one knob. `[I]`

### 1.3 Why today's `due ASC` is insufficient `[I]/[M]`

The shipped due branch orders `datetime(rs.due) ASC` (`buildReviewSession`). Due-ASC equals `R`-ascending **only across cards of equal stability**. Across different stabilities it mis-ranks: a mature card (`S`=60d) overdue 3 days has `R`≈0.97; a young card (`S`=2d) overdue 1 day has `R`≈0.5. Due-ASC puts the mature card first (it "became due" earlier) though it is by far the safer of the two. **Computing `R` explicitly is precisely what makes "young first" correct** — the young card's collapsing curve is invisible to a due-date sort and obvious to an `R` sort. This is the whole reason the SchedulerRetrievability slice exists.

### 1.4 Parameters (the decisions the slice must make)

- **Quick-sweep threshold.** Anchor it to FSRS's own retention scale rather than minting an unrelated constant `[M]`. The concurrent v2.1 slice ships a **fixed `R ≥ 0.85` cap** (SchedulerRetrievability, via `scheduler.get_retrievability(card, now)`) — deliberately just *below* `request_retention` (0.9) so the sweep also catches cards sitting right at/just-under target, i.e. a slightly larger "I'll probably get" set. The principle holds either way: the cap is expressed as a retrievability floor on the FSRS scale, not a hand-rolled number. Whether the floor is `0.85` (shipped, looser), `request_retention` (0.9, exactly the target set), or a tighter `0.95` (shorter, higher-confidence sweep) is a taste fork (§6.2); all are the same knob.
- **Order vs filter.** Prefer **soft reorder** (`R`-desc across the whole due set, Arthur stops when tired) with an **optional cap** to a bounded easy subset — never a hard *hide*. This inherits gating prohibition #3 verbatim: **never suppress, delay, or de-prioritize a due card into invisibility.** The sweep is a lens, not a filter that loses reviews. `[M]/[A~]`
- **Do quick-sweep grades update FSRS state normally? — YES, unchanged. Argued `[M]`:**
  1. A quick-sweep card is still a **closed-book retrieval at a real time `t`**. FSRS's post-recall stability update `next_recall_stability(D,S,R,G)` (ts-fsrs L288/L295) is *defined for exactly this event*. Nothing about "I did it while tired" changes what happened.
  2. A passed easy card **is a repetition** — distilled §3, T1: *"A 'repetition' is a successful review at the appropriate time."* Discarding it throws away a genuine, correctly-timed rep.
  3. Suppressing the update would require a **second, non-FSRS write path** (a "warm-up that doesn't count"), which is exactly the invented-scheduling the doctrine forbids, and would desync the append-only `review_events` (`prior/derived_state_version`) from `review_state`.
  The mode changes **only which due cards surface first and how many** Arthur chooses to do. Grading is byte-identical to a normal session. (A "no-consequence warm-up" is left as taste fork §6.3, with its cost named.)
- **`R` is read, never written.** All ordering reads `R` from stored `stability` + elapsed days via the FSRS forgetting curve — the shipped slice calls `scheduler.get_retrievability(card, now)` (which evaluates `forgetting_curve` internally) and **persists no `R`**. No interval, stability, difficulty, or due value is computed by this layer.

**Supporting Arthur signal `[A 2026-07-15]`:** *"each card as flat as possible"* (see §4) is what makes an `R`-desc sweep coherent — a flat card is one retrieval, so "I'll probably get it" is a single well-defined probability, not an average over several sub-demands.

---

## 2. Exposure crediting (the hard one)

### 2.1 The phenomenon and its named primitive

Arthur `[A 2026-07-15]`: *"some words, some radical characters appear a lot in a lot of different sentences, so you get exposed to them much more — how do we integrate that."* His @pleometric voice `[A~]` states the acquisition mechanism this rides on: comprehensible input *"is to let meaning emerge from repeated exposure, but you can adjust where that exposure is gonna come from"* (`x.com/pleometric/status/2036466514556064052`). VISION already recorded the link: *"Reading a sentence containing five due words IS a FIRe-style implicit review."*

**Named Skycak primitive: scheduling-within-scheduling / implicit repetition credit / encompassment** — distilled §2, T1 reason 2: *"each time a student learns or reviews an advanced topic, they're implicitly reviewing many simpler topics, all of whose repetition schedules need to be adjusted."* **The load-bearing caveat:** distilled §2 flags this **[AMBIGUOUS]** — *"the threads do not specify the algorithm for how much implicit-review credit a prerequisite receives."* There is a real effect and **no trustworthy formula** for its magnitude.

### 2.2 The substrate already exists

*"Which known/queued words each read paragraph contained"* is a pure JOIN over shipped tables — no new content, no LLM call:
- `reading_paragraphs(doc_id, idx, text)` — the text Arthur read.
- `reading_marks(surface, sentence, paragraph_idx)` — what he marked, and where.
- `queue_items(word, status, lookup_count)` — the queued/known set; **`lookup_count` is already a mark-derived exposure counter.**

Segment a read paragraph's `text`, match tokens against `queue_items.word` (queued) and `status='known'` (known). That set is the implicit-exposure event. `[A~ data model]`

### 2.3 Three options, tradeoffs, false-stability risk

| Option | What it does | Tradeoff | False-stability risk |
|---|---|---|---|
| **(a) No credit (status quo)** | Exposure invisible to the scheduler. | Zero risk; but ignores a signal Arthur explicitly named — a high-recurrence character keeps coming due on its solo card though he meets it constantly (wasted reps; a driver of the review fatigue §1's sweep exists to relieve). | **None** — but under-credits, over-schedules high-frequency items. |
| **(b) Encompassment credit into scheduling** (Skycak §2) | On a read paragraph, push implicit-review credit (bump `S` / defer due) to every contained known/queued word. | Matches the FIRe ideal; **but the "how much" is exactly the [AMBIGUOUS] gap** distilled §2 flags — the formula would be invented, not sourced. | **Severe.** FSRS `S` is defined to update *only on active closed-book retrieval*; passive reading is **re-ingestion, not retrieval** — distilled §4/T2: *"that doesn't happen if you just passively re-ingest the information through your senses"* (VISION: *recognition ≠ production*). Crediting it inflates `R` with no retrieval behind it ⇒ cards look mastered, decay unmodeled, silent forgetting. Also mutates FSRS state outside `ts-fsrs`. |
| **(c) Exposure logging without scheduling effect — RECOMMEND v1** `[M]` | Append-only `exposure_events(item_kind, item_id, doc_id, paragraph_idx, event_time, source='reading')` per contained known/queued word per read paragraph. `review_state` untouched. | Buys the dataset to answer the [AMBIGUOUS] question **empirically** later (does high reading-exposure between reviews actually reduce lapse rate?), so a future actuation is *measured*, not guessed. Cost: storage + a later analysis pass. | **None** — the scheduler is not read from or written to. |

### 2.4 Recommendation and boundary

**v1 = option (c).** It is the only option that respects **both** constraints at once: FSRS's retrieval-only stability semantics (rules out (b)) and Arthur's named signal (rules out (a)). It mirrors the gating brief's fail-open *observe-first* posture (gating §3.4) and DESIGN-LOG's *observe-before-actuate*, and it is the same discipline as enrichment's hand-labeled calibration batch: **record the signal, prove it earns actuation, then wire it.**

**Explicit non-overlap with the gating brief:** the gating brief owns the *graph edge* `encompasses(B→A)` — *"recorded, NOT acting"* (gating G5, §3.2). This brief owns the *reading-event* exposure log. Both are "record now, actuate never at v1," but they are **different observation channels** (static graph structure vs live reading behavior) feeding the same future question. No mechanism is shared, so neither can double-count. `[I]`

**Reader-loop tie:** the exposure log is also the data behind Arthur's coloring ask `[A 2026-07-15]` — *"mark up the character … depending on: have we seen it or not … is it the first time we see the card."* "Seen it / first time" is a projection of `exposure_events` + new-introduction; **rendering that coloring is ReaderReviewUI's to own** — this brief only supplies the log it reads.

---

## 3. Failure-reason taxonomy

### 3.1 Three failures wearing one 'again'

Arthur `[A 2026-07-15]`: *"different reasons why I fail the card: I can't decode the whole sentence — too many new cards — fix that at its core; or it takes me too long to read the sentence; or [forgot]."* A bare `again` collapses three failures with **three different remediations** into one memory-lapse signal:

| Reason | Trigger | Feeds back into | Grounded in |
|---|---|---|---|
| **decode** | Sentence had too many unknowns — an **85%-rule violation**. The card is malformed, not forgotten. | **Card construction**, *not* scheduling: regenerate the example through hsk-deck constrained generation (VISION card-level CI rule: *target is THE one new item; ≤1 unknown beyond target*) / re-scope. | Wilson et al. 85% rule (VISION); enrichment brief coverage discipline; = "card not flat" (§4). |
| **slow** | Decoded correctly but slowly — **fluency, not knowledge.** | **Exposure emphasis, not re-explanation** `[A~ framing]` — more reps / shorter interval / the §2 lane; never rewrite the card. | distilled §9 (automaticity frees WM); VISION *"correct-but-slow is not solid."* |
| **forgot** (default) | True lapse: `S` was over-estimated; the card correctly re-enters learning. | **Nothing new** — this is the *only* reason FSRS's lapse path (`next_forget_stability`, ts-fsrs L298/L306) is the right response. | FSRS lapse handling; distilled §3 decay. |

**The doctrine `[M]/[I]`:** the failure reason **routes the fix to the right subsystem.** Only `forgot` is a scheduling event; `decode` is a content bug; `slow` is a fluency signal. Today's status quo mislabels all three as lapses, so FSRS absorbs content and fluency failures **as if they were memory failures — corrupting `S` with false lapses.** The tag exists to stop that corruption at the source (matching Arthur's *"fix that at its core"*).

### 3.2 Capture UX cost — ~zero friction, optional, default 'forgot' `[A constraint]`

- The `again` key already exists and **fires the normal FSRS lapse immediately** (default reason = `forgot`). The tag is a *refinement of an event that already happened*, never a gate on the next card.
- After `again`, a **one-keystroke, dismissable micro-overlay** (e.g. `d`/`s`/`f` = decode/slow/forgot) can re-tag the just-written event within a brief window. Press nothing ⇒ it stays `forgot`. It **never blocks**, never modals. Grounded: VISION *"effortless capture — one gesture"*; PREFERENCES *"make uncertain state glanceable and playable."* `[M]`
- Consistency: the FSRS write happens **first**, tag **second**; no required field is ever added to the grading path.

### 3.3 Storage — `review_events` extension

Add a **nullable** column: `fail_reason TEXT CHECK(fail_reason IN ('decode','slow','forgot')) DEFAULT NULL`, meaningful only when `grade='again'`. `review_events` is already append-only with `prior/derived_state_version` (`gradeReviewItem`), so this is **purely additive** — existing rows read `NULL` (= untagged), no backfill, and **`review_state`/FSRS are untouched.** `[A~ data model]`

---

## 4. 'Each card as flat as possible'

**Arthur `[A 2026-07-15]`:** *"each card as flat as possible."*

**Interpretation `[I]`: minimal compound difficulty — one retrieval demand per card.** A flat card asks the learner to retrieve exactly one thing; a card is "steep/lumpy" when answering it requires clearing several unknowns at once, overloading working memory. This is the per-card instantiation of distilled §7 (**bite-sized bounded by WM**: *"small enough that no piece overloads any student's WM"*; *"4 chunks … for about 20 seconds"*) and §5 (interleaving = *"minimal effective doses"* per skill).

**Connection to the failure taxonomy `[A]/[I]`:** **decode-overload IS the review-time measurement of a non-flat card.** When `again` is tagged `decode` (§3), that card demanded more than one retrieval — it was not flat. So `decode` is the *empirical detector* of a flatness violation, and flatness is the *target* the decode-remediation restores. Flatness (design-time) and decode-overload (review-time) are the same property from two ends of the loop.

**Connection to enrichment's review-target discipline:** the queue-enrichment brief already enforces flatness at construction — *"the target is THE one new item; scaffolding from the known set; ≤1 glossed extra,"* one operative sense selected against the quote (no sense-dumping), examples at 85–95% coverage with `unknown_tokens` reported. **Flatness is not a new mechanism — it is the review-side name for the construction-side constraint enrichment owns.** The scheduler's only job is to **detect** violations (the `decode` tag) and **route** them back to that construction discipline; it never flattens cards itself (CARD-PROMOTION stage 8: *scheduling consumes, does not redefine content*). `[M]`

**Scheduler implication `[M]`:** flatness is the precondition that makes the existing same-headword interleave guard (`sharesGuardFamily`) and *"minimal effective dose per skill"* (distilled §5) coherent — a lumpy card is really several skills and cannot be interleaved or `R`-ranked cleanly.

---

## 5. Prioritized implementation sequence (observe-before-actuate)

**Principle `[A~]/DESIGN-LOG:** observe first, actuate on measured evidence — the same posture as gating's fail-open and enrichment's calibration batch. Ordered by (i) reversibility, (ii) no-FSRS-mutation first, (iii) data-before-policy. Also tracks Arthur's *"we have to get to the features which actually aid in learning, and slowly peel them off"* `[A 2026-07-15]` — earn each feature on evidence, keep it removable.

- **v2.1 — Retrievability ordering** *(actuating, but pure re-order; concurrent SchedulerRetrievability slice).* Compute `R` from stored `stability` + elapsed via `forgetting_curve`; add two due-set orderings — post-lapse `R`-asc, tired quick-sweep `R`-desc with optional `R ≥ request_retention` cap (§1.4). No FSRS write change; grades normal. Lowest risk because it only *permutes an existing set* and never hides a due card. Falsifier-gated (§6.1, §6.2).
- **v2.2 — Failure-reason tag** *(observation + light routing).* Nullable `fail_reason` on `review_events`; one-keystroke optional capture defaulting `forgot` (§3.2). Initially **pure annotation** — `decode`/`slow` are logged and surfaced (dashboard / card-construction queue) before any automated remediation. FSRS untouched.
- **v2.3 — Exposure logging** *(observation only).* Append-only `exposure_events` from read paragraphs (§2, option c). No scheduling effect. Accumulate the dataset.
- **v2.4 — Measured-actuation review** *(a gate, not a build).* Only after v2.2/v2.3 hold data, ask empirically: (i) does `decode`-tag rate identify which generated cards to regenerate? (ii) does high reading-exposure between reviews correlate with fewer lapses (would justify Skycak §2 encompassment credit — option (b))? (iii) does `slow` predict future `forgot`? Each **"yes"** unlocks a *specific, evidence-shaped* actuation; each **"no"** leaves the channel as a dashboard. **Never wire option-(b) stability credit before this gate.** `[M]`

v2.1 ships independently (already in flight); v2.2 and v2.3 are additive and unordered w.r.t. each other; v2.4 depends on both.

---

## 6. Falsifiers + Arthur taste forks

### Falsifiers — evidence the language layer *hurts* (≤5)

1. **Young-first starvation.** Post-lapse `R`-asc surfaces so many collapsed young cards that Arthur never reaches high-value mature due reviews. Metric: rate of sessions where `R`-asc pushes an overdue high-`S` card past the session limit.
2. **Quick-sweep false comfort.** The `R ≥ threshold` sweep passes repeatedly and Arthur feels done, but next-day lapse rate on the *un-swept low-`R` tail* spikes — the sweep trained the wrong subset. Metric: lapse rate on cards deferred by sweeps.
3. **Failure-tag noise.** `decode`/`slow` tag rate is high but later edits show most were mis-pressed (friction > signal), **or** everything defaults `forgot` and the taxonomy yields no routing signal. Metric: tag distribution + re-tag/correction rate.
4. **Exposure log inertia.** `exposure_events` grows large but shows no usable correlation (high-exposure words lapse the same as low-exposure) ⇒ the encompassment intuition is unsupported *for language*; stay on option (a). Metric: lapse-vs-exposure regression at v2.4.
5. **Flatness un-actionable.** `decode` tags don't map to fixable cards (the source sentences are just hard authentic input, not malformed cards) ⇒ `decode` is a reading-difficulty signal, not a card bug, and the §3→§4 routing is miscalibrated.

### Taste forks — only Arthur decides (≤5)

1. **Post-lapse trigger.** `R`-asc kicks in **automatically** after a detected missed day/lapse, or only as an explicit **"catch-up mode"** Arthur selects?
2. **Quick-sweep threshold & shape.** `R ≥ 0.85` (shipped v2.1 default, looser) vs `R ≥ request_retention (0.9)` (exactly the target set) vs a tighter floor (`0.95`, shorter/higher-confidence); and **soft reorder** (stop when tired) vs **hard cap** to a bounded easy set.
3. **Do quick-sweep grades count?** This brief argues **yes** (normal FSRS update, §1.4). Fork kept explicit in case Arthur wants a no-consequence **warm-up** mode — with its cost named: a second, non-FSRS write path.
4. **Failure-tag surface.** Three keys always visible vs a hold-to-reveal micro-overlay only on `again`; and default `forgot` vs a distinct `untagged` value.
5. **Exposure granularity.** Log exposure **per read paragraph** (coarse, cheap) vs per rendered sentence vs **per character/radical occurrence** — Arthur named radicals specifically (*"radical characters appear a lot"*); finer granularity = more signal, more write volume.

---

## Non-goals (explicit)

- **No FSRS-math modification.** `R` is read via `forgetting_curve`, never written; no interval/stability/difficulty/due value is computed here. Quick-sweep grades use the **unchanged** `ts-fsrs` update.
- **No acquisition theory.** The word↔concept mapping, radical/root (Hanly) decode scaffolding, Cantonese vertical alignment, and ASR (FireRedASR2S) belong to the sibling acquisition brief. This brief is scheduling / observation / annotation only.
- **No FSRS-parameter encoding of prerequisites, and no hiding overdue reviews behind gates** (rejected alternatives, DESIGN-LOG 2026-07-15). Prohibition inherited from the gating brief: never suppress a due card.
- **No overlap with gating's `encompasses` edge.** That is graph-side, recorded-not-acting; this is reading-event logging. Both observe-first; neither double-counts.
- **No card authoring.** Flatness is *detected* (§3 decode) and *routed* (§4), never enforced by the scheduler (CARD-PROMOTION stage 8).
- **No UI design.** The sweep/catch-up affordance, the failure-tag overlay, and the seen/first-time coloring are ReaderReviewUI's surfaces; this brief specifies only the data and selection behavior beneath them.
- **No schema migration or code.** Additive columns/tables are *named* (`fail_reason`, `exposure_events`) for a later slice to create; no DDL is prescribed here beyond that naming.
