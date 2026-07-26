# Agent-stack consolidation

Status: proposal plus mechanical changes applied 2026-07-12  
Scope: skills, agent definitions, prompt authority, and subagent routing/spawn doctrine in `~/agents`

## Executive proposal

Keep one small role-based stack and make the boundaries explicit:

1. **Policy:** `docs/fable/routing-doctrine.md` owns model-agnostic routing. `charter.md` owns the compact operating contract. `priors.md` supplies review heuristics, not routing defaults.
2. **Live posture:** `.omp/*-config.yml` resolves roles to current lanes. Model names stay here, not in personas or skill names. No live model-routing values were changed in this pass.
3. **Packets:** implementation is a coherent feature pod, not a file shard. Core state/concurrency work gets an independent reviewer. UI work gets direct QA/play rather than a reviewer by default.
4. **Proof:** split cancellation-prone E2E work into a short proof slice after implementation. The coordinator gates a staged snapshot, never a moving working tree.
5. **Skills:** keep a router plus narrow execution modes. Do not merge distinct tool truth surfaces merely to reduce the count. Make personal-data and project-specific skills opt-in.
6. **Agents:** prefer role-shaped task spawns over model-named markdown personas. Do not act on the four pre-existing `.omp/agents` deletions until the two still-referenced Jimeng definitions are resolved with Arthur.

## Inventory and evidence

### Prompt and authority surfaces

| Surface | Authority | Evidence / disposition |
|---|---|---|
| `docs/fable/charter.md` | One-screen identity, stream posture, packet contract | Session boot source; updated here with the current review/QA/proof/gate doctrine. |
| `docs/fable/routing-doctrine.md` | Canonical role/lane ontology, precedence, experiment and fallback rules | Explicitly canonical; last reconciled 2026-07-10. Keep as the only durable routing policy. |
| `docs/fable/priors.md` | Arthur-derived principles and heuristics | Contains feature-pod + independent-review precedent at line 125. Review input, not live config. |
| `.omp/fable-config.yml` | Fable session lane resolution and harness skills | Current operational posture, not doctrine. Role values are the file's to state — read it, don't trust prose inventories (this row cached them on 2026-07-12 and rotted; the dated posture entries in §Roles and model lanes win on conflict). |
| `.omp/{companion,playground,primer}-config.yml` | Stream overlays and stream-local skill exposure | Read the files for current roles. Known drift risk: overlays historically lag posture changes (the 2026-07-15 Terra ban reached playground before companion/primer); on conflict the dated posture entries below win and the overlay is the bug. |
| `.omp/config.yml` | Live default workspace configuration | Working-tree modified and explicitly excluded from nonessential edits. No change in this pass. |
| Root/context instructions (`AGENTS.md`, global CLAUDE/system prompt) | Harness-wide tool and safety contract | High prompt-tax surface. Do not duplicate its generic tool rules into personas. |
| Skills (`SKILL.md`) | Conditional workflow instructions | Load by task; descriptions are the dispatch boundary. Browser descriptions were clarified in this pass. |
| `streams/*/GOAL.md` | Ownership and durable stream goal | Harness owns `.omp/`, `skills/`, `docs/fable/`; companion, playground, and primer own their product paths. Use these to partition packets, not as prompt copies. |

The prompt stack should therefore be read as: global safety/tool contract → stream goal/ownership → charter and priors when relevant → routing doctrine → resolved live config → packet → conditional skill. A lower layer may specialize but must not silently contradict a higher authority.

### Active global skills

The active directory `/Users/arthur/.omp/agent/skills` currently exposes 15 entries:

| Family | Skills | Usage evidence and decision |
|---|---|---|
| Coordination/proof/review | `omp-irc`, `proof-of-work-qa`, `rubber-duck-adversarial` | Current harness primitives. Today's work repeatedly used independent reviewers to find real P1/P2 defects; proof artifacts are required for substantial work. Keep active. |
| Research/source | `librarian`, `source-archive`, `stema`, `youtube-transcript`, `transcribe` | Prior conservative session scan recorded 26 explicit `librarian` loads, 4 `source-archive`, 4 YouTube transcript, 2 transcription; Stema is the live book corpus skill. Keep distinct because code-source verification, archival, book retrieval, transcript retrieval, and STT have different side effects and truth sources. |
| Browser/control | `browser-control`, `background-browser-automation`, `cmux-browser-drive` | Chronic dispatch confusion, but no observed conflict today. `browser-control` is the router; background automation owns non-focus-stealing CDP/Playwright; cmux owns WKWebView surfaces. Keep all three with sharper descriptions. The session-visible `playwright` skill is an execution reference behind the router, not a fourth chooser. |
| Personal data | `gmcli`, `gdcli`, `gccli` | Prior scan: Gmail 1 explicit load, Drive/Calendar 0. Protected in the previous cleanup, but they impose sensitive/global prompt surface. Candidate for one opt-in Google Workspace package; do not delete or merge without Arthur's answer. |

Session-visible but not entries in that active directory include `arthur-high-level-first`, `arthur-primer-workflow`, `cloudflare-deploy`, `find-skills`, `meta-setup`, `playwright`, `writing-without-ai-tells`, and the browser/research skills above. These likely arrive from harness/system or `~/.agents`; their visibility is not proof that this repo owns or may delete them. `codex-system`, `reflect`, and `find-skills` exist under `~/.agents/skills`; the prior audit found one explicit load each and recommends hidden/manual treatment.

Prior usage counts and archive decisions are preserved in `docs/plans/skill-inventory-and-rationalization.md`; this document does not duplicate its 40+ historical row inventory. Important already-resolved states: `browser-tools`, `llm-frontend-browser`, and `oracle` are disabled globally; `impeccable` and `brave-search` remain archived/disabled; their source targets were not deleted.

### Stream-local skills

| Stream | Skills | Disposition |
|---|---|---|
| Harness | `hermes-omp-bridge`, `hermes-skill-porting`, `agent-skill-vendoring`, `spec-driven-overlays` | Correctly scoped by `fable-config.yml` and stream overlays; keep opt-in to harness sessions. |
| Playground | `remotion`, `impeccable-design-review`, `jimeng-browser-proxy` | Product/tool-specific. Keep local; note that `impeccable-design-review` is not the archived global `impeccable` skill and should be judged on its own use. |
| Primer | `wrapped-commentary-learning-card-db`, `audio-diarization-pipeline`, `sideline-annotation-card`, `browser-context-sync`, `twitter-x-context` | Domain-specific and correctly scoped to Primer. |
| Companion | `ai-companion-rtc-testbed` | Domain-specific and correctly scoped to Companion. |

No stream-local skill was deleted: absence of explicit load counts is not proof of non-use, and the stream configs already prevent global prompt tax.

### Agent definitions and spawn roles

Current repo state has no live `.omp/agents/*.md`. Four tracked definitions are already deleted in the working tree, but the deletion intent is not uniformly proven:

| Deleted-in-tree definition | Evidence | Decision in this pass |
|---|---|---|
| `jimeng-gemini-worker` | Model/provider-named and absent from active `.omp` config, but still explicitly referenced by `docs/plans/jimeng-parallel-implementation-plan.md` and the Jimeng worker runbooks as a scout fallback. | **Ambiguous: no deletion applied or endorsed.** Ask Arthur whether to restore temporarily or replace with a model-neutral role while updating callers. |
| `jimeng-kimi-worker` | Model/provider-named and absent from active config, but the same Jimeng docs still name it as emergency fallback. | **Ambiguous: no deletion applied or endorsed.** Ask Arthur; if retired, update historical/current runbook guidance separately. |
| `prose-deepseek-v4-pro` | Model-named prose role; no active config or scoped doc reference found, and its durable workflow belongs to `writing-without-ai-tells`. | Existing deletion is consistent with the doctrine, but this pass performs no delete operation. |
| `prose-glm-5-2` | Same prompt as the DeepSeek variant except model/description; no active config or scoped doc reference found. | Existing deletion is consistent with the doctrine, but this pass performs no delete operation. |

The four deletions predate this audit. Because the Jimeng references make two of them ambiguous, this pass leaves the working-tree state untouched rather than treating all four as a mechanical cleanup. If Arthur confirms retirement, update the live Jimeng guidance in the same change; if the role remains useful, restore one model-neutral `jimeng-implementer` or `jimeng-scout` persona and resolve its lane separately.

Built-in task roles (`task`, `plan`, `designer`, `reviewer`, `explore`, `quick_task`, `oracle`) are harness capabilities, not repo agent markdown. Use them as role templates and resolve models through current config/per-spawn choices. Today's large live roster demonstrates the useful naming pattern: specific responsibility (`concurrency reviewer`, `QA engineer`, `migration tester`) rather than provider/model identity.

## Consolidation plan

### Keep and sharpen now

- One browser router (`browser-control`) and two active truth-surface submodes (`background-browser-automation`, `cmux-browser-drive`). Keep Playwright as an implementation reference, not a peer router.
- One canonical routing doctrine; charter links and summarizes only the operational packet contract.
- Stream-specific skills remain local via `customDirectories`.
- Role-shaped task spawns replace model-named `.omp/agents` definitions.

### Merge or demote after Arthur answers

1. **Personal data:** package `gmcli`/`gdcli`/`gccli` behind one opt-in `google-workspace` chooser while retaining the three CLIs as implementation tools. This is a visibility/description merge, not necessarily a code merge.
2. **Research:** consider a small `research-control` router only if dispatch confusion is observed. Do not collapse source-specific execution skills; their contracts differ.
3. **Browser:** if the three-skill hierarchy still confuses after the description change, fold the background and cmux decision summaries into `browser-control` and make the subskills non-global references. Do not merge CDP and cmux implementations.
4. **Hidden personal prompts:** decide whether `codex-system` and `reflect` belong in global context instructions rather than skills. Their current hidden/manual status is safe.
5. **Project-local design:** evaluate `impeccable-design-review` independently; do not infer it is dead from the archived global skill with a similar name.

### Removal rule

Remove only when all are true: no current config or prompt reference; no conservative session-use signal; no owned stream requires it; a replacement owns the full behavior; and deletion/retirement intent is recorded. Otherwise demote to opt-in or ask Arthur. This pass found no additional deletion meeting that bar.

## Spawn doctrine

### Roles and model lanes

- Name the responsibility: orchestrator, implementer, reviewer, designer, scout/researcher, operator, QA/proof runner.
- A role never contains a provider/model/account. Resolve the current lane from hard constraints → explicit spawn → session strategy → workspace → global policy, with visible provenance.
- **Current routing posture (Arthur, 2026-07-26):** every child route is an explicit provider/model:effort selector; a missing selector or effort is invalid. Luna scouting, mechanical work, review, and QA use medium. Sol implementation uses medium, with low for narrow mechanical implementation. For equivalent work, Sol runs one to two effort steps below Luna. Extra-high requires a packet-local justification and is never a responsibility or stream default.
- **Calibration rationale (2026-07-26):** effort labels are model-relative. Blanket high/extra-high routing over-spends Sol latency and tokens without demonstrated acceptance gain and makes capability-vs-effort evidence uninterpretable. Start from the explicit role baseline and escalate one axis only when ambiguity, blast radius, failed acceptance, or irreversible impact justifies it.
- **Lane-strength criterion (Arthur, 2026-07-13):** route on entropy × blast radius × mistake legibility, never task size. Cheap lanes remain appropriate where mistakes are legible; load-bearing or silent-failure work requires stronger judgment and independent evidence.
- **Terra posture (Arthur, 2026-07-15, voice):** never route to Terra — "Terra is not pareto-efficient at anything." Re-evaluate only on a new checkpoint with scoped evidence.
- **Responsibility posture (Arthur, 2026-07-15, follow-up; reconciled 2026-07-26):** the catch-all `task` role remains an ontology mismatch. Spawns name a responsibility and its explicit provider/model:effort route; a child never receives its parent's lane merely because its own route was omitted. Earlier 2026-07-13/15 effort defaults are superseded by the 2026-07-26 calibration above.

### Packet shape

Every packet names owner paths, excluded paths, role, hard constraints, change, observable acceptance, non-goals, selected lane and provenance, and fallback. Partition by independently verifiable feature pod. Do not split a still-evolving schema/store/API contract across workers merely for concurrency.

### Attachment rules

| Slice | Default attachment | Why |
|---|---|---|
| Core state, concurrency, durability, routing, lifecycle, identity, or transaction boundary | Independent reviewer after implementation | Five independent reviews today each found a real P1/P2: park/IRC race, query mutation, gap recompute, digest tautology, replay idempotency. This is strong local evidence for the heuristic. |
| UI-only interaction/visual slice | Direct QA/play child; no reviewer by default | Today's UI slices with direct play/QA needed no independent reviewer. Review becomes warranted when the UI crosses load-bearing state or QA finds a correctness concern. |
| Mixed UI + load-bearing state | QA child plus independent core reviewer | The truth surfaces and failure modes differ. |
| Mechanical migration/docs/fixtures | Focused implementer; reviewer only if data continuity, authority, or semantics can change | Avoid review ceremony where regeneration is cheap, without weakening irreplaceable-data safeguards. |

Review independence means the reviewer did not implement the slice. Reviewers rerun focused dynamic checks and add adversarial cases when warranted; they do not merely inspect a diff.

### Implement slice and proof slice

Default for long E2E/provider/browser/runtime evidence:

1. **Implement slice:** owns code and focused behavioral checks. It stops only when implementation acceptance is met locally.
2. **Proof slice:** short-lived operator/QA child starts from the completed implementation, runs the exact E2E or interactive scenario, and writes durable artifacts plus rerun commands.
3. **Coordinator gate:** consumes both outputs and gates once. If the proof child is cancelled, implementation remains attributable but the work is not called complete; respawn only the proof slice.

This responds directly to four-plus Sol cancellations during E2E tails today, where implementation survived but evidence was lost.

### Staged-snapshot checkpoint

Before the phase gate:

1. Materialize the intended checkpoint as a staged snapshot (or an equivalent isolated tree built from exactly the intended paths).
2. Run typecheck/tests/build against that snapshot, not detached HEAD and not the mutable working tree.
3. Record snapshot identity, command, exit status, and artifact paths.
4. Only then checkpoint/promote.

This prevents recurrence of the `6d47bcbf` detached-HEAD compile break caused by coordinator gates observing a different tree than the intended checkpoint.

## Applied mechanical changes

1. **Updated `docs/fable/charter.md` subagent contract.** Added role/lane separation, coherent feature pods, automatic review for load-bearing runtime slices, QA-first UI attachment, implement/proof splitting, and staged-snapshot coordinator gates. Rationale: reconciles the compact charter with current observed Sol/Luna practice and the existing feature-pod heuristic in `priors.md`.
2. **Clarified `skills/browser/browser-control/SKILL.md` description.** It now declares itself the canonical chooser and names the subordinate modes. Rationale: removes four-way dispatch ambiguity without deleting distinct capabilities.
3. **Clarified `skills/browser/background-browser-automation/SKILL.md` description.** It now declares itself a browser-control submode and explicitly excludes cmux WebViews. Rationale: keeps background safety guidance while eliminating chooser overlap.
4. **Made no agent-definition deletion.** The four `.omp/agents` deletions predated this audit. The prose deletions appear mechanically consistent, but Jimeng docs still reference both Jimeng agents, so their tree state is explicitly left as an Arthur question rather than endorsed as cleanup. Rationale: nothing ambiguous may be deleted.
5. **Did not edit live `.omp/config.yml` or role mappings.** Rationale: live route changes were excluded except proven drift, and current differences include taste/availability choices that require Arthur.

## Open taste questions for Arthur

1. Should `gmcli`, `gdcli`, and `gccli` disappear from the global skill list behind one opt-in `google-workspace` router, or is direct discoverability worth the prompt surface?
2. After the description cleanup, do you want the browser stack to remain router + two execution skills, or should only `browser-control` be globally visible and the others become references it loads?
3. Is Primer's `claude-opus-4-8` designer pin intentional while Companion/Playground use `4-6`, or configuration drift?
4. Should `writing-without-ai-tells` own prose routing entirely, with no persistent prose agent definitions, or do you want one model-neutral `prose-reviewer` persona for repeatable detector ensembles?
5. Is the deletion of the two Jimeng workers intentional retirement of that product-specific persona layer? If not, should one model-neutral Jimeng role replace both?
6. Should `codex-system` and `reflect` remain hidden/manual skills, or be folded into global personal instructions so they stop looking invocable?
7. Does `impeccable-design-review` earn its Playground-local place despite the global `impeccable` archive, or should it be renamed to avoid guilt by association?
8. Do you want the reviewer attachment rule enforced by task templates/runtime, or kept as charter doctrine until more than today's five-review sample accumulates?

## Observed tool-usage baseline

The seven-day cross-project session analysis is in [`tool-usage-analytics.md`](tool-usage-analytics.md). Its 1,391-session-file baseline supports the chooser-first consolidation above, identifies browser/web overlap and broken low-use surfaces, and ranks ten retire/merge candidates by observed result-token waste. Use that evidence—not inventory size alone—when applying the removal rule.
