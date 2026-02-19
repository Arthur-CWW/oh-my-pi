import { describe, expect, it } from "bun:test";
import { Effect } from "effect";
import { readChromeCookiesEffect } from "../src/effect/chrome-cookies.js";

describe("effect chrome cookies", () => {
	it("maps null cookie read to typed error", async () => {
		const exit = await Effect.runPromiseExit(
			readChromeCookiesEffect({ getGoogleCookies: async () => null }),
		);
		expect(exit._tag).toBe("Failure");
	});

	it("returns cookies and warnings on success", async () => {
		const result = await Effect.runPromise(
			readChromeCookiesEffect({
				getGoogleCookies: async () => ({
					cookies: { "__Secure-1PSID": "x" },
					warnings: ["warning"],
				}),
			}),
		);
		expect(result.cookies["__Secure-1PSID"]).toBe("x");
		expect(result.warnings).toEqual(["warning"]);
	});
});
