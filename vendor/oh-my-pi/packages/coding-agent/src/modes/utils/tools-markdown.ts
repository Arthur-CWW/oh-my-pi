import type { Tool } from "../../tools";
import type { ToolOrigin } from "../../tools/tool-origin";

export type DisplayTool = Pick<Tool, "description" | "name"> & {
	readonly origin?: ToolOrigin;
};

export interface ToolsMarkdownBindings {
	tools: ReadonlyArray<DisplayTool>;
}

export interface ToolDisplayRow {
	readonly name: string;
	readonly description: string;
	readonly kind: ToolOrigin["kind"] | "unknown";
	readonly source: string;
	readonly registeredBy: string | undefined;
}

function compareText(left: string, right: string): number {
	return left < right ? -1 : left > right ? 1 : 0;
}

function escapeTableCell(value: string): string {
	return value
		.replace(/\|/g, "\\|")
		.replace(/[\r\n]+/g, " ")
		.trim();
}

function escapeInlineCode(value: string): string {
	return value.replace(/`/g, "\\`");
}

function toolRow(tool: DisplayTool): ToolDisplayRow {
	const registeredBy = tool.origin?.registeredBy?.trim();
	return {
		name: tool.name,
		description: tool.description.trim() || "No description provided.",
		kind: tool.origin?.kind ?? "unknown",
		source: tool.origin?.source.trim() || "unknown",
		registeredBy: registeredBy || undefined,
	};
}

function renderTable(tools: readonly ToolDisplayRow[]): string[] {
	return [
		"| Tool | Kind | Source | Description |",
		"|------|------|--------|-------------|",
		...tools.map(
			tool =>
				`| \`${tool.name}\` | ${tool.kind} | ${escapeTableCell(tool.source)} | ${escapeTableCell(tool.description)} |`,
		),
	];
}

function mcpServerName(source: string): string {
	const separator = source.indexOf(":");
	return separator > 0 ? source.slice(0, separator).trim() : source;
}

/**
 * Project registered tools into the deterministic order shared by the TUI and
 * text renderers: non-MCP tools first, then MCP tools grouped by source.
 */
export function buildToolRows(tools: ReadonlyArray<DisplayTool>): ToolDisplayRow[] {
	const rows = tools.map(toolRow);
	const otherTools = rows
		.filter(tool => tool.kind !== "mcp")
		.sort(
			(left, right) =>
				compareText(left.kind, right.kind) ||
				compareText(left.source, right.source) ||
				compareText(left.name, right.name),
		);
	const mcpTools = rows
		.filter(tool => tool.kind === "mcp")
		.sort((left, right) => compareText(left.source, right.source) || compareText(left.name, right.name));
	return [...otherTools, ...mcpTools];
}

export function buildToolsMarkdown(bindings: ToolsMarkdownBindings): string {
	if (bindings.tools.length === 0) {
		return "No tools are registered.";
	}

	const rows = buildToolRows(bindings.tools);
	const otherTools = rows.filter(tool => tool.kind !== "mcp");
	const mcpGroups = new Map<string, ToolDisplayRow[]>();
	for (const tool of rows) {
		if (tool.kind !== "mcp") continue;
		const group = mcpGroups.get(tool.source);
		if (group) {
			group.push(tool);
		} else {
			mcpGroups.set(tool.source, [tool]);
		}
	}

	const output: string[] = [];
	if (otherTools.length > 0) {
		output.push("## Non-MCP tools", "", ...renderTable(otherTools));
	}

	const orderedMcpGroups = [...mcpGroups.entries()].sort(([left], [right]) => compareText(left, right));
	if (orderedMcpGroups.length > 0) {
		if (output.length > 0) output.push("");
		output.push("## MCP tools");
		for (const [source, tools] of orderedMcpGroups) {
			tools.sort((left, right) => compareText(left.name, right.name));
			const registeringConfigs = [...new Set(tools.map(tool => tool.registeredBy ?? "unknown"))].sort(compareText);
			output.push(
				"",
				`### ${escapeTableCell(mcpServerName(source))}`,
				"",
				`Command/source: \`${escapeInlineCode(source)}\`  `,
				`Registered by: ${registeringConfigs.map(config => `\`${escapeInlineCode(config)}\``).join(", ")}`,
				"",
				...renderTable(tools),
			);
		}
	}

	return output.join("\n");
}
