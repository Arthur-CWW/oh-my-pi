import { afterEach, describe, expect, it } from "bun:test";
import * as fs from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";

import { CURRENT_SESSION_VERSION, type SessionHeader } from "@oh-my-pi/pi-coding-agent/session/session-entries";

const roots: string[] = [];

interface FirstChildResult {
	action: "first";
	inputId: string;
	ownerEpoch: string;
	attemptId: string;
	retryAt: number;
	providerCalls: readonly string[];
	bashCommands: readonly string[];
	pythonCommands: readonly string[];
	commandStatuses: readonly string[];
}

interface ResumeChildResult {
	action: "resume";
	inputId: string;
	firstAttemptId: string;
	resumedAttemptId: string;
	ownerEpoch: string;
	retryAt: number;
	adoptedBeforeDue: number;
	earlyDue: number;
	due: number;
	providerCalls: readonly string[];
	queuedAfter: number;
	admittedAgain: boolean;
}

interface OwnershipLossChildResult {
	action: "loss";
	results: readonly string[];
	inputElapsedMs: number;
	unhandledRejections: number;
}

type ChildResult = FirstChildResult | ResumeChildResult | OwnershipLossChildResult;

const CHILD_SOURCE = String.raw`
import * as path from "node:path";
import { clearCustomApis, registerCustomApi } from "@oh-my-pi/pi-ai";
import { createMockModel } from "@oh-my-pi/pi-ai/providers/mock";
import { buildModel } from "@oh-my-pi/pi-catalog/build";
import { AssistantMessageEventStream } from "@oh-my-pi/pi-ai/utils/event-stream";
import { createAssistantMessage } from "./test/helpers/agent-session-setup";
import { InputController } from "@oh-my-pi/pi-coding-agent/modes/controllers/input-controller";
import { ModelRegistry } from "@oh-my-pi/pi-coding-agent/config/model-registry";
import { Settings } from "@oh-my-pi/pi-coding-agent/config/settings";
import { createAgentSession } from "@oh-my-pi/pi-coding-agent/sdk";
import { AuthStorage } from "@oh-my-pi/pi-coding-agent/session/auth-storage";
import { DurableInputQueue } from "@oh-my-pi/pi-coding-agent/session/durable-input-queue";
import { SessionManager } from "@oh-my-pi/pi-coding-agent/session/session-manager";
import { acquireSessionOwnership } from "@oh-my-pi/pi-coding-agent/session/session-ownership";

const action = process.env.ACTION;
const cwd = process.env.CWD;
const sessionFile = process.env.SESSION_FILE;
const sessionsDir = process.env.SESSIONS_DIR;
const home = process.env.HOME;
if ((action !== "first" && action !== "resume" && action !== "loss") || !cwd || !sessionFile || !sessionsDir || !home) {
	throw new Error("missing durable queue child environment");
}


function createEditor() {
	let text = "";
	return {
		imageLinks: undefined,
		onSubmit: undefined,
		setText(next) { text = next; },
		getText() { return text; },
		addToHistory(_text) {},
		setActionKeys(_action, _keys) {},
		setCustomKeyHandler(_key, _handler) {},
		clearCustomKeyHandlers() {},
	};
}

function createControllerContext(session, sessionManager, settings, commandSink) {
	const editor = createEditor();
	const ctx = {
		editor,
		ui: { requestRender() {}, resetDisplay() {}, addInputListener() {}, addStartListener() {}, terminal: { write() {} } },
		session,
		sessionManager,
		settings,
		keybindings: { getKeys() { return []; } },
		pendingImages: [],
		pendingImageLinks: [],
		compactionQueuedMessages: [],
		fileSlashCommands: new Set(),
		locallySubmittedUserSignatures: new Set(),
		isKnownSlashCommand() { return false; },
		recordLocalSubmission(text, imageCount = 0) {
			const signature = text + "\u0000" + imageCount;
			this.locallySubmittedUserSignatures.add(signature);
			return () => this.locallySubmittedUserSignatures.delete(signature);
		},
		async withLocalSubmission(text, fn, options) {
			const dispose = this.recordLocalSubmission(text, options?.imageCount ?? 0);
			try { return await fn(); } catch (error) { dispose(); throw error; }
		},
		startPendingSubmission(input) { return { ...input, cancelled: false, started: true }; },
		finishPendingSubmission(_input) {},
		markPendingSubmissionStarted(_input) { return true; },
		cancelPendingSubmission() { return false; },
		onInputCallback: undefined,
		updatePendingMessagesDisplay() {},
		flushPendingBashComponents() {},
		queueCompactionMessage() {},
		showError(message) { commandSink.statuses.push(String(message)); },
		showWarning(message) { commandSink.statuses.push(String(message)); },
		showStatus(message) { commandSink.statuses.push(String(message)); },
		handleClearCommand() { commandSink.statuses.push("clear"); },
		handleHotkeysCommand() {},
		handlePlanModeCommand() {},
		showTreeSelector() {},
		showUserMessageSelector() {},
		showSessionSelector() {},
		handleSTTToggle() {},
		showDebugSelector() {},
		showHistorySearch() {},
		toggleThinkingBlockVisibility() {},
		showModelSelector() {},
		updateEditorBorderColor() {},
		hasActiveBtw() { return false; },
		isBashMode: false,
		isPythonMode: false,
		focusedAgentId: undefined,
		viewSession: session,
		async handleBashCommand(command) { commandSink.bash.push(command); },
		async handlePythonCommand(code) { commandSink.python.push(code); },
	};
	return { ctx, editor };
}

function durableAttemptEntries(sessionManager) {
	const entries = [];
	for (const entry of sessionManager.getEntries()) {
		if (entry.type !== "custom" || entry.customType !== "durable_input_attempt") continue;
		const data = entry.data;
		if (typeof data !== "object" || data === null || Array.isArray(data)) continue;
		entries.push(data);
	}
	return entries;
}

function latestAttempt(sessionManager, state) {
	const matches = durableAttemptEntries(sessionManager).filter(entry => entry.state === state);
	const latest = matches.at(-1);
	if (!latest) {
		throw new Error("missing durable attempt state: " + state + "; observed=" + JSON.stringify(durableAttemptEntries(sessionManager)));
	}
	if (typeof latest.inputId !== "string" || typeof latest.attemptId !== "string") throw new Error("invalid durable attempt identity");
	return latest;
}

function latestRateLimit(sessionManager) {
	const latest = latestAttempt(sessionManager, "failed-rate-limit");
	if (typeof latest.retryAt !== "number") throw new Error("invalid durable retryAt");
	return latest;
}

function waitForTurnEnd(session, predicate) {
	const done = Promise.withResolvers();
	const unsubscribe = session.subscribe(event => {
		if (event.type !== "turn_end" || !predicate(event)) return;
		unsubscribe();
		done.resolve(event);
	});
	return done.promise;
}

async function createSession(responseKind, providerCalls, existing) {
	clearCustomApis();
	const api = "durable-queue-process-" + process.pid + "-" + responseKind;
	const provider = "durable-provider-" + process.pid + "-" + responseKind;
	const model = buildModel({
		id: "durable-model",
		name: "Durable Model",
		api,
		provider,
		baseUrl: "",
		reasoning: false,
		input: ["text"],
		cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
		contextWindow: 4096,
		maxTokens: 1024,
	});
	const usageError = '429 {"type":"error","error":{"type":"rate_limit_error","message":"usage limit"}} retry-after-ms=600000';
	const mock = createMockModel({ handler: () => responseKind === "rate-limit" ? { throw: usageError } : { content: ["resumed ok"], stopReason: "stop" } });
	registerCustomApi(api, (streamModel, context, options) => {
		const last = context.messages.at(-1);
		const textPart = Array.isArray(last?.content) ? last.content.find(part => part?.type === "text" && typeof part.text === "string") : undefined;
		providerCalls.push(typeof last?.content === "string" ? last.content : textPart ? textPart.text : JSON.stringify(last?.content));
		if (responseKind === "success" && existing?.responseGate) {
			const stream = new AssistantMessageEventStream();
			void existing.responseGate.promise.then(() => {
				const message = createAssistantMessage("resumed ok");
				stream.push({ type: "text_delta", contentIndex: 0, delta: "resumed ok", partial: message });
				stream.push({ type: "done", reason: "stop", message });
			});
			return stream;
		}
		return mock.stream(streamModel, context, options);
	});
	const authStorage = await AuthStorage.create(path.join(home, "auth.db"));
	authStorage.setRuntimeApiKey(provider, "test-key");
	const modelRegistry = new ModelRegistry(authStorage);
	const acquired =
		existing?.sessionManager && existing?.ownership
			? existing
			: { sessionManager: await SessionManager.open(sessionFile, sessionsDir), ownership: undefined };
	if (!acquired.ownership) {
		acquired.ownership = await acquireSessionOwnership(acquired.sessionManager.getSessionFile(), acquired.sessionManager.getSessionId(), {
			root: path.join(home, ".agent-mux"),
		});
	}
	acquired.sessionManager.bindSessionOwnership(acquired.ownership);
	if (!(await acquired.ownership.isCurrent())) {
		throw new Error("session ownership was not current before AgentSession construction");
	}
	const settings = Settings.isolated({ "compaction.enabled": false, "retry.maxDelayMs": 100 });
	const { session } = await createAgentSession({
		cwd,
		agentDir: home,
		authStorage,
		modelRegistry,
		sessionManager: acquired.sessionManager,
		model,
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
	return { session, sessionManager: acquired.sessionManager, ownership: acquired.ownership, authStorage, settings };
}

async function closeHarness(harness) {
	await harness.session.dispose();
	await harness.sessionManager.close();
	harness.authStorage.close();
	await harness.ownership.release();
	clearCustomApis();
}

if (action === "first") {
	const providerCalls = [];
	const commandSink = { bash: [], python: [], statuses: [] };
	const harness = await createSession("rate-limit", providerCalls);
	try {
		const failedTurn = waitForTurnEnd(harness.session, event => Boolean(event.message?.errorMessage?.includes("rate_limit_error")));
		const { ctx, editor } = createControllerContext(harness.session, harness.sessionManager, harness.settings, commandSink);
		let submittedTurn;
		ctx.onInputCallback = submission => {
			submittedTurn = harness.session.prompt(submission.text, { images: submission.images });
		};
		const controller = new InputController(ctx);
		controller.setupEditorSubmitHandler();
		await editor.onSubmit("ordinary durable hello");
		await failedTurn;
		if (!submittedTurn) throw new Error("idle submission did not start a session prompt");
		await submittedTurn;
		await harness.session.waitForIdle();
		const failed = latestRateLimit(harness.sessionManager);
		console.log(JSON.stringify({
			action: "first",
			inputId: failed.inputId,
			ownerEpoch: harness.ownership.ownerEpoch,
			attemptId: failed.attemptId,
			retryAt: failed.retryAt,
			providerCalls,
			bashCommands: commandSink.bash,
			pythonCommands: commandSink.python,
			commandStatuses: commandSink.statuses,
		}));
	} finally {
		await closeHarness(harness);
	}
} else if (action === "resume") {
	const retryAt = Number(process.env.RETRY_AT);
	if (!Number.isFinite(retryAt)) throw new Error("missing retryAt");
	const providerCalls = [];
	const sessionManager = await SessionManager.open(sessionFile, sessionsDir);
	const ownership = await acquireSessionOwnership(sessionManager.getSessionFile(), sessionManager.getSessionId(), {
		root: path.join(home, ".agent-mux"),
	});
	sessionManager.bindSessionOwnership(ownership);
	const queue = await DurableInputQueue.open(ownership, path.join(home, ".agent-mux"));
	const adoptedBeforeDue = (await queue.adopt()).length;
	const earlyDue = (await queue.retryDue(retryAt - 1)).length;
	const due = (await queue.retryDue(retryAt)).length;
	const responseGate = Promise.withResolvers();
	const harness = await createSession("success", providerCalls, { sessionManager, ownership, responseGate });
	try {
		const successfulTurn = waitForTurnEnd(harness.session, event => !event.message?.errorMessage);
		responseGate.resolve();
		await successfulTurn;
		await harness.session.waitForIdle();
		const completed = latestAttempt(harness.sessionManager, "completed");
		const failed = latestRateLimit(harness.sessionManager);
		const freshQueue = await DurableInputQueue.open(harness.ownership, path.join(home, ".agent-mux"));
		const queuedAfter = (await freshQueue.replayQueued()).length;
		const admittedAgain = (await freshQueue.admitNext()) !== undefined;
		console.log(JSON.stringify({
			action: "resume",
			inputId: completed.inputId,
			ownerEpoch: harness.ownership.ownerEpoch,
			firstAttemptId: failed.attemptId,
			resumedAttemptId: completed.attemptId,
			retryAt: failed.retryAt,
			adoptedBeforeDue,
			earlyDue,
			due,
			providerCalls,
			queuedAfter,
			admittedAgain,
		}));
	} finally {
		await closeHarness(harness);
	}
} else {
	const providerCalls = [];
	const responseGate = Promise.withResolvers();
	const harness = await createSession("success", providerCalls, { responseGate });
	let unhandledRejections = 0;
	const onUnhandledRejection = () => {
		unhandledRejections++;
	};
	process.on("unhandledRejection", onUnhandledRejection);
	try {
		const requestStarted = Promise.withResolvers();
		const unsubscribe = harness.session.subscribe(event => {
			if (event.type === "turn_start") requestStarted.resolve();
		});
		const inFlight = harness.session.prompt("lose ownership after request start");
		await requestStarted.promise;
		unsubscribe();
		const replacement = {
			sessionFile: harness.sessionManager.getSessionFile(),
			sessionId: harness.sessionManager.getSessionId(),
			ownerEpoch: "replacement-owner",
			ownerKind: "omp",
			isCurrent: async () => true,
			release: async () => {},
		};
		const replacementQueue = await DurableInputQueue.open(replacement, path.join(home, ".agent-mux"));
		await replacementQueue.adopt();
		responseGate.resolve();
		await inFlight;
		const inputStartedAt = Date.now();
		const results = await Promise.all(
			["first rejected input", "second rejected input"].map(text =>
				harness.session.followUp(text).then(
					() => "resolved",
					error => (error instanceof Error ? error.name : String(error)),
				),
			),
		);
		await Bun.sleep(0);
		console.log(
			JSON.stringify({
				action: "loss",
				results,
				inputElapsedMs: Date.now() - inputStartedAt,
				unhandledRejections,
			}),
		);
	} finally {
		process.off("unhandledRejection", onUnhandledRejection);
		await closeHarness(harness);
	}
}
process.exit(0);
`;

function isStringArray(value: unknown): value is readonly string[] {
	return Array.isArray(value) && value.every(item => typeof item === "string");
}

function decodeChildResult(value: unknown): ChildResult {
	if (typeof value !== "object" || value === null || Array.isArray(value))
		throw new Error("child result must be an object");
	const record = value as Record<string, unknown>;
	if (record.action === "first") {
		if (
			typeof record.inputId === "string" &&
			typeof record.ownerEpoch === "string" &&
			typeof record.attemptId === "string" &&
			typeof record.retryAt === "number" &&
			isStringArray(record.providerCalls) &&
			isStringArray(record.bashCommands) &&
			isStringArray(record.pythonCommands) &&
			isStringArray(record.commandStatuses)
		) {
			return {
				action: "first",
				inputId: record.inputId,
				ownerEpoch: record.ownerEpoch,
				attemptId: record.attemptId,
				retryAt: record.retryAt,
				providerCalls: record.providerCalls,
				bashCommands: record.bashCommands,
				pythonCommands: record.pythonCommands,
				commandStatuses: record.commandStatuses,
			};
		}
	}
	if (record.action === "resume") {
		if (
			typeof record.inputId === "string" &&
			typeof record.ownerEpoch === "string" &&
			typeof record.firstAttemptId === "string" &&
			typeof record.resumedAttemptId === "string" &&
			typeof record.retryAt === "number" &&
			typeof record.adoptedBeforeDue === "number" &&
			typeof record.earlyDue === "number" &&
			typeof record.due === "number" &&
			isStringArray(record.providerCalls) &&
			typeof record.queuedAfter === "number" &&
			typeof record.admittedAgain === "boolean"
		) {
			return {
				action: "resume",
				inputId: record.inputId,
				ownerEpoch: record.ownerEpoch,
				firstAttemptId: record.firstAttemptId,
				resumedAttemptId: record.resumedAttemptId,
				retryAt: record.retryAt,
				adoptedBeforeDue: record.adoptedBeforeDue,
				earlyDue: record.earlyDue,
				due: record.due,
				providerCalls: record.providerCalls,
				queuedAfter: record.queuedAfter,
				admittedAgain: record.admittedAgain,
			};
		}
	}
	if (
		record.action === "loss" &&
		isStringArray(record.results) &&
		typeof record.inputElapsedMs === "number" &&
		typeof record.unhandledRejections === "number"
	) {
		return {
			action: "loss",
			results: record.results,
			inputElapsedMs: record.inputElapsedMs,
			unhandledRejections: record.unhandledRejections,
		};
	}
	throw new Error(`child emitted invalid result: ${JSON.stringify(value)}`);
}

async function runChild(environment: Record<string, string>): Promise<ChildResult> {
	const processHandle = Bun.spawn({
		cmd: [process.execPath, "-e", CHILD_SOURCE],
		cwd: path.resolve(import.meta.dir, "../.."),
		env: { ...process.env, ...environment },
		stdout: "pipe",
		stderr: "pipe",
	});
	const [exitCode, stdout, stderr] = await Promise.all([
		processHandle.exited,
		new Response(processHandle.stdout).text(),
		new Response(processHandle.stderr).text(),
	]);
	if (exitCode !== 0) throw new Error(`agent-session durable queue child failed (${exitCode}): ${stderr}`);
	const line = stdout.trim().split("\n").at(-1);
	if (!line) throw new Error("agent-session durable queue child emitted no result");
	return decodeChildResult(JSON.parse(line));
}

async function createPersistedSession(
	root: string,
): Promise<{ cwd: string; home: string; sessionsDir: string; sessionFile: string; sessionId: string }> {
	const home = path.join(root, "home");
	const cwd = path.join(root, "project");
	const sessionsDir = path.join(root, "sessions");
	await fs.mkdir(cwd, { recursive: true });
	await fs.mkdir(home, { recursive: true });
	await fs.mkdir(sessionsDir, { recursive: true });
	const sessionId = "durable-agent-session";
	const sessionFile = path.join(sessionsDir, `${sessionId}.jsonl`);
	const header: SessionHeader = {
		type: "session",
		version: CURRENT_SESSION_VERSION,
		id: sessionId,
		timestamp: new Date().toISOString(),
		cwd,
	};
	await fs.writeFile(sessionFile, `${JSON.stringify(header)}\n`);
	return { cwd, home, sessionsDir, sessionFile, sessionId };
}

afterEach(async () => {
	await Promise.all(roots.splice(0).map(root => fs.rm(root, { recursive: true, force: true })));
});

describe("AgentSession durable input queue process replacement", () => {
	it("resumes one idle InputController submission after usage-limit owner replacement", async () => {
		const root = await fs.mkdtemp(path.join(os.tmpdir(), "omp-agent-session-queue-process-"));
		roots.push(root);
		const fixture = await createPersistedSession(root);

		const first = await runChild({
			ACTION: "first",
			CWD: fixture.cwd,
			HOME: fixture.home,
			SESSIONS_DIR: fixture.sessionsDir,
			SESSION_FILE: fixture.sessionFile,
		});
		if (first.action !== "first") throw new Error("first child returned resume result");

		expect(first.providerCalls).toEqual(["ordinary durable hello"]);
		expect(first.retryAt).toBeGreaterThan(Date.now());
		const ownersRoot = path.join(fixture.home, ".agent-mux", "owners-v1");
		const [queueKey] = await fs.readdir(ownersRoot);
		if (!queueKey) throw new Error("durable queue root missing");
		const queueRoot = path.join(ownersRoot, queueKey, "queue-v2");
		const initialHead = JSON.parse(await fs.readFile(path.join(queueRoot, "head.json"), "utf8")) as { epoch: string };
		const initialSegment = path.join(queueRoot, "segments", `${initialHead.epoch}.jsonl`);
		const initialSegmentBytes = (await fs.stat(initialSegment)).size;

		const resumed = await runChild({
			ACTION: "resume",
			CWD: fixture.cwd,
			HOME: fixture.home,
			SESSIONS_DIR: fixture.sessionsDir,
			SESSION_FILE: fixture.sessionFile,
			RETRY_AT: String(first.retryAt),
		});
		if (resumed.action !== "resume") throw new Error("resume child returned first result");

		expect(resumed).toMatchObject({
			inputId: first.inputId,
			firstAttemptId: first.attemptId,
			retryAt: first.retryAt,
			adoptedBeforeDue: 0,
			earlyDue: 0,
			due: 1,
			providerCalls: ["ordinary durable hello"],
			queuedAfter: 0,
			admittedAgain: false,
		});
		expect(resumed.ownerEpoch).not.toBe(first.ownerEpoch);
		expect(resumed.resumedAttemptId).not.toBe(first.attemptId);
		const replacementHead = JSON.parse(await fs.readFile(path.join(queueRoot, "head.json"), "utf8")) as {
			ownershipEpoch?: string;
		};
		expect(replacementHead.ownershipEpoch).toBe(resumed.ownerEpoch);
		expect((await fs.stat(initialSegment)).size).toBe(initialSegmentBytes);
	}, 15_000);
	it("rejects repeated input promptly after queue ownership loss without retrying", async () => {
		const root = await fs.mkdtemp(path.join(os.tmpdir(), "omp-agent-session-queue-loss-"));
		roots.push(root);
		const fixture = await createPersistedSession(root);
		const lost = await runChild({
			ACTION: "loss",
			CWD: fixture.cwd,
			HOME: fixture.home,
			SESSIONS_DIR: fixture.sessionsDir,
			SESSION_FILE: fixture.sessionFile,
		});
		if (lost.action !== "loss") throw new Error("ownership-loss child returned an unexpected result");
		expect(lost.results).toEqual(["SessionOwnershipLostError", "SessionOwnershipLostError"]);
		expect(lost.inputElapsedMs).toBeLessThan(250);
		expect(lost.unhandledRejections).toBe(0);
	}, 1_000);
});
