import { describe, expect, it } from "bun:test";
import {
	buildRuntimeMemoryReport,
	collectRuntimeGarbage,
} from "@oh-my-pi/pi-coding-agent/slash-commands/runtime-memory";

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

	it("reports explicit forced collection without promising a decrease", async () => {
		const report = await collectRuntimeGarbage();
		expect(report).toMatch(/^Forced GC RSS: .* → .* \(.* (reclaimed|higher)\)$/);
	});
});
