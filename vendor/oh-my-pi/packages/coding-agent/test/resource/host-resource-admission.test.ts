import { Database } from "bun:sqlite";
import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import * as fs from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";
import {
	HostAdmissionCorruptError,
	HostAdmissionFencedError,
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
		const admission = new HostResourceAdmission({ dbPath, queuePollMs: 5, sampleIntervalMs: 60_000, ...options });
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

	it("admits by aggregate bytes rather than legacy count width", async () => {
		const admission = open({ memoryBudgetBytes: 10_000 });
		const leases: HostResourceLease[] = [];
		for (let index = 0; index < 4; index++) {
			leases.push(await admission.acquire(request(`attempt-${index}`, `session-${index}`, 100)));
		}
		expect(admission.inspect()).toMatchObject({
			safetyCeiling: 16,
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
		const processHandle = Bun.spawn(["/bin/sleep", "5"], { stdout: "ignore", stderr: "ignore" });
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
		expect(admission.inspect().leases).toHaveLength(1);
	});
});
