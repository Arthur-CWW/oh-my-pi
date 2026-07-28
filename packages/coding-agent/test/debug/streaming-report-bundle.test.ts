import { afterEach, describe, expect, it } from "bun:test";
import * as fs from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";
import { getConfigRootDir, setAgentDir } from "@oh-my-pi/pi-utils";
import { writeStreamingTarGz } from "@oh-my-pi/pi-coding-agent/debug/archive-writer";
import { createReportBundle } from "@oh-my-pi/pi-coding-agent/debug/report-bundle";

const originalAgentDir = process.env.PI_CODING_AGENT_DIR;
const fallbackAgentDir = path.join(getConfigRootDir(), "agent");
let cleanupRoot: string | undefined;

async function readArchiveEntry(archive: Bun.Archive, archivePath: string): Promise<Uint8Array> {
	const files = await archive.files();
	const file = files.get(archivePath);
	expect(file).toBeDefined();
	return file!.bytes();
}

afterEach(async () => {
	if (originalAgentDir) {
		setAgentDir(originalAgentDir);
	} else {
		setAgentDir(fallbackAgentDir);
		delete process.env.PI_CODING_AGENT_DIR;
	}
	if (cleanupRoot) {
		await fs.rm(cleanupRoot, { recursive: true, force: true });
		cleanupRoot = undefined;
	}
});

describe("streaming report archives", () => {
	it("preserves large session, artifact, and heap entries", async () => {
		cleanupRoot = await fs.mkdtemp(path.join(os.tmpdir(), "omp-streaming-report-"));
		const agentDir = path.join(cleanupRoot, "agent");
		await fs.mkdir(agentDir, { recursive: true });
		setAgentDir(agentDir);

		const sessionFile = path.join(cleanupRoot, "session.jsonl");
		const sessionText = "{\"role\":\"assistant\",\"content\":\"streamed\"}\n".repeat(100_000);
		await fs.writeFile(sessionFile, sessionText);

		const artifactsDir = sessionFile.slice(0, -6);
		await fs.mkdir(artifactsDir, { recursive: true });
		const artifactBytes = new Uint8Array(3 * 1024 * 1024 + 17);
		for (let index = 0; index < artifactBytes.length; index++) artifactBytes[index] = index % 251;
		await fs.writeFile(path.join(artifactsDir, "large.bin"), artifactBytes);

		const heapBytes = new Uint8Array(new ArrayBuffer(2 * 1024 * 1024 + 3));
		heapBytes.fill(0xa5);
		const result = await createReportBundle({
			sessionFile,
			heapSnapshot: { data: heapBytes.buffer },
		});

		expect(result.files).toEqual(expect.arrayContaining(["session.jsonl", "artifacts/large.bin", "heap.heapsnapshot"]));
		const archive = new Bun.Archive(await Bun.file(result.path).bytes());
		expect(new TextDecoder().decode(await readArchiveEntry(archive, "session.jsonl"))).toBe(sessionText);
		expect(await readArchiveEntry(archive, "artifacts/large.bin")).toEqual(artifactBytes);
		expect(await readArchiveEntry(archive, "heap.heapsnapshot")).toEqual(heapBytes);
	});

	it("reports bounded source chunks and removes temporary output on failure", async () => {
		cleanupRoot = await fs.mkdtemp(path.join(os.tmpdir(), "omp-streaming-writer-"));
		const sourcePath = path.join(cleanupRoot, "large.bin");
		const outputPath = path.join(cleanupRoot, "archive.tar.gz");
		const sourceBytes = new Uint8Array(8 * 1024 * 1024 + 31).fill(0x5a);
		await fs.writeFile(sourcePath, sourceBytes);
		const observedChunks: number[] = [];

		const metrics = await writeStreamingTarGz(
			outputPath,
			[{ path: "large.bin", source: { type: "file", path: sourcePath } }],
			{ onSourceChunk: size => observedChunks.push(size) },
		);

		expect(metrics.maxSourceChunk).toBeLessThanOrEqual(64 * 1024);
		expect(metrics.maxSourceChunk).toBeLessThan(sourceBytes.byteLength);
		expect(Math.max(...observedChunks)).toBe(metrics.maxSourceChunk);

		const failingDir = await fs.mkdtemp(path.join(cleanupRoot, "failure-"));
		await expect(
			writeStreamingTarGz(path.join(failingDir, "archive.tar.gz"), [
				{ path: "missing.bin", source: { type: "file", path: path.join(failingDir, "missing.bin") } },
			]),
		).rejects.toThrow();
		expect(await fs.readdir(failingDir)).toEqual([]);
	});
});
