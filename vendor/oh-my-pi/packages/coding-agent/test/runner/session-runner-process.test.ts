import { afterEach, describe, expect, it } from "bun:test";
import { createHash, randomUUID } from "node:crypto";
import * as fs from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";
import { ThinkingLevel } from "@oh-my-pi/pi-agent-core";
import { getBundledModel } from "@oh-my-pi/pi-catalog/models";
import { Effect } from "effect";
import { ModelRegistry } from "../../src/config/model-registry";
import { Settings } from "../../src/config/settings";
import { createSessionRunner } from "../../src/sdk";
import { AuthStorage } from "../../src/session/auth-storage";
import { SessionManager } from "../../src/session/session-manager";
import { acquireSessionOwnership } from "../../src/session/session-ownership";

const roots: string[] = [];
const CHILD_MARKER = "SESSION_RUNNER_PROCESS_RESULT=";

afterEach(async () => {
	await Promise.all(roots.splice(0).map(root => fs.rm(root, { recursive: true, force: true })));
});

async function construct(root: string) {
	const project = path.join(root, "project");
	const sessions = path.join(root, "sessions");
	await fs.mkdir(project, { recursive: true });
	await fs.mkdir(sessions, { recursive: true });
	const sessionManager = SessionManager.create(project, sessions);
	await sessionManager.flush();
	const sessionFile = sessionManager.getSessionFile();
	if (!sessionFile) throw new Error("persistent session file was not created");
	const runnerIdentity = {
		buildRevision: {
			digest: process.env.OMP_CANARY_BUILD_DIGEST ?? "c".repeat(64),
			version: process.env.OMP_CANARY_BUILD_DIGEST ? "process-fixture-v1" : "session-runner-process-test",
		},
		runnerInstance: { runnerInstanceId: randomUUID(), startedAt: new Date().toISOString() },
	};
	const ownership = await acquireSessionOwnership(sessionFile, sessionManager.getSessionId(), {
		buildRevision: runnerIdentity.buildRevision,
		runnerInstanceIdentity: runnerIdentity.runnerInstance,
	});
	const model = getBundledModel("anthropic", "claude-sonnet-4-5");
	if (!model) throw new Error("bundled model unavailable");
	const authStorage = await AuthStorage.create(path.join(root, "auth.db"));
	authStorage.setRuntimeApiKey(model.provider, "deliberately-unusable-process-proof-key");
	const modelRegistry = new ModelRegistry(authStorage, path.join(root, "models.yml"));
	const result = await createSessionRunner({
		cwd: project,
		agentDir: path.join(root, "agent"),
		model,
		authStorage,
		modelRegistry,
		settings: Settings.isolated({ "compaction.enabled": false }),
		sessionManager,
		ownership,
		runnerIdentity,
		mailboxCapacity: 8,
		eventCapacity: 8,
		disableExtensionDiscovery: true,
		enableMCP: false,
		enableLsp: false,
		skipPythonPreflight: true,
		contextFiles: [],
		skills: [],
		rules: [],
		promptTemplates: [],
		slashCommands: [],
		customTools: [],
	});
	await sessionManager.ensureOnDisk();
	return {
		...result,
		sessionFile,
		sessionId: sessionManager.getSessionId(),
		ownershipEpoch: ownership.ownerEpoch,
		runnerIdentity,
	};
}

async function childMain(mode: string, root: string): Promise<void> {
	const composition = await construct(root);
	const canaryOutput = process.env.OMP_CANARY_OUTPUT;
	const canaryCommandId = process.env.OMP_CANARY_COMMAND_ID;
	const canaryBuildDigest = process.env.OMP_CANARY_BUILD_DIGEST;
	if (mode === "canary") {
		if (!canaryOutput || !canaryCommandId || !canaryBuildDigest) throw new Error("missing canary worker environment");
		const startedAt = composition.runnerIdentity.runnerInstance.startedAt;
		const result = await Effect.runPromise(
			Effect.scoped(
				Effect.gen(function* () {
					const controller = yield* composition.runner.attachView({
						schemaVersion: 1,
						kind: "attachView",
						commandId: "attach-canary-controller",
						correlationId: "attach-canary-controller",
						expectedRevision: 0,
						viewId: "canary-controller",
						capability: "controller",
					});
					if (controller.capability !== "controller") throw new Error("controller attachment failed");
					const initial = yield* controller.snapshot();
					const thinkingCommandId = `${canaryCommandId}-thinking`;
					const thinkingCommand = {
						schemaVersion: 1 as const,
						kind: "setThinkingLevel" as const,
						commandId: thinkingCommandId,
						correlationId: thinkingCommandId,
						expectedSessionRevision: initial.sessionRevision,
						viewId: controller.viewId,
						controllerEpoch: controller.controllerEpoch,
						thinkingLevel: ThinkingLevel.High,
					};
					const thinkingAccepted = yield* controller.setThinkingLevel(thinkingCommand);
					const thinkingReplayed = yield* controller.setThinkingLevel(thinkingCommand);
					const command = {
						schemaVersion: 1 as const,
						kind: "submitInput" as const,
						commandId: canaryCommandId,
						correlationId: canaryCommandId,
						expectedRevision: initial.revision,
						viewId: controller.viewId,
						controllerEpoch: controller.controllerEpoch,
						payload: { text: "canary durable mutation", deliveryClass: "followUp" as const },
					};
					const accepted = yield* controller.submitInput(command);
					const replayed = yield* controller.submitInput(command);
					const final = yield* controller.snapshot();
					return { accepted, replayed, thinkingAccepted, thinkingReplayed, thinkingCommandId, initial, final };
				}),
			),
		);
		await Effect.runPromise(Effect.scoped(composition.runner.stop()));
		const replacementIdentity = {
			buildRevision: composition.runnerIdentity.buildRevision,
			runnerInstance: { runnerInstanceId: randomUUID(), startedAt: new Date().toISOString() },
		};
		const replacement = await acquireSessionOwnership(composition.sessionFile, composition.sessionId, {
			buildRevision: replacementIdentity.buildRevision,
			runnerInstanceIdentity: replacementIdentity.runnerInstance,
		});
		const leaseReacquired = await replacement.isCurrent();
		await replacement.release();
		const queueRecords = await jsonlRecords(process.env.AGENT_MUX_DIR ?? path.join(root, "mux"));
		const jsonl = await fs.readFile(composition.sessionFile, "utf8");
		await fs.writeFile(
			canaryOutput,
			`${JSON.stringify({
				schemaVersion: 1,
				buildDigest: canaryBuildDigest,
				version: "process-fixture-v1",
				runnerInstanceId: composition.runnerIdentity.runnerInstance.runnerInstanceId,
				fixtureSessionId: composition.sessionId,
				ownerEpoch: composition.ownershipEpoch,
				startedAt,
				stoppedAt: new Date().toISOString(),
				initialSnapshotRevision: result.initial.revision,
				finalSnapshotRevision: result.final.revision,
				commandId: canaryCommandId,
				proof: {
					mutationAppliedExactlyOnce:
						result.accepted.replayed === false &&
						result.replayed.replayed === true &&
						result.thinkingAccepted.replayed === false &&
						result.thinkingReplayed.replayed === true,
					leaseReleased: true,
					leaseReacquired,
					jsonlPersisted: jsonl.includes(result.thinkingCommandId),
					queuePersisted:
						queueRecords.filter(
							record =>
								record.type === "enqueue" &&
								(record.command as Record<string, unknown> | undefined)?.commandId === canaryCommandId,
						).length === 1,
				},
			})}\n`,
			{ flag: "wx" },
		);
		process.exit(0);
	}
	if (mode === "accept") {
		const receipts = await Effect.runPromise(
			Effect.scoped(
				Effect.gen(function* () {
					const controller = yield* composition.runner.attachView({
						schemaVersion: 1,
						kind: "attachView",
						commandId: "attach-process-controller",
						correlationId: "attach-process-controller",
						expectedRevision: 0,
						viewId: "process-controller",
						capability: "controller",
					});
					if (controller.capability !== "controller") throw new Error("controller attachment failed");
					const initialSnapshot = yield* controller.snapshot();
					const blockerCommand = {
						schemaVersion: 1 as const,
						kind: "submitInput" as const,
						commandId: "process-blocker",
						correlationId: "process-blocker-correlation",
						expectedRevision: 0,
						viewId: controller.viewId,
						controllerEpoch: controller.controllerEpoch,
						payload: { text: "hold the provider boundary open", deliveryClass: "followUp" as const },
					};
					yield* controller.submitInput(blockerCommand);
					yield* Effect.yieldNow;
					const command = {
						schemaVersion: 1 as const,
						kind: "submitInput" as const,
						commandId: "process-command",
						correlationId: "process-correlation",
						expectedRevision: 1,
						viewId: controller.viewId,
						controllerEpoch: controller.controllerEpoch,
						payload: { text: "accepted without claiming provider completion", deliveryClass: "followUp" as const },
					};
					const accepted = yield* controller.submitInput(command);
					const replayed = yield* controller.submitInput(command);
					const editCommand = {
						schemaVersion: 1 as const,
						kind: "editQueuedInput" as const,
						commandId: "process-edit",
						correlationId: "process-edit-correlation",
						expectedRevision: 2,
						viewId: controller.viewId,
						controllerEpoch: controller.controllerEpoch,
						inputId: accepted.inputId,
						itemRevision: 1,
						payload: { text: "edited without provider completion" },
					};
					const edited = yield* controller.editQueuedInput(editCommand);
					const editReplayed = yield* controller.editQueuedInput(editCommand);
					const cancelCommand = {
						schemaVersion: 1 as const,
						kind: "cancelQueuedInput" as const,
						commandId: "process-cancel",
						correlationId: "process-cancel-correlation",
						expectedRevision: 3,
						viewId: controller.viewId,
						controllerEpoch: controller.controllerEpoch,
						inputId: accepted.inputId,
						itemRevision: 2,
					};
					const cancelled = yield* controller.cancelQueuedInput(cancelCommand);
					const cancelReplayed = yield* controller.cancelQueuedInput(cancelCommand);
					const finalSnapshot = yield* controller.snapshot();
					return { accepted, replayed, edited, editReplayed, cancelled, cancelReplayed, initialSnapshot, finalSnapshot };
				}),
			),
		);
		console.log(
			`${CHILD_MARKER}${JSON.stringify({
				...receipts,
				sessionFile: composition.sessionFile,
				ownershipEpoch: composition.ownershipEpoch,
				runnerIdentity: composition.runnerIdentity,
			})}`,
		);
		process.exit(0);
	}

	await Effect.runPromise(Effect.scoped(composition.runner.stop()));
	await Effect.runPromise(Effect.scoped(composition.runner.stop()));
	const replacementIdentity = {
		buildRevision: composition.runnerIdentity.buildRevision,
		runnerInstance: { runnerInstanceId: randomUUID(), startedAt: new Date().toISOString() },
	};
	const replacement = await acquireSessionOwnership(composition.sessionFile, composition.sessionId, {
		buildRevision: replacementIdentity.buildRevision,
		runnerInstanceIdentity: replacementIdentity.runnerInstance,
	});
	const replacementCurrent = await replacement.isCurrent();
	await replacement.release();
	console.log(`${CHILD_MARKER}${JSON.stringify({ replacementCurrent })}`);
	process.exit(0);
}

if (process.env.OMP_SESSION_RUNNER_CHILD_MODE && process.env.OMP_SESSION_RUNNER_ROOT) {
	await childMain(process.env.OMP_SESSION_RUNNER_CHILD_MODE, process.env.OMP_SESSION_RUNNER_ROOT);
}

async function spawnChild(mode: "accept" | "stop", root: string): Promise<Record<string, unknown>> {
	const child = Bun.spawn([process.execPath, "test", import.meta.path], {
		cwd: path.resolve(import.meta.dir, "../.."),
		env: {
			...process.env,
			AGENT_MUX_DIR: path.join(root, "mux"),
			OMP_SESSION_RUNNER_CHILD_MODE: mode,
			OMP_SESSION_RUNNER_ROOT: root,
		},
		stdout: "pipe",
		stderr: "pipe",
	});
	const [stdout, stderr, exitCode] = await Promise.all([
		new Response(child.stdout).text(),
		new Response(child.stderr).text(),
		child.exited,
	]);
	if (exitCode !== 0) throw new Error(`child failed (${exitCode}): ${stderr}\n${stdout}`);
	const line = stdout.split("\n").find(value => value.startsWith(CHILD_MARKER));
	if (!line) throw new Error(`child emitted no result: ${stderr}\n${stdout}`);
	return JSON.parse(line.slice(CHILD_MARKER.length)) as Record<string, unknown>;
}

async function jsonlRecords(root: string): Promise<Array<Record<string, unknown>>> {
	const records: Array<Record<string, unknown>> = [];
	for (const entry of await fs.readdir(root, { withFileTypes: true })) {
		const target = path.join(root, entry.name);
		if (entry.isDirectory()) records.push(...(await jsonlRecords(target)));
		else if (entry.name.endsWith(".jsonl")) {
			for (const line of (await fs.readFile(target, "utf8")).split("\n")) {
				if (line.trim()) records.push(JSON.parse(line) as Record<string, unknown>);
			}
		}
	}
	return records;
}

async function readQueueHead(root: string): Promise<Record<string, unknown>> {
	for (const entry of await fs.readdir(root, { withFileTypes: true })) {
		const target = path.join(root, entry.name);
		if (entry.isDirectory()) {
			try {
				return await readQueueHead(target);
			} catch {}
		} else if (entry.name === "head.json") {
			return JSON.parse(await fs.readFile(target, "utf8")) as Record<string, unknown>;
		}
	}
	throw new Error(`queue-v3/head.json not found under ${root}`);
}

async function createCanaryCandidate(root: string): Promise<{ candidate: string; digest: string }> {
	const testPath = import.meta.path;
	const source = `#!/usr/bin/env bun
import { createHash } from "node:crypto";
import * as fs from "node:fs";
const digest = createHash("sha256").update(fs.readFileSync(import.meta.path)).digest("hex");
const args = Bun.argv.slice(2);
if (args.length === 1 && args[0] === "--runner-build-revision") {
	process.stdout.write(JSON.stringify({ buildDigest: digest, version: "process-fixture-v1" }));
	process.exit(0);
}
if (args[0] !== "--runner-canary-readiness-worker") process.exit(64);
const value = name => args[args.indexOf(name) + 1];
const fixtureRoot = value("--fixture-root");
const output = value("--output");
const commandId = value("--command-id");
const child = Bun.spawnSync([process.execPath, "test", ${JSON.stringify(testPath)}], {
	cwd: ${JSON.stringify(path.resolve(import.meta.dir, "../.."))},
	env: {
		...process.env,
		OMP_SESSION_RUNNER_CHILD_MODE: "canary",
		OMP_SESSION_RUNNER_ROOT: fixtureRoot,
		OMP_CANARY_OUTPUT: output,
		OMP_CANARY_COMMAND_ID: commandId,
		OMP_CANARY_BUILD_DIGEST: digest,
		AGENT_MUX_DIR: process.env.AGENT_MUX_ROOT,
	},
	stdout: "inherit",
	stderr: "inherit",
});
process.exit(child.exitCode);
`;
	const digest = createHash("sha256").update(source).digest("hex");
	const candidate = path.join(root, `omp-${digest}`);
	await fs.writeFile(candidate, source, { mode: 0o755 });
	await fs.chmod(candidate, 0o755);
	return { candidate, digest };
}

async function runReadinessDriver(
	candidate: string,
	fixtureRoot: string,
	output: string,
): Promise<{ exitCode: number; stdout: string; stderr: string }> {
	const child = Bun.spawn(
		[
			process.execPath,
			path.resolve(import.meta.dir, "../../scripts/runner-canary-readiness.ts"),
			"--candidate",
			candidate,
			"--fixture-root",
			fixtureRoot,
			"--output",
			output,
		],
		{ cwd: path.resolve(import.meta.dir, "../.."), stdout: "pipe", stderr: "pipe" },
	);
	const [exitCode, stdout, stderr] = await Promise.all([
		child.exited,
		new Response(child.stdout).text(),
		new Response(child.stderr).text(),
	]);
	return { exitCode, stdout, stderr };
}

describe("runner canary readiness process", () => {
	it("rejects the old checkout-test wrapper even when its receipt would otherwise pass", async () => {
		const root = await fs.mkdtemp(path.join(os.tmpdir(), "omp-runner-canary-wrapper-"));
		roots.push(root);
		const fixtureRoot = path.join(root, "fixture-source");
		await fs.mkdir(fixtureRoot, { recursive: true });
		const { candidate } = await createCanaryCandidate(root);
		const output = path.join(root, "receipt.json");

		const processResult = await runReadinessDriver(candidate, fixtureRoot, output);
		expect(processResult.exitCode).toBe(1);
		expect(processResult.stderr).toContain("candidate is not a compiled native executable");
		await expect(fs.stat(output)).rejects.toMatchObject({ code: "ENOENT" });
	});

	it("rejects a corrupted old wrapper and atomically removes a stale receipt", async () => {
		const root = await fs.mkdtemp(path.join(os.tmpdir(), "omp-runner-canary-corrupt-wrapper-"));
		roots.push(root);
		const fixtureRoot = path.join(root, "fixture-source");
		await fs.mkdir(fixtureRoot, { recursive: true });
		const { candidate } = await createCanaryCandidate(root);
		await fs.appendFile(candidate, "\n// corrupted after content-addressing\n");
		const output = path.join(root, "receipt.json");
		await fs.writeFile(output, "{\"stale\":true}\n");

		const processResult = await runReadinessDriver(candidate, fixtureRoot, output);
		expect(processResult.exitCode).toBe(1);
		expect(processResult.stderr).toContain("candidate is not a compiled native executable");
		await expect(fs.stat(output)).rejects.toMatchObject({ code: "ENOENT" });
	});

	it("embeds the readiness worker without invoking checkout tests", async () => {
		const workerSource = await fs.readFile(
			path.resolve(import.meta.dir, "../../src/runner/canary-readiness-worker.ts"),
			"utf8",
		);
		expect(workerSource).not.toContain("Bun.spawn");
		expect(workerSource).not.toContain("bun test");
		expect(workerSource).toContain("createSessionRunner");
		expect(workerSource).toContain('record.type === "enqueue"');
		expect(workerSource).toContain("record.command as Record<string, unknown>");
		expect(workerSource).toContain("matchingEnqueues.length === 1");
	});
});

describe("createSessionRunner process composition", () => {
	it("journals one record for each replayed input command without claiming provider completion", async () => {
		const root = await fs.mkdtemp(path.join(os.tmpdir(), "omp-sdk-runner-process-"));
		roots.push(root);
		const result = await spawnChild("accept", root);
		const accepted = result.accepted as Record<string, unknown>;
		const replayed = result.replayed as Record<string, unknown>;
		const edited = result.edited as Record<string, unknown>;
		const editReplayed = result.editReplayed as Record<string, unknown>;
		const cancelled = result.cancelled as Record<string, unknown>;
		const cancelReplayed = result.cancelReplayed as Record<string, unknown>;
		expect(accepted.replayed).toBe(false);
		expect(replayed).toEqual({ ...accepted, replayed: true });
		expect(editReplayed).toEqual({ ...edited, replayed: true });
		expect(cancelReplayed).toEqual({ ...cancelled, replayed: true });
		const runnerIdentity = result.runnerIdentity as Record<string, unknown>;
		const initialSnapshot = result.initialSnapshot as Record<string, unknown>;
		const finalSnapshot = result.finalSnapshot as Record<string, unknown>;
		expect(initialSnapshot.runnerIdentity).toEqual(runnerIdentity);
		expect(finalSnapshot.runnerIdentity).toEqual(runnerIdentity);
		expect((runnerIdentity.buildRevision as Record<string, unknown>).digest).toMatch(/^[a-f0-9]{64}$/);
		expect((runnerIdentity.runnerInstance as Record<string, unknown>).runnerInstanceId).toMatch(
			/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i,
		);
		expect(Number(finalSnapshot.revision)).toBeGreaterThan(Number(initialSnapshot.revision));

		const queueRecords = await jsonlRecords(path.join(root, "mux"));
		expect(queueRecords.filter(record => record.type === "adopt")).toHaveLength(0);
		const head = await readQueueHead(path.join(root, "mux"));
		expect(head.ownershipEpoch).toBe(result.ownershipEpoch);
		const enqueues = queueRecords.filter(record => record.type === "enqueue");
		expect(enqueues).toHaveLength(2);
		expect(enqueues.map(record => (record.command as Record<string, unknown>)?.commandId)).toEqual([
			"process-blocker",
			"process-command",
		]);
		const edits = queueRecords.filter(
			record =>
				record.type === "revision" &&
				(record.command as Record<string, unknown> | undefined)?.commandId === "process-edit",
		);
		expect(edits).toHaveLength(1);
		expect(edits[0]?.runnerRevision).toBe(3);
		const cancellations = queueRecords.filter(
			record =>
				record.type === "state" &&
				record.state === "cancelled" &&
				(record.command as Record<string, unknown> | undefined)?.commandId === "process-cancel",
		);
		expect(cancellations).toHaveLength(1);
		expect(cancellations[0]?.runnerRevision).toBe(4);
		expect(queueRecords.filter(record => record.type === "terminal")).toHaveLength(0);

		const sessionLines = (await fs.readFile(String(result.sessionFile), "utf8"))
			.split("\n")
			.filter(Boolean)
			.map(line => JSON.parse(line) as Record<string, unknown>);
		expect(sessionLines[0]?.type).toBe("session");
	});

	it("stops and releases idempotently using the real ownership lease", async () => {
		const root = await fs.mkdtemp(path.join(os.tmpdir(), "omp-sdk-runner-stop-"));
		roots.push(root);
		expect(await spawnChild("stop", root)).toEqual({ replacementCurrent: true });
	});
});
