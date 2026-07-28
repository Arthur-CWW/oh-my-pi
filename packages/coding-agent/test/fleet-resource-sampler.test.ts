import { describe, expect, it } from "bun:test";
import { decodeFleetResourceSamples, sampleFleetResources } from "../src/cli/fleet-resource-sampler";

describe("fleet resource sampler", () => {
	it("parses ps output for the current process", async () => {
		const samples = await sampleFleetResources([process.pid]);
		const sample = samples.get(process.pid);
		expect(sample).toBeDefined();
		if (!sample) throw new Error("current process was not sampled");
		expect(sample.rssMb).toBeGreaterThan(0);
		expect(sample.cpuPercent).toBeGreaterThanOrEqual(0);
		expect(sample.uptime).toMatch(/^(?:\d+-)?\d{1,3}:\d{2}(?::\d{2})?$/);
	});

	it("ignores malformed rows at the ps boundary", () => {
		const samples = decodeFleetResourceSamples(
			"123 2048 2.5 00:12\nnot-a-pid 2048 2.5 00:12\n124 NaN 1.0 00:13\n125 1024 -1 00:14\n126 1024 1.0 unknown\n",
		);
		expect([...samples.keys()]).toEqual([123]);
		expect(samples.get(123)).toEqual({ rssMb: 2, cpuPercent: 2.5, uptime: "00:12" });
	});
});
