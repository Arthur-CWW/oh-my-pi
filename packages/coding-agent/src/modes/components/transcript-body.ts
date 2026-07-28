import { renderInlineMarkdown, wrapTextWithAnsi } from "@oh-my-pi/pi-tui";
import { replaceTabs, truncateToWidth } from "../../tools/render-utils";
import { Ellipsis } from "../../tui";
import { getMarkdownTheme, type Theme } from "../theme/theme";
import { DEFAULT_TRANSCRIPT_DISPLAY_CONTEXT, type TranscriptDisplayContext } from "../transcript-display";
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
		width?: number;
		transcriptDisplay?: TranscriptDisplayContext;
	} = {},
): string[] {
	const indent = options.indent ?? "";
	const tone = options.tone ?? "toolOutput";
	const max = expanded ? BODY_LINES_EXPANDED : (options.collapsedLines ?? BODY_LINES_COLLAPSED);
	const logicalLines = body.split("\n").filter(line => line.trim());
	const display = options.transcriptDisplay ?? DEFAULT_TRANSCRIPT_DISPLAY_CONTEXT;
	const quote = theme.fg("dim", theme.md.quoteBorder);
	const bodyWidth = Math.max(1, (options.width ?? BODY_LINE_WIDTH) - indent.length - 2);
	const renderLine = (line: string): string[] => {
		const normalized = replaceTabs(line.trim());
		const styled = display.richTranscript
			? renderInlineMarkdown(normalized, getMarkdownTheme(theme), text => theme.fg(tone, text))
			: theme.fg(tone, normalized);
		if (!display.transcriptWrap) {
			return [truncateToWidth(styled, bodyWidth, Ellipsis.Unicode)];
		}
		return wrapTextWithAnsi(styled, bodyWidth);
	};
	const sourceLines = logicalLines.slice(0, max).flatMap(renderLine);
	const lines = sourceLines.map(line => `${indent}${quote} ${line}`);
	const hidden = logicalLines.length - Math.min(logicalLines.length, max);
	if (hidden > 0) {
		const hiddenText = `… +${hidden} more ${hidden === 1 ? "line" : "lines"}`;
		lines.push(`${indent}${quote} ${theme.fg("dim", truncateToWidth(hiddenText, bodyWidth, Ellipsis.Unicode))}`);
	}
	return lines;
}
