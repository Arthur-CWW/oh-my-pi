import { rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "bun:test";
import { Effect } from "effect";
import { makeEvent } from "../src/effect/core/Observability.js";
import { makeSqliteEventStore } from "../src/effect/observability/EventStore.js";

function tempDbPath(name: string): string {
	return join(tmpdir(), `pi-web-access-${name}-${Date.now()}-${Math.random().toString(16).slice(2)}.sqlite`);
}

describe("sqlite event store", () => {
	it("persists and retrieves events by correlation id", async () => {
		const dbPath = tempDbPath("event-store");
		const store = await Effect.runPromise(makeSqliteEventStore({ dbPath }));
		const correlationId = "corr-123";

		await Effect.runPromise(
			store.append(makeEvent("SearchRequested", { query: "effect" }, correlationId, "session-1")),
		);
		await Effect.runPromise(
			store.append(makeEvent("ProviderSelected", { provider: "gemini" }, correlationId, "session-1")),
		);

		const events = await Effect.runPromise(store.listByCorrelationId(correlationId));
		expect(events.length).toBe(2);
		expect(events[0]?.name).toBe("SearchRequested");
		expect(events[1]?.name).toBe("ProviderSelected");
		expect(events[0]?.payload).toEqual({ query: "effect" });

		await Effect.runPromise(store.close);
		rmSync(dbPath, { force: true });
	});

	it("returns recent events across correlations with limit", async () => {
		const dbPath = tempDbPath("event-store-recent");
		const store = await Effect.runPromise(makeSqliteEventStore({ dbPath }));

		await Effect.runPromise(
			store.append({
				eventId: "evt-1",
				timestamp: 1,
				correlationId: "corr-a",
				name: "SearchRequested",
				payload: { query: "a" },
			}),
		);
		await Effect.runPromise(
			store.append({
				eventId: "evt-2",
				timestamp: 2,
				correlationId: "corr-b",
				name: "ProviderSelected",
				payload: { provider: "gemini" },
			}),
		);

		const recent = await Effect.runPromise(store.listRecent(1));
		expect(recent.length).toBe(1);
		expect(recent[0]?.eventId).toBe("evt-2");
		expect(recent[0]?.correlationId).toBe("corr-b");

		await Effect.runPromise(store.close);
		rmSync(dbPath, { force: true });
	});
});
