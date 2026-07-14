/**
 * Pure decision predicate for auto-redeeming a saved OpenAI Codex rate-limit
 * reset, plus the process-wide coordinator that serializes attempts.
 *
 * WHY THIS IS REACTIVE-ONLY (never proactive):
 * The only trustworthy "blocked right now" signal is a live 429 /
 * `usage_limit_reached` from a request authenticated as the session's active
 * Codex credential. The session hook calls this predicate from the usage-limit
 * branch of the retry pipeline, *after* free remedies (sibling-account switch)
 * fail and *before* model fallback. A proactive surface (the status-line usage
 * poll) cannot be used: at `used_percent < 100` the account is not actually
 * limited, so redeeming would be a credit-wasting no-op; at exactly 100 the
 * user may be idle, so the freshly-reset weekly window would tick away with
 * nobody working. Saved resets are a scarce, ~monthly, effectively
 * irreversible resource — every gate here is biased to precision over recall:
 * we would rather miss a redeem than waste a credit.
 *
 * THE DECISION-2 TRAP (status MUST NOT be used to find the blocker):
 * `openai-codex.ts` applies the top-level `rate_limit.limit_reached` flag to
 * BOTH the primary (5h) and secondary (weekly) `buildUsageLimit` calls, so when
 * an account is blocked, *both* limit entries carry `status: "exhausted"`
 * regardless of which window is actually at 100%. Only `amount.usedFraction`
 * disambiguates which window is the real blocker. This module therefore keys
 * eligibility off exact limit ids (`openai-codex:primary` /
 * `openai-codex:secondary`) and `usedFraction`, never off `status`.
 *
 * ANTI-WASTE GATES (in evaluation order): the policy must not be set to "no";
 * the active model must be Codex (not Spark — a Spark block lives on a
 * separate meter and it is unknown whether a credit even resets it); a fresh
 * usage report for the active account must confirm `limitReached`; the WEEKLY
 * (secondary) window must be genuinely exhausted — a 5h-only block self-heals
 * within the hour, so a credit spent there buys nothing; the natural reset must be far
 * enough away to justify spending a ~30-day credit yet within one plausible
 * window length; a credit must be verifiably available above the reserve; and
 * the same block episode must not have been attempted already (debounce +
 * per-account cooldown). All of this is pure — no fetches, no IO. The only
 * stateful piece is the {@link CodexAutoRedeemCoordinator} container, whose
 * read-only views are passed in so the predicate itself stays deterministic.
 */
import type {
	Model,
	OAuthAccountIdentity,
	ResetCreditAccountStatus,
	ResetCreditRedeemOutcome,
	ResetCreditTarget,
	UsageReport,
} from "@oh-my-pi/pi-ai";
import { formatDuration, logger } from "@oh-my-pi/pi-utils";
import type { ModelRegistry } from "../config/model-registry";
import type { Settings } from "../config/settings";
import type { CodexAutoRedeemMode } from "../config/settings-schema";
import type { ExtensionRunner } from "../extensibility/extensions";
import { reportMatchesActiveAccount } from "../slash-commands/helpers/active-oauth-account";

/** Weekly window counts as exhausted at `usedFraction >= 0.999` (used_percent >= 99.9). */
export const WEEKLY_EXHAUSTED_MIN_FRACTION = 0.999;
/** A weekly reset can never be more than one window length (7d) away; +1h slack for skew. */
export const MAX_PLAUSIBLE_REMAINING_MS = 7 * 24 * 3_600_000 + 60 * 60_000;

/** Report must be no older than the 5-min usage cache TTL plus slack. */
export const REPORT_FRESHNESS_MS = 10 * 60_000;
/** Hard safety cap: never spend more than one saved reset per account in 24 hours. */
export const ATTEMPT_COOLDOWN_MS = 24 * 60 * 60_000;
/** Minute bucket for blockKey, absorbing `reset_after_seconds`-derived jitter. */
export const DEBOUNCE_BUCKET_MS = 60_000;

export function shouldEvaluateCodexAutoRedeem(mode: CodexAutoRedeemMode): boolean {
	return mode !== "no";
}

export function shouldPromptCodexAutoRedeem(mode: CodexAutoRedeemMode): boolean {
	return mode === "unset";
}

export type CodexAutoRedeemSkipReason =
	| "disabled"
	| "wrong-provider"
	| "spark-model"
	| "no-identity"
	| "no-report"
	| "stale-report"
	| "not-limit-reached"
	| "weekly-not-exhausted"
	| "no-reset-time"
	| "reset-too-soon"
	| "reset-implausible"
	| "credits-unknown"
	| "reserve"
	| "already-attempted"
	| "cooldown";

export interface CodexAutoRedeemInput {
	nowMs: number;
	/** `this.model.provider`. */
	provider: string;
	/** `this.model.id`. */
	modelId: string;
	settings: { autoRedeem: boolean; minBlockedMinutes: number; keepCredits: number };
	/** `getOAuthAccountIdentity("openai-codex", sessionId)`, captured at hook entry before any await. */
	identity: OAuthAccountIdentity | undefined;
	/** `session.fetchUsageReports()` (≤5-min cache). */
	reports: UsageReport[] | null;
	attemptedBlockKeys: ReadonlySet<string>;
	lastAttemptAtByAccount: ReadonlyMap<string, number>;
}

export interface CodexAutoRedeemRedeemDecision {
	redeem: true;
	target: ResetCreditTarget;
	accountKey: string;
	blockKey: string;
	weeklyResetAtMs: number;
	remainingMs: number;
	availableCount: number;
}

export type CodexAutoRedeemDecision =
	| CodexAutoRedeemRedeemDecision
	| { redeem: false; reason: CodexAutoRedeemSkipReason };

/** Trimmed lowercase, or undefined when blank. Mirrors `normalizeIdentityValue` in active-oauth-account.ts. */
function normalize(value: unknown): string | undefined {
	return typeof value === "string" && value.trim() ? value.trim().toLowerCase() : undefined;
}

/**
 * Decide whether to auto-redeem a saved Codex reset for the active account.
 *
 * Pure: every gate below is a function of the snapshot inputs only. Order
 * matters — cheapest / most-decisive gates first so the common "not eligible"
 * paths short-circuit before any account/report matching.
 */
export function evaluateCodexAutoRedeem(input: CodexAutoRedeemInput): CodexAutoRedeemDecision {
	const { nowMs, settings } = input;
	if (!settings.autoRedeem) return { redeem: false, reason: "disabled" };
	if (input.provider !== "openai-codex") return { redeem: false, reason: "wrong-provider" };
	// Unknown #1: it is unknown whether a credit resets the separate Spark meter.
	if (input.modelId.includes("-spark")) return { redeem: false, reason: "spark-model" };

	const accountKey = normalize(input.identity?.accountId) ?? normalize(input.identity?.email);
	if (!accountKey) return { redeem: false, reason: "no-identity" };

	const report = input.reports?.find(
		r => r.provider === "openai-codex" && reportMatchesActiveAccount(r, input.identity),
	);
	if (!report) return { redeem: false, reason: "no-report" };
	if (nowMs - report.fetchedAt > REPORT_FRESHNESS_MS) return { redeem: false, reason: "stale-report" };
	// The wire's own blocked flag must confirm the 429.
	if (report.metadata?.limitReached !== true) return { redeem: false, reason: "not-limit-reached" };

	// EXACT ids — never `status` (see the Decision-2 trap in the module docs).
	// The saved reset applies to the WEEKLY window, so that is the blocker we act
	// on. A 5h-only block (weekly still has headroom) self-heals within the hour,
	// so spending a scarce ~monthly credit there would be wasted.
	const weekly = report.limits.find(l => l.id === "openai-codex:secondary");
	const wUsed = weekly?.amount.usedFraction;
	if (!weekly || wUsed === undefined || wUsed < WEEKLY_EXHAUSTED_MIN_FRACTION) {
		return { redeem: false, reason: "weekly-not-exhausted" };
	}

	const resetsAt = weekly.window?.resetsAt;
	if (resetsAt === undefined) return { redeem: false, reason: "no-reset-time" };
	const remainingMs = resetsAt - nowMs;
	// anti-waste: too close to the natural reset — let it roll over instead of spending a credit.
	if (remainingMs < settings.minBlockedMinutes * 60_000) return { redeem: false, reason: "reset-too-soon" };
	if (remainingMs > MAX_PLAUSIBLE_REMAINING_MS) return { redeem: false, reason: "reset-implausible" };

	const available = report.resetCredits?.availableCount;
	// can't verify availability from the snapshot → don't spend (precision over recall).
	if (available === undefined) return { redeem: false, reason: "credits-unknown" };
	if (available - Math.max(0, Math.trunc(settings.keepCredits)) < 1) {
		return { redeem: false, reason: "reserve" };
	}

	const blockKey = `${accountKey}|${Math.round(resetsAt / DEBOUNCE_BUCKET_MS)}`;
	if (input.attemptedBlockKeys.has(blockKey)) return { redeem: false, reason: "already-attempted" };
	const lastAt = input.lastAttemptAtByAccount.get(accountKey);
	if (lastAt !== undefined && nowMs - lastAt < ATTEMPT_COOLDOWN_MS) return { redeem: false, reason: "cooldown" };

	return {
		redeem: true,
		target: { accountId: input.identity?.accountId, email: input.identity?.email },
		accountKey,
		blockKey,
		weeklyResetAtMs: resetsAt,
		remainingMs,
		availableCount: available,
	};
}

/**
 * Process-wide (NOT per-session) coordinator state. Parallel subagent sessions
 * share the same Codex accounts and must not race a double-spend, so this is a
 * single shared container, not a per-session field.
 *
 * - `attemptedBlockKeys`: one attempt EVER per block episode, regardless of
 *   outcome — recorded before calling the consume so exceptions can't re-enter.
 * - `lastAttemptAtByAccount`: per-account cooldown timestamps (epoch ms),
 *   catching blockKey drift across a minute boundary.
 * - `inFlightByAccount`: serializes per account — a second session for the same
 *   account adopts the in-flight promise instead of starting a second consume.
 */
export interface CodexAutoRedeemCoordinator {
	attemptedBlockKeys: Set<string>;
	lastAttemptAtByAccount: Map<string, number>;
	inFlightByAccount: Map<string, Promise<boolean>>;
}

export const defaultCodexAutoRedeemCoordinator: CodexAutoRedeemCoordinator = {
	attemptedBlockKeys: new Set(),
	lastAttemptAtByAccount: new Map(),
	inFlightByAccount: new Map(),
};

export async function fetchCodexUsageReports(
	modelRegistry: ModelRegistry,
	signal?: AbortSignal,
): Promise<UsageReport[] | null> {
	const authStorage = modelRegistry.authStorage;
	if (!authStorage.fetchUsageReports) return null;
	return authStorage.fetchUsageReports({
		baseUrlResolver: provider => modelRegistry.getProviderBaseUrl?.(provider),
		signal,
	});
}

export function redeemCodexResetCredit(
	modelRegistry: ModelRegistry,
	target: ResetCreditTarget,
	signal?: AbortSignal,
): Promise<ResetCreditRedeemOutcome> {
	return modelRegistry.authStorage.redeemResetCredit({
		target,
		baseUrlResolver: provider => modelRegistry.getProviderBaseUrl?.(provider),
		signal,
	});
}

export function listCodexResetCredits(
	modelRegistry: ModelRegistry,
	sessionId: string,
	signal?: AbortSignal,
): Promise<ResetCreditAccountStatus[]> {
	return modelRegistry.authStorage.listResetCredits({
		sessionId,
		baseUrlResolver: provider => modelRegistry.getProviderBaseUrl?.(provider),
		signal,
	});
}

export interface CodexAutoRedeemNoticeSink {
	emitNotice(level: "info" | "warning" | "error", message: string, source?: string): void;
}

export interface CodexAutoRedeemRuntime {
	modelRegistry: ModelRegistry;
	settings: Settings;
	model: Model | undefined;
	sessionId: string;
	extensionRunner: ExtensionRunner | undefined;
	noticeSink: CodexAutoRedeemNoticeSink;
	coordinator?: CodexAutoRedeemCoordinator;
}

async function confirmCodexAutoRedeem(
	runtime: CodexAutoRedeemRuntime,
	decision: CodexAutoRedeemRedeemDecision,
): Promise<boolean> {
	const runner = runtime.extensionRunner;
	if (!runner?.hasUI()) {
		runtime.noticeSink.emitNotice(
			"warning",
			"Codex saved reset is eligible, but auto-redeem is unset and no prompt UI is available. Run `/usage reset` or set codexResets.autoRedeem.",
			"codex-auto-reset",
		);
		return false;
	}

	const who = decision.target.email ?? decision.target.accountId ?? "the active account";
	const resetLabel = decision.availableCount === 1 ? "reset" : "resets";
	try {
		const choice = await runner
			.getUIContext()
			.select(
				`Do you wanna redeem your reset?\n${who} is blocked by the weekly Codex limit for about ${formatDuration(decision.remainingMs)}. Spend 1 of ${decision.availableCount} saved ${resetLabel}?`,
				[
					{
						label: "Yes",
						description: "Redeem now and remember yes for future eligible Codex weekly blocks.",
					},
					{
						label: "No",
						description: "Do not auto-redeem saved Codex resets.",
					},
				],
			);
		if (choice === "Yes") {
			runtime.settings.set("codexResets.autoRedeem", "yes");
			return true;
		}
		if (choice === "No") runtime.settings.set("codexResets.autoRedeem", "no");
	} catch (error) {
		logger.warn("codex-auto-reset prompt failed", { error: String(error) });
	}
	return false;
}

export async function runCodexAutoRedeem(runtime: CodexAutoRedeemRuntime): Promise<boolean> {
	const cfg = runtime.settings.getGroup("codexResets");
	const model = runtime.model;
	if (
		runtime.settings.get("auth.codexUsageReset") === "manual" ||
		!shouldEvaluateCodexAutoRedeem(cfg.autoRedeem) ||
		!model ||
		model.provider !== "openai-codex"
	) {
		return false;
	}
	const authStorage = runtime.modelRegistry.authStorage;
	const identity = authStorage.getOAuthAccountIdentity("openai-codex", runtime.sessionId);
	const accountKey = (identity?.accountId ?? identity?.email)?.trim().toLowerCase();
	if (!accountKey) return false;
	const coordinator = runtime.coordinator ?? defaultCodexAutoRedeemCoordinator;
	const existing = coordinator.inFlightByAccount.get(accountKey);
	if (existing) return existing;

	const run = (async (): Promise<boolean> => {
		const reports = await fetchCodexUsageReports(runtime.modelRegistry);
		const decision = evaluateCodexAutoRedeem({
			nowMs: Date.now(),
			provider: model.provider,
			modelId: model.id,
			settings: {
				autoRedeem: true,
				minBlockedMinutes: Math.max(0, cfg.minBlockedMinutes),
				keepCredits: Math.max(0, Math.trunc(cfg.keepCredits)),
			},
			identity,
			reports,
			attemptedBlockKeys: coordinator.attemptedBlockKeys,
			lastAttemptAtByAccount: coordinator.lastAttemptAtByAccount,
		});
		if (!decision.redeem) {
			logger.debug("codex-auto-reset: skipped", { reason: decision.reason });
			return false;
		}
		if (shouldPromptCodexAutoRedeem(cfg.autoRedeem) && !(await confirmCodexAutoRedeem(runtime, decision))) {
			return false;
		}
		coordinator.attemptedBlockKeys.add(decision.blockKey);
		coordinator.lastAttemptAtByAccount.set(decision.accountKey, Date.now());
		const who = decision.target.email ?? decision.target.accountId ?? "the active account";
		let outcome: ResetCreditRedeemOutcome;
		try {
			outcome = await redeemCodexResetCredit(runtime.modelRegistry, decision.target, AbortSignal.timeout(15_000));
		} catch (error) {
			logger.info("codex-auto-reset audit", {
				at: new Date().toISOString(),
				action: "POST /wham/rate-limit-reset-credits/consume",
				account: decision.accountKey,
				window: decision.blockKey,
				result: "transport-error",
				error: String(error),
			});
			runtime.noticeSink.emitNotice(
				"error",
				"Codex auto-redeem failed before confirmation; no retry will be attempted.",
				"codex-auto-reset",
			);
			return false;
		}
		logger.info("codex-auto-reset audit", {
			at: new Date().toISOString(),
			action: "POST /wham/rate-limit-reset-credits/consume",
			account: decision.accountKey,
			window: decision.blockKey,
			result: outcome.code,
		});
		switch (outcome.code) {
			case "reset": {
				const left = Math.max(0, decision.availableCount - 1);
				runtime.noticeSink.emitNotice(
					"info",
					`Auto-redeemed a saved Codex rate-limit reset for ${who} (${left} left); retrying now.`,
					"codex-auto-reset",
				);
				void fetchCodexUsageReports(runtime.modelRegistry);
				return true;
			}
			case "already_redeemed":
				runtime.noticeSink.emitNotice(
					"warning",
					"A saved Codex reset was already redeemed elsewhere; waiting for the window.",
					"codex-auto-reset",
				);
				return false;
			case "no_credit":
				runtime.noticeSink.emitNotice(
					"warning",
					"Codex auto-redeem found no saved reset credit; automatic reset remains stopped for this window.",
					"codex-auto-reset",
				);
				return false;
			case "nothing_to_reset":
				runtime.noticeSink.emitNotice(
					"warning",
					"Codex reset reported nothing to reset; auto-redeem suppressed for this window.",
					"codex-auto-reset",
				);
				return false;
			default:
				runtime.noticeSink.emitNotice("warning", `Codex auto-redeem failed (${outcome.code}).`, "codex-auto-reset");
				return false;
		}
	})().finally(() => coordinator.inFlightByAccount.delete(accountKey));
	coordinator.inFlightByAccount.set(accountKey, run);
	return run;
}
