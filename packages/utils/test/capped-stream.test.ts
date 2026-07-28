import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import * as fs from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";
import { cappedStreamNotice, drainToFile, readCapped, withCappedStreamNotice } from "../src/stream";

function streamOf(...chunks: readonly Uint8Array[]): ReadableStream<Uint8Array> {
	let index = 0;
	return new ReadableStream<Uint8Array>({
		pull(controller) {
			if (index >= chunks.length) {
				controller.close();
				return;
			}
			controller.enqueue(chunks[index++]);
		},
	});
}

const encoder = new TextEncoder();

/** UTF-8 bytes for a literal. */
function ascii(text: string): Uint8Array {
	return encoder.encode(text);
}

/** `byteLength` bytes of 'a' — single-byte UTF-8, so byte and char counts match. */
function filler(byteLength: number): Uint8Array {
	return new Uint8Array(byteLength).fill(0x61);
}

describe("readCapped", () => {
	test("retains the whole stream when it fits the cap", async () => {
		const result = await readCapped(streamOf(ascii("alpha"), ascii("-beta")), 64);
		expect(result.text).toBe("alpha-beta");
		expect(result.truncated).toBe(false);
		expect(result.keptBytes).toBe(10);
		expect(result.totalBytes).toBe(10);
	});

	test("retains exactly the cap and reports the full emitted size", async () => {
		const result = await readCapped(streamOf(filler(1000), filler(1000), filler(1000)), 1500);
		expect(result.text.length).toBe(1500);
		expect(result.truncated).toBe(true);
		expect(result.keptBytes).toBe(1500);
		expect(result.totalBytes).toBe(3000);
	});

	test("keeps draining past the cap so the producer is never left blocked", async () => {
		let pulls = 0;
		let closed = false;
		const stream = new ReadableStream<Uint8Array>({
			pull(controller) {
				pulls += 1;
				if (pulls > 200) {
					closed = true;
					controller.close();
					return;
				}
				controller.enqueue(filler(4096));
			},
		});
		const result = await readCapped(stream, 1024);
		expect(closed).toBe(true);
		expect(pulls).toBe(201);
		expect(result.keptBytes).toBe(1024);
		expect(result.totalBytes).toBe(200 * 4096);
	});

	test("retained memory tracks the cap, not the emitted volume", async () => {
		const small = await readCapped(streamOf(...Array.from({ length: 16 }, () => filler(65536))), 4096);
		const large = await readCapped(streamOf(...Array.from({ length: 1600 }, () => filler(65536))), 4096);
		expect(large.totalBytes).toBe(small.totalBytes * 100);
		expect(large.text.length).toBe(small.text.length);
		expect(large.keptBytes).toBe(4096);
	});

	test("a non-positive cap discards everything but still counts the stream", async () => {
		const result = await readCapped(streamOf(filler(512)), 0);
		expect(result.text).toBe("");
		expect(result.truncated).toBe(true);
		expect(result.keptBytes).toBe(0);
		expect(result.totalBytes).toBe(512);
	});

	test("a multi-byte character severed by the cap does not corrupt earlier text", async () => {
		// "é" is 0xC3 0xA9; a cap of 3 keeps "ab" plus the lead byte only.
		const result = await readCapped(streamOf(ascii("abé")), 3);
		expect(result.text.startsWith("ab")).toBe(true);
		expect(result.truncated).toBe(true);
		expect(result.totalBytes).toBe(4);
	});

	test("an empty stream is not reported as truncated", async () => {
		const result = await readCapped(streamOf(), 128);
		expect(result.text).toBe("");
		expect(result.truncated).toBe(false);
		expect(result.totalBytes).toBe(0);
	});
});

describe("cappedStreamNotice", () => {
	test("is empty when nothing was dropped", async () => {
		const result = await readCapped(streamOf(ascii("ok")), 16);
		expect(cappedStreamNotice(result, "stdout")).toBe("");
		expect(withCappedStreamNotice(result, "stdout")).toBe("ok");
	});

	test("names the label and both byte counts when bytes were dropped", async () => {
		const result = await readCapped(streamOf(filler(5000)), 100);
		expect(cappedStreamNotice(result, "stdout")).toBe("\n[stdout truncated: kept 100 of 5000 bytes]");
		const annotated = withCappedStreamNotice(result, "stdout");
		expect(annotated.endsWith("\n[stdout truncated: kept 100 of 5000 bytes]")).toBe(true);
		expect(annotated.length).toBeGreaterThan(result.text.length);
	});
});

describe("drainToFile", () => {
	let dir: string;

	beforeAll(async () => {
		dir = await fs.mkdtemp(path.join(os.tmpdir(), "capped-stream-"));
	});

	afterAll(async () => {
		await fs.rm(dir, { recursive: true, force: true });
	});

	test("writes every byte to disk and reports the size", async () => {
		const target = path.join(dir, "spill.bin");
		const spill = await drainToFile(streamOf(ascii("head-"), filler(100_000), ascii("-tail")), target);
		expect(spill.path).toBe(target);
		expect(spill.bytes).toBe(100_010);
		const written = await Bun.file(target).text();
		expect(written.length).toBe(100_010);
		expect(written.startsWith("head-")).toBe(true);
		expect(written.endsWith("-tail")).toBe(true);
	});

	test("an empty stream still produces the file", async () => {
		const target = path.join(dir, "empty.bin");
		const spill = await drainToFile(streamOf(), target);
		expect(spill.bytes).toBe(0);
		expect(await Bun.file(target).text()).toBe("");
	});
});
