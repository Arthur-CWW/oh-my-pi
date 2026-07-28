import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import * as fs from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";
import { KeybindingsManager } from "@oh-my-pi/pi-coding-agent/config/keybindings";
import { setKeybindings } from "@oh-my-pi/pi-tui";
import { YAML } from "bun";

describe("KeybindingsManager.create", () => {
	beforeEach(() => {
		setKeybindings(KeybindingsManager.inMemory());
	});

	afterEach(() => {
		setKeybindings(KeybindingsManager.inMemory());
	});

	it("migrates legacy keybinding JSON to YAML during create", async () => {
		const agentDir = await fs.mkdtemp(path.join(os.tmpdir(), "pi-keybindings-"));
		const jsonPath = path.join(agentDir, "keybindings.json");
		const ymlPath = path.join(agentDir, "keybindings.yml");

		await Bun.write(
			jsonPath,
			`${JSON.stringify(
				{
					fork: "ctrl+f",
					selectConfirm: "enter",
					cursorUp: "ctrl+p",
					selectModelTemporary: "alt+y",
				},
				null,
				2,
			)}\n`,
		);

		try {
			const manager = KeybindingsManager.create(agentDir);
			const writtenConfig = YAML.parse(await Bun.file(ymlPath).text());

			expect(manager.getKeys("app.session.fork")).toEqual(["ctrl+f"]);
			expect(manager.getKeys("tui.select.confirm")).toEqual(["enter"]);
			expect(manager.getKeys("tui.editor.cursorUp")).toEqual(["ctrl+p"]);
			expect(manager.getKeys("app.model.selectTemporary")).toEqual(["alt+y"]);
			expect(writtenConfig).toEqual({
				"app.model.selectTemporary": "alt+y",
				"app.session.fork": "ctrl+f",
				"tui.editor.cursorUp": "ctrl+p",
				"tui.select.confirm": "enter",
			});
			expect(writtenConfig).not.toHaveProperty("selectModelTemporary");
			expect(await Bun.file(jsonPath).exists()).toBe(true);
		} finally {
			await fs.rm(agentDir, { recursive: true, force: true });
		}
	});

	it("loads keybindings.yml directly", async () => {
		const agentDir = await fs.mkdtemp(path.join(os.tmpdir(), "pi-keybindings-"));
		const configPath = path.join(agentDir, "keybindings.yml");

		await Bun.write(
			configPath,
			YAML.stringify(
				{
					"app.session.fork": "ctrl+f",
					"app.clipboard.copyPrompt": ["alt+c", "ctrl+shift+c"],
				},
				null,
				2,
			),
		);

		try {
			const manager = KeybindingsManager.create(agentDir);

			expect(manager.getKeys("app.session.fork")).toEqual(["ctrl+f"]);
			expect(manager.getKeys("app.clipboard.copyPrompt")).toEqual(["alt+c", "ctrl+shift+c"]);
		} finally {
			await fs.rm(agentDir, { recursive: true, force: true });
		}
	});

	it("accepts keybindings.yaml when present", async () => {
		const agentDir = await fs.mkdtemp(path.join(os.tmpdir(), "pi-keybindings-"));
		const yamlPath = path.join(agentDir, "keybindings.yaml");
		const canonicalPath = path.join(agentDir, "keybindings.yml");

		await Bun.write(
			yamlPath,
			YAML.stringify(
				{
					"app.plan.toggle": "alt+shift+p",
				},
				null,
				2,
			),
		);

		try {
			const manager = KeybindingsManager.create(agentDir);

			expect(manager.getKeys("app.plan.toggle")).toEqual(["alt+shift+p"]);
			expect(await Bun.file(canonicalPath).exists()).toBe(false);
		} finally {
			await fs.rm(agentDir, { recursive: true, force: true });
		}
	});

	it("defaults model selection to Alt+M and display reset to Ctrl+L", () => {
		const manager = KeybindingsManager.inMemory();

		expect(manager.getKeys("app.model.select")).toEqual(["alt+m"]);
		expect(manager.getKeys("app.display.reset")).toEqual(["ctrl+l"]);
	});

	it("keeps default ui.dismiss=escape independent with only app.interrupt=ctrl+q configured", () => {
		const manager = KeybindingsManager.inMemory({
			"app.interrupt": "ctrl+q",
		});

		expect(manager.getKeys("app.interrupt")).toEqual(["ctrl+q"]);
		expect(manager.getKeys("ui.dismiss")).toEqual(["escape"]);
	});

	it("remaps ui.dismiss=ctrl+g independently while app.interrupt stays ctrl+q", () => {
		const manager = KeybindingsManager.inMemory({
			"ui.dismiss": "ctrl+g",
		});

		expect(manager.getKeys("ui.dismiss")).toEqual(["ctrl+g"]);
		expect(manager.getKeys("app.interrupt")).toEqual(["ctrl+q"]);
	});

	it("keeps the Ctrl+L display reset default when an old model remap still claims Ctrl+L", () => {
		const manager = KeybindingsManager.inMemory({
			"app.model.select": "ctrl+l",
		});

		expect(manager.getKeys("app.model.select")).toEqual(["ctrl+l"]);
		expect(manager.getKeys("app.display.reset")).toEqual(["ctrl+l"]);
		expect(manager.getEffectiveConfig()["app.display.reset"]).toBe("ctrl+l");
	});

	it("keeps Ctrl+L when the user explicitly assigns it to display reset", () => {
		const manager = KeybindingsManager.inMemory({
			"app.display.reset": "ctrl+l",
		});

		expect(manager.getKeys("app.display.reset")).toEqual(["ctrl+l"]);
	});

	it("reserves Ctrl+Q for direct interrupt and defaults follow-up to Ctrl+Enter", async () => {
		const agentDir = await fs.mkdtemp(path.join(os.tmpdir(), "pi-keybindings-"));

		try {
			const manager = KeybindingsManager.create(agentDir);

			expect(manager.getKeys("app.interrupt")).toEqual(["ctrl+q"]);
			expect(manager.getKeys("app.message.followUp")).toEqual(["ctrl+enter"]);
		} finally {
			await fs.rm(agentDir, { recursive: true, force: true });
		}
	});

	it("keeps Ctrl+Q out of follow-up when another user remap also claims it", () => {
		const manager = KeybindingsManager.inMemory({
			"app.plan.toggle": "ctrl+q",
		});

		expect(manager.getKeys("app.plan.toggle")).toEqual(["ctrl+q"]);
		expect(manager.getKeys("app.message.followUp")).toEqual(["ctrl+enter"]);
		expect(manager.getDisplayString("app.message.followUp")).toBe("Ctrl+Enter");
		expect(manager.getEffectiveConfig()["app.message.followUp"]).toEqual(["ctrl+enter"]);
	});

	it("keeps Ctrl+Q reserved when an unknown config key claims it", () => {
		const manager = KeybindingsManager.inMemory({
			"unknown.action": "ctrl+q",
		});

		expect(manager.getKeys("app.message.followUp")).toEqual(["ctrl+enter"]);
	});

	it("rejects Ctrl+Q even when the user explicitly assigns it to follow-up", () => {
		const manager = KeybindingsManager.inMemory({
			"app.message.followUp": "ctrl+q",
		});

		expect(manager.getKeys("app.message.followUp")).toEqual([]);
	});
});
