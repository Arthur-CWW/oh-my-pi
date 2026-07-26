import { randomUUID } from "node:crypto";
import * as path from "node:path";
import { Agent } from "@oh-my-pi/pi-agent-core";
import { getBundledModel } from "@oh-my-pi/pi-catalog/models";
import { ModelRegistry } from "@oh-my-pi/pi-coding-agent/config/model-registry";
import { Settings } from "@oh-my-pi/pi-coding-agent/config/settings";
import { AgentSession } from "@oh-my-pi/pi-coding-agent/session/agent-session";
import { AuthStorage } from "@oh-my-pi/pi-coding-agent/session/auth-storage";
import { SessionManager } from "@oh-my-pi/pi-coding-agent/session/session-manager";
import { BrowserTool } from "@oh-my-pi/pi-coding-agent/tools/browser";
import { listOwnedBrowserTabLeases } from "@oh-my-pi/pi-coding-agent/tools/browser/process-ownership";
import {
	getTab,
	releaseTab,
	releaseTabsOwnedBy,
} from "@oh-my-pi/pi-coding-agent/tools/browser/tab-supervisor";
import type { ToolSession } from "@oh-my-pi/pi-coding-agent/tools";
import { TempDir } from "@oh-my-pi/pi-utils";
import { afterAll, beforeAll, describe, expect, it } from "bun:test";

const model = getBundledModel("anthropic", "claude-sonnet-4-5");
if (!model) throw new Error("Expected built-in anthropic model to exist");

function createSession(
	manager: SessionManager,
	settings: Settings,
	modelRegistry: ModelRegistry,
	agentId: string,
): AgentSession {
	const agent = new Agent({
		initialState: {
			model,
			systemPrompt: ["Browser ownership test"],
			tools: [],
			messages: [],
		},
	});
	return new AgentSession({ agent, sessionManager: manager, settings, modelRegistry, agentId, agentKind: "sub" });
}

function createBrowserTool(session: AgentSession, manager: SessionManager, settings: Settings, cwd: string): BrowserTool {
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

async function waitForPendingRun(name: string): Promise<void> {
	for (let attempt = 0; attempt < 200; attempt++) {
		if ((getTab(name)?.pending.size ?? 0) > 0) return;
		await Bun.sleep(10);
	}
	throw new Error(`Tab ${JSON.stringify(name)} never registered its pending run`);
}

describe("child browser tab ownership", () => {
	// Spawn-guide isolation: browser process-ownership state resolves under
	// os.homedir(); never let tests touch the real ~/.omp/browser-sessions.
	const isolatedHome = TempDir.createSync("@pi-browser-child-home-");
	const originalHome = process.env.HOME;
	beforeAll(() => {
		process.env.HOME = isolatedHome.path();
	});
	afterAll(async () => {
		process.env.HOME = originalHome;
		await isolatedHome.remove().catch(() => undefined);
	});
	for (const disposalPath of ["terminal", "abort"] as const) {
		it(
			`releases only the child's tab on ${disposalPath} disposal`,
			async () => {
				const tempDir = TempDir.createSync(`@pi-browser-child-${disposalPath}-`);
				const authStorage = await AuthStorage.create(path.join(tempDir.path(), "auth.db"));
				authStorage.setRuntimeApiKey("anthropic", "test-key");
				const modelRegistry = new ModelRegistry(authStorage);
				const settings = Settings.isolated({
					"browser.cmux": false,
					"browser.headless": true,
					"compaction.enabled": false,
				});
				const parentManager = SessionManager.create(tempDir.path(), path.join(tempDir.path(), "parent-sessions"));
				const childManager = SessionManager.create(tempDir.path(), path.join(tempDir.path(), "child-sessions"));
				const parent = createSession(parentManager, settings, modelRegistry, `Parent-${randomUUID()}`);
				const child = createSession(childManager, settings, modelRegistry, `Child-${randomUUID()}`);
				const parentTool = createBrowserTool(parent, parentManager, settings, tempDir.path());
				const childTool = createBrowserTool(child, childManager, settings, tempDir.path());
				const parentName = `parent-${randomUUID()}`;
				const childName = `child-${randomUUID()}`;
				let childDisposed = false;

				try {
					await parentTool.execute("parent-open", { action: "open", name: parentName, url: "about:blank", timeout: 15 });
					await childTool.execute("child-open", { action: "open", name: childName, url: "about:blank", timeout: 15 });

					const parentTab = getTab(parentName);
					const childTab = getTab(childName);
					expect(parentTab).toBeDefined();
					expect(childTab).toBeDefined();
					expect(parentTab?.ownerSessionId).toBe(parentManager.getSessionId());
					expect(childTab?.ownerSessionId).toBe(childManager.getSessionId());
					expect(childTab?.browser).toBe(parentTab?.browser);
					expect(parentTab?.browser.refCount).toBe(2);

					const pendingRun = childTool.execute("child-run", {
						action: "run",
						name: childName,
						code: "await Promise.withResolvers().promise;",
						timeout: 30,
					});
					const pendingOutcome = pendingRun.then(
						() => undefined,
						error => error,
					);
					await waitForPendingRun(childName);

					if (disposalPath === "abort") child.agent.abort();
					await child.dispose({ scope: "child" });
					childDisposed = true;

					const outcome = await pendingOutcome;
					expect(outcome).toBeInstanceOf(Error);
					expect((outcome as Error).message).toContain("was closed");
					expect(getTab(childName)).toBeUndefined();
					expect(await releaseTabsOwnedBy(childManager.getSessionId())).toBe(0);

					const survivingParentTab = getTab(parentName);
					expect(survivingParentTab).toBe(parentTab);
					expect(survivingParentTab?.state).toBe("alive");
					expect(survivingParentTab?.browser.refCount).toBe(1);
					if (survivingParentTab && "browser" in survivingParentTab.browser) {
						expect(survivingParentTab.browser.browser.connected).toBeTrue();
					}
					await expect(
						parentTool.execute("parent-run", { action: "run", name: parentName, code: "return 42;", timeout: 15 }),
					).resolves.toBeDefined();

					const leases = await listOwnedBrowserTabLeases();
					expect(leases.some(lease => lease.sessionId === childManager.getSessionId())).toBeFalse();
					expect(leases.some(lease => lease.sessionId === parentManager.getSessionId())).toBeTrue();

					const concurrentCounts = await Promise.all([
						releaseTabsOwnedBy(parentManager.getSessionId()),
						releaseTabsOwnedBy(parentManager.getSessionId()),
					]);
					expect(concurrentCounts).toEqual([1, 1]);
					expect(getTab(parentName)).toBeUndefined();
					expect(parentTab?.browser.refCount).toBe(0);
				} finally {
					await releaseTab(childName).catch(() => undefined);
					await releaseTab(parentName).catch(() => undefined);
					if (!childDisposed) await child.dispose({ scope: "child" }).catch(() => undefined);
					await parent.dispose({ scope: "child" }).catch(() => undefined);
					authStorage.close();
					await tempDir.remove().catch(() => undefined);
				}
			},
			60_000,
		);
	}
});
