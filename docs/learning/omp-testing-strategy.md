# OMP testing strategy: prove the system, not the implementation

**Status:** decision and teaching document, 2026-07-27.  
**Scope:** OMP journals, session lifecycle, routing, storage, process recovery, rollout, and user-facing control surfaces.

This document uses four evidence labels:

- **Observed** — behavior or repository state already seen in OMP, or a capability stated by an official source.
- **Decision** — the testing contract OMP adopts now.
- **Proposal** — implementation work required to satisfy that contract.
- **Pilot / Watch** — deliberately non-gating evaluation; not part of ordinary local or promotion correctness.

## 1. Diagnosis: tests green, system broken

**Observed:** OMP has repeatedly passed narrow tests while failing as an operating system for agents:

- A persisted **policy v4** was rejected even though the decoder accepted versions 1, 2, 3, and 5.
- The **eval bridge omitted durable parent identity**, so restart could not reconstruct ownership and lineage.
- `:med` was accepted by the CLI parser but rejected by **responsibility route admission**.
- An **XDG split hid nine canonical credentials** because tested roots did not match deployed roots.
- A **fresh-worktree promotion storage alias** resolved differently from the prepared candidate.
- **Synthetic readiness** passed without proving real state-root or model visibility.
- Combining disk thresholds as percent OR bytes, plus faulty hysteresis, **pinned disk pressure at emergency** on a 994 GB volume even though the intended 21.5 GiB bound was satisfied.
- The 2026-07-26 fleet crash combined **mutable live-reloaded configuration**, split XDG state, no canary, and no fenced recovery authority; the detailed system diagnosis is recorded in `docs/learning/kubernetes-rollout-patterns.md`, §7.

These are not mainly failures to write enough examples. They are failures to test contracts across time and boundaries: old data with new code, parser with admission, producer with durable store, process before crash with process after restart, candidate with deployed state roots, and readiness with the resources users actually need.

Mock-heavy tests compound the problem. A mock usually encodes the calls the implementation is expected to make. Generated code can satisfy that call script while preserving the same mistaken assumptions in both code and test. As code generation accelerates, verification and debugging become the bottleneck: correctness work must supply independent evidence about externally visible invariants, not more replicas of implementation shape.

**Decision:** a green OMP change means the relevant behavior survives compatibility, restart, state-root, and process boundaries. Line coverage and isolated mocked units are supporting evidence only.

## 2. Vocabulary: name the evidence precisely

| Term | Meaning in OMP | Typical oracle |
|---|---|---|
| **Golden corpus** | Immutable, reviewed fixtures produced by blessed releases. Goldens pin a durable compatibility contract, not every byte of incidental output. | Candidate accepts N and N-1 records; unsupported versions fail closed without rewriting. |
| **Deterministic replay** | Re-run pure decoding, migration, projection, and state transitions with clock, IDs, randomness, locale, and roots fixed. | Same canonical state and failure location for the same fixture and seed. |
| **Recorded-outcome playback** | Feed previously recorded model messages, tool calls/results, provider errors, and process receipts back as inert observations. | Transcript/UI state reconstructs without dispatching any recorded action. |
| **Differential test** | Run the same immutable input through a blessed release and candidate, then compare canonical outcomes. | Acceptance, migration, topology, classifications, and typed errors agree unless an intentional difference is reviewed. See McKeeman's [Differential Testing for Software](https://www.cs.tufts.edu/comp/150FP/archive/bill-mckeeman/DifferentailTesting.pdf). |
| **Metamorphic test** | Transform an input in a way that should preserve meaning when no complete expected output is convenient. | Timestamp shift, path-root substitution, JSONL chunking, or equivalent symlinked cwd preserves the canonical outcome. See Chen et al., [Metamorphic Testing](https://www.cse.ust.hk/faculty/scc/publ/CS98-01-metamorphictesting.pdf). |
| **Model-based test** | Drive the real implementation with generated commands while a smaller, independent state machine predicts legal states and invariants. | Parent/child, ownership, receipt, or rollout state agrees after every command and restart. [fast-check commands](https://fast-check.dev/docs/advanced/model-based-testing/) support command preconditions, async execution, shrinking, and seed/path replay. |
| **Property test** | Generate many structured inputs and assert an invariant rather than a list of hand-picked outputs. | Codec round-trip, migration idempotence, parser/admission agreement, or monotonic pressure decisions. |
| **Fuzz test** | High-volume adversarial input exploration, usually where crash, panic, UB, unbounded work, or parser acceptance is a useful oracle. | No panic/UB; bounded resource use; stable typed rejection. |
| **Chaos test** | Inject a specific operational fault into real processes or storage: SIGKILL, delay, stale epoch, malformed frame, ENOSPC, WAL pressure. | Recovery invariant holds and the fault/seed is retained. |
| **Deterministic simulation testing (DST)** | Execute a hermetic multi-process system under controlled entropy, time, scheduling, and faults so histories can be explored and reproduced. | Safety/liveness properties across controlled interleavings. Antithesis describes the model in [Deterministic simulation testing](https://antithesis.com/docs/resources/deterministic_simulation_testing.md). |

A replay is not a rerun of the original session. Model sampling and external tool effects are nondeterministic and potentially destructive; replay reconstructs OMP's interpretation of recorded durable facts.

## 3. Mock policy: choose the cheapest faithful boundary

Use this order; moving downward costs more but proves a larger boundary.

| Test double / boundary | Use for | Do not use for |
|---|---|---|
| **Mock** | Verifying that a tiny adapter emits a protocol call that is itself the public contract; rare exceptional SDK shapes that cannot be induced safely. | Session lifecycle, storage, retries, ownership, readiness, routing, or any test whose assertion repeats an internal call sequence. |
| **In-memory fake** | An independent, stateful implementation of a stable interface when its semantics are the subject's dependency, not the subject itself. It must enforce realistic errors and transitions. | Claiming SQLite durability, WAL recovery, process identity, filesystem permissions, or network behavior. |
| **Deterministic Effect Layer** | Clock, random/ID source, temp-root filesystem service, rejecting provider registry, effect audit, and small deterministic domain services. Prefer this for pure policy and model tests. | Replacing the real adapter in the one test intended to prove that adapter or OS boundary. |
| **Recorded adapter** | Playback of curated provider/tool/process outcomes to test decoding, projection, retry classification, and UI reconstruction. | Re-executing old tool calls or claiming live provider compatibility. |
| **Real process / real local resource** | CLI-to-admission flow, SQLite migrations, JSONL/blob persistence, signal/crash recovery, environment roots, fresh-worktree readiness, and PTY/TUI behavior. | Broad random tests against providers or the public network. |

**Decision:** tests do not mock OMP-owned durable boundaries. Use a fresh temp directory, swap `HOME`, set every relevant XDG root, inject an isolated IRC database, and set `OMP_SESSION_CONTROL_DB` explicitly. `HOME` alone is insufficient. Use real SQLite files and real subprocesses where those semantics matter.

**Decision:** external providers, tools, extensions, MCP servers, browsers, shells, auth stores, network, and live control buses remain inert during transcript replay. A provider/auth adapter rejects every access; a tool dispatcher records and fails closed. Any attempted provider or tool execution is a test failure even if the projected output matches.

## 4. Historical transcript corpus

Old OMP sessions are production-shaped evidence about schema history, branch topology, child lifecycle, errors, and recovery. They should become a small curated replay corpus, not a wholesale copy of private archives.

### 4.1 Bundle architecture

Each immutable fixture bundle contains:

1. A manifest with corpus ID, expected classification, source schema version, blessed release digest/version, redaction-policy version, and canonicalizer version.
2. One main journal plus recursively referenced child journals.
3. Only referenced content-addressed blobs, each verified by SHA-256.
4. A whitelist-only copied SQLite metadata snapshot when a case requires it; never a live database.
5. A path/XDG profile and expected typed outcomes.
6. SHA-256 for every redacted file and the manifest, plus a privacy receipt.

The runner validates the bundle, copies it into a fresh read-only source area, and launches release and candidate workers in separate temp roots. It fixes clock, IDs, randomness, locale, cwd, and all path roots; denies network; disables ownership acquisition; audits every write; and permits output only beneath the worker root. Source hashes must be unchanged afterward.

Stages are deliberately separate:

1. structural JSONL/blob/SQLite validation;
2. deterministic migration, projection, tree/leaf selection, and context construction;
3. optional recorded-outcome playback into a non-authoritative transcript model;
4. blessed-release/candidate differential comparison;
5. metamorphic variants and selected crash/reopen points;
6. a receipt containing build and fixture digests, schema result, invariant failures, side-effect audit, seed/trace, and minimized case reference.

Canonicalization may replace timestamps, generated IDs, PIDs, absolute sandbox prefixes, and volatile provider headers. It must preserve record order and type, parent/leaf topology, lifecycle state, error class, ownership semantics, model/workflow transitions, and blob hashes.

### 4.2 Replay firewall

Allowed: parsing; schema decoding; migration; pure projection; read-only context reconstruction; fixture-local verified blob resolution; archived-child discovery with path-containment checks; read-only queries against a copied database; canonical exports inside the temp root.

Forbidden: provider/model/API calls; credential and OAuth reads; DNS/network; shell, browser, Python, MCP, extension, or old tool execution; live journal/database/control-bus access; ownership claim or transfer; clipboard/open actions; and any source-fixture mutation.

Model outputs, thinking, tool arguments/results, provider failures, timing, and usage are **recorded data, never commands**. Tool arguments may be schema-checked and privacy-scanned but are never dispatched.

### 4.3 Privacy and retention

Curate incident-linked structural slices: old versions; branch/fork/compaction; malformed tail; missing/corrupt blob; child success/failure/interruption; restart handoff; ownership loss; and moved/symlinked paths. Do not ingest the full private archive into CI.

Before hashing or committing, schema-aware allowlisting removes prompts, user text, tool arguments/results, file contents, URLs, tokens, environment values, host/email identity, absolute paths, and media unless strictly required. Replace identifiers with keyed HMAC tokens stable only within one fixture; replace paths with typed shape-preserving placeholders; replace text with semantic labels or length buckets. Scan nested JSON, blobs, SQLite text, and compressed payloads; uncertainty fails closed.

Retain only curated redacted bundles, manifests, minimized traces, and receipts. Raw staging data is access-restricted, encrypted, expiry-bound, and deleted after verification. Never emit raw transcript bodies or secrets in test logs, snapshots, artifact URLs, or failure messages.

## 5. OMP test pyramid and gates

This is a pyramid by run count, not by importance. Each layer owns a distinct failure mode.

| Layer | What runs | Incidents it catches | Gate / owner |
|---|---|---|---|
| **Static architecture ratchets** | One codec/grammar per wire contract; one canonical storage path service; no absolute home paths; explicit version/generation fields; no structural live reload. | `:med` drift; XDG split; implicit generation; common-mode config crash. | Per change; owning package. |
| **Deterministic unit + schema properties** | Codecs, migration functions, route grammar/admission, path resolution, threshold conversion, hysteresis, pure policy. | policy v4; `:med`; percent/bytes emergency pin. | Per change; fast, required. |
| **Golden compatibility + replay** | N/N-1 durable fixtures; curated older migrations; negative/malformed fixtures; projection and inert recorded outcomes. | policy v4; old journals; blob/path/child compatibility. | Per durable-reader/writer change; schema owner. |
| **Stateful model tests** | Bounded lifecycle, ownership epoch, outbox/delivery, rollout, migration, and pressure command sequences; invariants after every operation. | missing durable parent identity; duplicate/lost terminal receipt; stale rollout or pressure state. | Per state-machine change; subsystem owner. |
| **Real adapter/storage integration** | Real temp filesystem and SQLite, copied metadata, migrations/reopen, real CLI→typed admission. | XDG credential split; `:med`; storage alias; migration/WAL mistakes. | Per adapter/schema change. |
| **Process/crash E2E** | Spawn actual binaries, SIGKILL at named boundaries, restart/adopt, real isolated env and control DB. | eval parent identity; stale owner; duplicate delivery; fabricated completion. | Focused CI/nightly depending duration; lifecycle owner. |
| **Promotion canary** | Content-addressed candidate in a fresh worktree using actual roots, databases, model catalog/auth visibility, aliases, and readiness path. | fresh-worktree alias; synthetic readiness; release/state-root mismatch. | Every promotion; release owner. |
| **Targeted chaos / optional DST** | Seeded SIGKILL, malformed frames, delayed delivery, ENOSPC/WAL pressure, process loss, selected schedules/network faults. | concurrency and recovery defects not reached by fixed scenarios. | Nightly/pilot; reliability owner. |
| **Black-box UI/TUI exploration** | Semantic browser assertions and, selectively, Bombadil temporal properties/action exploration. | control surface crashes, unsafe transitions, unreachable recovery/error states. | UI changes; Bombadil remains pilot. |

A durable writer change ratchets the corpus: produce a new N fixture with the blessed writer, keep N-1 readable, and test unsupported versions as typed non-mutating rejection. Compatibility is a release contract, not a best-effort parser behavior.

## 6. Effect v4 testing primitives

**Observed:** OMP currently locks `effect@4.0.0-beta.92`. At `beta.102`, the official [`effect/testing` declarations](https://unpkg.com/effect@4.0.0-beta.102/dist/testing/index.d.ts) export `FastCheck`, `TestClock`, `TestConsole`, and `TestSchema`; `TestServices`, `TestAnnotations`, and `TestContext` are not exported there.

- [`TestClock`](https://unpkg.com/effect@4.0.0-beta.102/dist/testing/TestClock.d.ts) supplies a Layer and controlled `adjust`/`setTime` operations. Fork time-dependent effects before advancing virtual time. Use it for retry, timeout, lease-expiry, scheduler, and backoff policy—not OS process timing.
- [`TestSchema`](https://unpkg.com/effect@4.0.0-beta.102/dist/testing/TestSchema.d.ts) supplies decode, encode, construction, arbitrary-generation, and lossless-transformation assertions.
- [`FastCheck`](https://unpkg.com/effect@4.0.0-beta.102/dist/testing/FastCheck.d.ts) integrates generated checks. Effect Schema's [Arbitrary](https://effect.website/docs/schema/arbitrary/) can derive `fast-check` generators, but generator/filter order must be audited: filters before a final transformation can be ignored, and conflicting filters can stall generation.
- [`@effect/vitest@beta.102`](https://unpkg.com/@effect/vitest@4.0.0-beta.102/dist/index.d.ts) provides Vitest-bound `effect`, `layer`, and `prop` helpers. OMP uses `bun:test`; use core Effect/testing primitives there rather than importing a Vitest adapter.

**Decision:** do not copy beta.102 examples blindly into beta.92 code. Pin all Effect packages to one exact beta, probe the locked version's actual exports, and hide unstable testing APIs behind small OMP-owned helpers. A beta upgrade is an explicit compatibility change with focused tests; it is not cleanup.

Effect Layers are dependency wiring, not proof. A deterministic Layer is appropriate for Clock, IDs, rejecting provider/tool boundaries, and independently specified domain fakes. Real SQLite/process tests still prove durability and OS behavior.

## 7. Selective property, model, and fuzz plan

Property testing earns its cost only when there is a clear invariant, useful input diversity, and a replayable counterexample.

### Adopt first

1. **Versioned codecs and migrations:** generate supported records and grammar-aware malformed variants. Assert encode/decode round-trip, explicit version acceptance, idempotent migration, required-field preservation, and typed non-mutating rejection.
2. **Selector grammar→admission:** generate aliases, effort suffixes including `:med`, whitespace, case, Unicode, and malformed tokens. Every parser-accepted selector must become exactly one admissible typed route or a consistent typed rejection.
3. **Root coherence:** generate unset/empty/relative/absolute HOME and XDG roots plus OMP overrides, run in fresh temp directories with an injected control DB, and assert every reader/writer resolves the same canonical resource manifest with no cross-root leakage.
4. **Lifecycle model:** use bounded [`fc.commands`](https://fast-check.dev/docs/advanced/model-based-testing/) with `asyncModelRun` (and `scheduledModelRun` only for specifically race-sensitive cases). Model parent identity, legal statuses, ownership epoch, retries, cancellation, adoption, and terminal receipts; restart between command chunks.
5. **Migration/rollout model:** generate legacy schemas and stage/promote/abort/reopen command sequences. Assert version monotonicity, idempotence, legal transition enforcement, and restart convergence against a deliberately smaller model.
6. **Disk thresholds:** boundary-biased integers around bytes/percent and threshold ±1. Assert monotonic decisions, explicit semantic mode, and documented hysteresis.
7. **Native parsers/path normalization:** use [`cargo-fuzz`](https://rust-fuzz.github.io/book/cargo-fuzz.html) only where panic, UB, invalid-byte handling, determinism, and bounded allocation are meaningful oracles.

Every failure retains the seed, fast-check path/replayPath, minimized input or command trace, environment-root manifest, schema/database version, and exact invariant. Promote minimized incident cases into the deterministic corpus.

### Do not fuzz

Do not randomize full live provider/network sessions, visual snapshots, trivial wrappers, SQLite's SQL parser, or cryptographic primitives. Do not start unbounded lifecycle traces before command preconditions, isolation, shrinking, and deterministic replay are proven. Bun's [`--randomize`, `--seed`, and `--rerun-each`](https://bun.com/docs/test) help expose order sensitivity and repetition; they do not provide coverage-guided fuzzing or replace fast-check shrinking.

Chaos is separate from input fuzzing. Add a small named matrix—SIGKILL around append/flush/rename/terminal receipt/adoption, stale epoch, malformed frame, ENOSPC/WAL pressure, and candidate disappearance—only after deterministic contracts pass.

## 8. Bombadil, Hegel, and Antithesis: narrow roles

### Hegel — Watch, then consider a codec/property pilot

[Hegel](https://antithesis.com/blog/2026/hegel/) aims to bring Hypothesis-quality generation, shrinking, and persistent counterexamples across languages. The TypeScript implementation is early; the family is beta and may change. Its Hypothesis-backed architecture also adds a Python test-time dependency. OMP already has `fast-check` locked and working with Effect Schema, so replacing it now would add migration risk without closing a known gap.

**Watch:** API/runtime maturity and TypeScript integration. **Possible pilot:** one isolated versioned-codec suite, judged on counterexample quality, replay stability, CI friction, and maintenance—not novelty.

### Bombadil — Pilot for black-box TUI/browser invariants only

[Bombadil](https://github.com/antithesishq/bombadil) is a Rust 0.x, explicitly experimental UI exploration tool whose specs use JavaScript/TypeScript state extractors, temporal properties, and weighted action generators. It can exercise browser and experimental terminal surfaces and replay recorded action traces, although reproduction can diverge when the app/options differ.

**Pilot:** archived-session browsing, resume/export/error flows, and invariants such as “a terminal action never makes the session disappear without a terminal classification.” Use redacted fixtures only. Bombadil does not inspect OMP's internal journal/ownership semantics, documents no general fault-injection API, and documents no fast-check-style shrinking. **Do not claim that it shrinks traces.** Keep fast-check/model tests as the internal oracle.

### Antithesis DST — Watch; optional later external lane

[Antithesis](https://antithesis.com/docs/concepts/fault_injection.md) controls entropy and injects network, node, clock, thread, CPU, and custom faults in a deterministic hypervisor. That capability cannot be recreated by a few local delay hooks. Useful adoption requires hermetic Linux containers, packaged dependencies, explicit `setup_complete`, stable safety/liveness assertions, and a valid fault-tolerant workload.

**Watch / later pilot:** cross-process delivery, ownership handoff, and restart timing after OMP has deterministic seams, stable oracles, and containerized dependencies. It is not a local prerequisite and never replaces compatibility replay or process E2E. The [Antithesis skills](https://github.com/antithesishq/antithesis-skills) property-catalog/workload/triage discipline is useful now; hosted launch and triage remain optional external operations.

## 9. Recorded-provider behavioral E2E

**Proposal:** create a product-agnostic `@omp/provider-testkit` around the same provider-neutral Effect service used in production:

```ts
Provider.stream(request: ProviderRequest): Stream<TimedProviderEvent, ProviderError>
```

Only the Layer changes. This boundary lets OMP, Primer, Companion, and future products test their real orchestration without spending provider credits or teaching tests the implementation's call sequence.

### 9.1 Terms and evidence

| Term | Contract |
|---|---|
| **Fixture** | Static authored or curated input data. It has no behavior by itself. |
| **Stub** | A one-shot fixed success or failure for a narrow caller branch; it is not workflow evidence. |
| **Mock** | A substitute that asserts expected internal calls or their order. Do not recommend implementation-call-sequence mocks for behavioral E2E: they can repeat the implementation's wrong assumptions. |
| **Fake** | An independent stateful implementation of an interface that enforces realistic rules. A scripted provider may be a useful fake for a focused policy test, but it does not prove the product path. |
| **Record/replay** | `RecordingProvider` captures the neutral request→ordered outcome stream from a real provider; `ReplayProvider` reproduces that curated outcome without auth, network, SDK, or model execution. |
| **Golden corpus** | Reviewed immutable fixture bundles from a named schema and release. Compare typed canonical outcomes and compatibility contracts, not every incidental byte. |
| **Contract test** | Proves that a provider adapter maps real or captured wire requests, stream fragments, errors, usage, and cancellation into the neutral contract. It does not prove product behavior or provider quality. |
| **Behavioral E2E** | Drives the real product surface and local effects while replacing only nondeterministic or unsafe external boundaries. Assertions target durable and user-visible behavior, not provider call counts. |
| **Eval** | Measures stochastic prompt/model qualities such as correctness, pedagogy, citation faithfulness, or tool choice. It is budgeted and statistically reported, not an ordinary correctness gate. |

### 9.2 Service Layers and cassette contract

- **`LiveProvider`** is the production adapter and the only Layer allowed to read provider credentials, use an SDK, or open provider network connections. It normalizes wire events, typed errors, and usage and bridges Effect interruption to transport cancellation.
- **`RecordingProvider`** decorates another `Provider`, normally `LiveProvider`; it fingerprints the request, tees the unchanged neutral stream with monotonic relative timing, and records completion, typed failure, or interruption through an injected sink. Raw capture is restricted and expiring; curation/redaction is a separate reviewed step, never an automatic commit.
- **`ReplayProvider`** validates a sealed bundle, requires an exact request match, and emits its ordered event/error stream under instant or virtual timing. A missing match is `ReplayUnmatchedRequest`, an ambiguous match is `ReplayAmbiguousMatch`, and neither may pass through to `LiveProvider` or return a plausible default.
- **`ScriptedProvider`** is a deterministic fake for narrow codec, property, retry, cancellation, and fault-policy tests. Scripts use explicit request predicates and named variants or fault schedules; they must not encode “first call A, then call B” or be presented as behavioral E2E.
- **`RejectingProvider`** fails every call with a safe `UnexpectedProviderCall` audit record. Use it wherever provider access must remain inert, especially historical transcript playback.

The strict request digest is provider-neutral and versioned: `SHA-256(domain separator || canonical request bytes)`. Canonical bytes include the exact ordered system prompt, messages and prior tool results; route/provider API/model; ordered tool names, descriptions, strictness, grammars, and canonical JSON Schemas; response format, stop sequences, and every output-affecting generation option. Object keys are sorted, but prompt parts, messages, tools, enums, and other semantically ordered arrays are not. The canonicalizer may declare NFC Unicode and LF line endings equivalent; it must not trim, collapse, reorder, or fuzzy-match content. It excludes credentials, request/trace IDs, wall time, absolute roots, callbacks, and observability baggage. Component digests for prompt, conversation, tools, route, and generation make mismatches diagnosable without logging bodies or secrets.

Each sealed cassette contains a versioned manifest, an index keyed by request digest plus explicit named variant, ordered JSONL event frames, optional content-addressed blobs, and a privacy receipt. Frames preserve contiguous sequence, monotonic elapsed time, text/thinking and tool-call chunk boundaries, raw tool-argument fragments through their typed final parse, cumulative usage, stop reasons, and exactly one terminal record: completed, typed `ProviderError`, or interrupted. Cancellation is exercised by interrupting the real consumer fiber and observing finalization; a historical interrupted frame alone is not proof. The loader validates the event state machine and supported request/event/bundle/canonicalizer versions, verifies SHA-256 for every file and reference, applies the declared schema-aware redaction policy, and fails closed on corruption, unresolved sensitive data, unknown versions, or mutation. Fixtures are immutable; migration produces an in-memory representation or a new reviewed bundle.

Normal lookup is by independent request digest, not a global invocation cursor, so concurrency cannot select by filesystem order. A real fixture-local tool result becomes part of the next provider request and therefore selects a second independent interaction. Named retry/error variants and virtual-time fault schedules are explicit test configuration, never hidden occurrence-dependent behavior.

### 9.3 The real product path and the three lanes

A replay-backed behavioral E2E keeps the app binary or daemon, server and HTTP routes, product SQLite files and production migrations, filesystem persistence and reopen behavior, prompt/context assembly, model routing, stream/tool parsers, retry/error/cancellation policy, provenance and state machines, allowed fixture-local tool implementations, and the real UI/browser path. It substitutes external model sampling, provider auth/network/SDK transport, and unsafe external tools. Allowed tools execute for real only against isolated fixture state; shell, public network, MCP, extensions, live control buses, and other unclaimed effects reject.

Historical transcript compatibility is a different operation: old model messages, tool calls/results, errors, usage, and timing are inert recorded outcomes used for decoding and projection. Old arbitrary providers and tools never execute; install `RejectingProvider` and rejecting tool adapters rather than `ReplayProvider` unless the test intentionally begins a new provider turn.

Keep three separately reported lanes:

1. **Per-change hermetic behavioral E2E:** `ReplayProvider`, fresh temp roots and real product persistence, virtual time where needed, network/auth denied, zero provider spend; required for changed product behavior.
2. **Scheduled live provider contract canary:** a tiny credential-gated and budget-capped `LiveProvider` run that checks current auth, model visibility, streaming dialect, tool grammar, usage/error normalization, cancellation, and adapter drift. It runs on adapter/model-route changes and a sparse schedule, not on every product change.
3. **Prompt/model eval:** budgeted live samples with a quality rubric, public/synthetic cases, repeated samples and evaluator/version metadata. This is the lane for answer quality, pedagogy, citation faithfulness, refusal, and tool-choice claims. Passing replay does not claim that a provider or model is good.

### 9.4 Primer proving scenarios

Adopt the same service in Primer while keeping the daemon, routes, SQLite, parsers, provenance, SRS state, tool registry, and browser real:

1. **Success plus provenance:** create a synthetic reader document and mark through production routes, replay chunked structured enrichment, persist and reopen, then assert one valid domain result whose citations resolve to seeded source/span IDs and whose provenance receipt is linked. Assert structure and relationships, not generated prose.
2. **Allowlisted tool round trip:** replay fragmented `primer.lookup_source` arguments, decode and dispatch the real Primer tool against temp SQLite, record its real provenance/result digest, include that result in the next exact request, and replay the continuation. A changed result digest must mismatch rather than accept a stale continuation; no external tool may run.
3. **Retry and error:** replay an explicit retryable rate-limit/overload followed by success, plus malformed JSON, incomplete tool arguments, and mid-stream disconnect variants. Exercise real bounded retry/backoff under virtual time; partial deltas never become a durable success, typed terminal errors remain sanitized, and reopen does not duplicate work.
4. **Cancel and restart:** block replay at named stream and commit boundaries, cancel the real operation or terminate the daemon, then restart on the same temp databases. Assert interruption/finalization, stale-worker rejection, at most one terminal receipt/result, and resumable or uniquely committed state rather than duplicated output.
5. **Browser flow:** drive the real reader→mark→enqueue→enrich→review→provenance path through Chromium and loopback HTTP, including reload. Assert loading, retrying, error, success, empty and disabled states; keyboard/focus behavior; provenance navigation; no duplicate actions; persistence after reload; and responsive overflow/overlay behavior without full-page prose snapshots.

### 9.5 Fixture updates are product review

An exact prompt, message, prior tool result, route, generation option, or tool-contract change must alter its component digest and make replay fail before emitting an event. The failure reports safe expected/actual component digests and fixture IDs, never content. Do not add wildcard matching or silently rewrite the cassette. Updating it requires a reviewed fixture diff that explains the digest change, regenerates or authors the intended outcome, re-runs schema/redaction/integrity checks, updates version/checksum/privacy receipts, confirms the product-level assertions still express the intended behavior, and records whether the prompt/model change also requires a live eval. A reviewed alias may bridge only a canonicalizer or schema migration; it may not hide a prompt or tool-contract change.

## 10. The five highest-value initial tests

These five establish the spine; each is behavioral and incident-linked.

1. **N/N-1 durable corpus and migration replay.** Curated policy and journal fixtures from current and previous blessed releases, plus v1/v2/v3 migration cases and unsupported versions. Assert decode, canonical projection, migration idempotence, typed fail-closed rejection, no source rewrite, and zero provider/tool/network attempts. Catches policy v4 and schema drift.
2. **CLI selector→responsibility admission round trip.** Feed every supported shorthand—including `:med`—through the real parser and typed admission path. Assert the route receipt equals parsed intent or returns a typed rejection. Add generated aliases and malformed suffixes. Catches the parser/admission split.
3. **Canonical root and real readiness matrix.** Launch the candidate under a fresh temp `HOME`, every XDG directory, isolated IRC and `OMP_SESSION_CONTROL_DB`, seeded copied credential/model metadata, and storage aliases. Assert all nine expected credentials and expected models are visible through the real startup/readiness path, with no root leakage. Catches the XDG split and synthetic-readiness gap.
4. **Real crash/restart, adoption, and receipt test.** Spawn parent and child processes; SIGKILL at persistence, delivery, lifecycle-terminal, and adoption boundaries; restart. Assert durable parent identity, child lineage, monotonic ownership epoch, stale-owner rejection, and exactly one terminal receipt or explicit deduplication. Catches the eval-bridge identity defect and recovery races.
5. **Fresh-worktree candidate promotion.** Materialize the content-addressed candidate in a new worktree, run its actual readiness against copied isolated state, validate aliases, stage/canary/bless/launch, and compare the candidate's reported digest and tuple to the bytes and roots exercised. Catches the promotion storage alias and candidate/live parity gap.

The disk-pressure boundary property is the first follow-on: the 994 GB / 21.5 GiB regression belongs in the fast deterministic layer and then in the state-machine hysteresis model.

## 11. Architectural refactors that reduce test burden

Testing cannot compensate indefinitely for duplicated languages and hidden topology. Prefer deleting invalid states:

1. **One grammar/codec for selector syntax and route admission.** Derive CLI parsing, typed requests, and admission from it; remove duplicated acceptance lists.
2. **One canonical OMP-owned storage service and resource manifest, with separate domain databases.** Centralize path resolution, permissions, connections, busy handling, migrations, backup, and observability, while retaining `auth`, `model`, `history`, `control`, `coordination`, and `autoqa` failure domains.
3. **Immutable snapshots at turn/spawn/session boundaries.** Structural configuration changes require new generations and restart; delete mutable process-global live-reload paths.
4. **Explicit durable generation tuple:** config generation, release digest, state-root identity, schema/protocol versions, and ownership epoch. Persist and report it in readiness and receipts.
5. **One typed durable delivery/outbox substrate.** Requests, replies, acknowledgements, terminal states, and idempotency keys share one model; external effects remain idempotent because at-least-once delivery can repeat after a crash.
6. **Pure policy separated from effects.** Thresholds, route decisions, transition legality, and migration plans remain pure; Clock, Filesystem, Storage, Provider, and Tool services are explicit Layers.
7. **Readiness asserts resources, not liveness.** It proves actual roots, databases, credentials/model catalog, migrations, aliases, release bytes, and write permissions needed by the launched role.

**Decision:** one physical SQLite is not a testing solution. It would give all domains one writer, WAL/checkpoint behavior, migration lock, retention policy, and corruption/restore blast radius. A canonical storage service plus separate domain databases improves isolation while keeping path and connection policy consistent. SQLite's official documentation explains [WAL concurrency](https://sqlite.org/wal.html), [single-writer transactions](https://sqlite.org/lang_transaction.html#read_transactions_versus_write_transactions), and why [`ATTACH` atomicity](https://sqlite.org/lang_attach.html#details) does not make multi-file WAL workflows one failure domain. Cross-database workflows use stable IDs plus outbox/inbox reconciliation; backups use the [Online Backup API](https://sqlite.org/c3ref/backup_finish.html), not copied live files.

Effect Cluster placement is also not a testing or authority solution. At beta.102, Singleton/shard locks provide placement and failover, not an ownership-incarnation fence. OMP's monotonic ownership epoch must be checked on every mutating action. **Do not claim Effect Singleton fences stale writers.**

## 12. Promotion and readiness contract

A candidate may be promoted only when all applicable evidence is attached to the exact content-addressed build:

- The candidate reports a release version/digest matching its bytes.
- Static/unit/property gates pass for changed contracts.
- Current and N-1 golden fixtures decode; named older migrations remain idempotent; unsupported versions fail closed without mutation.
- Differential replay has no unreviewed acceptance, projection, topology, classification, or typed-error difference.
- Replay records **zero** provider, network, auth, tool, MCP, extension, live-control, or authority attempts; writes remain inside the worker temp root; fixture hashes remain unchanged.
- Relevant stateful models converge after reopen; every retained failure reproduces from its seed/trace and minimized case.
- Real subprocess crash/restart tests prove durable identity, legal ownership, and terminal receipt behavior for lifecycle changes.
- A fresh-worktree canary uses isolated `HOME`, all XDG roots, isolated IRC and session-control databases, copied domain data, the real model catalog/auth visibility, and actual aliases. Readiness means those resources work, not that a synthetic process answers.
- The receipt records build digest, fixture/redaction/canonicalizer versions, state-root identity token, schema/protocol versions, config generation, ownership epoch, and gate outcomes—never transcript bodies or secrets.
- Any compatibility allowlist change is reviewed as a product/release decision and arrives with a fixture proving both intended acceptance and intended rejection.

Rollout is cattle before pets: disposable worker, one disposable canary orchestrator, workstream orchestrators one at a time, Majordomo last. Abort on the first unclassified differential, privacy violation, effect-firewall attempt, stale-epoch acceptance, or readiness/resource mismatch. Rollback selects the last blessed immutable tuple; it does not repair the candidate in place.

This contract changes the question from “did our implementation-shaped tests pass?” to “what independent evidence proves this exact release can read our past, survive interruption, see the real state, and avoid doing harm?”

## Primary references

- OMP incident and rollout synthesis: `docs/learning/kubernetes-rollout-patterns.md`
- Effect: [`effect/testing` beta.102](https://unpkg.com/effect@4.0.0-beta.102/dist/testing/index.d.ts), [`TestClock`](https://unpkg.com/effect@4.0.0-beta.102/dist/testing/TestClock.d.ts), [`TestSchema`](https://unpkg.com/effect@4.0.0-beta.102/dist/testing/TestSchema.d.ts), [Schema Arbitrary](https://effect.website/docs/schema/arbitrary/)
- fast-check: [Model-based testing](https://fast-check.dev/docs/advanced/model-based-testing/)
- Bun: [Test runner](https://bun.com/docs/test)
- Bombadil: [repository and manual](https://github.com/antithesishq/bombadil)
- Hegel: [announcement and design](https://antithesis.com/blog/2026/hegel/)
- Antithesis: [DST](https://antithesis.com/docs/resources/deterministic_simulation_testing.md), [fault injection](https://antithesis.com/docs/concepts/fault_injection.md), [skills workflow](https://github.com/antithesishq/antithesis-skills)
- Record/replay: Peter Alvaro, [Deterministic Record-and-Replay](https://queue.acm.org/detail.cfm?id=3688088)
- SQLite: [WAL](https://sqlite.org/wal.html), [transactions](https://sqlite.org/lang_transaction.html), [backup API](https://sqlite.org/c3ref/backup_finish.html)
