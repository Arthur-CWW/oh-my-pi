import { afterEach, beforeEach, describe, expect, it, vi } from "bun:test";
import * as path from "node:path";
import { Agent } from "@oh-my-pi/pi-agent-core";
import { getBundledModel } from "@oh-my-pi/pi-catalog/models";
import { ModelRegistry } from "@oh-my-pi/pi-coding-agent/config/model-registry";
import { Settings } from "@oh-my-pi/pi-coding-agent/config/settings";
import * as pythonExecutor from "@oh-my-pi/pi-coding-agent/eval/py/executor";
import * as bashExecutor from "@oh-my-pi/pi-coding-agent/exec/bash-executor";
import type { ExtensionRunner } from "@oh-my-pi/pi-coding-agent/extensibility/extensions";
import { AgentSession } from "@oh-my-pi/pi-coding-agent/session/agent-session";
import { AuthStorage } from "@oh-my-pi/pi-coding-agent/session/auth-storage";
import { SessionManager } from "@oh-my-pi/pi-coding-agent/session/session-manager";
import { TempDir } from "@oh-my-pi/pi-utils";

describe("AgentSession user shortcut hooks", () => {
	let tempDir: TempDir;
	let session: AgentSession;
	let modelRegistry: ModelRegistry;
	let authStorage: AuthStorage | undefined;

	beforeEach(async () => {
		tempDir = TempDir.createSync("@pi-user-shortcut-hooks-");
		authStorage = await AuthStorage.create(path.join(tempDir.path(), "testauth.db"));
		modelRegistry = new ModelRegistry(authStorage);
	});

	afterEach(async () => {
		vi.restoreAllMocks();
		if (session) {
			await session.dispose();
		}
		await pythonExecutor.disposeAllKernelSessions();
		authStorage?.close();
		authStorage = undefined;
		tempDir.removeSync();
	});

	function createSession(extensionRunner?: ExtensionRunner): AgentSession {
		const model = getBundledModel("anthropic", "claude-sonnet-4-5");
		if (!model) throw new Error("Expected claude-sonnet-4-5 model to exist");

		const agent = new Agent({
			initialState: {
				model,
				systemPrompt: ["Test"],
				tools: [],
				messages: [],
			},
		});

		session = new AgentSession({
			agent,
			sessionManager: SessionManager.inMemory(tempDir.path()),
			settings: Settings.isolated({ "compaction.enabled": false }),
			modelRegistry,
			extensionRunner,
		});
		return session;
	}

	it("invokes user_bash hook and honors replacement result", async () => {
		const replacement = {
			output: "hooked bash output",
			exitCode: 0,
			cancelled: false,
			truncated: false,
			totalLines: 1,
			totalBytes: 18,
			outputLines: 1,
			outputBytes: 18,
		};
		const emitUserBash = vi.fn().mockResolvedValue({ result: replacement });
		const extensionRunner = {
			hasHandlers: vi.fn((eventType: string) => eventType === "user_bash"),
			emitUserBash,
		} as unknown as ExtensionRunner;
		const executeBashSpy = vi.spyOn(bashExecutor, "executeBash");

		createSession(extensionRunner);
		const result = await session.executeBash("echo hello", undefined, { excludeFromContext: true });

		expect(emitUserBash).toHaveBeenCalledWith({
			type: "user_bash",
			command: "echo hello",
			excludeFromContext: true,
			cwd: expect.any(String),
		});
		expect(executeBashSpy).not.toHaveBeenCalled();
		expect(result).toEqual(replacement);
		const bashMessage = session.messages.at(-1);
		expect(bashMessage?.role).toBe("bashExecution");
		expect(bashMessage).toMatchObject({
			output: "hooked bash output",
			excludeFromContext: true,
		});
	});

	it("invokes user_python hook and honors replacement result", async () => {
		const replacement = {
			output: "hooked python output",
			exitCode: 0,
			cancelled: false,
			truncated: false,
			totalLines: 1,
			totalBytes: 20,
			outputLines: 1,
			outputBytes: 20,
			displayOutputs: [],
			stdinRequested: false,
		};
		const emitUserPython = vi.fn().mockResolvedValue({ result: replacement });
		const extensionRunner = {
			hasHandlers: vi.fn((eventType: string) => eventType === "user_python"),
			emitUserPython,
		} as unknown as ExtensionRunner;
		const executePythonSpy = vi.spyOn(pythonExecutor, "executePython");

		createSession(extensionRunner);
		const result = await session.executePython("print('hi')", undefined, { excludeFromContext: true });

		expect(emitUserPython).toHaveBeenCalledWith({
			type: "user_python",
			code: "print('hi')",
			excludeFromContext: true,
			cwd: expect.any(String),
		});
		expect(executePythonSpy).not.toHaveBeenCalled();
		expect(result).toEqual(replacement);
		const pythonMessage = session.messages.at(-1);
		expect(pythonMessage?.role).toBe("pythonExecution");
		expect(pythonMessage).toMatchObject({
			output: "hooked python output",
			excludeFromContext: true,
		});
	});

	it("falls back to normal execution when hook does not return a replacement", async () => {
		const extensionRunner = {
			hasHandlers: vi.fn((eventType: string) => eventType === "user_bash" || eventType === "user_python"),
			emitUserBash: vi.fn().mockResolvedValue({}),
			emitUserPython: vi.fn().mockResolvedValue(undefined),
		} as unknown as ExtensionRunner;
		vi.spyOn(bashExecutor, "executeBash").mockResolvedValue({
			output: "bash fallback",
			exitCode: 0,
			cancelled: false,
			truncated: false,
			totalLines: 1,
			totalBytes: 13,
			outputLines: 1,
			outputBytes: 13,
		});
		vi.spyOn(pythonExecutor, "executePython").mockResolvedValue({
			output: "python fallback",
			exitCode: 0,
			cancelled: false,
			truncated: false,
			totalLines: 1,
			totalBytes: 15,
			outputLines: 1,
			outputBytes: 15,
			displayOutputs: [],
			stdinRequested: false,
		});

		createSession(extensionRunner);
		const bashResult = await session.executeBash("pwd", undefined, { excludeFromContext: true });
		const pythonResult = await session.executePython("1+1", undefined, { excludeFromContext: false });

		expect(bashResult.output).toBe("bash fallback");
		expect(pythonResult.output).toBe("python fallback");
		expect(bashExecutor.executeBash).toHaveBeenCalledTimes(1);
		expect(pythonExecutor.executePython).toHaveBeenCalledTimes(1);
		expect(
			session.messages.some(message => message.role === "bashExecution" && message.excludeFromContext === true),
		).toBe(true);
		expect(
			session.messages.some(message => message.role === "pythonExecution" && message.excludeFromContext === false),
		).toBe(true);
	});

	it("shares Python state between eval and user shortcut execution", async () => {
		createSession();
		const evalSessionId = session.getEvalSessionId();
		if (!evalSessionId) throw new Error("Expected eval session ID");

		await pythonExecutor.executePython("shared_value = 123", {
			cwd: tempDir.path(),
			sessionId: `python:${evalSessionId}`,
			kernelMode: "session",
		});

		const result = await session.executePython("print(shared_value)");

		expect(result.exitCode).toBe(0);
		expect(result.output.trim()).toBe("123");
	});

	it("invokes extension commands through the narrow result boundary", async () => {
		const handler = vi.fn().mockResolvedValue(undefined);
		const emitError = vi.fn();
		const extensionRunner = {
			getCommand: vi.fn((name: string) => (name === "hello" ? { handler } : undefined)),
			createCommandContext: vi.fn(() => ({ privateExtensionState: true })),
			emitError,
			hasHandlers: vi.fn(() => false),
		} as unknown as ExtensionRunner;
		createSession(extensionRunner);

		expect(await session.invokeExtensionCommand("missing", "")).toEqual({ handled: false });
		expect(await session.invokeExtensionCommand("hello", "world")).toEqual({
			handled: true,
			result: "completed",
		});
		expect(handler).toHaveBeenCalledWith("world", { privateExtensionState: true });

		handler.mockRejectedValueOnce(new Error("command failed"));
		expect(await session.invokeExtensionCommand("hello", "again")).toEqual({
			handled: true,
			result: "error",
			error: "command failed",
		});
		expect(emitError).toHaveBeenCalledWith({
			extensionPath: "command:hello",
			event: "command",
			error: "command failed",
		});
	});

	it("fences plan resolution by opaque capability epoch", async () => {
		createSession();
		const resolve = vi.fn().mockResolvedValue({ secret: "not exported" });
		session.setStandingResolveHandler(resolve);

		const first = session.bindPlanResolveCapability("view-a");
		const second = session.bindPlanResolveCapability("view-b");
		expect(session.getWorkflowEligibility().planResolve).toEqual({ bound: true, capabilityEpoch: second });
		expect(await session.invokePlanResolve({ action: "approve" }, first)).toEqual({ result: "stale" });
		expect(await session.invokePlanResolve({ action: "approve" }, second)).toEqual({ result: "resolved" });
		expect(resolve).toHaveBeenCalledTimes(1);

		session.unbindPlanResolveCapability(second);
		expect(session.getWorkflowEligibility().planResolve).toEqual({
			bound: false,
			capabilityEpoch: second + 1,
		});
		expect(await session.invokePlanResolve({ action: "approve" }, second)).toEqual({ result: "stale" });
	});

	it("returns deeply frozen controller query DTOs and delegates drafts", async () => {
		createSession();
		const models = session.getModelCatalog();
		const tools = session.getToolCatalog();
		const metadata = session.getSessionMetadataSnapshot();
		const eligibility = session.getWorkflowEligibility();
		const lifecycle = session.getTurnLifecycle();

		expect(Object.isFrozen(models)).toBe(true);
		expect(models.every(item => Object.isFrozen(item) && Object.isFrozen(item.roles))).toBe(true);
		expect(models.every(item => typeof item.current === "boolean")).toBe(true);
		expect(Object.isFrozen(tools)).toBe(true);
		expect(Object.isFrozen(tools.tools)).toBe(true);
		expect(tools.tools.every(Object.isFrozen)).toBe(true);
		expect(tools.tools.every(item => typeof item.selectable === "boolean")).toBe(true);
		expect(Object.isFrozen(metadata)).toBe(true);
		expect(Object.isFrozen(metadata.branch)).toBe(true);
		expect(Object.isFrozen(metadata.usage)).toBe(true);
		expect(Object.isFrozen(metadata.workflow)).toBe(true);
		expect(metadata).toMatchObject({
			id: expect.any(String),
			file: null,
			cwd: tempDir.path(),
			name: null,
			parent: null,
			leaf: null,
			draft: null,
			workflow: { kind: "none" },
		});
		expect(Object.isFrozen(eligibility)).toBe(true);
		expect(Object.isFrozen(eligibility.planResolve)).toBe(true);
		expect(Object.isFrozen(eligibility.goalContinuation)).toBe(true);
		expect(eligibility.goalContinuation).toEqual({ eligible: false, reason: "inactive" });
		expect(lifecycle).toEqual({
			streaming: false,
			abortRequested: false,
			settling: false,
			postPromptWork: false,
			compacting: false,
			retrying: false,
			handoff: false,
			promptGeneration: 0,
		});
		expect(Object.isFrozen(lifecycle)).toBe(true);

		const saveDraft = vi.spyOn(session.sessionManager, "saveDraft").mockResolvedValue(undefined);
		const consumeDraft = vi.spyOn(session.sessionManager, "consumeDraft").mockResolvedValue("continue here");
		await session.saveDraft("continue here");
		expect(await session.consumeDraft()).toBe("continue here");
		expect(saveDraft).toHaveBeenCalledWith("continue here");
		expect(consumeDraft).toHaveBeenCalledTimes(1);
	});

	it("admits a goal continuation only once for the active goal", async () => {
		createSession();
		session.setGoalModeState({
			enabled: true,
			mode: "active",
			goal: {
				id: "goal-1",
				objective: "Finish the focused work",
				status: "active",
				tokensUsed: 0,
				timeUsedSeconds: 0,
				createdAt: 1,
				updatedAt: 1,
			},
		});
		const send = vi.spyOn(session, "sendCustomMessage").mockResolvedValue(false);
		expect(session.getWorkflowEligibility().goalContinuation).toEqual({ eligible: true });

		expect(await session.requestGoalContinuation()).toBe(true);
		expect(session.getWorkflowEligibility().goalContinuation).toEqual({
			eligible: false,
			reason: "already-requested",
		});
		expect(await session.requestGoalContinuation()).toBe(false);
		expect(send).toHaveBeenCalledTimes(1);
		expect(send.mock.calls[0]?.[0]).toMatchObject({
			customType: "goal-continuation",
			display: false,
			attribution: "agent",
		});
		expect(send.mock.calls[0]?.[1]).toEqual({ deliverAs: "followUp" });
	});
});
