# Jimeng/Dreamina Goal Command

Copy/paste this into Codex when restarting the long-running Jimeng/Dreamina workstream:

```txt
/goal Continue Jimeng/Dreamina client extraction from @docs/plans/jimeng-dreamina-cli-goal.md and @TASKS.md.

Build a typed `jimeng-browser-proxy`/client surface for high-value UGC GenAI capabilities reachable from the logged-in Jimeng frontend. Move quickly: use Effect services, Effect Schema, Effect CLI where practical, and a cached HTTP transport with live/record/replay modes so tests run from fixtures instead of re-hitting the provider.

For backend/API refactors, proof is passing tests, typecheck, schema fixtures/snapshots, and replayed cassettes. Use live no-spend calls only to discover or refresh provider contracts, and record the result as a cassette/fixture; do not add one-off proof flags everywhere. Paid generation, account mutation, unsafe credential reads, or visible UI interruption still require explicit approval.

Do not start the async daemon/job scheduler yet. First converge the API client, transport, CLI shape, endpoint registry, and tests. Stop when every useful reachable frontend surface is either implemented through the typed client or classified in the registry as blocked/unknown with the reason and next probe.
```
