import type { ThinkingLevel } from "@oh-my-pi/pi-agent-core";
import type { Model, ReasoningEffort } from "@oh-my-pi/pi-ai";
import { getSupportedEfforts } from "@oh-my-pi/pi-catalog/model-thinking";
import { modelsAreEqual } from "@oh-my-pi/pi-catalog/models";
import { logger, toError } from "@oh-my-pi/pi-utils";
import { isBlockedSubagentModel, resolveModelOverride } from "../config/model-resolver";
import { extractExplicitThinkingSelector } from "../config/role-resolution";
import type { Settings } from "../config/settings";
import { AgentLifecycleManager } from "../registry/agent-lifecycle";
import { resolveAgentRef } from "../registry/agent-ref";
import { AgentRegistry, MAIN_AGENT_ID } from "../registry/agent-registry";
import type { AgentSession, AgentSessionEvent } from "../session/agent-session";
import { getRestorableSessionModels } from "../session/session-context";
import type { SessionCommandReceipt, SetModelSessionCommand } from "../session/session-entries";
import type { SessionManager } from "../session/session-manager";
import { parseThinkingLevel } from "../thinking";
import {
	admitChildRouteUpdate,
	appendChildRouteUpdateRecord,
	CHILD_ROUTE_UPDATE_CUSTOM_TYPE,
	type ChildRouteUpdateAdmission,
	type ChildRouteUpdateNotAppliedReason,
	type ChildRouteUpdateRecord,
	type ChildRouteUpdateRequest,
	type ChildRouteUpdateTarget,
	childRouteUpdateProjection,
	claimChildRouteUpdate,
	type DurableChildRoute,
	durableRouteSatisfies,
	isChildRouteUpdateInDoubt,
	isChildRouteUpdateOpen,
	markChildRouteUpdateApplied,
	markChildRouteUpdateApplying,
	markChildRouteUpdateNotApplied,
	markChildRouteUpdateUncertain,
	notifyChildRouteUpdate,
	projectChildRouteUpdates,
	projectDurableChildRoute,
	UNOWNED_OWNER_EPOCH,
} from "./child-route-update";
import { createEffectiveHotswapRoute, ROUTE_RESOLUTION_ENTRY } from "./route-events";

export interface HotswapArgs {
	agentId: string;
	/** Model selector: provider/model id, fuzzy selector, or role — with optional ":<thinkingLevel>" suffix. */
	model: string;
	requestedBy?: string;
	reason?: string;
	/** Stable command identity supplied by the invoking tool/runner for durable receipt replay. */
	commandId?: string;
	correlationId?: string;
	/** Current parent journal, required to address a historical direct child. */
	parentSessionManager?: SessionManager;
	/** Resolver/auth source when no live AgentSession exists. */
	modelRegistry?: HotswapModelRegistry;
	settings?: Settings;
	/**
	 * Owner epoch the caller decided under. When present and no longer current,
	 * the request is rejected instead of landing in a session that changed hands.
	 */
	expectedOwnerEpoch?: string;
}

export type HotswapFailureReason =
	| "unknown_agent"
	| "wrong_root"
	| "unauthorized"
	| "unavailable"
	| "unsafe_state"
	| "invalid_model"
	| "missing_credentials"
	| "apply_failed"
	| "stale_owner_epoch"
	| "conflicting_pending"
	| "corrupt_journal";

export type HotswapResult =
	| { status: "applied"; agentId: string; from: string; to: string; receipt?: SessionCommandReceipt }
	| { status: "queued"; agentId: string; from: string; to: string }
	| {
			status: "pending";
			agentId: string;
			from: string;
			to: string;
			requestId: string;
			effort: string | null;
	  }
	| { status: "recorded"; agentId: string; from: string; to: string }
	| {
			status: "failed";
			agentId: string;
			error: string;
			reason?: HotswapFailureReason;
			/**
			 * The live session route was already mutated when the failure surfaced,
			 * so the outcome is in doubt rather than cleanly not applied.
			 */
			mutated?: boolean;
	  };

export interface RestorableSessionModel {
	model: Model;
	thinkingLevel?: ThinkingLevel;
}

interface RestorableSessionModelSource {
	buildSessionContext(): { models: Readonly<Record<string, string>>; thinkingLevel?: string };
	getLastModelChangeRole(): string | undefined;
}

type RestorableModelRegistry = {
	getAvailable(): Model[];
	hasConfiguredAuth(model: Model): boolean;
};

type HotswapModelRegistry = RestorableModelRegistry & {
	getApiKey(model: Model): Promise<string | undefined>;
};

type PendingCancel = () => void;

const pendingSwaps = new Map<string, PendingCancel>();

function formatModel(model: Model): string {
	return `${model.provider}/${model.id}`;
}

function failed(agentId: string, error: string, reason?: HotswapFailureReason, mutated?: boolean): HotswapResult {
	return { status: "failed", agentId, error, ...(reason ? { reason } : {}), ...(mutated ? { mutated } : {}) };
}

function cancelPending(agentId: string): void {
	const cancel = pendingSwaps.get(agentId);
	if (!cancel) return;
	cancel();
	pendingSwaps.delete(agentId);
}

/**
 * Authoritative state of the lease that fences one child's route applies.
 *
 * A child `SessionManager` opened by the executor holds no lease of its own, so
 * asking it whether ownership was lost always answers "no". The real authority
 * is the parent runner that owns the journal tree; a boundary that consults only
 * the child keeps applying routes after its parent has been fenced.
 */
export type ChildRouteLease = { held: true; ownerEpoch: string } | { held: false; ownerEpoch?: string; detail: string };

export type ChildRouteLeaseProbe = () => ChildRouteLease;

/**
 * Read the parent lease that fences one child.
 *
 * `parent` is the owning runner's journal when the caller already holds it, or
 * the owning agent id to resolve in this process; the live Main session is the
 * fallback authority. A process with no live owning session has no lease to
 * lose, so the unowned sentinel reports as held rather than fencing every apply
 * in tests and embedded runners.
 */
export function parentRouteLease(parent?: SessionManager | string): ChildRouteLease {
	const registry = AgentRegistry.global();
	const manager =
		typeof parent === "object"
			? parent
			: ((typeof parent === "string" ? registry.get(parent)?.session?.sessionManager : undefined) ??
				registry.get(MAIN_AGENT_ID)?.session?.sessionManager);
	if (!manager) return { held: true, ownerEpoch: UNOWNED_OWNER_EPOCH };
	const lost = manager.getSessionOwnershipLostError();
	if (lost) return { held: false, detail: lost.message };
	const ownership = manager.getSessionOwnership();
	if (!ownership) return { held: true, ownerEpoch: UNOWNED_OWNER_EPOCH };
	if (ownership.isFenced?.() === true) {
		return {
			held: false,
			ownerEpoch: ownership.ownerEpoch,
			detail: `parent lease ${ownership.ownerEpoch} is fenced`,
		};
	}
	return { held: true, ownerEpoch: ownership.ownerEpoch };
}

/**
 * Owner epoch that fences one child's route updates.
 *
 * In-process children hold no lease of their own, so the fencing authority is
 * the owning runner: the caller's session when supplied, otherwise the live Main
 * session's lease.
 */
export function currentRouteOwnerEpoch(preferred?: SessionManager): string {
	const explicit = preferred?.getSessionOwnership()?.ownerEpoch;
	if (explicit) return explicit;
	const lease = parentRouteLease();
	return lease.ownerEpoch ?? UNOWNED_OWNER_EPOCH;
}

/**
 * Whether this process may still mutate one child's live route.
 *
 * The claim gate and the pre-mutation re-probe must answer the same question,
 * so they share this. The parent lease is the authority, the child's own
 * ownership error still fences it, and `expectedOwnerEpoch` catches the
 * takeover that completed while an await was in flight: a lease reacquired by
 * a new owner reads as held, but it is no longer the lease that admitted the
 * apply.
 */
interface RouteApplyFence {
	/** Owner epoch that would perform the apply; the unowned sentinel when nothing holds a lease. */
	readonly ownerEpoch: string;
	/** Why this process may no longer mutate the child, when the fence is lost. */
	readonly lost?: string;
}

function routeApplyFence(
	lease: ChildRouteLeaseProbe,
	sessionManager: Pick<SessionManager, "getSessionOwnershipLostError">,
	expectedOwnerEpoch?: string,
): RouteApplyFence {
	const state = lease();
	if (!state.held) return { ownerEpoch: state.ownerEpoch ?? UNOWNED_OWNER_EPOCH, lost: state.detail };
	const childLost = sessionManager.getSessionOwnershipLostError();
	if (childLost) return { ownerEpoch: state.ownerEpoch, lost: childLost.message };
	if (expectedOwnerEpoch !== undefined && state.ownerEpoch !== expectedOwnerEpoch) {
		return {
			ownerEpoch: state.ownerEpoch,
			lost: `parent lease moved from ${expectedOwnerEpoch} to ${state.ownerEpoch}`,
		};
	}
	return { ownerEpoch: state.ownerEpoch };
}

/** Request ids claimed by a boundary apply in this process, guarding re-entrancy. */
const claimedRouteUpdates = new Set<string>();

function routeUpdateResult(agentId: string, from: string, record: ChildRouteUpdateRecord): HotswapResult {
	if (record.state === "applied") {
		return { status: "applied", agentId, from, to: record.appliedSelector ?? record.selector };
	}
	if (record.state !== "not_applied") {
		// `applying` and `uncertain` still owe the child an outcome, so they read
		// as pending to every caller: the next boundary reconciles them.
		return {
			status: "pending",
			agentId,
			from,
			to: record.selector,
			requestId: record.requestId,
			effort: record.effort,
		};
	}
	return failed(
		agentId,
		`Route update ${record.requestId} was not applied (${record.notAppliedReason ?? "unknown"})${
			record.failureDetail ? `: ${record.failureDetail}` : ""
		}.`,
		"unavailable",
	);
}

/**
 * A closed child's answer for one durable record.
 *
 * `applied` reads as `recorded` because a historical journal is rewritten, not
 * mutated live. Every other state keeps the live vocabulary, so a record that
 * still owes an outcome is reported as pending instead of as success.
 */
function historicalRouteUpdateResult(agentId: string, from: string, record: ChildRouteUpdateRecord): HotswapResult {
	const result = routeUpdateResult(agentId, from, record);
	return result.status === "applied" ? { status: "recorded", agentId, from, to: result.to } : result;
}

function rejectionMessage(agentId: string, admission: ChildRouteUpdateAdmission & { status: "rejected" }): string {
	if (admission.reason === "stale_owner_epoch") {
		return `Agent ${agentId} changed owners since this request was decided.`;
	}
	if (admission.reason === "conflicting_pending") {
		const pending = admission.record;
		const pendingEffort = pending && pending.effort !== null ? `:${pending.effort}` : "";
		return `Agent ${agentId} already has a pending route update to ${pending?.selector ?? "another route"}${pendingEffort}.`;
	}
	return `Agent ${agentId} has an unreadable route-update journal.`;
}

/**
 * Record a durable route update for a live direct child instead of mutating it
 * mid-turn. The child applies it at its own turn boundary; the record survives a
 * parent restart because it lives in the child journal, not in this process.
 */
async function requestChildRouteUpdate(
	args: HotswapArgs,
	session: AgentSession,
	from: string,
	to: string,
	effort: string | null,
): Promise<HotswapResult> {
	const ownerEpoch = currentRouteOwnerEpoch(args.parentSessionManager);
	const request: ChildRouteUpdateRequest = {
		requestId: args.commandId ?? Bun.randomUUIDv7(),
		agentId: args.agentId,
		selector: to,
		effort,
		requestedBy: args.requestedBy ?? MAIN_AGENT_ID,
		ownerEpoch: args.expectedOwnerEpoch ?? ownerEpoch,
		...(args.reason === undefined ? {} : { reason: args.reason }),
	};
	const admission = admitChildRouteUpdate(childRouteUpdateProjection(session.sessionManager), request, ownerEpoch);
	if (admission.status === "rejected") {
		return failed(args.agentId, rejectionMessage(args.agentId, admission), admission.reason);
	}
	if (admission.status === "duplicate") return routeUpdateResult(args.agentId, from, admission.record);
	await appendChildRouteUpdateRecord(session.sessionManager, admission.record);
	return routeUpdateResult(args.agentId, from, admission.record);
}

/**
 * The child's route as a restart would reconstruct it.
 *
 * `AgentSession.setThinkingLevel` journals an entry only when the effective
 * level actually moves, so asking for the level a child already runs leaves no
 * durable evidence at all. Folding the live effective level in for exactly that
 * gap is what stops a reconcile from re-applying — and re-emitting the hot-swap
 * notice — for a no-op effort change. The selector is never defaulted:
 * `appendModelChange` is unconditional, so a missing model entry really does
 * mean the swap never reached the journal.
 */
function reconcilableChildRoute(session: AgentSession): DurableChildRoute {
	const durable = projectDurableChildRoute(session.sessionManager.getEntries());
	if (durable.selector === undefined || durable.effort !== undefined) return durable;
	const live = session.thinkingLevel;
	return { selector: durable.selector, ...(live === undefined ? {} : { effort: live }) };
}

/**
 * Settle an in-doubt record from the child's own durable route.
 *
 * The receipt is attributed to the owner epoch that recorded the apply intent,
 * not to the one reconciling it: that process is the one that actually mutated
 * the child, and naming the reconciler would misattribute the change.
 */
function settleFromDurableRoute(
	session: AgentSession,
	claimed: ChildRouteUpdateRecord,
	ownerEpoch: string,
	target: ChildRouteUpdateTarget,
): ChildRouteUpdateRecord | undefined {
	if (!durableRouteSatisfies(reconcilableChildRoute(session), target)) return undefined;
	return markChildRouteUpdateApplied(claimed, {
		appliedSelector: target.selector,
		appliedEffort: target.effort,
		appliedOwnerEpoch: claimed.applyingOwnerEpoch ?? ownerEpoch,
	});
}

/**
 * Run one claimed route update against a live child at its turn boundary.
 *
 * The write order is what makes a crash survivable: a durable `applying` intent
 * lands before any session mutation, so a process that dies mid-apply leaves an
 * in-doubt record instead of a `pending` one that a restart would replay from
 * scratch. `onIntent` hands that durable intent back to the caller so a throw
 * after it is reported as in-doubt rather than as a clean failure.
 *
 * `lease` is re-probed immediately before the mutation, because the intent
 * flush is an await and ownership can move across it.
 */
async function runClaimedRouteUpdate(
	agentId: string,
	session: AgentSession,
	claimed: ChildRouteUpdateRecord,
	resume: boolean,
	ownerEpoch: string,
	lease: ChildRouteLeaseProbe,
	onIntent: (record: ChildRouteUpdateRecord) => void,
): Promise<ChildRouteUpdateRecord> {
	const sessionManager = session.sessionManager;
	const currentModel = session.model;
	if (!currentModel) {
		return markChildRouteUpdateNotApplied(claimed, "apply_failed", `Agent ${agentId} has no current model.`);
	}
	// Durable evidence first. A record left in doubt by a crash is settled from
	// the child's own journal, which proves what landed and stays readable when
	// the requested model has since left the available set. Resolving the
	// selector first would stamp `not_applied` over a swap that provably landed.
	if (resume) {
		const settled = settleFromDurableRoute(session, claimed, ownerEpoch, {
			selector: claimed.selector,
			effort: claimed.effort,
		});
		if (settled) return settled;
	}
	const resolved = resolveModelOverride([claimed.selector], session.modelRegistry, session.settings);
	if (!resolved.model) {
		return markChildRouteUpdateNotApplied(
			claimed,
			"apply_failed",
			`Could not resolve model selector: ${claimed.selector}`,
		);
	}
	const target: ChildRouteUpdateTarget = { selector: formatModel(resolved.model), effort: claimed.effort };
	const applied = {
		appliedSelector: target.selector,
		appliedEffort: target.effort,
		appliedOwnerEpoch: ownerEpoch,
	};
	// The same reconcile against the resolved route, for a request whose selector
	// was fuzzy or a role and so never matched the journal literally. Either way
	// the settle is what keeps the model change, the thinking change, and the
	// hot-swap notice from being written a second time.
	if (resume) {
		const settled = settleFromDurableRoute(session, claimed, ownerEpoch, target);
		if (settled) return settled;
	}
	const sameModel = modelsAreEqual(resolved.model, currentModel);
	// Nothing to mutate: the receipt alone is the whole apply, so it needs no
	// durable intent to be crash-consistent.
	if (sameModel && target.effort === null) return markChildRouteUpdateApplied(claimed, applied);

	const intent = await appendChildRouteUpdateRecord(sessionManager, markChildRouteUpdateApplying(claimed, ownerEpoch));
	onIntent(intent);

	// The intent flush is an await and ownership can move across it, so re-probe
	// the exact lease that admitted this apply before touching the live session.
	// Nothing has mutated yet, which is what makes `not_applied` honest here
	// instead of a route change written under a lease this process has lost.
	const refence = routeApplyFence(lease, sessionManager, ownerEpoch);
	if (refence.lost !== undefined) {
		return markChildRouteUpdateNotApplied(intent, "owner_epoch_changed", refence.lost);
	}

	const from = formatModel(currentModel);
	const thinkingLevel = parseThinkingLevel(target.effort);
	const previousThinkingLevel = session.thinkingLevel;
	const outcome = sameModel
		? await applyThinkingOnlyHotswap(
				agentId,
				session,
				thinkingLevel,
				claimed.requestedBy,
				claimed.reason,
				from,
				previousThinkingLevel,
			)
		: await applyHotswap(
				agentId,
				session,
				resolved.model,
				thinkingLevel,
				target.effort !== null,
				claimed.requestedBy,
				claimed.reason,
				from,
				target.selector,
				previousThinkingLevel,
			);
	if (outcome.status === "failed") {
		logger.warn("Child route update failed at safe boundary", {
			agentId,
			requestId: claimed.requestId,
			error: outcome.error,
			mutated: outcome.mutated === true,
		});
		// A failure that already moved the live route is in doubt, not "not
		// applied": the child may be running the new model while the receipt
		// claims otherwise. The next boundary settles it against the journal.
		return outcome.mutated
			? markChildRouteUpdateUncertain(intent, outcome.error)
			: markChildRouteUpdateNotApplied(intent, "apply_failed", outcome.error);
	}
	return markChildRouteUpdateApplied(intent, applied);
}

/**
 * Claim and apply at most one open route update, then journal its receipt.
 *
 * Exactly-once holds across a crash, not just across a turn: a live child
 * journal has exactly one owning process, the turn loop awaits this serially,
 * and every mutation is bracketed by a durable `applying` intent whose successor
 * reconciles against the child's own durable route instead of replaying.
 *
 * `lease` is the authoritative parent fence. The child manager is not one — it
 * holds no lease of its own, so a boundary that trusted it would keep applying
 * routes for a parent that has already been taken over.
 */
export async function applyPendingChildRouteUpdate(
	agentId: string,
	session: AgentSession,
	lease: ChildRouteLeaseProbe = parentRouteLease,
): Promise<ChildRouteUpdateRecord | undefined> {
	const sessionManager = session.sessionManager;
	const fence = routeApplyFence(lease, sessionManager);
	const claim = claimChildRouteUpdate(childRouteUpdateProjection(sessionManager), {
		ownershipLost: fence.lost !== undefined,
	});
	if (claim.status === "none") return undefined;
	if (claim.status === "fenced") {
		return await appendChildRouteUpdateRecord(
			sessionManager,
			markChildRouteUpdateNotApplied(claim.record, "owner_epoch_changed", fence.lost),
		);
	}
	const claimed = claim.record;
	if (claimedRouteUpdates.has(claimed.requestId)) return undefined;
	claimedRouteUpdates.add(claimed.requestId);
	let intent: ChildRouteUpdateRecord | undefined;
	try {
		const receipt = await runClaimedRouteUpdate(
			agentId,
			session,
			claimed,
			claim.resume,
			fence.ownerEpoch,
			lease,
			record => {
				intent = record;
			},
		);
		return await appendChildRouteUpdateRecord(sessionManager, receipt);
	} catch (error) {
		const detail = toError(error).message;
		logger.warn("Child route update threw at safe boundary", { agentId, error: detail });
		// Past the durable intent the mutation may already have landed, so the
		// only honest receipt is in-doubt.
		const receipt = intent
			? markChildRouteUpdateUncertain(intent, detail)
			: markChildRouteUpdateNotApplied(claimed, "apply_failed", detail);
		try {
			return await appendChildRouteUpdateRecord(sessionManager, receipt);
		} catch {
			// The journal itself is unwritable. The durable record keeps its last
			// state and the next owner reconciles it; claiming an outcome we could
			// not persist is exactly the divergence this receipt exists to prevent.
			return undefined;
		}
	} finally {
		claimedRouteUpdates.delete(claimed.requestId);
	}
}

/**
 * Install the safe boundary for one live child: the turn loop awaits this after
 * the provider stream and every tool call/finalizer settle, and before it builds
 * the next turn's request.
 *
 * `lease` is the owning runner's fence, resolved once per boundary run so a
 * parent that loses its lease mid-turn retires the request instead of applying
 * it to a session it no longer owns.
 */
export function registerChildRouteUpdateBoundary(
	agentId: string,
	session: AgentSession,
	lease: ChildRouteLeaseProbe = parentRouteLease,
): () => void {
	return session.addTurnBoundaryHook(async () => {
		await applyPendingChildRouteUpdate(agentId, session, lease);
	});
}

/**
 * Retire the open request of a child that is going terminal.
 *
 * Only a `pending` request — one whose mutation provably never started — is
 * stamped `not_applied`. An in-doubt record is settled as `applied` when the
 * child's own durable route proves the swap landed, and is otherwise left open:
 * a receipt claiming "not applied" over a child that may already have swapped is
 * exactly the divergence between receipt and reality this state machine exists
 * to prevent, and an honest in-doubt record is what status surfaces should show.
 */
export async function retirePendingChildRouteUpdate(
	sessionManager: SessionManager,
	notAppliedReason: ChildRouteUpdateNotAppliedReason = "terminal_before_boundary",
): Promise<ChildRouteUpdateRecord | undefined> {
	const open = childRouteUpdateProjection(sessionManager).open;
	if (!open) return undefined;
	if (isChildRouteUpdateInDoubt(open.state)) {
		const durable = projectDurableChildRoute(sessionManager.getEntries());
		if (!durable.selector || !durableRouteSatisfies(durable, { selector: open.selector, effort: open.effort })) {
			return undefined;
		}
		return await appendChildRouteUpdateRecord(
			sessionManager,
			markChildRouteUpdateApplied(open, {
				appliedSelector: durable.selector,
				appliedEffort: open.effort,
				appliedOwnerEpoch: open.applyingOwnerEpoch ?? open.ownerEpoch,
			}),
		);
	}
	return await appendChildRouteUpdateRecord(sessionManager, markChildRouteUpdateNotApplied(open, notAppliedReason));
}

function validateThinkingLevel(
	model: Model,
	thinkingLevel: ThinkingLevel | undefined,
	explicit: boolean,
): string | undefined {
	if (!explicit || thinkingLevel === undefined || thinkingLevel === "off" || thinkingLevel === "inherit")
		return undefined;
	const supported = model.reasoning ? getSupportedEfforts(model) : [];
	if (supported.includes(thinkingLevel as ReasoningEffort)) return undefined;
	return `Thinking effort ${thinkingLevel} is not supported by ${formatModel(model)}${supported.length ? `. Supported efforts: ${supported.join(", ")}` : ""}`;
}

function hotswapAudit(
	sessionManager: SessionManager,
	agentId: string,
	model: Model,
	reason: string | undefined,
	requestedBy: string | undefined,
	previousModel: string,
	previousThinkingLevel: ThinkingLevel | string | undefined,
	thinkingLevel: ThinkingLevel | undefined,
) {
	const route = createEffectiveHotswapRoute(sessionManager, agentId, model, reason, thinkingLevel);
	return {
		...route,
		hotswapAudit: {
			requestedBy: requestedBy ?? null,
			previousRoute: { model: previousModel, effort: previousThinkingLevel ?? null },
			newRoute: { model: formatModel(model), effort: thinkingLevel ?? previousThinkingLevel ?? null },
			timestamp: new Date().toISOString(),
		},
	};
}

async function injectHotswapNotice(
	session: AgentSession,
	from: string,
	to: string,
	requestedBy: string | undefined,
	reason: string | undefined,
): Promise<void> {
	const reasonSuffix = reason ? ` (reason: ${reason})` : "";
	await session.sendCustomMessage(
		{
			customType: "hotswap:model",
			content: `<system-warning>Your model was hot-swapped by ${requestedBy ?? "the orchestrator"}: ${from} → ${to}${reasonSuffix}. Your conversation context is preserved; capabilities and style may differ from here on.</system-warning>`,
			display: false,
			attribution: "agent",
		},
		{ deliverAs: "nextTurn" },
	);
}

async function applyHotswap(
	agentId: string,
	session: AgentSession,
	model: Model,
	thinkingLevel: ThinkingLevel | undefined,
	explicitThinkingLevel: boolean,
	requestedBy: string | undefined,
	reason: string | undefined,
	from: string,
	to: string,
	previousThinkingLevel: ThinkingLevel | undefined,
	journaledCommand?: { commandId: string; correlationId: string },
): Promise<HotswapResult> {
	const modelBefore = session.model;
	const wasOnAnotherModel = !modelBefore || !modelsAreEqual(modelBefore, model);
	let mutated = false;
	try {
		let receipt: SessionCommandReceipt | undefined;
		if (journaledCommand) {
			const existingReceipt = session.sessionManager.getSessionCommandReceipt(journaledCommand.commandId);
			const command: SetModelSessionCommand = {
				schemaVersion: 1,
				kind: "setModel",
				commandId: journaledCommand.commandId,
				correlationId: journaledCommand.correlationId,
				expectedSessionRevision:
					existingReceipt?.entry.command?.expectedSessionRevision ?? session.sessionManager.getSessionRevision(),
				model: to,
				role: "hotswap",
			};
			receipt = await session.commitJournaledModel(command);
			if (receipt.replayed) {
				return { status: "applied", agentId, from, to, receipt };
			}
		} else {
			await session.setModel(model, "hotswap");
		}
		mutated = true;
		if (explicitThinkingLevel) {
			session.setThinkingLevel(thinkingLevel);
		}
		session.sessionManager.appendCustomEntry(
			ROUTE_RESOLUTION_ENTRY,
			hotswapAudit(
				session.sessionManager,
				agentId,
				model,
				reason,
				requestedBy,
				from,
				previousThinkingLevel,
				explicitThinkingLevel ? thinkingLevel : session.thinkingLevel,
			),
		);
		await injectHotswapNotice(session, from, to, requestedBy, reason);
		return { status: "applied", agentId, from, to, ...(receipt ? { receipt } : {}) };
	} catch (error) {
		const err = toError(error);
		logger.warn("Failed to hot-swap agent model", { agentId, error: err.message, from, to });
		// `setModel` swaps the live provider route before its journal write can
		// fail, so the flag alone under-reports. Asking the session what it is
		// actually running catches the partial mutation the flag misses.
		const startedMutating = mutated || (wasOnAnotherModel && !!session.model && modelsAreEqual(session.model, model));
		return failed(
			agentId,
			err.message,
			err.name === "SessionStateCommandInFlightError" ? "unsafe_state" : "apply_failed",
			startedMutating,
		);
	}
}

async function applyThinkingOnlyHotswap(
	agentId: string,
	session: AgentSession,
	thinkingLevel: ThinkingLevel | undefined,
	requestedBy: string | undefined,
	reason: string | undefined,
	modelString: string,
	previousThinkingLevel: ThinkingLevel | undefined,
): Promise<HotswapResult> {
	const liveEffortBefore = session.thinkingLevel;
	let mutated = false;
	try {
		const model = session.model;
		if (!model) return failed(agentId, `Agent ${agentId} has no current model.`);
		session.setThinkingLevel(thinkingLevel);
		mutated = true;
		session.sessionManager.appendModelChange(modelString, "hotswap");
		session.sessionManager.appendCustomEntry(
			ROUTE_RESOLUTION_ENTRY,
			hotswapAudit(
				session.sessionManager,
				agentId,
				model,
				reason,
				requestedBy,
				modelString,
				previousThinkingLevel,
				thinkingLevel,
			),
		);
		await injectHotswapNotice(session, modelString, modelString, requestedBy, reason);
		return { status: "applied", agentId, from: modelString, to: modelString };
	} catch (error) {
		const err = toError(error);
		logger.warn("Failed to hot-swap agent thinking level", { agentId, error: err.message, model: modelString });
		// `setThinkingLevel` moves the live effort and the running agent before it
		// appends `thinking_level_change`, so the flag alone under-reports: an
		// append that fails leaves the child already running the requested effort.
		// Ask the session what it is running before choosing a terminal receipt.
		const startedMutating = mutated || session.thinkingLevel !== liveEffortBefore;
		return failed(agentId, err.message, "apply_failed", startedMutating);
	}
}

async function hotswapHistoricalAgentModel(args: HotswapArgs): Promise<HotswapResult> {
	const parentSessionManager = args.parentSessionManager;
	const modelRegistry = args.modelRegistry;
	if (!parentSessionManager || !modelRegistry) {
		return failed(args.agentId, `Unknown agent: ${args.agentId}`);
	}

	const lookup = await parentSessionManager.openHistoricalDirectChild(args.agentId);
	if (lookup.status === "not_found") return failed(args.agentId, `Unknown agent: ${args.agentId}`);
	if (lookup.status === "ambiguous") {
		return failed(args.agentId, `Ambiguous historical agent id: ${args.agentId}`);
	}

	const sessionManager = lookup.sessionManager;
	const context = sessionManager.buildSessionContext();
	const lastRole = sessionManager.getLastModelChangeRole();
	const from = context.models[lastRole ?? "default"] ?? context.models.default;
	if (!from) return failed(args.agentId, `Historical agent ${args.agentId} has no current model.`);

	try {
		const resolved = resolveModelOverride([args.model], modelRegistry, args.settings);
		if (!resolved.model) return failed(args.agentId, `Could not resolve model selector: ${args.model}`);
		if (isBlockedSubagentModel(resolved.model, args.settings)) {
			return failed(args.agentId, `Model ${formatModel(resolved.model)} is not allowed for subagents.`);
		}
		const thinkingError = validateThinkingLevel(
			resolved.model,
			resolved.thinkingLevel,
			resolved.explicitThinkingLevel,
		);
		if (thinkingError) return failed(args.agentId, thinkingError);
		const to = formatModel(resolved.model);
		const key = await modelRegistry.getApiKey(resolved.model);
		if (!key || !modelRegistry.hasConfiguredAuth(resolved.model))
			return failed(args.agentId, `Missing credentials for ${to}`);
		if (to === from && !resolved.explicitThinkingLevel) {
			return { status: "recorded", agentId: args.agentId, from, to };
		}

		// A historical child runs through the same admission and fence as a live
		// one. Skipping it would let a replayed command id rewrite a closed child
		// a second time, and would accept a caller holding a superseded epoch.
		const ownerEpoch = currentRouteOwnerEpoch(parentSessionManager);
		const effort = resolved.explicitThinkingLevel ? (resolved.thinkingLevel ?? null) : null;
		const admission = admitChildRouteUpdate(
			projectChildRouteUpdates(sessionManager.getEntries()),
			{
				requestId: args.commandId ?? Bun.randomUUIDv7(),
				agentId: args.agentId,
				selector: to,
				effort,
				requestedBy: args.requestedBy ?? MAIN_AGENT_ID,
				ownerEpoch: args.expectedOwnerEpoch ?? ownerEpoch,
				...(args.reason === undefined ? {} : { reason: args.reason }),
			},
			ownerEpoch,
		);
		if (admission.status === "rejected") {
			return failed(args.agentId, rejectionMessage(args.agentId, admission), admission.reason);
		}
		if (admission.status === "duplicate") {
			// Only a terminal `applied` duplicate is settled work. An archived child
			// can still hold a `pending`, `applying`, or `uncertain` record left by
			// whatever closed it, and it has no boundary left to finish that record,
			// so reporting it as recorded would claim a route change that never
			// resolved. Reconcile it against the child's own journal instead and
			// answer with whatever that leaves — an open record reads as pending.
			const duplicate = admission.record;
			const settled = isChildRouteUpdateOpen(duplicate.state)
				? ((await retirePendingChildRouteUpdate(sessionManager)) ?? duplicate)
				: duplicate;
			return historicalRouteUpdateResult(args.agentId, from, settled);
		}
		const route = hotswapAudit(
			sessionManager,
			args.agentId,
			resolved.model,
			args.reason,
			args.requestedBy,
			from,
			context.thinkingLevel,
			resolved.explicitThinkingLevel ? resolved.thinkingLevel : undefined,
		);
		// A historical child has no boundary to wait for, so the admitted record
		// lands already applied and keeps every surface reading one state machine.
		const routeUpdate = markChildRouteUpdateApplied(admission.record, {
			appliedSelector: to,
			appliedEffort: effort,
			appliedOwnerEpoch: ownerEpoch,
		});
		await sessionManager.appendHistoricalHotswap(
			to,
			resolved.explicitThinkingLevel ? resolved.thinkingLevel : undefined,
			[
				{ customType: ROUTE_RESOLUTION_ENTRY, data: route },
				{ customType: CHILD_ROUTE_UPDATE_CUSTOM_TYPE, data: routeUpdate },
			],
		);
		// The atomic rewrite deliberately bypasses `appendChildRouteUpdateRecord`,
		// so this is the only place the transition can be published. Without it the
		// Hub keeps showing a closed child's pre-swap route until an unrelated
		// refresh happens to reload the journal.
		notifyChildRouteUpdate({
			agentId: args.agentId,
			sessionFile: sessionManager.getSessionFile() ?? undefined,
			record: routeUpdate,
		});
		return { status: "recorded", agentId: args.agentId, from, to };
	} catch (error) {
		return failed(args.agentId, toError(error).message);
	}
}

export function resolveRestorableSessionModel(
	sessionManager: SessionManager | RestorableSessionModelSource,
	modelRegistry: RestorableModelRegistry,
	settings: Settings | undefined,
	_spawnModel: Model | undefined,
): RestorableSessionModel | undefined {
	const lastRole = sessionManager.getLastModelChangeRole();
	if (lastRole !== "hotswap") return undefined;
	const context = sessionManager.buildSessionContext();
	const candidates = getRestorableSessionModels(context.models, lastRole);
	for (const candidate of candidates) {
		const resolved = resolveModelOverride([candidate], modelRegistry, settings);
		if (!resolved.model) continue;
		if (isBlockedSubagentModel(resolved.model, settings)) {
			logger.warn("Skipping blocked restorable hotswap model", {
				model: `${resolved.model.provider}/${resolved.model.id}`,
			});
			continue;
		}
		if (!modelRegistry.hasConfiguredAuth(resolved.model)) {
			logger.warn("Skipping unauthenticated restorable hotswap model", {
				model: `${resolved.model.provider}/${resolved.model.id}`,
			});
			continue;
		}
		const contextThinkingLevel = parseThinkingLevel(context.thinkingLevel);
		return {
			model: resolved.model,
			thinkingLevel: resolved.explicitThinkingLevel ? resolved.thinkingLevel : contextThinkingLevel,
		};
	}
	return undefined;
}

export async function hotswapAgentModel(args: HotswapArgs): Promise<HotswapResult> {
	const registry = AgentRegistry.global();
	const registeredRef = registry.get(args.agentId);
	const initialRef = registeredRef ? resolveAgentRef(args.agentId, args.requestedBy, registry)?.ref : undefined;
	if (!registeredRef) {
		return args.agentId === MAIN_AGENT_ID
			? failed(args.agentId, `Unknown agent: ${args.agentId}`)
			: await hotswapHistoricalAgentModel(args);
	}
	if (!initialRef) {
		return failed(args.agentId, `Agent ${args.agentId} is not a direct child of ${args.requestedBy}.`);
	}
	if (initialRef.status === "aborted") return failed(args.agentId, `Agent ${args.agentId} is aborted.`);

	const isMain = initialRef.kind === "main";
	if (isMain) {
		if (args.agentId !== MAIN_AGENT_ID || args.requestedBy !== MAIN_AGENT_ID) {
			return failed(args.agentId, `Agent ${args.agentId} is not the current Main session.`);
		}
		if (
			!initialRef.session ||
			(args.parentSessionManager && initialRef.session.sessionManager !== args.parentSessionManager)
		) {
			return failed(args.agentId, `Agent ${args.agentId} is not the current Main session.`);
		}
	} else if (initialRef.kind !== "sub") {
		return failed(args.agentId, `Agent ${args.agentId} is not a subagent.`);
	}

	let session: AgentSession;
	try {
		session = isMain
			? initialRef.session!
			: initialRef.status === "parked"
				? await AgentLifecycleManager.global().ensureLive(args.agentId)
				: (initialRef.session ?? (await AgentLifecycleManager.global().ensureLive(args.agentId)));
	} catch (error) {
		return failed(args.agentId, toError(error).message);
	}

	if (session.isDisposed) return failed(args.agentId, `Agent ${args.agentId} session is disposed.`);
	const currentModel = session.model;
	if (!currentModel) return failed(args.agentId, `Agent ${args.agentId} has no current model.`);
	const from = formatModel(currentModel);
	const previousThinkingLevel = session.thinkingLevel;

	try {
		const resolved = resolveModelOverride([args.model], session.modelRegistry, session.settings);
		if (!resolved.model) return failed(args.agentId, `Could not resolve model selector: ${args.model}`);
		if (!isMain && isBlockedSubagentModel(resolved.model, session.settings)) {
			return failed(args.agentId, `Model ${formatModel(resolved.model)} is not allowed for subagents.`);
		}
		const key = await session.modelRegistry.getApiKey(resolved.model);
		if (!key || !session.modelRegistry.hasConfiguredAuth(resolved.model)) {
			return failed(args.agentId, `Missing credentials for ${formatModel(resolved.model)}`);
		}
		const to = formatModel(resolved.model);
		const requestedThinking = extractExplicitThinkingSelector(args.model, session.settings);
		const thinkingLevel = requestedThinking ?? resolved.thinkingLevel;
		const explicitThinkingLevel = requestedThinking !== undefined || resolved.explicitThinkingLevel;
		const thinkingError = validateThinkingLevel(resolved.model, thinkingLevel, explicitThinkingLevel);
		if (thinkingError) return failed(args.agentId, thinkingError);

		const sameModel = modelsAreEqual(resolved.model, currentModel);
		if (!isMain && sameModel && !explicitThinkingLevel) {
			return { status: "applied", agentId: args.agentId, from, to: from };
		}

		if (!isMain) {
			// Direct children never swap mid-turn. The request lands in the child
			// journal and the child's own turn boundary applies it, so a parent
			// restart resumes it instead of losing it with this process.
			const effort = explicitThinkingLevel && thinkingLevel !== undefined ? thinkingLevel : null;
			const request = await requestChildRouteUpdate(args, session, from, to, effort);
			if (request.status !== "pending" || session.isStreaming) return request;
			// An idle child has no boundary coming until it is prompted again, so
			// drive the same state machine here and journal the receipt now. The
			// fence is the requesting parent's lease, never the child's own.
			const applied = await applyPendingChildRouteUpdate(args.agentId, session, () =>
				parentRouteLease(args.parentSessionManager ?? args.requestedBy),
			);
			return applied ? routeUpdateResult(args.agentId, from, applied) : request;
		}

		cancelPending(args.agentId);

		const targetModel = resolved.model;
		const apply = async (): Promise<HotswapResult> =>
			applyHotswap(
				args.agentId,
				session,
				targetModel,
				thinkingLevel,
				explicitThinkingLevel,
				args.requestedBy,
				args.reason,
				from,
				to,
				previousThinkingLevel,
				{
					commandId: args.commandId ?? Bun.randomUUIDv7(),
					correlationId: args.correlationId ?? args.commandId ?? Bun.randomUUIDv7(),
				},
			);

		if (!session.isStreaming) {
			return await apply();
		}

		let cancelled = false;
		let unsubscribeSession: PendingCancel | undefined;
		let unsubscribeRegistry: PendingCancel | undefined;
		const clearPending = (): void => {
			if (pendingSwaps.get(args.agentId) === cancel) {
				pendingSwaps.delete(args.agentId);
			}
		};
		const cancel = (): void => {
			cancelled = true;
			unsubscribeSession?.();
			unsubscribeSession = undefined;
			unsubscribeRegistry?.();
			unsubscribeRegistry = undefined;
		};
		const applyQueued = (): void => {
			if (cancelled) return;
			cancel();
			clearPending();
			const ref = registry.get(args.agentId);
			if (!ref || ref.status === "aborted" || ref.session !== session || session.isDisposed) {
				logger.warn("Dropping queued hot-swap for unavailable agent", { agentId: args.agentId, to });
				return;
			}
			void apply().then(result => {
				if (result.status === "failed") {
					logger.warn("Queued hot-swap failed", { agentId: args.agentId, error: result.error });
				}
			});
		};

		unsubscribeSession = session.subscribe((event: AgentSessionEvent) => {
			if (event.type === "agent_end") applyQueued();
		});
		unsubscribeRegistry = registry.onChange(event => {
			if (event.ref.id !== args.agentId) return;
			if (event.type === "removed" || event.ref.status === "parked" || event.ref.status === "aborted") {
				cancel();
				clearPending();
			}
		});
		pendingSwaps.set(args.agentId, cancel);

		if (!session.isStreaming) {
			cancel();
			clearPending();
			return await apply();
		}

		return { status: "queued", agentId: args.agentId, from, to };
	} catch (error) {
		return failed(args.agentId, toError(error).message);
	}
}
