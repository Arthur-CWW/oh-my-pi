import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import * as fs from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";
import { AsyncJobManager } from "@oh-my-pi/pi-coding-agent/async/job-manager";
import { CURRENT_SESSION_VERSION, type FileEntry } from "@oh-my-pi/pi-coding-agent/session/session-entries";
import {
	CHILD_LIFECYCLE_CUSTOM_TYPE,
	type ChildLifecycleRecord,
	latestChildLifecycleRecord,
} from "@oh-my-pi/pi-coding-agent/task/child-lifecycle";
import { resumeInterruptedChild } from "@oh-my-pi/pi-coding-agent/task/re-adopt";

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
	const entries = [
		JSON.stringify({ type: "session", version: CURRENT_SESSION_VERSION, id, timestamp, cwd: tmpDir }),
		JSON.stringify({
			type: "session_init",
			id: "init",
			parentId: null,
			timestamp,
			systemPrompt: "memory backpressure test",
			task: "preserved memory-bound assignment",
			tools: ["yield"],
			subagent: {
				agentId: id,
				parentSessionFile: parent,
				parentSessionId: "parent",
				displayName: id,
				model: "provider/model",
				taskDepth: 1,
				parentTaskPrefix: id,
				isolated: false,
				spawnRecord: {
					version: 1,
					agentId: id,
					spawnerId: "Main",
					agentType: "task",
					definitionSourcePath: "embedded:task.md",
					assignment: "preserved memory-bound assignment",
					context: "memory backpressure test",
					prompt: "memory backpressure test\n\npreserved memory-bound assignment",
				},
			},
		}),
	];
	await fs.writeFile(child, `${entries.join("\n")}\n`);
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
async function waitForFile(filePath: string, timeoutMs = 5_000): Promise<void> {
	const deadline = Date.now() + timeoutMs;
	while (Date.now() < deadline) {
		if (await Bun.file(filePath).exists()) return;
		await Bun.sleep(20);
	}
	throw new Error(`timed out waiting for ${filePath}`);
}

async function latestLifecycle(sessionFile: string): Promise<ChildLifecycleRecord | undefined | null> {
	const entries = (await fs.readFile(sessionFile, "utf8"))
		.trim()
		.split("\n")
		.map(line => JSON.parse(line) as FileEntry);
	return latestChildLifecycleRecord(entries);
}

describe("graduated worker memory backpressure", () => {
	it("kills the worker group on schedule while interruption persistence is stalled", async () => {
		const { parent, child } = await createSessionFiles("Runaway");
		const codingAgentRoot = path.resolve(import.meta.dir, "..", "..");
		const hostFile = path.join(tmpDir, "runaway-host.ts");
		const outcomeFile = path.join(tmpDir, "runaway-outcome.json");
		const workerFile = path.join(tmpDir, "runaway-worker.json");
		const appendStartedFile = path.join(tmpDir, "append-started");
		const releaseAppendFile = path.join(tmpDir, "release-append");
		const clientModule = path.join(codingAgentRoot, "src", "task", "spawn-worker-client.ts");
		const lifecycleModule = path.join(codingAgentRoot, "src", "task", "child-lifecycle.ts");
		const protocolModule = path.join(codingAgentRoot, "src", "task", "spawn-worker-protocol.ts");
		const settingsModule = path.join(codingAgentRoot, "src", "config", "settings.ts");
		const workerHostModule = path.resolve(codingAgentRoot, "..", "utils", "src", "worker-host.ts");
		const graceMs = 300;
		await fs.writeFile(
			hostFile,
			`import * as fs from "node:fs/promises";
import { Settings } from ${JSON.stringify(settingsModule)};
import { appendInterruptedChildLifecycleFile } from ${JSON.stringify(lifecycleModule)};
import { runSubagentSpawnProcess } from ${JSON.stringify(clientModule)};
import { SPAWN_WORKER_ARG } from ${JSON.stringify(protocolModule)};
import { declareWorkerHostEntry } from ${JSON.stringify(workerHostModule)};
if (process.argv.includes(SPAWN_WORKER_ARG)) {
  const request = JSON.parse((await Bun.stdin.text()).trim());
  process.on("SIGUSR2", () => {});
  process.stdout.write(JSON.stringify({ version: request.version, type: "ready", requestId: request.requestId, pid: process.pid }) + "\\n");
  await Bun.sleep(10_000);
} else {
  declareWorkerHostEntry();
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
      memoryWatermarks: { softBytes: 0, hardBytes: 1 },
      memoryInterruptGraceMs: ${graceMs},
      async onProcessStart(pid) {
        workerPid = pid;
        await fs.writeFile(${JSON.stringify(workerFile)}, JSON.stringify({ pid, startedAt: Date.now() }));
      },
      async appendInterruptedLifecycle(interrupted) {
        await fs.writeFile(${JSON.stringify(appendStartedFile)}, "started");
        while (!(await Bun.file(${JSON.stringify(releaseAppendFile)}).exists())) await Bun.sleep(20);
        await appendInterruptedChildLifecycleFile(interrupted);
      },
    });
  } catch (error) {
    code = typeof error === "object" && error !== null && "code" in error ? String(error.code) : "untyped";
    message = error instanceof Error ? error.message : String(error);
  }
  await fs.writeFile(${JSON.stringify(outcomeFile)}, JSON.stringify({ code, message, workerPid }));
}
`,
		);
		const proc = Bun.spawn([process.execPath, hostFile], {
			cwd: codingAgentRoot,
			env: Bun.env,
			stdout: "pipe",
			stderr: "pipe",
		});
		await Promise.all([waitForFile(workerFile), waitForFile(appendStartedFile)]);
		const worker = (await Bun.file(workerFile).json()) as { pid: number; startedAt: number };
		let killError: Error | undefined;
		try {
			await waitForExit(worker.pid, 750);
		} catch (error) {
			killError = error instanceof Error ? error : new Error(String(error));
		} finally {
			await fs.writeFile(releaseAppendFile, "release");
		}
		const [exitCode, stderr] = await Promise.all([proc.exited, new Response(proc.stderr).text()]);
		if (killError) throw killError;
		expect(exitCode, stderr).toBe(0);
		expect(Date.now() - worker.startedAt).toBeLessThan(graceMs + 1_250);
		const outcome = (await Bun.file(outcomeFile).json()) as {
			code: string;
			message: string;
			workerPid: number;
		};
		expect(outcome.code, outcome.message).toBe("memory-watermark");
		expect(outcome.workerPid).toBe(worker.pid);
		expect(await latestLifecycle(child)).toEqual(
			expect.objectContaining({
				agentId: "Runaway",
				state: "interrupted",
				failureClass: "subprocess_abort",
				resumeDisposition: "resumable",
			}),
		);
	});

	it("preserves a durable success recovered at kill time and refuses to resume it", async () => {
		const id = "CompletedAtDeadline";
		const { parent, child } = await createSessionFiles(id);
		const codingAgentRoot = path.resolve(import.meta.dir, "..", "..");
		const hostFile = path.join(tmpDir, "completed-at-deadline-host.ts");
		const outcomeFile = path.join(tmpDir, "completed-at-deadline-outcome.json");
		const durableFile = path.join(tmpDir, "completed-at-deadline");
		const crossingFile = path.join(tmpDir, "completed-at-deadline-crossing");
		const clientModule = path.join(codingAgentRoot, "src", "task", "spawn-worker-client.ts");
		const protocolModule = path.join(codingAgentRoot, "src", "task", "spawn-worker-protocol.ts");
		const settingsModule = path.join(codingAgentRoot, "src", "config", "settings.ts");
		const workerHostModule = path.resolve(codingAgentRoot, "..", "utils", "src", "worker-host.ts");
		const graceMs = 3_000;
		const payload = { completed: true, boundary: "memory-grace" };
		await fs.writeFile(
			hostFile,
			`import * as fs from "node:fs/promises";
import { Settings } from ${JSON.stringify(settingsModule)};
import { runSubagentSpawnProcess } from ${JSON.stringify(clientModule)};
import { SPAWN_WORKER_ARG, SPAWN_WORKER_JOURNAL_START_MARKER } from ${JSON.stringify(protocolModule)};
import { declareWorkerHostEntry } from ${JSON.stringify(workerHostModule)};
if (process.argv.includes(SPAWN_WORKER_ARG)) {
  const request = JSON.parse((await Bun.stdin.text()).trim());
  const markerAt = new Date().toISOString();
  await fs.appendFile(request.options.sessionFile, JSON.stringify({
    type: "custom",
    id: "turn-start",
    parentId: null,
    timestamp: markerAt,
    customType: SPAWN_WORKER_JOURNAL_START_MARKER,
    data: {
      requestId: request.requestId,
      launchGeneration: request.launchGeneration,
      nonce: request.journalStartNonce,
    },
  }) + "\\n");
  process.on("SIGUSR2", () => {});
  process.stdout.write(JSON.stringify({ version: request.version, type: "ready", requestId: request.requestId, pid: process.pid }) + "\\n");
  while (!(await Bun.file(${JSON.stringify(crossingFile)}).exists())) await Bun.sleep(10);
  const crossing = await fs.stat(${JSON.stringify(crossingFile)});
  await Bun.sleep(Math.max(0, crossing.mtimeMs + ${graceMs} - Date.now() - 250));
  const completedAt = new Date().toISOString();
  const lifecycle = {
    type: "custom",
    id: "completed-lifecycle",
    parentId: null,
    timestamp: completedAt,
    customType: ${JSON.stringify(CHILD_LIFECYCLE_CUSTOM_TYPE)},
    data: {
      version: 1,
      agentId: request.options.id,
      childSessionFile: request.options.sessionFile,
      parentSessionFile: request.options.parentSessionFile,
      state: "completed",
      updatedAt: completedAt,
    },
  };
  const yielded = {
    type: "message",
    id: "yield-message",
    parentId: null,
    timestamp: completedAt,
    message: {
      role: "toolResult",
      toolCallId: "yield-call",
      toolName: "yield",
      content: [{ type: "text", text: "Result submitted." }],
      details: { status: "success", data: ${JSON.stringify(payload)} },
    },
  };
  await fs.appendFile(request.options.sessionFile, JSON.stringify(lifecycle) + "\\n" + JSON.stringify(yielded) + "\\n");
  await fs.writeFile(${JSON.stringify(durableFile)}, "durable");
  await Bun.sleep(10_000);
} else {
  declareWorkerHostEntry();
  let code = "success";
  let output = "";
  let message = "";
  try {
    const result = await runSubagentSpawnProcess(${JSON.stringify({
			cwd: tmpDir,
			agent: { name: "task", description: "test", systemPrompt: "test", source: "bundled" },
			task: "complete at deadline",
			assignment: "complete at deadline",
			index: 0,
			id,
			sessionFile: child,
			parentSessionFile: parent,
			parentSessionId: "parent",
		})}, Settings.isolated(), {
      memoryWatermarks: { softBytes: 1, hardBytes: 2 },
      memoryInterruptGraceMs: ${graceMs},
      onMemoryPressureNotice() { void fs.writeFile(${JSON.stringify(crossingFile)}, "crossed"); },
    });
    output = result.output;
  } catch (error) {
    code = typeof error === "object" && error !== null && "code" in error ? String(error.code) : "untyped";
    message = error instanceof Error ? error.message : String(error);
  }
  await fs.writeFile(${JSON.stringify(outcomeFile)}, JSON.stringify({ code, output, message }));
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
		expect(await Bun.file(durableFile).exists()).toBe(true);
		const outcome = (await Bun.file(outcomeFile).json()) as { code: string; output: string; message: string };
		expect(outcome.code, outcome.message).toBe("success");
		expect(outcome.output).toBe(JSON.stringify(payload, null, 2));
		expect(await latestLifecycle(child)).toEqual(
			expect.objectContaining({
				agentId: id,
				state: "completed",
			}),
		);

		const manager = new AsyncJobManager({ onJobComplete: () => {} });
		let restartAttempted = false;
		const resumed = await resumeInterruptedChild({
			agentId: id,
			parentSessionFile: parent,
			parentSessionId: "parent",
			parentJournal: {
				getEntries: () => [],
				getSessionOwnership: () => ({
					sessionFile: parent,
					sessionId: "parent",
					ownerEpoch: "owner-epoch",
					ownerKind: "omp",
					buildRevision: { digest: "0".repeat(64), version: "memory-backpressure-test" },
					runnerInstanceIdentity: {
						runnerInstanceId: "00000000-0000-4000-8000-000000000099",
						startedAt: "2026-01-01T00:00:00.000Z",
					},
					isCurrent: async () => true,
					release: async () => {},
				}),
			} as never,
			manager,
			idleTtlMs: 0,
			createReviver: async () => {
				restartAttempted = true;
				throw new Error("completed child must not create a reviver");
			},
			startTurn: async () => {
				restartAttempted = true;
				throw new Error("completed child must not start another turn");
			},
		});
		expect(resumed).toEqual(
			expect.objectContaining({
				status: "refused",
				reason: "the child already completed",
				classification: expect.objectContaining({
					outcome: "completed",
					disposition: "unrecoverable",
				}),
			}),
		);
		expect(restartAttempted).toBe(false);
	}, 15_000);

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
