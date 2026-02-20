import { describe, expect, it } from "bun:test";
import { Effect } from "effect";
import {
	parseCookiesCliArgs,
	readChromeCookiesEffect,
	runCookiesCli,
} from "../src/effect/chrome-cookies.js";

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

	it("parses CLI cookie names", () => {
		const parsed = parseCookiesCliArgs(["--names", "A,B", "C"]);
		expect(parsed.kind).toBe("ok");
		if (parsed.kind === "ok") {
			expect(parsed.value.names).toEqual(["A", "B", "C"]);
		}
	});

	it("runs cookies CLI with injected reader", async () => {
		const output: string[] = [];
		const errors: string[] = [];
		const exitCode = await runCookiesCli(["--names", "A,B", "--json"], {
			readCookies: async () => ({
				cookies: { A: "1", Z: "2" },
				warnings: ["keychain locked"],
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
	});
});
