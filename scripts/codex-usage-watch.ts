#!/usr/bin/env bun
/**
 * Overnight Codex quota/reset-credit watcher (read-only).
 *
 * Every POLL_MINUTES runs the same read-only snapshot as codex-usage-check.ts
 * and appends one JSONL row to data/codex-usage-watch/log.jsonl. Alerts (credit
 * count drop = a reset was burned; weekly window back near 0% = upstream reset
 * observed) are appended to data/codex-usage-watch/alerts.log.
 *
 * Run supervised:  tmux new-session -d -s codex-usage-watch 'bun scripts/codex-usage-watch.ts'
 */
import { appendFileSync, mkdirSync } from "node:fs";
import { listCodexResetCredits } from "../vendor/oh-my-pi/packages/ai/src/usage/openai-codex-reset";
import { discoverAuthStorage } from "../vendor/oh-my-pi/packages/coding-agent/src/sdk";

const POLL_MINUTES = 15;
const DIR = new URL("../data/codex-usage-watch/", import.meta.url).pathname;
mkdirSync(DIR, { recursive: true });
const LOG = `${DIR}log.jsonl`;
const ALERTS = `${DIR}alerts.log`;

let lastAvailable: number | null = null;
let lastWeeklyUsed: number | null = null;

const alert = (message: string) => {
	const line = `${new Date().toISOString()} ${message}\n`;
	appendFileSync(ALERTS, line);
	console.error(line.trim());
};

for (;;) {
	try {
		const storage = await discoverAuthStorage();
		const reports = await storage.fetchUsageReports({ signal: AbortSignal.timeout(30_000) }).catch(() => null);
		const oauth = await storage.getOAuthAccess("openai-codex");
		const credits = oauth?.accessToken
			? await listCodexResetCredits({
					accessToken: oauth.accessToken,
					accountId: oauth.accountId,
					fetch,
					signal: AbortSignal.timeout(30_000),
				})
			: null;

		const weekly = (reports ?? [])
			.filter(r => r.provider === "openai-codex")
			.flatMap(r => r.limits ?? [])
			.filter(l => l.window?.id === "7d" && l.scope?.tier !== "spark")
			.map(l => ({ account: l.scope?.accountId, used: l.amount?.used, resetsAt: l.window?.resetsAt }));

		const row = {
			at: new Date().toISOString(),
			creditsAvailable: credits?.availableCount ?? null,
			weekly,
		};
		appendFileSync(LOG, `${JSON.stringify(row)}\n`);
		console.log(JSON.stringify(row));

		if (credits) {
			if (lastAvailable !== null && credits.availableCount < lastAvailable) {
				alert(`RESET CREDIT CONSUMED: available ${lastAvailable} -> ${credits.availableCount}`);
			}
			lastAvailable = credits.availableCount;
		}
		const proUsed = weekly.find(w => typeof w.used === "number")?.used;
		if (typeof proUsed === "number") {
			if (lastWeeklyUsed !== null && lastWeeklyUsed >= 80 && proUsed <= 20) {
				alert(`UPSTREAM RESET OBSERVED: weekly used ${lastWeeklyUsed}% -> ${proUsed}% (all-clear)`);
			}
			lastWeeklyUsed = proUsed;
		}
	} catch (error) {
		appendFileSync(ALERTS, `${new Date().toISOString()} watcher error: ${String(error)}\n`);
	}
	await Bun.sleep(POLL_MINUTES * 60_000);
}
