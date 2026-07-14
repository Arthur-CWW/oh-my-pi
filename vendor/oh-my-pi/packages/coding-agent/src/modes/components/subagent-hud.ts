import { visibleWidth } from "@oh-my-pi/pi-tui";
import { formatTaskId } from "../../task/render";
import { replaceTabs, TRUNCATE_LENGTHS, truncateToWidth } from "../../tools/render-utils";
import type { ObservableSession } from "../session-observer-registry";
import { theme, type Theme } from "../theme/theme";

interface CachedRow {
	columns: number;
	description?: string;
	task?: string;
	first: boolean;
	generation: number;
	row: string;
}

export interface SubagentHudPerformanceCounters {
	rowRebuilds: number;
}

/**
 * Incremental renderer for the detached-subagent HUD. Rows are retained by
 * child id; a progress update for one child does not rebuild its siblings.
 */
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

	render(sessions: readonly ObservableSession[], columns: number): string[] {
		if (this.#theme !== theme) {
			this.#theme = theme;
			this.#rows.clear();
		}
		const generation = ++this.#generation;
		const lines: string[] = [];
		let runningIndex = 0;
		for (const session of sessions) {
			if (session.kind !== "subagent" || session.status !== "active" || session.detached !== true) continue;
			if (runningIndex === 0) lines.push("", `  ${theme.bold(theme.fg("accent", "Subagents"))}`);
			const description = session.description?.trim() || session.progress?.description?.trim();
			const task = description ? undefined : session.progress?.task?.trim();
			const first = runningIndex === 0;
			let cached = this.#rows.get(session.id);
			if (
				!cached ||
				cached.columns !== columns ||
				cached.description !== description ||
				cached.task !== task ||
				cached.first !== first
			) {
				cached = {
					columns,
					description,
					task,
					first,
					generation,
					row: this.#buildRow(session.id, description, task, first, columns),
				};
				this.#rows.set(session.id, cached);
				this.#rowRebuilds++;
			} else {
				cached.generation = generation;
			}
			lines.push(cached.row);
			runningIndex++;
		}
		for (const [id, cached] of this.#rows) {
			if (cached.generation !== generation) this.#rows.delete(id);
		}
		return lines;
	}

	#buildRow(id: string, description: string | undefined, task: string | undefined, first: boolean, columns: number): string {
		const indent = "  ";
		const prefix = `${indent}${first ? theme.tree.hook : " "} `;
		const displayId = formatTaskId(id);
		let line = `${prefix}${theme.styledSymbol("status.done", "accent")} ${theme.fg("accent", theme.bold(displayId))}`;
		if (description) {
			const budget = Math.max(TRUNCATE_LENGTHS.SHORT, columns - visibleWidth(prefix) - visibleWidth(displayId) - 6);
			line += `${theme.fg("accent", ":")} ${theme.fg("accent", truncateToWidth(replaceTabs(description), budget))}`;
		} else if (task) {
			line += ` ${theme.fg("muted", truncateToWidth(replaceTabs(task), TRUNCATE_LENGTHS.SHORT))}`;
		}
		return line;
	}
}

/** Stateless compatibility helper for callers that render one snapshot. */
export function renderSubagentHudLines(sessions: readonly ObservableSession[], columns: number): string[] {
	return new SubagentHudRenderer().render(sessions, columns);
}
