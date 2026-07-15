import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import * as fs from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";
import { Agent, type AgentTool } from "@oh-my-pi/pi-agent-core";
import type { AssistantMessage } from "@oh-my-pi/pi-ai";
import { AssistantMessageEventStream } from "@oh-my-pi/pi-ai/utils/event-stream";
import { getBundledModel } from "@oh-my-pi/pi-catalog/models";
import { AsyncJobManager } from "@oh-my-pi/pi-coding-agent/async/job-manager";
import { Settings } from "@oh-my-pi/pi-coding-agent/config/settings";
import { ModelRegistry } from "@oh-my-pi/pi-coding-agent/config/model-registry";
import { IrcBus } from "@oh-my-pi/pi-coding-agent/irc/bus";
import { AgentLifecycleManager } from "@oh-my-pi/pi-coding-agent/registry/agent-lifecycle";
import { AgentRegistry } from "@oh-my-pi/pi-coding-agent/registry/agent-registry";
import { AgentSession, type AgentSessionEvent } from "@oh-my-pi/pi-coding-agent/session/agent-session";
import { AuthStorage } from "@oh-my-pi/pi-coding-agent/session/auth-storage";
import { convertToLlm } from "@oh-my-pi/pi-coding-agent/session/messages";
import { SessionManager } from "@oh-my-pi/pi-coding-agent/session/session-manager";
import {
	createFollowUpResultRouter,
	snapshotRequestedToolNames,
} from "@oh-my-pi/pi-coding-agent/task/executor";
import type { ToolSession } from "@oh-my-pi/pi-coding-agent/tools";
import { WriteTool } from "@oh-my-pi/pi-coding-agent/tools/write";
import { YieldTool } from "@oh-my-pi/pi-coding-agent/tools/yield";

class EventSession {
	readonly agent = { abort: () => this.aborts++ };
	aborts = 0;
	lastAssistantText = "";
	#listener: ((event: AgentSessionEvent) => void) | undefined;

	subscribe(listener: (event: AgentSessionEvent) => void): () => void {
		this.#listener = listener;
		return () => {
			this.#listener = undefined;
		};
	}

	emit(event: AgentSessionEvent): void {
		this.#listener?.(event);
	}

	getLastAssistantMessage(): { content: Array<{ type: "text"; text: string }> } {
		return { content: [{ type: "text", text: this.lastAssistantText }] };
	}
}

function assistant(content: AssistantMessage["content"], stopReason: AssistantMessage["stopReason"]): AssistantMessage {
	return {
		role: "assistant",
		content,
		api: "anthropic-messages",
		provider: "anthropic",
		model: "claude-sonnet-4-5",
		usage: {
			input: 0,
			output: 0,
			cacheRead: 0,
			cacheWrite: 0,
			totalTokens: 0,
			cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
		},
		stopReason,
		timestamp: Date.now(),
	};
}

function responseStream(message: AssistantMessage): AssistantMessageEventStream {
	const stream = new AssistantMessageEventStream();
	queueMicrotask(() => {
		stream.push({ type: "start", partial: message });
		stream.push({
			type: "done",
			reason:
				message.stopReason === "toolUse" || message.stopReason === "length" ? message.stopReason : "stop",
			message,
		});
	});
	return stream;
}

let root: string;
let previousHome: string | undefined;
let previousControlDb: string | undefined;

beforeEach(async () => {
	root = await fs.mkdtemp(path.join(os.tmpdir(), "park-revive-followup-"));
	previousHome = process.env.HOME;
	previousControlDb = process.env.OMP_SESSION_CONTROL_DB;
	process.env.HOME = root;
	process.env.OMP_SESSION_CONTROL_DB = path.join(root, "session-control.sqlite");
	AgentLifecycleManager.resetGlobalForTests();
	AgentRegistry.resetGlobalForTests();
	IrcBus.resetGlobalForTests();
	AgentRegistry.global().register({ id: "Main", displayName: "main", kind: "main", session: null, status: "idle" });
});

afterEach(async () => {
	AgentLifecycleManager.resetGlobalForTests();
	AgentRegistry.resetGlobalForTests();
	IrcBus.resetGlobalForTests();
	if (previousHome === undefined) delete process.env.HOME;
	else process.env.HOME = previousHome;
	if (previousControlDb === undefined) delete process.env.OMP_SESSION_CONTROL_DB;
	else process.env.OMP_SESSION_CONTROL_DB = previousControlDb;
	await fs.rm(root, { recursive: true, force: true });
});

describe("parked child revival", () => {
	it("preserves undefined full-tool selection instead of narrowing it to an empty allowlist", () => {
		expect(snapshotRequestedToolNames(undefined)).toBeUndefined();
		expect(snapshotRequestedToolNames(["write", "bash", "irc", "yield"])).toEqual([
			"write",
			"bash",
			"irc",
			"yield",
		]);
		expect(snapshotRequestedToolNames([])).toEqual([]);
	});

	it("retains a working write-capable tool after rematerializing the full-tool selection", async () => {
		const output = path.join(root, "revived-write.txt");
		const toolSession = {
			cwd: root,
			hasUI: false,
			settings: Settings.isolated({ "tools.approvalMode": "yolo" }),
			getSessionFile: () => null,
		} as ToolSession;
		const restoredSelection = snapshotRequestedToolNames(undefined);
		expect(restoredSelection).toBeUndefined();
		const result = await new WriteTool(toolSession).execute(
			"revived-write",
			{ path: output, content: "written after park" },
			undefined,
		);
		expect(result.isError).not.toBe(true);
		expect(await fs.readFile(output, "utf8")).toBe("written after park");
	});

	it("parks, revives through IRC, writes, and delivers both yield outcomes", async () => {
		const model = getBundledModel("anthropic", "claude-sonnet-4-5");
		if (!model) throw new Error("Expected bundled test model");
		const auth = await AuthStorage.create(path.join(root, "auth.sqlite"));
		auth.setRuntimeApiKey("anthropic", "test-key");
		const modelRegistry = new ModelRegistry(auth, path.join(root, "models.yml"));
		const settings = Settings.isolated({
			"async.enabled": false,
			"compaction.enabled": false,
			"todo.enabled": false,
			"tools.approvalMode": "yolo",
		});
		const output = path.join(root, "from-revived-agent.txt");
		let phase: "success" | "throwing" = "success";
		let request = 0;
		let activeSession: AgentSession | undefined;
		const router = createFollowUpResultRouter({ id: "RevivedReal", parentAgentId: "Main" });
		router.arm();

		const createChild = (): AgentSession => {
			const manager = SessionManager.inMemory(root);
			const toolSession = {
				cwd: root,
				hasUI: false,
				settings,
				getSessionFile: () => manager.getSessionFile() ?? null,
			} as ToolSession;
			const tools = [new WriteTool(toolSession), new YieldTool(toolSession)] as unknown as AgentTool[];
			let session: AgentSession;
			const agent = new Agent({
				getApiKey: () => "test-key",
				initialState: { model, systemPrompt: ["test"], tools, messages: [] },
				convertToLlm,
				streamFn: () => {
					const call = request++;
					if (phase === "success" && call === 0) {
						return responseStream(
							assistant(
								[{ type: "toolCall", id: "write-after-revive", name: "write", arguments: { path: output, content: "revived write succeeded" } }],
								"toolUse",
							),
						);
					}
					if (phase === "success") {
						return responseStream(
							assistant(
								[{ type: "toolCall", id: "yield-after-revive", name: "yield", arguments: { result: { data: { wrote: true } } } }],
								"toolUse",
							),
						);
					}
					if (call === 0) {
						return responseStream(
							assistant(
								[{ type: "toolCall", id: "yield-throws", name: "yield", arguments: { result: {} } }],
								"toolUse",
							),
						);
					}
					return responseStream(assistant([{ type: "text", text: "yield failed as expected" }], "stop"));
				},
			});
			session = new AgentSession({
				agent,
				sessionManager: manager,
				settings,
				modelRegistry,
				toolRegistry: new Map(tools.map(tool => [tool.name, tool])),
				agentId: "RevivedReal",
				agentKind: "sub",
			});
			activeSession = session;
			return session;
		};

		try {
			const initial = createChild();
			const initialTools = initial.getAllToolNames().sort();
			AgentRegistry.global().register({
				id: "RevivedReal",
				displayName: "task",
				kind: "sub",
				parentId: "Main",
				session: initial,
				status: "idle",
			});
			const lifecycle = AgentLifecycleManager.global();
			lifecycle.adopt("RevivedReal", {
				idleTtlMs: 0,
				revive: async registerSubscription => {
					const revived = createChild();
					registerSubscription(
						router.subscribe(revived, event => {
							if (event.type === "agent_start") AgentRegistry.global().setStatus("RevivedReal", "running");
							if (event.type === "agent_end") AgentRegistry.global().setStatus("RevivedReal", "idle");
						}),
					);
					return revived;
				},
			});
			await lifecycle.park("RevivedReal");
			expect(AgentRegistry.global().get("RevivedReal")?.status).toBe("parked");

			const successReport = IrcBus.global().wait("Main", { from: "RevivedReal" }, 2_000);
			const receipt = await IrcBus.global().send({ from: "Main", to: "RevivedReal", body: "write and yield" });
			expect(receipt.outcome).toBe("revived");
			expect(activeSession?.getAllToolNames().sort()).toEqual(initialTools);
			expect((await successReport)?.body).toContain('"wrote": true');
			await activeSession?.waitForIdle();
			expect(await fs.readFile(output, "utf8")).toBe("revived write succeeded");

			phase = "throwing";
			request = 0;
			const failedReport = IrcBus.global().wait("Main", { from: "RevivedReal" }, 2_000);
			await IrcBus.global().send({ from: "Main", to: "RevivedReal", body: "exercise throwing yield" });
			expect((await failedReport)?.body).toContain("Follow-up yield from RevivedReal failed");
			await activeSession?.waitForIdle();
		} finally {
			await AgentLifecycleManager.global().release("RevivedReal");
			auth.close();
		}
	});

	it("routes successful and throwing follow-up yields to the parent and terminal job", async () => {
		const manager = new AsyncJobManager({ onJobComplete: async () => {} });
		const jobId = manager.register("task", "Revived", async () => "initial result");
		await manager.waitForAll();
		const session = new EventSession();
		const router = createFollowUpResultRouter({
			id: "Revived",
			parentAgentId: "Main",
			asyncJobManager: manager,
			asyncJobId: jobId,
		});
		router.subscribe(session as unknown as AgentSession, () => {});
		router.arm();

		const successfulDelivery = IrcBus.global().wait("Main", { from: "Revived" }, 1_000);
		session.emit({ type: "agent_start" } as AgentSessionEvent);
		session.emit({
			type: "tool_execution_end",
			toolName: "yield",
			toolCallId: "yield-success",
			isError: false,
			result: { content: [{ type: "text", text: "Result submitted." }], details: { status: "success", data: { wrote: true } } },
		} as AgentSessionEvent);
		const successful = await successfulDelivery;
		expect(successful?.body).toContain('"wrote": true');
		expect(manager.getJob(jobId)?.resultText).toContain('"wrote": true');
		expect(session.aborts).toBe(1);

		const failedDelivery = IrcBus.global().wait("Main", { from: "Revived" }, 1_000);
		session.emit({ type: "agent_start" } as AgentSessionEvent);
		session.emit({
			type: "tool_execution_end",
			toolName: "yield",
			toolCallId: "yield-failure",
			isError: true,
			result: { content: [{ type: "text", text: "result must contain either data or error" }] },
		} as AgentSessionEvent);
		const failed = await failedDelivery;
		expect(failed?.body).toContain("Follow-up yield from Revived failed");
		expect(failed?.body).toContain("result must contain either data or error");
		expect(manager.getJob(jobId)?.resultText).toContain("result must contain either data or error");
		expect(session.aborts).toBe(1);
	});
});
