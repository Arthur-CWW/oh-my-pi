# TUI MVU recovery and generated testing

## Status

The MVU Big Bang is parked on `archive/tui-mvu-bigbang-20260720` at `72245bf84`. Daily OMP is the retained pre-MVU binary `16.0.1+fork.6d8cfd43b4ef`; `main` contains explicit reverts, so the experiment remains inspectable and recoverable.

Do not resume by chasing individual reported bugs or by making the migration audit table reach zero. First decide the intended behavior of each user-visible surface.

## Known parity gaps

- Raw subagent transcript/tool-call review became less useful.
- Model selection no longer exposed reasoning-effort choice as expected.
- Resume geometry, filtering, and dismissal regressed before a partial repair.
- Vim-normal colon command entry regressed before a partial repair.
- Other selector/modal geometry, shortcuts, help text, and nested Escape behavior remain insufficiently characterized.
- The package-wide test attempt did not produce a valid green verdict because a Bun worker terminated with SIGTRAP.

## Recovery sequence

1. Record a compact behavior matrix for Resume, Model/effort, transcript viewer, command mode, composer/history, Settings, and Agent Hub: opening action, navigation, filtering, nested Back/Escape, submission, geometry, persistence, and raw-inspection affordances.
2. Capture representative grids/screens from the retained binary. Treat them as contract-discovery evidence, not an automatic golden oracle.
3. Build one generated selector/runtime harness before migrating another surface.
4. Reintroduce infrastructure selectively. A mixed Legacy/MVU architecture is acceptable while ownership is explicit and tested.
5. Migrate one vertical surface at a time, starting with Resume or Model selector. Require generated cases, real grid/PTY proof, and human geometry review before continuing.

## Generated test-case approach

Generate reachable semantic scenarios rather than arbitrary terminal bytes or arbitrary reducer messages.

Reference state:

```text
route: unmounted | mounted(component, lease generation)
mode: browse | filter(query) | preview | confirm
source: ordered stable IDs + source revision
selection: stable selected ID
async world: pending operations keyed by full route stamp
receipt: none | pending | succeeded | failed
ownership: active input lease and consumer trace
viewport: rows, columns, prior grid, dirty/work counters
```

Actions are legal only when their preconditions hold: move, page, begin filter, append/delete, activate, Back, arm/commit, replace source, resolve/fail a pending operation, deliver one-axis-stale results, remount, resize, saturate, and close with pending work.

After every settled action, assert:

- exactly one input owner;
- commit before command observation;
- all four stamp axes fence stale/duplicate results;
- Back removes one reversible layer and never destroys a draft;
- stable-ID selection survives reorder and clamps on removal;
- destructive nonces spend at most once;
- every mounted route has a bounded path back to the composer;
- grid geometry is valid and navigation work remains bounded;
- model plus reasoning effort persist where the product contract requires it;
- transcript/raw-tool inspection remains reachable.

Use deterministic completion selection rather than sleeps. Save seed, shrink path, minimized semantic scenario, stamps, transition/command trace, ownership trace, dimensions, and normalized grid. Promote minimized failures to named tests.

Differential old/new runs are a discovery tool: compare normalized semantic outcomes and intermediate state, not raw whole-screen equality. Intentional differences require an explicit manifest. Keep raw-byte framing and process continuity in a thin real-PTY tier.

## Hegel and Bombadil fit

The source handoff is `~/vault/topics/hegel-bombadil-integration-handoff.md`.

Hegel is the stronger near-term experiment for the generated semantic layer. Its TypeScript frontend delegates generation, coverage guidance, persistence, and shrinking to Hypothesis through a permanent Python subprocess. Pin the 0.x/frontend version, make Python an explicit local/CI dependency, commit its example database, and apply timeouts around the subprocess boundary. Use it to generate reachable state/action structures and minimize failures; do not use it for billion-input parser fuzzing.

Bombadil contributes the better UI-test ontology: extractors capture a composite state after every step, temporal properties describe what must always or eventually hold, weighted generator trees keep actions reachable, and an inspection timeline makes failures reviewable. Its current standalone backend is Chromium, while a terminal driver is planned. Do not force OMP through a browser abstraction or depend on unreleased TUI support. Borrow the extractor/property/generator/timeline architecture now; evaluate Bombadil directly only when its terminal backend is usable or a small custom driver is demonstrably supported.

Small trial:

1. Write one Hegel-backed pure selector/model scenario using the independent reference state.
2. Demonstrate coverage-guided discovery and automatic shrinking against an intentionally broken invariant.
3. Persist and replay the minimized example without wall-clock sleeps.
4. Feed the same action trace to `MvuTestBackend`, recording Bombadil-style extractor snapshots and temporal violations.
5. Build a simple local timeline viewer only after the serialized artifact proves useful.

Hegel and Bombadil are complementary rather than alternatives: Hegel supplies generated data and shrinking; the Bombadil pattern supplies state extraction, temporal oracles, weighted action trees, and inspectability.

## Workspace strategy

Colocated Jujutsu is initialized as a controlled changeset trial in the existing `~/agents` workspace. The temporary sparse MVU workspace was removed: stream/path ownership remains the primary organizational convention, and extra workspaces are created only for concrete concurrent isolation needs. Automatic tracking is disabled to protect large local artifacts. The operating guide is `docs/plans/jj-changeset-workflow.md`.

Before making jj the mandatory repository-wide interface, evaluate:

- operation-log recovery and abandoned-agent changes;
- splitting/reordering the MVU runtime, per-surface migrations, tests, and UX fixes as independent changes;
- interoperability with Git-based release scripts, branch/bookmark expectations, and subagent isolation;
- disk use after installing dependencies and producing build outputs;
- whether workers can reliably return change IDs without mutating shared bookmarks.

## Reading order

1. `streams/harness/tui-mvu-core.md`
2. `git show archive/tui-mvu-bigbang-20260720:docs/fable/tui-view-audit.md`
3. `git show archive/tui-mvu-bigbang-20260720:local/proofs/tui-mvu-bigbang/README.md`
4. `git show archive/tui-mvu-bigbang-20260720:local/proofs/tui-mvu-bigbang/test-results.txt`
5. `docs/research/dst-scaled-down.md`
6. `packages/dst-mini-rs/src/main.rs`
