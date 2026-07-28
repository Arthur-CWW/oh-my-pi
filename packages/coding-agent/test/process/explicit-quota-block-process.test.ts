import { afterEach, describe, expect, it } from "bun:test";
import * as fs from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";

const roots: string[] = [];
const QUOTA_ENTRY = "quota_admission_state";
const ROUTE_RESOLUTION_ENTRY = "omp:route-resolution:v1";

interface ChildResult {
	text: string;
	resultIds: readonly string[];
	jobs: number;
	registryChild: boolean;
	customTypes: readonly string[];
	artifactExists: boolean;
	childSessionExists: boolean;
	routeResolutionEntries: number;
	quotaDecisionBlocks: number;
	unhandledRejections: number;
	receipts?: readonly { provider: string; model: string; lastUserText: string }[];
	routeWinningLayer?: string;
	originalProvider?: string;
	originalModel?: string;
	finalProvider?: string;
	finalModel?: string;
	routeReason?: string | null;
	quotaSampleCount?: number;
	childSessionCount?: number;
	jobStatuses?: readonly string[];
}

const CHILD_SOURCE = String.raw`
import * as fs from "node:fs/promises";
import * as path from "node:path";
import { AsyncJobManager } from "@oh-my-pi/pi-coding-agent/async/job-manager";
import { ModelRegistry } from "@oh-my-pi/pi-coding-agent/config/model-registry";
import { Settings } from "@oh-my-pi/pi-coding-agent/config/settings";
import { AgentRegistry } from "@oh-my-pi/pi-coding-agent/registry/agent-registry";
import { AuthStorage } from "@oh-my-pi/pi-coding-agent/session/auth-storage";
import { SessionManager } from "@oh-my-pi/pi-coding-agent/session/session-manager";
import { acquireSessionOwnership } from "@oh-my-pi/pi-coding-agent/session/session-ownership";
import { TaskTool } from "@oh-my-pi/pi-coding-agent/task";
import { QUOTA_ADMISSION_CUSTOM_TYPE, createQuotaAdmissionStateRecord } from "@oh-my-pi/pi-coding-agent/task/quota-admission";

const home = process.env.HOME;
const cwd = process.env.CWD;
const sessionsDir = process.env.SESSIONS_DIR;
const artifactsDir = process.env.ARTIFACTS_DIR;
if (!home || !cwd || !sessionsDir || !artifactsDir) throw new Error("missing explicit quota block child environment");
const TEST_BUILD_REVISION = { digest: "0".repeat(64), version: "explicit-quota-block-process-test" };
const TEST_RUNNER_INSTANCE_IDENTITY = {
	runnerInstanceId: "00000000-0000-4000-8000-000000000008",
	startedAt: "2026-01-01T00:00:00.000Z",
};

const provider = "provider-a";
const model = "model-a";
const selector = provider + "/" + model;
let unhandledRejections = 0;
process.on("unhandledRejection", () => { unhandledRejections += 1; });

const authStorage = await AuthStorage.create(path.join(home, "auth.db"));
const sessionManager = SessionManager.create(cwd, sessionsDir);
const ownership = await acquireSessionOwnership(sessionManager.getSessionFile(), sessionManager.getSessionId(), {
	root: path.join(home, "ownership"),
	buildRevision: TEST_BUILD_REVISION,
	runnerInstanceIdentity: TEST_RUNNER_INSTANCE_IDENTITY,
});
sessionManager.bindSessionOwnership(ownership);
const jobs = new AsyncJobManager({ onJobComplete: () => {} });

try {
	await fs.mkdir(cwd, { recursive: true });
	await fs.mkdir(path.join(cwd, ".omp", "agents"), { recursive: true });
	await fs.mkdir(artifactsDir, { recursive: true });
	await fs.writeFile(path.join(cwd, ".omp", "agents", "task.md"), "---\nname: task\ndescription: Minimal task agent\n---\nYou are a task agent.\n");
	if (!(await ownership.isCurrent())) throw new Error("explicit quota block ownership was not current");

	const registry = new ModelRegistry(authStorage);
	registry.registerProvider(provider, {
		baseUrl: "http://provider-a.invalid/v1",
		api: "openai-completions",
		apiKey: "TEST_KEY",
		models: [{
			id: model,
			name: "Provider A model A",
			reasoning: false,
			input: ["text"],
			cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
			contextWindow: 4096,
			maxTokens: 1024,
		}],
	}, "explicit-quota-block");
	authStorage.setRuntimeApiKey(provider, "runtime-key");
	if (!registry.find(provider, model)) throw new Error("explicit quota block model was not registered");

	const settings = Settings.isolated({
		"async.enabled": true,
		"quotaAdmission.enabled": true,
		"quotaAdmission.reservePercent": 20,
		"task.isolation.mode": "none",
	});
	const now = Date.now();
	sessionManager.appendCustomEntry(QUOTA_ADMISSION_CUSTOM_TYPE, createQuotaAdmissionStateRecord({
		samples: [{
			poolId: provider + ":pool-a",
			windowId: "five-hour",
			modelId: model,
			observedAtMs: now,
			remainingPercent: 1,
			resetAtMs: now + 3_600_000,
			emaBurnPerHour: 0,
		}],
		decisions: [],
	}, now));
	const initialQuotaEntries = sessionManager.getEntries().filter(entry => entry.type === "custom" && entry.customType === QUOTA_ADMISSION_CUSTOM_TYPE).length;
	const tool = await TaskTool.create({
		cwd,
		hasUI: false,
		settings,
		getSessionFile: () => sessionManager.getSessionFile(),
		getSessionSpawns: () => "*",
		getSessionId: () => sessionManager.getSessionId(),
		getArtifactsDir: () => artifactsDir,
		asyncJobManager: jobs,
		authStorage,
		modelRegistry: registry,
		sessionManager,
	});
	const result = await tool.execute("explicit-quota-block", {
		agent: "task",
		id: "MustNotAllocate",
		model: selector,
		assignment: "This must be blocked before allocation.",
	});
	const entries = sessionManager.getEntries();
	const customTypes = entries.filter(entry => entry.type === "custom").map(entry => entry.customType);
	const quotaEntries = entries.filter(entry => entry.type === "custom" && entry.customType === QUOTA_ADMISSION_CUSTOM_TYPE);
	const finalQuota = quotaEntries.at(-1);
	const finalQuotaData =
		finalQuota && finalQuota.type === "custom" && typeof finalQuota.data === "object" && finalQuota.data !== null
			? finalQuota.data
			: undefined;
	const finalQuotaState =
		finalQuotaData && typeof finalQuotaData.state === "object" && finalQuotaData.state !== null
			? finalQuotaData.state
			: undefined;
	const decisionCount = finalQuotaState && Array.isArray(finalQuotaState.decisions)
		? finalQuotaState.decisions.filter(decision => decision && typeof decision === "object" && decision.outcome === "block").length
		: 0;
	const text = result.content.find(part => part.type === "text");
	const childArtifacts = path.join(artifactsDir, "MustNotAllocate");
	const childSession = path.join(sessionsDir, "MustNotAllocate.jsonl");
	console.log(JSON.stringify({
		text: text && text.type === "text" ? text.text : "",
		resultIds: result.details.results.map(item => item.id),
		jobs: jobs.getAllJobs().length,
		registryChild: AgentRegistry.global().get("MustNotAllocate") !== undefined,
		customTypes,
		artifactExists: await Bun.file(childArtifacts).exists(),
		childSessionExists: await Bun.file(childSession).exists(),
		routeResolutionEntries: customTypes.filter(type => type === "omp:route-resolution:v1").length,
		quotaDecisionBlocks: quotaEntries.length === initialQuotaEntries + 1 ? decisionCount : -1,
		unhandledRejections,
	}));
} finally {
	await jobs.dispose({ timeoutMs: 1000 });
	await sessionManager.close();
	authStorage.close();
	await ownership.release();
}
process.exit(0);
`;

const AUTOMATIC_CHILD_SOURCE = String.raw`
import * as fs from "node:fs/promises";
import * as path from "node:path";
import { clearCustomApis, registerCustomApi } from "@oh-my-pi/pi-ai";
import { AssistantMessageEventStream } from "@oh-my-pi/pi-ai/utils/event-stream";
import { AsyncJobManager } from "@oh-my-pi/pi-coding-agent/async/job-manager";
import { ModelRegistry } from "@oh-my-pi/pi-coding-agent/config/model-registry";
import { Settings } from "@oh-my-pi/pi-coding-agent/config/settings";
import { AgentRegistry } from "@oh-my-pi/pi-coding-agent/registry/agent-registry";
import { AuthStorage } from "@oh-my-pi/pi-coding-agent/session/auth-storage";
import { SessionManager } from "@oh-my-pi/pi-coding-agent/session/session-manager";
import { acquireSessionOwnership } from "@oh-my-pi/pi-coding-agent/session/session-ownership";
import { TaskTool } from "@oh-my-pi/pi-coding-agent/task";
import { QUOTA_ADMISSION_CUSTOM_TYPE, createQuotaAdmissionStateRecord } from "@oh-my-pi/pi-coding-agent/task/quota-admission";
import { createAssistantMessage } from "./test/helpers/agent-session-setup";

const home = process.env.HOME;
const cwd = process.env.CWD;
const sessionsDir = process.env.SESSIONS_DIR;
const artifactsDir = process.env.ARTIFACTS_DIR;
const receiptsFile = process.env.RECEIPTS_FILE;
if (!home || !cwd || !sessionsDir || !artifactsDir || !receiptsFile) throw new Error("missing automatic quota reroute child environment");
const TEST_BUILD_REVISION = { digest: "0".repeat(64), version: "automatic-quota-reroute-process-test" };
const TEST_RUNNER_INSTANCE_IDENTITY = {
	runnerInstanceId: "00000000-0000-4000-8000-000000000009",
	startedAt: "2026-01-01T00:00:00.000Z",
};

const providerA = "provider-a";
const providerB = "provider-b";
const modelA = "model-a";
const modelB = "model-b";
let unhandledRejections = 0;
process.on("unhandledRejection", () => { unhandledRejections += 1; });

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

function createProvider(provider, model, api) {
	const streamSimple = (selectedModel, context) => {
		const stream = new AssistantMessageEventStream();
		void (async () => {
			await fs.appendFile(receiptsFile, JSON.stringify({ provider, model: selectedModel.id, lastUserText: lastUserText(context) }) + "\n");
			const message = createAssistantMessage("automatic provider receipt");
			stream.push({ type: "start", partial: message });
			stream.push({ type: "text_delta", contentIndex: 0, delta: "automatic provider receipt", partial: message });
			stream.push({ type: "done", reason: "stop", message });
		})();
		return stream;
	};
	return {
		baseUrl: "http://automatic-quota-reroute.invalid/v1",
		api,
		apiKey: "deterministic-key",
		models: [{
			id: model,
			name: provider + " " + model,
			reasoning: false,
			input: ["text"],
			cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
			contextWindow: 4096,
			maxTokens: 1024,
		}],
		streamSimple,
	};
}

clearCustomApis();
const authStorage = await AuthStorage.create(path.join(home, "auth.db"));
const sessionManager = SessionManager.create(cwd, sessionsDir);
const ownership = await acquireSessionOwnership(sessionManager.getSessionFile(), sessionManager.getSessionId(), {
	root: path.join(home, "ownership"),
	buildRevision: TEST_BUILD_REVISION,
	runnerInstanceIdentity: TEST_RUNNER_INSTANCE_IDENTITY,
});
sessionManager.bindSessionOwnership(ownership);
const jobs = new AsyncJobManager({ onJobComplete: () => {} });

try {
	await fs.mkdir(cwd, { recursive: true });
	await fs.mkdir(path.join(cwd, ".omp", "agents"), { recursive: true });
	await fs.mkdir(artifactsDir, { recursive: true });
	await fs.writeFile(path.join(cwd, ".omp", "agents", "task.md"), "---\nname: task\ndescription: Automatic quota task agent\nmodel:\n  - " + providerA + "/" + modelA + "\n  - " + providerB + "/" + modelB + "\n---\nYou are a task agent.\n");
	if (!(await ownership.isCurrent())) throw new Error("automatic quota reroute ownership was not current");

	const registry = new ModelRegistry(authStorage);
	const configA = createProvider(providerA, modelA, "automatic-quota-api-a");
	const configB = createProvider(providerB, modelB, "automatic-quota-api-b");
	registry.registerProvider(providerA, configA, "automatic-quota-reroute");
	registry.registerProvider(providerB, configB, "automatic-quota-reroute");
	registerCustomApi("automatic-quota-api-a", configA.streamSimple);
	registerCustomApi("automatic-quota-api-b", configB.streamSimple);
	authStorage.setRuntimeApiKey(providerA, "deterministic-key");
	authStorage.setRuntimeApiKey(providerB, "deterministic-key");
	if (!registry.find(providerA, modelA) || !registry.find(providerB, modelB)) throw new Error("automatic quota reroute models were not registered");

	const settings = Settings.isolated({
		"async.enabled": true,
		"quotaAdmission.enabled": true,
		"quotaAdmission.reservePercent": 20,
		"task.isolation.mode": "none",
	});
	const now = Date.now();
	sessionManager.appendCustomEntry(QUOTA_ADMISSION_CUSTOM_TYPE, createQuotaAdmissionStateRecord({
		samples: [
			{ poolId: providerA + ":pool-a", windowId: "five-hour", modelId: modelA, observedAtMs: now, remainingPercent: 1, resetAtMs: now + 3_600_000, emaBurnPerHour: 0 },
			{ poolId: providerB + ":pool-b", windowId: "five-hour", modelId: modelB, observedAtMs: now, remainingPercent: 90, resetAtMs: now + 3_600_000, emaBurnPerHour: 0 },
		],
		decisions: [],
	}, now));
	const tool = await TaskTool.create({
		cwd,
		hasUI: false,
		settings,
		getSessionFile: () => sessionManager.getSessionFile(),
		getSessionSpawns: () => "*",
		getSessionId: () => sessionManager.getSessionId(),
		getArtifactsDir: () => artifactsDir,
		asyncJobManager: jobs,
		authStorage,
		modelRegistry: registry,
		sessionManager,
	});
	const result = await tool.execute("automatic-quota-reroute", {
		agent: "task",
		id: "AutomaticReroute",
		assignment: "Complete this deterministic automatic reroute task.",
	});
	await Promise.all(jobs.getAllJobs().map(job => job.promise));
	const entries = sessionManager.getEntries();
	const routeEntries = entries.filter(entry => entry.type === "custom" && entry.customType === "omp:route-resolution:v1");
	const routeEntry = routeEntries.at(-1);
	const route = routeEntry && routeEntry.type === "custom" && typeof routeEntry.data === "object" && routeEntry.data !== null ? routeEntry.data : {};
	const routeCandidates = Array.isArray(route.candidates) ? route.candidates : [];
	const original = routeCandidates.find(candidate => candidate && typeof candidate === "object" && candidate.disposition === "rerouted") ?? {};
	const finalRoute = route.route && typeof route.route === "object" ? route.route : {};
	const quotaEntry = entries.filter(entry => entry.type === "custom" && entry.customType === QUOTA_ADMISSION_CUSTOM_TYPE).at(-1);
	const quotaData = quotaEntry && quotaEntry.type === "custom" && typeof quotaEntry.data === "object" && quotaEntry.data !== null ? quotaEntry.data : {};
	const quotaState = quotaData.state && typeof quotaData.state === "object" ? quotaData.state : {};
	const receipts = (await Bun.file(receiptsFile).text()).trim().split("\n").filter(Boolean).map(line => JSON.parse(line));
	const childRef = AgentRegistry.global().get("AutomaticReroute");
	const childSessionExists = childRef?.sessionFile ? await Bun.file(childRef.sessionFile).exists() : false;
	console.log(JSON.stringify({
		text: result.content.find(part => part.type === "text")?.text ?? "",
		resultIds: result.details.results.map(item => item.id),
		jobs: jobs.getAllJobs().length,
		registryChild: childRef !== undefined,
		customTypes: entries.filter(entry => entry.type === "custom").map(entry => entry.customType),
		artifactExists: childSessionExists,
		childSessionExists,
		routeResolutionEntries: routeEntries.length,
		quotaDecisionBlocks: 0,
		unhandledRejections,
		receipts,
		routeWinningLayer: route.provenance?.winningLayer,
		originalProvider: original.provider,
		originalModel: original.model,
		finalProvider: finalRoute.provider,
		finalModel: finalRoute.model,
		routeReason: typeof route.reason === "string" ? route.reason : null,
		quotaSampleCount: Array.isArray(quotaState.samples) ? quotaState.samples.length : 0,
		childSessionCount: childSessionExists ? 1 : 0,
		jobStatuses: jobs.getAllJobs().map(job => job.status),
	}));
} finally {
	await jobs.dispose({ timeoutMs: 1000 });
	await sessionManager.close();
	authStorage.close();
	await ownership.release();
	clearCustomApis();
}
process.exit(0);
`;

function decodeChildResult(value: unknown): ChildResult {
	if (typeof value !== "object" || value === null || Array.isArray(value))
		throw new Error("child emitted a non-object result");
	const result = value as Record<string, unknown>;
	if (
		typeof result.text !== "string" ||
		!Array.isArray(result.resultIds) ||
		!result.resultIds.every(value => typeof value === "string") ||
		typeof result.jobs !== "number" ||
		typeof result.registryChild !== "boolean" ||
		!Array.isArray(result.customTypes) ||
		!result.customTypes.every(value => typeof value === "string") ||
		typeof result.artifactExists !== "boolean" ||
		typeof result.childSessionExists !== "boolean" ||
		typeof result.routeResolutionEntries !== "number" ||
		typeof result.quotaDecisionBlocks !== "number" ||
		typeof result.unhandledRejections !== "number"
	)
		throw new Error(`child emitted an invalid result: ${JSON.stringify(result)}`);
	const receipts = result.receipts;
	if (
		receipts !== undefined &&
		(!Array.isArray(receipts) ||
			!receipts.every(
				receipt =>
					typeof receipt === "object" &&
					receipt !== null &&
					typeof receipt.provider === "string" &&
					typeof receipt.model === "string" &&
					typeof receipt.lastUserText === "string",
			))
	)
		throw new Error(`child emitted invalid receipts: ${JSON.stringify(result)}`);
	if (
		(result.routeWinningLayer !== undefined && typeof result.routeWinningLayer !== "string") ||
		(result.originalProvider !== undefined && typeof result.originalProvider !== "string") ||
		(result.originalModel !== undefined && typeof result.originalModel !== "string") ||
		(result.finalProvider !== undefined && typeof result.finalProvider !== "string") ||
		(result.finalModel !== undefined && typeof result.finalModel !== "string") ||
		(result.routeReason !== undefined && result.routeReason !== null && typeof result.routeReason !== "string") ||
		(result.quotaSampleCount !== undefined && typeof result.quotaSampleCount !== "number") ||
		(result.childSessionCount !== undefined && typeof result.childSessionCount !== "number") ||
		(result.jobStatuses !== undefined &&
			(!Array.isArray(result.jobStatuses) || !result.jobStatuses.every(status => typeof status === "string")))
	)
		throw new Error(`child emitted invalid automatic route result: ${JSON.stringify(result)}`);
	return {
		text: result.text,
		resultIds: result.resultIds as string[],
		jobs: result.jobs,
		registryChild: result.registryChild,
		customTypes: result.customTypes as string[],
		artifactExists: result.artifactExists,
		childSessionExists: result.childSessionExists,
		routeResolutionEntries: result.routeResolutionEntries,
		quotaDecisionBlocks: result.quotaDecisionBlocks,
		unhandledRejections: result.unhandledRejections,
		receipts: receipts as ChildResult["receipts"],
		routeWinningLayer: result.routeWinningLayer as ChildResult["routeWinningLayer"],
		originalProvider: result.originalProvider as ChildResult["originalProvider"],
		originalModel: result.originalModel as ChildResult["originalModel"],
		finalProvider: result.finalProvider as ChildResult["finalProvider"],
		finalModel: result.finalModel as ChildResult["finalModel"],
		routeReason: result.routeReason as ChildResult["routeReason"],
		quotaSampleCount: result.quotaSampleCount as ChildResult["quotaSampleCount"],
		childSessionCount: result.childSessionCount as ChildResult["childSessionCount"],
		jobStatuses: result.jobStatuses as ChildResult["jobStatuses"],
	};
}

async function runChild(environment: Record<string, string>): Promise<{ result: ChildResult; stderr: string }> {
	const child = Bun.spawn({
		cmd: [process.execPath, "-e", environment.ACTION === "automatic" ? AUTOMATIC_CHILD_SOURCE : CHILD_SOURCE],
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
	if (exitCode !== 0) throw new Error(`explicit quota block child failed (${exitCode}): ${stderr}`);
	const line = stdout.trim().split("\n").at(-1);
	if (!line) throw new Error("explicit quota block child emitted no result");
	return { result: decodeChildResult(JSON.parse(line)), stderr };
}

afterEach(async () => {
	await Promise.all(roots.splice(0).map(root => fs.rm(root, { recursive: true, force: true })));
});

describe("explicit quota block process proof", () => {
	it("blocks an explicit unavailable model before allocating a child", async () => {
		const root = await fs.mkdtemp(path.join(os.tmpdir(), "omp-explicit-quota-block-process-"));
		roots.push(root);
		const { result, stderr } = await runChild({
			HOME: path.join(root, "home"),
			CWD: path.join(root, "project"),
			SESSIONS_DIR: path.join(root, "sessions"),
			ARTIFACTS_DIR: path.join(root, "artifacts"),
			XDG_CONFIG_HOME: path.join(root, "xdg-config"),
			XDG_DATA_HOME: path.join(root, "xdg-data"),
			XDG_STATE_HOME: path.join(root, "xdg-state"),
		});

		expect(stderr).not.toContain("unhandledRejection");
		expect(result.unhandledRejections).toBe(0);
		expect(result.text).toContain("Quota admission blocked provider-a/model-a (reserve).");
		expect(result.resultIds.every(id => id.length === 0)).toBe(true);
		expect(result.jobs).toBe(0);
		expect(result.registryChild).toBe(false);
		expect(result.artifactExists).toBe(false);
		expect(result.childSessionExists).toBe(false);
		expect(result.routeResolutionEntries).toBe(0);
		expect(result.quotaDecisionBlocks).toBe(1);
		expect(result.customTypes.filter(type => type === QUOTA_ENTRY)).toHaveLength(2);
		expect(result.customTypes).not.toContain(ROUTE_RESOLUTION_ENTRY);
	}, 20_000);
});

describe("automatic quota reroute process proof", () => {
	it("reroutes a frontmatter candidate from unavailable A to healthy B", async () => {
		const root = await fs.mkdtemp(path.join(os.tmpdir(), "omp-automatic-quota-reroute-process-"));
		roots.push(root);
		const { result, stderr } = await runChild({
			ACTION: "automatic",
			HOME: path.join(root, "home"),
			CWD: path.join(root, "project"),
			SESSIONS_DIR: path.join(root, "sessions"),
			ARTIFACTS_DIR: path.join(root, "artifacts"),
			RECEIPTS_FILE: path.join(root, "receipts.jsonl"),
			XDG_CONFIG_HOME: path.join(root, "xdg-config"),
			XDG_DATA_HOME: path.join(root, "xdg-data"),
			XDG_STATE_HOME: path.join(root, "xdg-state"),
		});

		expect(stderr).not.toContain("unhandledRejection");
		expect(stderr).toBe("");
		expect(result.unhandledRejections).toBe(0);
		expect(result.resultIds).toHaveLength(0);
		expect(result.jobs).toBe(1);
		expect(result.registryChild).toBe(true);
		expect(result.jobStatuses).toEqual(["completed"]);
		expect(result.childSessionExists).toBe(true);
		expect(result.childSessionCount).toBe(1);
		expect(result.receipts?.length).toBeGreaterThan(0);
		for (const receipt of result.receipts ?? []) {
			expect(receipt).toMatchObject({ provider: "provider-b", model: "model-b" });
			expect(receipt.lastUserText).toContain("Complete this deterministic automatic reroute task.");
		}
		expect(result.routeResolutionEntries).toBe(1);
		expect(result.routeWinningLayer).toBe("automatic_reroute");
		expect(result.originalProvider).toBe("provider-a");
		expect(result.originalModel).toBe("model-a");
		expect(result.finalProvider).toBe("provider-b");
		expect(result.finalModel).toBe("model-b");
		expect(result.routeReason?.length).toBeGreaterThan(0);
		expect(result.quotaSampleCount).toBeGreaterThanOrEqual(2);
	}, 20_000);
});
