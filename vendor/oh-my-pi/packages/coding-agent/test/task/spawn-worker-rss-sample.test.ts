import { describe, expect, test } from "bun:test";
import { readCapped } from "@oh-my-pi/pi-utils";
import * as spawnWorkerClient from "../../src/task/spawn-worker-client";

describe("worker RSS sampling", () => {
	test("an exact ps overflow invalidates every affected worker without publishing a partial sample", async () => {
		const body = "101 999\n202 1\n";
		const sample = await readCapped(new Blob([body]).stream(), 8);
		expect(sample).toMatchObject({ keptBytes: 8, totalBytes: 14, truncated: true });

		const exceeded: number[] = [];
		const invalid: Array<{ pid: number; reason: string }> = [];
		const watch = (pid: number) => ({
			maxBytes: 1,
			onExceeded: () => exceeded.push(pid),
			onSampleInvalid: (reason: string) => invalid.push({ pid, reason }),
		});
		const watches = new Map([
			[101, watch(101)],
			[202, watch(202)],
		]);

		spawnWorkerClient.enforceWorkerRssSample(sample, watches);

		expect(exceeded).toEqual([]);
		expect(invalid.map(entry => entry.pid)).toEqual([101, 202]);
		expect(invalid[0]?.reason).toBe("ps output overflowed: kept 8 of 14 bytes");
	});
});
