import { afterEach, beforeAll, describe, expect, it, vi } from "bun:test";
import { renderResult } from "@oh-my-pi/pi-coding-agent/lsp/render";
import * as themeModule from "@oh-my-pi/pi-coding-agent/modes/theme/theme";

beforeAll(async () => {
	await themeModule.initTheme(false, undefined, undefined, "dark", "light");
});

afterEach(() => {
	vi.restoreAllMocks();
});

describe("LSP render", () => {
	it("renders hover code through the cached theme highlighter", () => {
		const highlightSpy = vi.spyOn(themeModule, "highlightCode").mockReturnValue(["CACHED_HIGHLIGHT"]);
		const component = renderResult(
			{ content: [{ type: "text", text: "```ts\nconst value = 1;\n```" }] },
			{ expanded: true, isPartial: false },
			themeModule.theme,
		);

		const rendered = Bun.stripANSI(component.render(120).join("\n"));

		expect(highlightSpy).toHaveBeenCalledTimes(1);
		expect(highlightSpy).toHaveBeenCalledWith("const value = 1;", "ts", themeModule.theme);
		expect(rendered).toContain("CACHED_HIGHLIGHT");
		expect(rendered).not.toMatch(/[├└│┌┐┘┤┬┴┼╭╮╰╯]/);
	});
	it("renders diagnostics, references, symbols, and generic output with plain indentation and no tree/box glyphs", () => {
		const cases = [
			{
				text: "2 error(s)\nsrc/foo.ts:10:5: error TS1005 semicolon expected\nsrc/bar.ts:20:1: error TS2304 cannot find name",
				contains: "src/foo.ts",
			},
			{
				text: "3 reference(s)\nsrc/foo.ts:10:5\nsrc/foo.ts:12:8\nsrc/bar.ts:1:1",
				contains: "src/foo.ts",
			},
			{
				text: "Symbols in src/foo.ts:\nfn parentSymbol @ line 10\n  method childSymbol @ line 12",
				contains: "parentSymbol",
			},
			{
				text: "first output line\nsecond output line\nthird output line",
				contains: "second output line",
			},
		];

		for (const testCase of cases) {
			const rendered = Bun.stripANSI(
				renderResult(
					{ content: [{ type: "text", text: testCase.text }] },
					{ expanded: true, isPartial: false },
					themeModule.theme,
				)
					.render(120)
					.join("\n"),
			);
			// The framed container draws only plain horizontal rules (─); tree
			// connectors, frame sides, and box corners must never appear.
			expect(rendered).not.toMatch(/[├└│┌┐┘┤┬┴┼╭╮╰╯]/);
			expect(rendered).toContain(testCase.contains);
		}
	});
});
