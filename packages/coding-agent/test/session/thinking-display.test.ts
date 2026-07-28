import { describe, expect, it } from "bun:test";
import { canonicalizeMessage, normalizeThinkingDisplay } from "@oh-my-pi/pi-coding-agent/utils/thinking-display";

describe("canonicalizeMessage", () => {
	it("returns empty string for undefined, empty, or whitespace-only", () => {
		expect(canonicalizeMessage(undefined)).toBe("");
		expect(canonicalizeMessage("")).toBe("");
		expect(canonicalizeMessage("   ")).toBe("");
		expect(canonicalizeMessage("\n\n")).toBe("");
	});

	it("returns empty string for dot-only content", () => {
		expect(canonicalizeMessage(".")).toBe("");
		expect(canonicalizeMessage("...")).toBe("");
		expect(canonicalizeMessage(" . ")).toBe("");
		expect(canonicalizeMessage("\n.")).toBe("");
		expect(canonicalizeMessage("…")).toBe("");
	});

	it("returns normal canonical content for actual prose", () => {
		expect(canonicalizeMessage("hello")).toBe("hello");
		expect(canonicalizeMessage("hello.")).toBe("hello.");
		expect(canonicalizeMessage(". hello .")).toBe(". hello .");
		expect(canonicalizeMessage("a")).toBe("a");
	});
});

describe("normalizeThinkingDisplay", () => {
	it("removes Sol-style empty separators between headings", () => {
		const raw = "## Plan\n<!-- -->\n## Implement\n<!--\n\t-->\n## Verify";

		expect(normalizeThinkingDisplay(raw)).toBe("## Plan\n\n## Implement\n\n## Verify");
		expect(raw).toBe("## Plan\n<!-- -->\n## Implement\n<!--\n\t-->\n## Verify");
	});

	it("removes whitespace variants before canonicalizing blank and dot-only thinking", () => {
		expect(normalizeThinkingDisplay("<!-- \t\n -->")).toBe("");
		expect(normalizeThinkingDisplay("\n<!--\r\n-->\n...\n<!--\f-->\n")).toBe("");
	});

	it("preserves comments in fenced code", () => {
		const thinking = "```html\n<!-- -->\n```\n\nUse this literal comment.";

		expect(normalizeThinkingDisplay(thinking)).toBe(thinking);
	});

	it("preserves non-empty comments and incomplete delimiters", () => {
		expect(normalizeThinkingDisplay("Keep <!-- explanation --> visible.")).toBe("Keep <!-- explanation --> visible.");
		expect(normalizeThinkingDisplay("<!--")).toBe("<!--");
		expect(normalizeThinkingDisplay("<!-- --")).toBe("<!-- --");
	});

	it("does not alter final assistant text normalization", () => {
		const finalText = "Final answer <!-- --> remains untouched.";

		expect(canonicalizeMessage(finalText)).toBe(finalText);
	});
});
