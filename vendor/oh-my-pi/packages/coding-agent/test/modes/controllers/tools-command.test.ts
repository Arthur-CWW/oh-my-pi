import { beforeAll, describe, expect, it, vi } from "bun:test";
import { CommandOutputOverlayComponent } from "@oh-my-pi/pi-coding-agent/modes/components/command-line";
import { CommandController } from "@oh-my-pi/pi-coding-agent/modes/controllers/command-controller";
import { ToolsView } from "@oh-my-pi/pi-coding-agent/modes/components/tools-view";
import type { InteractiveModeContext } from "@oh-my-pi/pi-coding-agent/modes/types";
import { initTheme } from "@oh-my-pi/pi-coding-agent/modes/theme/theme";
import { buildToolsMarkdown } from "@oh-my-pi/pi-coding-agent/modes/utils/tools-markdown";
import { withControllerFixture } from "../../helpers/controller-fixture";

beforeAll(() => {
	initTheme();
});

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
	it("renders every registered tool through the shared output callback", async () => {
		await withControllerFixture(fixture => {
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

			new CommandController(ctx, fixture.getInputLeaseManager, fixture.scope).handleToolsCommand(showOutput);

			expect(getAllToolNames).toHaveBeenCalledTimes(1);
			expect(getToolByName.mock.calls.map(([name]) => name)).toEqual(["read", "inactive_extension"]);
			expect(showOutput).toHaveBeenCalledTimes(1);
			expect(showOutput.mock.calls[0]?.[0]).toContain("inactive_extension");
			expect(showOutput.mock.calls[0]?.[0]).toContain("Only registered, not active");
		});
	});

	it("opens the tools view without writing to the transcript or reading active tool state", async () => {
		await withControllerFixture(async fixture => {
		const registered = {
			read: {
				name: "read",
				description: "Read files",
				origin: { kind: "builtin" as const, source: "coding-agent" },
			},
			inactive_extension: {
				name: "inactive_extension",
				description: "Only registered, not active",
				origin: { kind: "extension" as const, source: "/workspace/extensions/inactive.ts" },
			},
		};
		const agent = {} as { state?: unknown };
		Object.defineProperty(agent, "state", {
			get() {
				throw new Error("active tool state must not be read");
			},
		});
		const overlay = { hide: vi.fn() };
		const present = vi.fn(() => {
			throw new Error("tools view must not write to transcript");
		});
		const showOverlay = vi.fn((component: ToolsView) => overlay);
		const setFocus = vi.fn();
		const requestRender = vi.fn();
		const requestComponentRender = vi.fn();
		const editor = {};
		const ctx = {
			editor,
			present,
			session: {
				agent,
				getAllToolNames: () => ["read", "inactive_extension"],
				getToolByName: (name: keyof typeof registered) => registered[name],
			},
			ui: {
				terminal: { columns: 120, rows: 24 },
				showOverlay,
				setFocus,
				requestRender,
				requestComponentRender,
			},
		} as unknown as InteractiveModeContext;

		new CommandController(ctx, fixture.getInputLeaseManager, fixture.scope).handleToolsCommand();
		await Bun.sleep(0);
		await Bun.sleep(0);

		expect(present).not.toHaveBeenCalled();
		expect(showOverlay).toHaveBeenCalledTimes(1);
		const view = showOverlay.mock.calls[0]![0];
		expect(view).toBeInstanceOf(ToolsView);
		expect(setFocus).toHaveBeenCalledWith(view);
		expect(requestComponentRender).toHaveBeenCalledWith(view);
		expect(view.render(160).join("\n")).toContain("inactive_extension");
		await view.dispose();
		});
	});
});

describe("CommandController notification output", () => {
	it("routes jobs information through the command output overlay instead of the transcript", async () => {
		await withControllerFixture(async fixture => {
		const overlay = { hide: vi.fn() };
		const showOverlay = vi.fn((component: CommandOutputOverlayComponent) => overlay);
		const present = vi.fn(() => {
			throw new Error("notification output must not write to transcript");
		});
		const ctx = {
			present,
			session: {
				getAsyncJobSnapshot: () => ({ running: [], recent: [] }),
			},
			ui: {
				terminal: { columns: 120, rows: 24 },
				showOverlay,
				setFocus: vi.fn(),
				requestRender: vi.fn(),
			},
		} as unknown as InteractiveModeContext;

		await new CommandController(ctx, fixture.getInputLeaseManager, fixture.scope).handleJobsCommand();

		expect(present).not.toHaveBeenCalled();
		expect(showOverlay).toHaveBeenCalledTimes(1);
		expect(showOverlay.mock.calls[0]?.[0]).toBeInstanceOf(CommandOutputOverlayComponent);
		});
	});
});
