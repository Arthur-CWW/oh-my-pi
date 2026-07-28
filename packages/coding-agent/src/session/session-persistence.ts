import { isVideoMimeType, type MediaContent, type VideoContent } from "@oh-my-pi/pi-ai";
import {
	type BlobStore,
	externalizeImageDataUrlSync,
	externalizeMediaDataSync,
	isBlobRef,
	isImageDataUrl,
} from "./blob-store";
import type { FileEntry } from "./session-entries";

const MAX_PERSIST_CHARS = 500_000;
const TRUNCATION_NOTICE = "\n\n[Session persistence truncated large content]";
/** Minimum base64 length to externalize to blob store (skip tiny inline images) */
const BLOB_EXTERNALIZE_THRESHOLD = 1024;

function truncateString(value: string, maxLength: number): string {
	if (value.length <= maxLength) return value;
	let truncated = value.slice(0, maxLength);
	if (truncated.length > 0) {
		const last = truncated.charCodeAt(truncated.length - 1);
		if (last >= 0xd800 && last <= 0xdbff) {
			truncated = truncated.slice(0, -1);
		}
	}
	return truncated;
}


function isVideoContent(value: unknown): value is VideoContent {
	if (typeof value !== "object" || value === null || Array.isArray(value)) return false;
	const media = value as Record<string, unknown>;
	return (
		media.type === "video" &&
		typeof media.data === "string" &&
		typeof media.mimeType === "string" &&
		isVideoMimeType(media.mimeType)
	);
}

export function isMediaContent(value: unknown): value is MediaContent {
	if (isVideoContent(value)) return true;
	if (typeof value !== "object" || value === null || Array.isArray(value)) return false;
	const media = value as Record<string, unknown>;
	return (
		media.type === "image" &&
		typeof media.data === "string" &&
		typeof media.mimeType === "string" &&
		(media.detail === undefined ||
			media.detail === "auto" ||
			media.detail === "low" ||
			media.detail === "high" ||
			media.detail === "original")
	);
}

function externalizeMediaContent(media: MediaContent, blobStore: BlobStore): MediaContent {
	if (isBlobRef(media.data)) return media;
	if (media.type === "image") {
		if (media.data.length < BLOB_EXTERNALIZE_THRESHOLD) return media;
		return { ...media, data: externalizeMediaDataSync(blobStore, media.data, media.mimeType) };
	}
	return { ...media, data: externalizeMediaDataSync(blobStore, media.data, media.mimeType) };
}

/**
 * Recursively prepare an entry for session persistence.
 * - Externalizes typed video content unconditionally
 * - Externalizes typed image content above the inline threshold
 * - Truncates oversized non-media string fields
 * - Updates lineCount when textual content is truncated
 * - Returns the original object if no changes are needed (structural sharing)
 *
 * Runs in one synchronous tick so an OOM/SIGKILL landing right after a persist
 * call returns cannot lose the entry. Media externalization uses the synchronous
 * blob-store path, so blob bytes are in the kernel page cache before the JSONL
 * line referencing them is written.
 */
function truncateForPersistence(obj: unknown, blobStore: BlobStore, key?: string): unknown {
	if (obj === null || obj === undefined) return obj;

	if (typeof obj === "string") {
		if (key === "image_url" && isImageDataUrl(obj)) {
			return externalizeImageDataUrlSync(blobStore, obj);
		}
		if (obj.length > MAX_PERSIST_CHARS) {
			// Cryptographic signatures must be preserved exactly or cleared entirely — never truncated.
			// Truncation would produce an invalid signature that the API rejects.
			if (key === "thinkingSignature" || key === "thoughtSignature" || key === "textSignature") {
				return "";
			}
			const limit = Math.max(0, MAX_PERSIST_CHARS - TRUNCATION_NOTICE.length);
			return `${truncateString(obj, limit)}${TRUNCATION_NOTICE}`;
		}
		return obj;
	}

	if (typeof obj === "object" && obj !== null && !Array.isArray(obj)) {
		const type = (obj as { type?: unknown }).type;
		if (type === "image" || type === "video") {
			if (!isMediaContent(obj)) throw new TypeError(`Invalid typed ${type} content in session entry`);
			return externalizeMediaContent(obj, blobStore);
		}
	}

	if (Array.isArray(obj)) {
		let changed = false;
		const result: unknown[] = new Array(obj.length);
		for (let i = 0; i < obj.length; i++) {
			const item = obj[i];
			const newItem = truncateForPersistence(item, blobStore);
			if (newItem !== item) changed = true;
			result[i] = newItem;
		}
		return changed ? result : obj;
	}
	if (typeof obj === "object") {
		let changed = false;
		const entries: Array<readonly [string, unknown]> = [];
		for (const [childKey, value] of Object.entries(obj)) {
			// Strip transient/redundant properties that shouldn't be persisted.
			// - partialJson: streaming accumulator for tool call JSON parsing
			// - jsonlEvents: raw subprocess streaming events (already saved to artifact files)
			if (childKey === "partialJson" || childKey === "jsonlEvents") {
				changed = true;
				continue;
			}
			const newValue = truncateForPersistence(value, blobStore, childKey);
			if (newValue !== value) changed = true;
			entries.push([childKey, newValue]);
		}
		if (!changed) return obj;

		const contentEntry = entries.find(([childKey]) => childKey === "content");
		const lineCountEntry = entries.find(([childKey]) => childKey === "lineCount");
		if (
			contentEntry &&
			typeof contentEntry[1] === "string" &&
			lineCountEntry &&
			typeof lineCountEntry[1] === "number"
		) {
			const content = contentEntry[1];
			const updatedEntries = entries.map(([childKey, value]) =>
				childKey === "lineCount" ? ([childKey, content.split("\n").length] as const) : ([childKey, value] as const),
			);
			return Object.fromEntries(updatedEntries);
		}
		return Object.fromEntries(entries);
	}

	return obj;
}

export function prepareEntryForPersistence(entry: FileEntry, blobStore: BlobStore): FileEntry {
	return truncateForPersistence(entry, blobStore) as FileEntry;
}
