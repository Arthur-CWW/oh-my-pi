/**
 * Shared chrome for fullscreen overlays (the `/copy` picker, the plan-review
 * overlay, …). Frames render as plain headings, blank separators and spaces;
 * only the middle `│` divider between two simultaneously-rendered columns is
 * retained.
 */
import { padding, truncateToWidth, visibleWidth } from "@oh-my-pi/pi-tui";
import { theme } from "../theme/theme";

/** Pad or truncate a (possibly ANSI-styled) string to exactly `width` columns. */
export function fit(text: string, width: number): string {
	if (width <= 0) return "";
	const w = visibleWidth(text);
	if (w === width) return text;
	if (w < width) return text + padding(width - w);
	const cut = truncateToWidth(text, width);
	const cw = visibleWidth(cut);
	return cw < width ? cut + padding(width - cw) : cut;
}

function paint(s: string): string {
	return theme.fg("border", s);
}

/** A heading line carrying the title (no frame chrome). */
export function topBorder(width: number, title: string): string {
	if (!title) return "";
	return fit(theme.bold(theme.fg("accent", ` ${title}`)), width);
}

/** A blank line separating overlay sections. */
export function divider(width: number): string {
	return fit("", width);
}

/** A blank line closing the overlay (no frame chrome). */
export function bottomBorder(width: number): string {
	return fit("", width);
}

/** Content row with a two-column left inset (no frame sides). */
export function row(content: string, width: number): string {
	return `  ${fit(content, Math.max(0, width - 4))}`;
}

/** Body content width for a two-column overlay of total `width`. */
export function splitBodyWidth(width: number, sidebarWidth: number): number {
	return Math.max(0, width - sidebarWidth - 7);
}

/**
 * A two-column content row `  sidebar │ body`: the middle `│` is the retained
 * inter-column divider; the outer frame sides become spaces so the
 * sidebar/divider/body column positions match {@link splitBodyWidth}.
 */
export function splitRow(sidebar: string, body: string, width: number, sidebarWidth: number): string {
	const box = theme.boxSharp;
	const bodyWidth = splitBodyWidth(width, sidebarWidth);
	const bar = paint(box.vertical);
	return `  ${fit(sidebar, sidebarWidth)} ${bar} ${fit(body, bodyWidth)}`;
}
