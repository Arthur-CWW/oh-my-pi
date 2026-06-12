# Jimeng/Dreamina Goal Command

Copy/paste this into Codex when restarting the long-running Jimeng/Dreamina workstream:

```txt
/goal Continue Jimeng/Dreamina client extraction from @docs/plans/jimeng-dreamina-cli-goal.md, @docs/plans/jimeng-fast-contract-extraction.md, @docs/provider/jimeng-api-triage.md, and @TASKS.md.

Build a typed `jimeng-browser-proxy`/client surface for the high-value UGC GenAI API families marked keep in the triage doc. Move fast by working in named value-ranked packets, not one endpoint at a time. The priority order is product value first, implementation speed second, and no-spend/ease only as a tie-breaker or safety gate. Prioritize generation parity, persona/voice, lip-sync/digital-human, reference controls, and template mining before supporting metadata reads.

Use the fast packet factory from @docs/plans/jimeng-fast-contract-extraction.md:
1. Pick the highest-value unfinished packet from triage coverage.
2. Create or refresh the packet manifest: 2-5 useful UGC examples, sample source, ignored `data/**` artifact root, infer command, promotion files, acceptance commands, and handoff.
3. Gather a bounded live/passive/replay sample matrix when approved.
4. Run or improve `contract-infer` to generate Effect Schema IR, service/client drafts, Effect CLI flag sketches, replay fixture drafts, Vitest snapshotable reports, endpoint-registry patches, and docs/QA skeletons from saved samples.
5. Promote the generated drafts in one coherent chunk; hand-tighten only relied-on paths, flags, redaction, error handling, and user-facing workflow semantics.
6. Prove with replay/cassette tests, typecheck, Vitest snapshots, registry coverage, and media artifacts only when the packet creates media.
7. Commit scoped files and leave exact next commands.

Use Effect services, Effect Schema, Effect CLI where practical, Vitest snapshots for contract/report outputs, and the shared cached HTTP transport with `live`/`record`/`replay`/`fixture` modes. Do not add one-off live-proof flags or hand-written assertion walls. If a repeated manual step appears, improve the generator or shared abstraction before continuing.

Do not start with broad static analysis, manual endpoint hunting, or isolated dry-run planners unless the selected packet has no usable samples or registry evidence. The packet manifest and generated contract output are the cross-session handoff; a future session should be able to resume from those files and the listed commands.

Paid generation, account mutation, unsafe credential reads, fresh capture, or visible UI interruption require explicit approval with the exact command/action list, useful examples, spend/risk, and proof artifact path. If approval is needed, ask; if not approved, keep doing adjacent safe prep inside that same packet. Do not detour into lower-value no-spend work just because it is easy. When live spend is approved, keep generation/mutation concurrency at 1, default to at most half the current remaining credits unless Arthur gives a different cap, record credit before/after, and stop on risk-control/auth/account drift.

Do not start the async daemon/job scheduler yet. Stop only when each high-value keep-family in @docs/provider/jimeng-api-triage.md is implemented through the typed client/CLI or classified in the endpoint registry/triage docs as blocked, skipped, or unknown with exact reason, evidence, and next probe.

Before final handoff, update @TASKS.md and the relevant docs with the packet result, proof command, and exact next command. Do not stage unrelated dirty files.
```
