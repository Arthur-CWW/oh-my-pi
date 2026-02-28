import type { ExtensionAPI } from "@mariozechner/pi-coding-agent";
import { StringEnum } from "@mariozechner/pi-ai";
import { Type } from "@sinclair/typebox";
import { Effect } from "effect";
import { randomUUID } from "node:crypto";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { makeEvent } from "./core/Observability.js";
import { type FullSearchOptions, search as geminiSearch } from "./gemini-search.js";
import { kagiSearchEffect, type SearchSuccess } from "./kagi-search.js";
import { readChromeCookiesEffect } from "./chrome-cookies.js";
import { makeSqliteEventStore } from "./observability/EventStore.js";

interface EventStoreSmokeParams {
	readonly dbPath?: string;
	readonly correlationId?: string;
}

interface WebSearchParams {
	readonly query?: string;
	readonly provider?: "auto" | "kagi" | "gemini" | "perplexity";
	readonly numResults?: number;
	readonly recencyFilter?: "day" | "week" | "month" | "year";
	readonly domainFilter?: string[];
	readonly lens?: string;
}

interface CookiesParams {
	readonly names?: string[];
}

interface RegisterEffectToolsOptions {
	readonly includeWebSearch?: boolean;
}

interface SearchResponse extends SearchSuccess {
	readonly providerUsed?: "kagi" | "gemini" | "perplexity";
}

interface WebSearchToolDetails {
	readonly error: string | null;
	readonly provider?: "kagi" | "gemini" | "perplexity";
	readonly resultCount?: number;
	readonly queryDiagnostics?: SearchSuccess["queryDiagnostics"];
}

export interface EffectExtensionDeps {
	readonly search: (query: string, options?: FullSearchOptions) => Promise<SearchResponse>;
	readonly readCookies: typeof readChromeCookiesEffect;
}

async function searchWithFallback(
	query: string,
	options?: FullSearchOptions,
): Promise<SearchResponse> {
	const preferredProvider = options?.provider ?? "auto";
	
	// Try Kagi first if auto or explicitly requested
	if (preferredProvider === "auto" || preferredProvider === "kagi") {
		try {
			const kagiResult = await Effect.runPromise(
				kagiSearchEffect(query, undefined, {
					lens: options?.lens,
					recencyFilter: options?.recencyFilter,
					domainFilter: options?.domainFilter,
				}),
			);
			return { ...kagiResult, providerUsed: "kagi" };
		} catch (kagiErr) {
			// If Kagi fails and user explicitly wanted Kagi, don't fall back
			if (preferredProvider === "kagi") {
				throw kagiErr;
			}
			// Otherwise fall through to Gemini
			console.error(`Kagi search failed, falling back to Gemini: ${kagiErr}`);
		}
	}
	
	// Fall back to Gemini
	const geminiResult = await geminiSearch(query, options);
	const providerUsed = options?.provider === "perplexity" ? "perplexity" : "gemini";
	return { ...geminiResult, providerUsed };
}

const defaultDeps: EffectExtensionDeps = {
	search: searchWithFallback,
	readCookies: readChromeCookiesEffect,
};

const LEGACY_ENTRY_CANDIDATES = ["../old/index.js", "../old/index.ts"] as const;

function formatSearchSummary(
	results: ReadonlyArray<{ title: string; url: string; snippet?: string; publishedAt?: string }>,
	answer: string,
): string {
	const body = answer ? `${answer}\n\n---\n\n**Sources:**\n` : "";
	return (
		body +
		results
			.map((result, index) => {
				const snippet = result.snippet?.trim() ?? "";
				const publishedAt = result.publishedAt?.trim() ?? "";
				const lines = [`${index + 1}. ${result.title}`, `   ${result.url}`];
				if (publishedAt.length > 0) {
					lines.push(`   Date: ${publishedAt}`);
				}
				if (snippet.length > 0) {
					lines.push(`   ${snippet}`);
				}
				return lines.join("\n");
			})
			.join("\n\n")
	);
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

function registerWebSearchTool(pi: ExtensionAPI, deps: EffectExtensionDeps): void {
	pi.registerTool({
		name: "web_search",
		label: "Web Search",
		description:
			"Web search tool using Kagi (default) with Gemini fallback. Supports Kagi operators (`filetype:`, `site:`, `inurl:`, `intitle:`, quotes, boolean/grouping) plus Google-style compatibility helpers (`before:`/`after:` full-date mapping, `ext:`, `allintitle:`, `allinurl:`, `allintext:`). Unsupported operators are passed through and may be ignored by Kagi.",
		parameters: Type.Object({
			query: Type.String({ description: "Search query (Google-style operators supported where Kagi-compatible)" }),
			provider: Type.Optional(StringEnum(["auto", "kagi", "gemini", "perplexity"])),
			lens: Type.Optional(Type.String()),
			numResults: Type.Optional(Type.Number({ minimum: 1, maximum: 20 })),
			recencyFilter: Type.Optional(StringEnum(["day", "week", "month", "year"])),
			domainFilter: Type.Optional(Type.Array(Type.String())),
		}),
		async execute(_toolCallId, rawParams) {
			const params = rawParams as WebSearchParams;
			if (!params.query?.trim()) {
				const details: WebSearchToolDetails = { error: "missing-query" };
				return {
					content: [{ type: "text", text: "Error: No query provided." }],
					details,
				};
			}

			try {
				const response = await deps.search(params.query, {
					provider: params.provider,
					numResults: params.numResults,
					recencyFilter: params.recencyFilter,
					domainFilter: params.domainFilter,
					lens: params.lens,
				});
				const details: WebSearchToolDetails = {
					error: null,
					provider: response.providerUsed,
					resultCount: response.results.length,
					queryDiagnostics: response.queryDiagnostics,
				};
				return {
					content: [{ type: "text", text: formatSearchSummary(response.results, response.answer) }],
					details,
				};
			} catch (error) {
				const message = error instanceof Error ? error.message : String(error);
				const details: WebSearchToolDetails = { error: message };
				return {
					content: [{ type: "text", text: `Error: ${message}` }],
					details,
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
		registerWebSearchTool(pi, deps);
	}
}

export default function (pi: ExtensionAPI) {
	const registerLegacy = loadLegacyRegistrar();
	if (registerLegacy) {
		registerLegacy(pi);
		// Register Effect web_search last so it overrides legacy web_search while
		// preserving the rest of the legacy tool surface during migration.
		registerEffectTools(pi, defaultDeps, { includeWebSearch: true });
		return;
	}

	registerEffectTools(pi, defaultDeps, { includeWebSearch: true });
}
