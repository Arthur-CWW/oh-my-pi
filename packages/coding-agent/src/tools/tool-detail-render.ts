import { replaceTabs, sliceWithWidth, visibleWidth } from "@oh-my-pi/pi-tui";

/** Truncate a rendered tool title path while preserving both ends. */
export function truncateEditTitlePath(displayPath: string, maxWidth: number | undefined): string {
	if (maxWidth === undefined) return displayPath;
	const width = visibleWidth(displayPath);
	const safeMaxWidth = Math.max(0, Math.floor(maxWidth));
	if (width <= safeMaxWidth) return displayPath;

	const contentWidth = safeMaxWidth - 1;
	if (contentWidth <= 0) return "…";

	const headWidth = Math.floor(contentWidth / 2);
	const tailWidth = contentWidth - headWidth;
	const head = sliceWithWidth(displayPath, 0, headWidth, true).text;
	const tail = sliceWithWidth(displayPath, Math.max(0, width - tailWidth), tailWidth, true).text;
	return `${head}…${tail}`;
}

function decodePartialJsonStringFragment(fragment: string): string {
	// Trim a trailing partial escape so JSON.parse sees a well-formed string.
	let text = fragment.replace(/\\u[0-9a-fA-F]{0,3}$/u, "");
	const trailingBackslashes = text.match(/\\+$/u)?.[0].length ?? 0;
	if (trailingBackslashes % 2 === 1) text = text.slice(0, -1);
	try {
		return JSON.parse(`"${text}"`) as string;
	} catch {
		return text;
	}
}

function extractPartialJsonString(partialJson: unknown, key: string): string | undefined {
	if (typeof partialJson !== "string" || partialJson.length === 0) return undefined;
	const pattern = new RegExp(`"${key}"\\s*:\\s*"((?:\\\\.|[^"\\\\])*)`, "u");
	const match = pattern.exec(partialJson);
	return match ? decodePartialJsonStringFragment(match[1]!) : undefined;
}

function rawTextInputFromPartialJson(partialJson: unknown): string | undefined {
	if (typeof partialJson !== "string" || partialJson.length === 0) return undefined;
	const trimmed = partialJson.trimStart();
	if (trimmed.length === 0) return undefined;
	const first = trimmed[0];
	// Function-tool arguments stream as JSON. Custom/free-form tools stream raw
	// text in the same transport field; only the raw form is a valid fallback for
	// the conventional `input` parameter.
	if (first === "{" || first === '"') return undefined;
	return partialJson;
}

/** Return a streamed tool input whether transport carried raw text or partial JSON. */
export function getStreamedToolInput(args: unknown): string | undefined {
	if (args == null || typeof args !== "object") return undefined;
	const record = args as Record<string, unknown>;
	if (typeof record.input === "string") return record.input;
	const partialJson = record.__partialJson;
	return rawTextInputFromPartialJson(partialJson) ?? extractPartialJsonString(partialJson, "input");
}

function normalizeInputPath(rawPath: string): string {
	const trimmed = rawPath.trim();
	const withoutHash = trimmed.replace(/#[0-9a-fA-F]{4}$/u, "");
	if (withoutHash.length >= 2) {
		const first = withoutHash[0];
		const last = withoutHash[withoutHash.length - 1];
		if ((first === "'" || first === '"') && first === last) return withoutHash.slice(1, -1);
	}
	return withoutHash;
}

function firstInputPath(input: string): string | undefined {
	for (const rawLine of input.split("\n")) {
		const line = rawLine.replace(/\r$/, "").trim();
		const hashline = /^\[([^\]]*)(?:\]|$)/u.exec(line)?.[1];
		if (hashline) {
			const path = normalizeInputPath(hashline);
			if (path) return path;
		}
		const applyPatch = /^\*\*\*\s+(?:Update|Add|Delete|Move to) File:\s*(.*?)\s*$/u.exec(line)?.[1];
		if (applyPatch) {
			const path = normalizeInputPath(applyPatch);
			if (path) return path;
		}
	}
	return undefined;
}

/** Extract the first edit/apply_patch target path without exposing raw input. */
export function getStreamedEditTargetPath(args: unknown): string | undefined {
	if (args == null || typeof args !== "object") return undefined;
	const record = args as Record<string, unknown>;
	const filePath = record.file_path;
	if (typeof filePath === "string" && filePath.trim()) return filePath;
	const path = record.path;
	if (typeof path === "string" && path.trim()) return path;
	const edits = Array.isArray(record.edits) ? (record.edits[0] as Record<string, unknown> | undefined) : undefined;
	if (edits && typeof edits.path === "string" && edits.path.trim()) return edits.path;
	const input = getStreamedToolInput(args);
	const inputPath = input ? firstInputPath(input) : undefined;
	if (inputPath) return inputPath;
	return (
		extractPartialJsonString(record.__partialJson, "file_path") ??
		extractPartialJsonString(record.__partialJson, "path") ??
		undefined
	);
}

export function getArgsWithStreamedTextInput(args: unknown): unknown {
	if (args == null || typeof args !== "object") return args;
	const record = args as Record<string, unknown>;
	if (typeof record.input === "string") return args;
	const input = getStreamedToolInput(args);
	return input === undefined ? args : { ...record, input };
}

/** Absolute fs path recorded in read-result metadata, when available. */
export function readSourceFsPath(
	details: { meta?: { source?: { type?: string; value?: string } } } | undefined,
): string | undefined {
	const source = details?.meta?.source;
	return source?.type === "path" ? source.value : undefined;
}

export function sanitizeDiagnosticDisplayText(text: string): string {
	return replaceTabs(text);
}

