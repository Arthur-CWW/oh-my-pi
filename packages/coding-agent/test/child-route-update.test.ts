import { afterAll, afterEach, beforeAll, describe, expect, it } from "bun:test";
import * as fs from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";
import { Agent, type AgentTool } from "@oh-my-pi/pi-agent-core";
import type { AssistantMessage, Model, ToolCall } from "@oh-my-pi/pi-ai";
import { AssistantMessageEventStream } from "@oh-my-pi/pi-ai/utils/event-stream";
import { getSupportedEfforts } from "@oh-my-pi/pi-catalog/model-thinking";
import { getBundledModel } from "@oh-my-pi/pi-catalog/models";
import { z } from "zod/v4";
import { ModelRegistry } from "../src/config/model-registry";
import { resolveModelOverride } from "../src/config/model-resolver";
import { Settings } from "../src/config/settings";
import { AgentLifecycleManager } from "../src/registry/agent-lifecycle";
import { AgentRegistry } from "../src/registry/agent-registry";
import { AgentSession } from "../src/session/agent-session";
import { AuthStorage } from "../src/session/auth-storage";
import { SessionOwnershipLostError } from "../src/session/durable-input-queue";
import type { FileEntry } from "../src/session/session-entries";
import { SessionManager } from "../src/session/session-manager";
import { acquireSessionOwnership, type SessionOwnershipHandle } from "../src/session/session-ownership";
import {
	admitChildRouteUpdate,
	appendChildRouteUpdateRecord,
	CHILD_ROUTE_UPDATE_CUSTOM_TYPE,
	type ChildRouteUpdateNotification,
	type ChildRouteUpdateRecord,
	type ChildRouteUpdateRequest,
	childRouteUpdateProjection,
	childRouteUpdateStatus,
	claimChildRouteUpdate,
	createPendingChildRouteUpdate,
	decodeChildRouteUpdateEntry,
	formatChildRouteUpdate,
	formatChildRouteUpdateReport,
	isChildRouteUpdateInDoubt,
	markChildRouteUpdateApplied,
	markChildRouteUpdateApplying,
	markChildRouteUpdateNotApplied,
	markChildRouteUpdateUncertain,
	onChildRouteUpdate,
	projectChildRouteUpdates,
	readAuthoritativeChildRouteUpdateProjection,
	readChildRouteUpdateProjection,
	readChildRouteUpdateReport,
} from "../src/task/child-route-update";
import {
	applyPendingChildRouteUpdate,
	type ChildRouteLease,
	hotswapAgentModel,
	parentRouteLease,
	registerChildRouteUpdateBoundary,
	resolveRestorableSessionModel,
	retirePendingChildRouteUpdate,
} from "../src/task/hotswap";

/** Custom-message type `injectHotswapNotice` writes; a second one means the apply replayed. */
const HOTSWAP_NOTICE_TYPE = "hotswap:model";
const OWNER_EPOCH = "11111111-1111-4111-8111-111111111111";
const NEXT_OWNER_EPOCH = "22222222-2222-4222-8222-222222222222";
const AGENT_ID = "RouteChild";

const OLD_MODEL = getBundledModel("anthropic", "claude-sonnet-4-5");
const NEW_MODEL = getBundledModel("anthropic", "claude-opus-4-1");
const OLD_SELECTOR = `${OLD_MODEL.provider}/${OLD_MODEL.id}`;
const NEW_SELECTOR = `${NEW_MODEL.provider}/${NEW_MODEL.id}`;

let root: string;
let configRoot: string;

beforeAll(async () => {
	root = await fs.mkdtemp(path.join(os.tmpdir(), "child-route-update-"));
	configRoot = path.join(root, "config");
	await fs.mkdir(configRoot, { recursive: true });
	process.env.OMP_CONFIG_ROOT = configRoot;
	process.env.OMP_SESSION_CONTROL_DB = path.join(configRoot, "session-control.sqlite");
});

afterAll(async () => {
	await fs.rm(root, { recursive: true, force: true });
});

let sessionSeq = 0;

async function freshSessionDirs(): Promise<{ cwd: string; sessions: string }> {
	sessionSeq += 1;
	const cwd = path.join(root, `cwd-${sessionSeq}`);
	const sessions = path.join(root, `sessions-${sessionSeq}`);
	await fs.mkdir(cwd, { recursive: true });
	await fs.mkdir(sessions, { recursive: true });
	return { cwd, sessions };
}

/**
 * A child session exactly as the executor builds one: a real persisted
 * `SessionManager` whose journal is materialized by the production append path,
 * not by a hand-written file.
 */
async function freshSession(): Promise<SessionManager> {
	const dirs = await freshSessionDirs();
	return SessionManager.create(dirs.cwd, dirs.sessions);
}

function request(overrides: Partial<ChildRouteUpdateRequest> = {}): ChildRouteUpdateRequest {
	return {
		requestId: "req-1",
		agentId: AGENT_ID,
		selector: "anthropic/claude-opus-5",
		effort: "high",
		requestedBy: "Main",
		ownerEpoch: OWNER_EPOCH,
		...overrides,
	};
}

function customEntry(data: unknown): FileEntry {
	return { type: "custom", customType: CHILD_ROUTE_UPDATE_CUSTOM_TYPE, data } as FileEntry;
}

describe("durable child route update journal", () => {
	it("materializes the child journal on its first durable record", async () => {
		const manager = await freshSession();
		const sessionFile = manager.getSessionFile();
		if (!sessionFile) throw new Error("session manager chose no session file");
		// A child that has not produced an assistant message yet is still lazy:
		// nothing on disk until the route update forces the file into existence.
		await expect(fs.access(sessionFile)).rejects.toThrow();

		const admission = admitChildRouteUpdate(childRouteUpdateProjection(manager), request(), OWNER_EPOCH);
		if (admission.status !== "append") throw new Error("expected append");
		await appendChildRouteUpdateRecord(manager, admission.record);

		// Durable without any extra flush from the caller.
		const raw = await fs.readFile(sessionFile, "utf8");
		expect(raw).toContain(CHILD_ROUTE_UPDATE_CUSTOM_TYPE);
		expect((await readChildRouteUpdateProjection(sessionFile)).open?.requestId).toBe("req-1");
		await manager.close();
	});

	it("admits, journals, and recovers a pending request across a real reopen", async () => {
		const manager = await freshSession();
		const admission = admitChildRouteUpdate(childRouteUpdateProjection(manager), request(), OWNER_EPOCH);
		expect(admission.status).toBe("append");
		if (admission.status !== "append") throw new Error("expected append");
		await appendChildRouteUpdateRecord(manager, admission.record);
		const sessionFile = manager.getSessionFile();
		expect(sessionFile).toBeDefined();
		await manager.close();

		// Restart recovery: a brand-new reader with no process state sees the request.
		const recovered = await readChildRouteUpdateProjection(sessionFile as string);
		expect(recovered.corrupt).toBe(false);
		expect(recovered.overflow).toBe(false);
		expect(recovered.open?.requestId).toBe("req-1");
		expect(recovered.open?.selector).toBe("anthropic/claude-opus-5");
		expect(recovered.open?.effort).toBe("high");
		expect(recovered.open?.ownerEpoch).toBe(OWNER_EPOCH);

		// The claim is still available to the new owner: restart resumes, never drops.
		const claim = claimChildRouteUpdate(recovered, {});
		expect(claim.status).toBe("claim");
	});

	it("is idempotent on a replayed request id and on an identical pending value", async () => {
		const manager = await freshSession();
		const first = admitChildRouteUpdate(childRouteUpdateProjection(manager), request(), OWNER_EPOCH);
		if (first.status !== "append") throw new Error("expected append");
		await appendChildRouteUpdateRecord(manager, first.record);

		const replay = admitChildRouteUpdate(childRouteUpdateProjection(manager), request(), OWNER_EPOCH);
		expect(replay.status).toBe("duplicate");
		if (replay.status !== "duplicate") throw new Error("expected duplicate");
		expect(replay.record.requestId).toBe("req-1");

		const sameValueNewId = admitChildRouteUpdate(
			childRouteUpdateProjection(manager),
			request({ requestId: "req-2" }),
			OWNER_EPOCH,
		);
		expect(sameValueNewId.status).toBe("duplicate");

		// Exactly one record was ever appended.
		expect(childRouteUpdateProjection(manager).byRequestId.size).toBe(1);
		await manager.close();
	});

	it("rejects a conflicting pending value and a stale owner epoch with typed reasons", async () => {
		const manager = await freshSession();
		const first = admitChildRouteUpdate(childRouteUpdateProjection(manager), request(), OWNER_EPOCH);
		if (first.status !== "append") throw new Error("expected append");
		await appendChildRouteUpdateRecord(manager, first.record);

		const conflicting = admitChildRouteUpdate(
			childRouteUpdateProjection(manager),
			request({ requestId: "req-3", selector: "openai/gpt-5", effort: "low" }),
			OWNER_EPOCH,
		);
		expect(conflicting.status).toBe("rejected");
		if (conflicting.status !== "rejected") throw new Error("expected rejection");
		expect(conflicting.reason).toBe("conflicting_pending");
		expect(conflicting.record?.selector).toBe("anthropic/claude-opus-5");

		// Negative control: a request decided under a superseded owner never lands.
		const stale = admitChildRouteUpdate(
			childRouteUpdateProjection(manager),
			request({ requestId: "req-4", ownerEpoch: OWNER_EPOCH }),
			NEXT_OWNER_EPOCH,
		);
		expect(stale.status).toBe("rejected");
		if (stale.status !== "rejected") throw new Error("expected rejection");
		expect(stale.reason).toBe("stale_owner_epoch");

		expect(childRouteUpdateProjection(manager).byRequestId.size).toBe(1);
		await manager.close();
	});

	it("journals an applied receipt that retires the pending request exactly once", async () => {
		const manager = await freshSession();
		const admission = admitChildRouteUpdate(childRouteUpdateProjection(manager), request(), OWNER_EPOCH);
		if (admission.status !== "append") throw new Error("expected append");
		await appendChildRouteUpdateRecord(manager, admission.record);

		const claim = claimChildRouteUpdate(childRouteUpdateProjection(manager), {});
		if (claim.status !== "claim") throw new Error("expected claim");
		await appendChildRouteUpdateRecord(
			manager,
			markChildRouteUpdateApplied(claim.record, {
				appliedSelector: "anthropic/claude-opus-5",
				appliedEffort: "high",
				appliedOwnerEpoch: NEXT_OWNER_EPOCH,
			}),
		);
		const sessionFile = manager.getSessionFile() as string;
		await manager.close();

		const projection = await readChildRouteUpdateProjection(sessionFile);
		expect(projection.open).toBeUndefined();
		expect(projection.applied?.requestId).toBe("req-1");
		// Restart recovery applied the request minted by the previous owner.
		expect(projection.applied?.ownerEpoch).toBe(OWNER_EPOCH);
		expect(projection.applied?.appliedOwnerEpoch).toBe(NEXT_OWNER_EPOCH);
		expect(claimChildRouteUpdate(projection, {}).status).toBe("none");
		expect(formatChildRouteUpdate(childRouteUpdateStatus(projection.applied))).toBe(
			"route applied → anthropic/claude-opus-5:high",
		);
	});

	it("retires a request the child never reached a boundary for", async () => {
		const manager = await freshSession();
		const admission = admitChildRouteUpdate(childRouteUpdateProjection(manager), request(), OWNER_EPOCH);
		if (admission.status !== "append") throw new Error("expected append");
		await appendChildRouteUpdateRecord(manager, admission.record);

		const pending = childRouteUpdateProjection(manager).open;
		if (!pending) throw new Error("expected pending");
		await appendChildRouteUpdateRecord(manager, markChildRouteUpdateNotApplied(pending, "terminal_before_boundary"));
		const sessionFile = manager.getSessionFile() as string;
		await manager.close();

		const projection = await readChildRouteUpdateProjection(sessionFile);
		expect(projection.open).toBeUndefined();
		expect(projection.latest?.state).toBe("not_applied");
		expect(projection.latest?.notAppliedReason).toBe("terminal_before_boundary");
		expect(projection.latest?.terminalAt).toBeDefined();
		expect(formatChildRouteUpdate(childRouteUpdateStatus(projection.latest))).toBe(
			"route not applied → anthropic/claude-opus-5:high (terminal_before_boundary)",
		);
	});

	it("fences a claim when the applier lost the lease instead of mutating a foreign session", () => {
		const pending = createPendingChildRouteUpdate(request());
		const projection = projectChildRouteUpdates([customEntry(pending)]);
		const claim = claimChildRouteUpdate(projection, { ownershipLost: true });
		expect(claim.status).toBe("fenced");
		if (claim.status !== "fenced") throw new Error("expected fenced");
		const receipt = markChildRouteUpdateNotApplied(claim.record, "owner_epoch_changed");
		expect(receipt.state).toBe("not_applied");
		expect(receipt.notAppliedReason).toBe("owner_epoch_changed");
	});

	it("decodes the untrusted journal boundary fail-closed", () => {
		const valid = createPendingChildRouteUpdate(request());
		expect(decodeChildRouteUpdateEntry(customEntry(valid)).kind).toBe("valid");
		// A forward version is unreadable; v1 stays readable so an old journal is
		// never mistaken for corruption.
		expect(decodeChildRouteUpdateEntry(customEntry({ ...valid, version: 3 })).kind).toBe("invalid");
		expect(decodeChildRouteUpdateEntry(customEntry({ ...valid, version: 1 })).kind).toBe("valid");
		expect(decodeChildRouteUpdateEntry(customEntry({ ...valid, requestId: "" })).kind).toBe("invalid");
		expect(decodeChildRouteUpdateEntry(customEntry({ ...valid, effort: 7 })).kind).toBe("invalid");
		expect(decodeChildRouteUpdateEntry(customEntry({ ...valid, state: "half-applied" })).kind).toBe("invalid");
		expect(decodeChildRouteUpdateEntry(customEntry({ ...valid, state: "applied" })).kind).toBe("invalid");
		expect(
			decodeChildRouteUpdateEntry(customEntry({ ...valid, state: "not_applied", terminalAt: valid.updatedAt })).kind,
		).toBe("invalid");
		expect(decodeChildRouteUpdateEntry(customEntry("not-a-record")).kind).toBe("invalid");
		expect(
			decodeChildRouteUpdateEntry({ type: "custom", customType: "something-else", data: valid } as FileEntry).kind,
		).toBe("not_route_update");

		// A corrupt record poisons the projection so no apply runs on a journal we cannot read.
		const poisoned = projectChildRouteUpdates([customEntry(valid), customEntry({ ...valid, version: 99 })]);
		expect(poisoned.corrupt).toBe(true);
		expect(claimChildRouteUpdate(poisoned, {}).status).toBe("none");
		expect(admitChildRouteUpdate(poisoned, request({ requestId: "req-9" }), OWNER_EPOCH)).toEqual({
			status: "rejected",
			reason: "corrupt_journal",
		});
	});

	it("keeps last-append-wins order per request id across interleaved requests", () => {
		const first = createPendingChildRouteUpdate(request());
		const second = createPendingChildRouteUpdate(request({ requestId: "req-2", selector: "openai/gpt-5" }));
		const firstApplied = markChildRouteUpdateApplied(first, {
			appliedSelector: "anthropic/claude-opus-5",
			appliedEffort: "high",
			appliedOwnerEpoch: OWNER_EPOCH,
		});
		const projection = projectChildRouteUpdates([customEntry(first), customEntry(second), customEntry(firstApplied)]);
		expect(projection.byRequestId.size).toBe(2);
		expect(projection.byRequestId.get("req-1")?.state).toBe("applied");
		expect(projection.open?.requestId).toBe("req-2");
		expect(projection.applied?.requestId).toBe("req-1");
		expect(formatChildRouteUpdate(childRouteUpdateStatus(projection.open))).toBe(
			"route pending → openai/gpt-5:high (by Main)",
		);
	});
});

describe("bounded child route update projection", () => {
	/** Push the pending record far behind EOF with real journal entries. */
	async function buryPendingRecord(trailingBytes: number): Promise<{ sessionFile: string; entryBytes: number }> {
		const manager = await freshSession();
		const admission = admitChildRouteUpdate(childRouteUpdateProjection(manager), request(), OWNER_EPOCH);
		if (admission.status !== "append") throw new Error("expected append");
		await appendChildRouteUpdateRecord(manager, admission.record);

		const filler = "x".repeat(4096);
		let written = 0;
		while (written < trailingBytes) {
			manager.appendCustomEntry("route-update-test-filler", { filler });
			written += filler.length;
		}
		await manager.flush();
		const sessionFile = manager.getSessionFile() as string;
		await manager.close();
		return { sessionFile, entryBytes: written };
	}

	it("finds a pending record buried behind more unrelated entries than the tail budget", async () => {
		// 512 KiB of later entries: eight times the 64 KiB tail the reader starts with.
		const { sessionFile } = await buryPendingRecord(512 * 1024);

		const projection = await readChildRouteUpdateProjection(sessionFile);
		expect(projection.overflow).toBe(false);
		expect(projection.open?.requestId).toBe("req-1");
		expect(projection.open?.selector).toBe("anthropic/claude-opus-5");
	});

	it("reports overflow instead of an empty projection when the scan budget runs out", async () => {
		const { sessionFile } = await buryPendingRecord(256 * 1024);

		// A budget far smaller than the trailing entries cannot prove the absence
		// of an older record, so it must say so rather than answer "nothing pending".
		const bounded = await readChildRouteUpdateProjection(sessionFile, 8 * 1024, 16 * 1024);
		expect(bounded.overflow).toBe(true);
		expect(bounded.open).toBeUndefined();
		expect(bounded.latest).toBeUndefined();

		// The authoritative reader escalates on overflow and never loses the request.
		const authoritative = await readAuthoritativeChildRouteUpdateProjection(sessionFile);
		expect(authoritative.overflow).toBe(false);
		expect(authoritative.open?.requestId).toBe("req-1");
	});

	it("reports an empty, non-overflowing projection for a journal with no route updates", async () => {
		const manager = await freshSession();
		manager.appendCustomEntry("route-update-test-filler", { filler: "nothing to see" });
		await manager.ensureOnDisk();
		await manager.flush();
		const sessionFile = manager.getSessionFile() as string;
		await manager.close();

		const projection = await readChildRouteUpdateProjection(sessionFile);
		expect(projection.overflow).toBe(false);
		expect(projection.open).toBeUndefined();
		expect(projection.byRequestId.size).toBe(0);
	});
});

interface LiveChild {
	agentId: string;
	session: AgentSession;
	sessionManager: SessionManager;
	sessionFile: string;
	cwd: string;
	/** `provider/id` recorded for every provider request the child issued, in order. */
	streamedModels: string[];
	/** Resolves once the child's turn is blocked inside the barrier tool. */
	barrierEntered: Promise<void>;
	releaseBarrier: () => void;
	barrierCalls: () => number;
}

function toolCallMessage(): AssistantMessage {
	const call: ToolCall = { type: "toolCall", id: "call_barrier_1", name: "barrier", arguments: {} };
	return {
		role: "assistant",
		content: [call],
		api: "anthropic-messages",
		provider: "anthropic",
		model: "mock",
		usage: {
			input: 0,
			output: 0,
			cacheRead: 0,
			cacheWrite: 0,
			totalTokens: 0,
			cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
		},
		stopReason: "toolUse",
		timestamp: Date.now(),
	};
}

function textMessage(text: string): AssistantMessage {
	return {
		role: "assistant",
		content: [{ type: "text", text }],
		api: "anthropic-messages",
		provider: "anthropic",
		model: "mock",
		usage: {
			input: 0,
			output: 0,
			cacheRead: 0,
			cacheWrite: 0,
			totalTokens: 0,
			cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
		},
		stopReason: "stop",
		timestamp: Date.now(),
	};
}

const liveAuthStorages: AuthStorage[] = [];
const liveSessions: AgentSession[] = [];

/**
 * Build a live child over `sessionManager`: real session, deterministic provider
 * and tool.
 *
 * `restoreRoute` reproduces the executor's restart seam by seeding the agent
 * from the journal through the production restore path, so a reopened child
 * really does come back on the route its journal recorded.
 */
async function attachLiveChild(
	agentId: string,
	sessionManager: SessionManager,
	options: { useBarrier?: boolean; restoreRoute?: boolean } = {},
): Promise<LiveChild> {
	const streamedModels: string[] = [];
	let releaseBarrier!: () => void;
	const barrier = new Promise<void>(resolve => {
		releaseBarrier = resolve;
	});
	let markEntered!: () => void;
	const barrierEntered = new Promise<void>(resolve => {
		markEntered = resolve;
	});
	let barrierCalls = 0;

	const barrierTool: AgentTool = {
		name: "barrier",
		label: "Barrier",
		description: "Blocks the turn until the test releases it.",
		parameters: z.object({}),
		execute: async () => {
			barrierCalls += 1;
			markEntered();
			await barrier;
			return { content: [{ type: "text" as const, text: "released" }] };
		},
	};

	const authStorage = await AuthStorage.create(path.join(root, `auth-${agentId}.db`));
	liveAuthStorages.push(authStorage);
	authStorage.setRuntimeApiKey("anthropic", "test-key");
	const modelRegistry = new ModelRegistry(authStorage, path.join(root, `models-${agentId}.yml`));
	const settings = Settings.isolated({ "compaction.enabled": false, "advisor.enabled": false });
	const restored = options.restoreRoute
		? resolveRestorableSessionModel(sessionManager, modelRegistry, settings, undefined)
		: undefined;

	let streamCall = 0;
	const wantsBarrier = options.useBarrier !== false;
	const agent = new Agent({
		getApiKey: () => "test-key",
		initialState: { model: restored?.model ?? OLD_MODEL, systemPrompt: ["Test"], tools: [barrierTool] },
		streamFn: (model: Model) => {
			streamCall += 1;
			streamedModels.push(`${model.provider}/${model.id}`);
			const useTool = wantsBarrier && streamCall === 1;
			const stream = new AssistantMessageEventStream();
			queueMicrotask(() => {
				const message = useTool ? toolCallMessage() : textMessage("done");
				stream.push({ type: "start", partial: message });
				stream.push({ type: "done", reason: useTool ? "toolUse" : "stop", message });
			});
			return stream;
		},
	});

	const session = new AgentSession({ agent, sessionManager, settings, modelRegistry });
	if (restored?.thinkingLevel !== undefined) session.applyJournaledThinkingLevel(restored.thinkingLevel);
	liveSessions.push(session);

	AgentRegistry.global().register({
		id: agentId,
		displayName: agentId,
		kind: "sub",
		parentId: "Main",
		session,
		status: "running",
	});

	const sessionFile = sessionManager.getSessionFile();
	if (!sessionFile) throw new Error("live child has no session file");
	return {
		agentId,
		session,
		sessionManager,
		sessionFile,
		cwd: sessionManager.getCwd(),
		streamedModels,
		barrierEntered,
		releaseBarrier,
		barrierCalls: () => barrierCalls,
	};
}

async function createLiveChild(agentId: string, options: { useBarrier?: boolean } = {}): Promise<LiveChild> {
	const dirs = await freshSessionDirs();
	return attachLiveChild(agentId, SessionManager.create(dirs.cwd, dirs.sessions), options);
}

/** Reopen a child journal as a new owner would after a restart. */
async function reopenLiveChild(agentId: string, sessionFile: string): Promise<LiveChild> {
	const reopened = await SessionManager.open(sessionFile, undefined, undefined, { suppressBreadcrumb: true });
	return attachLiveChild(agentId, reopened, { useBarrier: false, restoreRoute: true });
}

async function journalEntries(sessionFile: string): Promise<Record<string, unknown>[]> {
	const raw = await fs.readFile(sessionFile, "utf8");
	return raw
		.split("\n")
		.filter(line => line.trim())
		.map(line => JSON.parse(line) as Record<string, unknown>);
}

/** Everything one route apply is allowed to write, counted so a replay shows up. */
async function routeFootprint(sessionFile: string): Promise<{
	notices: number;
	modelChanges: number;
	thinkingChanges: number;
	routeRecords: number;
}> {
	const entries = await journalEntries(sessionFile);
	const routeRecord = (entry: Record<string, unknown>): boolean =>
		entry.type === "custom" && entry.customType === CHILD_ROUTE_UPDATE_CUSTOM_TYPE;
	return {
		notices: entries.filter(e => e.type === "custom_message" && e.customType === HOTSWAP_NOTICE_TYPE).length,
		modelChanges: entries.filter(e => e.type === "model_change").length,
		thinkingChanges: entries.filter(e => e.type === "thinking_level_change").length,
		routeRecords: entries.filter(routeRecord).length,
	};
}

/**
 * Cut the journal immediately after the last entry matching `match`.
 *
 * This is a real torn tail on the file the production append path wrote, which
 * is exactly what a crash between two flushes leaves behind.
 */
async function crashAfter(sessionFile: string, match: (entry: Record<string, unknown>) => boolean): Promise<void> {
	const raw = await fs.readFile(sessionFile, "utf8");
	const lines = raw.split("\n").filter(line => line.trim());
	let cut = -1;
	for (let index = lines.length - 1; index >= 0; index--) {
		if (match(JSON.parse(lines[index]!) as Record<string, unknown>)) {
			cut = index;
			break;
		}
	}
	if (cut < 0) throw new Error("no journal entry matched the crash point");
	if (cut === lines.length - 1) throw new Error("crash point is already the last entry; nothing would be lost");
	await fs.writeFile(sessionFile, `${lines.slice(0, cut + 1).join("\n")}\n`);
}

const isRouteRecordWithState =
	(state: string) =>
	(entry: Record<string, unknown>): boolean =>
		entry.type === "custom" &&
		entry.customType === CHILD_ROUTE_UPDATE_CUSTOM_TYPE &&
		(entry.data as { state?: string } | undefined)?.state === state;

const isHotswapNotice = (entry: Record<string, unknown>): boolean =>
	entry.type === "custom_message" && entry.customType === HOTSWAP_NOTICE_TYPE;

/** Tear the live process down without touching the journal a successor will read. */
async function crashProcess(child: LiveChild): Promise<void> {
	await child.session.dispose().catch(() => {});
	await child.sessionManager.close().catch(() => {});
	AgentRegistry.resetGlobalForTests();
	AgentLifecycleManager.resetGlobalForTests();
}

describe("live child route update boundary", () => {
	afterEach(async () => {
		for (const session of liveSessions.splice(0)) {
			await session.dispose().catch(() => {});
		}
		for (const authStorage of liveAuthStorages.splice(0)) authStorage.close();
		AgentRegistry.resetGlobalForTests();
		AgentLifecycleManager.resetGlobalForTests();
	});

	it("keeps the blocked turn on the old route and applies the new one exactly once at the boundary", async () => {
		const child = await createLiveChild("LiveBoundaryChild");
		const sessionIdBefore = child.sessionManager.getSessionId();
		const releaseBoundary = registerChildRouteUpdateBoundary(child.agentId, child.session);

		const turn = child.session.prompt("start");
		await child.barrierEntered;
		expect(child.session.isStreaming).toBe(true);

		const result = await hotswapAgentModel({
			agentId: child.agentId,
			model: NEW_SELECTOR,
			requestedBy: "Main",
		});
		expect(result.status).toBe("pending");
		if (result.status !== "pending") throw new Error("expected pending");

		// Route before: the blocked turn is untouched and the request is durable.
		expect(`${child.session.model?.provider}/${child.session.model?.id}`).toBe(OLD_SELECTOR);
		const whileBlocked = await readChildRouteUpdateProjection(child.sessionFile);
		expect(whileBlocked.open?.requestId).toBe(result.requestId);
		expect(whileBlocked.open?.selector).toBe(NEW_SELECTOR);

		child.releaseBarrier();
		await turn;

		// Route after: every provider request of the finished turn used the old
		// route; the boundary ran after the tool and provider finalizers settled.
		expect(child.streamedModels).toEqual([OLD_SELECTOR, OLD_SELECTOR]);
		expect(child.barrierCalls()).toBe(1);
		expect(`${child.session.model?.provider}/${child.session.model?.id}`).toBe(NEW_SELECTOR);

		const afterBoundary = await readChildRouteUpdateProjection(child.sessionFile);
		expect(afterBoundary.open).toBeUndefined();
		expect(afterBoundary.applied?.requestId).toBe(result.requestId);
		expect(afterBoundary.applied?.appliedSelector).toBe(NEW_SELECTOR);
		expect(afterBoundary.byRequestId.size).toBe(1);

		// The next turn's request is built on the new route.
		await child.session.prompt("next");
		expect(child.streamedModels).toEqual([OLD_SELECTOR, OLD_SELECTOR, NEW_SELECTOR]);

		// Exactly once: the boundary ran again and found nothing left to claim.
		const afterSecondTurn = await readChildRouteUpdateProjection(child.sessionFile);
		expect(afterSecondTurn.byRequestId.size).toBe(1);
		expect(afterSecondTurn.applied?.appliedAt).toBe(afterBoundary.applied?.appliedAt);

		// Child identity, workspace, and journal are the ones it started with.
		expect(child.sessionManager.getSessionId()).toBe(sessionIdBefore);
		expect(child.sessionManager.getSessionFile()).toBe(child.sessionFile);
		expect(child.sessionManager.getCwd()).toBe(child.cwd);

		releaseBoundary();
	}, 20_000);

	it("does not answer a running child with the process-local queue the old path used", async () => {
		const child = await createLiveChild("NoQueueChild");
		const releaseBoundary = registerChildRouteUpdateBoundary(child.agentId, child.session);
		const turn = child.session.prompt("start");
		await child.barrierEntered;

		const result = await hotswapAgentModel({
			agentId: child.agentId,
			model: NEW_SELECTOR,
			requestedBy: "Main",
		});

		// Negative control for the pre-change contract: a streaming direct child
		// used to get an in-process `queued` result that died with the parent.
		expect(result.status).not.toBe("queued");
		expect(result.status).toBe("pending");
		expect((await readChildRouteUpdateProjection(child.sessionFile)).open).toBeDefined();

		child.releaseBarrier();
		await turn;
		releaseBoundary();
	}, 20_000);

	it("retires a live request the child never reached a boundary for", async () => {
		const child = await createLiveChild("TerminalBeforeBoundaryChild");
		const releaseBoundary = registerChildRouteUpdateBoundary(child.agentId, child.session);

		const turn = child.session.prompt("start");
		await child.barrierEntered;
		const result = await hotswapAgentModel({
			agentId: child.agentId,
			model: NEW_SELECTOR,
			requestedBy: "Main",
		});
		expect(result.status).toBe("pending");

		// Terminal teardown, in the executor's order: drop the boundary first, then
		// journal the not-applied receipt.
		releaseBoundary();
		const retired = await retirePendingChildRouteUpdate(child.sessionManager);
		expect(retired?.state).toBe("not_applied");
		expect(retired?.notAppliedReason).toBe("terminal_before_boundary");

		child.releaseBarrier();
		await turn;

		const projection = await readChildRouteUpdateProjection(child.sessionFile);
		expect(projection.open).toBeUndefined();
		expect(projection.applied).toBeUndefined();
		expect(projection.latest?.notAppliedReason).toBe("terminal_before_boundary");
		// The route never moved: a retired request must not mutate the child.
		expect(`${child.session.model?.provider}/${child.session.model?.id}`).toBe(OLD_SELECTOR);
		expect(child.streamedModels).toEqual([OLD_SELECTOR, OLD_SELECTOR]);
	}, 20_000);

	it("applies a request left pending by a previous owner when the child restarts", async () => {
		const first = await createLiveChild("RestartRouteChild");
		const sessionId = first.sessionManager.getSessionId();
		const sessionFile = first.sessionFile;
		const cwd = first.cwd;
		const releaseBoundary = registerChildRouteUpdateBoundary(first.agentId, first.session);

		const turn = first.session.prompt("start");
		await first.barrierEntered;
		const result = await hotswapAgentModel({
			agentId: first.agentId,
			model: NEW_SELECTOR,
			requestedBy: "Main",
		});
		expect(result.status).toBe("pending");
		if (result.status !== "pending") throw new Error("expected pending");

		// The owning process dies before any boundary runs: drop the hook, then let
		// the abandoned turn unwind and tear the session down.
		releaseBoundary();
		first.releaseBarrier();
		await turn;
		await first.session.dispose();
		await first.sessionManager.close();
		AgentRegistry.resetGlobalForTests();

		// The request outlived the process that made it.
		const onDisk = await readChildRouteUpdateProjection(sessionFile);
		expect(onDisk.open?.requestId).toBe(result.requestId);

		// A new owner reopens the same journal: same child id, workspace, and file.
		const reopened = await SessionManager.open(sessionFile, undefined, undefined, { suppressBreadcrumb: true });
		expect(reopened.getSessionId()).toBe(sessionId);
		expect(reopened.getSessionFile()).toBe(sessionFile);
		expect(reopened.getCwd()).toBe(cwd);
		expect(childRouteUpdateProjection(reopened).open?.requestId).toBe(result.requestId);

		const second = await attachLiveChild("RestartRouteChild", reopened, { useBarrier: false });
		// The executor's restart seam: apply before the resumed child's first turn.
		const releaseSecondBoundary = registerChildRouteUpdateBoundary(second.agentId, second.session);
		const applied = await applyPendingChildRouteUpdate(second.agentId, second.session);
		expect(applied?.state).toBe("applied");
		expect(applied?.requestId).toBe(result.requestId);
		expect(applied?.appliedSelector).toBe(NEW_SELECTOR);
		expect(`${second.session.model?.provider}/${second.session.model?.id}`).toBe(NEW_SELECTOR);

		// The resumed child's first turn already runs on the recovered route.
		await second.session.prompt("resumed");
		expect(second.streamedModels).toEqual([NEW_SELECTOR]);

		const settled = await readChildRouteUpdateProjection(sessionFile);
		expect(settled.open).toBeUndefined();
		expect(settled.byRequestId.size).toBe(1);
		expect(settled.applied?.ownerEpoch).toBe(onDisk.open?.ownerEpoch);
		expect(reopened.getSessionId()).toBe(sessionId);
		expect(reopened.getSessionFile()).toBe(sessionFile);

		releaseSecondBoundary();
	}, 20_000);
});

const OWNER_LEASE_BUILD = { digest: "a".repeat(64), version: "child-route-update-test" };
const OWNER_LEASE_RUNNER = {
	runnerInstanceId: "44444444-4444-4444-8444-444444444444",
	startedAt: "2026-07-20T00:00:00.000Z",
};

interface OwnedParent {
	sessionManager: SessionManager;
	ownership: SessionOwnershipHandle;
}

const heldLeases: SessionOwnershipHandle[] = [];

/** A parent journal holding a real, releasable session lease. */
async function ownedParentSession(label: string): Promise<OwnedParent> {
	const dirs = await freshSessionDirs();
	const sessionManager = SessionManager.create(dirs.cwd, dirs.sessions);
	await sessionManager.ensureOnDisk();
	const sessionFile = sessionManager.getSessionFile();
	if (!sessionFile) throw new Error("parent session has no file");
	const ownership = await acquireSessionOwnership(sessionFile, sessionManager.getSessionId(), {
		root: path.join(root, `lease-${label}`),
		buildRevision: OWNER_LEASE_BUILD,
		runnerInstanceIdentity: OWNER_LEASE_RUNNER,
	});
	heldLeases.push(ownership);
	sessionManager.bindSessionOwnership(ownership);
	return { sessionManager, ownership };
}

async function appendPendingRoute(
	child: LiveChild,
	overrides: Partial<ChildRouteUpdateRequest>,
): Promise<ChildRouteUpdateRecord> {
	return appendChildRouteUpdateRecord(
		child.sessionManager,
		createPendingChildRouteUpdate(request({ agentId: child.agentId, ...overrides })),
	);
}

function liveSelector(child: LiveChild): string {
	return `${child.session.model?.provider}/${child.session.model?.id}`;
}

describe("parent lease fences live child route applies", () => {
	afterEach(async () => {
		for (const session of liveSessions.splice(0)) await session.dispose().catch(() => {});
		for (const authStorage of liveAuthStorages.splice(0)) authStorage.close();
		for (const lease of heldLeases.splice(0)) await lease.release().catch(() => {});
		AgentRegistry.resetGlobalForTests();
		AgentLifecycleManager.resetGlobalForTests();
	});

	it("applies while the owning parent holds its lease and refuses once that exact lease is gone", async () => {
		const parent = await ownedParentSession("held");
		const child = await createLiveChild("ParentLeaseChild", { useBarrier: false });
		const lease = (): ChildRouteLease => parentRouteLease(parent.sessionManager);

		// Positive control: the real lease is held, so the boundary applies and
		// stamps the receipt with the parent's actual epoch.
		expect(lease()).toEqual({ held: true, ownerEpoch: parent.ownership.ownerEpoch });
		await appendPendingRoute(child, {
			requestId: "lease-held",
			selector: NEW_SELECTOR,
			effort: null,
			ownerEpoch: parent.ownership.ownerEpoch,
		});
		const applied = await applyPendingChildRouteUpdate(child.agentId, child.session, lease);
		expect(applied?.state).toBe("applied");
		expect(applied?.appliedOwnerEpoch).toBe(parent.ownership.ownerEpoch);
		expect(liveSelector(child)).toBe(NEW_SELECTOR);

		// Negative control: same child, same unfenced child manager, but the parent
		// that admitted the request no longer owns the journal tree.
		await appendPendingRoute(child, {
			requestId: "lease-lost",
			selector: OLD_SELECTOR,
			effort: null,
			ownerEpoch: parent.ownership.ownerEpoch,
		});
		await parent.ownership.release();
		// The exact control the fence needs: the child manager itself still reports
		// a perfectly healthy lease, so only the parent probe can see the takeover.
		expect(child.sessionManager.getSessionOwnershipLostError()).toBeUndefined();
		expect(child.sessionManager.getSessionOwnership()).toBeUndefined();
		expect(lease().held).toBe(false);

		const fenced = await applyPendingChildRouteUpdate(child.agentId, child.session, lease);
		expect(fenced?.state).toBe("not_applied");
		expect(fenced?.notAppliedReason).toBe("owner_epoch_changed");
		expect(fenced?.failureDetail).toBeDefined();
		// The route the fenced request asked for never landed.
		expect(liveSelector(child)).toBe(NEW_SELECTOR);

		const settled = await readChildRouteUpdateProjection(child.sessionFile);
		expect(settled.open).toBeUndefined();
		expect(settled.byRequestId.get("lease-lost")?.state).toBe("not_applied");
	}, 20_000);

	it("resolves the fence through the registry when only the owning agent id is known", async () => {
		const parent = await ownedParentSession("registry");
		const owner = await attachLiveChild("SpawningParent", parent.sessionManager, { useBarrier: false });
		expect(parentRouteLease(owner.agentId)).toEqual({ held: true, ownerEpoch: parent.ownership.ownerEpoch });

		await parent.ownership.release();
		expect(parentRouteLease(owner.agentId).held).toBe(false);
	}, 20_000);

	it("still applies a request minted under a superseded epoch once a new owner holds the lease", async () => {
		const parent = await ownedParentSession("takeover");
		const child = await createLiveChild("EpochTakeoverChild", { useBarrier: false });

		// Minted by the previous owner: restart recovery must apply it, so epoch
		// equality is deliberately not the apply-time fence.
		await appendPendingRoute(child, {
			requestId: "previous-owner",
			selector: NEW_SELECTOR,
			effort: null,
			ownerEpoch: OWNER_EPOCH,
		});
		const applied = await applyPendingChildRouteUpdate(child.agentId, child.session, () =>
			parentRouteLease(parent.sessionManager),
		);
		expect(applied?.state).toBe("applied");
		expect(applied?.ownerEpoch).toBe(OWNER_EPOCH);
		expect(applied?.appliedOwnerEpoch).toBe(parent.ownership.ownerEpoch);
		expect(applied?.appliedOwnerEpoch).not.toBe(OWNER_EPOCH);
		expect(liveSelector(child)).toBe(NEW_SELECTOR);
	}, 20_000);

	it("re-probes the parent lease after the applying intent and refuses to mutate once it moved", async () => {
		const child = await createLiveChild("FenceAfterIntentChild", { useBarrier: false });
		let leaseHeld = true;
		const lease = (): ChildRouteLease =>
			leaseHeld
				? { held: true, ownerEpoch: OWNER_EPOCH }
				: { held: false, ownerEpoch: OWNER_EPOCH, detail: "parent lease revoked mid-apply" };

		// Positive control: the same request, the same probe, a lease that never
		// moves. Whatever the fenced run does differently is caused by the takeover.
		await appendPendingRoute(child, {
			requestId: "fence-control",
			selector: NEW_SELECTOR,
			effort: null,
			ownerEpoch: OWNER_EPOCH,
		});
		expect((await applyPendingChildRouteUpdate(child.agentId, child.session, lease))?.state).toBe("applied");
		expect(liveSelector(child)).toBe(NEW_SELECTOR);
		const control = await routeFootprint(child.sessionFile);

		// The takeover lands inside the window the durable intent flush opens: the
		// transition hook fires the instant `applying` is on disk, which is exactly
		// the await the claim-time probe cannot see across.
		await appendPendingRoute(child, {
			requestId: "fence-after-intent",
			selector: OLD_SELECTOR,
			effort: null,
			ownerEpoch: OWNER_EPOCH,
		});
		const stopTakeover = onChildRouteUpdate(notification => {
			if (notification.record.requestId === "fence-after-intent" && notification.record.state === "applying") {
				leaseHeld = false;
			}
		});
		let fenced: ChildRouteUpdateRecord | undefined;
		try {
			fenced = await applyPendingChildRouteUpdate(child.agentId, child.session, lease);
		} finally {
			stopTakeover();
		}

		expect(fenced?.state).toBe("not_applied");
		expect(fenced?.notAppliedReason).toBe("owner_epoch_changed");
		expect(fenced?.failureDetail).toContain("revoked mid-apply");
		// The intent was durable, so the refusal is the first attempt's outcome.
		expect(fenced?.attempt).toBe(1);
		// Nothing ran under the revoked lease.
		expect(liveSelector(child)).toBe(NEW_SELECTOR);
		const after = await routeFootprint(child.sessionFile);
		expect(after.notices).toBe(control.notices);
		expect(after.modelChanges).toBe(control.modelChanges);
		expect(after.thinkingChanges).toBe(control.thinkingChanges);
		expect((await readChildRouteUpdateProjection(child.sessionFile)).open).toBeUndefined();
	}, 20_000);

	it("fences an apply whose parent lease was reacquired by a new owner during the intent flush", async () => {
		const child = await createLiveChild("EpochMovedDuringIntentChild", { useBarrier: false });
		let leaseEpoch = OWNER_EPOCH;
		const lease = (): ChildRouteLease => ({ held: true, ownerEpoch: leaseEpoch });

		await appendPendingRoute(child, {
			requestId: "epoch-moved",
			selector: NEW_SELECTOR,
			effort: null,
			ownerEpoch: OWNER_EPOCH,
		});
		// A lease held by a *different* owner still reads as held, so only the exact
		// epoch the apply was admitted under can tell a takeover from a healthy run.
		const stopTakeover = onChildRouteUpdate(notification => {
			if (notification.record.state === "applying") leaseEpoch = NEXT_OWNER_EPOCH;
		});
		let fenced: ChildRouteUpdateRecord | undefined;
		try {
			fenced = await applyPendingChildRouteUpdate(child.agentId, child.session, lease);
		} finally {
			stopTakeover();
		}

		expect(fenced?.state).toBe("not_applied");
		expect(fenced?.notAppliedReason).toBe("owner_epoch_changed");
		expect(fenced?.failureDetail).toContain(NEXT_OWNER_EPOCH);
		expect(liveSelector(child)).toBe(OLD_SELECTOR);
		expect(await routeFootprint(child.sessionFile)).toMatchObject({ notices: 0, modelChanges: 0 });
	}, 20_000);
});

describe("crash-consistent child route apply", () => {
	afterEach(async () => {
		for (const session of liveSessions.splice(0)) await session.dispose().catch(() => {});
		for (const authStorage of liveAuthStorages.splice(0)) authStorage.close();
		for (const lease of heldLeases.splice(0)) await lease.release().catch(() => {});
		AgentRegistry.resetGlobalForTests();
		AgentLifecycleManager.resetGlobalForTests();
	});

	/** Drive one full, successful model swap on an idle child and hand back its journal. */
	async function completedModelSwap(agentId: string): Promise<{ sessionFile: string; requestId: string }> {
		const child = await createLiveChild(agentId, { useBarrier: false });
		const result = await hotswapAgentModel({
			agentId: child.agentId,
			model: NEW_SELECTOR,
			requestedBy: "Main",
			commandId: `${agentId}-cmd`,
		});
		expect(result.status).toBe("applied");
		expect(liveSelector(child)).toBe(NEW_SELECTOR);
		const sessionFile = child.sessionFile;
		await crashProcess(child);

		const footprint = await routeFootprint(sessionFile);
		expect(footprint).toMatchObject({ notices: 1, routeRecords: 3 });
		return { sessionFile, requestId: `${agentId}-cmd` };
	}

	it("settles a crash between the mutation and its receipt without a second mutation or notice", async () => {
		const { sessionFile, requestId } = await completedModelSwap("CrashAfterMutation");
		const before = await routeFootprint(sessionFile);

		// The receipt never reached disk; everything the apply mutated did.
		await crashAfter(sessionFile, isHotswapNotice);
		const torn = await readChildRouteUpdateProjection(sessionFile);
		expect(torn.open?.state).toBe("applying");
		expect(torn.open?.attempt).toBe(1);

		const resumed = await reopenLiveChild("CrashAfterMutation", sessionFile);
		// The restored child already runs the target route, which is precisely why
		// the reconcile must not mutate it again.
		expect(liveSelector(resumed)).toBe(NEW_SELECTOR);
		const settled = await applyPendingChildRouteUpdate(resumed.agentId, resumed.session);
		expect(settled?.state).toBe("applied");
		expect(settled?.requestId).toBe(requestId);
		expect(settled?.attempt).toBe(1);

		const after = await routeFootprint(sessionFile);
		expect(after.notices).toBe(1);
		expect(after.modelChanges).toBe(before.modelChanges);
		expect(after.thinkingChanges).toBe(before.thinkingChanges);
		expect(after.routeRecords).toBe(before.routeRecords);
		expect((await readChildRouteUpdateProjection(sessionFile)).open).toBeUndefined();
	}, 30_000);

	it("re-applies exactly once when the crash left no durable route evidence", async () => {
		const { sessionFile, requestId } = await completedModelSwap("CrashAfterIntent");

		// Crash right after the durable intent: the mutation's own entries were
		// still buffered and died with the process.
		await crashAfter(sessionFile, isRouteRecordWithState("applying"));
		const torn = await routeFootprint(sessionFile);
		expect(torn).toMatchObject({ notices: 0, modelChanges: 0, routeRecords: 2 });

		const resumed = await reopenLiveChild("CrashAfterIntent", sessionFile);
		expect(liveSelector(resumed)).toBe(OLD_SELECTOR);
		const settled = await applyPendingChildRouteUpdate(resumed.agentId, resumed.session);
		expect(settled?.state).toBe("applied");
		expect(settled?.requestId).toBe(requestId);
		// A second durable intent is visible as a second attempt, never as a first try.
		expect(settled?.attempt).toBe(2);
		expect(liveSelector(resumed)).toBe(NEW_SELECTOR);

		const after = await routeFootprint(sessionFile);
		expect(after.notices).toBe(1);
		expect(after.modelChanges).toBe(1);
		expect(after.routeRecords).toBe(4);
	}, 30_000);

	it("reconciles an uncertain receipt against the durable route instead of replaying it", async () => {
		const { sessionFile } = await completedModelSwap("CrashUncertain");
		const before = await routeFootprint(sessionFile);

		await crashAfter(sessionFile, isHotswapNotice);
		const torn = await SessionManager.open(sessionFile, undefined, undefined, { suppressBreadcrumb: true });
		const inDoubt = childRouteUpdateProjection(torn).open;
		if (!inDoubt) throw new Error("expected an in-doubt record");
		await appendChildRouteUpdateRecord(
			torn,
			markChildRouteUpdateUncertain(inDoubt, "journal flush failed after the model change"),
		);
		await torn.close();
		expect((await readChildRouteUpdateProjection(sessionFile)).open?.state).toBe("uncertain");

		const resumed = await reopenLiveChild("CrashUncertain", sessionFile);
		const settled = await applyPendingChildRouteUpdate(resumed.agentId, resumed.session);
		expect(settled?.state).toBe("applied");
		expect(settled?.failureDetail).toBeUndefined();

		const after = await routeFootprint(sessionFile);
		expect(after.notices).toBe(1);
		expect(after.modelChanges).toBe(before.modelChanges);
		// Only the uncertain record and its applied successor were added.
		expect(after.routeRecords).toBe(before.routeRecords + 1);
	}, 30_000);

	it("reconciles an effort-only apply without a second thinking change or notice", async () => {
		const child = await createLiveChild("CrashEffortOnly", { useBarrier: false });
		const supported = OLD_MODEL.reasoning ? getSupportedEfforts(OLD_MODEL) : [];
		expect(supported.length).toBeGreaterThan(0);
		const effort = supported.at(-1) as string;

		const result = await hotswapAgentModel({
			agentId: child.agentId,
			model: `${OLD_SELECTOR}:${effort}`,
			requestedBy: "Main",
			commandId: "effort-cmd",
		});
		expect(result.status).toBe("applied");
		const sessionFile = child.sessionFile;
		await crashProcess(child);

		const before = await routeFootprint(sessionFile);
		expect(before).toMatchObject({ notices: 1, thinkingChanges: 1, routeRecords: 3 });

		await crashAfter(sessionFile, isHotswapNotice);
		expect((await readChildRouteUpdateProjection(sessionFile)).open?.state).toBe("applying");

		const resumed = await reopenLiveChild("CrashEffortOnly", sessionFile);
		const settled = await applyPendingChildRouteUpdate(resumed.agentId, resumed.session);
		expect(settled?.state).toBe("applied");
		expect(settled?.appliedEffort).toBe(effort);

		const after = await routeFootprint(sessionFile);
		expect(after.notices).toBe(1);
		expect(after.thinkingChanges).toBe(before.thinkingChanges);
		expect(after.modelChanges).toBe(before.modelChanges);
		expect(after.routeRecords).toBe(before.routeRecords);
	}, 30_000);

	it("never records a partially mutated route as not applied", async () => {
		const child = await createLiveChild("PartialMutationChild", { useBarrier: false });
		const ownership = await acquireSessionOwnership(child.sessionFile, child.sessionManager.getSessionId(), {
			root: path.join(root, "lease-partial"),
			buildRevision: OWNER_LEASE_BUILD,
			runnerInstanceIdentity: OWNER_LEASE_RUNNER,
		});
		heldLeases.push(ownership);
		child.sessionManager.bindSessionOwnership(ownership);

		await appendPendingRoute(child, {
			requestId: "partial-1",
			selector: NEW_SELECTOR,
			effort: null,
			ownerEpoch: OWNER_EPOCH,
		});

		// Real fault, injected through the production transition hook: the journal
		// becomes unwritable the instant the apply intent is durable, so the
		// mutation runs and none of its receipts can land.
		const stopFault = onChildRouteUpdate(notification => {
			if (notification.record.state === "applying") void ownership.release();
		});
		try {
			await applyPendingChildRouteUpdate(child.agentId, child.session, () => ({
				held: true,
				ownerEpoch: OWNER_EPOCH,
			}));
		} finally {
			stopFault();
		}

		// The live route moved, so a `not_applied` receipt would be a lie.
		expect(liveSelector(child)).toBe(NEW_SELECTOR);
		const durable = await readChildRouteUpdateProjection(child.sessionFile);
		expect(durable.open?.state).not.toBe("not_applied");
		expect(durable.latest?.state).not.toBe("not_applied");
		expect(isChildRouteUpdateInDoubt(durable.open?.state ?? "pending")).toBe(true);
	}, 30_000);

	it("records a clean not-applied receipt when the apply failed before touching the route", async () => {
		const child = await createLiveChild("PreMutationFailureChild", { useBarrier: false });
		await appendPendingRoute(child, {
			requestId: "unresolvable-1",
			selector: "nowhere/not-a-real-model",
			effort: null,
			ownerEpoch: OWNER_EPOCH,
		});

		const settled = await applyPendingChildRouteUpdate(child.agentId, child.session);
		expect(settled?.state).toBe("not_applied");
		expect(settled?.notAppliedReason).toBe("apply_failed");
		expect(settled?.failureDetail).toContain("nowhere/not-a-real-model");
		expect(liveSelector(child)).toBe(OLD_SELECTOR);
		// Nothing was mutated, so no intent was ever recorded.
		expect(settled?.attempt).toBeUndefined();
		expect(await routeFootprint(child.sessionFile)).toMatchObject({ notices: 0, routeRecords: 2 });
	}, 20_000);

	it("leaves an in-doubt request open at teardown instead of stamping it not applied", async () => {
		const { sessionFile } = await completedModelSwap("TeardownInDoubt");
		await crashAfter(sessionFile, isRouteRecordWithState("applying"));

		const reopened = await SessionManager.open(sessionFile, undefined, undefined, { suppressBreadcrumb: true });
		const retired = await retirePendingChildRouteUpdate(reopened);
		expect(retired).toBeUndefined();
		expect(childRouteUpdateProjection(reopened).open?.state).toBe("applying");
		await reopened.close();
	}, 30_000);

	it("settles an in-doubt request at teardown when the durable route already proves the swap", async () => {
		const { sessionFile } = await completedModelSwap("TeardownProven");
		await crashAfter(sessionFile, isHotswapNotice);

		const reopened = await SessionManager.open(sessionFile, undefined, undefined, { suppressBreadcrumb: true });
		const retired = await retirePendingChildRouteUpdate(reopened);
		expect(retired?.state).toBe("applied");
		expect(retired?.appliedSelector).toBe(NEW_SELECTOR);
		await reopened.close();

		const after = await routeFootprint(sessionFile);
		expect(after.notices).toBe(1);
		expect(after.modelChanges).toBe(1);
	}, 30_000);

	it("settles a resumed apply from durable evidence when the requested model no longer resolves", async () => {
		const child = await createLiveChild("UnavailableSelectorChild", { useBarrier: false });
		const retired = "nowhere/not-a-real-model";
		// The premise: this selector cannot be resolved a second time.
		expect(
			resolveModelOverride([retired], child.session.modelRegistry, child.session.settings).model,
		).toBeUndefined();

		// The previous owner recorded its intent, mutated the child, and died before
		// the receipt — the `applying` tail a crash leaves behind, over a model that
		// has since left the available set.
		const pending = await appendPendingRoute(child, {
			requestId: "unavailable-resume",
			selector: retired,
			effort: null,
			ownerEpoch: OWNER_EPOCH,
		});
		await appendChildRouteUpdateRecord(child.sessionManager, markChildRouteUpdateApplying(pending, OWNER_EPOCH));
		child.sessionManager.appendModelChange(retired, "hotswap");
		await child.sessionManager.flush();
		const sessionFile = child.sessionFile;
		await crashProcess(child);
		const before = await routeFootprint(sessionFile);
		expect((await readChildRouteUpdateProjection(sessionFile)).open?.state).toBe("applying");

		const resumed = await reopenLiveChild("UnavailableSelectorChild", sessionFile);
		const settled = await applyPendingChildRouteUpdate(resumed.agentId, resumed.session);
		expect(settled?.state).toBe("applied");
		expect(settled?.appliedSelector).toBe(retired);
		// Attributed to the owner that actually mutated the child, not the reconciler.
		expect(settled?.appliedOwnerEpoch).toBe(OWNER_EPOCH);

		const after = await routeFootprint(sessionFile);
		expect(after.modelChanges).toBe(before.modelChanges);
		expect(after.notices).toBe(0);
		expect((await readChildRouteUpdateProjection(sessionFile)).open).toBeUndefined();
	}, 30_000);

	it("reports an effort apply whose journal append failed as in doubt, not as not applied", async () => {
		const child = await createLiveChild("EffortAppendFaultChild", { useBarrier: false });
		const supported = OLD_MODEL.reasoning ? getSupportedEfforts(OLD_MODEL) : [];
		expect(supported.length).toBeGreaterThan(0);
		const effort = supported.at(-1) as string;
		expect(child.session.thinkingLevel).not.toBe(effort);

		await appendPendingRoute(child, {
			requestId: "effort-append-fault",
			selector: OLD_SELECTOR,
			effort,
			ownerEpoch: OWNER_EPOCH,
		});

		// The fault the receipt has to survive: `setThinkingLevel` moves the live
		// effort and the running agent, *then* journals the change, and that append
		// is what fails on a fenced manager. Scoped to the one call so the receipt
		// the boundary chooses still reaches disk and can be read back.
		const manager = child.sessionManager;
		const realAppend = manager.appendThinkingLevelChange.bind(manager);
		let armed = true;
		manager.appendThinkingLevelChange = (level?: string): string => {
			if (!armed) return realAppend(level);
			armed = false;
			throw new SessionOwnershipLostError(manager.getSessionId(), OWNER_EPOCH);
		};
		let settled: ChildRouteUpdateRecord | undefined;
		try {
			settled = await applyPendingChildRouteUpdate(child.agentId, child.session, () => ({
				held: true,
				ownerEpoch: OWNER_EPOCH,
			}));
		} finally {
			manager.appendThinkingLevelChange = realAppend;
		}

		// The child really is running the requested effort, so `not_applied` would
		// be a receipt that contradicts the live route.
		expect(child.session.thinkingLevel).toBe(effort);
		expect(settled?.state).toBe("uncertain");
		expect(isChildRouteUpdateInDoubt(settled?.state ?? "pending")).toBe(true);
		expect(settled?.failureDetail).toBeDefined();
		expect((await readChildRouteUpdateProjection(child.sessionFile)).open?.state).toBe("uncertain");
	}, 20_000);
});

describe("historical child route updates", () => {
	afterEach(async () => {
		for (const authStorage of liveAuthStorages.splice(0)) authStorage.close();
		AgentRegistry.resetGlobalForTests();
		AgentLifecycleManager.resetGlobalForTests();
	});

	/** `seed` writes the durable state a crash left behind before the child was archived. */
	async function historicalChild(
		agentId: string,
		seed?: (child: SessionManager) => Promise<void>,
	): Promise<{
		parent: SessionManager;
		childFile: string;
		modelRegistry: ModelRegistry;
		settings: Settings;
	}> {
		const dirs = await freshSessionDirs();
		const parent = SessionManager.create(dirs.cwd, dirs.sessions);
		await parent.ensureOnDisk();
		const parentFile = parent.getSessionFile();
		if (!parentFile) throw new Error("parent has no session file");

		const child = SessionManager.create(dirs.cwd, parentFile.slice(0, -".jsonl".length));
		child.appendSessionInit({
			systemPrompt: "Test",
			task: "historical",
			tools: [],
			subagent: {
				agentId,
				displayName: agentId,
				parentSessionId: parent.getSessionId(),
				parentSessionFile: parentFile,
				isolated: false,
				taskDepth: 0,
				parentTaskPrefix: "",
			},
		});
		child.appendModelChange(OLD_SELECTOR, "default");
		await child.ensureOnDisk();
		await child.flush();
		if (seed) await seed(child);
		const childFile = child.getSessionFile();
		if (!childFile) throw new Error("historical child has no session file");
		await child.close();

		const authStorage = await AuthStorage.create(path.join(root, `auth-hist-${agentId}.db`));
		liveAuthStorages.push(authStorage);
		authStorage.setRuntimeApiKey("anthropic", "test-key");
		return {
			parent,
			childFile,
			modelRegistry: new ModelRegistry(authStorage, path.join(root, `models-hist-${agentId}.yml`)),
			settings: Settings.isolated({ "compaction.enabled": false, "advisor.enabled": false }),
		};
	}

	it("records a replayed command id once instead of rewriting the closed child again", async () => {
		const fixture = await historicalChild("HistoricalReplayChild");
		const args = {
			agentId: "HistoricalReplayChild",
			model: NEW_SELECTOR,
			requestedBy: "Main",
			commandId: "historical-cmd",
			parentSessionManager: fixture.parent,
			modelRegistry: fixture.modelRegistry,
			settings: fixture.settings,
		};

		const first = await hotswapAgentModel(args);
		expect(first.status).toBe("recorded");
		const afterFirst = await routeFootprint(fixture.childFile);
		expect(afterFirst.routeRecords).toBe(1);
		const recorded = await readChildRouteUpdateProjection(fixture.childFile);
		expect(recorded.applied?.requestId).toBe("historical-cmd");
		expect(recorded.applied?.appliedSelector).toBe(NEW_SELECTOR);

		const replay = await hotswapAgentModel(args);
		expect(replay.status).toBe("recorded");
		if (replay.status !== "recorded") throw new Error("expected recorded");
		expect(replay.to).toBe(NEW_SELECTOR);
		expect(await routeFootprint(fixture.childFile)).toEqual(afterFirst);
	}, 20_000);

	it("rejects a historical request minted under a superseded owner epoch", async () => {
		const fixture = await historicalChild("HistoricalStaleEpochChild");
		const before = await routeFootprint(fixture.childFile);

		const stale = await hotswapAgentModel({
			agentId: "HistoricalStaleEpochChild",
			model: NEW_SELECTOR,
			requestedBy: "Main",
			commandId: "historical-stale",
			expectedOwnerEpoch: NEXT_OWNER_EPOCH,
			parentSessionManager: fixture.parent,
			modelRegistry: fixture.modelRegistry,
			settings: fixture.settings,
		});
		expect(stale.status).toBe("failed");
		if (stale.status !== "failed") throw new Error("expected failure");
		expect(stale.reason).toBe("stale_owner_epoch");
		expect(await routeFootprint(fixture.childFile)).toEqual(before);
	}, 20_000);

	it("never reports an open historical request as recorded", async () => {
		const agentId = "HistoricalOpenPendingChild";
		const fixture = await historicalChild(agentId, async child => {
			await appendChildRouteUpdateRecord(
				child,
				createPendingChildRouteUpdate(
					request({ requestId: "historical-open", agentId, selector: NEW_SELECTOR, effort: null }),
				),
			);
		});
		expect((await readChildRouteUpdateProjection(fixture.childFile)).open?.state).toBe("pending");

		const result = await hotswapAgentModel({
			agentId,
			model: NEW_SELECTOR,
			requestedBy: "Main",
			commandId: "historical-open",
			parentSessionManager: fixture.parent,
			modelRegistry: fixture.modelRegistry,
			settings: fixture.settings,
		});

		// A closed child has no boundary left to finish that request, so reporting
		// it as recorded would claim a route change that never resolved.
		expect(result.status).toBe("failed");
		if (result.status !== "failed") throw new Error("expected failure");
		expect(result.reason).toBe("unavailable");
		expect(result.error).toContain("terminal_before_boundary");

		const settled = await readChildRouteUpdateProjection(fixture.childFile);
		expect(settled.open).toBeUndefined();
		expect(settled.byRequestId.get("historical-open")?.state).toBe("not_applied");
		// Reconciled, never rewritten: the closed journal kept its one route.
		expect(await routeFootprint(fixture.childFile)).toMatchObject({ modelChanges: 1, notices: 0 });
	}, 20_000);

	it("reconciles an in-doubt historical request from its durable route before answering", async () => {
		const agentId = "HistoricalInDoubtChild";
		const effort = (NEW_MODEL.reasoning ? getSupportedEfforts(NEW_MODEL) : []).at(-1) as string;
		expect(effort).toBeDefined();
		const fixture = await historicalChild(agentId, async child => {
			const pending = await appendChildRouteUpdateRecord(
				child,
				createPendingChildRouteUpdate(
					request({ requestId: "historical-indoubt", agentId, selector: NEW_SELECTOR, effort }),
				),
			);
			await appendChildRouteUpdateRecord(child, markChildRouteUpdateApplying(pending, OWNER_EPOCH));
			// The mutation landed; the process died before writing its receipt.
			child.appendModelChange(NEW_SELECTOR, "hotswap");
			child.appendThinkingLevelChange(effort);
			await child.flush();
		});
		expect((await readChildRouteUpdateProjection(fixture.childFile)).open?.state).toBe("applying");

		const result = await hotswapAgentModel({
			agentId,
			model: `${NEW_SELECTOR}:${effort}`,
			requestedBy: "Main",
			commandId: "historical-indoubt",
			parentSessionManager: fixture.parent,
			modelRegistry: fixture.modelRegistry,
			settings: fixture.settings,
		});
		expect(result.status).toBe("recorded");
		if (result.status !== "recorded") throw new Error("expected recorded");
		expect(result.to).toBe(NEW_SELECTOR);

		// Settled from the evidence already in the journal, and closed for good.
		const settled = await readChildRouteUpdateProjection(fixture.childFile);
		expect(settled.open).toBeUndefined();
		expect(settled.applied?.state).toBe("applied");
		expect(settled.applied?.appliedSelector).toBe(NEW_SELECTOR);
		expect(settled.applied?.appliedOwnerEpoch).toBe(OWNER_EPOCH);
		expect(await routeFootprint(fixture.childFile)).toMatchObject({
			modelChanges: 2,
			notices: 0,
			routeRecords: 3,
		});
	}, 20_000);

	it("publishes the historical route transition so status surfaces reload", async () => {
		const agentId = "HistoricalNotifyChild";
		const fixture = await historicalChild(agentId);
		const seen: ChildRouteUpdateNotification[] = [];
		const stop = onChildRouteUpdate(notification => {
			seen.push(notification);
		});
		try {
			const result = await hotswapAgentModel({
				agentId,
				model: NEW_SELECTOR,
				requestedBy: "Main",
				commandId: "historical-notify",
				parentSessionManager: fixture.parent,
				modelRegistry: fixture.modelRegistry,
				settings: fixture.settings,
			});
			expect(result.status).toBe("recorded");
		} finally {
			stop();
		}

		// The atomic historical rewrite is the only append that bypasses the record
		// writer, so without an explicit publish the Hub never learns the route moved.
		expect(seen).toHaveLength(1);
		expect(seen[0]?.agentId).toBe(agentId);
		expect(seen[0]?.record.state).toBe("applied");
		expect(seen[0]?.record.appliedSelector).toBe(NEW_SELECTOR);
		expect(path.resolve(seen[0]?.sessionFile ?? "")).toBe(path.resolve(fixture.childFile));
	}, 20_000);
});

describe("child route status honesty", () => {
	it("reports an unreadable child journal as unavailable rather than absent", async () => {
		const manager = await freshSession();
		const admission = admitChildRouteUpdate(childRouteUpdateProjection(manager), request(), OWNER_EPOCH);
		if (admission.status !== "append") throw new Error("expected append");
		await appendChildRouteUpdateRecord(manager, admission.record);
		const sessionFile = manager.getSessionFile() as string;
		await manager.close();

		await fs.chmod(sessionFile, 0o000);
		try {
			const report = await readChildRouteUpdateReport(sessionFile);
			expect(report?.availability).toBe("unavailable");
			expect(formatChildRouteUpdateReport(report)).toStartWith("route status unavailable (");
		} finally {
			await fs.chmod(sessionFile, 0o600);
		}

		// Readable again: the same pending request is reported, never silently dropped.
		const recovered = await readChildRouteUpdateReport(sessionFile);
		expect(recovered?.availability).toBe("known");
		expect(formatChildRouteUpdateReport(recovered)).toStartWith("route pending → ");
	});

	it("reports a corrupt route record instead of an empty status", async () => {
		const manager = await freshSession();
		manager.appendCustomEntry(CHILD_ROUTE_UPDATE_CUSTOM_TYPE, { version: 2, requestId: "" });
		await manager.ensureOnDisk();
		await manager.flush();
		const sessionFile = manager.getSessionFile() as string;
		await manager.close();

		const report = await readChildRouteUpdateReport(sessionFile);
		expect(report?.availability).toBe("corrupt");
		expect(formatChildRouteUpdateReport(report)).toStartWith("route status corrupt (");
	});

	it("answers with nothing only when the journal was read cleanly and holds no request", async () => {
		const manager = await freshSession();
		manager.appendCustomEntry("route-update-test-filler", { filler: "no route updates here" });
		await manager.ensureOnDisk();
		await manager.flush();
		const sessionFile = manager.getSessionFile() as string;
		await manager.close();

		expect(await readChildRouteUpdateReport(sessionFile)).toBeUndefined();
		expect(formatChildRouteUpdateReport(undefined)).toBeUndefined();
	});
});
