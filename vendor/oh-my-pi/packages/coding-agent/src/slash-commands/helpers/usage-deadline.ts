/** Format a millisecond duration as a coarse-grained human label. */
export function formatDuration(ms: number): string {
	const seconds = Math.max(0, Math.round(ms / 1000));
	if (seconds < 60) return `${seconds}s`;
	const minutes = Math.round(seconds / 60);
	if (minutes < 60) return `${minutes}m`;
	const hours = Math.round(minutes / 60);
	if (hours < 48) return `${hours}h`;
	const days = Math.round(hours / 24);
	return `${days}d`;
}

export type UsageDeadlineFormatter = (deadlineMs: number | undefined) => string | undefined;

/**
 * Build a deterministic local deadline formatter for one usage rendering.
 *
 * The caller supplies both the clock and IANA timezone so every limit in a
 * report shares the same frame of reference and tests never depend on the host.
 */
export function createUsageDeadlineFormatter(nowMs: number, timeZone: string): UsageDeadlineFormatter {
	const absolute = new Intl.DateTimeFormat("en-US", {
		timeZone,
		year: "numeric",
		month: "short",
		day: "numeric",
		hour: "numeric",
		minute: "2-digit",
		timeZoneName: "short",
	});
	return deadlineMs => {
		if (deadlineMs === undefined) return undefined;
		const date = new Date(deadlineMs);
		if (!Number.isFinite(deadlineMs) || !Number.isFinite(date.getTime())) return "unknown time";
		const deltaMs = deadlineMs - nowMs;
		const relative =
			deltaMs > 0
				? `in ${formatDuration(deltaMs)}`
				: deltaMs < 0
					? `overdue by ${formatDuration(-deltaMs)}`
					: "due now";
		return `${absolute.format(date)} (${relative})`;
	};
}
