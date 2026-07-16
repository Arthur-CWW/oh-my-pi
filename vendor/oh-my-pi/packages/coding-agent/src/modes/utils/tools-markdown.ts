import type { Tool } from "../../tools";
import type { ToolOrigin } from "../../tools/tool-origin";

type DisplayTool = Pick<Tool, "description" | "name"> & {
	readonly origin?: ToolOrigin;
};

export interface ToolsMarkdownBindings {
	tools: ReadonlyArray<DisplayTool>;
}

interface ToolRow {
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

function toolRow(tool: DisplayTool): ToolRow {
	const registeredBy = tool.origin?.registeredBy;
	return {
		name: tool.name,
		description: escapeTableCell(tool.description) || "No description provided.",
		kind: tool.origin?.kind ?? "unknown",
		source: escapeTableCell(tool.origin?.source ?? "unknown") || "unknown",
		registeredBy: registeredBy ? escapeTableCell(registeredBy) || "unknown" : undefined,
	};
}

function renderTable(tools: readonly ToolRow[]): string[] {
	return [
		"| Tool | Kind | Source | Description |",
		"|------|------|--------|-------------|",
		...tools.map(tool => `| \`${tool.name}\` | ${tool.kind} | ${tool.source} | ${tool.description} |`),
	];
}

function mcpServerName(source: string): string {
	const separator = source.indexOf(":");
	return separator > 0 ? source.slice(0, separator).trim() : source;
}

export function buildToolsMarkdown(bindings: ToolsMarkdownBindings): string {
	if (bindings.tools.length === 0) {
		return "No tools are registered.";
	}

	const rows = bindings.tools.map(toolRow);
	const otherTools = rows
		.filter(tool => tool.kind !== "mcp")
		.sort(
			(left, right) =>
				compareText(left.kind, right.kind) ||
				compareText(left.source, right.source) ||
				compareText(left.name, right.name),
		);
	const mcpGroups = new Map<string, ToolRow[]>();
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
