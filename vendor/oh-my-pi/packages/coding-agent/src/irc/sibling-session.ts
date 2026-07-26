import * as fs from "node:fs";
import { JOURNAL_TAIL_BYTES, readJournalTailChunk } from "../journal/projection";
import type { IrcExternalBus, IrcExternalPeer } from "./bus-external";

export const SIBLING_TRANSCRIPT_TAIL_BYTES = JOURNAL_TAIL_BYTES;

export interface SiblingTranscriptChunk {
	text: string;
	fromByte: number;
	newSize: number;
}

/** Read complete JSONL records from a bounded tail, or only bytes appended after a prior snapshot. */
export function readSiblingTranscriptChunk(sessionFile: string, fromByte = 0): SiblingTranscriptChunk | null {
	return readJournalTailChunk(sessionFile, fromByte, SIBLING_TRANSCRIPT_TAIL_BYTES);
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
export function sendSiblingUserMessage(
	bus: IrcExternalBus,
	fromPeer: string,
	peer: IrcExternalPeer,
	body: string,
): number {
	const message = body.trim();
	if (!message) throw new Error("Cannot send an empty sibling message");
	return bus.sendMessage({ fromPeer, toPeer: peer.name, body: message, origin: "user", audience: "direct" });
}
