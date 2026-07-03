# Jido note for Symphony Lite / control-plane-core

Source: <https://github.com/agentjido/jido> read 2026-06-23.

Jido is interesting, but it should be treated as an optional Elixir agent-pattern library to evaluate after the first OTP substrate spike proves our ledger/API boundary.

## What Jido appears to provide

- Elixir autonomous-agent framework built on GenServer/OTP.
- Agents as immutable data structures with `cmd/2` returning updated agent state plus directives.
- Explicit separation between agent decision logic, actions, signals, directives, and runtime-owned effects.
- OTP runtime integration: AgentServer, supervision, parent/child hierarchies, signal routing.
- Multi-agent orchestration, plugins, sensors, strategies, worker pools, scheduling, state ops, and persistence docs/specs.
- AI is optional; companion packages add LLM integration.

## Why it maps to our layering discussion

Jido formalizes a boundary we want anyway:

```txt
stateful agent decision -> directive/effect description -> runtime executes effect
```

That resembles our desired split:

```txt
coordination/control -> runner directive -> execution adapter -> ledger/event proof
```

## Why not adopt it as the first substrate

- It is a higher-level agent framework, while our first need is a boring durable control-plane core.
- We need a stable SQLite/JSON/API contract, local-file/TASKS.md task adapters, and Pi/OMP runner boundaries before adding a framework abstraction.
- OpenAI Symphony already supplies the closer reference for Codex app-server orchestration, Phoenix status surfaces, workspace lifecycle, and issue/task polling.
- Pulling in Jido now risks replacing one ontology debate with another before our ledger is proven.

## Evaluation slot

Evaluate Jido after the Elixir spike has:

1. persisted workflow/subagent/session/event rows;
2. exposed `status --json` or `/api/state`;
3. implemented local-file/TASKS.md task sources;
4. modeled dry-run, Pi RPC, OMP CLI, and Codex app-server runners behind the same contract.

Then compare whether Jido reduces boilerplate for actions/directives/signals without obscuring ledger writes or runner proof.
