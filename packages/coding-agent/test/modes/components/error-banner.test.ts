import { describe, expect, test } from "bun:test";
import { stripVTControlCharacters } from "node:util";
import { ErrorBannerComponent } from "../../../src/modes/components/error-banner";

describe("ErrorBannerComponent", () => {
	test("displays message and points to /errors", () => {
		const banner = new ErrorBannerComponent("Some scary error\nwith multiple lines");
		const text = stripVTControlCharacters(banner.render(80).join("\n"));

		expect(text).toContain("Some scary error");
		expect(text).toContain("with multiple lines");
		expect(text).toContain("/errors for history");
	});
});
