import type { AgentMessage } from "@oh-my-pi/pi-agent-core";
import { getBlobsDir, isEnoent, logger } from "@oh-my-pi/pi-utils";
import { decodeJournalEntries } from "../journal/projection";
import { BlobStore, isBlobRef, isImageDataUrl, parseBlobRef } from "./blob-store";
import { buildSessionContext, resolveSessionLeaf } from "./session-context";
import type { FileEntry, SessionEntry, SessionHeader } from "./session-entries";
import { migrateToCurrentVersion } from "./session-migrations";
import { isMediaContent } from "./session-persistence";
import { FileSessionStorage, type SessionStorage } from "./session-storage";

/** Exported for compaction.test.ts */
export const parseSessionEntries = decodeJournalEntries;

function isSessionHeader(entry: FileEntry | undefined): entry is SessionHeader {
	return entry?.type === "session" && typeof entry.id === "string";
}

function recoverLeadingTitle(
	entries: FileEntry[],
	sessionIndex: number,
): { title?: string; titleSource?: "auto" | "user" } {
	for (let i = 0; i < sessionIndex; i++) {
		const entry = entries[i] as { type?: unknown; title?: unknown; source?: unknown; titleSource?: unknown };
		if (entry.type !== "title" || typeof entry.title !== "string") continue;
		const source = entry.source === "user" || entry.titleSource === "user" ? "user" : "auto";
		return { title: entry.title, titleSource: source };
	}
	return {};
}

function normalizeSessionEntries(entries: FileEntry[]): FileEntry[] {
	if (entries.length === 0) return entries;
	if (isSessionHeader(entries[0])) return entries;

	const sessionIndex = entries.findIndex(isSessionHeader);
	if (sessionIndex < 0) return [];

	const header = { ...entries[sessionIndex] } as SessionHeader;
	if (!header.title) {
		const recoveredTitle = recoverLeadingTitle(entries, sessionIndex);
		if (recoveredTitle.title) {
			header.title = recoveredTitle.title;
			header.titleSource = recoveredTitle.titleSource;
		}
	}
	return [header, ...entries.slice(sessionIndex + 1)];
}

/** Exported for testing */
export async function loadEntriesFromFile(
	filePath: string,
	storage: SessionStorage = new FileSessionStorage(),
): Promise<FileEntry[]> {
	let content: string;
	try {
		content = await logger.time("session:jsonlRead", () => storage.readText(filePath));
	} catch (err) {
		if (isEnoent(err)) return [];
		throw err;
	}
	const bytes = Buffer.byteLength(content, "utf8");
	const entries = logger.time("session:jsonlDecode", decodeJournalEntries, content);
	logger.time(`session:jsonlStats bytes=${bytes} entries=${entries.length}`);
	return normalizeSessionEntries(entries);
}

/**
 * Resolve persisted media blob references recursively before any entry is used
 * to rebuild provider context. Missing, malformed, or content-mismatched blobs
 * are fatal because forwarding a blob reference as base64 silently corrupts
 * resumed model history.
 */
function hasImageUrl(value: unknown): value is { image_url: string } {
	return typeof value === "object" && value !== null && "image_url" in value && typeof value.image_url === "string";
}

async function readVerifiedBlob(blobStore: BlobStore, ref: string, location: string): Promise<Buffer> {
	const hash = parseBlobRef(ref);
	if (!hash || !/^[0-9a-f]{64}$/.test(hash)) {
		throw new Error(`Invalid media blob reference at ${location}: ${ref}`);
	}
	const buffer = await blobStore.get(hash);
	if (!buffer) throw new Error(`Missing media blob ${hash} referenced at ${location}`);
	const actualHash = new Bun.SHA256().update(buffer).digest("hex");
	if (actualHash !== hash) {
		throw new Error(`Corrupt media blob ${hash} referenced at ${location}: content hash is ${actualHash}`);
	}
	return buffer;
}

function childLocation(parent: string, key: string): string {
	return /^[A-Za-z_$][\w$]*$/.test(key) ? `${parent}.${key}` : `${parent}[${JSON.stringify(key)}]`;
}

async function resolvePersistedMediaRefs(value: unknown, blobStore: BlobStore, location: string): Promise<void> {
	if (Array.isArray(value)) {
		await Promise.all(value.map((item, index) => resolvePersistedMediaRefs(item, blobStore, `${location}[${index}]`)));
		return;
	}
	if (typeof value !== "object" || value === null) return;

	const record = value as Record<string, unknown>;
	if (record.type === "image" || record.type === "video") {
		if (!isMediaContent(value)) throw new Error(`Invalid persisted ${record.type} content at ${location}`);
		if (isBlobRef(value.data)) {
			value.data = (await readVerifiedBlob(blobStore, value.data, `${location}.data`)).toString("base64");
		}
		return;
	}

	if (hasImageUrl(value) && isBlobRef(value.image_url)) {
		const imageUrlLocation = childLocation(location, "image_url");
		const restored = (await readVerifiedBlob(blobStore, value.image_url, imageUrlLocation)).toString("utf8");
		if (!isImageDataUrl(restored)) throw new Error(`Corrupt persisted image data URL at ${imageUrlLocation}`);
		value.image_url = restored;
	}

	await Promise.all(
		Object.entries(value).map(([key, item]) =>
			resolvePersistedMediaRefs(item, blobStore, childLocation(location, key)),
		),
	);
}

export async function resolveBlobRefsInEntries(entries: FileEntry[], blobStore: BlobStore): Promise<void> {
	await Promise.all(entries.map((entry, index) => resolvePersistedMediaRefs(entry, blobStore, `entries[${index}]`)));
}

/**
 * Read-only message view of a session file: load entries, migrate to the
 * current version, resolve blob refs, and build the context along the
 * replayed persisted leaf path. Does NOT create a writer or take the session
 * lock — safe to call against a file another session is writing.
 */
export async function loadSessionMessagesReadOnly(filePath: string): Promise<AgentMessage[]> {
	const entries = await loadEntriesFromFile(filePath);
	if (entries.length === 0) return [];
	migrateToCurrentVersion(entries);
	await resolveBlobRefsInEntries(entries, new BlobStore(getBlobsDir()));
	const sessionEntries = entries.filter(
		(e): e is SessionEntry => e.type !== "session" && !(e.type === "custom" && e.customType === "child_lifecycle"),
	);
	const leaf = resolveSessionLeaf(sessionEntries);
	return buildSessionContext(sessionEntries, leaf.leafId, leaf.entriesById).messages;
}
