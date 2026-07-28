import { describe, expect, it } from "bun:test";
import type { AgentMessage } from "@oh-my-pi/pi-agent-core";
import type { ImageContent, MediaContent, TextContent } from "@oh-my-pi/pi-ai";
import { stripMediaFromMessage } from "@oh-my-pi/pi-coding-agent/session/messages";

const png = (data: string = "iVBORw0KGgo"): ImageContent => ({ type: "image", data, mimeType: "image/png" });
const mp4 = (data: string = "AAECAw=="): MediaContent => ({ type: "video", data, mimeType: "video/mp4" });
const text = (value: string): TextContent => ({ type: "text", text: value });

describe("stripMediaFromMessage", () => {
	it("replaces image and video blocks with omission markers while keeping text in order", () => {
		const message: AgentMessage = {
			role: "user",
			content: [text("look at"), png("a"), text("and"), mp4(), png("b")],
			timestamp: Date.now(),
		};

		const removed = stripMediaFromMessage(message);

		expect(removed).toBe(3);
		expect(message.content).toEqual([
			text("look at"),
			text("[image omitted]"),
			text("and"),
			text("[video omitted]"),
			text("[image omitted]"),
		]);
	});

	it("leaves user content untouched and returns 0 when there are no images", () => {
		const original: (TextContent | ImageContent)[] = [text("hi"), text("there")];
		const message: AgentMessage = {
			role: "user",
			content: original,
			timestamp: Date.now(),
		};

		const removed = stripMediaFromMessage(message);

		expect(removed).toBe(0);
		expect(message.content).toBe(original);
	});

	it("returns 0 for string-form user content (no media blocks possible)", () => {
		const message: AgentMessage = {
			role: "user",
			content: "no images here",
			timestamp: Date.now(),
		};

		expect(stripMediaFromMessage(message)).toBe(0);
	});

	it("inserts a placeholder text block when stripping empties the array (user message)", () => {
		const message: AgentMessage = {
			role: "user",
			content: [png(), png()],
			timestamp: Date.now(),
		};

		expect(stripMediaFromMessage(message)).toBe(2);
		expect(message.content).toEqual([text("[image omitted]"), text("[image omitted]")]);
	});

	it("strips media from tool result content and details.images, summing the count", () => {
		const message: AgentMessage = {
			role: "toolResult",
			toolCallId: "tc1",
			toolName: "generate_image",
			content: [text("generated"), png("inline")],
			details: { images: [png("hidden-1"), png("hidden-2")], imageCount: 2 },
			isError: false,
			timestamp: Date.now(),
		};

		const removed = stripMediaFromMessage(message);

		expect(removed).toBe(3);
		expect(message.content).toEqual([text("generated"), text("[image omitted]")]);
		const details = message.details as { images: ImageContent[]; imageCount: number };
		expect(details.images).toEqual([]);
		expect(details.imageCount).toBe(2); // unrelated detail fields stay intact
	});

	it("clears fileMention media attachments without dropping other file fields", () => {
		const message: Extract<AgentMessage, { role: "fileMention" }> = {
			role: "fileMention",
			files: [
				{ path: "a.txt", content: "alpha\nbeta\n", lineCount: 2 },
				{ path: "b.png", content: "", attachment: png("attached"), byteSize: 1024 },
				{ path: "c.mp4", content: "", attachment: mp4("attached-video"), byteSize: 2048 },
			],
			timestamp: Date.now(),
		};

		const removed = stripMediaFromMessage(message);

		expect(removed).toBe(2);
		expect(message.files[0]).toEqual({ path: "a.txt", content: "alpha\nbeta\n", lineCount: 2 });
		expect(message.files[1]).toEqual({
			path: "b.png",
			content: "[image omitted]",
			attachment: undefined,
			byteSize: 1024,
		});
		expect(message.files[2]).toEqual({
			path: "c.mp4",
			content: "[video omitted]",
			attachment: undefined,
			byteSize: 2048,
		});
	});

	it("returns 0 for assistant messages (they never carry ImageContent)", () => {
		const message: AgentMessage = {
			role: "assistant",
			content: [text("hi")],
			api: "anthropic-messages",
			provider: "anthropic",
			model: "claude",
			usage: {
				input: 0,
				output: 0,
				cacheRead: 0,
				cacheWrite: 0,
				totalTokens: 0,
				cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
			},
			stopReason: "stop",
			timestamp: Date.now(),
		};

		expect(stripMediaFromMessage(message)).toBe(0);
	});
});
