import { afterEach, describe, expect, it } from "bun:test";
import * as fs from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";
import { IrcExternalBus } from "@oh-my-pi/pi-coding-agent/irc/bus-external";
import {
	readSiblingTranscriptChunk,
	SIBLING_TRANSCRIPT_TAIL_BYTES,
	sendSiblingUserMessage,
	watchSiblingTranscript,
} from "@oh-my-pi/pi-coding-agent/irc/sibling-session";

const roots: string[] = [];

afterEach(async () => {
	for (const root of roots.splice(0)) await fs.rm(root, { recursive: true, force: true });
});

async function tempRoot(): Promise<string> {
	const root = await fs.mkdtemp(path.join(os.tmpdir(), "omp-sibling-session-"));
	roots.push(root);
	return root;
}

describe("sibling session observation", () => {
	it("bounds initial history and follows complete live appends", async () => {
		const root = await tempRoot();
		const journal = path.join(root, "session.jsonl");
		const padding = "x".repeat(SIBLING_TRANSCRIPT_TAIL_BYTES + 32);
		await fs.writeFile(journal, `${padding}\n{"type":"message","id":1}\n`);
		const initial = readSiblingTranscriptChunk(journal);
		expect(initial).not.toBeNull();
		expect(Buffer.byteLength(initial!.text)).toBeLessThanOrEqual(SIBLING_TRANSCRIPT_TAIL_BYTES);
		expect(initial!.text).toBe('{"type":"message","id":1}\n');

		let resolveChanged!: () => void;
		const changed = new Promise<void>(resolve => {
			resolveChanged = resolve;
		});
		const stop = watchSiblingTranscript(journal, resolveChanged);
		const writer = await fs.open(journal, "a");
		await writer.write('{"type":"message","id":2}\n');
		await writer.sync();
		await writer.close();
		await changed;
		stop();
		const appended = readSiblingTranscriptChunk(journal, initial!.newSize);
		expect(appended?.text).toBe('{"type":"message","id":2}\n');
	});

	it("keeps historical journals readable after their writer exits", async () => {
		const root = await tempRoot();
		const journal = path.join(root, "ended.jsonl");
		await fs.writeFile(journal, '{"type":"message","id":1}\n{"type":"message","id":2}\n');
		expect(readSiblingTranscriptChunk(journal)?.text).toContain('"id":2');
	});

	it("delivers cockpit input with explicit user provenance across bus instances", async () => {
		const root = await tempRoot();
		const dbPath = path.join(root, "bus.sqlite");
		const sender = new IrcExternalBus(dbPath);
		const receiver = new IrcExternalBus(dbPath);
		try {
			const peer = receiver.registerPeer({
				sessionId: "receiver-session",
				name: "receiver",
				cwd: root,
				pid: process.pid,
				sessionFile: path.join(root, "receiver.jsonl"),
			});
			const id = sendSiblingUserMessage(sender, "operator-session", peer, "hello from the cockpit");
			expect(receiver.pollMessages("receiver")).toEqual([
				{
					id,
					ts: expect.any(String),
					fromPeer: "operator-session",
					toPeer: "receiver",
					body: "hello from the cockpit",
					origin: "user",
				},
			]);
			expect(sender.listPeers({ includeStale: true })[0]?.sessionFile).toBe(path.join(root, "receiver.jsonl"));
		} finally {
			sender.close();
			receiver.close();
		}
	});
});
