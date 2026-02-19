import { afterEach, describe, expect, it } from "bun:test";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { isVideoFile } from "../src/old/video-extract.ts";

const tempDirs: string[] = [];

afterEach(() => {
	for (const dir of tempDirs.splice(0)) {
		rmSync(dir, { recursive: true, force: true });
	}
});

describe("isVideoFile", () => {
	it("accepts supported local video path", () => {
		const dir = mkdtempSync(join(tmpdir(), "pi-web-access-test-"));
		tempDirs.push(dir);
		const file = join(dir, "sample.mp4");
		writeFileSync(file, "not-real-video-but-valid-extension");

		const result = isVideoFile(file);
		expect(result).not.toBeNull();
		expect(result?.mimeType).toBe("video/mp4");
	});

	it("rejects non-video paths", () => {
		expect(isVideoFile("https://example.com/video.mp4")).toBeNull();
		expect(isVideoFile("/tmp/file.txt")).toBeNull();
	});
});
