# Noumena / XJDR workflow watch

Date: 2026-06-18

## Current decision

Pause JJ adoption in `~/agents` for now. Use normal Git as the active workflow until Noumena releases the relevant SCM/platform tooling and workflow writeups.

Rationale:

- JJ workspaces solve parallel working-copy isolation, but they still require one filesystem checkout per active agent.
- The immediate pain is environment duplication: `node_modules`, mise/runtime setup, caches, `data/`, generated artifacts, provider credentials, and repo-local state.
- XJDR's public claims describe a deeper system than local JJ workspaces: shallow/virtual checkouts, cloud-synced JJ draft state, Sapling commit stacks, per-file ACLs, and managed remote runtimes.
- The current public Noumena Code repo does not contain that full SCM/backend workflow. Treat it as a reference CLI/TUI source snapshot, not as the available workspace solution.

## Repo state

- Local `.jj/` metadata was removed; this repo is back to Git-only locally.
- The Git history still contains the prior saved work, including the vendored Noumena snapshot.
- `vendor/noumena/code/` is a source snapshot for research.

Vendored source:

```txt
repo: https://github.com/noumena-network/code
commit: 12e972cf7dd50f31df841038d49440709ad37da7
local path: vendor/noumena/code
metadata: vendor/noumena/README.md
```

## What XJDR announced/claimed

From the 2026-06-18 X post, XJDR says Git/GitHub are poorly suited for dozens/hundreds of simultaneous AI agents because branches/worktrees go stale, reviews diverge, repos accumulate dirty state, and every clone/setup repeats heavyweight environment work.

The announced direction:

- shallow virtual checkouts/clones
- JJ for draft state
- a JJ-native persistence/backend layer
- Sapling commit stacks
- automatic cloud sync for workspaces
- AI agents/reviewers as first-class actors
- startup time reduced to seconds
- per-file ACLs
- vertically integrated model + coding harness + SCM + tools + remote runtimes/platform
- more formal announcements over coming days/weeks for `ncode scm` and `ncode platform`

Important: this is announced/claimed future platform behavior. It is not fully available in the public vendored repo today.

## Public code observations

The public Noumena Code repository contains the CLI/TUI and platform integration surfaces. Relevant observed pieces:

- `vendor/noumena/code/src/utils/citcWorkspaceSource.ts`
  - detects Sapling/CITC-style workspaces from `.hg/commitcloudrc` or `.sl/commitcloudrc`
  - reads Sapling repo config from `.hg/hgrc` or `.sl/config`
  - can call `sl cloud status`
- `vendor/noumena/code/src/utils/background/remote/remoteSession.ts`
  - remote-session eligibility can accept a managed workspace source without a normal Git repo
- `vendor/noumena/code/src/utils/teleport/*`
  - remote runtime / teleport session surfaces
- `vendor/noumena/code/src/utils/swarm/*`
  - team/teammate workflow surfaces

This supports the claim that Noumena is building around managed workspace sources and remote sessions, but the OSS snapshot does not provide a drop-in replacement for our local multi-agent workspace setup.

## References

- XJDR Git/GitHub/JJ/NCode platform thread: https://x.com/_xjdr/status/2067596405162848386
- Nitter/read mirror used by tooling: https://nitter.tiekoetter.com/_xjdr/status/2067596405162848386
- XJDR Noumena Code release highlights thread: https://x.com/_xjdr/status/2067018519049564160
- Nitter/read mirror used by tooling: https://nitter.tiekoetter.com/_xjdr/status/2067018519049564160
- Noumena Code site: https://code.noumena.com/
- Noumena usage page: https://code.noumena.com/usage
- Public source repo: https://github.com/noumena-network/code
- Local vendor metadata: `vendor/noumena/README.md`

## Practical workflow until this matures

Default: use Git in `~/agents`.

For normal solo work:

```bash
git status --short
git add <paths>
git commit -m "Message"
```

For parallel subagents, do not force JJ yet. Options, in order of preference:

1. Use OMP/task subagents on disjoint files in the same checkout when edits are well-scoped and coordination is explicit.
2. Use temporary Git worktrees only for risky overlapping changes.
3. Use separate clones only when dependency/runtime isolation is required.

If revisiting JJ later, evaluate it only after Noumena releases the SCM/platform workflow docs or code. The specific question to answer then: can it avoid repeated environment setup, or does it still require local checkout management plus shared caches?

## Follow-up trigger

Reopen this when XJDR/Noumena publishes one of:

- ncode SCM public docs/code
- ncode platform workspace docs/code
- workflow writeup/video promised in the 2026-06-18 thread
- implementation details for virtual checkouts, cloud-synced JJ state, Sapling stacks, or per-file ACLs
