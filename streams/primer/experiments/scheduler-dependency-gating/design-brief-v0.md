# Dependency Gating over FSRS — Design Brief v0

**Status:** design hypothesis (DESIGN ONLY — no code, no schema migration, no implementation).
**implements_slice_of:** Arthur's 2026-07-10 binding scheduler directive — the *"dependency gating from a knowledge graph (Skycak primitives are the spine)"* quadrant of "scheduling within scheduling."
**deferred_by:** knowledge-graph generation not yet built (multi-model edge cross-validation + Arthur review surface unbuilt; ledger has 0 reading docs as of 2026-07-15).
**Subordinate to:** [`../../INTENT.md`](../../INTENT.md), [`../../CARD-PROMOTION.md`](../../CARD-PROMOTION.md) (esp. stage 8), [`../../DESIGN-LOG.md`](../../DESIGN-LOG.md) (graph-views + Hashcards-downstream entries).
**Grounds every scheduling claim in:** [`../../research/skycak-scheduling-primitives-distilled.md`](../../research/skycak-scheduling-primitives-distilled.md) (cited as *distilled §N*; T1/T2 = the two source posts).
**Reads existing scheduler in:** `packages/primer-daemon/src/review-store.ts` (`review_state(item_kind,item_id)`, append-only `review_events`, `queue_items.priority`, `getReviewSession`, `interleaveReviewItems`/`sharesGuardFamily`, FSRS via `ts-fsrs`).

---

## 0. One-sentence thesis

Dependency gating is an **admission policy for NEW-item introduction only** — a filter and re-order layered *in front of* the FSRS-owned NEW branch of `getReviewSession` — that withholds introducing a card until its prerequisites are measured-mastered; it **borrows** its authority from the knowledge graph and the FSRS state that already exists, and it **never** invents a scheduling number or touches due-date math.

The core doctrine, stated once so every rule below inherits it: **gating is layered over FSRS, never inside it.** It changes *which un-enrolled items become eligible to enroll*, and in what order they are offered — nothing else.

---

## 1. Gating semantics

### 1.1 The one thing a dependency edge does

A validated `prerequisite(A → B)` edge means: **item B is not admissible for NEW introduction until A is measured-mastered** (§2 mastery signal). Concretely, in the existing scheduler this is a predicate applied to the *NEW candidate set only* — the `rs.item_id IS NULL` branch of `getReviewSession`. A non-admissible NEW item is **withheld** (left in `queue_items`, re-evaluated next session), never deleted, never mutated.

| # | Gating rule | Named Skycak primitive | Quote anchor (from distilled) |
|---|---|---|---|
| G1 | A prerequisite edge blocks *introduction* of the dependent until its prerequisites are learned. | **Prerequisite gating as hard ordering** (Math Academy: prerequisite ordering) | distilled §1, T2: a concept *"needs to be introduced after the prerequisites have been learned (so that the prerequisite knowledge can be pulled from long-term memory without taxing WM)."* |
| G2 | Admission credit requires *measured* mastery, not attendance or exposure. | **Measured mastery gating** | distilled §1, T1 reason 3: systems that gate but *"don't actually measure tangible mastery … The student has to actually be getting problems right, and those problems have to be representative of the content covered in the lesson."* |
| G3 | Do not let an item advance past unmastered prerequisites. | **Move-on anti-pattern** (the thing gating exists to prevent) | distilled §1, T1 reason 3: *"Tons of systems allow students to move on to more material despite not demonstrating knowledge of prerequisite material."* |
| G4 | Introduction stays bite-sized: gating admits one manageable frontier item at a time so no introduction overloads WM. | **Bite-sized granularity bounded by WM** | distilled §7, T2: each concept *"needs to be broken down into bite-sized pieces small enough that no piece overloads any student's WM"* (≈ *"4 chunks … for about 20 seconds"*). |
| G5 | *(informational at v1, NOT wired)* Reviewing a dependent implicitly reviews its prerequisites; that credit is real but its algorithm is unspecified, so it does not touch scheduling yet. | **Encompassment / implicit repetition credit** (Math Academy: encompassing / repetition-compression) | distilled §2, T1 reason 2: *"each time a student learns or reviews an advanced topic, they're implicitly reviewing many simpler topics, all of whose repetition schedules need to be adjusted."* Distilled §2 flags this **[AMBIGUOUS]** — no formula given — so v1 records the `encompasses` edge but must **not** act on it. |

### 1.2 What a gate must NEVER do (hard prohibitions)

1. **Never touch due timing of enrolled items.** The due branch (`rs.item_id IS NOT NULL`, `datetime(rs.due) <= now`, ordered by `due ASC`) is FSRS-owned and passes through untouched. Gating has *zero* read or write on `review_state` for enrolled items. (Grounded in doctrine: *scheduler BORROWED never invented — gating never alters FSRS due-date math.*)
2. **Never redefine content.** Gating consumes approved cards; it cannot re-author, re-scope, merge, or re-word them (CARD-PROMOTION stage 8: *"scheduling policy consumes, but does not redefine, approved content"*). A gate reads identity + state; it does not read prose to make pedagogical decisions.
3. **Never hide an overdue review.** No prerequisite state, no missing edge, and no gate decision may suppress, delay, or de-prioritize a due card. A dependent whose card is *already enrolled* keeps reviewing on its own FSRS schedule even if a prerequisite lapses — gating governs the *doorway (NEW → enrolled)*, not the *room (enrolled reviews)*.
4. **Never invent a scheduling number.** Gating produces a boolean admissibility and reuses the existing `priority`/`created_at`/`id` ordering. It introduces no interval, no stability delta, no due offset.
5. **Never block silently-forever without a human escape.** A withheld item must remain overridable (see §6 open question 4); gating that cannot be overridden is a lock, not an admission policy.

---

## 2. Mastery signal — what FSRS state can and cannot claim

A gate (G2) needs "is A mastered?" FSRS already stores, per `(item_kind, item_id)`: `stability`, `difficulty`, `reps`, `lapses`, `state`, `scheduled_days`. Map these to the Skycak mastery notion **without inventing new math**:

- **`reps`** approximates Skycak's repetition count directly: distilled §3, T1 — *"A 'repetition' is a successful review at the appropriate time."* Successful spaced reps are the literal unit of accumulated mastery.
- **`stability` / `scheduled_days`** approximate retention strength: distilled §3, T1 — *"the more reviews are completed (with appropriate spacing), the longer the memory will be retained."* High stability ⇒ the forgetting curve is flat ⇒ the prerequisite can be *"pulled from long-term memory without taxing WM"* (distilled §1, T2 — the exact mechanism G1 protects).
- **`lapses`** is a fragility signal: many lapses ⇒ the representation is not yet consolidated even if currently due-far.
- **`state`** (`new`/`learning`/`review`) is the coarse gate: only `state = 'review'` items are eligible to *grant* mastery credit.

**Proposed reader predicate (values are §6 open question 3, not asserted here):** `mastered(A) := state = 'review' AND reps ≥ R AND stability ≥ S_days AND lapses ≤ L`.

**What the FSRS signal CANNOT claim.** It measures *timed retrieval of one card's prompt*, nothing more:
- Not **comprehension** — distilled §10, T1 warns of the *"illusion of comprehension"*; a passed card is not understanding.
- Not **transfer / generalization** — distilled §5: blocked single-card practice *"can give a false sense of mastery and fluency"*; generalizability (distilled §11 goal) is exactly what a single card's history under-measures.
- Not **node-level mastery** when a concept has sibling/family cards (CARD-PROMOTION family/lemma/concept relations) — one card mastered ≠ the concept mastered (see §3 join and §6 open question 1).

**Where explicit human marks outrank FSRS.** Per INTENT (*"the human edits the model"*) and CARD-PROMOTION (human approval is the load-bearing decision), a human signal is authoritative over the statistical one, in both directions:
- A human **"known"** mark (`queue_items.status = 'known'`, or a future durable human mastery mark) grants prerequisite credit **without any review history** — it resolves the "Arthur already knew A from outside the system" case (§6 falsifier 2).
- A human **"not yet"** mark can veto admission even when FSRS says mastered.
This mirrors distilled §8 (**variable practice-to-mastery** — *"that amount of practice may vary depending on the particular student"*): the amount of evidence needed is not fixed, and the human is the final arbiter of "enough."

---

## 3. Graph contract — the minimal typed shape the scheduler consumes

The scheduler is a **consumer** of a graph it does not build. This section specifies only the *interface it reads*; the generation pipeline (multi-model proposal, cross-validation, Arthur review) is out of scope (see Non-goals).

### 3.1 Node identity vs review-item identity

- A **graph node** is a *concept / durable target* (CARD-PROMOTION stage 3 target, or a `concept`/`lemma` relation), **not** a card. Node id = a stable Primer target/concept id.
- A **review item** is `(item_kind, item_id)` — the composite key already used by `review_state`/`review_events` (currently `item_kind='queue_item'`, extensible per the shipped design).
- **The join is one-to-many:** a node maps to zero-or-more review items, because one concept can spawn sibling/family cards (CARD-PROMOTION family/lemma/concept). The scheduler resolves `mastered(node)` by aggregating `mastered(item)` over the node's items — with the aggregation rule (all / any / weighted) left to §6 open question 1. Gating never reasons over raw cards directly; it reasons over nodes and asks FSRS about their items.

### 3.2 Edge types

| Edge type | v1 status | Meaning | Why |
|---|---|---|---|
| `prerequisite(A → B)` | **v1, gating** | B not admissible until `mastered(A)`. | The only edge that gates (G1–G3). |
| `encompasses(B → A)` | **v1, recorded, NOT acting** | Reviewing B implicitly credits A. | Real (distilled §2) but algorithm is **[AMBIGUOUS]** in the source; storing it now avoids a later migration, but it must not alter selection or FSRS at v1 (§6 open question 5). |
| `related` / `contrast` / `cooccurs` / untyped similarity | **excluded from gating** | Evidence-view material only. | DESIGN-LOG 2026-07-11 graph-views doctrine: these belong to *bounded evidence instruments*, never to force-graph gating. They must never influence admission. |

### 3.3 Provenance / confidence required before an edge may gate

An edge is inert until it carries the fields Arthur's 2026-07-10 knowledge-graph directive requires:

- `method` — which models/derivation produced it.
- `model_agreement` — the multi-model cross-validation result (*"edges generated by SEVERAL models cross-validating"*).
- `arthur_review_status` ∈ {`pending`, `approved`, `rejected`} — the scan/review surface disposition (*"disagreements go to Arthur's scan/review surface"*).
- `confidence` — a scalar for thresholding.

**Gating eligibility (a fork Arthur owns, §6 Q2):** an edge may gate **only if** `arthur_review_status = 'approved'` OR (`model_agreement ≥ threshold` AND `arthur_review_status ≠ 'rejected'`). A `rejected` edge is permanently inert.

### 3.4 Failure default — **fail-open**

> **An edge that is unvalidated, `pending`, low-confidence, or absent has NO gating effect.**

If a NEW item has no gating-eligible prerequisite edges pointing at it, it is **admissible**. Therefore a sparse or empty graph reduces the scheduler to *exactly today's behavior* (all NEW admissible, priority-ordered). This is the doctrine safety valve: gating can only ever *withhold on positive, validated evidence of an unmet prerequisite* — never on ignorance. It aligns with *scheduler BORROWED never invented* and with graph-views doctrine (an unbacked edge is an *"explicit unsupported claim,"* not a force).

---

## 4. Composition order — one explicit algorithm sketch

Gating slots into the existing `getReviewSession` pipeline as a **filter + preserved ordering** on the NEW branch. Due branch and interleave guard are unchanged.

```
getReviewSession(now, limit, graph):

  # 1. DUE-FIRST — FSRS-owned, gating NEVER touches this.
  due = SELECT queue items WHERE enrolled (rs.item_id NOT NULL)
                            AND datetime(rs.due) <= now
        ORDER BY datetime(rs.due) ASC, id ASC          # unchanged

  # 2. NEW CANDIDATES — un-enrolled items.
  new_candidates = SELECT queue items WHERE rs.item_id IS NULL
                   AND status NOT IN ('known','discarded')

  # 3. DEPENDENCY-ADMISSIBLE NEW  ← the only new step.
  admissible_new = [ c for c in new_candidates
                     if all( mastered(node(p)) OR human_known(p)
                             for p in gating_prerequisites(c, graph) ) ]
  #   gating_prerequisites() returns ONLY edges that pass §3.3 eligibility.
  #   No eligible edge  ⇒ empty set  ⇒ admissible (fail-open, §3.4).
  #   Withheld candidates stay in queue_items, re-checked next session.

  # 4. PRIORITY ORDER — user-pushed items jump introduction order.
  admissible_new ORDER BY priority DESC, created_at ASC, id ASC   # unchanged

  # 5. INTERLEAVE GUARD — same as today.
  return interleaveReviewItems(due, admissible_new, limit)
  #   due phase first, then new phase; within each, avoid adjacency of
  #   sharesGuardFamily (identical word OR shared Han character).
```

Only step 3 is new. Steps 1, 4, 5 are the shipped code verbatim in intent. This preserves the directive's whole "scheduling within scheduling": **due timing (FSRS) is untouched**, **priority still only reorders NEW introduction**, **interleaving still forces same-lemma/sibling variations apart**, and **dependency gating is the admission filter feeding the NEW branch.**

### Worked micro-example (Chinese)

Queue: `好 hǎo` (char), `你 nǐ` (char), `你好 nǐhǎo` "hello", `好吃 hǎochī` "delicious", `吃 chī` (char).
Graph (validated): `prerequisite(好 → 你好)`, `prerequisite(你 → 你好)`, `prerequisite(好 → 好吃)`, `prerequisite(吃 → 好吃)`.
State: `好` enrolled, due now, `state=review, reps=4` ⇒ `mastered`. `你` has a human **"known"** mark. `吃` has no review state, no human mark ⇒ not mastered.

- **Due:** `好` (enrolled, due) → included, FSRS-ordered.
- **NEW candidates:** `你好`, `好吃`.
  - `你好`: prereqs `好` (mastered), `你` (human-known) ⇒ **admissible**.
  - `好吃`: prereq `吃` unmastered ⇒ **withheld** (stays queued, re-checked next session).
- **Priority order** of admissible new: `[你好]`.
- **Interleave guard:** session so far `[好(due)]`; next candidate `你好` shares Han `好` with `好` ⇒ guard defers it if another non-colliding item exists; here it is the only new item, so it follows. Result: `[好, 你好]` with `好吃` correctly held back until `吃` is learned — the move-on anti-pattern (G3) prevented, WM protected (G1/G4).

---

## 5. Per-domain applicability (explicit)

### 5.1 Chinese vocabulary — v1 instantiation (what dependency *means* here)

- **character → word encompassment / prerequisite:** a multi-character word's component characters are prerequisites (`好`, `你` → `你好`). This is a genuine WM-load claim (distilled §1/§7): a learner who cannot retrieve `好` will overload WM parsing `你好`.
- **morpheme composition:** compounds sharing a morpheme (`好` in `你好`/`好吃`; `吃` in `好吃`/`吃饭`) create prerequisite/`encompasses` structure at the morpheme level.
- **Deterministic source available now:** CEDICT + cjkvi **IDS decomposition** is already live (`data/primer/cedict.sqlite`). IDS gives character→component structure *deterministically* — a high-confidence candidate edge source (whether deterministic IDS is auto-trusted or still Arthur-reviewed is §6 Q2).
- **Graceful degradation (the current reality):** the ledger has **0 reading docs** and no graph. Under §3.4 fail-open, the scheduler runs *exactly as shipped today* — all NEW admissible, priority-ordered, interleave-guarded. As edges accrete and clear validation, gating switches on **per-edge, incrementally**; a partial graph gates only its validated subgraph and leaves everything else fail-open. There is no "graph required" state.

### 5.2 Maths — later (the same contract holds, ≤5 lines)

1. Node = a maths **topic** (Skycak's *"3,000 math topics"* graph, distilled §1 quoted tweet); items = its problem-type cards, joined by `(item_kind, item_id)` (e.g. `item_kind='maths_topic_card'`).
2. `prerequisite` edges gate a topic's NEW cards until upstream topics are **measured-mastered** (distilled §1, T1 reason 3 — the primitive is domain-agnostic).
3. `encompasses` (advanced topic reviews credit prerequisites, distilled §2) is where implicit-review credit would *eventually* wire — deferred identically (§6 Q5).
4. Mastery signal (§2), fail-open default (§3.4), and composition order (§4) are byte-for-byte the same; only the node/edge *source* differs.
5. **No FSRS-math change is needed to add maths** — confirming the contract is not Chinese-specific.

---

## 6. Falsifiers + open questions for Arthur

### Falsifiers — evidence that gating *hurts* (≤5)

1. **Blocked-frontier starvation.** Sessions repeatedly show due-only + a non-empty NEW backlog that is *fully withheld* (a rarely-due prerequisite locks a whole subtree). Metric: rate of sessions with `withheld_new > 0 AND admissible_new = 0`.
2. **Stale gates.** High human-override rate on withheld items ⇒ gates block things Arthur is actually ready for (esp. knowledge acquired outside the system with no review history).
3. **No retention/comprehension gain.** A/B: gated introduction vs fail-open priority order shows no improvement in retention or time-to-comprehension (HANDOFF metric) — gating adds latency without payoff.
4. **Threshold too loose.** Items admitted right after a prerequisite hits `mastered` lapse immediately *for prerequisite reasons* ⇒ the FSRS→mastery mapping (§2) under-measures readiness.
5. **False comfort from cross-validation.** Model-agreement is high but wrong-edge rate (caught only at Arthur's review surface) is also high ⇒ multi-model agreement is not evidence of correctness, only of shared bias.

### Open questions — taste forks only Arthur can decide (≤5)

1. **Node mastery aggregation.** When a concept has sibling/family cards, is it mastered when **all**, **any**, or a **weighted** subset of its items are mastered?
2. **Edge gating authority.** Does an edge gate on **multi-model agreement alone** (≥ threshold) or **only after explicit approval**? And is **deterministic IDS decomposition** auto-trusted or still routed to review?
3. **Mastery threshold values.** What `(reps R, stability S_days, lapses L)` counts as "mastered enough to unlock a dependent" — conservative (safe, slow frontier) vs permissive?
4. **Withheld-item visibility.** Should the reader show *why* a NEW item is withheld (which prerequisite blocks it) with a one-click override, or should gating be silent? (Override capability is required by prohibition #5; only its surfacing is a taste fork.)
5. **Encompassment wiring.** If/when does an `encompasses` edge earn the right to feed implicit-review credit into review *selection* (never FSRS math) — the one place distilled §2 pushes toward but current doctrine forbids?

---

## Non-goals (explicit)

- **No FSRS-math modification of any kind.** Due dates, intervals, stability, difficulty remain 100% `ts-fsrs`. Gating is admission-only.
- **No graph-generation pipeline implementation.** Only the *interface the scheduler reads* (§3) is specified. Multi-model proposal, cross-validation mechanics, and the Arthur review surface are separate work (`deferred_by`).
- **No UI design.** §6 Q4 names a UX fork but does not design a surface.
- **No schema migration or code.** This brief is a design a later session implements against; it references the shipped identity model but proposes no DDL.
- **No domain overfit.** Applicability is stated per-domain (§5): Chinese vocab now, maths later, contract identical. No philosophy-specific or Chinese-specific assumption is baked into the contract.
- **No `encompasses` action at v1.** The edge is recorded (§3.2) but must not alter selection or scheduling until §6 Q5 is resolved.
