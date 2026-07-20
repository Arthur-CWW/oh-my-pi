import * as fs from "node:fs";
import { parseJsonlLenient } from "@oh-my-pi/pi-utils";
import type { FileEntry, SessionEntry, SessionHeader } from "../session/session-entries";
import { loadEntriesFromFile } from "../session/session-loader";

export const JOURNAL_TAIL_BYTES = 256 * 1024;

export interface JournalTailChunk {
	text: string;
	fromByte: number;
	newSize: number;
}

export interface JournalProjection {
	header: SessionHeader;
	entries: SessionEntry[];
	leafId: string | null;
}

/** Decode complete JSONL records leniently. Unknown versions and malformed lines do not hide valid entries. */
export function decodeJournalEntries(content: string): FileEntry[] {
	return parseJsonlLenient<FileEntry>(content);
}

/** Project decoded file entries into the stable read model used by transcript consumers. */
export function projectJournalEntries(fileEntries: readonly FileEntry[], entryCap?: number): JournalProjection | null {
	const header = fileEntries.find((entry): entry is SessionHeader => entry.type === "session") ?? null;
	if (!header) return null;
	let entries = fileEntries.filter((entry): entry is SessionEntry => entry.type !== "session");
	if (entryCap !== undefined && entries.length > entryCap) entries = entries.slice(-entryCap);
	return {
		header,
		entries,
		leafId: entries.length > 0 ? entries[entries.length - 1].id : null,
	};
}

/** Load, migrate, and project a complete session journal. */
export async function loadJournalProjection(filePath: string, entryCap?: number): Promise<JournalProjection | null> {
	return projectJournalEntries(await loadEntriesFromFile(filePath), entryCap);
}

/** Read complete JSONL records from a bounded tail, or only bytes appended after a prior snapshot. */
export function readJournalTailChunk(
	filePath: string,
	fromByte = 0,
	maxBytes = JOURNAL_TAIL_BYTES,
): JournalTailChunk | null {
	try {
		const stat = fs.statSync(filePath);
		if (!stat.isFile()) return null;
		if (stat.size <= fromByte) return { text: "", fromByte, newSize: stat.size };
		const start = fromByte === 0 ? Math.max(0, stat.size - maxBytes) : fromByte;
		const length = stat.size - start;
		const buffer = Buffer.allocUnsafe(length);
		const fd = fs.openSync(filePath, "r");
		try {
			fs.readSync(fd, buffer, 0, length, start);
		} finally {
			fs.closeSync(fd);
		}
		let text = buffer.toString("utf8");
		let actualStart = start;
		if (fromByte === 0 && start > 0) {
			const newline = text.indexOf("\n");
			if (newline < 0) return { text: "", fromByte: stat.size, newSize: stat.size };
			actualStart += Buffer.byteLength(text.slice(0, newline + 1));
			text = text.slice(newline + 1);
		}
		const finalNewline = text.lastIndexOf("\n");
		if (finalNewline < 0) return { text: "", fromByte: actualStart, newSize: stat.size };
		return { text: text.slice(0, finalNewline + 1), fromByte: actualStart, newSize: stat.size };
	} catch {
		return null;
	}
}

/** Async counterpart for render-adjacent consumers. File metadata and bytes are read without blocking the TUI thread. */
export async function readJournalTailChunkAsync(
	filePath: string,
	fromByte = 0,
	maxBytes = JOURNAL_TAIL_BYTES,
): Promise<JournalTailChunk | null> {
	try {
		const stat = await fs.promises.stat(filePath);
		if (!stat.isFile()) return null;
		if (stat.size <= fromByte) return { text: "", fromByte, newSize: stat.size };
		const start = fromByte === 0 ? Math.max(0, stat.size - maxBytes) : fromByte;
		const length = stat.size - start;
		const handle = await fs.promises.open(filePath, "r");
		const buffer = Buffer.allocUnsafe(length);
		let bytesRead = 0;
		try {
			while (bytesRead < length) {
				const read = await handle.read(buffer, bytesRead, length - bytesRead, start + bytesRead);
				if (read.bytesRead === 0) break;
				bytesRead += read.bytesRead;
			}
		} finally {
			await handle.close();
		}
		let text = buffer.subarray(0, bytesRead).toString("utf8");
		let actualStart = start;
		if (fromByte === 0 && start > 0) {
			const newline = text.indexOf("\n");
			if (newline < 0) return { text: "", fromByte: stat.size, newSize: stat.size };
			actualStart += Buffer.byteLength(text.slice(0, newline + 1));
			text = text.slice(newline + 1);
		}
		const finalNewline = text.lastIndexOf("\n");
		if (finalNewline < 0) return { text: "", fromByte: actualStart, newSize: stat.size };
		return { text: text.slice(0, finalNewline + 1), fromByte: actualStart, newSize: stat.size };
	} catch {
		return null;
	}
}
