import * as fs from "node:fs";
import * as fsp from "node:fs/promises";
import * as path from "node:path";
import { isEnoent, logger } from "@oh-my-pi/pi-utils";

const BLOB_PREFIX = "blob:sha256:" as const;
const BLOB_REF_PATTERN = /^blob:sha256:([0-9a-f]{64})$/;
const BLOB_HASH_PATTERN = /^[0-9a-f]{64}$/;
declare const blobRefBrand: unique symbol;
export type BlobRef = `blob:sha256:${string}` & { readonly [blobRefBrand]: true };

export interface BlobPutOptions {
	/** Optional file extension for a sidecar hardlink/copy that OS openers can type-detect. */
	extension?: string;
}

export interface BlobPutResult {
	hash: string;
	/** Canonical content-addressed path, always `<dir>/<sha256-hex>`. */
	path: string;
	/** Path with the requested extension when supplied, otherwise the canonical path. */
	displayPath: string;
	get ref(): BlobRef;
}

/**
 * Content-addressed blob store for externalizing binary media from session JSONL files.
 *
 * Files are stored canonically at `<dir>/<sha256-hex>`. Callers may also request
 * a typed sidecar path (`<dir>/<sha256-hex>.<ext>`) for `file://` links and OS
 * media viewers; blob refs and reads still address the extensionless hash path.
 * The SHA-256 hash is computed over the raw binary data (not base64).
 * Content-addressing makes writes idempotent and provides automatic deduplication
 * across sessions.
 */

const MEDIA_EXTENSION_BY_MIME: Readonly<Record<string, string>> = {
	"image/png": "png",
	"image/jpeg": "jpg",
	"image/jpg": "jpg",
	"image/gif": "gif",
	"image/webp": "webp",
	"image/svg+xml": "svg",
	"video/mp4": "mp4",
	"video/quicktime": "mov",
	"video/x-m4v": "m4v",
	"video/webm": "webm",
};

function normalizeBlobExtension(extension: string | undefined): string | undefined {
	if (!extension) return undefined;
	const normalized = extension.startsWith(".") ? extension.slice(1) : extension;
	if (normalized.length === 0 || normalized.length > 32) return undefined;
	if (!/^[a-zA-Z0-9][a-zA-Z0-9._-]*$/.test(normalized)) return undefined;
	return normalized.toLowerCase();
}

async function ensureDisplayPath(blobPath: string, displayPath: string, data: Buffer): Promise<void> {
	if (displayPath === blobPath) return;
	try {
		await fsp.link(blobPath, displayPath);
		return;
	} catch (err) {
		if (typeof err === "object" && err !== null && "code" in err && err.code === "EEXIST") return;
		logger.debug("Blob display hardlink failed; falling back to copy", {
			blobPath,
			displayPath,
			error: err instanceof Error ? err.message : String(err),
		});
	}
	await Bun.write(displayPath, data);
}

function ensureDisplayPathSync(blobPath: string, displayPath: string, data: Buffer): void {
	if (displayPath === blobPath) return;
	try {
		fs.linkSync(blobPath, displayPath);
		return;
	} catch (err) {
		if (typeof err === "object" && err !== null && "code" in err && err.code === "EEXIST") return;
		logger.debug("Blob display hardlink failed; falling back to copy", {
			blobPath,
			displayPath,
			error: err instanceof Error ? err.message : String(err),
		});
	}
	fs.writeFileSync(displayPath, data);
}

export function blobExtensionForMimeType(mimeType: string | undefined): string | undefined {
	if (!mimeType) return undefined;
	const lower = mimeType.toLowerCase();
	const known = MEDIA_EXTENSION_BY_MIME[lower];
	if (known) return known;
	if (!lower.startsWith("image/")) return undefined;
	const subtype = lower.slice("image/".length).split(";")[0]?.split("+")[0];
	return normalizeBlobExtension(subtype);
}

export class BlobStore {
	constructor(readonly dir: string) {}

	/**
	 * Write binary data to the blob store.
	 * @returns SHA-256 hex hash of the data
	 */
	async put(data: Buffer, options?: BlobPutOptions): Promise<BlobPutResult> {
		const hash = new Bun.SHA256().update(data).digest("hex");
		const blobPath = path.join(this.dir, hash);
		const extension = normalizeBlobExtension(options?.extension);
		const displayPath = extension ? `${blobPath}.${extension}` : blobPath;
		const result = {
			hash,
			path: blobPath,
			displayPath,
			get ref(): BlobRef {
				return `${BLOB_PREFIX}${hash}` as BlobRef;
			},
		};

		await fsp.mkdir(this.dir, { recursive: true });
		await Bun.write(blobPath, data);
		await ensureDisplayPath(blobPath, displayPath, data);
		return result;
	}

	/**
	 * Synchronous variant of {@link put}. Use on persistence hot paths where the caller
	 * cannot afford the microtask hops of the async version (e.g. OOM-safe session writes).
	 * Returns once the bytes are in the kernel page cache.
	 */
	putSync(data: Buffer, options?: BlobPutOptions): BlobPutResult {
		const hash = new Bun.SHA256().update(data).digest("hex");
		const blobPath = path.join(this.dir, hash);
		const extension = normalizeBlobExtension(options?.extension);
		const displayPath = extension ? `${blobPath}.${extension}` : blobPath;
		const result = {
			hash,
			path: blobPath,
			displayPath,
			get ref(): BlobRef {
				return `${BLOB_PREFIX}${hash}` as BlobRef;
			},
		};
		fs.mkdirSync(this.dir, { recursive: true });
		fs.writeFileSync(blobPath, data);
		ensureDisplayPathSync(blobPath, displayPath, data);
		return result;
	}

	/** Read and integrity-check a blob by hash, returning null only when it is absent. */
	async get(hash: string): Promise<Buffer | null> {
		if (!BLOB_HASH_PATTERN.test(hash)) throw new Error(`Invalid blob hash: ${hash}`);
		const blobPath = path.join(this.dir, hash);
		try {
			const file = Bun.file(blobPath);
			const ab = await file.arrayBuffer();
			const data = Buffer.from(ab);
			const actualHash = new Bun.SHA256().update(data).digest("hex");
			if (actualHash !== hash) throw new Error(`Corrupt blob ${hash}: content hash is ${actualHash}`);
			return data;
		} catch (err) {
			if (isEnoent(err)) return null;
			throw err;
		}
	}

	/** Check if a blob exists. */
	async has(hash: string): Promise<boolean> {
		if (!BLOB_HASH_PATTERN.test(hash)) throw new Error(`Invalid blob hash: ${hash}`);
		try {
			await fsp.access(path.join(this.dir, hash));
			return true;
		} catch {
			return false;
		}
	}
}

/** Check whether a string is an exact, canonical blob reference. */
export function isBlobRef(data: string): data is BlobRef {
	return BLOB_REF_PATTERN.test(data);
}

/** Extract the SHA-256 hash from an exact, canonical blob reference. */
export function parseBlobRef(data: string): string | null {
	return BLOB_REF_PATTERN.exec(data)?.[1] ?? null;
}

/** Identify provider transport image data URLs so persistence can externalize and restore them losslessly. */
export function isImageDataUrl(data: string): boolean {
	return data.startsWith("data:image/") && data.includes(";base64,");
}

/**
 * Externalize a provider image data URL to the blob store, returning a blob reference.
 * The full data URL string is preserved so transport-native history can be reconstructed on resume.
 */
export async function externalizeImageDataUrl(blobStore: BlobStore, dataUrl: string): Promise<BlobRef> {
	if (isBlobRef(dataUrl)) return dataUrl;
	const { ref } = await blobStore.put(Buffer.from(dataUrl, "utf8"));
	return ref;
}

/** Synchronous variant of {@link externalizeImageDataUrl}. */
export function externalizeImageDataUrlSync(blobStore: BlobStore, dataUrl: string): BlobRef {
	if (isBlobRef(dataUrl)) return dataUrl;
	return blobStore.putSync(Buffer.from(dataUrl, "utf8")).ref;
}

/**
 * Externalize base64 media bytes to the blob store.
 * Exact blob references pass through unchanged.
 */
export async function externalizeMediaData(
	blobStore: BlobStore,
	base64Data: string,
	mimeType: string,
): Promise<BlobRef> {
	if (isBlobRef(base64Data)) return base64Data;
	const { ref } = await blobStore.put(Buffer.from(base64Data, "base64"), {
		extension: blobExtensionForMimeType(mimeType),
	});
	return ref;
}

/** Synchronous variant of {@link externalizeMediaData}. */
export function externalizeMediaDataSync(blobStore: BlobStore, base64Data: string, mimeType: string): BlobRef {
	if (isBlobRef(base64Data)) return base64Data;
	return blobStore.putSync(Buffer.from(base64Data, "base64"), {
		extension: blobExtensionForMimeType(mimeType),
	}).ref;
}

/**
 * Resolve an externalized provider image data URL back to its original string.
 * Non-reference strings pass through unchanged; missing and corrupt refs fail.
 */
export async function resolveImageDataUrl(blobStore: BlobStore, data: string): Promise<string> {
	const hash = parseBlobRef(data);
	if (!hash) return data;
	const buffer = await blobStore.get(hash);
	if (!buffer) throw new Error(`Missing blob for persisted image data URL: ${data}`);
	return buffer.toString("utf8");
}

/**
 * Resolve a media blob reference back to base64.
 * Non-reference strings pass through unchanged; missing and corrupt refs fail.
 */
export async function resolveMediaData(blobStore: BlobStore, data: string): Promise<string> {
	const hash = parseBlobRef(data);
	if (!hash) return data;
	const buffer = await blobStore.get(hash);
	if (!buffer) throw new Error(`Missing blob for persisted media: ${data}`);
	return buffer.toString("base64");
}
