import { describe, expect, it } from "bun:test";
import { Effect } from "effect";
import {
	readChromeCookiesEffect,
	runCookiesCli,
	selectGoogleCookies,
} from "../src/effect/chrome-cookies.js";

describe("effect chrome cookies", () => {
	it("falls back to DevTools on linux when legacy cookies are unavailable", async () => {
		const result = await Effect.runPromise(
			readChromeCookiesEffect({
				readLegacyGoogleCookies: async () => null,
				readGoogleCookiesFromDevTools: async () => ({
					cookies: { "__Secure-1PSID": "x" },
					warnings: ["devtools path"],
				}),
				getChromeDebugUrl: () => "http://localhost:9222",
				getPlatform: () => "linux",
			}),
		);
		expect(result.cookies["__Secure-1PSID"]).toBe("x");
		expect(result.source).toBe("devtools");
		expect(result.warnings).toContain("devtools path");
	});

	it("returns none source with warnings when no cookies are found", async () => {
		const result = await Effect.runPromise(
			readChromeCookiesEffect({
				readLegacyGoogleCookies: async () => ({ cookies: {}, warnings: ["legacy empty"] }),
				readGoogleCookiesFromDevTools: async () => ({ cookies: {}, warnings: ["devtools empty"] }),
				getChromeDebugUrl: () => "http://localhost:9222",
				getPlatform: () => "linux",
			}),
		);
		expect(result.source).toBe("none");
		expect(result.warnings).toContain("legacy empty");
		expect(result.warnings).toContain("devtools empty");
	});

	it("filters Google cookies from browser cookie rows", () => {
		const cookies = selectGoogleCookies([
			{ name: "__Secure-1PSID", value: "x", domain: ".google.com", expires: -1 },
			{ name: "random", value: "nope", domain: ".google.com", expires: -1 },
			{ name: "NID", value: "y", domain: ".example.com", expires: -1 },
			{ name: "__Secure-1PSIDTS", value: "z", domain: "gemini.google.com", expires: 9999999999 },
		]);
		expect(cookies["__Secure-1PSID"]).toBe("x");
		expect(cookies["__Secure-1PSIDTS"]).toBe("z");
		expect(cookies.NID).toBeUndefined();
	});


	it("runs cookies CLI with injected reader", async () => {
		const output: string[] = [];
		const errors: string[] = [];
		const exitCode = await runCookiesCli(["--names", "A,B", "--json"], {
			readCookies: async () => ({
				cookies: { A: "1", Z: "2" },
				warnings: ["keychain locked"],
				source: "devtools",
			}),
			stdout: (text) => output.push(text),
			stderr: (text) => errors.push(text),
		});

		expect(exitCode).toBe(0);
		expect(errors).toEqual([]);
		expect(output[0]).toContain('"present"');
		expect(output[0]).toContain('"A"');
		expect(output[0]).toContain('"missing"');
		expect(output[0]).toContain('"B"');
		expect(output[0]).toContain('"source": "devtools"');
	});
});
