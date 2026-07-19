import { afterEach, beforeAll, describe, expect, it } from "bun:test";
import { KeybindingsManager } from "@oh-my-pi/pi-coding-agent/config/keybindings";
import { TOOLS_VIEW_ROUTE, ToolsView } from "@oh-my-pi/pi-coding-agent/modes/components/tools-view";
import { makeSelectorModel, updateSelector } from "@oh-my-pi/pi-coding-agent/modes/mvu/selector";
import { initTheme } from "@oh-my-pi/pi-coding-agent/modes/theme/theme";
import type { DisplayTool } from "@oh-my-pi/pi-coding-agent/modes/utils/tools-markdown";
import type { Component } from "@oh-my-pi/pi-tui";
import { setKeybindings } from "@oh-my-pi/pi-tui";

beforeAll(() => {
	initTheme();
});

afterEach(() => {
	setKeybindings(KeybindingsManager.inMemory());
});

describe("ToolsView", () => {
	it("exports selector route grammar", () => {
		expect(String(TOOLS_VIEW_ROUTE.componentId)).toBe("tools-view");
		expect(TOOLS_VIEW_ROUTE.context).toBe("selector.global");
	});

	it("renders only committed selector projections and requests its long-lived root", async () => {
		setKeybindings(KeybindingsManager.inMemory({ "tui.select.down": "ctrl+n" }));
		const tools: DisplayTool[] = [
			{
				name: "mcp_write",
				description: "Updated filesystem write description",
				origin: {
					kind: "mcp",
					source: "filesystem: npx -y server-filesystem /workspace",
					registeredBy: "/home/user/.omp/mcp.json",
				},
			},
			{
				name: "read",
				description: "Read files",
				origin: { kind: "builtin", source: "coding-agent" },
			},
			{
				name: "extension_tool",
				description: "Inspect extension state",
				origin: { kind: "extension", source: "/workspace/extensions/sample.ts" },
			},
		];
		let requestedRoot: Component | undefined;
		const view = new ToolsView(tools, {
			height: () => 18,
			requestComponentRender: component => {
				requestedRoot = component;
			},
		});
		const initial = makeSelectorModel(["read", "extension_tool", "mcp_write"], 1);
		view.apply({ model: initial, dirtyKeys: new Set(initial.orderedIds) });
		expect(requestedRoot).toBe(view);
		const moved = updateSelector(initial, { _tag: "Move", delta: 1 }).model;
		const movedAgain = updateSelector(moved, { _tag: "Move", delta: 1 }).model;
		view.apply({ model: movedAgain, dirtyKeys: new Set(["read", "mcp_write"]) });

		const rendered = view.render(180).join("\n");
		expect(rendered).toContain("filesystem: npx -y server-filesystem /workspace");
		expect(rendered).toContain("/home/user/.omp/mcp.json");
		expect(rendered).not.toContain("Ctrl+W");
		expect(rendered).not.toContain("type: filter");

		await view.dispose();
		requestedRoot = undefined;
		view.apply({ model: initial, dirtyKeys: new Set(["read"]) });
		expect(requestedRoot).toBeUndefined();
	});
});
