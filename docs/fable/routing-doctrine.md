# Routing Doctrine

Status: canonical, model-agnostic policy  
Owner: frontier orchestrator  
Last reconciled: 2026-07-10

This document governs how an orchestrator routes work across agent lanes. It is policy, not a list of currently fashionable models. Provider availability, model releases, account quotas, and observed temperaments change; the decision contract does not.

## Objective

Optimize Arthur's attention first: route each packet to produce the required quality and reliability with appropriate latency, quota use, context and tool fit, and cost. Preserve scarce high-judgment orchestration capacity for synthesis, taste, irreversible decisions, routing, and gates; delegate execution whenever a worker can own it. Cheap empirical adaptation beats permanent intuitions. Throughput is capacity, not quality.

This discipline applies to every scarce orchestrator, not only Fable. A scarce lane does not do routine implementation, repeated scouting, browser QA, or administrative loops merely because it can. It defines the packet, selects and supervises a route, evaluates evidence, and spends its own capacity only where its distinct judgment changes the result.

## Stable ontology

- **Work packet**: an auditable contract containing the assignment, role, owner and excluded paths, acceptance, non-goals, constraints, and applicable budget/context/tool needs.
- **Work role**: the capability and responsibility needed for a packet, such as orchestrator, implementer, reviewer, designer, scout, researcher, or operator. A role says what judgment is required, not which model supplies it.
- **Persona**: a role-shaped instruction/context profile. It is replaceable and is not a model, provider, or account.
- **Lane**: a concrete execution option: a resolved provider/model/account, effort level, tool/skill and context profile, budget posture, and state. Eligible roles are recorded by policy and evidence; a lane is an operational fact, not an identity.
- **Lane registry**: the current catalog of lanes, their capabilities, restrictions, availability, and evidence links.
- **Routing policy**: durable rules for eligibility, selection, experimentation, escalation, and fallback.
- **Resolved decision**: the concrete route selected for one packet, including why alternatives were excluded and what policy/config sources won.
- **Observation**: dated, evidence-linked measurement or review judgment about a lane under stated conditions. It may support, weaken, or retire a hypothesis; it is never timeless doctrine.

Roles and personas MUST remain independent of models, providers, accounts, and effort labels. A model/account change may replace a lane implementation without renaming the role or rewriting policy. Conversely, one model may serve several roles only where evidence and constraints permit it.

## Routing pipeline

Every dispatch follows this pipeline:

```text
work packet
  → requirements and hard constraints
  → eligible lanes
  → exploit / experiment decision
  → resolved route and explanation
  → execution
  → evidence
```

1. Extract functional work type and non-functional needs: quality bar, reversibility, novelty/ambiguity, latency, budget, context, tools, privacy/auth, availability, and required independence of review.
2. Remove lanes that violate hard constraints. A preferred or explicitly selected lane is never eligible if it cannot satisfy a hard constraint.
3. Decide whether existing evidence justifies exploitation or whether the packet qualifies as a bounded experiment.
4. Resolve the route, including a fallback chain where required, before execution when feasible.
5. Record the decision and give the requester/worker a concise explanation. Execute against the packet, then attach evidence and update observations only when the result warrants it.

### Policy layers and precedence

The winning value is selected in this order:

1. hard constraints;
2. per-spawn explicit choice;
3. session strategy;
4. workspace policy;
5. global policy.

Higher layers override lower layers only visibly. A resolution MUST identify each source consulted, every overridden value, and the final value; no runtime override, inherited default, or account selection may silently shadow another layer. An explicit choice is an intentional exception, not new policy, and must carry a reason and scope.

## Lane registry, states, and evidence

A lane registry records operational facts needed to decide eligibility: resolved provider/model/account and effort, supported tools/context profile, available quota or capacity, allowed work roles, restrictions, fallback eligibility, and links to observations. It does not turn those facts into universal recommendations.
When several accounts back an eligible lane, load-balance only across accounts that meet the packet constraints. Record the serving account and its per-account quota and cost provenance for every run; account selection is never hidden.

A lane is one of:

- **candidate**: available for bounded evaluation; not a default.
- **active**: eligible for stated role/work conditions with current supporting evidence.
- **constrained**: usable only under recorded limits, such as a quota, tool, reliability, or safety constraint.
- **unavailable**: currently ineligible because of outage, auth, quota, or unmet constraint; retain its history.
- **retired**: intentionally removed from routing; preserve evidence and retirement reason.
- **sunsetting**: planned cancellation or withdrawal is known but not yet effective; treat the lane as constrained until its effective date, then re-resolve affected routes.

Observations MUST be dated and identify the lane version, packet/work type, relevant context/tool/effort conditions, evidence artifact or review, outcome, confidence, and expiry/review trigger. Credible external provider reports and third-party evaluations are valid prior evidence when their scope and provenance are recorded; local reproduction is not required for every claim. Use local comparable evaluations for harness-specific fit, contradictory evidence, or high-leverage uncertainty. Recency and comparable evidence matter more than folklore. Anecdotes may enter as low-confidence hypotheses; stale observations must be revalidated, constrained, or retired rather than silently carried forward.

**Historical evidence examples, not mappings:** observations concerning Terra, Sol, Kimi, Opus, or Fable are dated evidence about particular versions, accounts, packets, and harness conditions. They MUST NOT establish that any named model is permanently the best worker, designer, reviewer, orchestrator, or fallback. In particular, Fable-specific scarcity and temperament notes describe a historical lane, not a universal orchestrator doctrine.

## Exploit and explore

Exploit an active lane when the packet is routine enough, its constraints are met, recent comparable evidence reaches the needed quality bar, and experimentation would waste attention or introduce unacceptable risk.

Explore when a candidate model/provider/account appears, evidence is stale or contradictory, a material work type has no credible active lane, a recurrent failure/refusal/quota event changes the frontier, or a bounded fork could answer a decision that will recur. Exploration MUST have a declared hypothesis, comparison axis, packet budget, stopping rule, and reviewer/decision owner. Do not experiment on irreversible, high-stakes, or time-critical work unless the packet explicitly accepts that risk.

A new release enters as a **candidate**, never as a default because of release claims, benchmark marketing, or a single impressive run. Promote only after sufficient scoped evidence under the outcome rubric—external, local, or both—supports the intended role; constrain or retire after repeated contrary evidence.

### Minimum effective effort

Effort/thinking level is independent of lane selection and is an experiment axis. Start at the lowest evidence-supported effort that can meet acceptance; bounded, low-entropy implementation normally avoids high or extra-high effort. Escalate medium to high only for ambiguity, hard planning, failed acceptance, irreversible decisions, or evidence that the marginal gain exceeds added token and latency cost. Treat diminishing returns from high or extra-high effort as a provider-agnostic hypothesis to measure, not doctrine.

### Minimum-effective-cost frontier

Lane capability/model strength and effort/thinking budget are independent knobs, not substitutes. First select the weakest eligible lane whose capabilities plausibly clear the packet requirements, then select the lowest evidence-supported effort. For recoverable failure, escalate one axis at a time—effort within the lane or lane capability—so the result teaches the router; use stronger initial bounds for irreversible or ambiguous work. The orchestrator's difficulty estimate is itself a hypothesis: measure over- and under-routing against outcomes. Advisor composition is a third optional axis, not a substitute for either lane capability or effort.

**Lane-strength criterion (Arthur, 2026-07-13).** Estimate three packet properties and route on them, not on task size:
1. **Decision entropy** — how many real decisions the packet contains. Low-entropy ("robotic": benchmarks, mechanical ports, straightforward subtasks) → cheap/fast lane, even for UI/UX iteration.
2. **Blast radius** — how integral the code is: when everything builds on it, mistakes are hard to catch and annoying to fix → strong lane plus extra testing/independent review.
3. **Mistake legibility** — how easily a wrong result announces itself. Highly legible failure (visible UI, hard test oracle) tolerates a cheap lane and buys iteration speed; illegible failure (state, concurrency, silent corruption) demands a strong lane.
Cheap lanes are the peripheries; strong lanes are the chunky core. Workers on a strong lane SHOULD themselves spawn cheap-lane children for the low-entropy parts of their packet rather than doing them inline.

### Comparable forks and evaluations

Use a shared packet and acceptance rubric. Keep owner paths, evidence requirements, time/cost caps, and evaluator fixed. Vary one declared axis where practical: lane/model/provider, persona, tool profile, context manifest, effort, prompt, or advisor composition. Advisor composition is an explicit worker-lane plus independent-advisor-lane experiment: measure marginal quality and reliability against added cost, latency, and context pollution. An advisor is never silently bundled into a persona. Record all uncontrolled differences. Blind review where possible; preserve prompts/context manifests, route resolution, raw outputs/artifacts, retries, interventions, latency, token/cost/quota data, and final reviewer judgment.

A comparison without a declared packet, outcome rubric, and context/tool provenance is a demo, not routing evidence. A fork may reveal a failure mode even when neither result is promotable.

## Outcome rubric

Assess outcomes in this order:

1. **Behavioral gates and acceptance**: did the result actually satisfy the packet's observable contract?
2. **Reviewer or human judgment**: quality, taste, correctness, steerability, and appropriateness for the role.
3. **Reliability**: errors, refusals, retries, fallback pressure, unplanned interventions, and recovery quality.
4. **Efficiency**: end-to-end latency, tokens, cost, quota consumption, and useful throughput.

Report the dimensions separately. Never use token volume, edit volume, or throughput as a proxy for quality. A fast lane that repeatedly needs correction is not efficient; a high-quality lane that consumes scarce orchestration attention may be inappropriate for routine work.

## Failure, fallback, and escalation

Failures are typed facts: provider error, quota/rate limit, auth failure, refusal/content filter, timeout, invalid output, failed acceptance, or human/reviewer rejection. Record the original route, failure class, evidence, retry relation, fallback relation, and final outcome.

Retry only when the failure is plausibly transient and the packet budget permits it. Otherwise move to the next eligible lane in the declared fallback chain or return to the orchestrator for a new constraint/packet decision. Never disguise a fallback as a successful first route, silently downgrade the quality bar, or continue an ineligible lane because it was the initial choice. Preserve context only when it remains appropriate for the new lane; re-resolve tool, account, and privacy constraints after every handoff.

Escalate to a scarcer or stronger lane for ambiguity, irreversible decisions, repeated failed acceptance, or a requirement that the current lane cannot meet—not merely because a worker is slow. Escalation and fallback are decisions with provenance, not invisible retries.

## Release and quota-change protocol

When a model releases, an account changes, or quota/availability shifts:

1. Update the lane registry fact and its effective date; do not rewrite durable role policy.
2. Mark affected lanes candidate, constrained, sunsetting, or unavailable as appropriate, with the reason and evidence.
3. Re-resolve active packets whose route or fallback became ineligible; surface the impact.
4. Run bounded comparable evaluations only for harness-specific fit, contradictory evidence, or high-leverage uncertainty; otherwise assess scoped credible external evidence under the outcome rubric.
5. Promote, constrain, or retire through an explicit observation-backed decision. Keep prior observations as historical evidence.
6. Revisit defaults only after promotion evidence; remove superseded configuration rather than leaving competing defaults.

A quota outage may activate an already-approved fallback, but it does not prove the fallback superior. A release may be explored immediately, but it is not entitled to production/default traffic.

## State-surface ownership

| Surface | Owns | Does not own |
|---|---|---|
| This doctrine | ontology, decision rules, precedence, evidence standards, escalation/fallback semantics | live model rankings, account quotas, concrete defaults |
| Policy/config | scoped role-to-lane preferences, lane registry entries, tool/context/budget profiles, explicit fallback ordering | durable historical outcomes or hidden runtime overrides |
| SQLite/ledger | packets, resolved decisions, provenance, observations, lane state history, telemetry, retries/fallbacks, artifacts and review links | policy prose or a duplicate source of config defaults |
| Artifacts/archives | transcripts, raw outputs, context manifests, proof, detailed evaluator notes | queryable routing authority |

SQLite is the durable queryable history; configuration is the current declared operational posture; doctrine is the stable contract. Where sources disagree, resolve under the precedence rules and record the resolution rather than creating another shadow table, document, or override mechanism.

## Anti-patterns

- Pinning a role permanently to a model/provider/account or treating a persona name as one.
- Calling a provider/model default “doctrine.”
- Promoting a new model from hype, one unreviewed output, throughput, or an unavailable comparison; credible benchmarks are prior evidence, not a substitute for checking their scope or for harness-specific evaluation when needed.
- Carrying Fable, Terra, Sol, Kimi, or Opus anecdotes forward as universal truth.
- Comparing forks with different packets, hidden context/tool changes, or different acceptance bars.
- Recording only wins, cost, or latency while omitting retries, interventions, refusals, and reviewer judgment.
- Silent config shadowing, unrecorded account selection, invisible fallback, or quality-bar downgrade.
- Using scarce orchestration capacity as a generic worker because it is convenient.
- Automatically turning telemetry into policy without review.

## Staged adoption

1. **Make routes legible:** require packets, resolved-route explanations, precedence/provenance, typed outcomes, and visible fallback chains.
2. **Make lane facts durable:** maintain one registry and dated evidence-linked observations; separate current config from history.
3. **Make adaptation cheap:** capture comparable telemetry and run bounded forks for high-leverage uncertainty.
4. **Automate conservatively:** use reviewed evidence to recommend or update scoped policy; retain human/orchestrator judgment for promotion, retirement, and exceptions.

The doctrine succeeds when a future orchestrator can route a packet from its requirements and current lane facts, explain that route, know when uncertainty warrants an experiment, and promote a lane only from evidence that survives model rotation.
