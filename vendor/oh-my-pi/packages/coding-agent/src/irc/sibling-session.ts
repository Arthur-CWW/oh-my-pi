import * as fs from "node:fs";
import type { IrcExternalBus, IrcExternalPeer } from "./bus-external";

export const SIBLING_TRANSCRIPT_TAIL_BYTES = 256 * 1024;

export interface SiblingTranscriptChunk {
	text: string;
	fromByte: number;
	newSize: number;
}

/** Read complete JSONL records from a bounded tail, or only bytes appended after a prior snapshot. */
export function readSiblingTranscriptChunk(sessionFile: string, fromByte = 0): SiblingTranscriptChunk | null {
	try {
		const stat = fs.statSync(sessionFile);
		if (!stat.isFile()) return null;
		if (stat.size <= fromByte) return { text: "", fromByte, newSize: stat.size };
		const start = fromByte === 0 ? Math.max(0, stat.size - SIBLING_TRANSCRIPT_TAIL_BYTES) : fromByte;
		const length = stat.size - start;
		const buffer = Buffer.allocUnsafe(length);
		const fd = fs.openSync(sessionFile, "r");
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

/** Watches exactly one selected sibling journal. Dispose before selecting another sibling. */
export function watchSiblingTranscript(sessionFile: string, onAppend: () => void): () => void {
	let watcher: fs.FSWatcher | undefined;
	try {
		watcher = fs.watch(sessionFile, event => {
			if (event === "change") onAppend();
		});
	} catch {
		return () => {};
	}
	return () => watcher?.close();
}

/** Operator-authored cockpit input retains user provenance across the external bus. */
export function sendSiblingUserMessage(bus: IrcExternalBus, fromPeer: string, peer: IrcExternalPeer, body: string): number {
	const message = body.trim();
	if (!message) throw new Error("Cannot send an empty sibling message");
	return bus.sendMessage({ fromPeer, toPeer: peer.name, body: message, origin: "user" });
}
