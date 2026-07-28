import { Database } from "bun:sqlite";
import { afterEach, beforeEach, describe, expect, it, vi } from "bun:test";
import * as fs from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";
import { AsyncJobManager } from "@oh-my-pi/pi-coding-agent/async/job-manager";
import { AgentLifecycleManager } from "@oh-my-pi/pi-coding-agent/registry/agent-lifecycle";
import { AgentRegistry, MAIN_AGENT_ID } from "@oh-my-pi/pi-coding-agent/registry/agent-registry";
import {
	type AdmissionSettingsSource,
	resolveGlobalHostResourceAdmission,
} from "@oh-my-pi/pi-coding-agent/resource/admission-bootstrap";
import {
	DEFAULT_ATTEMPT_RESERVATION_BYTES,
	HostAdmissionCorruptError,
	HostAdmissionRejectedError,
	HostResourceAdmission,
	type HostResourceLease,
} from "@oh-my-pi/pi-coding-agent/resource/host-resource-admission";
import { readProcessIdentity } from "@oh-my-pi/pi-coding-agent/resource/process-identity";
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

/**
 * Reason of a settled promise that must have rejected. Concurrent teardown
 * tests collect their promises through one `allSettled` before releasing the
 * gate, so neither rejection is ever momentarily unhandled.
 */
function rejectionOf(result: PromiseSettledResult<unknown>): unknown {
	expect(result.status).toBe("rejected");
	return (result as PromiseRejectedResult).reason;
}

/** Settle the async park chain (timer callback → park() → dispose → setStatus). */
async function flushAsync(): Promise<void> {
	for (let i = 0; i < 5; i++) await Promise.resolve();
}

const TTL = 20;

/**
 * Host capacity these tests reason about. Without it the profile is derived from
 * whatever machine or cgroup the suite runs inside: under a bounded cell the
 * derived budget collapses to exactly one child reservation, and every revival
 * here would hit hard pressure for reasons that have nothing to do with
 * lifecycle behaviour.
 */
const HERMETIC_HOST_PROBE = {
	systemMemoryBytes: 512 * 1_073_741_824,
	systemCpuCount: 128,
	warnings: [] as string[],
};

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
		expect(events).toEqual(Array.from({ length: attemptCount }, () => ["acquired", "released"]).flat());
	} finally {
		db.close();
	}
}

/**
 * Acquire/release totals, for flows where several children hold rows at once:
 * their events interleave, so the strict per-child order above cannot apply,
 * but every row must still be acquired once and handed back once.
 */
function leaseEventCounts(): { acquired: number; released: number } {
	const db = new Database(path.join(root, "irc-bus.sqlite"), { readonly: true });
	try {
		const rows = db
			.query<{ event: string; total: number }, []>(
				"SELECT event, COUNT(*) AS total FROM test_resource_lease_events GROUP BY event",
			)
			.all();
		const counts = { acquired: 0, released: 0 };
		for (const row of rows) {
			if (row.event === "acquired") counts.acquired = row.total;
			else if (row.event === "released") counts.released = row.total;
		}
		return counts;
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
			memoryBudgetBytes: DEFAULT_ATTEMPT_RESERVATION_BYTES * 2 - 1,
			queuePollMs: 5,
			sampleIntervalMs: 60_000,
			hostResourceProbe: HERMETIC_HOST_PROBE,
			coordinatorRoots: () => [],
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

	/**
	 * Run something while a real peer connection holds the authority's write
	 * lock past its busy timeout, so releases are refused by genuine contention
	 * rather than by a stubbed failure.
	 */
	async function withHostWriteLock<T>(run: () => Promise<T> | T): Promise<T> {
		const peer = new Database(path.join(root, "irc-bus.sqlite"));
		peer.run("BEGIN IMMEDIATE");
		try {
			return await run();
		} finally {
			peer.run("ROLLBACK");
			peer.close();
		}
	}

	/**
	 * Durable lease rows in the authority file itself. Read through an
	 * independent connection on purpose: a row this process owes back is exactly
	 * the thing a live authority object can be wrong about, and a blocked peer
	 * sees the file, not our bookkeeping.
	 */
	function durableLeaseRows(): number {
		const db = new Database(path.join(root, "irc-bus.sqlite"), { readonly: true });
		try {
			return db.query<{ rows: number }, []>("SELECT COUNT(*) AS rows FROM resource_leases").get()?.rows ?? 0;
		} finally {
			db.close();
		}
	}

	/**
	 * Wait for whatever owns the handback to finish, without asking it. Nothing
	 * here calls the lifecycle manager again: the point is that a row comes back
	 * on its owner's own schedule after the writer that refused it lets go.
	 *
	 * Real time, deliberately. The schedule under test runs on the platform
	 * clock against a real SQLite writer, and the evidence is a row disappearing
	 * from the file — a fake clock would drive neither.
	 */
	async function settledDurableLeaseRows(budgetMs = 15_000): Promise<number> {
		const deadline = Date.now() + budgetMs;
		let rows = durableLeaseRows();
		while (rows > 0 && Date.now() < deadline) {
			await Bun.sleep(10);
			rows = durableLeaseRows();
		}
		return rows;
	}

	/**
	 * Make SQLite raise the genuine corruption message on the exact statement a
	 * lease release runs, so the classification and the path are both real.
	 */
	function corruptLeaseReleases(trigger: string): void {
		const saboteur = new Database(path.join(root, "irc-bus.sqlite"));
		saboteur.run(`
			CREATE TRIGGER ${trigger} BEFORE DELETE ON resource_leases
			BEGIN SELECT RAISE(ABORT, 'database disk image is malformed'); END
		`);
		saboteur.close();
	}

	/** Budget for more than the single child the rest of these tests run under. */
	function useMultiChildAdmission(): void {
		HostResourceAdmission.resetGlobalForTests();
		HostResourceAdmission.global({
			dbPath: path.join(root, "irc-bus.sqlite"),
			memoryBudgetBytes: DEFAULT_ATTEMPT_RESERVATION_BYTES * 8,
			queuePollMs: 5,
			sampleIntervalMs: 60_000,
			hostResourceProbe: HERMETIC_HOST_PROBE,
			coordinatorRoots: () => [],
		});
	}

	/** Register a parked child and revive it so it holds exactly one host lease. */
	async function reviveParkedChild(id: string, dispose?: () => Promise<void>): Promise<SessionStub> {
		const stub = makeSessionStub(dispose);
		registry.register({
			id,
			displayName: "task",
			kind: "sub",
			session: null,
			sessionFile: `/tmp/${id}.jsonl`,
			status: "parked",
		});
		lifecycle.adopt(id, { idleTtlMs: 0, revive: async () => stub.session });
		await lifecycle.ensureLive(id);
		return stub;
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

	it("uses the configured host reservation for default revivals", async () => {
		HostResourceAdmission.resetGlobalForTests();
		const reservationBytes = DEFAULT_ATTEMPT_RESERVATION_BYTES * 2;
		HostResourceAdmission.global({
			dbPath: path.join(root, "custom-resource-authority.sqlite"),
			memoryBudgetBytes: reservationBytes * 2,
			childReservationBytes: reservationBytes,
			coordinatorRoots: () => [],
			queuePollMs: 5,
			sampleIntervalMs: 60_000,
			hostResourceProbe: HERMETIC_HOST_PROBE,
		});
		const revived = makeSessionStub();
		registry.register({
			id: "3b-Sub",
			displayName: "task",
			kind: "sub",
			session: null,
			sessionFile: "/tmp/3b-Sub.jsonl",
			status: "parked",
		});
		lifecycle.adopt("3b-Sub", { idleTtlMs: 0, revive: async () => revived.session });

		await lifecycle.ensureLive("3b-Sub");

		expect(HostResourceAdmission.global().inspect().leases[0]?.reservationBytes).toBe(reservationBytes);
		await lifecycle.park("3b-Sub");
	});

	it("refuses a revival-first admission instead of installing a default-budget authority", async () => {
		HostResourceAdmission.resetGlobalForTests();
		const revived = makeSessionStub();
		registry.register({
			id: "3c-Sub",
			displayName: "task",
			kind: "sub",
			session: null,
			sessionFile: "/tmp/3c-Sub.jsonl",
			status: "parked",
		});
		lifecycle.adopt("3c-Sub", { idleTtlMs: 0, revive: async () => revived.session });

		await expect(lifecycle.ensureLive("3c-Sub")).rejects.toThrow(/initialized settings/);
		expect(HostResourceAdmission.hasGlobal()).toBe(false);
		expect(registry.get("3c-Sub")).toMatchObject({ status: "parked", session: null });
	});

	it("revives under the configured global admission budgets, not the built-in defaults", async () => {
		HostResourceAdmission.resetGlobalForTests();
		const reservationBytes = DEFAULT_ATTEMPT_RESERVATION_BYTES * 3;
		const configured = {
			getGlobal: (key: string) =>
				key === "task.globalAdmission.attemptReservationBytes"
					? reservationBytes
					: key === "task.globalAdmission.memoryBudgetBytes"
						? reservationBytes * 4
						: 0,
		} as unknown as AdmissionSettingsSource;
		const admission = resolveGlobalHostResourceAdmission({
			onPressure: async () => {},
			settings: configured,
			hostResourceProbe: HERMETIC_HOST_PROBE,
		});
		expect(admission.childReservationBytes).toBe(reservationBytes);

		const revived = makeSessionStub();
		registry.register({
			id: "3d-Sub",
			displayName: "task",
			kind: "sub",
			session: null,
			sessionFile: "/tmp/3d-Sub.jsonl",
			status: "parked",
		});
		lifecycle.adopt("3d-Sub", { idleTtlMs: 0, revive: async () => revived.session });

		await lifecycle.ensureLive("3d-Sub");

		// The revive path reused the configured authority; it did not re-create one
		// with default budgets, so the lease carries the configured reservation.
		expect(admission.inspect().leases[0]?.reservationBytes).toBe(reservationBytes);
		expect(HostResourceAdmission.global()).toBe(admission);
		await lifecycle.park("3d-Sub");
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
			reservationBytes: DEFAULT_ATTEMPT_RESERVATION_BYTES,
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
						reservationBytes: DEFAULT_ATTEMPT_RESERVATION_BYTES,
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

	it("settles a deferred revive with a typed refusal when the authority closes mid-admission", async () => {
		const admission = HostResourceAdmission.global();
		const holderProcess = readProcessIdentity(process.pid)!;
		// The budget fits exactly one reservation, so this lease makes the revive
		// below queue instead of being granted.
		await admission.acquire({
			attemptId: "close-race-holder",
			kind: "spawn",
			sessionId: "parent-session",
			sessionOwnerEpoch: null,
			parentAgentId: MAIN_AGENT_ID,
			agentId: "close-race-child",
			jobId: "close-race-job",
			holderProcess,
			reservationBytes: DEFAULT_ATTEMPT_RESERVATION_BYTES,
		});
		const queued = deferred();
		const revived = makeSessionStub();
		registry.register({
			id: "3e-Sub",
			displayName: "task",
			kind: "sub",
			session: null,
			sessionFile: "/tmp/3e-Sub.jsonl",
			status: "parked",
		});
		lifecycle.adopt("3e-Sub", {
			idleTtlMs: 0,
			acquireResourceLease: () =>
				admission.acquire(
					{
						attemptId: "close-race-revive",
						kind: "revive",
						sessionId: "parent-session",
						sessionOwnerEpoch: null,
						parentAgentId: MAIN_AGENT_ID,
						agentId: "3e-Sub",
						jobId: "close-race-revive-job",
						holderProcess,
						reservationBytes: DEFAULT_ATTEMPT_RESERVATION_BYTES,
					},
					{ onDeferred: () => queued.resolve() },
				),
			revive: async () => revived.session,
		});

		const pending = lifecycle.ensureLive("3e-Sub");
		// Deterministic barrier: the revive is queued and deferred, so the close
		// below lands squarely inside its reconcile/poll loop.
		await queued.promise;
		HostResourceAdmission.resetGlobalForTests();

		await expect(pending).rejects.toThrow(/Host resource authority is clos/);
		expect(registry.get("3e-Sub")).toMatchObject({ status: "parked", session: null });
		expect(revived.disposeCalls()).toBe(0);
		// Repeating the reset over an already-closed authority stays a no-op.
		HostResourceAdmission.resetGlobalForTests();
		expect(HostResourceAdmission.hasGlobal()).toBe(false);
	});

	it("parks an idle agent without an unhandled rejection after the authority is reset", async () => {
		const revived = makeSessionStub();
		registry.register({
			id: "3f-Sub",
			displayName: "task",
			kind: "sub",
			session: null,
			sessionFile: "/tmp/3f-Sub.jsonl",
			status: "parked",
		});
		lifecycle.adopt("3f-Sub", { idleTtlMs: 0, revive: async () => revived.session });
		await lifecycle.ensureLive("3f-Sub");

		// The lease now outlives its authority; cleanup must absorb that instead
		// of rejecting into the timer callback that nobody awaits.
		HostResourceAdmission.resetGlobalForTests();
		await lifecycle.park("3f-Sub");

		expect(registry.get("3f-Sub")).toMatchObject({ status: "parked", session: null });
		expect(revived.disposeCalls()).toBe(1);
	});

	it("cleans up a revive lease whose authority closed between acquire and failure", async () => {
		const admission = HostResourceAdmission.global();
		const holderProcess = readProcessIdentity(process.pid)!;
		registry.register({
			id: "3g-Sub",
			displayName: "task",
			kind: "sub",
			session: null,
			sessionFile: "/tmp/3g-Sub.jsonl",
			status: "parked",
		});
		let leased: HostResourceLease | undefined;
		lifecycle.adopt("3g-Sub", {
			idleTtlMs: 0,
			acquireResourceLease: async () => {
				leased = await admission.acquire({
					attemptId: "close-mid-revive",
					kind: "revive",
					sessionId: "parent-session",
					sessionOwnerEpoch: null,
					parentAgentId: MAIN_AGENT_ID,
					agentId: "3g-Sub",
					jobId: "close-mid-revive-job",
					holderProcess,
					reservationBytes: DEFAULT_ATTEMPT_RESERVATION_BYTES,
				});
				return leased;
			},
			revive: async () => {
				// The authority disappears while this revive is in flight, exactly
				// as it does when the process tears down around a wake.
				HostResourceAdmission.resetGlobalForTests();
				throw new Error("reviver exploded");
			},
		});

		// Unwinding cleanup reports the failure that actually broke the revive
		// rather than replacing it with an authority error its own release raised.
		await expect(lifecycle.ensureLive("3g-Sub")).rejects.toThrow("reviver exploded");
		expect(registry.get("3g-Sub")).toMatchObject({ status: "parked", session: null });
		expect(leased?.release()).toBe("released");
	});

	it("raises a corrupt host database found while releasing a lease instead of logging it away", async () => {
		const revived = await reviveParkedChild("3h-Sub");
		expect(HostResourceAdmission.global().inspect().leases).toHaveLength(1);

		corruptLeaseReleases("test_corrupt_on_release");

		await expect(lifecycle.park("3h-Sub")).rejects.toThrow(HostAdmissionCorruptError);
		expect(registry.get("3h-Sub")).toMatchObject({ status: "parked", session: null });
		expect(revived.disposeCalls()).toBe(1);
	});

	it("unregisters a released agent before a corrupt lease release escapes", async () => {
		const revived = await reviveParkedChild("3i-Sub");
		expect(HostResourceAdmission.global().inspect().leases).toHaveLength(1);

		corruptLeaseReleases("test_corrupt_on_release");

		await expect(lifecycle.release("3i-Sub")).rejects.toThrow(HostAdmissionCorruptError);

		// Removal finished around the failure: a damaged host database must not
		// leave a released agent registered around a session already disposed.
		expect(registry.get("3i-Sub")).toBeUndefined();
		expect(revived.disposeCalls()).toBe(1);
		expect(lifecycle.has("3i-Sub")).toBe(false);
		expect(lifecycle.resourceCountsForTests()).toEqual({ liveSessions: 0, subscriptions: 0, timers: 0 });
	});

	it("finishes detaching every adopted agent before raising the corruption it found", async () => {
		useMultiChildAdmission();
		const ids = ["3j-One", "3j-Two"];
		for (const id of ids) await reviveParkedChild(id);
		expect(HostResourceAdmission.global().inspect().leases).toHaveLength(2);

		corruptLeaseReleases("test_corrupt_on_detach");

		let failure: unknown;
		try {
			await lifecycle.detach();
		} catch (error) {
			failure = error;
		}

		// Neither lease skipped the other, and no adopted record survived: one
		// damaged database cannot leave half this manager's bookkeeping installed.
		expect(failure).toBeInstanceOf(AggregateError);
		const errors = (failure as AggregateError).errors;
		expect(errors).toHaveLength(2);
		expect(errors.every(error => error instanceof HostAdmissionCorruptError)).toBe(true);
		for (const id of ids) expect(lifecycle.has(id)).toBe(false);
		expect(lifecycle.resourceCountsForTests()).toEqual({ liveSessions: 0, subscriptions: 0, timers: 0 });
	});

	it("keeps a contended park's lease retryable so the next cleanup hands the slot back", async () => {
		const revived = await reviveParkedChild("3k-Sub");

		await withHostWriteLock(() => lifecycle.park("3k-Sub"));

		// Park still completed and the slot was not stranded: the refused handle
		// is still owned by this manager instead of being dropped against a row
		// this live process holds and expiry reaping refuses to reclaim.
		expect(registry.get("3k-Sub")).toMatchObject({ status: "parked", session: null });
		expect(revived.disposeCalls()).toBe(1);
		expect(HostResourceAdmission.global().inspect().leases).toHaveLength(1);

		await lifecycle.release("3k-Sub");

		expect(HostResourceAdmission.global().inspect().leases).toEqual([]);
		// One acquire, one delete: the refused release never removed a row.
		expectLeaseLifecycle(1);
		expect(lifecycle.pendingLeaseCountForTests()).toBe(0);
	}, 20_000);

	it("settles an in-flight park before detach finishes the rest of its bookkeeping", async () => {
		useMultiChildAdmission();
		const gate = deferred();
		const disposing = Promise.withResolvers<void>();
		await reviveParkedChild("3l-Parking", async () => {
			disposing.resolve();
			await gate.promise;
		});
		await reviveParkedChild("3l-Adopted");
		expect(HostResourceAdmission.global().inspect().leases).toHaveLength(2);

		// The park is suspended inside dispose when detach starts, so the only
		// way detach can see its corruption is by waiting for it to settle.
		const parking = lifecycle.park("3l-Parking");
		await disposing.promise;
		corruptLeaseReleases("test_corrupt_mid_detach");
		const detaching = lifecycle.detach();
		const outcomes = Promise.allSettled([parking, detaching]);
		gate.resolve();
		const [parkOutcome, detachOutcome] = await outcomes;

		expect(rejectionOf(parkOutcome)).toBeInstanceOf(HostAdmissionCorruptError);
		const failure = rejectionOf(detachOutcome);

		// Both failures are reported and the second agent was still released: a
		// rejection in flight cannot cancel the teardown that had not run yet.
		expect(failure).toBeInstanceOf(AggregateError);
		const errors = (failure as AggregateError).errors;
		expect(errors).toHaveLength(2);
		expect(errors.every(error => error instanceof HostAdmissionCorruptError)).toBe(true);
		expect(lifecycle.has("3l-Parking")).toBe(false);
		expect(lifecycle.has("3l-Adopted")).toBe(false);
		expect(lifecycle.resourceCountsForTests()).toEqual({ liveSessions: 0, subscriptions: 0, timers: 0 });
	});

	it("keeps a contended hard release retryable after the record and registry entry are gone", async () => {
		await reviveParkedChild("3m-Sub");

		// The lock outlives the release attempt, so the handle is refused after
		// #release has already deleted the only adopted record pointing at it.
		await withHostWriteLock(() => lifecycle.release("3m-Sub"));

		expect(registry.get("3m-Sub")).toBeUndefined();
		expect(lifecycle.has("3m-Sub")).toBe(false);
		// Expiry reaping needs the holder proven dead, and this process is alive:
		// the retained handle is the only thing that can hand the slot back.
		expect(HostResourceAdmission.global().inspect().leases).toHaveLength(1);

		await lifecycle.detach();

		expect(HostResourceAdmission.global().inspect().leases).toEqual([]);
		expectLeaseLifecycle(1);
		expect(lifecycle.pendingLeaseCountForTests()).toBe(0);
	}, 20_000);

	it("retains retry ownership of a contended lease the registry removed underneath it", async () => {
		await reviveParkedChild("3n-Sub");

		// Nothing calls release(): the registry removal alone drops the adopted
		// record, from a listener that has no caller to hand a failure to.
		await withHostWriteLock(() => {
			registry.unregister("3n-Sub");
		});

		expect(lifecycle.has("3n-Sub")).toBe(false);
		expect(HostResourceAdmission.global().inspect().leases).toHaveLength(1);

		await lifecycle.dispose();

		expect(HostResourceAdmission.global().inspect().leases).toEqual([]);
		expectLeaseLifecycle(1);
		expect(lifecycle.pendingLeaseCountForTests()).toBe(0);
	}, 20_000);

	it("hands a contended lease back before a revival acquires its replacement", async () => {
		// A budget wide enough for two rows to coexist. They must not: the
		// revival drains the stranded handle before it acquires a new one.
		useMultiChildAdmission();
		const stub = await reviveParkedChild("3o-Sub");

		await withHostWriteLock(() => lifecycle.park("3o-Sub"));
		expect(HostResourceAdmission.global().inspect().leases).toHaveLength(1);

		await lifecycle.ensureLive("3o-Sub");

		// One row, not two: the stranded handle was handed back before the
		// replacement lease was acquired, not overwritten by it.
		expect(HostResourceAdmission.global().inspect().leases).toHaveLength(1);
		expect(stub.disposeCalls()).toBe(1);

		await lifecycle.release("3o-Sub");

		expect(HostResourceAdmission.global().inspect().leases).toEqual([]);
		// Two acquires, two deletes: the revived lease did not leave a row behind.
		expectLeaseLifecycle(2);
		expect(lifecycle.pendingLeaseCountForTests()).toBe(0);
	}, 20_000);

	it("refuses a revival instead of granting a second row while the child's own lease is still open", async () => {
		// Budget for two rows: nothing but this manager stops one child from
		// owning a stranded handle and its replacement at the same time.
		useMultiChildAdmission();
		const admission = HostResourceAdmission.global();
		const holderProcess = readProcessIdentity(process.pid)!;
		const stub = makeSessionStub();
		registry.register({
			id: "3r-Sub",
			displayName: "task",
			kind: "sub",
			session: null,
			sessionFile: "/tmp/3r-Sub.jsonl",
			status: "parked",
		});
		const writer = new Database(path.join(root, "irc-bus.sqlite"));
		let holdingLock = false;
		let acquires = 0;
		lifecycle.adopt("3r-Sub", {
			idleTtlMs: 0,
			revive: async () => stub.session,
			acquireResourceLease: () => {
				acquires++;
				// The competing writer lets go between the refused release and
				// this acquire: the exact window in which granting on top of an
				// open handle leaves one live child owning two durable rows.
				if (holdingLock) {
					writer.run("ROLLBACK");
					holdingLock = false;
				}
				return admission.acquire({
					attemptId: `3r-revive-${acquires}`,
					kind: "revive",
					sessionId: MAIN_AGENT_ID,
					sessionOwnerEpoch: null,
					parentAgentId: MAIN_AGENT_ID,
					agentId: "3r-Sub",
					jobId: `3r-revive-job-${acquires}`,
					holderProcess,
					reservationBytes: DEFAULT_ATTEMPT_RESERVATION_BYTES,
				});
			},
		});
		await lifecycle.ensureLive("3r-Sub");
		expect(acquires).toBe(1);

		try {
			writer.run("BEGIN IMMEDIATE");
			holdingLock = true;
			await lifecycle.park("3r-Sub");
			expect(lifecycle.pendingLeaseCountForTests()).toBe(1);

			const failure = await lifecycle.ensureLive("3r-Sub").then(
				() => undefined,
				(error: unknown) => error,
			);

			// Bounded retries ran out against a writer that never let go, so the
			// revival stopped at the row it still owes instead of asking for a
			// second one — and said so in a way the caller can retry.
			expect(failure).toBeInstanceOf(HostAdmissionRejectedError);
			expect((failure as HostAdmissionRejectedError).reason).toBe("authority-unavailable");
			// Nothing was asked of the authority: the revival stopped at the row
			// it still owes rather than reaching for a second one.
			expect(acquires).toBe(1);
			expect(registry.get("3r-Sub")).toMatchObject({ status: "parked", session: null });
			expect(lifecycle.pendingLeaseCountForTests()).toBe(1);
		} finally {
			if (holdingLock) writer.run("ROLLBACK");
			holdingLock = false;
			writer.close();
		}

		// One live child, one durable row — the original, never a second grant.
		expect(HostResourceAdmission.global().inspect().leases).toHaveLength(1);

		// With the writer gone the child's own slot is reused, never doubled.
		await lifecycle.ensureLive("3r-Sub");
		expect(acquires).toBe(2);
		expect(HostResourceAdmission.global().inspect().leases).toHaveLength(1);
		expect(lifecycle.pendingLeaseCountForTests()).toBe(0);

		await lifecycle.release("3r-Sub");

		expect(HostResourceAdmission.global().inspect().leases).toEqual([]);
		expectLeaseLifecycle(2);
	}, 60_000);

	it("hands an open lease to the next manager instead of dropping it on reset", async () => {
		// Single-row budget: this is the whole host slot, so a reset that drops
		// the handle strands the process's only capacity behind a live PID.
		await reviveParkedChild("3s-Sub");

		await withHostWriteLock(async () => {
			await lifecycle.park("3s-Sub");
			expect(lifecycle.pendingLeaseCountForTests()).toBe(1);
			// The manager is discarded while the authority is still refusing.
			AgentLifecycleManager.resetGlobalForTests();
		});

		// Expiry reaping will not touch a row whose holder is provably alive, so
		// the handle is the only way this slot ever comes back.
		expect(HostResourceAdmission.global().inspect().leases).toHaveLength(1);

		const next = AgentLifecycleManager.global();
		expect(next.pendingLeaseCountForTests()).toBe(1);

		await next.dispose();

		expect(HostResourceAdmission.global().inspect().leases).toEqual([]);
		expect(next.pendingLeaseCountForTests()).toBe(0);
		expectLeaseLifecycle(1);
	}, 40_000);

	it("reports host-pressure relief only once a blocked waiter's slot is genuinely back", async () => {
		// Single-row budget: the waiter below cannot be granted until this
		// child's durable row is actually deleted.
		const stub = await reviveParkedChild("3t-Sub");
		const admission = HostResourceAdmission.global();
		const holderProcess = readProcessIdentity(process.pid)!;

		const stalled = await withHostWriteLock(() => lifecycle.reclaimIdleChildrenForHostPressure());

		// The child parked and its session went away, but the authority refused
		// the lease: no host slot came back, so the doorbell reports no relief
		// instead of an optimistic child count.
		expect(stalled).toBe(0);
		expect(stub.disposeCalls()).toBe(1);
		expect(registry.get("3t-Sub")).toMatchObject({ status: "parked", session: null });
		expect(lifecycle.pendingLeaseCountForTests()).toBe(1);
		expect(admission.inspect().leases).toHaveLength(1);

		// A real waiter queues behind that row. Nothing else can free it: the
		// child is already parked, so a later doorbell has nothing left to park.
		const waiting = admission.acquire({
			attemptId: "3t-waiter",
			kind: "spawn",
			sessionId: MAIN_AGENT_ID,
			sessionOwnerEpoch: null,
			parentAgentId: MAIN_AGENT_ID,
			agentId: "3t-Waiter",
			jobId: "3t-waiter-job",
			holderProcess,
			reservationBytes: DEFAULT_ATTEMPT_RESERVATION_BYTES,
		});

		const relieved = await lifecycle.reclaimIdleChildrenForHostPressure();

		// One slot, actually handed back, actually reported.
		expect(relieved).toBe(1);
		expect(lifecycle.pendingLeaseCountForTests()).toBe(0);

		const lease = await waiting;
		expect(admission.inspect().leases).toHaveLength(1);
		lease.release();

		expect(admission.inspect().leases).toEqual([]);
		expectLeaseLifecycle(2);
	}, 40_000);

	it("keeps owning a lease whose release only finished after the manager was reset", async () => {
		const stub = makeSessionStub();
		const reviving = Promise.withResolvers<void>();
		const gate = deferred();
		registry.register({
			id: "3u-Sub",
			displayName: "task",
			kind: "sub",
			session: null,
			sessionFile: "/tmp/3u-Sub.jsonl",
			status: "parked",
		});
		lifecycle.adopt("3u-Sub", {
			idleTtlMs: 0,
			revive: async () => {
				reviving.resolve();
				await gate.promise;
				return stub.session;
			},
		});

		const waking = lifecycle.ensureLive("3u-Sub");
		// Admission happens before the reviver runs: the row exists, and no
		// adopted record points at it yet.
		await reviving.promise;
		expect(durableLeaseRows()).toBe(1);

		const failure = await withHostWriteLock(async () => {
			// The manager is discarded mid-revive. Everything it was holding is
			// cleared here — but this revive's cleanup has not run yet, so the
			// snapshot taken now cannot possibly contain its row.
			AgentLifecycleManager.resetGlobalForTests();
			gate.resolve();
			return await waking.then(
				() => undefined,
				(error: unknown) => error,
			);
		});

		expect(failure).toBeInstanceOf(Error);
		// Expiry reaping refuses a slot whose holder is provably alive, so this
		// row comes back through the process that owns it or not at all.
		expect(durableLeaseRows()).toBe(1);
		expect(AgentLifecycleManager.global().pendingLeaseCountForTests()).toBe(1);

		expect(await settledDurableLeaseRows()).toBe(0);
		expect(AgentLifecycleManager.global().pendingLeaseCountForTests()).toBe(0);
		expectLeaseLifecycle(1);
	}, 40_000);

	it("hands a refused row back through a reopened authority after the granting one closed", async () => {
		await reviveParkedChild("3v-Sub");
		expect(durableLeaseRows()).toBe(1);

		await withHostWriteLock(async () => {
			await lifecycle.park("3v-Sub");
			expect(lifecycle.pendingLeaseCountForTests()).toBe(1);
			// The authority that granted the row goes away while the row is still
			// owed. Its handle stops speaking for that row; the row stays granted
			// to this live process.
			HostResourceAdmission.resetGlobalForTests();
		});

		expect(durableLeaseRows()).toBe(1);

		// Nothing calls the manager, and nothing in this process is bound to that
		// database any more. The row still comes back.
		expect(await settledDurableLeaseRows()).toBe(0);
		expect(lifecycle.pendingLeaseCountForTests()).toBe(0);
		expectLeaseLifecycle(1);
	}, 40_000);

	it("answers a pressure doorbell without stalling the event loop on a refusing authority", async () => {
		useMultiChildAdmission();
		for (const id of ["3w-One", "3w-Two"]) await reviveParkedChild(id);
		expect(durableLeaseRows()).toBe(2);

		// Real timers, deliberately: the property is that the platform clock keeps
		// advancing callbacks while a real writer holds the authority's lock. The
		// stall this has to catch is a synchronous block, which a fake clock
		// cannot experience.
		let previousTick = Date.now();
		let maxGapMs = 0;
		const heartbeat = setInterval(() => {
			const now = Date.now();
			maxGapMs = Math.max(maxGapMs, now - previousTick);
			previousTick = now;
		}, 10);
		let elapsedMs = 0;
		let relieved = -1;
		try {
			previousTick = Date.now();
			const started = Date.now();
			relieved = await withHostWriteLock(() => lifecycle.reclaimIdleChildrenForHostPressure());
			elapsedMs = Date.now() - started;
		} finally {
			clearInterval(heartbeat);
		}

		// Two refused handbacks. Waiting out the authority's busy budget for each
		// one, on the thread every timer in this process runs on, is how a
		// fire-and-forget doorbell turns into seconds of dead queue polls.
		expect(maxGapMs).toBeLessThan(1_000);
		expect(elapsedMs).toBeLessThan(2_000);
		// Nothing came back while the writer held the lock, and it said so.
		expect(relieved).toBe(0);
		expect(lifecycle.pendingLeaseCountForTests()).toBe(2);

		// Both rows back, each exactly once. Their acquires interleave, so the
		// per-child lifecycle order this suite asserts elsewhere does not apply.
		expect(await settledDurableLeaseRows()).toBe(0);
		expect(leaseEventCounts()).toEqual({ acquired: 2, released: 2 });
	}, 60_000);

	it("reports the slots its own pressure reclaim handed back, not every row that vanished during it", async () => {
		useMultiChildAdmission();
		const gate = deferred();
		const disposing = Promise.withResolvers<void>();
		await reviveParkedChild("3x-Idle", async () => {
			disposing.resolve();
			await gate.promise;
		});
		await reviveParkedChild("3x-Bystander");
		// Live work: the doorbell parks idle children and leaves this one alone,
		// so the row it holds is never this reclaim's to hand back.
		registry.setStatus("3x-Bystander", "running");
		expect(durableLeaseRows()).toBe(2);

		const doorbell = lifecycle.reclaimIdleChildrenForHostPressure();
		await disposing.promise;
		// A hard removal returns its own row while the doorbell is suspended
		// inside a park. That slot is relief the doorbell did not produce.
		await lifecycle.release("3x-Bystander");
		expect(durableLeaseRows()).toBe(1);
		gate.resolve();

		expect(await doorbell).toBe(1);
		expect(durableLeaseRows()).toBe(0);
		expect(lifecycle.pendingLeaseCountForTests()).toBe(0);
		expect(leaseEventCounts()).toEqual({ acquired: 2, released: 2 });
	}, 40_000);

	it("serves concurrent pressure doorbells from one reclaim of the same rows", async () => {
		await reviveParkedChild("3y-Sub");
		// One refused row, and the child is already parked: there is nothing left
		// to park, so both doorbells are racing over exactly this slot.
		await withHostWriteLock(() => lifecycle.park("3y-Sub"));
		expect(lifecycle.pendingLeaseCountForTests()).toBe(1);
		expect(durableLeaseRows()).toBe(1);

		const first = lifecycle.reclaimIdleChildrenForHostPressure();
		const second = lifecycle.reclaimIdleChildrenForHostPressure();

		// One invocation, not two snapshots of one slot each claiming it.
		expect(second).toBe(first);
		expect(await first).toBe(1);
		expect(await second).toBe(1);
		expect(durableLeaseRows()).toBe(0);
		// The slot is already back, so the doorbell after it has nothing to claim.
		expect(await lifecycle.reclaimIdleChildrenForHostPressure()).toBe(0);
		expectLeaseLifecycle(1);
	}, 40_000);

	it("finishes a hard release the authority refused, with no further lifecycle call", async () => {
		await reviveParkedChild("3z-Sub");

		await withHostWriteLock(() => lifecycle.release("3z-Sub"));

		expect(registry.get("3z-Sub")).toBeUndefined();
		expect(lifecycle.has("3z-Sub")).toBe(false);
		expect(lifecycle.pendingLeaseCountForTests()).toBe(1);
		expect(durableLeaseRows()).toBe(1);

		// Terminal removal already ran. Nothing will call this manager again, so
		// the retry that returns the slot has to belong to something else.
		expect(await settledDurableLeaseRows()).toBe(0);
		expect(lifecycle.pendingLeaseCountForTests()).toBe(0);
		expectLeaseLifecycle(1);
	}, 40_000);

	it("unregisters a hard-released agent whose in-flight park died, then reports it", async () => {
		const gate = deferred();
		const disposing = Promise.withResolvers<void>();
		await reviveParkedChild("3p-Sub", async () => {
			disposing.resolve();
			await gate.promise;
		});

		const parking = lifecycle.park("3p-Sub");
		await disposing.promise;
		corruptLeaseReleases("test_corrupt_mid_release");
		const releasing = lifecycle.release("3p-Sub");
		const outcomes = Promise.allSettled([parking, releasing]);
		gate.resolve();
		const [parkOutcome, releaseOutcome] = await outcomes;

		expect(rejectionOf(parkOutcome)).toBeInstanceOf(HostAdmissionCorruptError);
		expect(rejectionOf(releaseOutcome)).toBeInstanceOf(HostAdmissionCorruptError);

		// The hard removal still finished: a park that died on a damaged
		// authority cannot leave an orphaned registry entry behind a record
		// #release had already deleted.
		expect(registry.get("3p-Sub")).toBeUndefined();
		expect(lifecycle.has("3p-Sub")).toBe(false);
		expect(lifecycle.resourceCountsForTests()).toEqual({ liveSessions: 0, subscriptions: 0, timers: 0 });
	});

	it("settles every hard release before dispose raises what they could not absorb", async () => {
		useMultiChildAdmission();
		const ids = ["3q-One", "3q-Two"];
		for (const id of ids) await reviveParkedChild(id);
		expect(HostResourceAdmission.global().inspect().leases).toHaveLength(2);

		corruptLeaseReleases("test_corrupt_on_dispose");

		let failure: unknown;
		try {
			await lifecycle.dispose();
		} catch (error) {
			failure = error;
		}

		// One damaged lease cannot cancel the other child's removal, and both
		// failures reach the caller instead of only the first one raised.
		expect(failure).toBeInstanceOf(AggregateError);
		expect((failure as AggregateError).errors).toHaveLength(2);
		for (const id of ids) {
			expect(registry.get(id)).toBeUndefined();
			expect(lifecycle.has(id)).toBe(false);
		}
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
