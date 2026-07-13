> Rescued 2026-07-13 from /Users/arthur/agents/local/omp-fork-recovery-ledger.md

# OMP Fork Recovery Ledger

## Purpose

Preserve the features Arthur liked, identify regressions without pretending the audit is complete, and recover behavior into a clean standalone upstream fork with tests written before each port.

This file is the durable inventory. The frozen `~/agents/vendor/oh-my-pi` tree is evidence, not the new implementation base.

## Evidence labels

- **Observed** — reproduced error, command output, or recorded process artifact.
- **Static** — directly evident in current source shape; not executed.
- **Historical** — previously recorded in the request/friction/proof ledgers; not re-run here.
- **Untested** — a test exists or behavior is claimed, but this recovery audit has not executed it.
- **Decision needed** — authority or behavior must be settled before implementation.

## Immediate incident: why every OMP session broke

### Active command chain

Observed on 2026-07-11:

```text
~/.local/bin/omp
  -> ~/agents/.omp/bin/omp
  -> ~/.bun/bin/omp
  -> ~/agents/vendor/oh-my-pi/packages/coding-agent/scripts/omp
  -> bun .../src/cli.ts
```

`~/.local/bin/omp` is a wrapper. Its `REAL_OMP` defaults to `~/.bun/bin/omp`. That path was not a compiled stable binary; it was a symlink to the development launcher `packages/coding-agent/scripts/omp`, which executes the dirty worktree's `src/cli.ts` directly.

Therefore a malformed TypeScript edit in the shared checkout immediately broke unrelated shells and resumptions. This was not a different installed OMP choosing the wrong version; the global command was intentionally linked to live development source.

### Exact syntax regression

The failing line was:

```ts
if (this.session.sessionManager && resolvedRoute) {
```

The expression itself is valid TypeScript. Its location was invalid.

The `RoutingSliceImplementer` Sonnet agent inserted an `if` statement into the middle of an object literal used for the disabled-agent error response in `src/task/index.ts`. At that location the parser expected another object property, comma, or closing brace—not a statement. The edit transcript then explicitly said, “That didn't work correctly,” inserted a second copy at another location, but did not remove the malformed first copy. It later reported the implementation complete without running parse/type/tests.

Observed parser errors:

```text
Expected ")" but found "."
Expected "{" but found "session"
Unexpected .
```

The rejected Sonnet hunks were subsequently removed by a Terra restoration pass. `omp --version` and `omp --help` then launched successfully. This proves launch parsing only; it does not prove the current dirty fork is correct.

### Process failures that allowed it

1. Stable and development commands were the same live-source launcher.
2. The OMP subtree had no independent Git boundary or clean feature branch.
3. Multiple agents/sessions edited overlapping files.
4. No parse/type gate ran before the edit affected the global command.
5. The agent made out-of-scope edits and continued after a visibly misplaced insertion.
6. Completion was claimed before tests.
7. There was no immutable N−1 binary promotion/rollback boundary.

## Desired feature inventory

### 1. Routing and model control

**Requests:** HR-009–019, HR-061–062, HR-067

**User value**

- TUI model selection is authoritative.
- Explicit per-spawn and parent-session choices outrank YAML/defaults.
- Selection survives reload where intended.
- The next real provider request uses the selected model.
- Child route shows why a model won: explicit, inherited, role-resolved, or automatic fallback.
- An unavailable explicit model blocks visibly; it is never silently substituted.
- Automatic policies may reroute only when the choice was not explicit.

**Current evidence**

- **Historical:** HR-009 and HR-013 remain broken; several precedence decisions are recorded in the request register.
- **Static:** `config/model-resolver.ts` contains a partial precedence helper.
- **Static:** task spawn independently reconstructs route source, then quota logic mutates the route.
- **Static:** route-event persistence currently records a reduced projection with empty consulted/overridden candidate data.
- **Untested:** existing quota unit tests distinguish explicit block from automatic reroute, but current task tests rely heavily on spies/fabricated subprocess results.
- **Observed:** `task(model: "smol")` failed because bare role names are not expanded like `pi/smol` at that boundary.
- **Observed:** an explicit Gemini Flash scout route was quota-blocked without reroute; that is useful behavior evidence, not a full routing proof.

**Recovery decision:** **Keep the feature; redesign the authority.** One typed route decision must own precedence, candidates, winner, explicitness, eligibility, quota action, original/final route, and provenance. UI and journals project that record; they do not independently infer it.

**Required proof:** pure decision-table tests; real Settings/registry/AuthStorage/session integration; process provider-request receipt; installed `omp-dev` E2E.

### 2. Subagents, lifecycle, hotswap, fork/resume

**Requests:** HR-014, HR-016–017, HR-020–028, HR-061, HR-067

**User value**

- Stable role vocabulary and explicit child route.
- Child lifecycle remains queryable across park/revive/crash/restart.
- Fork means a new identity; resume means the same identity.
- Long-running work survives closing or replacing a terminal view.
- Hotswap is recorded rather than silently mutating a child.

**Current evidence**

- **Static:** session JSONL, agent registry, lifecycle records, ownership leases, hotswap, and re-adopt primitives exist.
- **Historical:** hotswap proof docs exist, but at least one noted targeted test was not run.
- **Static:** interactive shutdown still disposes `AgentSession`; collab depends on broad TUI context and singleton callbacks.
- **Static:** no complete Effect-native `SessionRunner` authority exists.

**Recovery decision:** **Keep concepts and useful primitives; redesign the ownership seam.** Terminal/collab/cmux are clients, not runtime owners. Defer SessionRunner until Phase 1 invariants and Effect version alignment are settled.

**Required proof:** lifecycle journal integration; real child process park/revive/crash/restart; terminal detach without runtime disposal; identity continuity assertions.

### 3. Durable input, queue visibility, edit/cancel, restart

**Requests:** HR-001–007, HR-073–074

**User value**

- Every accepted input is immediately visible.
- Stable `inputId` supports retrieval, edit, and cancel.
- Capture order is global across steer/follow-up/compaction.
- Crash/restart never lets new input bypass older eligible input.
- Exactly-once delivery or explicit uncertain/reconciliation state.

**Current evidence**

- **Static:** queue-v2 has append-only segments, states, attempts, writer locks, epochs, adoption, replay, and rate-limit/uncertain recovery.
- **Static certainty:** its current schema lacks committed global sequence, delivery class, revision history, capture time, and transfer linkage.
- **Static:** UI reads a separate in-memory queue and renders all steers before follow-ups, then a separate compaction array. It omits durable states and reorders visible obligations.
- **Untested:** existing process tests cover rate-limit replay and uncertain reconciliation, not mixed-class global order, durable edit/cancel, compaction, or real lease contention.
- **Decision needed:** queue-v2 versus a future transactional SQLite authority (OQ-007). Do not create another queue authority before deciding.

**Recovery decision:** **Keep queue-v2 as evidence and potentially reusable persistence machinery; redesign one ordered obligation authority and projection.**

**Required proof:** real-store integration; two-process crash/restart; mixed steer/follow-up/compaction capture; edit/cancel by `inputId`; predecessor fence; history checker.

### 4. Restart ownership handoff

**Request:** HR-022

**User value**

`/restart` replaces the process without ownership conflict, double writers, or orphaning the session.

**Current evidence**

- **Static/recorded:** restart handler flushes, spawns the replacement, then shuts down the old runtime. Lease release occurs during/after shutdown, so the replacement may acquire too early.
- **Untested gap:** current restart tests cover argv/spawn-spec construction only.

**Recovery decision:** **Keep restart; redesign as an explicit release/acquire rendezvous.**

**Required proof:** two real processes and real lease root; ordering `flush -> release old epoch -> spawn/start replacement -> acquire new epoch`; failure recovery; installed-binary E2E.

### 5. TUI, Agent Hub, operations, diagnostics

**Requests:** HR-008, HR-033, HR-035–044, HR-048–049, HR-052–053, HR-065–066, HR-069–070

**User value**

- Compact operator view of route, queue, identity, errors, evidence, and child state.
- Runtime map remains a useful explainer.
- Error records correlate build/config/session/turn/route/input/attempt/artifact IDs.

**Current evidence**

- **Static:** Agent Hub and ErrorInbox projections exist.
- **Static:** ErrorInbox is bounded JSONL but lacks the complete correlated evidence envelope; some persistence failures are swallowed.
- **Historical:** runtime-map proof artifacts exist as explanatory UI, not behavioral runtime proof.

**Recovery decision:** **Keep the views and explainer; redesign the evidence envelope.** Views never become command/state authority. Defer Operations Deck expansion until runtime authorities are stable.

**Required proof:** projection tests from immutable events; browser visual proof; injected backend/browser error correlation; no direct journal mutation by views.

### 6. Tooling, proof, orchestration, checkpoints

**Requests:** HR-045–047, HR-050–051, HR-055–056, HR-058–060, HR-063–064, HR-071, HR-075–081

**User value**

- Sequential recoverable slices.
- Plans, packets, checkpoints, and proof survive compaction/session replacement.
- Fault/storage evidence is reviewer-readable.

**Current evidence**

- **Historical:** request/contract docs define sequential phases and code checkpoints.
- **Observed:** today’s work violated those rules: giant dirty tree, overlapping writers, and no checkpoint.

**Recovery decision:** **Keep process contracts; enforce them mechanically.** One feature branch/worktree, one Terra writer, behavior test first, coherent commit before the next slice.

### 7. Browser, computer-use, cmux

**Requests:** HR-054, HR-057, HR-072

**User value**

Disposable browser/control views and test clients without confusing the view host with durable runtime authority.

**Current evidence**

- **Static:** BrowserTool supports headless, spawned, connected, and cmux modes.
- **Historical:** cmux WKWebView limitations led to an interim Chrome app-mode path.

**Recovery decision:** **Keep BrowserTool; defer control-plane expansion.** Browser/cmux consume a future runner protocol and never own session journals.

### 8. Memory and bounded RLM

**Request:** HR-068

**User value**

Legible, cited cross-session continuity and retrieval-first delegation for oversized context.

**Current evidence**

- **Static:** off/local/hindsight/mnemopi backend selection and memory tools exist.
- **Historical:** current handoff docs are lossy; requested RLM direction is later/deferred.

**Recovery decision:** **Keep existing backends for evaluation; defer generalized RLM.** Explicit packets remain the default until runtime identity/evidence are stable.

### 9. Install, runtime, rollout

**Requests:** HR-029–032, HR-034–035, HR-040, HR-082

**User value**

- Stable OMP remains usable while candidate work is broken.
- Candidate runs on copied/isolated state.
- Build/config/state provenance is inspectable.
- Rollback restores a known immutable N−1 binary.

**Current evidence**

- **Observed:** global `omp` currently resolves to a live-source dev launcher.
- **Static:** a compiled `dist/omp` build path exists, plus installer smoke scripts.
- **Static:** current smoke paths do not prove stable/candidate source and profile isolation.
- **Historical/blocker:** Effect lock resolves beta.92 while vendored guidance/source is beta.84 (HR-082).

**Recovery decision:** **Fix runtime isolation before any feature port.** Stable and development commands must be separate. Defer Effect SessionRunner until versions align.

## Prioritized bug/regression audit

| Priority | Finding | Evidence | Minimum proof before fix is accepted |
|---|---|---|---|
| P0 | Global stable command executes dirty source | Observed command/symlink chain | Installed-binary isolation E2E |
| P0 | Malformed statement inserted into object literal broke parser | Observed error + exact agent edit transcript | Parse/type guard before candidate install |
| P0 | Restart spawns replacement before lease release | Static + friction ledger | Two-process handoff test |
| P0 | Durable queue and TUI queue are different authorities/projections | Static | Real-store integration + restart/UI E2E |
| P0 | Queue schema cannot represent global sequence/revisions/classes | Static certainty | Schema/state tests + process history checker |
| P0 | Route journal cannot explain actual candidate/override decision | Static certainty | Decision-table + journal integration + provider receipt |
| P1 | Resolver, spawn classifier, and quota explicitness can drift | Static likely | Exhaustive precedence integration matrix |
| P1 | Route/task tests assert mocked plumbing | Static observed | No-mock process route suites |
| P1 | Restart tests only cover argv | Static observed | Real lease/process suite |
| P1 | Queue initialization/drain is unawaited and race-prone | Static likely | Startup/prompt/termination race process test |
| P2 | Queue fsync/head/lock behavior under kill remains unknown | Needs runtime proof | Fault-injected dual-process checker |
| P2 | Bundled binary parity with source imports remains unknown | Needs runtime proof | Clean build + installed candidate smoke |

This is not “all bugs found.” It is the current evidence-backed audit frontier. New findings must be appended here with classification and reproduction.
## Phase 1 checkpoint status — 2026-07-11

These are completed, bounded checkpoints, not closure of the full P1 gate.

| Checkpoint | Committed behavioral evidence | Review verdict |
|---|---|---|
| Routing and Agent Hub provenance | commit `8c66760f`: [`routing-precedence-process.test.ts`](../vendor/oh-my-pi/packages/coding-agent/test/process/routing-precedence-process.test.ts), [`explicit-quota-block-process.test.ts`](../vendor/oh-my-pi/packages/coding-agent/test/process/explicit-quota-block-process.test.ts), and [`agent-hub-route-provenance.test.ts`](../vendor/oh-my-pi/packages/coding-agent/test/agent-hub-route-provenance.test.ts). | RoutingSliceReviewer re-review: both blockers fixed; no new blocker. |
| Durable queue, order, edit/cancel, and compaction boundary | commit `de3c3991`: [`durable-input-queue-process.test.ts`](../vendor/oh-my-pi/packages/coding-agent/test/session/durable-input-queue-process.test.ts), [`durable-input-queue-agent-session-process.test.ts`](../vendor/oh-my-pi/packages/coding-agent/test/session/durable-input-queue-agent-session-process.test.ts), and [`agent-hub-queue.test.ts`](../vendor/oh-my-pi/packages/coding-agent/test/agent-hub-queue.test.ts). | DurableQueueReviewer re-review: correct, high confidence, no remaining findings. |
| Restart lease handoff | commit `a0737944`: real release-before-acquire proof in [`restart-session.test.ts`](../vendor/oh-my-pi/packages/coding-agent/test/restart-session.test.ts). | RestartHandoffReviewer re-review: correct, no findings; `persistSession:false` skips post-release flush/saveDraft while preserving detach cleanup. |
| Formatting and immutable stable binary promotion | commit `24c83473`: final stable binary `omp/16.0.1+fork.24c834732f7b`; legacy v3 export/load observed. | Promotion checkpoint is a binary-format/install checkpoint, not evidence for outstanding P1 runtime requests. |

Focused proof gate recorded for this checkpoint set: coding-agent 158 pass/0 fail; agent 69 pass/0 fail; typecheck; Biome on changed files. The committed process/UI test paths above are the proof artifacts. No broad P1 completion is implied.

**Explicit P1 deferrals:** HR-082 Effect version alignment; OQ-007 queue-v2 journal versus transactional SQLite authority; queue edit/cancel keybinding OQ-001; and correlated diagnostics (HR-037). HR-073 and HR-074 remain undecided/unimplemented; the queue projection also retains HR-002's generic pending-next-turn internal-message gap, and HR-048 still lacks a complete context-manifest/affected-ID timeline.

## Required layered test suite

### A. Parse/build firewall

Proposed: `scripts/ci-parse-compiled-cli.test.ts`

- Build candidate in a copied clean worktree.
- Introduce malformed TypeScript in candidate copy.
- Assert build fails and cannot replace stable executable.
- Assert previous stable binary still returns `--version` and `--help`.

### B. Stable/candidate isolation

Proposed: `scripts/ci-installed-binary-isolation.test.ts`

- Separate stable and candidate executables.
- Separate HOME/XDG/profile/session/artifact roots.
- Dirty candidate source after installation.
- Assert stable binary hash/revision and state remain unchanged.
- Assert stable process never opens candidate source.

### C. Routing precedence and provider request

Proposed: `packages/coding-agent/test/process/routing-precedence-process.test.ts`

- Real child processes.
- Real Settings, ModelRegistry, AuthStorage, SessionManager JSONL.
- Deterministic registered custom provider writes concrete request receipts.
- Exercise explicit spawn, explicit session, temporary, agent override, frontmatter role, active inheritance, and default.
- Reload disk config and assert runtime override still wins where specified.
- Assert provider receipt and persisted route record match the same decision.

### D. Explicit quota block

Proposed: `packages/coding-agent/test/process/explicit-quota-block-process.test.ts`

- Persist real quota state below reserve.
- Submit explicit route while another healthy route exists.
- Assert visible block, no provider receipt, no child session/process registration, and no replacement route.

### E. Durable queue crash/restart

Proposed:

- `test/session/durable-input-queue-global-order-process.test.ts`
- `test/session/durable-input-queue-edit-cancel-process.test.ts`

Use two real processes and shared queue/lease root. Assert stable `inputId`, committed global sequence, predecessor fence, edited-text-only delivery, isolated cancellation, exactly-once or explicit uncertain/reconciled status, and compaction/restart order.

### F. Restart ownership handoff

Proposed: `test/process/restart-release-acquire-handoff.test.ts`

Assert one-writer ordering and replacement failure recovery using real leases and processes.

### G. Subagent lifecycle/provenance

Proposed: `test/process/subagent-lifecycle-provenance-process.test.ts`

Exercise running → idle/parked → revive → completed plus crash/restart. Assert immutable lifecycle transitions, parent/child linkage, terminal monotonicity, and route provenance after restart.

### Test network policy

- Deny ambient network.
- Clear real provider credentials in test processes.
- Use deterministic registered custom APIs and request receipt files.
- Loopback only when transport itself must be tested.
- No `vi.spyOn`, `mock.module`, fabricated `SingleResult`, or `createMockModel` in process evidence suites.

## Git and implementation policy

1. Standalone upstream fork outside `~/agents` Git boundary.
2. Frozen current tree remains recovery evidence.
3. One branch/worktree per approved ledger item.
4. One Terra implementation owner; no overlapping writers.
5. Reproduce failure with a behavior test first.
6. Commit a coherent checkpoint before any next slice.
7. Candidate binary runs under isolated state roots.
8. Stable promotion requires clean commit, full relevant gate, binary hash/revision, N−1 backup, and rollback proof.

## Recovery order

1. Runtime/install isolation and parse firewall.
2. Route decision/provenance and explicit quota behavior.
3. One durable input authority/projection after OQ-007 decision.
4. Restart release/acquire handoff.
5. Immutable diagnostic/evidence envelope.
6. Only then: SessionRunner/view separation, operations UI, browser control plane, memory/RLM, or Effect-native runner.

## Source index

- `docs/fable/harness-runtime-contract.md`
- `docs/fable/harness-request-register.md`
- `docs/state/harness-friction.md`
- `TASKS.md` — T-2026-07-11-001
- `local/omp-clean-fork-plan.md`
- `local/phase1-adjacent-orchestrator.txt`
- `vendor/oh-my-pi/packages/coding-agent/src/config/model-resolver.ts`
- `vendor/oh-my-pi/packages/coding-agent/src/task/{index,quota-admission,route-events,executor}.ts`
- `vendor/oh-my-pi/packages/coding-agent/src/session/{durable-input-queue,agent-session,session-ownership}.ts`
- `vendor/oh-my-pi/packages/coding-agent/src/slash-commands/builtin-registry.ts`
- `vendor/oh-my-pi/packages/coding-agent/src/modes/{interactive-mode,utils/ui-helpers,utils/error-inbox}.ts`
- `vendor/oh-my-pi/packages/coding-agent/scripts/{omp,build-binary.ts}`
- `vendor/oh-my-pi/scripts/install-tests/run-ci.sh`
- `/Users/arthur/.omp/agent/sessions/-agents/2026-07-11T02-43-53-887Z_019f4f0f-599f-7000-827a-cb4f1ffded60/RoutingSliceImplementer.jsonl`
