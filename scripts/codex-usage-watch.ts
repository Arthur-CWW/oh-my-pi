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
const lastWeeklyByAccount = new Map<string, number>();

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
		// Alert on the reset transition for ANY account (>=80% -> <=20%).
		for (const w of weekly) {
			const key = String(w.account ?? "?");
			const used = typeof w.used === "number" ? w.used : null;
			if (used === null) continue;
			const prev = lastWeeklyByAccount.get(key);
			if (prev !== undefined && prev >= 80 && used <= 20) {
				alert(`UPSTREAM RESET OBSERVED on ${key}: weekly used ${prev}% -> ${used}% (all-clear)`);
			}
			lastWeeklyByAccount.set(key, used);
		}
