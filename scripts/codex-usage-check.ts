#!/usr/bin/env bun
/**
 * Read-only Codex quota + saved-reset-credit snapshot.
 *
 * GET-only by construction: the injected fetch refuses any non-GET request,
 * so this can never consume/redeem a reset credit.
 *
 * Run from the repo root:
 *   bun scripts/codex-usage-check.ts
 */
import { listCodexResetCredits } from "../vendor/oh-my-pi/packages/ai/src/usage/openai-codex-reset";
import type { FetchImpl } from "../vendor/oh-my-pi/packages/ai/src/types";
import { discoverAuthStorage } from "../vendor/oh-my-pi/packages/coding-agent/src/sdk";

const getOnlyFetch: FetchImpl = (input, init) => {
	const method = (init?.method ?? "GET").toUpperCase();
	if (method !== "GET") {
		throw new Error(`codex-usage-check is read-only; refused ${method} ${String(input)}`);
	}
	return fetch(input, init);
};

const storage = await discoverAuthStorage();

const reports = await storage.fetchUsageReports({ signal: AbortSignal.timeout(30_000) }).catch(error => {
	console.error("usage report fetch failed:", String(error));
	return null;
});

for (const report of reports ?? []) {
	if (report.provider !== "openai" && report.provider !== "openai-codex") continue;
	console.log(`provider=${report.provider} account=${report.accountId ?? report.email ?? "?"}`);
	console.log(JSON.stringify(report, null, 1));
}

const oauth = await storage.getOAuthAccess("openai-codex");
if (!oauth?.accessToken) {
	console.error("no openai-codex oauth credential resolved; cannot list reset credits");
	process.exit(2);
}

const credits = await listCodexResetCredits({
	accessToken: oauth.accessToken,
	accountId: oauth.accountId,
	fetch: getOnlyFetch,
	signal: AbortSignal.timeout(30_000),
});

if (!credits) {
	console.log("reset credits: unavailable (transport/auth failure)");
} else {
	console.log(`reset credits: available=${credits.availableCount} total=${credits.credits.length}`);
	for (const credit of credits.credits) {
		console.log(
			`  id=${credit.id} status=${credit.status ?? "available"} granted=${credit.grantedAt ?? "?"} expires=${credit.expiresAt ?? "?"} title=${credit.title ?? ""}`,
		);
	}
}
