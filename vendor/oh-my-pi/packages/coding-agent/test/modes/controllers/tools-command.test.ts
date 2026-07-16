import { describe, expect, it, vi } from "bun:test";
import { CommandController } from "@oh-my-pi/pi-coding-agent/modes/controllers/command-controller";
import type { InteractiveModeContext } from "@oh-my-pi/pi-coding-agent/modes/types";
import { buildToolsMarkdown } from "@oh-my-pi/pi-coding-agent/modes/utils/tools-markdown";

describe("buildToolsMarkdown", () => {
	it("groups MCP tools by server source and renders deterministic provenance rows", () => {
		const markdown = buildToolsMarkdown({
			tools: [
				{
					name: "mcp_write",
					description: "Write a file",
					origin: {
						kind: "mcp",
						source: "filesystem: npx -y @modelcontextprotocol/server-filesystem /workspace",
						registeredBy: "/home/user/.omp/mcp.json",
					},
				},
				{
					name: "extension_tool",
					description: "First line\nsecond line | safely escaped",
					origin: { kind: "extension", source: "/workspace/extensions/sample.ts" },
				},
				{
					name: "read",
					description: "Read files",
					origin: { kind: "builtin", source: "coding-agent" },
				},
				{
					name: "mcp_read",
					description: "Read a file",
					origin: {
						kind: "mcp",
						source: "filesystem: npx -y @modelcontextprotocol/server-filesystem /workspace",
						registeredBy: "/home/user/.omp/mcp.json",
					},
				},
				{ name: "legacy_tool", description: "No origin yet" },
			],
		});

		expect(markdown).toContain("| `read` | builtin | coding-agent | Read files |");
		expect(markdown).toContain(
			"| `extension_tool` | extension | /workspace/extensions/sample.ts | First line second line \\| safely escaped |",
		);
		expect(markdown).toContain("| `legacy_tool` | unknown | unknown | No origin yet |");
		expect(markdown.match(/^### filesystem$/gm)).toHaveLength(1);
		expect(markdown).toContain(
			"Command/source: `filesystem: npx -y @modelcontextprotocol/server-filesystem /workspace`",
		);
		expect(markdown).toContain("Registered by: `/home/user/.omp/mcp.json`");
		expect(markdown.indexOf("`mcp_read`")).toBeLessThan(markdown.indexOf("`mcp_write`"));
	});
});

describe("CommandController.handleToolsCommand", () => {
	it("renders every registered tool through the shared output callback", () => {
		const registry: Record<string, { name: string; description: string; origin: { kind: string; source: string } }> =
			{
				read: { name: "read", description: "Read files", origin: { kind: "builtin", source: "coding-agent" } },
				inactive_extension: {
					name: "inactive_extension",
					description: "Only registered, not active",
					origin: { kind: "extension", source: "/workspace/extensions/inactive.ts" },
				},
			};
		const getAllToolNames = vi.fn(() => ["read", "inactive_extension"]);
		const getToolByName = vi.fn((name: string) => registry[name]);
		const agent = {} as { state?: unknown };
		Object.defineProperty(agent, "state", {
			get() {
				throw new Error("active tool state must not be read");
			},
		});
		const showOutput = vi.fn();
		const ctx = {
			session: { agent, getAllToolNames, getToolByName },
		} as unknown as InteractiveModeContext;

		new CommandController(ctx).handleToolsCommand(showOutput);

		expect(getAllToolNames).toHaveBeenCalledTimes(1);
		expect(getToolByName.mock.calls.map(([name]) => name)).toEqual(["read", "inactive_extension"]);
		expect(showOutput).toHaveBeenCalledTimes(1);
		expect(showOutput.mock.calls[0]?.[0]).toContain("inactive_extension");
		expect(showOutput.mock.calls[0]?.[0]).toContain("Only registered, not active");
	});
});
