import { describe, expect, it } from "bun:test";
import { formatIdPreview } from "@oh-my-pi/pi-coding-agent/internal-urls/id-preview";

describe("formatIdPreview", () => {
	it("bounds unique IDs and reports the hidden count", () => {
		expect(formatIdPreview(["A", "B", "C", "D", "E", "F", "A"])).toBe(
			"A, B, C, D, E (+1 more)",
		);
	});

	it("renders empty and short collections without noise", () => {
		expect(formatIdPreview([])).toBe("none");
		expect(formatIdPreview(["A", "B"])).toBe("A, B");
	});
});
