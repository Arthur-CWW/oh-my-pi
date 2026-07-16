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

function stubStdoutRows(): { setRows(rows: number): void; restore(): void } {
	const descriptor = Object.getOwnPropertyDescriptor(process.stdout, "rows");
	let rows = 40;
	Object.defineProperty(process.stdout, "rows", { configurable: true, get: () => rows });
	return {
		setRows(next: number) {
			rows = next;
		},
		restore() {
			if (descriptor) Object.defineProperty(process.stdout, "rows", descriptor);
			else Reflect.deleteProperty(process.stdout, "rows");
		},
	};
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
				responsibility: "implementer",
				alias: "deprecated-alias",
				resolutionSource: "automatic_reroute",
				resolvedLane: "openai-codex/gpt-5.6-sol:medium",
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

	it("keeps side-by-side lanes at the 160-column breakpoint", () => {
		const { hub, observers } = fixture("Inspect this spawn packet");
		const narrow = text(hub, 159).split("\n");
		expect(narrow.findIndex(line => line.includes("Prompt [ / ] section"))).toBeLessThan(
			narrow.findIndex(line => line.includes("Preview transcript")),
		);
		const wide = text(hub, 160).split("\n");
		expect(wide.findIndex(line => line.includes("Prompt [ / ] section"))).toBe(
			wide.findIndex(line => line.includes("Preview transcript")),
		);
		expect(wide.join("\n")).toContain("Shared cockpit context");
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
	it("gives the preview the full height above the compact roster", () => {
		const geometry = stubStdoutRows();
		const { hub, observers } = fixture("Full-height preview");
		try {
			for (const rows of [24, 40, 60]) {
				geometry.setRows(rows);
				const lines = hub.render(120).map(line => Bun.stripANSI(line));
				const transcriptStart = lines.findIndex(line => line.includes("Preview transcript"));
				const inspectorStart = lines.findIndex(line => line.includes("Prompt [ / ] section"));
				const previewTrackStart = inspectorStart >= 0 ? inspectorStart : transcriptStart;
				const rosterStart = lines.findIndex(line => line.includes("Running (1)"));
				expect(transcriptStart).toBeGreaterThan(0);
				// 9 = header/footer chrome, 6 = compact roster, 2 = fixed selected-agent rail (HR-125)
				expect(rosterStart - previewTrackStart).toBe(rows - 9 - 6 - 2);
			}
			hub.handleInput("j");
			expect(text(hub, 120)).toContain("Full-height preview");
		} finally {
			hub.dispose();
			observers.dispose();
			geometry.restore();
		}
	});

	it.each([80, 120])("stacks inspector and transcript at %i columns with the same lane keys", width => {
		const geometry = stubStdoutRows();
		geometry.setRows(40);
		const { hub, observers } = fixture("Stacked prompt body");
		try {
			const initial = text(hub, width).split("\n");
			const inspectorStart = initial.findIndex(line => line.includes("Prompt [ / ] section"));
			const transcriptStart = initial.findIndex(line => line.includes("Preview transcript"));
			const rosterStart = initial.findIndex(line => line.includes("Running (1)"));
			expect(inspectorStart).toBeGreaterThan(0);
			expect(transcriptStart).toBeGreaterThan(inspectorStart);
			expect(rosterStart - inspectorStart).toBe(40 - 9 - 6 - 2);

			hub.handleInput("]");
			expect(text(hub, width)).toContain("Route [ / ] section");
			hub.handleInput("h");
			expect(text(hub, width)).toContain("●Route");
			hub.handleInput("l");
			expect(text(hub, width)).toContain("●Preview transcript");
		} finally {
			hub.dispose();
			observers.dispose();
			geometry.restore();
		}
	});

	it("falls back to transcript-only when the preview track cannot fit two useful lanes", () => {
		const geometry = stubStdoutRows();
		geometry.setRows(24);
		const { hub, observers } = fixture("Short terminal prompt");
		try {
			const rendered = text(hub, 120);
			expect(rendered).toContain("Preview transcript");
			expect(rendered).not.toContain("Prompt [ / ] section");
			hub.handleInput("h");
			expect(text(hub, 120)).not.toContain("●Prompt");
		} finally {
			hub.dispose();
			observers.dispose();
			geometry.restore();
		}
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
	it("shows compressed effort in both roster and preview header", () => {
		const { hub, observers } = fixture("Effort-visible preview");
		try {
			expect(text(hub, 160)).toContain("SOX5.6m");
			hub.handleInput("\r");
			expect(text(hub, 160)).toContain("SOX5.6m");
		} finally {
			hub.dispose();
			observers.dispose();
		}
	});
});
