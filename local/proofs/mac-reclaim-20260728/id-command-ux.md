# `:id` command UX receipt

Branch: `changeset/id-command-ux`
Tip: `0e2bc2300`
Remote: `nb/changeset/id-command-ux`

## Root cause

`CommandLineComponent.#submit()` closes/restores the colon palette before dispatching the selected command. The shared `showFeedback` route then rendered `:id` through `CommandOutputOverlayComponent`, whose `handleInput(_data)` dismissed that output on every keypress. Thus `viewLocal` correctly made the command available from focused-agent views, but selection used a transient generic output surface rather than an identity view; the next input immediately removed the only readable identity display.

## Changed files and symbols

- `src/modes/command-registry.ts`: the single `id` command retains `aliases: ["whoami"]` and now routes to `CommandModeContext.showIdentityPanel`.
- `src/modes/session-identity.ts`: `SessionIdentity` now carries authoritative hostname/project data; `formatSessionIdentity` assembles session id, agent IRC id, host/project, journal, binary, and copy confirmation.
- `src/modes/components/identity-panel.ts`: added `IdentityPanelState` (idempotent copy activation and Esc-only dismissal) and `IdentityPanelComponent` (persistent selectable terminal text).
- `src/modes/components/command-line.ts`: identity comes from the root `SessionManager`, focused/view agent id with canonical `MAIN_AGENT_ID`, `os.hostname()`, and `getProjectDir()`; the dedicated overlay restores prior focus only after explicit dismissal.
- `src/modes/components/status-line/segments.ts`: the default `pi` HUD segment includes the authoritative current IRC agent id at normal widths and preserves its old footprint below 40 columns.
- `test/command-mode.test.ts`: covers content assembly, alias convergence, one-copy activation, ordinary-key persistence, and Esc dismissal.
- `test/status-line-agent-id.test.ts`: covers Main, focused-child, and narrow-width HUD behavior.
- `CHANGELOG.md`: Unreleased fix entry.

## Focused verification

Nixbox isolated run used a fresh tmpdir for `HOME`, `TMPDIR`, `OMP_CONFIG_ROOT`, `OMP_SESSION_CONTROL_DB`, `OMP_IRC_DB`, and `IRC_EXTERNAL_BUS_DB`; it generated the docs index and collab tool views before testing.

```text
bun test test/command-mode.test.ts test/status-line-agent-id.test.ts
22 pass
0 fail
126 expect() calls
Ran 22 tests across 2 files. [2.23s]
```

Main comparison on the pre-change focused file:

```text
bun test test/command-mode.test.ts
18 pass
0 fail
112 expect() calls
Ran 18 tests across 1 file. [2.12s]
```

Failure-name diff versus main: empty (zero failures on both); the branch adds four passing tests.

Mac focused formatting and lint:

```text
bunx biome check src/modes/command-registry.ts src/modes/session-identity.ts src/modes/components/command-line.ts src/modes/components/identity-panel.ts src/modes/components/status-line/segments.ts test/command-mode.test.ts test/status-line-agent-id.test.ts
OK
```

Package `bun run check:types` remains red on unrelated pre-existing errors in `test/irc/content-safety.test.ts`, `test/replay/omp-replay-adapter.ts`, and `test/request-failure-presentation.test.ts`; it emitted no diagnostics for the touched files.

## HUD in five lines

1. At normal widths, the default left `pi` segment shows the π icon followed by the current IRC peer id (`Main`).
2. When a child is focused, the same surface shows the ghost icon and that focused child’s DM-ready IRC id.
3. The label uses `focusedAgentId`, the live session’s `getAgentId()`, and canonical `MAIN_AGENT_ID` rather than a parallel identity field.
4. Below 40 columns, Main returns to the prior icon-only footprint so the new label cannot cause a narrow-layout regression.
5. No new segment or preset priority was added, so existing status overflow and user customization behavior remain unchanged.
