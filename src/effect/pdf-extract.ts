import { mkdir, writeFile } from "node:fs/promises";
import { basename, join } from "node:path";
import { homedir } from "node:os";
import { getDocumentProxy } from "unpdf";

export interface PDFExtractResult {
	readonly title: string;
	readonly pages: number;
	readonly chars: number;
	readonly outputPath: string;
}

export interface PDFExtractOptions {
	readonly maxPages?: number;
	readonly outputDir?: string;
	readonly filename?: string;
}

const DEFAULT_MAX_PAGES = 100;
const DEFAULT_OUTPUT_DIR = join(homedir(), "Downloads");

export async function extractPDFToMarkdown(
	buffer: ArrayBuffer,
	url: string,
	options: PDFExtractOptions = {},
): Promise<PDFExtractResult> {
	const { maxPages = DEFAULT_MAX_PAGES, outputDir = DEFAULT_OUTPUT_DIR, filename } = options;
	const pdf = await getDocumentProxy(new Uint8Array(buffer));
	const metadata = await pdf.getMetadata();
	const metaTitle = metadata.info?.Title as string | undefined;
	const title = metaTitle?.trim() || extractTitleFromUrl(url);
	const pagesToExtract = Math.min(pdf.numPages, maxPages);
	const truncated = pdf.numPages > maxPages;

	const pages: Array<{ readonly pageNum: number; readonly text: string }> = [];
	for (let pageNumber = 1; pageNumber <= pagesToExtract; pageNumber += 1) {
		const page = await pdf.getPage(pageNumber);
		const textContent = await page.getTextContent();
		const pageText = textContent.items
			.map((item: unknown) => {
				const textItem = item as { readonly str?: string };
				return textItem.str || "";
			})
			.join(" ")
			.replace(/\s+/g, " ")
			.trim();
		if (pageText) {
			pages.push({ pageNum: pageNumber, text: pageText });
		}
	}

	const lines: string[] = [];
	lines.push(`# ${title}`);
	lines.push("");
	lines.push(`> Source: ${url}`);
	lines.push(`> Pages: ${pdf.numPages}${truncated ? ` (extracted first ${pagesToExtract})` : ""}`);
	if (metadata.info?.Author) {
		lines.push(`> Author: ${metadata.info.Author}`);
	}
	lines.push("");
	lines.push("---");
	lines.push("");

	for (let index = 0; index < pages.length; index += 1) {
		if (index > 0) {
			lines.push("");
			lines.push(`<!-- Page ${pages[index]?.pageNum} -->`);
			lines.push("");
		}
		lines.push(pages[index]?.text ?? "");
	}

	if (truncated) {
		lines.push("");
		lines.push("---");
		lines.push("");
		lines.push(`*[Truncated: Only first ${pagesToExtract} of ${pdf.numPages} pages extracted]*`);
	}

	const content = lines.join("\n");
	const outputFilename = filename || sanitizeFilename(title) + ".md";
	const outputPath = join(outputDir, outputFilename);
	await mkdir(outputDir, { recursive: true });
	await writeFile(outputPath, content, "utf-8");

	return {
		title,
		pages: pdf.numPages,
		chars: content.length,
		outputPath,
	};
}

function extractTitleFromUrl(url: string): string {
	try {
		const parsed = new URL(url);
		let fileName = basename(parsed.pathname, ".pdf");
		if (parsed.hostname.includes("arxiv.org")) {
			const match = parsed.pathname.match(/\/(?:pdf|abs)\/(\d+\.\d+)/);
			if (match?.[1]) {
				fileName = `arxiv-${match[1]}`;
			}
		}
		fileName = fileName.replace(/[_-]+/g, " ").replace(/\s+/g, " ").trim();
		return fileName || "document";
	} catch {
		return "document";
	}
}

function sanitizeFilename(name: string): string {
	return (
		name
			.toLowerCase()
			.replace(/[^a-z0-9\s-]/g, "")
			.replace(/\s+/g, "-")
			.replace(/-+/g, "-")
			.slice(0, 100)
			.replace(/^-|-$/g, "") || "document"
	);
}

export function isPDF(url: string, contentType?: string): boolean {
	if (contentType?.includes("application/pdf")) {
		return true;
	}
	try {
		return new URL(url).pathname.toLowerCase().endsWith(".pdf");
	} catch {
		return false;
	}
}
