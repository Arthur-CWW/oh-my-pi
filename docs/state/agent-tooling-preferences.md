# Agent Tooling Preferences

Durable preferences for local automation, browser control, and computer-use tooling.

## Current Defaults

- When Arthur says “cooler driver”, “cuadriver”, or “C-U-A driver”, interpret it as CuaDriver / `cua-driver`.
- Prefer CuaDriver for local macOS GUI automation that should run in the background without stealing focus. This includes native apps, browser windows that need visual/AX interaction, Messages, Telegram, Preview, Figma, YouTube, and similar app surfaces.
- When Arthur is using the computer, automation must be background-first: do not foreground browser tabs, steal focus, move the active cursor/window, or use visible Computer Use unless Arthur explicitly asks for it.
- Treat CuaDriver as the maintained boundary for private macOS/SkyLight behavior. Do not reimplement or vendor those private APIs in this repo unless Arthur explicitly asks.
- Keep CDP, Playwright, and Puppeteer for what they are best at: DOM JavaScript, protocol events, network capture, cookies/session inspection, and provider-specific browser frontend adapters.
- For logged-in browser/API reversal work, prefer direct APIs, saved sessions, CDP network/DOM access, CuaDriver, and background browser-use flows over `bringToFront`, visible clicking, or foreground screenshots.
- Avoid reactive focus-restoration hacks as the primary solution. AeroSpace/PID guards can remain as seatbelts, but new automation should not depend on stealing focus and jumping back.
- Keep `TASKS.md` current during substantial repo work so agents can recover active, next, blocked, and done tasks without relying on conversation memory.
- For React UI work, when adding or materially changing UI tests, prefer adding snapshot tests alongside behavior tests when that gives useful regression coverage and encourages composable UI structure.
- For UI/UX implementations, produce reviewer-saving proof artifacts after QA: a short recorded walkthrough video when practical, screenshots or visual diffs, and a concise report with commands and pass/fail findings. The artifact should show the changed workflow being exercised, not merely prove that a process exited.
- For API reversal, provider setup, integrations, and backend behavior, choose proof tests that demonstrate the actual accomplishment: live or dry-run contract tests as appropriate, snapshot/fixture tests, decoded boundary assertions, and saved outputs/logs that let Arthur or a reviewer verify the work quickly.
- For external APIs and provider JSON, validate runtime response shapes at the boundary with a permissive schema parser. Enforce the contract paths the pipeline relies on, allow additive extra fields, and record schema/proof artifacts so provider drift can be rerun and diagnosed later.
- For frontend API reversal, prefer a hybrid loop over pure static bundle reading: passive/background CDP capture for actual requests, `capture-analyze` or equivalent ranking to produce a token-efficient worklist, structural/static search for request-builder semantics, explicit replay/probe for body variants, then a typed schema-backed command once the contract is stable.
- When a Python utility needs third-party libraries, run it through `uv` with explicit dependencies, for example `uv run --with pillow python ...`; do not call `python3` directly for ad hoc library-backed scripts.
- When installing missing local developer CLIs for agent work, prefer `mise` first so tools are user-level and reusable. Add repo dependencies only when the tool must be part of project CI or runtime reproducibility.

## Decision Log

### 2026-06-09

Arthur decided that background macOS/browser automation should default to CuaDriver rather than the older focus-restore window guard approach. Future agents should try CuaDriver first, especially when asked to automate apps like Messages or Telegram, and should only drop down to CDP/Playwright when the task actually needs browser protocol access.

Arthur also asked for top-level task tracking instead of relying on agents to remember all open threads. Use `TASKS.md` as the index. For React UI work, prefer UI snapshot testing when adding or changing UI tests.

Arthur clarified that proof of work should be planned as part of implementation, especially for UI/UX and integration work. UI changes should usually leave behind a visual QA report plus a video walkthrough artifact. API and provider work should leave behind tests, logs, snapshots, or saved outputs that directly prove the reversed/setup behavior works and reduce reviewer effort.

Arthur clarified that ad hoc Python scripts needing libraries should run via `uv run --with <package> python ...`, not direct `python3`.

### 2026-06-10

Arthur clarified during Jimeng/Dreamina API reversal that agents must not interrupt his active computer use. For browser/login flows, use background CDP, CuaDriver, browser-use, direct API calls, saved sessions, and passive network capture first. Do not call `bringToFront`, foreground tabs, or use visible UI automation unless he explicitly opts in.

Arthur clarified that missing developer CLI tooling should preferably be installed through `mise`. For example, use the existing mise-managed `ast-grep` CLI for structural bundle/code searches instead of adding `@ast-grep/cli` as a project dependency unless CI needs it.

Arthur clarified that API/provider integrations should use runtime schema validation, not just TypeScript interfaces or lint. The schema should be permissive about extra JSON fields but strict about the response paths the pipeline depends on, so future provider changes fail with clear contract-drift errors and can be rerun from saved proof commands.

Arthur clarified that API reverse engineering should be sped up with mixed dynamic/static tooling. Use CDP network truth, `ast-grep`/targeted bundle search, and explicit replay/probe tools together; avoid spending long stretches reading minified bundles when a captured request plus replay comparison can prove the contract faster.

The Jimeng/Dreamina workflow now has `jimeng-browser-proxy capture-analyze` for this loop. After each meaningful `jimeng-network-recorder` capture, run it first to rank endpoints, classify replay risk, summarize shapes, and emit local candidate JSON before reading frontend bundles by hand.
