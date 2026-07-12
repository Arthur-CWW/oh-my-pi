import { beforeAll, describe, expect, it } from "bun:test";
import { IrcBus } from "@oh-my-pi/pi-coding-agent/irc/bus";
import { AgentHubOverlayComponent } from "@oh-my-pi/pi-coding-agent/modes/components/agent-hub";
import { SessionObserverRegistry } from "@oh-my-pi/pi-coding-agent/modes/session-observer-registry";
import { initTheme } from "@oh-my-pi/pi-coding-agent/modes/theme/theme";
import { AgentRegistry } from "@oh-my-pi/pi-coding-agent/registry/agent-registry";
import type { AgentSession } from "@oh-my-pi/pi-coding-agent/session/agent-session";
import { TASK_SUBAGENT_PROGRESS_CHANNEL, type SubagentProgressPayload } from "@oh-my-pi/pi-coding-agent/task";
import { EventBus } from "@oh-my-pi/pi-coding-agent/utils/event-bus";

const AGENT_ID = "LaneWorker";

function text(hub: AgentHubOverlayComponent, width: number): string {
	return hub
		.render(width)
		.map(line => Bun.stripANSI(line))
		.join("\n");
}

function fixture(assignment: string) {
	const registry = new AgentRegistry();
	const session = { subscribe: () => () => {} } as unknown as AgentSession;
	registry.register({ id: AGENT_ID, displayName: AGENT_ID, kind: "sub", session, status: "running" });
	const observers = new SessionObserverRegistry();
	const eventBus = new EventBus();
	observers.subscribeToEventBus(eventBus);
	const payload: SubagentProgressPayload = {
		index: 0,
		agent: "task",
		agentSource: "bundled",
		task: assignment,
		assignment,
		progress: {
			index: 0,
			id: AGENT_ID,
			agent: "task",
			agentSource: "bundled",
			status: "running",
			task: assignment,
			assignment,
			spawnContext: "Shared cockpit context",
			recentTools: [],
			recentOutput: [],
			toolCount: 0,
			requests: 0,
			tokens: 0,
			cost: 0,
			durationMs: 0,
			resolvedModel: "openai-codex/gpt-5.6-sol:medium",
			routeReceipt: {
				source: "automatic_reroute",
				route: {
					selector: "openai-codex/gpt-5.6-sol:medium",
					provider: "openai-codex",
					model: "gpt-5.6-sol",
					thinking: "medium",
					parentActiveSelector: undefined,
				},
				reason: "quota evidence favored the available candidate",
				consulted: [],
				overridden: [],
				resolvedPatterns: ["openai-codex/gpt-5.6-sol:medium", "anthropic/claude-opus-4-5"],
				priorAttempts: [
					{
						source: "global_default",
						route: {
							selector: "anthropic/claude-opus-4-5",
							provider: "anthropic",
							model: "claude-opus-4-5",
							thinking: undefined,
							parentActiveSelector: undefined,
						},
						reason: "quota exhausted",
					},
				],
			},
		},
	};
	eventBus.emit(TASK_SUBAGENT_PROGRESS_CHANNEL, payload);
	const hub = new AgentHubOverlayComponent({
		observers,
		hubKeys: [],
		onDone: () => {},
		requestRender: () => {},
		registry,
		irc: new IrcBus(registry),
		externalIrc: null,
	});
	return { hub, observers };
}

describe("Agent Hub dual-lane inspector", () => {
	beforeAll(async () => {
		await initTheme();
	});

	it("activates exactly at the 160-column breakpoint", () => {
		const { hub, observers } = fixture("Inspect this spawn packet");
		expect(text(hub, 159)).not.toContain("[ / ] section");
		expect(text(hub, 160)).toContain("Prompt [ / ] section");
		expect(text(hub, 160)).toContain("Shared cockpit context");
		hub.dispose();
		observers.dispose();
	});

	it("cycles sections and switches lane focus with h/l", () => {
		const { hub, observers } = fixture("Prompt body");
		text(hub, 160);
		hub.handleInput("]");
		expect(text(hub, 160)).toContain("Route [ / ] section");
		hub.handleInput("h");
		hub.handleInput("j");
		hub.handleInput("j");
		expect(text(hub, 160)).toContain("quota evidence favored");
		hub.handleInput("]");
		expect(text(hub, 160)).toContain("Comms [ / ] section");
		hub.handleInput("[");
		expect(text(hub, 160)).toContain("●Route");
		hub.handleInput("l");
		expect(text(hub, 160)).toContain("●Preview transcript");
		hub.dispose();
		observers.dispose();
	});

	it("bounds prompt materialization before inspector scrolling", () => {
		const { hub, observers } = fixture(`${"x".repeat(40_000)}TAIL_BEYOND_BOUND`);
		text(hub, 160);
		hub.handleInput("h");
		hub.handleInput("G");
		expect(text(hub, 160)).not.toContain("TAIL_BEYOND_BOUND");
		expect(hub.getRetentionMetrics().cachedTranscriptEntries).toBeLessThanOrEqual(200);
		hub.dispose();
		observers.dispose();
	});
});
