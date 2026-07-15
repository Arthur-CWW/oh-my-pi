import { describe, expect, it } from "bun:test";
import { MCPTool } from "@oh-my-pi/pi-coding-agent/mcp/tool-bridge";
import type {
	MCPContent,
	MCPServerConnection,
	MCPToolCallResult,
	MCPTransport,
} from "@oh-my-pi/pi-coding-agent/mcp/types";

const TOOL_DEFINITION = { name: "render", inputSchema: { type: "object" as const } };
const NO_CONTEXT = {} as Parameters<MCPTool["execute"]>[3];

function makeTool(result: MCPToolCallResult): MCPTool {
	const transport: MCPTransport = {
		connected: true,
		async request<T>(): Promise<T> {
			return result as T;
		},
		async notify() {},
		async close() {},
	};
	const connection: MCPServerConnection = {
		name: "node-repl",
		config: { type: "stdio", command: "node-repl" },
		transport,
		serverInfo: { name: "node-repl", version: "1" },
		capabilities: { tools: {} },
	};
	return new MCPTool(connection, TOOL_DEFINITION);
}

function imageEnvelope(data: string, mimeType: string): string {
	return JSON.stringify({ type: "image", data, mimeType });
}

describe("MCP tool image results", () => {
	it("converts exact serialized image envelopes without leaking their base64 into text", async () => {
		const imageData = ["c2VyaWFsaXplZC0x", "c2VyaWFsaXplZC0y", "c2VyaWFsaXplZC0z"];
		const emptyData = imageEnvelope("", "image/png");
		const wrongMime = imageEnvelope("bm90LWFuLWltYWdl", "application/json");
		const malformed = '{"type":"image","data":"broken"';
		const ordinaryJson = JSON.stringify({ type: "status", data: "ordinary" });
		const rawContent: MCPContent[] = [
			{ type: "text", text: "before" },
			{ type: "text", text: imageEnvelope(imageData[0]!, "image/png") },
			{ type: "text", text: imageEnvelope(imageData[1]!, "image/jpeg") },
			{ type: "text", text: imageEnvelope(imageData[2]!, "image/webp") },
			{ type: "text", text: emptyData },
			{ type: "text", text: wrongMime },
			{ type: "text", text: malformed },
			{ type: "text", text: ordinaryJson },
			{ type: "text", text: "after" },
		];

		const result = await makeTool({ content: rawContent }).execute("call-1", {}, undefined, NO_CONTEXT);

		expect(result.content).toEqual([
			{ type: "text", text: "before" },
			{ type: "image", data: imageData[0], mimeType: "image/png" },
			{ type: "image", data: imageData[1], mimeType: "image/jpeg" },
			{ type: "image", data: imageData[2], mimeType: "image/webp" },
			{ type: "text", text: [emptyData, wrongMime, malformed, ordinaryJson, "after"].join("\n\n") },
		]);
		const text = result.content
			.filter(block => block.type === "text")
			.map(block => block.text)
			.join("\n");
		for (const data of imageData) {
			expect(text).not.toContain(data);
		}
		expect(result.details?.rawContent).toBe(rawContent);
	});

	it("preserves native MCP images as typed content in their original order", async () => {
		const rawContent: MCPContent[] = [
			{ type: "text", text: "left" },
			{ type: "image", data: "bmF0aXZlLWltYWdl", mimeType: "image/png" },
			{ type: "text", text: "right" },
		];

		const result = await makeTool({ content: rawContent }).execute("call-2", {}, undefined, NO_CONTEXT);

		expect(result.content).toEqual([
			{ type: "text", text: "left" },
			{ type: "image", data: "bmF0aXZlLWltYWdl", mimeType: "image/png" },
			{ type: "text", text: "right" },
		]);
		expect(result.details?.rawContent).toBe(rawContent);
	});

	it("keeps error results text-only while replacing image payloads with placeholders", async () => {
		const serializedData = "c2VyaWFsaXplZC1lcnJvcg==";
		const nativeData = "bmF0aXZlLWVycm9y";
		const result = await makeTool({
			isError: true,
			content: [
				{ type: "text", text: "failed" },
				{ type: "text", text: imageEnvelope(serializedData, "image/png") },
				{ type: "image", data: nativeData, mimeType: "image/jpeg" },
			],
		}).execute("call-3", {}, undefined, NO_CONTEXT);

		expect(result.isError).toBe(true);
		expect(result.content).toEqual([
			{ type: "text", text: "Error: failed\n\n[Image: image/png]\n\n[Image: image/jpeg]" },
		]);
		expect(result.content[0]?.type === "text" ? result.content[0].text : "").not.toContain(serializedData);
		expect(result.content[0]?.type === "text" ? result.content[0].text : "").not.toContain(nativeData);
	});
});
