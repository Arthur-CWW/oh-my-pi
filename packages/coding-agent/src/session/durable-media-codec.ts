import {
	decodedBase64ByteLength,
	type ImageContent,
	isVideoMimeType,
	type MediaContent,
	type MessageAttribution,
} from "@oh-my-pi/pi-ai";
import {
	type BlobStore,
	externalizeMediaData,
	isBlobRef,
	resolveMediaData,
} from "./blob-store";
import { hasOnlyKeys, isRecord } from "./durable-queue-decode";
import type {
	DurableCustomPayload,
	DurableInputPayload,
	DurableMediaContent,
	DurableQueuedInput,
	HydratedQueuedInput,
	InputPayload,
	JsonValue,
} from "./durable-input-queue";

export function decodeJsonValue(value: unknown): JsonValue | undefined {
	const seen = new Set<object>();
	const decode = (candidate: unknown): JsonValue | undefined => {
		if (
			candidate === null ||
			typeof candidate === "string" ||
			typeof candidate === "boolean" ||
			(typeof candidate === "number" && Number.isFinite(candidate))
		) {
			return candidate as null | string | boolean | number;
		}
		if (typeof candidate !== "object") return undefined;
		if (seen.has(candidate)) return undefined;
		seen.add(candidate);
		try {
			if (Array.isArray(candidate)) {
				const result: JsonValue[] = [];
				for (const element of candidate) {
					const decoded = decode(element);
					if (decoded === undefined) return undefined;
					result.push(decoded);
				}
				return result;
			}
			const prototype = Object.getPrototypeOf(candidate);
			if (prototype !== Object.prototype && prototype !== null) return undefined;
			const result: Record<string, JsonValue> = {};
			for (const [key, element] of Object.entries(candidate)) {
				const decoded = decode(element);
				if (decoded === undefined) return undefined;
				result[key] = decoded;
			}
			return result;
		} finally {
			seen.delete(candidate);
		}
	};
	return decode(value);
}

function isImageDetail(value: unknown): value is NonNullable<ImageContent["detail"]> {
	return value === "auto" || value === "low" || value === "high" || value === "original";
}

function isImageMimeType(value: unknown): value is string {
	return typeof value === "string" && /^image\/[a-z0-9][a-z0-9.+-]*$/i.test(value);
}

function isStrictBase64(value: unknown): value is string {
	return (
		typeof value === "string" &&
		value.length > 0 &&
		value.length % 4 === 0 &&
		/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(value)
	);
}

function isStrictVideoBase64(value: unknown): value is string {
	if (typeof value !== "string" || value.length === 0) return false;
	try {
		decodedBase64ByteLength(value);
		return true;
	} catch {
		return false;
	}
}

function decodeMediaContent(value: unknown): MediaContent | undefined {
	if (!isRecord(value) || !hasOnlyKeys(value, ["type", "data", "mimeType", "detail"])) return undefined;
	if (value.type === "image") {
		if (
			!isStrictBase64(value.data) ||
			!isImageMimeType(value.mimeType) ||
			(value.detail !== undefined && !isImageDetail(value.detail))
		) {
			return undefined;
		}
		return {
			type: "image",
			data: value.data,
			mimeType: value.mimeType,
			...(value.detail === undefined ? {} : { detail: value.detail }),
		};
	}
	if (
		value.type === "video" &&
		hasOnlyKeys(value, ["type", "data", "mimeType"]) &&
		isStrictVideoBase64(value.data) &&
		typeof value.mimeType === "string" &&
		isVideoMimeType(value.mimeType)
	) {
		return { type: "video", data: value.data, mimeType: value.mimeType };
	}
	return undefined;
}

function decodeDurableMediaContent(value: unknown): DurableMediaContent | undefined {
	if (!isRecord(value) || !hasOnlyKeys(value, ["type", "data", "mimeType", "detail"])) return undefined;
	if (value.type === "image") {
		if (
			typeof value.data !== "string" ||
			!isBlobRef(value.data) ||
			!isImageMimeType(value.mimeType) ||
			(value.detail !== undefined && !isImageDetail(value.detail))
		) {
			return undefined;
		}
		return {
			type: "image",
			data: value.data,
			mimeType: value.mimeType,
			...(value.detail === undefined ? {} : { detail: value.detail }),
		};
	}
	if (
		value.type === "video" &&
		hasOnlyKeys(value, ["type", "data", "mimeType"]) &&
		typeof value.data === "string" &&
		isBlobRef(value.data) &&
		typeof value.mimeType === "string" &&
		isVideoMimeType(value.mimeType)
	) {
		return { type: "video", data: value.data, mimeType: value.mimeType };
	}
	return undefined;
}

function decodeContent<M extends MediaContent | DurableMediaContent>(
	value: unknown,
	decodeMedia: (candidate: unknown) => M | undefined,
): string | readonly ({ readonly type: "text"; readonly text: string } | M)[] | undefined {
	if (typeof value === "string") return value;
	if (!Array.isArray(value)) return undefined;
	const content: ({ readonly type: "text"; readonly text: string } | M)[] = [];
	for (const block of value) {
		if (isRecord(block) && block.type === "text" && hasOnlyKeys(block, ["type", "text"]) && typeof block.text === "string") {
			content.push({ type: "text", text: block.text });
			continue;
		}
		const media = decodeMedia(block);
		if (!media) return undefined;
		content.push(media);
	}
	return Object.freeze(content);
}

function decodeCustomPayload<M extends MediaContent | DurableMediaContent>(
	value: unknown,
	decodeMedia: (candidate: unknown) => M | undefined,
): {
	readonly kind: "custom";
	readonly message: {
		readonly customType: string;
		readonly content: string | readonly ({ readonly type: "text"; readonly text: string } | M)[];
		readonly display: boolean;
		readonly details?: JsonValue;
		readonly attribution: MessageAttribution;
	};
	readonly deliverAs: "steer" | "followUp" | "nextTurn";
	readonly triggerTurn: boolean;
	readonly disposition: "provider" | "append";
} | undefined {
	if (
		!isRecord(value) ||
		!hasOnlyKeys(value, ["kind", "message", "deliverAs", "triggerTurn", "disposition"]) ||
		value.kind !== "custom" ||
		!isRecord(value.message) ||
		!hasOnlyKeys(value.message, ["customType", "content", "display", "details", "attribution"]) ||
		typeof value.message.customType !== "string" ||
		typeof value.message.display !== "boolean" ||
		(value.message.attribution !== "user" && value.message.attribution !== "agent") ||
		(value.deliverAs !== "steer" && value.deliverAs !== "followUp" && value.deliverAs !== "nextTurn") ||
		typeof value.triggerTurn !== "boolean" ||
		(value.disposition !== "provider" && value.disposition !== "append")
	) {
		return undefined;
	}
	const content = decodeContent(value.message.content, decodeMedia);
	if (content === undefined) return undefined;
	const details = value.message.details === undefined ? undefined : decodeJsonValue(value.message.details);
	if (value.message.details !== undefined && details === undefined) return undefined;
	return {
		kind: "custom",
		message: {
			customType: value.message.customType,
			content,
			display: value.message.display,
			...(details === undefined ? {} : { details }),
			attribution: value.message.attribution,
		},
		deliverAs: value.deliverAs,
		triggerTurn: value.triggerTurn,
		disposition: value.disposition,
	};
}

export function decodeDurableCustomPayload(value: unknown): DurableCustomPayload | undefined {
	return decodeCustomPayload(value, decodeDurableMediaContent);
}

export function decodeDurablePayload(value: unknown): DurableInputPayload | undefined {
	const custom = decodeDurableCustomPayload(value);
	if (custom) return custom;
	if (
		!isRecord(value) ||
		!hasOnlyKeys(value, ["kind", "text", "attachments"]) ||
		(value.kind !== undefined && value.kind !== "user") ||
		typeof value.text !== "string" ||
		(value.attachments !== undefined && !Array.isArray(value.attachments))
	) {
		return undefined;
	}
	const attachments: DurableMediaContent[] = [];
	for (const attachment of value.attachments ?? []) {
		const decoded = decodeDurableMediaContent(attachment);
		if (!decoded) return undefined;
		attachments.push(decoded);
	}
	return {
		...(value.kind === "user" ? { kind: "user" as const } : {}),
		text: value.text,
		attachments: value.attachments === undefined ? undefined : Object.freeze(attachments),
	};
}

export function decodeInputPayload(value: unknown): InputPayload | undefined {
	const custom = decodeCustomPayload(value, decodeMediaContent);
	if (custom) return custom;
	if (
		!isRecord(value) ||
		!hasOnlyKeys(value, ["kind", "text", "attachments"]) ||
		(value.kind !== undefined && value.kind !== "user") ||
		typeof value.text !== "string" ||
		(value.attachments !== undefined && !Array.isArray(value.attachments))
	) {
		return undefined;
	}
	const attachments: MediaContent[] = [];
	for (const attachment of value.attachments ?? []) {
		const decoded = decodeMediaContent(attachment);
		if (!decoded) return undefined;
		attachments.push(decoded);
	}
	return {
		...(value.kind === "user" ? { kind: "user" as const } : {}),
		text: value.text,
		attachments: value.attachments === undefined ? undefined : Object.freeze(attachments),
	};
}

async function externalizeMediaContent(blobStore: BlobStore, media: MediaContent): Promise<DurableMediaContent> {
	const data = await externalizeMediaData(blobStore, media.data, media.mimeType);
	return media.type === "image"
		? {
				type: "image",
				data,
				mimeType: media.mimeType,
				...(media.detail === undefined ? {} : { detail: media.detail }),
			}
		: { type: "video", data, mimeType: media.mimeType };
}

export async function externalizePayload(blobStore: BlobStore, payload: InputPayload): Promise<DurableInputPayload> {
	if (payload.kind !== "custom") {
		const attachments =
			payload.attachments === undefined
				? undefined
				: await Promise.all(payload.attachments.map(attachment => externalizeMediaContent(blobStore, attachment)));
		return {
			...(payload.kind === "user" ? { kind: "user" as const } : {}),
			text: payload.text,
			attachments: attachments === undefined ? undefined : Object.freeze(attachments),
		};
	}
	if (typeof payload.message.content === "string") {
		return { ...payload, message: { ...payload.message, content: payload.message.content } };
	}
	const content = await Promise.all(
		payload.message.content.map(block =>
			block.type === "text" ? Promise.resolve(block) : externalizeMediaContent(blobStore, block),
		),
	);
	return { ...payload, message: { ...payload.message, content: Object.freeze(content) } };
}

async function hydrateMediaContent(blobStore: BlobStore, media: DurableMediaContent): Promise<MediaContent> {
	const data = await resolveMediaData(blobStore, media.data);
	return media.type === "image"
		? {
				type: "image",
				data,
				mimeType: media.mimeType,
				...(media.detail === undefined ? {} : { detail: media.detail }),
			}
		: { type: "video", data, mimeType: media.mimeType };
}

async function hydratePayload(blobStore: BlobStore, payload: DurableInputPayload): Promise<InputPayload> {
	if (payload.kind !== "custom") {
		const attachments =
			payload.attachments === undefined
				? undefined
				: await Promise.all(payload.attachments.map(attachment => hydrateMediaContent(blobStore, attachment)));
		return {
			...(payload.kind === "user" ? { kind: "user" as const } : {}),
			text: payload.text,
			attachments: attachments === undefined ? undefined : Object.freeze(attachments),
		};
	}
	if (typeof payload.message.content === "string") {
		return { ...payload, message: { ...payload.message, content: payload.message.content } };
	}
	const content = await Promise.all(
		payload.message.content.map(block =>
			block.type === "text" ? Promise.resolve(block) : hydrateMediaContent(blobStore, block),
		),
	);
	return { ...payload, message: { ...payload.message, content: Object.freeze(content) } };
}

export async function hydrateItem(blobStore: BlobStore, item: DurableQueuedInput): Promise<HydratedQueuedInput> {
	return { ...item, payload: await hydratePayload(blobStore, item.payload) };
}
