import { randomUUID } from "node:crypto";
import type { MediaContent } from "@oh-my-pi/pi-ai";
import type {
	CancelCompactionReceipt,
	CancelEphemeralTurnReceipt,
	CancelHandoffReceipt,
	CancelLocalOperationReceipt,
	CancelShakeReceipt,
	CycleModelReceipt,
	GetCheckpointStateReceipt,
	InterruptPromptReceipt,
	RefreshSshToolReceipt,
	ReloadSessionReceipt,
	PrepareHostTransitionReceipt,
	ReplaceTodosReceipt,
	RunCompactionReceipt,
	RunEphemeralTurnReceipt,
	RunHandoffReceipt,
	RunLocalOperationReceipt,
	RunnerCheckpointState,
	RunnerCommandReceipt,
	RunShakeReceipt,
	SetActiveToolsReceipt,
	SetCheckpointStateReceipt,
	SetModelReceipt,
	SetThinkingLevelReceipt,
	SubmitCustomMessageCommand,
	TransitionGoalModeReceipt,
	TransitionPlanModeReceipt,
} from "../runner/protocol";
import {
	decodeCancelCompactionCommand,
	decodeCancelEphemeralTurnCommand,
	decodeCancelHandoffCommand,
	decodeCancelLocalOperationCommand,
	decodeCancelQueuedInputCommand,
	decodeCancelShakeCommand,
	decodeCycleModelCommand,
	decodeEditQueuedInputCommand,
	decodeGetCheckpointStateCommand,
	decodeInterruptPromptCommand,
	decodeRefreshSshToolCommand,
	decodePrepareHostTransitionCommand,
	decodeReloadSessionCommand,
	decodeReplaceTodosCommand,
	decodeRunCompactionCommand,
	decodeRunEphemeralTurnCommand,
	decodeRunHandoffCommand,
	decodeRunLocalOperationCommand,
	decodeRunShakeCommand,
	decodeSetActiveToolsCommand,
	decodeSetCheckpointStateCommand,
	decodeSetModelCommand,
	decodeSetThinkingLevelCommand,
	decodeSubmitCustomMessageCommand,
	decodeSubmitInputCommand,
	decodeTransitionGoalModeCommand,
	decodeTransitionPlanModeCommand,
	InvalidRunnerCommandError,
	RUNNER_SCHEMA_VERSION,
	RunnerCompactionTargetError,
	RunnerEphemeralTurnTargetError,
	RunnerLocalOperationTargetError,
} from "../runner/protocol";
import type { InteractiveHostIntent } from "./interactive-host-intent";
import type { SessionRunner } from "../runner/session-runner";
import {
	LocalTerminalSessionTransport,
	type TerminalSessionTransport,
} from "../runner/terminal-session-transport";
import type {
	TerminalAdvisorStats,
	TerminalAsyncJobSnapshot,
	TerminalContextUsage,
	TerminalExtensionCommandResult,
	TerminalHindsightSessionState,
	TerminalModelCatalogItem,
	TerminalPlanResolveResult,
	TerminalSessionMetadataSnapshot,
	TerminalSessionSnapshot,
	TerminalSessionStats,
	TerminalToolCatalog,
	TerminalTurnLifecycle,
	TerminalWorkflowEligibility,
} from "../runner/terminal-session-view";
import type { AgentSessionEvent } from "../session/agent-session";
import type { JsonValue } from "../session/durable-input-queue";
import type { ConfiguredThinkingLevel } from "../thinking";
import type { TodoPhase } from "../tools/todo";

export interface TerminalSubmitIntent {
	readonly text: string;
	readonly attachments?: ReadonlyArray<MediaContent>;
	readonly deliveryClass: "steer" | "followUp";
	readonly commandId?: string;
	readonly correlationId?: string;
	readonly causationId?: string;
}

export interface TerminalSubmitCustomMessageIntent {
	readonly payload: SubmitCustomMessageCommand["payload"];
	readonly commandId?: string;
	readonly correlationId?: string;
	readonly causationId?: string;
}

export interface TerminalEditIntent {
	readonly inputId: string;
	readonly itemRevision: number;
	readonly text: string;
	readonly attachments?: ReadonlyArray<MediaContent>;
	readonly commandId?: string;
	readonly correlationId?: string;
	readonly causationId?: string;
}

export interface TerminalCancelIntent {
	readonly inputId: string;
	readonly itemRevision: number;
	readonly commandId?: string;
	readonly correlationId?: string;
	readonly causationId?: string;
}

export interface TerminalSetActiveToolsIntent {
	readonly toolNames: ReadonlyArray<string>;
	readonly commandId?: string;
	readonly correlationId?: string;
	readonly causationId?: string;
}

export interface TerminalReplaceTodosIntent {
	readonly phases: ReadonlyArray<TodoPhase>;
	readonly commandId?: string;
	readonly correlationId?: string;
	readonly causationId?: string;
}

export interface TerminalRefreshSshToolIntent {
	readonly activateIfAvailable: boolean;
	readonly commandId?: string;
	readonly correlationId?: string;
	readonly causationId?: string;
}

export interface TerminalSetModelIntent {
	readonly provider: string;
	readonly id: string;
	readonly role?: string;
	readonly commandId?: string;
	readonly correlationId?: string;
	readonly causationId?: string;
}

export interface TerminalCycleModelIntent {
	readonly direction?: "forward" | "backward";
	readonly commandId?: string;
	readonly correlationId?: string;
	readonly causationId?: string;
}

export interface TerminalSetThinkingLevelIntent {
	readonly thinkingLevel: ConfiguredThinkingLevel | undefined;
	readonly commandId?: string;
	readonly correlationId?: string;
	readonly causationId?: string;
}

export interface TerminalTransitionPlanModeIntent {
	readonly transition:
		| {
				readonly kind: "enter";
				readonly planFilePath: string;
				readonly workflow: "parallel" | "iterative";
		  }
		| { readonly kind: "exit"; readonly disposition: "paused" | "disabled" };
	readonly commandId?: string;
	readonly correlationId?: string;
	readonly causationId?: string;
}

export interface TerminalTransitionGoalModeIntent {
	readonly transition:
		| {
				readonly kind: "enter";
				readonly action: "create";
				readonly objective: string;
				readonly tokenBudget?: number;
				readonly workstream?: string;
		  }
		| { readonly kind: "enter"; readonly action: "resume"; readonly goalId: string }
		| {
				readonly kind: "exit";
				readonly goalId: string;
				readonly disposition: "paused" | "dropped" | "completed";
		  };
	readonly commandId?: string;
	readonly correlationId?: string;
	readonly causationId?: string;
}

export interface TerminalInterruptPromptIntent {
	readonly commandId?: string;
	readonly correlationId?: string;
	readonly causationId?: string;
}

export interface TerminalShakeIntent {
	readonly mode: "elide" | "images";
	readonly commandId?: string;
	readonly correlationId?: string;
	readonly causationId?: string;
}

export interface TerminalCancelShakeIntent {
	readonly commandId?: string;
	readonly correlationId?: string;
	readonly causationId?: string;
}

export interface TerminalHandoffIntent {
	readonly customInstructions?: string;
	readonly commandId?: string;
	readonly correlationId?: string;
	readonly causationId?: string;
}

export interface TerminalCancelHandoffIntent {
	readonly commandId?: string;
	readonly correlationId?: string;
	readonly causationId?: string;
}

export interface TerminalGetCheckpointStateIntent {
	readonly commandId?: string;
	readonly correlationId?: string;
	readonly causationId?: string;
}

export interface TerminalSetCheckpointStateIntent {
	readonly state: RunnerCheckpointState | null;
	readonly commandId?: string;
	readonly correlationId?: string;
	readonly causationId?: string;
}

export interface TerminalReloadSessionIntent {
	readonly commandId?: string;
	readonly correlationId?: string;
	readonly causationId?: string;
}

export type TerminalPrepareHostTransitionIntent = InteractiveHostIntent & {
	readonly commandId?: string;
	readonly correlationId?: string;
	readonly causationId?: string;
};

export interface TerminalCompactionIntent {
	readonly customInstructions?: string;
	readonly commandId?: string;
	readonly correlationId?: string;
	readonly causationId?: string;
}

export interface TerminalCancelCompactionIntent {
	readonly commandId?: string;
	readonly correlationId?: string;
	readonly causationId?: string;
}

export interface TerminalEphemeralTurnIntent {
	readonly prompt: string;
	readonly commandId?: string;
	readonly correlationId?: string;
	readonly causationId?: string;
}

export interface TerminalCancelEphemeralTurnIntent {
	readonly commandId?: string;
	readonly correlationId?: string;
	readonly causationId?: string;
}

export type TerminalLocalOperationIntent = {
	readonly excludeFromContext: boolean;
	readonly commandId?: string;
	readonly correlationId?: string;
	readonly causationId?: string;
} & ({ readonly kind: "bash"; readonly command: string } | { readonly kind: "python"; readonly code: string });

export interface TerminalCancelLocalOperationIntent {
	readonly commandId?: string;
	readonly correlationId?: string;
	readonly causationId?: string;
}

export interface TerminalLocalOperationOutput {
	readonly commandId: string;
	readonly operationGeneration: number;
	readonly chunk: string;
	readonly totalBytes: number;
	readonly truncated: boolean;
	readonly reset: boolean;
}

export interface TerminalEphemeralTurnOutput {
	readonly commandId: string;
	readonly operationGeneration: number;
	readonly chunk: string;
	readonly totalBytes: number;
	readonly truncated: boolean;
	readonly reset: boolean;
}

export interface TerminalSessionControllerOptions {
	readonly viewId?: string;
	readonly commandId?: string;
	readonly correlationId?: string;
}

export interface TerminalSessionController {
	readonly viewId: string;
	readonly epoch: number;
	readonly snapshot: () => TerminalSessionSnapshot;
	readonly subscribeAgentEvents: (listener: (event: AgentSessionEvent) => void) => () => void;
	readonly subscribeLocalOperationOutput: (listener: (output: TerminalLocalOperationOutput) => void) => () => void;
	readonly subscribeEphemeralTurnOutput: (listener: (output: TerminalEphemeralTurnOutput) => void) => () => void;
	readonly refresh: () => Promise<TerminalSessionSnapshot>;
	readonly getContextUsage: (options?: {
		readonly contextWindow?: number;
	}) => Promise<TerminalContextUsage | undefined>;
	readonly getSessionStats: () => Promise<TerminalSessionStats>;
	readonly getAdvisorStats: () => Promise<TerminalAdvisorStats>;
	readonly getAsyncJobSnapshot: (options?: {
		readonly recentLimit?: number;
	}) => Promise<TerminalAsyncJobSnapshot | null>;
	readonly getHindsightSessionState: () => Promise<TerminalHindsightSessionState | undefined>;
	readonly getAllToolNames: () => Promise<ReadonlyArray<string>>;
	readonly formatSessionAsText: (options?: { readonly compact?: boolean }) => Promise<string>;
	readonly formatAdvisorHistoryAsText: (options?: { readonly compact?: boolean }) => Promise<string | null>;
	readonly getModelCatalog: () => Promise<readonly TerminalModelCatalogItem[]>;
	readonly getToolCatalog: () => Promise<TerminalToolCatalog>;
	readonly getSessionMetadataSnapshot: () => Promise<TerminalSessionMetadataSnapshot>;
	readonly getWorkflowEligibility: () => Promise<TerminalWorkflowEligibility>;
	readonly getTurnLifecycle: () => Promise<TerminalTurnLifecycle>;
	readonly saveDraft: (text: string) => Promise<void>;
	readonly consumeDraft: () => Promise<string | null>;
	readonly invokeExtensionCommand: (name: string, args: string) => Promise<TerminalExtensionCommandResult>;
	readonly invokePlanResolve: (input: JsonValue) => Promise<TerminalPlanResolveResult>;
	readonly requestGoalContinuation: () => Promise<boolean>;
	readonly submit: (intent: TerminalSubmitIntent) => Promise<RunnerCommandReceipt>;
	readonly submitCustomMessage: (intent: TerminalSubmitCustomMessageIntent) => Promise<RunnerCommandReceipt>;
	readonly edit: (intent: TerminalEditIntent) => Promise<RunnerCommandReceipt>;
	readonly cancel: (intent: TerminalCancelIntent) => Promise<RunnerCommandReceipt>;
	readonly setActiveTools: (intent: TerminalSetActiveToolsIntent) => Promise<SetActiveToolsReceipt>;
	readonly replaceTodos: (intent: TerminalReplaceTodosIntent) => Promise<ReplaceTodosReceipt>;
	readonly refreshSshTool: (intent: TerminalRefreshSshToolIntent) => Promise<RefreshSshToolReceipt>;
	readonly setModel: (intent: TerminalSetModelIntent) => Promise<SetModelReceipt>;
	readonly cycleModel: (intent?: TerminalCycleModelIntent) => Promise<CycleModelReceipt>;
	readonly setThinkingLevel: (intent: TerminalSetThinkingLevelIntent) => Promise<SetThinkingLevelReceipt>;
	readonly transitionPlanMode: (intent: TerminalTransitionPlanModeIntent) => Promise<TransitionPlanModeReceipt>;
	readonly transitionGoalMode: (intent: TerminalTransitionGoalModeIntent) => Promise<TransitionGoalModeReceipt>;
	readonly shake: (intent: TerminalShakeIntent) => Promise<RunShakeReceipt>;
	readonly cancelShake: (intent?: TerminalCancelShakeIntent) => Promise<CancelShakeReceipt>;
	readonly handoff: (intent?: TerminalHandoffIntent) => Promise<RunHandoffReceipt>;
	readonly cancelHandoff: (intent?: TerminalCancelHandoffIntent) => Promise<CancelHandoffReceipt>;
	readonly getCheckpointState: (intent?: TerminalGetCheckpointStateIntent) => Promise<GetCheckpointStateReceipt>;
	readonly setCheckpointState: (intent: TerminalSetCheckpointStateIntent) => Promise<SetCheckpointStateReceipt>;
	readonly reload: (intent?: TerminalReloadSessionIntent) => Promise<ReloadSessionReceipt>;
	readonly prepareHostTransition: (
		intent: TerminalPrepareHostTransitionIntent,
	) => Promise<PrepareHostTransitionReceipt>;
	readonly compact: (intent?: TerminalCompactionIntent) => Promise<RunCompactionReceipt>;
	readonly cancelCompaction: (intent?: TerminalCancelCompactionIntent) => Promise<CancelCompactionReceipt>;
	readonly runEphemeralTurn: (intent: TerminalEphemeralTurnIntent) => Promise<RunEphemeralTurnReceipt>;
	readonly cancelEphemeralTurn: (intent?: TerminalCancelEphemeralTurnIntent) => Promise<CancelEphemeralTurnReceipt>;
	readonly runLocalOperation: (intent: TerminalLocalOperationIntent) => Promise<RunLocalOperationReceipt>;
	readonly cancelLocalOperation: (intent?: TerminalCancelLocalOperationIntent) => Promise<CancelLocalOperationReceipt>;
	readonly interruptPrompt: (intent?: TerminalInterruptPromptIntent) => Promise<InterruptPromptReceipt>;
	readonly close: () => Promise<void>;
}

const metadata = (intent: { readonly commandId?: string; readonly correlationId?: string }) => {
	const commandId = intent.commandId ?? randomUUID();
	return { commandId, correlationId: intent.correlationId ?? commandId };
};

const stripHostTransitionMetadata = (intent: TerminalPrepareHostTransitionIntent): InteractiveHostIntent => {
	switch (intent.kind) {
		case "exit":
		case "freshSession":
		case "restartProcess":
			return { kind: intent.kind };
		case "newSession":
			return intent.parent === undefined ? { kind: "newSession" } : { kind: "newSession", parent: intent.parent };
		case "resume":
		case "switchSession":
			return { kind: intent.kind, session: intent.session };
		case "fork":
		case "branch":
			return { kind: intent.kind, entryId: intent.entryId };
		case "navigate":
			return { kind: "navigate", targetId: intent.targetId, summarize: intent.summarize };
		case "moveSession":
			return { kind: "moveSession", newDir: intent.newDir };
	}
};

/** Promise boundary for terminal code; transport owns runner authority and delivery scope. */
export async function createTerminalSessionController(
	source: SessionRunner | TerminalSessionTransport,
	options: TerminalSessionControllerOptions = {},
): Promise<TerminalSessionController> {
	const transport =
		"attachTerminalView" in source ? new LocalTerminalSessionTransport(source) : source;
	const viewId = options.viewId ?? `terminal:${randomUUID()}`;
	const attachCommandId = options.commandId ?? randomUUID();
	let attachment: Awaited<ReturnType<TerminalSessionTransport["attach"]>> | undefined;
	let closed = false;
	let unsubscribeTransport: (() => void) | undefined;
	try {
		attachment = await transport.attach({
			commandId: attachCommandId,
			correlationId: options.correlationId ?? attachCommandId,
			viewId,
		});
		const listeners = new Set<(event: AgentSessionEvent) => void>();
		const localOperationOutputListeners = new Set<(output: TerminalLocalOperationOutput) => void>();
		const ephemeralTurnOutputListeners = new Set<(output: TerminalEphemeralTurnOutput) => void>();
		let latest!: TerminalSessionSnapshot;
		const refresh = async (): Promise<TerminalSessionSnapshot> => {
			latest = await transport.requestSnapshot();
			return latest;
		};
		let deliveryChain = Promise.resolve();
		unsubscribeTransport = transport.subscribe(delivery => {
			deliveryChain = deliveryChain
				.then(async () => {
					if (delivery.kind === "resyncRequired") {
						latest = delivery.snapshot;
						return;
					}
					if (delivery.kind === "runnerEvent") {
						const output = delivery.event.localOperationOutput;
						const operationGeneration = delivery.event.targetOperationGeneration;
						if (output !== undefined && operationGeneration !== undefined) {
							const projected = {
								commandId: delivery.event.commandId,
								operationGeneration,
								...output,
							} satisfies TerminalLocalOperationOutput;
							for (const listener of localOperationOutputListeners) listener(projected);
						}
						const ephemeralOutput = delivery.event.ephemeralTurnOutput;
						if (ephemeralOutput !== undefined && operationGeneration !== undefined) {
							const projected = {
								commandId: delivery.event.commandId,
								operationGeneration,
								...ephemeralOutput,
							} satisfies TerminalEphemeralTurnOutput;
							for (const listener of ephemeralTurnOutputListeners) listener(projected);
						}
						await refresh();
						return;
					}
					for (const listener of listeners) listener(delivery.event);
				})
				.catch(() => {});
		});
		await refresh();
		const fenced = async (
			operation: (snapshot: TerminalSessionSnapshot) => Promise<RunnerCommandReceipt>,
		): Promise<RunnerCommandReceipt> => {
			try {
				const receipt = await operation(latest);
				latest = { ...latest, runner: { ...latest.runner, revision: receipt.revision } };
				return receipt;
			} catch (error) {
				await refresh();
				throw error;
			}
		};
		return {
			viewId,
			epoch: attachment.epoch,
			snapshot: () => latest,
			subscribeAgentEvents: listener => {
				listeners.add(listener);
				return () => listeners.delete(listener);
			},
			subscribeLocalOperationOutput: listener => {
				localOperationOutputListeners.add(listener);
				return () => localOperationOutputListeners.delete(listener);
			},
			subscribeEphemeralTurnOutput: listener => {
				ephemeralTurnOutputListeners.add(listener);
				return () => ephemeralTurnOutputListeners.delete(listener);
			},
			refresh,
			getContextUsage: queryOptions => transport.request("getContextUsage", [queryOptions]),
			getSessionStats: () => transport.request("getSessionStats", []),
			getAdvisorStats: () => transport.request("getAdvisorStats", []),
			getAsyncJobSnapshot: queryOptions => transport.request("getAsyncJobSnapshot", [queryOptions]),
			getHindsightSessionState: () => transport.request("getHindsightSessionState", []),
			getAllToolNames: () => transport.request("getAllToolNames", []),
			formatSessionAsText: queryOptions => transport.request("formatSessionAsText", [queryOptions]),
			formatAdvisorHistoryAsText: queryOptions => transport.request("formatAdvisorHistoryAsText", [queryOptions]),
			getModelCatalog: () => transport.request("getModelCatalog", []),
			getToolCatalog: () => transport.request("getToolCatalog", []),
			getSessionMetadataSnapshot: () => transport.request("getSessionMetadataSnapshot", []),
			getWorkflowEligibility: () => transport.request("getWorkflowEligibility", []),
			getTurnLifecycle: () => transport.request("getTurnLifecycle", []),
			saveDraft: text => transport.request("saveDraft", [text]),
			consumeDraft: () => transport.request("consumeDraft", []),
			invokeExtensionCommand: (name, args) => transport.request("invokeExtensionCommand", [name, args]),
			invokePlanResolve: input => transport.request("invokePlanResolve", [input]),
			requestGoalContinuation: () => transport.request("requestGoalContinuation", []),
			submit: intent =>
				fenced(async current => {
					const ids = metadata(intent);
					return transport.sendCommand(decodeSubmitInputCommand({
								schemaVersion: RUNNER_SCHEMA_VERSION,
								kind: "submitInput",
								...ids,
								...(intent.causationId === undefined ? {} : { causationId: intent.causationId }),
								expectedRevision: current.runner.revision,
								viewId,
								controllerEpoch: attachment!.epoch,
								payload: {
									text: intent.text,
									...(intent.attachments === undefined ? {} : { attachments: [...intent.attachments] }),
									deliveryClass: intent.deliveryClass,
								},
							}));
				}),
			submitCustomMessage: intent =>
				fenced(async current => {
					const ids = metadata(intent);
					return transport.sendCommand(decodeSubmitCustomMessageCommand({
								schemaVersion: RUNNER_SCHEMA_VERSION,
								kind: "submitCustomMessage",
								...ids,
								...(intent.causationId === undefined ? {} : { causationId: intent.causationId }),
								expectedRevision: current.runner.revision,
								viewId,
								controllerEpoch: attachment!.epoch,
								payload: intent.payload,
							}));
				}),
			edit: intent =>
				fenced(async current => {
					const ids = metadata(intent);
					return transport.sendCommand(decodeEditQueuedInputCommand({
								schemaVersion: RUNNER_SCHEMA_VERSION,
								kind: "editQueuedInput",
								...ids,
								...(intent.causationId === undefined ? {} : { causationId: intent.causationId }),
								expectedRevision: current.runner.revision,
								viewId,
								controllerEpoch: attachment!.epoch,
								inputId: intent.inputId,
								itemRevision: intent.itemRevision,
								payload: {
									text: intent.text,
									...(intent.attachments === undefined ? {} : { attachments: [...intent.attachments] }),
								},
							}));
				}),
			cancel: intent =>
				fenced(async current => {
					const ids = metadata(intent);
					return transport.sendCommand(decodeCancelQueuedInputCommand({
								schemaVersion: RUNNER_SCHEMA_VERSION,
								kind: "cancelQueuedInput",
								...ids,
								...(intent.causationId === undefined ? {} : { causationId: intent.causationId }),
								expectedRevision: current.runner.revision,
								viewId,
								controllerEpoch: attachment!.epoch,
								inputId: intent.inputId,
								itemRevision: intent.itemRevision,
							}));
				}),
			setActiveTools: async intent => {
				const current = await refresh();
				try {
					const ids = metadata(intent);
					const receipt = await transport.sendCommand(decodeSetActiveToolsCommand({
								schemaVersion: RUNNER_SCHEMA_VERSION,
								kind: "setActiveTools",
								...ids,
								...(intent.causationId === undefined ? {} : { causationId: intent.causationId }),
								viewId,
								controllerEpoch: attachment!.epoch,
								expectedToolConfigurationGeneration: current.runner.toolConfigurationGeneration,
								toolNames: [...intent.toolNames],
							}));
					await refresh();
					return receipt;
				} catch (error) {
					await refresh();
					throw error;
				}
			},
			replaceTodos: async intent => {
				const current = await refresh();
				try {
					const ids = metadata(intent);
					const receipt = await transport.sendCommand(decodeReplaceTodosCommand({
								schemaVersion: RUNNER_SCHEMA_VERSION,
								kind: "replaceTodos",
								...ids,
								...(intent.causationId === undefined ? {} : { causationId: intent.causationId }),
								viewId,
								controllerEpoch: attachment!.epoch,
								expectedTodoGeneration: current.runner.todoGeneration,
								phases: intent.phases.map(phase => ({
									name: phase.name,
									tasks: phase.tasks.map(task => ({ content: task.content, status: task.status })),
								})),
							}));
					await refresh();
					return receipt;
				} catch (error) {
					await refresh();
					throw error;
				}
			},
			refreshSshTool: async intent => {
				const current = await refresh();
				try {
					const ids = metadata(intent);
					const receipt = await transport.sendCommand(decodeRefreshSshToolCommand({
								schemaVersion: RUNNER_SCHEMA_VERSION,
								kind: "refreshSshTool",
								...ids,
								...(intent.causationId === undefined ? {} : { causationId: intent.causationId }),
								viewId,
								controllerEpoch: attachment!.epoch,
								expectedToolConfigurationGeneration: current.runner.toolConfigurationGeneration,
								activateIfAvailable: intent.activateIfAvailable,
							}));
					await refresh();
					return receipt;
				} catch (error) {
					await refresh();
					throw error;
				}
			},
			setModel: async intent => {
				try {
					const ids = metadata(intent);
					const receipt = await transport.sendCommand(decodeSetModelCommand({
								schemaVersion: RUNNER_SCHEMA_VERSION,
								kind: "setModel",
								...ids,
								...(intent.causationId === undefined ? {} : { causationId: intent.causationId }),
								expectedSessionRevision: latest.runner.sessionRevision,
								viewId,
								controllerEpoch: attachment!.epoch,
								payload: {
									provider: intent.provider,
									id: intent.id,
									...(intent.role === undefined ? {} : { role: intent.role }),
								},
							}));
					latest = await transport.requestSnapshot();
					return receipt;
				} catch (error) {
					await refresh();
					throw error;
				}
			},
			cycleModel: async (intent = {}) => {
				const current = await refresh();
				try {
					const ids = metadata(intent);
					const receipt = await transport.sendCommand(decodeCycleModelCommand({
								schemaVersion: RUNNER_SCHEMA_VERSION,
								kind: "cycleModel",
								...ids,
								...(intent.causationId === undefined ? {} : { causationId: intent.causationId }),
								expectedSessionRevision: current.runner.sessionRevision,
								viewId,
								controllerEpoch: attachment!.epoch,
								direction: intent.direction ?? "forward",
							}));
					await refresh();
					return receipt;
				} catch (error) {
					await refresh();
					throw error;
				}
			},
			setThinkingLevel: async intent => {
				try {
					const ids = metadata(intent);
					const receipt = await transport.sendCommand(decodeSetThinkingLevelCommand({
								schemaVersion: RUNNER_SCHEMA_VERSION,
								kind: "setThinkingLevel",
								...ids,
								...(intent.causationId === undefined ? {} : { causationId: intent.causationId }),
								expectedSessionRevision: latest.runner.sessionRevision,
								viewId,
								controllerEpoch: attachment!.epoch,
								...(intent.thinkingLevel === undefined ? {} : { thinkingLevel: intent.thinkingLevel }),
							}));
					latest = {
						...latest,
						runner: {
							...latest.runner,
							sessionRevision: Math.max(latest.runner.sessionRevision, receipt.sessionRevision),
						},
					};
					return receipt;
				} catch (error) {
					await refresh();
					throw error;
				}
			},
			transitionPlanMode: async intent => {
				const current = await refresh();
				try {
					const ids = metadata(intent);
					const receipt = await transport.sendCommand(decodeTransitionPlanModeCommand({
								schemaVersion: RUNNER_SCHEMA_VERSION,
								kind: "transitionPlanMode",
								...ids,
								...(intent.causationId === undefined ? {} : { causationId: intent.causationId }),
								expectedSessionRevision: current.runner.sessionRevision,
								viewId,
								controllerEpoch: attachment!.epoch,
								transition: intent.transition,
							}));
					await refresh();
					return receipt;
				} catch (error) {
					await refresh();
					throw error;
				}
			},
			transitionGoalMode: async intent => {
				const current = await refresh();
				try {
					const ids = metadata(intent);
					const receipt = await transport.sendCommand(decodeTransitionGoalModeCommand({
								schemaVersion: RUNNER_SCHEMA_VERSION,
								kind: "transitionGoalMode",
								...ids,
								...(intent.causationId === undefined ? {} : { causationId: intent.causationId }),
								expectedSessionRevision: current.runner.sessionRevision,
								viewId,
								controllerEpoch: attachment!.epoch,
								transition: intent.transition,
							}));
					await refresh();
					return receipt;
				} catch (error) {
					await refresh();
					throw error;
				}
			},
			shake: async intent => {
				const current = await refresh();
				try {
					const ids = metadata(intent);
					const receipt = await transport.sendCommand(decodeRunShakeCommand({
								schemaVersion: RUNNER_SCHEMA_VERSION,
								kind: "runShake",
								...ids,
								...(intent.causationId === undefined ? {} : { causationId: intent.causationId }),
								expectedSessionRevision: current.runner.sessionRevision,
								viewId,
								controllerEpoch: attachment!.epoch,
								mode: intent.mode,
							}));
					await refresh();
					return receipt;
				} catch (error) {
					await refresh();
					throw error;
				}
			},
			cancelShake: async (intent = {}) => {
				const current = await refresh();
				const active = current.runner.activeSessionOperation;
				if (active?.kind !== "shake") {
					throw new InvalidRunnerCommandError({ issue: "No active shake operation" });
				}
				const ids = metadata(intent);
				const receipt = await transport.sendCommand(decodeCancelShakeCommand({
							schemaVersion: RUNNER_SCHEMA_VERSION,
							kind: "cancelShake",
							...ids,
							...(intent.causationId === undefined ? {} : { causationId: intent.causationId }),
							viewId,
							controllerEpoch: attachment!.epoch,
							targetCommandId: active.commandId,
							targetOperationGeneration: active.operationGeneration,
						}));
				await refresh();
				return receipt;
			},
			handoff: async (intent = {}) => {
				const current = await refresh();
				try {
					const ids = metadata(intent);
					const receipt = await transport.sendCommand(decodeRunHandoffCommand({
								schemaVersion: RUNNER_SCHEMA_VERSION,
								kind: "runHandoff",
								...ids,
								...(intent.causationId === undefined ? {} : { causationId: intent.causationId }),
								expectedSessionRevision: current.runner.sessionRevision,
								viewId,
								controllerEpoch: attachment!.epoch,
								...(intent.customInstructions === undefined
									? {}
									: { customInstructions: intent.customInstructions }),
							}));
					await refresh();
					return receipt;
				} catch (error) {
					await refresh();
					throw error;
				}
			},
			cancelHandoff: async (intent = {}) => {
				const current = await refresh();
				const active = current.runner.activeSessionOperation;
				if (active?.kind !== "handoff") {
					throw new InvalidRunnerCommandError({ issue: "No active handoff operation" });
				}
				const ids = metadata(intent);
				const receipt = await transport.sendCommand(decodeCancelHandoffCommand({
							schemaVersion: RUNNER_SCHEMA_VERSION,
							kind: "cancelHandoff",
							...ids,
							...(intent.causationId === undefined ? {} : { causationId: intent.causationId }),
							viewId,
							controllerEpoch: attachment!.epoch,
							targetCommandId: active.commandId,
							targetOperationGeneration: active.operationGeneration,
						}));
				await refresh();
				return receipt;
			},
			getCheckpointState: async (intent = {}) => {
				const ids = metadata(intent);
				try {
					return await transport.sendCommand(decodeGetCheckpointStateCommand({
								schemaVersion: RUNNER_SCHEMA_VERSION,
								kind: "getCheckpointState",
								...ids,
								...(intent.causationId === undefined ? {} : { causationId: intent.causationId }),
								viewId,
								controllerEpoch: attachment!.epoch,
							}));
				} catch (error) {
					await refresh();
					throw error;
				}
			},
			setCheckpointState: async intent => {
				const current = await refresh();
				try {
					const ids = metadata(intent);
					const receipt = await transport.sendCommand(decodeSetCheckpointStateCommand({
								schemaVersion: RUNNER_SCHEMA_VERSION,
								kind: "setCheckpointState",
								...ids,
								...(intent.causationId === undefined ? {} : { causationId: intent.causationId }),
								viewId,
								controllerEpoch: attachment!.epoch,
								expectedCheckpointRevision: current.runner.checkpointRevision,
								state: intent.state,
							}));
					await refresh();
					return receipt;
				} catch (error) {
					await refresh();
					throw error;
				}
			},
			reload: async (intent = {}) => {
				const current = await refresh();
				try {
					const ids = metadata(intent);
					const receipt = await transport.sendCommand(decodeReloadSessionCommand({
								schemaVersion: RUNNER_SCHEMA_VERSION,
								kind: "reloadSession",
								...ids,
								...(intent.causationId === undefined ? {} : { causationId: intent.causationId }),
								expectedSessionRevision: current.runner.sessionRevision,
								viewId,
								controllerEpoch: attachment!.epoch,
							}));
					await refresh();
					return receipt;
				} catch (error) {
					await refresh();
					throw error;
				}
			},
			prepareHostTransition: async intent => {
				const current = await refresh();
				try {
					const ids = metadata(intent);
					const receipt = await transport.sendCommand(decodePrepareHostTransitionCommand({
								schemaVersion: RUNNER_SCHEMA_VERSION,
								kind: "prepareHostTransition",
								...ids,
								...(intent.causationId === undefined ? {} : { causationId: intent.causationId }),
								expectedSessionRevision: current.runner.sessionRevision,
								viewId,
								controllerEpoch: attachment!.epoch,
								intent: stripHostTransitionMetadata(intent),
							}));
					await refresh();
					return receipt;
				} catch (error) {
					await refresh();
					throw error;
				}
			},
			compact: async (intent = {}) => {
				const current = await refresh();
				try {
					const ids = metadata(intent);
					const receipt = await transport.sendCommand(decodeRunCompactionCommand({
								schemaVersion: RUNNER_SCHEMA_VERSION,
								kind: "runCompaction",
								...ids,
								...(intent.causationId === undefined ? {} : { causationId: intent.causationId }),
								expectedSessionRevision: current.runner.sessionRevision,
								viewId,
								controllerEpoch: attachment!.epoch,
								...(intent.customInstructions === undefined
									? {}
									: { customInstructions: intent.customInstructions }),
							}));
					await refresh();
					return receipt;
				} catch (error) {
					await refresh();
					throw error;
				}
			},
			cancelCompaction: async (intent = {}) => {
				const current = await refresh();
				const activeCompaction = current.runner.activeCompaction;
				if (activeCompaction === undefined) {
					throw new RunnerCompactionTargetError({
						targetCommandId: "",
						targetOperationGeneration: 0,
					});
				}
				const ids = metadata(intent);
				const receipt = await transport.sendCommand(decodeCancelCompactionCommand({
							schemaVersion: RUNNER_SCHEMA_VERSION,
							kind: "cancelCompaction",
							...ids,
							...(intent.causationId === undefined ? {} : { causationId: intent.causationId }),
							viewId,
							controllerEpoch: attachment!.epoch,
							targetCommandId: activeCompaction.commandId,
							targetOperationGeneration: activeCompaction.operationGeneration,
						}));
				await refresh();
				return receipt;
			},
			runEphemeralTurn: async intent => {
				const current = await refresh();
				try {
					const ids = metadata(intent);
					const receipt = await transport.sendCommand(decodeRunEphemeralTurnCommand({
								schemaVersion: RUNNER_SCHEMA_VERSION,
								kind: "runEphemeralTurn",
								...ids,
								...(intent.causationId === undefined ? {} : { causationId: intent.causationId }),
								expectedSessionRevision: current.runner.sessionRevision,
								viewId,
								controllerEpoch: attachment!.epoch,
								prompt: intent.prompt,
							}));
					await refresh();
					return receipt;
				} catch (error) {
					await refresh();
					throw error;
				}
			},
			cancelEphemeralTurn: async (intent = {}) => {
				const current = await refresh();
				const active = current.runner.activeEphemeralTurn;
				if (active === undefined) {
					throw new RunnerEphemeralTurnTargetError({
						targetCommandId: "",
						targetOperationGeneration: 0,
					});
				}
				const ids = metadata(intent);
				const receipt = await transport.sendCommand(decodeCancelEphemeralTurnCommand({
							schemaVersion: RUNNER_SCHEMA_VERSION,
							kind: "cancelEphemeralTurn",
							...ids,
							...(intent.causationId === undefined ? {} : { causationId: intent.causationId }),
							expectedSessionRevision: current.runner.sessionRevision,
							viewId,
							controllerEpoch: attachment!.epoch,
							targetCommandId: active.commandId,
							targetOperationGeneration: active.operationGeneration,
						}));
				await refresh();
				return receipt;
			},
			runLocalOperation: async intent => {
				const current = await refresh();
				try {
					const ids = metadata(intent);
					const receipt = await transport.sendCommand(decodeRunLocalOperationCommand({
								schemaVersion: RUNNER_SCHEMA_VERSION,
								kind: "runLocalOperation",
								...ids,
								...(intent.causationId === undefined ? {} : { causationId: intent.causationId }),
								expectedSessionRevision: current.runner.sessionRevision,
								viewId,
								controllerEpoch: attachment!.epoch,
								operation:
									intent.kind === "bash"
										? {
												kind: "bash",
												command: intent.command,
												excludeFromContext: intent.excludeFromContext,
												useUserShell: true,
											}
										: {
												kind: "python",
												code: intent.code,
												excludeFromContext: intent.excludeFromContext,
											},
							}));
					await refresh();
					return receipt;
				} catch (error) {
					await refresh();
					throw error;
				}
			},
			cancelLocalOperation: async (intent = {}) => {
				const current = await refresh();
				const active = current.runner.activeLocalOperation;
				if (active === undefined) {
					throw new RunnerLocalOperationTargetError({
						targetCommandId: "",
						targetOperationGeneration: 0,
					});
				}
				const ids = metadata(intent);
				const receipt = await transport.sendCommand(decodeCancelLocalOperationCommand({
							schemaVersion: RUNNER_SCHEMA_VERSION,
							kind: "cancelLocalOperation",
							...ids,
							...(intent.causationId === undefined ? {} : { causationId: intent.causationId }),
							expectedSessionRevision: current.runner.sessionRevision,
							viewId,
							controllerEpoch: attachment!.epoch,
							targetCommandId: active.commandId,
							targetOperationGeneration: active.operationGeneration,
						}));
				await refresh();
				return receipt;
			},
			interruptPrompt: async (intent = {}) => {
				try {
					const ids = metadata(intent);
					const targetGeneration = (await refresh()).session.promptOperation.generation;
					const receipt = await transport.sendCommand(decodeInterruptPromptCommand({
								schemaVersion: RUNNER_SCHEMA_VERSION,
								kind: "interruptPrompt",
								...ids,
								...(intent.causationId === undefined ? {} : { causationId: intent.causationId }),
								viewId,
								controllerEpoch: attachment!.epoch,
								targetGeneration,
							}));
					await refresh();
					return receipt;
				} catch (error) {
					await refresh();
					throw error;
				}
			},
			close: async () => {
				if (closed) return;
				closed = true;
				unsubscribeTransport?.();
				unsubscribeTransport = undefined;
				try {
					await attachment!.detach();
				} finally {
					listeners.clear();
					localOperationOutputListeners.clear();
					ephemeralTurnOutputListeners.clear();
				}
			},
		};
	} catch (error) {
		unsubscribeTransport?.();
		await attachment?.detach().catch(() => {});
		throw error;
	}
}
