import { describe, expect, it } from "bun:test";
import * as fs from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";
import { HostResourceAdmission } from "@oh-my-pi/pi-coding-agent/resource/host-resource-admission";
import {
	defaultHostMemoryBudgetBytes,
	sampleLeaseProcessTrees,
} from "@oh-my-pi/pi-coding-agent/resource/host-resource-sampler";
import { readProcessIdentity } from "@oh-my-pi/pi-coding-agent/resource/process-identity";

describe("host resource sampler", () => {
	it("uses the bounded argv ps sampler to observe a real owned process", async () => {
		const child = Bun.spawn(["/bin/sleep", "5"], { stdout: "ignore", stderr: "ignore" });
		try {
			let identity = readProcessIdentity(child.pid);
			while (!identity) {
				// The integration boundary is process publication in the real OS process table.
				await Bun.sleep(5);
				identity = readProcessIdentity(child.pid);
			}
			const sample = await sampleLeaseProcessTrees([{ leaseId: "owned", holderProcess: identity }]);
			expect(sample.processCount).toBeGreaterThanOrEqual(1);
			expect(sample.aggregateObservedBytes).toBeGreaterThan(0);
			expect(sample.observedBytesByLease.get("owned")).toBeGreaterThan(0);
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
		const child = Bun.spawn(["/bin/sleep", "5"], { stdout: "ignore", stderr: "ignore" });
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

	it("caps the default at 52 GiB and otherwise uses sixty percent of RAM", () => {
		expect(defaultHostMemoryBudgetBytes(10_000)).toBe(6_000);
		expect(defaultHostMemoryBudgetBytes(100 * 1_073_741_824)).toBe(52 * 1_073_741_824);
	});
});
