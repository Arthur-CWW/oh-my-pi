# Stream and substream categorization design (HR-155)

## Summary

Build one versioned session-classification projection, not a second policy system: every session has one primary stream (`streams/*/GOAL.md`, `adhoc`, or `uncategorized`), an optional primary substream, and optional secondary filter tags with evidence. Deterministic evidence wins, a confidence-gated cheap model only fills genuine gaps, and explicit choices are sticky. The session journal remains authority; a denormalized catalog and live fleet capability make filtering cheap for fleet, Hub, bookmarks, and doctor.

## Assumptions and decisions

- Categories are navigation metadata, not ownership law. A low-confidence or conflicting signal must stay `uncategorized`, never manufacture certainty.
- One primary stream drives display and DurablePolicy selection; secondary stream/substream tags are filter-only. This prevents a mixed marketplace+infra session from activating two workstream policies.
- `adhoc` is a deliberate T1 classification. `uncategorized` is the honest default and may also be explicitly locked; an `auto` action removes that lock and permits refinement.
- Stream IDs are discovered only from actual `streams/<slug>/GOAL.md` roots. Today those roots are `companion`, `harness`, `playground`, and `primer`.

## 1. Existing substrate

- The canonical type is currently `SessionWorkstream = workstream | adhoc`; absence means unclassified, slugs are lowercase kebab-case, and the charter path is derived as `streams/<id>/GOAL.md` (`src/session/session-entries.ts:7-52`). There is no substream, explicit uncategorized value, persisted source, confidence, or evidence.
- `/goal` accepts an optional workstream and returns the session classification (`src/goals/tools/goal-tool.ts:18-72,101-137`). Without one, exactly one bounded `streams/<slug>/GOAL.md` reference in the objective infers a workstream; zero or multiple references do nothing (`src/goals/runtime.ts:167-191,228-245,648-680`). It does not verify that the charter exists.
- Launch precedence is `--workstream` > resumed header > `OMP_WORKSTREAM` > an exact `streams/<slug>` cwd; descendant ownership paths are not considered (`src/cli/workstream.ts:25-45`; `src/main.ts:1216-1231`). `/session workstream|adhoc|unclassify` is the live manual surface (`src/slash-commands/builtin-registry.ts:354-400,979-985`).
- Classification is mutable metadata on the first journal line. `SessionManager` sanitizes it on load, atomically rewrites the journal on change, and lets explicit writes replace/remove while goal/inherited writes cannot overwrite (`src/session/session-manager.ts:668-744,866-870,1451-1490`). Source is used during the call but not persisted.
- `FleetCapability.workstream` advertises the live value (`src/session/fleet-capability.ts:22-35,113-129,167-224`; publisher `src/session/agent-session.ts:13055-13088`). Fleet status prefers capability over journal, prints `WORKSTREAM`, and exact-filters `--workstream`; missing/malformed displays `unknown` (`src/cli/fleet-cli.ts:23-46,99-103,176-207,241-276`; command flag `src/commands/fleet.ts:56-66,97-108`).
- Historical session listing still reads a 4 KB prefix from every JSONL file and projects header workstream into `SessionInfo` (`src/session/session-listing.ts:288-448,549-608`). Existing SQL/in-memory indexes contain file metadata, not category fields (`src/session/sql-session-storage.ts:118-123,156-161`; `src/session/indexed-session-storage.ts:4-15,66-85`).
- HR-139 bookmarks are append-only JSONL records with one optional free-text `tag`; last record wins per target. `:bookmarks` accepts no filter (`src/session/bookmarks.ts:7-48,80-126`; `src/modes/command-registry.ts:290-313`; `src/modes/controllers/selector-controller.ts:1213-1297`). Do not overload the user tag as category.
- Hub `/` is a case-insensitive substring filter over fixed active/archived/external fields, with no facet grammar (`src/modes/components/agent-hub.ts:464-488,946-960,1082-1201,2164-2194`). Its row/observer/archive contracts carry no category (`src/registry/agent-ref.ts:4-28`; `src/modes/session-observer-registry.ts:8-37`; `src/internal-urls/history-protocol.ts:44-54`).
- HR-124 `SpawnRecord` persists assignment, shared context, exact full prompt, route, definition, and build provenance (`src/task/spawn-record.ts:3-59`). Parent workstream is snapshotted into the child header, and grandchildren inherit their immediate parent's current value (`src/task/index.ts:1457-1460,1686-1696,1735-1764`; `src/task/executor.ts:2007-2015,2323-2330,2520-2545`; proof `test/task/workstream-inheritance.test.ts:13-85`).
- Durable policy already has global and workstream scopes (`src/policy/policy-records.ts:118-127,184-235`). Precedence is invocation > session policy > temporary posture > workstream durable > global durable > built-in (`src/policy/policy-projection.ts:17-31,132-180`). Session policy is an override layer, not a DurablePolicy scope; classification does not belong in the policy journal.
- HR-155's exact request and honest-default constraint are recorded at `docs/fable/harness-request-register.md:106`; current substrate gaps above are why the row remains requested.

## 2. Taxonomy and substream source

```ts
type StreamRef = { kind: 'stream'; id: string } | { kind: 'adhoc' } | { kind: 'uncategorized' };
type CategoryRef = { stream: StreamRef; substream?: string }; // canonical filter key: stream[/substream]
interface ClassificationClaim { category: CategoryRef; tier: 'T1'|'T2'|'T3'; source: string; confidence?: number; evidenceRefs: string[]; updatedAt: string; }
interface SessionClassificationV1 { version: 1; primary: ClassificationClaim; secondary: ClassificationClaim[]; revision: number; }
```

- Add machine-readable classification metadata to each stream charter: normalized owned path prefixes and optional declared substream slugs/aliases. Longest unique owned-prefix match wins; overlapping or shared paths are ambiguous, not first-match.
- Hybrid substream precedence: (1) manual explicit substream; (2) a verified register row touched in a checkpoint/commit receipt, mapped canonically as `harness/HR-nnn`; (3) a charter-declared sub-slug selected by exact goal/spawn wording or unique owned path; (4) a confidence-gated cheap-model label.
- Declared slugs provide stable vocabulary but are optional. Register IDs need no charter edit, so a new HR row is immediately filterable. T3 may select a declared slug or mint a provisional normalized slug, always carrying `source=inferred` and never affecting policy.
- Claims at the same tier do not silently fight: preserve the current primary if supported, add non-conflicting candidates as secondary tags, and otherwise keep primary `uncategorized`. Manual primary/substream choices remain sticky until explicitly reset to auto.

## 3. Classification evidence tiers and cadence

| Tier | Evidence | Rule |
|---|---|---|
| T1 explicit | `/goal ... workstream`, `--workstream`, `/session` manual override, explicit `adhoc`/`uncategorized` | Wins per field; persists across resume; only another explicit action or `auto` changes it. |
| T2 deterministic | unique charter ownership match from cwd/changed paths; exactly one GOAL.md reference; verified `HR-nnn` register-row receipt; immediate-parent spawn snapshot | Never overwrites T1. Direct child evidence may refine inherited T2; conflicts become secondary or uncategorized. |
| T3 inferred | `smol` classification from title plus most recent bounded journal/compaction summary, constrained to known streams | Run only with no T1/T2 primary; accept one stream at confidence >= 0.85, otherwise uncategorized. Confidence and input revision are durable. |
| fallback | no evidence, conflict, invalid legacy slug, classifier failure/timeout | `uncategorized`; never fall through to `adhoc`. |

Recommended cadence: classify synchronously at goal/manual set and child creation; refine deterministically after checkpoint/commit from actual changed paths and receipts; run T3 once after an idle/checkpoint boundary if still uncategorized. Filter-time reads must stay pure and non-blocking: a missing/stale catalog row may enqueue backfill, but the current query returns `uncategorized` rather than scanning journals or waiting for a model.

## 4. Storage and propagation

- Authority: append a typed `classification_change` entry to `SessionEntry` for audit/evidence, and keep the winning `SessionClassificationV1` snapshot in `SessionHeader` for O(1) resume. `SessionManager` updates both under one serialized mutation; header revision must equal the last typed entry revision.
- Query projection: add a denormalized category table keyed by session ID/path with primary stream/substream, secondary filter keys, tier/source/confidence, revision, and mtime. Maintain it on create, classification change, rename/import/fork, and delete; rebuild only through an explicit doctor repair from journal headers. Hub, bookmarks, session selectors, and doctor query this table rather than journal prefixes.
- Live propagation: replace capability `workstream` with a versioned compact classification snapshot/revision and immediately re-register the peer on change; heartbeat-only refresh is insufficient. Fleet status uses capability first only when its revision is at least the catalog/header revision, otherwise reports stale metadata rather than a false label.
- Hub propagation: carry the compact projection through `AgentRef`, `ObservableSession`, archived descriptors, and external peer rows. Bookmark records retain user tag/note only; `:bookmarks` joins target session/agent IDs against the category table, avoiding stale copied labels.
- Spawn propagation: add the parent's classification snapshot/revision to `SpawnRecord` and child `session_init`; initialize the child with `source=parent`, T2. Existing children do not follow later parent changes; each child may override/refine, and grandchildren snapshot their immediate parent.
- Policy boundary: `projectPolicy(..., {workstream})` receives only the primary known stream. `adhoc`, `uncategorized`, secondary tags, substreams, and T3-only primaries do not select workstream DurablePolicy; this preserves the existing precedence without turning categorization into authority.
- Migration: decode legacy `header.workstream` into a classification entry/snapshot once, with explicit `adhoc` preserved and absent/invalid/unknown-root values becoming `uncategorized` plus legacy evidence. Cleanly rewrite callers to the new type; do not retain dual mutable fields.

## 5. Filter surfaces, v1, and acceptance

- Fleet: retain `omp fleet status --workstream harness`; add `--substream harness/HR-155` and make the `WORKSTREAM` cell show `harness/HR-155` when present. `--workstream` matches primary or secondary stream tags for navigation, but control/policy targeting remains primary-only.
- Hub: extend `/` without breaking free text: `stream:harness`, `substream:harness/HR-155`, `category:adhoc|uncategorized`; tokens AND together, unqualified text keeps current substring behavior, and row counts update from already-projected fields.
- Bookmarks: accept the same facet tokens in `:bookmarks [query]`, render stream/substream as separate badges from the free-text bookmark tag, and join through the category table.
- Doctor: group session/fleet findings by primary stream with explicit adhoc/uncategorized buckets; report projection/header revision drift and offer an explicit `--apply` rebuild. Do not alter the separate plugin-doctor surface in v1.
- Smallest v1 includes the versioned type/event/header snapshot, category table, T1 plus deterministic cwd/GOAL/register/spawn classification, guarded T3 fallback, manual override/reset, capability refresh, and the four read surfaces above. It does not add category-based routing, enforcement, or a taxonomy-management UI.

Acceptance criteria:
1. A session under a uniquely owned path or with one GOAL reference classifies to the real charter; a verified HR-155 receipt yields `harness/HR-155`; ambiguous evidence stays uncategorized.
2. Manual stream/substream, adhoc, and explicit uncategorized survive restart and beat every automatic signal; `auto` permits recomputation.
3. A child inherits the parent's snapshot once, can override it, and a grandchild inherits the immediate parent's current category; provenance remains visible.
4. T3 never runs when T1/T2 exists, never blocks a filter, and below-threshold/error results remain uncategorized.
5. Fleet, Hub, bookmarks, and doctor return identical facet membership from the projection with journal reads disabled; classification changes appear live and after restart.
6. Mixed sessions have one policy-driving primary and filterable secondary tags; inferred/secondary/substream labels never alter DurablePolicy selection.

Open questions before implementation: whether T3 may mint provisional slugs or only choose declared ones; whether `--workstream` navigation should include secondary streams or require `--category`; retention/redaction limits for evidence refs; and which checkpoint/commit receipt is the canonical source of changed paths/register hunks. Recommendation: allow provisional T3 substreams, include secondary matches for read-only filters only, store bounded hashes/paths rather than prompt text, and extend the canonical checkpoint receipt rather than scrape Git history.

## Sequence

1. Define the versioned category/evidence codecs and charter catalog; decide the checkpoint receipt field for register rows.
2. Add journal event + header projection + legacy migration and the denormalized category table with atomic/idempotent update semantics.
3. Implement T1/T2 classification and spawn inheritance, then capability refresh and primary-only policy handoff.
4. Add guarded T3 after deterministic behavior is proven; then wire fleet, Hub, bookmarks, and doctor to the shared projection/query grammar.
5. Run focused behavior/process tests, typecheck, then update changelog/operator docs and HR-155 proof.

## Edge cases

- Deleted/renamed charters; symlinked cwd; relative/glob ownership; longest-prefix ties; shared `apps/xanadu`; malformed legacy metadata; multiple GOAL or HR references; parent uncategorized/adhoc; reclassification during spawn; stale capability revisions; bookmark targets whose child session was pruned; T3 timeout/model unavailability; and classifier results computed from an obsolete journal revision.
- Never let a malformed classification invalidate the whole fleet capability: decode compatibility fields independently and surface category as unknown/stale with evidence.

## Verification

- Extend `test/goals/goal-runtime.test.ts:483-581`, `test/task/workstream-inheritance.test.ts:13-85`, `test/fleet-cli.test.ts:155-231`, `test/agent-hub-search-filter.test.ts:364-496,741-805`, and `test/session/bookmarks.test.ts:23-66`; add real tempdir-backed category-table restart/rebuild tests and policy assertions around `src/policy/policy-projection.ts:17-31`.
- Use a fresh HOME, IRC DB, session-control DB, and session/catalog roots; no mocks. Prove filters with journal reads made unavailable, immediate capability refresh, legacy migration, mixed categories, conflict/low-confidence fallback, and doctor rebuild idempotence.
- Future focused gates: the named/new tests and `bun --cwd=packages/coding-agent run check:types`. This design task itself performs no build or tests.

## Critical files

- `src/session/session-entries.ts:7-52,469-557`; `src/session/session-manager.ts:668-744,866-870,1451-1490`; `src/session/session-listing.ts:288-448,549-608`
- `src/goals/runtime.ts:167-191,228-245,648-680`; `src/goals/tools/goal-tool.ts:18-72,101-137`; `src/cli/workstream.ts:25-45`
- `src/task/spawn-record.ts:3-59`; `src/task/index.ts:1735-1764`; `src/task/executor.ts:2007-2015,2323-2330,2520-2545`
- `src/session/fleet-capability.ts:22-35,113-129,167-224`; `src/cli/fleet-cli.ts:23-46,176-207,241-276`; `src/modes/components/agent-hub.ts:464-488,1082-1201`
- `src/session/bookmarks.ts:7-48,80-126`; `src/modes/controllers/selector-controller.ts:1213-1297`; `src/commands/doctor.ts:29-80,147-209,414-539`
- `src/policy/policy-records.ts:118-127,184-235`; `src/policy/policy-projection.ts:17-31,132-180`; `docs/fable/harness-request-register.md:55,106`; `streams/*/GOAL.md`
