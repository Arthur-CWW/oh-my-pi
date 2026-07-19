import { pressHub } from "./helpers/agent-hub-input";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "bun:test";
import { Settings, resetSettingsForTest } from "@oh-my-pi/pi-coding-agent/config/settings";
import { IrcExternalBus } from "@oh-my-pi/pi-coding-agent/irc/bus-external";
import { AgentHubOverlayComponent } from "@oh-my-pi/pi-coding-agent/modes/components/agent-hub";
import { SelectorController } from "@oh-my-pi/pi-coding-agent/modes/controllers/selector-controller";
import { SessionObserverRegistry } from "@oh-my-pi/pi-coding-agent/modes/session-observer-registry";
import { initTheme } from "@oh-my-pi/pi-coding-agent/modes/theme/theme";
import type { InteractiveModeContext } from "@oh-my-pi/pi-coding-agent/modes/types";
import { AgentRegistry } from "@oh-my-pi/pi-coding-agent/registry/agent-registry";
import { withControllerFixture } from "./helpers/controller-fixture";
import { VirtualTerminal } from "../../tui/test/virtual-terminal";

type Harness = Pick<InteractiveModeContext, "hideThinkingBlock"> & {
	keybindings: { getKeys(key: string): string[] };
	ui: Pick<InteractiveModeContext["ui"], "terminal" | "showOverlay" | "setFocus" | "requestRender">;
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

	it("persists the selected row, honors explicit initial ids, and falls back when it vanishes", async () => {
		await withControllerFixture(async fixture => {
			const registry = AgentRegistry.global();
			register(registry, "Alpha");
			register(registry, "Beta");
			let shown: AgentHubOverlayComponent | undefined;
			const editor = {};
			const ctx: Harness = {
				keybindings: { getKeys: key => (key === "app.interrupt" ? ["ctrl+q"] : ["ctrl+s"]) },
				ui: {
					terminal: fixture.tui.terminal,
					showOverlay: (component, options) => {
						if (!(component instanceof AgentHubOverlayComponent)) throw new Error("Expected Agent Hub overlay");
						shown = component;
						return fixture.tui.showOverlay(component, options);
					},
					setFocus: target => fixture.tui.setFocus(target),
					requestRender: () => fixture.tui.requestRender(),
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
			const observers = new SessionObserverRegistry();
			const controller = new SelectorController(
				ctx as unknown as InteractiveModeContext,
				fixture.getInputLeaseManager,
				fixture.scope,
			);
			const terminal = fixture.tui.terminal;
			if (!(terminal instanceof VirtualTerminal)) throw new Error("Expected virtual terminal");
			const waitFor = async (predicate: () => boolean, message: string): Promise<void> => {
				for (let attempt = 0; attempt < 100; attempt++) {
					if (predicate()) return;
					await Bun.sleep(0);
				}
				throw new Error(message);
			};
			const openHub = async (options?: { initialAgentId?: string }): Promise<AgentHubOverlayComponent> => {
				const previous = shown;
				controller.showAgentHub(observers, options);
				await waitFor(
					() => {
						const lease = fixture.getInputLeaseManager().current();
						return shown !== undefined && shown !== previous && lease.kind === "mvu" && lease.focusedRoot === shown;
					},
					"Expected mounted Agent Hub route",
				);
				if (!shown) throw new Error("Expected mounted Agent Hub renderer");
				return shown;
			};
			const pressMounted = async (sequence: string, predicate: () => boolean): Promise<void> => {
				terminal.sendInput(sequence);
				await waitFor(predicate, `Mounted Agent Hub did not handle ${JSON.stringify(sequence)}`);
			};

			fixture.tui.start();
			try {
				let current = await openHub();
				await pressMounted("n", () => current.getSelectedSelection()?.id === "Beta");
				await pressMounted("\x13", () => fixture.getInputLeaseManager().current().kind === "legacy");

				current = await openHub();
				expect(current.getSelectedSelection()?.id).toBe("Beta");
				await pressMounted("\x13", () => fixture.getInputLeaseManager().current().kind === "legacy");

				current = await openHub({ initialAgentId: "Alpha" });
				expect(current.getSelectedSelection()?.id).toBe("Alpha");
				await pressMounted("\x13", () => fixture.getInputLeaseManager().current().kind === "legacy");

				registry.unregister("Beta");
				current = await openHub();
				expect(current.getSelectedSelection()?.id).toBe("Alpha");
				current.dispose();
			} finally {
				fixture.tui.stop();
				observers.dispose();
			}
		});
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
		pressHub(hub, "\x11");
		expect(doneCalls).toBe(1);
		expect(unfocusCalls).toBe(1);
		hub.dispose();
	});
});
