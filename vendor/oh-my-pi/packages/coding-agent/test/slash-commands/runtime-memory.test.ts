import { describe, expect, it } from "bun:test";
import {
	classifyRuntimeMemoryChange,
	collectRuntimeGarbage,
	formatRuntimeMemoryChange,
	formatRuntimeMemoryReport,
	type RuntimeMemoryReport,
	type RuntimeMemorySnapshot,
	sampleRuntimeMemoryReport,
} from "@oh-my-pi/pi-coding-agent/slash-commands/runtime-memory";

const GIBIBYTE = 1024 ** 3;

function memorySnapshot(overrides: Partial<RuntimeMemorySnapshot> = {}): RuntimeMemorySnapshot {
	return {
		coordinatorRss: 10 * GIBIBYTE,
		jscHeapSize: 2 * GIBIBYTE,
		jscHeapCapacity: 3 * GIBIBYTE,
		jscExtraMemory: 4 * GIBIBYTE,
		mimallocInUse: 5 * GIBIBYTE,
		mimallocCommitted: 6 * GIBIBYTE,
		...overrides,
	};
}

function memoryReport(overrides: Partial<RuntimeMemoryReport> = {}): RuntimeMemoryReport {
	return {
		...memorySnapshot(),
		nodeHeapUsed: 0.03 * GIBIBYTE,
		nodeHeapTotal: 0.05 * GIBIBYTE,
		external: 0.1 * GIBIBYTE,
		arrayBuffers: 0.2 * GIBIBYTE,
		objectCount: 1_234,
		protectedObjectCount: 12,
		objectTypeCounts: { Structure: 900, Function: 300 },
		mimallocPeakInUse: 40 * GIBIBYTE,
		mimallocPeakCommitted: 54 * GIBIBYTE,
		pageFaults: 987_654,
		...overrides,
	};
}

describe("/runtime-memory", () => {
	it("reports the mimalloc commit high-water mark that explains the RSS gap", () => {
		const report = formatRuntimeMemoryReport(
			memoryReport({ coordinatorRss: 9.77 * GIBIBYTE, jscHeapSize: 0.03 * GIBIBYTE }),
		);
		expect(report).toContain("Coordinator RSS: 9.77 GiB");
		expect(report).toContain("mimalloc: 5.00 GiB in use / 6.00 GiB committed");
		expect(report).toContain("mimalloc peak: 40.00 GiB in use / 54.00 GiB committed");
		expect(report).toContain("Page faults: 987,654");
		expect(report).toContain("Top object types: Structure=900, Function=300");
	});

	it("states the actual reclaim mechanism instead of promising a collection frees RSS", () => {
		const report = formatRuntimeMemoryReport(memoryReport());
		expect(report).toContain("non-forced mimalloc collect of this thread only");
		expect(report).toContain("/restart is the only lever that lowers RSS");
	});

	it("samples every field the report prints from the live process", () => {
		const sample = sampleRuntimeMemoryReport();
		// Peak commit is a durable high-water mark, so it can never be below the
		// current commit no matter when the process is sampled.
		expect(sample.mimallocPeakCommitted).toBeGreaterThanOrEqual(sample.mimallocCommitted);
		expect(sample.mimallocPeakInUse).toBeGreaterThanOrEqual(sample.mimallocInUse);
		expect(sample.coordinatorRss).toBeGreaterThan(0);
		expect(formatRuntimeMemoryReport(sample)).toContain("mimalloc peak:");
	});

	it("classifies a JSC-only decrease as unchanged while RSS is flat", () => {
		const before = memorySnapshot();
		const after = memorySnapshot({
			jscHeapSize: GIBIBYTE,
			jscHeapCapacity: 2 * GIBIBYTE,
			jscExtraMemory: 3 * GIBIBYTE,
			mimallocInUse: 4 * GIBIBYTE,
		});
		expect(classifyRuntimeMemoryChange(before, after)).toBe("unchanged");
		expect(formatRuntimeMemoryChange(before, after)).toContain("Measured change (coordinator RSS): unchanged");
	});

	it("classifies a JSC decrease under rising RSS as higher", () => {
		const before = memorySnapshot();
		const after = memorySnapshot({ coordinatorRss: 11 * GIBIBYTE, jscHeapSize: GIBIBYTE });
		expect(classifyRuntimeMemoryChange(before, after)).toBe("higher");
	});

	it("classifies a falling RSS as reclaimed even when JSC counters grow", () => {
		const before = memorySnapshot();
		const after = memorySnapshot({ coordinatorRss: 9 * GIBIBYTE, jscHeapSize: 8 * GIBIBYTE });
		expect(classifyRuntimeMemoryChange(before, after)).toBe("reclaimed");
		expect(formatRuntimeMemoryChange(before, after)).toContain(
			"Coordinator RSS: 10.00 GiB → 9.00 GiB (Δ -1.00 GiB)",
		);
	});

	it("shows the mimalloc committed delta a forced collection did not move", () => {
		const before = memorySnapshot();
		const after = memorySnapshot({ mimallocInUse: 4.5 * GIBIBYTE });
		expect(formatRuntimeMemoryChange(before, after)).toContain(
			"mimalloc committed: 6.00 GiB → 6.00 GiB (Δ +0.00 GiB)",
		);
		expect(formatRuntimeMemoryChange(before, after)).toContain(
			"Only RSS decides that verdict; the JSC and mimalloc counters above are informational.",
		);
	});

	it("measures a real forced collection without promising RSS release", async () => {
		const report = await collectRuntimeGarbage();
		expect(report).toMatch(/Coordinator RSS: .* → .* \(Δ [+-].* GiB\)/);
		expect(report).toMatch(/mimalloc committed: .* → .* \(Δ [+-].* GiB\)/);
		expect(report).toMatch(/Measured change \(coordinator RSS\): (reclaimed|unchanged|higher)/);
	});
});
