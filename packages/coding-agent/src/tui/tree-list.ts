/**
 * Hierarchical tree list rendering helper.
 */

import { replaceTabs } from "@oh-my-pi/pi-tui";
import type { Theme } from "../modes/theme/theme";
import { formatMoreItems } from "../tools/render-utils";
import type { TreeContext } from "./types";

export interface TreeListOptions<T> {
	items: T[];
	expanded?: boolean;
	maxCollapsed?: number;
	/** Strict total-line budget for collapsed mode. When set (and not expanded),
	 *  rendered item lines plus the trailing summary line must fit within this budget.
	 */
	maxCollapsedLines?: number;
	itemType?: string;
	truncateFrom?: "start" | "end";
	/** Called once per item with `isLast: false` during budget calculation;
	 *  line count MUST NOT vary based on `isLast`. */
	renderItem: (item: T, context: TreeContext) => string | string[];
}

/** Fixed left indent for list items and the "+N more" summary line. Replaces
 *  the former tree-branch prefix (├─ / └─, 3 columns) with plain spaces of the
 *  same width, so rendered lists copy cleanly without leading box glyphs. */
const ITEM_INDENT = "   ";

export function renderTreeList<T>(options: TreeListOptions<T>, theme: Theme): string[] {
	const {
		items,
		expanded = false,
		maxCollapsed = 8,
		maxCollapsedLines,
		itemType = "item",
		truncateFrom = "end",
		renderItem,
	} = options;
	const maxItems = expanded ? items.length : Math.min(items.length, maxCollapsed);
	const linesBudget = !expanded && maxCollapsedLines !== undefined ? maxCollapsedLines : Infinity;

	const candidateIndices: number[] = [];
	if (truncateFrom === "start") {
		const startCandidateIdx = Math.max(0, items.length - maxItems);
		for (let i = startCandidateIdx; i < items.length; i++) {
			candidateIndices.push(i);
		}
	} else {
		for (let i = 0; i < maxItems; i++) {
			candidateIndices.push(i);
		}
	}

	// Pre-render each candidate item once.
	// isLast cannot be known at this point (fittingCount is not yet determined);
	// renderItem implementations MUST NOT vary line count based on isLast.
	const preRendered: string[][] = [];
	for (let i = 0; i < candidateIndices.length; i++) {
		const itemIdx = candidateIndices[i];
		const rendered = renderItem(items[itemIdx], {
			index: itemIdx,
			isLast: false,
			depth: 0,
			theme,
			prefix: "",
			continuePrefix: "",
		});
		preRendered.push(Array.isArray(rendered) ? rendered : rendered ? [rendered] : []);
	}

	let displayedSlice: { start: number; end: number };
	let remaining: number;
	let fittedLineCount = 0;

	if (truncateFrom === "start") {
		let fittingCount = candidateIndices.length;
		if (linesBudget !== Infinity) {
			fittingCount = 0;
			for (let i = candidateIndices.length - 1; i >= 0; i--) {
				const count = preRendered[i].length;
				const remainingBefore = candidateIndices[i];
				const reservedSummaryLines = remainingBefore > 0 ? 1 : 0;
				if (fittedLineCount + count + reservedSummaryLines > linesBudget) break;
				fittedLineCount += count;
				fittingCount++;
			}
		}
		const start = candidateIndices.length - fittingCount;
		displayedSlice = { start, end: candidateIndices.length };
		remaining = candidateIndices.length > 0 ? candidateIndices[start] : 0;
	} else {
		let fittingCount = candidateIndices.length;
		if (linesBudget !== Infinity) {
			fittingCount = 0;
			for (let i = 0; i < candidateIndices.length; i++) {
				const count = preRendered[i].length;
				const remainingAfter = items.length - (i + 1);
				const reservedSummaryLines = remainingAfter > 0 ? 1 : 0;
				if (fittedLineCount + count + reservedSummaryLines > linesBudget) break;
				fittedLineCount += count;
				fittingCount = i + 1;
			}
		}
		displayedSlice = { start: 0, end: fittingCount };
		remaining = items.length - fittingCount;
	}

	const hasSummary = !expanded && remaining > 0 && (linesBudget === Infinity || fittedLineCount < linesBudget);

	// Emit pre-rendered content with a fixed indent — no tree-branch glyphs, so
	// the list copies cleanly while indentation still conveys grouping.
	const lines: string[] = [];

	if (truncateFrom === "start" && hasSummary) {
		lines.push(`${ITEM_INDENT}${theme.fg("muted", formatMoreItems(remaining, itemType))}`);
	}

	for (let i = displayedSlice.start; i < displayedSlice.end; i++) {
		const itemLines = preRendered[i]!;
		if (itemLines.length === 0) continue;
		for (const itemLine of itemLines) {
			lines.push(`${ITEM_INDENT}${replaceTabs(itemLine)}`);
		}
	}

	if (truncateFrom === "end" && hasSummary) {
		lines.push(`${ITEM_INDENT}${theme.fg("muted", formatMoreItems(remaining, itemType))}`);
	}

	return lines;
}
