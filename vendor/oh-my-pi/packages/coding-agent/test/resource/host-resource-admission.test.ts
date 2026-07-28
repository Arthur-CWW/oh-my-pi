import { Database } from "bun:sqlite";
import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import * as fs from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";
import {
	HostAdmissionCorruptError,
	HostAdmissionFencedError,
	HostAdmissionRejectedError,
	HostResourceAdmission,
	type HostResourceAdmissionRequest,
	type HostResourceLease,
} from "@oh-my-pi/pi-coding-agent/resource/host-resource-admission";
import { type ProcessIdentity, readProcessIdentity } from "@oh-my-pi/pi-coding-agent/resource/process-identity";

// Real SQLite connections and OS process publication cannot be advanced with a fake JS clock.
async function pollUntil(predicate: () => boolean, timeoutMs = 2_000): Promise<void> {
	const deadline = Date.now() + timeoutMs;
	while (!predicate()) {
		if (Date.now() >= deadline) throw new Error("pollUntil timed out");
		await Bun.sleep(5);
	}
}

function deferred(): { promise: Promise<void>; resolve: () => void } {
	let resolve!: () => void;
	const promise = new Promise<void>(r => {
		resolve = r;
	});
	return { promise, resolve };
}

describe("HostResourceAdmission memory budget", () => {
	let root: string;
	let dbPath: string;
	let holder: ProcessIdentity;
	let previousHome: string | undefined;
	let previousControlDb: string | undefined;
	const admissions: HostResourceAdmission[] = [];

	beforeEach(async () => {
		root = await fs.mkdtemp(path.join(os.tmpdir(), "omp-host-memory-admission-"));
		dbPath = path.join(root, "irc-bus.sqlite");
		previousHome = process.env.HOME;
		previousControlDb = process.env.OMP_SESSION_CONTROL_DB;
		process.env.HOME = root;
		process.env.OMP_SESSION_CONTROL_DB = path.join(root, "session-control.sqlite");
		holder = readProcessIdentity(process.pid)!;
		if (!holder) throw new Error("test process identity unavailable");
	});

	afterEach(async () => {
		for (const admission of admissions.splice(0)) admission.close();
		if (previousHome === undefined) delete process.env.HOME;
		else process.env.HOME = previousHome;
		if (previousControlDb === undefined) delete process.env.OMP_SESSION_CONTROL_DB;
		else process.env.OMP_SESSION_CONTROL_DB = previousControlDb;
		await fs.rm(root, { recursive: true, force: true });
	});

	function open(options: ConstructorParameters<typeof HostResourceAdmission>[0]): HostResourceAdmission {
		const admission = new HostResourceAdmission({
			dbPath,
			queuePollMs: 5,
			sampleIntervalMs: 60_000,
			childReservationBytes: 1,
			hostResourceProbe: {
				systemMemoryBytes: 512 * 1_073_741_824,
				systemCpuCount: 128,
				warnings: [],
			},
			coordinatorRoots: () => [],
			...options,
		});
		admissions.push(admission);
		return admission;
	}

	function request(
		attemptId: string,
		sessionId: string,
		reservationBytes: number,
		holderProcess: ProcessIdentity = holder,
	): HostResourceAdmissionRequest {
		return {
			attemptId,
			kind: "spawn",
			sessionId,
			sessionOwnerEpoch: null,
			parentAgentId: `${sessionId}-parent`,
			agentId: `${attemptId}-agent`,
			jobId: `${attemptId}-job`,
			holderProcess,
			reservationBytes,
		};
	}

	it("accounts for coordinator RSS even when no child lease exists", async () => {
		const admission = open({ memoryBudgetBytes: 1, coordinatorRoots: () => [holder] });
		await admission.sampleNow();
		const snapshot = admission.inspect();
		expect(snapshot.leases).toHaveLength(0);
		expect(snapshot.observedBytes).toBeGreaterThan(0);
		expect(snapshot.processCount).toBeGreaterThan(0);
		expect(snapshot.coordinatorRootCount).toBe(1);
		expect(snapshot.sampleFresh).toBeTrue();
		expect(snapshot.pressureState).toBe("hard");
	});

	it("admits by aggregate bytes rather than legacy count width", async () => {
		const admission = open({ memoryBudgetBytes: 10_000 });
		const leases: HostResourceLease[] = [];
		for (let index = 0; index < 4; index++) {
			leases.push(await admission.acquire(request(`attempt-${index}`, `session-${index}`, 100)));
		}
		expect(admission.inspect()).toMatchObject({
			mode: "resource-bounded",
			effectiveLimit: 102,
			limitingBounds: ["cpu"],
			memoryBudgetBytes: 10_000,
			reservedBytes: 400,
			chargedBytes: 400,
		});
		expect(admission.inspect().leases).toHaveLength(4);
		for (const lease of leases) lease.release();
	});

	it("defers a reservation that would exceed the byte budget", async () => {
		const first = open({ memoryBudgetBytes: 250 });
		const second = open({ memoryBudgetBytes: 250 });
		const held = await first.acquire(request("held", "session-a", 150));
		let admitted: HostResourceLease | undefined;
		const pending = second.acquire(request("deferred", "session-b", 150)).then(lease => (admitted = lease));
		await pollUntil(() => first.inspect().waiters.length === 1);
		expect(admitted).toBeUndefined();
		expect(first.inspect().receipts.some(receipt => receipt.type === "deferred")).toBe(true);
		held.release();
		await pending;
		admitted!.release();
	});

	it("rings the GC doorbell exactly once per 80-percent crossing", async () => {
		let doorbells = 0;
		const admission = open({
			memoryBudgetBytes: 1_000,
			onPressure: () => {
				doorbells++;
			},
		});
		const left = await admission.acquire(request("left", "session-a", 400));
		const right = await admission.acquire(request("right", "session-b", 400));
		expect(doorbells).toBe(1);
		expect(admission.inspect().pressureState).toBe("gc");
		admission.inspect();
		expect(doorbells).toBe(1);
		left.release();
		right.release();
		expect(admission.inspect().pressureState).toBe("normal");
		const crossedAgain = await admission.acquire(request("again", "session-c", 800));
		expect(doorbells).toBe(2);
		crossedAgain.release();
	});

	it("stops at 95 percent and rejects deferred waiters with a typed error", async () => {
		const admission = open({ memoryBudgetBytes: 1_000 });
		const held = await admission.acquire(request("held", "session-a", 900));
		const older = admission.acquire(request("older", "session-b", 60));
		const newest = admission.acquire(request("newest", "session-c", 60));
		await expect(older).rejects.toMatchObject({ reason: "pressure-hard" });
		await expect(newest).rejects.toMatchObject({ reason: "pressure-hard" });
		expect(admission.inspect().receipts.some(receipt => receipt.type === "waiters-rejected")).toBe(true);
		held.release();
	});

	it("decays stale observations back to the declared reservation", async () => {
		const admission = open({ memoryBudgetBytes: 1_000, observationMaxAgeMs: 20 });
		const lease = await admission.acquire(request("observed", "session-a", 100));
		const audit = new Database(dbPath);
		audit
			.query("UPDATE resource_leases SET observed_bytes=$bytes, observed_at_ms=$now WHERE lease_id=$leaseId")
			.run({ $bytes: 700, $now: Date.now(), $leaseId: lease.leaseId });
		expect(admission.inspect().chargedBytes).toBe(700);
		audit
			.query("UPDATE resource_leases SET observed_at_ms=$staleAt WHERE lease_id=$leaseId")
			.run({ $staleAt: Date.now() - 100, $leaseId: lease.leaseId });
		expect(admission.inspect()).toMatchObject({ observedBytes: 100, chargedBytes: 100 });
		audit.close();
		lease.release();
	});

	it("fails closed instead of migrating an old resource schema", () => {
		const oldPath = path.join(root, "old-schema.sqlite");
		const old = new Database(oldPath);
		old.run(`CREATE TABLE resource_pool_state (
			id INTEGER PRIMARY KEY, schema_version INTEGER NOT NULL, next_ticket INTEGER NOT NULL,
			next_fence_token INTEGER NOT NULL, grant_sequence INTEGER NOT NULL, pressure_state TEXT NOT NULL,
			pressure_since_ms INTEGER, emergency_epoch INTEGER NOT NULL, sample_json TEXT, sample_at_ms INTEGER
		)`);
		old.run(`INSERT INTO resource_pool_state VALUES (1, 1, 1, 1, 0, 'normal', NULL, 0, NULL, NULL)`);
		old.close();
		expect(() => new HostResourceAdmission({ dbPath: oldPath, memoryBudgetBytes: 1_000 })).toThrow(
			HostAdmissionCorruptError,
		);
	});

	it("never frees an expired lease while its exact holder remains live", async () => {
		const admission = open({ memoryBudgetBytes: 110, leaseTtlMs: 10 });
		const held = await admission.acquire(request("live-holder", "session-a", 100));
		await Bun.sleep(30);
		let replacement: HostResourceLease | undefined;
		const pending = admission.acquire(request("waiting", "session-b", 100)).then(lease => (replacement = lease));
		await pollUntil(() => admission.inspect().waiters.length === 1);
		expect(admission.inspect().leases.map(lease => lease.attemptId)).toEqual(["live-holder"]);
		expect(replacement).toBeUndefined();
		held.release();
		await pending;
		replacement!.release();
	});

	it("reclaims an expired lease only after its exact holder dies", async () => {
		const admission = open({ memoryBudgetBytes: 110, leaseTtlMs: 10 });
		const processHandle = Bun.spawn([process.execPath, "-e", "setTimeout(() => {}, 5000)"], {
			stdout: "ignore",
			stderr: "ignore",
		});
		let shortLived: ProcessIdentity | null = null;
		await pollUntil(() => {
			shortLived = readProcessIdentity(processHandle.pid);
			return shortLived !== null;
		});
		await admission.acquire(request("dead-holder", "session-a", 100, shortLived!));
		processHandle.kill();
		await processHandle.exited;
		await Bun.sleep(20);
		const replacement = await admission.acquire(request("replacement", "session-b", 100));
		expect(admission.inspect().leases.map(lease => lease.attemptId)).toEqual(["replacement"]);
		replacement.release();
	});

	it("rejects stale fence operations without touching the authoritative row", async () => {
		const admission = open({ memoryBudgetBytes: 1_000 });
		const lease = await admission.acquire(request("fenced", "session-a", 100));
		const audit = new Database(dbPath);
		audit.query("UPDATE resource_leases SET fence_token=$next WHERE lease_id=$leaseId").run({
			$next: lease.fenceToken + 1_000,
			$leaseId: lease.leaseId,
		});
		audit.close();
		expect(lease.renew()).toBe("fenced");
		expect(() => lease.release()).toThrow(HostAdmissionFencedError);
		// A newer fence owns that row now, so this handle never speaks for it
		// again and reports the refusal exactly once.
		expect(lease.state).toBe("revoked");
		expect(lease.release()).toBe("released");
		expect(admission.inspect().leases).toHaveLength(1);
	});

	it("settles a deferred acquire with a typed refusal the moment the authority closes", async () => {
		// A five-second poll makes the back-off, not the test, the thing that has
		// to be woken: settling quickly can only mean the close woke the waiter.
		const admission = open({ memoryBudgetBytes: 110, queuePollMs: 5_000 });
		const held = await admission.acquire(request("holder", "session-a", 100));
		const queued = deferred();
		const pending = admission.acquire(request("waiter", "session-b", 100), {
			onDeferred: () => queued.resolve(),
		});
		await queued.promise;

		const startedAt = Date.now();
		admission.close();

		await expect(pending).rejects.toThrow(/Host resource authority is clos/);
		expect(Date.now() - startedAt).toBeLessThan(1_000);
		// The close revoked this lease, so handing it back is a local no-op: the
		// durable row survives for its TTL instead of a statement running against
		// a connection that is already gone.
		expect(held.release()).toBe("released");
		expect(held.release()).toBe("released");
		const audit = new Database(dbPath);
		try {
			expect(audit.query<{ count: number }, []>("SELECT COUNT(*) AS count FROM resource_leases").get()).toEqual({
				count: 1,
			});
		} finally {
			audit.close();
		}
	});

	it("withdraws the waiters it still owns so a peer never inherits a phantom queue", async () => {
		const admission = open({ memoryBudgetBytes: 110, queuePollMs: 5_000 });
		await admission.acquire(request("holder", "session-a", 100));
		const firstQueued = deferred();
		const secondQueued = deferred();
		const first = admission.acquire(request("waiter-1", "session-b", 100), {
			onDeferred: () => firstQueued.resolve(),
		});
		const second = admission.acquire(request("waiter-2", "session-c", 100), {
			onDeferred: () => secondQueued.resolve(),
		});
		await Promise.all([firstQueued.promise, secondQueued.promise]);
		expect(admission.inspect().waiters).toHaveLength(2);

		// Both outcomes are observed before the close, so neither rejection can
		// land on a promise nobody is holding yet.
		const settled = Promise.allSettled([first, second]);
		admission.close();
		const outcomes = await settled;

		expect(outcomes.map(outcome => outcome.status)).toEqual(["rejected", "rejected"]);
		for (const outcome of outcomes) {
			expect(String((outcome as PromiseRejectedResult).reason)).toMatch(/Host resource authority is clos/);
		}

		const peer = open({ memoryBudgetBytes: 110 });
		expect(peer.inspect().waiters).toEqual([]);
		expect(peer.inspect().leases.map(lease => lease.attemptId)).toEqual(["holder"]);
	});

	it("closes idempotently and refuses every later operation with a typed error", async () => {
		const admission = open({ memoryBudgetBytes: 1_000 });
		const lease = await admission.acquire(request("first", "session-a", 100));
		admission.close();
		admission.close();
		admission.close();

		await expect(admission.acquire(request("after-close", "session-b", 100))).rejects.toThrow(
			/Host resource authority is clos/,
		);
		expect(() => admission.inspect()).toThrow(/Host resource authority is clos/);
		// A closed authority cannot vouch for the lease it granted any more, which
		// is exactly what a fence means to the holder.
		expect(lease.renew()).toBe("fenced");
		await admission.whenQuiesced();
	});

	it("settles a waiter whose own deferred hook closes the authority", async () => {
		// The hook closes before the back-off has registered, so the wake-up set
		// the close drains is still empty and only the re-check inside the sleep
		// can end this wait. A five-second poll makes waiting it out unmistakable.
		const admission = open({ memoryBudgetBytes: 110, queuePollMs: 5_000 });
		const held = await admission.acquire(request("holder", "session-a", 100));
		let deferrals = 0;
		const startedAt = Date.now();
		const pending = admission.acquire(request("reentrant-waiter", "session-b", 100), {
			onDeferred: () => {
				deferrals++;
				admission.close();
			},
		});

		await expect(pending).rejects.toThrow(/Host resource authority is clos/);
		expect(Date.now() - startedAt).toBeLessThan(1_000);
		expect(deferrals).toBe(1);
		expect(held.release()).toBe("released");

		// The close ran to completion from inside the hook: the waiter row it
		// owned is withdrawn, so no peer inherits a queue head nobody is holding.
		const peer = open({ memoryBudgetBytes: 110 });
		expect(peer.inspect().waiters).toEqual([]);
		expect(peer.inspect().leases.map(lease => lease.attemptId)).toEqual(["holder"]);
	});

	it("reports a corrupt database found while withdrawing instead of closing quietly", async () => {
		const admission = open({ memoryBudgetBytes: 110, queuePollMs: 5_000 });
		const held = await admission.acquire(request("holder", "session-a", 100));
		const queued = deferred();
		const pending = admission.acquire(request("doomed-waiter", "session-b", 100), {
			onDeferred: () => queued.resolve(),
		});
		await queued.promise;

		// SQLite raises the genuine corruption message itself, on the exact
		// statement close uses to drain the waiter rows this process owns.
		const saboteur = new Database(dbPath);
		saboteur.run(
			`CREATE TRIGGER corrupt_on_withdraw BEFORE DELETE ON resource_waiters
			 BEGIN SELECT RAISE(ABORT, 'database disk image is malformed'); END`,
		);
		saboteur.close();

		expect(() => admission.close()).toThrow(HostAdmissionCorruptError);
		// Teardown still finished around the failure: the sleeper woke, the
		// authority refuses every later call, and the handle is gone.
		await expect(pending).rejects.toThrow(/Host resource authority is clos/);
		expect(() => admission.inspect()).toThrow(/Host resource authority is clos/);
		expect(held.release()).toBe("released");
	});

	it("stays idempotent across repeated close and reset with a lease outstanding", async () => {
		const admission = open({ memoryBudgetBytes: 1_000 });
		const lease = await admission.acquire(request("held", "session-a", 100));
		for (let round = 0; round < 3; round++) {
			admission.close();
			HostResourceAdmission.resetGlobalForTests();
		}

		expect(lease.renew()).toBe("fenced");
		expect(lease.release()).toBe("released");
		expect(lease.state).toBe("revoked");
		expect(lease.release()).toBe("released");

		// The row the revoked lease never deleted stays durable, and a replacement
		// authority on the same file keeps granting around it.
		const replacement = open({ memoryBudgetBytes: 1_000 });
		expect(replacement.inspect().leases.map(row => row.attemptId)).toEqual(["held"]);
		const next = await replacement.acquire(request("after-reset", "session-b", 100));
		expect(next.release()).toBe("released");
		expect(replacement.inspect().leases.map(row => row.attemptId)).toEqual(["held"]);
	});

	it("keeps a lease retryable when contention refuses a release from an open authority", async () => {
		const admission = open({ memoryBudgetBytes: 1_000 });
		const lease = await admission.acquire(request("contended", "session-a", 100));

		// A real peer connection holds the write lock, so the release fails the
		// way contention actually fails: BEGIN IMMEDIATE waits out the authority's
		// busy timeout and SQLite reports the database as locked.
		const peer = new Database(dbPath);
		peer.run("BEGIN IMMEDIATE");
		let refused: unknown;
		try {
			lease.release();
		} catch (error) {
			refused = error;
		}
		peer.run("ROLLBACK");
		peer.close();

		expect(refused).toBeInstanceOf(HostAdmissionRejectedError);
		expect((refused as HostAdmissionRejectedError).reason).toBe("authority-unavailable");
		// The row is still this live process's to give back, and expiry reaping
		// refuses to reclaim a lease whose holder is provably alive: a handle that
		// gave up here would consume the slot for the rest of the process.
		expect(lease.state).toBe("open");
		expect(admission.inspect().leases.map(row => row.attemptId)).toEqual(["contended"]);

		expect(lease.release()).toBe("released");
		expect(lease.state).toBe("released");
		expect(admission.inspect().leases).toEqual([]);
	}, 20_000);

	it("removes the row exactly once when concurrent callers release one lease", async () => {
		const admission = open({ memoryBudgetBytes: 1_000 });
		const lease = await admission.acquire(request("shared", "session-a", 100));
		const audit = new Database(dbPath);
		audit.run("CREATE TABLE release_audit (lease_id TEXT NOT NULL)");
		audit.run(
			`CREATE TRIGGER count_lease_deletes AFTER DELETE ON resource_leases
			 BEGIN INSERT INTO release_audit (lease_id) VALUES (OLD.lease_id); END`,
		);

		const outcomes = await Promise.all(
			Array.from({ length: 8 }, () => Promise.resolve().then(() => lease.release())),
		);

		expect(outcomes).toEqual(Array.from({ length: 8 }, () => "released"));
		expect(lease.state).toBe("released");
		const deletes = audit.query<{ lease_id: string }, []>("SELECT lease_id FROM release_audit").all();
		audit.close();
		expect(deletes.map(row => row.lease_id)).toEqual([lease.leaseId]);
		expect(admission.inspect().leases).toEqual([]);
	});

	it("drops an in-flight process sample instead of writing through a closed handle", async () => {
		const admission = open({ memoryBudgetBytes: 1_000, coordinatorRoots: () => [holder] });
		// Closed in the same turn the sample starts, so the process walk is
		// guaranteed to still be running when the connection goes away.
		const sampling = admission.sampleNow();
		admission.close();

		await expect(sampling).resolves.toBeUndefined();
		await admission.whenQuiesced();
	});

	it("stops the scheduled sampler at close so no timer callback runs against the closed handle", async () => {
		const unhandled: unknown[] = [];
		const record = (reason: unknown): void => {
			unhandled.push(reason);
		};
		process.on("unhandledRejection", record);
		try {
			const admission = open({
				memoryBudgetBytes: 1_000,
				sampleIntervalMs: 50,
				coordinatorRoots: () => [holder],
			});
			await pollUntil(() => admission.inspect().sampleFresh);
			admission.close();
			await admission.whenQuiesced();
			// Several sampler periods with nothing left to fire.
			await Bun.sleep(250);
			expect(unhandled).toEqual([]);
		} finally {
			process.off("unhandledRejection", record);
		}
	});

	it("replaces a closed process-wide authority instead of handing it back out", async () => {
		const first = HostResourceAdmission.global({ dbPath, memoryBudgetBytes: 1_000, sampleIntervalMs: 60_000 });
		expect(HostResourceAdmission.hasGlobal()).toBeTrue();
		HostResourceAdmission.resetGlobalForTests();
		HostResourceAdmission.resetGlobalForTests();
		expect(HostResourceAdmission.hasGlobal()).toBeFalse();

		const second = HostResourceAdmission.global({ dbPath, memoryBudgetBytes: 1_000, sampleIntervalMs: 60_000 });
		admissions.push(second);
		expect(second).not.toBe(first);
		expect(second.inspect().leases).toEqual([]);
		HostResourceAdmission.resetGlobalForTests();
	});
});
