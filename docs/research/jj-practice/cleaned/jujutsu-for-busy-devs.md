# Jujutsu For Busy Devs — durable notes

- Author: Maddie
- Canonical URL: https://maddie.wtf/posts/2025-07-21-jujutsu-for-busy-devs
- Published: 2025-07-21; updated 2025-07-27
- Retrieved: 2026-07-20
- Source type: public article

## Core mental model

Jujutsu uses revisions/changes rather than branches as the everyday unit of work. The working copy is itself a mutable revision, identified by `@`. There is no staging area: edits immediately become part of the current change. The stable change ID survives rewrites while the underlying Git commit hash changes.

A normal boundary is:

```sh
jj describe -m 'behavioral claim'
jj new
```

`jj commit -m ...` combines those operations. Empty undescribed revisions disappear automatically when you move elsewhere.

Bookmarks are publication pointers, not containers one is “on”. Create or move a bookmark when sharing work:

```sh
jj bookmark create <name> -r <change>
jj git push -b <name> --allow-new
```

## Navigation and recovery

Useful revision expressions:

- `@` — working-copy revision
- `x-` — parent(s) of `x`
- `y+` — child(ren) of `y`
- `z::` — `z` and all descendants

Useful operations:

```sh
jj edit <change>
jj abandon <change>
jj op undo
```

Abandon is immediate but recoverable through the operation log.

## Colocated Git

`jj git init --colocate .` adds `.jj/` beside an existing `.git/` and uses the Git object store. Git users are not forced to use jj. Avoid `git clean -fdx`, which can delete `.jj/` and repository-local jj configuration.

## Practical higher-value features

The article's later sections emphasize workflows that are awkward in Git but natural in jj:

- Work directly in old revisions with `jj edit`; descendants rebase automatically.
- Create parallel revisions from a common parent.
- Use `jj split` to separate unrelated hunks and files.
- Use `jj squash` to move a revision into its parent.
- Use `jj absorb` to redistribute working-copy hunks to the nearest appropriate ancestor changes.
- Conflicts can live in revisions and be resolved later rather than halting every operation.
- Bookmarks must be moved deliberately when a stack changes.

## Local interpretation

For the agents monorepo, the valuable discipline is: one described behavioral claim per writable worker, independent work as sibling changes, dependencies as short stacks, and coordinator-owned bookmark movement. `jj absorb` is useful only after the intended stack exists; it is not a substitute for identifying ownership in an inherited dirty workspace.
