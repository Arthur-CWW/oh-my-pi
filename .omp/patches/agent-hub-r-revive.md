# Agent Hub explicit parked revive

## Kind

OMP source overlay. Prefer upstream PR. Until then, maintain as a spec patch against the installed upstream OMP source.

## Target files

Current upstream OMP layout:

- `~/.bun/install/global/node_modules/@oh-my-pi/pi-coding-agent/src/modes/components/agent-hub.ts`
- `~/.bun/install/global/node_modules/@oh-my-pi/pi-coding-agent/src/modes/components/agent-transcript-viewer.ts`

The stale repo fork has an older monolithic implementation and tests that show the intended behavior:

- `oh-my-pi/packages/coding-agent/src/modes/components/agent-hub.ts`
- `oh-my-pi/packages/coding-agent/test/agent-hub-activate.test.ts`

## Behavior contract

Problem: opening a parked agent should not implicitly revive it. Reviving consumes resources and changes lifecycle state. Reading history should be safe and read-only.

Required behavior:

1. In the Agent Hub table, Enter on a live/running/idle row may focus the live agent session as upstream does.
2. In the Agent Hub table, Enter on a parked row must open the parked agent transcript/history read-only and must not call `focusAgent`, `ensureLive`, `remote.revive`, or otherwise change that agent's lifecycle state.
3. While viewing a parked agent transcript/history, uppercase `R` revives that parked agent explicitly.
4. The `R` key path must not focus the main view. It only revives and refreshes the transcript/view state.
5. The transcript footer or visible help must show `R:revive` only when the viewed agent is parked.
6. Submitting a non-empty message from the parked transcript may keep upstream behavior: revive the agent and send/steer the message.
7. Non-parked transcript views must not advertise or trigger `R:revive`.
8. Advisor/read-only transcript rows must remain read-only and must not be revivable.

## Verification

Manual/source checks:

- Search installed OMP source for `R:revive` or uppercase `keyData === "R"` handling in the Agent Hub transcript path.
- Confirm Enter on parked rows opens transcript/history without `ensureLive`.

Behavioral test shape:

- Register a parked subagent with a session file.
- Press Enter in Agent Hub table.
- Assert the agent remains `parked`, no focus callback is called, and the history view is visible with `R:revive`.
- Press `R` in that history view.
- Assert the lifecycle revive path is called and the agent becomes `idle`/live, without focusing the main view.
