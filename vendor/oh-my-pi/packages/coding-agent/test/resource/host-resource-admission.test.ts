import { Database } from "bun:sqlite";
import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import * as fs from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";
import {
	HostAdmissionFencedError,
	HostAdmissionRejectedError,
	HostResourceAdmission,
	type HostResourceAdmissionRequest,
	type HostResourceLease,
	type ResourceAttemptKind,
} from "@oh-my-pi/pi-coding-agent/resource/host-resource-admission";
import { type ProcessIdentity, readProcessIdentity } from "@oh-my-pi/pi-coding-agent/resource/process-identity";

// Integration proof: real SQLite pollers and OS process death require the platform clock.
async function pollUntil(predicate: () => boolean, timeoutMs = 2_000): Promise<void> {
	const deadline = Date.now() + timeoutMs;
	while (!predicate()) {
		if (Date.now() >= deadline) throw new Error("pollUntil timed out");
		await Bun.sleep(5);
	}
}

describe("HostResourceAdmission", () => {
	let root: string;
	let dbPath: string;
	let holder: ProcessIdentity;
	let previousHome: string | undefined;
	let previousControlDb: string | undefined;
	const admissions: HostResourceAdmission[] = [];

	beforeEach(async () => {
		root = await fs.mkdtemp(path.join(os.tmpdir(), "omp-host-admission-"));
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

	function open(options: ConstructorParameters<typeof HostResourceAdmission>[0] = {}): HostResourceAdmission {
		const admission = new HostResourceAdmission({ dbPath, queuePollMs: 5, ...options });
		admissions.push(admission);
		return admission;
	}

	function request(
		attemptId: string,
		sessionId: string,
		kind: ResourceAttemptKind = "spawn",
		holderProcess: ProcessIdentity = holder,
	): HostResourceAdmissionRequest {
		return {
			attemptId,
			kind,
			sessionId,
			sessionOwnerEpoch: null,
			parentAgentId: `${sessionId}-parent`,
			agentId: `${attemptId}-agent`,
			jobId: `${attemptId}-job`,
			holderProcess,
			reservationBytes: 0,
		};
	}

	it("serializes two independent connections at width one", async () => {
		const left = open({ maxLiveAttempts: 1 });
		const right = open({ maxLiveAttempts: 1 });
		let live = 0;
		let peakLive = 0;
		let leftLease: HostResourceLease | undefined;
		let rightLease: HostResourceLease | undefined;
		const recordGrant = (lease: HostResourceLease): HostResourceLease => {
			live++;
			peakLive = Math.max(peakLive, live);
			return lease;
		};
		const leftPending = left.acquire(request("left", "session-left")).then(lease => {
			leftLease = recordGrant(lease);
		});
		const rightPending = right.acquire(request("right", "session-right")).then(lease => {
			rightLease = recordGrant(lease);
		});

		await pollUntil(
			() =>
				(leftLease !== undefined || rightLease !== undefined) &&
				left.inspect().leases.length === 1 &&
				left.inspect().waiters.length === 1,
		);
		expect(live).toBe(1);
		(leftLease ?? rightLease)!.release();
		live--;
		await Promise.all([leftPending, rightPending]);
		expect(left.inspect().leases).toHaveLength(1);
		expect(live).toBe(1);
		expect(peakLive).toBe(1);
		const activeAttempt = left.inspect().leases[0]!.attemptId;
		(activeAttempt === "left" ? leftLease : rightLease)!.release();
		live--;
		expect(live).toBe(0);
		expect(left.inspect()).toMatchObject({ leases: [], waiters: [] });
	});

	it("round-robins sessions while preserving FIFO inside each session", async () => {
		const left = open({ maxLiveAttempts: 1 });
		const right = open({ maxLiveAttempts: 1 });
		const seed = await left.acquire(request("a-seed", "session-a"));
		const order: string[] = [];
		const a1 = left.acquire(request("a-1", "session-a")).then(lease => {
			order.push("a-1");
			return lease;
		});
		const a2 = left.acquire(request("a-2", "session-a")).then(lease => {
			order.push("a-2");
			return lease;
		});
		const b1 = right.acquire(request("b-1", "session-b")).then(lease => {
			order.push("b-1");
			return lease;
		});
		await pollUntil(() => left.inspect().waiters.length === 3);

		seed.release();
		const bLease = await b1;
		expect(order).toEqual(["b-1"]);
		bLease.release();
		const firstA = await a1;
		expect(order).toEqual(["b-1", "a-1"]);
		firstA.release();
		const secondA = await a2;
		expect(order).toEqual(["b-1", "a-1", "a-2"]);
		secondA.release();
	});

	it("deletes only the cancelled durable waiter across connections", async () => {
		const holder = open({ maxLiveAttempts: 1 });
		const waiter = open({ maxLiveAttempts: 1 });
		const held = await holder.acquire(request("held", "session-a"));
		const controller = new AbortController();
		const cancelled = waiter.acquire(request("cancelled", "session-b"), { signal: controller.signal });
		await pollUntil(() => holder.inspect().waiters.length === 1);
		controller.abort(new Error("cancel queued admission"));
		await expect(cancelled).rejects.toMatchObject({ reason: "cancelled" });
		expect(holder.inspect().waiters).toEqual([]);
		held.release();
	});

	it("rejects stale fence renewal and release without touching the current row", async () => {
		const admission = open();
		const observer = open();
		const lease = await admission.acquire(request("fenced", "session-a"));
		const db = new Database(dbPath);
		db.run("PRAGMA busy_timeout = 3000");
		db.query("UPDATE resource_leases SET fence_token=$next WHERE lease_id=$leaseId").run({
			$next: lease.fenceToken + 1_000,
			$leaseId: lease.leaseId,
		});
		db.close();

		expect(lease.renew()).toBe("fenced");
		expect(() => lease.release()).toThrow(HostAdmissionFencedError);
		expect(observer.inspect().leases).toHaveLength(1);
	});

	it("never reclaims a live exact holder from TTL alone", async () => {
		const holder = open({ leaseTtlMs: 10, maxLiveAttempts: 1 });
		const waiter = open({ leaseTtlMs: 10, maxLiveAttempts: 1 });
		const held = await holder.acquire(request("live-holder", "session-a"));
		await Bun.sleep(30);
		const waiting = waiter.acquire(request("waiting", "session-b"));
		await pollUntil(() => holder.inspect().waiters.length === 1);
		expect(holder.inspect().leases.map(lease => lease.attemptId)).toEqual(["live-holder"]);
		held.release();
		const admitted = await waiting;
		admitted.release();
	});

	it("reclaims an expired lease only after its exact holder dies", async () => {
		const holder = open({ leaseTtlMs: 10, maxLiveAttempts: 1 });
		const reclaimer = open({ leaseTtlMs: 10, maxLiveAttempts: 1 });
		const processHandle = Bun.spawn(["/bin/sleep", "5"], { stdout: "ignore", stderr: "ignore" });
		let shortLived: ProcessIdentity | null = null;
		await pollUntil(() => {
			shortLived = readProcessIdentity(processHandle.pid);
			return shortLived !== null;
		});
		await holder.acquire(request("dead-holder", "session-a", "spawn", shortLived!));
		processHandle.kill();
		await processHandle.exited;
		await Bun.sleep(20);

		const replacement = await reclaimer.acquire(request("replacement", "session-b"));
		expect(holder.inspect().leases.map(lease => lease.attemptId)).toEqual(["replacement"]);
		replacement.release();
	});

	it("gives nested sessions no private admission budget", async () => {
		const parent = open({ maxLiveAttempts: 1 });
		const nested = open({ maxLiveAttempts: 1 });
		const parentLease = await parent.acquire(request("parent", "outer-session"));
		let nestedLease: HostResourceLease | undefined;
		const pending = nested.acquire(request("grandchild", "nested-session")).then(lease => (nestedLease = lease));
		await pollUntil(() => parent.inspect().waiters.length === 1);
		expect(nestedLease).toBeUndefined();
		parentLease.release();
		await pending;
		nestedLease!.release();
	});

	it("reserves one revive permit only at widths two and three", async () => {
		for (const width of [2, 3]) {
			const admission = new HostResourceAdmission({
				dbPath: path.join(root, `width-${width}.sqlite`),
				maxLiveAttempts: width,
				queuePollMs: 5,
			});
			admissions.push(admission);
			expect(admission.inspect()).toMatchObject({ configuredWidth: width, reviveReserve: 1 });

			const spawns = await Promise.all(
				Array.from({ length: width - 1 }, (_, index) =>
					admission.acquire(request(`width-${width}-spawn-${index}`, `width-${width}-session-${index}`)),
				),
			);
			let blockedSpawn: HostResourceLease | undefined;
			const blocked = admission
				.acquire(request(`width-${width}-blocked`, `width-${width}-blocked-session`))
				.then(lease => (blockedSpawn = lease));
			await pollUntil(() => admission.inspect().waiters.length === 1);

			const revive = await admission.acquire(
				request(`width-${width}-revive`, `width-${width}-revive-session`, "revive"),
			);
			expect(blockedSpawn).toBeUndefined();
			expect(admission.inspect().leases).toHaveLength(width);

			spawns[0]!.release();
			await blocked;
			blockedSpawn!.release();
			for (const spawn of spawns.slice(1)) spawn.release();
			revive.release();
			expect(admission.inspect()).toMatchObject({ leases: [], waiters: [] });
		}

		const capped = new HostResourceAdmission({
			dbPath: path.join(root, "compiled-cap.sqlite"),
			maxLiveAttempts: 99,
		});
		admissions.push(capped);
		expect(capped.inspect()).toMatchObject({ configuredWidth: 3, reviveReserve: 1 });

		const defaulted = new HostResourceAdmission({ dbPath: path.join(root, "default-width.sqlite") });
		admissions.push(defaulted);
		expect(defaulted.inspect()).toMatchObject({ configuredWidth: 1, reviveReserve: 0 });
	});

	it("fails closed when the SQLite authority cannot be opened", async () => {
		const directoryPath = path.join(root, "not-a-database");
		await fs.mkdir(directoryPath);
		expect(() => new HostResourceAdmission({ dbPath: directoryPath })).toThrow(HostAdmissionRejectedError);
	});
});
