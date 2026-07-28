import * as fs from "node:fs/promises";
import { IrcBus } from "../src/irc/bus";
import { AgentHubOverlayComponent, type AgentHubRetentionMetrics } from "../src/modes/components/agent-hub";
import { SessionObserverRegistry } from "../src/modes/session-observer-registry";
import { initTheme } from "../src/modes/theme/theme";
import { AgentRegistry } from "../src/registry/agent-registry";
import { CURRENT_SESSION_VERSION } from "../src/session/session-entries";
import { CHILD_LIFECYCLE_CUSTOM_TYPE } from "../src/task/child-lifecycle";
import type { AgentSession } from "../src/session/agent-session";
import { TempDir } from "@oh-my-pi/pi-utils";

const ROW_COUNTS = [100, 1_000, 10_000] as const;
const WIDTH = 120;
const REPEATS = 20;
const ARCHIVE_TIMEOUT_MS = 10_000;
const VIEWPORT_ROW_LIMIT = 5;

interface GeometryStub {
	restore(): void;
}

interface BenchmarkSample {
	rows: number;
	mode: "refresh" | "filter" | "visible-window-render" | "archive-toggle";
	milliseconds: number;
	visibleRows: number;
	viewportRowLimit: number;
	retained: AgentHubRetentionMetrics;
	beforeEditStructuralModel: BeforeEditStructuralModel;
}

function stubStdoutGeometry(): GeometryStub {
	const rowsDesc = Object.getOwnPropertyDescriptor(process.stdout, "rows");
	const colsDesc = Object.getOwnPropertyDescriptor(process.stdout, "columns");
	Object.defineProperty(process.stdout, "rows", { configurable: true, get: () => 12 });
	Object.defineProperty(process.stdout, "columns", { configurable: true, get: () => WIDTH });
	return {
		restore() {
			if (rowsDesc) Object.defineProperty(process.stdout, "rows", rowsDesc);
			else Reflect.deleteProperty(process.stdout, "rows");
			if (colsDesc) Object.defineProperty(process.stdout, "columns", colsDesc);
			else Reflect.deleteProperty(process.stdout, "columns");
		},
	};
}

function liveSession(): AgentSession {
	const session: Pick<AgentSession, "subscribe"> = { subscribe: () => () => {} };
	return session as AgentSession;
}

function makeHub(registry: AgentRegistry): AgentHubOverlayComponent {
	return new AgentHubOverlayComponent({
		observers: new SessionObserverRegistry(),
		hubKeys: [],
		onDone: () => {},
		requestRender: () => {},
		registry,
		irc: new IrcBus(registry),
		focusAgent: async () => {},
		externalIrc: null,
	});
}

function makeRoster(rows: number): AgentRegistry {
	const registry = new AgentRegistry();
	for (let index = 0; index < rows; index++) {
		const id = `Agent${String(index).padStart(5, "0")}`;
		const ref = registry.register({ id, displayName: `Worker ${index}`, kind: "sub", session: liveSession() });
		ref.lastActivity = rows - index;
	}
	return registry;
}

function measure(repeats: number, operation: () => void): number {
	const startedAt = Bun.nanoseconds();
	for (let index = 0; index < repeats; index++) operation();
	return (Bun.nanoseconds() - startedAt) / 1e6 / repeats;
}

async function measureAsync(operation: () => Promise<void>): Promise<number> {
	const startedAt = Bun.nanoseconds();
	await operation();
	return (Bun.nanoseconds() - startedAt) / 1e6;
}

interface BeforeEditStructuralModel {
	/** Derived from the replaced always-warm search-cache shape, not a heap sample. */
	evidence: "structural-model";
	inactiveSearchFieldEntries: number;
}

function beforeEditStructuralModel(activeRows: number): BeforeEditStructuralModel {
	return { evidence: "structural-model", inactiveSearchFieldEntries: activeRows };
}

function visibleRowCount(hub: AgentHubOverlayComponent): number {
	const count = hub
		.render(WIDTH)
		.map(line => Bun.stripANSI(line))
		.filter(line => /(?:Agent|Archived)\d{5}/.test(line))
		.length;
	if (count > VIEWPORT_ROW_LIMIT) throw new Error(`Rendered ${count} roster rows outside the ${VIEWPORT_ROW_LIMIT}-row viewport`);
	return count;
}

async function waitForText(hub: AgentHubOverlayComponent, text: string): Promise<void> {
	const deadline = Date.now() + ARCHIVE_TIMEOUT_MS;
	while (!Bun.stripANSI(hub.render(WIDTH).join("\n")).includes(text)) {
		if (Date.now() >= deadline) throw new Error(`Timed out waiting for archived row ${text}`);
		await Bun.sleep(1);
	}
}

async function writeArchivedRows(parentFile: string, rows: number): Promise<void> {
	const childrenDir = parentFile.slice(0, -".jsonl".length);
	await fs.mkdir(childrenDir);
	for (let index = 0; index < rows; index++) {
		const agentId = `Archived${String(index).padStart(5, "0")}`;
		const childSessionFile = `${childrenDir}/${agentId}.jsonl`;
		const timestamp = "2026-07-10T03:00:00.000Z";
		const entries = [
			{ type: "session", version: CURRENT_SESSION_VERSION, id: agentId, timestamp, cwd: "/tmp" },
			{
				type: "session_init",
				id: "init",
				parentId: null,
				timestamp,
				systemPrompt: "benchmark",
				task: "archive benchmark",
				tools: [],
				subagent: {
					agentId,
					parentSessionFile: parentFile,
					parentSessionId: "parent",
					displayName: agentId,
					model: "openai-codex/gpt-5.6-terra",
					taskDepth: 1,
					parentTaskPrefix: agentId,
					isolated: false,
				},
			},
			{
				type: "custom",
				id: "lifecycle",
				parentId: null,
				timestamp,
				customType: CHILD_LIFECYCLE_CUSTOM_TYPE,
				data: {
					version: 1,
					agentId,
					childSessionFile,
					parentSessionFile: parentFile,
					state: "completed",
					updatedAt: timestamp,
					modelId: "openai-codex/gpt-5.6-terra",
					thinkingLevel: "medium",
				},
			},
		];
		await Bun.write(childSessionFile, `${entries.map(entry => JSON.stringify(entry)).join("\n")}\n`);
	}
}

async function benchmarkArchiveToggle(rows: number): Promise<BenchmarkSample> {
	using tempDir = TempDir.createSync("@omp-agent-hub-bench-");
	const parentFile = `${tempDir.path()}/Main.jsonl`;
	await Bun.write(parentFile, "");
	await writeArchivedRows(parentFile, rows);
	const registry = new AgentRegistry();
	registry.register({ id: "Main", displayName: "main", kind: "main", session: null, sessionFile: parentFile, status: "parked" });
	const hub = makeHub(registry);
	hub.render(WIDTH);
	const milliseconds = await measureAsync(async () => {
		hub.handleInput("c");
		await waitForText(hub, "Archived00000");
	});
	const visibleRows = visibleRowCount(hub);
	const retained = hub.getRetentionMetrics();
	hub.dispose();
	return {
		rows,
		mode: "archive-toggle",
		milliseconds,
		visibleRows,
		viewportRowLimit: VIEWPORT_ROW_LIMIT,
		retained,
		beforeEditStructuralModel: beforeEditStructuralModel(0),
	};
}

await initTheme("dark");
const geometry = stubStdoutGeometry();
const samples: BenchmarkSample[] = [];
try {
	for (const rows of ROW_COUNTS) {
		const registry = makeRoster(rows);
		const hub = makeHub(registry);
		hub.render(WIDTH);

		const refreshMs = measure(REPEATS, () => {
			const ref = registry.get("Agent00000")!;
			registry.setStatus(ref.id, ref.status === "running" ? "idle" : "running");
			hub.render(WIDTH);
		});
		samples.push({
			rows,
			mode: "refresh",
			milliseconds: refreshMs,
			visibleRows: visibleRowCount(hub),
			viewportRowLimit: VIEWPORT_ROW_LIMIT,
			retained: hub.getRetentionMetrics(),
			beforeEditStructuralModel: beforeEditStructuralModel(rows),
		});

		hub.handleInput("/");
		const filterMs = measure(REPEATS, () => {
			hub.handleInput("a");
			hub.handleInput("\x7f");
		});
		hub.handleInput("\r");
		samples.push({
			rows,
			mode: "filter",
			milliseconds: filterMs,
			visibleRows: visibleRowCount(hub),
			viewportRowLimit: VIEWPORT_ROW_LIMIT,
			retained: hub.getRetentionMetrics(),
			beforeEditStructuralModel: beforeEditStructuralModel(rows),
		});

		const visibleWindowMs = measure(REPEATS, () => {
			hub.handleInput("j");
			hub.render(WIDTH);
		});
		samples.push({
			rows,
			mode: "visible-window-render",
			milliseconds: visibleWindowMs,
			visibleRows: visibleRowCount(hub),
			viewportRowLimit: VIEWPORT_ROW_LIMIT,
			retained: hub.getRetentionMetrics(),
			beforeEditStructuralModel: beforeEditStructuralModel(rows),
		});
		hub.dispose();

		samples.push(await benchmarkArchiveToggle(rows));
	}
} finally {
	geometry.restore();
}

process.stdout.write(`${JSON.stringify({ benchmark: "agent-hub", width: WIDTH, repeats: REPEATS, samples })}\n`);
