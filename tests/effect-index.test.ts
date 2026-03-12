import { existsSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { beforeEach, describe, expect, it } from "bun:test";
import type { ExtensionAPI } from "@mariozechner/pi-coding-agent";
import { Effect } from "effect";
import effectEntry, { registerEffectTools, type EffectExtensionDeps } from "../src/effect/index.js";
import { clearResults, storeResult } from "../src/shared/stored-results.js";

interface TestTheme {
	readonly fg: (token: string, text: string) => string;
	readonly bold: (text: string) => string;
}

interface ToolLike {
	readonly name?: unknown;
	readonly description?: unknown;
	readonly execute?: (
		toolCallId: string,
		params: Record<string, unknown>,
		signal?: AbortSignal,
		onUpdate?: (update: { content: Array<{ type: string; text: string }>; details?: Record<string, unknown> }) => void,
	) => Promise<{
		content: Array<{ type: string; text?: string; data?: string; mimeType?: string }>;
		details?: Record<string, unknown>;
	}>;
	readonly renderCall?: (args: Record<string, unknown>, theme: TestTheme) => { text: string };
	readonly renderResult?: (
		result: {
			content: Array<{ type: string; text?: string; data?: string; mimeType?: string }>;
			details?: Record<string, unknown>;
		},
		state: { expanded?: boolean; isPartial?: boolean },
		theme: TestTheme,
	) => { text: string };
}

function registerWith(deps: EffectExtensionDeps): Map<string, ToolLike> {
	const registered = new Map<string, ToolLike>();
	const api = {
		registerTool: (tool: ToolLike) => {
			if (typeof tool.name === "string") {
				registered.set(tool.name, tool);
			}
		},
	} as unknown as ExtensionAPI;

	registerEffectTools(api, deps);
	return registered;
}

function registerCutoverEntry(): Map<string, ToolLike> {
	const registered = new Map<string, ToolLike>();
	const api = {
		registerTool: (tool: ToolLike) => {
			if (typeof tool.name === "string") {
				registered.set(tool.name, tool);
			}
		},
		registerShortcut: () => {},
		on: () => {},
		registerCommand: () => {},
	} as unknown as ExtensionAPI;

	effectEntry(api);
	return registered;
}

const fakeTheme: TestTheme = {
	fg: (_token, text) => text,
	bold: (text) => text,
};

const fakeDeps: EffectExtensionDeps = {
	search: () =>
		Effect.succeed({
			answer: "Bun is a runtime.",
			results: [
				{
					title: "Bun",
					url: "https://bun.com",
					snippet: "Fast JavaScript runtime.",
					publishedAt: "2025-02-23",
				},
			],
		}),
	fetchContent: (urls) =>
		Effect.succeed(
			urls.map((url, index) => ({
				url,
				title: `Title ${index + 1}`,
				content: `Body ${index + 1} for ${url}`,
				error: null,
			})),
		),
	readCookies: () =>
		Effect.succeed({
			cookies: { "__Secure-1PSID": "x", "__Secure-1PSIDTS": "y" },
			warnings: [],
			source: "legacy",
		}),
};

beforeEach(() => {
	clearResults();
});

describe("effect shadow entry", () => {
	it("registers all effect tools", () => {
		const tools = registerWith(fakeDeps);
		expect(tools.has("effect_event_store_smoke")).toBe(true);
		expect(tools.has("web_search")).toBe(true);
		expect(tools.has("fetch_content")).toBe(true);
		expect(tools.has("chrome_cookies")).toBe(true);
		expect(tools.has("get_search_content")).toBe(true);
	});

	it("runs sqlite smoke tool", async () => {
		const tools = registerWith(fakeDeps);
		const tool = tools.get("effect_event_store_smoke");
		expect(typeof tool?.execute).toBe("function");
		if (typeof tool?.execute !== "function") throw new Error("missing execute");

		const dbPath = join(tmpdir(), `pi-effect-shadow-test-${Date.now()}.sqlite`);
		const result = await tool.execute("call-1", { dbPath, correlationId: "test-correlation" });
		expect(result.content[0]?.text).toContain("Effect shadow ok");
		expect(result.details?.error).toBe(null);
		expect(result.details?.eventCount).toBe(1);
		expect(existsSync(dbPath)).toBe(true);
		rmSync(dbPath, { force: true });
	});

	it("validates effect_event_store_smoke params with schema decode", async () => {
		const tools = registerWith(fakeDeps);
		const tool = tools.get("effect_event_store_smoke");
		expect(typeof tool?.execute).toBe("function");
		if (typeof tool?.execute !== "function") throw new Error("missing execute");

		const result = await tool.execute("call-1-schema", { dbPath: 1234 });
		expect(result.details?.error).toBe("invalid-params");
		expect(result.details?.reason).toContain("dbPath");
		expect(result.content[0]?.text).toContain("Invalid parameters for effect_event_store_smoke");
	});

	it("runs web_search via effect deps", async () => {
		const tools = registerWith(fakeDeps);
		const tool = tools.get("web_search");
		expect(typeof tool?.execute).toBe("function");
		if (typeof tool?.execute !== "function") throw new Error("missing execute");

		const result = await tool.execute("call-2", { query: "what is bun" });
		expect(result.details?.error).toBe(null);
		expect(result.content[0]?.text).toContain("Bun is a runtime.");
		expect(result.content[0]?.text).toContain("https://bun.com");
		expect(result.content[0]?.text).toContain("Date: 2025-02-23");
		expect(result.content[0]?.text).toContain("Fast JavaScript runtime.");
	});

	it("returns structured validation guidance for missing query", async () => {
		const tools = registerWith(fakeDeps);
		const tool = tools.get("web_search");
		expect(typeof tool?.execute).toBe("function");
		if (typeof tool?.execute !== "function") throw new Error("missing execute");

		const result = await tool.execute("call-2a", { query: "   " });
		const errorDetails = result.details?.error as
			| {
					readonly title?: string;
					readonly technicalCause?: string;
					readonly nextStep?: string;
			  }
			| undefined;
		expect(errorDetails?.title).toBe("No query was provided");
		expect(errorDetails?.technicalCause).toContain("Missing required parameter");
		expect(errorDetails?.nextStep).toContain("web_search");
		expect(result.content[0]?.text).toContain("No query was provided");
		expect(result.content[0]?.text).toContain("Next step:");
	});

	it("validates web_search params with schema decode", async () => {
		const tools = registerWith(fakeDeps);
		const tool = tools.get("web_search");
		expect(typeof tool?.execute).toBe("function");
		if (typeof tool?.execute !== "function") throw new Error("missing execute");

		const result = await tool.execute("call-2a-schema", {
			query: "effect",
			numResults: 999,
		});
		const errorDetails = result.details?.error as
			| {
					readonly title?: string;
					readonly technicalCause?: string;
			  }
			| undefined;
		expect(errorDetails?.title).toBe("Invalid web_search parameters");
		expect(errorDetails?.technicalCause).toContain("numResults");
		expect(result.content[0]?.text).toContain("Invalid web_search parameters");
	});

	it("rejects deprecated auto provider selection at tool boundary", async () => {
		const tools = registerWith(fakeDeps);
		const tool = tools.get("web_search");
		expect(typeof tool?.execute).toBe("function");
		if (typeof tool?.execute !== "function") throw new Error("missing execute");

		const result = await tool.execute("call-2a-provider-auto", {
			query: "effect",
			provider: "auto",
		});
		const errorDetails = result.details?.error as
			| {
					readonly title?: string;
					readonly technicalCause?: string;
			  }
			| undefined;
		expect(errorDetails?.title).toBe("Invalid web_search parameters");
		expect(errorDetails?.technicalCause).toContain("provider");
	});

	it("forwards kagi-specific provider and lens options", async () => {
		let capturedProvider: string | undefined;
		let capturedLens: string | undefined;
		const tools = registerWith({
			search: (_query, options) => {
				capturedProvider = options?.provider;
				capturedLens = options?.lens;
				return Effect.succeed({
					answer: "ok",
					results: [{ title: "Result", url: "https://example.com", snippet: "" }],
				});
			},
			fetchContent: fakeDeps.fetchContent,
			readCookies: fakeDeps.readCookies,
		});
		const tool = tools.get("web_search");
		expect(typeof tool?.execute).toBe("function");
		if (typeof tool?.execute !== "function") throw new Error("missing execute");

		const result = await tool.execute("call-2b", {
			query: "effect",
			provider: "kagi",
			lens: "programming",
		});

		expect(result.details?.error).toBe(null);
		expect(capturedProvider).toBe("kagi");
		expect(capturedLens).toBe("programming");
	});

	it("maps structured search dependency failures to tool errors", async () => {
		const tools = registerWith({
			search: () => Effect.fail({ reason: "provider-down" }),
			fetchContent: fakeDeps.fetchContent,
			readCookies: fakeDeps.readCookies,
		});
		const tool = tools.get("web_search");
		expect(typeof tool?.execute).toBe("function");
		if (typeof tool?.execute !== "function") throw new Error("missing execute");

		const result = await tool.execute("call-2c", { query: "effect" });
		const errorDetails = result.details?.error as
			| {
					readonly title?: string;
					readonly technicalCause?: string;
			  }
			| undefined;
		expect(errorDetails?.title).toBe("Web search failed");
		expect(errorDetails?.technicalCause).toBe("provider-down");
		expect(result.content[0]?.text).toContain("Technical cause: provider-down");
		expect(result.content[0]?.text).toContain("Next step:");
	});

	it("validates chrome_cookies params with schema decode", async () => {
		const tools = registerWith(fakeDeps);
		const tool = tools.get("chrome_cookies");
		expect(typeof tool?.execute).toBe("function");
		if (typeof tool?.execute !== "function") throw new Error("missing execute");

		const result = await tool.execute("call-3-schema", { names: "__Secure-1PSID" });
		expect(result.details?.error).toContain("names");
		expect(result.content[0]?.text).toContain("Invalid parameters for chrome_cookies");
	});

	it("runs chrome_cookies via effect deps", async () => {
		const tools = registerWith(fakeDeps);
		const tool = tools.get("chrome_cookies");
		expect(typeof tool?.execute).toBe("function");
		if (typeof tool?.execute !== "function") throw new Error("missing execute");

		const result = await tool.execute("call-3", { names: ["__Secure-1PSID", "NID"] });
		expect(result.details?.error).toBe(null);
		expect(result.content[0]?.text).toContain("Present requested: 1/2");
	});

	it("validates fetch_content params with schema decode", async () => {
		const tools = registerWith(fakeDeps);
		const tool = tools.get("fetch_content");
		expect(typeof tool?.execute).toBe("function");
		if (typeof tool?.execute !== "function") throw new Error("missing execute");

		const result = await tool.execute("call-fetch-2", { frames: 99 });
		expect(result.content[0]?.text).toContain("Invalid parameters for fetch_content");
		expect(result.details).toEqual({
			error: "invalid-params",
			reason: expect.stringContaining("frames"),
		});
	});

	it("mirrors legacy-style fetch_content call/result rendering", () => {
		const tools = registerWith(fakeDeps);
		const tool = tools.get("fetch_content");
		expect(typeof tool?.renderCall).toBe("function");
		expect(typeof tool?.renderResult).toBe("function");
		if (typeof tool?.renderCall !== "function" || typeof tool?.renderResult !== "function") {
			throw new Error("missing render helper");
		}

		const callView = tool.renderCall(
			{
				url: "https://example.com/article",
				prompt: "Find the main claim",
				timestamp: "23:41-25:00",
				frames: 4,
				model: "gemini-2.5-flash",
			},
			fakeTheme,
		);
		expect(callView.text).toContain("fetch https://example.com/article");
		expect(callView.text).toContain("timestamp: 23:41-25:00");
		expect(callView.text).toContain("frames: 4");
		expect(callView.text).toContain('prompt: "Find the main claim"');
		expect(callView.text).toContain("model: gemini-2.5-flash");

		const partialView = tool.renderResult(
			{
				content: [{ type: "text", text: "Fetching..." }],
				details: { phase: "fetch", progress: 0.3 },
			},
			{ isPartial: true },
			fakeTheme,
		);
		expect(partialView.text).toContain("fetch");

		const resultView = tool.renderResult(
			{
				content: [{ type: "text", text: "Body preview" }],
				details: {
					urlCount: 1,
					successful: 1,
					totalChars: 12,
					title: "Example Title",
					truncated: true,
					imageCount: 2,
					timestamp: "23:41-25:00",
					frames: 4,
					duration: 125,
				},
			},
			{ expanded: true },
			fakeTheme,
		);
		expect(resultView.text).toContain("Example Title");
		expect(resultView.text).toContain("(12 chars)");
		expect(resultView.text).toContain("[2 images]");
		expect(resultView.text).toContain("[truncated]");
		expect(resultView.text).toContain("2:05 total");
		expect(resultView.text).toContain("timestamp: 23:41-25:00");
		expect(resultView.text).toContain("frames: 4");
	});

	it("returns stored search content with legacy-compatible formatting", async () => {
		const tools = registerWith(fakeDeps);
		const tool = tools.get("get_search_content");
		expect(typeof tool?.execute).toBe("function");
		if (typeof tool?.execute !== "function") throw new Error("missing execute");

		storeResult("search-1", {
			id: "search-1",
			type: "search",
			timestamp: Date.now(),
			queries: [
				{
					query: "effect ts",
					answer: "Effect is a TypeScript library",
					results: [
						{
							title: "Effect",
							url: "https://effect.website",
							snippet: "Docs",
						},
					],
					error: null,
				},
			],
		});

		const result = await tool.execute("call-4", { responseId: "search-1", queryIndex: 0 });
		expect(result.content[0]?.text).toBe(
			'## Results for: "effect ts"\n\nEffect is a TypeScript library\n\n---\n\n### Effect\nhttps://effect.website\n\n',
		);
		expect(result.details).toEqual({ query: "effect ts", resultCount: 1 });
	});

	it("returns stored fetched URL content and not-found guidance", async () => {
		const tools = registerWith(fakeDeps);
		const tool = tools.get("get_search_content");
		expect(typeof tool?.execute).toBe("function");
		if (typeof tool?.execute !== "function") throw new Error("missing execute");

		storeResult("fetch-1", {
			id: "fetch-1",
			type: "fetch",
			timestamp: Date.now(),
			urls: [
				{
					url: "https://example.com",
					title: "Example",
					content: "Example body",
					error: null,
				},
			],
		});

		const found = await tool.execute("call-5", { responseId: "fetch-1", urlIndex: 0 });
		expect(found.content[0]?.text).toBe("# Example\n\nExample body");
		expect(found.details).toEqual({
			url: "https://example.com",
			title: "Example",
			contentLength: 12,
		});

		const missing = await tool.execute("call-5b", { responseId: "missing" });
		expect(missing.content[0]?.text).toBe('Error: No stored results for "missing"');
		expect(missing.details).toEqual({ error: "Not found", responseId: "missing" });
	});

	it("validates get_search_content params with schema decode", async () => {
		const tools = registerWith(fakeDeps);
		const tool = tools.get("get_search_content");
		expect(typeof tool?.execute).toBe("function");
		if (typeof tool?.execute !== "function") throw new Error("missing execute");

		const result = await tool.execute("call-6", { responseId: 123 });
		expect(result.content[0]?.text).toContain("Invalid parameters for get_search_content");
		expect(result.details).toEqual({
			error: "invalid-params",
			reason: expect.stringContaining("responseId"),
		});
	});
});

describe("effect production cutover entry", () => {
	it("registers legacy tool surface plus effect extras", () => {
		const tools = registerCutoverEntry();
		expect(tools.has("web_search")).toBe(true);
		expect(tools.has("fetch_content")).toBe(true);
		expect(tools.has("get_search_content")).toBe(true);
		expect(tools.has("chrome_cookies")).toBe(true);
		expect(tools.has("effect_event_store_smoke")).toBe(true);
		expect(String(tools.get("web_search")?.description ?? "")).toContain("Kagi");
	});

	it("supports disabling the legacy bridge with PI_WEB_ACCESS_DISABLE_LEGACY_BRIDGE", () => {
		const previous = process.env.PI_WEB_ACCESS_DISABLE_LEGACY_BRIDGE;
		process.env.PI_WEB_ACCESS_DISABLE_LEGACY_BRIDGE = "1";
		try {
			const tools = registerCutoverEntry();
			expect(tools.has("web_search")).toBe(true);
			expect(tools.has("fetch_content")).toBe(true);
			expect(tools.has("get_search_content")).toBe(true);
			expect(tools.has("chrome_cookies")).toBe(true);
			expect(tools.has("effect_event_store_smoke")).toBe(true);
		} finally {
			if (previous === undefined) {
				delete process.env.PI_WEB_ACCESS_DISABLE_LEGACY_BRIDGE;
			} else {
				process.env.PI_WEB_ACCESS_DISABLE_LEGACY_BRIDGE = previous;
			}
		}
	});

	it("package entrypoint points to effect index", () => {
		const packageJson = JSON.parse(readFileSync(join(process.cwd(), "package.json"), "utf8")) as {
			readonly pi?: { readonly extensions?: readonly string[] };
		};
		expect(packageJson.pi?.extensions?.[0]).toBe("./src/effect/index.ts");
	});
});
