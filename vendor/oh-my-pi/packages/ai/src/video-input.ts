import type { Api, Context, Model, VideoMimeType } from "./types";

export const MAX_ANTIGRAVITY_INLINE_VIDEO_BYTES = 100_000_000;

export function isVideoMimeType(value: string): value is VideoMimeType {
	return (
		value === "video/mp4" ||
		value === "video/quicktime" ||
		value === "video/x-m4v" ||
		value === "video/webm"
	);
}

function base64Value(code: number): number {
	if (code >= 65 && code <= 90) return code - 65;
	if (code >= 97 && code <= 122) return code - 71;
	if (code >= 48 && code <= 57) return code + 4;
	if (code === 43) return 62;
	if (code === 47) return 63;
	return -1;
}

/** Return the decoded byte length of canonical, unprefixed base64 without decoding or copying it. */
export function decodedBase64ByteLength(data: string): number {
	const length = data.length;
	if (length === 0) return 0;
	if (length % 4 !== 0) {
		throw new Error("Video data must be strict, unprefixed base64 with a length divisible by four");
	}

	let padding = 0;
	if (data.charCodeAt(length - 1) === 61) {
		padding = data.charCodeAt(length - 2) === 61 ? 2 : 1;
	}
	const contentLength = length - padding;
	for (let index = 0; index < contentLength; index++) {
		if (base64Value(data.charCodeAt(index)) < 0) {
			throw new Error("Video data must contain only strict, unprefixed base64 characters and trailing padding");
		}
	}
	for (let index = contentLength; index < length; index++) {
		if (data.charCodeAt(index) !== 61) {
			throw new Error("Video data must use base64 padding only at the end");
		}
	}

	if (padding === 2 && (base64Value(data.charCodeAt(length - 3)) & 15) !== 0) {
		throw new Error("Video data has non-canonical base64 padding bits");
	}
	if (padding === 1 && (base64Value(data.charCodeAt(length - 2)) & 3) !== 0) {
		throw new Error("Video data has non-canonical base64 padding bits");
	}
	return (length / 4) * 3 - padding;
}

export function assertInlineVideoByteCount(decodedBytes: number): void {
	if (!Number.isSafeInteger(decodedBytes) || decodedBytes < 0) {
		throw new Error("Inline video decoded byte count must be a non-negative safe integer");
	}
	if (decodedBytes >= MAX_ANTIGRAVITY_INLINE_VIDEO_BYTES) {
		throw new Error(
			`Inline video payload is ${decodedBytes} decoded bytes; aggregate Antigravity inline video data must be below ${MAX_ANTIGRAVITY_INLINE_VIDEO_BYTES} bytes. Antigravity Files API upload is unavailable.`,
		);
	}
}

export function contextHasVideo(context: Context): boolean {
	for (const message of context.messages) {
		if (message.role !== "user" && message.role !== "developer") continue;
		if (typeof message.content === "string") continue;
		for (const block of message.content) {
			if (block.type === "video") return true;
		}
	}
	return false;
}

export function supportsNativeVideoInput(model: Model<Api>): boolean {
	return (
		model.api === "google-gemini-cli" &&
		model.provider === "google-antigravity" &&
		model.input.includes("video")
	);
}

export function assertContextVideoInputSupported(model: Model<Api>, context: Context): void {
	if (!contextHasVideo(context)) return;
	if (!supportsNativeVideoInput(model)) {
		throw new Error(
			`Model ${model.provider}/${model.id} does not support native video input. Select the video-capable pi/vision model.`,
		);
	}

	let decodedBytes = 0;
	for (const message of context.messages) {
		if (message.role !== "user" && message.role !== "developer") continue;
		if (typeof message.content === "string") continue;
		for (const block of message.content) {
			if (block.type !== "video") continue;
			if (!isVideoMimeType(block.mimeType)) {
				throw new Error(
					`Model ${model.provider}/${model.id} received unsupported video MIME type ${block.mimeType}`,
				);
			}
			if (block.data.length === 0) {
				throw new Error(`Model ${model.provider}/${model.id} received empty video data`);
			}
			let blockBytes: number;
			try {
				blockBytes = decodedBase64ByteLength(block.data);
			} catch {
				throw new Error(
					`Model ${model.provider}/${model.id} received invalid video data; expected strict, unprefixed base64`,
				);
			}
			decodedBytes += blockBytes;
			if (decodedBytes >= MAX_ANTIGRAVITY_INLINE_VIDEO_BYTES) {
				throw new Error(
					`Model ${model.provider}/${model.id} received ${decodedBytes} decoded video bytes; aggregate Antigravity inline video data must be below ${MAX_ANTIGRAVITY_INLINE_VIDEO_BYTES} bytes. Antigravity Files API upload is unavailable.`,
				);
			}
			assertInlineVideoByteCount(decodedBytes);
		}
	}
}
