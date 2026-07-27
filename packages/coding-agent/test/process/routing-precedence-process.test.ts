import { afterEach, describe, expect, it } from "bun:test";
import * as fs from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";

const roots: string[] = [];

interface Receipt {
	provider: string;
	model: string;
	lastUserText: string;
}

interface ModelChange {
	model: string;
	role?: string;
}

interface ChildResult {
	liveModel: string;
	resolution: { selector: string; winningLayer: string };
	sessionId: string;
	modelChanges: readonly ModelChange[];
	thinkingLevels: readonly string[];
	unhandledRejections: number;
	diagnostics: readonly string[];
}

const CHILD_SOURCE = String.raw`
import * as fs from "node:fs/promises";
import { clearCustomApis, Effort, registerCustomApi } from "@oh-my-pi/pi-ai";
import { AssistantMessageEventStream } from "@oh-my-pi/pi-ai/utils/event-stream";
import { createAssistantMessage } from "./test/helpers/agent-session-setup";
import { ModelRegistry } from "@oh-my-pi/pi-coding-agent/config/model-registry";
import { Settings } from "@oh-my-pi/pi-coding-agent/config/settings";
import { createAgentSession } from "@oh-my-pi/pi-coding-agent/sdk";
import { AuthStorage } from "@oh-my-pi/pi-coding-agent/session/auth-storage";
import { SessionManager } from "@oh-my-pi/pi-coding-agent/session/session-manager";
import { acquireSessionOwnership } from "@oh-my-pi/pi-coding-agent/session/session-ownership";

const home = process.env.HOME;
const cwd = process.env.CWD;
const agentDir = process.env.AGENT_DIR;
const sessionsDir = process.env.SESSIONS_DIR;
const configOverlay = process.env.CONFIG_OVERLAY;
const receiptsFile = process.env.RECEIPTS_FILE;
if (!home || !cwd || !agentDir || !sessionsDir || !configOverlay || !receiptsFile) {
	throw new Error("missing routing precedence child environment");
}

const providerA = "routing-precedence-a";
const providerB = "routing-precedence-b";
const modelA = "model-a";
const modelB = "model-b";
const selectorA = providerA + "/" + modelA;
const selectorB = providerB + "/" + modelB;

function lastUserText(context) {
	for (const message of [...context.messages].reverse()) {
		if (message.role !== "user") continue;
		if (typeof message.content === "string") return message.content;
		if (Array.isArray(message.content)) {
			const part = message.content.find(value => value?.type === "text" && typeof value.text === "string");
			if (part) return part.text;
		}
	}
	return "";
}

function createProvider(provider, api, id) {
	return {
		baseUrl: "http://routing-precedence.invalid/v1",
		api,
		apiKey: "deterministic-key",
		models: [{
			id,
			name: provider + " " + id,
			reasoning: true,
			thinking: { mode: "effort", efforts: [Effort.Low, Effort.Medium, Effort.High] },
			input: ["text"],
			cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
			contextWindow: 4096,
			maxTokens: 1024,
		}],
		streamSimple(model, context) {
			const stream = new AssistantMessageEventStream();
			void (async () => {
				await fs.appendFile(receiptsFile, JSON.stringify({ provider, model: model.id, lastUserText: lastUserText(context) }) + "\n");
				const message = createAssistantMessage("provider receipt");
				stream.push({ type: "start", partial: message });
				stream.push({ type: "text_delta", contentIndex: 0, delta: "provider receipt", partial: message });
				stream.push({ type: "done", reason: "stop", message });
			})();
			return stream;
		},
	};
}

let unhandledRejections = 0;
process.on("unhandledRejection", () => { unhandledRejections += 1; });
const TEST_BUILD_REVISION = { digest: "0".repeat(64), version: "routing-precedence-process-test" };
const TEST_RUNNER_INSTANCE_IDENTITY = {
	runnerInstanceId: "00000000-0000-4000-8000-000000000129",
	startedAt: "2026-07-15T00:00:00.000Z",
};

clearCustomApis();
const authStorage = await AuthStorage.create(path.join(home, "auth.db"));
const registry = new ModelRegistry(authStorage);
const manager = SessionManager.create(cwd, sessionsDir);
const ownership = await acquireSessionOwnership(manager.getSessionFile(), manager.getSessionId(), {
	root: path.join(home, "ownership"),
	buildRevision: TEST_BUILD_REVISION,
	runnerInstanceIdentity: TEST_RUNNER_INSTANCE_IDENTITY,
});
manager.bindSessionOwnership(ownership);

try {
	await fs.mkdir(cwd, { recursive: true });
	await fs.mkdir(agentDir, { recursive: true });
	await fs.writeFile(path.join(agentDir, "config.yml"), "modelRoles:\n  default: " + selectorA + "\n");
	await fs.writeFile(configOverlay, "modelRoles:\n  default: " + selectorA + "\n");
	if (!(await ownership.isCurrent())) throw new Error("routing precedence ownership was not current");
	const configA = createProvider(providerA, "routing-precedence-api-a", modelA);
	const configB = createProvider(providerB, "routing-precedence-api-b", modelB);
	registry.registerProvider(providerA, configA, "routing-precedence");
	registry.registerProvider(providerB, configB, "routing-precedence");
	registerCustomApi("routing-precedence-api-a", configA.streamSimple);
	registerCustomApi("routing-precedence-api-b", configB.streamSimple);
	authStorage.setRuntimeApiKey(providerA, "deterministic-key");
	authStorage.setRuntimeApiKey(providerB, "deterministic-key");
	const selectedA = registry.find(providerA, modelA);
	const selectedB = registry.find(providerB, modelB);
	if (!selectedA || !selectedB) throw new Error("routing precedence models were not registered");

	const settings = await Settings.init({ cwd, agentDir, configFiles: [configOverlay] });
	const { session } = await createAgentSession({
		cwd,
		agentDir,
		authStorage,
		modelRegistry: registry,
		sessionManager: manager,
		model: selectedA,
		settings,
		disableExtensionDiscovery: true,
		skills: [],
		contextFiles: [],
		promptTemplates: [],
		slashCommands: [],
		enableMCP: false,
		enableLsp: false,
		rules: [],
		workspaceTree: { rootPath: cwd, rendered: "", truncated: false, totalLines: 0, agentsMdFiles: [] },
		toolNames: [],
	});
	try {
		await session.setModelExplicitRuntime(selectedB, "default", { selector: selectorB, thinkingLevel: Effort.High });
		await settings.reloadFromDisk();
		await session.prompt("provider receipt proof");
		await session.waitForIdle();
		const resolution = settings.resolveModelRole("default");
		const entries = manager.getEntries();
		console.log(JSON.stringify({
			liveModel: session.model ? session.model.provider + "/" + session.model.id : "",
			resolution: { selector: resolution.effectiveSelector, winningLayer: resolution.winningLayer },
			sessionId: manager.getSessionId(),
			modelChanges: entries.filter(entry => entry.type === "model_change").map(entry => ({ model: entry.model, role: entry.role })),
			thinkingLevels: entries.filter(entry => entry.type === "thinking_level_change").map(entry => entry.thinkingLevel),
			unhandledRejections,
			diagnostics: session.messages
				.filter(message => message.role === "assistant")
				.map(message => message.errorMessage ?? message.stopReason ?? "assistant"),
		}));
	} finally {
		await session.dispose();
	}
} finally {
	await manager.close();
	authStorage.close();
	await ownership.release();
	clearCustomApis();
}
process.exit(0);
`;

interface PolicyWriterResult {
	transactionId: string;
	sequence: number;
	rollbackTransactionId: string;
	rollbackSequence: number;
	journalPath: string;
	pid: number;
}

interface PolicyAdmission {
	lane: string;
	source: string;
	pid: number;
	policy?: {
		key: string;
		sourceLayer: string;
		transactionId?: string;
		sequence: number;
		snapshotAt: string;
	};
	decision: Record<string, unknown>;
}

interface PolicyReaderResult {
	pid: number;
	writerLeasePid: number;
	firstAtAdmission: PolicyAdmission;
	firstAfterRollback: PolicyAdmission;
	secondAfterRollback: PolicyAdmission;
	settingsYamlBefore: string;
	settingsYamlAfter: string;
}

const POLICY_WRITER_SOURCE = String.raw`
import * as fs from "node:fs/promises";
import { Effect } from "effect";
import { PolicyJournal } from "@oh-my-pi/pi-coding-agent/policy/policy-journal";
import { makePolicyService } from "@oh-my-pi/pi-coding-agent/policy/policy-service";

const policyDirectory = process.env.POLICY_DIRECTORY;
const committedFile = process.env.COMMITTED_FILE;
const firstAdmissionFile = process.env.FIRST_ADMISSION_FILE;
const rollbackFile = process.env.ROLLBACK_FILE;
if (!policyDirectory || !committedFile || !firstAdmissionFile || !rollbackFile) {
	throw new Error("missing policy writer environment");
}

async function waitForFile(file, label) {
	const deadline = Date.now() + 10_000;
	while (Date.now() < deadline) {
		try {
			return await fs.readFile(file, "utf8");
		} catch (error) {
			if (!(error instanceof Error) || !("code" in error) || error.code !== "ENOENT") throw error;
		}
		await Bun.sleep(10);
	}
	throw new Error("timed out waiting for " + label);
}

const journal = await PolicyJournal.acquire({ directory: policyDirectory });
try {
	const service = makePolicyService(journal);
	const setResult = await Effect.runPromise(service.set({
		key: "core.routing.implementer",
		value: "routing-policy-b/model-b",
		scope: { kind: "global" },
		reason: "prove next-admission policy routing",
	}));
	await fs.writeFile(committedFile, JSON.stringify({
		transactionId: setResult.transaction.transactionId,
		sequence: setResult.transaction.sequence,
	}) + "\n", { flag: "wx" });
	await waitForFile(firstAdmissionFile, "the first policy admission");
	const rollbackResult = await Effect.runPromise(service.rollback({
		transactionId: setResult.transaction.transactionId,
		reason: "restore the settings-backed implementer lane",
	}));
	await fs.writeFile(rollbackFile, JSON.stringify({
		transactionId: rollbackResult.transaction.transactionId,
		sequence: rollbackResult.transaction.sequence,
		rollbackOf: rollbackResult.transaction.rollbackOf,
	}) + "\n", { flag: "wx" });
	console.log(JSON.stringify({
		transactionId: setResult.transaction.transactionId,
		sequence: setResult.transaction.sequence,
		rollbackTransactionId: rollbackResult.transaction.transactionId,
		rollbackSequence: rollbackResult.transaction.sequence,
		journalPath: journal.journalPath,
		pid: process.pid,
	}));
} finally {
	await journal.release();
}
process.exit(0);
`;

const POLICY_READER_SOURCE = String.raw`
import * as fs from "node:fs/promises";
import * as path from "node:path";
import { AuthStorage } from "@oh-my-pi/pi-coding-agent/session/auth-storage";
import { ModelRegistry } from "@oh-my-pi/pi-coding-agent/config/model-registry";
import { Settings } from "@oh-my-pi/pi-coding-agent/config/settings";
import {
	configureSpawnPolicyRouting,
	resolveTaskSpawnRoute,
	snapshotTaskSpawnPolicy,
} from "@oh-my-pi/pi-coding-agent/task/spawn-route";

const home = process.env.HOME;
const cwd = process.env.CWD;
const agentDir = process.env.AGENT_DIR;
const settingsFile = process.env.SETTINGS_FILE;
const policyDirectory = process.env.POLICY_DIRECTORY;
const committedFile = process.env.COMMITTED_FILE;
const firstAdmissionFile = process.env.FIRST_ADMISSION_FILE;
const rollbackFile = process.env.ROLLBACK_FILE;
if (!home || !cwd || !agentDir || !settingsFile || !policyDirectory || !committedFile || !firstAdmissionFile || !rollbackFile) {
	throw new Error("missing policy reader environment");
}

async function waitForFile(file, label) {
	const deadline = Date.now() + 10_000;
	while (Date.now() < deadline) {
		try {
			return await fs.readFile(file, "utf8");
		} catch (error) {
			if (!(error instanceof Error) || !("code" in error) || error.code !== "ENOENT") throw error;
		}
		await Bun.sleep(10);
	}
	throw new Error("timed out waiting for " + label);
}

function providerConfig(provider, id) {
	return {
		baseUrl: "http://routing-policy.invalid/v1",
		api: "openai-responses",
		apiKey: "deterministic-key",
		models: [{
			id,
			name: provider + " " + id,
			reasoning: false,
			input: ["text"],
			cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
			contextWindow: 4096,
			maxTokens: 1024,
		}],
	};
}

function summarize(decision) {
	const policyInput = decision.consulted.find(input => input.source === "policy");
	if (!decision.route || !decision.source) {
		throw new Error("spawn admission did not resolve: " + JSON.stringify(decision));
	}
	return {
		lane: decision.route.selector,
		source: decision.source,
		pid: process.pid,
		...(policyInput?.policy ? { policy: policyInput.policy } : {}),
		decision: JSON.parse(JSON.stringify(decision)),
	};
}

await waitForFile(committedFile, "the committed policy transaction");
await fs.mkdir(cwd, { recursive: true });
await fs.mkdir(agentDir, { recursive: true });
const authStorage = await AuthStorage.create(path.join(home, "auth.db"));
try {
	const registry = new ModelRegistry(authStorage);
	const providerA = providerConfig("routing-policy-a", "model-a");
	const providerB = providerConfig("routing-policy-b", "model-b");
	registry.registerProvider("routing-policy-a", providerA, "routing-policy-process");
	registry.registerProvider("routing-policy-b", providerB, "routing-policy-process");
	authStorage.setRuntimeApiKey("routing-policy-a", "deterministic-key");
	authStorage.setRuntimeApiKey("routing-policy-b", "deterministic-key");
	const settings = await Settings.init({ cwd, agentDir, configFiles: [settingsFile] });
	const session = {
		cwd,
		hasUI: false,
		settings,
		modelRegistry: registry,
		getSessionFile: () => null,
		getSessionSpawns: () => "*",
		getActiveModelString: () => "routing-policy-a/model-a",
	};
	const implementer = {
		name: "implementer",
		description: "Implementation responsibility",
		systemPrompt: "Implement the assignment.",
		model: "routing-policy-a/model-a",
		source: "bundled",
	};
	const params = { agent: "implementer", assignment: "Prove policy routing." };
	configureSpawnPolicyRouting({ directory: policyDirectory });
	const settingsYamlBefore = await fs.readFile(settingsFile, "utf8");
	const firstSnapshot = await snapshotTaskSpawnPolicy(session);
	const firstDecision = resolveTaskSpawnRoute(session, "implementer", implementer, params, firstSnapshot);
	const firstAtAdmission = summarize(firstDecision);
	const writerLease = JSON.parse(await fs.readFile(path.join(policyDirectory, "policy-v1.lease"), "utf8"));
	await fs.writeFile(firstAdmissionFile, JSON.stringify({ admitted: true }) + "\n", { flag: "wx" });
	await waitForFile(rollbackFile, "the policy rollback");
	const firstAfterRollback = summarize(firstDecision);
	const secondSnapshot = await snapshotTaskSpawnPolicy(session);
	const secondDecision = resolveTaskSpawnRoute(session, "implementer", implementer, params, secondSnapshot);
	const settingsYamlAfter = await fs.readFile(settingsFile, "utf8");
	console.log(JSON.stringify({
		pid: process.pid,
		writerLeasePid: writerLease.pid,
		firstAtAdmission,
		firstAfterRollback,
		secondAfterRollback: summarize(secondDecision),
		settingsYamlBefore,
		settingsYamlAfter,
	}));
} finally {
	authStorage.close();
}
process.exit(0);
`;

function decodeReceipt(value: unknown): Receipt {
	if (typeof value !== "object" || value === null || Array.isArray(value))
		throw new Error("receipt was not an object");
	const receipt = value as Record<string, unknown>;
	if (
		typeof receipt.provider !== "string" ||
		typeof receipt.model !== "string" ||
		typeof receipt.lastUserText !== "string"
	) {
		throw new Error("receipt had an invalid shape");
	}
	return { provider: receipt.provider, model: receipt.model, lastUserText: receipt.lastUserText };
}

function decodeChildResult(value: unknown): ChildResult {
	if (typeof value !== "object" || value === null || Array.isArray(value))
		throw new Error("child emitted a non-object result");
	const result = value as Record<string, unknown>;
	const resolution = result.resolution;
	const validModelChanges =
		Array.isArray(result.modelChanges) &&
		result.modelChanges.every(
			change =>
				typeof change === "object" &&
				change !== null &&
				!Array.isArray(change) &&
				typeof (change as Record<string, unknown>).model === "string" &&
				((change as Record<string, unknown>).role === undefined ||
					typeof (change as Record<string, unknown>).role === "string"),
		);
	if (
		typeof result.liveModel !== "string" ||
		typeof result.sessionId !== "string" ||
		typeof result.unhandledRejections !== "number" ||
		!validModelChanges ||
		!Array.isArray(result.thinkingLevels) ||
		!result.thinkingLevels.every(level => typeof level === "string") ||
		!Array.isArray(result.diagnostics) ||
		!result.diagnostics.every(value => typeof value === "string") ||
		typeof resolution !== "object" ||
		resolution === null ||
		Array.isArray(resolution) ||
		typeof (resolution as Record<string, unknown>).selector !== "string" ||
		typeof (resolution as Record<string, unknown>).winningLayer !== "string"
	)
		throw new Error(`child emitted an invalid result: ${JSON.stringify(result)}`);
	const resolutionRecord = resolution as Record<string, unknown>;
	return {
		liveModel: result.liveModel,
		resolution: {
			selector: resolutionRecord.selector as string,
			winningLayer: resolutionRecord.winningLayer as string,
		},
		sessionId: result.sessionId,
		modelChanges: (result.modelChanges as Record<string, unknown>[]).map(change => ({
			model: change.model as string,
			...(typeof change.role === "string" ? { role: change.role } : {}),
		})),
		thinkingLevels: result.thinkingLevels as string[],
		unhandledRejections: result.unhandledRejections,
		diagnostics: result.diagnostics as string[],
	};
}

function parseJsonLine(line: string, label: string): unknown {
	try {
		return JSON.parse(line);
	} catch {
		throw new Error(`${label} was not valid JSON`);
	}
}

async function runChild(environment: Record<string, string>): Promise<{ result: ChildResult; stderr: string }> {
	const child = Bun.spawn({
		cmd: [process.execPath, "-e", CHILD_SOURCE],
		cwd: path.resolve(import.meta.dir, "../.."),
		env: { ...process.env, ...environment },
		stdout: "pipe",
		stderr: "pipe",
	});
	const [exitCode, stdout, stderr] = await Promise.all([
		child.exited,
		new Response(child.stdout).text(),
		new Response(child.stderr).text(),
	]);
	if (exitCode !== 0) throw new Error(`routing precedence child failed (${exitCode}): ${stderr}`);
	const line = stdout.trim().split("\n").at(-1);
	if (!line) throw new Error("routing precedence child emitted no result");
	return { result: decodeChildResult(parseJsonLine(line, "child result")), stderr };
}

async function readReceipts(receiptsFile: string, diagnostics: readonly string[]): Promise<Receipt[]> {
	const text = await fs.readFile(receiptsFile, "utf8").catch(error => {
		throw new Error(
			`provider receipt file missing; diagnostics=${JSON.stringify(diagnostics)}; error=${String(error)}`,
		);
	});
	return text
		.split("\n")
		.filter(Boolean)
		.map(line => decodeReceipt(parseJsonLine(line, "receipt")));
}

async function runPolicyCutoverChildren(environment: Record<string, string>): Promise<{
	writer: PolicyWriterResult;
	reader: PolicyReaderResult;
	writerStderr: string;
	readerStderr: string;
}> {
	const cwd = path.resolve(import.meta.dir, "../..");
	const env = { ...process.env, ...environment };
	const writerProcess = Bun.spawn({
		cmd: [process.execPath, "-e", POLICY_WRITER_SOURCE],
		cwd,
		env,
		stdout: "pipe",
		stderr: "pipe",
	});
	const readerProcess = Bun.spawn({
		cmd: [process.execPath, "-e", POLICY_READER_SOURCE],
		cwd,
		env,
		stdout: "pipe",
		stderr: "pipe",
	});

	const collect = async (label: string, child: typeof writerProcess): Promise<{ stdout: string; stderr: string }> => {
		const stdoutPromise = new Response(child.stdout).text();
		const stderrPromise = new Response(child.stderr).text();
		const exitCode = await Promise.race([
			child.exited,
			Bun.sleep(12_000).then(() => {
				throw new Error(`${label} timed out`);
			}),
		]);
		const [stdout, stderr] = await Promise.all([stdoutPromise, stderrPromise]);
		if (exitCode !== 0) throw new Error(`${label} failed (${exitCode}): ${stderr}`);
		return { stdout, stderr };
	};

	try {
		const [writerOutput, readerOutput] = await Promise.all([
			collect("policy writer process", writerProcess),
			collect("policy reader process", readerProcess),
		]);
		const writerLine = writerOutput.stdout.trim().split("\n").at(-1);
		const readerLine = readerOutput.stdout.trim().split("\n").at(-1);
		if (!writerLine) throw new Error("policy writer process emitted no result");
		if (!readerLine) throw new Error("policy reader process emitted no result");
		return {
			writer: parseJsonLine(writerLine, "policy writer result") as PolicyWriterResult,
			reader: parseJsonLine(readerLine, "policy reader result") as PolicyReaderResult,
			writerStderr: writerOutput.stderr,
			readerStderr: readerOutput.stderr,
		};
	} finally {
		for (const child of [writerProcess, readerProcess]) {
			if (child.exitCode !== null) continue;
			try {
				child.kill("SIGKILL");
			} catch {}
		}
		await Promise.all([writerProcess.exited, readerProcess.exited]);
	}
}

afterEach(async () => {
	await Promise.all(roots.splice(0).map(root => fs.rm(root, { recursive: true, force: true })));
});

describe("routing precedence process proof", () => {
	it("routes the next request through an explicit runtime default assignment", async () => {
		const root = await fs.mkdtemp(path.join(os.tmpdir(), "omp-routing-precedence-process-"));
		roots.push(root);
		const result = await runChild({
			HOME: path.join(root, "home"),
			CWD: path.join(root, "project"),
			AGENT_DIR: path.join(root, "agent"),
			SESSIONS_DIR: path.join(root, "sessions"),
			CONFIG_OVERLAY: path.join(root, "overlay.yml"),
			RECEIPTS_FILE: path.join(root, "receipts.jsonl"),
			XDG_CONFIG_HOME: path.join(root, "xdg-config"),
			XDG_DATA_HOME: path.join(root, "xdg-data"),
			XDG_STATE_HOME: path.join(root, "xdg-state"),
		});
		const receipts = await readReceipts(path.join(root, "receipts.jsonl"), result.result.diagnostics);

		expect(result.stderr).not.toContain("unhandledRejection");
		expect(result.result.unhandledRejections).toBe(0);
		expect(result.result.resolution).toEqual({
			selector: "routing-precedence-b/model-b:high",
			winningLayer: "runtime_override",
		});
		expect(result.result.liveModel).toBe("routing-precedence-b/model-b");
		expect(result.result.modelChanges).toContainEqual({ model: "routing-precedence-b/model-b", role: "default" });
		expect(result.result.thinkingLevels).toContain("high");
		expect(receipts).toEqual([
			{
				provider: "routing-precedence-b",
				model: "model-b",
				lastUserText: "provider receipt proof",
			},
		]);
	}, 20_000);

	it("applies and rolls back durable policy at fresh spawn admission boundaries across processes", async () => {
		const root = await fs.mkdtemp(path.join(os.tmpdir(), "omp-routing-policy-process-"));
		roots.push(root);
		const home = path.join(root, "home");
		const cwd = path.join(root, "project");
		const agentDir = path.join(root, "agent");
		const policyDirectory = path.join(root, "policy");
		const settingsFile = path.join(root, "routing.yml");
		const committedFile = path.join(root, "committed.json");
		const firstAdmissionFile = path.join(root, "first-admission.json");
		const rollbackFile = path.join(root, "rolled-back.json");
		const settingsYaml = "task:\n  agentModelOverrides:\n    implementer: routing-policy-a/model-a\n";
		await Promise.all([
			fs.mkdir(home, { recursive: true }),
			fs.mkdir(cwd, { recursive: true }),
			fs.mkdir(agentDir, { recursive: true }),
			fs.writeFile(settingsFile, settingsYaml),
		]);

		const result = await runPolicyCutoverChildren({
			HOME: home,
			CWD: cwd,
			AGENT_DIR: agentDir,
			SETTINGS_FILE: settingsFile,
			POLICY_DIRECTORY: policyDirectory,
			COMMITTED_FILE: committedFile,
			FIRST_ADMISSION_FILE: firstAdmissionFile,
			ROLLBACK_FILE: rollbackFile,
			XDG_CONFIG_HOME: path.join(root, "xdg-config"),
			XDG_DATA_HOME: path.join(root, "xdg-data"),
			XDG_STATE_HOME: path.join(root, "xdg-state"),
		});

		expect(result.writerStderr).not.toContain("unhandledRejection");
		expect(result.readerStderr).not.toContain("unhandledRejection");
		expect(result.writer.journalPath).toBe(path.join(policyDirectory, "policy-v1.jsonl"));
		expect(result.writer.pid).not.toBe(result.reader.pid);
		expect(result.reader.writerLeasePid).toBe(result.writer.pid);
		expect(result.writer.sequence).toBe(1);
		expect(result.writer.rollbackSequence).toBe(2);
		expect(typeof result.reader.firstAtAdmission.policy?.snapshotAt).toBe("string");
		expect(Number.isNaN(Date.parse(result.reader.firstAtAdmission.policy?.snapshotAt ?? ""))).toBe(false);
		expect(result.reader.firstAtAdmission).toMatchObject({
			lane: "routing-policy-b/model-b",
			source: "policy",
			pid: result.reader.pid,
			policy: {
				key: "core.routing.implementer",
				sourceLayer: "global-durable",
				transactionId: result.writer.transactionId,
				sequence: 1,
				snapshotAt: expect.any(String),
			},
		});
		expect(result.reader.firstAfterRollback).toEqual(result.reader.firstAtAdmission);
		expect(result.reader.secondAfterRollback).toMatchObject({
			lane: "routing-policy-a/model-a",
			source: "agent_model_override",
			pid: result.reader.pid,
		});
		expect(result.reader.settingsYamlBefore).toBe(settingsYaml);
		expect(result.reader.settingsYamlAfter).toBe(settingsYaml);
		expect(await fs.readFile(settingsFile, "utf8")).toBe(settingsYaml);

		const journalRecords = (await fs.readFile(result.writer.journalPath, "utf8"))
			.trim()
			.split("\n")
			.map(line => parseJsonLine(line, "policy journal record"));
		expect(journalRecords).toEqual([
			expect.objectContaining({
				transactionId: result.writer.transactionId,
				sequence: 1,
				author: expect.objectContaining({ pid: result.writer.pid }),
				mutations: [
					expect.objectContaining({
						op: "set",
						key: "core.routing.implementer",
						value: "routing-policy-b/model-b",
					}),
				],
			}),
			expect.objectContaining({
				transactionId: result.writer.rollbackTransactionId,
				sequence: 2,
				rollbackOf: result.writer.transactionId,
				author: expect.objectContaining({ pid: result.writer.pid }),
				mutations: [
					expect.objectContaining({
						op: "clear",
						key: "core.routing.implementer",
					}),
				],
			}),
		]);
	}, 20_000);
});
