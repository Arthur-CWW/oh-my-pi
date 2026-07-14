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
interface SingleSubmissionChildResult {
	action: "single";
	inputId: string;
	providerCalls: readonly string[];
	userTranscript: readonly string[];
	queuedAfter: number;
	admittedAgain: boolean;
	attempts: readonly {
		inputId: string;
		attemptId: string;
		revision: number;
		state: string;
	}[];
}


interface OwnershipLossChildResult {
	action: "loss";
	results: readonly string[];
	inputElapsedMs: number;
	unhandledRejections: number;
}

interface MixedChildResult {
	action: "mixed";
	providerCalls: readonly string[];
	toolExecutions: number;
	coreQueuedInputs: readonly string[];
	attempts: readonly {
		inputId: string;
		attemptId: string;
		revision: number;
		state: string;
	}[];
	unhandledRejections: number;
	uncaughtErrors: number;
}

interface CompactionChildResult {
	action: "compaction";
	providerCalls: readonly string[];
	queuedDuringCompaction: readonly {
		inputId: string;
		sequence: number;
		deliveryClass: string;
	}[];
	compactionBoundarySequence: number;
	compactionIndex: number;
	durableAttemptIndexes: readonly number[];
	attempts: readonly {
		inputId: string;
		attemptId: string;
		revision: number;
		state: string;
	}[];
	queuedAfter: number;
	unhandledRejections: number;
	uncaughtErrors: number;
}

type ChildResult =
	| FirstChildResult
	| ResumeChildResult
	| SingleSubmissionChildResult
	| OwnershipLossChildResult
	| MixedChildResult
	| CompactionChildResult;

const CHILD_SOURCE = String.raw`
import * as path from "node:path";
import { type AssistantMessage, clearCustomApis, registerCustomApi } from "@oh-my-pi/pi-ai";
import { buildModel } from "@oh-my-pi/pi-catalog/build";
import { AssistantMessageEventStream } from "@oh-my-pi/pi-ai/utils/event-stream";
import { z } from "zod/v4";
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
const TEST_BUILD_REVISION = { digest: "d".repeat(64), version: "durable-input-queue-agent-session-process" };
const TEST_RUNNER_INSTANCE_IDENTITY = {
	runnerInstanceId: "00000000-0000-4000-8000-000000000001",
	startedAt: "2026-01-01T00:00:00.000Z",
};
if (
	(action !== "first" &&
		action !== "resume" &&
		action !== "single" &&
		action !== "loss" &&
		action !== "mixed" &&
		action !== "compaction") ||
	!cwd ||
	!sessionFile ||
	!sessionsDir ||
	!home
) {
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
	const usageError = '{"type":"error","error":{"type":"rate_limit_error","message":"usage limit"}} retry-after-ms=600000';
	function textStream(text, gate) {
		const stream = new AssistantMessageEventStream();
		void (gate ?? Promise.resolve()).then(() => setTimeout(() => {
			const message: AssistantMessage = {
				role: "assistant",
				content: [{ type: "text", text }],
				api,
				provider,
				model: model.id,
				usage: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, totalTokens: 0, cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 } },
				stopReason: "stop",
				timestamp: Date.now(),
			};
			stream.push({ type: "start", partial: message });
			stream.push({ type: "done", reason: "stop", message });
		}, 0));
		return stream;
	}
	function rateLimitStream() {
		const stream = new AssistantMessageEventStream();
		const message: AssistantMessage = {
			role: "assistant",
			content: [],
			api,
			provider,
			model: "durable-model",
			usage: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, totalTokens: 0, cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 } },
			stopReason: "error",
			errorMessage: usageError,
			timestamp: Date.now(),
		};
		queueMicrotask(() => {
			stream.push({ type: "start", partial: message });
			stream.push({ type: "error", reason: "error", error: message });
		});
		return stream;
	}
	function toolStream() {
		const stream = new AssistantMessageEventStream();
		const message: AssistantMessage = {
			role: "assistant",
			content: [{ type: "toolCall", id: "durable-gate-call", name: "durable_gate", arguments: {} }],
			api,
			provider,
			model: "durable-model",
			usage: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, totalTokens: 0, cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 } },
			stopReason: "toolUse",
			timestamp: Date.now(),
		};
		queueMicrotask(() => {
			stream.push({ type: "start", partial: message });
			stream.push({ type: "done", reason: "toolUse", message });
		});
		return stream;
	}
	registerCustomApi(api, (_streamModel, context) => {
		const lastUser = [...context.messages].reverse().find(message => message.role === "user");
		const textPart = Array.isArray(lastUser?.content)
			? lastUser.content.find(part => part?.type === "text" && typeof part.text === "string")
			: undefined;
		const call = typeof lastUser?.content === "string" ? lastUser.content : textPart ? textPart.text : JSON.stringify(lastUser?.content);
		providerCalls.push(responseKind === "compaction" && providerCalls.length === 0 ? "compaction" : call);
		existing?.providerInvoked?.resolve();
		if (providerCalls.length === 3) existing?.thirdCall?.resolve();
		if (responseKind === "rate-limit") return rateLimitStream();
		if (responseKind === "mixed" && providerCalls.length === 1) return toolStream();
		return textStream(responseKind === "compaction" && providerCalls.length === 1 ? "Compaction summary." : responseKind === "mixed" ? "settled" : "resumed ok", existing?.responseGate?.promise);
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
			buildRevision: TEST_BUILD_REVISION,
			runnerInstanceIdentity: TEST_RUNNER_INSTANCE_IDENTITY,
		});
	}
	acquired.sessionManager.bindSessionOwnership(acquired.ownership);
	if (!(await acquired.ownership.isCurrent())) {
		throw new Error("session ownership was not current before AgentSession construction");
	}
	const settings = Settings.isolated({
		"compaction.enabled": false,
		"compaction.keepRecentTokens": responseKind === "compaction" ? 1 : undefined,
		"retry.maxDelayMs": 100,
	});
	if (responseKind === "compaction" && acquired.sessionManager.getEntries().length === 0) {
		for (const text of ["persisted branch context one", "persisted branch context two"]) {
			acquired.sessionManager.appendMessage({ role: "user", content: [{ type: "text", text }], timestamp: Date.now() });
			acquired.sessionManager.appendMessage({
				role: "assistant",
				content: [{ type: "text", text: "persisted response for " + text }],
				api,
				provider,
				model: model.id,
				usage: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, totalTokens: 0, cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 } },
				stopReason: "stop",
				timestamp: Date.now(),
			});
		}
		await acquired.sessionManager.flush();
	}
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
		toolNames: responseKind === "mixed" ? ["durable_gate"] : [],
		customTools: responseKind === "mixed"
			? [{
				name: "durable_gate",
				label: "durable gate",
				description: "Gates this process proof until its queued input is durable.",
				parameters: z.object({}),
				async execute() {
					existing?.toolExecutions?.push("durable_gate");
					existing?.toolStarted?.resolve();
					await existing?.toolGate?.promise;
					return { content: [{ type: "text", text: "gate released" }] };
				},
			}]
			: undefined,
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
		const { ctx, editor } = createControllerContext(harness.session, harness.sessionManager, harness.settings, commandSink);
		let submittedTurn;
		ctx.onInputCallback = submission => {
			submittedTurn = harness.session.prompt(submission.text, { attachments: submission.attachments });
		};
		const controller = new InputController(ctx);
		controller.setupEditorSubmitHandler();
		await editor.onSubmit("ordinary durable hello");
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
		buildRevision: TEST_BUILD_REVISION,
		runnerInstanceIdentity: TEST_RUNNER_INSTANCE_IDENTITY,
	});
	sessionManager.bindSessionOwnership(ownership);
	const queue = await DurableInputQueue.open(ownership, path.join(home, ".agent-mux"));
	const adoptedBeforeDue = (await queue.adopt()).length;
	const earlyDue = (await queue.retryDue(retryAt - 1)).length;
	const due = (await queue.retryDue(retryAt)).length;
	const responseGate = Promise.withResolvers();
	const providerInvoked = Promise.withResolvers();
	const releaseResponse = providerInvoked.promise.then(() => responseGate.resolve());
	const harness = await createSession("success", providerCalls, { sessionManager, ownership, responseGate, providerInvoked });
	try {
		await providerInvoked.promise;
		await releaseResponse;
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
} else if (action === "single") {
	const providerCalls = [];
	const commandSink = { bash: [], python: [], statuses: [] };
	const harness = await createSession("success", providerCalls);
	try {
		const { ctx, editor } = createControllerContext(harness.session, harness.sessionManager, harness.settings, commandSink);
		let submittedTurn;
		ctx.onInputCallback = submission => {
			submittedTurn = harness.session.prompt(submission.text, {
				attachments: submission.attachments,
				streamingBehavior: submission.streamingBehavior,
			});
		};
		const controller = new InputController(ctx);
		controller.setupEditorSubmitHandler();
		await editor.onSubmit("go on");
		if (!submittedTurn) throw new Error("idle submission did not start a session prompt");
		await submittedTurn;
		await harness.session.waitForIdle();
		const completed = latestAttempt(harness.sessionManager, "completed");
		const queue = await DurableInputQueue.open(harness.ownership, path.join(home, ".agent-mux"));
		const userTranscript = harness.sessionManager
			.getEntries()
			.flatMap(entry => {
				if (entry.type !== "message" || entry.message.role !== "user") return [];
				const content = entry.message.content;
				return Array.isArray(content)
					? content.filter(part => part.type === "text").map(part => part.text)
					: typeof content === "string"
						? [content]
						: [];
			});
		console.log(JSON.stringify({
			action: "single",
			inputId: completed.inputId,
			providerCalls,
			userTranscript,
			queuedAfter: (await queue.replayQueued()).length,
			admittedAgain: (await queue.admitNext()) !== undefined,
			attempts: durableAttemptEntries(harness.sessionManager).map(entry => ({
				inputId: entry.inputId,
				attemptId: entry.attemptId,
				revision: entry.revision,
				state: entry.state,
			})),
		}));
	} finally {
		await closeHarness(harness);
	}
} else if (action === "mixed") {
	const providerCalls = [];
	const toolGate = Promise.withResolvers();
	const toolStarted = Promise.withResolvers();
	const thirdCall = Promise.withResolvers();
	const toolExecutions = [];
	const harness = await createSession("mixed", providerCalls, { toolGate, toolStarted, thirdCall, toolExecutions });
	let unhandledRejections = 0;
	let uncaughtErrors = 0;
	const onUnhandledRejection = () => {
		unhandledRejections++;
	};
	const onUncaughtException = () => {
		uncaughtErrors++;
	};
	process.on("unhandledRejection", onUnhandledRejection);
	process.on("uncaughtException", onUncaughtException);
	try {
		const initial = harness.session.followUp("initial tool request");
		await toolStarted.promise;
		await harness.session.followUp("lower follow-up");
		await harness.session.steer("higher steer");
		const coreQueuedInputs = harness.session.messages
			.filter(message => message.role === "user")
			.flatMap(message => typeof message.content === "string"
				? [message.content]
				: message.content.filter(part => part.type === "text").map(part => part.text))
			.filter(text => text === "lower follow-up" || text === "higher steer");
		toolGate.resolve();
		await initial;
		await thirdCall.promise;
		await harness.session.waitForIdle();
		const attempts = durableAttemptEntries(harness.sessionManager).map(entry => ({
			inputId: entry.inputId,
			attemptId: entry.attemptId,
			revision: entry.revision,
			state: entry.state,
		}));
		console.log(JSON.stringify({
			action: "mixed",
			providerCalls,
			toolExecutions,
			coreQueuedInputs,
			attempts,
			unhandledRejections,
			uncaughtErrors,
		}));
	} finally {
		process.off("unhandledRejection", onUnhandledRejection);
		process.off("uncaughtException", onUncaughtException);
		await closeHarness(harness);
	}
} else if (action === "compaction") {
	const providerCalls = [];
	const responseGate = Promise.withResolvers();
	const providerInvoked = Promise.withResolvers();
	const harness = await createSession("compaction", providerCalls, { responseGate, providerInvoked });
	let unhandledRejections = 0;
	let uncaughtErrors = 0;
	const onUnhandledRejection = () => {
		unhandledRejections++;
	};
	const onUncaughtException = () => {
		uncaughtErrors++;
	};
	process.on("unhandledRejection", onUnhandledRejection);
	process.on("uncaughtException", onUncaughtException);
	try {
		const compacting = harness.session.compact();
		await providerInvoked.promise;
		const queuedInput = harness.session.followUp("input captured during compaction");
		const projection = await DurableInputQueue.open(harness.ownership, path.join(home, ".agent-mux"));
		let queuedDuringCompaction = await projection.replayQueued();
		for (let attempt = 0; queuedDuringCompaction.length === 0 && attempt < 50; attempt++) {
			await Bun.sleep(1);
			queuedDuringCompaction = await projection.replayQueued();
		}
		if (queuedDuringCompaction.length === 0) throw new Error("input was not journaled while compaction provider was gated");
		if (providerCalls.some(call => call.includes("input captured during compaction"))) {
			throw new Error("main provider received input before compaction committed: " + JSON.stringify(providerCalls));
		}
		responseGate.resolve();
		await compacting;
		await queuedInput;
		await harness.session.waitForIdle();
		const entries = harness.sessionManager.getEntries();
		const compactionIndex = entries.findIndex(entry => entry.type === "compaction");
		if (compactionIndex < 0) throw new Error("manual compaction did not persist a compaction entry");
		const compactionEntry = entries[compactionIndex];
		if (compactionEntry?.type !== "compaction" || typeof compactionEntry.queueBoundarySequence !== "number") {
			throw new Error("compaction entry omitted queue boundary sequence");
		}
		const durableAttemptIndexes = entries
			.map((entry, index) => entry.type === "custom" && entry.customType === "durable_input_attempt" ? index : -1)
			.filter(index => index >= 0);
		const attempts = durableAttemptEntries(harness.sessionManager).map(entry => ({
			inputId: entry.inputId,
			attemptId: entry.attemptId,
			revision: entry.revision,
			state: entry.state,
		}));
		console.log(JSON.stringify({
			action: "compaction",
			providerCalls,
			queuedDuringCompaction: queuedDuringCompaction.map(input => ({
				inputId: input.inputId,
				sequence: input.sequence,
				deliveryClass: input.deliveryClass,
			})),
			compactionBoundarySequence: compactionEntry.queueBoundarySequence,
			compactionIndex,
			durableAttemptIndexes,
			attempts,
			queuedAfter: (await projection.replayQueued()).length,
			unhandledRejections,
			uncaughtErrors,
		}));
	} finally {
		process.off("unhandledRejection", onUnhandledRejection);
		process.off("uncaughtException", onUncaughtException);
		await closeHarness(harness);
	}
} else {
	const providerCalls = [];
	const responseGate = Promise.withResolvers();
	const providerInvoked = Promise.withResolvers();
	const harness = await createSession("success", providerCalls, { responseGate, providerInvoked });
	let unhandledRejections = 0;
	const onUnhandledRejection = () => {
		unhandledRejections++;
	};
	process.on("unhandledRejection", onUnhandledRejection);
	try {
		const inFlight = harness.session.prompt("lose ownership after request start");
		await providerInvoked.promise;
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
		await harness.session.waitForIdle();
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

function isAttemptLedger(value: unknown): value is MixedChildResult["attempts"][number] {
	return (
		typeof value === "object" &&
		value !== null &&
		typeof (value as Record<string, unknown>).inputId === "string" &&
		typeof (value as Record<string, unknown>).attemptId === "string" &&
		typeof (value as Record<string, unknown>).revision === "number" &&
		typeof (value as Record<string, unknown>).state === "string"
	);
}

function isCompactionProjection(value: unknown): value is CompactionChildResult["queuedDuringCompaction"][number] {
	return (
		typeof value === "object" &&
		value !== null &&
		typeof (value as Record<string, unknown>).inputId === "string" &&
		typeof (value as Record<string, unknown>).sequence === "number" &&
		typeof (value as Record<string, unknown>).deliveryClass === "string"
	);
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
		record.action === "single" &&
		typeof record.inputId === "string" &&
		isStringArray(record.providerCalls) &&
		isStringArray(record.userTranscript) &&
		typeof record.queuedAfter === "number" &&
		typeof record.admittedAgain === "boolean" &&
		Array.isArray(record.attempts) &&
		record.attempts.every(isAttemptLedger)
	) {
		return {
			action: "single",
			inputId: record.inputId,
			providerCalls: record.providerCalls,
			userTranscript: record.userTranscript,
			queuedAfter: record.queuedAfter,
			admittedAgain: record.admittedAgain,
			attempts: record.attempts,
		};
	}
	if (
		record.action === "mixed" &&
		isStringArray(record.providerCalls) &&
		isStringArray(record.toolExecutions) &&
		isStringArray(record.coreQueuedInputs) &&
		Array.isArray(record.attempts) &&
		record.attempts.every(isAttemptLedger) &&
		typeof record.unhandledRejections === "number" &&
		typeof record.uncaughtErrors === "number"
	) {
		return {
			action: "mixed",
			providerCalls: record.providerCalls,
			toolExecutions: record.toolExecutions.length,
			coreQueuedInputs: record.coreQueuedInputs,
			attempts: record.attempts,
			unhandledRejections: record.unhandledRejections,
			uncaughtErrors: record.uncaughtErrors,
		};
	}
	if (
		record.action === "compaction" &&
		isStringArray(record.providerCalls) &&
		Array.isArray(record.queuedDuringCompaction) &&
		record.queuedDuringCompaction.every(isCompactionProjection) &&
		typeof record.compactionBoundarySequence === "number" &&
		typeof record.compactionIndex === "number" &&
		Array.isArray(record.durableAttemptIndexes) &&
		record.durableAttemptIndexes.every(index => typeof index === "number") &&
		Array.isArray(record.attempts) &&
		record.attempts.every(isAttemptLedger) &&
		typeof record.queuedAfter === "number" &&
		typeof record.unhandledRejections === "number" &&
		typeof record.uncaughtErrors === "number"
	) {
		return {
			action: "compaction",
			providerCalls: record.providerCalls,
			queuedDuringCompaction: record.queuedDuringCompaction,
			compactionBoundarySequence: record.compactionBoundarySequence,
			compactionIndex: record.compactionIndex,
			durableAttemptIndexes: record.durableAttemptIndexes,
			attempts: record.attempts,
			queuedAfter: record.queuedAfter,
			unhandledRejections: record.unhandledRejections,
			uncaughtErrors: record.uncaughtErrors,
		};
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
	it("delivers one idle typed submission through one durable attempt without residue", async () => {
		const root = await fs.mkdtemp(path.join(os.tmpdir(), "omp-agent-session-queue-single-"));
		roots.push(root);
		const fixture = await createPersistedSession(root);
		const single = await runChild({
			ACTION: "single",
			CWD: fixture.cwd,
			HOME: fixture.home,
			SESSIONS_DIR: fixture.sessionsDir,
			SESSION_FILE: fixture.sessionFile,
		});
		if (single.action !== "single") throw new Error("single child returned an unexpected result");

		expect(single.providerCalls).toEqual(["go on"]);
		expect(single.userTranscript.filter(text => text === "go on")).toHaveLength(1);
		expect(single.queuedAfter).toBe(0);
		expect(single.admittedAgain).toBe(false);
		expect(single.attempts).toHaveLength(3);
		expect(single.attempts.map(attempt => attempt.state)).toEqual(["admitted", "request-started", "completed"]);
		expect(new Set(single.attempts.map(attempt => attempt.inputId))).toEqual(new Set([single.inputId]));
	}, 10_000);
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
		const queueRoot = path.join(ownersRoot, queueKey, "queue-v3");
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
	it("preserves capture order when an earlier follow-up blocks a later steer at the tool boundary", async () => {
		const root = await fs.mkdtemp(path.join(os.tmpdir(), "omp-agent-session-queue-mixed-"));
		roots.push(root);
		const fixture = await createPersistedSession(root);
		const mixed = await runChild({
			ACTION: "mixed",
			CWD: fixture.cwd,
			HOME: fixture.home,
			SESSIONS_DIR: fixture.sessionsDir,
			SESSION_FILE: fixture.sessionFile,
		});
		if (mixed.action !== "mixed") throw new Error("mixed child returned an unexpected result");

		expect(mixed.providerCalls).toHaveLength(4);
		expect(mixed.providerCalls[0]).toBe("initial tool request");
		expect(mixed.providerCalls.filter(call => call.includes("lower follow-up") || call.includes("higher steer"))).toEqual([
			"lower follow-up",
			"higher steer",
		]);
		expect(mixed.toolExecutions).toBe(1);
		expect(mixed.coreQueuedInputs).toEqual([]);
		expect(mixed.unhandledRejections).toBe(0);
		expect(mixed.uncaughtErrors).toBe(0);
		const inputs = ["initial tool request", "lower follow-up", "higher steer"];
		const byAttempt = Map.groupBy(mixed.attempts, entry => `${entry.inputId}:${entry.attemptId}:${entry.revision}`);
		expect(byAttempt.size).toBe(inputs.length);
		expect([...byAttempt.values()].map(entries => entries.map(entry => entry.state))).toEqual(
			inputs.map(() => ["admitted", "request-started", "completed"]),
		);
	}, 10_000);
	it("holds queued input behind a durable manual compaction boundary", async () => {
		const root = await fs.mkdtemp(path.join(os.tmpdir(), "omp-agent-session-queue-compaction-"));
		roots.push(root);
		const fixture = await createPersistedSession(root);
		const compaction = await runChild({
			ACTION: "compaction",
			CWD: fixture.cwd,
			HOME: fixture.home,
			SESSIONS_DIR: fixture.sessionsDir,
			SESSION_FILE: fixture.sessionFile,
		});
		if (compaction.action !== "compaction") throw new Error("compaction child returned an unexpected result");

		expect(compaction.queuedDuringCompaction).toHaveLength(1);
		const [queued] = compaction.queuedDuringCompaction;
		if (!queued) throw new Error("compaction child omitted queued input projection");
		expect(queued).toMatchObject({ deliveryClass: "followUp" });
		expect(queued.inputId).not.toBe("");
		expect(queued.sequence).toBeGreaterThan(compaction.compactionBoundarySequence);
		expect(compaction.providerCalls.at(-1)).toContain("input captured during compaction");
		expect(
			compaction.providerCalls.slice(0, -1).every(call => !call.includes("input captured during compaction")),
		).toBe(true);
		expect(compaction.compactionIndex).toBeGreaterThanOrEqual(0);
		expect(compaction.durableAttemptIndexes.length).toBeGreaterThan(0);
		expect(compaction.durableAttemptIndexes.every(index => index > compaction.compactionIndex)).toBe(true);
		expect(compaction.attempts).toHaveLength(3);
		expect(compaction.attempts.map(entry => entry.state)).toEqual(["admitted", "request-started", "completed"]);
		expect(new Set(compaction.attempts.map(entry => entry.inputId))).toEqual(new Set([queued.inputId]));
		expect(compaction.queuedAfter).toBe(0);
		expect(compaction.unhandledRejections).toBe(0);
		expect(compaction.uncaughtErrors).toBe(0);
	}, 10_000);
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
	}, 5_000);
});
