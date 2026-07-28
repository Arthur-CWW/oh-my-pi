import { Database } from "bun:sqlite";
import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import * as fsSync from "node:fs";
import * as fs from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";
import {
	HostAdmissionCorruptError,
	HostResourceAdmission,
	type HostResourceAdmissionRequest,
} from "@oh-my-pi/pi-coding-agent/resource/host-resource-admission";
import { PendingHostLeaseReleases } from "@oh-my-pi/pi-coding-agent/resource/pending-lease-releases";
import { type ProcessIdentity, readProcessIdentity } from "@oh-my-pi/pi-coding-agent/resource/process-identity";

describe("PendingHostLeaseReleases", () => {
	let root: string;
	let dbPath: string;
	let holder: ProcessIdentity;
	let previousHome: string | undefined;
	const admissions: HostResourceAdmission[] = [];

	beforeEach(async () => {
		root = await fs.mkdtemp(path.join(os.tmpdir(), "omp-pending-lease-release-"));
		dbPath = path.join(root, "resource-authority.sqlite");
		previousHome = process.env.HOME;
		process.env.HOME = root;
		holder = readProcessIdentity(process.pid)!;
		if (!holder) throw new Error("test process identity unavailable");
		PendingHostLeaseReleases.resetForTests();
		HostResourceAdmission.resetGlobalForTests();
	});

	afterEach(async () => {
		PendingHostLeaseReleases.resetForTests();
		HostResourceAdmission.resetGlobalForTests();
		for (const admission of admissions.splice(0)) admission.close();
		if (previousHome === undefined) delete process.env.HOME;
		else process.env.HOME = previousHome;
		await fs.rm(root, { recursive: true, force: true });
	});

	function open(options: ConstructorParameters<typeof HostResourceAdmission>[0] = {}): HostResourceAdmission {
		const admission = new HostResourceAdmission({
			dbPath,
			memoryBudgetBytes: 10_000,
			queuePollMs: 5,
			sampleIntervalMs: 60_000,
			childReservationBytes: 1,
			hostResourceProbe: { systemMemoryBytes: 512 * 1_073_741_824, systemCpuCount: 128, warnings: [] },
			coordinatorRoots: () => [],
			...options,
		});
		admissions.push(admission);
		return admission;
	}

	function request(attemptId: string): HostResourceAdmissionRequest {
		return {
			attemptId,
			kind: "spawn",
			sessionId: "session",
			sessionOwnerEpoch: null,
			parentAgentId: "Main",
			agentId: `${attemptId}-agent`,
			jobId: `${attemptId}-job`,
			holderProcess: holder,
			reservationBytes: 100,
		};
	}

	/** Rows in the authority file, read through a connection nothing under test owns. */
	function durableLeaseRows(): number {
		const db = new Database(dbPath, { readonly: true });
		try {
			return db.query<{ rows: number }, []>("SELECT COUNT(*) AS rows FROM resource_leases").get()?.rows ?? 0;
		} finally {
			db.close();
		}
	}

	/** Shared pool state as the file holds it, read through a connection nothing under test owns. */
	function poolState(): {
		pressureState: string;
		pressureSinceMs: number | null;
		pressureEpoch: number;
		receipts: string[];
	} {
		const db = new Database(dbPath, { readonly: true });
		try {
			const row = db
				.query<
					{
						pressure_state: string;
						pressure_since_ms: number | null;
						pressure_epoch: number;
						receipts_json: string;
					},
					[]
				>(
					`SELECT pressure_state, pressure_since_ms, pressure_epoch, receipts_json
					 FROM resource_pool_state WHERE id=1`,
				)
				.get();
			if (!row) throw new Error("authority has no pool state row");
			return {
				pressureState: row.pressure_state,
				pressureSinceMs: row.pressure_since_ms,
				pressureEpoch: row.pressure_epoch,
				receipts: (JSON.parse(row.receipts_json) as { type: string }[]).map(receipt => receipt.type),
			};
		} finally {
			db.close();
		}
	}

	/**
	 * A number that rises by at least one for every descriptor this process
	 * strands. Exact where `/proc` exists; elsewhere it is the descriptor the
	 * kernel hands out next, which POSIX defines as the lowest free one and
	 * which therefore climbs as stranded handles fill the low slots.
	 *
	 * Lowest of three readings either way: a test runner opens and closes files
	 * of its own between statements, and a descriptor that is already gone by
	 * the next reading was never a leak.
	 */
	function openDescriptorWatermark(): number {
		let lowest = Number.POSITIVE_INFINITY;
		for (let probe = 0; probe < 3; probe++) {
			let reading: number;
			try {
				reading = fsSync.readdirSync("/proc/self/fd").length;
			} catch {
				const descriptor = fsSync.openSync(dbPath, "r");
				fsSync.closeSync(descriptor);
				reading = descriptor;
			}
			lowest = Math.min(lowest, reading);
		}
		return lowest;
	}

	/** Hold the authority's write lock from a real peer connection for the duration of `run`. */
	async function withWriteLock<T>(run: () => Promise<T> | T): Promise<T> {
		const peer = new Database(dbPath);
		peer.run("BEGIN IMMEDIATE");
		try {
			return await run();
		} finally {
			peer.run("ROLLBACK");
			peer.close();
		}
	}

	it("owns the row from the moment a refused release begins", async () => {
		const admission = open();
		const lease = await admission.acquire(request("owned"));
		const service = PendingHostLeaseReleases.global();

		const tally = await withWriteLock(() => service.handBack("OwnedAgent", lease));

		// The attempt failed, so nothing was released — but the row is owned, and
		// it is owned by identity rather than by the handle that failed.
		expect(tally.released).toBe(0);
		expect(tally.pending).toBe(1);
		expect(service.owed()).toBe(1);
		expect(service.owed("OwnedAgent")).toBe(1);
		expect(lease.state).toBe("open");
		expect(durableLeaseRows()).toBe(1);

		await service.whenSettled();

		expect(service.owed()).toBe(0);
		expect(durableLeaseRows()).toBe(0);
	}, 30_000);

	it("keeps one retry owner when the same row is handed back twice", async () => {
		const admission = open();
		const lease = await admission.acquire(request("twice"));
		const service = PendingHostLeaseReleases.global();

		await withWriteLock(() => {
			service.handBack("TwiceAgent", lease);
			// A second cleanup path reaching the same handle must not create a
			// second record, and must not leave two timers racing over one
			// statement.
			service.handBack("TwiceAgent", lease);
			service.sweep("TwiceAgent");
			expect(service.owed()).toBe(1);
		});

		await service.whenSettled();

		expect(durableLeaseRows()).toBe(0);
	}, 30_000);

	it("hands the row back through a reopened authority once the granting one closed", async () => {
		const admission = open();
		const lease = await admission.acquire(request("reopen"));
		const service = PendingHostLeaseReleases.global();

		await withWriteLock(() => {
			service.handBack("ReopenAgent", lease);
			expect(service.owed()).toBe(1);
		});

		// The authority that granted the row is gone. Its handle can only report
		// that it stopped speaking for the row, never that the row is back.
		admission.close();
		expect(lease.tryRelease()).toBe("unbound");
		expect(durableLeaseRows()).toBe(1);

		await service.whenSettled();

		expect(service.owed()).toBe(0);
		expect(durableLeaseRows()).toBe(0);
	}, 30_000);

	it("reports damaged storage once instead of retrying it forever", async () => {
		const admission = open();
		const lease = await admission.acquire(request("corrupt"));
		const service = PendingHostLeaseReleases.global();
		const saboteur = new Database(dbPath);
		saboteur.run(
			"CREATE TRIGGER corrupt_on_release BEFORE DELETE ON resource_leases BEGIN SELECT RAISE(ABORT, 'database disk image is malformed'); END",
		);
		saboteur.close();

		const tally = service.handBack("CorruptAgent", lease);

		expect(tally.corruption).toHaveLength(1);
		expect(tally.corruption[0]).toBeInstanceOf(HostAdmissionCorruptError);
		expect(tally.released).toBe(0);
		// Nothing retries permanent damage: a record kept here would spin against
		// a broken database for the life of the process.
		expect(service.owed()).toBe(0);
	}, 30_000);

	it("finishes a contended handback without blocking the event loop", async () => {
		const admission = open();
		const leases = [await admission.acquire(request("gap-a")), await admission.acquire(request("gap-b"))];
		const service = PendingHostLeaseReleases.global();

		// Real timers, deliberately: the property under test is that the platform
		// clock keeps advancing callbacks while a real SQLite writer holds the
		// authority's lock. A fake clock would measure nothing — the stall it has
		// to catch is a synchronous block that a fake clock cannot experience.
		let previousTick = Date.now();
		let maxGapMs = 0;
		const heartbeat = setInterval(() => {
			const now = Date.now();
			maxGapMs = Math.max(maxGapMs, now - previousTick);
			previousTick = now;
		}, 10);
		let elapsedMs = 0;
		try {
			previousTick = Date.now();
			const started = Date.now();
			await withWriteLock(() => {
				for (const lease of leases) service.handBack("GapAgent", lease);
			});
			elapsedMs = Date.now() - started;
		} finally {
			clearInterval(heartbeat);
		}

		// Each refused attempt costs a scheduled retry, never the authority's
		// multi-second busy budget on the thread that runs every timer here.
		expect(elapsedMs).toBeLessThan(1_000);
		expect(maxGapMs).toBeLessThan(500);

		await service.whenSettled();

		expect(durableLeaseRows()).toBe(0);
	}, 30_000);

	it("strands no database handle while a reopened handback keeps losing the write lock", async () => {
		const admission = open();
		const lease = await admission.acquire(request("handles"));
		const service = PendingHostLeaseReleases.global();

		// Nothing in this process speaks for the database from here, so every
		// attempt has to reopen an authority — and under a held write lock each
		// reopen fails inside its own constructor, after its connection is open
		// and before anything that could ever close it exists.
		admission.close();
		expect(lease.tryRelease()).toBe("unbound");

		const refusals = 64;
		let baseline = 0;
		let afterRefusals = 0;
		await withWriteLock(() => {
			service.handBack("HandleAgent", lease);
			// Measured after the path has already run: a one-off allocation made by
			// the first reopen is not per-attempt growth.
			for (let warmup = 0; warmup < 4; warmup++) service.sweep("HandleAgent");
			baseline = openDescriptorWatermark();
			for (let refusal = 0; refusal < refusals; refusal++) service.sweep("HandleAgent");
			afterRefusals = openDescriptorWatermark();
			// Still owed, so all of those attempts really did run and really were
			// refused.
			expect(service.owed()).toBe(1);
		});

		// Each attempt constructs exactly one authority, so a construction that
		// stranded its connection would grow this by at least one per attempt —
		// three, in fact, since opening a WAL database costs a descriptor each for
		// the file, its log and its shared-memory index. Anything this far below
		// the attempt count is the runtime's own churn.
		expect(afterRefusals - baseline).toBeLessThan(refusals / 4);

		// Ahead of the 5 s ceiling the backoff has reached: the schedule is not
		// what this test is about, and the row still has to come back.
		expect(service.sweep("HandleAgent").released).toBe(1);
		expect(service.owed()).toBe(0);
		expect(durableLeaseRows()).toBe(0);
	}, 30_000);

	it("hands a row back through a reopened authority without repricing the pool", async () => {
		// A budget far below anything this host would derive for itself: the
		// default profile a reopened authority falls back to calls the same charge
		// "normal", so a reprice here is visible as a pressure state that moves.
		const admission = open({ memoryBudgetBytes: 1_000 });
		const spare = await admission.acquire({ ...request("priced-spare"), reservationBytes: 100 });
		await admission.acquire({ ...request("priced-bulk"), reservationBytes: 840 });
		const service = PendingHostLeaseReleases.global();
		const before = poolState();
		expect(before.pressureState).toBe("gc");

		// Nothing speaks for the database any more, so the handback runs through
		// an authority that never saw those budgets.
		admission.close();
		expect(spare.tryRelease()).toBe("unbound");

		const tally = service.handBack("PricedAgent", spare);

		expect(tally.released).toBe(1);
		expect(service.owed()).toBe(0);
		expect(durableLeaseRows()).toBe(1);

		// The row and the receipt recording it are the whole change. Repricing
		// from a default profile would have reset this pool to "normal" and
		// silenced the signal for every other reader.
		const after = poolState();
		expect(after.pressureState).toBe("gc");
		expect(after.pressureSinceMs).toBe(before.pressureSinceMs);
		expect(after.pressureEpoch).toBe(before.pressureEpoch);
		expect(after.receipts.slice(before.receipts.length)).toEqual(["released"]);

		// And the pool the budgets describe is still the narrow one: 840 of 1000
		// charged is this pool's gc, not the default profile's normal.
		expect(open({ memoryBudgetBytes: 1_000 }).inspect().pressureState).toBe("gc");
	}, 30_000);
});
