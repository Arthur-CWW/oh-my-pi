import { beforeAll, describe, expect, it } from "bun:test";
import { stripVTControlCharacters } from "node:util";
import { renderSegment } from "@oh-my-pi/pi-coding-agent/modes/components/status-line/segments";
import type { SegmentContext } from "@oh-my-pi/pi-coding-agent/modes/components/status-line/types";
import { initTheme } from "@oh-my-pi/pi-coding-agent/modes/theme/theme";

beforeAll(async () => {
	await initTheme();
});

function context(width: number, focusedAgentId?: string): SegmentContext {
	return {
		width,
		focusedAgentId,
		session: { getAgentId: () => undefined },
	} as unknown as SegmentContext;
}

describe("agent IRC id status segment", () => {
	it("shows the main IRC peer id on the default persistent HUD surface", () => {
		const rendered = renderSegment("pi", context(80));
		expect(stripVTControlCharacters(rendered.content)).toContain("Main");
	});

	it("preserves the prior icon-only footprint at narrow widths", () => {
		const rendered = renderSegment("pi", context(20));
		expect(stripVTControlCharacters(rendered.content)).not.toContain("Main");
	});

	it("uses the focused child IRC id instead of Main", () => {
		const rendered = renderSegment("pi", context(20, "IdWhoamiUx"));
		expect(stripVTControlCharacters(rendered.content)).toContain("IdWhoamiUx");
	});
});
