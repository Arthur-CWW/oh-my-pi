# Agents topology and folder ontology

Status: decision record, adopted 2026-07-28 (Arthur + harness thread; infra concurrence `agents-fz30p2`).
Machine-level invariants live in the nixbox wiki (`dotfiles/docs/agent-library/machines/nixbox.md` — "Sharing with the Mac", "Development workspaces", "Ownership boundaries"). This doc owns only the repo-side conventions; link, never restate.

## Decision: the agents dir is never mounted across machines

The tree is not shared as a live network filesystem in either direction. Concurrent Git/jj writers, filesystem watchers, locks, and cross-host metadata semantics are a failure domain we refuse (wiki §Sharing with the Mac). What crosses machines instead:

- **source** — git refs through `nb` (`nixbox:/home/arthur/agents.git`), the single canonical repo;
- **proofs / review assets** — read-only HTTP over the tailnet (Tailscale serve of the proof archive) plus explicit `rsync` for bulk;
- **interactive work** — ssh/tmux on nixbox, surfaced on the Mac as cmux remote tabs.

Reopen only if a workload genuinely needs shared mutable files; then export a dedicated data subtree (never the repository), tailnet-bound, with an explicit single-writer contract, owned by the dotfiles flake.

## Machine roles

| Machine | Role | Holds |
|---|---|---|
| Mac | control/review plane; macOS-only work (cmux, Touch ID, native evidence) | exactly one checkout, `/Users/arthur/agents`, kept thin on clean `main` |
| nixbox | execution: builds, tests, lanes, load/fault work | canonical bare repo, clean clone, all lane workspaces |
| h11 | hardware + recovery plane | never mounts or edits guest filesystems |

## nixbox layout

| Path | Purpose |
|---|---|
| `/home/arthur/agents.git` | canonical bare repo (`nb`) — the only ref authority |
| `/home/arthur/agents-main` | clean clone; `omp-next` launcher source; fast-forward only |
| `/srv/data/agents/` | bcachefs subvolume on the big volume; all heavy, disposable state |
| `/srv/data/agents/workspaces/<lane>` | per-lane sparse checkouts; deleted when the lane lands |
| `/srv/data/agents/closures/<bun.lock-sha>/` | canonical `node_modules` seeds; lanes reflink from here (reflinks cannot cross filesystems, so seeds live on the same volume as workspaces) |
| `/srv/data/agents/attic/` | rescue bundles and imported archives |
| `/srv/data/agents/proofs/` | proof archive (migrating from `/home/arthur/proofs-archive`) |

On `nb`, the ref namespace `refs/attic/<date>/*` holds rescued or unlanded tips. Never build new work directly on an attic ref — copy it to a real branch first.

## Mac `local/` ontology

`local/` is disposable (AGENTS.md). On the Mac it may contain ONLY:

1. `local/proofs/` — receipts pending `rsync` to the nixbox proof archive;
2. short-lived scratch that its creator deletes in the same session.

Lane workspaces never live on the Mac. cmux source lives at `vendor/manaflow-ai/cmux`, not in `local/`. Anything in `local/` that a second task wants is promoted immediately (`packages/`, `streams/`, `skills/`, `docs/`) or archived to the nixbox attic and deleted. Worked example: the 2026-07-28 reclaim (`nixbox:/home/arthur/proofs-archive/attic-mac-20260728/` — audits, rescue bundles, artifact sweep receipts).

## What would reopen these decisions

- nixbox unavailable → Mac temporarily regains execution duty (evidence discipline unchanged).
- A proven shared-mutable-file need → dedicated exported subtree per the wiki, never the repo.
- A third machine joining the fleet → revisit the closure/attic layout before cloning conventions.
