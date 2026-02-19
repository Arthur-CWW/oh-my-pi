import type { ExtensionAPI } from "@mariozechner/pi-coding-agent";
import { Type } from "@sinclair/typebox";
import { Effect } from "effect";
import { randomUUID } from "node:crypto";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { makeEvent } from "./core/Observability.js";
import { makeSqliteEventStore } from "./observability/EventStore.js";

interface EventStoreSmokeParams {
	readonly dbPath?: string;
	readonly correlationId?: string;
}

export default function (pi: ExtensionAPI) {
	pi.registerTool({
		name: "effect_event_store_smoke",
		label: "Effect Event Store Smoke",
		description:
			"Dry-run tool for the Effect migration path. Appends a sample event to the Effect SQLite event store and returns a small status summary.",
		parameters: Type.Object({
			dbPath: Type.Optional(
				Type.String({
					description:
						"Optional SQLite DB path. Defaults to a temp file so this command is safe for non-production dry runs.",
				}),
			),
			correlationId: Type.Optional(
				Type.String({
					description: "Optional correlation id for the emitted event.",
				}),
			),
		}),
		async execute(_toolCallId, rawParams) {
			const params = rawParams as EventStoreSmokeParams;
			const dbPath =
				params.dbPath ?? join(tmpdir(), `pi-web-access-effect-shadow-${Date.now()}-${randomUUID()}.sqlite`);
			const correlationId = params.correlationId ?? `effect-shadow-${randomUUID()}`;

			const program = Effect.gen(function* () {
				const store = yield* makeSqliteEventStore({ dbPath });
				yield* store.append(
					makeEvent(
						"ToolCompleted",
						{ tool: "effect_event_store_smoke", mode: "shadow" },
						correlationId,
					),
				);
				const events = yield* store.listByCorrelationId(correlationId);
				yield* store.close;
				return {
					error: null,
					dbPath,
					correlationId,
					eventCount: events.length,
					latestEventName: events[events.length - 1]?.name ?? null,
				};
			});

			const exit = await Effect.runPromiseExit(program);
			if (exit._tag === "Failure") {
				return {
					content: [
						{
							type: "text",
							text: "Effect shadow event-store smoke failed. See details for typed cause.",
						},
					],
					details: {
						error: "event-store-smoke-failed",
						dbPath,
						correlationId,
						eventCount: 0,
						latestEventName: null,
					},
				};
			}

			return {
				content: [
					{
						type: "text",
						text: `Effect shadow ok. Stored ${exit.value.eventCount} event(s) in ${exit.value.dbPath}.`,
					},
				],
				details: exit.value,
			};
		},
	});
}
