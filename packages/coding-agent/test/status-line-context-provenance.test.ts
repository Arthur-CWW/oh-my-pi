import { beforeAll, describe, expect, it } from "bun:test";
import type { ContextWindowSource } from "@oh-my-pi/pi-catalog/types";
import { renderSegment } from "@oh-my-pi/pi-coding-agent/modes/components/status-line/segments";
import type { SegmentContext } from "@oh-my-pi/pi-coding-agent/modes/components/status-line/types";
import { initTheme } from "@oh-my-pi/pi-coding-agent/modes/theme/theme";

beforeAll(async () => {
	await initTheme();
});

function contextWithWindow(contextWindow: number, contextWindowSource?: ContextWindowSource): SegmentContext {
	return {
		contextPercent: 12.5,
		contextWindow,
		contextWindowSource,
		autoCompactEnabled: false,
	} as unknown as SegmentContext;
}

describe("status-line context window provenance", () => {
	it("labels the Codex upstream default in percentage and total context segments", () => {
		const context = contextWithWindow(372_000, "codex-upstream");

		expect(renderSegment("context_pct", context).content).toContain("372K (codex upstream)");
		expect(renderSegment("context_total", context).content).toContain("372K (codex upstream)");
	});

	it("labels a user override", () => {
		const segment = renderSegment("context_total", contextWithWindow(372_000, "user-override"));

		expect(segment.content).toContain("372K (user override)");
	});

	it("preserves the existing output when provenance is absent", () => {
		const context = contextWithWindow(372_000);

		expect(renderSegment("context_pct", context).content).toContain("12.5%/372K");
		expect(renderSegment("context_total", context).content).toContain("372K");
		expect(renderSegment("context_total", context).content).not.toContain("(");
	});
});
