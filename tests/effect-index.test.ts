import { existsSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "bun:test";
import type { ExtensionAPI } from "@mariozechner/pi-coding-agent";
import { Effect } from "effect";
import { registerEffectTools, type EffectExtensionDeps } from "../src/effect/index.js";

interface ToolLike {
	readonly name?: unknown;
	readonly execute?: (
		toolCallId: string,
		params: Record<string, unknown>,
		signal?: AbortSignal,
	) => Promise<{ content: Array<{ type: string; text: string }>; details?: Record<string, unknown> }>;
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

const fakeDeps: EffectExtensionDeps = {
	search: async () => ({
		answer: "Bun is a runtime.",
		results: [{ title: "Bun", url: "https://bun.com", snippet: "" }],
	}),
	readCookies: () =>
		Effect.succeed({
			cookies: { "__Secure-1PSID": "x", "__Secure-1PSIDTS": "y" },
			warnings: [],
		}),
};

describe("effect shadow entry", () => {
	it("registers all effect tools", () => {
		const tools = registerWith(fakeDeps);
		expect(tools.has("effect_event_store_smoke")).toBe(true);
		expect(tools.has("web_search")).toBe(true);
		expect(tools.has("chrome_cookies")).toBe(true);
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

	it("runs web_search via effect deps", async () => {
		const tools = registerWith(fakeDeps);
		const tool = tools.get("web_search");
		expect(typeof tool?.execute).toBe("function");
		if (typeof tool?.execute !== "function") throw new Error("missing execute");

		const result = await tool.execute("call-2", { query: "what is bun" });
		expect(result.details?.error).toBe(null);
		expect(result.content[0]?.text).toContain("Bun is a runtime.");
		expect(result.content[0]?.text).toContain("https://bun.com");
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
});
