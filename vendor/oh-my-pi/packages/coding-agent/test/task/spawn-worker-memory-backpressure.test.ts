import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import * as fs from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";
import { CURRENT_SESSION_VERSION, type FileEntry } from "@oh-my-pi/pi-coding-agent/session/session-entries";
import { type ChildLifecycleRecord, latestChildLifecycleRecord } from "@oh-my-pi/pi-coding-agent/task/child-lifecycle";

const savedEnvironment = new Map<string, string | undefined>();
let tmpDir = "";

beforeEach(async () => {
	tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "omp-memory-backpressure-"));
	for (const name of ["HOME", "TMPDIR", "OMP_CONFIG_ROOT", "OMP_IRC_DB", "OMP_SESSION_CONTROL_DB"] as const) {
		savedEnvironment.set(name, process.env[name]);
	}
	process.env.HOME = path.join(tmpDir, "home");
	process.env.TMPDIR = path.join(tmpDir, "tmp");
	process.env.OMP_CONFIG_ROOT = path.join(tmpDir, "config");
	process.env.OMP_IRC_DB = path.join(tmpDir, "irc.sqlite");
	process.env.OMP_SESSION_CONTROL_DB = path.join(tmpDir, "session-control.sqlite");
	await Promise.all([
		fs.mkdir(process.env.HOME, { recursive: true }),
		fs.mkdir(process.env.TMPDIR, { recursive: true }),
		fs.mkdir(process.env.OMP_CONFIG_ROOT, { recursive: true }),
	]);
});

afterEach(async () => {
	for (const [name, value] of savedEnvironment) {
		if (value === undefined) delete process.env[name];
		else process.env[name] = value;
	}
	savedEnvironment.clear();
	await fs.rm(tmpDir, { recursive: true, force: true });
});

async function createSessionFiles(id: string): Promise<{ parent: string; child: string }> {
	const parent = path.join(tmpDir, "parent.jsonl");
	const childDir = parent.slice(0, -".jsonl".length);
	const child = path.join(childDir, `${id}.jsonl`);
	const timestamp = new Date().toISOString();
	await fs.mkdir(childDir, { recursive: true });
	await fs.writeFile(
		parent,
		`${JSON.stringify({ type: "session", version: CURRENT_SESSION_VERSION, id: "parent", timestamp, cwd: tmpDir })}\n`,
	);
	await fs.writeFile(
		child,
		`${JSON.stringify({ type: "session", version: CURRENT_SESSION_VERSION, id, timestamp, cwd: tmpDir })}\n`,
	);
	return { parent, child };
}

async function waitForExit(pid: number, timeoutMs: number): Promise<void> {
	const deadline = Date.now() + timeoutMs;
	while (Date.now() < deadline) {
		try {
			process.kill(pid, 0);
		} catch {
			return;
		}
		await Bun.sleep(20);
	}
	throw new Error(`worker pid ${pid} remained alive after ${timeoutMs}ms`);
}

async function latestLifecycle(sessionFile: string): Promise<ChildLifecycleRecord | undefined | null> {
	const entries = (await fs.readFile(sessionFile, "utf8"))
		.trim()
		.split("\n")
		.map(line => JSON.parse(line) as FileEntry);
	return latestChildLifecycleRecord(entries);
}

describe("graduated worker memory backpressure", () => {
	it("escalates an unresponsive worker after grace, journals resumable interruption, and kills its group", async () => {
		const { parent, child } = await createSessionFiles("Runaway");
		const codingAgentRoot = path.resolve(import.meta.dir, "..", "..");
		const hostFile = path.join(tmpDir, "runaway-host.ts");
		const outcomeFile = path.join(tmpDir, "runaway-outcome.json");
		const clientModule = path.join(codingAgentRoot, "src", "task", "spawn-worker-client.ts");
		const protocolModule = path.join(codingAgentRoot, "src", "task", "spawn-worker-protocol.ts");
		const settingsModule = path.join(codingAgentRoot, "src", "config", "settings.ts");
		const workerHostModule = path.resolve(codingAgentRoot, "..", "utils", "src", "worker-host.ts");
		const graceMs = 300;
		await fs.writeFile(
			hostFile,
			`import * as fs from "node:fs/promises";
import { Settings } from ${JSON.stringify(settingsModule)};
import { runSubagentSpawnProcess } from ${JSON.stringify(clientModule)};
import { SPAWN_WORKER_ARG } from ${JSON.stringify(protocolModule)};
import { declareWorkerHostEntry } from ${JSON.stringify(workerHostModule)};
if (process.argv.includes(SPAWN_WORKER_ARG)) {
  const request = JSON.parse((await Bun.stdin.text()).trim());
  process.stdout.write(JSON.stringify({ version: request.version, type: "ready", requestId: request.requestId, pid: process.pid }) + "\\n");
  const allocation = new Uint8Array(256 * 1024 * 1024);
  for (let offset = 0; offset < allocation.byteLength; offset += 4096) allocation[offset] = 1;
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 10_000);
} else {
  declareWorkerHostEntry();
  const startedAt = performance.now();
  let workerPid = 0;
  let code = "none";
  let message = "";
  try {
    await runSubagentSpawnProcess(${JSON.stringify({
			cwd: tmpDir,
			agent: { name: "task", description: "test", systemPrompt: "test", source: "bundled" },
			task: "stay blocked",
			assignment: "stay blocked",
			index: 0,
			id: "Runaway",
			sessionFile: child,
			parentSessionFile: parent,
			parentSessionId: "parent",
		})}, Settings.isolated(), {
      memoryWatermarks: { softBytes: 0, hardBytes: 160 * 1024 * 1024 },
      memoryInterruptGraceMs: ${graceMs},
      onProcessStart(pid) { workerPid = pid; },
    });
  } catch (error) {
    code = typeof error === "object" && error !== null && "code" in error ? String(error.code) : "untyped";
    message = error instanceof Error ? error.message : String(error);
  }
  await fs.writeFile(${JSON.stringify(outcomeFile)}, JSON.stringify({ code, message, workerPid, elapsedMs: performance.now() - startedAt }));
}
`,
		);
		const proc = Bun.spawn([process.execPath, hostFile], {
			cwd: codingAgentRoot,
			env: Bun.env,
			stdout: "pipe",
			stderr: "pipe",
		});
		const [exitCode, stderr] = await Promise.all([proc.exited, new Response(proc.stderr).text()]);
		expect(exitCode, stderr).toBe(0);
		const outcome = (await Bun.file(outcomeFile).json()) as {
			code: string;
			message: string;
			workerPid: number;
			elapsedMs: number;
		};
		expect(outcome.code, outcome.message).toBe("memory-watermark");
		expect(outcome.workerPid).toBeGreaterThan(0);
		await waitForExit(outcome.workerPid, graceMs + 1_500);
		expect(outcome.elapsedMs).toBeLessThan(graceMs + 2_500);
		expect(await latestLifecycle(child)).toEqual(
			expect.objectContaining({
				agentId: "Runaway",
				state: "interrupted",
				failureClass: "subprocess_abort",
				resumeDisposition: "resumable",
			}),
		);
	});

	it("never sends SIGUSR2 before ready and still bounds a worker that never becomes ready", async () => {
		const codingAgentRoot = path.resolve(import.meta.dir, "..", "..");
		const hostFile = path.join(tmpDir, "pre-ready-host.ts");
		const signalFile = path.join(tmpDir, "pre-ready-signal");
		const outcomeFile = path.join(tmpDir, "pre-ready-outcome.json");
		const clientModule = path.join(codingAgentRoot, "src", "task", "spawn-worker-client.ts");
		const protocolModule = path.join(codingAgentRoot, "src", "task", "spawn-worker-protocol.ts");
		const workerHostModule = path.resolve(codingAgentRoot, "..", "utils", "src", "worker-host.ts");
		await fs.writeFile(
			hostFile,
			`import * as fs from "node:fs/promises";\nimport { runSyntheticSpawnWorkerWorkload } from ${JSON.stringify(clientModule)};\nimport { SPAWN_WORKER_ARG } from ${JSON.stringify(protocolModule)};\nimport { declareWorkerHostEntry } from ${JSON.stringify(workerHostModule)};\nif (process.argv.includes(SPAWN_WORKER_ARG)) {\n  process.once("SIGUSR2", () => void fs.writeFile(${JSON.stringify(signalFile)}, "received"));\n  await Bun.stdin.text();\n  await Bun.sleep(10_000);\n} else {\n  declareWorkerHostEntry();\n  const startedAt = performance.now();\n  let code = "none";\n  try {\n    await runSyntheticSpawnWorkerWorkload({ spinMs: 0, allocateBytes: 1 }, { memoryWatermarks: { softBytes: 0, hardBytes: 1 }, memoryInterruptGraceMs: 300 });\n  } catch (error) {\n    code = typeof error === "object" && error !== null && "code" in error ? String(error.code) : "untyped";\n  }\n  await fs.writeFile(${JSON.stringify(outcomeFile)}, JSON.stringify({ code, elapsedMs: performance.now() - startedAt }));\n}\n`,
		);
		const proc = Bun.spawn([process.execPath, hostFile], {
			cwd: codingAgentRoot,
			env: Bun.env,
			stdout: "pipe",
			stderr: "pipe",
		});
		const [exitCode, stderr] = await Promise.all([proc.exited, new Response(proc.stderr).text()]);
		expect(exitCode, stderr).toBe(0);
		const outcome = (await Bun.file(outcomeFile).json()) as { code: string; elapsedMs: number };
		expect(outcome.code).toBe("memory-watermark");
		expect(outcome.elapsedMs).toBeLessThan(2_000);
		expect(await Bun.file(signalFile).exists()).toBe(false);
	});
});
