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

clearCustomApis();
const authStorage = await AuthStorage.create(path.join(home, "auth.db"));
const registry = new ModelRegistry(authStorage);
const manager = SessionManager.create(cwd, sessionsDir);
const ownership = await acquireSessionOwnership(manager.getSessionFile(), manager.getSessionId(), { root: path.join(home, "ownership") });
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

function decodeReceipt(value: unknown): Receipt {
	if (typeof value !== "object" || value === null || Array.isArray(value)) throw new Error("receipt was not an object");
	const receipt = value as Record<string, unknown>;
	if (typeof receipt.provider !== "string" || typeof receipt.model !== "string" || typeof receipt.lastUserText !== "string") {
		throw new Error("receipt had an invalid shape");
	}
	return { provider: receipt.provider, model: receipt.model, lastUserText: receipt.lastUserText };
}

function decodeChildResult(value: unknown): ChildResult {
	if (typeof value !== "object" || value === null || Array.isArray(value)) throw new Error("child emitted a non-object result");
	const result = value as Record<string, unknown>;
	const resolution = result.resolution;
	const validModelChanges = Array.isArray(result.modelChanges) && result.modelChanges.every(change =>
		typeof change === "object" && change !== null && !Array.isArray(change) &&
		typeof (change as Record<string, unknown>).model === "string" &&
		((change as Record<string, unknown>).role === undefined || typeof (change as Record<string, unknown>).role === "string"),
	);
	if (
		typeof result.liveModel !== "string" ||
		typeof result.sessionId !== "string" ||
		typeof result.unhandledRejections !== "number" ||
		!validModelChanges ||
		!Array.isArray(result.thinkingLevels) || !result.thinkingLevels.every(level => typeof level === "string") ||
		!Array.isArray(result.diagnostics) || !result.diagnostics.every(value => typeof value === "string") ||
		typeof resolution !== "object" || resolution === null || Array.isArray(resolution) ||
		typeof (resolution as Record<string, unknown>).selector !== "string" ||
		typeof (resolution as Record<string, unknown>).winningLayer !== "string"
	) throw new Error(`child emitted an invalid result: ${JSON.stringify(result)}`);
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
		throw new Error(label + " was not valid JSON");
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
	if (exitCode !== 0) throw new Error("routing precedence child failed (" + exitCode + "): " + stderr);
	const line = stdout.trim().split("\n").at(-1);
	if (!line) throw new Error("routing precedence child emitted no result");
	return { result: decodeChildResult(parseJsonLine(line, "child result")), stderr };
}

async function readReceipts(receiptsFile: string, diagnostics: readonly string[]): Promise<Receipt[]> {
	const text = await fs.readFile(receiptsFile, "utf8").catch(error => {
		throw new Error(`provider receipt file missing; diagnostics=${JSON.stringify(diagnostics)}; error=${String(error)}`);
	});
	return text
		.split("\n")
		.filter(Boolean)
		.map(line => decodeReceipt(parseJsonLine(line, "receipt")));
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
		expect(result.result.resolution).toEqual({ selector: "routing-precedence-b/model-b:high", winningLayer: "runtime_override" });
		expect(result.result.liveModel).toBe("routing-precedence-b/model-b");
		expect(result.result.modelChanges).toContainEqual({ model: "routing-precedence-b/model-b", role: "default" });
		expect(result.result.thinkingLevels).toContain("high");
	}, 20_000);
});
