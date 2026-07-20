#!/usr/bin/env bun

import { Effect } from "effect";
import { CliError, Command, Flag } from "effect/unstable/cli";
import { NodeServices } from "@effect/platform-node";
import { formatDuration, formatNumber, formatPercent } from "@oh-my-pi/pi-utils";
import { getDashboardStats, getTotalMessageCount, syncAllSessions } from "./aggregator";
import { closeDb } from "./db";
import { startServer } from "./server";

export {
	getDashboardStats,
	getTotalMessageCount,
	type SyncOptions,
	type SyncProgress,
	smokeTestSyncWorker,
	syncAllSessions,
} from "./aggregator";
export { closeDb } from "./db";
export {
	startServer,
	waitForStatsHealth,
	type StatsErrorPayload,
	type StatsHealth,
	type StatsServer,
	type StatsVersion,
	type WaitForStatsHealthOptions,
} from "./server";
export type {
	AggregatedStats,
	DashboardStats,
	FolderStats,
	MessageStats,
	ModelPerformancePoint,
	ModelStats,
	ModelTimeSeriesPoint,
	TimeSeriesPoint,
} from "./types";

/**
 * Format cost in dollars.
 */
function formatCost(n: number): string {
	if (n < 0.01) return `$${n.toFixed(4)}`;
	if (n < 1) return `$${n.toFixed(3)}`;
	return `$${n.toFixed(2)}`;
}

function normalizePremiumRequests(n: number): number {
	return Math.round((n + Number.EPSILON) * 100) / 100;
}

/**
 * Print stats summary to console.
 */
async function printStats(): Promise<void> {
	const stats = await getDashboardStats();
	const { overall, byModel, byFolder } = stats;

	console.log("\n=== AI Usage Statistics ===\n");

	console.log("Overall:");
	console.log(`  Requests: ${formatNumber(overall.totalRequests)} (${formatNumber(overall.failedRequests)} errors)`);
	console.log(`  Error Rate: ${formatPercent(overall.errorRate)}`);
	console.log(`  Total Tokens: ${formatNumber(overall.totalInputTokens + overall.totalOutputTokens)}`);
	console.log(`  Input Tokens: ${formatNumber(overall.totalInputTokens)}`);
	console.log(`  Output Tokens: ${formatNumber(overall.totalOutputTokens)}`);
	console.log(`  Cache Rate: ${formatPercent(overall.cacheRate)}`);
	console.log(`  Total Cost: ${formatCost(overall.totalCost)}`);
	console.log(`  Premium Requests: ${formatNumber(normalizePremiumRequests(overall.totalPremiumRequests ?? 0))}`);
	console.log(`  Avg Duration: ${overall.avgDuration !== null ? formatDuration(overall.avgDuration) : "-"}`);
	console.log(`  Avg TTFT: ${overall.avgTtft !== null ? formatDuration(overall.avgTtft) : "-"}`);
	if (overall.avgTokensPerSecond !== null) {
		console.log(`  Avg Tokens/s: ${overall.avgTokensPerSecond.toFixed(1)}`);
	}

	if (byModel.length > 0) {
		console.log("\nBy Model:");
		for (const m of byModel.slice(0, 10)) {
			console.log(
				`  ${m.model}: ${formatNumber(m.totalRequests)} reqs, ${formatCost(m.totalCost)}, ${formatPercent(m.cacheRate)} cache`,
			);
		}
	}

	if (byFolder.length > 0) {
		console.log("\nBy Folder:");
		for (const f of byFolder.slice(0, 10)) {
			console.log(`  ${f.folder}: ${formatNumber(f.totalRequests)} reqs, ${formatCost(f.totalCost)}`);
		}
	}

	console.log("");
}

const command = Command.make("omp-stats", {
	port: Flag.integer("port").pipe(
		Flag.withAlias("p"),
		Flag.withDescription("Port for the dashboard server"),
		Flag.withDefault(3847),
	),
	json: Flag.boolean("json").pipe(
		Flag.withAlias("j"),
		Flag.withDescription("Output stats as JSON and exit"),
	),
	sync: Flag.boolean("sync").pipe(
		Flag.withAlias("s"),
		Flag.withDescription("Sync session files and show summary"),
	),
}, (config) =>
	Effect.gen(function* () {
		// Sync first
		const tty = process.stderr.isTTY === true;
		process.stderr.write("Syncing session files...\n");
		let lastWidth = 0;
		let lastRender = 0;
		const { processed, files } = yield* Effect.promise(() =>
			syncAllSessions({
				onProgress: (event) => {
					if (!tty) return;
					const now = Date.now();
					if (event.current < event.total && now - lastRender < 33) return;
					lastRender = now;
					const marker = "/sessions/";
					const idx = event.sessionFile.indexOf(marker);
					const short = idx >= 0 ? event.sessionFile.slice(idx + marker.length) : event.sessionFile;
					const pct = ((event.current / event.total) * 100).toFixed(0).padStart(3, " ");
					const line = `[${event.current}/${event.total}] ${pct}%  ${short}`;
					const columns = process.stderr.columns ?? 120;
					const clipped = line.length > columns - 1 ? `${line.slice(0, columns - 2)}\u2026` : line;
					process.stderr.write(`\r${clipped.padEnd(lastWidth)}`);
					lastWidth = clipped.length;
				},
			}),
		);
		if (tty && lastWidth > 0) process.stderr.write(`\r${" ".repeat(lastWidth)}\r`);
		const total = yield* Effect.promise(() => getTotalMessageCount());
		console.log(`Synced ${processed} new entries from ${files} files (${total} total)\n`);

		if (config.json) {
			const stats = yield* Effect.promise(() => getDashboardStats());
			console.log(JSON.stringify(stats, null, 2));
			return;
		}

		if (config.sync) {
			yield* Effect.promise(() => printStats());
			return;
		}

		// Start server
		const { port: actualPort } = yield* Effect.promise(() => startServer(config.port));
		console.log(`Dashboard available at: http://localhost:${actualPort}`);
		console.log("Press Ctrl+C to stop\n");

		// Keep process running
		process.on("SIGINT", () => {
			console.log("\nShutting down...");
			closeDb();
			process.exit(0);
		});
	}),
).pipe(
	Command.withDescription("AI Usage Statistics Dashboard"),
	Command.withExamples([
		{ command: "omp-stats", description: "Start dashboard server" },
		{ command: "omp-stats --json", description: "Print stats as JSON" },
		{ command: "omp-stats --port 8080", description: "Start on custom port" },
		{ command: "omp-stats --sync", description: "Sync and show summary" },
	]),
);

// Run if executed directly
if (import.meta.main) {
	const program = Command.runWith(command, { version: "16.0.1" })(process.argv.slice(2));
	Effect.runPromise(program.pipe(Effect.provide(NodeServices.layer))).catch((error) => {
		if (!CliError.isCliError(error)) {
			console.error("Error:", error);
		}
		closeDb();
		process.exitCode = 1;
	});
}
