import { describe, expect, it } from "bun:test";
import { buildHotkeysMarkdown } from "@oh-my-pi/pi-coding-agent/modes/utils/hotkeys-markdown";

describe("buildHotkeysMarkdown", () => {
	it("emits flush-left markdown and uses the configured temporary selector hint", () => {
		const displayStrings: Record<string, string> = {
			"app.clipboard.copyLine": "Alt+Shift+L",
			"app.clipboard.copyPrompt": "Ctrl+Shift+P",
			"app.plan.toggle": "Alt+Shift+P",
			"app.tools.expand": "Ctrl+O",
			"app.display.reset": "Ctrl+L",
			"ui.dismiss": "Esc",
			"app.interrupt": "Ctrl+Q",
			"app.navigation.down": "j",
			"app.navigation.up": "k",
			"app.navigation.pageDown": "Ctrl+D",
			"app.navigation.pageUp": "Ctrl+U",
			"app.navigation.top": "g",
			"app.navigation.bottom": "G",
			"app.clear": "Ctrl+C",
			"app.exit": "Ctrl+D",
			"app.suspend": "Ctrl+Z",
			"app.thinking.cycle": "Shift+Tab",
			"app.model.cycleForward": "Ctrl+P",
			"app.model.cycleBackward": "Shift+Ctrl+P",
			"app.model.selectTemporary": "Ctrl+Shift+L",
			"app.model.select": "Alt+M",
			"app.history.search": "Ctrl+R",
			"app.thinking.toggle": "Ctrl+T",
			"app.editor.external": "Ctrl+G",
			"app.clipboard.pasteImage": "Ctrl+V",
			"app.stt.toggle": "Alt+H",
		};
		const markdown = buildHotkeysMarkdown({
			keybindings: {
				getDisplayString(action) {
					return displayStrings[action] ?? "Disabled";
				},
			},
		});

		const lines = markdown.split("\n");
		expect(lines[0]).toBe("**Navigation**");
		expect(markdown).toContain("| `Ctrl+Shift+P` | Copy whole prompt |");
		expect(markdown).toContain("| `Ctrl+Shift+L` | Select model (temporary) |");
		expect(markdown).toContain("| `Alt+M` | Select model (set roles) |");
		expect(markdown).toContain("| `Ctrl+L` | Reset terminal display |");
		expect(markdown).toContain("| `Alt+Shift+P` | Toggle plan mode |");
		expect(markdown).toContain("| `Esc` | Dismiss autocomplete / active UI |");
		expect(markdown).toContain("| `Ctrl+Q` | Interrupt active work |");
		expect(markdown).toContain("| `#` | Open prompt actions |");
		expect(markdown).toContain("| `j` | scroll one line down |");
		expect(markdown).toContain("| `k` | scroll one line up |");
		expect(markdown).toContain("| `n` | next orchestrator root |");
		expect(markdown).toContain("| `p` | previous orchestrator root |");
		expect(markdown).toContain("| `gg` | jump to the first line |");
		expect(markdown).toContain("| `G` | jump to the last line |");
		for (const line of lines) {
			if (line.length === 0) continue;
			expect(line.startsWith(" ")).toBe(false);
			expect(line.startsWith("\t")).toBe(false);
		}
	});

	it("renders the temporary selector row as disabled when no display string is configured", () => {
		const markdown = buildHotkeysMarkdown({
			keybindings: {
				getDisplayString(action) {
					if (action === "app.model.selectTemporary") {
						return "";
					}
					if (action === "app.model.select") {
						return "Alt+M";
					}
					if (action === "app.display.reset") {
						return "Ctrl+L";
					}
					return "Ctrl+K";
				},
			},
		});

		expect(markdown).toContain("| `Disabled` | Select model (temporary) |");
		expect(markdown).toContain("| `Alt+M` | Select model (set roles) |");
	});
});
