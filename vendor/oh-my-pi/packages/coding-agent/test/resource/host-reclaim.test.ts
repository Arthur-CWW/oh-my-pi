import { expect, it } from "bun:test";
import { randomUUID } from "node:crypto";
import * as path from "node:path";
import { Agent } from "@oh-my-pi/pi-agent-core";
import { getBundledModel } from "@oh-my-pi/pi-catalog/models";
import { ModelRegistry } from "@oh-my-pi/pi-coding-agent/config/model-registry";
import { Settings } from "@oh-my-pi/pi-coding-agent/config/settings";
import { executeBash, shutdownShellSessionsOwnedBy } from "@oh-my-pi/pi-coding-agent/exec/bash-executor";
import { IrcExternalBus } from "@oh-my-pi/pi-coding-agent/irc/bus-external";
import { AgentLifecycleManager } from "@oh-my-pi/pi-coding-agent/registry/agent-lifecycle";
import { AgentRegistry } from "@oh-my-pi/pi-coding-agent/registry/agent-registry";
import { reclaimHostMemory } from "@oh-my-pi/pi-coding-agent/resource/host-reclaim";
import { AgentSession } from "@oh-my-pi/pi-coding-agent/session/agent-session";
import { AuthStorage } from "@oh-my-pi/pi-coding-agent/session/auth-storage";
import { SessionManager } from "@oh-my-pi/pi-coding-agent/session/session-manager";
import { appendChildLifecycleRecord } from "@oh-my-pi/pi-coding-agent/task/child-lifecycle";
import type { ToolSession } from "@oh-my-pi/pi-coding-agent/tools";
import { BrowserTool } from "@oh-my-pi/pi-coding-agent/tools/browser";
import { getTab, releaseTab } from "@oh-my-pi/pi-coding-agent/tools/browser/tab-supervisor";
import { TempDir } from "@oh-my-pi/pi-utils";

const model = getBundledModel("anthropic", "claude-sonnet-4-5");
if (!model) throw new Error("Expected built-in anthropic model to exist");

function createSession(
	manager: SessionManager,
	settings: Settings,
	modelRegistry: ModelRegistry,
	agentId: string,
	externalIrcBus: IrcExternalBus,
): AgentSession {
	const agent = new Agent({
		initialState: {
			model,
			systemPrompt: ["Host reclaim behavior test"],
			tools: [],
			messages: [],
		},
	});
	return new AgentSession({
		agent,
		sessionManager: manager,
		settings,
		modelRegistry,
		agentId,
		agentKind: "sub",
		externalIrcBus,
	});
}

function createBrowserTool(
	session: AgentSession,
	manager: SessionManager,
	settings: Settings,
	cwd: string,
): BrowserTool {
	const toolSession: ToolSession = {
		cwd,
		hasUI: false,
		settings,
		getSessionFile: () => manager.getSessionFile() ?? null,
		getSessionSpawns: () => null,
		getSessionId: () => manager.getSessionId(),
		getAgentId: () => session.getAgentId() ?? null,
	};
	return new BrowserTool(toolSession);
}

it("reclaims only idle and parked session resources by pressure tier", async () => {
	using root = TempDir.createSync("@pi-host-reclaim-");
	const previousEnvironment = {
		HOME: process.env.HOME,
		OMP_CONFIG_ROOT: process.env.OMP_CONFIG_ROOT,
		OMP_SESSION_CONTROL_DB: process.env.OMP_SESSION_CONTROL_DB,
	};
	process.env.HOME = root.path();
	process.env.OMP_CONFIG_ROOT = path.join(root.path(), "config");
	process.env.OMP_SESSION_CONTROL_DB = path.join(root.path(), "session-control.sqlite");
	const externalIrcBus = new IrcExternalBus(path.join(root.path(), "irc-bus.sqlite"));
	const authStorage = await AuthStorage.create(path.join(root.path(), "auth.sqlite"));
	authStorage.setRuntimeApiKey("anthropic", "test-key");
	const modelRegistry = new ModelRegistry(authStorage);
	const settings = Settings.isolated({
		"browser.cmux": false,
		"browser.headless": true,
		"compaction.enabled": false,
	});
	AgentLifecycleManager.resetGlobalForTests();
	AgentRegistry.resetGlobalForTests();
	const registry = AgentRegistry.global();
	const lifecycle = AgentLifecycleManager.global();
	const activeManager = SessionManager.create(root.path(), path.join(root.path(), "active-sessions"));
	const idleManager = SessionManager.create(root.path(), path.join(root.path(), "idle-sessions"));
	const busyManager = SessionManager.create(root.path(), path.join(root.path(), "busy-sessions"));
	const parkedManager = SessionManager.create(root.path(), path.join(root.path(), "parked-sessions"));
	const activeId = `Active-${randomUUID()}`;
	const idleId = `Idle-${randomUUID()}`;
	const busyId = `Busy-${randomUUID()}`;
	const parkedId = `Parked-${randomUUID()}`;
	const active = createSession(activeManager, settings, modelRegistry, activeId, externalIrcBus);
	const idle = createSession(idleManager, settings, modelRegistry, idleId, externalIrcBus);
	const busy = createSession(busyManager, settings, modelRegistry, busyId, externalIrcBus);
	const parked = createSession(parkedManager, settings, modelRegistry, parkedId, externalIrcBus);
	const activeTool = createBrowserTool(active, activeManager, settings, root.path());
	const idleTool = createBrowserTool(idle, idleManager, settings, root.path());
	const activeTabName = `active-${randomUUID()}`;
	const idleTabName = `idle-${randomUUID()}`;

	try {
		registry.register({ id: activeId, displayName: "active", kind: "sub", session: active, status: "running" });
		registry.register({ id: idleId, displayName: "idle", kind: "sub", session: idle, status: "idle" });
		registry.register({ id: busyId, displayName: "busy", kind: "sub", session: busy, status: "running" });
		lifecycle.adopt(busyId, { idleTtlMs: 0 });

		await parkedManager.ensureOnDisk();
		const parkedSessionFile = parkedManager.getSessionFile();
		if (!parkedSessionFile) throw new Error("Expected parked test session file");
		appendChildLifecycleRecord(parkedManager, {
			version: 1,
			agentId: parkedId,
			childSessionFile: parkedSessionFile,
			parentSessionFile: path.join(root.path(), "parent.jsonl"),
			state: "idle",
			updatedAt: new Date().toISOString(),
		});
		registry.register({
			id: parkedId,
			displayName: "parked",
			kind: "sub",
			session: parked,
			sessionFile: parkedSessionFile,
			status: "idle",
		});
		lifecycle.adopt(parkedId, { idleTtlMs: 0 });
		await lifecycle.park(parkedId);
		expect(registry.get(parkedId)).toEqual(expect.objectContaining({ status: "parked", session: null }));

		await activeTool.execute("active-open", { action: "open", name: activeTabName, url: "about:blank", timeout: 15 });
		await idleTool.execute("idle-open", { action: "open", name: idleTabName, url: "about:blank", timeout: 15 });
		await executeBash("export HOST_RECLAIM_MARKER=active", { sessionKey: activeManager.getSessionId() });
		await executeBash("export HOST_RECLAIM_MARKER=idle", { sessionKey: idleManager.getSessionId() });

		const soft = await reclaimHostMemory("soft");
		expect(soft.errors).toEqual([]);
		expect(registry.get(busyId)).toEqual(expect.objectContaining({ status: "running", session: busy }));
		expect(getTab(activeTabName)).toBeDefined();
		expect(getTab(idleTabName)).toBeDefined();

		const hard = await reclaimHostMemory("hard");
		const hardCounts = Object.fromEntries(hard.receipts.map(receipt => [receipt.action, receipt.count]));
		expect(hard.errors).toEqual([]);
		expect(hardCounts["release-idle-tabs"]).toBe(1);
		expect(hardCounts["shutdown-idle-shells"]).toBe(1);
		expect(hardCounts["release-parked-sessions"]).toBe(1);
		expect(getTab(idleTabName)).toBeUndefined();
		expect(registry.get(parkedId)).toBeUndefined();
		expect(registry.get(busyId)).toEqual(expect.objectContaining({ status: "running", session: busy }));
		expect(getTab(activeTabName)).toBeDefined();
		expect(registry.get(activeId)).toEqual(expect.objectContaining({ status: "running", session: active }));

		const repeated = await reclaimHostMemory("hard");
		const repeatedCounts = Object.fromEntries(repeated.receipts.map(receipt => [receipt.action, receipt.count]));
		expect(repeated.errors).toEqual([]);
		expect(repeatedCounts["release-idle-tabs"]).toBe(0);
		expect(repeatedCounts["shutdown-idle-shells"]).toBe(0);
		expect(repeatedCounts["shutdown-idle-lsp"]).toBe(0);
		expect(repeatedCounts["clear-lsp-init-cache"]).toBe(0);
		expect(repeatedCounts["park-idle-children"]).toBe(0);
		expect(repeatedCounts["release-parked-sessions"]).toBe(0);

		const activeShell = await executeBash('printf "%s" "$HOST_RECLAIM_MARKER"', {
			sessionKey: activeManager.getSessionId(),
		});
		expect(activeShell.output).toBe("active");
		await expect(
			activeTool.execute("active-run", { action: "run", name: activeTabName, code: "return 42;", timeout: 15 }),
		).resolves.toBeDefined();
	} finally {
		await releaseTab(idleTabName).catch(() => undefined);
		await releaseTab(activeTabName).catch(() => undefined);
		await shutdownShellSessionsOwnedBy(new Set([activeManager.getSessionId(), idleManager.getSessionId()])).catch(
			() => undefined,
		);
		await lifecycle.dispose().catch(() => undefined);
		await Promise.allSettled([
			active.dispose({ scope: "child" }),
			idle.dispose({ scope: "child" }),
			busy.dispose({ scope: "child" }),
		]);
		AgentLifecycleManager.resetGlobalForTests();
		AgentRegistry.resetGlobalForTests();
		externalIrcBus.close();
		authStorage.close();
		if (previousEnvironment.HOME === undefined) delete process.env.HOME;
		else process.env.HOME = previousEnvironment.HOME;
		if (previousEnvironment.OMP_CONFIG_ROOT === undefined) delete process.env.OMP_CONFIG_ROOT;
		else process.env.OMP_CONFIG_ROOT = previousEnvironment.OMP_CONFIG_ROOT;
		if (previousEnvironment.OMP_SESSION_CONTROL_DB === undefined) delete process.env.OMP_SESSION_CONTROL_DB;
		else process.env.OMP_SESSION_CONTROL_DB = previousEnvironment.OMP_SESSION_CONTROL_DB;
	}
}, 90_000);
