import type { ExtensionAPI } from "@mariozechner/pi-coding-agent";
import { StringEnum } from "@mariozechner/pi-ai";
import { Type } from "@sinclair/typebox";
import { Effect } from "effect";
import { randomUUID } from "node:crypto";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { makeEvent } from "./core/Observability.js";
import { type FullSearchOptions, search as effectSearch } from "./gemini-search.js";
import { readChromeCookiesEffect } from "./chrome-cookies.js";
import { makeSqliteEventStore } from "./observability/EventStore.js";

interface EventStoreSmokeParams {
	readonly dbPath?: string;
	readonly correlationId?: string;
}

interface WebSearchParams {
	readonly query?: string;
	readonly provider?: "auto" | "perplexity" | "gemini";
	readonly numResults?: number;
	readonly recencyFilter?: "day" | "week" | "month" | "year";
	readonly domainFilter?: string[];
}

interface CookiesParams {
	readonly names?: string[];
}

interface RegisterEffectToolsOptions {
	readonly includeWebSearch?: boolean;
}

export interface EffectExtensionDeps {
	readonly search: (query: string, options?: FullSearchOptions) => Promise<{
		answer: string;
		results: Array<{ title: string; url: string; snippet: string }>;
	}>;
	readonly readCookies: typeof readChromeCookiesEffect;
}

const defaultDeps: EffectExtensionDeps = {
	search: effectSearch,
	readCookies: readChromeCookiesEffect,
};

const LEGACY_ENTRY_CANDIDATES = ["../old/index.js", "../old/index.ts"] as const;

function formatSearchSummary(results: Array<{ title: string; url: string }>, answer: string): string {
	const body = answer ? `${answer}\n\n---\n\n**Sources:**\n` : "";
	return body + results.map((result, index) => `${index + 1}. ${result.title}\n   ${result.url}`).join("\n\n");
}

function loadLegacyRegistrar(): ((pi: ExtensionAPI) => void) | null {
	const require = createRequire(import.meta.url);
	for (const candidate of LEGACY_ENTRY_CANDIDATES) {
		try {
			const moduleRecord = require(candidate) as { default?: unknown };
			if (typeof moduleRecord.default === "function") {
				return moduleRecord.default as (pi: ExtensionAPI) => void;
			}
		} catch {
			// Try next candidate path.
		}
	}
	return null;
}

function registerEventStoreSmokeTool(pi: ExtensionAPI): void {
	pi.registerTool({
		name: "effect_event_store_smoke",
		label: "Effect Event Store Smoke",
		description:
			"Dry-run tool for the Effect migration path. Appends a sample event to the Effect SQLite event store and returns a small status summary.",
		parameters: Type.Object({
			dbPath: Type.Optional(Type.String()),
			correlationId: Type.Optional(Type.String()),
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
					content: [{ type: "text", text: "Effect shadow event-store smoke failed." }],
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
					{ type: "text", text: `Effect shadow ok. Stored ${exit.value.eventCount} event(s).` },
				],
				details: exit.value,
			};
		},
	});
}

function registerEffectWebSearchTool(pi: ExtensionAPI, deps: EffectExtensionDeps): void {
	pi.registerTool({
		name: "web_search",
		label: "Web Search (Effect)",
		description:
			"Effect migration web search tool (Gemini/Perplexity routing). Supports Gemini API and Gemini Web cookie-auth fallback.",
		parameters: Type.Object({
			query: Type.String({ description: "Search query" }),
			provider: Type.Optional(StringEnum(["auto", "perplexity", "gemini"])),
			numResults: Type.Optional(Type.Number({ minimum: 1, maximum: 20 })),
			recencyFilter: Type.Optional(StringEnum(["day", "week", "month", "year"])),
			domainFilter: Type.Optional(Type.Array(Type.String())),
		}),
		async execute(_toolCallId, rawParams) {
			const params = rawParams as WebSearchParams;
			if (!params.query?.trim()) {
				return {
					content: [{ type: "text", text: "Error: No query provided." }],
					details: { error: "missing-query" },
				};
			}

			try {
				const response = await deps.search(params.query, {
					provider: params.provider,
					numResults: params.numResults,
					recencyFilter: params.recencyFilter,
					domainFilter: params.domainFilter,
				});
				return {
					content: [{ type: "text", text: formatSearchSummary(response.results, response.answer) }],
					details: {
						error: null,
					},
				};
			} catch (error) {
				const message = error instanceof Error ? error.message : String(error);
				return {
					content: [{ type: "text", text: `Error: ${message}` }],
					details: { error: message },
				};
			}
		},
	});
}

function registerChromeCookiesTool(pi: ExtensionAPI, deps: EffectExtensionDeps): void {
	pi.registerTool({
		name: "chrome_cookies",
		label: "Chrome Cookies (Effect)",
		description: "Read Google/Gemini cookie availability from local Chrome profile.",
		parameters: Type.Object({
			names: Type.Optional(Type.Array(Type.String())),
		}),
		async execute(_toolCallId, rawParams) {
			const params = rawParams as CookiesParams;
			const requested = params.names ?? ["__Secure-1PSID", "__Secure-1PSIDTS", "NID"];
			const exit = await Effect.runPromiseExit(deps.readCookies());
			if (exit._tag === "Failure") {
				return {
					content: [{ type: "text", text: "Error: Chrome cookies unavailable." }],
					details: { error: "cookies-unavailable" },
				};
			}

			const present = requested.filter((name) => Boolean(exit.value.cookies[name]));
			return {
				content: [
					{
						type: "text",
						text: `Found ${Object.keys(exit.value.cookies).length} Google cookie(s). Present requested: ${present.length}/${requested.length}.`,
					},
				],
				details: {
					error: null,
				},
			};
		},
	});
}

export function registerEffectTools(
	pi: ExtensionAPI,
	deps: EffectExtensionDeps = defaultDeps,
	options: RegisterEffectToolsOptions = {},
): void {
	registerEventStoreSmokeTool(pi);
	registerChromeCookiesTool(pi, deps);
	if (options.includeWebSearch !== false) {
		registerEffectWebSearchTool(pi, deps);
	}
}

export default function (pi: ExtensionAPI) {
	const registerLegacy = loadLegacyRegistrar();
	if (registerLegacy) {
		registerLegacy(pi);
		registerEffectTools(pi, defaultDeps, { includeWebSearch: false });
		return;
	}

	registerEffectTools(pi, defaultDeps, { includeWebSearch: true });
}
