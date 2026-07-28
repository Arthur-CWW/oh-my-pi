import { expect, test } from "bun:test";
import { convertAnthropicMessages } from "@oh-my-pi/pi-ai/providers/anthropic";
import { NON_VISION_IMAGE_PLACEHOLDER } from "@oh-my-pi/pi-ai/providers/vision-guard";
import type { Model, ModelSpec, UserMessage } from "@oh-my-pi/pi-ai/types";
import { buildModel } from "@oh-my-pi/pi-catalog/build";

const baseModel: Omit<ModelSpec<"anthropic-messages">, "provider" | "baseUrl" | "input"> = {
	api: "anthropic-messages",
	id: "claude-sonnet-4-6",
	name: "Claude Sonnet 4.6",
	cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
	maxTokens: 8192,
	contextWindow: 200000,
	reasoning: false,
};

function model(input: Model<"anthropic-messages">["input"]): Model<"anthropic-messages"> {
	return buildModel({
		...baseModel,
		provider: "anthropic",
		baseUrl: "https://api.anthropic.com",
		input,
	});
}

const IMAGE_DATA = "aGVsbG8=";
const legacyEnvelope = JSON.stringify({ type: "image", data: IMAGE_DATA, mimeType: "image/png" });
const malformedEnvelope = `{"type":"image","data":"${IMAGE_DATA}","mimeType":"image/png"`;

function userWithTextBlocks(...texts: string[]): UserMessage {
	return {
		role: "user",
		content: texts.map(text => ({ type: "text", text })),
		timestamp: 1,
	};
}

test("Anthropic converts legacy node_repl image JSON without forwarding it as text", () => {
	const messages = convertAnthropicMessages(
		[userWithTextBlocks(legacyEnvelope, malformedEnvelope, "ordinary text")],
		model(["text", "image"]),
		false,
	);
	const serialized = JSON.stringify({ messages });
	const content = messages[0]?.content;
	if (!Array.isArray(content)) throw new Error("Expected Anthropic content blocks");

	const imageBlocks = content.filter(block => block.type === "image");
	expect(imageBlocks).toHaveLength(1);
	expect(imageBlocks[0]).toEqual({
		type: "image",
		source: { type: "base64", media_type: "image/png", data: IMAGE_DATA },
	});
	expect(serialized).not.toContain(JSON.stringify(legacyEnvelope));
	expect(content.some(block => block.type === "text" && block.text === legacyEnvelope)).toBe(false);
	expect(content.some(block => block.type === "text" && block.text === malformedEnvelope)).toBe(true);
	expect(content.some(block => block.type === "text" && block.text === "ordinary text")).toBe(true);

	const textOnlyMessages = convertAnthropicMessages(
		[userWithTextBlocks(legacyEnvelope)],
		model(["text"]),
		false,
	);
	expect(textOnlyMessages[0]?.content).toBe(NON_VISION_IMAGE_PLACEHOLDER);
	expect(JSON.stringify({ messages: textOnlyMessages })).not.toContain(IMAGE_DATA);
});
