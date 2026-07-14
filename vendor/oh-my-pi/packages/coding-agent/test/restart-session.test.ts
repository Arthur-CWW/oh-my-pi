import { beforeEach, describe, expect, test } from "bun:test";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import * as net from "node:net";
import * as os from "node:os";
import * as path from "node:path";
import {
	acquireRestartSessionOwnership,
	buildRestartLaunchArgs,
	buildRestartSpawnSpec,
	captureRestartLaunchArgs,
	getRestartLaunchArgsForTest,
	handoffRestartProcess,
	RESTART_API_KEY_ENV,
} from "../src/cli/restart-session";
import { SessionManager } from "../src/session/session-manager";
import { acquireSessionOwnership, inspectSessionOwnership, readRestartHandoff } from "../src/session/session-ownership";
import { ensureRestartSessionOwnership } from "../src/slash-commands/builtin-registry";

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
