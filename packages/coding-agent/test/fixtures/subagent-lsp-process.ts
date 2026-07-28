import { createHash } from "node:crypto";
import { Effort } from "@oh-my-pi/pi-catalog/effort";
import type { Api, AssistantMessage, Model, ToolCall } from "@oh-my-pi/pi-ai";
import { clearCustomApis, registerCustomApi } from "@oh-my-pi/pi-ai";
import { AssistantMessageEventStream } from "@oh-my-pi/pi-ai/utils/event-stream";
import { ModelRegistry, type ProviderConfigInput } from "@oh-my-pi/pi-coding-agent/config/model-registry";
import { resetSettingsForTest, Settings } from "@oh-my-pi/pi-coding-agent/config/settings";
import { IrcExternalBus, resolveIrcExternalDbPath } from "@oh-my-pi/pi-coding-agent/irc/bus-external";
import { AgentLifecycleManager } from "@oh-my-pi/pi-coding-agent/registry/agent-lifecycle";
import { AgentRegistry } from "@oh-my-pi/pi-coding-agent/registry/agent-registry";
import { HostResourceAdmission } from "@oh-my-pi/pi-coding-agent/resource/host-resource-admission";
import { AuthStorage } from "@oh-my-pi/pi-coding-agent/session/auth-storage";
import { SessionManager } from "@oh-my-pi/pi-coding-agent/session/session-manager";
import { SESSION_CONTROL_DB_PATH, SessionControlBus } from "@oh-my-pi/pi-coding-agent/session/session-control";
import { TaskTool } from "@oh-my-pi/pi-coding-agent/task";
import { getAgentDir, getConfigRootDir } from "@oh-my-pi/pi-utils";
import * as fs from "node:fs/promises";
import * as path from "node:path";

const AGENT_NAME = "subagent-lsp-process-proof-7f3b";
const PROVIDER = "subagent-lsp-process-provider";
const MODEL = "scripted-yield";
const ROUTE = `${PROVIDER}/${MODEL}:${Effort.Low}`;
const API = "subagent-lsp-process-api" as Api;
const MARKER = "tracked-marker-7f3b";
const CONFIG_VALUE = false;
const CONTROL_SESSION_ID = "subagent-lsp-process-control-7f3b";
const CONTROL_OWNER_EPOCH = "owner-7f3b";

interface CanonicalStateReceipt {
	configRoot: string;
	configPath: string;
	controlDb: string;
	configDigest: string;
	stateDigest: string;
	configValue: boolean;
	controlSessionId: string;
	controlOwnerEpoch: string;
}

interface ProviderReceipt extends CanonicalStateReceipt {
	toolNames: string[];
	registryCwd: string;
	marker: string;
	sessionFile: string;
	routeSelector: string;
}

function requiredEnvironment(name: string): string {
	const value = process.env[name];
	if (!value) throw new Error(`Missing required environment variable ${name}`);
	return value;
}

function digest(value: string): string {
	return createHash("sha256").update(value).digest("hex");
}

async function recordCanonicalState(registryCwd: string): Promise<CanonicalStateReceipt> {
	const configRoot = getConfigRootDir();
	const configPath = path.join(getAgentDir(), "config.yml");
	const controlDb = SESSION_CONTROL_DB_PATH;

	const writer = await Settings.init({ cwd: registryCwd });
	try {
		writer.set("todo.enabled", CONFIG_VALUE);
		await writer.flush();
	} finally {
		resetSettingsForTest();
	}

	const configContents = await fs.readFile(configPath, "utf8");
	const reader = await Settings.init({ cwd: registryCwd });
	let configValue: boolean;
	try {
		configValue = reader.get("todo.enabled");
	} finally {
		resetSettingsForTest();
	}
	if (configValue !== CONFIG_VALUE) {
		throw new Error(`Canonical settings reload returned ${configValue} instead of ${CONFIG_VALUE}`);
	}

	const control = new SessionControlBus();
	let controlOwnerEpoch: string;
	try {
		control.bindTarget(CONTROL_SESSION_ID, CONTROL_OWNER_EPOCH);
		const persistedOwnerEpoch = control.getTargetOwnerEpoch(CONTROL_SESSION_ID);
		if (!persistedOwnerEpoch) throw new Error("Canonical control state was not persisted");
		controlOwnerEpoch = persistedOwnerEpoch;
	} finally {
		control.close();
	}
	if (controlOwnerEpoch !== CONTROL_OWNER_EPOCH) {
		throw new Error(`Canonical control reload returned ${controlOwnerEpoch} instead of ${CONTROL_OWNER_EPOCH}`);
	}

	const configDigest = digest(configContents);
	const controlStateDigest = digest(`${CONTROL_SESSION_ID}\0${controlOwnerEpoch}`);
	return {
		configRoot,
		configPath,
		controlDb,
		configDigest,
		stateDigest: digest(`${configDigest}\0${controlStateDigest}`),
		configValue,
		controlSessionId: CONTROL_SESSION_ID,
		controlOwnerEpoch,
	};
}

function usage(): AssistantMessage["usage"] {
	return {
		input: 0,
		output: 0,
		cacheRead: 0,
		cacheWrite: 0,
		totalTokens: 0,
		cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
	};
}

function yieldingStream(model: Model): AssistantMessageEventStream {
	const toolCall: ToolCall = {
		type: "toolCall",
		id: "yield-subagent-lsp-proof",
		name: "yield",
		arguments: { result: { data: { ok: true } } },
	};
	const message: AssistantMessage = {
		role: "assistant",
		content: [toolCall],
		api: model.api,
		provider: model.provider,
		model: model.id,
		usage: usage(),
		stopReason: "toolUse",
		timestamp: Date.now(),
	};
	const stream = new AssistantMessageEventStream();
	stream.push({ type: "start", partial: message });
	stream.push({ type: "toolcall_start", contentIndex: 0, partial: message });
	stream.push({
		type: "toolcall_delta",
		contentIndex: 0,
		delta: JSON.stringify(toolCall.arguments),
		partial: message,
	});
	stream.push({ type: "toolcall_end", contentIndex: 0, toolCall, partial: message });
	stream.push({ type: "done", reason: "toolUse", message });
	stream.end();
	return stream;
}

async function runGit(cwd: string, args: string[]): Promise<void> {
	const child = Bun.spawn({
		cmd: ["git", ...args],
		cwd,
		env: {
			...process.env,
			GIT_AUTHOR_NAME: "OMP Process Proof",
			GIT_AUTHOR_EMAIL: "process-proof@example.invalid",
			GIT_COMMITTER_NAME: "OMP Process Proof",
			GIT_COMMITTER_EMAIL: "process-proof@example.invalid",
		},
		stdout: "pipe",
		stderr: "pipe",
	});
	const [exitCode, stdout, stderr] = await Promise.all([
		child.exited,
		new Response(child.stdout).text(),
		new Response(child.stderr).text(),
	]);
	if (exitCode !== 0) throw new Error(`git ${args.join(" ")} failed (${exitCode}): ${stderr || stdout}`);
}

async function readSessionCwd(sessionFile: string): Promise<string> {
	const firstLine = (await fs.readFile(sessionFile, "utf8")).split("\n", 1)[0];
	if (!firstLine) throw new Error(`Child session ${sessionFile} had no header`);
	const header = JSON.parse(firstLine) as { type?: unknown; cwd?: unknown };
	if (header.type !== "session" || typeof header.cwd !== "string") {
		throw new Error(`Child session ${sessionFile} had an invalid header`);
	}
	return header.cwd;
}

async function main(): Promise<void> {
	const root = requiredEnvironment("TEST_ROOT");
	const project = requiredEnvironment("PROJECT_DIR");
	const sessionsDir = requiredEnvironment("SESSIONS_DIR");
	const ircDb = requiredEnvironment("IRC_DB");
	const parentManagers: SessionManager[] = [];
	let authStorage: AuthStorage | undefined;
	let explicitIrcBus: IrcExternalBus | undefined;

	AgentRegistry.resetGlobalForTests();
	AgentLifecycleManager.resetGlobalForTests();
	HostResourceAdmission.resetGlobalForTests();
	IrcExternalBus.resetGlobalForTests();
	clearCustomApis();

	try {
		const agentsDir = path.join(project, ".omp", "agents");
		await fs.mkdir(agentsDir, { recursive: true });
		await fs.writeFile(path.join(project, "tracked-marker.txt"), MARKER);
		await fs.writeFile(
			path.join(agentsDir, `${AGENT_NAME}.md`),
			[
				"---",
				`name: ${AGENT_NAME}`,
				"description: Unique process-discovered LSP proof agent.",
				`model: ${ROUTE}`,
				"blocking: true",
				"tools: [ast_grep]",
				"---",
				"Submit the integration proof with yield.",
			].join("\n"),
		);
		await runGit(project, ["init"]);
		await runGit(project, ["add", "."]);
		await runGit(project, ["commit", "-m", "process proof fixture"]);

		if (path.resolve(resolveIrcExternalDbPath()) !== path.resolve(ircDb)) {
			throw new Error(`Canonical IRC database ${resolveIrcExternalDbPath()} did not match injected ${ircDb}`);
		}
		explicitIrcBus = new IrcExternalBus(ircDb);
		if (explicitIrcBus.listPeers({ includeStale: true }).length !== 0) {
			throw new Error("Explicit fixture IRC database was not fresh");
		}

		authStorage = await AuthStorage.create(path.join(root, "auth.sqlite"));
		authStorage.setRuntimeApiKey(PROVIDER, "deterministic-key");
		const modelRegistry = new ModelRegistry(authStorage, path.join(root, "models.yml"));
		let providerReceipt: ProviderReceipt | undefined;
		const providerConfig: ProviderConfigInput = {
			baseUrl: "http://subagent-lsp-process.invalid/v1",
			api: API,
			apiKey: "deterministic-key",
			models: [
				{
					id: MODEL,
					name: "Scripted Yield",
					reasoning: true,
					thinking: { mode: "effort", efforts: [Effort.Low] },
					input: ["text"],
					supportsTools: true,
					cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
					contextWindow: 16_384,
					maxTokens: 1_024,
				},
			],
			streamSimple(model, context) {
				const stream = new AssistantMessageEventStream();
				void (async () => {
					try {
						const ref = AgentRegistry.global()
							.list()
							.find(
								candidate => candidate.kind === "sub" && candidate.status === "running" && candidate.session,
							);
						if (!ref?.session || !ref.sessionFile || !ref.session.model || !ref.session.thinkingLevel) {
							throw new Error("No live routed child session was registered");
						}
						const registryCwd = ref.session.sessionManager.getCwd();
						const canonicalState = await recordCanonicalState(registryCwd);
						providerReceipt = {
							toolNames: (context.tools ?? []).map(tool => tool.name),
							registryCwd,
							marker: await fs.readFile(path.join(registryCwd, "tracked-marker.txt"), "utf8"),
							sessionFile: ref.sessionFile,
							routeSelector: `${ref.session.model.provider}/${ref.session.model.id}:${ref.session.thinkingLevel}`,
							...canonicalState,
						};
						for await (const event of yieldingStream(model)) stream.push(event);
						stream.end();
					} catch (error) {
						const errorMessage = error instanceof Error ? error.message : String(error);
						const message: AssistantMessage = {
							role: "assistant",
							content: [{ type: "text", text: errorMessage }],
							api: model.api,
							provider: model.provider,
							model: model.id,
							usage: usage(),
							stopReason: "error",
							errorMessage,
							timestamp: Date.now(),
						};
						stream.push({ type: "error", reason: "error", error: message });
						stream.end(message);
					}
				})();
				return stream;
			},
		};
		modelRegistry.registerProvider(PROVIDER, providerConfig, "subagent-lsp-process-proof");
		registerCustomApi(API, providerConfig.streamSimple!);
		if (!modelRegistry.find(PROVIDER, MODEL)) throw new Error("Scripted model was not registered");

		const settings = Settings.isolated({
			"async.enabled": false,
			"task.batch": false,
			"task.enableLsp": true,
			"task.isolation.mode": "rcopy",
			"task.isolateSetup": false,
			"compaction.enabled": false,
			"retry.enabled": false,
			"todo.enabled": false,
		});
		const manager = SessionManager.create(project, sessionsDir);
		parentManagers.push(manager);
		const tool = await TaskTool.create({
			cwd: project,
			hasUI: false,
			enableLsp: true,
			settings,
			getSessionFile: () => manager.getSessionFile() ?? null,
			getSessionId: () => manager.getSessionId(),
			getSessionSpawns: () => "*",
			getArtifactsDir: () => path.join(root, "artifacts"),
			getPlanModeState: () => ({ enabled: true, planFilePath: path.join(root, "PLAN.md") }),
			authStorage,
			modelRegistry,
			sessionManager: manager,
		});
		const advertised = tool.description.includes(AGENT_NAME);
		const result = await tool.execute("task-subagent-lsp-process-proof", {
			agent: AGENT_NAME,
			id: "SubagentLspProcessProof",
			role: "Subagent LSP integration proof",
			model: ROUTE,
			assignment: "Exercise the real child session and submit the scripted result.",
			isolated: true,
		});
		const taskResult = result.details?.results[0];
		if (!taskResult || taskResult.exitCode !== 0) {
			throw new Error(`Task failed: ${taskResult?.error ?? taskResult?.stderr ?? JSON.stringify(result)}`);
		}
		if (!providerReceipt) throw new Error("Scripted provider did not record the child session");
		if (taskResult.isolationBackend === undefined) throw new Error("Task result omitted the isolation backend");
		const liveChildrenAfterExecute = AgentRegistry.global()
			.list()
			.filter(ref => ref.kind === "sub" && ref.status === "running").length;
		let worktreeExistsAfterExecute = true;
		try {
			await fs.access(providerReceipt.registryCwd);
		} catch {
			worktreeExistsAfterExecute = false;
		}
		process.stdout.write(
			JSON.stringify({
				project,
				agentName: AGENT_NAME,
				advertised,
				projectAgentsDir: result.details?.projectAgentsDir ?? null,
				ircDb,
				...providerReceipt,
				persistedCwd: await readSessionCwd(providerReceipt.sessionFile),
				agentSource: taskResult.agentSource,
				liveChildrenAfterExecute,
				isolationBackend: taskResult.isolationBackend,
				worktreeExistsAfterExecute,
			}),
		);
	} finally {
		for (const ref of AgentRegistry.global().list()) {
			if (ref.session) await ref.session.dispose();
		}
		for (const manager of parentManagers) await manager.close();
		authStorage?.close();
		explicitIrcBus?.close();
		IrcExternalBus.resetGlobalForTests();
		HostResourceAdmission.resetGlobalForTests();
		AgentLifecycleManager.resetGlobalForTests();
		AgentRegistry.resetGlobalForTests();
		resetSettingsForTest();
		clearCustomApis();
	}
}

await main();
