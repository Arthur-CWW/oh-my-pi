import { describe, expect, it } from "bun:test";
import {
	formatRawSemanticTranscript,
	RawSemanticTranscriptComponent,
} from "@oh-my-pi/pi-coding-agent/modes/components/raw-semantic-transcript";
import { TranscriptContainer } from "@oh-my-pi/pi-coding-agent/modes/components/transcript-container";
import type { SessionEntry, SessionHeader } from "@oh-my-pi/pi-coding-agent/session/session-entries";

const header: SessionHeader = {
	type: "session",
	version: 3,
	id: "session-1",
	timestamp: "2026-07-12T00:00:00.000Z",
	cwd: "/tmp/project",
};

function entry(type: string, fields: Record<string, unknown>): SessionEntry {
	return {
		type,
		id: `${type}-1`,
		parentId: null,
		timestamp: "2026-07-12T00:00:01.000Z",
		...fields,
	} as SessionEntry;
}

describe("raw semantic transcript projection", () => {
	it("includes the header and non-message semantic entries without mutating the session snapshot", () => {
		const entries = [
			entry("message", {
				message: { role: "user", content: "hello", timestamp: 1 },
			}),
			entry("model_change", { model: "provider/model", role: "default" }),
			entry("custom", { customType: "diagnostic", data: { enabled: true } }),
			entry("compaction", { summary: "kept summary", firstKeptEntryId: "message-1", tokensBefore: 42 }),
			entry("mode_change", { mode: "plan", data: { planFilePath: "plan.md" } }),
		];
		const before = structuredClone(entries);

		const lines = formatRawSemanticTranscript({ header, entries, streaming: false });

		expect(JSON.parse(lines[0]!)).toEqual(header);
		for (const type of ["message", "model_change", "custom", "compaction", "mode_change"]) {
			expect(lines.some(line => line.includes(`"type":"${type}"`))).toBe(true);
		}
		expect(entries).toEqual(before);
		expect(lines).not.toContain("[live stream not journaled yet]");
	});

	it("shows the explicit transient streaming limitation", () => {
		const lines = formatRawSemanticTranscript({ header, entries: [], streaming: true });

		expect(lines.at(-1)).toBe("[live stream not journaled yet]");
	});

	it("wraps semantic lines to the requested terminal width", () => {
		const component = new RawSemanticTranscriptComponent(() => ({
			header,
			entries: [entry("custom", { customType: "long", data: { text: "x".repeat(240) } })],
			streaming: false,
		}));

		const lines = component.render(80);
		expect(lines.length).toBeGreaterThan(2);
		expect(lines.every(line => Bun.stringWidth(line) <= 80)).toBe(true);
		expect(lines.join("")).toContain('"customType":"long"');
	});
	it("keeps rich children mounted while the projection is active", () => {
		const container = new TranscriptContainer();
		const rich = { render: () => ["rich"] };
		const raw = new RawSemanticTranscriptComponent(() => ({ header, entries: [], streaming: false }));

		container.addChild(rich);
		container.setRawProjection(raw);
		expect(container.render(200)).toEqual([JSON.stringify(header)]);
		expect(container.children).toEqual([rich]);

		container.setRawProjection(undefined);
		expect(container.render(80)).toEqual(["rich"]);
	});
});
