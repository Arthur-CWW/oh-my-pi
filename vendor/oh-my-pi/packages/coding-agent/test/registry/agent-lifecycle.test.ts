import { Database } from "bun:sqlite";
import { afterEach, beforeEach, describe, expect, it, vi } from "bun:test";
import * as fs from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";
import { AsyncJobManager } from "@oh-my-pi/pi-coding-agent/async/job-manager";
import { HostResourceAdmission } from "@oh-my-pi/pi-coding-agent/resource/host-resource-admission";
import { readProcessIdentity } from "@oh-my-pi/pi-coding-agent/resource/process-identity";
import { AgentLifecycleManager } from "@oh-my-pi/pi-coding-agent/registry/agent-lifecycle";
import { AgentRegistry, MAIN_AGENT_ID } from "@oh-my-pi/pi-coding-agent/registry/agent-registry";
import type { AgentSession } from "@oh-my-pi/pi-coding-agent/session/agent-session";
import { SessionManager } from "@oh-my-pi/pi-coding-agent/session/session-manager";
import { appendChildLifecycleRecord, type ChildLifecycleState } from "@oh-my-pi/pi-coding-agent/task/child-lifecycle";

interface SessionStub {
	session: AgentSession;
	disposeCalls: () => number;
	disposeOptions: () => unknown;
}

/** Minimal session: the lifecycle manager only ever calls dispose() on it. */
function makeSessionStub(dispose?: () => Promise<void>): SessionStub {
	let calls = 0;
	let options: unknown;
	const stub = {
		dispose: async (received?: unknown) => {
			calls++;
			options = received;
			await dispose?.();
		},
	};
	return { session: stub as unknown as AgentSession, disposeCalls: () => calls, disposeOptions: () => options };
}

interface TerminalSessionStub extends SessionStub {
	setStreaming: (value: boolean) => void;
}

function makeTerminalSessionStub(
	id: string,
	sessionFile: string,
	state: ChildLifecycleState = "completed",
	dispose?: () => Promise<void>,
): TerminalSessionStub {
	const sessionManager = SessionManager.inMemory();
	appendChildLifecycleRecord(sessionManager, {
		version: 1,
		agentId: id,
		childSessionFile: sessionFile,
		parentSessionFile: "/tmp/parent.jsonl",
		state,
		updatedAt: "2026-07-10T00:00:00.000Z",
	});
	let streaming = false;
	let calls = 0;
	let options: unknown;
	const session = {
		get isStreaming() {
			return streaming;
		},
		sessionManager,
		dispose: async (received?: unknown) => {
			calls++;
			options = received;
			await dispose?.();
		},
	} as unknown as AgentSession;
	return {
		session,
		disposeCalls: () => calls,
		disposeOptions: () => options,
		setStreaming: value => {
			streaming = value;
		},
	};
}

function deferred(): { promise: Promise<void>; resolve: () => void } {
	let resolve!: () => void;
	const promise = new Promise<void>(r => {
		resolve = r;
	});
	return { promise, resolve };
}

/** Settle the async park chain (timer callback → park() → dispose → setStatus). */
async function flushAsync(): Promise<void> {
	for (let i = 0; i < 5; i++) await Promise.resolve();
}

const TTL = 20;

let root: string;
let previousHome: string | undefined;
let previousControlDb: string | undefined;

function expectLeaseLifecycle(attemptCount: number): void {
	const db = new Database(path.join(root, "irc-bus.sqlite"), { readonly: true });
	try {
		const events = db
			.query<{ event: string }, []>("SELECT event FROM test_resource_lease_events ORDER BY rowid")
			.all()
			.map(row => row.event);
		expect(events).toEqual(
			Array.from({ length: attemptCount }, () => ["acquired", "released"]).flat(),
		);
	} finally {
		db.close();
	}
}

describe("AgentLifecycleManager", () => {
	let registry: AgentRegistry;
	let lifecycle: AgentLifecycleManager;

	beforeEach(async () => {
		root = await fs.mkdtemp(path.join(os.tmpdir(), "omp-revive-admission-"));
		previousHome = process.env.HOME;
		previousControlDb = process.env.OMP_SESSION_CONTROL_DB;
		process.env.HOME = root;
		process.env.OMP_SESSION_CONTROL_DB = path.join(root, "session-control.sqlite");
		AgentRegistry.resetGlobalForTests();
		AgentLifecycleManager.resetGlobalForTests();
		HostResourceAdmission.resetGlobalForTests();
		HostResourceAdmission.global({
			dbPath: path.join(root, "irc-bus.sqlite"),
			maxLiveAttempts: 1,
			queuePollMs: 5,
		});
		const audit = new Database(path.join(root, "irc-bus.sqlite"));
		audit.run("CREATE TABLE test_resource_lease_events (event TEXT NOT NULL, attempt_id TEXT NOT NULL)");
		audit.run(`
			CREATE TRIGGER test_resource_lease_acquired
			AFTER INSERT ON resource_leases
			BEGIN
				INSERT INTO test_resource_lease_events (event, attempt_id) VALUES ('acquired', NEW.attempt_id);
			END
		`);
		audit.run(`
			CREATE TRIGGER test_resource_lease_released
			AFTER DELETE ON resource_leases
			BEGIN
				INSERT INTO test_resource_lease_events (event, attempt_id) VALUES ('released', OLD.attempt_id);
			END
		`);
		audit.close();
		registry = AgentRegistry.global();
		lifecycle = AgentLifecycleManager.global();
	});
	afterEach(async () => {
		vi.useRealTimers();
		vi.restoreAllMocks();
		AgentLifecycleManager.resetGlobalForTests();
		AgentRegistry.resetGlobalForTests();
		AsyncJobManager.resetForTests();
		HostResourceAdmission.resetGlobalForTests();
		if (previousHome === undefined) delete process.env.HOME;
		else process.env.HOME = previousHome;
		if (previousControlDb === undefined) delete process.env.OMP_SESSION_CONTROL_DB;
		else process.env.OMP_SESSION_CONTROL_DB = previousControlDb;
		await fs.rm(root, { recursive: true, force: true });
	});

	function registerIdleSub(id: string, session: AgentSession | null, sessionFile: string | null = `/tmp/${id}.jsonl`) {
		return registry.register({ id, displayName: "task", kind: "sub", session, sessionFile, status: "idle" });
	}

	it("reconciles a terminal, dormant running orphan into parked", async () => {
		const id = "WindowRecorderPod";
		const sessionFile = "/tmp/WindowRecorderPod.jsonl";
		const stub = makeTerminalSessionStub(id, sessionFile);
		registry.register({
			id,
			displayName: "recorder",
			kind: "sub",
			session: stub.session,
			sessionFile,
			status: "running",
		});
		let unsubscribed = 0;
		lifecycle.adopt(id, { idleTtlMs: TTL, sessionSubscription: () => unsubscribed++ });
		expect(lifecycle.resourceCountsForTests()).toEqual({ liveSessions: 1, subscriptions: 1, timers: 1 });

		expect(await lifecycle.reconcileStaleOrphan(id)).toEqual({ reconciled: true });
		expect(stub.disposeCalls()).toBe(1);
		expect(stub.disposeOptions()).toEqual({ scope: "child" });
		expect(registry.get(id)).toEqual(expect.objectContaining({ status: "parked", session: null, sessionFile }));
		expect(unsubscribed).toBe(1);
		expect(lifecycle.resourceCountsForTests()).toEqual({ liveSessions: 0, subscriptions: 0, timers: 0 });
	});

	it("detaches a disposed stale orphan even if its status changes during disposal", async () => {
		const id = "WindowRecorderPod";
		const sessionFile = "/tmp/WindowRecorderPod.jsonl";
		const stub = makeTerminalSessionStub(id, sessionFile, "completed", async () => {
			registry.setStatus(id, "idle");
		});
		registry.register({
			id,
			displayName: "recorder",
			kind: "sub",
			session: stub.session,
			sessionFile,
			status: "running",
		});

		expect(await lifecycle.reconcileStaleOrphan(id)).toEqual({ reconciled: true });
		expect(registry.get(id)).toEqual(expect.objectContaining({ status: "parked", session: null }));
	});

	it("refuses stale-orphan parking while a model turn or owned async job is live", async () => {
		const id = "WindowRecorderPod";
		const sessionFile = "/tmp/WindowRecorderPod.jsonl";
		const stub = makeTerminalSessionStub(id, sessionFile);
		registry.register({
			id,
			displayName: "recorder",
			kind: "sub",
			session: stub.session,
			sessionFile,
			status: "running",
		});
		stub.setStreaming(true);

		expect(await lifecycle.reconcileStaleOrphan(id)).toEqual({ reconciled: false, reason: "live_model_turn" });
		expect(stub.disposeCalls()).toBe(0);
		stub.setStreaming(false);
		const manager = new AsyncJobManager({ onJobComplete: async () => {} });
		AsyncJobManager.setInstance(manager);
		const gate = deferred();
		manager.register(
			"task",
			"recording",
			async () => {
				await gate.promise;
				return "done";
			},
			{ ownerId: id },
		);

		expect(await lifecycle.reconcileStaleOrphan(id)).toEqual({ reconciled: false, reason: "live_async_job" });
		expect(stub.disposeCalls()).toBe(0);
		gate.resolve();
		await manager.waitForAll();
	});

	it("requires terminal evidence bound to the running peer session", async () => {
		const id = "WindowRecorderPod";
		const stub = makeTerminalSessionStub(id, "/tmp/old-session.jsonl");
		registry.register({
			id,
			displayName: "recorder",
			kind: "sub",
			session: stub.session,
			sessionFile: "/tmp/current-session.jsonl",
			status: "running",
		});

		expect(await lifecycle.reconcileStaleOrphan(id)).toEqual({
			reconciled: false,
			reason: "missing_terminal_evidence",
		});
		expect(stub.disposeCalls()).toBe(0);
	});

	it("rechecks model activity after flushing terminal evidence", async () => {
		const id = "WindowRecorderPod";
		const sessionFile = "/tmp/WindowRecorderPod.jsonl";
		const stub = makeTerminalSessionStub(id, sessionFile);
		registry.register({
			id,
			displayName: "recorder",
			kind: "sub",
			session: stub.session,
			sessionFile,
			status: "running",
		});
		const flushStarted = Promise.withResolvers<void>();
		const flushGate = deferred();
		vi.spyOn(stub.session.sessionManager, "flush").mockImplementation(async () => {
			flushStarted.resolve();
			await flushGate.promise;
		});

		const reconciling = lifecycle.reconcileStaleOrphan(id);
		await flushStarted.promise;
		stub.setStreaming(true);
		flushGate.resolve();

		expect(await reconciling).toEqual({ reconciled: false, reason: "live_model_turn" });
		expect(stub.disposeCalls()).toBe(0);
	});

	it("isReconcilableStaleOrphan reports terminal dormant orphans and refuses live work or missing evidence", () => {
		const terminal = makeTerminalSessionStub("Terminal", "/tmp/Terminal.jsonl");
		registry.register({
			id: "Terminal",
			displayName: "t",
			kind: "sub",
			session: terminal.session,
			sessionFile: "/tmp/Terminal.jsonl",
			status: "running",
		});
		lifecycle.adopt("Terminal", { idleTtlMs: 0 });
		expect(lifecycle.isReconcilableStaleOrphan("Terminal")).toBe(true);

		// Live model turn => not reconcilable.
		terminal.setStreaming(true);
		expect(lifecycle.isReconcilableStaleOrphan("Terminal")).toBe(false);
		terminal.setStreaming(false);

		// Terminal evidence bound to a different session file => not reconcilable.
		const mismatched = makeTerminalSessionStub("Mismatch", "/tmp/old.jsonl");
		registry.register({
			id: "Mismatch",
			displayName: "m",
			kind: "sub",
			session: mismatched.session,
			sessionFile: "/tmp/current.jsonl",
			status: "running",
		});
		expect(lifecycle.isReconcilableStaleOrphan("Mismatch")).toBe(false);

		// A still-live (idle) child is never a stale running orphan.
		const idle = makeSessionStub();
		registerIdleSub("Idle", idle.session);
		expect(lifecycle.isReconcilableStaleOrphan("Idle")).toBe(false);

		// Unknown id is not reconcilable.
		expect(lifecycle.isReconcilableStaleOrphan("Ghost")).toBe(false);
	});

	it("reconcileStaleOrphans parks every terminal dormant running orphan and leaves live ones running", async () => {
		const dead = makeTerminalSessionStub("Dead", "/tmp/Dead.jsonl", "completed");
		const rateLimited = makeTerminalSessionStub("RateLimited", "/tmp/RateLimited.jsonl", "failed");
		const busy = makeTerminalSessionStub("Busy", "/tmp/Busy.jsonl");
		registry.register({
			id: "Dead",
			displayName: "d",
			kind: "sub",
			session: dead.session,
			sessionFile: "/tmp/Dead.jsonl",
			status: "running",
		});
		registry.register({
			id: "RateLimited",
			displayName: "r",
			kind: "sub",
			session: rateLimited.session,
			sessionFile: "/tmp/RateLimited.jsonl",
			status: "running",
		});
		registry.register({
			id: "Busy",
			displayName: "b",
			kind: "sub",
			session: busy.session,
			sessionFile: "/tmp/Busy.jsonl",
			status: "running",
		});
		lifecycle.adopt("Dead", { idleTtlMs: 0 });
		lifecycle.adopt("RateLimited", { idleTtlMs: 0 });
		lifecycle.adopt("Busy", { idleTtlMs: 0 });
		busy.setStreaming(true);

		const parked = await lifecycle.reconcileStaleOrphans();

		expect(parked.sort()).toEqual(["Dead", "RateLimited"]);
		expect(registry.get("Dead")).toEqual(expect.objectContaining({ status: "parked", session: null }));
		expect(registry.get("RateLimited")).toEqual(expect.objectContaining({ status: "parked", session: null }));
		expect(registry.get("Busy")).toEqual(expect.objectContaining({ status: "running", session: busy.session }));
		expect(dead.disposeCalls()).toBe(1);
		expect(rateLimited.disposeCalls()).toBe(1);
		expect(busy.disposeCalls()).toBe(0);
	});

	it("rechecks owned async jobs after flushing terminal evidence", async () => {
		const id = "WindowRecorderPod";
		const sessionFile = "/tmp/WindowRecorderPod.jsonl";
		const stub = makeTerminalSessionStub(id, sessionFile);
		registry.register({
			id,
			displayName: "recorder",
			kind: "sub",
			session: stub.session,
			sessionFile,
			status: "running",
		});
		const flushStarted = Promise.withResolvers<void>();
		const flushGate = deferred();
		vi.spyOn(stub.session.sessionManager, "flush").mockImplementation(async () => {
			flushStarted.resolve();
			await flushGate.promise;
		});
		const manager = new AsyncJobManager({ onJobComplete: async () => {} });
		AsyncJobManager.setInstance(manager);

		const reconciling = lifecycle.reconcileStaleOrphan(id);
		await flushStarted.promise;
		const jobGate = deferred();
		manager.register(
			"task",
			"recording",
			async () => {
				await jobGate.promise;
				return "done";
			},
			{ ownerId: id },
		);
		flushGate.resolve();

		expect(await reconciling).toEqual({ reconciled: false, reason: "live_async_job" });
		expect(stub.disposeCalls()).toBe(0);
		jobGate.resolve();
		await manager.waitForAll();
	});

	it("adopt arms the TTL: an idle agent is parked — session disposed, ref + sessionFile retained", async () => {
		vi.useFakeTimers();
		const stub = makeSessionStub();
		registerIdleSub("1-Sub", stub.session, "/tmp/1-Sub.jsonl");
		lifecycle.adopt("1-Sub", { idleTtlMs: TTL });
		expect(lifecycle.resourceCountsForTests()).toEqual({ liveSessions: 1, subscriptions: 0, timers: 1 });

		vi.advanceTimersByTime(TTL);
		await flushAsync();

		const ref = registry.get("1-Sub");
		expect(stub.disposeCalls()).toBe(1);
		expect(ref?.status).toBe("parked");
		expect(ref?.session).toBeNull();
		expect(ref?.sessionFile).toBe("/tmp/1-Sub.jsonl");
		expect(lifecycle.has("1-Sub")).toBe(true);
		expect(lifecycle.resourceCountsForTests()).toEqual({ liveSessions: 0, subscriptions: 0, timers: 0 });
		expect(stub.disposeOptions()).toEqual({ scope: "child" });
	});

	it("counts and tears down only its child-owned status hook", async () => {
		const stub = makeSessionStub();
		let unsubscribed = 0;
		registerIdleSub("1a-Sub", stub.session);
		lifecycle.adopt("1a-Sub", {
			idleTtlMs: 0,
			sessionSubscription: () => {
				unsubscribed++;
			},
		});
		expect(lifecycle.resourceCountsForTests()).toEqual({ liveSessions: 1, subscriptions: 1, timers: 0 });

		await lifecycle.park("1a-Sub");

		expect(unsubscribed).toBe(1);
		expect(lifecycle.resourceCountsForTests()).toEqual({ liveSessions: 0, subscriptions: 0, timers: 0 });
	});

	it("running disarms the timer; returning to idle re-arms a fresh TTL", async () => {
		vi.useFakeTimers();
		const stub = makeSessionStub();
		registerIdleSub("2-Sub", stub.session);
		lifecycle.adopt("2-Sub", { idleTtlMs: TTL });
		registry.setStatus("2-Sub", "running");

		vi.advanceTimersByTime(TTL * 10);
		await flushAsync();
		expect(registry.get("2-Sub")?.status).toBe("running");
		expect(registry.get("2-Sub")?.session).toBe(stub.session);
		expect(stub.disposeCalls()).toBe(0);

		registry.setStatus("2-Sub", "idle");
		vi.advanceTimersByTime(TTL);
		await flushAsync();
		expect(registry.get("2-Sub")?.status).toBe("parked");
		expect(stub.disposeCalls()).toBe(1);
	});

	it("revives through the host authority and releases its lease exactly once when parked", async () => {
		const revived = makeSessionStub();
		registry.register({
			id: "3-Sub",
			displayName: "task",
			kind: "sub",
			session: null,
			sessionFile: "/tmp/3-Sub.jsonl",
			status: "parked",
		});
		lifecycle.adopt("3-Sub", { idleTtlMs: 0, revive: async () => revived.session });

		const session = await lifecycle.ensureLive("3-Sub");

		expect(session).toBe(revived.session);
		const ref = registry.get("3-Sub");
		expect(ref?.status).toBe("idle");
		expect(ref?.session).toBe(revived.session);
		expect(ref?.sessionFile).toBe("/tmp/3-Sub.jsonl");
		expect(HostResourceAdmission.global().inspect().leases).toHaveLength(1);
		lifecycle.adopt("3-Sub", { idleTtlMs: 0, revive: async () => revived.session });
		expect(HostResourceAdmission.global().inspect().leases).toHaveLength(1);

		await lifecycle.park("3-Sub");
		expect(registry.get("3-Sub")).toMatchObject({ status: "parked", session: null });
		expect(revived.disposeCalls()).toBe(1);
		expectLeaseLifecycle(1);

		await lifecycle.release("3-Sub");
		expectLeaseLifecycle(1);
	});

	it("keeps a failed admission-wait parked and releases admission when revival fails", async () => {
		const revived = makeSessionStub();
		const admission = HostResourceAdmission.global();
		const holderProcess = readProcessIdentity(process.pid)!;
		const held = await admission.acquire({
			attemptId: "held-spawn",
			kind: "spawn",
			sessionId: "parent-session",
			sessionOwnerEpoch: null,
			parentAgentId: MAIN_AGENT_ID,
			agentId: "held-child",
			jobId: "held-job",
			holderProcess,
			reservationBytes: 0,
		});
		const controller = new AbortController();
		let signal: AbortSignal | undefined = controller.signal;
		let attempt = 0;
		let reviverRuns = 0;
		registry.register({
			id: "3a-Sub",
			displayName: "task",
			kind: "sub",
			session: null,
			sessionFile: "/tmp/3a-Sub.jsonl",
			status: "parked",
		});
		lifecycle.adopt("3a-Sub", {
			idleTtlMs: 0,
			acquireResourceLease: () =>
				admission.acquire(
					{
						attemptId: `revive-${++attempt}`,
						kind: "revive",
						sessionId: "parent-session",
						sessionOwnerEpoch: null,
						parentAgentId: MAIN_AGENT_ID,
						agentId: "3a-Sub",
						jobId: `revive-job-${attempt}`,
						holderProcess,
						reservationBytes: 0,
					},
					{ signal },
				),
			revive: async () => {
				reviverRuns++;
				throw new Error("reviver failed");
			},
		});

		const cancelled = lifecycle.ensureLive("3a-Sub");
		expect(admission.inspect().waiters).toHaveLength(1);
		controller.abort(new Error("admission aborted"));
		await expect(cancelled).rejects.toThrow("Host resource admission was cancelled");
		expect(registry.get("3a-Sub")).toMatchObject({ status: "parked", session: null });
		expect(reviverRuns).toBe(0);
		expect(admission.inspect().waiters).toEqual([]);

		held.release();
		signal = undefined;
		await expect(lifecycle.ensureLive("3a-Sub")).rejects.toThrow("reviver failed");
		expect(registry.get("3a-Sub")).toMatchObject({ status: "parked", session: null });
		expect(admission.inspect()).toMatchObject({ leases: [], waiters: [] });
		expect(revived.disposeCalls()).toBe(0);
		expectLeaseLifecycle(2);
	});

	it("concurrent ensureLive calls during a slow revive coalesce into one reviver run", async () => {
		const gate = deferred();
		const revived = makeSessionStub();
		let reviverRuns = 0;
		registry.register({
			id: "4-Sub",
			displayName: "task",
			kind: "sub",
			session: null,
			sessionFile: "/tmp/4-Sub.jsonl",
			status: "parked",
		});
		lifecycle.adopt("4-Sub", {
			idleTtlMs: 0,
			revive: async () => {
				reviverRuns++;
				await gate.promise;
				return revived.session;
			},
		});

		const first = lifecycle.ensureLive("4-Sub");
		const second = lifecycle.ensureLive("4-Sub");
		gate.resolve();
		const [a, b] = await Promise.all([first, second]);

		expect(reviverRuns).toBe(1);
		expect(a).toBe(revived.session);
		expect(b).toBe(revived.session);
	});

	it("waits for a stale revival to dispose before release returns", async () => {
		const gate = deferred();
		const revived = makeSessionStub();
		registry.register({
			id: "4r-Sub",
			displayName: "task",
			kind: "sub",
			session: null,
			sessionFile: "/tmp/4r-Sub.jsonl",
			status: "parked",
		});
		lifecycle.adopt("4r-Sub", {
			idleTtlMs: 0,
			revive: async () => {
				await gate.promise;
				return revived.session;
			},
		});

		const waking = lifecycle.ensureLive("4r-Sub");
		const releasing = lifecycle.release("4r-Sub");
		gate.resolve();
		await expect(waking).rejects.toThrow(/released or replaced/);
		await releasing;

		expect(revived.disposeCalls()).toBe(1);
		expect(registry.get("4r-Sub")).toBeUndefined();
	});

	it("waits for an in-flight park before reviving, without returning the disposing session", async () => {
		const disposeGate = deferred();
		const parked = makeSessionStub(() => disposeGate.promise);
		const revived = makeSessionStub();
		let reviverRuns = 0;
		let initialSubscriptionDisposals = 0;
		let revivedSubscriptionDisposals = 0;
		registerIdleSub("4a-Sub", parked.session);
		lifecycle.adopt("4a-Sub", {
			idleTtlMs: 0,
			sessionSubscription: () => initialSubscriptionDisposals++,
			revive: async registerSubscription => {
				reviverRuns++;
				registerSubscription(() => revivedSubscriptionDisposals++);
				return revived.session;
			},
		});

		const parking = lifecycle.park("4a-Sub");
		const waking = lifecycle.ensureLive("4a-Sub");
		expect(lifecycle.isParking("4a-Sub")).toBe(true);
		expect(reviverRuns).toBe(0);
		expect(lifecycle.resourceCountsForTests()).toEqual({ liveSessions: 1, subscriptions: 0, timers: 0 });

		disposeGate.resolve();
		const session = await waking;
		await parking;

		expect(parked.disposeCalls()).toBe(1);
		expect(initialSubscriptionDisposals).toBe(1);
		expect(reviverRuns).toBe(1);
		expect(session).toBe(revived.session);
		expect(registry.get("4a-Sub")?.session).toBe(revived.session);
		expect(revivedSubscriptionDisposals).toBe(0);
		expect(lifecycle.resourceCountsForTests()).toEqual({ liveSessions: 1, subscriptions: 1, timers: 0 });
	});

	it("does not dispose a child that starts running while its parked snapshot flushes", async () => {
		const flushGate = deferred();
		let disposeCalls = 0;
		const session = {
			dispose: async () => {
				disposeCalls++;
			},
			sessionManager: {
				appendCustomEntry: () => "entry",
				flush: async () => flushGate.promise,
				getEntries: () => [],
				getSessionId: () => "stale-Sub",
			},
		} as unknown as AgentSession;
		registerIdleSub("stale-Sub", session);
		lifecycle.adopt("stale-Sub", { idleTtlMs: 0 });

		const parking = lifecycle.park("stale-Sub");
		registry.setStatus("stale-Sub", "running");
		flushGate.resolve();
		await parking;

		expect(disposeCalls).toBe(0);
		expect(registry.get("stale-Sub")).toEqual(expect.objectContaining({ status: "running", session }));
	});

	it("ensureLive on an unknown id throws and points at history://", async () => {
		await expect(lifecycle.ensureLive("9-Ghost")).rejects.toThrow(/history:\/\/9-Ghost/);
	});

	it("ensureLive on a parked agent without a reviver throws as not revivable", async () => {
		registry.register({ id: "5-Sub", displayName: "task", kind: "sub", session: null, status: "parked" });
		lifecycle.adopt("5-Sub", { idleTtlMs: 0 });

		await expect(lifecycle.ensureLive("5-Sub")).rejects.toThrow(/cannot be revived.*no reviver registered/);
	});

	it("release disposes a live adopted agent, unregisters it, and leaves no pending park", async () => {
		vi.useFakeTimers();
		const stub = makeSessionStub();
		registerIdleSub("6-Sub", stub.session);
		lifecycle.adopt("6-Sub", { idleTtlMs: TTL });

		await lifecycle.release("6-Sub");

		expect(stub.disposeCalls()).toBe(1);
		expect(registry.get("6-Sub")).toBeUndefined();
		expect(lifecycle.has("6-Sub")).toBe(false);

		// The disarmed timer must not fire a late park (which would double-dispose).
		vi.advanceTimersByTime(TTL * 10);
		await flushAsync();
		expect(stub.disposeCalls()).toBe(1);
		expect(registry.get("6-Sub")).toBeUndefined();
	});

	it("adopt(Main) is a no-op: Main is never adopted or parked", async () => {
		vi.useFakeTimers();
		const stub = makeSessionStub();
		registry.register({
			id: MAIN_AGENT_ID,
			displayName: "main",
			kind: "main",
			session: stub.session,
			status: "idle",
		});
		lifecycle.adopt(MAIN_AGENT_ID, { idleTtlMs: TTL });

		expect(lifecycle.has(MAIN_AGENT_ID)).toBe(false);
		vi.advanceTimersByTime(TTL * 10);
		await flushAsync();
		expect(registry.get(MAIN_AGENT_ID)?.status).toBe("idle");
		expect(registry.get(MAIN_AGENT_ID)?.session).toBe(stub.session);
		expect(stub.disposeCalls()).toBe(0);
	});

	it("publishes parked while dispose is in flight and detaches after it completes", async () => {
		const gate = deferred();
		const stub = makeSessionStub(() => gate.promise);
		registerIdleSub("7-Sub", stub.session);
		lifecycle.adopt("7-Sub", { idleTtlMs: 0 });

		// park() publishes the reservation-safe state before awaiting dispose.
		const parking = lifecycle.park("7-Sub");

		expect(stub.disposeCalls()).toBe(1);
		expect(lifecycle.isParking("7-Sub")).toBe(true);
		expect(registry.get("7-Sub")).toBeDefined();
		expect(registry.get("7-Sub")?.status).toBe("parked");

		gate.resolve();
		await parking;

		expect(lifecycle.isParking("7-Sub")).toBe(false);
		expect(registry.get("7-Sub")?.status).toBe("parked");
		expect(registry.get("7-Sub")?.session).toBeNull();
	});

	it("idleTtlMs <= 0 adopts without a timer: the agent never parks", async () => {
		vi.useFakeTimers();
		const stub = makeSessionStub();
		registerIdleSub("8-Sub", stub.session);
		lifecycle.adopt("8-Sub", { idleTtlMs: 0 });

		vi.advanceTimersByTime(60_000);
		await flushAsync();
		const ref = registry.get("8-Sub");
		expect(ref?.status).toBe("idle");
		expect(ref?.session).toBe(stub.session);
		expect(stub.disposeCalls()).toBe(0);
		expect(lifecycle.has("8-Sub")).toBe(true);
	});
});
