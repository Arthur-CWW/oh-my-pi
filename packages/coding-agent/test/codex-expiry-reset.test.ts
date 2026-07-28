import { afterEach, describe, expect, it } from "bun:test";
import * as fs from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";
import { type AuthCredentialStore, AuthStorage, type StoredAuthCredential, type UsageReport } from "@oh-my-pi/pi-ai";
import { Settings } from "@oh-my-pi/pi-coding-agent/config/settings";
import {
	type CodexExpiryClock,
	type CodexExpiryResetRuntime,
	CodexExpiryResetScheduler,
} from "@oh-my-pi/pi-coding-agent/session/codex-expiry-reset";
import { renderUsageReports } from "@oh-my-pi/pi-coding-agent/slash-commands/helpers/usage-report";

const NOW = Date.parse("2026-07-26T17:00:00Z");
const PACIFIC = "America/Los_Angeles";
const tempDirs: string[] = [];

interface FakeTimerEntry {
	at: number;
	callback: () => void;
	cancelled: boolean;
}

class FakeClock implements CodexExpiryClock {
	#nowMs: number;
	readonly #timers: FakeTimerEntry[] = [];

	constructor(nowMs: number) {
		this.#nowMs = nowMs;
	}

	now(): number {
		return this.#nowMs;
	}

	schedule(callback: () => void, delayMs: number) {
		const entry: FakeTimerEntry = { at: this.#nowMs + delayMs, callback, cancelled: false };
		this.#timers.push(entry);
		return { cancel: () => (entry.cancelled = true) };
	}

	get pendingCount(): number {
		return this.#timers.filter(entry => !entry.cancelled).length;
	}

	advanceTo(targetMs: number): void {
		for (;;) {
			const next = this.#timers
				.filter(entry => !entry.cancelled && entry.at <= targetMs)
				.sort((left, right) => left.at - right.at)[0];
			if (!next) break;
			next.cancelled = true;
			this.#nowMs = next.at;
			next.callback();
		}
		this.#nowMs = targetMs;
	}
}

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
				expires: Date.now() + 24 * 60 * 60_000,
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

function fixtureReport(expiresAt: number): UsageReport {
	return {
		provider: "openai-codex",
		fetchedAt: NOW,
		limits: [],
		resetCredits: { availableCount: 1, expiresAt },
		metadata: { accountId: "fixture-account", email: "fixture@example.com" },
	};
}

function createRuntime(storage: AuthStorage, baseUrl: string): CodexExpiryResetRuntime {
	return {
		list: options =>
			storage.listResetCredits({
				baseUrlResolver: () => baseUrl,
				signal: options?.signal,
				fresh: options?.fresh,
			}),
		redeem: options =>
			storage.redeemResetCredit({
				target: options.target,
				creditId: options.creditId,
				redeemRequestId: options.redeemRequestId,
				baseUrlResolver: () => baseUrl,
				signal: options.signal,
			}),
		refreshUsage: async () => {},
	};
}

async function tempStatePath(): Promise<string> {
	const directory = await fs.mkdtemp(path.join(os.tmpdir(), "codex-expiry-reset-"));
	tempDirs.push(directory);
	return path.join(directory, "receipts.json");
}

function settings(leadMinutes = 30): Settings {
	return Settings.isolated({
		"codexResets.autoRedeem": "yes",
		"codexResets.expiryLeadMinutes": leadMinutes,
	});
}

afterEach(async () => {
	await Promise.all(tempDirs.splice(0).map(directory => fs.rm(directory, { recursive: true, force: true })));
});

describe("Codex saved-reset expiry scheduler", () => {
	it("waits until the configured lead, rechecks, redeems one exact credit, and survives restart", async () => {
		const expiry = NOW + 2 * 60 * 60_000;
		let redeemed = false;
		let detailCalls = 0;
		const consumeBodies: Array<{ credit_id?: string; redeem_request_id?: string }> = [];
		const server = Bun.serve({
			hostname: "127.0.0.1",
			port: 0,
			async fetch(request) {
				const url = new URL(request.url);
				if (url.pathname === "/wham/rate-limit-reset-credits") {
					detailCalls += 1;
					return Response.json({
						available_count: redeemed ? 0 : 1,
						credits: [
							{
								id: "fixture-credit",
								status: redeemed ? "redeemed" : "available",
								redeemed_at: redeemed ? new Date(NOW).toISOString() : null,
								expires_at: new Date(expiry).toISOString(),
							},
						],
					});
				}
				if (url.pathname === "/wham/rate-limit-reset-credits/consume") {
					consumeBodies.push((await request.json()) as (typeof consumeBodies)[number]);
					redeemed = true;
					return Response.json({ code: "reset" });
				}
				return new Response("Not found", { status: 404 });
			},
		});
		const storage = new AuthStorage(makeStore());
		const statePath = await tempStatePath();
		const clock = new FakeClock(NOW);
		const scheduler = new CodexExpiryResetScheduler({
			runtime: createRuntime(storage, server.url.toString()),
			settings: settings(),
			clock,
			statePath,
		});
		const peerScheduler = new CodexExpiryResetScheduler({
			runtime: createRuntime(storage, server.url.toString()),
			settings: settings(),
			clock,
			statePath,
		});
		let restartedStorage: AuthStorage | undefined;
		let restarted: CodexExpiryResetScheduler | undefined;

		try {
			await storage.reload();
			scheduler.start();
			peerScheduler.start();
			await scheduler.waitForIdle();
			await peerScheduler.waitForIdle();
			expect(consumeBodies).toHaveLength(0);
			expect(detailCalls).toBe(1);

			const scheduledReports = await scheduler.observeReports([fixtureReport(expiry)]);
			const scheduledText = renderUsageReports(scheduledReports, NOW, PACIFIC);
			expect(scheduledText).toContain("expires Jul 26, 2026 at 12:00 PM PDT (in 2h)");
			expect(scheduledText).toContain("auto-redeem scheduled Jul 26, 2026 at 11:30 AM PDT (in 1h 30m)");

			await scheduler.stop();
			restartedStorage = new AuthStorage(makeStore());
			await restartedStorage.reload();
			restarted = new CodexExpiryResetScheduler({
				runtime: createRuntime(restartedStorage, server.url.toString()),
				settings: settings(),
				clock,
				statePath,
			});
			restarted.start();
			await restarted.waitForIdle();
			expect(detailCalls).toBe(2);

			clock.advanceTo(expiry - 30 * 60_000 - 1);
			await restarted.waitForIdle();
			expect(consumeBodies).toHaveLength(0);
			clock.advanceTo(expiry - 30 * 60_000);
			await restarted.waitForIdle();
			await peerScheduler.waitForIdle();
			expect(consumeBodies).toHaveLength(1);
			expect(detailCalls).toBe(3);
			expect(consumeBodies[0]?.credit_id).toBe("fixture-credit");
			expect(consumeBodies[0]?.redeem_request_id).toBeString();

			const receiptReports = await restarted.observeReports([fixtureReport(expiry)]);
			expect(renderUsageReports(receiptReports, clock.now(), PACIFIC)).toContain("auto-redeemed 0s ago");
		} finally {
			await scheduler.stop();
			await peerScheduler.stop();
			await restarted?.stop();
			restartedStorage?.close();
			storage.close();
			server.stop(true);
		}
	});

	it("uses one idempotency key across bounded retries and stops before expiry", async () => {
		const expiry = NOW + 60 * 60_000;
		const requestIds: string[] = [];
		let consumeCalls = 0;
		const server = Bun.serve({
			hostname: "127.0.0.1",
			port: 0,
			async fetch(request) {
				const url = new URL(request.url);
				if (url.pathname === "/wham/rate-limit-reset-credits") {
					return Response.json({
						available_count: 1,
						credits: [{ id: "retry-credit", status: "available", expires_at: new Date(expiry).toISOString() }],
					});
				}
				if (url.pathname === "/wham/rate-limit-reset-credits/consume") {
					consumeCalls += 1;
					const body = (await request.json()) as { redeem_request_id: string };
					requestIds.push(body.redeem_request_id);
					return Response.json({ code: "temporary_failure" }, { status: 503 });
				}
				return new Response("Not found", { status: 404 });
			},
		});
		const storage = new AuthStorage(makeStore());
		const statePath = await tempStatePath();
		const clock = new FakeClock(NOW);
		const scheduler = new CodexExpiryResetScheduler({
			runtime: createRuntime(storage, server.url.toString()),
			settings: settings(),
			clock,
			statePath,
		});

		try {
			await storage.reload();
			scheduler.start();
			await scheduler.waitForIdle();
			clock.advanceTo(expiry - 30 * 60_000);
			await scheduler.waitForIdle();
			for (const delay of [1, 2, 4]) {
				clock.advanceTo(clock.now() + delay * 60_000);
				await scheduler.waitForIdle();
			}
			expect(consumeCalls).toBe(4);
			expect(new Set(requestIds).size).toBe(1);
			const reports = await scheduler.observeReports([fixtureReport(expiry)]);
			expect(reports[0]?.resetCredits?.automation).toMatchObject({
				status: "failed",
				reason: "attempt-limit",
			});
			expect(renderUsageReports(reports, clock.now(), PACIFIC)).toContain("auto-redeem failed 0s ago");
			clock.advanceTo(expiry + 60_000);
			await scheduler.waitForIdle();
			expect(consumeCalls).toBe(4);
		} finally {
			await scheduler.stop();
			storage.close();
			server.stop(true);
		}
	});

	it("stays disabled while the capability route is unavailable and recovers on lifecycle refresh", async () => {
		const expiry = NOW + 2 * 60 * 60_000;
		let capabilityAvailable = false;
		let consumeCalls = 0;
		const server = Bun.serve({
			hostname: "127.0.0.1",
			port: 0,
			fetch(request) {
				const url = new URL(request.url);
				if (url.pathname === "/wham/rate-limit-reset-credits") {
					if (!capabilityAvailable) return Response.json({ error: "unavailable" }, { status: 404 });
					return Response.json({
						available_count: 1,
						credits: [
							{ id: "recovered-credit", status: "available", expires_at: new Date(expiry).toISOString() },
						],
					});
				}
				if (url.pathname === "/wham/rate-limit-reset-credits/consume") {
					consumeCalls += 1;
					return Response.json({ code: "reset" });
				}
				return new Response("Not found", { status: 404 });
			},
		});
		const storage = new AuthStorage(makeStore());
		const clock = new FakeClock(NOW);
		const scheduler = new CodexExpiryResetScheduler({
			runtime: createRuntime(storage, server.url.toString()),
			settings: settings(),
			clock,
			statePath: await tempStatePath(),
		});
		try {
			await storage.reload();
			scheduler.start();
			await scheduler.waitForIdle();
			expect(consumeCalls).toBe(0);
			capabilityAvailable = true;
			scheduler.requestRefresh();
			await scheduler.waitForIdle();
			clock.advanceTo(expiry - 30 * 60_000);
			await scheduler.waitForIdle();
			expect(consumeCalls).toBe(1);
		} finally {
			await scheduler.stop();
			storage.close();
			server.stop(true);
		}
	});

	it("honors manual reset mode without scheduling and explains it in usage", async () => {
		const expiry = NOW + 2 * 60 * 60_000;
		let detailCalls = 0;
		let consumeCalls = 0;
		const server = Bun.serve({
			hostname: "127.0.0.1",
			port: 0,
			fetch(request) {
				const url = new URL(request.url);
				if (url.pathname === "/wham/rate-limit-reset-credits") detailCalls += 1;
				if (url.pathname === "/wham/rate-limit-reset-credits/consume") consumeCalls += 1;
				return Response.json({
					available_count: 1,
					credits: [{ id: "manual-credit", status: "available", expires_at: new Date(expiry).toISOString() }],
				});
			},
		});
		const storage = new AuthStorage(makeStore());
		const clock = new FakeClock(NOW);
		const statePath = await tempStatePath();
		const scheduler = new CodexExpiryResetScheduler({
			runtime: createRuntime(storage, server.url.toString()),
			settings: Settings.isolated({
				"auth.codexUsageReset": "manual",
				"codexResets.autoRedeem": "yes",
				"codexResets.expiryLeadMinutes": 30,
			}),
			clock,
			statePath,
		});
		try {
			await storage.reload();
			scheduler.start();
			await scheduler.waitForIdle();
			expect(detailCalls).toBe(0);
			expect(clock.pendingCount).toBe(0);
			const reports = await scheduler.observeReports([fixtureReport(expiry)]);
			expect(reports[0]?.resetCredits?.automation).toEqual({
				status: "disabled",
				updatedAt: NOW,
				reason: "manual-mode",
			});
			expect(renderUsageReports(reports, NOW, PACIFIC)).toContain("auto-redeem disabled by manual reset mode");
			clock.advanceTo(expiry + 60_000);
			await scheduler.waitForIdle();
			expect(consumeCalls).toBe(0);
			expect(await Bun.file(statePath).exists()).toBe(false);
			await scheduler.stop();
			const stoppedReports = await scheduler.observeReports([fixtureReport(expiry)]);
			expect(stoppedReports[0]?.resetCredits?.automation).toBeUndefined();
			expect(await Bun.file(statePath).exists()).toBe(false);
		} finally {
			await scheduler.stop();
			storage.close();
			server.stop(true);
		}
	});

	it("stop aborts and awaits an in-flight refresh without phantom state", async () => {
		const expiry = NOW + 2 * 60 * 60_000;
		const requestStarted = Promise.withResolvers<void>();
		const responseGate = Promise.withResolvers<Response>();
		const server = Bun.serve({
			hostname: "127.0.0.1",
			port: 0,
			fetch(request) {
				if (new URL(request.url).pathname !== "/wham/rate-limit-reset-credits") {
					return new Response("Not found", { status: 404 });
				}
				requestStarted.resolve();
				return responseGate.promise;
			},
		});
		const storage = new AuthStorage(makeStore());
		const clock = new FakeClock(NOW);
		const statePath = await tempStatePath();
		const scheduler = new CodexExpiryResetScheduler({
			runtime: createRuntime(storage, server.url.toString()),
			settings: settings(),
			clock,
			statePath,
		});
		try {
			await storage.reload();
			scheduler.start();
			await requestStarted.promise;
			await scheduler.stop();
			responseGate.resolve(
				Response.json({
					available_count: 1,
					credits: [{ id: "late-credit", status: "available", expires_at: new Date(expiry).toISOString() }],
				}),
			);
			expect(clock.pendingCount).toBe(0);
			expect(await Bun.file(statePath).exists()).toBe(false);
			const reports = await scheduler.observeReports([fixtureReport(expiry)]);
			expect(reports[0]?.resetCredits?.automation).toBeUndefined();
			expect(clock.pendingCount).toBe(0);
		} finally {
			await scheduler.stop();
			responseGate.resolve(new Response("Stopped", { status: 499 }));
			storage.close();
			server.stop(true);
		}
	});

	it("reconciles an email-only usage report with an accountId-enriched detail status", async () => {
		const expiry = NOW + 2 * 60 * 60_000;
		let capabilityAvailable = false;
		let consumeCalls = 0;
		const server = Bun.serve({
			hostname: "127.0.0.1",
			port: 0,
			fetch(request) {
				const url = new URL(request.url);
				if (url.pathname === "/wham/rate-limit-reset-credits") {
					if (!capabilityAvailable) return Response.json({ error: "not ready" }, { status: 404 });
					return Response.json({
						available_count: 1,
						credits: [
							{ id: "identity-drift-credit", status: "available", expires_at: new Date(expiry).toISOString() },
						],
					});
				}
				if (url.pathname === "/wham/rate-limit-reset-credits/consume") {
					consumeCalls += 1;
					return Response.json({ code: "reset" });
				}
				return new Response("Not found", { status: 404 });
			},
		});
		const storage = new AuthStorage(makeStore());
		const clock = new FakeClock(NOW);
		const scheduler = new CodexExpiryResetScheduler({
			runtime: createRuntime(storage, server.url.toString()),
			settings: settings(),
			clock,
			statePath: await tempStatePath(),
		});
		try {
			await storage.reload();
			scheduler.start();
			await scheduler.waitForIdle();
			capabilityAvailable = true;
			const emailOnlyReport: UsageReport = {
				...fixtureReport(expiry),
				metadata: { email: "fixture@example.com" },
			};
			await scheduler.observeReports([emailOnlyReport]);
			await scheduler.waitForIdle();
			clock.advanceTo(expiry - 30 * 60_000);
			await scheduler.waitForIdle();
			expect(consumeCalls).toBe(1);
		} finally {
			await scheduler.stop();
			storage.close();
			server.stop(true);
		}
	});

	it("does not schedule a credit with an absent or malformed expiry", async () => {
		let consumeCalls = 0;
		const server = Bun.serve({
			hostname: "127.0.0.1",
			port: 0,
			fetch(request) {
				const url = new URL(request.url);
				if (url.pathname === "/wham/rate-limit-reset-credits") {
					return Response.json({
						available_count: 2,
						credits: [
							{ id: "missing-expiry", status: "available" },
							{ id: "malformed-expiry", status: "available", expires_at: "not-a-date" },
						],
					});
				}
				if (url.pathname === "/wham/rate-limit-reset-credits/consume") consumeCalls += 1;
				return new Response("Not found", { status: 404 });
			},
		});
		const storage = new AuthStorage(makeStore());
		const clock = new FakeClock(NOW);
		const scheduler = new CodexExpiryResetScheduler({
			runtime: createRuntime(storage, server.url.toString()),
			settings: settings(),
			clock,
			statePath: await tempStatePath(),
		});
		try {
			await storage.reload();
			scheduler.start();
			await scheduler.waitForIdle();
			clock.advanceTo(NOW + 24 * 60 * 60_000);
			await scheduler.waitForIdle();
			expect(consumeCalls).toBe(0);
		} finally {
			await scheduler.stop();
			storage.close();
			server.stop(true);
		}
	});
});
