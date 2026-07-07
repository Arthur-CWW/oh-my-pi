import type { ThinkingLevel } from "@oh-my-pi/pi-agent-core";
import type { Model } from "@oh-my-pi/pi-ai";
import { modelsAreEqual } from "@oh-my-pi/pi-catalog/models";
import { logger, toError } from "@oh-my-pi/pi-utils";
import { resolveModelOverride } from "../config/model-resolver";
import type { Settings } from "../config/settings";
import { AgentLifecycleManager } from "../registry/agent-lifecycle";
import { AgentRegistry } from "../registry/agent-registry";
import type { AgentSession, AgentSessionEvent } from "../session/agent-session";
import { getRestorableSessionModels } from "../session/session-context";
import { parseThinkingLevel } from "../thinking";
import type { SessionManager } from "../session/session-manager";

export interface HotswapArgs {
	agentId: string;
	/** Model selector: provider/model id, fuzzy selector, or role — with optional ":<thinkingLevel>" suffix. */
	model: string;
	requestedBy?: string;
	reason?: string;
}

export type HotswapResult =
	| { status: "applied"; agentId: string; from: string; to: string }
	| { status: "queued"; agentId: string; from: string; to: string }
	| { status: "failed"; agentId: string; error: string };

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

type PendingCancel = () => void;

const pendingSwaps = new Map<string, PendingCancel>();

function formatModel(model: Model): string {
	return `${model.provider}/${model.id}`;
}

function failed(agentId: string, error: string): HotswapResult {
	return { status: "failed", agentId, error };
}

function cancelPending(agentId: string): void {
	const cancel = pendingSwaps.get(agentId);
	if (!cancel) return;
	cancel();
	pendingSwaps.delete(agentId);
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
): Promise<HotswapResult> {
	try {
		await session.setModel(model, "hotswap");
		if (explicitThinkingLevel) {
			session.setThinkingLevel(thinkingLevel);
		}
		await injectHotswapNotice(session, from, to, requestedBy, reason);
		return { status: "applied", agentId, from, to };
	} catch (error) {
		const err = toError(error);
		logger.warn("Failed to hot-swap agent model", { agentId, error: err.message, from, to });
		return { status: "failed", agentId, error: err.message };
	}
}

async function applyThinkingOnlyHotswap(
	agentId: string,
	session: AgentSession,
	thinkingLevel: ThinkingLevel | undefined,
	requestedBy: string | undefined,
	reason: string | undefined,
	modelString: string,
): Promise<HotswapResult> {
	try {
		session.setThinkingLevel(thinkingLevel);
		session.sessionManager.appendModelChange(modelString, "hotswap");
		await injectHotswapNotice(session, modelString, modelString, requestedBy, reason);
		return { status: "applied", agentId, from: modelString, to: modelString };
	} catch (error) {
		const err = toError(error);
		logger.warn("Failed to hot-swap agent thinking level", { agentId, error: err.message, model: modelString });
		return { status: "failed", agentId, error: err.message };
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
	if (!initialRef) return failed(args.agentId, `Unknown agent: ${args.agentId}`);
	if (initialRef.kind !== "sub") return failed(args.agentId, `Agent ${args.agentId} is not a subagent.`);
	if (initialRef.status === "aborted") return failed(args.agentId, `Agent ${args.agentId} is aborted.`);

	let session: AgentSession;
	try {
		session =
			initialRef.status === "parked"
				? await AgentLifecycleManager.global().ensureLive(args.agentId)
				: (initialRef.session ?? (await AgentLifecycleManager.global().ensureLive(args.agentId)));
	} catch (error) {
		return failed(args.agentId, toError(error).message);
	}

	if (session.isDisposed) return failed(args.agentId, `Agent ${args.agentId} session is disposed.`);
	const currentModel = session.model;
	if (!currentModel) return failed(args.agentId, `Agent ${args.agentId} has no current model.`);
	const from = formatModel(currentModel);

	try {
		const resolved = resolveModelOverride([args.model], session.modelRegistry, session.settings);
		if (!resolved.model) return failed(args.agentId, `Could not resolve model selector: ${args.model}`);
		const to = formatModel(resolved.model);
		const key = await session.modelRegistry.getApiKey(resolved.model);
		if (!key) return failed(args.agentId, `Missing credentials for ${to}`);

		cancelPending(args.agentId);

		const sameModel = modelsAreEqual(resolved.model, currentModel);
		if (sameModel && !resolved.explicitThinkingLevel) {
			return { status: "applied", agentId: args.agentId, from, to: from };
		}

		const targetModel = resolved.model;
		const apply = async (): Promise<HotswapResult> =>
			sameModel
				? applyThinkingOnlyHotswap(
						args.agentId,
						session,
						resolved.thinkingLevel,
						args.requestedBy,
						args.reason,
						from,
					)
				: applyHotswap(
						args.agentId,
						session,
						targetModel,
						resolved.thinkingLevel,
						resolved.explicitThinkingLevel,
						args.requestedBy,
						args.reason,
						from,
						to,
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
