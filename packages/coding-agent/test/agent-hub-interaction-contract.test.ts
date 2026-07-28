import { afterAll, beforeAll, describe, expect, it } from "bun:test";
import { mkdir, rm } from "node:fs/promises";
import path from "node:path";
import { IrcBus } from "@oh-my-pi/pi-coding-agent/irc/bus";
import { AgentHubOverlayComponent } from "@oh-my-pi/pi-coding-agent/modes/components/agent-hub";
import { SessionObserverRegistry } from "@oh-my-pi/pi-coding-agent/modes/session-observer-registry";
import { buildAgentRouteExplanation } from "@oh-my-pi/pi-coding-agent/task/route-inspector";
import type { RouteResolutionSource } from "@oh-my-pi/pi-coding-agent/task/route-events";
import type { SpawnRouteReceipt } from "@oh-my-pi/pi-coding-agent/task/route-resolution";
import { initTheme } from "@oh-my-pi/pi-coding-agent/modes/theme/theme";
import { AgentRegistry } from "@oh-my-pi/pi-coding-agent/registry/agent-registry";
import type { AgentSession } from "@oh-my-pi/pi-coding-agent/session/agent-session";
import { TASK_SUBAGENT_PROGRESS_CHANNEL, type SubagentProgressPayload } from "@oh-my-pi/pi-coding-agent/task";
import { EventBus } from "@oh-my-pi/pi-coding-agent/utils/event-bus";

const IDS = Array.from({ length: 8 }, (_, index) => `FocusWorker${index}`);
const CTRL_W = "\x17";
const root = path.join(process.env.HOME ?? process.cwd(), `.agent-hub-interactions-${process.pid}`);

function liveSession(): AgentSession {
	const session: Pick<AgentSession, "subscribe"> = { subscribe: () => () => {} };
	return session as AgentSession;
}

function routeReceipt(): SpawnRouteReceipt {
	const route = {
		selector: "openai-codex/gpt-5.6-sol:medium",
		provider: "openai-codex",
		model: "gpt-5.6-sol",
		thinking: "medium" as const,
		parentActiveSelector: undefined,
	};
	return {
		source: "automatic_reroute",
		route,
		requestedSelector: route.selector,
		effectiveSelector: route.selector,
		enforcementSource: "runtime_reconciliation",
		reason: "Needs senior route judgment",
		consulted: [],
		overridden: [],
		resolvedPatterns: [route.selector],
		priorAttempts: [],
		responsibility: "implementer",
		resolutionSource: "automatic_reroute",
		resolvedLane: route.selector,
	};
}

function hotSwapEvent(agentId: string): RouteResolutionSource {
	return {
		payloadVersion: 1,
		resolutionId: "route-hot-swap",
		occurredAt: 2,
		agentId,
		agentSeq: 2,
		agentSessionId: null,
		parentSessionId: null,
		parentAgentId: "Main",
		taskId: null,
		packetId: null,
		branchId: null,
		turnId: null,
		changeKind: "hotswap",
		reason: "provider capacity recovered",
		responsibility: "implementer",
		alias: null,
		route: {
			lane: "anthropic/claude-opus-4-5:high",
			provider: "anthropic",
			upstreamProvider: null,
			model: "claude-opus-4-5",
			account: { kind: "none", ref: null, provenance: {} },
			effort: "high",
		},
		provenance: {
			resolutionSource: "auth_fallback",
			resolvedLane: "anthropic/claude-opus-4-5:high",
			winningLayer: "auth_fallback",
			constraints: [],
			consultedSources: [],
			overriddenValues: [],
		},
		candidates: [],
		fallbackFromResolutionId: null,
		revertedFromResolutionId: null,
		advisors: [],
		rawDecisionArtifactId: null,
		artifacts: [],
	};
}
function progressPayload(
	id: string,
	index: number,
	status: "pending" | "running" = "running",
	model = "openai-codex/gpt-5.6-sol:medium",
): SubagentProgressPayload {
	const assignment = Array.from({ length: 80 }, (_, line) => `${id} prompt line ${line}`).join("\n");
	return {
		index,
		agent: "implementer",
		agentSource: "bundled",
		task: assignment,
		assignment,
		progress: {
			index,
			id,
			agent: "implementer",
			agentSource: "bundled",
			status,
			task: assignment,
			assignment,
			recentTools: [],
			recentOutput: status === "running" ? ["waiting-provider"] : [],
			toolCount: 0,
			requests: 0,
			tokens: 0,
			cost: 0,
			durationMs: 0,
			resolvedModel: model,
			routeReceipt: routeReceipt(),
		},
	};
}

async function writeTranscript(id: string): Promise<string> {
	const file = path.join(root, `${id}.jsonl`);
	const timestamp = "2026-07-26T00:00:00.000Z";
	const entries = Array.from({ length: 80 }, (_, index) => ({
		type: "message",
		id: `${id}-message-${index}`,
		parentId: null,
		timestamp,
		message: { role: "user", content: `${id} transcript line ${index}`, timestamp: Date.parse(timestamp) + index },
	}));
	await Bun.write(file, `${entries.map(entry => JSON.stringify(entry)).join("\n")}\n`);
	return file;
}

async function fixture(): Promise<{
	hub: AgentHubOverlayComponent;
	observers: SessionObserverRegistry;
	registry: AgentRegistry;
	eventBus: EventBus;
}> {
	await mkdir(root, { recursive: true });
	const registry = new AgentRegistry();
	const observers = new SessionObserverRegistry();
	const eventBus = new EventBus();
	observers.subscribeToEventBus(eventBus);
	for (const [index, id] of IDS.entries()) {
		registry.register({
			id,
			displayName: id,
			kind: "sub",
			parentId: "Main",
			session: liveSession(),
			sessionFile: await writeTranscript(id),
			status: "running",
		});
		eventBus.emit(TASK_SUBAGENT_PROGRESS_CHANNEL, progressPayload(id, index));
	}
	return {
		hub: new AgentHubOverlayComponent({
			observers,
			hubKeys: [],
			onDone: () => {},
			requestRender: () => {},
			registry,
			irc: new IrcBus(registry),
			externalIrc: null,
		}),
		observers,
		registry,
		eventBus,
	};
}

async function settleTranscript(hub: AgentHubOverlayComponent): Promise<void> {
	for (let attempt = 0; attempt < 100; attempt++) {
		hub.render(160);
		if (hub.getRetentionMetrics().cachedTranscriptEntries > 0) return;
		await new Promise<void>(resolve => setImmediate(resolve));
	}
	throw new Error("Hub transcript fixture did not settle");
}

function chord(hub: AgentHubOverlayComponent, suffix: "j" | "k"): void {
	hub.handleInput("g");
	hub.handleInput(suffix);
}

function firstLine(hub: AgentHubOverlayComponent): void {
	hub.handleInput("g");
	hub.handleInput("g");
}

describe("Agent Hub interaction contract", () => {
	beforeAll(async () => {
		await initTheme(false);
	});

	afterAll(async () => {
		await rm(root, { recursive: true, force: true });
	});

	it("moves focus bidirectionally and executes sibling, display-row, and five-line chords in every live Hub context", async () => {
		const { hub, observers } = await fixture();
		try {
			await settleTranscript(hub);
			expect(hub.getInteractionState()).toMatchObject({ panelFocus: "roster", selectedAgentId: IDS[0] });

			hub.handleInput("h");
			expect(hub.getInteractionState().panelFocus).toBe("prompt");
			hub.handleInput("l");
			expect(hub.getInteractionState().panelFocus).toBe("transcript");
			hub.handleInput(CTRL_W);
			expect(hub.getInteractionState().panelFocus).toBe("roster");
			hub.handleInput(CTRL_W);
			expect(hub.getInteractionState().panelFocus).toBe("transcript");
			hub.handleInput(CTRL_W);

			chord(hub, "j");
			expect(hub.getInteractionState().tableIndex).toBe(1);
			chord(hub, "k");
			expect(hub.getInteractionState().tableIndex).toBe(0);
			hub.handleInput("J");
			expect(hub.getInteractionState().tableIndex).toBe(5);
			hub.handleInput("K");
			expect(hub.getInteractionState().tableIndex).toBe(0);
			hub.handleInput("]");
			expect(hub.getInteractionState().selectedAgentId).toBe(IDS[1]);
			hub.handleInput("[");
			expect(hub.getInteractionState().selectedAgentId).toBe(IDS[0]);

			hub.handleInput("l");
			expect(hub.getInteractionState().panelFocus).toBe("transcript");
			await settleTranscript(hub);
			hub.render(160);
			firstLine(hub);
			expect(hub.getInteractionState().transcriptOffset).toBe(0);
			chord(hub, "j");
			expect(hub.getInteractionState().transcriptOffset).toBe(1);
			chord(hub, "k");
			expect(hub.getInteractionState().transcriptOffset).toBe(0);
			hub.handleInput("J");
			expect(hub.getInteractionState().transcriptOffset).toBe(5);
			hub.handleInput("K");
			expect(hub.getInteractionState().transcriptOffset).toBe(0);
			hub.handleInput("]");
			expect(hub.getInteractionState().selectedAgentId).toBe(IDS[1]);
			hub.handleInput("[");

			hub.handleInput("h");
			hub.render(160);
			firstLine(hub);
			expect(hub.getInteractionState()).toMatchObject({ panelFocus: "prompt", inspectorOffset: 0 });
			chord(hub, "j");
			expect(hub.getInteractionState().inspectorOffset).toBe(1);
			chord(hub, "k");
			expect(hub.getInteractionState().inspectorOffset).toBe(0);
			hub.handleInput("J");
			expect(hub.getInteractionState().inspectorOffset).toBe(5);
			hub.handleInput("K");
			expect(hub.getInteractionState().inspectorOffset).toBe(0);
			hub.handleInput("]");
			expect(hub.getInteractionState().selectedAgentId).toBe(IDS[1]);
			hub.handleInput("[");

			hub.openChat(IDS[0]!);
			await settleTranscript(hub);
			firstLine(hub);
			expect(hub.getInteractionState()).toMatchObject({ view: "chat", panelFocus: "transcript", transcriptOffset: 0 });
			chord(hub, "j");
			expect(hub.getInteractionState().transcriptOffset).toBe(1);
			chord(hub, "k");
			expect(hub.getInteractionState().transcriptOffset).toBe(0);
			hub.handleInput("J");
			expect(hub.getInteractionState().transcriptOffset).toBe(5);
			hub.handleInput("K");
			expect(hub.getInteractionState().transcriptOffset).toBe(0);
			hub.handleInput("]");
			expect(hub.getInteractionState().selectedAgentId).toBe(IDS[1]);
			hub.handleInput("[");
			expect(hub.getInteractionState().selectedAgentId).toBe(IDS[0]);
		} finally {
			hub.dispose();
			observers.dispose();
		}
	});

	it("keeps routed effort through lifecycle transitions and exposes exact route provenance via g i", async () => {
		const { hub, observers, registry, eventBus } = await fixture();
		try {
			const sessionFile = registry.get(IDS[0]!)?.sessionFile;
			registry.register({
				id: IDS[0]!,
				displayName: IDS[0]!,
				kind: "sub",
				parentId: "Main",
				session: null,
				sessionFile,
				status: "running",
				recovery: {
					task: "interaction contract",
					model: "openai-codex/gpt-5.6-sol",
					thinkingLevel: "medium",
					turnState: "detached_live",
				},
			});
			eventBus.emit(TASK_SUBAGENT_PROGRESS_CHANNEL, progressPayload(IDS[0]!, 0, "pending"));
			await new Promise<void>(resolve => setImmediate(resolve));
			expect(hub.getSelectedAgentViewModel()?.modelSelector).toBe("openai-codex/gpt-5.6-sol:medium");

			registry.register({
				id: IDS[0]!,
				displayName: IDS[0]!,
				kind: "sub",
				parentId: "Main",
				session: null,
				sessionFile,
				status: "running",
				starting: true,
				recovery: {
					task: "interaction contract",
					model: "openai-codex/gpt-5.6-sol",
					thinkingLevel: "medium",
					turnState: "detached_live",
				},
			});
			expect(hub.getSelectedAgentViewModel()?.modelSelector).toBe("openai-codex/gpt-5.6-sol:medium");

			registry.setActivity(IDS[0]!, "waiting-provider");
			eventBus.emit(TASK_SUBAGENT_PROGRESS_CHANNEL, progressPayload(IDS[0]!, 0, "running"));
			await new Promise<void>(resolve => setImmediate(resolve));
			expect(hub.getSelectedAgentViewModel()?.modelSelector).toBe("openai-codex/gpt-5.6-sol:medium");

			expect(registry.setRecoveryRoute(IDS[0]!, "anthropic/claude-opus-4-5", "high")).toBe(true);
			expect(hub.getSelectedAgentViewModel()?.modelSelector).toBe("anthropic/claude-opus-4-5:high");

			const explanation = buildAgentRouteExplanation({
				agentId: IDS[0]!,
				receipt: routeReceipt(),
				routeEvents: [hotSwapEvent(IDS[0]!)],
			});
			expect(explanation).toEqual({
				agentId: IDS[0]!,
				selectedModel: "anthropic/claude-opus-4-5",
				effort: "high",
				responsibility: "implementer",
				receiptSource: "automatic_reroute",
				escalationReason: "Needs senior route judgment",
				history: [
					{
						kind: "hotswap",
						model: "anthropic/claude-opus-4-5",
						effort: "high",
						reason: "provider capacity recovered",
						occurredAt: 2,
					},
				],
			});

			hub.handleInput("g");
			hub.handleInput("i");
			expect(hub.getInteractionState()).toMatchObject({ panelFocus: "route", inspectorSection: "route" });
		} finally {
			hub.dispose();
			observers.dispose();
		}
	});
});
