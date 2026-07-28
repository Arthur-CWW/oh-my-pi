import { describe, expect, it } from "bun:test";
import * as fs from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";
import { HostResourceAdmission } from "@oh-my-pi/pi-coding-agent/resource/host-resource-admission";
import { sampleLeaseProcessTrees } from "@oh-my-pi/pi-coding-agent/resource/host-resource-sampler";
import { readProcessIdentity } from "@oh-my-pi/pi-coding-agent/resource/process-identity";
import {
	makePsSnapshotSource,
	PsDecodeError,
	type PsSnapshotRow,
	type PsSnapshotSource,
} from "@oh-my-pi/pi-coding-agent/resource/ps-command";
import { Effect } from "effect";

/** Decoded-row seam: attribution is exercised without racing the real process table. */
function snapshotOf(rows: readonly PsSnapshotRow[]): PsSnapshotSource {
	return () => Effect.succeed(rows);
}

describe("host resource sampler", () => {
	it("uses the bounded argv ps sampler to observe a real owned process", async () => {
		const child = Bun.spawn([process.execPath, "-e", "setTimeout(() => {}, 5000)"], {
			stdout: "ignore",
			stderr: "ignore",
		});
		try {
			let identity = readProcessIdentity(child.pid);
			while (!identity) {
				// The integration boundary is process publication in the real OS process table.
				await Bun.sleep(5);
				identity = readProcessIdentity(child.pid);
			}
			const sample = await sampleLeaseProcessTrees([{ leaseId: "owned", holderProcess: identity }], {
				coordinatorRoots: [identity, identity],
			});
			expect(sample.processCount).toBeGreaterThanOrEqual(1);
			expect(sample.aggregateObservedBytes).toBeGreaterThan(0);
			expect(sample.observedBytesByLease.get("owned")).toBeGreaterThan(0);
			expect(sample.rootCount).toBe(1);
		} finally {
			child.kill();
			await child.exited;
		}
	});

	it("publishes a real process-tree observation into its fenced lease row", async () => {
		const root = await fs.mkdtemp(path.join(os.tmpdir(), "omp-host-sampler-"));
		const previousHome = process.env.HOME;
		const previousControlDb = process.env.OMP_SESSION_CONTROL_DB;
		process.env.HOME = root;
		process.env.OMP_SESSION_CONTROL_DB = path.join(root, "session-control.sqlite");
		const child = Bun.spawn([process.execPath, "-e", "setTimeout(() => {}, 5000)"], {
			stdout: "ignore",
			stderr: "ignore",
		});
		let admission: HostResourceAdmission | undefined;
		try {
			let identity = readProcessIdentity(child.pid);
			while (!identity) {
				// The integration boundary is process publication in the real OS process table.
				await Bun.sleep(5);
				identity = readProcessIdentity(child.pid);
			}
			admission = new HostResourceAdmission({
				dbPath: path.join(root, "irc-bus.sqlite"),
				memoryBudgetBytes: 100 * 1_048_576,
				sampleIntervalMs: 60_000,
				coordinatorRoots: () => [],
			});
			const lease = await admission.acquire({
				attemptId: "sampled-attempt",
				kind: "spawn",
				sessionId: "sampled-session",
				sessionOwnerEpoch: null,
				parentAgentId: "sampled-parent",
				agentId: "sampled-agent",
				jobId: "sampled-job",
				holderProcess: identity,
				reservationBytes: 1,
			});
			await admission.sampleNow();
			const sampledLease = admission.inspect().leases[0]!;
			expect(sampledLease.observedBytes).toBeGreaterThan(1);
			expect(admission.inspect().sampledAtMs).not.toBeNull();
			lease.release();
		} finally {
			admission?.close();
			child.kill();
			await child.exited;
			if (previousHome === undefined) delete process.env.HOME;
			else process.env.HOME = previousHome;
			if (previousControlDb === undefined) delete process.env.OMP_SESSION_CONTROL_DB;
			else process.env.OMP_SESSION_CONTROL_DB = previousControlDb;
			await fs.rm(root, { recursive: true, force: true });
		}
	});

	it("drops a recycled pid whose snapshot start fingerprint no longer matches the lease", async () => {
		const child = Bun.spawn([process.execPath, "-e", "setTimeout(() => {}, 50)"], {
			stdout: "ignore",
			stderr: "ignore",
		});
		let recorded = readProcessIdentity(child.pid);
		while (!recorded) {
			await Bun.sleep(5);
			recorded = readProcessIdentity(child.pid);
		}
		child.kill();
		await child.exited;

		// The pid is now free. A later occupant reports a different start time, which
		// is exactly what a reuse looks like from inside one snapshot.
		const reused = await sampleLeaseProcessTrees([{ leaseId: "recycled", holderProcess: recorded }], {
			snapshotSource: snapshotOf([
				{ pid: recorded.pid, ppid: 1, rssBytes: 512 * 1_048_576, startFingerprint: "Sun Jan 1 00:00:00 2000" },
				{
					pid: recorded.pid + 1,
					ppid: recorded.pid,
					rssBytes: 64 * 1_048_576,
					startFingerprint: "Sun Jan 1 00:00:01 2000",
				},
			]),
		});
		expect(reused.observedBytesByLease.get("recycled")).toBeUndefined();
		expect(reused.aggregateObservedBytes).toBe(0);
		expect(reused.processCount).toBe(0);
		expect(reused.rootCount).toBe(0);

		// Same rows, matching fingerprint: the tree is attributed in full.
		const owned = await sampleLeaseProcessTrees([{ leaseId: "recycled", holderProcess: recorded }], {
			snapshotSource: snapshotOf([
				{ pid: recorded.pid, ppid: 1, rssBytes: 512 * 1_048_576, startFingerprint: recorded.startFingerprint },
				{
					pid: recorded.pid + 1,
					ppid: recorded.pid,
					rssBytes: 64 * 1_048_576,
					startFingerprint: "Sun Jan 1 00:00:01 2000",
				},
			]),
		});
		expect(owned.observedBytesByLease.get("recycled")).toBe(576 * 1_048_576);
		expect(owned.rootCount).toBe(1);
	});

	it("splits a shared pid only between leases that prove the same snapshot identity", async () => {
		const self = readProcessIdentity(process.pid);
		expect(self).not.toBeNull();
		const holder = self!;
		const stale = { ...holder, startFingerprint: `${holder.startFingerprint} (stale)` };
		const sample = await sampleLeaseProcessTrees(
			[
				{ leaseId: "live", holderProcess: holder },
				{ leaseId: "stale", holderProcess: stale },
			],
			{
				snapshotSource: snapshotOf([
					{ pid: holder.pid, ppid: 1, rssBytes: 1_000, startFingerprint: holder.startFingerprint },
				]),
			},
		);
		// Both leases name one pid with different fingerprints, so they are two roots.
		// Only the one the snapshot proves is credited; the other is invented nowhere.
		expect(sample.rootCount).toBe(1);
		expect(sample.observedBytesByLease.get("live")).toBe(1_000);
		expect(sample.observedBytesByLease.has("stale")).toBe(false);
	});

	it("attributes a shared pid the same way whichever lease is listed first", async () => {
		const self = readProcessIdentity(process.pid);
		expect(self).not.toBeNull();
		const holder = self!;
		const stale = { ...holder, startFingerprint: `${holder.startFingerprint} (stale)` };
		// Reversing the targets must not change attribution: keying roots on the pid
		// alone made the first-seen identity win and erased the live lease entirely.
		const sample = await sampleLeaseProcessTrees(
			[
				{ leaseId: "stale", holderProcess: stale },
				{ leaseId: "live", holderProcess: holder },
			],
			{
				snapshotSource: snapshotOf([
					{ pid: holder.pid, ppid: 1, rssBytes: 1_000, startFingerprint: holder.startFingerprint },
				]),
			},
		);
		expect(sample.rootCount).toBe(1);
		expect(sample.observedBytesByLease.get("live")).toBe(1_000);
		expect(sample.observedBytesByLease.has("stale")).toBe(false);
		expect(sample.aggregateObservedBytes).toBe(1_000);
	});

	it("keeps a coordinator root and a lease sharing one pid from overwriting each other", async () => {
		const self = readProcessIdentity(process.pid);
		expect(self).not.toBeNull();
		const live = self!;
		const stale = { ...live, startFingerprint: `${live.startFingerprint} (stale)` };
		const rows: readonly PsSnapshotRow[] = [
			{ pid: live.pid, ppid: 1, rssBytes: 900, startFingerprint: live.startFingerprint },
			{ pid: live.pid + 1, ppid: live.pid, rssBytes: 100, startFingerprint: "Sun Jan 1 00:00:01 2000" },
		];

		// Stale coordinator, live lease: dropping the coordinator must not take the
		// lease's proven tree with it.
		const leaseProves = await sampleLeaseProcessTrees([{ leaseId: "live", holderProcess: live }], {
			coordinatorRoots: [stale],
			snapshotSource: snapshotOf(rows),
		});
		expect(leaseProves.rootCount).toBe(1);
		expect(leaseProves.observedBytesByLease.get("live")).toBe(1_000);
		expect(leaseProves.aggregateObservedBytes).toBe(1_000);
		expect(leaseProves.processCount).toBe(2);

		// Live coordinator, stale lease: the coordinator forest is still accounted,
		// and the unproven lease is credited nothing rather than inheriting it.
		const coordinatorProves = await sampleLeaseProcessTrees([{ leaseId: "stale", holderProcess: stale }], {
			coordinatorRoots: [live],
			snapshotSource: snapshotOf(rows),
		});
		expect(coordinatorProves.rootCount).toBe(1);
		expect(coordinatorProves.observedBytesByLease.has("stale")).toBe(false);
		expect(coordinatorProves.aggregateObservedBytes).toBe(1_000);
		expect(coordinatorProves.processCount).toBe(2);
	});

	it("rejects a root whose identity was recorded on a different boot", async () => {
		const self = readProcessIdentity(process.pid);
		expect(self).not.toBeNull();
		const holder = self!;
		const previousBoot = { ...holder, bootId: `${holder.bootId} (previous boot)` };
		const sample = await sampleLeaseProcessTrees([{ leaseId: "rebooted", holderProcess: previousBoot }], {
			snapshotSource: snapshotOf([
				{ pid: holder.pid, ppid: 1, rssBytes: 4_096, startFingerprint: holder.startFingerprint },
			]),
		});
		expect(sample.rootCount).toBe(0);
		expect(sample.observedBytesByLease.has("rebooted")).toBe(false);
		expect(sample.aggregateObservedBytes).toBe(0);
		expect(sample.processCount).toBe(0);
	});

	it("rejects every root when the host cannot prove a boot identity", async () => {
		const self = readProcessIdentity(process.pid);
		expect(self).not.toBeNull();
		const holder = self!;
		const rows: readonly PsSnapshotRow[] = [
			{ pid: holder.pid, ppid: 1, rssBytes: 8_192, startFingerprint: holder.startFingerprint },
		];

		// Control: with the host boot identity proved, this exact snapshot attributes.
		const proved = await sampleLeaseProcessTrees([{ leaseId: "unprovable", holderProcess: holder }], {
			hostBootId: holder.bootId,
			snapshotSource: snapshotOf(rows),
		});
		expect(proved.rootCount).toBe(1);
		expect(proved.observedBytesByLease.get("unprovable")).toBe(8_192);

		// Treatment: the boot probe failed, so the matching start time is not proof.
		// Zero observed bytes keeps the lease charging its declared reservation.
		const unprovable = await sampleLeaseProcessTrees([{ leaseId: "unprovable", holderProcess: holder }], {
			hostBootId: "",
			snapshotSource: snapshotOf(rows),
		});
		expect(unprovable.rootCount).toBe(0);
		expect(unprovable.observedBytesByLease.has("unprovable")).toBe(false);
		expect(unprovable.aggregateObservedBytes).toBe(0);
		expect(unprovable.processCount).toBe(0);
	});

	it("surfaces a malformed ps table as a typed decode error", async () => {
		const self = readProcessIdentity(process.pid);
		expect(self).not.toBeNull();
		const garbage = makePsSnapshotSource(() => Effect.succeed("this is not a ps row\n"));
		await expect(
			sampleLeaseProcessTrees([{ leaseId: "decode", holderProcess: self! }], { snapshotSource: garbage }),
		).rejects.toBeInstanceOf(PsDecodeError);

		const negativeRss = makePsSnapshotSource(() => Effect.succeed("10 1 -5 Sun Jan 1 00:00:00 2000\n"));
		await expect(
			sampleLeaseProcessTrees([{ leaseId: "decode", holderProcess: self! }], { snapshotSource: negativeRss }),
		).rejects.toBeInstanceOf(PsDecodeError);
	});
});
