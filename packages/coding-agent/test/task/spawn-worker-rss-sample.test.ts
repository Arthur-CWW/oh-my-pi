import { describe, expect, test } from "bun:test";
import { readCapped } from "@oh-my-pi/pi-utils";
import * as spawnWorkerClient from "../../src/task/spawn-worker-client";

describe("worker RSS sampling", () => {
	test("an exact ps overflow invalidates every affected worker without publishing a partial sample", async () => {
		const body = "101 999\n202 1\n";
		const sample = await readCapped(new Blob([body]).stream(), 8);
		expect(sample).toMatchObject({ keptBytes: 8, totalBytes: 14, truncated: true });

		const soft: number[] = [];
		const hard: number[] = [];
		const invalid: Array<{ pid: number; reason: string }> = [];
		const watch = (pid: number) => ({
			softBytes: 1,
			hardBytes: 2,
			onSoftWatermark: () => soft.push(pid),
			onHardWatermark: () => hard.push(pid),
			onSampleInvalid: (reason: string) => invalid.push({ pid, reason }),
		});
		const watches = new Map([
			[101, watch(101)],
			[202, watch(202)],
		]);

		spawnWorkerClient.enforceWorkerRssSample(sample, watches);

		expect(soft).toEqual([]);
		expect(hard).toEqual([]);
		expect(invalid.map(entry => entry.pid)).toEqual([101, 202]);
		expect(invalid[0]?.reason).toBe("ps output overflowed: kept 8 of 14 bytes");
	});

	test("invalidates a successful sample containing a malformed ps row", () => {
		const invalid: string[] = [];
		spawnWorkerClient.enforceWorkerRssSample(
			{ text: "101 not-rss\n", keptBytes: 12, totalBytes: 12, truncated: false },
			new Map([
				[
					101,
					{
						softBytes: 1,
						hardBytes: 2,
						onSoftWatermark: () => {},
						onHardWatermark: () => {},
						onSampleInvalid: reason => invalid.push(reason),
					},
				],
			]),
		);

		expect(invalid).toEqual(['ps emitted malformed row: "101 not-rss"']);
	});

	test("invalidates each watched pid omitted from a successful ps sample", () => {
		const invalid: Array<{ pid: number; reason: string }> = [];
		const watch = (pid: number) => ({
			softBytes: 0,
			hardBytes: 1,
			onSoftWatermark: () => {},
			onHardWatermark: () => {},
			onSampleInvalid: (reason: string) => invalid.push({ pid, reason }),
		});
		spawnWorkerClient.enforceWorkerRssSample(
			{ text: "101 1\n", keptBytes: 6, totalBytes: 6, truncated: false },
			new Map([
				[101, watch(101)],
				[202, watch(202)],
			]),
		);

		expect(invalid).toEqual([{ pid: 202, reason: "ps omitted watched pid 202" }]);
	});

	test("signals only the live subprocess handle with the watched pid identity", async () => {
		const proc = Bun.spawn([process.execPath, "-e", "await Bun.sleep(10_000)"]);
		try {
			expect(spawnWorkerClient.signalWorkerMemoryInterrupt(proc, proc.pid + 1)).toBe(false);
			expect(proc.exitCode).toBeNull();
			expect(spawnWorkerClient.signalWorkerMemoryInterrupt(proc, proc.pid)).toBe(true);
			await proc.exited;
			expect(proc.signalCode).toBe("SIGUSR2");
		} finally {
			if (proc.exitCode === null && proc.signalCode === null) proc.kill("SIGKILL");
		}
	});
});
