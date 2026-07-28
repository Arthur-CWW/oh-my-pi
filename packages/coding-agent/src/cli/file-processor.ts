/**
 * Process @file CLI arguments into text, document content, and media attachments
 */
import * as fs from "node:fs";
import * as path from "node:path";
import { MAX_ANTIGRAVITY_INLINE_VIDEO_BYTES, type ImageContent, type MediaContent } from "@oh-my-pi/pi-ai";
import { getProjectDir, isEnoent, readImageMetadata } from "@oh-my-pi/pi-utils";
import chalk from "chalk";
import { resolveReadPath } from "../tools/path-utils";
import { formatBytes } from "../tools/render-utils";
import { formatDimensionNote, resizeImage } from "../utils/image-resize";
import { convertFileWithMarkit } from "../utils/markit";
import { videoMimeTypeForExtension } from "../utils/video-loading";

// Keep CLI startup responsive and avoid OOM when users pass huge files.
// If a file exceeds these limits, we include it as a path-only <file/> block.
const MAX_CLI_TEXT_BYTES = 5 * 1024 * 1024; // 5MB
const MAX_CLI_IMAGE_BYTES = 25 * 1024 * 1024; // 25MB
const CONVERTIBLE_EXTENSIONS = new Set([".pdf", ".doc", ".docx", ".ppt", ".pptx", ".xls", ".xlsx", ".rtf", ".epub"]);

export interface ProcessedFiles {
	text: string;
	attachments: MediaContent[];
}

export interface ProcessFileOptions {
	/** Whether to auto-resize images to 2000x2000 max. Default: true */
	autoResizeImages?: boolean;
}

/** Process @file arguments into text, document content, and media attachments */
export async function processFileArguments(fileArgs: string[], options?: ProcessFileOptions): Promise<ProcessedFiles> {
	const autoResizeImages = options?.autoResizeImages ?? true;
	let text = "";
	const attachments: MediaContent[] = [];

	for (const fileArg of fileArgs) {
		// Expand and resolve path (handles ~ expansion and macOS screenshot Unicode spaces)
		const absolutePath = path.resolve(resolveReadPath(fileArg, getProjectDir()));

		const stat = fs.statSync(absolutePath, { throwIfNoEntry: false });
		const ext = path.extname(absolutePath).toLowerCase();
		const videoMimeType = videoMimeTypeForExtension(ext);
		if (!stat) {
			console.error(chalk.red(`Error: File not found: ${absolutePath}`));
			process.exit(1);
		}

		if (videoMimeType) {
			if (!stat.isFile()) {
				throw new Error(`Invalid video attachment (not a regular file): ${absolutePath}`);
			}
			if (stat.size === 0) {
				throw new Error(`Invalid video attachment (empty file): ${absolutePath}`);
			}
			if (stat.size >= MAX_ANTIGRAVITY_INLINE_VIDEO_BYTES) {
				throw new Error(
					`Video attachment is too large (${formatBytes(stat.size)}; inline limit is under ${formatBytes(MAX_ANTIGRAVITY_INLINE_VIDEO_BYTES)}). Antigravity Files API upload is unavailable: ${absolutePath}`,
				);
			}
		}

		const imageMetadata = videoMimeType ? undefined : await readImageMetadata(absolutePath);
		const mimeType = imageMetadata?.mimeType;
		const maxBytes = mimeType ? MAX_CLI_IMAGE_BYTES : MAX_CLI_TEXT_BYTES;
		if (!videoMimeType && stat.size > maxBytes) {
			console.error(
				chalk.yellow(`Warning: Skipping file contents (too large: ${formatBytes(stat.size)}): ${absolutePath}`),
			);
			text += `<file name="${absolutePath}">(skipped: too large, ${formatBytes(stat.size)})</file>\n`;
			continue;
		}

		// Read file, handling not-found gracefully
		let buffer: Uint8Array;
		try {
			buffer = await Bun.file(absolutePath).bytes();
		} catch (err) {
			if (isEnoent(err)) {
				console.error(chalk.red(`Error: File not found: ${absolutePath}`));
				process.exit(1);
			}
			throw err;
		}
		if (buffer.length === 0) {
			continue;
		}

		if (videoMimeType) {
			attachments.push({ type: "video", mimeType: videoMimeType, data: buffer.toBase64() });
			text += `<file name="${absolutePath}"></file>\n`;
		} else if (mimeType) {
			// Handle image file
			const base64Content = buffer.toBase64();
			let attachment: ImageContent;
			let dimensionNote: string | undefined;

			if (autoResizeImages) {
				try {
					const resized = await resizeImage({ type: "image", data: base64Content, mimeType });
					dimensionNote = formatDimensionNote(resized);
					attachment = {
						type: "image",
						mimeType: resized.mimeType,
						data: resized.data,
					};
				} catch {
					// Fall back to original image on resize failure
					attachment = {
						type: "image",
						mimeType,
						data: base64Content,
					};
				}
			} else {
				attachment = {
					type: "image",
					mimeType,
					data: base64Content,
				};
			}

			attachments.push(attachment);

			// Add text reference to image with optional dimension note
			if (dimensionNote) {
				text += `<file name="${absolutePath}">${dimensionNote}</file>\n`;
			} else {
				text += `<file name="${absolutePath}"></file>\n`;
			}
		} else if (CONVERTIBLE_EXTENSIONS.has(ext)) {
			const result = await convertFileWithMarkit(absolutePath);
			if (result.ok) {
				text += `<file name="${absolutePath}">\n${result.content}\n</file>\n`;
			} else {
				text += `<file name="${absolutePath}">[Cannot read ${ext} file: ${result.error || "conversion failed"}]</file>\n`;
			}
		} else {
			// Handle text file
			try {
				const content = new TextDecoder().decode(buffer);
				text += `<file name="${absolutePath}">\n${content}\n</file>\n`;
			} catch (error: unknown) {
				const message = error instanceof Error ? error.message : String(error);
				console.error(chalk.red(`Error: Could not read file ${absolutePath}: ${message}`));
				process.exit(1);
			}
		}
	}

	return { text, attachments };
}
