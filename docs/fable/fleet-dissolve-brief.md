# Fleet-dissolve brief — 2026-07-17 rant extraction

Source: Arthur voice rant, 2026-07-17 ("boundaries dissolve"). Companion to
[`shared-workspace-brief.md`](shared-workspace-brief.md) — that doc dissolves the
session boundary (transcript ↔ rendering); this one dissolves the **fleet**
boundaries (machine ↔ machine, stream ↔ stream, run ↔ review). Grounding
inventory: five scout reports 2026-07-17 (`history://ControlPlaneScout`,
`DashboardScout`, `WorkerQueueScout`, `TailscaleScout`, `LayerSlopScout`); facts
below were verified against live files, not docs.

## What Arthur means (distilled)

1. **Work shouldn't care which machine.** Most processing is Bun/browser-portable;
   macOS is a *capability* (CoreML, motion-oracle, window-recorder, cmux), not a home.
   Portable work should run on the Ubuntu boxes without ceremony.
2. **Review shouldn't care which machine.** Every stream surface reachable by a
   stable name from any tailnet device — glance at workstream state from anywhere.
3. **"Boundaries dissolve"** = the shared-workspace ontology, one level up: streams,
   machines, and dashboards become *projections over one event substrate*, exactly as
   TUI/browser views are projections over one journal.

## The decisive finding: the layer already exists

**Do not extend OMP into a control plane, and do not build a new layer.**
`packages/control-plane` *is* the layer — built, doctrinally correct (journal → outbox
→ ledger → projections), and half-dormant:

| Piece | State (verified 2026-07-17) |
|---|---|
| OMP publisher → JSONL outbox (`~/.agent-control-plane/outbox/`) | **Alive** — thousands of files, minutes-fresh |
| Ingest daemon → SQLite ledger (`src/daemon.ts`, `src/ledger.ts`) | Implemented, **not running** (ledger 3 days stale, 1 session) |
| HTTP + SSE API (`src/http-api.ts`, `src/server.ts`) | Library-only — **never served**, no services.yml entry |
| Life-queue tables in the ledger schema | Schema exists, unused |

OMP stays what it is: a producer (publisher hooks) and consumer (sessions, agents) of
the substrate. The control plane sits *below* OMP and *above* the machines. Extending
OMP itself would couple fleet state to one process's lifetime — the opposite of dissolving.

## The three dissolves, mapped to existing seams

### 1. Machine → capability (the worker queue)
Two real durable queues exist today: companion `JobQueue`
(`apps/ai-companion-rtc/src/job-queue.ts`, JSONL, restart-safe) and the remote
`model-bench/queue` file queue on `desktop` (atomic claim, tmux runner). Everything
else is scheduler (omp automations), in-memory fan-out (task manager,
dynamic-workflows), or manual (gpu-workload-dispatch). Plus one liability: the
subagent worker-pool **echo stub** (already flagged for deletion in
`agent-system-overview.md` open fork #1).

Direction: **one queue seam** — jobs carry `{capabilities: [gpu|darwin|browser|any]}`;
workers on any machine run a claim loop against the control-plane ledger (its queue
tables exist). Companion JobQueue and model-bench queue become the first two
*migrations into* it, not siblings beside it. Clean cutover doctrine applies: a third
queue added without killing the first two is the failure mode.

### 2. Stream → namespace (the dashboards)
Eight review surfaces, four persistence families, ~5 bespoke SSE implementations
(DashboardScout). AGENTS.md said "converge when a third consumer appears" — it
appeared long ago. Convergence seam is **narrow**: shared feed-envelope + error-log
contract (scene-playground's is the best live reference: durable `errors.log` +
`POST /api/client-errors` + `GET /api/errors`) + one SSE transport package. Domain
UIs stay owned per stream; they become *components over artifacts* — the
shared-workspace component layer's first fleet consumer. One universal dashboard is
explicitly the trap: storage schemas differ materially and should.

### 3. Network → gateway (the Tailscale ask)
Smallest honest path, mostly config: portless 0.15 natively supports `--tailscale`
(Tailscale Serve per app; node-level `https://<machine>.ts.net`, extra apps on
8443+). Nothing in-repo enables it yet. Framework noVNC is the only live Serve
precedent. Funnel unused (keep it that way).

**Security finding, act regardless of architecture:** several surfaces
(`apps/xanadu`, `packages/primer-daemon`, `apps/scene-playground`,
`packages/video-eval-viewer`) call `Bun.serve` without `hostname` → they bind
0.0.0.0 *today*, accidentally LAN-exposed. And xanadu's feed actions **execute repo
commands via POST** — served over tailnet unmodified, that is remote code execution
from any device. The dissolve needs a read/act split: viewing is tailnet-wide;
acting stays loopback (or authed) until deliberately opened.

## Deslop delta (LayerSlopScout, beyond deslop-plan.md's landed work)

Dead/duplicate, candidates for the next ratchet wave: worker-pool echo stub (fork #1,
recommended delete) · `apps/tweet-viewer` (README-only) · `packages/symphony-lite-web`
(orphaned client of old contract) · `apps/ios-qa-controller` vs `packages/ios-control`
(dup ownership) · `hyperframes-renderer` vs `remotion-renderer` (docs already pick
remotion) · service lifecycle split 4 ways (`scripts/streams.ts` tmux / per-app
`dev-up.sh` / portless / Caddy `scripts/dev-proxy.ts` + duplicate in
`local/hr164-trial/`) · root alias registry vs self-contained packages (deslop-plan
already flags). Each deletion lands with its ratchet, per slop doctrine.

## Traps

- **10x architecture on a 1x budget.** No broker, no k8s. The honest slice is: turn on
  the existing daemon, serve the existing API, one claim-loop worker on `desktop`.
- **Fourth queue / ninth dashboard.** Every convergence is a cutover with deletions.
- **Act-over-tailnet.** Runnable actions are the value of the surfaces *and* the risk.
- **Doc rot:** this brief describes 2026-07-17 state; the scout reports are the
  evidence, config remains authority.

## Open fork for Arthur (small next decision)

A. **View-first** (config-mostly, days): portless `--tailscale` for existing stream
   surfaces + fix the 0.0.0.0/action-exposure holes. Proves "glance from any device."
B. **Spine-first** (the real move, ~a week of slices): control-plane daemon on +
   HTTP/SSE served under a portless name + one fleet status page projecting outbox
   events; queue unification follows as its own slice.
C. **Deslop wave** (orthogonal, parallelizable): the deletion list above + ratchets.

Recommendation: A + C now (cheap, independent), B as the next planned slice — A's
gateway is exactly where B's status page will hang.

## Addendum 2026-07-17b — practice evidence, new server, k3s/Elixir verdict

Sources: HandoffScout/DoctrineScout/StateScout digests + direct `history.db` queries.

### Measured practice (last 7 days, `~/.omp/agent/history.db`)
- 73 distinct sessions; ramp 8/day (07-10) → 22–26/day (07-14..16). cwd: `~/agents` 44,
  dotfiles 9, headless automations 6, vault 1. Models in use: fable-5 orchestrator +
  luna/sol implementers dominate; long tail (kimi, deepseek, gemini-flash).
- Cross-machine practice already real: desktop GPU file-queue proven (281/281 clips,
  48.3m); **Stema (Primer) already runs capability-ranked local/Tailscale/remote
  processors with SQLite staged jobs + fenced renewable leases** — the in-tree seed for
  the one queue seam, ahead of companion JobQueue and model-bench.
- Lane contradiction to resolve: harness lane says "never tmux, cmux-only"; companion
  batch practice is named desktop tmux. Both are written doctrine somewhere.
- Top failure classes (taxonomy 07-13) are all OMP-internal lifecycle: cancelled
  children losing output (25×), live job-handle loss, read-only revive sandboxes,
  30GB JSC RSS high-water. None are problems a cluster scheduler can see.

### k3s / Elixir — already adjudicated in-corpus, now confirmed
- `fleet-rollout-design.md` (07-15): take k3s *ideas* (immutable digest, desired
  revision, readiness, cordon/drain, serial waves, rollback), reject the k8s resource
  model — sessions are stateful pets with identity + journals.
- `harness-runtime-contract.md` (07-11) + `pi-agent-control-plane.md` (07-04): runtime
  is Bun + Effect v4 + SQLite/JSONL; Elixir parked behind fixed contracts
  (priors: contract-over-substrate — substrate mistakes are cheap once row/API
  contracts are fixed). Elixir spike (06-23) + 07-10 comparison: supervision proven,
  no runtime winner. OTP semantics are requirements, not a runtime adoption.
- Multi-machine escape hatch already chosen (07-04): per-machine daemon + HTTP
  federation over replicated writes; libSQL/Turso noted as future option.

### Topology with the new server
- **Mac M4 Max** — operator + `darwin`/realtime capability (cmux, motion-oracle,
  CoreML, window-recorder). Interactive sessions stay; batch leaves (RSS evidence).
- **New server** — the always-on spine: control-plane ingest daemon + ledger + served
  HTTP/SSE; tailnet gateway (portless `--tailscale` / tailscale serve) fronting every
  stream surface; automations daemon (ends launchd/Mac-sleep fragility — night-reaper
  is currently dead on launchd PATH); headless browser workers; artifact store.
- **Ubuntu desktop (3090)** — `gpu` capability worker; model-bench queue migrates into
  the one queue seam (generalize Stema's fenced-lease model).
- **Framework laptop** — roaming spare worker; existing noVNC Serve precedent.
- Supersedes the sketch above where the spine was implied to live on `desktop`: the
  spine belongs on the most boring always-on box, not the GPU box that reboots.
