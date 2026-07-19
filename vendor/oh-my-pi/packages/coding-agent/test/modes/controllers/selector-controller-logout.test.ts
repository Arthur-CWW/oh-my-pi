import { beforeAll, describe, expect, it } from "bun:test";
import * as path from "node:path";
import { Agent } from "@oh-my-pi/pi-agent-core";
import { Effort } from "@oh-my-pi/pi-ai";
import { ModelRegistry } from "@oh-my-pi/pi-coding-agent/config/model-registry";
import { resetSettingsForTest, Settings } from "@oh-my-pi/pi-coding-agent/config/settings";
import { LogoutAccountSelectorComponent } from "@oh-my-pi/pi-coding-agent/modes/components/logout-account-selector";
import { SelectorController } from "@oh-my-pi/pi-coding-agent/modes/controllers/selector-controller";
import { InteractiveMode } from "@oh-my-pi/pi-coding-agent/modes/interactive-mode";
import { initTheme } from "@oh-my-pi/pi-coding-agent/modes/theme/theme";
import { AgentSession } from "@oh-my-pi/pi-coding-agent/session/agent-session";
import { AuthStorage, type OAuthCredential } from "@oh-my-pi/pi-coding-agent/session/auth-storage";
import { SessionManager } from "@oh-my-pi/pi-coding-agent/session/session-manager";
import { TempDir } from "@oh-my-pi/pi-utils";
import { VirtualTerminal } from "../../../../tui/test/virtual-terminal";
import { withControllerFixture } from "../../helpers/controller-fixture";

function createOAuthCredential(email: string, accountId: string, suffix: string): OAuthCredential {
	return {
		type: "oauth",
		access: `access-${suffix}`,
		refresh: `refresh-${suffix}`,
		expires: Date.now() + 60_000,
		email,
		accountId,
	};
}

beforeAll(async () => {
	await initTheme();
});

describe("SelectorController logout", () => {
	it("opens an account picker and removes only the selected credential", async () => {
		await withControllerFixture(async fixture => {
			const tempDir = TempDir.createSync("@pi-selector-logout-");
			const authStorage = await AuthStorage.create(path.join(tempDir.path(), "auth.db"));
			const sessionManager = SessionManager.create(tempDir.path(), path.join(tempDir.path(), "sessions"));
			resetSettingsForTest();
			const settings = await Settings.init({
				inMemory: true,
				cwd: tempDir.path(),
				overrides: { "startup.quiet": true },
			});
			const modelRegistry = new ModelRegistry(authStorage, path.join(tempDir.path(), "models.yml"));
			const model = modelRegistry.find("anthropic", "claude-sonnet-4-5");
			if (!model) throw new Error("Expected bundled anthropic model");

			await authStorage.set("anthropic", [
				createOAuthCredential("a@example.com", "acct-a", "a"),
				createOAuthCredential("b@example.com", "acct-b", "b"),
			]);
			const before = authStorage.listStoredCredentials("anthropic");
			if (before.length !== 2) throw new Error("Expected two stored credentials");

			const session = new AgentSession({
				agent: new Agent({
					initialState: {
						model,
						systemPrompt: ["Test"],
						tools: [],
						messages: [],
						thinkingLevel: Effort.Medium,
					},
				}),
				sessionManager,
				settings,
				modelRegistry,
				toolRegistry: new Map(),
			});
			const mode = new InteractiveMode(session, "test");
			mode.ui = fixture.tui;
			fixture.tui.addChild(mode.editorContainer);
			fixture.tui.setFocus(mode.editor);

			try {
				const controller = new SelectorController(mode, fixture.getInputLeaseManager, fixture.scope);

				await controller.showOAuthSelector("logout", "anthropic");
				let selector: LogoutAccountSelectorComponent | undefined;
				for (let attempt = 0; attempt < 80; attempt += 1) {
					const focused = fixture.tui.getFocused();
					if (focused instanceof LogoutAccountSelectorComponent) {
						selector = focused;
						break;
					}
					await Bun.sleep(1);
				}
				if (selector === undefined) throw new Error("Expected mounted logout account selector renderer");
				const terminal = fixture.tui.terminal;
				if (!(terminal instanceof VirtualTerminal)) {
					throw new Error("Expected virtual terminal");
				}
				fixture.tui.start();
				try {
					terminal.sendInput("\x1b[B");
					terminal.sendInput("\n");
					for (let attempt = 0; attempt < 20; attempt += 1) {
						if (
							authStorage.listStoredCredentials("anthropic").length === 1 &&
							mode.chatContainer.children.length > 0
						) {
							break;
						}
						await Bun.sleep(0);
					}
				} finally {
					fixture.tui.stop();
				}

				const remaining = authStorage.listStoredCredentials("anthropic");
				expect(remaining.map(row => row.id)).toEqual([before[0]?.id]);
				expect(remaining[0]?.credential).toEqual(before[0]?.credential);
				expect(session.modelRegistry.authStorage).toBe(authStorage);
				expect(mode.errorInbox.getErrors()).toHaveLength(0);
				expect(mode.chatContainer.children).toHaveLength(1);
			} finally {
				mode.stop();
				await session.dispose();
				authStorage.close();
				resetSettingsForTest();
				tempDir.removeSync();
			}
		});
	});
});
