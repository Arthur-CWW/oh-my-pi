import * as fs from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";
import { afterEach, beforeAll, describe, expect, it, vi } from "bun:test";
import { IrcBus } from "@oh-my-pi/pi-coding-agent/irc/bus";
import { AgentHubOverlayComponent } from "@oh-my-pi/pi-coding-agent/modes/components/agent-hub";
import {
	getAgentHubPerfCounters,
	resetAgentHubPerfCounters,
} from "@oh-my-pi/pi-coding-agent/modes/components/agent-hub-performance";
import { SessionObserverRegistry } from "@oh-my-pi/pi-coding-agent/modes/session-observer-registry";
import { initTheme } from "@oh-my-pi/pi-coding-agent/modes/theme/theme";
import { AgentRegistry } from "@oh-my-pi/pi-coding-agent/registry/agent-registry";
import { createSpawnRecord } from "@oh-my-pi/pi-coding-agent/task/spawn-record";


const tempRoots: string[] = [];
function hubFor(registry: AgentRegistry, requestRender = () => {}): AgentHubOverlayComponent {
	return new AgentHubOverlayComponent({
		observers: new SessionObserverRegistry(),
		hubKeys: [],
		onDone: () => {},
		requestRender,
		registry,
		irc: new IrcBus(registry),
		externalIrc: null,
	});
}

function text(hub: AgentHubOverlayComponent): string {
	return Bun.stripANSI(hub.render(120).join("\n"));
}

function registryWithParked(count: number): AgentRegistry {
	const registry = new AgentRegistry();
	registry.register({ id: "live", displayName: "live", kind: "sub", session: null, status: "running" });
	for (let index = 1; index < count; index++) {
		registry.register({
			id: `parked-${index}`,
			displayName: `parked-${index}`,
			kind: "sub",
			session: null,
			status: "parked",
		});
	}
	return registry;
}

beforeAll(async () => initTheme());
afterEach(async () => {
	vi.useRealTimers();
	AgentRegistry.resetGlobalForTests();
	await Promise.all(tempRoots.splice(0).map(root => fs.rm(root, { recursive: true, force: true })));
});

describe("Agent Hub sectioned projection", () => {
	it("orders live and historical sections, then hides only history with dot", () => {
		const registry = new AgentRegistry();
		registry.register({ id: "idle", displayName: "idle", kind: "sub", session: null, status: "idle" });
		registry.register({ id: "completed", displayName: "completed", kind: "sub", session: null, status: "idle" });
		registry.register({ id: "parked", displayName: "parked", kind: "sub", session: null, status: "parked" });
		registry.register({ id: "running", displayName: "running", kind: "sub", session: null, status: "running" });
		const hub = new AgentHubOverlayComponent({
			observers: new SessionObserverRegistry(),
			hubKeys: [],
			onDone: () => {},
			requestRender: () => {},
			registry,
			irc: new IrcBus(registry),
			externalIrc: null,
			turnStatus: id => (id === "completed" ? { inputId: "done", state: "completed", canCancel: false } : undefined),
		});

		const initial = text(hub);
		expect(initial.indexOf("Running (1)")).toBeLessThan(initial.indexOf("Idle / needs attention (1)"));
		expect(initial.indexOf("Idle / needs attention (1)")).toBeLessThan(initial.indexOf("Recent completed (1)"));
		expect(initial).toContain("Parked history (1)");
		expect(initial).toContain("■ PARK parked");

		hub.handleInput(".");
		const activeOnly = text(hub);
		expect(activeOnly).toContain("Running (1)");
		expect(activeOnly).toContain("Idle / needs attention (1)");
		expect(activeOnly).not.toContain("Recent completed");
		expect(activeOnly).not.toContain("Parked history");
		expect(activeOnly).toContain("2 hidden");
		hub.dispose();
	});

	it("batches a transition burst into one projection rebuild and render request per window", () => {
		vi.useFakeTimers();
		const registry = registryWithParked(120);
		let renders = 0;
		const hub = hubFor(registry, () => renders++);
		resetAgentHubPerfCounters();
		for (let index = 1; index <= 100; index++) registry.setStatus(`parked-${index}`, "idle");
		hub.render(120);
		expect(getAgentHubPerfCounters()).toEqual({ journalReads: 0, projectionRebuilds: 1 });
		vi.advanceTimersByTime(15);
		expect(renders).toBe(0);
		vi.advanceTimersByTime(1);
		expect(renders).toBe(1);
		expect(getAgentHubPerfCounters()).toEqual({ journalReads: 0, projectionRebuilds: 1 });
		expect(text(hub)).toContain("Idle / needs attention (100)");
		hub.dispose();
	});

	it("keeps active-only event projection independent of hidden history population at N=50/338/1000", () => {
		const measurements: Array<{ n: number; microseconds: number }> = [];
		// Warmup pass: the first hub exercises cold JIT/caches; discard it so the
		// N=50 measurement is not inflated relative to later sizes (ratio assertion below).
		for (const n of [50, 50, 338, 1000]) {
			const registry = registryWithParked(n);
			const hub = hubFor(registry);
			hub.handleInput(".");
			hub.render(120);
			const samples: number[] = [];
			for (let iteration = 0; iteration < 100; iteration++) {
				const next = iteration % 2 === 0 ? "idle" : "running";
				const start = Bun.nanoseconds();
				registry.setStatus("live", next);
				hub.render(120);
				samples.push((Bun.nanoseconds() - start) / 1_000);
			}
			samples.sort((a, b) => a - b);
			measurements.push({ n, microseconds: samples[94]! });
			hub.dispose();
		}
		measurements.shift(); // drop warmup
		console.info("agent-hub event→projection p95 µs", measurements);
		const values = measurements.map(row => row.microseconds);
		expect(Math.max(...values)).toBeLessThan(2_000);
		expect(Math.max(...values) / Math.max(1, Math.min(...values))).toBeLessThan(5);
	});

	it("keeps selected journal tail I/O async and single-flight across a render burst", async () => {
		const root = await fs.mkdtemp(path.join(os.tmpdir(), "agent-hub-projection-"));
		tempRoots.push(root);
		const sessionFile = path.join(root, "child.jsonl");
		await Bun.write(
			sessionFile,
			`${JSON.stringify({
				type: "message",
				id: "message-1",
				parentId: null,
				timestamp: new Date().toISOString(),
				message: {
					role: "user",
					content: [{ type: "text", text: "cached tail" }],
					timestamp: Date.now(),
				},
			})}\n`,
		);
		const registry = new AgentRegistry();
		registry.register({
			id: "selected",
			displayName: "selected",
			kind: "sub",
			session: null,
			sessionFile,
			status: "running",
		});
		resetAgentHubPerfCounters();
		const hub = hubFor(registry);
		expect(getAgentHubPerfCounters().journalReads).toBe(1);
		hub.openChat("selected");
		resetAgentHubPerfCounters();
		for (let index = 0; index < 100; index++) hub.render(120);
		expect(getAgentHubPerfCounters()).toEqual({ journalReads: 0, projectionRebuilds: 0 });
		const deadline = Date.now() + 1_000;
		while (!text(hub).includes("cached tail")) {
			if (Date.now() >= deadline) throw new Error("Timed out waiting for cached journal tail");
			await Bun.sleep(10);
		}
		expect(getAgentHubPerfCounters().journalReads).toBe(0);
		hub.dispose();
	});
	it("renders a persisted nested spawn packet in the selected inspector", async () => {
		const root = await fs.mkdtemp(path.join(os.tmpdir(), "agent-hub-spawn-packet-"));
		tempRoots.push(root);
		const sessionFile = path.join(root, "Parent.Child.jsonl");
		const spawnRecord = createSpawnRecord({
			agentId: "Parent.Child",
			spawnerId: "Parent",
			agentType: "reviewer",
			definitionSourcePath: "/tmp/project/.omp/agents/reviewer.md",
			context: "Nested context",
			assignment: "Nested assignment",
			buildVersion: "15.9.0",
			buildDigest: "b".repeat(64),
		});
		await Bun.write(
			sessionFile,
			`${JSON.stringify({
				type: "session",
				id: "nested",
				timestamp: new Date().toISOString(),
				cwd: root,
			})}\n${JSON.stringify({
				type: "session_init",
				id: "init",
				parentId: null,
				timestamp: new Date().toISOString(),
				systemPrompt: "reviewer",
				task: "Nested assignment",
				tools: [],
				subagent: {
					agentId: spawnRecord.agentId,
					parentSessionFile: path.join(root, "Parent.jsonl"),
					parentSessionId: "parent-session",
					displayName: "Parent.Child",
					model: "openai/gpt-5.6",
					thinkingLevel: null,
					isolated: false,
					taskDepth: 2,
					parentTaskPrefix: "Parent.Child",
					spawnRecord,
				},
			})}\n`,
		);
		const registry = new AgentRegistry();
		registry.register({
			id: "selected",
			displayName: "Parent.Child",
			kind: "sub",
			session: null,
			sessionFile,
			status: "running",
		});
		const hub = hubFor(registry);
		const deadline = Date.now() + 1_000;
		let rendered = text(hub);
		while (!rendered.includes("Nested assignment")) {
			if (Date.now() >= deadline) throw new Error("Timed out waiting for nested spawn inspector");
			await Bun.sleep(10);
			rendered = text(hub);
		}
		expect(rendered).toContain("Definition: /tmp/project/.omp/agents/reviewer.md");
		expect(rendered).toContain("Build: 15.9.0");
		expect(rendered).toContain(`Build digest: ${"b".repeat(64)}`);
		hub.dispose();
	});
});
