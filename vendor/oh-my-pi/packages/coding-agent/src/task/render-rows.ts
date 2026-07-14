import type { Theme } from "../modes/theme/theme";
import { formatMoreItems, replaceTabs, truncateToWidth } from "../tools/render-utils";
import type { TaskItem, TaskParams } from "./types";

export function formatTaskId(id: string): string {
	// Ids are name-based (e.g. "Anna", "Anna-2"); a "." separates nesting levels
	// (e.g. "Anna.Bob"). Render the hierarchy with a ">" breadcrumb.
	const segments = id.split(".");
	return segments.length < 2 ? id : segments.join(">");
}

/**
 * Render the call preview lines for the single spawned agent. The
 * args stream in token by token, so every field access is defensive.
 */
export function renderTaskCallLines(args: Partial<TaskParams> | undefined, theme: Theme): string[] {
	if (!args) return [];
	const bullet = theme.fg("dim", "•");
	const lines: string[] = [];
	const rawId = typeof args.id === "string" ? args.id.trim() : "";
	const idLabel = rawId ? formatTaskId(rawId) : "";
	const desc = typeof args.description === "string" ? args.description.trim() : "";
	if (idLabel || desc) {
		let line = `${bullet} ${theme.fg("accent", theme.bold(idLabel || "agent"))}`;
		if (desc) line += `: ${theme.fg("muted", truncateToWidth(replaceTabs(desc), 64))}`;
		lines.push(line);
	}
	lines.push(...renderTaskItemLines(args.tasks, theme));
	return lines;
}

/** Agent rows shown per collapsed task list; the rest fold into a summary line. */
export const COLLAPSED_AGENT_LIMIT = 4;

function renderTaskItemLines(tasks: TaskItem[] | undefined, theme: Theme): string[] {
	if (!Array.isArray(tasks) || tasks.length === 0) return [];
	const bullet = theme.fg("dim", "•");
	const cap = Math.min(tasks.length, COLLAPSED_AGENT_LIMIT);
	const lines: string[] = [];
	for (let i = 0; i < cap; i++) {
		const task = tasks[i] as Partial<TaskItem> | undefined;
		const rawId = typeof task?.id === "string" ? task.id.trim() : "";
		const idLabel = rawId ? formatTaskId(rawId) : `#${i + 1}`;
		let line = `${bullet} ${theme.fg("accent", theme.bold(idLabel))}`;
		const desc = typeof task?.description === "string" ? task.description.trim() : "";
		if (desc) line += `: ${theme.fg("muted", truncateToWidth(replaceTabs(desc), 64))}`;
		if (task?.isolated === true) line += theme.fg("dim", " [isolated]");
		lines.push(line);
	}
	if (cap < tasks.length) lines.push(`${bullet} ${theme.fg("dim", formatMoreItems(tasks.length - cap, "agent"))}`);
	return lines;
}
