import type { UsageResetAutomation } from "@oh-my-pi/pi-ai";

/** Format a millisecond duration as a coarse-grained human label. */
export function formatDuration(ms: number): string {
	const seconds = Math.max(0, Math.round(ms / 1000));
	if (seconds < 60) return `${seconds}s`;
	const minutes = Math.round(seconds / 60);
	if (minutes < 60) return `${minutes}m`;
	const hours = Math.floor(minutes / 60);
	if (hours < 48) {
		const remainingMinutes = minutes % 60;
		return remainingMinutes === 0 ? `${hours}h` : `${hours}h ${remainingMinutes}m`;
	}
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

export function formatUsageResetAutomation(
	automation: UsageResetAutomation | undefined,
	nowMs: number,
	formatDeadline: UsageDeadlineFormatter,
): string | undefined {
	if (!automation) return undefined;
	switch (automation.status) {
		case "disabled":
			return automation.reason === "manual-mode"
				? "auto-redeem disabled by manual reset mode"
				: "auto-redeem disabled";
		case "scheduled": {
			const deadline = formatDeadline(automation.nextAttemptAt);
			return deadline ? `auto-redeem scheduled ${deadline}` : "auto-redeem scheduled";
		}
		case "retrying": {
			const deadline = formatDeadline(automation.nextAttemptAt);
			return deadline ? `auto-redeem retry ${deadline}` : "auto-redeem retry pending";
		}
		case "redeemed":
			return `auto-redeemed ${formatDuration(Math.max(0, nowMs - automation.updatedAt))} ago`;
		case "failed":
			return `auto-redeem failed ${formatDuration(Math.max(0, nowMs - automation.updatedAt))} ago`;
	}
}
