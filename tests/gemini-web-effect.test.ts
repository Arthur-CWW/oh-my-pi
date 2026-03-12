import { describe, expect, it } from "bun:test";
import { Effect } from "effect";
import { isGeminiWebAvailable } from "../src/effect/gemini-web.js";

describe("effect gemini-web availability", () => {
	it("returns null when required Gemini cookies are missing", async () => {
		const result = await isGeminiWebAvailable({
			readCookies: () =>
				Effect.succeed({
					cookies: {
						NID: "present",
					},
				}),
		});

		expect(result).toBeNull();
	});

	it("returns cookies when required Gemini cookies are present", async () => {
		const result = await isGeminiWebAvailable({
			readCookies: () =>
				Effect.succeed({
					cookies: {
						"__Secure-1PSID": "a",
						"__Secure-1PSIDTS": "b",
						NID: "c",
					},
				}),
		});

		expect(result).toEqual({
			"__Secure-1PSID": "a",
			"__Secure-1PSIDTS": "b",
			NID: "c",
		});
	});
});
