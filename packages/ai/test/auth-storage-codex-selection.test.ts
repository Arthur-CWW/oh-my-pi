import { afterEach, beforeEach, describe, expect, test, vi } from "bun:test";
import * as fs from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";
import { type AuthCredentialStore, AuthStorage, SqliteAuthCredentialStore } from "@oh-my-pi/pi-ai/auth-storage";
import * as oauthUtils from "@oh-my-pi/pi-ai/registry/oauth";
import type { OAuthCredentials } from "@oh-my-pi/pi-ai/registry/oauth/types";
import type { UsageLimit, UsageProvider, UsageReport } from "@oh-my-pi/pi-ai/usage";

const WEEK_MS = 7 * 24 * 60 * 60 * 1000;
const HOUR_MS = 60 * 60 * 1000;

const FIVE_HOUR_MS = 5 * HOUR_MS;

type UsageWindowSpec = {
	usedFraction: number;
	resetInMs: number;
};

type UsageWindowConfig = {
	windowId: string;
	windowLabel: string;
	durationMs: number;
};

function createLimit(args: {
	key: "primary" | "secondary";
	windowId: string;
	windowLabel: string;
	durationMs: number;
	usedFraction: number;
	resetInMs: number;
}): UsageLimit {
	const clamped = Math.min(Math.max(args.usedFraction, 0), 1);
	const used = clamped * 100;
	return {
		id: `openai-codex:${args.key}`,
		label: args.windowLabel,
		scope: {
			provider: "openai-codex",
			windowId: args.windowId,
			shared: true,
		},
		window: {
			id: args.windowId,
			label: args.windowLabel,
			durationMs: args.durationMs,
			resetsAt: Date.now() + args.resetInMs,
		},
		amount: {
			unit: "percent",
			used,
			limit: 100,
			remaining: 100 - used,
			usedFraction: clamped,
			remainingFraction: Math.max(0, 1 - clamped),
		},
		status: clamped >= 1 ? "exhausted" : clamped >= 0.9 ? "warning" : "ok",
	};
}

function createCodexUsageReport(args: {
	accountId: string;
	primary: UsageWindowSpec;
	secondary: UsageWindowSpec;
	primaryWindow?: UsageWindowConfig;
	secondaryWindow?: UsageWindowConfig;
	planType?: string;
	fetchedAt?: number;
	allowed?: boolean;
	limitReached?: boolean;
}): UsageReport {
	const primaryWindow = args.primaryWindow ?? { windowId: "1h", windowLabel: "1 Hour", durationMs: HOUR_MS };
	const secondaryWindow = args.secondaryWindow ?? { windowId: "7d", windowLabel: "7 Day", durationMs: WEEK_MS };
	const metadata: Record<string, string | boolean> = { accountId: args.accountId };
	if (args.planType) metadata.planType = args.planType;
	if (args.allowed !== undefined) metadata.allowed = args.allowed;
	if (args.limitReached !== undefined) metadata.limitReached = args.limitReached;
	return {
		provider: "openai-codex",
		fetchedAt: args.fetchedAt ?? Date.now(),
		limits: [
			createLimit({
				key: "primary",
				windowId: primaryWindow.windowId,
				windowLabel: primaryWindow.windowLabel,
				durationMs: primaryWindow.durationMs,
				usedFraction: args.primary.usedFraction,
				resetInMs: args.primary.resetInMs,
			}),
			createLimit({
				key: "secondary",
				windowId: secondaryWindow.windowId,
				windowLabel: secondaryWindow.windowLabel,
				durationMs: secondaryWindow.durationMs,
				usedFraction: args.secondary.usedFraction,
				resetInMs: args.secondary.resetInMs,
			}),
		],
		metadata,
	};
}

function createCredential(accountId: string, email: string): OAuthCredentials {
	return {
		access: `access-${accountId}`,
		refresh: `refresh-${accountId}`,
		expires: Date.now() + HOUR_MS,
		accountId,
		email,
	};
}

async function countApiKeySelections(
	authStorage: AuthStorage,
	provider: string,
	sessionPrefix: string,
	samples = 150,
): Promise<Map<string, number>> {
	const counts = new Map<string, number>();
	for (let index = 0; index < samples; index += 1) {
		const apiKey = await authStorage.getApiKey(provider, `${sessionPrefix}-${index}`);
		if (!apiKey) continue;
		counts.set(apiKey, (counts.get(apiKey) ?? 0) + 1);
	}
	return counts;
}

function countFor(counts: Map<string, number>, apiKey: string): number {
	return counts.get(apiKey) ?? 0;
}

function expectWeightedPreference(counts: Map<string, number>, preferred: string, fallback: string): void {
	const preferredCount = countFor(counts, preferred);
	const fallbackCount = countFor(counts, fallback);
	expect(preferredCount).toBeGreaterThan(fallbackCount);
	expect(preferredCount / fallbackCount).toBeGreaterThan(1.4);
	expect(preferredCount / fallbackCount).toBeLessThan(2.4);
}

describe("AuthStorage codex oauth ranking", () => {
	let tempDir = "";
	let store: AuthCredentialStore | null = null;
	let authStorage: AuthStorage | null = null;
	const usageByAccount = new Map<string, UsageReport>();

	const usageProvider: UsageProvider = {
		id: "openai-codex",
		async fetchUsage(params) {
			const accountId = params.credential.accountId;
			if (!accountId) return null;
			return usageByAccount.get(accountId) ?? null;
		},
	};

	beforeEach(async () => {
		tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "pi-ai-auth-codex-selection-"));
		store = await SqliteAuthCredentialStore.open(path.join(tempDir, "agent.db"));
		authStorage = new AuthStorage(store, {
			usageProviderResolver: provider => (provider === "openai-codex" ? usageProvider : undefined),
		});
		usageByAccount.clear();
		vi.spyOn(oauthUtils, "getOAuthApiKey").mockImplementation(async (_provider, credentials) => {
			const credential = credentials["openai-codex"] as OAuthCredentials | undefined;
			if (!credential?.accountId) return null;
			return {
				apiKey: `api-${credential.accountId}`,
				newCredentials: credential,
			};
		});
	});

	afterEach(async () => {
		vi.restoreAllMocks();
		store?.close();
		store = null;
		authStorage = null;
		if (tempDir) {
			await fs.rm(tempDir, { recursive: true, force: true });
			tempDir = "";
		}
	});

	test("weighted remaining capacity outranks near-reset low headroom", async () => {
		if (!authStorage) throw new Error("test setup failed");

		await authStorage.set("openai-codex", [
			{ type: "oauth", ...createCredential("acct-near", "near@example.com") },
			{ type: "oauth", ...createCredential("acct-far", "far@example.com") },
		]);

		usageByAccount.set(
			"acct-near",
			createCodexUsageReport({
				accountId: "acct-near",
				primary: { usedFraction: 0.4, resetInMs: 10 * 60 * 1000 },
				secondary: { usedFraction: 0.92, resetInMs: 15 * 60 * 1000 },
			}),
		);
		usageByAccount.set(
			"acct-far",
			createCodexUsageReport({
				accountId: "acct-far",
				primary: { usedFraction: 0.3, resetInMs: 40 * 60 * 1000 },
				secondary: { usedFraction: 0.55, resetInMs: 6 * 24 * 60 * 60 * 1000 },
			}),
		);

		const apiKey = await authStorage.getApiKey("openai-codex");
		expect(apiKey).toBe("api-acct-far");
	});

	test("uses fresh 5h ticker only as a tie-break after weighted capacity", async () => {
		if (!authStorage) throw new Error("test setup failed");

		await authStorage.set("openai-codex", [
			{ type: "oauth", ...createCredential("acct-zero", "zero@example.com") },
			{ type: "oauth", ...createCredential("acct-progress", "progress@example.com") },
		]);

		const fiveHourWindow: UsageWindowConfig = {
			windowId: "5h",
			windowLabel: "5 Hours",
			durationMs: FIVE_HOUR_MS,
		};

		usageByAccount.set(
			"acct-zero",
			createCodexUsageReport({
				accountId: "acct-zero",
				primary: { usedFraction: 0, resetInMs: FIVE_HOUR_MS },
				secondary: { usedFraction: 0.8, resetInMs: 2 * HOUR_MS },
				primaryWindow: fiveHourWindow,
			}),
		);
		usageByAccount.set(
			"acct-progress",
			createCodexUsageReport({
				accountId: "acct-progress",
				primary: { usedFraction: 0.8, resetInMs: 4 * HOUR_MS },
				secondary: { usedFraction: 0.2, resetInMs: 6 * 24 * HOUR_MS },
				primaryWindow: fiveHourWindow,
			}),
		);

		const apiKey = await authStorage.getApiKey("openai-codex");
		expect(apiKey).toBe("api-acct-zero");
	});

	test("20x large plan at 54 percent remaining outranks 1x plan at 99 percent", async () => {
		if (!authStorage) throw new Error("test setup failed");

		await authStorage.set("openai-codex", [
			{ type: "oauth", ...createCredential("acct-standard", "standard@example.com") },
			{ type: "oauth", ...createCredential("acct-large", "large@example.com") },
		]);

		usageByAccount.set(
			"acct-standard",
			createCodexUsageReport({
				accountId: "acct-standard",
				primary: { usedFraction: 0.01, resetInMs: HOUR_MS },
				secondary: { usedFraction: 0.01, resetInMs: WEEK_MS },
				planType: "standard",
			}),
		);
		usageByAccount.set(
			"acct-large",
			createCodexUsageReport({
				accountId: "acct-large",
				primary: { usedFraction: 0.46, resetInMs: HOUR_MS },
				secondary: { usedFraction: 0.46, resetInMs: WEEK_MS },
				planType: "large",
			}),
		);

		const apiKey = await authStorage.getApiKey("openai-codex");
		expect(apiKey).toBe("api-acct-large");
	});

	test("session-sticky allocation gives Pro twenty times the standard capacity", async () => {
		if (!authStorage) throw new Error("test setup failed");

		await authStorage.set("openai-codex", [
			{ type: "oauth", ...createCredential("acct-standard-weight", "standard-weight@example.com") },
			{ type: "oauth", ...createCredential("acct-pro-weight", "pro-weight@example.com") },
		]);

		for (const [accountId, planType] of [
			["acct-standard-weight", "standard"],
			["acct-pro-weight", "pro"],
		] as const) {
			usageByAccount.set(
				accountId,
				createCodexUsageReport({
					accountId,
					primary: { usedFraction: 0.2, resetInMs: HOUR_MS },
					secondary: { usedFraction: 0.2, resetInMs: WEEK_MS },
					planType,
				}),
			);
		}

		const counts = await countApiKeySelections(authStorage, "openai-codex", "weighted-codex-pro", 1_000);
		const standardCount = countFor(counts, "api-acct-standard-weight");
		const proCount = countFor(counts, "api-acct-pro-weight");

		expect(proCount / standardCount).toBeGreaterThan(15);
		expect(proCount / standardCount).toBeLessThan(25);
	});

	test("same-plan account with more bottleneck weighted remaining wins", async () => {
		if (!authStorage) throw new Error("test setup failed");

		await authStorage.set("openai-codex", [
			{ type: "oauth", ...createCredential("acct-low", "low@example.com") },
			{ type: "oauth", ...createCredential("acct-high", "high@example.com") },
		]);

		usageByAccount.set(
			"acct-low",
			createCodexUsageReport({
				accountId: "acct-low",
				primary: { usedFraction: 0.25, resetInMs: HOUR_MS },
				secondary: { usedFraction: 0.6, resetInMs: WEEK_MS },
				planType: "standard",
			}),
		);
		usageByAccount.set(
			"acct-high",
			createCodexUsageReport({
				accountId: "acct-high",
				primary: { usedFraction: 0.3, resetInMs: HOUR_MS },
				secondary: { usedFraction: 0.2, resetInMs: WEEK_MS },
				planType: "standard",
			}),
		);

		const apiKey = await authStorage.getApiKey("openai-codex");
		expect(apiKey).toBe("api-acct-high");
	});

	test("stale reports preserve credential order when no fresh report can rank candidates", async () => {
		if (!authStorage) throw new Error("test setup failed");

		await authStorage.set("openai-codex", [
			{ type: "oauth", ...createCredential("acct-stale-depleted", "stale-depleted@example.com") },
			{ type: "oauth", ...createCredential("acct-stale-healthy", "stale-healthy@example.com") },
		]);

		const fetchedAt = Date.now() - 10 * 60_000;
		usageByAccount.set(
			"acct-stale-depleted",
			createCodexUsageReport({
				accountId: "acct-stale-depleted",
				primary: { usedFraction: 0.99, resetInMs: 5 * 60_000 },
				secondary: { usedFraction: 0.99, resetInMs: 15 * 60_000 },
				fetchedAt,
			}),
		);
		usageByAccount.set(
			"acct-stale-healthy",
			createCodexUsageReport({
				accountId: "acct-stale-healthy",
				primary: { usedFraction: 0.01, resetInMs: HOUR_MS },
				secondary: { usedFraction: 0.01, resetInMs: WEEK_MS },
				fetchedAt,
			}),
		);

		await expect(authStorage.getApiKey("openai-codex")).resolves.toBe("api-acct-stale-depleted");
	});

	test("stale large plan does not beat a fresh usable standard plan", async () => {
		if (!authStorage) throw new Error("test setup failed");

		await authStorage.set("openai-codex", [
			{ type: "oauth", ...createCredential("acct-stale-large", "stale-large@example.com") },
			{ type: "oauth", ...createCredential("acct-fresh-standard", "fresh-standard@example.com") },
		]);

		usageByAccount.set(
			"acct-stale-large",
			createCodexUsageReport({
				accountId: "acct-stale-large",
				primary: { usedFraction: 0.01, resetInMs: HOUR_MS },
				secondary: { usedFraction: 0.01, resetInMs: WEEK_MS },
				planType: "large",
				fetchedAt: Date.now() - 10 * 60_000,
			}),
		);
		usageByAccount.set(
			"acct-fresh-standard",
			createCodexUsageReport({
				accountId: "acct-fresh-standard",
				primary: { usedFraction: 0.46, resetInMs: HOUR_MS },
				secondary: { usedFraction: 0.46, resetInMs: WEEK_MS },
				planType: "standard",
			}),
		);

		const apiKey = await authStorage.getApiKey("openai-codex");
		expect(apiKey).toBe("api-acct-fresh-standard");
	});

	test("metadata-ineligible large plan does not beat a fresh usable standard plan", async () => {
		if (!authStorage) throw new Error("test setup failed");

		await authStorage.set("openai-codex", [
			{ type: "oauth", ...createCredential("acct-ineligible-large", "ineligible-large@example.com") },
			{ type: "oauth", ...createCredential("acct-usable-standard", "usable-standard@example.com") },
		]);

		usageByAccount.set(
			"acct-ineligible-large",
			createCodexUsageReport({
				accountId: "acct-ineligible-large",
				primary: { usedFraction: 0.01, resetInMs: HOUR_MS },
				secondary: { usedFraction: 0.01, resetInMs: WEEK_MS },
				planType: "large",
				allowed: false,
			}),
		);
		usageByAccount.set(
			"acct-usable-standard",
			createCodexUsageReport({
				accountId: "acct-usable-standard",
				primary: { usedFraction: 0.46, resetInMs: HOUR_MS },
				secondary: { usedFraction: 0.46, resetInMs: WEEK_MS },
				planType: "standard",
			}),
		);

		const apiKey = await authStorage.getApiKey("openai-codex");
		expect(apiKey).toBe("api-acct-usable-standard");
	});

	test("blocked and spark-ineligible large plans do not win", async () => {
		if (!authStorage) throw new Error("test setup failed");

		await authStorage.set("openai-codex", [
			{ type: "oauth", ...createCredential("acct-blocked-large", "blocked-large@example.com") },
			{ type: "oauth", ...createCredential("acct-large", "large@example.com") },
			{ type: "oauth", ...createCredential("acct-pro", "pro@example.com") },
		]);

		usageByAccount.set(
			"acct-blocked-large",
			createCodexUsageReport({
				accountId: "acct-blocked-large",
				primary: { usedFraction: 1, resetInMs: HOUR_MS },
				secondary: { usedFraction: 1, resetInMs: WEEK_MS },
				planType: "large",
			}),
		);
		usageByAccount.set(
			"acct-large",
			createCodexUsageReport({
				accountId: "acct-large",
				primary: { usedFraction: 0.01, resetInMs: HOUR_MS },
				secondary: { usedFraction: 0.01, resetInMs: WEEK_MS },
				planType: "large",
			}),
		);
		usageByAccount.set(
			"acct-pro",
			createCodexUsageReport({
				accountId: "acct-pro",
				primary: { usedFraction: 0.5, resetInMs: HOUR_MS },
				secondary: { usedFraction: 0.5, resetInMs: WEEK_MS },
				planType: "pro",
			}),
		);

		const apiKey = await authStorage.getApiKey("openai-codex", "spark-ineligible-large", {
			modelId: "gpt-5.3-codex-spark",
		});
		expect(apiKey).toBe("api-acct-pro");
	});

	test("healthy sticky active session is not reranked by later capacity changes", async () => {
		if (!authStorage) throw new Error("test setup failed");

		await authStorage.set("openai-codex", [
			{ type: "oauth", ...createCredential("acct-sticky", "sticky@example.com") },
			{ type: "oauth", ...createCredential("acct-later-better", "later-better@example.com") },
		]);

		for (const accountId of ["acct-sticky", "acct-later-better"]) {
			usageByAccount.set(
				accountId,
				createCodexUsageReport({
					accountId,
					primary: { usedFraction: 0.2, resetInMs: HOUR_MS },
					secondary: { usedFraction: 0.2, resetInMs: WEEK_MS },
				}),
			);
		}

		const sessionId = "sticky-session";
		const firstApiKey = await authStorage.getApiKey("openai-codex", sessionId);
		expect(firstApiKey).toBeDefined();
		const firstAccount = firstApiKey === "api-acct-sticky" ? "acct-sticky" : "acct-later-better";
		const otherAccount = firstAccount === "acct-sticky" ? "acct-later-better" : "acct-sticky";

		usageByAccount.set(
			firstAccount,
			createCodexUsageReport({
				accountId: firstAccount,
				primary: { usedFraction: 0.9, resetInMs: HOUR_MS },
				secondary: { usedFraction: 0.9, resetInMs: WEEK_MS },
			}),
		);
		usageByAccount.set(
			otherAccount,
			createCodexUsageReport({
				accountId: otherAccount,
				primary: { usedFraction: 0.01, resetInMs: HOUR_MS },
				secondary: { usedFraction: 0.01, resetInMs: WEEK_MS },
			}),
		);

		await expect(authStorage.getApiKey("openai-codex", sessionId)).resolves.toBe(firstApiKey);
	});

	test("reset boundary history does not create false burn", async () => {
		if (!authStorage || !store) throw new Error("test setup failed");

		await authStorage.set("openai-codex", [
			{ type: "oauth", ...createCredential("acct-reset", "reset@example.com") },
			{ type: "oauth", ...createCredential("acct-peer", "peer@example.com") },
		]);

		usageByAccount.set(
			"acct-reset",
			createCodexUsageReport({
				accountId: "acct-reset",
				primary: { usedFraction: 0.5, resetInMs: HOUR_MS },
				secondary: { usedFraction: 0.5, resetInMs: WEEK_MS },
			}),
		);
		usageByAccount.set(
			"acct-peer",
			createCodexUsageReport({
				accountId: "acct-peer",
				primary: { usedFraction: 0.5, resetInMs: HOUR_MS },
				secondary: { usedFraction: 0.5, resetInMs: WEEK_MS },
			}),
		);

		const now = Date.now();
		store.recordUsageSnapshots?.([
			{
				recordedAt: now - 3 * HOUR_MS,
				provider: "openai-codex",
				accountKey: "oauth|account:acct-reset|email:reset@example.com",
				limitId: "openai-codex:secondary",
				label: "7 Day",
				windowLabel: "7 Day",
				usedFraction: 0.01,
				status: "ok",
				resetsAt: now - 2 * HOUR_MS,
			},
			{
				recordedAt: now - Math.floor(1.5 * HOUR_MS),
				provider: "openai-codex",
				accountKey: "oauth|account:acct-reset|email:reset@example.com",
				limitId: "openai-codex:secondary",
				label: "7 Day",
				windowLabel: "7 Day",
				usedFraction: 0.99,
				status: "warning",
				resetsAt: now + WEEK_MS,
			},
			{
				recordedAt: now - 3 * HOUR_MS,
				provider: "openai-codex",
				accountKey: "oauth|account:acct-peer|email:peer@example.com",
				limitId: "openai-codex:secondary",
				label: "7 Day",
				windowLabel: "7 Day",
				usedFraction: 0.1,
				status: "ok",
				resetsAt: now + WEEK_MS,
			},
			{
				recordedAt: now - Math.floor(1.5 * HOUR_MS),
				provider: "openai-codex",
				accountKey: "oauth|account:acct-peer|email:peer@example.com",
				limitId: "openai-codex:secondary",
				label: "7 Day",
				windowLabel: "7 Day",
				usedFraction: 0.2,
				status: "ok",
				resetsAt: now + WEEK_MS,
			},
		]);

		const apiKey = await authStorage.getApiKey("openai-codex");
		expect(apiKey).toBe("api-acct-reset");
	});

	test("skips exhausted weekly account even when reset is near", async () => {
		if (!authStorage) throw new Error("test setup failed");

		await authStorage.set("openai-codex", [
			{ type: "oauth", ...createCredential("acct-exhausted", "exhausted@example.com") },
			{ type: "oauth", ...createCredential("acct-healthy", "healthy@example.com") },
		]);

		usageByAccount.set(
			"acct-exhausted",
			createCodexUsageReport({
				accountId: "acct-exhausted",
				primary: { usedFraction: 1, resetInMs: 5 * 60 * 1000 },
				secondary: { usedFraction: 1, resetInMs: 5 * 60 * 1000 },
			}),
		);
		usageByAccount.set(
			"acct-healthy",
			createCodexUsageReport({
				accountId: "acct-healthy",
				primary: { usedFraction: 0.5, resetInMs: 20 * 60 * 1000 },
				secondary: { usedFraction: 0.4, resetInMs: 3 * 24 * 60 * 60 * 1000 },
			}),
		);

		const apiKey = await authStorage.getApiKey("openai-codex", "session-exhausted");
		expect(apiKey).toBe("api-acct-healthy");
	});

	test("falls back to earliest-unblocking account when all exhausted", async () => {
		if (!authStorage) throw new Error("test setup failed");

		await authStorage.set("openai-codex", [
			{ type: "oauth", ...createCredential("acct-soon", "soon@example.com") },
			{ type: "oauth", ...createCredential("acct-later", "later@example.com") },
		]);

		usageByAccount.set(
			"acct-soon",
			createCodexUsageReport({
				accountId: "acct-soon",
				primary: { usedFraction: 1, resetInMs: 5 * 60 * 1000 },
				secondary: { usedFraction: 1, resetInMs: 5 * 60 * 1000 },
			}),
		);
		usageByAccount.set(
			"acct-later",
			createCodexUsageReport({
				accountId: "acct-later",
				primary: { usedFraction: 1, resetInMs: 30 * 60 * 1000 },
				secondary: { usedFraction: 1, resetInMs: 30 * 60 * 1000 },
			}),
		);

		const apiKey = await authStorage.getApiKey("openai-codex", "session-all-exhausted");
		expect(apiKey).toBe("api-acct-soon");
	});

	test("works with single credential (no ranking)", async () => {
		if (!authStorage) throw new Error("test setup failed");

		await authStorage.set("openai-codex", [{ type: "oauth", ...createCredential("acct-solo", "solo@example.com") }]);

		usageByAccount.set(
			"acct-solo",
			createCodexUsageReport({
				accountId: "acct-solo",
				primary: { usedFraction: 0.3, resetInMs: 20 * 60 * 1000 },
				secondary: { usedFraction: 0.2, resetInMs: 5 * 24 * 60 * 60 * 1000 },
			}),
		);

		const apiKey = await authStorage.getApiKey("openai-codex", "session-single");
		expect(apiKey).toBe("api-acct-solo");
	});

	test("prefers Pro accounts for codex spark models over Plus accounts", async () => {
		if (!authStorage) throw new Error("test setup failed");

		await authStorage.set("openai-codex", [
			{ type: "oauth", ...createCredential("acct-plus", "plus@example.com") },
			{ type: "oauth", ...createCredential("acct-pro", "pro@example.com") },
		]);

		const plusReport = createCodexUsageReport({
			accountId: "acct-plus",
			primary: { usedFraction: 0.05, resetInMs: 30 * 60 * 1000 },
			secondary: { usedFraction: 0.05, resetInMs: 6 * 24 * 60 * 60 * 1000 },
		});
		plusReport.metadata = { ...plusReport.metadata, planType: "plus" };
		usageByAccount.set("acct-plus", plusReport);

		const proReport = createCodexUsageReport({
			accountId: "acct-pro",
			primary: { usedFraction: 0.2, resetInMs: 30 * 60 * 1000 },
			secondary: { usedFraction: 0.2, resetInMs: 6 * 24 * 60 * 60 * 1000 },
		});
		proReport.metadata = { ...proReport.metadata, planType: "pro" };
		usageByAccount.set("acct-pro", proReport);

		const apiKey = await authStorage.getApiKey("openai-codex", "session-spark-prefers-pro", {
			modelId: "gpt-5.3-codex-spark",
		});
		expect(apiKey).toBe("api-acct-pro");
	});

	test("routes codex spark to a single Plus account when no Pro is connected", async () => {
		if (!authStorage) throw new Error("test setup failed");

		await authStorage.set("openai-codex", [{ type: "oauth", ...createCredential("acct-plus", "plus@example.com") }]);

		const plusReport = createCodexUsageReport({
			accountId: "acct-plus",
			primary: { usedFraction: 0.05, resetInMs: 30 * 60 * 1000 },
			secondary: { usedFraction: 0.05, resetInMs: 6 * 24 * 60 * 60 * 1000 },
		});
		plusReport.metadata = { ...plusReport.metadata, planType: "plus" };
		usageByAccount.set("acct-plus", plusReport);

		const apiKey = await authStorage.getApiKey("openai-codex", "session-spark-single-plus", {
			modelId: "gpt-5.3-codex-spark",
		});
		expect(apiKey).toBe("api-acct-plus");
	});

	test("falls back to Plus accounts for codex spark models when no Pro is connected", async () => {
		if (!authStorage) throw new Error("test setup failed");

		await authStorage.set("openai-codex", [
			{ type: "oauth", ...createCredential("acct-plus-a", "plus-a@example.com") },
			{ type: "oauth", ...createCredential("acct-plus-b", "plus-b@example.com") },
		]);

		for (const accountId of ["acct-plus-a", "acct-plus-b"]) {
			const plusReport = createCodexUsageReport({
				accountId,
				primary: { usedFraction: 0.05, resetInMs: 30 * 60 * 1000 },
				secondary: { usedFraction: 0.05, resetInMs: 6 * 24 * 60 * 60 * 1000 },
			});
			plusReport.metadata = { ...plusReport.metadata, planType: "plus" };
			usageByAccount.set(accountId, plusReport);
		}

		const apiKey = await authStorage.getApiKey("openai-codex", "session-spark-all-plus", {
			modelId: "gpt-5.3-codex-spark",
		});
		expect(apiKey).toBeDefined();
		expect(apiKey?.startsWith("api-acct-plus-")).toBe(true);
	});

	test("times out slow usage ranking instead of blocking first account selection", async () => {
		if (!store) throw new Error("test setup failed");

		const slowAuthStorage = new AuthStorage(store, {
			usageProviderResolver: provider =>
				provider === "openai-codex"
					? ({
							id: "openai-codex",
							async fetchUsage(params) {
								const { promise, resolve } = Promise.withResolvers<UsageReport | null>();
								params.signal?.addEventListener("abort", () => resolve(null), { once: true });
								// 2s "would-block" fallback: if the per-request timeout below fails
								// to abort the fetch, ranking blocks for this long instead of the
								// ~10ms timeout path. Kept well above the assertion bound so a broken
								// timeout is still caught, while leaving generous slack for CI jitter.
								return Promise.race([promise, Bun.sleep(2_000).then(() => null)]);
							},
						} satisfies UsageProvider)
					: undefined,
			usageRequestTimeoutMs: 10,
		});

		await slowAuthStorage.set("openai-codex", [
			{ type: "oauth", ...createCredential("acct-first", "first@example.com") },
			{ type: "oauth", ...createCredential("acct-second", "second@example.com") },
		]);

		const startedAt = Date.now();
		const apiKey = await slowAuthStorage.getApiKey("openai-codex");
		const elapsedMs = Date.now() - startedAt;

		expect(apiKey).toBe("api-acct-first");
		// Timeout path resolves in ~10ms; the would-block fallback is 2s. A bound
		// of 1s proves the 10ms per-request timeout fired without being fooled by
		// the block path, and absorbs scheduling jitter under parallel CI load.
		expect(elapsedMs).toBeLessThan(1_000);
	});

	test("weights 3 accounts by weekly drain rate", async () => {
		if (!authStorage) throw new Error("test setup failed");

		await authStorage.set("openai-codex", [
			{ type: "oauth", ...createCredential("acct-fast", "fast@example.com") },
			{ type: "oauth", ...createCredential("acct-medium", "medium@example.com") },
			{ type: "oauth", ...createCredential("acct-slow", "slow@example.com") },
		]);

		usageByAccount.set(
			"acct-slow",
			createCodexUsageReport({
				accountId: "acct-slow",
				primary: { usedFraction: 0.2, resetInMs: 30 * 60 * 1000 },
				secondary: { usedFraction: 0.1, resetInMs: 6 * 24 * 60 * 60 * 1000 },
			}),
		);
		usageByAccount.set(
			"acct-medium",
			createCodexUsageReport({
				accountId: "acct-medium",
				primary: { usedFraction: 0.2, resetInMs: 30 * 60 * 1000 },
				secondary: { usedFraction: 0.3, resetInMs: 5 * 24 * 60 * 60 * 1000 },
			}),
		);
		usageByAccount.set(
			"acct-fast",
			createCodexUsageReport({
				accountId: "acct-fast",
				primary: { usedFraction: 0.2, resetInMs: 30 * 60 * 1000 },
				secondary: { usedFraction: 0.7, resetInMs: 3 * 24 * 60 * 60 * 1000 },
			}),
		);

		const counts = await countApiKeySelections(authStorage, "openai-codex", "weighted-codex-three");
		expect(countFor(counts, "api-acct-slow")).toBeGreaterThan(countFor(counts, "api-acct-medium"));
		expect(countFor(counts, "api-acct-slow")).toBeGreaterThan(countFor(counts, "api-acct-fast"));
	});

	test("does not allocate fresh known capacity to an account with no usage report", async () => {
		if (!authStorage) throw new Error("test setup failed");

		await authStorage.set("openai-codex", [
			{ type: "oauth", ...createCredential("acct-null", "null@example.com") },
			{ type: "oauth", ...createCredential("acct-known", "known@example.com") },
		]);

		// acct-null has no entry in usageByAccount — fetchUsage returns null
		usageByAccount.set(
			"acct-known",
			createCodexUsageReport({
				accountId: "acct-known",
				primary: { usedFraction: 0.2, resetInMs: 30 * 60 * 1000 },
				secondary: { usedFraction: 0.3, resetInMs: 5 * 24 * 60 * 60 * 1000 },
			}),
		);

		const counts = await countApiKeySelections(authStorage, "openai-codex", "weighted-codex-known", 300);
		expect(countFor(counts, "api-acct-known")).toBe(300);
		expect(countFor(counts, "api-acct-null")).toBe(0);
	});
	test("refreshes expired oauth candidates in parallel before selection", async () => {
		if (!authStorage) throw new Error("test setup failed");

		vi.spyOn(oauthUtils, "getOAuthApiKey").mockImplementation(async (_provider, credentials) => {
			const credential = credentials["openai-codex"] as OAuthCredentials | undefined;
			if (!credential?.accountId) return null;

			let nextCredential = credential;
			if (Date.now() >= credential.expires) {
				nextCredential = await oauthUtils.refreshOAuthToken("openai-codex", credential);
			}

			if (nextCredential.accountId === "acct-first" || nextCredential.accountId === "acct-second") {
				return null;
			}

			return {
				apiKey: nextCredential.access,
				newCredentials: nextCredential,
			};
		});

		const refreshDelayMs = 75;
		let inFlight = 0;
		let maxConcurrent = 0;
		const refreshStarts: number[] = [];
		vi.spyOn(oauthUtils, "refreshOAuthToken").mockImplementation(async (_provider, credential) => {
			refreshStarts.push(Date.now());
			inFlight += 1;
			maxConcurrent = Math.max(maxConcurrent, inFlight);
			await Bun.sleep(refreshDelayMs);
			inFlight -= 1;
			return {
				...credential,
				access: `refreshed-${credential.accountId}`,
				expires: Date.now() + HOUR_MS,
			};
		});

		const expiredAt = Date.now() - HOUR_MS;
		await authStorage.set("openai-codex", [
			{ type: "oauth", ...createCredential("acct-first", "first@example.com"), expires: expiredAt },
			{ type: "oauth", ...createCredential("acct-second", "second@example.com"), expires: expiredAt },
			{ type: "oauth", ...createCredential("acct-third", "third@example.com"), expires: expiredAt },
		]);

		const apiKey = await authStorage.getApiKey("openai-codex");

		expect(apiKey).toBe("refreshed-acct-third");
		expect(refreshStarts).toHaveLength(3);
		// Parallelism is proven deterministically by the concurrency counter: serial
		// refreshes never overlap (peak in-flight stays 1). A wall-clock bound here was
		// flaky on loaded CI runners, so maxConcurrent is the authoritative signal.
		expect(maxConcurrent).toBe(3);
	});
});

// ─────────────────────────────────────────────────────────────────────────────
// Claude (Anthropic) ranking tests
// ─────────────────────────────────────────────────────────────────────────────

function createClaudeLimit(args: {
	key: "5h" | "7d";
	durationMs: number;
	usedFraction: number;
	resetInMs: number;
}): UsageLimit {
	const clamped = Math.min(Math.max(args.usedFraction, 0), 1);
	const used = clamped * 100;
	const label = args.key === "5h" ? "Claude 5 Hour" : "Claude 7 Day";
	return {
		id: `anthropic:${args.key}`,
		label,
		scope: {
			provider: "anthropic",
			windowId: args.key,
			shared: true,
		},
		window: {
			id: args.key,
			label,
			durationMs: args.durationMs,
			resetsAt: Date.now() + args.resetInMs,
		},
		amount: {
			unit: "percent",
			used,
			limit: 100,
			remaining: 100 - used,
			usedFraction: clamped,
			remainingFraction: Math.max(0, 1 - clamped),
		},
		status: clamped >= 1 ? "exhausted" : clamped >= 0.9 ? "warning" : "ok",
	};
}

function createClaudeUsageReport(args: {
	accountId: string;
	primary: { usedFraction: number; resetInMs: number };
	secondary: { usedFraction: number; resetInMs: number };
}): UsageReport {
	return {
		provider: "anthropic",
		fetchedAt: Date.now(),
		limits: [
			createClaudeLimit({
				key: "5h",
				durationMs: FIVE_HOUR_MS,
				usedFraction: args.primary.usedFraction,
				resetInMs: args.primary.resetInMs,
			}),
			createClaudeLimit({
				key: "7d",
				durationMs: WEEK_MS,
				usedFraction: args.secondary.usedFraction,
				resetInMs: args.secondary.resetInMs,
			}),
		],
		metadata: { accountId: args.accountId },
	};
}

describe("AuthStorage claude oauth ranking", () => {
	let tempDir = "";
	let store: AuthCredentialStore | null = null;
	let authStorage: AuthStorage | null = null;
	const usageByAccount = new Map<string, UsageReport>();

	const usageProvider: UsageProvider = {
		id: "anthropic",
		async fetchUsage(params) {
			const accountId = params.credential.accountId;
			if (!accountId) return null;
			return usageByAccount.get(accountId) ?? null;
		},
	};

	beforeEach(async () => {
		tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "pi-ai-auth-claude-selection-"));
		store = await SqliteAuthCredentialStore.open(path.join(tempDir, "agent.db"));
		authStorage = new AuthStorage(store, {
			usageProviderResolver: provider => (provider === "anthropic" ? usageProvider : undefined),
		});
		usageByAccount.clear();
		vi.spyOn(oauthUtils, "getOAuthApiKey").mockImplementation(async (_provider, credentials) => {
			const credential = credentials.anthropic as OAuthCredentials | undefined;
			if (!credential?.accountId) return null;
			return {
				apiKey: `api-${credential.accountId}`,
				newCredentials: credential,
			};
		});
	});

	afterEach(async () => {
		vi.restoreAllMocks();
		store?.close();
		store = null;
		authStorage = null;
		if (tempDir) {
			await fs.rm(tempDir, { recursive: true, force: true });
			tempDir = "";
		}
	});

	test("weights lower secondary drain rate account", async () => {
		if (!authStorage) throw new Error("test setup failed");

		await authStorage.set("anthropic", [
			{ type: "oauth", ...createCredential("acct-near", "near@example.com") },
			{ type: "oauth", ...createCredential("acct-far", "far@example.com") },
		]);

		usageByAccount.set(
			"acct-near",
			createClaudeUsageReport({
				accountId: "acct-near",
				primary: { usedFraction: 0.4, resetInMs: 2 * HOUR_MS },
				secondary: { usedFraction: 0.92, resetInMs: 15 * 60 * 1000 },
			}),
		);
		usageByAccount.set(
			"acct-far",
			createClaudeUsageReport({
				accountId: "acct-far",
				primary: { usedFraction: 0.3, resetInMs: 4 * HOUR_MS },
				secondary: { usedFraction: 0.55, resetInMs: 6 * 24 * HOUR_MS },
			}),
		);

		const counts = await countApiKeySelections(authStorage, "anthropic", "weighted-claude-near");
		expectWeightedPreference(counts, "api-acct-near", "api-acct-far");
	});

	test("balances equal-priority accounts evenly", async () => {
		if (!authStorage) throw new Error("test setup failed");

		await authStorage.set("anthropic", [
			{ type: "oauth", ...createCredential("acct-a", "a@example.com") },
			{ type: "oauth", ...createCredential("acct-b", "b@example.com") },
		]);

		for (const accountId of ["acct-a", "acct-b"]) {
			usageByAccount.set(
				accountId,
				createClaudeUsageReport({
					accountId,
					primary: { usedFraction: 0.25, resetInMs: 4 * HOUR_MS },
					secondary: { usedFraction: 0.25, resetInMs: 4 * 24 * HOUR_MS },
				}),
			);
		}

		const counts = await countApiKeySelections(authStorage, "anthropic", "weighted-claude-equal", 200);
		expect(Math.abs(countFor(counts, "api-acct-a") - countFor(counts, "api-acct-b"))).toBeLessThanOrEqual(25);
	});

	test("caps the strongest priority bucket at about 2x baseline weight", async () => {
		if (!authStorage) throw new Error("test setup failed");

		await authStorage.set("anthropic", [
			{ type: "oauth", ...createCredential("acct-best", "best@example.com") },
			{ type: "oauth", ...createCredential("acct-base-a", "base-a@example.com") },
			{ type: "oauth", ...createCredential("acct-base-b", "base-b@example.com") },
		]);

		usageByAccount.set(
			"acct-best",
			createClaudeUsageReport({
				accountId: "acct-best",
				primary: { usedFraction: 0.05, resetInMs: 4 * HOUR_MS },
				secondary: { usedFraction: 0.05, resetInMs: 6 * 24 * HOUR_MS },
			}),
		);
		for (const accountId of ["acct-base-a", "acct-base-b"]) {
			usageByAccount.set(
				accountId,
				createClaudeUsageReport({
					accountId,
					primary: { usedFraction: 0.7, resetInMs: 2 * HOUR_MS },
					secondary: { usedFraction: 0.7, resetInMs: 2 * 24 * HOUR_MS },
				}),
			);
		}

		const counts = await countApiKeySelections(authStorage, "anthropic", "claude-cap", 300);
		expectWeightedPreference(counts, "api-acct-best", "api-acct-base-a");
		expectWeightedPreference(counts, "api-acct-best", "api-acct-base-b");
		expect(Math.abs(countFor(counts, "api-acct-base-a") - countFor(counts, "api-acct-base-b"))).toBeLessThanOrEqual(
			15,
		);
	});

	test("skips exhausted account and picks healthy", async () => {
		if (!authStorage) throw new Error("test setup failed");

		await authStorage.set("anthropic", [
			{ type: "oauth", ...createCredential("acct-exhausted", "exhausted@example.com") },
			{ type: "oauth", ...createCredential("acct-healthy", "healthy@example.com") },
		]);

		usageByAccount.set(
			"acct-exhausted",
			createClaudeUsageReport({
				accountId: "acct-exhausted",
				primary: { usedFraction: 1, resetInMs: 5 * 60 * 1000 },
				secondary: { usedFraction: 1, resetInMs: 5 * 60 * 1000 },
			}),
		);
		usageByAccount.set(
			"acct-healthy",
			createClaudeUsageReport({
				accountId: "acct-healthy",
				primary: { usedFraction: 0.5, resetInMs: 3 * HOUR_MS },
				secondary: { usedFraction: 0.4, resetInMs: 3 * 24 * HOUR_MS },
			}),
		);

		const apiKey = await authStorage.getApiKey("anthropic", "session-claude-exhausted");
		expect(apiKey).toBe("api-acct-healthy");
	});

	test("falls back to earliest-unblocking when all exhausted", async () => {
		if (!authStorage) throw new Error("test setup failed");

		await authStorage.set("anthropic", [
			{ type: "oauth", ...createCredential("acct-soon", "soon@example.com") },
			{ type: "oauth", ...createCredential("acct-later", "later@example.com") },
		]);

		usageByAccount.set(
			"acct-soon",
			createClaudeUsageReport({
				accountId: "acct-soon",
				primary: { usedFraction: 1, resetInMs: 5 * 60 * 1000 },
				secondary: { usedFraction: 1, resetInMs: 5 * 60 * 1000 },
			}),
		);
		usageByAccount.set(
			"acct-later",
			createClaudeUsageReport({
				accountId: "acct-later",
				primary: { usedFraction: 1, resetInMs: 30 * 60 * 1000 },
				secondary: { usedFraction: 1, resetInMs: 30 * 60 * 1000 },
			}),
		);

		const apiKey = await authStorage.getApiKey("anthropic", "session-claude-all-exhausted");
		expect(apiKey).toBe("api-acct-soon");
	});

	test("weights 3 accounts by secondary drain rate", async () => {
		if (!authStorage) throw new Error("test setup failed");

		await authStorage.set("anthropic", [
			{ type: "oauth", ...createCredential("acct-fast", "fast@example.com") },
			{ type: "oauth", ...createCredential("acct-medium", "medium@example.com") },
			{ type: "oauth", ...createCredential("acct-slow", "slow@example.com") },
		]);

		usageByAccount.set(
			"acct-slow",
			createClaudeUsageReport({
				accountId: "acct-slow",
				primary: { usedFraction: 0.2, resetInMs: 4 * HOUR_MS },
				secondary: { usedFraction: 0.1, resetInMs: 6 * 24 * HOUR_MS },
			}),
		);
		usageByAccount.set(
			"acct-medium",
			createClaudeUsageReport({
				accountId: "acct-medium",
				primary: { usedFraction: 0.2, resetInMs: 4 * HOUR_MS },
				secondary: { usedFraction: 0.3, resetInMs: 5 * 24 * HOUR_MS },
			}),
		);
		usageByAccount.set(
			"acct-fast",
			createClaudeUsageReport({
				accountId: "acct-fast",
				primary: { usedFraction: 0.2, resetInMs: 4 * HOUR_MS },
				secondary: { usedFraction: 0.7, resetInMs: 3 * 24 * HOUR_MS },
			}),
		);

		const counts = await countApiKeySelections(authStorage, "anthropic", "weighted-claude-three");
		expect(countFor(counts, "api-acct-slow")).toBeGreaterThan(countFor(counts, "api-acct-medium"));
		expect(countFor(counts, "api-acct-slow")).toBeGreaterThan(countFor(counts, "api-acct-fast"));
	});

	test("single credential works without ranking", async () => {
		if (!authStorage) throw new Error("test setup failed");

		await authStorage.set("anthropic", [{ type: "oauth", ...createCredential("acct-solo", "solo@example.com") }]);

		usageByAccount.set(
			"acct-solo",
			createClaudeUsageReport({
				accountId: "acct-solo",
				primary: { usedFraction: 0.3, resetInMs: 3 * HOUR_MS },
				secondary: { usedFraction: 0.2, resetInMs: 5 * 24 * HOUR_MS },
			}),
		);

		const apiKey = await authStorage.getApiKey("anthropic", "session-claude-single");
		expect(apiKey).toBe("api-acct-solo");
	});
});
