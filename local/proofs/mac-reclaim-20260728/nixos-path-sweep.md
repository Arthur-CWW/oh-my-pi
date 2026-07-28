# NixOS path sweep receipt

## Branch and commits

- Base `nb/main`: `f12d995e115ed65694ba61ad43ff57a4f5e0a789`
- Required stacked spawn-worker fix: `25ee8f96cbc0b3ca1cf6b2039aa774311c4ac8d0`
- Path-sweep commits:
  - `36f16035d0ba9f48fb4301f0eed177dafb97bc6c`
  - `1066c88f6327812d386e9f412630bb472a525932`
  - `c8913b7fea37b1bd7717b18e935bf02fc75d487c`
- Pushed branch head `nb/changeset/nixos-path-sweep`: `25e753bdd7f48e7b85e92fcea8badaf21c698c02`

The changeset is stacked on the separately owned `wip/spawn-graduated-backpressure` branch so the new rule can remain exception-free outside `resource/ps-command.ts`. This lane did not edit `spawn-worker-client.ts`.

## NixOS verification

Host: `nixbox`. Final fresh clone: `/tmp/nixos-path-sweep-final2.2VLPN2`.

Setup followed the isolated test-state contract: fresh shared clone, copied the prescribed `vendor/oh-my-pi/node_modules`, generated the docs index, and set isolated `HOME`, `TMPDIR`, `OMP_CONFIG_ROOT`, and `OMP_SESSION_CONTROL_DB`.

Focused command covered:

- `test/resource/idle-reclaimer.test.ts`
- `test/resource/ps-command.test.ts`
- `test/resource/host-resource-sampler.test.ts` (real `ps` plus process-identity coverage)
- `test/fleet-resource-sampler.test.ts`

Result: **17 pass, 0 fail, 78 assertions across 4 files**.

Focused Biome check on the three touched source files and the new boundary test: **4 files checked, no fixes**.

The required coding-agent typecheck is blocked by an existing workspace dependency-resolution baseline outside coding-agent: both `nb/main` and this changeset report **60 diagnostics across the same 12 files**. Computed diagnostic-set diff: **branch-only 0; main-only 0**.

A direct NixOS production-boundary smoke also returned a positive process group id and a non-empty boot identity for the running Bun process.

## Mac lint proof

Clean-tree scan:

```text
bun run scripts/ast-grep.boundary.ts scan --config sgconfig.yml \
  --filter=no-absolute-spawn-tool-path-ts --report-style=medium \
  vendor/oh-my-pi/packages/coding-agent/src
```

Result: **exit 0, zero findings**.

Rule test:

```text
ast-grep test -c sgconfig.yml \
  --filter no-absolute-spawn-tool-path-ts --skip-snapshot-tests
```

Result: **1 rule passed, 0 failed; 6 cases**. Its three invalid cases deliberately cover `/bin/ps`, `/usr/sbin/sysctl`, and `/sbin/helper` inside `Bun.spawn`, `Bun.spawnSync`, and `spawn` `cmd` arrays.

A source search for quoted `/bin/ps` or `/usr/sbin/sysctl` literals under `packages/coding-agent/src` returned **no matches**. Absolute fallback candidates remain only inside `resource/ps-command.ts`, as required by the boundary exception.
