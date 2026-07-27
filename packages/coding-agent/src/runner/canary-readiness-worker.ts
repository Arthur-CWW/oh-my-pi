import { randomUUID } from "node:crypto";
import * as fs from "node:fs/promises";
import * as path from "node:path";
import { getBundledModel } from "@oh-my-pi/pi-catalog/models";
import { VERSION } from "@oh-my-pi/pi-utils/dirs";
import { Effect } from "effect";
import { ModelRegistry } from "../config/model-registry";
import { Settings } from "../config/settings";
import { createSessionRunner } from "../sdk";
import { AuthStorage } from "../session/auth-storage";
import { SessionManager } from "../session/session-manager";
import { acquireSessionOwnership } from "../session/session-ownership";

const SHA256 = /^[a-f0-9]{64}$/;

export interface CandidateBuildRevision {
	buildDigest: string;
	version: string;
}

function candidateDigest(): string {
	const matches = path.basename(process.execPath).match(/[a-f0-9]{64}/g);
	if (!matches || matches.length !== 1 || !SHA256.test(matches[0])) {
		throw new Error("candidate executable filename must contain exactly one SHA-256 digest");
	}
	return matches[0];
}

export function candidateBuildRevision(): CandidateBuildRevision {
	return { buildDigest: candidateDigest(), version: VERSION };
}

function parseWorkerArguments(argv: string[]): { fixtureRoot: string; output: string; commandId: string } {
	const values = new Map<string, string>();
	for (let index = 0; index < argv.length; index += 2) {
		const flag = argv[index];
		const value = argv[index + 1];
		if (!value || !["--fixture-root", "--output", "--command-id"].includes(flag)) throw new Error("invalid readiness worker arguments");
		if (values.has(flag)) throw new Error(`duplicate readiness worker argument: ${flag}`);
		values.set(flag, value);
	}
	if (values.size !== 3) throw new Error("missing readiness worker arguments");
	return { fixtureRoot: path.resolve(values.get("--fixture-root")!), output: path.resolve(values.get("--output")!), commandId: values.get("--command-id")! };
}

async function jsonlRecords(root: string): Promise<Array<Record<string, unknown>>> {
	const records: Array<Record<string, unknown>> = [];
	for (const entry of await fs.readdir(root, { withFileTypes: true })) {
		const target = path.join(root, entry.name);
		if (entry.isDirectory()) records.push(...(await jsonlRecords(target)));
		else if (entry.name.endsWith(".jsonl")) {
			for (const line of (await fs.readFile(target, "utf8")).split("\n")) if (line.trim()) records.push(JSON.parse(line) as Record<string, unknown>);
		}
	}
	return records;
}

export async function runCandidateReadinessWorker(argv: string[]): Promise<void> {
	const args = parseWorkerArguments(argv);
	if (!process.env.AGENT_MUX_DIR) throw new Error("AGENT_MUX_DIR is required");
	const buildRevision = candidateBuildRevision();
	const sessions = path.join(args.fixtureRoot, ".omp-canary-sessions");
	await fs.mkdir(sessions, { recursive: true });
	const sessionManager = SessionManager.create(args.fixtureRoot, sessions);
	await sessionManager.flush();
	const sessionFile = sessionManager.getSessionFile();
	if (!sessionFile) throw new Error("readiness session was not persisted");
	const runnerInstance = { runnerInstanceId: randomUUID(), startedAt: new Date().toISOString() };
	const runnerIdentity = { buildRevision: { digest: buildRevision.buildDigest, version: buildRevision.version }, runnerInstance };
	const ownership = await acquireSessionOwnership(sessionFile, sessionManager.getSessionId(), { buildRevision: runnerIdentity.buildRevision, runnerInstanceIdentity: runnerInstance });
	const model = getBundledModel("anthropic", "claude-sonnet-4-5");
	if (!model) throw new Error("bundled canary model unavailable");
	const authStorage = await AuthStorage.create(path.join(args.fixtureRoot, ".omp-canary-auth.db"));
	authStorage.setRuntimeApiKey(model.provider, "canary-must-not-call-provider");
	const result = await createSessionRunner({
		cwd: args.fixtureRoot, agentDir: path.join(args.fixtureRoot, ".omp-canary-agent"), model, authStorage,
		modelRegistry: new ModelRegistry(authStorage, path.join(args.fixtureRoot, ".omp-canary-models.yml")),
		settings: Settings.isolated({ "compaction.enabled": false }), sessionManager, ownership, runnerIdentity,
		mailboxCapacity: 8, eventCapacity: 8, disableExtensionDiscovery: true, enableMCP: false, enableLsp: false,
		skipPythonPreflight: true, contextFiles: [], skills: [], rules: [], promptTemplates: [], slashCommands: [], customTools: [],
	});
	await sessionManager.ensureOnDisk();
	const proof = await Effect.runPromise(Effect.scoped(Effect.gen(function* () {
		const controller = yield* result.runner.attachView({ schemaVersion: 1, kind: "attachView", commandId: "attach-canary-controller", correlationId: "attach-canary-controller", expectedRevision: 0, viewId: "canary-controller", capability: "controller" });
		if (controller.capability !== "controller") throw new Error("controller attachment failed");
		const initial = yield* controller.snapshot();
		const mutation = {
			schemaVersion: 1 as const,
			kind: "submitInput" as const,
			commandId: args.commandId,
			correlationId: args.commandId,
			expectedRevision: initial.revision,
			viewId: controller.viewId,
			controllerEpoch: controller.controllerEpoch,
			payload: { text: "canary durable mutation", deliveryClass: "followUp" as const },
		};
		const accepted = yield* controller.submitInput(mutation);
		const replayed = yield* controller.submitInput(mutation);
		const final = yield* controller.snapshot();
		return { initial, final, accepted, replayed };
	})));
	await Effect.runPromise(Effect.scoped(result.runner.stop()));
	const replacementIdentity = { runnerInstanceId: randomUUID(), startedAt: new Date().toISOString() };
	const replacement = await acquireSessionOwnership(sessionFile, sessionManager.getSessionId(), { buildRevision: runnerIdentity.buildRevision, runnerInstanceIdentity: replacementIdentity });
	const leaseReacquired = await replacement.isCurrent();
	await replacement.release();
	const transcript = await fs.readFile(sessionFile, "utf8");
	const muxRecords = await jsonlRecords(process.env.AGENT_MUX_DIR);
	const matchingEnqueues = muxRecords.filter(
		record =>
			record.type === "enqueue" &&
			(record.command as Record<string, unknown> | undefined)?.commandId === args.commandId,
	);
	const receipt = {
		schemaVersion: 1, buildDigest: buildRevision.buildDigest, version: buildRevision.version,
		runnerInstanceId: runnerInstance.runnerInstanceId, fixtureSessionId: sessionManager.getSessionId(), ownerEpoch: ownership.ownerEpoch,
		startedAt: runnerInstance.startedAt, stoppedAt: new Date().toISOString(), initialSnapshotRevision: proof.initial.revision,
		finalSnapshotRevision: proof.final.revision, commandId: args.commandId,
		proof: { mutationAppliedExactlyOnce: proof.accepted.replayed === false && proof.replayed.replayed === true, leaseReleased: true, leaseReacquired, jsonlPersisted: transcript.includes(sessionManager.getSessionId()), queuePersisted: matchingEnqueues.length === 1 },
	};
	await fs.writeFile(args.output, `${JSON.stringify(receipt)}\n`, { flag: "wx", mode: 0o600 });
}
