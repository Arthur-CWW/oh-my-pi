import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import * as path from "node:path";
import { type AgentToolResult, validateAgentToolArguments } from "@oh-my-pi/pi-agent-core";
import { getBundledModel, isGeneratedProvider } from "@oh-my-pi/pi-catalog/models";
import { ModelRegistry } from "@oh-my-pi/pi-coding-agent/config/model-registry";
import { Settings } from "@oh-my-pi/pi-coding-agent/config/settings";
import { loadExtensions } from "@oh-my-pi/pi-coding-agent/extensibility/extensions/loader";
import { MCPManager } from "@oh-my-pi/pi-coding-agent/mcp/manager";
import { createMCPToolName } from "@oh-my-pi/pi-coding-agent/mcp/tool-bridge";
import type { MCPStdioServerConfig } from "@oh-my-pi/pi-coding-agent/mcp/types";
import { initializeExtensions } from "@oh-my-pi/pi-coding-agent/modes/runtime-init";
import { type CreateAgentSessionOptions, createAgentSession } from "@oh-my-pi/pi-coding-agent/sdk";
import type { AgentSession } from "@oh-my-pi/pi-coding-agent/session/agent-session";
import type { AuthStorage } from "@oh-my-pi/pi-coding-agent/session/auth-storage";
import { SessionManager } from "@oh-my-pi/pi-coding-agent/session/session-manager";
import { createMCPProxyTools } from "@oh-my-pi/pi-coding-agent/task/executor";
import { cfgAsyncEnabled, cfgToolsXdev } from "@oh-my-pi/pi-coding-agent/tools/settings";
import type { XdevDispatch } from "@oh-my-pi/pi-coding-agent/tools/xdev";
import { EventBus } from "@oh-my-pi/pi-coding-agent/utils/event-bus";
import { TempDir } from "@oh-my-pi/pi-utils";
import {
	ADDED_TOOL,
	ANNOTATION_TOOL,
	LIST_FAILURE,
	REMOVED_TOOL,
	RETAINED_TOOL,
	type RefreshFixtureRequest,
	type RefreshFixtureState,
	STABLE_TOOL,
} from "./fixtures/scoped-refresh-mcp";
import { createInMemoryAuthStorage } from "./helpers/agent-session-setup";

const FIXTURE_PATH = path.join(import.meta.dir, "fixtures", "scoped-refresh-mcp.ts");
const SERVER = "refresh-fixture";
const RETAINED_NAME = createMCPToolName(SERVER, RETAINED_TOOL);
const ANNOTATION_NAME = createMCPToolName(SERVER, ANNOTATION_TOOL);
const STABLE_NAME = createMCPToolName(SERVER, STABLE_TOOL);
const REMOVED_NAME = createMCPToolName(SERVER, REMOVED_TOOL);
const ADDED_NAME = createMCPToolName(SERVER, ADDED_TOOL);
const NATIVE_NAME = "native_refresh_probe";

interface RefreshDetails {
	server: string;
	status: "refreshed";
	added: string[];
	changed: string[];
	removed: string[];
	visibility: "available_for_subsequent_tool_calls";
}

let tempDir: TempDir;
let authStorage: AuthStorage;
let modelRegistry: ModelRegistry;
let manager: MCPManager;
let statePath: string;
let requestsPath: string;
let callsGate: string;
let listGate: string;
let callSequence = 0;
const sessions: AgentSession[] = [];

beforeEach(async () => {
	tempDir = TempDir.createSync("omp-mcp-refresh-tool-");
	statePath = tempDir.join("state.json");
	requestsPath = tempDir.join("requests.jsonl");
	callsGate = tempDir.join("release-calls");
	listGate = tempDir.join("release-list");
	await Bun.write(requestsPath, "");
	await setFixtureState({ revision: 1 });
	authStorage = createInMemoryAuthStorage();
	modelRegistry = new ModelRegistry(authStorage, tempDir.join("models.yml"));
	// A supplied shared manager and empty loader prevent ambient MCP discovery.
	manager = new MCPManager(tempDir.path(), null, async () => ({ configs: {}, sources: {}, exaApiKeys: [] }));
});

afterEach(async () => {
	for (const session of sessions.splice(0)) await session.dispose();
	await manager.disconnectAll();
	authStorage.close();
	tempDir.removeSync();
});

function fixtureConfig(): MCPStdioServerConfig {
	return {
		type: "stdio",
		command: process.execPath,
		args: [FIXTURE_PATH],
		env: {
			REFRESH_FIXTURE_STATE: statePath,
			REFRESH_FIXTURE_REQUESTS: requestsPath,
			REFRESH_FIXTURE_CALLS_GATE: callsGate,
			REFRESH_FIXTURE_LIST_GATE: listGate,
		},
	};
}

async function setFixtureState(state: RefreshFixtureState): Promise<void> {
	await Bun.write(statePath, JSON.stringify(state));
}

async function fixtureRequests(): Promise<RefreshFixtureRequest[]> {
	const text = await Bun.file(requestsPath).text();
	return text
		.split("\n")
		.filter(line => line.length > 0)
		.map(line => JSON.parse(line) as RefreshFixtureRequest);
}

async function waitForRequests(
	predicate: (requests: RefreshFixtureRequest[]) => boolean,
	label: string,
): Promise<RefreshFixtureRequest[]> {
	// The request log belongs to a real stdio subprocess with no in-process
	// completion event; fake timers cannot advance that peer's protocol work.
	const deadline = Date.now() + 8_000;
	while (Date.now() < deadline) {
		const requests = await fixtureRequests();
		if (predicate(requests)) return requests;
		await Bun.sleep(10);
	}
	throw new Error(`timed out waiting for ${label}`);
}

async function connectReady(): Promise<void> {
	await manager.connectServers({ [SERVER]: fixtureConfig() }, {});
	expect(await manager.waitForStartup(0)).toEqual({ connected: [SERVER], pending: [], failed: [] });
}

async function makeSession(overrides: CreateAgentSessionOptions = {}): Promise<AgentSession> {
	const settings = Settings.isolated({ "tools.approvalMode": "yolo" });
	cfgAsyncEnabled.set(settings, false);
	cfgToolsXdev.set(settings, true);
	const provider = "openai";
	if (!isGeneratedProvider(provider)) throw new Error("the bundled OpenAI catalog is unavailable");
	const model = getBundledModel(provider, "gpt-4o-mini");
	if (!model) throw new Error("the bundled gpt-4o-mini session descriptor is unavailable");
	const { session } = await createAgentSession({
		cwd: tempDir.path(),
		agentDir: tempDir.path(),
		authStorage,
		modelRegistry,
		sessionManager: SessionManager.inMemory(tempDir.path()),
		settings,
		model,
		cacheWarming: false,
		bindProcessState: false,
		disableExtensionDiscovery: true,
		preloadedCustomToolPaths: [],
		skills: [],
		rules: [],
		contextFiles: [],
		workspaceTree: {
			rootPath: tempDir.path(),
			rendered: "",
			truncated: false,
			totalLines: 0,
			agentsMdFiles: [],
		},
		promptTemplates: [],
		slashCommands: [],
		enableMCP: true,
		mcpManager: manager,
		mcpTools: createMCPProxyTools(manager),
		parentTaskPrefix: "ScopedRefresh",
		enableLsp: false,
		enableIrc: false,
		skipPythonPreflight: true,
		...overrides,
	});
	sessions.push(session);
	return session;
}

function textOf(result: AgentToolResult<unknown>): string {
	return result.content.map(part => (part.type === "text" ? part.text : "")).join("\n");
}

async function dispatch(
	session: AgentSession,
	name: string,
	args: Record<string, unknown>,
): Promise<AgentToolResult<unknown>> {
	const write = session.agent.state.tools.find(tool => tool.name === "write");
	if (!write) throw new Error("SDK session did not expose its ordinary write transport");
	return write.execute(`refresh-test-${++callSequence}`, {
		path: `xd://${name}`,
		content: JSON.stringify(args),
	} as never);
}

function expectRefreshed(
	result: AgentToolResult<unknown>,
	delta: Pick<RefreshDetails, "added" | "changed" | "removed">,
): void {
	expect(result.isError ?? false).toBe(false);
	const body = JSON.parse(textOf(result)) as RefreshDetails;
	expect({
		...body,
		added: [...body.added].sort(),
		changed: [...body.changed].sort(),
		removed: [...body.removed].sort(),
	}).toEqual({
		server: SERVER,
		status: "refreshed",
		added: [...delta.added].sort(),
		changed: [...delta.changed].sort(),
		removed: [...delta.removed].sort(),
		visibility: "available_for_subsequent_tool_calls",
	});
	const details = result.details as { xdev?: XdevDispatch } | undefined;
	expect(details?.xdev?.tool).toBe("mcp_refresh");
	expect(details?.xdev?.inner).toEqual(body);
}

function mcpNames(session: AgentSession): string[] {
	return session
		.getEnabledToolNames()
		.filter(name => name.startsWith("mcp__"))
		.sort();
}

function nativeExtensionSource(result: string): string {
	return `export default function (api) {
	api.registerTool({
		name: ${JSON.stringify(NATIVE_NAME)},
		label: "Native refresh probe",
		description: "Native implementation must stay imported during MCP refresh.",
		parameters: api.arktype({}),
		async execute() { return { content: [{ type: "text", text: ${JSON.stringify(result)} }] }; }
	});
}
`;
}

// Separately invocable by `bun test ... --test-name-pattern 'mcp_refresh real-session smoke'`.
// These calls only use the SDK tool registry; no prompt(), model loop, or CLI host is started.
describe("mcp_refresh real-session smoke", () => {
	it("replaces one live SDK catalog, reports descriptor deltas, and leaves native extensions imported", async () => {
		await connectReady();
		const extensionPath = path.resolve(tempDir.join("native-refresh-probe.ts"));
		await Bun.write(extensionPath, nativeExtensionSource("native-v1"));
		const loaded = await loadExtensions([extensionPath], tempDir.path(), new EventBus());
		expect(loaded.errors).toEqual([]);
		expect(loaded.extensions.some(extension => extension.tools.has(NATIVE_NAME))).toBe(true);
		if (!loaded.preparedExtensions?.length) {
			throw new Error(`native fixture extension failed to load: ${JSON.stringify(loaded.errors)}`);
		}
		const session = await makeSession({ preloadedPreparedExtensions: loaded.preparedExtensions });
		const identity = { id: session.sessionId, agent: session.agent, sessionManager: session.sessionManager };
		const connection = manager.getConnection(SERVER);
		const initialNames = [RETAINED_NAME, ANNOTATION_NAME, STABLE_NAME, REMOVED_NAME].sort();
		expect(mcpNames(session)).toEqual(initialNames);
		const read = session.agent.state.tools.find(tool => tool.name === "read");
		if (!read) throw new Error("SDK session did not expose its ordinary read transport");
		expect(textOf(await read.execute("discover-refresh", { path: "xd://" } as never))).toContain("mcp_refresh");
		expect(textOf(await dispatch(session, RETAINED_NAME, { value: "old" }))).toBe(`v1:${RETAINED_TOOL}:old`);
		expect(textOf(await dispatch(session, STABLE_NAME, {}))).toBe(`v1:${STABLE_TOOL}:ok`);
		expect(textOf(await dispatch(session, REMOVED_NAME, {}))).toBe(`v1:${REMOVED_TOOL}:ok`);
		expect(textOf(await dispatch(session, NATIVE_NAME, {}))).toBe("native-v1");

		await Bun.write(extensionPath, nativeExtensionSource("native-v2"));
		await setFixtureState({ revision: 2 });
		expectRefreshed(await dispatch(session, "mcp_refresh", { server: SERVER }), {
			added: [ADDED_NAME],
			changed: [RETAINED_NAME, ANNOTATION_NAME],
			removed: [REMOVED_NAME],
		});
		// No registry drain or follower is installed: awaited refresh itself must
		// make the calling shared-manager session's next dispatch see the catalog.
		expect(mcpNames(session)).toEqual([RETAINED_NAME, ANNOTATION_NAME, STABLE_NAME, ADDED_NAME].sort());
		expect(session.getToolByName(REMOVED_NAME)).toBeUndefined();
		expect(textOf(await dispatch(session, RETAINED_NAME, { value: 7 }))).toBe(`v2:${RETAINED_TOOL}:7`);
		expect(textOf(await dispatch(session, ADDED_NAME, {}))).toBe(`v2:${ADDED_TOOL}:ok`);
		expect(textOf(await dispatch(session, STABLE_NAME, {}))).toBe(`v2:${STABLE_TOOL}:ok`);
		const obsoleteArgs = await dispatch(session, RETAINED_NAME, { value: "old" });
		expect(obsoleteArgs.isError).toBe(true);
		expect(textOf(obsoleteArgs)).toMatch(/invalid args/i);
		const removed = await dispatch(session, REMOVED_NAME, {});
		expect(removed.isError).toBe(true);
		expect(textOf(removed)).toMatch(/no such tool/i);
		expect(textOf(await dispatch(session, NATIVE_NAME, {}))).toBe("native-v1");

		await setFixtureState({ revision: 3 });
		expectRefreshed(await dispatch(session, "mcp_refresh", { server: SERVER }), {
			added: [],
			changed: [],
			removed: [],
		});
		expect(textOf(await dispatch(session, STABLE_NAME, {}))).toBe(`v3:${STABLE_TOOL}:ok`);
		expect(session.sessionId).toBe(identity.id);
		expect(session.agent).toBe(identity.agent);
		expect(session.sessionManager).toBe(identity.sessionManager);
		expect(session.agent.state.messages).toEqual([]);
		expect(manager.getConnection(SERVER)).toBe(connection);
		expect(connection?.transport.connected).toBe(true);
		const requests = await fixtureRequests();
		expect(requests.filter(request => request.method === "initialize")).toHaveLength(1);
		expect(requests.filter(request => request.method === "tools/list")).toHaveLength(3);
		expect(requests.filter(request => request.method === "tools/call")).toHaveLength(7);
		expect(new Set(requests.map(request => request.pid)).size).toBe(1);
	}, 20_000);
});

describe("mcp_refresh failure and call-snapshot regressions", () => {
	it("rejects an unknown target without making a connection or sending another server request", async () => {
		await connectReady();
		const session = await makeSession();
		const connection = manager.getConnection(SERVER);
		const before = await fixtureRequests();
		const result = await dispatch(session, "mcp_refresh", { server: "not-configured" });
		expect(result.isError).toBe(true);
		expect(textOf(result)).toMatch(/unknown|not configured/i);
		expect(textOf(result)).toContain("not-configured");
		expect(manager.getConnection("not-configured")).toBeUndefined();
		expect(manager.getServerConfig("not-configured")).toBeUndefined();
		expect(manager.getAllServerNames()).toEqual([SERVER]);
		expect(manager.getConnection(SERVER)).toBe(connection);
		expect(await fixtureRequests()).toEqual(before);
	}, 20_000);

	it("surfaces tools/list failure, retains the old catalog, and computes the next successful delta from it", async () => {
		await connectReady();
		const session = await makeSession();
		const connection = manager.getConnection(SERVER);
		const oldDescriptors = structuredClone(connection?.tools);
		const oldNames = mcpNames(session);
		expect(textOf(await dispatch(session, RETAINED_NAME, { value: "before" }))).toBe(`v1:${RETAINED_TOOL}:before`);
		await setFixtureState({ revision: 2, failList: true });
		const failed = await dispatch(session, "mcp_refresh", { server: SERVER });
		expect(failed.isError).toBe(true);
		expect(textOf(failed)).toContain(LIST_FAILURE);
		expect(mcpNames(session)).toEqual(oldNames);
		expect(manager.getConnection(SERVER)).toBe(connection);
		expect(connection?.tools).toEqual(oldDescriptors);
		expect(session.getToolByName(REMOVED_NAME)).toBeDefined();
		expect(session.getToolByName(ADDED_NAME)).toBeUndefined();
		expect((await dispatch(session, ADDED_NAME, {})).isError).toBe(true);
		await setFixtureState({ revision: 1 });
		expect(textOf(await dispatch(session, RETAINED_NAME, { value: "still-old" }))).toBe(
			`v1:${RETAINED_TOOL}:still-old`,
		);
		let requests = await fixtureRequests();
		expect(requests.filter(request => request.method === "initialize")).toHaveLength(1);
		expect(requests.filter(request => request.method === "tools/list")).toHaveLength(2);
		await setFixtureState({ revision: 2 });
		expectRefreshed(await dispatch(session, "mcp_refresh", { server: SERVER }), {
			added: [ADDED_NAME],
			changed: [RETAINED_NAME, ANNOTATION_NAME],
			removed: [REMOVED_NAME],
		});
		expect(textOf(await dispatch(session, ADDED_NAME, {}))).toBe(`v2:${ADDED_TOOL}:ok`);
		requests = await fixtureRequests();
		expect(requests.filter(request => request.method === "initialize")).toHaveLength(1);
		expect(requests.filter(request => request.method === "tools/list")).toHaveLength(3);
	}, 20_000);

	it("rejects a configured but disconnected server instead of reconnecting it", async () => {
		await setFixtureState({ revision: 1, failInitialize: true });
		await manager.connectServers({ [SERVER]: fixtureConfig() }, {});
		await manager.waitForStartup(0);
		expect(manager.getServerConfig(SERVER)).toBeDefined();
		expect(manager.getConnectionStatus(SERVER)).toBe("disconnected");
		const session = await makeSession();
		const before = await fixtureRequests();
		expect(before.filter(request => request.method === "initialize")).toHaveLength(1);
		// The configured command can now succeed, but refresh must not invoke it.
		await setFixtureState({ revision: 1 });
		const result = await dispatch(session, "mcp_refresh", { server: SERVER });
		expect(result.isError).toBe(true);
		expect(textOf(result)).toMatch(/not connected|disconnected/i);
		expect(manager.getConnection(SERVER)).toBeUndefined();
		expect(await fixtureRequests()).toEqual(before);
	}, 20_000);

	it("reports unsupported MCP truthfully in an SDK session with MCP disabled", async () => {
		const session = await makeSession({ enableMCP: false });
		const result = await dispatch(session, "mcp_refresh", { server: SERVER });
		expect(result.isError).toBe(true);
		expect(textOf(result)).toMatch(/MCP/i);
		expect(textOf(result)).toMatch(/unavailable|unsupported|disabled|not available|not supported/i);
		expect(manager.getConnectedServers()).toEqual([]);
		expect(await fixtureRequests()).toEqual([]);
	});

	it("rejects a connected server without tools capability without listing tools or reconnecting", async () => {
		await setFixtureState({ revision: 1, noTools: true });
		await manager.connectServers({ [SERVER]: fixtureConfig() }, {});
		const session = await makeSession();
		const connection = manager.getConnection(SERVER);
		expect(connection).toBeDefined();
		expect(connection?.transport.connected).toBe(true);
		const before = await fixtureRequests();
		expect(connection?.capabilities.tools).toBeUndefined();
		expect(mcpNames(session)).toEqual([]);
		expect(before.filter(request => request.method === "initialize")).toHaveLength(1);
		expect(before.filter(request => request.method === "tools/list")).toHaveLength(0);
		const result = await dispatch(session, "mcp_refresh", { server: SERVER });
		expect(result.isError).toBe(true);
		expect(textOf(result)).toMatch(/unsupported|does not support/i);
		expect(textOf(result)).toContain(SERVER);
		expect(manager.getConnection(SERVER)).toBe(connection);
		expect(connection?.transport.connected).toBe(true);
		expect(await fixtureRequests()).toEqual(before);
	}, 20_000);

	it("cancels its caller promptly while a gated manager refresh finishes independently without retrying", async () => {
		await connectReady();
		const session = await makeSession();
		const tool = session.getToolByName("mcp_refresh");
		if (!tool) throw new Error("SDK session did not register its native MCP refresh tool");
		const connection = manager.getConnection(SERVER);
		const oldDescriptors = structuredClone(connection?.tools);
		const originalRefresh = manager.refreshServerTools;
		let managerRefresh: Promise<void> | undefined;
		let managerFinished = false;
		// Observe the actual shared operation without joining it a second time:
		// joining would legitimately queue the manager's trailing refresh pass.
		manager.refreshServerTools = function (server) {
			const operation = originalRefresh.call(this, server);
			managerRefresh = operation;
			void operation.then(
				() => {
					managerFinished = true;
				},
				() => {
					managerFinished = true;
				},
			);
			return operation;
		};
		const controller = new AbortController();
		try {
			await setFixtureState({ revision: 2, deferList: true });
			// Execute the native operation itself: write's independent cancellation
			// race would otherwise hide a refresh caller that keeps waiting.
			const cancelled = tool.execute("cancel-gated-refresh", { server: SERVER }, controller.signal).then(
				result => ({ status: "fulfilled" as const, result }),
				error => ({ status: "rejected" as const, error }),
			);
			await waitForRequests(
				requests => requests.filter(request => request.method === "tools/list").length === 2,
				"the cancellable gated tools/list request",
			);
			expect(managerRefresh).toBeDefined();
			expect(managerFinished).toBe(false);
			expect(connection?.tools).toEqual(oldDescriptors);
			controller.abort();
			// A watchdog, not a synchronization sleep: real subprocess I/O cannot
			// be driven by fake timers, and a broken caller must fail before release.
			const outcome = await Promise.race([cancelled, Bun.sleep(1_000).then(() => ({ status: "timeout" as const }))]);
			expect(outcome.status).toBe("rejected");
			if (outcome.status !== "rejected") throw new Error(`refresh cancellation ${outcome.status}`);
			expect(outcome.error).toBeInstanceOf(Error);
			expect(outcome.error.message).toMatch(/aborted/i);
			expect(managerFinished).toBe(false);
			expect(manager.getConnection(SERVER)).toBe(connection);
			expect(connection?.transport.connected).toBe(true);
			expect(connection?.tools).toEqual(oldDescriptors);
			expect((await fixtureRequests()).filter(request => request.method === "tools/list")).toHaveLength(2);
		} finally {
			controller.abort();
			await Bun.write(listGate, "release");
			manager.refreshServerTools = originalRefresh;
			if (managerRefresh) await managerRefresh;
		}
		expect(managerFinished).toBe(true);
		expect(manager.getConnection(SERVER)).toBe(connection);
		expect(connection?.tools?.map(tool => tool.name).sort()).toEqual(
			[RETAINED_TOOL, ANNOTATION_TOOL, STABLE_TOOL, ADDED_TOOL].sort(),
		);
		expect(
			manager
				.getTools()
				.map(tool => tool.name)
				.sort(),
		).toEqual([RETAINED_NAME, ANNOTATION_NAME, STABLE_NAME, ADDED_NAME].sort());
		const requests = await fixtureRequests();
		expect(requests.filter(request => request.method === "tools/list")).toHaveLength(2);
		expect(requests.filter(request => request.method === "initialize")).toHaveLength(1);
		expect(new Set(requests.map(request => request.pid)).size).toBe(1);
	}, 20_000);

	it("joins an already pending manager refresh using stable descriptors and reports the full catalog delta", async () => {
		await connectReady();
		const session = await makeSession();
		const connection = manager.getConnection(SERVER);
		const oldDescriptors = structuredClone(connection?.tools);
		const oldNames = mcpNames(session);
		const originalRefresh = manager.refreshServerTools;
		const overlapEntered = Promise.withResolvers<void>();
		let managerFinished = false;
		let callerFinished = false;
		let managerRefresh: Promise<void> | undefined;
		let refresh: Promise<AgentToolResult<unknown>> | undefined;
		try {
			await setFixtureState({ revision: 2, deferList: true });
			const existingRefresh = manager.refreshServerTools(SERVER);
			managerRefresh = existingRefresh;
			void managerRefresh.then(
				() => {
					managerFinished = true;
				},
				() => {
					managerFinished = true;
				},
			);
			manager.refreshServerTools = function (server) {
				const operation = originalRefresh.call(this, server);
				expect(operation).toBe(existingRefresh);
				overlapEntered.resolve();
				return operation;
			};
			await waitForRequests(
				requests => requests.filter(request => request.method === "tools/list").length === 2,
				"the preexisting manager tools/list request",
			);
			expect(connection?.tools).toEqual(oldDescriptors);
			expect(mcpNames(session)).toEqual(oldNames);
			refresh = dispatch(session, "mcp_refresh", { server: SERVER }).finally(() => {
				callerFinished = true;
			});
			// Await entry into the real shared manager operation, not a guessed
			// delay. Premature tool settlement also resolves the race and fails.
			const joined = await Promise.race([
				overlapEntered.promise.then(() => "joined" as const),
				refresh.then(() => "settled" as const),
			]);
			expect(joined).toBe("joined");
			expect(managerFinished).toBe(false);
			expect(callerFinished).toBe(false);
			expect(connection?.tools).toEqual(oldDescriptors);
			expect((await fixtureRequests()).filter(request => request.method === "tools/list")).toHaveLength(2);
		} finally {
			await Bun.write(listGate, "release");
			manager.refreshServerTools = originalRefresh;
			if (managerRefresh) await managerRefresh;
		}
		if (!refresh) throw new Error("the overlapping refresh caller was not started");
		expectRefreshed(await refresh, {
			added: [ADDED_NAME],
			changed: [RETAINED_NAME, ANNOTATION_NAME],
			removed: [REMOVED_NAME],
		});
		expect(managerFinished).toBe(true);
		expect(callerFinished).toBe(true);
		expect(manager.getConnection(SERVER)).toBe(connection);
		expect(mcpNames(session)).toEqual([RETAINED_NAME, ANNOTATION_NAME, STABLE_NAME, ADDED_NAME].sort());
		expect(textOf(await dispatch(session, RETAINED_NAME, { value: 7 }))).toBe(`v2:${RETAINED_TOOL}:7`);
		expect(textOf(await dispatch(session, ADDED_NAME, {}))).toBe(`v2:${ADDED_TOOL}:ok`);
		const requests = await fixtureRequests();
		// One existing in-flight request plus the manager's coalesced trailing
		// pass, not a second independent refresh or connection.
		expect(requests.filter(request => request.method === "tools/list")).toHaveLength(3);
		expect(requests.filter(request => request.method === "initialize")).toHaveLength(1);
		expect(new Set(requests.map(request => request.pid)).size).toBe(1);
	}, 20_000);

	it("does not claim refresh success when the original connection disappears during tools/list", async () => {
		await connectReady();
		const session = await makeSession();
		await setFixtureState({ revision: 2, deferList: true });
		const refresh = dispatch(session, "mcp_refresh", { server: SERVER });
		await waitForRequests(
			requests => requests.filter(request => request.method === "tools/list").length === 2,
			"the deferred refresh tools/list request",
		);
		await manager.disconnectServer(SERVER);
		const result = await refresh;
		expect(result.isError).toBe(true);
		expect(manager.getConnection(SERVER)).toBeUndefined();
		expect((await fixtureRequests()).filter(request => request.method === "initialize")).toHaveLength(1);
	}, 20_000);

	it("finishes a captured active invocation while later calls see the revised catalog", async () => {
		await connectReady();
		const session = await makeSession();
		await setFixtureState({ revision: 1, deferCalls: true });
		let finished = false;
		const active = dispatch(session, REMOVED_NAME, {}).finally(() => {
			finished = true;
		});
		try {
			await waitForRequests(
				requests => requests.some(request => request.method === "tools/call" && request.name === REMOVED_TOOL),
				"the captured old invocation",
			);
			await setFixtureState({ revision: 2 });
			expectRefreshed(await dispatch(session, "mcp_refresh", { server: SERVER }), {
				added: [ADDED_NAME],
				changed: [RETAINED_NAME, ANNOTATION_NAME],
				removed: [REMOVED_NAME],
			});
			expect(finished).toBe(false);
			expect((await dispatch(session, REMOVED_NAME, {})).isError).toBe(true);
			expect(textOf(await dispatch(session, ADDED_NAME, {}))).toBe(`v2:${ADDED_TOOL}:ok`);
		} finally {
			await Bun.write(callsGate, "release");
		}
		const result = await active;
		expect(result.isError ?? false).toBe(false);
		expect(textOf(result)).toBe(`v1:${REMOVED_TOOL}:ok`);
		const requests = await fixtureRequests();
		expect(requests.filter(request => request.method === "tools/call" && request.name === REMOVED_TOOL)).toHaveLength(
			1,
		);
		expect(requests.filter(request => request.method === "tools/list")).toHaveLength(2);
		expect(requests.filter(request => request.method === "initialize")).toHaveLength(1);
	}, 20_000);

	it("refreshes while approval is pending without substituting the captured wrapper or its approved arguments", async () => {
		await connectReady();
		const settings = Settings.isolated({
			"tools.approvalMode": "yolo",
			"tools.approval": { [RETAINED_NAME]: "prompt" },
		});
		cfgAsyncEnabled.set(settings, false);
		cfgToolsXdev.set(settings, true);
		const session = await makeSession({ settings });
		const runner = session.extensionRunner;
		if (!runner) throw new Error("SDK session did not expose its extension approval wrapper");
		const approvalEntered = Promise.withResolvers<void>();
		const approval = Promise.withResolvers<void>();
		const prompts: string[] = [];
		await initializeExtensions(session, {
			reportSendError: (_action, error) => {
				throw error;
			},
			reportRuntimeError: error => {
				throw new Error(error.error);
			},
			uiContext: {
				...runner.getUIContext(),
				async select(title) {
					prompts.push(title);
					if (prompts.length === 1) {
						approvalEntered.resolve();
						await approval.promise;
					}
					return "Approve";
				},
			},
		});
		const captured = session.getToolByName(RETAINED_NAME);
		if (!captured) throw new Error("the original MCP wrapper was not registered");
		// Mirror ordinary agent-call preparation: validate once and retain the tool
		// reference before its existing approval gate suspends execute().
		const prepared = validateAgentToolArguments(captured, {
			type: "toolCall",
			id: "pending-old-wrapper",
			name: RETAINED_NAME,
			arguments: { value: "approved-old" },
		});
		const pending = captured.execute("pending-old-wrapper", prepared);
		try {
			await approvalEntered.promise;
			expect(prompts).toHaveLength(1);
			expect(prompts[0]).toContain(RETAINED_NAME);
			expect(prepared).toEqual({ value: "approved-old" });
			expect((await fixtureRequests()).filter(request => request.method === "tools/call")).toHaveLength(0);
			await setFixtureState({ revision: 2 });
			expectRefreshed(await dispatch(session, "mcp_refresh", { server: SERVER }), {
				added: [ADDED_NAME],
				changed: [RETAINED_NAME, ANNOTATION_NAME],
				removed: [REMOVED_NAME],
			});
			expect(session.getToolByName(RETAINED_NAME)).not.toBe(captured);
			expect((await dispatch(session, RETAINED_NAME, { value: "approved-old" })).isError).toBe(true);
			expect((await fixtureRequests()).filter(request => request.method === "tools/call")).toHaveLength(0);
		} finally {
			approval.resolve();
		}
		const result = await pending;
		expect(result.isError ?? false).toBe(false);
		expect(textOf(result)).toBe(`v2:${RETAINED_TOOL}:approved-old`);
		const requests = await fixtureRequests();
		expect(requests.filter(request => request.method === "tools/call")).toEqual([
			expect.objectContaining({ name: RETAINED_TOOL, arguments: { value: "approved-old" }, revision: 2 }),
		]);
		expect(requests.filter(request => request.method === "tools/list")).toHaveLength(2);
		expect(requests.filter(request => request.method === "initialize")).toHaveLength(1);
		const approvalsBefore = prompts.filter(prompt => prompt.includes(RETAINED_NAME)).length;
		expect(textOf(await dispatch(session, RETAINED_NAME, { value: 7 }))).toBe(`v2:${RETAINED_TOOL}:7`);
		const approvalsAfter = prompts.filter(prompt => prompt.includes(RETAINED_NAME)).length;
		expect(approvalsAfter).toBeGreaterThan(approvalsBefore);
		expect((await fixtureRequests()).filter(request => request.method === "tools/call")).toEqual([
			expect.objectContaining({ name: RETAINED_TOOL, arguments: { value: "approved-old" }, revision: 2 }),
			expect.objectContaining({ name: RETAINED_TOOL, arguments: { value: 7 }, revision: 2 }),
		]);
	}, 20_000);
});
