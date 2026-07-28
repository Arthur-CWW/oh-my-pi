import { afterEach, beforeAll, beforeEach, describe, expect, it } from "bun:test";
import * as path from "node:path";
import { Agent } from "@oh-my-pi/pi-agent-core";
import { ModelRegistry } from "@oh-my-pi/pi-coding-agent/config/model-registry";
import { resetSettingsForTest, Settings } from "@oh-my-pi/pi-coding-agent/config/settings";
import { CustomEditor } from "@oh-my-pi/pi-coding-agent/modes/components/custom-editor";
import { InteractiveMode } from "@oh-my-pi/pi-coding-agent/modes/interactive-mode";
import { getEditorTheme, initTheme } from "@oh-my-pi/pi-coding-agent/modes/theme/theme";
import type { InteractiveModeContext } from "@oh-my-pi/pi-coding-agent/modes/types";
import { AgentSession } from "@oh-my-pi/pi-coding-agent/session/agent-session";
import { AuthStorage } from "@oh-my-pi/pi-coding-agent/session/auth-storage";
import { SessionManager } from "@oh-my-pi/pi-coding-agent/session/session-manager";
import { executeBuiltinSlashCommand } from "@oh-my-pi/pi-coding-agent/slash-commands/builtin-registry";
import { TempDir } from "@oh-my-pi/pi-utils";

function createCommandContext(editor: CustomEditor, statuses: string[]): InteractiveModeContext {
	return {
		editor,
		showStatus: (message: string) => statuses.push(message),
	} as unknown as InteractiveModeContext;
}

describe("/vim slash command", () => {
	beforeAll(() => initTheme());

	it("toggles the active editor in place and reports its state and mode", async () => {
		const editor = new CustomEditor(getEditorTheme());
		const statuses: string[] = [];
		const ctx = createCommandContext(editor, statuses);

		expect(await executeBuiltinSlashCommand("/vim", { ctx })).toBe(true);
		expect(editor.isVimEnabled()).toBe(true);
		expect(editor.getVimMode()).toBe("insert");
		expect(statuses.at(-1)).toContain("Vim mode enabled (mode: insert)");

		expect(await executeBuiltinSlashCommand("/vim", { ctx })).toBe(true);
		expect(editor.isVimEnabled()).toBe(false);
		expect(editor.getVimMode()).toBeNull();
		expect(statuses.at(-1)).toContain("Vim mode disabled (mode: disabled)");
		expect(statuses.at(-1)).toContain("editor.vim: true");
	});

	it("supports on, off, status, and usage arguments", async () => {
		const editor = new CustomEditor(getEditorTheme());
		const statuses: string[] = [];
		const ctx = createCommandContext(editor, statuses);

		expect(await executeBuiltinSlashCommand("/vim on", { ctx })).toBe(true);
		expect(editor.isVimEnabled()).toBe(true);
		expect(await executeBuiltinSlashCommand("/vim status", { ctx })).toBe(true);
		expect(statuses.at(-1)).toContain("Vim mode enabled (mode: insert)");
		expect(await executeBuiltinSlashCommand("/vim off", { ctx })).toBe(true);
		expect(editor.isVimEnabled()).toBe(false);
		expect(await executeBuiltinSlashCommand("/vim nope", { ctx })).toBe(true);
		expect(statuses.at(-1)).toBe("Usage: /vim [on|off|status]");
	});
});

describe("InteractiveMode Vim startup setting", () => {
	let tempDir: TempDir;
	let authStorage: AuthStorage;
	let session: AgentSession;
	let mode: InteractiveMode;

	beforeEach(async () => {
		resetSettingsForTest();
		tempDir = TempDir.createSync("@pi-vim-command-");
		await Settings.init({ inMemory: true, cwd: tempDir.path() });
		authStorage = await AuthStorage.create(path.join(tempDir.path(), "testauth.db"));
		const modelRegistry = new ModelRegistry(authStorage);
		const model = modelRegistry.find("anthropic", "claude-sonnet-4-5");
		if (!model) throw new Error("Expected claude-sonnet-4-5 to exist in registry");

		session = new AgentSession({
			agent: new Agent({
				initialState: {
					model,
					systemPrompt: ["Test"],
					tools: [],
					messages: [],
				},
			}),
			sessionManager: SessionManager.create(tempDir.path(), tempDir.path()),
			settings: Settings.isolated({ "editor.vim": true }),
			modelRegistry,
		});
		mode = new InteractiveMode(session, "test");
	});

	afterEach(async () => {
		mode?.stop();
		await session?.dispose();
		authStorage?.close();
		tempDir?.removeSync();
		resetSettingsForTest();
	});

	it("constructs the active editor with Vim enabled when configured", () => {
		expect(mode.editor.isVimEnabled()).toBe(true);
		expect(mode.editor.getVimMode()).toBe("insert");
	});
});
