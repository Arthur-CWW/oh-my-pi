import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import * as fs from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";
import { AsyncJobManager } from "@oh-my-pi/pi-coding-agent/async/job-manager";
import { resetSettingsForTest, Settings, settings } from "@oh-my-pi/pi-coding-agent/config/settings";
import { IrcExternalBus } from "@oh-my-pi/pi-coding-agent/irc/bus-external";
import { AgentRegistry } from "@oh-my-pi/pi-coding-agent/registry/agent-registry";
import {
	recoverSpawnWorkerResultFromJournal,
	runSubagentSpawnProcess,
	runSyntheticSpawnWorkerWorkload,
	SpawnWorkerError,
} from "@oh-my-pi/pi-coding-agent/task/spawn-worker-client";
import { initializeSpawnWorkerSettings } from "@oh-my-pi/pi-coding-agent/task/spawn-worker-entry";
import type { SpawnWorkerRunRequest } from "@oh-my-pi/pi-coding-agent/task/spawn-worker-protocol";
import { SPAWN_WORKER_ARG } from "@oh-my-pi/pi-coding-agent/task/spawn-worker-protocol";
import type { SingleResult } from "@oh-my-pi/pi-coding-agent/task/types";
import type { ToolSession } from "@oh-my-pi/pi-coding-agent/tools";
import { IrcTool } from "@oh-my-pi/pi-coding-agent/tools/irc";

let tmpDir = "";
let previousHome: string | undefined;
let previousControlDb: string | undefined;
let previousWorkerMarker: string | undefined;

beforeEach(async () => {
	tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "omp-worker-reliability-"));
	previousHome = process.env.HOME;
	previousControlDb = process.env.OMP_SESSION_CONTROL_DB;
	previousWorkerMarker = process.env.OMP_SUBPROCESS_WORKER;
	process.env.HOME = tmpDir;
	process.env.OMP_SESSION_CONTROL_DB = path.join(tmpDir, "session-control.sqlite");
	delete process.env.OMP_SUBPROCESS_WORKER;
});

afterEach(async () => {
	if (previousHome === undefined) delete process.env.HOME;
	else process.env.HOME = previousHome;
	if (previousControlDb === undefined) delete process.env.OMP_SESSION_CONTROL_DB;
	else process.env.OMP_SESSION_CONTROL_DB = previousControlDb;
	if (previousWorkerMarker === undefined) delete process.env.OMP_SUBPROCESS_WORKER;
	else process.env.OMP_SUBPROCESS_WORKER = previousWorkerMarker;
	resetSettingsForTest();
	AgentRegistry.resetGlobalForTests();
	await fs.rm(tmpDir, { recursive: true, force: true });
});

function requestFor(sessionFile: string): SpawnWorkerRunRequest {
	return {
		version: 1,
		type: "run",
		requestId: "request-1",
		options: {
			cwd: tmpDir,
			id: "child-1",
			task: "report result",
			agent: { name: "task", description: "test", systemPrompt: "test", source: "bundled" },
			index: 0,
			sessionFile,
			outputSchema: undefined,
		},
		settings: {},
		registry: [],
	};
}
const JOURNAL_TIMESTAMP = "2026-01-01T00:00:00.000Z";
type TerminalPayload = Record<string, string | number | boolean>;

interface WorkerProcess {
	readonly pid: number;
	readonly pgid: number;
}

async function workerProcesses(): Promise<WorkerProcess[]> {
	const ps = Bun.spawn(["ps", "-axo", "pid=,pgid=,command="], { stdout: "pipe", stderr: "pipe" });
	const output = await new Response(ps.stdout).text();
	await ps.exited;
	const processes: WorkerProcess[] = [];
	for (const line of output.split("\n")) {
		if (!line.includes(SPAWN_WORKER_ARG)) continue;
		const columns = line.trim().split(/\s+/);
		const pid = Number(columns[0]);
		const pgid = Number(columns[1]);
		if (Number.isSafeInteger(pid) && Number.isSafeInteger(pgid)) processes.push({ pid, pgid });
	}
	return processes;
}

async function waitForWorkerProcessesToExit(processes: readonly WorkerProcess[]): Promise<void> {
	const pids = new Set(processes.map(process => process.pid));
	const pgids = new Set(processes.map(process => process.pgid));
	const stillRunning = (current: readonly WorkerProcess[]): boolean =>
		current.some(process => pids.has(process.pid) || pgids.has(process.pgid));
	for (let attempt = 0; attempt < 100; attempt++) {
		if (!stillRunning(await workerProcesses())) return;
		await Bun.sleep(20);
	}
	expect(stillRunning(await workerProcesses())).toBe(false);
}

async function writeTerminalWorkerExtension(
	extensionFile: string,
	sessionFile: string,
	payload: TerminalPayload,
	termination: "kill" | "exit",
	delayMs = 30,
): Promise<void> {
	const journal = `${[
		JSON.stringify({ type: "session", version: 4, id: "session-1", timestamp: JOURNAL_TIMESTAMP, cwd: tmpDir }),
		JSON.stringify({
			type: "message",
			id: "yield-message",
			parentId: null,
			timestamp: JOURNAL_TIMESTAMP,
			message: {
				role: "toolResult",
				toolCallId: "yield-call",
				toolName: "yield",
				content: [{ type: "text", text: "Result submitted." }],
				details: { status: "success", data: payload },
			},
		}),
	].join("\n")}\n`;
	const terminate = termination === "kill" ? 'process.kill(process.pid, "SIGKILL");' : "process.exit(0);";
	await Bun.write(
		extensionFile,
		`export default async function() {
	await Bun.sleep(${delayMs});
	await Bun.write(${JSON.stringify(sessionFile)}, ${JSON.stringify(journal)});
	${terminate}
}
`,
	);
}

async function waitForFile(filePath: string): Promise<void> {
	for (let attempt = 0; attempt < 100; attempt++) {
		try {
			await fs.access(filePath);
			return;
		} catch {
			await Bun.sleep(20);
		}
	}
	throw new Error(`Timed out waiting for ${filePath}`);
}

describe("subprocess worker reliability", () => {
	it("[I2/I4] recovers a journaled yield when the child is killed before pipe flush", async () => {
		const sessionFile = path.join(tmpDir, "child-killed.jsonl");
		const extensionFile = path.join(tmpDir, "kill-after-yield.ts");
		const payload = { ok: true, boundary: "yield-written" };
		await writeTerminalWorkerExtension(extensionFile, sessionFile, payload, "kill");
		const livenessStates: Array<"stalled" | "dead" | undefined> = [];

		const request = requestFor(sessionFile);
		const result = await runSubagentSpawnProcess(
			{
				...request.options,
				preloadedExtensionPaths: [extensionFile],
				onProgress: progress => livenessStates.push(progress.livenessState),
			},
			Settings.isolated(),
		);

		expect(result.exitCode).toBe(0);
		expect(result.output).toBe(JSON.stringify(payload, null, 2));
		expect(result.extractedToolData?.yield).toHaveLength(1);
		expect(livenessStates).not.toContain("dead");
	});

	it("[I4] recovers a terminal journal exactly when the pipe is torn and empty", async () => {
		const sessionFile = path.join(tmpDir, "child-torn-pipe.jsonl");
		const extensionFile = path.join(tmpDir, "exit-after-yield.ts");
		const payload = { answer: 42, status: "durable" };
		await writeTerminalWorkerExtension(extensionFile, sessionFile, payload, "exit");

		const request = requestFor(sessionFile);
		const result = await runSubagentSpawnProcess(
			{ ...request.options, preloadedExtensionPaths: [extensionFile] },
			Settings.isolated(),
		);

		expect(result.output).toBe(JSON.stringify(payload, null, 2));
		expect(result.extractedToolData?.yield).toHaveLength(1);
	});

	it("[I1] turns a pre-yield nonzero child exit into exactly one typed error", async () => {
		const sessionFile = path.join(tmpDir, "child-nonzero.jsonl");
		const extensionFile = path.join(tmpDir, "crash-nonzero.ts");
		await Bun.write(extensionFile, "export default function() { process.exit(23); }\n");

		const livenessStates: Array<"stalled" | "dead" | undefined> = [];
		const request = requestFor(sessionFile);
		let outcomes = 0;
		let typedError: SpawnWorkerError | undefined;
		const pending: Promise<SingleResult> = runSubagentSpawnProcess(
			{
				...request.options,
				preloadedExtensionPaths: [extensionFile],
				onProgress: progress => livenessStates.push(progress.livenessState),
			},
			Settings.isolated(),
		).then(
			result => {
				outcomes++;
				return result;
			},
			error => {
				outcomes++;
				if (!(error instanceof SpawnWorkerError)) throw error;
				typedError = error;
				throw error;
			},
		);
		try {
			await pending;
		} catch (error) {
			if (!(error instanceof SpawnWorkerError)) throw error;
		}

		expect(typedError?.code).toBe("exit");
		expect(outcomes).toBe(1);
		expect(livenessStates).toContain("dead");
	});
	it("[I1] probes a live slow child without terminating it", async () => {
		const sessionFile = path.join(tmpDir, "child-live-slow.jsonl");
		const extensionFile = path.join(tmpDir, "live-slow.ts");
		const payload = { ok: true, boundary: "slow-tool" };
		await writeTerminalWorkerExtension(extensionFile, sessionFile, payload, "exit", 150);
		const livenessStates: Array<"stalled" | "dead" | undefined> = [];

		const request = requestFor(sessionFile);
		const result = await runSubagentSpawnProcess(
			{
				...request.options,
				preloadedExtensionPaths: [extensionFile],
				onProgress: progress => livenessStates.push(progress.livenessState),
			},
			Settings.isolated({ "task.stallThresholdMs": 25 }),
		);

		expect(result.output).toBe(JSON.stringify(payload, null, 2));
		expect(livenessStates).toContain("stalled");
		expect(livenessStates).not.toContain("dead");
	});

	it("[I1] turns a pre-yield signal exit into exactly one typed error", async () => {
		const sessionFile = path.join(tmpDir, "child-signal.jsonl");
		const extensionFile = path.join(tmpDir, "crash-signal.ts");
		await Bun.write(extensionFile, 'export default function() { process.kill(process.pid, "SIGTERM"); }\n');

		const request = requestFor(sessionFile);
		let outcomes = 0;
		let typedError: SpawnWorkerError | undefined;
		const pending: Promise<SingleResult> = runSubagentSpawnProcess(
			{ ...request.options, preloadedExtensionPaths: [extensionFile] },
			Settings.isolated(),
		).then(
			result => {
				outcomes++;
				return result;
			},
			error => {
				outcomes++;
				if (!(error instanceof SpawnWorkerError)) throw error;
				typedError = error;
				throw error;
			},
		);
		try {
			await pending;
		} catch (error) {
			if (!(error instanceof SpawnWorkerError)) throw error;
		}

		expect(typedError).toBeInstanceOf(SpawnWorkerError);
		expect(outcomes).toBe(1);
	});

	it("detach relinquishes a real worker job without signaling its detached process group", async () => {
		const started = Promise.withResolvers<number>();
		const runPhase = Promise.withResolvers<void>();
		const manager = new AsyncJobManager({ maxRunningJobs: 2, onJobComplete: () => {} });
		const jobId = manager.register(
			"task",
			"detached worker",
			async () => {
				await runSyntheticSpawnWorkerWorkload(
					{ spinMs: 0, allocateBytes: 1024, hangMs: 10_000 },
					{
						onProcessStart: pid => started.resolve(pid),
						onPhase: phase => {
							if (phase === "run") runPhase.resolve();
						},
					},
				);
				return "done";
			},
			{ id: "DetachedWorker", ownerId: "Main" },
		);
		const job = manager.getJob(jobId);
		const pid = await started.promise;
		await runPhase.promise;
		try {
			expect(manager.detachRunningJobs({ ownerId: "Main", type: "task" })).toEqual(["DetachedWorker"]);
			await manager.dispose();
			expect(() => process.kill(pid, 0)).not.toThrow();
		} finally {
			try {
				process.kill(-pid, "SIGKILL");
			} catch {}
			await job?.promise;
		}
	});

	it("keeps a detached worker alive after its predecessor exits and closes the protocol pipe", async () => {
		const pidFile = path.join(tmpDir, "detached-worker.pid");
		const workerClientModule = path.resolve(import.meta.dir, "../../src/task/spawn-worker-client.ts");
		const helperSource = `
			import { writeFileSync } from "node:fs";
			const { runSyntheticSpawnWorkerWorkload } = await import(${JSON.stringify(workerClientModule)});
			await runSyntheticSpawnWorkerWorkload(
				{ spinMs: 0, allocateBytes: 1024, hangMs: 100, lingerAfterResultMs: 3_000 },
				{
					onProcessStart(pid) { writeFileSync(${JSON.stringify(pidFile)}, String(pid)); },
					onPhase(phase) { if (phase === "run") process.exit(0); },
				},
			);
		`;
		const predecessor = Bun.spawn({
			cmd: [process.execPath, "-e", helperSource],
			cwd: process.cwd(),
			env: {
				...process.env,
				HOME: tmpDir,
				OMP_SESSION_CONTROL_DB: path.join(tmpDir, "detached-session-control.sqlite"),
			},
			stdin: "ignore",
			stdout: "ignore",
			stderr: "inherit",
		});
		expect(await predecessor.exited).toBe(0);
		const workerPid = Number(await fs.readFile(pidFile, "utf8"));
		expect(Number.isSafeInteger(workerPid)).toBe(true);
		try {
			// The result projection happens after hangMs and hits the closed pipe.
			// Staying alive in the linger proves EPIPE did not terminate the work.
			await Bun.sleep(400);
			expect(() => process.kill(workerPid, 0)).not.toThrow();
		} finally {
			try {
				process.kill(-workerPid, "SIGKILL");
			} catch {}
		}
	});

	it("[I7] interrupts a running worker, reaps its process tree, and is idempotent", async () => {
		const controller = new AbortController();
		const runPhase = Promise.withResolvers<void>();
		const baseline = new Set((await workerProcesses()).map(process => process.pid));
		const pending = runSyntheticSpawnWorkerWorkload(
			{ spinMs: 0, allocateBytes: 1024, hangMs: 10_000 },
			{
				signal: controller.signal,
				onPhase: phase => {
					if (phase === "run") runPhase.resolve();
				},
			},
		);
		await runPhase.promise;
		const active = (await workerProcesses()).filter(process => !baseline.has(process.pid));
		expect(active.length).toBeGreaterThan(0);
		controller.abort();
		controller.abort();

		let typedError: SpawnWorkerError | undefined;
		try {
			await pending;
		} catch (error) {
			if (!(error instanceof SpawnWorkerError)) throw error;
			typedError = error;
		}
		expect(typedError?.code).toBe("aborted");
		await waitForWorkerProcessesToExit(active);
	});

	it("[I8] leaves no worker process or child-owned temp artifact after reap", async () => {
		const baseline = new Set((await workerProcesses()).map(process => process.pid));
		const runPhase = Promise.withResolvers<void>();
		const pending = runSyntheticSpawnWorkerWorkload(
			{ spinMs: 100, allocateBytes: 1024 },
			{
				onPhase: phase => {
					if (phase === "run") runPhase.resolve();
				},
			},
		);
		await runPhase.promise;
		const active = (await workerProcesses()).filter(process => !baseline.has(process.pid));
		const result = await pending;

		expect(result.allocatedBytes).toBe(1024);
		await waitForWorkerProcessesToExit(active);
		expect(await fs.readdir(tmpDir)).toEqual([]);
	});

	it("[I9] returns a terminal result, not running, after client journal recovery", async () => {
		const sessionFile = path.join(tmpDir, "child-terminal.jsonl");
		const extensionFile = path.join(tmpDir, "exit-terminal.ts");
		const payload = { terminal: true, recovered: true };
		await writeTerminalWorkerExtension(extensionFile, sessionFile, payload, "exit");

		const request = requestFor(sessionFile);
		const result = await runSubagentSpawnProcess(
			{ ...request.options, preloadedExtensionPaths: [extensionFile] },
			Settings.isolated(),
		);

		expect(result.exitCode).toBe(0);
		expect(result.aborted).not.toBe(true);
		expect(result.output).toBe(JSON.stringify(payload, null, 2));
		expect(result.extractedToolData?.yield).toHaveLength(1);
	});

	it("[I3][I8][D2] delivers a synthetic result before lingering and reaps its process group", async () => {
		const workerStarted = Promise.withResolvers<number>();
		const dispatchRequest = Promise.withResolvers<void>();
		const lingerAfterResultMs = 10_000;
		const pending = runSyntheticSpawnWorkerWorkload(
			{ spinMs: 0, allocateBytes: 1024, lingerAfterResultMs },
			{
				onProcessStart: async pid => {
					workerStarted.resolve(pid);
					await dispatchRequest.promise;
				},
				timeoutMs: 2_000,
			},
		);

		const workerPid = await workerStarted.promise;
		const active = (await workerProcesses()).filter(process => process.pid === workerPid);
		const startedAt = performance.now();
		dispatchRequest.resolve();

		const result = await pending;
		const resultDeliveryMs = performance.now() - startedAt;

		expect(active).toHaveLength(1);
		expect(active[0]!.pgid).toBe(active[0]!.pid);
		expect(result.allocatedBytes).toBe(1024);
		expect(resultDeliveryMs).toBeLessThan(lingerAfterResultMs / 2);
		await waitForWorkerProcessesToExit(active);
	});
	it.todo("[I9][D3] journal-terminal child must not report running (ledger D3)", () => {});

	it("[I4] recovers a durable yield when the final pipe record is absent", async () => {
		const sessionFile = path.join(tmpDir, "child-1.jsonl");
		const timestamp = JOURNAL_TIMESTAMP;
		await Bun.write(
			sessionFile,
			`${[
				JSON.stringify({ type: "session", version: 4, id: "session-1", timestamp, cwd: tmpDir }),
				JSON.stringify({
					type: "message",
					id: "yield-message",
					parentId: null,
					timestamp,
					message: {
						role: "toolResult",
						toolCallId: "yield-call",
						toolName: "yield",
						content: [{ type: "text", text: "Result submitted." }],
						details: { status: "success", data: { ok: true } },
					},
				}),
			].join("\n")}\n`,
		);

		const result = await recoverSpawnWorkerResultFromJournal(requestFor(sessionFile));
		expect(result?.exitCode).toBe(0);
		expect(result?.output).toContain('"ok": true');
		expect(result?.extractedToolData?.yield).toHaveLength(1);
	});

	it("[regression] initializes settings in the worker bootstrap for the edit guard seam", async () => {
		await initializeSpawnWorkerSettings({
			...requestFor(path.join(tmpDir, "child-1.jsonl")),
			settings: { "edit.mode": "hashline" },
		});
		expect(settings.get("edit.mode")).toBe("hashline");
	});

	it("[I8] exits the real worker subprocess promptly after its terminal record", async () => {
		const result = await runSyntheticSpawnWorkerWorkload({ spinMs: 0, allocateBytes: 1024 });
		expect(result.allocatedBytes).toBe(1024);
	});

	it("[HR-228] routes real subprocess IRC through the external bus", async () => {
		const bus = new IrcExternalBus(path.join(tmpDir, ".omp", "agent", "irc-bus.sqlite"));
		try {
			bus.registerPeer({
				sessionId: "coordinator-session",
				agentId: "Main",
				name: "coordinator",
				cwd: tmpDir,
				pid: process.pid,
			});
			const registry = AgentRegistry.global();
			registry.register({
				id: "child-1",
				displayName: "worker",
				kind: "sub",
				parentId: "Main",
				status: "running",
				session: null,
			});

			const sessionFile = path.join(tmpDir, "irc-child.jsonl");
			const toolFile = path.join(tmpDir, "irc-probe.ts");
			const readyFile = path.join(tmpDir, "irc-ready");
			const receivedFile = path.join(tmpDir, "irc-received.json");
			await Bun.write(
				toolFile,
				[
					`import { AgentRegistry } from ${JSON.stringify(path.resolve("src/registry/agent-registry.ts"))};`,
					`import { IrcExternalBus } from ${JSON.stringify(path.resolve("src/irc/bus-external.ts"))};`,
					`import { Settings } from ${JSON.stringify(path.resolve("src/config/settings.ts"))};`,
					`import { IrcTool } from ${JSON.stringify(path.resolve("src/tools/irc.ts"))};`,
					`const READY = ${JSON.stringify(readyFile)};`,
					`const RECEIVED = ${JSON.stringify(receivedFile)};`,
					"export default async function(pi) {",
					"  const registry = AgentRegistry.global();",
					'  const session = { cwd: process.cwd(), hasUI: false, settings: Settings.instance, getSessionFile: () => null, getSessionSpawns: () => "*", agentRegistry: registry, getAgentId: () => "child-1" };',
					'  const result = await new IrcTool(session).execute("probe", { op: "send", to: "Main", message: "worker-to-main" });',
					"  await Bun.write(READY, JSON.stringify({ isError: result.isError, details: result.details }));",
					"  await Bun.sleep(1000);",
					"  const bus = new IrcExternalBus();",
					'  await Bun.write(RECEIVED, JSON.stringify(bus.drainMessages("child-1")));',
					"  bus.close();",
					'  return { name: "irc_probe", label: "IRC probe", description: "IRC probe", parameters: pi.typebox.Type.Object({}), execute: async () => ({ content: [{ type: "text", text: "probe" }] }) };',
					"}",
				].join("\n"),
			);

			const pending = runSubagentSpawnProcess(
				{
					...requestFor(sessionFile).options,
					preloadedCustomToolPaths: [{ path: toolFile }],
					maxRuntimeMs: 5_000,
				},
				Settings.isolated({ "task.maxRuntimeMs": 5_000 }),
			);
			await Promise.race([
				waitForFile(readyFile),
				pending.then(
					() => {
						throw new Error("subprocess ended before the IRC probe became ready");
					},
					error => {
						throw error;
					},
				),
			]);
			expect(bus.findPeerByName("child-1")).toMatchObject({ agentId: "child-1", name: "child-1" });

			const coordinatorSession: ToolSession = {
				cwd: tmpDir,
				hasUI: false,
				settings: Settings.isolated(),
				getSessionFile: () => null,
				getSessionSpawns: () => "*",
				agentRegistry: registry,
				getAgentId: () => "Main",
			};
			const coordinatorResult = await new IrcTool(coordinatorSession, bus).execute("coordinator", {
				op: "send",
				to: "child-1",
				message: "main-to-worker",
			});
			expect(coordinatorResult.isError).toBeFalsy();
			expect(coordinatorResult.details?.receipts?.[0]?.outcome).toBe("injected");

			await pending;
			const outbound = bus.pollMessages("coordinator");
			expect(outbound).toHaveLength(1);
			expect(outbound[0]).toMatchObject({ fromPeer: "child-1", body: "worker-to-main" });
			await waitForFile(receivedFile);
			expect(JSON.parse(await fs.readFile(receivedFile, "utf8"))).toEqual(
				expect.arrayContaining([expect.objectContaining({ body: "main-to-worker", toPeer: "child-1" })]),
			);
			expect(bus.findPeerByName("child-1")).toBeUndefined();
		} finally {
			bus.close();
		}
	});

	it("[D4][regression] routes subprocess worker sends through the external IRC bus", async () => {
		const registry = AgentRegistry.global();
		registry.register({ id: "Main", displayName: "main", kind: "main", status: "running", session: null });
		const bus = new IrcExternalBus(path.join(tmpDir, "irc.sqlite"));
		bus.registerPeer({
			sessionId: "main-session",
			agentId: "Main",
			name: "main-peer",
			cwd: tmpDir,
			pid: process.pid,
		});
		process.env.OMP_SUBPROCESS_WORKER = "1";
		try {
			const toolSession: ToolSession = {
				cwd: tmpDir,
				hasUI: false,
				settings: Settings.isolated(),
				getSessionFile: () => null,
				getSessionSpawns: () => "*",
				agentRegistry: registry,
				getAgentId: () => "child-1",
			};
			const result = await new IrcTool(toolSession, bus).execute("irc", {
				op: "send",
				to: "Main",
				message: "hello",
			});
			expect(result.isError).toBeFalsy();
			expect(result.details?.receipts?.[0]?.outcome).toBe("injected");
			expect(bus.pollMessages("main-peer")[0]).toMatchObject({ body: "hello", fromPeer: "child-1" });
		} finally {
			bus.close();
		}
	});
});
