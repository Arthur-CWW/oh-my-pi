import { describe, expect, it } from "bun:test";
import {
	assertParkedResources,
	assertParkedDescriptorSlope,
	parsePssKilobytes,
	summarizeSamples,
	type LifecycleMemorySample,
	type LifecycleResourceCounts,
} from "../../bench/lifecycle-memory";

const PARKED_RESOURCES: LifecycleResourceCounts = {
	liveSessions: 0,
	subscriptions: 0,
	timers: 0,
};

function sample(
	childCount: number,
	phase: LifecycleMemorySample["phase"],
	baseline: number,
	bytesPerChild: number,
	pssBytesPerChild: number | null = bytesPerChild,
): LifecycleMemorySample {
	return {
		childCount,
		phase,
		rssBytes: baseline + childCount * bytesPerChild,
		heapUsedBytes: baseline + childCount * bytesPerChild,
		pssBytes: pssBytesPerChild === null ? null : baseline + childCount * pssBytesPerChild,
		resources: PARKED_RESOURCES,
		descriptors: 1,
		baselineDescriptors: 0,
	};
}

function samplesFor(
	phase: LifecycleMemorySample["phase"],
	baseline: number,
	bytesPerChild: number,
	pssBytesPerChild: number | null = bytesPerChild,
): LifecycleMemorySample[] {
	return [1, 10, 50].map(childCount => sample(childCount, phase, baseline, bytesPerChild, pssBytesPerChild));
}

describe("lifecycle memory benchmark helpers", () => {
	it("parses the rollup PSS field in kilobytes", () => {
		const rollup = `00000000-7fffffff ---p 00000000 00:00 0 [rollup]\nRss:                2048 kB\nPss:                 768 kB\nPss_Dirty:           512 kB\n`;

		expect(parsePssKilobytes(rollup)).toBe(768);
	});

	it("returns null when smaps_rollup has no PSS field", () => {
		expect(parsePssKilobytes("Rss:                2048 kB\nPrivate_Dirty:       512 kB\n")).toBeNull();
	});

	it("separates baseline memory from per-child slopes at N=1, 10, and 50", () => {
		const summary = summarizeSamples([
			...samplesFor("baseline", 1_000, 0),
			...samplesFor("live-idle", 1_000, 400, 250),
			...samplesFor("parked-settled", 1_000, 20, 10),
			...samplesFor("revived", 1_000, 350, 225),
			...samplesFor("reparked", 1_000, 20, 10),
		]);

		expect(summary.rssBytes["baseline"].baseline).toBeCloseTo(1_000);
		expect(summary.rssBytes["baseline"].perChild).toBeCloseTo(0);
		expect(summary.rssBytes["live-idle"].baseline).toBeCloseTo(1_000);
		expect(summary.rssBytes["live-idle"].perChild).toBeCloseTo(400);
		expect(summary.rssBytes["parked-settled"].baseline).toBeCloseTo(1_000);
		expect(summary.rssBytes["parked-settled"].perChild).toBeCloseTo(20);
		expect(summary.heapUsedBytes["live-idle"].perChild).toBeCloseTo(400);
		expect(summary.heapUsedBytes["parked-settled"].perChild).toBeCloseTo(20);
		expect(summary.pssBytes["live-idle"]?.baseline).toBeCloseTo(1_000);
		expect(summary.pssBytes["live-idle"]?.perChild).toBeCloseTo(250);
		expect(summary.pssBytes["parked-settled"]?.baseline).toBeCloseTo(1_000);
		expect(summary.pssBytes["parked-settled"]?.perChild).toBeCloseTo(10);
		expect(summary.descriptorDelta["parked-settled"].baseline).toBeCloseTo(1);
		expect(summary.descriptorDelta["parked-settled"].perChild).toBeCloseTo(0);
	});

	it("fits all N values instead of discarding the N=10 sample", () => {
		const liveSamples = samplesFor("live-idle", 1_000, 400);
		liveSamples[1] = { ...liveSamples[1], rssBytes: liveSamples[1].rssBytes + 1_000 };
		const summary = summarizeSamples([
			...samplesFor("baseline", 1_000, 0),
			...liveSamples,
			...samplesFor("parked-settled", 1_000, 20),
			...samplesFor("revived", 1_000, 350),
			...samplesFor("reparked", 1_000, 20),
		]);

		expect(summary.rssBytes["live-idle"].baseline).toBeCloseTo(1_487.7511024);
		expect(summary.rssBytes["live-idle"].perChild).toBeCloseTo(392.4056835);
	});

	it("accepts zero parked resources and fixed descriptor overhead", () => {
		expect(() => assertParkedResources(PARKED_RESOURCES)).not.toThrow();
		const summary = summarizeSamples([
			...samplesFor("baseline", 1_000, 0),
			...samplesFor("live-idle", 1_000, 400),
			...samplesFor("parked-settled", 1_000, 20).map(sample => ({ ...sample, descriptors: 8 })),
			...samplesFor("revived", 1_000, 350),
			...samplesFor("reparked", 1_000, 20).map(sample => ({ ...sample, descriptors: 8 })),
		]);
		expect(() => assertParkedDescriptorSlope(summary)).not.toThrow();
	});

	it("rejects every positive parked resource count", () => {
		for (const resources of [
			{ ...PARKED_RESOURCES, liveSessions: 1 },
			{ ...PARKED_RESOURCES, subscriptions: 1 },
			{ ...PARKED_RESOURCES, timers: 1 },
		]) {
			expect(() => assertParkedResources(resources)).toThrow();
		}
	});

	it("rejects descriptor deltas that grow with child count", () => {
		const summary = summarizeSamples([
			...samplesFor("baseline", 1_000, 0),
			...samplesFor("live-idle", 1_000, 400),
			...samplesFor("parked-settled", 1_000, 20).map(sample => ({ ...sample, descriptors: sample.childCount })),
			...samplesFor("revived", 1_000, 350),
			...samplesFor("reparked", 1_000, 20).map(sample => ({ ...sample, descriptors: sample.childCount })),
		]);
		expect(() => assertParkedDescriptorSlope(summary)).toThrow();
	});
});
