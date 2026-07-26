import { describe, expect, it } from "bun:test";
import { type AuthCredentialStore, AuthStorage, type StoredAuthCredential } from "@oh-my-pi/pi-ai/auth-storage";

interface CacheEntry {
	value: string;
	expiresAtSec: number;
}

function makeStore(): AuthCredentialStore {
	const rows: StoredAuthCredential[] = [
		{
			id: 1,
			provider: "openai-codex",
			credential: {
				type: "oauth",
				access: "fixture-access-token",
				refresh: "fixture-refresh-token",
				expires: Date.now() + 60 * 60_000,
				accountId: "fixture-account",
				email: "fixture@example.com",
			},
			disabledCause: null,
		},
	];
	const cache = new Map<string, CacheEntry>();
	return {
		close() {},
		listAuthCredentials: () => rows,
		updateAuthCredential() {},
		deleteAuthCredential() {},
		tryDisableAuthCredentialIfMatches: () => false,
		replaceAuthCredentialsForProvider: () => rows,
		upsertAuthCredentialForProvider: () => rows,
		deleteAuthCredentialsForProvider() {},
		getCache(key, options) {
			const entry = cache.get(key);
			if (!entry || (!options?.includeExpired && entry.expiresAtSec * 1000 <= Date.now())) return null;
			return entry.value;
		},
		setCache(key, value, expiresAtSec) {
			cache.set(key, { value, expiresAtSec });
		},
		cleanExpiredCache() {},
	};
}

function usagePayload(availableCount: number): unknown {
	return {
		plan_type: "pro",
		rate_limit: {
			allowed: true,
			limit_reached: false,
			primary_window: {
				used_percent: 10,
				limit_window_seconds: 18_000,
				reset_at: Math.floor((Date.now() + 60 * 60_000) / 1000),
			},
		},
		rate_limit_reset_credits: { available_count: availableCount },
	};
}

function json(payload: unknown, status = 200): Response {
	return Response.json(payload, { status });
}

describe("AuthStorage Codex reset-credit expiry", () => {
	it("uses the earliest future redeemable expiry and reuses an already-fetched detail list", async () => {
		const nowMs = Date.now();
		const earliest = new Date(nowMs + 4 * 60 * 60_000).toISOString();
		const later = new Date(nowMs + 24 * 60 * 60_000).toISOString();
		let detailCalls = 0;
		const server = Bun.serve({
			hostname: "127.0.0.1",
			port: 0,
			fetch(request) {
				const { pathname } = new URL(request.url);
				if (pathname === "/wham/usage") return json(usagePayload(2));
				if (pathname === "/wham/rate-limit-reset-credits") {
					detailCalls += 1;
					return json({
						available_count: 2,
						credits: [
							{ id: "later", status: "available", expires_at: later },
							{ id: "expired", status: "available", expires_at: new Date(nowMs - 60_000).toISOString() },
							{ id: "redeemed", status: "redeemed", expires_at: new Date(nowMs + 60_000).toISOString() },
							{
								id: "redeemed-at",
								status: "available",
								redeemed_at: new Date(nowMs).toISOString(),
								expires_at: new Date(nowMs + 2 * 60_000).toISOString(),
							},
							{
								id: "in-progress",
								status: "available",
								redeem_started_at: new Date(nowMs).toISOString(),
								expires_at: new Date(nowMs + 3 * 60_000).toISOString(),
							},
							{ id: "earliest", status: "available", expires_at: earliest },
						],
					});
				}
				return new Response("Not found", { status: 404 });
			},
		});
		const storage = new AuthStorage(makeStore());
		const baseUrl = server.url.toString();

		try {
			await storage.reload();
			const statuses = await storage.listResetCredits({ baseUrlResolver: () => baseUrl });
			expect(statuses[0]?.availableCount).toBe(2);

			const reports = await storage.fetchUsageReports({ baseUrlResolver: () => baseUrl });
			const report = reports?.find(candidate => candidate.provider === "openai-codex");
			expect(report?.resetCredits).toEqual({
				availableCount: 2,
				expiresAt: Date.parse(earliest),
			});
			expect(detailCalls).toBe(1);
		} finally {
			storage.close();
			server.stop(true);
		}
	});

	it("keeps the count-only usage report when the detail endpoint fails", async () => {
		let detailCalls = 0;
		const server = Bun.serve({
			hostname: "127.0.0.1",
			port: 0,
			fetch(request) {
				const { pathname } = new URL(request.url);
				if (pathname === "/wham/usage") return json(usagePayload(3));
				if (pathname === "/wham/rate-limit-reset-credits") {
					detailCalls += 1;
					return json({ error: "fixture failure" }, 503);
				}
				return new Response("Not found", { status: 404 });
			},
		});
		const storage = new AuthStorage(makeStore());

		try {
			await storage.reload();
			const reports = await storage.fetchUsageReports({ baseUrlResolver: () => server.url.toString() });
			const report = reports?.find(candidate => candidate.provider === "openai-codex");
			expect(report?.limits.length).toBeGreaterThan(0);
			expect(report?.resetCredits).toEqual({ availableCount: 3 });
			expect(detailCalls).toBe(1);
		} finally {
			storage.close();
			server.stop(true);
		}
	});
});
