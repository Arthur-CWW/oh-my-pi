# cmux interface direction

> **Provenance — 2026-07-28.** Landed from `review/cmux-interface-direction` (`streams/harness/CMUX-INTERFACE-DIRECTION.md`), authored by Arthur's harness lane on 2026-07-27. The stale stacked `.omp/nixbox-config.yml` was intentionally excluded. Current machine roles and topology are owned by [`agents-topology.md`](agents-topology.md).

Status: active direction, partially built
Owner: harness stream

This is the durable record of what Arthur wants the agent control surface to *be*. Per [`docs/fable/epistemics.md`](../fable/epistemics.md), entries identify their generator: tier A = Arthur stated it directly; A~ = Arthur stated it and scope was inferred; I = inferred from repeated behavior; M = mechanism or measurement.

Implementation sequencing lives in [`docs/fable/harness-reliability-program.md`](../fable/harness-reliability-program.md). This document owns intent and does not duplicate the testing strategy or the source-backed testing research in [`docs/research/testing-talks/`](../research/testing-talks/) and [`docs/research/dst-hegel-bombadil-verdict.md`](../research/dst-hegel-bombadil-verdict.md).

## 1. The thesis

**cmux is the interface, not a dashboard.** (A, 2026-07-27)

Arthur does most of his work through cmux. The control surface must therefore live *inside* cmux as ordinary cmux objects—terminals, browser panes, workspaces, and the Dock—rather than as a separate web app he has to remember to visit.

Corollary: **do not build a generic fleet dashboard.** (A~, 2026-07-27) Generic metric panels are the gravity well. Expose real sessions, transcripts, artifacts, and errors—objects Arthur can act on—not aggregate charts about them.

## 2. Remote should feel local

**Working on a remote host should feel the same as working locally.** (A, 2026-07-27)

Execution moves to nixbox; the experience stays on the Mac. Launch, navigate, inspect, debug, monitor, recover, and review must all be reachable from cmux without the user thinking about SSH, ports, tunnels, or process location.

Transport commands are an anti-goal. Ports, aliases, control masters, and tunnels are system-owned implementation detail, never UI. The durable machine-role and source-transfer contract is in [`agents-topology.md`](agents-topology.md); this document does not restate it.

## 3. Review surfaces forward themselves

**React/Bun dashboards, Portless apps, and plain HTML reports must auto-forward into cmux so Arthur can just look at them.** (A, 2026-07-27)

These are one need and therefore one code path: resolve a remote review target, forward it over loopback, and open it as a cmux browser surface in the workstream's mapped workspace.

Rules earned alongside it:

- Never steal focus; surfaces open with `--focus false`. (A~, 2026-07-27)
- Bind loopback only; never expose a review server on a routable interface. (M)
- Resolve the backend port on every reconcile; a remembered port is stale. (M)
- Report `degraded` or `dead` honestly rather than showing green over a dead backend. (A~, 2026-07-27)

## 4. One workstream, one workspace

**A workstream maps to exactly one cmux workspace; tmux session = workspace and tmux windows = tabs.** (A, earlier session, reaffirmed 2026-07-27)

Inside it: the orchestrator terminal, followed worker surfaces, a signal pane for errors/test receipts/resource pressure, and a browser split for PRs, proofs, and dashboards. Workspace and surface IDs are host-local observations, not durable policy, so no numeric mapping is recorded here.

## 5. Read-only before mutation

**The first control surface is read-only.** (A~, 2026-07-27)

Navigation, inspection, and monitoring come first because they are safe and answer the actual need. Remote mutation—send directive, kill, restart, resume, approve provider—waits until the destination host persists a client-generated message ID and returns a durable receipt. A button that might or might not have acted is worse than no button.

## 6. Navigation reuses one keyboard grammar

**A Dock-hosted read-only `omp hub` TUI is the navigator, reusing the existing Agent Hub keyboard grammar.** (I, 2026-07-27)

This was chosen over a native Swift sidebar for the first slice because it needs no signed extension, stays visible across workspace switches, supports Arthur's Vim-style navigation, and avoids inventing a second control grammar. A native ExtensionKit sidebar remains a later option for roster/navigation; cmux extensions cover cmux metadata and navigation, not OMP's domain model.

The hub must support this path end to end:

host → session → child → transcript → route → error → PR → proof artifact.

## 7. Effort is a live control

**Arthur wants to move thinking effort up and down for subagents—from the hub himself and by telling the orchestrator.** (A, 2026-07-27)

The generator was detail-critical work where `medium` was too low and progress had to survive a change. This is a first-class control-surface requirement, not a config detail. The 2026-07-27 snapshot described running-child swaps as impossible; that implementation gap has since been addressed on `main`, so it is not preserved as current state here.

Standing rule: every spawn carries an explicit model and effort; nothing silently inherits the parent's lane.

## 8. Scope exclusions

- **cmux-tui is not the Mac interface.** (A, 2026-07-27) It may later have a server-side role on nixbox, but it is not Arthur's interaction surface.
- **cmux nightly / Chromium is a lab candidate, not a dependency.** (A~ + M, 2026-07-27) Stable cmux plus WKWebView remains the review path until a signed artifact exists and browser control is programmatically exposed. Nightly may run side-by-side as a tagged lab.
- **Fleet protocol redesign is deferred.** (A, 2026-07-27) Interaction comes first.

## 9. Standing taste rules

- **Bret Victor rule.** Show the behavior itself and invite direct manipulation. A number or static file is a failure when the thing could be experienced. Ask: can Arthur feel this in one click?
- **Adaptive desktop worlds.** Use the available window. `1440x900` is a QA baseline only, never a layout bound.
- **One error log per app**, carrying backend and browser errors. Read it before claiming UI work done.
- **Leave the review path green.** A session that changes servers, routes, or built assets ends by restarting registered instances onto the new build and verifying the review URL.
- **Delegate the checking.** Browser QA and verification runs happen in subagents, not the orchestrator's main thread.
- **Conservative degradation.** Missing or stale evidence is never presented as healthy state.

## 10. Identity discipline

**One durable identity set, not many ad-hoc IDs.** (A, 2026-07-27)

Durable and safe to display, link, and address: `HostId`, `SessionId`, owner epoch, `RunId`, and content/build digests.

Host-local observations—IP addresses, DNS names, SSH aliases, PIDs, socket paths, cmux workspace IDs, and surface IDs—are never authority or cross-host keys. The hub may show them; it must not key durable state on them.
