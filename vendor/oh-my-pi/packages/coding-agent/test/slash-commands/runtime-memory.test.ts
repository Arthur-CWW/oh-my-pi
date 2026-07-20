import { describe, expect, it } from "bun:test";
import {
	buildRuntimeMemoryReport,
	classifyRuntimeMemoryChange,
	collectRuntimeGarbage,
	formatRuntimeMemoryChange,
	type RuntimeMemorySnapshot,
} from "@oh-my-pi/pi-coding-agent/slash-commands/runtime-memory";

const GIBIBYTE = 1024 ** 3;

function memorySnapshot(
	coordinatorRss: number,
	jscHeapSize: number,
	jscHeapCapacity: number,
	jscExtraMemory: number,
): RuntimeMemorySnapshot {
	return { coordinatorRss, jscHeapSize, jscHeapCapacity, jscExtraMemory };
}

describe("/runtime-memory", () => {
	it("reports bounded RSS and JavaScriptCore retention categories", () => {
		const report = buildRuntimeMemoryReport();
		expect(report.split("\n")).toHaveLength(8);
		expect(report).toContain("Coordinator RSS:");
		expect(report).toContain("JSC heap:");
		expect(report).toContain("JSC extra memory:");
		expect(report).toContain("Objects:");
		expect(report).toContain("Top object types:");
		expect(report).toContain("/debug → Memory Report");
	});

	it("classifies a measured decrease as reclaimed", () => {
		const before = memorySnapshot(GIBIBYTE, 2 * GIBIBYTE, 3 * GIBIBYTE, 4 * GIBIBYTE);
		const after = memorySnapshot(0.9 * GIBIBYTE, 2.1 * GIBIBYTE, 3 * GIBIBYTE, 4 * GIBIBYTE);
		expect(classifyRuntimeMemoryChange(before, after)).toBe("reclaimed");
		expect(formatRuntimeMemoryChange(before, after)).toContain(
			"Coordinator RSS: 1.00 GiB → 0.90 GiB (Δ -0.10 GiB)",
		);
	});

	it("classifies equal measurements as unchanged", () => {
		const before = memorySnapshot(GIBIBYTE, 2 * GIBIBYTE, 3 * GIBIBYTE, 4 * GIBIBYTE);
		expect(classifyRuntimeMemoryChange(before, before)).toBe("unchanged");
		expect(formatRuntimeMemoryChange(before, before)).toContain("(Δ +0.00 GiB)");
	});

	it("classifies increases without decreases as higher", () => {
		const before = memorySnapshot(GIBIBYTE, 2 * GIBIBYTE, 3 * GIBIBYTE, 4 * GIBIBYTE);
		const after = memorySnapshot(1.1 * GIBIBYTE, 2 * GIBIBYTE, 3.1 * GIBIBYTE, 4 * GIBIBYTE);
		expect(classifyRuntimeMemoryChange(before, after)).toBe("higher");
		expect(formatRuntimeMemoryChange(before, after)).toContain(
			"JSC heap capacity: 3.00 GiB → 3.10 GiB (Δ +0.10 GiB)",
		);
	});

	it("reports explicit forced collection measurements without promising RSS release", async () => {
		const report = await collectRuntimeGarbage();
		expect(report.split("\n")).toHaveLength(7);
		expect(report).toMatch(/Coordinator RSS: .* → .* \(Δ [+-].* GiB\)/);
		expect(report).toMatch(/JSC heap size: .* → .* \(Δ [+-].* GiB\)/);
		expect(report).toMatch(/JSC heap capacity: .* → .* \(Δ [+-].* GiB\)/);
		expect(report).toMatch(/JSC extra memory: .* → .* \(Δ [+-].* GiB\)/);
		expect(report).toMatch(/Measured change: (reclaimed|unchanged|higher)/);
		expect(report).toContain("Native RSS release is not guaranteed");
	});
});
