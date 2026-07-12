import { afterEach, describe, expect, it } from "bun:test";
import * as fs from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";

const roots: string[] = [];

const CHILD_SOURCE = String.raw`
import * as fs from "node:fs/promises";
import * as path from "node:path";
import { Agent } from "@oh-my-pi/pi-agent-core";
import { type AssistantMessage, AssistantMessageEventStream } from "@oh-my-pi/pi-ai";
import { getBundledModel } from "@oh-my-pi/pi-catalog/models";
import { ModelRegistry } from "@oh-my-pi/pi-coding-agent/config/model-registry";
import { Settings } from "@oh-my-pi/pi-coding-agent/config/settings";
import { AgentSession } from "@oh-my-pi/pi-coding-agent/session/agent-session";
import { AuthStorage } from "@oh-my-pi/pi-coding-agent/session/auth-storage";
import { DurableInputQueue } from "@oh-my-pi/pi-coding-agent/session/durable-input-queue";
import { SessionManager } from "@oh-my-pi/pi-coding-agent/session/session-manager";
import { acquireSessionOwnership } from "@oh-my-pi/pi-coding-agent/session/session-ownership";

const root = process.env.ROOT;
if (!root) throw new Error("missing ROOT");
const project = path.join(root, "project");
const sessions = path.join(root, "sessions");
const injectedMuxRoot = path.join(root, "injected-mux");
const defaultMuxRoot = path.join(root, "default-mux");
process.env.AGENT_MUX_DIR = defaultMuxRoot;
await fs.mkdir(project, { recursive: true });
await fs.mkdir(sessions, { recursive: true });

const model = getBundledModel("anthropic", "claude-sonnet-4-5");
if (!model) throw new Error("test model unavailable");
const authStorage = await AuthStorage.create(path.join(root, "auth.db"));
authStorage.setRuntimeApiKey(model.provider, "test-key");
const modelRegistry = new ModelRegistry(authStorage, path.join(root, "models.yml"));
const providerCalls = [];
const providerContexts = [];
const streamFn = (_model, context) => {
  const lastUser = [...context.messages].reverse().find(message => message.role === "user");
  const text = typeof lastUser?.content === "string"
    ? lastUser.content
    : lastUser?.content?.find(part => part.type === "text")?.text;
  providerCalls.push(text ?? "");
  providerContexts.push(context.messages.map(message => ({
    role: message.role,
    content: typeof message.content === "string"
      ? message.content
      : message.content?.find(part => part.type === "text")?.text,
  })));
  const stream = new AssistantMessageEventStream();
  const message: AssistantMessage = {
    role: "assistant",
    content: [{ type: "text", text: "accepted" }],
    api: model.api,
    provider: model.provider,
    model: model.id,
    usage: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, totalTokens: 0, cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 } },
    stopReason: "stop",
    timestamp: Date.now(),
  };
  queueMicrotask(() => {
    stream.push({ type: "start", partial: message });
    stream.push({ type: "done", reason: "stop", message });
  });
  return stream;
};
function makeAgent() {
  return new Agent({
    initialState: { model, systemPrompt: ["test"], tools: [], messages: [] },
    convertToLlm: messages => messages.map(message =>
      message.role === "custom"
        ? { role: "user", content: message.content, timestamp: message.timestamp }
        : message
    ),
    streamFn,
  });
}

const manager = SessionManager.create(project, sessions);
await manager.flush();
const bootstrapOwnership = await acquireSessionOwnership(manager.getSessionFile(), manager.getSessionId(), { root: injectedMuxRoot });
const bootstrapQueue = await DurableInputQueue.open(bootstrapOwnership, injectedMuxRoot);
await bootstrapQueue.adopt();
await bootstrapOwnership.release();
const ownership = await acquireSessionOwnership(manager.getSessionFile(), manager.getSessionId(), { root: injectedMuxRoot });
manager.bindSessionOwnership(ownership);
const injectedQueue = await DurableInputQueue.open(ownership, injectedMuxRoot);
await injectedQueue.adopt();
const injectedAgent = makeAgent();
const injectedSession = new AgentSession({
  agent: injectedAgent,
  sessionManager: manager,
  durableInputQueue: injectedQueue,
  settings: Settings.isolated({ "compaction.enabled": false }),
  modelRegistry,
});
const input = { text: "runner command", deliveryClass: "followUp" };
const command = {
  schemaVersion: 1,
  commandId: "command-1",
  correlationId: "correlation-1",
  viewId: "view-1",
  controllerEpoch: 1,
  expectedRevision: 0,
};
const first = await injectedSession.acceptDurableInput(input, command);
const replay = await injectedSession.acceptDurableInput(input, command);
await injectedSession.waitForIdle();
const appendTurnStarted = await injectedSession.sendCustomMessage(
  { customType: "idle-append", content: "idle durable append", display: false, attribution: "agent" },
  { deliverAs: "nextTurn", triggerTurn: false },
);
await injectedSession.waitForIdle();
const callsBeforeDeferred = providerCalls.length;
await injectedSession.acceptDurableInput({
  kind: "custom",
  message: {
    customType: "deferred-context",
    content: "durable prefix",
    display: false,
    attribution: "agent",
  },
  deliverAs: "nextTurn",
  triggerTurn: false,
  disposition: "provider",
}, { ...command, commandId: "custom-prefix", correlationId: "custom-prefix", expectedRevision: 1 });
await Bun.sleep(10);
const callsWhileDeferredAlone = providerCalls.length;
await injectedSession.acceptDurableInput(
  { text: "after durable prefix", deliveryClass: "followUp" },
  { ...command, commandId: "after-prefix", correlationId: "after-prefix", expectedRevision: 2 },
);
await injectedSession.waitForIdle();
const completeAppendOnly = injectedQueue.completeAppendOnly.bind(injectedQueue);
let appendCompletionAttempts = 0;
injectedQueue.completeAppendOnly = async (...args) => {
  appendCompletionAttempts++;
  if (appendCompletionAttempts === 1) throw new Error("injected append completion failure");
  return completeAppendOnly(...args);
};
const structuredContent = [
  { type: "text", text: "structured durable append" },
  { type: "image", data: "ZmFrZQ==", mimeType: "image/png" },
];
let structuredFailure;
try {
  await injectedSession.sendCustomMessage(
    { customType: "structured-retry", content: structuredContent, display: false, attribution: "agent" },
    { deliverAs: "nextTurn", triggerTurn: false },
  );
} catch (error) {
  structuredFailure = error?.message;
}
await injectedSession.sendCustomMessage(
  { customType: "retry-drain", content: "wake retry", display: false, attribution: "agent" },
  { deliverAs: "nextTurn", triggerTurn: false },
);
await injectedSession.waitForIdle();
const structuredMessages = injectedAgent.state.messages.filter(
  message => message.role === "custom" && message.customType === "structured-retry"
);
const prefixProviderContext = providerContexts.find(messages =>
  messages.some(message => message.role === "user" && message.content === "after durable prefix")
);
const persisted = await injectedQueue.list();
const promptAccepted = await injectedSession.prompt("ordinary prompt");
await injectedSession.waitForIdle();
await injectedSession.followUp("ordinary follow-up");
await injectedSession.waitForIdle();
await injectedSession.steer("ordinary steer");
await injectedSession.waitForIdle();
const ordinaryQueuedInputs = (await injectedQueue.list())
  .filter(item => item.inputId !== first.item.inputId && item.payload.kind !== "custom")
  .map(item => ({ text: item.payload.text, deliveryClass: item.deliveryClass, revision: item.revision, state: item.state }));
const [injectedOwnerDirectory] = await fs.readdir(path.join(injectedMuxRoot, "owners-v1"));
const injectedSegmentsRoot = path.join(injectedMuxRoot, "owners-v1", injectedOwnerDirectory, "queue-v2", "segments");
const injectedSegmentNames = await fs.readdir(injectedSegmentsRoot);
const injectedRecords = (await Promise.all(injectedSegmentNames.map(name => fs.readFile(path.join(injectedSegmentsRoot, name), "utf8"))))
  .flatMap(text => text.trim().split("\n").filter(Boolean).map(line => JSON.parse(line)));
const injectedAdoptRecords = injectedRecords.filter(record => record.type === "adopt").length;
let defaultOpenedDuringInjection = true;
try { await fs.stat(defaultMuxRoot); } catch (error) {
  if (error?.code === "ENOENT") defaultOpenedDuringInjection = false;
  else throw error;
}
await ownership.release();
let ownershipFailureName;
try {
  await injectedSession.acceptDurableInput(
    { text: "stale owner", deliveryClass: "followUp" },
    { ...command, commandId: "command-after-loss", correlationId: "correlation-after-loss", expectedRevision: 1 },
  );
} catch (error) {
  ownershipFailureName = error?.name;
}
await injectedSession.dispose();
await manager.close();

const standaloneManager = SessionManager.create(project, sessions);
await standaloneManager.flush();
const standaloneOwnership = await acquireSessionOwnership(
  standaloneManager.getSessionFile(),
  standaloneManager.getSessionId(),
  { root: defaultMuxRoot },
);
standaloneManager.bindSessionOwnership(standaloneOwnership);
const standaloneSession = new AgentSession({
  agent: makeAgent(),
  sessionManager: standaloneManager,
  settings: Settings.isolated({ "compaction.enabled": false }),
  modelRegistry,
});
const ownerDirectories = await fs.readdir(path.join(defaultMuxRoot, "owners-v1"));
const standaloneQueueHead = path.join(defaultMuxRoot, "owners-v1", ownerDirectories[0], "queue-v2", "head.json");
let standaloneQueueHeadExists = false;
for (let attempt = 0; attempt < 100 && !standaloneQueueHeadExists; attempt++) {
  try {
    standaloneQueueHeadExists = (await fs.stat(standaloneQueueHead)).isFile();
  } catch (error) {
    if (error?.code !== "ENOENT") throw error;
    await Bun.sleep(1);
  }
}
await standaloneSession.dispose();
await standaloneManager.close();
await standaloneOwnership.release();
authStorage.close();

console.log(JSON.stringify({
  first: { inputId: first.item.inputId, sequence: first.item.sequence, runnerRevision: first.runnerRevision, replayed: first.replayed },
  replay: { inputId: replay.item.inputId, sequence: replay.item.sequence, runnerRevision: replay.runnerRevision, replayed: replay.replayed },
  persisted: persisted.map(item => ({ inputId: item.inputId, revision: item.revision, attempts: item.attempts.map(attempt => attempt.state) })),
  promptAccepted,
  appendTurnStarted,
  ordinaryQueuedInputs,
  providerCalls,
  defaultOpenedDuringInjection,
  injectedAdoptRecords,
  ownershipFailureName,
  standaloneQueueHeadExists,
  deferredPrefix: {
    callsBeforeDeferred,
    callsWhileDeferredAlone,
    providerContext: prefixProviderContext,
  },
  structuredRetry: {
    appendCompletionAttempts,
    failure: structuredFailure,
    messageCount: structuredMessages.length,
    content: structuredMessages[0]?.content,
  },
}));
`;

afterEach(async () => {
	await Promise.all(roots.splice(0).map(root => fs.rm(root, { recursive: true, force: true })));
});

describe("AgentSession durable input queue injection", () => {
	it("uses one adopted queue and admits a replayed runner command exactly once", async () => {
		const root = await fs.mkdtemp(path.join(os.tmpdir(), "omp-agent-session-injected-queue-"));
		roots.push(root);
		const child = Bun.spawn({
			cmd: [process.execPath, "-e", CHILD_SOURCE],
			cwd: path.resolve(import.meta.dir, "../.."),
			env: { ...process.env, ROOT: root },
			stdout: "pipe",
			stderr: "pipe",
		});
		const [exitCode, stdout, stderr] = await Promise.all([
			child.exited,
			new Response(child.stdout).text(),
			new Response(child.stderr).text(),
		]);
		if (exitCode !== 0) throw new Error(`AgentSession injection child failed (${exitCode}): ${stderr}`);
		const line = stdout.trim().split("\n").at(-1);
		if (!line) throw new Error("AgentSession injection child emitted no result");
		const result = JSON.parse(line) as {
			first: { inputId: string; sequence: number; runnerRevision: number; replayed: boolean };
			replay: { inputId: string; sequence: number; runnerRevision: number; replayed: boolean };
			persisted: Array<{ inputId: string; revision: number; attempts: string[] }>;
			promptAccepted: boolean;
			ordinaryQueuedInputs: Array<{ text: string; deliveryClass: string; revision: number; state: string }>;
			appendTurnStarted: boolean;
			providerCalls: string[];
			defaultOpenedDuringInjection: boolean;
			injectedAdoptRecords: number;
			ownershipFailureName?: string;
			standaloneQueueHeadExists: boolean;
			deferredPrefix: {
				callsBeforeDeferred: number;
				callsWhileDeferredAlone: number;
				providerContext?: Array<{ role: string; content?: string }>;
			};
			structuredRetry: {
				appendCompletionAttempts: number;
				failure?: string;
				messageCount: number;
				content?: Array<{ type: string; text?: string; data?: string; mimeType?: string }>;
			};
		};

		expect(result.first).toMatchObject({ sequence: 1, runnerRevision: 1, replayed: false });
		expect(result.replay).toEqual({ ...result.first, replayed: true });
		expect(result.persisted).toHaveLength(6);
		expect(result.persisted.map(item => item.attempts)).toEqual([["completed"], [], [], ["completed"], [], []]);
		expect(result.providerCalls.filter(call => call === "runner command")).toEqual(["runner command"]);
		expect(result.deferredPrefix.callsWhileDeferredAlone).toBe(result.deferredPrefix.callsBeforeDeferred);
		expect(result.appendTurnStarted).toBe(false);
		expect(
			result.deferredPrefix.providerContext?.filter(
				message => message.role === "user" && message.content === "idle durable append",
			),
		).toHaveLength(1);
		const prefixIndex = result.deferredPrefix.providerContext?.findIndex(
			message => message.role === "user" && message.content === "durable prefix",
		);
		const userIndex = result.deferredPrefix.providerContext?.findIndex(
			message => message.role === "user" && message.content === "after durable prefix",
		);
		expect(prefixIndex).toBeGreaterThanOrEqual(0);
		expect(userIndex).toBeGreaterThan(prefixIndex ?? Number.MAX_SAFE_INTEGER);
		expect(result.structuredRetry).toEqual({
			appendCompletionAttempts: 3,
			failure: "injected append completion failure",
			messageCount: 1,
			content: [
				{ type: "text", text: "structured durable append" },
				{ type: "image", data: "ZmFrZQ==", mimeType: "image/png" },
			],
		});
		expect(result.promptAccepted).toBe(true);
		expect(result.ordinaryQueuedInputs.map(item => item.text)).toEqual([
			"after durable prefix",
			"ordinary prompt",
			"ordinary follow-up",
			"ordinary steer",
		]);
		expect(result.providerCalls).toEqual([
			"runner command",
			"after durable prefix",
			"ordinary prompt",
			"ordinary follow-up",
			"ordinary steer",
		]);
		expect(result.injectedAdoptRecords).toBe(1);
		expect(result.defaultOpenedDuringInjection).toBe(false);
		expect(result.ownershipFailureName).toBe("SessionOwnershipLostError");
		expect(result.standaloneQueueHeadExists).toBe(true);
	}, 10_000);
});
