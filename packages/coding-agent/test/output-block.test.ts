import { beforeAll, describe, expect, it } from "bun:test";
import { stripVTControlCharacters } from "node:util";
import { initTheme, theme } from "@oh-my-pi/pi-coding-agent/modes/theme/theme";
import { renderOutputBlock, renderStatusLine } from "@oh-my-pi/pi-coding-agent/tui";
import { visibleWidth } from "@oh-my-pi/pi-tui";

// The regression fixture: a real, deeply-nested source path whose length
// exceeds a typical terminal column count. It must render in full when the
// terminal is wide, and degrade path-aware (basename kept) when it is narrow.
const LONG_PATH = "oh-my-pi/packages/coding-agent/src/modes/controllers/input-controller.ts";
const BASENAME = "input-controller.ts";

/** Plain (ANSI-stripped, right-trimmed) text of the heading row. */
function headingOf(width: number, title: string): string {
	// No status icon: keeps the assertion independent of the active symbol
	// preset while still exercising the styled (ANSI-wrapped) title path.
	const header = renderStatusLine({ title }, theme);
	const lines = renderOutputBlock({ header, state: "success", sections: [{ lines: ["body"] }], width }, theme);
	return stripVTControlCharacters(lines[0] ?? "").replace(/\s+$/, "");
}

describe("renderOutputBlock heading", () => {
	beforeAll(async () => {
		await initTheme();
	});

	it("renders the full file path when the terminal is wide", () => {
		const heading = headingOf(200, `Read ${LONG_PATH}`);
		expect(heading).toContain(LONG_PATH);
		expect(heading).not.toContain("…");
	});

	it("leaves a heading that already fits within the width untouched", () => {
		const title = `Read ${LONG_PATH}`;
		// visibleWidth of the styled title plus generous slack.
		const heading = headingOf(visibleWidth(title) + 20, title);
		expect(heading).toBe(title);
	});

	it("shortens a long path from the middle at narrow width, keeping the basename", () => {
		const title = `Read ${LONG_PATH}`;
		const heading = headingOf(72, title);

		// Path-aware middle elision: exactly one ellipsis, basename preserved.
		expect(heading).toContain("…");
		expect(heading.split("…")).toHaveLength(2);
		expect(heading).toContain(BASENAME);

		// The surviving head and tail are a genuine prefix/suffix of the real
		// title — the middle (and only the middle) was elided, nothing invented.
		const [head, tail] = heading.split("…");
		expect(title.startsWith(head!)).toBe(true);
		expect(title.endsWith(tail!)).toBe(true);
	});

	it("keeps every rendered line bounded to the requested width", () => {
		const title = `Read ${LONG_PATH}`;
		for (const width of [24, 40, 60, 72, 80, 120, 200]) {
			const lines = renderOutputBlock(
				{ header: renderStatusLine({ title }, theme), state: "success", sections: [{ lines: ["body"] }], width },
				theme,
			);
			for (const line of lines) {
				expect(visibleWidth(line)).toBeLessThanOrEqual(width);
			}
		}
	});

	it("shortens in a single heading row without inflating the line count", () => {
		// One heading + one body line: the narrow heading must elide in place, not
		// wrap into extra rows (which would push the status/line count around).
		const lines = renderOutputBlock(
			{
				header: renderStatusLine({ title: `Read ${LONG_PATH}` }, theme),
				state: "success",
				sections: [{ lines: ["body"] }],
				width: 40,
			},
			theme,
		);
		expect(lines).toHaveLength(2);
	});

	it("is deterministic for a given width", () => {
		const title = `Read ${LONG_PATH}`;
		const header = renderStatusLine({ title }, theme);
		const a = renderOutputBlock({ header, state: "success", sections: [{ lines: ["body"] }], width: 60 }, theme);
		const b = renderOutputBlock({ header, state: "success", sections: [{ lines: ["body"] }], width: 60 }, theme);
		expect(a).toEqual(b);
	});
});
