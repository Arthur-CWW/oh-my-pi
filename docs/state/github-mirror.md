# GitHub mirror and pull-request flow

## Source of truth

`nb` (`/home/arthur/agents.git` on nixbox) remains the execution truth. Coordinators create and land changesets there with compare-and-swap ref updates. `Arthur-CWW/agents` is the review surface: it makes current landings browsable and gives Arthur a normal GitHub pull-request feedback loop. Do not use a GitHub ref to launch production work or overwrite `nb`.

The GitHub history was rebuilt with `git-filter-repo --strip-blobs-bigger-than 90M` because the canonical history contains old blobs GitHub will not accept. Commit messages and topology are preserved, but commits whose reachable objects changed have different SHAs. A GitHub SHA and an `nb` SHA can therefore describe the same landing. Compare trees or patches, not hash equality.

The filtered lineage is maintained in the dedicated bare clone at `/srv/data/agents/workspaces/gh-filter` on nixbox. Preserve that clone and its private `refs/gh-mirror/nb-main` marker. Its remotes are `nb=/home/arthur/agents.git` and `github=https://github.com/Arthur-CWW/agents.git`; GitHub HTTPS authentication is supplied by `gh auth setup-git`.

## Keep main synchronized

Run from an up-to-date checkout containing the script:

```bash
bun scripts/gh-mirror-sync.ts --dry-run
bun scripts/gh-mirror-sync.ts
```

The default mirror directory is `/srv/data/agents/workspaces/gh-filter`; override it with `--repo` or `GH_MIRROR_DIR`. The script fetches both mains, verifies every new blob is at most 90 MiB, replays new linear `nb` commits onto the filtered GitHub lineage, and pushes with a force-with-lease. `--dry-run` fetches and proves the range but does not change a branch, marker, or remote ref. It fails rather than guessing after a non-fast-forward `nb` move, a merge commit, an oversized blob, or divergent main trees.

## Pull request per changeset

1. Cut and validate a linear changeset branch from current `nb/main`, then publish it to `nb` through the normal coordinator/CAS path.
2. Synchronize main first: `bun scripts/gh-mirror-sync.ts`.
3. Replay the changeset onto the filtered base and publish its GitHub branch:

   ```bash
   bun scripts/gh-mirror-sync.ts --branch changeset/example --dry-run
   bun scripts/gh-mirror-sync.ts --branch changeset/example
   gh pr create --repo Arthur-CWW/agents --base main --head changeset/example
   ```

4. Arthur reviews the GitHub PR. Apply requested edits to the changeset and repeat step 3; the script updates the review branch with a force-with-lease.
5. Once approved, the coordinator runs `gh pr merge --squash`, then lands the exact reviewed content on `nb/main` with the normal CAS landing procedure. GitHub is the review/merge UX; `nb` becomes authoritative only when that content lands there.
6. Run the main sync again. If the GitHub squash and the `nb` landing have identical trees, the script advances its `nb` marker without creating a duplicate commit. Until the two main trees match, the script refuses to publish another changeset.

This ordering permits normal GitHub review without making GitHub the execution authority, while the tree-equality reconciliation keeps the two main tips content-identical despite unavoidable SHA divergence.
