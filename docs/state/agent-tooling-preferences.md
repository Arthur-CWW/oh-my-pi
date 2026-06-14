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
- For React UI work, avoid unit tests that render owned components to raw HTML strings or snapshot full markup. Prefer pre-render state/view-model assertions, interaction/keyboard tests where behavior matters, and visual/browser QA for rendered layout. Use snapshots for stable normalized data/contracts, generated reports, or focused design-system variant outputs when they protect an intentional invariant.
- For UI/UX implementations, produce reviewer-saving proof artifacts after QA: a short recorded walkthrough video when practical, screenshots or visual diffs, and a concise report with commands and pass/fail findings. The artifact should show the changed workflow being exercised, not merely prove that a process exited.
- For API reversal, provider setup, integrations, and backend behavior, choose proof tests that demonstrate the actual accomplishment: live or dry-run contract tests as appropriate, snapshot/fixture tests, decoded boundary assertions, and saved outputs/logs that let Arthur or a reviewer verify the work quickly.
- For external APIs and provider JSON, validate runtime response shapes at the boundary with a permissive schema parser. Enforce the contract paths the pipeline relies on, allow additive extra fields, and record schema/proof artifacts so provider drift can be rerun and diagnosed later.
- For TypeScript API/client work, prefer Vitest snapshots for stable contract artifacts and generated reports. Use file snapshots for Markdown or large report output, object snapshots for normalized JSON contracts, and direct assertions for small branch behavior. `@effect/vitest` is useful for `it.effect` and Effect layers/scopes, but Vitest itself is the snapshot engine.
- For provider/API reversal, choose next work by user-visible workflow value first, implementation speed second, and no-spend/ease only as a tie-breaker or safety gate. If the highest-value step needs spend, mutation, visible UI, or capture approval, ask for approval with the exact command and proof plan instead of drifting into lower-value no-spend endpoints.
- For frontend API reversal, prefer a hybrid loop over pure static bundle reading: passive/background CDP capture for actual requests, `capture-analyze` or equivalent ranking for endpoint evidence, `discovery-worklist` or equivalent prioritization for the next small slice, structural/static search for request-builder semantics, explicit replay/probe for body variants, then a typed schema-backed command once the contract is stable.
- When a Python utility needs third-party libraries, run it through `uv` with explicit dependencies, for example `uv run --with pillow python ...`; do not call `python3` directly for ad hoc library-backed scripts.
- When installing missing local developer CLIs for agent work, prefer `mise` first so tools are user-level and reusable. Add repo dependencies only when the tool must be part of project CI or runtime reproducibility.

- For OMP subagents, prefer the Antigravity subscription lane for Gemini workers, not the raw Google Gemini API lane. In this repo, simple implementation and read-only packet review workers should use `google-antigravity/gemini-3.5-flash-low`; avoid bare `gemini-3.5-flash` because an inherited `GEMINI_API_KEY` / `GOOGLE_API_KEY` can silently route work onto paid Gemini API billing. For trickier bounded implementations or reviews, prefer GPT-5.5 `task` / `reviewer` subagents while subscription and rate limits allow. Keep the main GPT-5.5 process mainly as the orchestrator. Use latest Kimi only when explicitly selected or when Gemini/GPT fallback is unavailable.
- Generalize the Jimeng worker-packet pattern across workstreams: coordinator owns the task packet, exact owner paths, excluded paths, acceptance checks, and integration validation; workers avoid root manifests/configs and return proof commands rather than running project-wide gates.
- Treat speech-to-text variants like “Gming” or “Jming” as Jimeng/Dreamina context when the surrounding request is about provider/API/UGC generation work.
- For CLI work, prefer Effect APIs and Effect CLI for new command surfaces or substantial CLI refactors. Keep handwritten parsers only for tiny legacy surfaces or when converting them would distract from the requested change. Add lint guardrails for new custom parsers when practical.
- For external JSON/file/process/API data, use Effect Schema boundary decoders before data enters core code. Avoid raw `JSON.parse` in core implementation; if raw parsing is unavoidable at an IO edge, immediately decode and return typed data.
- For browser/UI verification, run headless/background first. Prefer CuaDriver for background visual/AX/browser flows that would otherwise steal focus; use CDP/Playwright/Puppeteer headless for DOM/network checks. Do not open foreground/visible browser automation while Arthur is using the machine unless he explicitly asks for it.


- For authenticated website debugging/reversal, start headless/background when possible, but switch quickly to a logged-in non-headless profile when state only settles in the real browser. Use CuaDriver for background UI state, headed CDP for DOM/network truth, save the winning request plus artifacts, then replay it directly to separate payload-parity bugs from provider denial.
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

The Jimeng/Dreamina workflow now has `jimeng-browser-proxy capture-analyze` and `jimeng-browser-proxy discovery-worklist` for this loop. After each meaningful `jimeng-network-recorder` capture, run `capture-analyze` first to rank endpoints, classify replay risk, summarize shapes, and emit local candidate JSON; then run `discovery-worklist` to merge analyzer/probe/static evidence into a prioritized next-slice queue before reading frontend bundles by hand.

### 2026-06-11

Arthur clarified that the Jimeng/Dreamina client is prototype infrastructure, so agents should optimize for a fast, clean architecture rather than compatibility-preserving micro-slices. Avoid proof ritual for backend refactors: passing tests, typecheck, schema fixtures, snapshots, and replayed cassettes are enough unless a live provider contract needs discovery or drift refresh.

For provider/API clients, prefer a shared HTTP transport with `live`, `record`, `replay`, and `fixture` modes over command-specific `--dryRun`/proof flags everywhere. Use dependency injection through Effect `Context`/`Layer` or a thin equivalent so tests swap HTTP/cache/clock/filesystem services directly.

For CLI work, prefer Effect CLI for new or substantially refactored surfaces instead of continuing to grow hand-written argument parsing. For large analyzer/inventory outputs, prefer structured endpoint registries plus snapshot/fixture tests over long inline string fixtures and assertion walls.

Arthur clarified that Vitest snapshots feel significantly better after the Jimeng endpoint-registry trial. For TypeScript provider/client packages, use Vitest snapshot tests from now on for generated Markdown, endpoint registry gaps, normalized response summaries, request plans, CLI summary output, and cassette metadata. Keep existing Bun tests where they are already concise or testing tiny behavior; convert verbose contract/report tests as they become painful.

Arthur clarified that "no-spend" should not be the primary work selector for Jimeng/Dreamina. It is a safety/proof constraint, not the priority function. The priority function is highest-value UGC API/workflow first, then speed/ease as a tie-breaker. When the valuable next step is paid or mutating, ask for explicit approval with concrete commands and expected artifacts.

### 2026-06-13

Arthur clarified the OMP model split: GPT-5.5 stays the parent/orchestrator; `gemini-3.5-flash` should be the default for simple non-core implementation workers and packet review; latest Kimi is the fallback only when Gemini is unavailable or rate-limited. Core abstractions and surfaces other work will build on should stay with GPT-5.5/main or a stronger implementation agent.

Arthur also clarified the tooling default for ongoing Jimeng work: prefer Effect APIs and Effect CLI for command surfaces, and keep browser/UI checks headless/background. Use CuaDriver when visual/browser automation needs to run in the background without disrupting his active desktop.

Broader lessons about decomposition, caching validated layers, and parallel agents live in `docs/state/agent-iteration-lessons.md`.

### 2026-06-13 follow-up

Arthur clarified that the Jimeng fast packet workflow should become the general repo workflow: packetized owner paths, exact validation, and coordinator-owned merge/QA. He also wants GPT-5.5 to be the fallback worker while subscription usage is acceptable, with Kimi demoted to explicit/unavailable fallback.

Arthur wants repo implementation SOPs to converge on Effect: Effect CLI for command surfaces, Effect Schema for external JSON and file/process/API boundaries, and AST lint rules to prevent new bespoke CLI parsers or unvalidated JSON parsing.

Arthur wants design and QA knowledge extracted into reusable agent skills/personas: a Refactoring UI-derived private design skill if the local PDF can be found and used, React static-analysis/design-review personas, and Effect AI docs distilled into implementation guidance.

Arthur is considering Git checkpoint discipline now and Jujutsu later for stacked agent work. He also wants less scattered timestamp-only Markdown metadata; evaluate a centralized SQLite/ledger approach before moving docs wholesale.

Arthur clarified that raw HTML string assertions and broad markup snapshots are the wrong default for owned React UI. They are appropriate for real HTML scraping/parsing boundaries, not for testing components we control. UI tests should target state before render, semantic behavior, and visual QA artifacts; snapshots belong to stable normalized contracts or narrow intentional component variants.
