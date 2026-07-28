import { describe, expect, it } from "bun:test";
import * as path from "node:path";
import { Settings } from "@oh-my-pi/pi-coding-agent/config/settings";
import { RegisteredToolAdapter } from "@oh-my-pi/pi-coding-agent/extensibility/extensions/wrapper";
import { MCPManager } from "@oh-my-pi/pi-coding-agent/mcp/manager";
import type { MCPStdioServerConfig } from "@oh-my-pi/pi-coding-agent/mcp/types";
import { applyToolFactoryOrigin, BUILTIN_TOOLS, type Tool, type ToolSession } from "@oh-my-pi/pi-coding-agent/tools";
import { z } from "zod/v4";

const MCP_FIXTURE = path.join(import.meta.dir, "fixtures", "instructions-mcp.ts");

describe("tool registry provenance", () => {
	it("attaches the builtin module to a builtin registry entry", async () => {
		const raw = await BUILTIN_TOOLS.read({
			cwd: process.cwd(),
			hasUI: false,
			settings: Settings.isolated({}),
		} as ToolSession);
		expect(raw).not.toBeNull();
		const registered = applyToolFactoryOrigin(raw as Tool, BUILTIN_TOOLS.read);
		expect(registered.origin).toEqual({ kind: "builtin", source: "tools/read.ts" });
	});

	it("records an isolated MCP fixture command and registering config", async () => {
		const manager = new MCPManager(process.cwd());
		const config: MCPStdioServerConfig = {
			type: "stdio",
			command: process.execPath,
			args: [MCP_FIXTURE],
		};
		const configPath = path.join(process.cwd(), ".codex", "config.toml");
		try {
			const result = await manager.connectServers(
				{ fixture: config },
				{
					fixture: {
						provider: "codex",
						providerName: "OpenAI Codex",
						path: configPath,
						level: "project",
					},
				},
			);
			expect(result.tools).toHaveLength(1);
			expect(result.tools[0]?.origin).toEqual({
				kind: "mcp",
				source: `fixture: ${process.execPath} ${MCP_FIXTURE}`,
				registeredBy: configPath,
			});
		} finally {
			await manager.disconnectAll();
		}
	}, 10_000);

	it("uses the registering extension path for extension tools", () => {
		const extensionPath = "/workspace/.omp/extensions/example.ts";
		const adapter = new RegisteredToolAdapter(
			{
				extensionPath,
				definition: {
					name: "example",
					label: "Example",
					description: "Example extension tool",
					parameters: z.object({}),
					async execute() {
						return { content: [{ type: "text", text: "ok" }] };
					},
				},
			},
			{} as never,
		) as Tool;
		expect(adapter.origin).toEqual({ kind: "extension", source: extensionPath });
	});
});
