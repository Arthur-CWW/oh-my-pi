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
const streamFn = (_model, context) => {
  const lastUser = [...context.messages].reverse().find(message => message.role === "user");
  const text = typeof lastUser?.content === "string"
    ? lastUser.content
    : lastUser?.content?.find(part => part.type === "text")?.text;
  providerCalls.push(text ?? "");
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
const injectedSession = new AgentSession({
  agent: makeAgent(),
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
const persisted = await injectedQueue.list();
const promptAccepted = await injectedSession.prompt("ordinary prompt");
await injectedSession.waitForIdle();
await injectedSession.followUp("ordinary follow-up");
await injectedSession.waitForIdle();
await injectedSession.steer("ordinary steer");
await injectedSession.waitForIdle();
const ordinaryQueuedInputs = (await injectedQueue.list())
  .filter(item => item.inputId !== first.item.inputId)
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
  ordinaryQueuedInputs,
  providerCalls,
  defaultOpenedDuringInjection,
  injectedAdoptRecords,
  ownershipFailureName,
  standaloneQueueHeadExists,
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
			providerCalls: string[];
			defaultOpenedDuringInjection: boolean;
			injectedAdoptRecords: number;
			ownershipFailureName?: string;
			standaloneQueueHeadExists: boolean;
		};

		expect(result.first).toMatchObject({ sequence: 1, runnerRevision: 1, replayed: false });
		expect(result.replay).toEqual({ ...result.first, replayed: true });
		expect(result.persisted).toEqual([
			{ inputId: result.first.inputId, revision: 1, attempts: ["completed"] },
		]);
		expect(result.providerCalls.filter(call => call === "runner command")).toEqual(["runner command"]);
		expect(result.promptAccepted).toBe(true);
		expect(result.ordinaryQueuedInputs).toEqual([
			{ text: "ordinary prompt", deliveryClass: "followUp", revision: 1, state: "completed" },
			{ text: "ordinary follow-up", deliveryClass: "followUp", revision: 1, state: "completed" },
			{ text: "ordinary steer", deliveryClass: "steer", revision: 1, state: "completed" },
		]);
		expect(result.providerCalls).toEqual(["runner command", "ordinary prompt", "ordinary follow-up", "ordinary steer"]);
		expect(result.injectedAdoptRecords).toBe(1);
		expect(result.defaultOpenedDuringInjection).toBe(false);
		expect(result.ownershipFailureName).toBe("SessionOwnershipLostError");
		expect(result.standaloneQueueHeadExists).toBe(true);
	}, 10_000);
});
