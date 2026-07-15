# Primer preferences

**Status:** durable, revisable preference doctrine as of 2026-07-14. This is neither a profile nor a report of what Arthur currently does. It records scoped propositions that may help future agents, with enough provenance to correct or supersede them.

## CEV backward frame

Primer is **CEV-oriented**, not an implemented coherent-extrapolated-volition system. The useful direction runs backward from a hypothetical better-informed, more reflective, more coherent Arthur: ask which present intervention that future perspective might endorse after seeing its evidence, costs, alternatives, and effects. Do not project current clicks, habits, tool choices, or momentary requests forward and call the result volition.

This frame is a steering check, not an authority claim. Current explicit corrections remain the strongest available evidence; extrapolations remain hypotheses; conflicts stay visible; consequential changes require review. Primer should help Arthur revise the model, including the CEV framing itself.

## Evidence ladder

Use the highest applicable rung and preserve lower-rung counterevidence:

1. **Current explicit correction or reflective choice** — scoped to what was corrected; strongest evidence available.
2. **Repeated recent behavior across independent episodes** — operational evidence, not identity or value.
3. **Recent task trail and accepted artifact** — evidence about the task and workflow in which it occurred.
4. **Aggregate attention pattern** — a lead for inquiry only; attention is not value, mastery, authorship, or endorsement.
5. **Older explicit statement** — meaningful but exposed to changed context and preference drift.
6. **Historical implementation or generated configuration** — evidence of what once ran, usually weak evidence of why or whether it is still wanted.

Every durable claim should carry: **status, scope, observed range, provenance, confidence, counterevidence or tension, and review/decay condition**. A newer item does not automatically win: it must address the same scope. An explicit correction `corrects` a claim; an adopted replacement `supersedes` it; contrary evidence without a decision is `counterevidence_to` it.

### Staleness and decay

- Recheck operational/tool preferences after **30 days** or a material runtime/model change.
- Recheck repeated workflow patterns after **90 days** without confirming evidence.
- Durable ends and product doctrine do not expire mechanically, but must be reopened when direct corrections or repeated cross-episode counterevidence appear.
- One-off experiments remain dated experiments until transferred successfully to another episode or explicitly adopted.
- Model names, routing recipes, generated config, notification wiring, and transient tool affordances decay fastest. Preserve the model-independent reason, not the residue.
- Never silently delete stale evidence. Change status, record the successor and delta, and retain the provenance edge in [`LINEAGE.md`](LINEAGE.md) or the dated design log.

## Current high-confidence preference cards

### Orchestrate centrally; give workers bounded ownership

- **Status / confidence:** inferred durable pattern; high.
- **Scope:** substantial agentic software and research work, especially OMP.
- **Observed:** 2026-07-10–2026-07-14.
- **Claim:** keep the main surface for synthesis, routing, and conflict resolution; fan independent slices out in parallel with explicit ownership and acceptance criteria.
- **Sources:** `~/.omp/agent/sessions/-dotfiles/2026-07-14T04-29-38-451Z_019f5ee3-3d13-7000-a342-2cc250ed41d9.jsonl`; `~/.omp/agent/sessions/-dotfiles/2026-07-14T01-14-53-957Z_019f5e30-f285-7000-b213-c35a0da5218a.jsonl`; `~/.omp/agent/sessions/-agents/2026-07-10T06-07-27-661Z_019f4aa3-5bac-7000-a706-39d813d6553c.jsonl`.
- **Tension / decay:** parallelism can produce cancellation, no-output workers, and collisions. Recheck if the harness changes or Arthur directly prefers a different collaboration shape.

### Treat handoff as part of the deliverable

- **Status / confidence:** explicit plus repeated behavior; high.
- **Scope:** resumable multi-session work.
- **Observed:** 2026-06-07–2026-07-14.
- **Claim:** leave a dated, source-of-truth context packet with state, evidence, ownership, restart information, and unresolved decisions; do not rely on transcript continuity.
- **Sources:** `~/.pi/agent/sessions/--Users-arthur-vault--/2026-06-07T01-55-42-193Z_019e9fcb-01f1-7ad7-8dd0-59ba460fd7a4.jsonl`; `~/.omp/agent/sessions/-dotfiles/2026-07-14T04-29-38-451Z_019f5ee3-3d13-7000-a342-2cc250ed41d9.jsonl`; [`LINEAGE.md`](LINEAGE.md).
- **Tension / decay:** a handoff is evidence, not doctrine; newest does not mean authoritative outside its scope.

### Require behavioral proof, not plausible plumbing

- **Status / confidence:** repeated explicit task constraint and observed correction; high.
- **Scope:** implementation, UI, integration, and operational changes.
- **Observed:** 2026-07-10–2026-07-14.
- **Claim:** verify the behavior that can fail end to end; use focused E2E or visual evidence for high-dimensional behavior; do not let superficial passing tests mask integration defects.
- **Sources:** `~/.omp/agent/sessions/-agents/2026-07-10T06-07-27-661Z_019f4aa3-5bac-7000-a706-39d813d6553c.jsonl`; `~/.omp/agent/sessions/-agents/2026-07-13T02-49-50-803Z_019f5961-83d3-7000-bb7a-fcd4e5b6ff02.jsonl`; `~/.omp/agent/sessions/-dotfiles/2026-07-14T04-29-38-451Z_019f5ee3-3d13-7000-a342-2cc250ed41d9.jsonl`.
- **Tension / decay:** proof should be proportionate and reviewer-useful, not ritual test accumulation.

### Make uncertain state glanceable and playable

- **Status / confidence:** explicit recent UX direction; high within agent interfaces, provisional elsewhere.
- **Scope:** Agent Hub and adjacent orchestration surfaces.
- **Observed:** 2026-07-13.
- **Claim:** expose live state, sibling movement, throughput, and rich/plain evidence in a complementary peripheral surface without competing with the primary task.
- **Source:** `~/.omp/agent/sessions/-agents/2026-07-13T02-49-50-803Z_019f5961-83d3-7000-bb7a-fcd4e5b6ff02.jsonl`.
- **Tension / decay:** do not generalize specific keybindings, badges, or layout choices into universal UI taste without transfer evidence.

### Guard remote and destructive operations

- **Status / confidence:** repeated recent constraint; high.
- **Scope:** remote workstations, GPU hosts, recovery, deletion, and other hard-to-reverse actions.
- **Observed:** 2026-06-05–2026-07-14.
- **Claim:** inspect read-only first, preserve recoverability, and require an independent recovery path before remote reboot/poweroff or comparably destructive action.
- **Sources:** `~/.omp/agent/sessions/-dotfiles/2026-07-14T04-29-38-451Z_019f5ee3-3d13-7000-a342-2cc250ed41d9.jsonl`; `~/.pi/agent/sessions/--Users-arthur-dotfiles--/2026-06-05T11-54-12-208Z_019e97a2-3b70-74b9-9886-69caaa171176.jsonl`.
- **Tension / decay:** the exact guard depends on blast radius; this is not a ban on autonomous low-risk action.

### Prefer resumable, auditable data pipelines

- **Status / confidence:** repeated architecture preference; high in data workflows.
- **Scope:** ingestion, enrichment, repair, and long-running batch work.
- **Observed:** 2026-05-31–2026-07-14.
- **Claim:** use stable identities/resume keys, centralized structured state, append-only run provenance, and repair only failed artifacts where possible.
- **Sources:** `~/.pi/agent/sessions/--Users-arthur-apps-hsk-deck--/2026-05-31T23-19-21-831Z_019e8055-b7e7-7ad8-b4af-591064f9660e.jsonl`; `/Users/arthur/agents/packages/primer-daemon/README.md` (observed 2026-07-10–2026-07-11).
- **Tension / decay:** SQLite and current ledger boundaries are implementation choices, not universal ends.

### Automate without stealing focus

- **Status / confidence:** explicit recurring direction; high.
- **Scope:** browser and desktop automation.
- **Observed:** 2026-06-03–2026-07-10.
- **Claim:** prefer read-only or background attachment and avoid interrupting Arthur’s active flow; respect approved access boundaries rather than bypassing them.
- **Sources:** `~/.pi/agent/sessions/--Users-arthur--/2026-06-03T01-06-36-899Z_019e8b04-a0e3-7c16-93a4-554880feee13.jsonl`; `~/.codex/sessions/2026/07/10/rollout-2026-07-10T10-02-08-019f4954-e5d7-74f0-a049-3c19fca18cf9.jsonl`; `/Users/arthur/exploratory/browser-context-sync/docs/primer-agent-use-contract-v0.md` (2026-06-28).
- **Tension / decay:** specific browser attachment mechanisms are transient.

### Deslop before accreting; route by task, not model identity

- **Status / confidence:** explicit recent correction plus repeated pattern; high.
- **Scope:** configs, docs, agent routing, and inherited implementation.
- **Observed:** 2026-07-10–2026-07-14.
- **Claim:** remove stale/generated residue and recover the actual invariant before adding mechanisms. Route by capability, cost, risk, and task shape; do not canonize temporary model names or old Pi/Codex wiring.
- **Sources:** `~/.omp/agent/sessions/-dotfiles/2026-07-14T01-14-53-957Z_019f5e30-f285-7000-b213-c35a0da5218a.jsonl`; `~/.codex/sessions/2026/07/10/rollout-2026-07-10T10-02-08-019f4954-e5d7-74f0-a049-3c19fca18cf9.jsonl`; `/Users/arthur/exploratory/browser-context-sync/docs/arthur-primer-ontology-v0.md` (2026-06-28).
- **Tension / decay:** current model/tool selections are operational observations unless Arthur explicitly promotes them.

## Provisional attention clusters

These are **privacy-preserving aggregate leads**, not preference cards. Source: read-only Firefox `places.sqlite` analysis covering 2026-04-15–2026-07-14, with a recent window of 2026-06-14–2026-07-14. Sensitive/local/account paths, query strings, tokens, and raw URL lists were excluded. The active profile was locked with a WAL present, so newest writes may be incomplete; Firefox omits non-Firefox work.

- **Agent-oriented coding/docs:** recent activity rose relative to the prior 61 days, and repeated agent↔docs bursts suggest research/implementation trails. This supports asking about active terminal/agent work, not inferring authorship or durable tool allegiance.
- **CEV/alignment:** a small but sharply increased recent cluster appeared in concentrated bursts across public safety, paper, and alignment sources. This supports the CEV-oriented inquiry in this document, not a claim that a settled alignment doctrine exists.
- **Personal/information feeds:** high aggregate volume, dominated by search/social use. Treat as mixed navigation and drift until Arthur labels a thread.
- **GPU/media and hardware purchasing:** lower recent rates than the preceding window. This is a shift in attention, not evidence of declining value or abandoned goals.
- **Infrastructure/storage:** low recent Firefox counts despite substantial terminal-side infrastructure work. This is direct counterevidence to equating browser volume with importance.

## Explicit non-inferences

Do **not** infer from this evidence that:

- current behavior equals coherent or extrapolated volition;
- attention, dwell, repeated visits, follows, or purchases equal endorsement or value;
- a page title establishes intent, authorship, comprehension, or mastery;
- a tool/model used recently is a durable preference;
- an old implementation, config key, schema, or skill copy is still desired;
- a failed/cancelled worker means its assignment lacked value;
- the current reader experiment is Primer’s universal center;
- one domain preference transfers to remote operations, pedagogy, UI, or source trust;
- silence or missing history is negative evidence;
- aggregate Firefox evidence describes private content or non-Firefox activity.

## Recurring failure modes

- Treating generated config, old Pi routing, or historical prototypes as intent.
- Promoting the newest handoff or a one-off experiment to doctrine without scope/transfer evidence.
- Letting worker cancellation, no-output completion, ownership collisions, or protocol projection lose work.
- Assuming cwd, shell, executable, or tool availability instead of checking the runtime boundary.
- Accepting unit-level plausibility while interruption, vi-mode, browser/server, or other integration seams remain broken.
- Flooding the main thread with raw history instead of leaving compact, cited artifacts.
- Turning attention aggregates into a dossier, global interest score, or intervention trigger.
- Building dashboards, GraphRAG, proactive notifications, or a second writable registry before the decision they serve is clear.

## Suggested Primer and workflow improvements

These are **review-gated proposals**, not present system capabilities:

1. Give each preference card machine-readable-enough metadata in Markdown: status, scope, dates, provenance, confidence, tensions, and next review. Keep doctrine readable; do not build a new database merely to encode it.
2. At task start, retrieve only the smallest relevant cards. State: **Arthur-prior / current evidence / recommendation / uncertainty**. Ask for correction at the decision boundary, not after irreversible work.
3. Capture accepts, rewrites, dismissals, and explicit corrections as provenance edges. Let those update confidence only after human review; never silently infer a durable preference.
4. Add a periodic contradiction review that proposes `corrects`, `supersedes`, `counterevidence_to`, or “leave unresolved.” No automatic merges and no behavior-only promotion.
5. Separate observation ingestion from doctrine. Browser/session substrates stay read-only; reviewed interpretations belong in the chosen writable ledger or canonical Markdown only after ownership is resolved.
6. Preserve privacy by default: aggregate locally, minimize retained excerpts, cite bounded artifacts/date ranges, and never emit exhaustive browsing or transcript trails.
7. Evaluate Primer by correction quality, useful transfer, restraint, and recoverable provenance—not volume of captured data, annotations, or confident predictions.

## Review and correction protocol

1. **Challenge:** Arthur or an agent names the exact card/claim and supplies a correction, counterexample, changed scope, or newer evidence.
2. **Classify:** mark the input explicit correction, dated preference, repeated observation, task-local result, aggregate attention, or historical residue.
3. **Compare scopes:** only claim supersession when old and new evidence address the same domain and decision. Otherwise preserve both.
4. **Propose a delta:** show the old proposition, proposed replacement, provenance edge, confidence change, and consequences. Consequential or extrapolative changes remain pending until Arthur reviews them.
5. **Record:** update this file only for durable doctrine; put task-local experiments in [`DESIGN-LOG.md`](DESIGN-LOG.md); record intellectual provenance in [`LINEAGE.md`](LINEAGE.md).
6. **Decay:** revisit cards at their review condition. Mark stale rather than deleting; do not let stale cards silently steer action.

When evidence conflicts, prefer a scoped unresolved tension over a tidy composite. Corrigibility is not a failure of Primer; it is the mechanism that keeps an extrapolative direction answerable to Arthur.