/**
 * Output container with an unframed heading and indented content sections.
 */
import type { Component } from "@oh-my-pi/pi-tui";
import { ImageProtocol, padding, sliceWithWidth, TERMINAL, visibleWidth, wrapTextWithAnsi } from "@oh-my-pi/pi-tui";
import type { Theme, ThemeColor } from "../modes/theme/theme";
import { getSixelLineMask } from "../utils/sixel";
import type { State } from "./types";
import type { RenderCache } from "./utils";
import { getStateBgColor, Hasher, padToWidth, truncateToWidth } from "./utils";

export interface OutputBlockOptions {
	header?: string;
	headerMeta?: string;
	state?: State;
	sections?: Array<{ label?: string; lines: readonly string[]; separator?: boolean }>;
	width: number;
	applyBg?: boolean;
	contentPaddingLeft?: number;
	/** Retained for caller compatibility. Output blocks are unframed, so this no
	 * longer selects a border color and does not affect rendering. */
	borderColor?: ThemeColor;
}

const FRAMED_BLOCK_COMPONENT = Symbol("framedBlockComponent");

export type FramedBlockComponent = Component & { [FRAMED_BLOCK_COMPONENT]?: true };

export function markFramedBlockComponent<T extends Component>(component: T): T & FramedBlockComponent {
	(component as T & FramedBlockComponent)[FRAMED_BLOCK_COMPONENT] = true;
	return component as T & FramedBlockComponent;
}

export function isFramedBlockComponent(component: Component): boolean {
	return (component as FramedBlockComponent)[FRAMED_BLOCK_COMPONENT] === true;
}

type BlockRow =
	| { kind: "heading"; label: string }
	| { kind: "blank" }
	| { kind: "content"; inner: string }
	| { kind: "sixel"; raw: string };

function normalizeContentPaddingLeft(value: number | undefined): number {
	if (value === undefined || !Number.isFinite(value)) return 1;
	return Math.max(0, Math.floor(value));
}

const HEADING_ELLIPSIS = "…";

/**
 * Fit a heading — a status prefix followed by a semantic identifier such as a
 * file path — into `width`. When the label already fits it is returned
 * untouched, so a wide terminal renders the identifier (e.g. a full file path)
 * in full. When it overflows, the label is shortened from the MIDDLE via
 * ANSI-safe head + tail slices joined by an ellipsis, so the leading
 * status/prefix AND the trailing basename/suffix stay visible instead of the
 * plain end-truncation that silently dropped the basename. The result is always
 * bounded to `width` visible columns.
 */
function shortenHeadingToWidth(label: string, width: number): string {
	if (width <= 0) return "";
	const total = visibleWidth(label);
	if (total <= width) return label;
	// Too narrow to keep head + ellipsis + tail meaningfully apart: fall back to
	// plain end-truncation (which still appends its own ellipsis).
	if (width <= 2) return truncateToWidth(label, width);
	const budget = width - 1; // reserve one column for the ellipsis glyph
	// Split the budget evenly, giving any odd column to the tail so the
	// basename/suffix side is never the shorter half.
	const headWidth = Math.floor(budget / 2);
	const tailWidth = budget - headWidth;
	const head = sliceWithWidth(label, 0, headWidth, true).text;
	const tail = sliceWithWidth(label, total - tailWidth, tailWidth, true).text;
	return `${head}${HEADING_ELLIPSIS}${tail}`;
}

export function renderOutputBlock(options: OutputBlockOptions, theme: Theme): string[] {
	const { header, headerMeta, state, sections = [], width, applyBg = true } = options;
	const lineWidth = Math.max(0, width);
	const bgFn = (() => {
		if (!state || !applyBg) return undefined;
		const bgAnsi = theme.getBgAnsi(getStateBgColor(state));
		// Keep block background stable even if inner content contains SGR resets (e.g. "\x1b[0m"),
		// which would otherwise clear the outer background mid-line.
		return (text: string) => {
			const stabilized = text
				.replace(/\x1b\[(?:0)?m/g, m => `${m}${bgAnsi}`)
				.replace(/\x1b\[49m/g, m => `${m}${bgAnsi}`);
			return `${bgAnsi}${stabilized}\x1b[49m`;
		};
	})();

	const contentPaddingLeft = normalizeContentPaddingLeft(options.contentPaddingLeft);
	const contentWidth = Math.max(0, lineWidth - contentPaddingLeft);
	const contentLeftPadding = contentPaddingLeft > 0 ? padding(contentPaddingLeft) : "";

	// Layout pass: collect row descriptors before emitting the unframed lines.
	const rows: BlockRow[] = [];
	const headerLabel = [header, headerMeta].filter(Boolean).join(theme.sep.dot);
	if (headerLabel) {
		rows.push({ kind: "heading", label: headerLabel });
	}

	const normalizedSections = sections.length > 0 ? sections : [{ lines: [] as string[] }];
	for (let sectionIndex = 0; sectionIndex < normalizedSections.length; sectionIndex++) {
		const section = normalizedSections[sectionIndex]!;
		// A labeled section draws its heading. A label-less section can still
		// request a blank divider via `separator`, but only between sections —
		// leading with one would just pad the top.
		if (section.label) {
			rows.push({ kind: "heading", label: section.label });
		} else if (section.separator && sectionIndex > 0) {
			rows.push({ kind: "blank" });
		}
		const allLines = section.lines.flatMap(l => l.split("\n"));
		const sixelLineMask = TERMINAL.imageProtocol === ImageProtocol.Sixel ? getSixelLineMask(allLines) : undefined;
		for (let lineIndex = 0; lineIndex < allLines.length; lineIndex++) {
			const line = allLines[lineIndex]!;
			if (sixelLineMask?.[lineIndex]) {
				rows.push({ kind: "sixel", raw: line });
				continue;
			}
			const wrappedLines = wrapTextWithAnsi(line.trimEnd(), contentWidth);
			for (const wrappedLine of wrappedLines) {
				const innerPadding = padding(Math.max(0, contentWidth - visibleWidth(wrappedLine)));
				rows.push({ kind: "content", inner: `${wrappedLine}${innerPadding}` });
			}
		}
	}

	const renderHeading = (label: string): string => shortenHeadingToWidth(label, lineWidth);
	const renderContent = (inner: string): string => `${contentLeftPadding}${inner}`;

	const lines: string[] = [];
	for (const row of rows) {
		if (row.kind === "sixel") {
			lines.push(row.raw);
			continue;
		}
		const line =
			row.kind === "heading" ? renderHeading(row.label) : row.kind === "blank" ? "" : renderContent(row.inner);
		lines.push(padToWidth(line, lineWidth, bgFn));
	}

	return lines;
}

/**
 * Cached wrapper around `renderOutputBlock`.
 *
 * Since output blocks are re-rendered on every frame (via `render(width)` closures),
 * but their content rarely changes, this cache avoids redundant `visibleWidth()` and
 * `padding()` computations on ~99% of render calls.
 */
export class CachedOutputBlock {
	#cache?: RenderCache;

	/** Render with caching. Returns the cached (shared, caller-immutable) lines if options haven't changed. */
	render(options: OutputBlockOptions, theme: Theme): readonly string[] {
		const key = this.#buildKey(options);
		if (this.#cache?.key === key) return this.#cache.lines;
		const lines = renderOutputBlock(options, theme);
		this.#cache = { key, lines };
		return lines;
	}

	/** Invalidate the cache, forcing a rebuild on next render. */
	invalidate(): void {
		this.#cache = undefined;
	}

	#buildKey(options: OutputBlockOptions): bigint {
		const h = new Hasher();
		h.u32(options.width);
		h.u32(normalizeContentPaddingLeft(options.contentPaddingLeft));
		h.optional(options.header);
		h.optional(options.headerMeta);
		h.optional(options.state);
		h.optional(options.borderColor);
		h.bool(options.applyBg ?? true);
		if (options.sections) {
			for (const s of options.sections) {
				h.optional(s.label);
				h.bool(s.separator ?? false);
				for (const line of s.lines) {
					h.str(line);
				}
			}
		}
		return h.digest();
	}
}

/**
 * Build a self-framing tool component backed by a cached output block. The
 * `build` callback returns the block options for a given width; the cache
 * dedupes re-renders.
 */
export function framedBlock(theme: Theme, build: (width: number) => OutputBlockOptions): Component {
	const block = new CachedOutputBlock();
	// Marked so the tool-execution container treats it as self-framing (renders
	// flush, no extra padding/background) the same way `markFramedBlockComponent`
	// blocks are treated.
	return markFramedBlockComponent({
		render: (width: number): readonly string[] => block.render(build(width), theme),
		invalidate: () => block.invalidate(),
	});
}
