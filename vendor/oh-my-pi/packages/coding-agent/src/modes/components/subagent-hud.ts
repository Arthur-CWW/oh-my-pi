import { padding, visibleWidth } from "@oh-my-pi/pi-tui";
import { formatTaskId } from "../../task/render";
import { replaceTabs, truncateToWidth } from "../../tools/render-utils";
import type { ObservableSession } from "../session-observer-registry";
import { theme, type Theme } from "../theme/theme";
import { renderModelSelectorAbbreviation, withModelSelectorEffort } from "./model-selector-abbreviation";

interface CachedRow {
	columns: number;
	fingerprint: string;
	generation: number;
	row: string;
}

type HudStatus = "streaming" | "starting" | "stalled" | "failed" | "canceled" | "done";

interface HudRow {
	session: ObservableSession;
	prefix: string;
	displayId: string;
	description?: string;
	task?: string;
	modelSelector?: string;
	tokenRate?: number;
	status: HudStatus;
}

interface TokenProgress {
	tokens: number;
	at: number;
}

export interface SubagentHudPerformanceCounters {
	rowRebuilds: number;
}

function shortAgentId(id: string): string {
	const separator = id.lastIndexOf(".");
	return formatTaskId(separator >= 0 ? id.slice(separator + 1) : id);
}

function subagentDepth(session: ObservableSession, sessionsById: ReadonlyMap<string, ObservableSession>): number {
	let depth = 0;
	let parentId = session.parentAgentId;
	const visited = new Set<string>([session.id]);
	while (parentId && !visited.has(parentId)) {
		visited.add(parentId);
		const parent = sessionsById.get(parentId);
		if (!parent || parent.kind !== "subagent") break;
		depth++;
		parentId = parent.parentAgentId;
	}
	return depth;
}

function modelSelector(session: ObservableSession): string | undefined {
	return withModelSelectorEffort(session.progress?.resolvedModel, { route: session.progress?.routeReceipt?.route.thinking });
}

const STALL_THRESHOLD_MS = 30_000;
const TOKEN_RATE_CELL_WIDTH = 8;

function hudStatus(session: ObservableSession, now: number, lastTokenProgressAt: number): HudStatus {
	const progressStatus = session.progress?.status;
	if (session.status === "failed" || progressStatus === "failed" || session.progress?.livenessState === "dead") {
		return "failed";
	}
	if (session.status === "aborted" || progressStatus === "aborted") return "canceled";
	if (session.status === "completed" || progressStatus === "completed") return "done";
	if (progressStatus === "pending") return "starting";

	const stalled =
		session.progress?.livenessState === "stalled" ||
		session.tokenRateStuck === true ||
		((session.tokenRate ?? 0) <= 0 && now - lastTokenProgressAt >= STALL_THRESHOLD_MS);
	if (stalled) return "stalled";

	const generatedTokens = session.progress?.outputTokens ?? session.progress?.tokens ?? 0;
	return (session.tokenRate ?? 0) > 0 || generatedTokens > 0 ? "streaming" : "starting";
}

function formatTokenRate(rate: number | undefined): string {
	const rounded = Number.isFinite(rate) ? Math.max(0, Math.round(rate ?? 0)) : 0;
	if (rounded < 10_000) return `${rounded} t/s`;
	if (rounded < 1_000_000) return `${Math.min(999, Math.round(rounded / 1_000))}k t/s`;
	return `${Math.min(999, Math.round(rounded / 1_000_000))}m t/s`;
}
/** Incremental, column-aligned renderer for the detached-subagent HUD tree. */
export class SubagentHudRenderer {
	#rows = new Map<string, CachedRow>();
	#tokenProgress = new Map<string, TokenProgress>();
	#generation = 0;
	#theme: Theme | undefined;
	#rowRebuilds = 0;

	getPerformanceCounters(): Readonly<SubagentHudPerformanceCounters> {
		return { rowRebuilds: this.#rowRebuilds };
	}

	resetPerformanceCounters(): void {
		this.#rowRebuilds = 0;
	}

	#lastTokenProgressAt(session: ObservableSession): number {
		const tokens = session.progress?.tokens ?? session.progress?.outputTokens ?? 0;
		const previous = this.#tokenProgress.get(session.id);
		if (!previous || tokens !== previous.tokens) {
			this.#tokenProgress.set(session.id, { tokens, at: session.lastUpdate });
			return session.lastUpdate;
		}
		return previous.at;
	}

	render(sessions: readonly ObservableSession[], columns: number, showTokenRateBadge = true): string[] {
		if (this.#theme !== theme) {
			this.#theme = theme;
			this.#rows.clear();
		}
		const visible = sessions.filter(
			session => session.kind === "subagent" && session.status === "active" && session.detached === true,
		);
		if (visible.length === 0) {
			this.#rows.clear();
			this.#tokenProgress.clear();
			return [];
		}

		const generation = ++this.#generation;
		const now = Date.now();
		const sessionsById = new Map(sessions.map(session => [session.id, session]));
		const rowWidth = Math.max(0, columns - 1);
		const rateColumnWidth = showTokenRateBadge
			? Math.min(TOKEN_RATE_CELL_WIDTH, Math.max(0, rowWidth - 2))
			: 0;
		const rows: HudRow[] = visible.map(session => {
			const depth = subagentDepth(session, sessionsById);
			const description = session.description?.trim() || session.progress?.description?.trim();
			return {
				session,
				prefix: `  ${"  ".repeat(depth)}   `,
				displayId: shortAgentId(session.id),
				description,
				task: description ? undefined : session.progress?.task?.trim(),
				modelSelector: modelSelector(session),
				tokenRate: showTokenRateBadge ? session.tokenRate : undefined,
				status: hudStatus(session, now, this.#lastTokenProgressAt(session)),
			};
		});

		const lines = ["", `  ${theme.bold(theme.fg("accent", "Subagents"))}`];
		for (const input of rows) {
			const rate = showTokenRateBadge ? formatTokenRate(input.tokenRate) : "";
			const fingerprint = [
				input.prefix,
				input.displayId,
				input.description ?? "",
				input.task ?? "",
				input.modelSelector ?? "",
				rate,
				input.status,
				rateColumnWidth,
			].join("\u0000");
			let cached = this.#rows.get(input.session.id);
			if (!cached || cached.columns !== columns || cached.fingerprint !== fingerprint) {
				cached = {
					columns,
					fingerprint,
					generation,
					row: this.#buildRow(input, rate, rateColumnWidth, columns),
				};
				this.#rows.set(input.session.id, cached);
				this.#rowRebuilds++;
			} else {
				cached.generation = generation;
			}
			lines.push(cached.row);
		}
		for (const [id, cached] of this.#rows) {
			if (cached.generation === generation) continue;
			this.#rows.delete(id);
			this.#tokenProgress.delete(id);
		}
		return lines;
	}

	#buildRow(input: HudRow, rate: string, rateColumnWidth: number, columns: number): string {
		const abbreviation = input.modelSelector
			? renderModelSelectorAbbreviation(input.modelSelector, "compact")
			: theme.fg("dim", "?");
		const statusGlyph = (() => {
			switch (input.status) {
				case "streaming":
					return theme.fg("accent", theme.status.running);
				case "starting":
					return theme.fg("dim", theme.status.pending);
				case "stalled":
					return theme.fg("warning", theme.status.warning);
				case "failed":
					return theme.fg("error", theme.status.error);
				case "canceled":
					return theme.fg("warning", theme.status.aborted);
				case "done":
					return theme.fg("success", theme.status.done);
			}
		})();
		let left =
			`${theme.fg("dim", input.prefix)}${statusGlyph} [${abbreviation}] ` +
			theme.fg("accent", theme.bold(input.displayId));
		if (input.description) {
			left += `${theme.fg("accent", ":")} ${theme.fg("muted", replaceTabs(input.description))}`;
		} else if (input.task) {
			left += ` ${theme.fg("muted", replaceTabs(input.task))}`;
		}

		// Leave the terminal's final cell unused. Exact-width rows arm the
		// terminal's pending-wrap state, so the next cursor move can appear on a
		// second display line.
		const rowWidth = Math.max(0, columns - 1);
		const tailWidth = rateColumnWidth > 0 ? rateColumnWidth + 1 : 0;
		const leftWidth = Math.max(0, rowWidth - tailWidth);
		left = truncateToWidth(left, leftWidth);
		left += padding(Math.max(0, leftWidth - visibleWidth(left)));
		if (rateColumnWidth === 0) return left;

		const visibleRate = truncateToWidth(rate, rateColumnWidth);
		const rateCell = `${padding(Math.max(0, rateColumnWidth - visibleWidth(visibleRate)))}${visibleRate}`;
		return `${left} ${theme.fg(input.status === "stalled" ? "warning" : "success", rateCell)}`;
	}
}

/** Stateless compatibility helper for callers that render one snapshot. */
export function renderSubagentHudLines(sessions: readonly ObservableSession[], columns: number): string[] {
	return new SubagentHudRenderer().render(sessions, columns);
}
