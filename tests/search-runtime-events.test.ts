import { rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "bun:test";
import { Effect } from "effect";
import { makeSqliteEventStore } from "../src/effect/observability/EventStore.js";
import {
	makeInMemorySearchEvents,
	makeSearchEventsService,
} from "../src/effect/search-events.js";
import {
	SearchProviderError,
	searchWithFallbackEffect,
} from "../src/effect/search-runtime.js";

function tempDbPath(name: string): string {
	return join(tmpdir(), `pi-web-access-${name}-${Date.now()}-${Math.random().toString(16).slice(2)}.sqlite`);
}

describe("search runtime events", () => {
	it("emits expected sequence for auto provider success via Kagi", async () => {
		const inMemory = makeInMemorySearchEvents();
		let geminiCalls = 0;

		const result = await Effect.runPromise(
			searchWithFallbackEffect(
				"effect ts",
				{ provider: "auto", correlationId: "corr-kagi-success" },
				{
					events: inMemory.service,
					runKagiSearch: () =>
						Effect.succeed({
							answer: "Kagi answer",
							results: [{ title: "Effect", url: "https://effect.website", snippet: "" }],
						}),
					runGeminiSearch: () => {
						geminiCalls += 1;
						return Effect.succeed({ answer: "Gemini", results: [] });
					},
				},
			),
		);

		expect(result.providerUsed).toBe("kagi");
		expect(result.correlationId).toBe("corr-kagi-success");
		expect(geminiCalls).toBe(0);
		expect(inMemory.events.map((event) => event.name)).toEqual([
			"SearchRequested",
			"ProviderSelected",
			"ProviderAttempted",
			"ProviderSucceeded",
			"ToolCompleted",
		]);
		expect(inMemory.events.every((event) => event.correlationId === "corr-kagi-success")).toBe(true);
	});

	it("emits fallback sequence when Kagi fails and Gemini succeeds", async () => {
		const inMemory = makeInMemorySearchEvents();

		const result = await Effect.runPromise(
			searchWithFallbackEffect(
				"fallback query",
				{ provider: "auto", correlationId: "corr-fallback-success" },
				{
					events: inMemory.service,
					runKagiSearch: () =>
						Effect.fail(
							SearchProviderError.make({
								provider: "kagi",
								reason: "kagi unavailable",
							}),
						),
					runGeminiSearch: () =>
						Effect.succeed({
							answer: "Gemini fallback answer",
							results: [{ title: "Gemini", url: "https://gemini.google.com", snippet: "" }],
						}),
				},
			),
		);

		expect(result.providerUsed).toBe("gemini");
		expect(inMemory.events.map((event) => event.name)).toEqual([
			"SearchRequested",
			"ProviderSelected",
			"ProviderAttempted",
			"ProviderFailed",
			"FallbackAttempted",
			"ProviderSelected",
			"ProviderAttempted",
			"ProviderSucceeded",
			"ToolCompleted",
		]);
	});

	it("emits failure sequence when both providers fail", async () => {
		const inMemory = makeInMemorySearchEvents();

		const exit = await Effect.runPromiseExit(
			searchWithFallbackEffect(
				"total failure",
				{ provider: "auto", correlationId: "corr-total-failure" },
				{
					events: inMemory.service,
					runKagiSearch: () =>
						Effect.fail(
							SearchProviderError.make({
								provider: "kagi",
								reason: "kagi down",
							}),
						),
					runGeminiSearch: () =>
						Effect.fail(
							SearchProviderError.make({
								provider: "gemini",
								reason: "gemini down",
							}),
						),
				},
			),
		);

		expect(exit._tag).toBe("Failure");
		if (exit._tag === "Failure") {
			expect(exit.cause._tag).toBe("Fail");
			if (exit.cause._tag === "Fail") {
				expect(exit.cause.error._tag).toBe("SearchFallbackError");
			}
		}
		expect(inMemory.events.map((event) => event.name)).toEqual([
			"SearchRequested",
			"ProviderSelected",
			"ProviderAttempted",
			"ProviderFailed",
			"FallbackAttempted",
			"ProviderSelected",
			"ProviderAttempted",
			"ProviderFailed",
			"ToolCompleted",
		]);
	});

	it("optionally persists emitted events to sqlite", async () => {
		const dbPath = tempDbPath("search-events");
		const correlationId = "corr-sqlite-events";
		const eventsService = await Effect.runPromise(makeSearchEventsService({ dbPath }));

		await Effect.runPromise(
			searchWithFallbackEffect(
				"sqlite search",
				{ provider: "kagi", correlationId },
				{
					events: eventsService,
					runKagiSearch: () =>
						Effect.succeed({
							answer: "ok",
							results: [{ title: "SQLite", url: "https://sqlite.org", snippet: "" }],
						}),
					runGeminiSearch: () =>
						Effect.succeed({
							answer: "unused",
							results: [],
						}),
				},
			),
		);

		const store = await Effect.runPromise(makeSqliteEventStore({ dbPath }));
		const events = await Effect.runPromise(store.listByCorrelationId(correlationId));

		expect(events.length).toBeGreaterThan(0);
		expect(events.map((event) => event.name)).toContain("SearchRequested");
		expect(events.map((event) => event.name)).toContain("ToolCompleted");

		await Effect.runPromise(store.close);
		await Effect.runPromise(eventsService.close);
		rmSync(dbPath, { force: true });
	});
});
