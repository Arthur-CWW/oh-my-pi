import { describe, expect, it } from "bun:test";
import { extractRSCContent } from "../src/old/rsc-extract.ts";

describe("extractRSCContent", () => {
	it("returns null for non-RSC HTML", () => {
		const html = "<html><head><title>Test</title></head><body><p>Hello</p></body></html>";
		expect(extractRSCContent(html)).toBeNull();
	});
});
