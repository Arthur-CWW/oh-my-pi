# What Kubernetes actually does for rollouts — and what OMP should steal

Written 2026-07-27 after the fleet-wide crash (live-reloaded config + split XDG state killed every orchestrator at once). Provenance: A (Arthur asked for the k8s pattern as a teaching doc), I (mechanism descriptions from well-established public k8s/OTP/NixOS design, not verified against source this session).

## 1. The core trick: nothing is ever edited in place

A k8s Deployment never mutates a running pod. Every change to the pod template produces a **new immutable ReplicaSet** (identified by a hash of the template). Rollout = scale new ReplicaSet up, old one down, a few pods at a time (`maxSurge` / `maxUnavailable`). The old ReplicaSet is kept at scale 0.

- **Readiness probes gate the rollout.** A new pod receives no traffic until it proves healthy; if new pods never go ready, `progressDeadlineSeconds` marks the rollout failed.
- **Rollback is not a repair** — it is re-scaling the previous ReplicaSet, which still exists, byte-identical. `kubectl rollout undo` is a pointer move.
- **ConfigMaps don't hot-patch pods.** By default a config change does nothing to running pods; you roll the Deployment so new pods pick it up. Teams that want config immutability hash the ConfigMap into its name so a config change *is* a template change.

The failure we had — one mutable config file live-reloaded into every running orchestrator simultaneously — is impossible in this model **by construction**, not by carefulness. There is no channel through which a config edit can reach a running process.

## 2. The second trick: reconciliation, not commands

k8s stores *desired state* (etcd) and runs controllers that continuously converge *actual* toward *desired*. Nobody sends "restart that pod" imperatives; you edit the desired state and the loop does the rest. Consequences:

- Crashes are not exceptional: the loop just re-converges. "Let it crash" at cluster scale.
- Every object carries `generation` (spec version) and `status.observedGeneration` — you can always ask "has the system caught up with what I asked for?"

## 3. Leader election: leases + fencing, not Paxos

Arthur asked "how does Paxos work / should we run two orchestrators?" The layered answer:

- **etcd** (the datastore) internally runs **Raft** — consensus is needed there because it is multi-node replicated storage with no shared disk.
- **Controllers** (scheduler, controller-manager) do NOT run Paxos. They use a **Lease object**: one instance holds a named lease with a TTL, renews it periodically; standbys watch and take over when it expires. Every write the leader makes is fenced by the datastore's optimistic concurrency (`resourceVersion`), so a paused-and-resumed stale leader cannot clobber a successor.

Rule of thumb: **consensus is for replicated state without shared durable storage. A fenced lease over shared durable storage is strictly simpler and sufficient.** One Mac with SQLite = shared durable storage. OMP needs a lease row + monotonic ownership epoch checked on every mutating control operation — not Paxos, and not two *active* orchestrators (two journal writers = split brain). The useful version of the "second orchestrator" is a **warm standby that follows the journal read-only** and is promoted by an epoch bump from a supervisor when the leader's lease lapses.

## 4. Node pressure (our disk-guard cousin)

The kubelet's eviction manager watches signals like `nodefs.available` with thresholds expressible as **either** absolute bytes **or** percent — the operator picks the form per signal; the two forms are not silently OR-ed together. Under pressure it taints the node (`node.kubernetes.io/disk-pressure`) so the scheduler stops placing new pods, and evicts by priority. Our 2026-07-26 incident was exactly the OR-mistake: a 5% bound (~50 GB on a 994 GB volume) fired while the 21.5 GiB byte bound was satisfied, and a hysteresis bug pinned the state at `emergency`. Fixed in `kvtrulvu`: bytes authoritative, percent opt-in (default 0), regression tests encode the 994 GB case.

## 5. What OMP has convergently rebuilt (the "did we rebuild k3s?" audit)

| k8s piece | OMP piece | Verdict |
|---|---|---|
| etcd + object store | AgentRegistry + session-control SQLite + journals | Keep ours; single-node SQLite is the right etcd |
| kubelet + CRI | spawn-worker client/host protocol | Keep; just landed malformed-ref sanitization |
| Job controller, `restartPolicy` | `job {"resume":[…]}` from durable journals | Keep — this IS transcript-as-truth |
| Image digests + tag pinning | Release blessing (`16.0.1+fork.…` + sha256 digest) | Keep; already digest-pinned |
| ReplicaSet immutability | **missing** — config is one mutable live-reloaded file | Build: config generations |
| Readiness gates + progressDeadline | **missing** — no canary before fleet adoption | Build: canary orchestrator checklist |
| `rollout undo` | **missing** — recovery was a manual Codex repair session | Build: last-good tuple + one-command rollback |
| Lease leader election | **missing** — Majordomo authority is implicit | Build: fenced ownership epoch |
| Pod UID / generation | `launchGeneration`, session ownership epoch (partial) | Extend |
| Eviction manager | disk-pressure guard | Fixed, keep |
| StatefulSet (stable identity, ordered replacement) | Majordomo blue/green refresh design | Build — sessions are pets, not cattle; StatefulSet is the pattern for pets |

Conclusion: yes, roughly half of k3s' control loop exists here in miniature. That is convergent evolution, not waste — the mistake would be adopting k8s/k3s itself (containers, YAML, cluster networking) for one machine running stateful pet processes. **Steal the four primitives, not the platform:** immutable versioned artifacts, health-gated incremental adoption, pointer rollback, fenced leases.

## 6. NixOS and Elixir/OTP (triage notes)

- **NixOS** is the config-generation model applied to a whole OS: every rebuild is an immutable generation in `/nix/store`, activation is an atomic symlink switch, and the boot menu keeps old generations — `nixos-rebuild switch --rollback` is our "pointer rollback" at system scope. If OMP's config/release/state-root tuple ever grows past homegrown tooling, Nix is the mature substrate for exactly this. Cost: ecosystem buy-in, macOS friction (nix-darwin), team learning curve.
- **Elixir/OTP** contributes the supervision insight, not the runtime: **the supervisor must be simpler than what it supervises** (our refresh supervisor must not run candidate-release code); "let it crash" only works because restarts converge from durable state (our journals). OTP hot code upgrades (versioned modules, `code_change`) are famously hard to get right, and most Erlang shops do rolling restarts instead — strong evidence for blue/green process replacement over in-place live reload.

## 6b. What replaces hot reload: snapshot-at-boundary (Arthur, 2026-07-27)

Hot reload is a cache-invalidation problem in disguise: every subsystem that read config at init holds derived state (DB handles, resolved paths, model clients), and a live mutation silently desynchronizes an unbounded, implicit set of them. The replacement inverts the flow — sessions **pull** an immutable snapshot at safe boundaries instead of having changes **pushed** into running code:

1. **Snapshot-at-boundary (default).** Config is a frozen value captured once per turn (orchestrators), per spawn (workers), per session start (structural keys). The watcher only *stages*: decode → validate → write generation → mark pending. Sessions atomically swap whole snapshots at their next boundary; decode failure keeps last-good and never crashes. This is the nginx model (`nginx -t`, then new workers on new config while old workers drain — running workers are never mutated).
2. **Restart-to-adopt (blue/green)** for structural keys: state roots, auth/session/blob DB paths, worker protocol, isolation mode. The session reports "generation N requires restart" and keeps its pinned tuple until the supervisor cycles it.
3. **True hot reload** — at most stateless display preferences; with per-turn snapshots even those can wait a turn, and deleting the hot path deletes the failure class.

Net work is negative: hot reload demands invalidation logic forever; snapshots delete it. Mechanically in OMP: mutable process-global `settings.get()` becomes a frozen per-turn config object; spawn requests already serialize the parent's snapshot into the worker, so the worker path is accidentally correct today. The open design item is only the closed list of boundaries (turn start / spawn / session start).

## 6c. Resource manifest and cross-generation contracts (Arthur, 2026-07-27)

"Keep a list of resources, like Effect services, with contracts for what won't change between rollouts."

**Durability classes.** Every resource a live session holds falls into exactly one:

| Class | Members | Rollout rule |
|---|---|---|
| Durable truth | session journal, session-control SQLite, auth DB, IRC DB, blob store, workspace files | Never touched by a rollout; protected by versioned format contracts |
| Derived | agent-registry projection, provider clients, route tables, caches | Rebuildable from durable truth at any moment; a rollout may discard freely |
| Ephemeral handles | child PIDs, sockets, LSP servers, browser tabs | Death = re-attach or respawn from durable truth |

Litmus: **crash-only software** (Candea & Fox) — `kill -9` any session at any instant must recover completely from disk. The 2026-07-26 crash ran this test involuntarily and the fleet passed (sessions resumed from journals + DBs once the XDG split was repaired); the manifest turns that from a lucky property into an enforced invariant. Subagent handles illustrate the split: durable identity is `(agentId, sessionFile, launchGeneration, ownership epoch)` in the control DB; the PID is ephemeral. A refreshed parent re-adopts children from the DB and re-fences — the existing `job resume` path.

**Contracts.** Effect's Tag/Layer discipline (stable interface, swappable implementation, explicit dependencies) is the intra-process half. Across rollout generations, the contract surface is the durable-truth column: journal record schema, SQLite schemas, spawn-worker wire protocol, blob addressing, IRC message format. Rule: **writers write version N; readers accept N and N-1.** The spawn-worker protocol already does this (version field; suite tests "fenced v2 and conservative v1 traffic") — generalize the pattern. Enforcement is a golden-fixture corpus: artifacts produced by the previous blessed release must decode under the candidate. The fixture corpus *is* the contract, executable.

**Rollout order.** k8s mandates control-plane-first because it only guarantees one direction (servers tolerate old clients; kubelet lags, never leads). With bidirectional N/N-1 on every contract, a mixed fleet is always legal, and ordering becomes purely a blast-radius choice: **cattle before pets** — disposable workers → one canary orchestrator → workstream orchestrators one at a time → Majordomo last. OMP's skew topology makes this cheap: fresh children spawn from the parent's release (parent + new children are always same-version), so real skew appears only when a refreshed parent re-adopts long-running children — i.e. the journal/control-DB N-1 read path, which is where fixture tests concentrate.

## 6d. Effect Cluster / Workflows as the coordination substrate (Arthur, 2026-07-27)

Effect v4 source research (five Luna librarian lanes, 2026-07-27) found the functionality has moved into core `effect` under unstable imports. At investigated tag `effect@4.0.0-beta.102`, use `effect/unstable/cluster` and `effect/unstable/workflow`; do **not** combine the old v3 `@effect/cluster` / `@effect/workflow` packages with Effect v4. Bun support exists through matching `@effect/platform-bun` and `@effect/sql-sqlite-bun` beta packages. Pin all three to one exact beta and wrap every unstable API behind OMP-owned service Tags.

| Cluster module | OMP fit |
|---|---|
| `Entity` / `EntityAddress` / `Envelope` | Stable typed actor/message identity; good contract for subagent commands |
| `SqlMessageStorage` | Persisted requests, replies, acknowledgements and terminal exits; useful replacement for hand-rolled delivery seams |
| `Singleton` / shard locks | Placement and crash failover only — **not fencing**; there is no incarnation epoch preventing a paused stale owner from writing |
| `ClusterWorkflowEngine` | Strong fit for rollout/canary/rollback orchestration; activities, durable timers, signals and receipts |
| `Runner` / `RunnerHealth` / `SingleRunner` | Membership + health; `SingleRunner` keeps the one-Mac pilot simple |

**Delivery guarantee:** at least once, not exactly once. Keyed requests deduplicate submission, not arbitrary handler side effects. A crash after an external effect but before persisting the terminal reply can repeat the effect; every activity therefore needs an idempotency key or a transaction coupling its side effect and terminal state. Ordering is not global across shards/concurrent handlers.

**Authority gap:** Effect's expiring shard lock does not replace OMP's ownership epoch. Majordomo still needs a monotonically increasing epoch in `control.sqlite`, checked by every mutating command, child adoption, journal projection and external action. Cluster supplies placement; OMP supplies fencing.

**Boundary:** cluster fits the *coordination plane*, not the LLM turn. An LLM turn is nondeterministic and its durable truth remains the transcript. Use workflows around sessions — candidate staging, canary launch, readiness deadline, adoption receipt and rollback — not to replay session execution itself.

**Adoption gate:** conditionally ready for an exact-version beta pilot, not stable-v4-ready. Start with one disposable rollout supervisor using `SingleRunner` + `SqlMessageStorage` + `ClusterWorkflowEngine`; keep Majordomo and live workstream orchestrators outside until crash recovery, duplicate suppression, SQLite contention, N/N-1 decoding and stale-epoch rejection are proven.

## 6e. SQLite topology: one service, several failure domains

Do **not** collapse OMP into one physical database. Use one canonical storage service/path resolver and a small set of domain databases:

| Database | Authority |
|---|---|
| `auth.sqlite` | Credentials, auth sessions and security audit; restrictive permissions |
| `model.sqlite` | Non-secret provider capabilities and routing |
| `history.sqlite` | Transcript/history indexes and durable child-journal metadata |
| `control.sqlite` | Fleet tuples, ownership epochs, adoption state, rollout pointers and receipts |
| `coordination.sqlite` | IRC/mailbox delivery, Cluster messages and workflow records |
| `autoqa.sqlite` | QA runs and retention-prunable evidence indexes |

One physical SQLite file would make every domain share one writer, WAL/checkpoint behavior, migration lock, retention policy and corruption/restore blast radius. Separate files retain independent writers and operational policies; one OMP-owned Effect service still centralizes canonical path resolution, connection setup, busy handling, migrations, backups and observability.

Rules: local filesystem + WAL; short write transactions; no `ATTACH` on request paths (under WAL, attached multi-file transactions are atomic per file, not across the set); cross-file workflows use stable IDs plus outbox/inbox reconciliation; use SQLite's Online Backup API rather than copying live files; treat `-wal`/`-shm` as state; quiesce all owners only for a coherent application-wide recovery point.

Primary references: [WAL concurrency/checkpointing](https://sqlite.org/wal.html), [ATTACH atomicity](https://sqlite.org/lang_attach.html#details), [single-writer transaction behavior](https://sqlite.org/lang_transaction.html#read_transactions_versus_write_transactions), [Online Backup API](https://sqlite.org/c3ref/backup_finish.html), [database sidecars](https://sqlite.org/fileformat.html#the_database_file).

## 7. Root cause of 2026-07-26, restated in these terms

1. **Common-mode channel:** one mutable config, live-reloaded into all sessions including the fleet head. No pinning, no canary, no generation. (k8s: impossible by construction.)
2. **Untested stateful envelope:** XDG path resolution split auth DB / sessions / blobs across two OMP homes; tests exercised the code, not the *state-root identity* the live fleet ran with. Hence the generation tuple must be `(config generation, release digest, state-root identity)` — the state roots are part of what you canary, exactly like a pod spec hashes its volumes, not just its image.
3. **No fenced authority:** when Main crashed, nothing prevented — or orchestrated — recovery; a human ran a repair session. A lease + standby follower turns that into an automatic epoch-bumped promotion.

## 8. Implementation order (agreed with Arthur 2026-07-27)

1. Transactional config decode, last-good retention (bad candidate → quarantined, never a crash).
2. Immutable generation store; sessions pin and record their tuple.
3. Key classification: turn-boundary / restart-required (hot path deleted per §6b).
4. Resource manifest with durability classes (§6c); `session resources` surface printing each resource, class, schema version.
5. Golden-fixture contract corpus: previous-blessed-release artifacts decoded by the candidate (journal, control DB, spawn protocol, IRC).
6. Disposable canary orchestrator + rollout receipts (cattle before pets; Majordomo adopts last).
7. External refresh supervisor; fenced ownership epoch in session-control DB.
8. One-command rollback to last-good tuple.
9. Fleet surface shows per-session tuple + epoch.

Steps 6–9 are the candidate `@effect/cluster` surface (§6d: `ClusterWorkflowEngine`, `Singleton`, `RunnerHealth`), gated on the v4-alignment verification; steps 1–5 are substrate-independent and start immediately.

## Further reading

- Kubernetes docs: Deployments (rolling updates), kubelet eviction, coordinated leader election / Lease API.
- Kleppmann, "How to do distributed locking" — the fencing-token argument.
- Ousterhout et al., "Raft: In Search of an Understandable Consensus Algorithm" — for when we genuinely go multi-host.
- Joe Armstrong, "Making reliable distributed systems in the presence of software errors" (thesis) — supervision trees.
- NixOS manual: system generations and rollback.
