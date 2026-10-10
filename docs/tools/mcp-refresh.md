# mcp_refresh

> Refresh the tool catalog of exactly one configured, connected MCP server.

## Source
- Entry: `packages/coding-agent/src/tools/mcp-refresh.ts` (`MCPRefreshTool`)
- Model-facing prompt: `packages/coding-agent/src/prompts/tools/mcp-refresh.md`
- Manager catalog refresh: `packages/coding-agent/src/mcp/manager.ts` (`MCPManager.refreshServerTools`)
- Session tool registry: `packages/coding-agent/src/session/session-tools.ts` (`SessionTools.refreshMCPTools`)
- Builtin names: `packages/coding-agent/src/tools/builtin-names.ts`

## Registration / Visibility
- Tool metadata: `name = "mcp_refresh"`, `approval = "write"`, `strict = true`, `loadMode = "discoverable"`.
- Native device mounting: under `tools.xdev` (default enabled), `mcp_refresh` is discoverable as `xd://mcp_refresh`. Writing JSON arguments to `xd://mcp_refresh` via the `write` tool dispatches the tool call. It may also be invoked directly as `mcp_refresh` when explicitly requested in tool lists.
- Execution is single-shot and emits no streaming progress updates.
- Availability requires an active session with an `MCPManager` and a session-bound `refreshMCPServerTools` callback. Disposed sessions or sessions without MCP management fail execution immediately.

## Inputs

| Field | Type | Required | Description |
|---|---|---:|---|
| `server` | `string` | Yes | Exact configured MCP server name to refresh without reconnecting (not an OMP tool name). |

Invocation via `write`:
```json
{
  "path": "xd://mcp_refresh",
  "content": "{\"server\": \"github\"}"
}
```

## Outputs
- Single-shot `AgentToolResult`: `content` contains one text block with JSON-serialized details, and `details` contains:
  - `server`: exact configured server name passed in the arguments.
  - `status`: `"refreshed"`.
  - `added`: sorted array of dispatched OMP MCP tool names added to the catalog.
  - `changed`: sorted array of dispatched OMP MCP tool names whose tool descriptors changed.
  - `removed`: sorted array of dispatched OMP MCP tool names removed from the catalog.
  - `visibility`: `"available_for_subsequent_tool_calls"`.

Descriptor changes include updates to parameters, JSON schemas, descriptions, or tool annotations, evaluated by deep structural equality (`Bun.deepEquals`, key order independent). Implementation-only changes on the MCP server where descriptors remain structurally identical cannot be inferred and do not populate `changed`.

## Flow
1. Schema validation validates `server` as a string parameter.
2. The tool verifies that the session is active (not disposed) and has a valid `MCPManager` and `refreshMCPServerTools` callback.
3. The tool verifies that `server` is a configured server (`manager.getServerConfig(server)`), that its transport is currently connected (`connection?.transport.connected`), and that the server advertises tools capability (`connection.capabilities.tools`). Disconnected, unconfigured, or tool-unsupported servers fail with a `ToolError`.
4. The tool snapshots the existing descriptor catalog before refresh, preserving full descriptor values including annotations.
5. The session's `refreshMCPServerTools(server)` is awaited through an abort-guarded wait (`untilAborted(signal, ...)`):
   - The MCP manager executes `tools/list` with `{ refresh: true }` over the existing transport without reconnecting or recreating the connection. The previous cached tool list remains untouched until the listing succeeds completely.
   - If `tools/list` throws, the manager preserves the existing cached tools and lets the raw error propagate, which the tool wraps into a `ToolError`.
   - The calling session's tool registry rebinds its active tools via serialized `session.refreshMCPTools(...)` so the caller's own registry mutation is settled before completion.
   - If the calling turn is cancelled/aborted, `untilAborted` stops the caller from waiting and raises `ToolAbortError`, while the shared manager refresh continues in the background and may still complete.
6. The tool verifies that the session did not dispose or change managers during the refresh, and that the server remained connected on the same connection.
7. Post-refresh descriptors are compared against the pre-refresh snapshot to calculate `added`, `changed`, and `removed` arrays using the dispatched OMP tool names.
8. The result is returned with `visibility: "available_for_subsequent_tool_calls"`.

## In-Flight Call Semantics & Isolation
- Running or pending tool calls dispatched prior to the refresh hold their captured contract and tool descriptor.
- Subsequent tool calls dispatched after the refresh completes see the updated descriptors and tool catalog.
- The refresh is scoped strictly to the single targeted MCP server. It does not touch other connected MCP servers or unrelated tool definitions.
- Scope limits:
  - No connection creation or server reconnection: disconnected or unavailable servers return an error.
  - No configuration modification: server configs and credentials are not re-read or altered.
  - No native-extension or arbitrary module hot reload: reloading plugins or refreshing MCP catalogs does not reimport or reload arbitrary native compiled extensions or JS/TS extension modules.
  - No arbitrary model calls or retries of failed tool actions.

## Errors
- Unconfigured server: `MCP server "<server>" is not configured.`
- Disconnected server: `MCP server "<server>" is disconnected; mcp_refresh does not reconnect servers.`
- Missing manager or callback: `MCP refresh is unavailable for this session: no MCP manager or refresh callback.`
- Disposed session: `MCP refresh is unavailable because this session is disposed.`
- Server does not support tools: `MCP server "<server>" does not support tools; its tool catalog cannot be refreshed.`
- Server failure during `tools/list`: `Failed to refresh MCP server "<server>": <error>`.
- Transport drop or reconnection during execution: `MCP server "<server>" disconnected or changed connections during refresh.`
- Session switch or disposal during execution: `MCP server "<server>" was not made visible because the calling session changed.`
