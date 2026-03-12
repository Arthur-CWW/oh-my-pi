import { Text } from "@mariozechner/pi-tui";

export interface RenderTheme {
	readonly fg: (token: string, text: string) => string;
	readonly bold: (text: string) => string;
}

interface FetchContentRenderDetails {
	readonly urlCount?: number;
	readonly successful?: number;
	readonly totalChars?: number;
	readonly error?: string;
	readonly title?: string;
	readonly truncated?: boolean;
	readonly responseId?: string;
	readonly phase?: string;
	readonly progress?: number;
	readonly hasImage?: boolean;
	readonly imageCount?: number;
	readonly prompt?: string;
	readonly timestamp?: string;
	readonly frames?: number;
	readonly duration?: number;
}

interface FetchContentRenderItem {
	readonly type?: unknown;
	readonly text?: unknown;
}

function formatDurationSeconds(totalSeconds: number): string {
	const hours = Math.floor(totalSeconds / 3600);
	const minutes = Math.floor((totalSeconds % 3600) / 60);
	const seconds = totalSeconds % 60;
	if (hours > 0) {
		return `${hours}:${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")}`;
	}
	return `${minutes}:${String(seconds).padStart(2, "0")}`;
}

function asRecord(value: unknown): Record<string, unknown> | null {
	return value && typeof value === "object" ? (value as Record<string, unknown>) : null;
}

function readString(value: unknown): string | undefined {
	return typeof value === "string" ? value : undefined;
}

function readNumber(value: unknown): number | undefined {
	return typeof value === "number" ? value : undefined;
}

function readBoolean(value: unknown): boolean | undefined {
	return typeof value === "boolean" ? value : undefined;
}

function readStringArray(value: unknown): ReadonlyArray<string> | undefined {
	return Array.isArray(value) && value.every((entry) => typeof entry === "string")
		? value
		: undefined;
}

function readFetchContentRenderDetails(value: unknown): FetchContentRenderDetails {
	const record = asRecord(value);
	if (!record) {
		return {};
	}
	return {
		urlCount: readNumber(record.urlCount),
		successful: readNumber(record.successful),
		totalChars: readNumber(record.totalChars),
		error: readString(record.error),
		title: readString(record.title),
		truncated: readBoolean(record.truncated),
		responseId: readString(record.responseId),
		phase: readString(record.phase),
		progress: readNumber(record.progress),
		hasImage: readBoolean(record.hasImage),
		imageCount: readNumber(record.imageCount),
		prompt: readString(record.prompt),
		timestamp: readString(record.timestamp),
		frames: readNumber(record.frames),
		duration: readNumber(record.duration),
	};
}

function readFetchCallArgs(value: unknown): {
	readonly urlList: ReadonlyArray<string>;
	readonly prompt?: string;
	readonly timestamp?: string;
	readonly frames?: number;
	readonly model?: string;
} {
	const record = asRecord(value);
	if (!record) {
		return { urlList: [] };
	}
	const urls = readStringArray(record.urls);
	const url = readString(record.url);
	return {
		urlList: urls ?? (url ? [url] : []),
		prompt: readString(record.prompt),
		timestamp: readString(record.timestamp),
		frames: readNumber(record.frames),
		model: readString(record.model),
	};
}

function readFetchTextContent(items: unknown): string {
	if (!Array.isArray(items)) {
		return "";
	}
	for (const item of items as ReadonlyArray<FetchContentRenderItem>) {
		if (item.type === "text" && typeof item.text === "string") {
			return item.text;
		}
	}
	return "";
}

export function renderFetchContentCall(args: unknown, theme: RenderTheme): Text {
	const { urlList, prompt, timestamp, frames, model } = readFetchCallArgs(args);
	if (urlList.length === 0) {
		return new Text(
			theme.fg("toolTitle", theme.bold("fetch ")) + theme.fg("error", "(no URL)"),
			0,
			0,
		);
	}
	const lines: string[] = [];
	if (urlList.length === 1) {
		const display = urlList[0].length > 60 ? urlList[0].slice(0, 57) + "..." : urlList[0];
		lines.push(theme.fg("toolTitle", theme.bold("fetch ")) + theme.fg("accent", display));
	} else {
		lines.push(
			theme.fg("toolTitle", theme.bold("fetch ")) + theme.fg("accent", `${urlList.length} URLs`),
		);
		for (const url of urlList.slice(0, 5)) {
			const display = url.length > 60 ? url.slice(0, 57) + "..." : url;
			lines.push(theme.fg("muted", `  ${display}`));
		}
		if (urlList.length > 5) {
			lines.push(theme.fg("muted", `  ... and ${urlList.length - 5} more`));
		}
	}
	if (timestamp) {
		lines.push(theme.fg("dim", "  timestamp: ") + theme.fg("warning", timestamp));
	}
	if (typeof frames === "number") {
		lines.push(theme.fg("dim", "  frames: ") + theme.fg("warning", String(frames)));
	}
	if (prompt) {
		const display = prompt.length > 250 ? prompt.slice(0, 247) + "..." : prompt;
		lines.push(theme.fg("dim", "  prompt: ") + theme.fg("muted", `"${display}"`));
	}
	if (model) {
		lines.push(theme.fg("dim", "  model: ") + theme.fg("warning", model));
	}
	return new Text(lines.join("\n"), 0, 0);
}

export function renderFetchContentResult(
	result: { readonly details?: unknown; readonly content?: unknown },
	state: { readonly expanded?: boolean; readonly isPartial?: boolean },
	theme: RenderTheme,
): Text {
	const details = readFetchContentRenderDetails(result.details);
	if (state.isPartial) {
		const progress = details.progress ?? 0;
		const bar = "█".repeat(Math.floor(progress * 10)) + "░".repeat(10 - Math.floor(progress * 10));
		return new Text(theme.fg("accent", `[${bar}] ${details.phase || "fetching"}`), 0, 0);
	}
	if (details.error) {
		return new Text(theme.fg("error", `Error: ${details.error}`), 0, 0);
	}
	if (details.urlCount === 1) {
		const title = details.title || "Untitled";
		const imageCount = details.imageCount ?? (details.hasImage ? 1 : 0);
		const imageBadge =
			imageCount > 1
				? theme.fg("accent", ` [${imageCount} images]`)
				: imageCount === 1
					? theme.fg("accent", " [image]")
					: "";
		let statusLine =
			theme.fg("success", title) +
			theme.fg("muted", ` (${details.totalChars ?? 0} chars)`) +
			imageBadge;
		if (details.truncated) {
			statusLine += theme.fg("warning", " [truncated]");
		}
		if (typeof details.duration === "number") {
			statusLine += theme.fg(
				"muted",
				` | ${formatDurationSeconds(Math.floor(details.duration))} total`,
			);
		}
		const textContent = readFetchTextContent(result.content);
		if (!state.expanded) {
			const brief = textContent.length > 200 ? textContent.slice(0, 200) + "..." : textContent;
			return new Text(statusLine + "\n" + theme.fg("dim", brief), 0, 0);
		}
		const lines = [statusLine];
		if (details.prompt) {
			const display =
				details.prompt.length > 250 ? details.prompt.slice(0, 247) + "..." : details.prompt;
			lines.push(theme.fg("dim", `  prompt: "${display}"`));
		}
		if (details.timestamp) {
			lines.push(theme.fg("dim", `  timestamp: ${details.timestamp}`));
		}
		if (typeof details.frames === "number") {
			lines.push(theme.fg("dim", `  frames: ${details.frames}`));
		}
		const preview = textContent.length > 500 ? textContent.slice(0, 500) + "..." : textContent;
		lines.push(theme.fg("dim", preview));
		return new Text(lines.join("\n"), 0, 0);
	}
	const countColor = (details.successful ?? 0) > 0 ? "success" : "error";
	const statusLine =
		theme.fg(countColor, `${details.successful ?? 0}/${details.urlCount ?? 0} URLs`) +
		theme.fg("muted", " (content stored)");
	if (!state.expanded) {
		return new Text(statusLine, 0, 0);
	}
	const textContent = readFetchTextContent(result.content);
	const preview = textContent.length > 500 ? textContent.slice(0, 500) + "..." : textContent;
	return new Text(statusLine + "\n" + theme.fg("dim", preview), 0, 0);
}
