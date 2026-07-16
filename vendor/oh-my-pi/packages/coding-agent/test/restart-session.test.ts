import { beforeEach, describe, expect, test, vi } from "bun:test";
import { createHash } from "node:crypto";
import { chmod, mkdtemp, readFile, realpath, rm, symlink, writeFile } from "node:fs/promises";
import * as net from "node:net";
import * as os from "node:os";
import * as path from "node:path";
import {
	acquireRestartSessionOwnership,
	buildRestartLaunchArgs,
	buildRestartSpawnSpec,
	buildRolloutRestartSpawnSpec,
	captureRestartLaunchArgs,
	getRestartLaunchArgsForTest,
	handoffRestartProcess,
	RESTART_API_KEY_ENV,
	RESTART_CHECKPOINT_ID_ENV,
	RESTART_ROLLOUT_ID_ENV,
	RESTART_TARGET_DIGEST_ENV,
	resolveRestartExecutable,
	resolveVerifiedReleaseExecutable,
	replaceRestartProcess,
} from "../src/cli/restart-session";
import { SessionManager } from "../src/session/session-manager";
import { acquireSessionOwnership, inspectSessionOwnership, readRestartHandoff } from "../src/session/session-ownership";
import { DurableInputQueue } from "../src/session/durable-input-queue";
import { ensureRestartSessionOwnership, executeBuiltinSlashCommand } from "../src/slash-commands/builtin-registry";

type HandoffReceipt = {
	predecessorEpoch?: string;
	ownerEpoch?: string;
	ownerKind?: string;
	predecessorStatus?: string;
	replacementReleased?: boolean;
	error?: string;
};

async function notifyHandoffParent(socketPath: string, receipt: HandoffReceipt): Promise<void> {
	const sent = Promise.withResolvers<void>();
	const socket = net.createConnection(socketPath);
	socket.once("error", sent.reject);
	socket.once("connect", () => socket.end(JSON.stringify(receipt)));
	socket.once("close", hadError => {
		if (!hadError) sent.resolve();
	});
	await sent.promise;
}
const SESSION = "live-session-abc";
const TEST_BUILD_REVISION = { digest: "0".repeat(64), version: "restart-session-test" };
const OWNER_RUNNER_INSTANCE_IDENTITY = {
	runnerInstanceId: "00000000-0000-4000-8000-000000000004",
	startedAt: "2026-01-01T00:00:00.000Z",
};
const REPLACEMENT_RUNNER_INSTANCE_IDENTITY = {
	runnerInstanceId: "00000000-0000-4000-8000-000000000005",
	startedAt: "2026-01-01T00:00:01.000Z",
};

async function runRestartHandoffChild(): Promise<void> {
	const [mode, root, sessionFile, sessionId, receiptPath, socketPath, predecessorEpoch] = process.argv.slice(2);
	if (mode !== "--restart-handoff-owner" && mode !== "--restart-handoff-replacement") return;

	try {
		if (!root || !sessionFile || !sessionId || !receiptPath || !socketPath) {
			throw new Error("Missing restart handoff child arguments");
		}

		if (mode === "--restart-handoff-owner") {
			const ownership = await acquireSessionOwnership(sessionFile, sessionId, {
				root,
				buildRevision: TEST_BUILD_REVISION,
				runnerInstanceIdentity: OWNER_RUNNER_INSTANCE_IDENTITY,
			});
			await handoffRestartProcess(
				{
					executable: process.execPath,
					args: [
						import.meta.path,
						"--restart-handoff-replacement",
						root,
						sessionFile,
						sessionId,
						receiptPath,
						socketPath,
						ownership.ownerEpoch,
					],
					cwd: process.cwd(),
				},
				ownership,
				async () => [
					{ agentId: "Running", state: "running", journalPath: `${sessionFile}.running`, queueCheckpoint: "q-7" },
					{ agentId: "Parked", state: "parked", journalPath: `${sessionFile}.parked`, queueCheckpoint: null },
				],
			);
			return;
		}

		const predecessor = await inspectSessionOwnership(sessionFile, sessionId, { root });
		const ownership = await acquireRestartSessionOwnership(sessionFile, sessionId, {
			root,
			buildRevision: TEST_BUILD_REVISION,
			runnerInstanceIdentity: REPLACEMENT_RUNNER_INSTANCE_IDENTITY,
		});
		const receipt: HandoffReceipt = {
			ownerEpoch: ownership.ownerEpoch,
			predecessorEpoch,
			ownerKind: ownership.ownerKind,
			predecessorStatus: predecessor.status,
		};
		await writeFile(receiptPath, JSON.stringify(receipt));
		await Bun.sleep(2_000);
		await ownership.release();
		receipt.replacementReleased = true;
		await writeFile(receiptPath, JSON.stringify(receipt));
		await notifyHandoffParent(socketPath, receipt);
	} catch (error) {
		const receipt: HandoffReceipt = { error: error instanceof Error ? error.message : String(error) };
		if (receiptPath) await writeFile(receiptPath, JSON.stringify(receipt));
		if (socketPath) await notifyHandoffParent(socketPath, receipt);
		process.exitCode = 1;
	}
}

type RestartCaptureSnapshot = {
	draft: string | null;
	queued: Array<{ sequence: number; text: string; deliveryClass: string; state: string }>;
	error?: string;
};

async function runRestartCaptureChild(): Promise<void> {
	const [mode, root, tempDir, reportPath, sessionFile, sessionId, predecessorEpoch] = process.argv.slice(2);
	if (mode !== "--restart-capture-owner" && mode !== "--restart-capture-replacement") return;

	try {
		if (!root || !tempDir || !reportPath) throw new Error("Missing restart capture arguments");
		if (mode === "--restart-capture-owner") {
			const manager = SessionManager.create(tempDir, path.join(tempDir, "sessions"));
			await manager.ensureOnDisk();
			const ownerSessionFile = manager.getSessionFile();
			const ownerSessionId = manager.getSessionId();
			if (!ownerSessionFile) throw new Error("Restart capture session file unavailable");
			const ownership = await acquireSessionOwnership(ownerSessionFile, ownerSessionId, {
				root,
				buildRevision: TEST_BUILD_REVISION,
				runnerInstanceIdentity: OWNER_RUNNER_INSTANCE_IDENTITY,
			});
			manager.bindSessionOwnership(ownership);
			const queue = await DurableInputQueue.open(ownership, root);
			await queue.adopt();
			await queue.enqueue({ text: "queued first", attachments: undefined, deliveryClass: "followUp" });
			await queue.enqueue({ text: "queued second", attachments: undefined, deliveryClass: "followUp" });
			await manager.saveDraft("draft survives restart verbatim\nwith two lines");

			await handoffRestartProcess(
				{
					executable: process.execPath,
					args: [
						import.meta.path,
						"--restart-capture-replacement",
						root,
						tempDir,
						reportPath,
						ownerSessionFile,
						ownerSessionId,
						ownership.ownerEpoch,
					],
					cwd: tempDir,
				},
				ownership,
				async () => {
					await manager.close();
				},
			);
			return;
		}

		if (!sessionFile || !sessionId || !predecessorEpoch) throw new Error("Missing restart capture replacement arguments");
		const ownership = await acquireRestartSessionOwnership(
			sessionFile,
			sessionId,
			{
				root,
				buildRevision: TEST_BUILD_REVISION,
				runnerInstanceIdentity: REPLACEMENT_RUNNER_INSTANCE_IDENTITY,
			},
			predecessorEpoch,
		);
		const queue = await DurableInputQueue.open(ownership, root);
		await queue.adopt();
		const manager = await SessionManager.open(sessionFile);
		const items = await queue.list();
		const queued = items
			.filter(item => item.state === "queued" && item.payload.kind !== "custom" && "text" in item.payload)
			.map(item => {
				if (!("text" in item.payload)) throw new Error("Restart capture found a non-user input");
				return {
					sequence: item.sequence,
					text: item.payload.text,
					deliveryClass: item.deliveryClass,
					state: item.state,
				};
			});
		const snapshot: RestartCaptureSnapshot = {
			draft: await manager.consumeDraft(),
			queued,
		};
		await writeFile(reportPath, JSON.stringify(snapshot));
		await manager.close();
		await ownership.release();
	} catch (error) {
		await writeFile(
			reportPath,
			JSON.stringify({ draft: null, queued: [], error: error instanceof Error ? error.message : String(error) }),
		);
		process.exitCode = 1;
	}
}

const restartCaptureChild = process.argv[2];
if (restartCaptureChild === "--restart-capture-owner" || restartCaptureChild === "--restart-capture-replacement") {
	await runRestartCaptureChild();
	process.exit(process.exitCode ?? 0);
}

const restartHandoffChild = process.argv[2];
if (restartHandoffChild === "--restart-handoff-owner" || restartHandoffChild === "--restart-handoff-replacement") {
	await runRestartHandoffChild();
	process.exit(process.exitCode ?? 0);
}

describe("buildRestartLaunchArgs", () => {
	test("preserves --config and its value", () => {
		expect(buildRestartLaunchArgs(["--config", "/path/cfg.json"], SESSION)).toEqual([
			"--config",
			"/path/cfg.json",
			"--resume",
			SESSION,
		]);
	});

	test("preserves --model and its value", () => {
		expect(buildRestartLaunchArgs(["--model", "pi/large"], SESSION)).toEqual([
			"--model",
			"pi/large",
			"--resume",
			SESSION,
		]);
	});

	test("preserves --cwd and its value", () => {
		expect(buildRestartLaunchArgs(["--cwd", "/work/project"], SESSION)).toEqual([
			"--cwd",
			"/work/project",
			"--resume",
			SESSION,
		]);
	});

	test("preserves other string-valued flags", () => {
		const args = ["--mode", "text", "--provider", "anthropic", "--thinking", "high"];
		expect(buildRestartLaunchArgs(args, SESSION)).toEqual([...args, "--resume", SESSION]);
	});

	test("preserves -e extension flag and its value", () => {
		expect(buildRestartLaunchArgs(["-e", "my-ext"], SESSION)).toEqual(["-e", "my-ext", "--resume", SESSION]);
	});

	test("drops --resume and its value", () => {
		expect(buildRestartLaunchArgs(["--resume", "old-session"], SESSION)).toEqual(["--resume", SESSION]);
	});

	test("drops -r and its value", () => {
		expect(buildRestartLaunchArgs(["-r", "old-session"], SESSION)).toEqual(["--resume", SESSION]);
	});

	test("drops --session and its value", () => {
		expect(buildRestartLaunchArgs(["--session", "old-session"], SESSION)).toEqual(["--resume", SESSION]);
	});

	test("drops bare --resume when next arg is another flag", () => {
		expect(buildRestartLaunchArgs(["--resume", "--model", "pi/large"], SESSION)).toEqual([
			"--model",
			"pi/large",
			"--resume",
			SESSION,
		]);
	});

	test("drops --continue boolean flag", () => {
		expect(buildRestartLaunchArgs(["--continue"], SESSION)).toEqual(["--resume", SESSION]);
	});

	test("drops -c boolean flag", () => {
		expect(buildRestartLaunchArgs(["-c"], SESSION)).toEqual(["--resume", SESSION]);
	});

	test("drops --print boolean flag", () => {
		expect(buildRestartLaunchArgs(["--print"], SESSION)).toEqual(["--resume", SESSION]);
	});

	test("drops -p boolean flag", () => {
		expect(buildRestartLaunchArgs(["-p"], SESSION)).toEqual(["--resume", SESSION]);
	});

	test("drops --fork and its value before string flag preservation", () => {
		expect(buildRestartLaunchArgs(["--fork", "fork-name"], SESSION)).toEqual(["--resume", SESSION]);
	});

	test("drops --export and its value before string flag preservation", () => {
		expect(buildRestartLaunchArgs(["--export", "out.html"], SESSION)).toEqual(["--resume", SESSION]);
	});

	test("drops --help and -h boolean flags", () => {
		expect(buildRestartLaunchArgs(["--help", "-h"], SESSION)).toEqual(["--resume", SESSION]);
	});

	test("drops --version and -v boolean flags", () => {
		expect(buildRestartLaunchArgs(["--version", "-v"], SESSION)).toEqual(["--resume", SESSION]);
	});

	test("preserves equals-form --config and --model", () => {
		expect(buildRestartLaunchArgs(["--config=/path/cfg.json", "--model=pi/large"], SESSION)).toEqual([
			"--config=/path/cfg.json",
			"--model=pi/large",
			"--resume",
			SESSION,
		]);
	});

	test("drops equals-form session and one-shot flags", () => {
		expect(
			buildRestartLaunchArgs(
				["--resume=old-session", "--fork=old-fork", "--export=old.html", "--continue=yes"],
				SESSION,
			),
		).toEqual(["--resume", SESSION]);
	});

	test("empty args produces only --resume", () => {
		expect(buildRestartLaunchArgs([], SESSION)).toEqual(["--resume", SESSION]);
	});

	test("all-dropped args produces only --resume", () => {
		expect(buildRestartLaunchArgs(["--help", "--version", "--continue", "-c", "--print", "-p"], SESSION)).toEqual([
			"--resume",
			SESSION,
		]);
	});

	test("drops positional args", () => {
		expect(buildRestartLaunchArgs(["some-prompt", "another-arg"], SESSION)).toEqual(["--resume", SESSION]);
	});

	test("preserves end-of-options marker but drops following positional", () => {
		expect(buildRestartLaunchArgs(["--", "some-file.txt"], SESSION)).toEqual(["--", "--resume", SESSION]);
	});

	test("complex mix preserves reusable launch state and drops one-shot intent", () => {
		const args = [
			"--model",
			"pi/large",
			"--continue",
			"--config",
			"cfg.json",
			"--resume",
			"old-session",
			"-c",
			"--print",
			"--fork",
			"fork-x",
			"--export",
			"out.html",
			"positional-prompt",
			"--help",
			"--version",
			"--cwd",
			"/work",
		];

		expect(buildRestartLaunchArgs(args, SESSION)).toEqual([
			"--model",
			"pi/large",
			"--config",
			"cfg.json",
			"--cwd",
			"/work",
			"--resume",
			SESSION,
		]);
	});
});

describe("buildRestartSpawnSpec", () => {
	test("cwd is passed through", () => {
		const spec = buildRestartSpawnSpec({
			sessionId: SESSION,
			cwd: "/custom/cwd",
			executable: "omp",
			processArgv: ["omp"],
			launchArgs: [],
		});

		expect(spec.cwd).toBe("/custom/cwd");
	});

	test("keeps no prefix when launch args start at argv[1]", () => {
		const spec = buildRestartSpawnSpec({
			sessionId: SESSION,
			cwd: "/cwd",
			executable: "/usr/local/bin/omp",
			processArgv: ["/usr/local/bin/omp", "--model", "pi/large"],
			launchArgs: ["--model", "pi/large"],
		});

		expect(spec).toEqual({
			executable: "/usr/local/bin/omp",
			cwd: "/cwd",
			args: ["--model", "pi/large", "--resume", SESSION],
		});
	});

	test("drops Bun compiled-binary virtual entries", () => {
		const spec = buildRestartSpawnSpec({
			sessionId: SESSION,
			cwd: "/cwd",
			executable: "/opt/omp",
			processArgv: ["bun", "/$bunfs/root/omp", "--no-extensions"],
			launchArgs: ["--no-extensions"],
		});

		expect(spec.executable).toBe("/opt/omp");
		expect(spec.args).toEqual(["--no-extensions", "--resume", SESSION]);
		expect(spec.args.join("\0")).not.toContain("/$bunfs/");
	});

	test("keeps bun run script prefix", () => {
		const spec = buildRestartSpawnSpec({
			sessionId: SESSION,
			cwd: "/cwd",
			executable: "/usr/local/bin/bun",
			processArgv: ["/usr/local/bin/bun", "run", "src/cli.ts", "--model", "pi/large"],
			launchArgs: ["--model", "pi/large"],
		});

		expect(spec.args).toEqual(["run", "src/cli.ts", "--model", "pi/large", "--resume", SESSION]);
	});

	test("keeps script-only prefix when launch args are empty", () => {
		const spec = buildRestartSpawnSpec({
			sessionId: SESSION,
			cwd: "/cwd",
			executable: "/usr/local/bin/bun",
			processArgv: ["/usr/local/bin/bun", "src/cli.ts"],
			launchArgs: [],
		});

		expect(spec.args).toEqual(["src/cli.ts", "--resume", SESSION]);
	});

	test("uses only resume for binary-only no-arg invocation", () => {
		const spec = buildRestartSpawnSpec({
			sessionId: SESSION,
			cwd: "/cwd",
			executable: "omp",
			processArgv: ["omp"],
			launchArgs: [],
		});

		expect(spec.args).toEqual(["--resume", SESSION]);
	});

	test("moves API keys from restart argv into the child environment", () => {
		for (const launchArgs of [
			["--model", "anthropic/claude", "--api-key", "known-secret-value"],
			["--model=anthropic/claude", "--api-key=known-secret-value"],
		]) {
			const spec = buildRestartSpawnSpec({
				sessionId: SESSION,
				cwd: "/cwd",
				executable: "omp",
				processArgv: ["omp", ...launchArgs],
				launchArgs,
			});

			expect(spec.args.join("\0")).not.toContain("known-secret-value");
			expect(spec.args).not.toContain("--api-key");
			expect(spec.env?.[RESTART_API_KEY_ENV]).toBe("known-secret-value");
		}
	});

	test("full integration preserves config, model, and cwd while dropping one-shot flags", () => {
		const launchArgs = [
			"--config",
			"/tmp/cfg.json",
			"--model",
			"pi/large",
			"--resume",
			"old-resume",
			"--session",
			"old-session",
			"-r",
			"old-short",
			"--continue",
			"-c",
			"--print",
			"-p",
			"--fork",
			"fork-name",
			"--export",
			"out.html",
			"--help",
			"--version",
		];

		const spec = buildRestartSpawnSpec({
			sessionId: SESSION,
			cwd: "/work/tree",
			executable: "/usr/local/bin/bun",
			processArgv: ["/usr/local/bin/bun", "src/cli.ts", ...launchArgs],
			launchArgs,
		});

		expect(spec).toEqual({
			executable: "/usr/local/bin/bun",
			cwd: "/work/tree",
			args: ["src/cli.ts", "--config", "/tmp/cfg.json", "--model", "pi/large", "--resume", SESSION],
		});
	});
});

describe("restart executable resolution", () => {
	test("re-resolves a swapped launcher while preserving direct-binary launches", async () => {
		const tempDir = await mkdtemp(path.join(os.tmpdir(), "omp-restart-launcher-"));
		const binaryA = path.join(tempDir, "omp-a");
		const binaryB = path.join(tempDir, "omp-b");
		const launcher = path.join(tempDir, "omp");
		const originalCwd = process.cwd();
		await writeFile(binaryA, "#!/bin/sh\nexit 0\n");
		await writeFile(binaryB, "#!/bin/sh\nexit 0\n");
		await chmod(binaryA, 0o755);
		await chmod(binaryB, 0o755);
		await symlink(binaryA, launcher);

		const execveCalls: Array<{ executable: string; args: string[] }> = [];
		const execve = vi.spyOn(process, "execve").mockImplementation((executable, args) => {
			execveCalls.push({ executable, args: [...(args ?? [])] });
			throw new Error("stop restart in test");
		});

		try {
			captureRestartLaunchArgs([], launcher, binaryA);
			const launcherSpec = buildRestartSpawnSpec({
				sessionId: SESSION,
				cwd: originalCwd,
				processArgv: [launcher],
				launchArgs: [],
			});
			expect(launcherSpec.executable).toBe(binaryA);
			expect(launcherSpec.launchPath).toBe(launcher);

			await rm(launcher);
			await symlink(binaryB, launcher);
			const resolution = resolveRestartExecutable(launcherSpec);
			expect(resolution).toEqual({
				executable: launcher,
				usedLauncher: true,
				fallback: false,
				notice: `restart executable re-resolved: ${binaryA} → ${launcher}`,
			});
			expect(await realpath(resolution.executable)).toBe(await realpath(binaryB));
			expect(() => replaceRestartProcess(launcherSpec)).toThrow("stop restart in test");
			expect(execveCalls[0]).toEqual({
				executable: launcher,
				args: [launcher, "--resume", SESSION],
			});

			execveCalls.length = 0;
			captureRestartLaunchArgs([], binaryA, binaryA);
			const directSpec = buildRestartSpawnSpec({
				sessionId: SESSION,
				cwd: originalCwd,
				processArgv: [binaryA],
				launchArgs: [],
			});
			expect(directSpec.executable).toBe(binaryA);
			expect(directSpec.launchPath).toBeUndefined();
			expect(() => replaceRestartProcess(directSpec)).toThrow("stop restart in test");
			expect(execveCalls[0]).toEqual({
				executable: binaryA,
				args: [binaryA, "--resume", SESSION],
			});
		} finally {
			process.chdir(originalCwd);
			execve.mockRestore();
			captureRestartLaunchArgs([]);
			await rm(tempDir, { recursive: true, force: true });
		}
	});

	test("falls back to the captured executable with a visible notice when the launcher disappears", async () => {
		const tempDir = await mkdtemp(path.join(os.tmpdir(), "omp-restart-launcher-fallback-"));
		const binary = path.join(tempDir, "omp-a");
		const launcher = path.join(tempDir, "omp");
		await writeFile(binary, "#!/bin/sh\nexit 0\n");
		await chmod(binary, 0o755);
		await symlink(binary, launcher);
		try {
			captureRestartLaunchArgs([], launcher, binary);
			const spec = buildRestartSpawnSpec({
				sessionId: SESSION,
				cwd: process.cwd(),
				processArgv: [launcher],
				launchArgs: [],
			});
			await rm(launcher);
			expect(resolveRestartExecutable(spec)).toEqual({
				executable: binary,
				usedLauncher: false,
				fallback: true,
				notice: `restart launcher unavailable: ${launcher}; using ${binary}`,
			});
		} finally {
			captureRestartLaunchArgs([]);
			await rm(tempDir, { recursive: true, force: true });
		}
	});
});

describe("rollout restart release verification", () => {
	test("refuses a digest-named executable whose bytes do not match", async () => {
		const root = await mkdtemp(path.join(os.tmpdir(), "omp-release-mismatch-"));
		const claimedDigest = "a".repeat(64);
		const executable = path.join(root, `omp-${claimedDigest}`);
		try {
			await writeFile(executable, "corrupt release");
			await chmod(executable, 0o555);
			await expect(resolveVerifiedReleaseExecutable(root, claimedDigest)).rejects.toThrow("digest mismatch");
		} finally {
			await rm(root, { recursive: true, force: true });
		}
	});

	test("builds exact-digest same-session reexec only from its checkpoint", async () => {
		const root = await mkdtemp(path.join(os.tmpdir(), "omp-release-valid-"));
		const bytes = "#!/bin/sh\nexit 0\n";
		const digest = createHash("sha256").update(bytes).digest("hex");
		const executable = path.join(root, `omp-${digest}`);
		try {
			await writeFile(executable, bytes);
			await chmod(executable, 0o555);
			const spec = await buildRolloutRestartSpawnSpec({
				checkpoint: {
					type: "rollout-checkpoint",
					checkpointId: "checkpoint-1",
					rolloutId: "rollout-1",
					commandId: "00000000-0000-4000-8000-000000000001",
					ownerEpoch: "old-epoch",
					expectedDigest: "b".repeat(64),
					journalCheckpoint: {
						sessionId: SESSION,
						sessionFile: "/tmp/session.jsonl",
						checkpointId: "checkpoint-1",
					},
					children: [],
					unresumableReasons: [],
					autoResumeAllowed: true,
					pauseProvenance: "rollout",
					outcome: "Checkpointed",
					createdAt: "2026-01-01T00:00:00.000Z",
				},
				rolloutId: "rollout-1",
				targetDigest: digest,
				releaseStoreDir: root,
				sessionId: SESSION,
				sessionFile: "/tmp/session.jsonl",
				ownerEpoch: "old-epoch",
				cwd: "/work",
				processArgv: ["omp"],
				launchArgs: [],
			});
			expect(spec.executable).toBe(executable);
			expect(spec.args).toEqual(["--resume", SESSION]);
			expect(spec.env?.[RESTART_ROLLOUT_ID_ENV]).toBe("rollout-1");
			expect(spec.env?.[RESTART_TARGET_DIGEST_ENV]).toBe(digest);
			expect(spec.env?.[RESTART_CHECKPOINT_ID_ENV]).toBe("checkpoint-1");
		} finally {
			await rm(root, { recursive: true, force: true });
		}
	});
});

describe("ensureRestartSessionOwnership", () => {
	test("acquires and binds ownership when a fresh manager has none", async () => {
		const tempDir = await mkdtemp(path.join(os.tmpdir(), "omp-restart-fresh-"));
		const manager = SessionManager.create(tempDir, path.join(tempDir, "sessions"));
		try {
			expect(manager.getSessionOwnership()).toBeUndefined();
			await manager.ensureOnDisk();
			const ownership = await ensureRestartSessionOwnership(manager);
			expect(manager.getSessionOwnership()).toBe(ownership);
			expect(await ownership.isCurrent()).toBe(true);
			await ownership.release();
		} finally {
			await manager.close();
			await rm(tempDir, { recursive: true, force: true });
		}
	});
});

describe("/restart draft persistence", () => {
	test("saves the editor draft before attempting process replacement", async () => {
		const tempDir = await mkdtemp(path.join(os.tmpdir(), "omp-restart-draft-"));
		const manager = SessionManager.create(tempDir, path.join(tempDir, "sessions"));
		const setText = vi.fn();
		const showError = vi.fn();
		const shutdown = vi.fn(async () => {});
		const session = {
			isStreaming: false,
			asyncJobManager: undefined,
			async checkpointChildJobsForRestart() {},
		};
		const editor = {
			getText: () => "unsent editor draft",
			setText,
		};
		const ctx = {
			editor,
			session,
			sessionManager: manager,
			showError,
			showStatus: vi.fn(),
			showWarning: vi.fn(),
			shutdown,
			focusedAgentId: undefined,
			collabGuest: undefined,
		} as unknown as Parameters<typeof executeBuiltinSlashCommand>[1]["ctx"];
		const execve = vi.spyOn(process, "execve").mockImplementation(() => {
			throw new Error("stop restart in test");
		});

		try {
			await expect(executeBuiltinSlashCommand("/restart", { ctx })).resolves.toBe(true);
			expect(await manager.consumeDraft()).toBe("unsent editor draft");
			expect(setText).not.toHaveBeenCalled();
			expect(shutdown).toHaveBeenCalledTimes(1);
			expect(showError).toHaveBeenCalledWith(expect.stringContaining("stop restart in test"));
		} finally {
			execve.mockRestore();
			await manager.close();
			await rm(tempDir, { recursive: true, force: true });
		}
	});
});

describe("/restart durable capture", () => {
	test("preserves queued follow-ups and the draft across same-PID replacement", async () => {
		const tempDir = await mkdtemp(path.join(os.tmpdir(), "omp-restart-capture-"));
		const root = path.join(tempDir, "ownership");
		const reportPath = path.join(tempDir, "restart-capture.json");
		const child = Bun.spawn(
			[process.execPath, import.meta.path, "--restart-capture-owner", root, tempDir, reportPath],
			{ cwd: tempDir, stdin: "ignore", stdout: "pipe", stderr: "pipe" },
		);

		try {
			expect(await child.exited).toBe(0);
			const snapshot = JSON.parse(await readFile(reportPath, "utf8")) as RestartCaptureSnapshot;
			expect(snapshot.error).toBeUndefined();
			expect(snapshot.draft).toBe("draft survives restart verbatim\nwith two lines");
			expect(snapshot.queued).toEqual([
				{ sequence: 1, text: "queued first", deliveryClass: "followUp", state: "queued" },
				{ sequence: 2, text: "queued second", deliveryClass: "followUp", state: "queued" },
			]);
		} finally {
			await rm(tempDir, { recursive: true, force: true });
		}
	});
});

describe("captureRestartLaunchArgs / getRestartLaunchArgsForTest", () => {
	beforeEach(() => {
		captureRestartLaunchArgs([]);
	});

	test("round-trips captured args unchanged", () => {
		const args = ["--config", "/tmp/cfg.json", "--model", "pi/smol"];
		captureRestartLaunchArgs(args);

		expect(getRestartLaunchArgsForTest()).toEqual(args);
	});

	test("snapshot is immutable against external mutation", () => {
		const args = ["--config", "/tmp/original.json"];
		captureRestartLaunchArgs(args);
		args[1] = "/tmp/mutated.json";

		expect(getRestartLaunchArgsForTest()).toEqual(["--config", "/tmp/original.json"]);
	});

	test("captured snapshot drives default spawn reconstruction", () => {
		captureRestartLaunchArgs(["--config", "/tmp/cfg.json", "--model", "pi/smol"]);

		const spec = buildRestartSpawnSpec({
			sessionId: SESSION,
			cwd: "/cwd",
			executable: "bun",
			processArgv: ["bun", "src/cli.ts", "--config", "/tmp/cfg.json", "--model", "pi/smol"],
		});

		expect(spec.args).toEqual(["src/cli.ts", "--config", "/tmp/cfg.json", "--model", "pi/smol", "--resume", SESSION]);
	});
});

async function receiveHandoffReceipt(socketPath: string): Promise<{
	receipt: Promise<HandoffReceipt>;
	close(): Promise<void>;
}> {
	const received = Promise.withResolvers<HandoffReceipt>();
	const server = net.createServer(socket => {
		socket.setEncoding("utf8");
		let payload = "";
		socket.on("data", chunk => {
			payload += chunk;
		});
		socket.on("end", () => {
			try {
				received.resolve(JSON.parse(payload) as HandoffReceipt);
			} catch (error) {
				received.reject(error);
			}
		});
		socket.on("error", error => received.reject(error));
	});
	const listening = Promise.withResolvers<void>();
	server.once("error", listening.reject);
	server.listen(socketPath, () => {
		server.off("error", listening.reject);
		listening.resolve();
	});
	await listening.promise;
	return {
		receipt: received.promise,
		close: async () => {
			const closed = Promise.withResolvers<void>();
			server.close(error => (error ? closed.reject(error) : closed.resolve()));
			await closed.promise;
		},
	};
}

describe("handoffRestartProcess", () => {
	test("releases direct ownership before a detached replacement acquires a new epoch", async () => {
		const tempDir = await mkdtemp(path.join(os.tmpdir(), "omp-restart-handoff-"));
		const root = path.join(tempDir, "ownership");
		const sessionFile = path.join(tempDir, "session.jsonl");
		const sessionId = "restart-handoff-session";
		const receiptPath = path.join(tempDir, "replacement-receipt.json");
		const socketPath = path.join(tempDir, "handoff.sock");
		await writeFile(sessionFile, "");
		const receiver = await receiveHandoffReceipt(socketPath);

		try {
			const owner = Bun.spawn(
				[
					process.execPath,
					import.meta.path,
					"--restart-handoff-owner",
					root,
					sessionFile,
					sessionId,
					receiptPath,
					socketPath,
				],
				{ cwd: tempDir, stdin: "ignore", stdout: "pipe", stderr: "pipe" },
			);
			const [ownerExitCode, receipt] = await Promise.all([owner.exited, receiver.receipt]);
			const durableReceipt = JSON.parse(await readFile(receiptPath, "utf8")) as HandoffReceipt;
			expect(receipt.error).toBeUndefined();

			expect(ownerExitCode).toBe(0);
			expect(durableReceipt).toEqual(receipt);
			expect(receipt.predecessorStatus).toBe("none");
			expect(receipt.ownerKind).toBe("omp");
			expect(receipt.ownerEpoch).not.toBeUndefined();
			expect(receipt.predecessorEpoch).not.toBeUndefined();
			expect(receipt.ownerEpoch).not.toBe(receipt.predecessorEpoch);
			expect(receipt.replacementReleased).toBe(true);
			const marker = await readRestartHandoff(sessionFile, sessionId, receipt.predecessorEpoch as string, { root });
			expect(marker?.predecessorOwnerEpoch).toBe(receipt.predecessorEpoch);
			expect(marker?.childManifest).toEqual([
				{ agentId: "Running", state: "running", journalPath: `${sessionFile}.running`, queueCheckpoint: "q-7" },
				{ agentId: "Parked", state: "parked", journalPath: `${sessionFile}.parked`, queueCheckpoint: null },
			]);
		} finally {
			await receiver.close();
			await rm(tempDir, { recursive: true, force: true });
		}
	});

	test("retries only the declared predecessor epoch while its lease is being released", async () => {
		const tempDir = await mkdtemp(path.join(os.tmpdir(), "omp-restart-claim-race-"));
		const root = path.join(tempDir, "ownership");
		const sessionFile = path.join(tempDir, "session.jsonl");
		const sessionId = "restart-claim-race-session";
		await writeFile(sessionFile, "");
		const predecessor = await acquireSessionOwnership(sessionFile, sessionId, {
			root,
			buildRevision: TEST_BUILD_REVISION,
			runnerInstanceIdentity: OWNER_RUNNER_INSTANCE_IDENTITY,
		});

		try {
			const release = Bun.sleep(30).then(() => predecessor.release());
			const replacement = await acquireRestartSessionOwnership(
				sessionFile,
				sessionId,
				{
					root,
					buildRevision: TEST_BUILD_REVISION,
					runnerInstanceIdentity: REPLACEMENT_RUNNER_INSTANCE_IDENTITY,
				},
				predecessor.ownerEpoch,
			);
			await release;
			expect(replacement.ownerEpoch).not.toBe(predecessor.ownerEpoch);
			await replacement.release();
		} finally {
			await predecessor.release();
			await rm(tempDir, { recursive: true, force: true });
		}
	});

	test("surfaces replacement spawn failure after releasing direct ownership", async () => {
		const tempDir = await mkdtemp(path.join(os.tmpdir(), "omp-restart-spawn-failure-"));
		const root = path.join(tempDir, "ownership");
		const sessionFile = path.join(tempDir, "session.jsonl");
		const sessionId = "restart-spawn-failure-session";
		await writeFile(sessionFile, "");
		const ownership = await acquireSessionOwnership(sessionFile, sessionId, {
			root,
			buildRevision: TEST_BUILD_REVISION,
			runnerInstanceIdentity: OWNER_RUNNER_INSTANCE_IDENTITY,
		});

		try {
			await expect(
				handoffRestartProcess(
					{ executable: path.join(tempDir, "missing-replacement"), args: [], cwd: tempDir },
					ownership,
				),
			).rejects.toThrow();
			expect((await inspectSessionOwnership(sessionFile, sessionId, { root })).status).toBe("none");
		} finally {
			await ownership.release();
			await rm(tempDir, { recursive: true, force: true });
		}
	});
});
