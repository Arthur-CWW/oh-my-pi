import type { AgentMessage } from "@oh-my-pi/pi-agent-core";
import { getBlobsDir, isEnoent, parseJsonlLenient } from "@oh-my-pi/pi-utils";
import { BlobStore, isBlobRef, resolveImageData, resolveImageDataUrl } from "./blob-store";
import { buildSessionContext, resolveSessionLeaf } from "./session-context";
import type { FileEntry, SessionEntry, SessionHeader } from "./session-entries";
import { migrateToCurrentVersion } from "./session-migrations";
import { isImageBlock } from "./session-persistence";
import { FileSessionStorage, type SessionStorage } from "./session-storage";

/** Exported for compaction.test.ts */
export function parseSessionEntries(content: string): FileEntry[] {
	return parseJsonlLenient<FileEntry>(content);
}

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
		content = await storage.readText(filePath);
	} catch (err) {
		if (isEnoent(err)) return [];
		throw err;
	}
	const entries = parseJsonlLenient<FileEntry>(content);
	return normalizeSessionEntries(entries);
}

/**
 * Resolve blob references in loaded entries, restoring both session image blocks and persisted
 * provider image URLs back to the inline data expected by downstream transports. Mutates entries in place.
 */
function hasImageUrl(value: unknown): value is { image_url: string } {
	return typeof value === "object" && value !== null && "image_url" in value && typeof value.image_url === "string";
}

async function resolvePersistedImageUrlRefs(value: unknown, blobStore: BlobStore): Promise<void> {
	if (Array.isArray(value)) {
		await Promise.all(value.map(item => resolvePersistedImageUrlRefs(item, blobStore)));
		return;
	}

	if (typeof value !== "object" || value === null) return;

	if (hasImageUrl(value) && isBlobRef(value.image_url)) {
		value.image_url = await resolveImageDataUrl(blobStore, value.image_url);
	}

	await Promise.all(Object.values(value).map(item => resolvePersistedImageUrlRefs(item, blobStore)));
}

export async function resolveBlobRefsInEntries(entries: FileEntry[], blobStore: BlobStore): Promise<void> {
	const promises: Promise<void>[] = [];

	for (const entry of entries) {
		if (entry.type === "session") continue;

		let contentArray: unknown[] | undefined;
		if (entry.type === "message" && "content" in entry.message && Array.isArray(entry.message.content)) {
			contentArray = entry.message.content;
		} else if (entry.type === "custom_message" && Array.isArray(entry.content)) {
			contentArray = entry.content;
		}

		if (contentArray) {
			for (const block of contentArray) {
				if (isImageBlock(block) && isBlobRef(block.data)) {
					promises.push(
						resolveImageData(blobStore, block.data).then(resolved => {
							block.data = resolved;
						}),
					);
				}
			}
		}

		promises.push(resolvePersistedImageUrlRefs(entry, blobStore));
	}

	await Promise.all(promises);
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
	const sessionEntries = entries.filter((e): e is SessionEntry => e.type !== "session");
	const leaf = resolveSessionLeaf(sessionEntries);
	return buildSessionContext(sessionEntries, leaf.leafId, leaf.entriesById).messages;
}
