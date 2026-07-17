import { padding, visibleWidth } from "@oh-my-pi/pi-tui";
import { formatTaskId } from "../../task/render";
import { replaceTabs, TRUNCATE_LENGTHS, truncateToWidth } from "../../tools/render-utils";
import type { ObservableSession } from "../session-observer-registry";
import { theme, type Theme } from "../theme/theme";
import { renderModelSelectorAbbreviation, withModelSelectorEffort } from "./model-selector-abbreviation";

interface CachedRow {
	columns: number;
	fingerprint: string;
	generation: number;
	row: string;
}

interface HudRow {
	session: ObservableSession;
	prefix: string;
	displayId: string;
	description?: string;
	task?: string;
	modelSelector?: string;
	tokenRate?: number;
	tokenRateStuck: boolean;
	livenessState?: "stalled" | "dead";
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

/** Incremental, column-aligned renderer for the detached-subagent HUD tree. */
export class SubagentHudRenderer {
	#rows = new Map<string, CachedRow>();
	#generation = 0;
	#theme: Theme | undefined;
	#rowRebuilds = 0;

	getPerformanceCounters(): Readonly<SubagentHudPerformanceCounters> {
		return { rowRebuilds: this.#rowRebuilds };
	}

	resetPerformanceCounters(): void {
		this.#rowRebuilds = 0;
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
			return [];
		}

		const generation = ++this.#generation;
		const sessionsById = new Map(sessions.map(session => [session.id, session]));
		const lastSiblingByParent = new Map<string | undefined, string>();
		for (const session of visible) lastSiblingByParent.set(session.parentAgentId, session.id);
		const tokenColumnWidth = showTokenRateBadge
			? Math.max(1, ...visible.map(session => String(Math.round(session.tokenRate ?? 0)).length))
			: 0;
		const rows: HudRow[] = visible.map(session => {
			const depth = subagentDepth(session, sessionsById);
			const branch =
				lastSiblingByParent.get(session.parentAgentId) === session.id ? theme.tree.last : theme.tree.branch;
			const description = session.description?.trim() || session.progress?.description?.trim();
			return {
				session,
				prefix: `  ${"  ".repeat(depth)}${branch} `,
				displayId: shortAgentId(session.id),
				description,
				task: description ? undefined : session.progress?.task?.trim(),
				modelSelector: modelSelector(session),
				tokenRate: showTokenRateBadge ? session.tokenRate : undefined,
				tokenRateStuck: session.tokenRateStuck === true,
				livenessState: session.progress?.livenessState,
			};
		});

		const lines = ["", `  ${theme.bold(theme.fg("accent", "Subagents"))}`];
		for (const input of rows) {
			const rate = input.tokenRate === undefined ? "" : String(Math.round(input.tokenRate));
			const state =
				input.livenessState === "dead"
					? "DEAD"
					: input.livenessState === "stalled"
						? "STALLED"
						: input.tokenRateStuck
							? "RUN+0"
							: "RUN";
			const fingerprint = [
				input.prefix,
				input.displayId,
				input.description ?? "",
				input.task ?? "",
				input.modelSelector ?? "",
				rate,
				state,
				tokenColumnWidth,
			].join("\u0000");
			let cached = this.#rows.get(input.session.id);
			if (!cached || cached.columns !== columns || cached.fingerprint !== fingerprint) {
				cached = {
					columns,
					fingerprint,
					generation,
					row: this.#buildRow(input, rate, state, tokenColumnWidth, columns),
				};
				this.#rows.set(input.session.id, cached);
				this.#rowRebuilds++;
			} else {
				cached.generation = generation;
			}
			lines.push(cached.row);
		}
		for (const [id, cached] of this.#rows) {
			if (cached.generation !== generation) this.#rows.delete(id);
		}
		return lines;
	}

	#buildRow(input: HudRow, rate: string, state: string, tokenColumnWidth: number, columns: number): string {
		const abbreviation = input.modelSelector
			? renderModelSelectorAbbreviation(input.modelSelector, "compact")
			: theme.fg("dim", "?");
		let left = `${theme.fg("dim", input.prefix)}[${abbreviation}] ${theme.fg("accent", theme.bold(input.displayId))}`;
		if (input.description) {
			left += `${theme.fg("accent", ":")} ${theme.fg("muted", replaceTabs(input.description))}`;
		} else if (input.task) {
			left += ` ${theme.fg("muted", replaceTabs(input.task))}`;
		}

		const tokenLane = tokenColumnWidth > 0 ? rate.padStart(tokenColumnWidth) : "";
		const stateLane = state.padStart(5);
		// Leave the terminal's final cell unused. Exact-width rows arm the terminal's
		// pending-wrap state, so the next cursor move can appear on a second display line.
		const rowWidth = Math.max(1, columns - 1);
		const tailWidth = tokenColumnWidth + (tokenColumnWidth > 0 ? 1 : 0) + stateLane.length;
		const leftWidth = Math.max(1, rowWidth - tailWidth - 1);
		left = truncateToWidth(left, Math.max(TRUNCATE_LENGTHS.SHORT, leftWidth));
		left = truncateToWidth(left, leftWidth);
		left += padding(Math.max(0, leftWidth - visibleWidth(left)));
		const token = tokenColumnWidth > 0 ? `${theme.fg("dim", tokenLane)} ` : "";
		const status = theme.fg(input.livenessState === "dead" ? "error" : state === "RUN" ? "success" : "warning", stateLane);
		return `${left} ${token}${status}`;
	}
}

/** Stateless compatibility helper for callers that render one snapshot. */
export function renderSubagentHudLines(sessions: readonly ObservableSession[], columns: number): string[] {
	return new SubagentHudRenderer().render(sessions, columns);
}
