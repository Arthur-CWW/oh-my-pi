/**
 * Hub Ctrl+Enter contract: a local live agent sends through the durable
 * follow-up API and exposes the host-provided queue/admission projection.
 */
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "bun:test";
import { resetSettingsForTest, Settings } from "@oh-my-pi/pi-coding-agent/config/settings";
import { IrcBus } from "@oh-my-pi/pi-coding-agent/irc/bus";
import { IrcExternalBus } from "@oh-my-pi/pi-coding-agent/irc/bus-external";
import { getAgentHubTurnStatus } from "@oh-my-pi/pi-coding-agent/modes/controllers/selector-controller";
import { AgentHubOverlayComponent } from "@oh-my-pi/pi-coding-agent/modes/components/agent-hub";
import { SessionObserverRegistry } from "@oh-my-pi/pi-coding-agent/modes/session-observer-registry";
import { initTheme } from "@oh-my-pi/pi-coding-agent/modes/theme/theme";
import { AgentLifecycleManager } from "@oh-my-pi/pi-coding-agent/registry/agent-lifecycle";
import { AgentRegistry } from "@oh-my-pi/pi-coding-agent/registry/agent-registry";
import type { InteractiveModeContext } from "@oh-my-pi/pi-coding-agent/modes/types";
import { UiHelpers } from "@oh-my-pi/pi-coding-agent/modes/utils/ui-helpers";
import type { AgentSession } from "@oh-my-pi/pi-coding-agent/session/agent-session";
import { Container } from "@oh-my-pi/pi-tui";

const AGENT_ID = "Worker";

describe("Agent hub queued follow-up", () => {
	beforeAll(() => {
		initTheme();
	});

	beforeEach(async () => {
		resetSettingsForTest();
		await Settings.init({ inMemory: true });
		vi.spyOn(IrcExternalBus.prototype, "listPeers").mockReturnValue([]);
	});

	afterEach(() => {
		vi.restoreAllMocks();
		resetSettingsForTest();
	});

	it("queues Ctrl+Enter through the durable session and renders admission status", async () => {
		const delivered = Promise.withResolvers<void>();
		const sendUserMessage = vi.fn(async () => {
			delivered.resolve();
		});
		const sessionStub: Pick<AgentSession, "subscribe" | "sendUserMessage"> = {
			subscribe: () => () => {},
			sendUserMessage,
		};
		const session = sessionStub as AgentSession;
		const registry = new AgentRegistry();
		registry.register({
			id: AGENT_ID,
			displayName: AGENT_ID,
			kind: "sub",
			parentId: "Main",
			session,
			sessionFile: null,
			status: "running",
			quota: {
				originalProvider: "chosen-provider",
				reroutedProvider: "chosen-provider",
				originalModel: "chosen-provider/luna",
				reroutedModel: "chosen-provider/sol",
				ratePerHour: 42,
				projectedEmptyAt: Date.now() + 30_000,
				deficitPerHour: 7,
				decisionReason: "prefer healthy fallback",
				quotaPoolId: "pool-a",
				limitWindowId: "hourly",
				resetAt: Date.now() + 60_000,
			},
		});

		expect(getAgentHubTurnStatus(registry, AGENT_ID)).toMatchObject({
			provider: "chosen-provider",
			reroutedProvider: "chosen-provider",
			originalModel: "chosen-provider/luna",
			reroutedModel: "chosen-provider/sol",
		});
		const lifecycle = new AgentLifecycleManager(registry);
		lifecycle.adopt(AGENT_ID, { idleTtlMs: 0, revive: async () => session });
		const hub = new AgentHubOverlayComponent({
			observers: new SessionObserverRegistry(),
			hubKeys: [],
			onDone: () => {},
			requestRender: () => {},
			registry,
			irc: new IrcBus(registry),
			lifecycle,
			turnStatus: id => getAgentHubTurnStatus(registry, id),
			externalIrc: null,
		});

		hub.handleInput("\r");
		for (const character of "follow up message") hub.handleInput(character);
		hub.handleInput("\x1b[13;5u");
		await delivered.promise;

		expect(sendUserMessage).toHaveBeenCalledWith("follow up message", { deliverAs: "followUp" });

		const rendered = Bun.stripANSI(hub.render(120).join("\n"));
		expect(rendered).toContain("running");
		expect(rendered).toContain("rerouted:chosen-provider");
		expect(rendered).toContain("reset:");
		expect(rendered).toContain("provider:chosen-provider");
		expect(rendered).toContain("rate:42/h");
		expect(rendered).toContain("empty:");
		expect(rendered).toContain("deficit:7/h");
		expect(rendered).toContain("model:chosen-provider/luna");
		expect(rendered).toContain("rerouted-model:chosen-provider/sol");
		expect(rendered).toContain("reason:prefer healthy fallback");
		expect(rendered).toContain("pool:pool-a");
		expect(rendered).toContain("window:hourly");

		hub.dispose();
		await lifecycle.dispose();
	});

	it("renders durable obligations by global sequence with class, state, identity, and count", () => {
		const pendingMessagesContainer = new Container();
		const projection = [
			{
				sequence: 20,
				deliveryClass: "followUp",
				state: "running",
				inputId: "follow20-identity",
				payload: { text: "finish second", images: [{ type: "image" }] },
			},
			{
				sequence: 3,
				deliveryClass: "steer",
				state: "queued",
				inputId: "steer003-identity",
				payload: { text: "interrupt first", images: undefined },
			},
			{
				sequence: 14,
				deliveryClass: "steer",
				state: "failed-rate-limit",
				inputId: "steer014-identity",
				payload: { text: "retry between", images: undefined },
			},
		];
		const ctx = {
			pendingMessagesContainer,
			viewSession: {
				getQueuedInputProjection: () => projection,
				getQueuedMessages: () => ({
					steering: ["interrupt first", "core-only"],
					followUp: ["finish second"],
				}),
			},
			keybindings: { getDisplayString: () => "Alt+Up" },
		} as unknown as InteractiveModeContext;

		new UiHelpers(ctx).updatePendingMessagesDisplay();

		const rendered = Bun.stripANSI(pendingMessagesContainer.render(120).join("\n"));
		expect(rendered).toContain("Pending inputs (4):");
		expect(rendered).toContain("#3 steer · queued · steer003: interrupt first");
		expect(rendered).toContain("#14 steer · failed-rate-limit · steer014: retry between");
		expect(rendered).toContain("#20 followUp · running · follow20: finish second [image]");
		expect(rendered).toContain("legacy steer · queued · core: core-only");
		expect(rendered).not.toContain("legacy steer · queued · core: interrupt first");
		expect(rendered).not.toContain("legacy followUp · queued · core: finish second");
		expect(rendered.indexOf("#3 steer")).toBeLessThan(rendered.indexOf("#14 steer"));
		expect(rendered.indexOf("#14 steer")).toBeLessThan(rendered.indexOf("#20 followUp"));
	});
});
