# Jimeng/Dreamina Goal Command

Copy/paste this into Codex when restarting the long-running Jimeng/Dreamina workstream:

```txt
/goal Continue Jimeng/Dreamina client extraction from @docs/plans/jimeng-dreamina-cli-goal.md, @docs/provider/jimeng-api-triage.md, and @TASKS.md.

Build a typed `jimeng-browser-proxy`/client surface for the high-value UGC GenAI API families marked keep in the triage doc, plus any newly discovered high-value frontend surface. Choose work by UGC product value first, implementation speed second, and no-spend/ease only as a tie-breaker or safety gate. The selection test is "which endpoint family unlocks or proves the most useful UGC workflow with examples," not "which safe endpoint is fastest." Do not pick the fastest no-spend W6 block while generation, persona/voice, lip-sync, reference-control, or template-mining work remains higher value. Move quickly: use Effect services, Effect Schema, Effect CLI where practical, and a shared cached HTTP transport with live/record/replay/fixture modes so tests run from fixtures/cassettes instead of repeatedly hitting the provider.

For backend/API refactors, proof is passing tests, typecheck, schema fixtures, Vitest snapshots, registry coverage, and replayed cassettes. Prefer Vitest file snapshots for generated Markdown or large reports, object snapshots for normalized JSON contracts, and direct assertions for small behavior branches. Test useful UGC workflow examples, not just endpoint existence. Use live no-spend calls only to discover or refresh provider contracts, and record the result as a cassette/fixture. Do not add one-off proof flags or per-command live-proof rituals.

Do not start the async daemon/job scheduler yet. First converge the API client, transport, CLI shape, endpoint registry, triage docs, and tests. Work in coherent chunks from the goal doc queue, not one endpoint at a time unless risk requires it. Prioritize generation parity, persona/voice, lip-sync/digital-human, reference controls, and template mining before supporting metadata reads. Paid generation, account mutation, unsafe credential reads, or visible UI interruption require explicit approval; ask with the exact planned command, expected useful examples, and expected proof artifact instead of silently switching to a lower-value no-spend endpoint. If approval is needed, do adjacent safe prep inside that same high-value family rather than detouring into unrelated cheap reads.

Stop when each high-value keep-family in @docs/provider/jimeng-api-triage.md is either implemented through the typed client/CLI or classified in the endpoint registry/triage docs as blocked, skipped, or unknown with exact reason, evidence, and next probe.
```
