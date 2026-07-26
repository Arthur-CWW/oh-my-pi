import * as fs from "node:fs/promises";
import * as path from "node:path";
import type {
	ResetCreditAccountStatus,
	ResetCreditRedeemOutcome,
	ResetCreditTarget,
	UsageReport,
	UsageResetAutomation,
} from "@oh-my-pi/pi-ai";
import { findEarliestRedeemableCodexResetCredit } from "@oh-my-pi/pi-ai/usage/openai-codex-reset";
import { getAgentDir, isEnoent, logger } from "@oh-my-pi/pi-utils";
import { z } from "zod";
import { updateConfigAtomically } from "../config/atomic-config-writer";
import { withFileLock } from "../config/file-lock";
import type { ModelRegistry } from "../config/model-registry";
import type { Settings } from "../config/settings";

export const DEFAULT_EXPIRY_LEAD_MINUTES = 30;
export const MIN_EXPIRY_LEAD_MINUTES = 5;
export const MAX_EXPIRY_LEAD_MINUTES = 24 * 60;
export const MAX_EXPIRY_REDEEM_ATTEMPTS = 4;
const MAX_TIMER_DELAY_MS = 24 * 60 * 60_000;
const RECEIPT_RETENTION_MS = 24 * 60 * 60_000;
const CONSUME_TIMEOUT_MS = 15_000;

const receiptEntrySchema = z.object({
	expiresAt: z.number(),
	status: z.enum(["scheduled", "retrying", "redeemed", "failed"]),
	updatedAt: z.number(),
	nextAttemptAt: z.number().optional(),
	reason: z.enum(["transport", "provider", "expired", "attempt-limit", "capability-unavailable"]).optional(),
	attempts: z.number().int().min(0),
	redeemRequestId: z.string().optional(),
});
const receiptStateSchema = z.object({
	version: z.literal(1),
	accounts: z.record(z.string(), receiptEntrySchema),
});
type ReceiptEntry = z.infer<typeof receiptEntrySchema>;
type ReceiptState = z.infer<typeof receiptStateSchema>;

const EMPTY_STATE: ReceiptState = { version: 1, accounts: {} };

export interface CodexExpiryTimer {
	cancel(): void;
}

export interface CodexExpiryClock {
	now(): number;
	schedule(callback: () => void, delayMs: number): CodexExpiryTimer;
}

const SYSTEM_CLOCK: CodexExpiryClock = {
	now: Date.now,
	schedule(callback, delayMs) {
		const timer = setTimeout(callback, delayMs);
		timer.unref?.();
		return { cancel: () => clearTimeout(timer) };
	},
};

export interface CodexExpiryResetRuntime {
	list(options?: { signal?: AbortSignal; fresh?: boolean }): Promise<ResetCreditAccountStatus[]>;
	redeem(options: {
		target: ResetCreditTarget;
		creditId: string;
		redeemRequestId: string;
		signal?: AbortSignal;
	}): Promise<ResetCreditRedeemOutcome>;
	refreshUsage(): Promise<void>;
}

export interface CodexExpiryResetSchedulerOptions {
	runtime: CodexExpiryResetRuntime;
	settings: Settings;
	clock?: CodexExpiryClock;
	statePath?: string;
}

interface ScheduledAccount {
	accountKey: string;
	target: ResetCreditTarget;
	expiresAt: number;
	dueAt: number;
	timer?: CodexExpiryTimer;
}

function normalizeIdentity(value: string | undefined): string | undefined {
	return value?.trim().toLowerCase() || undefined;
}

function accountKeyOf(value: { accountId?: string; email?: string }): string | undefined {
	return normalizeIdentity(value.accountId) ?? normalizeIdentity(value.email);
}

function statusMatchesTarget(status: ResetCreditAccountStatus, target: ResetCreditTarget): boolean {
	if (
		status.credentialId !== undefined &&
		target.credentialId !== undefined &&
		status.credentialId === target.credentialId
	) {
		return true;
	}
	const statusAccountId = normalizeIdentity(status.accountId);
	const targetAccountId = normalizeIdentity(target.accountId);
	if (statusAccountId && targetAccountId && statusAccountId === targetAccountId) return true;
	const statusEmail = normalizeIdentity(status.email);
	const targetEmail = normalizeIdentity(target.email);
	return Boolean(statusEmail && targetEmail && statusEmail === targetEmail);
}

function accountHash(accountKey: string): string {
	return Bun.hash(accountKey).toString(16);
}

function clampExpiryLeadMinutes(value: number): number {
	if (!Number.isFinite(value)) return DEFAULT_EXPIRY_LEAD_MINUTES;
	return Math.min(MAX_EXPIRY_LEAD_MINUTES, Math.max(MIN_EXPIRY_LEAD_MINUTES, Math.trunc(value)));
}

function retryDelayMs(attempts: number): number {
	return Math.min(5 * 60_000, 60_000 * 2 ** Math.max(0, attempts - 1));
}

async function readReceiptState(statePath: string): Promise<ReceiptState> {
	try {
		const parsed = receiptStateSchema.safeParse(await Bun.file(statePath).json());
		if (!parsed.success) throw new Error("Invalid Codex expiry-reset receipt state");
		return parsed.data;
	} catch (error) {
		if (isEnoent(error)) return EMPTY_STATE;
		throw error;
	}
}

export class CodexExpiryResetScheduler {
	readonly #runtime: CodexExpiryResetRuntime;
	readonly #settings: Settings;
	readonly #clock: CodexExpiryClock;
	readonly #statePath: string;
	readonly #lockDir: string;
	readonly #scheduled = new Map<string, ScheduledAccount>();
	readonly #inFlight = new Set<Promise<void>>();
	#refreshInFlight: Promise<void> | undefined;
	#refreshAbortController: AbortController | undefined;
	#started = false;

	constructor(options: CodexExpiryResetSchedulerOptions) {
		this.#runtime = options.runtime;
		this.#settings = options.settings;
		this.#clock = options.clock ?? SYSTEM_CLOCK;
		this.#statePath = options.statePath ?? path.join(getAgentDir(), "codex-reset-expiry.json");
		this.#lockDir = path.join(path.dirname(this.#statePath), "codex-reset-expiry-locks");
	}

	#track(task: Promise<void>): void {
		const tracked = task.catch(() => {
			logger.debug("codex-expiry-reset background task failed");
		});
		this.#inFlight.add(tracked);
		void tracked.then(() => this.#inFlight.delete(tracked));
	}

	start(): void {
		if (this.#started) return;
		this.#started = true;
		this.requestRefresh();
	}

	async stop(): Promise<void> {
		if (!this.#started && this.#inFlight.size === 0) return;
		this.#started = false;
		this.#refreshAbortController?.abort();
		for (const scheduled of this.#scheduled.values()) scheduled.timer?.cancel();
		this.#scheduled.clear();
		await this.#refreshInFlight;
		await this.waitForIdle();
		for (const scheduled of this.#scheduled.values()) scheduled.timer?.cancel();
		this.#scheduled.clear();
	}

	requestRefresh(): void {
		if (!this.#started || this.#refreshInFlight) return;
		const controller = new AbortController();
		const signal = AbortSignal.any([controller.signal, AbortSignal.timeout(CONSUME_TIMEOUT_MS)]);
		const run = this.refresh(signal).catch(() => {
			if (!controller.signal.aborted) logger.debug("codex-expiry-reset refresh failed");
		});
		this.#refreshAbortController = controller;
		this.#refreshInFlight = run;
		this.#track(run);
		void run.then(() => {
			if (this.#refreshInFlight === run) this.#refreshInFlight = undefined;
			if (this.#refreshAbortController === controller) this.#refreshAbortController = undefined;
		});
	}

	async waitForIdle(): Promise<void> {
		while (this.#inFlight.size > 0) await Promise.all([...this.#inFlight]);
	}

	async refresh(signal: AbortSignal): Promise<void> {
		if (!this.#enabled()) return;
		const statuses = await this.#runtime.list({ signal });
		if (!this.#started || signal.aborted) return;
		const nowMs = this.#clock.now();
		for (const status of statuses) {
			if (!this.#started || signal.aborted) return;
			this.#observeStatus(status, nowMs);
		}
	}

	async observeReports(reports: UsageReport[]): Promise<UsageReport[]> {
		if (!this.#started) return reports;
		const nowMs = this.#clock.now();
		if (this.#manualMode()) {
			return reports.map(report =>
				report.provider === "openai-codex" && report.resetCredits
					? {
							...report,
							resetCredits: {
								...report.resetCredits,
								automation: { status: "disabled", updatedAt: nowMs, reason: "manual-mode" },
							},
						}
					: report,
			);
		}
		if (this.#started && this.#enabled()) {
			const reserve = Math.max(0, Math.trunc(this.#settings.getGroup("codexResets").keepCredits));
			for (const report of reports) {
				if (report.provider !== "openai-codex" || !report.resetCredits?.expiresAt) continue;
				if (report.resetCredits.availableCount - reserve < 1) continue;
				const target = {
					accountId: typeof report.metadata?.accountId === "string" ? report.metadata.accountId : undefined,
					email: typeof report.metadata?.email === "string" ? report.metadata.email : undefined,
				};
				this.#schedule(target, report.resetCredits.expiresAt, nowMs);
			}
		}
		return this.#projectReceipts(reports, nowMs);
	}

	#manualMode(): boolean {
		return this.#settings.get("auth.codexUsageReset") === "manual";
	}

	#enabled(): boolean {
		return !this.#manualMode() && this.#settings.getGroup("codexResets").autoRedeem === "yes";
	}

	#observeStatus(status: ResetCreditAccountStatus, nowMs: number): void {
		const reserve = Math.max(0, Math.trunc(this.#settings.getGroup("codexResets").keepCredits));
		if (status.error || status.availableCount - reserve < 1) return;
		const earliest = findEarliestRedeemableCodexResetCredit(status.credits, nowMs);
		if (!earliest) return;
		this.#schedule(
			{ credentialId: status.credentialId, accountId: status.accountId, email: status.email },
			earliest.expiresAt,
			nowMs,
		);
	}

	#schedule(target: ResetCreditTarget, expiresAt: number, nowMs: number): void {
		const accountKey = accountKeyOf(target);
		if (!accountKey || !Number.isFinite(expiresAt) || expiresAt <= nowMs) return;
		const cfg = this.#settings.getGroup("codexResets");
		const dueAt = expiresAt - clampExpiryLeadMinutes(cfg.expiryLeadMinutes) * 60_000;
		const existing = this.#scheduled.get(accountKey);
		if (existing?.expiresAt === expiresAt && existing.dueAt === dueAt) return;
		existing?.timer?.cancel();
		const scheduled: ScheduledAccount = {
			accountKey,
			target,
			expiresAt,
			dueAt,
		};
		this.#scheduled.set(accountKey, scheduled);
		this.#arm(scheduled);
		this.#track(
			this.#writeEntry(accountHash(accountKey), current => {
				if (current?.expiresAt === expiresAt && current.status === "redeemed") return current;
				return {
					expiresAt,
					status: "scheduled",
					updatedAt: nowMs,
					nextAttemptAt: Math.max(nowMs, dueAt),
					attempts: current?.expiresAt === expiresAt ? current.attempts : 0,
					redeemRequestId: current?.expiresAt === expiresAt ? current.redeemRequestId : undefined,
				};
			})
				.then(() => undefined)
				.catch(() => logger.debug("codex-expiry-reset receipt write failed")),
		);
	}

	#arm(scheduled: ScheduledAccount): void {
		const remainingMs = Math.max(0, scheduled.dueAt - this.#clock.now());
		const delayMs = Math.min(MAX_TIMER_DELAY_MS, remainingMs);
		scheduled.timer = this.#clock.schedule(() => {
			if (!this.#started || this.#scheduled.get(scheduled.accountKey) !== scheduled) return;
			if (this.#clock.now() < scheduled.dueAt) {
				this.#arm(scheduled);
				return;
			}
			this.#track(this.#attempt(scheduled));
		}, delayMs);
	}

	async #attempt(scheduled: ScheduledAccount): Promise<void> {
		const keyHash = accountHash(scheduled.accountKey);
		await fs.mkdir(this.#lockDir, { recursive: true });
		try {
			await withFileLock(path.join(this.#lockDir, "redeem"), async () => this.#attemptLocked(scheduled, keyHash), {
				retries: 1,
				staleMs: 60_000,
			});
		} catch {
			await this.#scheduleRetry(scheduled, keyHash, "transport");
		}
	}

	async #attemptLocked(scheduled: ScheduledAccount, keyHash: string): Promise<void> {
		const nowMs = this.#clock.now();
		if (!this.#enabled()) {
			scheduled.timer?.cancel();
			this.#scheduled.delete(scheduled.accountKey);
			return;
		}
		const prior = (await readReceiptState(this.#statePath)).accounts[keyHash];
		if (prior?.expiresAt === scheduled.expiresAt && prior.status === "redeemed") {
			scheduled.timer?.cancel();
			this.#scheduled.delete(scheduled.accountKey);
			return;
		}
		if (nowMs >= scheduled.expiresAt) {
			await this.#finalFailure(scheduled, keyHash, "expired");
			return;
		}

		const statuses = await this.#runtime.list({
			signal: AbortSignal.timeout(CONSUME_TIMEOUT_MS),
			fresh: true,
		});
		const checkedAt = this.#clock.now();
		if (checkedAt >= scheduled.expiresAt) {
			await this.#finalFailure(scheduled, keyHash, "expired");
			return;
		}
		const status = statuses.find(candidate => statusMatchesTarget(candidate, scheduled.target));
		if (!status || status.error) {
			await this.#finalFailure(scheduled, keyHash, "capability-unavailable");
			return;
		}
		const reserve = Math.max(0, Math.trunc(this.#settings.getGroup("codexResets").keepCredits));
		if (status.availableCount - reserve < 1) {
			await this.#finalFailure(scheduled, keyHash, "provider");
			return;
		}
		const earliest = findEarliestRedeemableCodexResetCredit(status.credits, checkedAt);
		if (!earliest) {
			await this.#finalFailure(scheduled, keyHash, "provider");
			return;
		}
		if (earliest.expiresAt !== scheduled.expiresAt) {
			this.#scheduled.delete(scheduled.accountKey);
			this.#schedule(
				{ credentialId: status.credentialId, accountId: status.accountId, email: status.email },
				earliest.expiresAt,
				checkedAt,
			);
			return;
		}

		let entry = (await readReceiptState(this.#statePath)).accounts[keyHash];
		if (entry?.expiresAt === scheduled.expiresAt && entry.status === "redeemed") return;
		const attempts = entry?.expiresAt === scheduled.expiresAt ? entry.attempts + 1 : 1;
		if (attempts > MAX_EXPIRY_REDEEM_ATTEMPTS) {
			await this.#finalFailure(scheduled, keyHash, "attempt-limit");
			return;
		}
		const redeemRequestId =
			entry?.expiresAt === scheduled.expiresAt && entry.redeemRequestId
				? entry.redeemRequestId
				: crypto.randomUUID();
		entry = await this.#writeEntry(keyHash, () => ({
			expiresAt: scheduled.expiresAt,
			status: "retrying",
			updatedAt: checkedAt,
			attempts,
			redeemRequestId,
		}));

		let outcome: ResetCreditRedeemOutcome;
		try {
			outcome = await this.#runtime.redeem({
				target: { credentialId: status.credentialId, accountId: status.accountId, email: status.email },
				creditId: earliest.credit.id,
				redeemRequestId,
				signal: AbortSignal.timeout(CONSUME_TIMEOUT_MS),
			});
		} catch {
			await this.#scheduleRetry(scheduled, keyHash, "transport");
			return;
		}

		if (outcome.code === "reset" || outcome.code === "already_redeemed") {
			scheduled.timer?.cancel();
			this.#scheduled.delete(scheduled.accountKey);
			await this.#writeEntry(keyHash, current => {
				if (current && current.expiresAt !== scheduled.expiresAt) return current;
				return {
					expiresAt: scheduled.expiresAt,
					status: "redeemed",
					updatedAt: this.#clock.now(),
					attempts: current?.attempts ?? attempts,
				};
			});
			await this.#runtime.refreshUsage();
			return;
		}
		if (outcome.code.startsWith("http_") || (outcome.status !== undefined && outcome.status >= 500)) {
			await this.#scheduleRetry(scheduled, keyHash, "provider");
			return;
		}
		await this.#finalFailure(scheduled, keyHash, "provider");
	}

	async #scheduleRetry(scheduled: ScheduledAccount, keyHash: string, reason: "transport" | "provider"): Promise<void> {
		if (!this.#started) return;
		const current = (await readReceiptState(this.#statePath)).accounts[keyHash];
		if (current?.expiresAt === scheduled.expiresAt && current.status === "redeemed") {
			scheduled.timer?.cancel();
			this.#scheduled.delete(scheduled.accountKey);
			return;
		}
		const recordedAttempts = current?.expiresAt === scheduled.expiresAt ? current.attempts : 0;
		const attempts =
			current?.status === "retrying" && current.reason === undefined ? recordedAttempts : recordedAttempts + 1;
		if (attempts >= MAX_EXPIRY_REDEEM_ATTEMPTS) {
			await this.#finalFailure(scheduled, keyHash, "attempt-limit");
			return;
		}
		const nextAttemptAt = this.#clock.now() + retryDelayMs(attempts);
		if (nextAttemptAt >= scheduled.expiresAt) {
			await this.#finalFailure(scheduled, keyHash, "expired");
			return;
		}
		scheduled.dueAt = nextAttemptAt;
		await this.#writeEntry(keyHash, entry => ({
			expiresAt: scheduled.expiresAt,
			status: "retrying",
			updatedAt: this.#clock.now(),
			nextAttemptAt,
			reason,
			attempts,
			redeemRequestId: entry?.redeemRequestId,
		}));
		this.#arm(scheduled);
	}

	async #finalFailure(
		scheduled: ScheduledAccount,
		keyHash: string,
		reason: "provider" | "expired" | "attempt-limit" | "capability-unavailable",
	): Promise<void> {
		scheduled.timer?.cancel();
		this.#scheduled.delete(scheduled.accountKey);
		await this.#writeEntry(keyHash, current => {
			if (
				current &&
				(current.expiresAt !== scheduled.expiresAt ||
					(current.expiresAt === scheduled.expiresAt && current.status === "redeemed"))
			) {
				return current;
			}
			return {
				expiresAt: scheduled.expiresAt,
				status: "failed",
				updatedAt: this.#clock.now(),
				reason,
				attempts: current?.attempts ?? 0,
			};
		});
	}

	async #writeEntry(
		keyHash: string,
		update: (current: ReceiptEntry | undefined) => ReceiptEntry,
	): Promise<ReceiptEntry> {
		if (!this.#started) throw new Error("Codex expiry-reset scheduler stopped");
		await fs.mkdir(path.dirname(this.#statePath), { recursive: true });
		return updateConfigAtomically(this.#statePath, async () => {
			if (!this.#started) throw new Error("Codex expiry-reset scheduler stopped");
			const state = await readReceiptState(this.#statePath);
			if (!this.#started) throw new Error("Codex expiry-reset scheduler stopped");
			const entry = update(state.accounts[keyHash]);
			const next: ReceiptState = {
				version: 1,
				accounts: { ...state.accounts, [keyHash]: entry },
			};
			return { content: `${JSON.stringify(next)}\n`, value: entry };
		});
	}

	async #projectReceipts(reports: UsageReport[], nowMs: number): Promise<UsageReport[]> {
		let state: ReceiptState;
		try {
			state = await readReceiptState(this.#statePath);
		} catch {
			return reports;
		}
		return reports.map(report => {
			if (report.provider !== "openai-codex" || !report.resetCredits) return report;
			const accountKey = accountKeyOf({
				accountId: typeof report.metadata?.accountId === "string" ? report.metadata.accountId : undefined,
				email: typeof report.metadata?.email === "string" ? report.metadata.email : undefined,
			});
			if (!accountKey) return report;
			const entry = state.accounts[accountHash(accountKey)];
			if (!entry || nowMs - entry.updatedAt > RECEIPT_RETENTION_MS) return report;
			if (
				(entry.status === "scheduled" || entry.status === "retrying") &&
				entry.expiresAt !== report.resetCredits.expiresAt
			) {
				return report;
			}
			const automation: UsageResetAutomation = {
				status: entry.status,
				updatedAt: entry.updatedAt,
				nextAttemptAt: entry.nextAttemptAt,
				reason: entry.reason,
			};
			return { ...report, resetCredits: { ...report.resetCredits, automation } };
		});
	}
}

const schedulerByRegistry = new WeakMap<ModelRegistry, CodexExpiryResetScheduler>();

function createRuntime(modelRegistry: ModelRegistry): CodexExpiryResetRuntime {
	return {
		list: options =>
			modelRegistry.authStorage.listResetCredits({
				baseUrlResolver: provider => modelRegistry.getProviderBaseUrl?.(provider),
				signal: options?.signal,
				fresh: options?.fresh,
			}),
		redeem: options =>
			modelRegistry.authStorage.redeemResetCredit({
				target: options.target,
				creditId: options.creditId,
				redeemRequestId: options.redeemRequestId,
				baseUrlResolver: provider => modelRegistry.getProviderBaseUrl?.(provider),
				signal: options.signal,
			}),
		refreshUsage: async () => {
			await modelRegistry.authStorage.fetchUsageReports({
				baseUrlResolver: provider => modelRegistry.getProviderBaseUrl?.(provider),
			});
		},
	};
}

export function ensureCodexExpiryResetScheduler(
	modelRegistry: ModelRegistry,
	settings: Settings,
): CodexExpiryResetScheduler {
	let scheduler = schedulerByRegistry.get(modelRegistry);
	if (!scheduler) {
		scheduler = new CodexExpiryResetScheduler({ runtime: createRuntime(modelRegistry), settings });
		schedulerByRegistry.set(modelRegistry, scheduler);
		scheduler.start();
		modelRegistry.authStorage.onGenerationChanged(() => scheduler?.requestRefresh());
	}
	return scheduler;
}

export function getCodexExpiryResetScheduler(modelRegistry: ModelRegistry): CodexExpiryResetScheduler | undefined {
	return schedulerByRegistry.get(modelRegistry);
}
