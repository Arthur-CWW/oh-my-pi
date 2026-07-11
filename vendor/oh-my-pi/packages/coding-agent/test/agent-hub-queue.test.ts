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
import type { AgentSession } from "@oh-my-pi/pi-coding-agent/session/agent-session";

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
});
