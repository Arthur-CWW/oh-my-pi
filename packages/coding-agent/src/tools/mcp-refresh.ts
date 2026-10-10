import { type } from "@oh-my-pi/omptype";
import type { AgentTool, AgentToolResult } from "@oh-my-pi/pi-agent-core";
import { ToolError } from "@oh-my-pi/pi-tui/tools/tool-errors";
import { untilAborted } from "@oh-my-pi/pi-utils";
import type { MCPManager, MCPToolDefinition } from "../mcp";
import { deduplicateMCPToolsByName } from "../mcp/tool-bridge";
import mcpRefreshDescription from "../prompts/tools/mcp-refresh.md" with { type: "text" };
import type { ToolSession } from ".";
import { renderError, throwIfAborted, ToolAbortError } from "./tool-errors";

const mcpRefreshSchema = type({
	server: type("string").describe("Exact configured MCP server name to refresh without reconnecting"),
});

export type MCPRefreshParams = typeof mcpRefreshSchema.infer;

export interface MCPRefreshToolDetails {
	server: string;
	status: "refreshed";
	added: string[];
	changed: string[];
	removed: string[];
	visibility: "available_for_subsequent_tool_calls";
}

/** Match the raw descriptors to the same normalized names the dispatch catalog uses. */
function serverCatalog(
	manager: MCPManager,
	server: string,
	descriptors: readonly MCPToolDefinition[],
): Map<string, MCPToolDefinition> {
	const descriptorsByName = new Map(descriptors.map(descriptor => [descriptor.name, descriptor]));
	const catalog = new Map<string, MCPToolDefinition>();
	for (const tool of deduplicateMCPToolsByName(manager.getTools())) {
		if (tool.mcpServerName !== server || typeof tool.mcpToolName !== "string") continue;
		const descriptor = descriptorsByName.get(tool.mcpToolName);
		if (!descriptor) {
			throw new ToolError(`MCP server "${server}" has no available descriptor snapshot for tool "${tool.name}".`);
		}
		catalog.set(tool.name, descriptor);
	}
	return catalog;
}

/** Refreshes the catalog of one existing connection, never its connection or configuration. */
export class MCPRefreshTool implements AgentTool<typeof mcpRefreshSchema, MCPRefreshToolDetails> {
	readonly name = "mcp_refresh";
	readonly approval = "write" as const;
	readonly label = "Refresh MCP Tools";
	readonly description = mcpRefreshDescription;
	readonly parameters = mcpRefreshSchema;
	readonly strict = true;
	readonly loadMode = "discoverable" as const;
	readonly summary = "Refresh one connected MCP server's tools for subsequent calls";

	constructor(private readonly session: ToolSession) {}

	async execute(
		_id: string,
		params: MCPRefreshParams,
		signal?: AbortSignal,
	): Promise<AgentToolResult<MCPRefreshToolDetails>> {
		throwIfAborted(signal);
		const manager = this.session.mcpManager;
		const refresh = this.session.refreshMCPServerTools;
		if (!manager || !refresh) {
			throw new ToolError("MCP refresh is unavailable for this session: no MCP manager or refresh callback.");
		}
		if (this.session.isDisposed?.()) {
			throw new ToolError("MCP refresh is unavailable because this session is disposed.");
		}
		if (!manager.getServerConfig(params.server)) {
			throw new ToolError(`MCP server "${params.server}" is not configured.`);
		}
		const connection = manager.getConnection(params.server);
		if (!connection?.transport.connected) {
			throw new ToolError(`MCP server "${params.server}" is disconnected; mcp_refresh does not reconnect servers.`);
		}
		if (!connection.capabilities.tools) {
			throw new ToolError(
				`MCP server "${params.server}" does not support tools; its tool catalog cannot be refreshed.`,
			);
		}
		// Manager refresh replaces the cache; retain descriptor values, including
		// annotations that do not survive conversion into the agent tool schema.
		const before = serverCatalog(manager, params.server, structuredClone(connection.tools ?? []));
		try {
			await untilAborted(signal, () => refresh(params.server));
		} catch (error) {
			if (error instanceof ToolError || error instanceof ToolAbortError) throw error;
			throwIfAborted(signal);
			throw new ToolError(`Failed to refresh MCP server "${params.server}": ${renderError(error)}`);
		}
		throwIfAborted(signal);
		if (this.session.isDisposed?.() || this.session.mcpManager !== manager) {
			throw new ToolError(`MCP server "${params.server}" was not made visible because the calling session changed.`);
		}
		if (manager.getConnection(params.server) !== connection || !connection.transport.connected) {
			throw new ToolError(`MCP server "${params.server}" disconnected or changed connections during refresh.`);
		}
		const after = serverCatalog(manager, params.server, connection.tools ?? []);
		const details: MCPRefreshToolDetails = {
			server: params.server,
			status: "refreshed",
			added: [],
			changed: [],
			removed: [],
			visibility: "available_for_subsequent_tool_calls",
		};
		for (const [name, descriptor] of after) {
			if (!before.has(name)) details.added.push(name);
			else if (!Bun.deepEquals(before.get(name), descriptor)) details.changed.push(name);
		}
		for (const name of before.keys()) {
			if (!after.has(name)) details.removed.push(name);
		}
		details.added.sort();
		details.changed.sort();
		details.removed.sort();
		return {
			content: [{ type: "text", text: JSON.stringify(details) }],
			details,
		};
	}
}
