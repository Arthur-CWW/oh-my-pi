import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import * as fsSync from "node:fs";
import * as fs from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";
import { AsyncJobManager } from "@oh-my-pi/pi-coding-agent/async/job-manager";
import { resetSettingsForTest, Settings, settings } from "@oh-my-pi/pi-coding-agent/config/settings";
import { IrcExternalBus } from "@oh-my-pi/pi-coding-agent/irc/bus-external";
import { AgentRegistry } from "@oh-my-pi/pi-coding-agent/registry/agent-registry";
import {
	JournalRecoveryError,
	recoverSpawnWorkerResultFromJournal,
	runSubagentSpawnProcess,
	runSyntheticSpawnWorkerWorkload,
	SpawnWorkerError,
} from "@oh-my-pi/pi-coding-agent/task/spawn-worker-client";
import { initializeSpawnWorkerSettings, readJournalYieldTail } from "@oh-my-pi/pi-coding-agent/task/spawn-worker-entry";
import {
	decodeSpawnWorkerRecord,
	decodeSpawnWorkerRequest,
	SPAWN_WORKER_ARG,
	SPAWN_WORKER_JOURNAL_START_MARKER,
	SPAWN_WORKER_PROTOCOL_VERSION,
	type SpawnWorkerRunRequest,
} from "@oh-my-pi/pi-coding-agent/task/spawn-worker-protocol";
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

const TEST_LAUNCH_GENERATION = "launch-generation-1";
const TEST_JOURNAL_START_NONCE = "journal-start-1";

function requestFor(sessionFile: string): SpawnWorkerRunRequest {
	return {
		version: SPAWN_WORKER_PROTOCOL_VERSION,
		type: "run",
		requestId: "request-1",
		launchGeneration: TEST_LAUNCH_GENERATION,
		journalStartNonce: TEST_JOURNAL_START_NONCE,
		options: {
			cwd: tmpDir,
			id: "child-1",
			task: "report result",
			agent: {
				name: "task",
				description: "test",
				systemPrompt: "test",
				source: "bundled",
			},
			index: 0,
			sessionFile,
			outputSchema: undefined,
		},
		settings: {},
		registry: [],
	};
}

function v1RequestFor(sessionFile: string): SpawnWorkerRunRequest {
	const request = requestFor(sessionFile);
	return {
		version: 1,
		type: request.type,
		requestId: request.requestId,
		options: request.options,
		settings: request.settings,
		registry: request.registry,
	};
}

const JOURNAL_TIMESTAMP = "2026-01-01T00:00:00.000Z";
type TerminalPayload = Record<string, string | number | boolean>;

interface WorkerProcess {
	readonly pid: number;
	readonly pgid: number;
}

async function workerProcesses(): Promise<WorkerProcess[]> {
	const ps = Bun.spawn(["ps", "-axo", "pid=,pgid=,command="], {
		stdout: "pipe",
		stderr: "pipe",
	});
	const output = await new Response(ps.stdout).text();
	await ps.exited;
	const processes: WorkerProcess[] = [];
	for (const line of output.split("\n")) {
		if (!line.includes(SPAWN_WORKER_ARG)) continue;
		const columns = line.trim().split(/\s+/);
		const pid = Number(columns[0]);
		const pgid = Number(columns[1]);
		if (Number.isSafeInteger(pid) && Number.isSafeInteger(pgid)) {
			processes.push({ pid, pgid });
		}
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

function terminalYield(payload: TerminalPayload): string {
	return `${JSON.stringify({
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
	})}\n`;
}

function terminalJournal(payload: TerminalPayload): string {
	return `${[
		JSON.stringify({
			type: "session",
			version: 4,
			id: "session-1",
			timestamp: JOURNAL_TIMESTAMP,
			cwd: tmpDir,
		}),
		JSON.stringify({
			type: "custom",
			customType: SPAWN_WORKER_JOURNAL_START_MARKER,
			data: {
				requestId: "request-1",
				launchGeneration: TEST_LAUNCH_GENERATION,
				nonce: TEST_JOURNAL_START_NONCE,
			},
			id: "turn-start",
			parentId: null,
			timestamp: JOURNAL_TIMESTAMP,
		}),
	].join("\n")}\n${terminalYield(payload)}`;
}

async function writeTerminalWorkerExtension(
	extensionFile: string,
	sessionFile: string,
	payload: TerminalPayload,
	termination: "kill" | "exit" | "hang",
	delayMs = 30,
	barrierFile?: string,
): Promise<void> {
	const terminate =
		termination === "kill"
			? 'process.kill(process.pid, "SIGKILL");'
			: termination === "exit"
				? "process.exit(0);"
				: "await Bun.sleep(10_000);";
	await Bun.write(
		extensionFile,
		`import * as fs from "node:fs/promises";
export default async function() {
	await Bun.sleep(${delayMs});
	await fs.appendFile(${JSON.stringify(sessionFile)}, ${JSON.stringify(terminalYield(payload))});
	${barrierFile ? `await Bun.write(${JSON.stringify(barrierFile)}, "written");` : ""}
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

interface RogueWorkerOutcome {
	readonly ok: boolean;
	readonly name?: string;
	readonly code?: string;
	readonly message?: string;
}

async function runPreReadyYieldWorker(sessionFile: string, payload: TerminalPayload): Promise<RogueWorkerOutcome> {
	const codingAgentRoot = path.resolve(import.meta.dir, "..", "..");
	const hostFile = path.join(tmpDir, "pre-ready-yield-host.ts");
	const outcomeFile = path.join(tmpDir, "pre-ready-yield-outcome.json");
	const clientModule = path.join(codingAgentRoot, "src", "task", "spawn-worker-client.ts");
	const protocolModule = path.join(codingAgentRoot, "src", "task", "spawn-worker-protocol.ts");
	const settingsModule = path.join(codingAgentRoot, "src", "config", "settings.ts");
	const workerHostModule = path.resolve(codingAgentRoot, "..", "utils", "src", "worker-host.ts");
	const options = requestFor(sessionFile).options;
	await Bun.write(
		hostFile,
		`import { Settings } from ${JSON.stringify(settingsModule)};
import { runSubagentSpawnProcess, SpawnWorkerError } from ${JSON.stringify(clientModule)};
import { SPAWN_WORKER_ARG } from ${JSON.stringify(protocolModule)};
import { declareWorkerHostEntry } from ${JSON.stringify(workerHostModule)};

if (process.argv.includes(SPAWN_WORKER_ARG)) {
	const request = JSON.parse((await Bun.stdin.text()).trim());
	await Bun.write(request.options.sessionFile, ${JSON.stringify(terminalJournal(payload))});
	process.stdout.write(
		JSON.stringify({ version: request.version, type: "yield-written", requestId: request.requestId }) + "\\n",
	);
	await Bun.sleep(10_000);
} else {
	declareWorkerHostEntry();
	try {
		await runSubagentSpawnProcess(${JSON.stringify(options)}, Settings.isolated(), { timeoutMs: 2_000 });
		await Bun.write(${JSON.stringify(outcomeFile)}, JSON.stringify({ ok: true }));
	} catch (error) {
		await Bun.write(
			${JSON.stringify(outcomeFile)},
			JSON.stringify({
				ok: false,
				name: error instanceof Error ? error.name : undefined,
				code: error instanceof SpawnWorkerError ? error.code : undefined,
				message: error instanceof Error ? error.message : String(error),
			}),
		);
	}
}
`,
	);
	const proc = Bun.spawn([process.execPath, hostFile], {
		cwd: codingAgentRoot,
		env: Bun.env,
		stdout: "pipe",
		stderr: "pipe",
	});
	const [exitCode, stdout, stderr] = await Promise.all([
		proc.exited,
		new Response(proc.stdout).text(),
		new Response(proc.stderr).text(),
	]);
	if (exitCode !== 0) {
		throw new Error(`Rogue worker host exited ${exitCode}: ${stderr || stdout}`);
	}
	return Bun.file(outcomeFile).json();
}

describe("subprocess worker reliability", () => {
	it("[I2/I4] recovers journaled yield after a pre-flush child kill", async () => {
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

	it("[I4] recovers when the terminal pipe record is absent", async () => {
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

	it("[I5][D1] delivers the current journal result before the child exits", async () => {
		const sessionFile = path.join(tmpDir, "child-yield-linger.jsonl");
		const extensionFile = path.join(tmpDir, "linger-after-yield.ts");
		const barrierFile = path.join(tmpDir, "child-entered-linger");
		const payload = { delivered: "at-yield", child: "still-running" };
		await writeTerminalWorkerExtension(extensionFile, sessionFile, payload, "hang", 30, barrierFile);
		const workerStarted = Promise.withResolvers<number>();
		const pending = runSubagentSpawnProcess(
			{ ...requestFor(sessionFile).options, preloadedExtensionPaths: [extensionFile] },
			Settings.isolated(),
			{ onProcessStart: pid => workerStarted.resolve(pid) },
		);
		const workerPid = await workerStarted.promise;
		await waitForFile(barrierFile);

		const result = await pending;

		expect(result.output).toBe(JSON.stringify(payload, null, 2));
		await waitForWorkerProcessesToExit([{ pid: workerPid, pgid: workerPid }]);
	});

	it("[I1] reports one typed error for a pre-yield nonzero exit", async () => {
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

	it("[I1] reports one typed error for a pre-yield signal exit", async () => {
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

	it("[I7] interrupts and idempotently reaps a worker process tree", async () => {
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

	it("[I8] reaping leaves no worker process or child temp artifact", async () => {
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

	it("[I9][D3] projects terminal state onto the matching generation", async () => {
		const sessionFile = path.join(tmpDir, "child-terminal.jsonl");
		const extensionFile = path.join(tmpDir, "exit-terminal.ts");
		const payload = { terminal: true, recovered: true };
		await writeTerminalWorkerExtension(extensionFile, sessionFile, payload, "exit");
		AgentRegistry.global().register({
			id: "child-1",
			displayName: "worker",
			kind: "sub",
			parentId: "Main",
			status: "running",
			session: null,
			sessionFile: null,
			starting: true,
		});

		const request = requestFor(sessionFile);
		const result = await runSubagentSpawnProcess(
			{ ...request.options, preloadedExtensionPaths: [extensionFile] },
			Settings.isolated(),
		);

		expect(result.exitCode).toBe(0);
		expect(result.aborted).not.toBe(true);
		expect(result.output).toBe(JSON.stringify(payload, null, 2));
		expect(result.extractedToolData?.yield).toHaveLength(1);
		const terminalRef = AgentRegistry.global().get("child-1");
		expect(terminalRef).toMatchObject({
			status: "parked",
			session: null,
			sessionFile,
			starting: false,
		});
		expect(typeof AgentRegistry.global().getLaunchGeneration(terminalRef!)).toBe("string");
	});

	it("[I9][identity] leaves a replacement launch generation untouched", () => {
		const registry = AgentRegistry.global();
		const sessionFile = path.join(tmpDir, "child.jsonl");
		const original = registry.register({
			id: "child-1",
			displayName: "original",
			kind: "sub",
			parentId: "Main",
			status: "running",
			session: null,
			sessionFile,
			starting: true,
			launchGeneration: "launch-original",
		});
		const replacement = registry.register({
			id: "child-1",
			displayName: "replacement",
			kind: "sub",
			parentId: "Main",
			status: "running",
			session: null,
			sessionFile,
			starting: true,
			launchGeneration: "launch-replacement",
		});

		registry.projectJournalTerminal("child-1", sessionFile, "launch-original");

		expect(registry.get("child-1")).toBe(replacement);
		expect(registry.getLaunchGeneration(replacement)).toBe("launch-replacement");
		expect(replacement).toMatchObject({
			status: "running",
			sessionFile,
			starting: true,
		});
		expect(original).toMatchObject({ status: "running", starting: true });
	});

	it("[I3][I8][D2] delivers before lingering, then reaps the process group", async () => {
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

	it("[I4] recovers a matching marked yield without a final pipe record", async () => {
		const sessionFile = path.join(tmpDir, "child-1.jsonl");
		await Bun.write(sessionFile, terminalJournal({ ok: true }));

		const result = await recoverSpawnWorkerResultFromJournal(requestFor(sessionFile));
		expect(result?.exitCode).toBe(0);
		expect(result?.output).toContain('"ok": true');
		expect(result?.extractedToolData?.yield).toHaveLength(1);
	});

	it("[I2/I3][D2] lets durable yield beat the wall timeout", async () => {
		const sessionFile = path.join(tmpDir, "child-yield-before-timeout.jsonl");
		const extensionFile = path.join(tmpDir, "yield-before-timeout.ts");
		const payload = { durable: true, outcome: "result-not-timeout" };
		await Bun.write(
			extensionFile,
			"export default function() { Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 10_000); }\n",
		);
		const journalWritten = Promise.withResolvers<void>();

		const result = await runSubagentSpawnProcess(
			{ ...requestFor(sessionFile).options, preloadedExtensionPaths: [extensionFile] },
			Settings.isolated(),
			{
				timeoutMs: 1_500,
				onPhase: phase => {
					if (phase !== "run") return;
					void fs.appendFile(sessionFile, terminalYield(payload)).then(() => journalWritten.resolve());
				},
			},
		);
		await journalWritten.promise;

		expect(result.output).toBe(JSON.stringify(payload, null, 2));
	});

	it("[I2/I3] rejects a prior-turn yield when a revived turn times out", async () => {
		const sessionFile = path.join(tmpDir, "child-revived.jsonl");
		const extensionFile = path.join(tmpDir, "revived-hangs.ts");
		await Bun.write(sessionFile, terminalJournal({ turn: "prior", stale: true }));
		await Bun.write(extensionFile, "export default async function() { await Bun.sleep(10_000); }\n");

		let error: unknown;
		try {
			await runSubagentSpawnProcess(
				{ ...requestFor(sessionFile).options, preloadedExtensionPaths: [extensionFile] },
				Settings.isolated(),
				{ timeoutMs: 500 },
			);
		} catch (caught) {
			error = caught;
		}
		expect(error).toBeInstanceOf(SpawnWorkerError);
		expect((error as SpawnWorkerError).code).toBe("timeout");
	});

	it("[I2/I3][shrink] recovers a matching marker after journal shrink", async () => {
		const sessionFile = path.join(tmpDir, "child-shrunk.jsonl");
		const extensionFile = path.join(tmpDir, "shrink-after-start.ts");
		const payload = { turn: "current-after-shrink" };
		const compactHeader = `${JSON.stringify({
			type: "session",
			version: 4,
			id: "session-1",
			timestamp: JOURNAL_TIMESTAMP,
			cwd: tmpDir,
		})}\n`;
		await Bun.write(sessionFile, terminalJournal({ turn: "prior", padding: "x".repeat(4_096) }));
		await Bun.write(
			extensionFile,
			`import * as fs from "node:fs/promises";
export default async function() {
	const entries = (await Bun.file(${JSON.stringify(sessionFile)}).text())
		.trim()
		.split("\\n")
		.map(line => JSON.parse(line));
	const marker = entries.findLast(
		entry => entry.type === "custom" && entry.customType === ${JSON.stringify(SPAWN_WORKER_JOURNAL_START_MARKER)},
	);
	if (!marker) throw new Error("current turn marker missing");
	await fs.truncate(${JSON.stringify(sessionFile)}, 0);
	await fs.appendFile(
		${JSON.stringify(sessionFile)},
		${JSON.stringify(compactHeader)} + JSON.stringify(marker) + "\\n" + ${JSON.stringify(terminalYield(payload))},
	);
	process.exit(0);
}
`,
		);

		const result = await runSubagentSpawnProcess(
			{ ...requestFor(sessionFile).options, preloadedExtensionPaths: [extensionFile] },
			Settings.isolated(),
		);

		expect(result.output).toBe(JSON.stringify(payload, null, 2));
	});

	it("[I2/I3][rotation] recovers a marked yield after atomic replacement", async () => {
		const sessionFile = path.join(tmpDir, "child-rotated.jsonl");
		const replacementFile = path.join(tmpDir, "child-rotated.next.jsonl");
		const extensionFile = path.join(tmpDir, "rotate-after-start.ts");
		const payload = { turn: "current-after-rotation" };
		await Bun.write(sessionFile, terminalJournal({ turn: "prior" }));
		await Bun.write(
			extensionFile,
			`import * as fs from "node:fs/promises";
export default async function() {
	const current = await Bun.file(${JSON.stringify(sessionFile)}).text();
	await Bun.write(${JSON.stringify(replacementFile)}, current + ${JSON.stringify(terminalYield(payload))});
	await fs.rename(${JSON.stringify(replacementFile)}, ${JSON.stringify(sessionFile)});
	process.exit(0);
}
`,
		);

		const result = await runSubagentSpawnProcess(
			{ ...requestFor(sessionFile).options, preloadedExtensionPaths: [extensionFile] },
			Settings.isolated(),
		);

		expect(result.output).toBe(JSON.stringify(payload, null, 2));
	});

	it("[I2/I3][rotation] fails closed without the matching marker", async () => {
		const sessionFile = path.join(tmpDir, "child-rotated-mismatch.jsonl");
		const replacementFile = path.join(tmpDir, "child-rotated-mismatch.next.jsonl");
		const extensionFile = path.join(tmpDir, "rotate-without-current-marker.ts");
		await Bun.write(sessionFile, terminalJournal({ turn: "prior", padding: "x".repeat(4_096) }));
		await Bun.write(
			extensionFile,
			`import * as fs from "node:fs/promises";
export default async function() {
	await Bun.write(${JSON.stringify(replacementFile)}, ${JSON.stringify(terminalJournal({ turn: "replacement" }))});
	await fs.rename(${JSON.stringify(replacementFile)}, ${JSON.stringify(sessionFile)});
	process.exit(0);
}
`,
		);

		let error: unknown;
		try {
			await runSubagentSpawnProcess(
				{ ...requestFor(sessionFile).options, preloadedExtensionPaths: [extensionFile] },
				Settings.isolated(),
			);
		} catch (caught) {
			error = caught;
		}

		expect(error).toBeInstanceOf(SpawnWorkerError);
		expect((error as SpawnWorkerError).code).toBe("exit");
	});

	it("[I1][corruption] rejects corruption after the current marker", async () => {
		const sessionFile = path.join(tmpDir, "child-corrupt-current-turn.jsonl");
		const extensionFile = path.join(tmpDir, "corrupt-yield-then-exit.ts");
		await Bun.write(
			extensionFile,
			`import * as fs from "node:fs/promises";
export default async function() {
	await fs.appendFile(
		${JSON.stringify(sessionFile)},
		${JSON.stringify(`{malformed-current-turn\n${terminalYield({ durable: true })}`)},
	);
	await Bun.sleep(100);
	process.exit(0);
}
`,
		);

		let error: unknown;
		try {
			await runSubagentSpawnProcess(
				{
					...requestFor(sessionFile).options,
					preloadedExtensionPaths: [extensionFile],
					maxRuntimeMs: 2_000,
				},
				Settings.isolated(),
			);
		} catch (caught) {
			error = caught;
		}
		expect(error).toBeInstanceOf(JournalRecoveryError);
	});

	it("[I2][corruption] accepts yield before later corrupt JSONL", async () => {
		const sessionFile = path.join(tmpDir, "child-yield-before-corruption.jsonl");
		const extensionFile = path.join(tmpDir, "yield-before-corruption.ts");
		const payload = { durable: true, order: "yield-before-corruption" };
		await Bun.write(
			extensionFile,
			`import * as fs from "node:fs/promises";
export default async function() {
	await fs.appendFile(
		${JSON.stringify(sessionFile)},
		${JSON.stringify(`${terminalYield(payload)}{malformed-after-yield\n`)},
	);
	await Bun.sleep(100);
	process.exit(0);
}
`,
		);

		const result = await runSubagentSpawnProcess(
			{
				...requestFor(sessionFile).options,
				preloadedExtensionPaths: [extensionFile],
				maxRuntimeMs: 2_000,
			},
			Settings.isolated(),
		);

		expect(result.output).toBe(JSON.stringify(payload, null, 2));
		expect(result.extractedToolData?.yield).toHaveLength(1);
	});

	it("[I5] advances the journal tail cursor only through bytes consumed", async () => {
		const sessionFile = path.join(tmpDir, "child-growing-tail.jsonl");
		const prefix = `${JSON.stringify({
			type: "session",
			version: 4,
			id: "session-1",
			timestamp: JOURNAL_TIMESTAMP,
			cwd: tmpDir,
		})}\n`;
		await Bun.write(sessionFile, prefix);
		const initialSize = Bun.file(sessionFile).size;
		const firstRead = readJournalYieldTail(sessionFile, { offset: 0, remainder: "" });
		fsSync.appendFileSync(sessionFile, terminalYield({ delivered: "after-read-started" }));

		const first = await firstRead;
		expect(first.found).toBe(false);
		expect(first.state.offset).toBe(initialSize);
		const second = await readJournalYieldTail(sessionFile, first.state);
		expect(second.found).toBe(true);
	});

	it("[I1/D2] preserves the first protocol error over later output", async () => {
		const sessionFile = path.join(tmpDir, "child-protocol-error.jsonl");
		const extensionFile = path.join(tmpDir, "protocol-error-before-result.ts");
		await Bun.write(
			extensionFile,
			`export default async function() {
	process.stdout.write("{not-json}\\\\n");
	await Bun.sleep(100);
}
`,
		);

		let error: unknown;
		try {
			await runSubagentSpawnProcess(
				{
					...requestFor(sessionFile).options,
					preloadedExtensionPaths: [extensionFile],
					maxRuntimeMs: 2_000,
				},
				Settings.isolated(),
			);
		} catch (caught) {
			error = caught;
		}
		expect(error).toBeInstanceOf(SpawnWorkerError);
		expect((error as SpawnWorkerError).code).toBe("protocol");
	});

	it("[protocol] decodes fenced v2 and conservative v1 traffic", () => {
		const v1Request = v1RequestFor(path.join(tmpDir, "old-parent.jsonl"));
		expect(decodeSpawnWorkerRequest(v1Request).version).toBe(1);
		expect(() =>
			decodeSpawnWorkerRequest({
				...v1Request,
				registry: [
					{
						id: "child-1",
						displayName: "old-child",
						kind: "sub",
						status: "running",
						launchGeneration: "not-valid-in-v1",
					},
				],
			}),
		).toThrow("launchGeneration requires spawn-worker protocol version 2");
		const v2Request = {
			...requestFor(path.join(tmpDir, "new-parent.jsonl")),
			registry: [
				{
					id: "child-1",
					displayName: "new-child",
					kind: "sub" as const,
					status: "running" as const,
					launchGeneration: TEST_LAUNCH_GENERATION,
				},
			],
		};
		expect(decodeSpawnWorkerRequest(v2Request)).toMatchObject({
			version: SPAWN_WORKER_PROTOCOL_VERSION,
			launchGeneration: TEST_LAUNCH_GENERATION,
			journalStartNonce: TEST_JOURNAL_START_NONCE,
			registry: [{ launchGeneration: TEST_LAUNCH_GENERATION }],
		});
		expect(() => decodeSpawnWorkerRequest({ ...v2Request, journalStartNonce: undefined })).toThrow(
			"journalStartNonce must be a non-empty string",
		);
		expect(
			decodeSpawnWorkerRecord({
				version: 1,
				type: "ready",
				requestId: "old-child",
				pid: 42,
			}),
		).toEqual({
			version: 1,
			type: "ready",
			requestId: "old-child",
			pid: 42,
		});
		expect(
			decodeSpawnWorkerRecord({
				version: SPAWN_WORKER_PROTOCOL_VERSION,
				type: "yield-written",
				requestId: "new-child",
			}),
		).toEqual({
			version: SPAWN_WORKER_PROTOCOL_VERSION,
			type: "yield-written",
			requestId: "new-child",
		});
		expect(() => decodeSpawnWorkerRecord({ version: 1, type: "yield-written", requestId: "old-child" })).toThrow(
			"yield-written requires spawn-worker protocol version 2",
		);
	});

	it("[protocol] rejects yield-written before the ready handshake", async () => {
		const outcome = await runPreReadyYieldWorker(path.join(tmpDir, "pre-ready-yield.jsonl"), {
			durable: true,
			order: "before-ready",
		});

		expect(outcome).toMatchObject({
			ok: false,
			name: "SpawnWorkerError",
			code: "protocol",
		});
		expect(outcome.message).toContain("yield-written before ready");
	});

	it("[regression] initializes worker-bootstrap settings", async () => {
		await initializeSpawnWorkerSettings({
			...requestFor(path.join(tmpDir, "child-1.jsonl")),
			settings: { "edit.mode": "hashline" },
		});
		expect(settings.get("edit.mode")).toBe("hashline");
	});

	it("[I8] exits the real worker promptly after its terminal record", async () => {
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
			expect(bus.findPeerByName("child-1")).toMatchObject({
				agentId: "child-1",
				name: "child-1",
			});

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

	it("[D4][regression] routes worker sends through external IRC", async () => {
		const registry = AgentRegistry.global();
		registry.register({
			id: "Main",
			displayName: "main",
			kind: "main",
			status: "running",
			session: null,
		});
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
