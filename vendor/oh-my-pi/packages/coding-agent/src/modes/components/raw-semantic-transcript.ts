import { type Component, wrapTextWithAnsi } from "@oh-my-pi/pi-tui";
import type { SessionEntry, SessionHeader } from "../../session/session-entries";

export interface RawSemanticTranscriptSnapshot {
	header: SessionHeader | null;
	entries: readonly SessionEntry[];
	/** True while the provider response has not been journaled as an entry yet. */
	streaming: boolean;
}

/**
 * Serialize one semantic session value for diagnostics.
 *
 * This is intentionally a structured JSON projection, not a byte-level view of
 * the persisted JSONL file. A defensive fallback keeps a malformed extension
 * value from making the diagnostic view itself fail to render.
 */
export function serializeRawSemanticValue(value: unknown): string {
	try {
		const serialized = JSON.stringify(value);
		return serialized === undefined ? "null" : serialized;
	} catch {
		return '{"type":"serialization_error"}';
	}
}

export function formatRawSemanticTranscript(snapshot: RawSemanticTranscriptSnapshot): string[] {
	const lines: string[] = [];
	if (snapshot.header) lines.push(serializeRawSemanticValue(snapshot.header));
	for (const entry of snapshot.entries) lines.push(serializeRawSemanticValue(entry));
	if (snapshot.streaming) lines.push("[live stream not journaled yet]");
	return lines;
}

/** Render-only diagnostic projection of a session header and semantic entries. */
export class RawSemanticTranscriptComponent implements Component {
	constructor(private readonly getSnapshot: () => RawSemanticTranscriptSnapshot) {}

	render(width: number): readonly string[] {
		const safeWidth = Math.max(1, width);
		const wrapped: string[] = [];
		for (const line of formatRawSemanticTranscript(this.getSnapshot())) {
			wrapped.push(...wrapTextWithAnsi(line, safeWidth));
		}
		return wrapped;
	}
}
