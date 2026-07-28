import { describe, expect, it } from "bun:test";
import type { AgentMessage } from "../src/types";
import { elideOldestImagePayloads, estimateImageTokens, estimateTokens } from "../src/compaction/compaction";

function pngHeader(width: number, height: number): string {
	const bytes = Buffer.alloc(26);
	Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]).copy(bytes);
	bytes.write("IHDR", 12, "ascii");
	bytes.writeUInt32BE(width, 16);
	bytes.writeUInt32BE(height, 20);
	bytes[25] = 6;
	return bytes.toString("base64");
}

function toolImage(id: string, data: string, legacy = false): AgentMessage {
	return {
		role: "toolResult",
		toolCallId: id,
		toolName: "node_repl",
		isError: false,
		content: [
			{ type: "text", text: `before-${id}` },
			legacy
				? { type: "text", text: JSON.stringify({ type: "image", data, mimeType: "image/png" }) }
				: { type: "image", data, mimeType: "image/png" },
			{ type: "text", text: `after-${id}` },
		],
		timestamp: Date.now(),
	};
}

describe("compaction image accounting", () => {
	it("estimates Anthropic image tokens from dimensions and caps oversized images", () => {
		const regular = pngHeader(1000, 750);
		expect(estimateImageTokens(regular)).toBe(1000);
		expect(estimateTokens(toolImage("native", regular))).toBeGreaterThanOrEqual(1000);
		expect(estimateTokens(toolImage("legacy", regular, true))).toBeGreaterThanOrEqual(1000);
		expect(estimateImageTokens(pngHeader(4000, 4000))).toBe(1600);
	});

	it("elides oldest image tool results while retaining surrounding text", () => {
		const data = pngHeader(1200, 750);
		const messages = [toolImage("oldest", data), toolImage("middle", data, true), toolImage("newest", data)];
		const bytesBefore = JSON.stringify(messages).length;
		const result = elideOldestImagePayloads(messages, estimateTokens(messages[2]!) + 200);

		expect(result.elidedCount).toBe(2);
		expect(JSON.stringify(result.messages).length).toBeLessThan(bytesBefore);
		expect(JSON.stringify(result.messages[0])).toContain("[image 1200x750 elided]");
		expect(JSON.stringify(result.messages[0])).toContain("before-oldest");
		expect(JSON.stringify(result.messages[0])).toContain("after-oldest");
		expect(JSON.stringify(result.messages[1])).toContain("[image 1200x750 elided]");
		expect(JSON.stringify(result.messages[2])).toContain(data);
		expect(JSON.stringify(messages[0])).toContain(data);
		expect(result.tokensAfter).toBeLessThan(result.tokensBefore);
	});
});
