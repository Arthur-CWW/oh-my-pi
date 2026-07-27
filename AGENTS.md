# AGENTS.md

## What this is

`vendor/oh-my-pi` is the local OMP fork. Default target is `packages/coding-agent/`, the CLI users call `omp`.

## Build and verify

```bash
bun run dev                         # run packages/coding-agent/src/cli.ts
bun run build                       # workspace builds with build scripts
bun run build:native                # packages/natives native build
bun run check                       # TS + Rust checks
bun run test                        # TS + Rust tests
bun run ci:test:smoke               # CLI/version/help/stats/smoke worker probe
bun run test:py                     # omp-rpc + robomp pytest in a temp venv
bun run generate-models             # regenerate packages/catalog/src/models.json
bun run release                     # version, changelog, tag, publish
```

Use the narrow package script when only one package changed: `bun --cwd=packages/<name> run <script>`.

## Package map

| Area | Path |
|---|---|
| CLI/TUI orchestration, tools, prompts, sessions | `packages/coding-agent/` |
| Agent runtime and tool calling | `packages/agent/` |
| Multi-provider LLM client | `packages/ai/` |
| Model catalog and provider descriptors | `packages/catalog/` |
| Terminal UI renderer | `packages/tui/` |
| Native text/image/grep bindings | `packages/natives/`, `crates/pi-natives/` |
| Shared utilities and streams | `packages/utils/` |
| Wire/shared protocol types | `packages/wire/` |
| Local stats dashboard | `packages/stats/` |
| Python RPC + robomp runner | `python/omp-rpc/`, `python/robomp/` |
| Release/build/test scripts | `scripts/` |

## Invariants

- Import catalog values from `@oh-my-pi/pi-catalog/<module>`, not `@oh-my-pi/pi-ai`; type-only imports of `Model`, `Api`, `ThinkingConfig`, `Effort`, etc. from `@oh-my-pi/pi-ai` are fine.
- Never use `ReturnType<>`; name the type.
- No inline imports: no `await import()`, no `import("pkg").Type`, no dynamic type imports. Use top-level imports.
- Check installed package types before guessing external APIs.
- Pure barrels use `export * from "./module"`; remove redundant export paths instead of keeping ambiguous named re-exports.
- Use ES `#private` fields. Do not add `private`/`protected`/`public` on fields or methods except TypeScript constructor parameter properties.
- Use `Promise.withResolvers()` instead of `new Promise((resolve, reject) => ...)`.
- Prompts live in static `.md` files with Handlebars for dynamic content. Import with `with { type: "text" }`; do not build prompts in code or read them with `readFile`.
- Prefer Bun APIs for file IO, shelling, sleep, hashing, SQLite, string width, wrapping, and JSONL/JSON5. Use `node:*` only where Bun lacks the API.
- Do not spawn shell commands for operations with direct APIs (`mkdir`, `which`, file reads/writes, etc.).
- Namespace-import `node:fs`, `node:fs/promises`, `node:path`, and `node:os`.
- In async code, avoid sync fs calls. For missing-file reads, try the read and gate with `isEnoent`; no existence-check race.
- Use centralized stream helpers (`readStream`, `readLines`) unless the protocol needs manual reader loops.
- Never edit `packages/catalog/src/models.json` directly; fix the resolver/descriptor/generator source, run `bun run generate-models`, and commit the regenerated JSON with the source change.
- In `packages/coding-agent`, never use `console.log`/`error`/`warn`; use `logger` from `@oh-my-pi/pi-utils`. Logs go to `~/.omp/logs/omp.YYYY-MM-DD.log`.
- Sanitize every TUI render path: tabs via `replaceTabs()`, width via `truncateToWidth()`/`ui.truncate()`, paths via `shortenPath()`, limits via `PREVIEW_LIMITS`/`TRUNCATE_LENGTHS`.
- Bash tool previews have live and rebuilt transcript paths; if preview-only fields change, update `event-controller.ts`, `ui-helpers.ts`, `tool-execution.ts`, and `ToolExecutionComponent.#buildRenderContext()` together.
- Worker scripts re-enter the CLI entrypoint. Add new worker selectors to `cli.ts`, keep `workerHostEntry()` fallback for non-CLI hosts, and validate with `bun run ci:test:smoke` or a sibling smoke for a different graph.
- Never run `tsc` or `npx tsc`; use the package `check` script.
- Tests prove externally observable contracts. No placeholder assertions, no `mock.module()`, no file-wide global mutations, no duplicate coverage across abstraction levels.
- Changelogs are per package at `packages/*/CHANGELOG.md`; add entries only under `## [Unreleased]`. Released sections are immutable.

## Orientation

| What | Where |
|---|---|
| Coding-agent internals | `packages/coding-agent/DEVELOPMENT.md`, `packages/coding-agent/src/` |
| TUI internals | `docs/tui.md`, `docs/tui-core-renderer.md`, `docs/tui-runtime-internals.md` |
| Tool docs and generated tool views | `docs/tools/`, `packages/collab-web/` |
| System prompts and customization | `docs/system-prompt-customization.md`, `packages/coding-agent/src/**/*.md` |
| Task agents and discovery | `docs/task-agent-discovery.md`, `.omp/skills/` |
| Python runner | `python/robomp/AGENTS.md`, `python/robomp/` |
| Rust workspace | `Cargo.toml`, `crates/` |
