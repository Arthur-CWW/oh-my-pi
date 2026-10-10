Refresh the tool catalog of exactly one already configured, connected MCP server.

`server` is the exact MCP server name from configuration, not an OMP tool name.
The operation fetches that server's latest tool descriptors over its existing connection and waits until the calling session can dispatch the refreshed tools on subsequent tool calls.

Success returns JSON with `server`, `status: "refreshed"`, `added`, `changed`, `removed`, and `visibility: "available_for_subsequent_tool_calls"`. Name arrays contain the dispatched OMP MCP tool names. `changed` means a descriptor changed (including schemas, descriptions, or annotations); implementation-only changes with stable descriptors are not detectable.

It does not connect or reconnect servers, change configuration, retry failed tool actions, or reimport native extensions. Unknown or disconnected servers, unsupported sessions, refresh failures, and connection changes during refresh are errors. Calls already executing or awaiting approval keep their captured dispatch contract.
