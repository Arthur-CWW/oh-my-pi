import { getPreviewLines, replaceTabs, wrapTextWithAnsi } from "../../tools/render-utils";
import { Ellipsis } from "../../tui";
import type { Theme } from "../theme/theme";

const BODY_LINES_COLLAPSED = 2;
const BODY_LINES_EXPANDED = 12;
const BODY_LINE_WIDTH = 100;

/** Quote-bordered transcript body with optional terminal-width wrapping. */
export function renderTranscriptBodyLines(
	body: string,
	expanded: boolean,
	theme: Theme,
	options: {
		indent?: string;
		tone?: "dim" | "toolOutput";
		collapsedLines?: number;
		wrapWidth?: number;
	} = {},
): string[] {
	const indent = options.indent ?? "";
	const tone = options.tone ?? "toolOutput";
	const max = expanded ? BODY_LINES_EXPANDED : (options.collapsedLines ?? BODY_LINES_COLLAPSED);
	const logicalLines = body.split("\n").filter(line => line.trim());
	const quote = theme.fg("dim", theme.md.quoteBorder);
	const sourceLines =
		options.wrapWidth === undefined
			? getPreviewLines(body, max, BODY_LINE_WIDTH, Ellipsis.Unicode)
			: logicalLines
					.slice(0, max)
					.flatMap(line => wrapTextWithAnsi(replaceTabs(line), Math.max(1, options.wrapWidth ?? 1)));
	const lines = sourceLines.map(line => `${indent}${quote} ${theme.fg(tone, replaceTabs(line))}`);
	const hidden = logicalLines.length - Math.min(logicalLines.length, max);
	if (hidden > 0) {
		lines.push(`${indent}${quote} ${theme.fg("dim", `… +${hidden} more ${hidden === 1 ? "line" : "lines"}`)}`);
	}
	return lines;
}
