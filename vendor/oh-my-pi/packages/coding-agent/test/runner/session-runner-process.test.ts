import { afterEach, describe, expect, it } from "bun:test";
import * as fs from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";
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
	const ownership = await acquireSessionOwnership(sessionFile, sessionManager.getSessionId());
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
	};
}

async function childMain(mode: string, root: string): Promise<void> {
	const composition = await construct(root);
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
					return { accepted, replayed, edited, editReplayed, cancelled, cancelReplayed };
				}),
			),
		);
		console.log(
			`${CHILD_MARKER}${JSON.stringify({
				...receipts,
				sessionFile: composition.sessionFile,
				ownershipEpoch: composition.ownershipEpoch,
			})}`,
		);
		process.exit(0);
	}

	await Effect.runPromise(Effect.scoped(composition.runner.stop()));
	await Effect.runPromise(Effect.scoped(composition.runner.stop()));
	const replacement = await acquireSessionOwnership(composition.sessionFile, composition.sessionId);
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
	throw new Error(`queue-v2/head.json not found under ${root}`);
}

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
