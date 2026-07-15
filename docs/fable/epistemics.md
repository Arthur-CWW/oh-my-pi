# Epistemics — how to read and write shared context here

Docs are testimony, not ground truth. Every file in this repo was written by someone (usually an agent) at some moment, under some assumption that has been decaying ever since. Read accordingly; write accordingly. This doc is the covenant for both. It is deliberately generator-shaped so it ages slowly; anything fast-moving is linked, never restated.

## Why this exists (the failure it prevents)

An agent that obeys a stale doc performs a prompt injection on the user's behalf, against the user. Forensics of this repo (2026-07-15) found the loop: agents transcribe Arthur's utterances into docs as law → the fact base moves → nobody invalidates → the next agent obeys the fossil. The fix is not more docs; it is typed docs, provenance, and mechanical invalidation.

## Doc classes and how to treat them

| Class | Examples | Half-life | Reader rule | Writer rule |
|---|---|---|---|---|
| **Doctrine** | charter, priors, arthur.md, routing-doctrine, this file | months | Trust; push back from evidence when it seems wrong | Generator-shaped only: reasons and selection criteria, never concrete lane/model/quota facts |
| **Evidence** | dated lane-temperament entries, decision logs, friction ledgers | permanent as history | Weigh by date and provenance tier; never read as current policy | Always dated + attributed + scoped ("about X, observed on Y") |
| **State** | TASKS.md, GOAL.md settled sections, INDEX.md | days–weeks | Verify rows that show no recent activity before acting on them | Retirement is part of the write: touching a ledger means also flagging/removing rows you can see are dead |
| **Snapshot** | any restated config/model/quota fact in prose | days | **Config beats doc.** On conflict, the live file wins — and flag the doc | **Prohibited.** Link, never restate. One fact, one home: model roles live in `.omp/*.yml` + `~/.omp/agent/config.yml`; availability in `docs/state/model-availability.md` |
| **Handoff** | `HANDOFF*.md`, session dumps | single-use | A superseded or >7-day-old handoff is **history, not instruction**. Highest-dated `HANDOFF-LIVE-*.md` is live; everything else is archaeology | Supersede banner on the old file in the same commit that creates the new one |

## Provenance tiers

Every recorded preference or operational claim carries its tier. Tier + date + evidence pointer replaces fake confidence numbers (no "0.7" — a number implies a calibration nobody did).

- **A** — Arthur verbatim: exact words, date, and the context he said them in. Use when the wording itself is the preference.
- **A~** — Arthur paraphrased (most STT input): record the *generator*, not the utterance — what he values, its scope, and what would change his mind. Most of what he says is a reaction to a specific incident; write down the incident.
- **I** — agent-inferred: a pattern you extracted. Legal as a prior, never as a constraint. `I`-tier claims never enter Doctrine or Hard-rules without Arthur seeing them first.
- **M** — measured: has a rerun command or eval artifact. The only tier that outranks Arthur's vibes on factual questions.

Degree ladder when you must express strength: **vibe < tested-once < measured < gated** (enforced by lint/CI).

## Utterance → generator (the core discipline)

When Arthur states a preference, your job is not transcription. Infer the degree of truth and the scope before writing anything down:

1. **Ask or qualify** when a claim generalizes from one incident. "Never do X" after one bad run usually means "X failed here, on this model, on this day."
2. **Record the why.** "Never route to Terra" without its reason is a fossil the day a new Terra ships. With the reason ("not pareto-efficient vs Luna/Sol, judged 2026-07-15 on gpt-5.6-terra") it self-scopes: the ban covers that model, not the name.
3. **Push back for real.** Shallow agreeable pushback is worse than none. Meaningful pushback names the evidence that would falsify the claim and offers the alternative. Arthur enjoys the friction and overrides when he means it (charter §identity).
4. **Verbatim only when the wording is the point.** Otherwise, clean STT ramble into the generator and mark it `A~`.

## Model band-aids die with the model

Rules that exist only because some model kept making a mistake are **temporary patches, not preferences**. Each model release invalidates a batch of them, and they rot in the docs.

- Prefer pushing the rule down the guardrail ladder: AST-grep lint, ratchet, or a harness runtime reminder (catch the mistake once per run, remind in-context) beats a permanent doc sentence every model must re-read forever.
- If a doc rule is unavoidable, name the model and date it: `(band-aid for <model>, 2026-07-15 — delete when the lane rotates)`.
- Litmus: "would this sentence still be needed if the model were smarter?" No → guardrail ladder, not docs.

## Triage entries decay too

Queued questions/nitpicks/judgment calls carry a date and die honorably: an unanswered entry whose subject moved on is closed as `expired`, not answered late. Solving a problem at a different level closes the queue entries under it.

## Layering (which repo, which layer)

- **Core** (this file + charter/priors/arthur.md): philosophy, epistemics, taste generators. Lives in `~/agents` (the spine repo). Other repos link here; they never fork the philosophy, only add deltas.
- **Repo deltas**: each repo's AGENTS.md holds only what differs there (stack, commands, local invariants). If a rule is true everywhere, it belongs in core, stated once.
- **Runtime**: mechanical rules live in the harness (lints, ratchets, runtime reminders), not in prose. The harness is the layer that cannot be skimmed past.

## Enforcement backlog (harness-stream requests, not prose fixes)

1. Staleness lint: flag operational claims with `review-by`/`dies-with` markers past due; flag model names in Doctrine-class docs.
2. Supersede ratchet: creating `HANDOFF-LIVE-<date>.md` without banner-marking the predecessor fails lint.
3. Unified triage queue (defer-judgment / fill-blanks / nitpicks / taste forks / preference-change proposals) with expiry — preference prose lands as queue proposals, not direct commits to Doctrine.
4. Runtime mistake-reminder: first occurrence of a known lint-class mistake injects a one-line reminder into the offending agent's context for the rest of the run.
