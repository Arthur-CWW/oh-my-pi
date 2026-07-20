import type { CompactionSettings } from "@oh-my-pi/pi-agent-core/compaction";
import { effectiveReserveTokens, estimateTokens, resolveThresholdTokens } from "@oh-my-pi/pi-agent-core/compaction";
import type { Model } from "@oh-my-pi/pi-ai";
import { isZodSchema, zodToWireSchema } from "@oh-my-pi/pi-ai/utils/schema";
import { countTokens } from "@oh-my-pi/pi-natives";
import { formatNumber } from "@oh-my-pi/pi-utils";
import type { Skill } from "../../extensibility/skills";
import type { AgentSession } from "../../session/agent-session";
import { estimateInlineSavings, type SnapcompactSavingsEstimate } from "../../session/snapcompact-inline";
import type { Tool } from "../../tools";
import { formatContextWindow } from "../components/status-line/context-thresholds";
import type { theme as Theme } from "../theme/theme";

const GRID_COLS = 20;
const GRID_ROWS = 10;
const GRID_CELLS = GRID_COLS * GRID_ROWS;
const GRID_GUTTER = "   ";

const CELL_FILLED = "⛁";
const CELL_FILLED_MESSAGES = "⛃";
const CELL_FREE = "⛶";
const CELL_BUFFER = "⛝";

type CategoryId = "systemPrompt" | "systemContext" | "systemTools" | "skills" | "messages";

interface CategoryInfo {
	id: CategoryId;
	label: string;
	tokens: number;
	color: "accent" | "warning" | "success" | "userMessageText" | "customMessageLabel";
	glyph: string;
}

export interface ContextBreakdown {
	model: Model | undefined;
	contextWindow: number;
	categories: CategoryInfo[];
	/**
	 * Provider-anchored current context tokens — the authoritative numerator,
	 * identical to `session.getContextUsage()`, the status line, and collab. When
	 * the provider anchor is unknown (post-compaction, before the next response)
	 * `percent` is null and this holds the retained-text estimate as a numeric
	 * stand-in for downstream consumers; render surfaces key off `percent === null`
	 * to show the "unknown" state.
	 */
	usedTokens: number;
	/**
	 * Provider-anchored usage percent (reported honestly past 100% when the
	 * provider genuinely exceeds the window), or null when unknown.
	 */
	percent: number | null;
	autoCompactBufferTokens: number;
	/** Provider-anchored free space (window − used − buffer, floored at 0). */
	freeTokens: number;
	/**
	 * Sum of the per-category retained-text estimates. An estimate of transcript
	 * size, never the authoritative used/free/compaction basis — it can diverge
	 * sharply from `usedTokens` (cache reuse, provider-side counting).
	 */
	estimatedRetainedTokens: number;
	/** Estimated snapcompact wire savings; set when requested and a snapcompact.* setting is enabled. */
	snapcompact?: SnapcompactSavingsEstimate;
}

const EMPTY_STRING_PARTS: readonly string[] = [];
const EMPTY_TOOLS: ReadonlyArray<Pick<Tool, "name" | "description" | "parameters">> = [];

export function estimateSkillsTokens(skills: readonly Skill[]): number {
	const fragments: string[] = [];
	for (const skill of skills) {
		// "- name: description\n" wire framing tokenizes ~identically to the
		// concatenated form, so encode each piece separately and sum.
		fragments.push(skill.name, skill.description);
	}
	return countTokens(fragments);
}

export function estimateToolSchemaTokens(
	tools: ReadonlyArray<Pick<Tool, "name" | "description" | "parameters">>,
): number {
	const fragments: string[] = [];
	for (const tool of tools) {
		fragments.push(tool.name, tool.description);
		try {
			const params = tool.parameters;
			fragments.push(JSON.stringify((isZodSchema(params) ? zodToWireSchema(params) : params) ?? {}));
		} catch {
			// Schema may contain functions or cycles; ignore.
		}
	}
	return countTokens(fragments);
}

/**
 * Compute just the NON-MESSAGE token total: system prompt (with its skills
 * section subtracted, since skills are tokenized separately) + system context
 * (the rest of the system-prompt array) + tools + skills.
 *
 * Exposed so callers like `StatusLineComponent` can cache the non-message
 * total separately from the message total. Non-message inputs (skills,
 * tools, system prompt) change rarely; the message list grows on every
 * streaming turn. Splitting the two lets the caller refresh each on its own
 * cadence — non-message recomputed only when the inputs identity changes,
 * messages walked incrementally as new entries append.
 */
export function computeNonMessageTokens(session: AgentSession): number {
	const systemPromptParts = session.systemPrompt ?? EMPTY_STRING_PARTS;
	const tools = session.agent?.state?.tools ?? EMPTY_TOOLS;
	return countTokens(systemPromptParts) + estimateToolSchemaTokens(tools);
}

/**
 * Shared helper for the four non-message token totals in the /context panel's
 * retained-text estimate. These per-category counts are ESTIMATES only: the
 * panel's headline used/percent/free numbers and the status line both come from
 * the provider-anchored `session.getContextUsage()`, not from this sum.
 * `computeNonMessageTokens` (the collapsed form) exists for the session's own
 * provider-usage accounting and compaction sizing — it is not what the status
 * line renders.
 */
function computeNonMessageBreakdown(session: AgentSession): {
	skillsTokens: number;
	toolsTokens: number;
	systemContextTokens: number;
	systemPromptTokens: number;
} {
	const skillsTokens = estimateSkillsTokens(session.skills ?? []);
	const toolsTokens = estimateToolSchemaTokens(session.agent?.state?.tools ?? []);
	const systemPromptParts = session.systemPrompt ?? [];
	const systemContextTokens = countTokens(systemPromptParts.slice(1));
	const systemPromptTokens = Math.max(0, countTokens(systemPromptParts[0] ?? "") - skillsTokens);
	return { skillsTokens, toolsTokens, systemContextTokens, systemPromptTokens };
}

/**
 * Compute a breakdown of estimated context usage by category for the active
 * session and model.
 */
export function computeContextBreakdown(
	session: AgentSession,
	options?: { snapcompactSavings?: boolean },
): ContextBreakdown {
	const model = session.model;
	const contextWindow = model?.contextWindow ?? 0;

	let messagesTokens = 0;
	const convo = session.messages;
	if (convo) {
		for (const message of convo) {
			messagesTokens += estimateTokens(message);
		}
	}

	// The rendered system prompt already contains the skill descriptions and the
	// markdown tool descriptions. To present a non-overlapping breakdown:
	//   System prompt = total system prompt text - skills section (tool descriptions stay)
	//   Tools         = JSON tool schema sent separately on the wire
	//   Skills        = the skill list embedded in the system prompt
	//   Messages      = conversation messages
	const { skillsTokens, toolsTokens, systemContextTokens, systemPromptTokens } = computeNonMessageBreakdown(session);

	const categories: CategoryInfo[] = [
		{ id: "systemPrompt", label: "System prompt", tokens: systemPromptTokens, color: "accent", glyph: CELL_FILLED },
		{ id: "systemTools", label: "System tools", tokens: toolsTokens, color: "warning", glyph: CELL_FILLED },
		{
			id: "systemContext",
			label: "System context",
			tokens: systemContextTokens,
			color: "customMessageLabel",
			glyph: CELL_FILLED,
		},
		{ id: "skills", label: "Skills", tokens: skillsTokens, color: "success", glyph: CELL_FILLED },
		{
			id: "messages",
			label: "Messages",
			tokens: messagesTokens,
			color: "userMessageText",
			glyph: CELL_FILLED_MESSAGES,
		},
	];

	const estimatedRetainedTokens = categories.reduce((sum, c) => sum + c.tokens, 0);

	// Authoritative current-context numerator: the provider-anchored count from
	// session.getContextUsage(), shared verbatim with the status line and collab.
	// `undefined` => no anchor (degraded/model-less session): fall back to the
	// retained-text estimate. `tokens === null` => count is unknown right after
	// compaction and must stay unknown, so keep the estimate as a numeric
	// stand-in for downstream consumers but report `percent: null`.
	const usage = session.getContextUsage();
	const usageUnknown = usage !== undefined && usage.tokens === null;
	const usedTokens = usage?.tokens ?? estimatedRetainedTokens;
	const percent = usageUnknown ? null : contextWindow > 0 ? (usedTokens / contextWindow) * 100 : null;

	let autoCompactBufferTokens = 0;
	if (contextWindow > 0) {
		const compactionSettings = session.settings.getGroup("compaction") as CompactionSettings;
		if (compactionSettings.enabled && compactionSettings.strategy !== "off") {
			const threshold = resolveThresholdTokens(contextWindow, compactionSettings);
			autoCompactBufferTokens = Math.max(0, contextWindow - threshold);
		} else {
			autoCompactBufferTokens = 0;
		}
		// Even when fully disabled, fall back to a sensible reserve floor for display.
		if (autoCompactBufferTokens === 0 && compactionSettings.enabled) {
			autoCompactBufferTokens = effectiveReserveTokens(contextWindow, compactionSettings);
		}
	}
	autoCompactBufferTokens = Math.min(
		autoCompactBufferTokens,
		Math.max(0, contextWindow - (usageUnknown ? 0 : usedTokens)),
	);

	const freeTokens = Math.max(0, contextWindow - usedTokens - autoCompactBufferTokens);

	// Estimated wire savings from snapcompact inline imaging. Opt-in: only the
	// /context surfaces need it; other callers skip the extra token counting.
	let snapcompactSavings: SnapcompactSavingsEstimate | undefined;
	if (options?.snapcompactSavings) {
		const renderSystemPrompt = session.settings.get("snapcompact.systemPrompt");
		const renderToolResults = session.settings.get("snapcompact.toolResults");
		if (renderSystemPrompt !== "none" || renderToolResults) {
			snapcompactSavings = estimateInlineSavings({
				options: { renderSystemPrompt, renderToolResults, shape: session.settings.get("snapcompact.shape") },
				model,
				systemPrompt: session.systemPrompt ?? [],
				messages: session.messages ?? [],
			});
		}
	}

	return {
		model,
		contextWindow,
		categories,
		usedTokens,
		percent,
		autoCompactBufferTokens,
		freeTokens,
		estimatedRetainedTokens,
		snapcompact: snapcompactSavings,
	};
}

interface CellSpec {
	glyph: string;
	color: "accent" | "warning" | "success" | "userMessageText" | "customMessageLabel" | "muted" | "dim";
}

function planCells(breakdown: ContextBreakdown): CellSpec[] {
	const cells: CellSpec[] = [];
	const window = breakdown.contextWindow;

	if (window <= 0) {
		for (let i = 0; i < GRID_CELLS; i++) {
			cells.push({ glyph: CELL_FREE, color: "dim" });
		}
		return cells;
	}

	const tokensPerCell = window / GRID_CELLS;
	const ratioCells = (tokens: number): number => {
		if (tokens <= 0) return 0;
		return Math.max(1, Math.round(tokens / tokensPerCell));
	};

	// Anchor the used region on the authoritative provider count, not the
	// category-estimate sum, so the grid can never contradict the headline
	// summary (e.g. a 557K retained-text estimate against 62.8% real usage).
	let bufferCount = ratioCells(breakdown.autoCompactBufferTokens);
	let usedCount = ratioCells(breakdown.usedTokens);
	if (usedCount + bufferCount > GRID_CELLS) {
		usedCount = Math.max(0, GRID_CELLS - bufferCount);
		if (usedCount + bufferCount > GRID_CELLS) {
			bufferCount = Math.max(0, GRID_CELLS - usedCount);
		}
	}

	// Sub-divide the used region by each category's share of the retained-text
	// estimate, preserving the per-category colors within the honest total.
	const categoryTokenTotal = breakdown.categories.reduce((sum, c) => sum + c.tokens, 0);
	for (const { category, count } of distributeCells(breakdown.categories, usedCount, categoryTokenTotal)) {
		for (let i = 0; i < count; i++) {
			cells.push({ glyph: category.glyph, color: category.color });
		}
	}
	// Provider reports usage but the estimate has no category tokens: still fill
	// the used region so the grid reflects the authoritative total.
	while (cells.length < usedCount) {
		cells.push({ glyph: CELL_FILLED, color: "accent" });
	}

	const freeCount = Math.max(0, GRID_CELLS - cells.length - bufferCount);
	for (let i = 0; i < freeCount; i++) {
		cells.push({ glyph: CELL_FREE, color: "dim" });
	}
	for (let i = 0; i < bufferCount; i++) {
		cells.push({ glyph: CELL_BUFFER, color: "warning" });
	}

	// Pad to exactly GRID_CELLS in case rounding undershot.
	while (cells.length < GRID_CELLS) {
		cells.push({ glyph: CELL_FREE, color: "dim" });
	}
	return cells.slice(0, GRID_CELLS);
}

/**
 * Distribute `totalCells` grid cells across categories proportional to each
 * category's share of `totalTokens`, using largest-remainder rounding so the
 * counts sum to exactly `totalCells`.
 */
function distributeCells(
	categories: CategoryInfo[],
	totalCells: number,
	totalTokens: number,
): { category: CategoryInfo; count: number }[] {
	const result = categories.map(category => ({ category, count: 0, remainder: 0 }));
	if (totalCells <= 0 || totalTokens <= 0) return result;
	let assigned = 0;
	for (const entry of result) {
		const exact = (entry.category.tokens / totalTokens) * totalCells;
		entry.count = Math.floor(exact);
		entry.remainder = exact - entry.count;
		assigned += entry.count;
	}
	let leftover = totalCells - assigned;
	const byRemainder = [...result].sort((a, b) => b.remainder - a.remainder);
	for (let i = 0; leftover > 0 && i < byRemainder.length; i++, leftover--) {
		byRemainder[i]!.count += 1;
	}
	// Residual (all-equal remainders / single category) lands on the first entry.
	while (leftover > 0 && result.length > 0) {
		result[0]!.count += 1;
		leftover -= 1;
	}
	return result;
}

function percentString(part: number, whole: number, fractionDigits = 1): string {
	if (whole <= 0) return "0%";
	const pct = (part / whole) * 100;
	if (pct > 0 && pct < 0.05) return "<0.1%";
	return `${pct.toFixed(fractionDigits)}%`;
}

function buildLegendLines(breakdown: ContextBreakdown, theme: typeof Theme): string[] {
	const lines: string[] = [];
	const {
		model,
		contextWindow,
		categories,
		usedTokens,
		autoCompactBufferTokens,
		freeTokens,
		estimatedRetainedTokens,
		percent,
	} = breakdown;
	const usageUnknown = percent === null;

	const modelName = model?.name ?? model?.id ?? "no model";
	const modelId = model?.id ?? "unknown";
	const windowLabel = formatNumber(contextWindow).toLowerCase();
	const modelWindowLabel = model?.codex?.contextWindowSource
		? formatContextWindow(contextWindow, model.codex.contextWindowSource)
		: windowLabel;

	lines.push(theme.bold(`${modelName}`) + theme.fg("dim", ` (${modelWindowLabel} context)`));
	lines.push(theme.fg("muted", `${modelId}[${windowLabel}]`));
	// Authoritative current context — the provider-anchored numerator shared with
	// the status line and collab. Unknown right after compaction until the next
	// response, and reported honestly even past 100% when the provider says so.
	if (usageUnknown) {
		lines.push(
			`${theme.bold(theme.fg("muted", "unknown"))}${theme.fg("dim", `/${windowLabel} tokens`)}` +
				theme.fg("muted", " (unknown until next response)"),
		);
	} else {
		lines.push(
			`${theme.bold(formatNumber(usedTokens))}${theme.fg("dim", `/${windowLabel} tokens`)}` +
				theme.fg("muted", ` (${percentString(usedTokens, contextWindow)})`),
		);
	}
	lines.push("");
	lines.push(theme.fg("muted", "Retained-text estimate by category"));

	for (const category of categories) {
		const dot = theme.fg(category.color, category.glyph);
		const label = category.label;
		const tokens = formatNumber(category.tokens);
		const pct = percentString(category.tokens, contextWindow);
		lines.push(`${dot} ${label}: ${theme.bold(tokens)} ${theme.fg("dim", `tokens (${pct})`)}`);
	}

	// The category sum is an ESTIMATE of retained transcript text, deliberately
	// separate from the provider-anchored current context above — the two can
	// diverge sharply (cache reuse, provider-side counting).
	lines.push(
		`${theme.fg("dim", CELL_FILLED)} Retained-text estimate: ${theme.bold(formatNumber(estimatedRetainedTokens))} ${theme.fg(
			"dim",
			`tokens (${percentString(estimatedRetainedTokens, contextWindow)})`,
		)}`,
	);

	const freeDot = theme.fg("dim", CELL_FREE);
	if (usageUnknown) {
		lines.push(`${freeDot} Free space: ${theme.bold(theme.fg("muted", "unknown"))}`);
	} else {
		lines.push(
			`${freeDot} Free space: ${theme.bold(formatNumber(freeTokens))} ${theme.fg("dim", `(${percentString(freeTokens, contextWindow)})`)}`,
		);
	}

	if (autoCompactBufferTokens > 0) {
		const bufferDot = theme.fg("warning", CELL_BUFFER);
		lines.push(
			`${bufferDot} Autocompact buffer: ${theme.bold(formatNumber(autoCompactBufferTokens))} ${theme.fg(
				"dim",
				`tokens (${percentString(autoCompactBufferTokens, contextWindow)})`,
			)}`,
		);
	}

	const snap = breakdown.snapcompact;
	if (snap) {
		lines.push("");
		if (!snap.visionCapable) {
			lines.push(theme.fg("muted", "Snapcompact: inactive (model has no image input)"));
		} else {
			lines.push(theme.fg("muted", "Snapcompact (estimated wire savings)"));
			if (snap.systemPrompt) {
				const sp = snap.systemPrompt;
				if (sp.applied) {
					lines.push(
						`  System prompt (${sp.scope === "agents-md" ? "AGENTS.md" : "all"}): saves ${theme.bold(`~${formatNumber(sp.savedTokens)}`)} ` +
							theme.fg(
								"dim",
								`(${formatNumber(sp.textTokens)} text → ${sp.frames} frame${sp.frames === 1 ? "" : "s"} ≈ ${formatNumber(sp.imageTokens)})`,
							),
					);
				} else {
					const reason =
						sp.reason === "budget"
							? "image budget exhausted"
							: sp.reason === "empty"
								? "nothing to image"
								: "frames would not save tokens";
					lines.push(
						`  System prompt (${sp.scope === "agents-md" ? "AGENTS.md" : "all"}): ${theme.fg("dim", `stays text (${reason})`)}`,
					);
				}
			}
			if (snap.toolResults) {
				const tr = snap.toolResults;
				if (tr.swapped > 0) {
					lines.push(
						`  Tool results: saves ${theme.bold(`~${formatNumber(tr.savedTokens)}`)} ` +
							theme.fg(
								"dim",
								`(${tr.swapped}/${tr.total} imaged, ${formatNumber(tr.textTokens)} text → ${tr.frames} frames ≈ ${formatNumber(tr.imageTokens)})`,
							),
					);
				} else {
					lines.push(`  Tool results: ${theme.fg("dim", `none imaged (${tr.total} in history)`)}`);
				}
			}
			if (snap.savedTokens > 0) {
				lines.push(
					`  Next request: ${theme.bold(`~${formatNumber(Math.max(0, usedTokens - snap.savedTokens))}`)} ${theme.fg("dim", "tokens on the wire")}`,
				);
			}
		}
	}

	return lines;
}

/**
 * Render a colorful context-usage panel as ANSI text. Output is a series of
 * lines pairing the grid (left) with the legend (right).
 */
export function renderContextUsage(breakdown: ContextBreakdown, theme: typeof Theme): string {
	if (breakdown.contextWindow <= 0) {
		return theme.fg("muted", "Context usage is unavailable: no model is selected for this session.");
	}

	const cells = planCells(breakdown);
	const legend = buildLegendLines(breakdown, theme);

	const totalLines = Math.max(GRID_ROWS, legend.length);
	const lines: string[] = [];

	for (let row = 0; row < totalLines; row++) {
		let gridSegment = "";
		if (row < GRID_ROWS) {
			const rowCells: string[] = [];
			for (let col = 0; col < GRID_COLS; col++) {
				const cell = cells[row * GRID_COLS + col];
				rowCells.push(theme.fg(cell.color, cell.glyph));
			}
			gridSegment = rowCells.join(" ");
		} else {
			// Pad with blanks the same visible width as a grid row so legend lines
			// past the grid stay aligned with their column.
			const blank = " ".repeat(GRID_COLS * 2 - 1);
			gridSegment = blank;
		}

		const legendSegment = legend[row] ?? "";
		const line = legendSegment.length > 0 ? `${gridSegment}${GRID_GUTTER}${legendSegment}` : gridSegment;
		lines.push(line);
	}

	return lines.join("\n");
}
