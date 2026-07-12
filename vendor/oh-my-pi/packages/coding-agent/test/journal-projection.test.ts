import { afterEach, describe, expect, it } from "bun:test";
import * as fs from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";
import {
	decodeJournalEntries,
	projectJournalEntries,
	readJournalTailChunk,
} from "@oh-my-pi/pi-coding-agent/journal/projection";

const roots: string[] = [];

afterEach(async () => {
	for (const root of roots.splice(0)) await fs.rm(root, { recursive: true, force: true });
});

async function tempRoot(): Promise<string> {
	const root = await fs.mkdtemp(path.join(os.tmpdir(), "omp-journal-projection-"));
	roots.push(root);
	return root;
}

describe("journal projection", () => {
	it("keeps valid typed entries around malformed JSONL lines", () => {
		const entries = decodeJournalEntries(
			'{"type":"session","id":"s","timestamp":"t","cwd":"/tmp"}\nnot-json\n{"type":"message","id":"m","parentId":null,"timestamp":"t","message":{"role":"user","content":"hi"}}\n',
		);
		expect(entries.map(entry => entry.type)).toEqual(["session", "message"]);
		expect(projectJournalEntries(entries)?.leafId).toBe("m");
	});

	it("drops partial records at both edges of a bounded tail window", async () => {
		const root = await tempRoot();
		const journal = path.join(root, "session.jsonl");
		await fs.writeFile(journal, `discard-${"x".repeat(64)}\n{"type":"message","id":"kept"}\npartial`);
		const chunk = readJournalTailChunk(journal, 0, 50);
		expect(chunk?.text).toBe('{"type":"message","id":"kept"}\n');
		expect(chunk?.newSize).toBeGreaterThan(chunk?.fromByte ?? 0);
	});

	it("tolerates absent and future session versions", () => {
		for (const version of [undefined, 999]) {
			const versionField = version === undefined ? "" : `,"version":${version}`;
			const decoded = decodeJournalEntries(
				`{"type":"session","id":"s","timestamp":"t","cwd":"/tmp"${versionField}}\n`,
			);
			expect(projectJournalEntries(decoded)?.header.version).toBe(version);
		}
	});
});
