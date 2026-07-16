import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import * as fs from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";
import { Settings, resetSettingsForTest, settings } from "@oh-my-pi/pi-coding-agent/config/settings";
import { AgentRegistry } from "@oh-my-pi/pi-coding-agent/registry/agent-registry";
import {
	recoverSpawnWorkerResultFromJournal,
	runSubagentSpawnProcess,
	runSyntheticSpawnWorkerWorkload,
	SpawnWorkerError,
} from "@oh-my-pi/pi-coding-agent/task/spawn-worker-client";
import type { SingleResult } from "@oh-my-pi/pi-coding-agent/task/types";
import type { SpawnWorkerRunRequest } from "@oh-my-pi/pi-coding-agent/task/spawn-worker-protocol";
import { SPAWN_WORKER_ARG } from "@oh-my-pi/pi-coding-agent/task/spawn-worker-protocol";
import { initializeSpawnWorkerSettings } from "@oh-my-pi/pi-coding-agent/task/spawn-worker-entry";
import { IrcExternalBus } from "@oh-my-pi/pi-coding-agent/irc/bus-external";
import { IrcTool } from "@oh-my-pi/pi-coding-agent/tools/irc";
import type { ToolSession } from "@oh-my-pi/pi-coding-agent/tools";

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
): Promise<void> {
	const journal = [
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
	].join("\n") + "\n";
	const terminate = termination === "kill" ? 'process.kill(process.pid, "SIGKILL");' : "process.exit(0);";
	await Bun.write(
		extensionFile,
		`export default async function() {
	await Bun.sleep(30);
	await Bun.write(${JSON.stringify(sessionFile)}, ${JSON.stringify(journal)});
	${terminate}
}
`,
	);
}

describe("subprocess worker reliability", () => {
	it("[I2/I4] recovers a journaled yield when the child is killed before pipe flush", async () => {
		const sessionFile = path.join(tmpDir, "child-killed.jsonl");
		const extensionFile = path.join(tmpDir, "kill-after-yield.ts");
		const payload = { ok: true, boundary: "yield-written" };
		await writeTerminalWorkerExtension(extensionFile, sessionFile, payload, "kill");

		const request = requestFor(sessionFile);
		const result = await runSubagentSpawnProcess(
			{ ...request.options, preloadedExtensionPaths: [extensionFile] },
			Settings.isolated(),
		);

		expect(result.exitCode).toBe(0);
		expect(result.output).toBe(JSON.stringify(payload, null, 2));
		expect(result.extractedToolData?.yield).toHaveLength(1);
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
		await Bun.write(extensionFile, 'export default function() { process.exit(23); }\n');

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

		expect(typedError?.code).toBe("exit");
		expect(outcomes).toBe(1);
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

	it.todo("[I3][D2] wall-clock after yield must deliver result, not SpawnWorkerError (ledger D2)", () => {});
	it.todo("[I9][D3] journal-terminal child must not report running (ledger D3)", () => {});

	it("[I4] recovers a durable yield when the final pipe record is absent", async () => {
		const sessionFile = path.join(tmpDir, "child-1.jsonl");
		const timestamp = JOURNAL_TIMESTAMP;
		await Bun.write(
			sessionFile,
			[
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
			].join("\n") + "\n",
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

	it("[D4][regression] returns a typed local-peer refusal instead of external IRC loopback", async () => {
		const registry = AgentRegistry.global();
		registry.register({ id: "Main", displayName: "main", kind: "main", status: "running", session: null });
		process.env.OMP_SUBPROCESS_WORKER = "1";
		const toolSession: ToolSession = {
			cwd: tmpDir,
			hasUI: false,
			settings: Settings.isolated(),
			getSessionFile: () => null,
			getSessionSpawns: () => "*",
			agentRegistry: registry,
			getAgentId: () => "child-1",
		};
		const result = await new IrcTool(toolSession, new IrcExternalBus(path.join(tmpDir, "irc.sqlite"))).execute("irc", {
			op: "send",
			to: "Main",
			message: "hello",
		});
		expect(result.isError).toBe(true);
		expect(result.content[0]?.type === "text" ? result.content[0].text : "").toContain("coordinator IPC");
		expect(result.details?.receipts?.[0]).toMatchObject({
			to: "Main",
			outcome: "failed",
			error: "subprocess-worker-peer-unavailable",
		});
	});
});
