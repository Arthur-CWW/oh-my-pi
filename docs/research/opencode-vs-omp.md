# OpenCode vs. Oh-My-Pi (OMP) — Evidence-backed comparison

> **Compared versions:** OpenCode at commit `a226767` (2026-07-04) · OMP v16.0.1 (2026-06-15)  
> **Sources:** OpenCode: GitHub permalinks to `anomalyco/opencode`; OMP: local paths under `vendor/oh-my-pi/`

---

## 1. Architecture — client/server split, headless/server mode, session model, multi-client attach

### OpenCode

OpenCode is a **client/server agent**. The `opencode serve` command starts a headless HTTP server on port 4096 (default) using an Effect-based router. The server exposes a REST + SSE + WebSocket API for sessions, messages, PTY, file system, and events [(serve.ts:14–23)](https://github.com/anomalyco/opencode/blob/a22676720d6108dc09b1dcfca1dcf02d505906dd/packages/opencode/src/cli/cmd/serve.ts#L14-L23). It loads project instances lazily per-request via the `x-opencode-directory` header, so a single server process can serve multiple projects concurrently.

The runtime server entry is `packages/opencode/src/server/server.ts` (Effect/HttpRouter), which is what `opencode serve` uses. A separate newer `packages/server` package also exists at `packages/server/src/routes.ts` with its own API. The server spans session CRUD, message prompt/stream, events (SSE), PTY, file-system access, and auth. Multiple frontends — TUI (`packages/tui`), SolidJS web app (`packages/app`), Electron desktop (`packages/desktop`), and an ACP (Agent Client Protocol) server over stdio — can **attach simultaneously** to the same server and session. The TUI connects via the `opencode attach <url>` command [(attach.ts:14–58)](https://github.com/anomalyco/opencode/blob/a22676720d6108dc09b1dcfca1dcf02d505906dd/packages/opencode/src/cli/cmd/attach.ts#L14-L58).

Sessions are durable SQLite-backed objects managed by `SessionV2` service in `packages/core`. The server is stateless aside from database connection; any TUI/web/desktop client that holds the session ID can resume work. Session isolation happens at the server layer via `x-opencode-directory`.

### OMP

OMP is a **single-process CLI** with four UI modes: interactive TUI, JSON-text print, RPC (JSONL over stdio), and ACP (Agent Client Protocol over stdio) [(cli/args.ts:69–78)](vendor/oh-my-pi/packages/coding-agent/src/cli/args.ts). There is **no long-lived HTTP server for the agent itself**. The `omp acp` command acts as an ACP server over stdio — a single editor (Zed / VS Code) attaches as one client. OMP has separate `serve` commands for its auth-broker and auth-gateway credential proxies, plus a local stats dashboard on port 3847, but these are auxiliary services.

The session model is **process-local**: an `AgentSession` wraps an append-only JSONL journal file managed by `SessionManager` [(session-manager.ts:1–45)](vendor/oh-my-pi/packages/coding-agent/src/session/session-manager.ts). There is no native multi-client attach — the ACP server handles one client, and the collab-web package [(collab-web/README.md)](vendor/oh-my-pi/packages/collab-web/README.md) provides a read-only browser view of a live session via WebSocket relay, but guests cannot prompt the agent directly.

**Verdict:** OpenCode has a true client/server split with multi-client attach, web/desktop UI, and server-side session durability. OMP is process-local with a richer TUI but limited to one interactive client at a time. For a headless L2 substrate, OpenCode's server model is directly adoptable; OMP would need a server wrapper around its RPC mode.

---

## 2. Multi-agent — subagent spawning, inter-agent messaging, orchestration primitives

### OpenCode

OpenCode supports subagents through the **Task tool** and the **AgentV2** definition system. Agents are configured with `mode: "subagent"` (e.g., `general`, `explore`) or `mode: "primary"` (`build`, `plan`) [(agent/agent.ts:24–37)](https://github.com/anomalyco/opencode/blob/a22676720d6108dc09b1dcfca1dcf02d505906dd/packages/opencode/src/agent/agent.ts#L24-L37). The primary agent can spawn subagents via the `task` tool, which creates a new **child session** with permission inheritance from the parent [(subagent-permissions.ts:12–36)](https://github.com/anomalyco/opencode/blob/a22676720d6108dc09b1dcfca1dcf02d505906dd/packages/opencode/src/agent/subagent-permissions.ts#L12-L36).

The TUI footer renders subagent tabs with status indicators and session navigation [(footer.subagent.tsx:10–28)](https://github.com/anomalyco/opencode/blob/a22676720d6108dc09b1dcfca1dcf02d505906dd/packages/app/src/components/footer.subagent.tsx#L10-L28). Users can cycle between parent and child sessions with keyboard shortcuts. Subagent output is displayed inline in the parent transcript.

Inter-agent messaging is **implicit** — subagents communicate results through structured tool output, and the parent agent can read child session transcripts. There is no explicit IRC-style bus between agents. Orchestration primitives are limited to spawn + await; there is no batch fan-out with concurrency limits, no detached background agents, and no structured-output schema validation on subagent yields.

### OMP

OMP has a richer subagent system. The `task` tool spawns subagents **in-process** via `TaskExecutor` [(task/executor.ts:1–36)](vendor/oh-my-pi/packages/coding-agent/src/task/executor.ts). Subagents are discovered from `.omp/agents/` (project), `~/.omp/agent/agents` (user), and bundled definitions, with first-wins dedup by name [(task-agent-discovery.md:44–78)](vendor/oh-my-pi/docs/task-agent-discovery.md).

**Inter-agent messaging** is first-class: agents communicate via an `EventBus` with dedicated channels for subagent events, progress updates, and lifecycle transitions [(executor.ts:42–58)](vendor/oh-my-pi/packages/coding-agent/src/task/executor.ts). An `AgentRegistry` maintains a live roster of all running agents with status, activity, and role-derived display names [(task/types.ts:18–62)](vendor/oh-my-pi/packages/coding-agent/src/task/types.ts).

Orchestration primitives include:
- **Batch fan-out** with configurable concurrency (`task.maxConcurrency`, `mapWithConcurrencyLimit`)
- **Detached (background) spawns** that don't block the parent turn
- **Structured output** with JSON Schema validation, a `yield` tool with retry budget, and `report_finding` aggregation
- **Filesystem isolation** per subagent (`worktree`, `fuse-overlay`, `projfs`) with patch or branch-based merge
- **Recursion-depth gating** (`task.maxRecursionDepth`) and per-agent spawn policies
- **Soft request budgets** with steering notices and graceful abort at 1.5× budget

**Verdict:** OMP's multi-agent system is substantially richer: in-process event bus for inter-agent messaging, batch fan-out with concurrency control, structured output validation, and filesystem isolation. OpenCode's model is simpler (child sessions, tabbed UI navigation) but lacks explicit inter-agent messaging and structured-output enforcement. OMP is the stronger foundation for agent orchestration.

---

## 3. Session durability — storage format, resume, forking/branching, sharing

### OpenCode

Sessions are stored in **SQLite** via Drizzle ORM. The schema includes tables `session`, `message`, `session_input` (inbox), `session_context_epoch`, `session_share`, and `session_baseline` [(session/sql.ts:3–48)](https://github.com/anomalyco/opencode/blob/a22676720d6108dc09b1dcfca1dcf02d505906dd/packages/core/src/session/sql.ts#L3-L48). Sessions are event-sourced: every message is an immutable row; the agent reconstructs context from the ordered message stream.

**Resume** is by session ID: `--continue` resumes the last session; `--session <id>` resumes a specific one. **Forking** is supported via `session.fork` from a user-chosen message — this creates a new session with messages up to the fork point [(dialog-fork.tsx:8–32)](https://github.com/anomalyco/opencode/blob/a22676720d6108dc09b1dcfca1dcf02d505906dd/packages/app/src/components/dialog-fork.tsx#L8-L32). Forking preserves the parent-child relationship via a `parent_id` column.

**Sharing** is built-in: `session.share` creates a `session_share` row with a share URL. Shared sessions are viewable by other users through the web UI — this is server-mediated sharing, not peer-to-peer.

**Branching within a session** is not supported. There is no tree-structured message history with a mutable leaf pointer — forking always creates a new session.

### OMP

Sessions are stored as **append-only JSONL files** with a tree structure. The file format: one `SessionHeader` line, then typed `SessionEntry` records linked by `(id, parentId)`. A mutable **leaf pointer** selects which path is active for future appends and LLM context construction [(session-manager.ts:61–113)](vendor/oh-my-pi/packages/coding-agent/src/session/session-manager.ts). Version: `CURRENT_SESSION_VERSION = 3`, with migration functions for v1→v2 and v2→v3.

Key durability properties:
- **Synchronous append**: entries survive software crash the instant `appendMessage()` returns (not power-loss safe).
- **Branching**: `branch(entryId)` moves the leaf pointer to any ancestor entry; subsequent appends form a new branch. `branchWithSummary()` records a summary of the abandoned path.
- **Forking**: `fork()` duplicates the session file and artifact directory with a new ID, preserving `parentSession` lineage [(session-manager.ts:731–767)](vendor/oh-my-pi/packages/coding-agent/src/session/session-manager.ts).
- **Branched export**: `createBranchedSession(leafId)` creates a new file containing only the path from root to `leafId`, carrying labels forward.
- **Artifacts**: per-session artifact directories with URL-based artifact resolution.
- **Blob store**: binary blobs externalized to a shared blob directory with inline references.

Session sharing uses a peer-to-peer model: the `collab-web` package streams entries through a WebSocket relay with AES-256-GCM encryption; guests see a live, read-only transcript [(collab-web/README.md:3–12)](vendor/oh-my-pi/packages/collab-web/README.md).

**Verdict:** OMP's session model is significantly more sophisticated: tree-structured JSONL with branching, forking, branched export, artifact management, and encrypted peer-to-peer sharing. OpenCode's SQLite model is simpler and server-centric with built-in sharing and fork-from-message. For an L2 substrate requiring transparent, directly tool-readable session files, OMP's JSONL format wins; for multi-user server scenarios, OpenCode's sharing model wins.

---

## 4. Telemetry / observability of model calls and errors

### OpenCode

OpenCode has **built-in OpenTelemetry** tracing and logging via the `Observability.layer` and `otlp.ts` [(observability.ts:1–22)](https://github.com/anomalyco/opencode/blob/a22676720d6108dc09b1dcfca1dcf02d505906dd/packages/core/src/observability.ts#L1-L22). The OTLP exporter [(otlp.ts:1–44)](https://github.com/anomalyco/opencode/blob/a22676720d6108dc09b1dcfca1dcf02d505906dd/packages/core/src/observability/otlp.ts#L1-L44) is configured via environment variables (`OTEL_EXPORTER_OTLP_ENDPOINT`, `OTEL_EXPORTER_OTLP_HEADERS`). Resource attributes include service name (`opencode`), version, run ID, and client. This means every model call, tool execution, and error is traced by default — no opt-in required.

The `packages/stats` infra provides aggregate usage statistics and a public stats dashboard. The `packages/http-recorder` captures HTTP requests for replay testing. Errors propagate through Effect's structured error types with tagged discriminators, so error telemetry includes typed error metadata.

Plugin hooks (`tool.execute.before`, `tool.execute.after`, `session.error`, `session.status`) offer additional observability injection points [(plugin/src/index.ts:40–122)](https://github.com/anomalyco/opencode/blob/a22676720d6108dc09b1dcfca1dcf02d505906dd/packages/plugin/src/index.ts#L40-L122).

### OMP

OMP has **opt-in OTLP trace export** via `telemetry-export.ts` — it activates only when `OTEL_EXPORTER_OTLP_ENDPOINT` is set [(telemetry-export.ts:1–26)](vendor/oh-my-pi/packages/coding-agent/src/telemetry-export.ts). The agent core crate emits OpenTelemetry GenAI semantic convention spans only if a global `TracerProvider` is registered. Without an external collector, there is no built-in trace or metrics pipeline.

OMP provides a **local stats dashboard** (`packages/stats`) — a Bun HTTP server on port 3847 serving a web UI with per-model cost, token, behavior, and timeseries views, plus recent request/error drill-down [(stats/src/server.ts:1–60)](vendor/oh-my-pi/packages/stats/src/server.ts). Data comes from a local SQLite DB (`~/.omp/stats.db`) that records every model call. Structured logs go to `~/.omp/logs/omp.YYYY-MM-DD.log`.

**Verdict:** OpenCode has integrated OpenTelemetry out of the box; every call is traced. OMP is opt-in and requires an external collector for traces. However, OMP's local stats dashboard is privacy-preserving and requires no infrastructure — a useful trade-off. For an L2 substrate, OpenCode's automatic tracing is the stronger default.

---
## 5. UI surfaces — TUI, web/HTML viewers, mobile, raw-request legibility

### OpenCode

OpenCode ships **five UI surfaces**:

| Surface | Technology | Path / Notes |
|---|---|---|
| **TUI** | SolidJS via opentui | `packages/tui` — terminal renderer with themes, keybindings, mouse, subagent tabs, PTY panel |
| **Web app** | SolidJS SPA | `packages/app` — full agent UI served by the server, with session management, fork dialog, settings |
| **Desktop** | Electron (wraps web app) | `packages/desktop` — native desktop app with tray, notifications, auto-start |
| **ACP** | stdio JSON-RPC | `packages/opencode/src/cli/cmd/acp.ts` — Agent Client Protocol for editor integration |
| **Stats dashboard** | Web (SST/Cloudflare) | Aggregated public stats from opt-in telemetry |

There is **no native mobile app**; the web app is responsive but not optimized for mobile. **Raw-request legibility** is limited — the `packages/http-recorder` captures HTTP traffic for testing, but there is no built-in "show me the raw provider request" viewer for users. The TUI can display tool-call arguments inline but not raw HTTP frames.

### OMP

OMP ships **three UI surfaces** plus debugging tools:

| Surface | Technology | Path / Notes |
|---|---|---|
| **TUI** | Custom terminal renderer | `packages/tui` + `coding-agent/src/tui` — differential rendering, component model, overlay system, cursor handing [(tui.md:1–30)](vendor/oh-my-pi/docs/tui.md) |
| **Collab web viewer** | React SPA | `packages/collab-web` — browser guest client with real-time transcript, tool-call cards, subagent panel |
| **HTML export** | Static HTML + React tool views | `coding-agent/src/export/html` — self-contained session export with embedded tool renderers |
| **Raw SSE debug viewer** | Terminal raw stream | `coding-agent/src/debug/raw-sse.ts` — shows **live provider SSE frames** (tokens, tool calls) as they arrive from the model |
| **LSP raw request** | Tool | `lsp` tool accepts `raw_request` for arbitrary LSP JSON-RPC calls |

The **raw SSE viewer** directly addresses the "show me the raw request" need — it renders streaming provider responses as raw frames, invaluable for debugging model behavior. The **HTML export** produces a standalone `session.html` with embedded CSS/JS, no server required. There is **no native mobile or desktop app**.

**Verdict:** OpenCode has more polished end-user surfaces (web, desktop, ACP). OMP has stronger debugging and export surfaces: raw SSE viewer for provider traffic, HTML session export, and collab web viewer. Neither has a real mobile app.

---

## 6. Extensibility — plugins/extensions, custom tools, code-first primitives, model routing/fallback

### OpenCode

OpenCode has a **V2 plugin system** (`@opencode-ai/plugin`) based on Effect schemas and hooks. Plugins can:
- Register **custom tools** with Zod schemas, descriptions, and execute handlers [(plugin/src/index.ts:85–122)](https://github.com/anomalyco/opencode/blob/a22676720d6108dc09b1dcfca1dcf02d505906dd/packages/plugin/src/index.ts#L85-L122)
- Intercept **chat requests** (`chat.params`, `chat.headers`, `chat.message`, `chat.model`)
- Hook into **tool execution** (`tool.execute.before`, `tool.execute.after`)
- Override **auth providers** and model catalog entries
- Hook **permission checks** (`permission.ask`)
- Register **TUI commands** and **workspace adapters**

The V2 API uses Effect-based transforms and hooks [(plugin/src/v2/)](https://github.com/anomalyco/opencode/blob/a22676720d6108dc09b1dcfca1dcf02d505906dd/packages/plugin/src/v2/). MCP (Model Context Protocol) is supported both as client (connect to MCP servers) and server (expose tools via MCP). Custom agents can be defined in `.opencode/agents/` as markdown with YAML frontmatter.

**Code-first primitives:** Plugins can inject behavior at well-defined hook points, but agents cannot **script the harness at runtime** — there is no tool that lets an agent register a new tool, change the model mid-turn, or reconfigure permissions programmatically. Model routing is done via the `Provider` service and session-level `model` override; there is **no automatic fallback chain** on provider errors (retry is per-request, not per-model).

### OMP

OMP has a **deeper extensibility model** via the TypeScript extension runner [(runner.ts:1–78)](vendor/oh-my-pi/packages/coding-agent/src/extensibility/extensions/runner.ts). Extensions can:
- Register **custom tools** as TypeScript modules in `.omp/tools/`, with full access to the `pi` API (session manager, settings, auth storage, tool calling, event bus) [(custom-tools/types.ts:1–42)](vendor/oh-my-pi/packages/coding-agent/src/extensibility/custom-tools/types.ts)
- Hook into **20+ lifecycle events**: `before_provider_request`, `after_provider_response`, `tool_call`, `tool_result`, `session_before_switch`, `session_start`, `before_agent_start`, `turn_end`, `todo_reminder`, etc.
- Register **slash commands** and **keybindings**
- **Script the harness at runtime**: `ExtensionActions` include `setModel()`, `setActiveTools()`, `sendMessage()`, `appendEntry()`, `setSessionName()`, `setStatus()` [(types.ts:86–130)](vendor/oh-my-pi/packages/coding-agent/src/extensibility/extensions/types.ts)

**Model routing/fallback:** OMP has a `ModelRegistry` with role-based routing (`default`, `smol`, `slow`, `plan`, `commit`) and **fallback chains** (`retry.fallbackChains`). When the primary model throws 429s or hits quota, the next entry in the chain takes over for the rest of the turn, with automatic cooldown and restoration [(model-resolver.ts:1–50)](vendor/oh-my-pi/packages/coding-agent/src/config/model-resolver.ts). Providers can be overridden per role and per project path.

MCP is supported via `capability/mcp.ts`. Cross-harness config import (Claude, Codex, Cursor, Gemini, Copilot) happens automatically — OMP reads their config formats natively.

**Verdict:** OMP has stronger code-first primitives — extensions can call back into the harness to change model, tools, or session state at runtime. OpenCode's plugin API is cleaner (Effect-based transforms) but less powerful at runtime. OMP's model fallback chains are a significant feature OpenCode lacks. For an L2 substrate where agents need to reconfigure the harness, OMP wins.

---

## 7. Provenance — commit ↔ session tying

### OpenCode

OpenCode has **no direct commit↔session provenance**. Sessions have a `parent_id` for fork lineage, and the server can capture a git changeset patch when moving a session between directories, but there is no stored `git_commit` or `baseline_sha` in the session schema [(session/sql.ts:3–48)](https://github.com/anomalyco/opencode/blob/a22676720d6108dc09b1dcfca1dcf02d505906dd/packages/core/src/session/sql.ts#L3-L48). The `session_baseline` table tracks context epochs but not git state. An external integration could add this via a plugin, but it is not built in.

### OMP

OMP has **explicit commit↔session provenance** in its autoresearch workflow. The `init-experiment` tool auto-commits the harness to git and records a `baselineCommit` in the session state [(autoresearch/state.ts)](vendor/oh-my-pi/packages/coding-agent/src/autoresearch/state.ts). The `log-experiment` tool records `commit_hash` for each experiment run. Session headers carry a `parentSession` field for fork lineage. Additionally, the session `cwd` is stored in the header, and terminal breadcrumbs (`terminal-sessions/<tty-id>`) track per-terminal session continuity.

Outside the autoresearch flow, OMP does not automatically tie every session to a git commit — but the infrastructure for doing so (session header fields, breadcrumb system) exists and could be extended.

**Verdict:** OMP has explicit commit↔session provenance for research workflows; OpenCode has none. For an L2 substrate that needs to reproduce which code state produced which agent output, OMP's baseline-commit tracking is directly useful.

---

## 8. License, governance, and maintenance velocity

### OpenCode

- **License:** MIT [(LICENSE)](https://github.com/anomalyco/opencode/blob/a22676720d6108dc09b1dcfca1dcf02d505906dd/LICENSE)
- **Governance:** Company-backed by Anomaly (formerly SST). The repo moved from `sst/opencode` to `anomalyco/opencode`. Core team listed in `.github/TEAM_MEMBERS`. PRs require linked issues; UI changes undergo design review.
- **Maintenance velocity:** Very high. The repo has 182k+ stars, 22k+ forks, 5k+ open issues. CI/CD includes `publish.yml`, `test.yml`, `typecheck.yml`, `deploy.yml`. Last commit at time of snapshot: 2026-07-04. Version in `package.json`: `1.17.13` (frequent releases). Multiple packages published to npm: `opencode-ai`, `@opencode-ai/plugin`, `@opencode-ai/sdk`, `@opencode-ai/core`, etc.

### OMP

- **License:** MIT [(LICENSE)](vendor/oh-my-pi/LICENSE)
- **Governance:** Individual maintainer (Can Bölük), fork of Pi by Mario Zechner. Single-committer model visible in changelog entries (~all authored by one person). No formal governance structure.
- **Maintenance velocity:** Very high. Version `16.0.1` at time of snapshot, with a 12,000-line `CHANGELOG.md` documenting rapid iteration [(CHANGELOG.md:1–30)](vendor/oh-my-pi/packages/coding-agent/CHANGELOG.md). Multiple releases per week. Packages published to npm: `@oh-my-pi/pi-coding-agent`, `@oh-my-pi/pi-catalog`, `@oh-my-pi/pi-tui`, etc. ~55k lines of Rust in native crates.

**Verdict:** Both are MIT-licensed and actively maintained at high velocity. OpenCode has corporate backing and a broader contributor base; OMP has a single maintainer but ships features at a comparable or faster pace. Governance risk is higher for OMP (bus factor), but the code is simpler to fork.

---

## Executive Summary

1. **What OpenCode would give us for free:** A true client/server architecture with multi-client attach (TUI + web + desktop + ACP all connected to one server); built-in OpenTelemetry tracing on every model call; a polished SolidJS web UI and Electron desktop app; server-mediated session sharing with share URLs; and a plugin ecosystem with npm distribution.

2. **What OMP has that OpenCode lacks:** Tree-structured session branching with mutable leaf pointer (you can branch/rewind/fork within a single journal file); in-process inter-agent messaging via EventBus and AgentRegistry; structured output with JSON Schema validation and yield/retry budget; model fallback chains with automatic provider rotation on errors; a raw SSE provider-stream debug viewer; code-first harness scripting (extensions can call `setModel()`, `setActiveTools()`, `sendMessage()` at runtime); and explicit commit↔session provenance for research workflows.

3. **Adoptable OpenCode components for our L2 substrate:** The `packages/server` HTTP/SSE server layer with Effect-based routing, session V2 SQL schema, and PTY/file-system handlers could be adopted piecemeal as the headless serving layer. The `packages/plugin` V2 hook/transform API is clean and could be adapted to our extension model. The `packages/client` SDK provides a typed client for embedding. The `packages/core/src/observability` OTLP layer is directly reusable for automatic tracing. However, OpenCode's subagent model, session branching, and model fallback are weaker than OMP's — those pieces should come from OMP or be built custom.
