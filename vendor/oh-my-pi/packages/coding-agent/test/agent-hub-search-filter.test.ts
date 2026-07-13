/**
 * Agent Hub roster filtering, transcript search, stable-ID selection anchoring,
 * and default-to-oldest-registration behavior.
 */
import { afterEach, beforeAll, describe, expect, it, vi } from "bun:test";
import * as fs from "node:fs/promises";
import { IrcBus } from "@oh-my-pi/pi-coding-agent/irc/bus";
import {
	AgentHubOverlayComponent,
	type AgentHubTurnStatus,
} from "@oh-my-pi/pi-coding-agent/modes/components/agent-hub";
import { SessionObserverRegistry } from "@oh-my-pi/pi-coding-agent/modes/session-observer-registry";
import { initTheme } from "@oh-my-pi/pi-coding-agent/modes/theme/theme";
import { AgentRegistry, type AgentStatus } from "@oh-my-pi/pi-coding-agent/registry/agent-registry";
import type { AgentSession } from "@oh-my-pi/pi-coding-agent/session/agent-session";
import { CURRENT_SESSION_VERSION } from "@oh-my-pi/pi-coding-agent/session/session-entries";
import { CHILD_LIFECYCLE_CUSTOM_TYPE, type ChildLifecycleState } from "@oh-my-pi/pi-coding-agent/task/child-lifecycle";
import { TempDir } from "@oh-my-pi/pi-utils";

interface GeometryStub {
	setRows(n: number): void;
	restore(): void;
}

function stubStdoutGeometry(cols: number): GeometryStub {
	const rowsDesc = Object.getOwnPropertyDescriptor(process.stdout, "rows");
	const colsDesc = Object.getOwnPropertyDescriptor(process.stdout, "columns");
	let rows = 40;
	Object.defineProperty(process.stdout, "rows", { configurable: true, get: () => rows });
	Object.defineProperty(process.stdout, "columns", { configurable: true, get: () => cols });
	const restoreOne = (key: "rows" | "columns", desc: PropertyDescriptor | undefined) => {
		if (desc) Object.defineProperty(process.stdout, key, desc);
		else Reflect.deleteProperty(process.stdout, key);
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
	options: {
		focusAgent?: (id: string) => Promise<void>;
		initialAgentId?: string;
		turnStatus?: (agentId: string) => AgentHubTurnStatus | undefined;
	} = {},
) {
	let doneCalls = 0;
	const hub = new AgentHubOverlayComponent({
		observers: new SessionObserverRegistry(),
		hubKeys: [],
		onDone: () => {
			doneCalls++;
		},
		requestRender: () => {},
		registry: agents,
		irc: new IrcBus(agents),
		focusAgent: options.focusAgent ?? (async () => {}),
		externalIrc: null,
		turnStatus: options.turnStatus,
		initialAgentId: options.initialAgentId,
	});
	return { hub, doneCalls: () => doneCalls };
}

function liveSession(): AgentSession {
	const session: Pick<AgentSession, "subscribe"> = { subscribe: () => () => {} };
	return session as AgentSession;
}

function registerAgent(agents: AgentRegistry, id: string, status: AgentStatus = "running") {
	const session = status === "parked" ? null : liveSession();
	agents.register({ id, displayName: id, kind: "sub", session, status });
}

async function waitForRenderedText(hub: AgentHubOverlayComponent, text: string): Promise<void> {
	const deadline = Date.now() + 1_000;
	while (!renderedText(hub).includes(text)) {
		if (Date.now() >= deadline) throw new Error(`Timed out waiting for ${text}`);
		await Bun.sleep(1);
	}
}

async function writeArchivedChildJournal(options: {
	file: string;
	parentFile: string;
	agentId: string;
	updatedAt: string;
	state?: ChildLifecycleState;
	modelId?: string;
	thinkingLevel?: string;
}): Promise<void> {
	const entries = [
		{
			type: "session",
			version: CURRENT_SESSION_VERSION,
			id: options.agentId,
			timestamp: options.updatedAt,
			cwd: "/tmp",
		},
		{
			type: "session_init",
			id: "init",
			parentId: null,
			timestamp: options.updatedAt,
			systemPrompt: "child",
			task: "archive filter test",
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

function renderedText(hub: AgentHubOverlayComponent): string {
	return hub
		.render(120)
		.map(line => Bun.stripANSI(line))
		.join("\n");
}
function revealParked(hub: AgentHubOverlayComponent, id: string): void {
	hub.handleInput("/");
	for (const character of id) hub.handleInput(character);
	hub.handleInput("\r");
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

/** Return the id from the table row carrying the rendered navigation cursor. */
function selectedAgentId(hub: AgentHubOverlayComponent): string | undefined {
	for (const line of hub.render(120)) {
		const plain = Bun.stripANSI(line);
		if (plain.startsWith(" ❯ ")) {
			const namePart = plain.slice(23).trim();
			const cleanName = namePart.replace(/^[▸▾]\s*/, "");
			return cleanName.split(/\s+/)[0];
		}
	}
	return undefined;
}

describe("Agent Hub selection and filter", () => {
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

	it("defaults selection to the oldest-registration agent", () => {
		geometry = stubStdoutGeometry(120);
		const now = vi.spyOn(Date, "now");
		const agents = new AgentRegistry();
		now.mockReturnValue(1_000);
		registerAgent(agents, "Alpha");
		now.mockReturnValue(2_000);
		registerAgent(agents, "Beta");
		now.mockReturnValue(3_000);
		registerAgent(agents, "Gamma");
		const { hub } = makeHub(agents);
		expect(renderedAgentIds(hub)).toEqual(["Alpha", "Beta", "Gamma"]);
		expect(selectedAgentId(hub)).toBe("Alpha");
		hub.handleInput("n");
		expect(selectedAgentId(hub)).toBe("Beta");
		hub.handleInput("p");
		expect(selectedAgentId(hub)).toBe("Alpha");
		hub.handleInput("n");
		hub.handleInput("n");
		expect(selectedAgentId(hub)).toBe("Gamma");
		hub.handleInput("p");
		expect(selectedAgentId(hub)).toBe("Beta");
		hub.dispose();
	});

	it("opens on the agent currently attached in the main view", () => {
		geometry = stubStdoutGeometry(120);
		const agents = new AgentRegistry();
		registerAgent(agents, "Alpha");
		registerAgent(agents, "Beta");
		registerAgent(agents, "Gamma");
		const { hub } = makeHub(agents, { initialAgentId: "Beta" });
		expect(selectedAgentId(hub)).toBe("Beta");
		hub.handleInput("n");
		expect(selectedAgentId(hub)).toBe("Gamma");
		hub.handleInput("p");
		expect(selectedAgentId(hub)).toBe("Beta");
		hub.dispose();
	});

	it("keeps scroll and input modes modal", () => {
		geometry = stubStdoutGeometry(120);
		const agents = new AgentRegistry();
		registerAgent(agents, "Alpha");
		registerAgent(agents, "Beta");
		const { hub } = makeHub(agents);
		hub.handleInput("j");
		expect(selectedAgentId(hub)).toBe("Alpha");
		hub.handleInput("i");
		expect(renderedText(hub)).toContain("INPUT");
		hub.handleInput("n");
		expect(selectedAgentId(hub)).toBe("Alpha");
		hub.handleInput("\x1b");
		expect(renderedText(hub)).toContain("SCROLL");
		hub.handleInput("n");
		expect(selectedAgentId(hub)).toBe("Beta");
		hub.dispose();
	});

	it("toggles historical rows with hidden counts and migrates selection to the nearest visible row", () => {
		geometry = stubStdoutGeometry(120);
		const agents = new AgentRegistry();
		registerAgent(agents, "Alpha", "running");
		registerAgent(agents, "Beta", "idle");
		registerAgent(agents, "Gamma", "parked");
		registerAgent(agents, "Delta", "idle");
		const { hub } = makeHub(agents, {
			turnStatus: id => (id === "Beta" ? { inputId: "done", state: "completed", canCancel: false } : undefined),
		});

		expect(renderedAgentIds(hub)).toEqual(["Alpha", "Delta", "Beta", "Gamma"]);
		expect(renderedText(hub)).toContain(". hide history");
		hub.handleInput("n");
		hub.handleInput("n");
		expect(selectedAgentId(hub)).toBe("Beta");

		hub.handleInput(".");
		expect(renderedAgentIds(hub)).toEqual(["Alpha", "Delta"]);
		expect(selectedAgentId(hub)).toBe("Delta");
		expect(renderedText(hub)).toContain("2 hidden");
		expect(renderedText(hub)).toContain(". show history");

		hub.handleInput(".");
		expect(renderedAgentIds(hub)).toEqual(["Alpha", "Delta", "Beta", "Gamma"]);
		expect(selectedAgentId(hub)).toBe("Delta");
		expect(renderedText(hub)).toContain(". hide history");
		hub.handleInput("?");
		expect(renderedText(hub)).toContain(". show/hide history");
		hub.handleInput("?");

		hub.handleInput("/");
		hub.handleInput(".");
		expect(renderedText(hub)).toContain("/.");
		expect(renderedText(hub)).toContain(". hide history");
		hub.handleInput("\x1b");
		hub.handleInput("\x1b");
		hub.dispose();
	});

	it("renders the explicit empty active-history state", () => {
		geometry = stubStdoutGeometry(120);
		const agents = new AgentRegistry();
		registerAgent(agents, "Completed", "idle");
		registerAgent(agents, "Parked", "parked");
		const { hub } = makeHub(agents, {
			turnStatus: id => (id === "Completed" ? { inputId: "done", state: "completed", canCancel: false } : undefined),
		});

		hub.handleInput(".");
		const text = renderedText(hub);
		expect(text).toContain("No active subagents · . to show history");
		expect(text).toContain("2 hidden");
		hub.dispose();
	});

	it("preserves selection by stable ID when agents are added", () => {
		geometry = stubStdoutGeometry(120);
		vi.spyOn(Date, "now").mockReturnValue(1_000);
		const agents = new AgentRegistry();
		registerAgent(agents, "Alpha");
		registerAgent(agents, "Beta");

		const { hub } = makeHub(agents);
		// Default selects Alpha, the oldest registration.
		// Add a newcomer — Alpha must remain selected by its stable key.
		registerAgent(agents, "Gamma");
		expect(renderedAgentIds(hub)).toEqual(["Alpha", "Beta", "Gamma"]);
		expect(selectedAgentId(hub)).toBe("Alpha");

		// Non-first stable selection regression test
		hub.handleInput("n");
		expect(selectedAgentId(hub)).toBe("Beta");
		registerAgent(agents, "Delta");
		expect(renderedAgentIds(hub)).toEqual(["Alpha", "Beta", "Gamma", "Delta"]);
		expect(selectedAgentId(hub)).toBe("Beta");

		let focusedId: string | undefined;
		const agents2 = new AgentRegistry();
		registerAgent(agents2, "Alpha");
		registerAgent(agents2, "Beta");
		const { hub: hub2 } = makeHub(agents2, {
			focusAgent: async id => {
				focusedId = id;
			},
		});
		registerAgent(agents2, "Gamma");
		hub2.handleInput("\r");
		expect(focusedId).toBe("Alpha");

		hub.dispose();
		hub2.dispose();
	});

	it("n/p move through the roster", () => {
		geometry = stubStdoutGeometry(120);
		const agents = new AgentRegistry();
		registerAgent(agents, "Alpha");
		registerAgent(agents, "Beta");
		registerAgent(agents, "Gamma");

		const focus: { id: string | undefined } = { id: undefined };
		const focusedId = (): string | undefined => focus.id;
		const { hub } = makeHub(agents, {
			focusAgent: async id => {
				focus.id = id;
			},
		});
		// Oldest registrations are at the top.
		hub.handleInput("\r");
		expect(focusedId()).toBe("Alpha");

		// Move to the newest registration.
		hub.handleInput("n");
		hub.handleInput("n");
		focus.id = undefined;
		hub.handleInput("\r");
		expect(focusedId()).toBe("Gamma");

		hub.dispose();
	});

	it("renders only the terminal viewport and evicts inactive filter buffers from a 10k roster", () => {
		geometry = stubStdoutGeometry(120);
		geometry.setRows(10);
		vi.spyOn(Date, "now").mockReturnValue(1_000);
		const agents = new AgentRegistry();
		for (let index = 0; index < 10_000; index++) {
			registerAgent(agents, `Agent${String(index).padStart(4, "0")}`);
		}
		const { hub } = makeHub(agents);

		expect(renderedAgentIds(hub)).toEqual(["Agent0000", "Agent0001", "Agent0002"]);
		expect(hub.getRetentionMetrics()).toMatchObject({
			activeIdentities: 10_000,
			activeSearchFieldEntries: 0,
			materializedRows: 3,
		});
		for (let i = 0; i < 10_000; i++) hub.handleInput("n");
		expect(renderedAgentIds(hub)).toEqual(["Agent9997", "Agent9998", "Agent9999"]);

		hub.handleInput("/");
		expect(hub.getRetentionMetrics().activeSearchFieldEntries).toBe(10_000);
		hub.handleInput("\x1b");
		expect(hub.getRetentionMetrics().activeSearchFieldEntries).toBe(0);
		hub.dispose();
	});

	it("/ activates filter and narrows visible rows", () => {
		geometry = stubStdoutGeometry(120);
		const agents = new AgentRegistry();
		const now = vi.spyOn(Date, "now");
		now.mockReturnValue(1_000);
		registerAgent(agents, "AuthLoader");
		now.mockReturnValue(2_000);
		registerAgent(agents, "DataParser");
		now.mockReturnValue(3_000);
		registerAgent(agents, "AuthValidator");

		const { hub } = makeHub(agents);
		expect(renderedAgentIds(hub)).toEqual(["AuthLoader", "DataParser", "AuthValidator"]);

		// Type / to enter filter mode
		hub.handleInput("/");
		// Type "auth" incrementally
		hub.handleInput("a");
		hub.handleInput("u");
		hub.handleInput("t");
		hub.handleInput("h");

		// Only Auth* agents should be visible
		const filtered = renderedAgentIds(hub);
		expect(filtered).toEqual(["AuthLoader", "AuthValidator"]);
		expect(filtered).not.toContain("DataParser");

		// The rendered output should show the filter indicator
		const text = renderedText(hub);
		expect(text).toContain("/auth");
		expect(text).toContain("2/3");

		hub.dispose();
	});
	it("treats vim navigation letters as filter text while text entry is focused", () => {
		geometry = stubStdoutGeometry(120);
		const agents = new AgentRegistry();
		registerAgent(agents, "Alpha");
		registerAgent(agents, "JkWorker");
		const { hub } = makeHub(agents);

		hub.handleInput("/");
		hub.handleInput("j");
		hub.handleInput("k");

		expect(renderedText(hub)).toContain("/jk");
		expect(renderedAgentIds(hub)).toEqual(["JkWorker"]);
		hub.dispose();
	});

	it("Esc clears filter before closing hub", () => {
		geometry = stubStdoutGeometry(120);
		const agents = new AgentRegistry();
		registerAgent(agents, "AuthLoader");
		registerAgent(agents, "DataParser");

		const { hub, doneCalls } = makeHub(agents);

		// Enter filter, type something
		hub.handleInput("/");
		hub.handleInput("a");
		hub.handleInput("u");
		// Exit filter editing with Enter
		hub.handleInput("\r");

		expect(renderedAgentIds(hub)).toEqual(["AuthLoader"]);

		// First Esc clears the filter
		hub.handleInput("\x1b");
		expect(renderedAgentIds(hub)).toEqual(["AuthLoader", "DataParser"]);
		expect(doneCalls()).toBe(0);

		// Second Esc closes the hub
		hub.handleInput("\x1b");
		expect(doneCalls()).toBe(1);

		hub.dispose();
	});

	it("filter does not accidentally select a different agent", () => {
		geometry = stubStdoutGeometry(120);
		const agents = new AgentRegistry();
		registerAgent(agents, "Alpha");
		registerAgent(agents, "Beta");
		registerAgent(agents, "AlphaChild");

		let focusedId: string | undefined;
		const { hub } = makeHub(agents, {
			focusAgent: async id => {
				focusedId = id;
			},
		});

		// Default selects Alpha (oldest). Keep Alpha selected while filtering.

		// Apply a filter that includes Alpha.
		hub.handleInput("/");
		hub.handleInput("A");
		hub.handleInput("l");
		hub.handleInput("p");
		hub.handleInput("h");
		hub.handleInput("a");
		hub.handleInput("\r"); // confirm filter

		// Alpha and AlphaChild visible; Alpha should still be selected.
		expect(renderedAgentIds(hub)).toEqual(["Alpha", "AlphaChild"]);
		hub.handleInput("\r");
		expect(focusedId).toBe("Alpha");

		hub.dispose();
	});

	it("clamps selection when filtering removes the selected row", () => {
		geometry = stubStdoutGeometry(120);
		const agents = new AgentRegistry();
		registerAgent(agents, "Alpha");
		registerAgent(agents, "Beta");
		registerAgent(agents, "Gamma");
		const { hub } = makeHub(agents);
		hub.handleInput("n");
		expect(selectedAgentId(hub)).toBe("Beta");
		hub.handleInput("/");
		for (const key of "Alpha") hub.handleInput(key);
		expect(selectedAgentId(hub)).toBe("Alpha");
		hub.dispose();
	});

	it("filters shown archived descriptors by id, terminal state, and route without registering them", async () => {
		geometry = stubStdoutGeometry(120);
		using tempDir = TempDir.createSync("@omp-agent-hub-archive-filter-");
		const parentFile = `${tempDir.path()}/Main.jsonl`;
		const childrenDir = `${tempDir.path()}/Main`;
		await fs.mkdir(childrenDir);
		await Bun.write(parentFile, "");
		await writeArchivedChildJournal({
			file: `${childrenDir}/FinishedBuild.jsonl`,
			parentFile,
			agentId: "FinishedBuild",
			updatedAt: "2026-07-10T03:00:00.000Z",
			state: "completed",
			modelId: "openai-codex/gpt-5.6-terra",
			thinkingLevel: "high",
		});
		await writeArchivedChildJournal({
			file: `${childrenDir}/FailedAuth.jsonl`,
			parentFile,
			agentId: "FailedAuth",
			updatedAt: "2026-07-10T02:00:00.000Z",
			state: "failed",
			modelId: "anthropic/claude-sonnet",
			thinkingLevel: "medium",
		});
		await writeArchivedChildJournal({
			file: `${childrenDir}/LegacyWorker.jsonl`,
			parentFile,
			agentId: "LegacyWorker",
			updatedAt: "2026-07-10T01:00:00.000Z",
			modelId: "anthropic/claude-haiku",
		});
		const agents = new AgentRegistry();
		agents.register({
			id: "Main",
			displayName: "main",
			kind: "main",
			session: null,
			sessionFile: parentFile,
			status: "parked",
		});
		const { hub } = makeHub(agents);

		await waitForRenderedText(hub, "FinishedBuild");
		expect(renderedAgentIds(hub)).toEqual(["FinishedBuild", "FailedAuth", "LegacyWorker"]);

		hub.handleInput(".");
		expect(renderedAgentIds(hub)).toEqual([]);
		expect(renderedText(hub)).toContain("3 hidden");
		hub.handleInput(".");
		expect(renderedAgentIds(hub)).toEqual(["FinishedBuild", "FailedAuth", "LegacyWorker"]);

		hub.handleInput("/");
		for (const key of "failed") hub.handleInput(key);
		expect(renderedAgentIds(hub)).toEqual(["FailedAuth"]);
		hub.handleInput("\x1b");
		hub.handleInput("/");
		for (const key of "terra") hub.handleInput(key);
		expect(renderedAgentIds(hub)).toEqual(["FinishedBuild"]);
		expect(agents.list().map(ref => ref.id)).toEqual(["Main"]);
		hub.dispose();
	});

	it("returns from detail with the same roster cursor and viewport", () => {
		geometry = stubStdoutGeometry(120);
		vi.spyOn(Date, "now").mockReturnValue(1_000);
		geometry.setRows(10);
		const agents = new AgentRegistry();
		for (let i = 1; i <= 10; i++) {
			registerAgent(agents, `Agent${String(i).padStart(2, "0")}`, i === 8 ? "parked" : "running");
		}
		const { hub } = makeHub(agents);
		for (let i = 0; i < 7; i++) hub.handleInput("n");
		const before = renderedAgentIds(hub);
		hub.handleInput("\r");
		hub.handleInput("h");
		expect(renderedAgentIds(hub)).toEqual(before);
		hub.handleInput("n");
		expect(selectedAgentId(hub)).toBe("Agent10");
		hub.dispose();
	});

	it("restores a searched parked selection on return from chat", () => {
		vi.spyOn(Date, "now").mockReturnValue(1_000);
		geometry = stubStdoutGeometry(120);
		const agents = new AgentRegistry();
		registerAgent(agents, "Alpha");
		registerAgent(agents, "Beta", "parked");
		registerAgent(agents, "Gamma");

		const focus: { id: string | undefined } = { id: undefined };
		const focusedId = (): string | undefined => focus.id;
		const { hub } = makeHub(agents, {
			focusAgent: async id => {
				focus.id = id;
			},
		});

		revealParked(hub, "Beta");
		hub.handleInput("\r");
		hub.handleInput("\x1b");
		expect(selectedAgentId(hub)).toBe("Beta");

		hub.handleInput("\x1b");
		hub.handleInput("p");
		hub.handleInput("\r");
		expect(focusedId()).toBe("Gamma");

		hub.dispose();
	});
});

describe("Agent Hub transcript search", () => {
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

	it("/ in chat view enters search mode and Esc clears before closing", () => {
		geometry = stubStdoutGeometry(120);
		const agents = new AgentRegistry();
		registerAgent(agents, "Worker", "parked");

		const { hub, doneCalls } = makeHub(agents);
		revealParked(hub, "Worker");
		hub.handleInput("\r"); // open chat for parked Worker

		// Verify we're in chat view
		let text = renderedText(hub);
		expect(text).toContain("Agent Hub > Worker");

		// Enter search mode
		hub.handleInput("/");
		text = renderedText(hub);
		// Should show the search input prompt
		expect(text).toContain("/");

		// Type a query
		hub.handleInput("t");
		hub.handleInput("e");
		hub.handleInput("s");
		hub.handleInput("t");

		text = renderedText(hub);
		expect(text).toContain("/test");

		// Confirm search with Enter
		hub.handleInput("\r");

		// Esc should clear search first (not close chat)
		hub.handleInput("\x1b");
		text = renderedText(hub);
		// Should still be in chat view (search was cleared, not closed)
		expect(text).toContain("Agent Hub > Worker");
		// Search indicator should be gone
		expect(text).not.toContain("/test");

		// Second Esc closes chat back to table
		hub.handleInput("\x1b");
		text = renderedText(hub);
		expect(text).toContain("Agent Hub");
		expect(text).not.toContain("Agent Hub > Worker");

		hub.dispose();
	});

	it("Esc during search editing clears query and exits editing", () => {
		geometry = stubStdoutGeometry(120);
		const agents = new AgentRegistry();
		registerAgent(agents, "Worker", "parked");

		const { hub } = makeHub(agents);
		revealParked(hub, "Worker");
		hub.handleInput("\r"); // open chat

		// Enter search, type, then Esc during editing
		hub.handleInput("/");
		hub.handleInput("f");
		hub.handleInput("o");
		hub.handleInput("o");
		hub.handleInput("\x1b"); // Esc during editing

		const text = renderedText(hub);
		// Should still be in chat view but search cleared
		expect(text).toContain("Agent Hub > Worker");
		expect(text).not.toContain("/foo");

		hub.dispose();
	});

	it("backspace removes characters from filter query", () => {
		geometry = stubStdoutGeometry(120);
		const agents = new AgentRegistry();
		const now = vi.spyOn(Date, "now");
		now.mockReturnValue(1_000);
		registerAgent(agents, "AuthLoader");
		now.mockReturnValue(2_000);
		registerAgent(agents, "DataParser");
		now.mockReturnValue(3_000);
		registerAgent(agents, "AuthValidator");

		const { hub } = makeHub(agents);

		hub.handleInput("/");
		hub.handleInput("d");
		hub.handleInput("a");
		hub.handleInput("t");
		hub.handleInput("a");
		hub.handleInput("p");

		// "datap" matches only DataParser
		expect(renderedAgentIds(hub)).toEqual(["DataParser"]);

		// Backspace to "dat" — matches DataParser and AuthValidator (authvaliDATor)
		hub.handleInput("\x7f"); // backspace
		hub.handleInput("\x7f");
		expect(renderedAgentIds(hub)).toEqual(["DataParser", "AuthValidator"]);

		// Backspace all remaining chars
		hub.handleInput("\x7f");
		hub.handleInput("\x7f");
		hub.handleInput("\x7f");

		// Filter is now empty — all agents visible
		expect(renderedAgentIds(hub)).toEqual(["AuthLoader", "DataParser", "AuthValidator"]);

		hub.dispose();
	});

	it("footer shows search and filter hints", () => {
		geometry = stubStdoutGeometry(120);
		const agents = new AgentRegistry();
		registerAgent(agents, "Worker", "parked");

		const { hub } = makeHub(agents);

		// Table view footer should mention /:filter
		let text = renderedText(hub);
		expect(text).toContain("/:filter");
		expect(text).toContain("g/G:");

		// Enter on parked agent opens chat view (not focusAgent)
		revealParked(hub, "Worker");
		hub.handleInput("\r");
		text = renderedText(hub);
		expect(text).toContain("/:search");
		expect(text).toContain("g/G:");

		hub.dispose();
	});
	it("defaults to tree topology while retaining child selection", () => {
		geometry = stubStdoutGeometry(120);
		const agents = new AgentRegistry();
		agents.register({ id: "Pod", displayName: "Pod", kind: "sub", session: liveSession(), status: "running" });
		agents.register({
			id: "Pod.Leaf",
			displayName: "Leaf",
			kind: "sub",
			parentId: "Pod",
			session: liveSession(),
			status: "running",
		});
		const { hub } = makeHub(agents);
		expect(renderedText(hub)).toContain("Agent Hub · tree");
		hub.handleInput("n");
		expect(renderedText(hub)).toContain("Pod.Leaf");
		hub.dispose();
	});

	it("folds tree descendants and keeps table materialization viewport-bounded", () => {
		geometry = stubStdoutGeometry(120);
		geometry.setRows(20);
		const agents = new AgentRegistry();
		agents.register({ id: "Pod", displayName: "Pod", kind: "sub", session: liveSession(), status: "running" });
		for (let index = 0; index < 10_000; index++) {
			agents.register({
				id: `Pod.${index}`,
				displayName: `Leaf ${index}`,
				kind: "sub",
				parentId: "Pod",
				session: liveSession(),
				status: "running",
			});
		}
		const { hub } = makeHub(agents);
		hub.handleInput("h");
		expect(renderedText(hub)).toContain("(+10000 · 10000 run)");
		expect(hub.getRetentionMetrics().materializedRows).toBeLessThan(20);
		hub.dispose();
	});
});
