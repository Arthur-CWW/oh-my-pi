import { describe, expect, it } from "bun:test";
import { Effect } from "effect";
import type { KagiSearchResult } from "../src/kagi-client.js";
import {
	runKagiSocketSearchEffect,
	type KagiSearchRuntimeDeps,
} from "../src/kagi-search-effect.js";

function baseResult(overrides: Partial<KagiSearchResult>): KagiSearchResult {
	return {
		capturedAt: new Date().toISOString(),
		requestUrl: "https://kagi.com/socket/search?q=test",
		referer: "https://kagi.com/search?q=test",
		status: 200,
		ok: true,
		headersSent: {},
		responseHeaders: {},
		rawSse: "",
		parsedEvents: [],
		...overrides,
	};
}

describe("kagi package effect interface", () => {
	it("returns successful search results", async () => {
		const deps: KagiSearchRuntimeDeps = {
			runSocketSearchWithAutoRefresh: async () =>
				baseResult({
					status: 200,
					ok: true,
				}),
		};

		const result = await Effect.runPromise(
			runKagiSocketSearchEffect(
				{
					query: "effect ts",
				},
				undefined,
				deps,
			),
		);

		expect(result.ok).toBe(true);
		expect(result.status).toBe(200);
	});

	it("classifies Kagi HTTP authorization failures inside package boundary", async () => {
		const deps: KagiSearchRuntimeDeps = {
			runSocketSearchWithAutoRefresh: async () =>
				baseResult({
					status: 401,
					ok: false,
				}),
		};

		const error = await Effect.runPromise(
			Effect.flip(
				runKagiSocketSearchEffect(
					{
						query: "effect ts",
					},
					undefined,
					deps,
				),
			),
		);

		expect(error.code).toBe("unauthorized");
		expect(error.status).toBe(401);
		expect(error.reason).toContain("unauthorized");
	});

	it("classifies session bootstrap failures as session-unavailable", async () => {
		const deps: KagiSearchRuntimeDeps = {
			runSocketSearchWithAutoRefresh: async () => {
				throw new Error(
					"Kagi session unavailable. Tried /tmp/session.json and could not refresh from Chrome",
				);
			},
		};

		const error = await Effect.runPromise(
			Effect.flip(
				runKagiSocketSearchEffect(
					{
						query: "effect ts",
					},
					undefined,
					deps,
				),
			),
		);

		expect(error.code).toBe("session-unavailable");
		expect(error.reason).toContain("Kagi session unavailable");
	});
});
