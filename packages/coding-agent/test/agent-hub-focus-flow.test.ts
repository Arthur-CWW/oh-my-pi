import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "bun:test";
import { Settings, resetSettingsForTest } from "@oh-my-pi/pi-coding-agent/config/settings";
import { IrcExternalBus } from "@oh-my-pi/pi-coding-agent/irc/bus-external";
import { AgentHubOverlayComponent } from "@oh-my-pi/pi-coding-agent/modes/components/agent-hub";
import { SelectorController } from "@oh-my-pi/pi-coding-agent/modes/controllers/selector-controller";
import { SessionObserverRegistry } from "@oh-my-pi/pi-coding-agent/modes/session-observer-registry";
import { initTheme } from "@oh-my-pi/pi-coding-agent/modes/theme/theme";
import type { InteractiveModeContext } from "@oh-my-pi/pi-coding-agent/modes/types";
import { AgentRegistry } from "@oh-my-pi/pi-coding-agent/registry/agent-registry";

type Harness = Pick<InteractiveModeContext, "hideThinkingBlock"> & {
	keybindings: { getKeys(key: string): string[] };
	ui: {
		showOverlay(component: AgentHubOverlayComponent, options?: Record<string, unknown>): { hide(): void };
		setFocus(target: object): void;
		requestRender(): void;
	};
	editor: object;
	collabGuest: { agentRegistry: AgentRegistry; hubRemote: undefined };
	focusedAgentId?: string;
	focusAgentHubInput(id: string): Promise<void>;
	unfocusSession(): Promise<void>;
	session: { getToolByName(name: string): undefined; extensionRunner: undefined };
	sessionManager: { getCwd(): string; getSessionFile(): null; getSessionId(): string };
};

function liveSession() {
	return { subscribe: () => () => {} } as never;
}

function register(registry: AgentRegistry, id: string): void {
	registry.register({ id, displayName: id, kind: "sub", parentId: "Main", session: liveSession(), sessionFile: null, status: "running" });
}

describe("Agent Hub focus flow", () => {
	beforeAll(() => initTheme());
	beforeEach(async () => {
		resetSettingsForTest();
		await Settings.init({ inMemory: true });
		vi.spyOn(IrcExternalBus.prototype, "listPeers").mockReturnValue([]);
	});
	afterEach(() => {
		vi.restoreAllMocks();
		resetSettingsForTest();
		AgentRegistry.resetGlobalForTests();
	});

	it("persists the selected row, honors explicit initial ids, and falls back when it vanishes", () => {
		const registry = AgentRegistry.global();
		register(registry, "Alpha");
		register(registry, "Beta");
		let shown: AgentHubOverlayComponent | undefined;
		const editor = {};
		const ctx: Harness = {
			keybindings: { getKeys: key => key === "app.interrupt" ? ["ctrl+q"] : ["ctrl+s"] },
			ui: {
				showOverlay: component => { shown = component; return { hide: () => {} }; },
				setFocus: () => {},
				requestRender: () => {},
			},
			editor,
			collabGuest: { agentRegistry: registry, hubRemote: undefined },
			focusedAgentId: undefined,
			focusAgentHubInput: async () => {},
			unfocusSession: async () => {},
			session: { getToolByName: () => undefined, extensionRunner: undefined },
			sessionManager: { getCwd: () => "/tmp", getSessionFile: () => null, getSessionId: () => "test" },
			hideThinkingBlock: false,
		};
		const controller = new SelectorController(ctx as unknown as InteractiveModeContext);
		const observers = new SessionObserverRegistry();
		controller.showAgentHub(observers);
		if (!shown) throw new Error("Expected first Hub");
		shown.handleInput("n");
		expect(shown.getSelectedSelection()?.id).toBe("Beta");
		shown.handleInput("\x13");
		controller.showAgentHub(observers);
		expect(shown?.getSelectedSelection()?.id).toBe("Beta");
		shown?.handleInput("\x13");
		controller.showAgentHub(observers, { initialAgentId: "Alpha" });
		expect(shown?.getSelectedSelection()?.id).toBe("Alpha");
		shown?.handleInput("\x13");
		registry.unregister("Beta");
		controller.showAgentHub(observers);
		expect(shown?.getSelectedSelection()?.id).toBe("Alpha");
		shown?.dispose();
	});

	it("Ctrl-Q closes the Hub and unfocuses the subagent", async () => {
		const registry = new AgentRegistry();
		register(registry, "Worker");
		let doneCalls = 0;
		let unfocusCalls = 0;
		const hub = new AgentHubOverlayComponent({
			observers: new SessionObserverRegistry(),
			hubKeys: ["ctrl+s"],
			interruptKeys: ["ctrl+q"],
			onDone: () => { doneCalls++; },
			unfocusSession: async () => { unfocusCalls++; },
			requestRender: () => {},
			registry,
			externalIrc: null,
		});
		hub.handleInput("\x11");
		expect(doneCalls).toBe(1);
		expect(unfocusCalls).toBe(1);
		hub.dispose();
	});
});
