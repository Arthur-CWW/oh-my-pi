/**
 * Agent Hub keeps live rows in registration order, oldest first, regardless
 * of activity or heartbeat updates.
 */
import { afterEach, beforeAll, describe, expect, it, vi } from "bun:test";
import * as fs from "node:fs/promises";
import { IrcBus } from "@oh-my-pi/pi-coding-agent/irc/bus";
import {
	type AgentHubExternalPeer,
	type AgentHubExternalPeerDataSource,
	AgentHubOverlayComponent,
} from "@oh-my-pi/pi-coding-agent/modes/components/agent-hub";
import { SessionObserverRegistry } from "@oh-my-pi/pi-coding-agent/modes/session-observer-registry";
import { initTheme } from "@oh-my-pi/pi-coding-agent/modes/theme/theme";
import { AgentRegistry } from "@oh-my-pi/pi-coding-agent/registry/agent-registry";
import { CURRENT_SESSION_VERSION } from "@oh-my-pi/pi-coding-agent/session/session-entries";
import { CHILD_LIFECYCLE_CUSTOM_TYPE, type ChildLifecycleState } from "@oh-my-pi/pi-coding-agent/task/child-lifecycle";
import type { AgentSession } from "@oh-my-pi/pi-coding-agent/session/agent-session";
import { TempDir } from "@oh-my-pi/pi-utils";

interface GeometryStub {
	setRows(n: number): void;
	restore(): void;
}

function liveSession(): AgentSession {
	const session: Pick<AgentSession, "subscribe"> = { subscribe: () => () => {} };
	return session as AgentSession;
}

function stubStdoutGeometry(cols: number): GeometryStub {
	const rowsDesc = Object.getOwnPropertyDescriptor(process.stdout, "rows");
	const colsDesc = Object.getOwnPropertyDescriptor(process.stdout, "columns");
	let rows = 24;
	Object.defineProperty(process.stdout, "rows", { configurable: true, get: () => rows });
	Object.defineProperty(process.stdout, "columns", { configurable: true, get: () => cols });
	const restoreOne = (key: "rows" | "columns", desc: PropertyDescriptor | undefined) => {
		if (desc) Object.defineProperty(process.stdout, key, desc);
		else Object.defineProperty(process.stdout, key, { configurable: true, value: undefined, writable: true });
	};
	return {
		setRows(n: number) {
			rows = n;
		},
		restore() {
			restoreOne("rows", rowsDesc);
			restoreOne("columns", colsDesc);
		},
	};
}

function makeHub(
	agents: AgentRegistry,
	options: { externalIrc?: AgentHubExternalPeerDataSource | null; externalSessionId?: string } = {},
) {
	return new AgentHubOverlayComponent({
		observers: new SessionObserverRegistry(),
		hubKeys: [],
		onDone: () => {},
		requestRender: () => {},
		registry: agents,
		irc: new IrcBus(agents),
		focusAgent: async () => {},
		externalIrc: options.externalIrc ?? null,
		externalSessionId: options.externalSessionId,
	});
}

function renderedText(hub: AgentHubOverlayComponent): string {
	return hub
		.render(120)
		.map(line => Bun.stripANSI(line))
		.join("\n");
}

async function waitForRenderedText(hub: AgentHubOverlayComponent, text: string): Promise<void> {
	const deadline = Date.now() + 1_000;
	while (!renderedText(hub).includes(text)) {
		if (Date.now() >= deadline) throw new Error(`Timed out waiting for ${text}`);
		await Bun.sleep(1);
	}
}

async function writeDirectChildJournal(options: {
	file: string;
	parentFile: string;
	agentId: string;
	updatedAt: string;
	state?: ChildLifecycleState;
	modelId?: string;
	thinkingLevel?: string;
}): Promise<void> {
	const entries = [
		{ type: "session", version: CURRENT_SESSION_VERSION, id: options.agentId, timestamp: options.updatedAt, cwd: "/tmp" },
		{
			type: "session_init",
			id: "init",
			parentId: null,
			timestamp: options.updatedAt,
			systemPrompt: "child",
			task: "archive test",
			tools: [],
			subagent: {
				agentId: options.agentId,
				parentSessionFile: options.parentFile,
				parentSessionId: "parent",
				displayName: options.agentId,
				model: options.modelId ?? "openai-codex/gpt-5.6-terra",
				taskDepth: 1,
				parentTaskPrefix: options.agentId,
				isolated: false,
			},
		},
		...(options.state
			? [
					{
						type: "custom",
						id: "lifecycle",
						parentId: null,
						timestamp: options.updatedAt,
						customType: CHILD_LIFECYCLE_CUSTOM_TYPE,
						data: {
							version: 1,
							agentId: options.agentId,
							childSessionFile: options.file,
							parentSessionFile: options.parentFile,
							state: options.state,
							updatedAt: options.updatedAt,
							modelId: options.modelId ?? "openai-codex/gpt-5.6-terra",
							thinkingLevel: options.thinkingLevel ?? "medium",
						},
					},
				]
			: []),
	];
	await Bun.write(options.file, `${entries.map(entry => JSON.stringify(entry)).join("\n")}\n`);
}

function renderedAgentIds(hub: AgentHubOverlayComponent): string[] {
	return hub
		.render(120)
		.map(line => Bun.stripANSI(line))
		.filter(line => {
			if (line.length <= 25) return false;
			const prefix = line.slice(0, 3);
			if (prefix !== " ❯ " && prefix !== "   ") return false;
			const stateCol = line.slice(17, 23).trim();
			return /[●○■×◌·✓~]/.test(stateCol);
		})
		.map(line => {
			const namePart = line.slice(23).trim();
			const cleanName = namePart.replace(/^[▸▾]\s*/, "");
			return cleanName.split(/\s+/)[0];
		})
		.filter(Boolean) as string[];
}

function renderedExternalPeerNames(hub: AgentHubOverlayComponent): string[] {
	return hub
		.render(120)
		.map(line => Bun.stripANSI(line))
		.filter(line => {
			if (line.length <= 25) return false;
			const prefix = line.slice(0, 3);
			if (prefix !== " ❯ " && prefix !== "   ") return false;
			const stateCol = line.slice(17, 23).trim();
			if (!/[●○■×◌·✓~]/.test(stateCol)) return false;
			return line.slice(23).toLowerCase().includes("external");
		})
		.map(line => {
			const namePart = line.slice(23).trim();
			return namePart.split(/\s+/)[0];
		})
		.filter(Boolean) as string[];
}

function externalPeer(
	sessionId: string,
	name: string,
	lastSeen: string,
	state: AgentHubExternalPeer["state"],
): AgentHubExternalPeer {
	return {
		sessionId,
		name,
		cwd: `/tmp/${name}`,
		pid: 100,
		lastSeen,
		state,
	};
}

describe("Agent hub row ordering", () => {
	let geometry: GeometryStub | undefined;

	beforeAll(async () => {
		await initTheme();
	});

	afterEach(() => {
		vi.restoreAllMocks();
		geometry?.restore();
		geometry = undefined;
		AgentRegistry.resetGlobalForTests();
	});

	it("keeps activity updates in place and appends sequential registrations", () => {
		geometry = stubStdoutGeometry(120);
		const now = vi.spyOn(Date, "now");
		const agents = new AgentRegistry();

		now.mockReturnValue(1000);
		agents.register({ id: "A", displayName: "Alpha", kind: "sub", session: liveSession() });
		now.mockReturnValue(2000);
		agents.register({ id: "B", displayName: "Beta", kind: "sub", session: liveSession() });
		now.mockReturnValue(3000);
		agents.register({ id: "C", displayName: "Gamma", kind: "sub", session: liveSession() });

		const hub = makeHub(agents);
		expect(renderedAgentIds(hub)).toEqual(["A", "B", "C"]);

		now.mockReturnValue(4000);
		agents.setActivity("A", "updated");
		expect(renderedAgentIds(hub)).toEqual(["A", "B", "C"]);
		agents.setStatus("A", "idle");
		expect(renderedAgentIds(hub)).toEqual(["B", "C", "A"]);
		expect(renderedText(hub)).toContain("○ IDLE A");

		now.mockReturnValue(5000);
		agents.register({ id: "D", displayName: "Delta", kind: "sub", session: liveSession() });
		expect(renderedAgentIds(hub)).toEqual(["B", "C", "D", "A"]);
		hub.dispose();
	});

	it("breaks forced spawn-index ties by stable agent id", () => {
		geometry = stubStdoutGeometry(120);
		const agents = new AgentRegistry();
		const zulu = agents.register({ id: "Zulu", displayName: "Zulu", kind: "sub", session: liveSession() });
		const alpha = agents.register({ id: "Alpha", displayName: "Alpha", kind: "sub", session: liveSession() });
		Object.defineProperty(zulu, "spawnIndex", { value: 42 });
		Object.defineProperty(alpha, "spawnIndex", { value: 42 });
		const hub = makeHub(agents);
		expect(renderedAgentIds(hub)).toEqual(["Alpha", "Zulu"]);
		hub.dispose();
	});

	it("keeps external peers in first-seen order and appends newcomers", () => {
		geometry = stubStdoutGeometry(120);
		const now = vi.spyOn(Date, "now");
		now.mockReturnValue(Date.parse("2026-07-03T00:00:00.000Z"));
		const lastSeen = new Date(Date.now()).toISOString();
		const agents = new AgentRegistry();
		let peers = [
			externalPeer("external:alpha", "alpha", lastSeen, "working"),
			externalPeer("external:beta", "beta", lastSeen, "idle"),
		];
		const externalIrc: AgentHubExternalPeerDataSource = {
			listPeers: () => peers,
		};

		const hub = makeHub(agents, { externalIrc, externalSessionId: "this-session" });
		expect(renderedExternalPeerNames(hub)).toEqual(["alpha", "beta"]);
		hub.handleInput("\r");
		const siblingView = Bun.stripANSI(hub.render(120).join("\n"));
		expect(siblingView).toContain("READONLY");
		expect(siblingView).toContain("cmd+p to real TUI");
		expect(siblingView).toContain("Sibling transcript path unavailable");
		hub.handleInput("\x1b");

		peers = [
			externalPeer("external:beta", "beta", lastSeen, "idle"),
			externalPeer("external:alpha", "alpha", lastSeen, "working"),
			externalPeer("external:gamma", "gamma", lastSeen, "waiting_input"),
		];
		agents.register({ id: "refresh", displayName: "Refresh", kind: "sub", session: liveSession() });

		expect(renderedExternalPeerNames(hub)).toEqual(["alpha", "beta", "gamma"]);
		hub.dispose();
	});

	it("shows unknown state when external peer state is absent", () => {
		geometry = stubStdoutGeometry(120);
		const now = vi.spyOn(Date, "now");
		now.mockReturnValue(Date.parse("2026-07-03T00:00:00.000Z"));
		const lastSeen = new Date(Date.now()).toISOString();
		const agents = new AgentRegistry();
		const externalIrc: AgentHubExternalPeerDataSource = {
			listPeers: () => [externalPeer("external:nemo", "nemo", lastSeen, undefined)],
		};

		const hub = makeHub(agents, { externalIrc, externalSessionId: "this-session" });
		const rendered = Bun.stripANSI(hub.render(120).join("\n"));

		expect(rendered).toContain("nemo");
		expect(rendered).toContain("UNKN");
		hub.dispose();
	});

	it("hides external peers when the bus is absent", () => {
		geometry = stubStdoutGeometry(120);
		const agents = new AgentRegistry();
		const externalIrc: AgentHubExternalPeerDataSource = {
			listPeers: () => {
				throw new Error("ENOENT: no IRC bus file");
			},
		};

		const hub = makeHub(agents, { externalIrc, externalSessionId: "this-session" });
		const rendered = Bun.stripANSI(hub.render(120).join("\n"));

		expect(rendered).not.toContain("external peers");
		expect(rendered).toContain("no subagents yet");
		hub.dispose();
	});

	it("hides archived children by default and shows terminal and legacy journals newest first after c", async () => {
		geometry = stubStdoutGeometry(120);
		using tempDir = TempDir.createSync("@omp-agent-hub-archive-order-");
		const parentFile = `${tempDir.path()}/Main.jsonl`;
		const childrenDir = `${tempDir.path()}/Main`;
		await fs.mkdir(childrenDir);
		await Bun.write(parentFile, "");
		await writeDirectChildJournal({
			file: `${childrenDir}/Newest.jsonl`,
			parentFile,
			agentId: "Newest",
			updatedAt: "2026-07-10T03:00:00.000Z",
			state: "completed",
		});
		await writeDirectChildJournal({
			file: `${childrenDir}/Failure.jsonl`,
			parentFile,
			agentId: "Failure",
			updatedAt: "2026-07-10T02:00:00.000Z",
			state: "failed",
		});
		await writeDirectChildJournal({
			file: `${childrenDir}/Legacy.jsonl`,
			parentFile,
			agentId: "Legacy",
			updatedAt: "2026-07-10T01:00:00.000Z",
		});

		const agents = new AgentRegistry();
		agents.register({ id: "Main", displayName: "main", kind: "main", session: null, sessionFile: parentFile, status: "parked" });
		const hub = new AgentHubOverlayComponent({
			observers: new SessionObserverRegistry(),
			hubKeys: [],
			onDone: () => {},
			requestRender: () => {},
			registry: agents,
			irc: new IrcBus(agents),
			focusAgent: async () => {},
			externalIrc: null,
		});

		expect(renderedText(hub)).not.toContain("Newest");
		expect(agents.list().map(ref => ref.id)).toEqual(["Main"]);
		hub.handleInput("c");
		await waitForRenderedText(hub, "Newest");

		expect(renderedAgentIds(hub)).toEqual(["Newest", "Failure", "Legacy"]);
		expect(renderedText(hub)).toContain("LEGC");
		expect(agents.list().map(ref => ref.id)).toEqual(["Main"]);
		hub.dispose();
	});

	it("asserts column widths, offsets, and semantic model aliases at different terminal widths", () => {
		const agents = new AgentRegistry();
		agents.register({ id: "Worker", displayName: "Worker", kind: "sub", session: liveSession() });

		const observers = new SessionObserverRegistry();
		const sessionsList: any[] = [
			{
				id: "Worker",
				kind: "subagent",
				label: "Worker subagent",
				status: "active",
				lastUpdate: Date.now(),
				progress: {
					id: "Worker",
					resolvedModel: "openai-codex/gpt-5.6-terra:high",
				},
			},
		];
		vi.spyOn(observers, "getSessions").mockReturnValue(sessionsList);

		const hub = new AgentHubOverlayComponent({
			observers,
			hubKeys: [],
			onDone: () => {},
			requestRender: () => {},
			registry: agents,
			irc: new IrcBus(agents),
			focusAgent: async () => {},
			externalIrc: null,
		});

		for (const w of [60, 80, 120, 160] as const) {
			const rendered = hub.render(w);
			const line = Bun.stripANSI(rendered.find(candidate => Bun.stripANSI(candidate).includes("Worker")) || "");

			const modelWidth = w <= 80 ? 13 : w <= 120 ? 14 : 15;
			const stateWidth = w <= 80 ? 6 : 7;
			const nameIndex = modelWidth + stateWidth;
			const expectedIndex = 3 + nameIndex;

			expect(expectedIndex).toBeGreaterThanOrEqual(22);
			expect(expectedIndex).toBeLessThanOrEqual(25);

			const namePart = line.slice(expectedIndex).trim();
			expect(namePart.startsWith("Worker")).toBe(true);

			const modelCol = line.slice(3, 3 + modelWidth);
			expect(modelCol.startsWith("S OX")).toBe(true);
			expect(modelCol.includes("5.6Tr")).toBe(true);
			expect(modelCol.includes("h")).toBe(true);
		}

		// Test adjacent variant distinction (claude-sonnet-4-5 vs claude-opus-4-5)
		sessionsList[0].progress.resolvedModel = "anthropic/claude-sonnet-4-5";
		const sonnetLine = Bun.stripANSI(hub.render(120).find(candidate => Bun.stripANSI(candidate).includes("Worker")) || "");
		const sonnetModelCol = sonnetLine.slice(3, 3 + 14);
		expect(sonnetModelCol.startsWith("A AN")).toBe(true);
		expect(sonnetModelCol.includes("4.5So")).toBe(true);

		sessionsList[0].progress.resolvedModel = "anthropic/claude-opus-4-5";
		const opusLine = Bun.stripANSI(hub.render(120).find(candidate => Bun.stripANSI(candidate).includes("Worker")) || "");
		const opusModelCol = opusLine.slice(3, 3 + 14);
		expect(opusModelCol.startsWith("A AN")).toBe(true);
		expect(opusModelCol.includes("4.5Op")).toBe(true);

		hub.dispose();
	});
});
