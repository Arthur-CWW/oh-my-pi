import { describe, expect, it } from "bun:test";
import {
	MAX_ANTIGRAVITY_INLINE_VIDEO_BYTES,
	assertContextVideoInputSupported,
	assertInlineVideoByteCount,
	contextHasVideo,
	decodedBase64ByteLength,
	isVideoMimeType,
	supportsNativeVideoInput,
} from "@oh-my-pi/pi-ai/video-input";
import type { Api, Context, Model, UserContent } from "@oh-my-pi/pi-ai/types";
import { buildModel } from "@oh-my-pi/pi-catalog/build";
import type { ModelSpec } from "@oh-my-pi/pi-catalog/types";

function makeModel(api: Api, provider: string, input: Array<"text" | "image" | "video">): Model<Api> {
	return buildModel({
		id: `${provider}-${api}-${input.join("-")}`,
		name: "video test model",
		api,
		provider,
		baseUrl: "https://example.com",
		reasoning: false,
		input,
		cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
		contextWindow: 128_000,
		maxTokens: 8_192,
	} as ModelSpec<Api>);
}

function videoContext(content: UserContent[] = [{ type: "video", mimeType: "video/mp4", data: "AA==" }]): Context {
	return {
		messages: [{ role: "user", content, timestamp: 1 }],
	};
}

describe("native video input guards", () => {
	it("decodes only canonical, unprefixed base64 without allocating decoded data", () => {
		expect(decodedBase64ByteLength("")).toBe(0);
		expect(decodedBase64ByteLength("AA==")).toBe(1);
		expect(decodedBase64ByteLength("AAE=")).toBe(2);
		expect(decodedBase64ByteLength("AAEC")).toBe(3);

		for (const value of [
			"data:video/mp4;base64,AA==",
			"AA==\n",
			"AA-_",
			"A A=",
			"AA=A",
			"AB==",
			"AAB=",
		]) {
			expect(() => decodedBase64ByteLength(value)).toThrow();
		}
	});

	it("recognizes exactly the supported native video MIME types", () => {
		for (const mimeType of ["video/mp4", "video/quicktime", "video/x-m4v", "video/webm"]) {
			expect(isVideoMimeType(mimeType)).toBe(true);
		}
		for (const mimeType of ["video/mov", "video/mp4; codecs=avc1", "image/png", "audio/mp4"]) {
			expect(isVideoMimeType(mimeType)).toBe(false);
		}
	});

	it("enforces the strict under-100MB decoded byte limit with integer helpers", () => {
		expect(() => assertInlineVideoByteCount(0)).not.toThrow();
		expect(() => assertInlineVideoByteCount(MAX_ANTIGRAVITY_INLINE_VIDEO_BYTES - 1)).not.toThrow();
		expect(() => assertInlineVideoByteCount(MAX_ANTIGRAVITY_INLINE_VIDEO_BYTES)).toThrow(/below/);
		expect(() => assertInlineVideoByteCount(MAX_ANTIGRAVITY_INLINE_VIDEO_BYTES + 1)).toThrow(/below/);

		for (const value of [-1, Number.NaN, Number.POSITIVE_INFINITY, 1.5]) {
			expect(() => assertInlineVideoByteCount(value)).toThrow(/safe integer/);
		}
	});

	it("requires the exact Google Antigravity native-video lane", () => {
		const cases: Array<[Api, string, Array<"text" | "image" | "video">, boolean]> = [
			["google-gemini-cli", "google-antigravity", ["text", "video"], true],
			["google-gemini-cli", "google-antigravity", ["text"], false],
			["google-gemini-cli", "google", ["text", "video"], false],
			["google-generative-ai", "google-antigravity", ["text", "video"], false],
			["openai-completions", "google-antigravity", ["text", "video"], false],
		];

		for (const [api, provider, input, expected] of cases) {
			expect(supportsNativeVideoInput(makeModel(api, provider, input))).toBe(expected);
		}
	});

	it("validates user and developer videos while rejecting empty, malformed, and wrong MIME data", () => {
		const model = makeModel("google-gemini-cli", "google-antigravity", ["text", "video"]);
		const validContent: UserContent[] = [
			{ type: "text", text: "before" },
			{ type: "video", mimeType: "video/mp4", data: "AA==" },
			{ type: "video", mimeType: "video/quicktime", data: "AA==" },
			{ type: "video", mimeType: "video/x-m4v", data: "AA==" },
			{ type: "video", mimeType: "video/webm", data: "AA==" },
		];
		expect(contextHasVideo(videoContext(validContent))).toBe(true);
		const developerContext: Context = {
			messages: [{ role: "developer", content: [{ type: "video", mimeType: "video/webm", data: "AA==" }], timestamp: 2 }],
		};
		expect(contextHasVideo(developerContext)).toBe(true);
		expect(() => assertContextVideoInputSupported(model, developerContext)).not.toThrow();

		expect(() => assertContextVideoInputSupported(model, videoContext(validContent))).not.toThrow();

		for (const content of [
			[{ type: "video", mimeType: "video/mp4", data: "" }],
			[{ type: "video", mimeType: "video/mp4", data: "not base64" }],
			[{ type: "video", mimeType: "video/mov", data: "AA==" }],
		] as UserContent[][]) {
			expect(() => assertContextVideoInputSupported(model, videoContext(content))).toThrow();
		}
	});

	it("fails closed when video reaches a non-native provider lane", () => {
		const context = videoContext();
		for (const model of [
			makeModel("google-gemini-cli", "google", ["text", "video"]),
			makeModel("google-generative-ai", "google-antigravity", ["text", "video"]),
			makeModel("google-gemini-cli", "google-antigravity", ["text"]),
		]) {
			expect(() => assertContextVideoInputSupported(model, context)).toThrow(/does not support native video input/);
		}
	});
});
