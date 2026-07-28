import type { LoopWatchdogSnapshot } from "@oh-my-pi/pi-tui/loop-watchdog";
import type { SlashCommandSpec } from "./types";

export function formatLoopStats(snapshot: LoopWatchdogSnapshot): string {
	const lines = [
		"Loop watchdog",
		`  total violations: ${snapshot.totalViolations}`,
		`  max blocked ms: ${snapshot.maxBlockedMs}`,
		`  retained records: ${snapshot.violations.length}`,
	];
	if (snapshot.violations.length > 0) {
		lines.push("  recent records:");
		for (const record of snapshot.violations) {
			const phase = record.phase.replace(/[\u0000-\u001f\u007f-\u009f]+/g, " ").trim();
			const attribution = record.attribution
				? ` attribution=${record.attribution.replace(/[\u0000-\u001f\u007f-\u009f]+/g, " ").trim()}`
				: "";
			lines.push(
				`    timestamp=${record.timestamp} blockedMs=${record.blockedMs} phase=${phase} pid=${record.pid}${attribution}`,
			);
		}
	}
	return lines.join("\n");
}

export const LOOPSTATS_COMMAND_SPEC: SlashCommandSpec = {
	name: "loopstats",
	tuiNamespace: "colon",
	description: "Show event-loop watchdog violations and retained records",
	handleTui: (_command, runtime) => {
		runtime.ctx.showStatus(formatLoopStats(runtime.ctx.ui.loopWatchdogSnapshot));
		runtime.ctx.editor.setText("");
	},
};
