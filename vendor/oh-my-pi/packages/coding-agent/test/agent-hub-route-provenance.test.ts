/**
 * Agent Hub derives displayed route provenance from the newest structured
 * subagent progress snapshot, including the final resolved model.
 */
import { beforeAll, describe, expect, it } from "bun:test";
import { IrcBus } from "@oh-my-pi/pi-coding-agent/irc/bus";
import { AgentHubOverlayComponent } from "@oh-my-pi/pi-coding-agent/modes/components/agent-hub";
import { SessionObserverRegistry } from "@oh-my-pi/pi-coding-agent/modes/session-observer-registry";
import { initTheme } from "@oh-my-pi/pi-coding-agent/modes/theme/theme";
import { AgentRegistry } from "@oh-my-pi/pi-coding-agent/registry/agent-registry";
import type { AgentSession } from "@oh-my-pi/pi-coding-agent/session/agent-session";
import {
	type AgentProgress,
	type SubagentProgressPayload,
	TASK_SUBAGENT_PROGRESS_CHANNEL,
} from "@oh-my-pi/pi-coding-agent/task";
import type { SpawnRouteReceipt } from "@oh-my-pi/pi-coding-agent/task/route-resolution";
import { EventBus } from "@oh-my-pi/pi-coding-agent/utils/event-bus";

const AGENT_ID = "RouteWorker";
const INITIAL_MODEL = "openai-codex/gpt-5.6-terra:medium";
const FINAL_MODEL = "anthropic/claude-opus-4-5:high";

function liveSession(): AgentSession {
	const session: Pick<AgentSession, "subscribe"> = { subscribe: () => () => {} };
	return session as AgentSession;
}

function routeReceipt(source: SpawnRouteReceipt["source"], model: string): SpawnRouteReceipt {
	const [provider, ...modelParts] = model.split("/");
	const selector = modelParts.join("/");
	const [modelId, thinking] = selector.split(":");
	return {
		source,
		route: {
			selector,
			provider,
			model: modelId,
			thinking: thinking === "high" || thinking === "medium" ? thinking : undefined,
			parentActiveSelector: undefined,
		},
		consulted: [],
		overridden: [],
		resolvedPatterns: [],
	};
}

function progress(model: string, source: SpawnRouteReceipt["source"]): AgentProgress {
	return {
		index: 0,
		id: AGENT_ID,
		agent: "task",
		agentSource: "bundled",
		status: "running",
		task: "Verify route provenance",
		recentTools: [],
		recentOutput: [],
		toolCount: 0,
		requests: 0,
		tokens: 0,
		cost: 0,
		durationMs: 0,
		resolvedModel: model,
		routeReceipt: routeReceipt(source, model),
	};
}

function progressPayload(model: string, source: SpawnRouteReceipt["source"]): SubagentProgressPayload {
	return {
		index: 0,
		agent: "task",
		agentSource: "bundled",
		task: "Verify route provenance",
		parentToolCallId: "route-provenance",
		progress: progress(model, source),
	};
}

function renderedText(hub: AgentHubOverlayComponent): string {
	return hub
		.render(120)
		.map(line => Bun.stripANSI(line))
		.join("\n");
}

function makeHub(registry: AgentRegistry, observers: SessionObserverRegistry): AgentHubOverlayComponent {
	return new AgentHubOverlayComponent({
		observers,
		hubKeys: [],
		onDone: () => {},
		requestRender: () => {},
		registry,
		irc: new IrcBus(registry),
		focusAgent: async () => {},
		externalIrc: null,
	});
}

describe("Agent Hub route provenance", () => {
	beforeAll(async () => {
		await initTheme();
	});

	it("renders and filters the final structured route source and resolved model", async () => {
		const registry = new AgentRegistry();
		registry.register({
			id: AGENT_ID,
			displayName: AGENT_ID,
			kind: "sub",
			session: liveSession(),
			status: "running",
		});
		const eventBus = new EventBus();
		const observers = new SessionObserverRegistry();
		observers.subscribeToEventBus(eventBus);
		const hub = makeHub(registry, observers);

		eventBus.emit(TASK_SUBAGENT_PROGRESS_CHANNEL, progressPayload(INITIAL_MODEL, "spawn_explicit"));
		await Bun.sleep(20);
		hub.openChat(AGENT_ID);
		expect(renderedText(hub)).toContain(INITIAL_MODEL);
		expect(renderedText(hub)).toContain("[spawn_explicit]");

		eventBus.emit(TASK_SUBAGENT_PROGRESS_CHANNEL, progressPayload(FINAL_MODEL, "automatic_reroute"));
		await Bun.sleep(100);
		const rerendered = renderedText(hub);
		expect(rerendered).toContain(FINAL_MODEL);
		expect(rerendered).toContain("[automatic_reroute]");
		expect(rerendered).not.toContain(INITIAL_MODEL);
		expect(rerendered).not.toContain("[spawn_explicit]");

		hub.handleInput("\x1b");
		hub.handleInput("/");
		for (const character of "automatic_reroute") hub.handleInput(character);
		const filtered = renderedText(hub);
		expect(filtered).toContain(AGENT_ID);
		expect(filtered).toContain("1/1");

		hub.dispose();
		observers.dispose();
	});
});
