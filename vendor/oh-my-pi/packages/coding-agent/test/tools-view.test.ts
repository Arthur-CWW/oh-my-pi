import { afterEach, beforeAll, describe, expect, it } from "bun:test";
import { KeybindingsManager } from "@oh-my-pi/pi-coding-agent/config/keybindings";
import { ToolsView } from "@oh-my-pi/pi-coding-agent/modes/components/tools-view";
import { initTheme } from "@oh-my-pi/pi-coding-agent/modes/theme/theme";
import type { DisplayTool } from "@oh-my-pi/pi-coding-agent/modes/utils/tools-markdown";
import { setKeybindings } from "@oh-my-pi/pi-tui";

beforeAll(() => {
	initTheme();
});

afterEach(() => {
	setKeybindings(KeybindingsManager.inMemory());
});

describe("ToolsView", () => {
	it("keeps name-keyed selection through refresh and previews description plus provenance", async () => {
		setKeybindings(KeybindingsManager.inMemory({ "tui.select.down": "ctrl+n" }));
		const initial: DisplayTool[] = [
			{
				name: "mcp_write",
				description: "Write through the filesystem server",
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
		const view = new ToolsView(initial, {
			height: () => 18,
			requestRender: () => {},
			onClose: () => {},
		});

		expect(view.selectedKey).toBe("read");
		view.handleInput("\x0e");
		expect(view.selectedKey).toBe("extension_tool");
		view.handleInput("\x0e");
		expect(view.selectedKey).toBe("mcp_write");

		view.refresh([
			{
				...initial[0]!,
				description: "Updated filesystem write description",
			},
			initial[2]!,
			initial[1]!,
		]);
		await view.whenPreviewSettled();

		expect(view.selectedKey).toBe("mcp_write");
		const rendered = view.render(180).join("\n");
		expect(rendered).toContain("Updated filesystem write description");
		expect(rendered).toContain("filesystem: npx -y server-filesystem /workspace");
		expect(rendered).toContain("/home/user/.omp/mcp.json");

		await view.dispose();
	});
});
