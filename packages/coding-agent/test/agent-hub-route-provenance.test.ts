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

function routeReceipt(
	source: SpawnRouteReceipt["source"],
	model: string,
	consulted: SpawnRouteReceipt["consulted"] = [],
	overridden: SpawnRouteReceipt["overridden"] = [],
): SpawnRouteReceipt {
	const [provider, ...modelParts] = model.split("/");
	const selector = modelParts.join("/");
	const [modelId, thinking] = selector.split(":");
	return {
		source,
		requestedSelector: selector,
		effectiveSelector: selector,
		enforcementSource:
			source === "spawn_explicit"
				? "packet_local_escalation"
				: source === "automatic_reroute" || source === "auth_fallback"
					? "runtime_reconciliation"
					: source === "policy_enforced"
						? "policy_enforcement"
						: "responsibility_default",
		responsibility: "implementer",
		alias: "deprecated-alias",
		resolutionSource: source,
		resolvedLane: selector,
		route: {
			selector,
			provider,
			model: modelId,
			thinking: thinking === "high" || thinking === "medium" ? thinking : undefined,
			parentActiveSelector: undefined,
		},
		consulted,
		overridden,
		resolvedPatterns: [],
	};
}

function policyRouteReceipt(
	model: string,
	source: SpawnRouteReceipt["source"] = "automatic_reroute",
): SpawnRouteReceipt {
	const policyCandidate: SpawnRouteReceipt["consulted"][number] = {
		source: "policy",
		explicit: false,
		selectors: [model],
		patterns: [model],
		policy: {
			key: "core.routing.implementer",
			sourceLayer: "workstream-durable",
			transactionId: "11111111-1111-4111-8111-111111111111",
			sequence: 7,
			snapshotAt: "2026-07-15T12:00:00.000Z",
		},
	};
	const shadowedCandidate: SpawnRouteReceipt["consulted"][number] = {
		source: "agent_frontmatter",
		explicit: false,
		selectors: ["pi/implementer"],
		patterns: ["pi/implementer"],
	};
	if (source !== "spawn_explicit")
		return routeReceipt(source, model, [policyCandidate, shadowedCandidate], [shadowedCandidate]);
	const explicitCandidate: SpawnRouteReceipt["consulted"][number] = {
		source,
		explicit: true,
		selectors: [model],
		patterns: [model],
	};
	return routeReceipt(
		source,
		model,
		[explicitCandidate, policyCandidate, shadowedCandidate],
		[policyCandidate, shadowedCandidate],
	);
}

function progress(
	model: string,
	source: SpawnRouteReceipt["source"],
	receipt: SpawnRouteReceipt = routeReceipt(source, model),
): AgentProgress {
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
		routeReceipt: receipt,
	};
}

function progressPayload(
	model: string,
	source: SpawnRouteReceipt["source"],
	receipt?: SpawnRouteReceipt,
): SubagentProgressPayload {
	return {
		index: 0,
		agent: "task",
		agentSource: "bundled",
		task: "Verify route provenance",
		parentToolCallId: "route-provenance",
		progress: progress(model, source, receipt),
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

		eventBus.emit(
			TASK_SUBAGENT_PROGRESS_CHANNEL,
			progressPayload(INITIAL_MODEL, "spawn_explicit", policyRouteReceipt(INITIAL_MODEL, "spawn_explicit")),
		);
		await Bun.sleep(20);
		renderedText(hub);
		hub.handleInput("]");
		const routePane = renderedText(hub);
		expect(routePane).toContain("ROUTE");
		expect(routePane).toContain(`model: ${INITIAL_MODEL}`);
		expect(routePane).toContain("selected: gpt-5.6-terra:medium");
		expect(routePane).toContain("source: spawn receipt RouteWorker");
		expect(routePane).toContain("transaction=11111111-1111-4111-8111-111111111111");
		expect(routePane).toContain("consulted: 3 layers; shadowed candidates=2");

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
