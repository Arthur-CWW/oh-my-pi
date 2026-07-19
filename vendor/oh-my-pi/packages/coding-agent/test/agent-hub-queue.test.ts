/** Hub preview stays read-only while still projecting host queue/admission state. */
import { pressHub } from "./helpers/agent-hub-input";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "bun:test";
import { resetSettingsForTest, Settings } from "@oh-my-pi/pi-coding-agent/config/settings";
import { IrcBus } from "@oh-my-pi/pi-coding-agent/irc/bus";
import { IrcExternalBus } from "@oh-my-pi/pi-coding-agent/irc/bus-external";
import { AgentHubOverlayComponent } from "@oh-my-pi/pi-coding-agent/modes/components/agent-hub";
import { formatAgentHubTurnStatus } from "@oh-my-pi/pi-coding-agent/modes/components/agent-hub-selected-state";
import { getAgentHubTurnStatus } from "@oh-my-pi/pi-coding-agent/modes/controllers/selector-controller";
import { SessionObserverRegistry } from "@oh-my-pi/pi-coding-agent/modes/session-observer-registry";
import { initTheme } from "@oh-my-pi/pi-coding-agent/modes/theme/theme";
import type { InteractiveModeContext } from "@oh-my-pi/pi-coding-agent/modes/types";
import { UiHelpers } from "@oh-my-pi/pi-coding-agent/modes/utils/ui-helpers";
import { AgentLifecycleManager } from "@oh-my-pi/pi-coding-agent/registry/agent-lifecycle";
import { AgentRegistry } from "@oh-my-pi/pi-coding-agent/registry/agent-registry";
import type { AgentSession } from "@oh-my-pi/pi-coding-agent/session/agent-session";
import { Container } from "@oh-my-pi/pi-tui";

const AGENT_ID = "Worker";

describe("Agent hub queue projection", () => {
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

	it("does not dispatch follow-ups from the read-only preview and renders admission status", async () => {
		const sendUserMessage = vi.fn(async () => {});
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

		const turnStatus = getAgentHubTurnStatus(registry, AGENT_ID);
		expect(turnStatus).toMatchObject({
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

		pressHub(hub, "\r");
		pressHub(hub, "i");
		for (const character of "follow up message") pressHub(hub, character);
		pressHub(hub, "\x1b[13;5u");

		expect(sendUserMessage).not.toHaveBeenCalled();
		const rendered = Bun.stripANSI(hub.render(120).join("\n"));
		expect(rendered).toContain("running");
		expect(rendered).toContain("rerouted:chosen-provider");
		expect(turnStatus).toBeDefined();
		const formattedStatus = Bun.stripANSI(formatAgentHubTurnStatus(turnStatus!, 1_000));
		expect(formattedStatus).toContain("provider:chosen-provider");
		expect(formattedStatus).toContain("rerouted:chosen-provider");
		expect(formattedStatus).toContain("model:chosen-provider/luna");
		expect(formattedStatus).toContain("rerouted-model:chosen-provider/sol");
		expect(formattedStatus).toContain("rate:42/h");
		expect(formattedStatus).toContain("empty:");
		expect(formattedStatus).toContain("reset:");
		expect(formattedStatus).toContain("deficit:7/h");
		expect(formattedStatus).toContain("reason:prefer healthy fallback");
		expect(formattedStatus).toContain("pool:pool-a");
		expect(formattedStatus).toContain("window:hourly");

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
		expect(rendered).toContain("Pending inputs (3):");
		expect(rendered).toContain("#3 steer · queued · steer003: interrupt first");
		expect(rendered).toContain("#14 steer · failed-rate-limit · steer014: retry between");
		expect(rendered).not.toContain("#20 followUp · running · follow20: finish second [image]");
		expect(rendered).toContain("legacy steer · queued · core: core-only");
		expect(rendered).not.toContain("legacy steer · queued · core: interrupt first");
		expect(rendered).not.toContain("legacy followUp · queued · core: finish second");
		expect(rendered.indexOf("#3 steer")).toBeLessThan(rendered.indexOf("#14 steer"));
		expect(rendered.indexOf("#14 steer")).toBeLessThan(rendered.indexOf("legacy steer"));
	});
	it("dedupes admitted, running, and completed durable mirrors while preserving a separate legacy duplicate", () => {
		const pendingMessagesContainer = new Container();
		const projection = [
			{
				sequence: 1,
				deliveryClass: "steer",
				state: "admitted",
				inputId: "admitted001-identity",
				payload: { text: "same input", images: undefined },
			},
			{
				sequence: 2,
				deliveryClass: "followUp",
				state: "running",
				inputId: "running002-identity",
				payload: { text: "active input", images: undefined },
			},
			{
				sequence: 3,
				deliveryClass: "steer",
				state: "queued",
				inputId: "queued003-identity",
				payload: { text: "same input", images: undefined },
			},
			{
				sequence: 4,
				deliveryClass: "followUp",
				state: "completed",
				inputId: "completed004-identity",
				payload: { text: "completed input", images: undefined },
			},
		];
		const ctx = {
			pendingMessagesContainer,
			viewSession: {
				getQueuedInputProjection: () => projection,
				getQueuedMessages: () => ({
					steering: ["same input", "same input", "same input"],
					followUp: ["active input", "completed input"],
				}),
			},
			keybindings: { getDisplayString: () => "Alt+Up" },
		} as unknown as InteractiveModeContext;

		new UiHelpers(ctx).updatePendingMessagesDisplay();

		const rendered = Bun.stripANSI(pendingMessagesContainer.render(120).join("\n"));
		expect(rendered).toContain("Pending inputs (2):");
		expect(rendered).toContain("#3 steer · queued · queued00: same input");
		expect((rendered.match(/legacy steer · queued · core: same input/g) ?? []).length).toBe(1);
		expect(rendered).not.toContain("#1 steer · admitted");
		expect(rendered).not.toContain("#2 followUp · running");
		expect(rendered).not.toContain("#4 followUp · completed");
		expect(rendered).not.toContain("legacy followUp · queued · core: active input");
		expect(rendered).not.toContain("legacy followUp · queued · core: completed input");
	});
});
