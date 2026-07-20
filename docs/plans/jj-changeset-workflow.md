# Jujutsu changeset workflow

## Current setup

This repository is colocated Git + Jujutsu. Git remains the publication/release boundary; jj is the local change/workspace interface.

- Primary workspace: `~/agents`
- Existing `streams/<name>` ownership remains the organizational convention
- MVU experiment remains addressable by bookmark `archive/tui-mvu-bigbang-20260720`
- Repo-local jj policy: `snapshot.auto-track = "none()"`
- `trunk()` resolves to the local `main` bookmark, not the unrelated `origin/master` remote

Do not create a permanent workspace per stream. A separate sparse workspace is an exception for a real concurrent filesystem-isolation need, then is forgotten and removed after its change lands.

## Mental model

A jj working copy is already a mutable change. Start a new change before each behavioral claim. Do not use one long-lived workspace change as a dumping ground.

Good changes:

- `generated selector scenario harness`
- `restore model plus effort selection`
- `expose raw transcript tool calls`
- `migrate Resume with parity contract`

Bad changes:

- `MVU work`
- `misc fixes`
- `modify selector files`

## Daily commands

Inspect the current graph and change:

```sh
jj status
jj log -r 'trunk()..@' --summary
jj diff
```

Describe the current change early:

```sh
jj describe -m 'restore model plus effort selection'
```

Finish the current change and start a new child:

```sh
jj new -m 'generated selector scenario harness'
```

Create a sibling change from the same parent:

```sh
jj new @- -m 'raw transcript inspection parity'
```

Split unrelated work out of the current change:

```sh
jj split
```

Move a change onto another parent:

```sh
jj rebase -s <change-id> -d <new-parent>
```

Abandon a failed change while retaining operation-log recovery:

```sh
jj abandon <change-id>
jj op log
jj op undo
```

Create or move a Git-visible bookmark only when a change is ready for publication:

```sh
jj bookmark set <name> -r <change-id>
jj git export
```

Use existing Git release scripts after export. Do not run Git reset/checkout operations casually in a colocated workspace; they can move Git refs underneath jj and trigger imports.

## Optional isolated workspace

Most work stays in `~/agents` and is separated by described changes plus stream-owned paths. When two writers genuinely need concurrent filesystem state, create a temporary sparse workspace:

```sh
workspace=\"${HOME}/.omp/workspaces/agents/<name>\"
mkdir -p \"$(dirname \"${workspace}\")\"
cd ~/agents
jj workspace add --name <name> --revision <parent> --sparse-patterns empty \"${workspace}\"
cd \"${workspace}\"
jj sparse set --clear --add <owned-path> --add <required-root-file>
```

Add a dependency only when a build proves it is required:

```sh
jj sparse set --add vendor/oh-my-pi/packages/<dependency>
```

After the change lands:

```sh
cd ~/agents
jj workspace forget <name>
rm -rf \"${HOME}/.omp/workspaces/agents/<name>\"
```

## Tracking policy

`snapshot.auto-track = "none()"` is deliberate. This monorepo contains large local datasets, application bundles, logs, and proofs. jj will continue tracking already tracked Git files, but it will not automatically adopt arbitrary untracked files.

Add a new file deliberately:

```sh
jj file track path/to/file
```

Gitignore remains the shared durable ignore mechanism. Do not raise jj's maximum new-file size to absorb local binaries or datasets.

## Agent changeset contract

For delegated work, each worker packet should name:

- parent change ID;
- proposed change description;
- exact owned paths;
- acceptance behavior;
- proof artifact or focused checks;
- non-goals.

Workers should return a change ID rather than merging into a shared dirty change. Independent surfaces become siblings; dependent work becomes a short stack. A coordinator reviews and rebases changes, then advances a Git bookmark only after union verification.

## Trial exit criteria

Before making jj the repository-wide default, prove:

- Git promotion scripts still select the intended exported commit;
- subagent isolated work can return stable change IDs;
- concurrent workspace operations reconcile predictably;
- operation-log recovery works for an interrupted worker;
- sparse package builds can add dependencies without expanding to the full monorepo;
- cmux/session tooling does not assume Git branch checkout semantics.
