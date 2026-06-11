# Agent Iteration Lessons

Durable lessons about making Codex/agent work faster and less token-heavy.

## Current Lessons

- Decompose provider/API work into independently validated layers: transport/auth, request construction, schema decoding, command/UI surface, and docs. Once one layer is validated, cache or fixture it and move on instead of re-proving the full stack every time.
- Keep the iteration loop short. Prefer replayed cassettes, snapshots, and focused tests over repeated live calls, repeated proof bundles, or long manual verification rituals.
- Use live provider calls only when discovering a new contract, refreshing a cassette, or checking suspected provider drift. A passing replay test is enough for backend refactors that do not change the external contract.
- Avoid assertion walls and giant inline fixtures. Store structured fixtures or endpoint registries, then snapshot the normalized output that matters.
- Watch for context bloat as a real engineering problem. Long progress logs, dirty worktrees, duplicated docs, and manual endpoint lists slow down future agents.
- When the work can be split cleanly, use parallel agents for disjoint write scopes or independent investigations. Do not delegate the immediate blocking step if the main thread needs the result before it can continue.
- Optimize for working prototype architecture before backwards compatibility. Delete stale tests or code when they protect accidental behavior rather than useful behavior.
- Prefer “build the tool that makes the next 20 steps cheap” over repeating one-endpoint-at-a-time work when the pattern is clear.

## 2026-06-11 Jimeng/Dreamina Lesson

The Jimeng reversal loop became slow because proof, docs, static fixtures, and endpoint classification were all handled manually per endpoint. The better shape is a shared cached HTTP transport, Effect-style dependency injection, replayed fixtures/cassettes, snapshot tests for analyzer output, and a structured endpoint registry. This lets agents solve one layer once, cache it, and work on the next layer without spending tokens or provider calls re-validating earlier assumptions.
