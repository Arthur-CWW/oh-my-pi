> Rescued 2026-07-13 from /Users/arthur/.omp/agent/sessions/-agents/2026-07-04T06-00-08-576Z_019f2bb6-8080-7000-8a22-156408ea1a65/local/AskPresenceWire-report.md

# AskPresenceWire report

## Root cause
- `agent-session.ts` already publishes post-turn `waiting_input` from `#emit(agent_end)` through `#updateExternalIrcPeerState()`, and publishes `working` from `agent_start`.
- `ask.ts` blocks inside `askSingleQuestion()` (selector/editor paths) without any peer-state callback, so mid-turn ask waits kept the earlier `working` state until the turn ended.

## Changes (file:line)
- `vendor/oh-my-pi/packages/coding-agent/src/tools/index.ts:218`: added optional `ToolSession.beginIrcWaitingInput()` seam for tools that block on user input.
- `vendor/oh-my-pi/packages/coding-agent/src/session/agent-session.ts:1913`: added `beginExternalIrcWaitingInput()`, which publishes `waiting_input` via the existing `#updateExternalIrcPeerState()` path and returns an idempotent restore callback for the prior state.
- `vendor/oh-my-pi/packages/coding-agent/src/sdk.ts:1508`: wired the ToolSession seam to the live AgentSession implementation.
- `vendor/oh-my-pi/packages/coding-agent/src/tools/ask.ts:548`: wraps every `askSingleQuestion()` wait in `beginIrcWaitingInput()` / `finally restore`, so normal answer, cancel, timeout, and abort/error paths cannot leave the peer stuck in `waiting_input`.
- `vendor/oh-my-pi/packages/coding-agent/test/tools/ask.test.ts:76`: added targeted tests for presence publish/restore on successful ask and AbortError conversion path.
- `vendor/oh-my-pi/packages/coding-agent/CHANGELOG.md:7`: added Unreleased changelog entry.

## Verification
- Code-path inspection: `askQuestion()` calls `beginIrcWaitingInput()` immediately before awaiting `askSingleQuestion()` and restores in `finally`; AbortError is still converted to `ToolAbortError` before `finally` restores.
- Targeted tests were added but not run here because this subagent assignment forbids running tests/package commands; coordinator should run the narrow command below.

## Open risks
- Not locally executed by this subagent. Recommended parent validation: `bun --cwd=vendor/oh-my-pi/packages/coding-agent test test/tools/ask.test.ts`.
