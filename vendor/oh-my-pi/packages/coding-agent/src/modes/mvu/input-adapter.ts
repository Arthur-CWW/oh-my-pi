import {
	extractPrintableText,
	isKeyRelease,
	isKeyRepeat,
	matchesKey,
	parseSgrMouse,
	parseKey,
	type KeyId,
} from "@oh-my-pi/pi-tui";
import type { KeyEvent } from "./schema";

const PASTE_START = "\x1b[200~";
const PASTE_END = "\x1b[201~";

/**
 * Converts one already-framed StdinBuffer sequence into an MVU key event.
 *
 * Framing deliberately remains in pi-tui's StdinBuffer. This adapter only
 * interprets the complete sequence handed to the TUI input seam.
 */
export interface TerminalInputAdapter {
	decode(sequence: string): KeyEvent | undefined;
	resize(columns: number, rows: number): KeyEvent;
	retains(sequence: string): boolean;
}

function decodePaste(sequence: string): KeyEvent | undefined {
	if (!sequence.startsWith(PASTE_START) || !sequence.endsWith(PASTE_END)) return undefined;
	const text = sequence.slice(PASTE_START.length, -PASTE_END.length);
	return { _tag: "Paste", text };
}

function decodeReleaseKey(sequence: string): KeyId | undefined {
	if (!isKeyRelease(sequence)) return undefined;
	const eventMarker = sequence.indexOf(":3", sequence.indexOf(";") + 1);
	if (eventMarker === -1) return undefined;
	const key = parseKey(`${sequence.slice(0, eventMarker)}${sequence.slice(eventMarker + 2)}`);
	return key as KeyId | undefined;
}

export const makeTerminalInputAdapter = (): TerminalInputAdapter => ({
	decode(sequence) {
		const paste = decodePaste(sequence);
		const mouse = sequence.startsWith("\x1b[<") ? parseSgrMouse(sequence) : null;
		if (mouse !== null) return { _tag: "Mouse", event: mouse };

		if (paste !== undefined) return paste;

		const releaseKey = decodeReleaseKey(sequence);
		if (releaseKey !== undefined) {
			return { _tag: "Release", key: releaseKey, repeat: false };
		}

		const key = parseKey(sequence);
		if (key === undefined) return undefined;

		const text = extractPrintableText(sequence);
		if (text === undefined) {
			return { _tag: "Press", key: key as KeyId, repeat: isKeyRepeat(sequence) };
		}
		return { _tag: "Press", key: key as KeyId, text, repeat: isKeyRepeat(sequence) };
	},
	resize(columns, rows) {
		return { _tag: "Resize", columns, rows };
	},
	retains(sequence) {
		return matchesKey(sequence, "shift+ctrl+d");
	},
});
