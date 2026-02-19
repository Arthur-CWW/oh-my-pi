import { existsSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "bun:test";
import type { ExtensionAPI } from "@mariozechner/pi-coding-agent";
import effectExtension from "../src/effect/index.js";

interface ToolLike {
	readonly name?: unknown;
	readonly execute?: (
		toolCallId: string,
		params: Record<string, unknown>,
		signal?: AbortSignal,
	) => Promise<{ content: Array<{ type: string; text: string }>; details?: Record<string, unknown> }>;
}

function getRegisteredTool(): ToolLike {
	const registered: ToolLike[] = [];
	const api = {
		registerTool: (tool: ToolLike) => {
			registered.push(tool);
		},
	} as unknown as ExtensionAPI;

	effectExtension(api);
	expect(registered.length).toBe(1);
	return registered[0] ?? {};
}

describe("effect shadow entry", () => {
	it("registers smoke tool and executes sqlite write/read", async () => {
		const tool = getRegisteredTool();
		expect(tool.name).toBe("effect_event_store_smoke");
		expect(typeof tool.execute).toBe("function");

		if (typeof tool.execute !== "function") {
			throw new Error("Expected tool.execute to be a function");
		}

		const dbPath = join(tmpdir(), `pi-effect-shadow-test-${Date.now()}.sqlite`);
		const result = await tool.execute("call-1", { dbPath, correlationId: "test-correlation" });

		expect(result.content[0]?.text).toContain("Effect shadow ok");
		expect(result.details?.error).toBe(null);
		expect(result.details?.eventCount).toBe(1);
		expect(result.details?.latestEventName).toBe("ToolCompleted");
		expect(existsSync(dbPath)).toBe(true);

		rmSync(dbPath, { force: true });
	});
});
