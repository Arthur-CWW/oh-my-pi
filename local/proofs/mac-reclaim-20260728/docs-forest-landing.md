# Docs forest landing receipt — 2026-07-28

Branch: `changeset/docs-forest-landing`
Canonical remote: `nb` (`/home/arthur/agents.git`)
Scope: documentation only

## Source → destination

| Source ref | Source artifact | Destination | Curation |
|---|---|---|---|
| `review/cmux-interface-direction` (`8f50e8a2`) | `streams/harness/CMUX-INTERFACE-DIRECTION.md` | `docs/state/cmux-interface-direction.md` | Preserved interface thesis, review/navigation/control requirements, taste, and identity discipline. Removed the stale stacked nixbox config and transient workspace-number mapping; marked the former live-effort gap as resolved rather than current. |
| `review/deferred-ideas` (`516a0f3d`) | `streams/harness/DEFERRED-IDEAS.md` | `docs/state/deferred-harness-ideas.md` | Preserved the fork primitive, Hub grammar, and queryable-observability ideas with graduation gates. Deduplicated its stacked direction/profile predecessors. |
| `review/harness-reliability-plan` (`c5a4e526`) | `streams/harness/RELIABILITY-TESTING-PLAN.md` | `docs/fable/harness-reliability-program.md` | Preserved the hermetic testing program, cells, provider boundary, fault layer, review loop, phases, and exit criteria. Removed stale phase-status claims and machine measurements; linked authorities. |
| `review/nixbox-execution-profile` (`e2b30ab1`) | `.omp/nixbox-config.yml` | `docs/state/nixbox-execution-policy.md` | Serialized bounded/capability-derived admission intent as documentation. No active config, byte ceilings, machine sizes, auth setting, or stale skill paths were landed. |
| `review/validation-charter` (`d44307ae`) | `docs/learning/validation-charter.md` | `docs/fable/validation-charter.md` | Preserved the boundary/cell/oracle/fault/receipt ontology, cell ladder, validation philosophy, and portable practices. Deduplicated four stacked predecessor artifacts and refreshed obsolete tool/gap statements. |
| `review/overnight-state` (`ecbdcbed`) | `streams/harness/OVERNIGHT-STATE-2026-07-27.md` | mined into the five docs above | Snapshot was not landed wholesale. Durable decisions and their dispositions are listed below. |

All source commits were authored by `arthur <arthur@xoreax.net>`; the source documents identify the original lane as the harness stream (the overnight snapshot identifies the Fable majordomo/orchestrator).

## Deduplication

- [`docs/state/agents-topology.md`](../../../docs/state/agents-topology.md) remains authoritative for machine roles, canonical repo, workspace/storage layout, and the rule that repositories are not live-mounted across machines. The landed docs link it instead of restating today's topology.
- [`docs/research/dst-hegel-bombadil-verdict.md`](../../../docs/research/dst-hegel-bombadil-verdict.md) remains authoritative for the current DST/Hegel/Bombadil facts and adoption verdicts. The charter/program do not repeat package versions, runtime caveats, or verdict detail.
- [`docs/research/testing-talks/`](../../../docs/research/testing-talks/) remains the source archive for the Hashimoto and Minsky talks. The landed docs link the archive instead of recopying talk-derived arguments.
- The validation branch's stacked `omp-testing-strategy.md`, `kubernetes-rollout-patterns.md`, reliability plan, and nixbox profile were not duplicated. Existing learning docs stay linked; the latter two were curated once into their destinations above.
- The deferred-ideas branch's stacked cmux-direction and nixbox-profile blobs were not duplicated.
- Exact machine capacity was deliberately omitted. The nixbox wiki (`dotfiles/docs/agent-library/machines/nixbox.md`) is the sole current machine-fact authority.

## Overnight-state mining decisions

### Folded because still live

1. **Mac is control/review; nixbox executes heavy work** → reliability program and nixbox execution policy, with topology linked rather than copied.
2. **Every spawn declares model and effort** → cmux direction, reliability program, and validation charter. Transient model routing choices were not copied.
3. **Serialize durable context into the repo** → expressed by the dated provenance/authority boundaries on every landed document.
4. **One behavior per change/PR; adversarial review before merge** → reliability program and validation charter.
5. **Never narrow the Mac root checkout for a lane** → nixbox execution policy, reframed under the current rule that Mac is not a lane workspace.
6. **Addresses and hostnames are routes, not identity** → cmux direction and reliability runtime boundary.
7. **Fail closed / conservative degradation** → cmux direction, reliability provider contract, and validation charter.
8. **Resume and salvage durable work before respawn** → reliability program and validation charter.
9. **Review surfaces and evidence must be live and actionable** → cmux direction and reliability review loop.

### Dropped because stale, superseded, transient, or secret-operational

- The overnight `main` SHA, Mac-as-canonical statement, nixbox clone/workspace paths, and proof paths: superseded by `agents-topology.md` and current canonical `nb` policy.
- Exact guest CPU/memory, lane ceilings, and the historical `systemd-run` command: stale measurements and implementation snapshot; current facts belong to the wiki and current runner receipts.
- “Never `bun install` anywhere” and the Nix-closure dependency claim: tied to a closure approach explicitly killed on 2026-07-28, so not promoted into durable policy.
- Branch-by-branch PASS/REJECT/running queues, mixed jj change IDs, fix-lane names, and landed-fix highlights: dated operational status already resolved or triaged elsewhere, not durable doctrine.
- Credential-copy reminder: deliberate secret operation, inappropriate for a durable docs landing.
- Companion clip and Goal Mode morning queue: workstream status, not governance.
- The claim that running-child effort hot-swap was impossible: superseded by later landed implementation; retained only as the generator for the durable control-surface requirement.
- The old numbered cmux workspace map: host-local observation, not durable identity or policy.

## Verification

- Documentation-only changeset; no code or active configuration added.
- Repository has no docs/Markdown lint command, so no lint or tests were run, per assignment.
