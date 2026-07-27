import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { processFileArguments } from "@oh-my-pi/pi-coding-agent/cli/file-processor";
import { Settings } from "@oh-my-pi/pi-coding-agent/config/settings";
import { assertInlineVideoByteCount, MAX_ANTIGRAVITY_INLINE_VIDEO_BYTES } from "@oh-my-pi/pi-ai";
import { ReadTool } from "@oh-my-pi/pi-coding-agent/tools/read";
import type { ToolSession } from "@oh-my-pi/pi-coding-agent/tools";

// 1x1 red PNG image as base64 (smallest valid PNG)
const TINY_PNG_BASE64 =
	"iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8DwHwAFBQIAX8jx0gAAAABJRU5ErkJggg==";

function createTestToolSession(cwd: string, settings: Settings = Settings.isolated()): ToolSession {
	return {
		cwd,
		hasUI: false,
		getSessionFile: () => null,
		getSessionSpawns: () => "*",
		settings,
	};
}

describe("blockImages setting", () => {
	describe("Read tool", () => {
		let testDir: string;

		beforeEach(() => {
			testDir = path.join(os.tmpdir(), `block-images-test-${Date.now()}-${Math.random()}`);
			fs.mkdirSync(testDir, { recursive: true });
		});

		afterEach(() => {
			fs.rmSync(testDir, { recursive: true, force: true });
		});

		it("should include image blocks when inspect_image is disabled", async () => {
			// Create test image
			const imagePath = path.join(testDir, "test.png");
			fs.writeFileSync(imagePath, Buffer.from(TINY_PNG_BASE64, "base64"));

			const tool = new ReadTool(
				createTestToolSession(testDir, Settings.isolated({ "inspect_image.enabled": false })),
			);
			const result = await tool.execute("test-1", { path: imagePath });

			// Should have text note + image content
			expect(result.content.length).toBeGreaterThanOrEqual(1);
			const hasImage = result.content.some(c => c.type === "image");
			expect(hasImage).toBe(true);
		});

		it("should read text files normally", async () => {
			// Create test text file
			const textPath = path.join(testDir, "test.txt");
			fs.writeFileSync(textPath, "Hello, world!");

			const tool = new ReadTool(createTestToolSession(testDir));
			const result = await tool.execute("test-2", { path: textPath });

			expect(result.content).toHaveLength(1);
			expect(result.content[0].type).toBe("text");
			const textContent = result.content[0] as { type: "text"; text: string };
			expect(textContent.text).toContain("Hello, world!");
		});
	});

	describe("processFileArguments", () => {
		let testDir: string;

		beforeEach(() => {
			testDir = path.join(os.tmpdir(), `block-images-process-test-${Date.now()}-${Math.random()}`);
			fs.mkdirSync(testDir, { recursive: true });
		});

		afterEach(() => {
			fs.rmSync(testDir, { recursive: true, force: true });
		});

		it("should always process images (filtering happens at convertToLlm layer)", async () => {
			// Create test image
			const imagePath = path.join(testDir, "test.png");
			fs.writeFileSync(imagePath, Buffer.from(TINY_PNG_BASE64, "base64"));

			const result = await processFileArguments([imagePath]);

			expect(result.attachments).toHaveLength(1);
			expect(result.attachments[0].type).toBe("image");
		});

		it("ingests supported video extensions as ordered base64 attachments", async () => {
			const fixtures = [
				["clip.mp4", "video/mp4"],
				["clip.mov", "video/quicktime"],
				["clip.m4v", "video/x-m4v"],
				["clip.webm", "video/webm"],
			] as const;
			const bytes = Buffer.from([0, 1, 2, 3, 4]);
			for (const [name] of fixtures) fs.writeFileSync(path.join(testDir, name), bytes);

			const result = await processFileArguments(fixtures.map(([name]) => path.join(testDir, name)));

			expect(result.attachments).toEqual(
				fixtures.map(([name, mimeType]) => ({
					type: "video",
					mimeType,
					data: bytes.toString("base64"),
				})),
			);
			expect(result.text).toContain(`<file name="${path.join(testDir, "clip.mp4")}"></file>`);
		});

		it("rejects video files at the Antigravity inline byte boundary", () => {
			expect(() => assertInlineVideoByteCount(MAX_ANTIGRAVITY_INLINE_VIDEO_BYTES)).toThrow(/below/);
		});
		it("rejects oversized video files before reading them", async () => {
			const videoPath = path.join(testDir, "oversized.mp4");
			const handle = fs.openSync(videoPath, "w");
			try {
				fs.ftruncateSync(handle, MAX_ANTIGRAVITY_INLINE_VIDEO_BYTES);
			} finally {
				fs.closeSync(handle);
			}

			await expect(processFileArguments([videoPath])).rejects.toThrow(/inline limit/);
		});


		it("rejects empty video files before reading them", async () => {
			const videoPath = path.join(testDir, "empty.webm");
			fs.writeFileSync(videoPath, Buffer.alloc(0));

			await expect(processFileArguments([videoPath])).rejects.toThrow(/empty file/);
		});

		it("should process text files normally", async () => {
			// Create test text file
			const textPath = path.join(testDir, "test.txt");
			fs.writeFileSync(textPath, "Hello, world!");

			const result = await processFileArguments([textPath]);

			expect(result.attachments).toHaveLength(0);
			expect(result.text).toContain("Hello, world!");
		});
	});
});
