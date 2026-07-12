import type { ThinkingLevel } from "@oh-my-pi/pi-agent-core";
import type { Model, ReasoningEffort } from "@oh-my-pi/pi-ai";
import { getSupportedEfforts } from "@oh-my-pi/pi-catalog/model-thinking";
import { modelsAreEqual } from "@oh-my-pi/pi-catalog/models";
import { logger, toError } from "@oh-my-pi/pi-utils";
import { extractExplicitThinkingSelector, isBlockedSubagentModel, resolveModelOverride } from "../config/model-resolver";
import type { Settings } from "../config/settings";
import { AgentLifecycleManager } from "../registry/agent-lifecycle";
import { AgentRegistry, MAIN_AGENT_ID, type AgentRef } from "../registry/agent-registry";
import type { AgentSession, AgentSessionEvent } from "../session/agent-session";
import type { SessionCommandReceipt, SetModelSessionCommand } from "../session/session-entries";
import { getRestorableSessionModels } from "../session/session-context";
import { SessionManager } from "../session/session-manager";
import { parseThinkingLevel } from "../thinking";
import { ROUTE_RESOLUTION_ENTRY, createEffectiveHotswapRoute } from "./route-events";

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
}

export type HotswapFailureReason =
	| "unknown_agent"
	| "wrong_root"
	| "unauthorized"
	| "unavailable"
	| "unsafe_state"
	| "invalid_model"
	| "missing_credentials"
	| "apply_failed";

export type HotswapResult =
	| { status: "applied"; agentId: string; from: string; to: string; receipt?: SessionCommandReceipt }
	| { status: "queued"; agentId: string; from: string; to: string }
	| { status: "recorded"; agentId: string; from: string; to: string }
	| { status: "failed"; agentId: string; error: string; reason?: HotswapFailureReason };

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

function failed(agentId: string, error: string, reason?: HotswapFailureReason): HotswapResult {
	return { status: "failed", agentId, error, ...(reason ? { reason } : {}) };
}

function cancelPending(agentId: string): void {
	const cancel = pendingSwaps.get(agentId);
	if (!cancel) return;
	cancel();
	pendingSwaps.delete(agentId);
}

function validateThinkingLevel(model: Model, thinkingLevel: ThinkingLevel | undefined, explicit: boolean): string | undefined {
	if (!explicit || thinkingLevel === undefined || thinkingLevel === "off" || thinkingLevel === "inherit") return undefined;
	const supported = model.reasoning ? getSupportedEfforts(model) : [];
	if (supported.includes(thinkingLevel as ReasoningEffort)) return undefined;
	return `Thinking effort ${thinkingLevel} is not supported by ${formatModel(model)}${supported.length ? `. Supported efforts: ${supported.join(", ")}` : ""}`;
}

function isOwnedAgent(ref: AgentRef, requestedBy: string | undefined, registry: AgentRegistry): boolean {
	return requestedBy === undefined || registry.isInSubtree(ref.id, requestedBy);
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
		return failed(
			agentId,
			err.message,
			err.name === "SessionStateCommandInFlightError" ? "unsafe_state" : "apply_failed",
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
	try {
		const model = session.model;
		if (!model) return failed(agentId, `Agent ${agentId} has no current model.`);
		session.setThinkingLevel(thinkingLevel);
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
		return { status: "failed", agentId, error: err.message };
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
		const thinkingError = validateThinkingLevel(resolved.model, resolved.thinkingLevel, resolved.explicitThinkingLevel);
		if (thinkingError) return failed(args.agentId, thinkingError);
		const to = formatModel(resolved.model);
		const key = await modelRegistry.getApiKey(resolved.model);
		if (!key || !modelRegistry.hasConfiguredAuth(resolved.model)) return failed(args.agentId, `Missing credentials for ${to}`);
		if (to === from && !resolved.explicitThinkingLevel) {
			return { status: "recorded", agentId: args.agentId, from, to };
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
		await sessionManager.appendHistoricalHotswap(
			to,
			resolved.explicitThinkingLevel ? resolved.thinkingLevel : undefined,
			{ customType: ROUTE_RESOLUTION_ENTRY, data: route },
		);
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
	const initialRef = registry.get(args.agentId);
	if (!initialRef) {
		return args.agentId === MAIN_AGENT_ID
			? failed(args.agentId, `Unknown agent: ${args.agentId}`)
			: await hotswapHistoricalAgentModel(args);
	}
	if (initialRef.status === "aborted") return failed(args.agentId, `Agent ${args.agentId} is aborted.`);

	const isMain = initialRef.kind === "main";
	if (isMain) {
		if (args.agentId !== MAIN_AGENT_ID || args.requestedBy !== MAIN_AGENT_ID) {
			return failed(args.agentId, `Agent ${args.agentId} is not the current Main session.`);
		}
		if (!initialRef.session || (args.parentSessionManager && initialRef.session.sessionManager !== args.parentSessionManager)) {
			return failed(args.agentId, `Agent ${args.agentId} is not the current Main session.`);
		}
	} else if (initialRef.kind !== "sub") {
		return failed(args.agentId, `Agent ${args.agentId} is not a subagent.`);
	} else if (!isOwnedAgent(initialRef, args.requestedBy, registry)) {
		return failed(args.agentId, `Agent ${args.agentId} is not a direct child of ${args.requestedBy}.`);
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

		cancelPending(args.agentId);

		const sameModel = modelsAreEqual(resolved.model, currentModel);
		if (!isMain && sameModel && !explicitThinkingLevel) {
			return { status: "applied", agentId: args.agentId, from, to: from };
		}

		const targetModel = resolved.model;
		const apply = async (): Promise<HotswapResult> =>
			sameModel && !isMain
				? applyThinkingOnlyHotswap(
						args.agentId,
						session,
						thinkingLevel,
						args.requestedBy,
						args.reason,
						from,
						previousThinkingLevel,
					)
				: applyHotswap(
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
						isMain
							? {
									commandId: args.commandId ?? Bun.randomUUIDv7(),
									correlationId: args.correlationId ?? args.commandId ?? Bun.randomUUIDv7(),
								}
							: undefined,
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
