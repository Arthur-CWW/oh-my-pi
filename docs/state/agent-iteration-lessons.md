# Agent Iteration Lessons

Durable lessons about making Codex/agent work faster and less token-heavy.

## Current Lessons

- Decompose provider/API work into independently validated layers: transport/auth, request construction, schema decoding, command/UI surface, and docs. Once one layer is validated, cache or fixture it and move on instead of re-proving the full stack every time.
- Keep the iteration loop short. Prefer replayed cassettes, snapshots, and focused tests over repeated live calls, repeated proof bundles, or long manual verification rituals.
- Use live provider calls only when discovering a new contract, refreshing a cassette, or checking suspected provider drift. A passing replay test is enough for backend refactors that do not change the external contract.
- Avoid assertion walls and giant inline fixtures. Store structured fixtures or endpoint registries, then snapshot the normalized output that matters.
- For TypeScript provider/client work, prefer Vitest snapshots for contract-shaped outputs: endpoint registries, generated Markdown, normalized request/response summaries, CLI summaries, analyzer/worklist reports, cassette metadata, and schema drift fixtures. Use file snapshots for generated Markdown or large reports, and object snapshots for normalized JSON contracts.
- Watch for context bloat as a real engineering problem. Long progress logs, dirty worktrees, duplicated docs, and manual endpoint lists slow down future agents.
- When the work can be split cleanly, use parallel agents for disjoint write scopes or independent investigations. Do not delegate the immediate blocking step if the main thread needs the result before it can continue.
- Optimize for working prototype architecture before backwards compatibility. Delete stale tests or code when they protect accidental behavior rather than useful behavior.
- Prefer “build the tool that makes the next 20 steps cheap” over repeating one-endpoint-at-a-time work when the pattern is clear.
- Prioritize by workflow value first. For provider/API reversal, do not choose low-value no-spend work just because it is easy; rank by the user-visible pipeline capability unlocked, then use speed/no-spend as tie-breakers or safety gates. The acceptance test should include representative examples for workflows the product would actually run, not just endpoint existence.
- When provider spend/capture is approved and bounded, prefer a small real matrix of useful examples over more manual dry-run planners. Save raw/normalized JSON, commands, media artifacts, and credit deltas; infer schemas/scaffolds from those samples; then replay tests from fixtures.

## 2026-06-11 Jimeng/Dreamina Lesson

The Jimeng reversal loop became slow because proof, docs, static fixtures, and endpoint classification were all handled manually per endpoint. The better shape is a shared cached HTTP transport, Effect-style dependency injection, replayed fixtures/cassettes, Vitest snapshots for normalized contract/report output, and a structured endpoint registry. This lets agents solve one layer once, cache it, and work on the next layer without spending tokens or provider calls re-validating earlier assumptions.

The small Jimeng registry trial showed that Vitest file snapshots are materially cleaner than hand-rolled string/assertion tests for generated Markdown and large normalized contract objects. For future TypeScript API-reversal work, default to Vitest snapshots when the output is a stable contract artifact; keep direct assertions for small parser branches and narrow behavior checks.

Arthur clarified that the Jimeng/Dreamina queue should not be sorted by no-spend availability. Sort by highest UGC workflow value first: generation parity, persona/voice, lip-sync, reference controls, and template mining. If the highest-value next step requires spend, account mutation, visible UI, or capture approval, ask for approval with a concrete command/proof plan instead of falling back to a lower-value safe endpoint.

After the 2026-06-12 live generation matrix, the preferred Jimeng implementation loop is: bounded matrix or passive capture, contract inference from saved JSON/artifacts, generated Effect Schema/client/CLI/test/registry drafts, then manual tightening and Vitest replay snapshots. Dry-run planners are useful as compare gates or blocked-flow fallbacks, but they should not be the default work unit when real samples can make the next layer faster.
