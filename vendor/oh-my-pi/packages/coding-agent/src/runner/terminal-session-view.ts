import type { ThinkingLevel } from "@oh-my-pi/pi-agent-core";
import type { Model } from "@oh-my-pi/pi-ai";
import type { Effect, Scope } from "effect";
import type { ContextUsage } from "../extensibility/extensions/types";
import type { GoalModeState } from "../goals/state";
import type {
	AdvisorStats,
	AgentSessionEvent,
	AgentSessionMetadataSnapshot,
	AgentSessionModelCatalogItem,
	AgentSessionToolCatalog,
	AgentSessionWorkflowEligibility,
	AsyncJobSnapshot,
	ExtensionCommandInvocationResult,
	PlanResolveInvocationResult,
	SessionStats,
} from "../session/agent-session";
import type { JsonValue } from "../session/durable-input-queue";
import type { WorkflowModeSnapshot } from "../session/session-entries";
import type { ConfiguredThinkingLevel } from "../thinking";
import type { TodoPhase } from "../tools/todo";
import type {
	CancelCompactionCommand,
	CancelCompactionReceipt,
	CancelEphemeralTurnCommand,
	CancelEphemeralTurnReceipt,
	CancelHandoffCommand,
	CancelHandoffReceipt,
	CancelLocalOperationCommand,
	CancelLocalOperationReceipt,
	CancelQueuedInputCommand,
	CancelShakeCommand,
	CancelShakeReceipt,
	CycleModelCommand,
	CycleModelReceipt,
	EditQueuedInputCommand,
	GetCheckpointStateCommand,
	GetCheckpointStateReceipt,
	InterruptPromptCommand,
	InterruptPromptReceipt,
	RefreshSshToolCommand,
	RefreshSshToolReceipt,
	ReloadSessionCommand,
	ReloadSessionReceipt,
	ReplaceTodosCommand,
	ReplaceTodosReceipt,
	RunCompactionCommand,
	RunCompactionReceipt,
	RunEphemeralTurnCommand,
	RunEphemeralTurnReceipt,
	RunHandoffCommand,
	RunHandoffReceipt,
	RunLocalOperationCommand,
	RunLocalOperationReceipt,
	RunnerCommandReceipt,
	RunnerEvent,
	RunnerTurnLifecycle,
	RunShakeCommand,
	RunShakeReceipt,
	SessionRunnerSnapshot,
	SetActiveToolsCommand,
	SetActiveToolsReceipt,
	SetCheckpointStateCommand,
	SetCheckpointStateReceipt,
	SetModelCommand,
	SetModelReceipt,
	SetThinkingLevelCommand,
	SetThinkingLevelReceipt,
	SubmitCustomMessageCommand,
	SubmitInputCommand,
	TransitionGoalModeCommand,
	TransitionGoalModeReceipt,
	TransitionPlanModeCommand,
	TransitionPlanModeReceipt,
} from "./protocol";
import type { RunnerFailure } from "./session-runner";

export type TerminalModelSnapshot = Readonly<
	Pick<Model, "provider" | "api" | "id" | "requestModelId" | "name" | "contextWindow">
>;
export type TerminalContextUsage = Readonly<ContextUsage>;
export type TerminalSessionStats = Readonly<
	Omit<SessionStats, "tokens"> & { readonly tokens: Readonly<SessionStats["tokens"]> }
>;
export type TerminalAdvisorStats = Readonly<
	Omit<AdvisorStats, "model" | "tokens" | "messages"> & {
		readonly model?: TerminalModelSnapshot;
		readonly tokens: Readonly<AdvisorStats["tokens"]>;
		readonly messages: Readonly<AdvisorStats["messages"]>;
	}
>;
export type TerminalAsyncJobSnapshot = Readonly<
	Omit<AsyncJobSnapshot, "running" | "recent" | "delivery"> & {
		readonly running: ReadonlyArray<Readonly<AsyncJobSnapshot["running"][number]>>;
		readonly recent: ReadonlyArray<Readonly<AsyncJobSnapshot["recent"][number]>>;
		readonly delivery: Readonly<
			Omit<AsyncJobSnapshot["delivery"], "pendingJobIds"> & {
				readonly pendingJobIds: ReadonlyArray<string>;
			}
		>;
	}
>;
export type TerminalModelCatalogItem = Readonly<AgentSessionModelCatalogItem>;
export type TerminalToolCatalog = Readonly<AgentSessionToolCatalog>;
export type TerminalSessionMetadataSnapshot = Readonly<AgentSessionMetadataSnapshot>;
export type TerminalWorkflowEligibility = Readonly<AgentSessionWorkflowEligibility>;
export type TerminalTurnLifecycle = Readonly<RunnerTurnLifecycle>;
export type TerminalExtensionCommandResult = ExtensionCommandInvocationResult;
export type TerminalPlanResolveResult = PlanResolveInvocationResult;

export interface TerminalHindsightSessionState {
	readonly sessionId: string;
	readonly bankId: string;
	readonly retainTags: ReadonlyArray<string> | undefined;
	readonly recallTags: ReadonlyArray<string> | undefined;
	readonly recallTagsMatch: "any" | "all" | "any_strict" | "all_strict" | undefined;
	readonly lastRetainedTurn: number;
	readonly hasRecalledForFirstTurn: boolean;
	readonly lastRecallSnippet: string | undefined;
	readonly mentalModelsSnippet: string | undefined;
	readonly mentalModelsLoadedAt: number | undefined;
	readonly isAlias: boolean;
}

export interface TerminalSessionStateSnapshot {
	readonly sessionId: string;
	readonly sessionFile: string | undefined;
	readonly cwd: string;
	readonly modelSummary: TerminalModelSnapshot | undefined;
	readonly configuredThinkingLevel: ConfiguredThinkingLevel | undefined;
	readonly effectiveThinkingLevel: ThinkingLevel | undefined;
	readonly workflow: WorkflowModeSnapshot;
	readonly toolConfigurationGeneration: number;
	readonly activeToolNames: ReadonlyArray<string>;
	readonly todoGeneration: number;
	readonly todoPhases: ReadonlyArray<TodoPhase>;
	readonly goalModeState: GoalModeState | undefined;
	readonly planReferencePath: string;
	readonly autoCompactionEnabled: boolean;
	readonly isStreaming: boolean;
	readonly isCompacting: boolean;
	readonly hasPostPromptWork: boolean;
	readonly isBashRunning: boolean;
	readonly isEvalRunning: boolean;
	readonly promptOperation: { readonly generation: number; readonly active: boolean };
}

export interface TerminalSessionSnapshot {
	readonly terminalSequence: number;
	readonly runner: SessionRunnerSnapshot;
	readonly session: TerminalSessionStateSnapshot;
}

export type TerminalSessionDelivery =
	| { readonly kind: "agentEvent"; readonly sequence: number; readonly event: AgentSessionEvent }
	| { readonly kind: "runnerEvent"; readonly sequence: number; readonly event: RunnerEvent }
	| {
			readonly kind: "resyncRequired";
			readonly expectedSequence: number;
			readonly observedSequence: number;
			readonly snapshot: TerminalSessionSnapshot;
	  };

export interface TerminalSessionSubscription {
	readonly take: Effect.Effect<TerminalSessionDelivery, RunnerFailure, Scope.Scope>;
}

/** Controller-only projection. The live AgentSession and SessionManager never cross this boundary. */
export interface TerminalSessionView {
	readonly viewId: string;
	readonly epoch: number;
	readonly snapshot: () => Effect.Effect<TerminalSessionSnapshot, RunnerFailure, Scope.Scope>;
	readonly subscribe: () => Effect.Effect<TerminalSessionSubscription, RunnerFailure, Scope.Scope>;
	readonly getContextUsage: (options?: {
		readonly contextWindow?: number;
	}) => Effect.Effect<TerminalContextUsage | undefined, RunnerFailure, Scope.Scope>;
	readonly getSessionStats: () => Effect.Effect<TerminalSessionStats, RunnerFailure, Scope.Scope>;
	readonly getAdvisorStats: () => Effect.Effect<TerminalAdvisorStats, RunnerFailure, Scope.Scope>;
	readonly getAsyncJobSnapshot: (options?: {
		readonly recentLimit?: number;
	}) => Effect.Effect<TerminalAsyncJobSnapshot | null, RunnerFailure, Scope.Scope>;
	readonly getHindsightSessionState: () => Effect.Effect<
		TerminalHindsightSessionState | undefined,
		RunnerFailure,
		Scope.Scope
	>;
	readonly getAllToolNames: () => Effect.Effect<ReadonlyArray<string>, RunnerFailure, Scope.Scope>;
	readonly formatSessionAsText: (options?: {
		readonly compact?: boolean;
	}) => Effect.Effect<string, RunnerFailure, Scope.Scope>;
	readonly formatAdvisorHistoryAsText: (options?: {
		readonly compact?: boolean;
	}) => Effect.Effect<string | null, RunnerFailure, Scope.Scope>;
	readonly getModelCatalog: () => Effect.Effect<readonly TerminalModelCatalogItem[], RunnerFailure, Scope.Scope>;
	readonly getToolCatalog: () => Effect.Effect<TerminalToolCatalog, RunnerFailure, Scope.Scope>;
	readonly getSessionMetadataSnapshot: () => Effect.Effect<
		TerminalSessionMetadataSnapshot,
		RunnerFailure,
		Scope.Scope
	>;
	readonly getWorkflowEligibility: () => Effect.Effect<TerminalWorkflowEligibility, RunnerFailure, Scope.Scope>;
	readonly getTurnLifecycle: () => Effect.Effect<TerminalTurnLifecycle, RunnerFailure, Scope.Scope>;
	readonly saveDraft: (text: string) => Effect.Effect<void, RunnerFailure, Scope.Scope>;
	readonly consumeDraft: () => Effect.Effect<string | null, RunnerFailure, Scope.Scope>;
	readonly invokeExtensionCommand: (
		name: string,
		args: string,
	) => Effect.Effect<TerminalExtensionCommandResult, RunnerFailure, Scope.Scope>;
	readonly invokePlanResolve: (
		input: JsonValue,
	) => Effect.Effect<TerminalPlanResolveResult, RunnerFailure, Scope.Scope>;
	readonly requestGoalContinuation: () => Effect.Effect<boolean, RunnerFailure, Scope.Scope>;
	readonly submit: (command: SubmitInputCommand) => Effect.Effect<RunnerCommandReceipt, RunnerFailure, Scope.Scope>;
	readonly submitCustomMessage: (
		command: SubmitCustomMessageCommand,
	) => Effect.Effect<RunnerCommandReceipt, RunnerFailure, Scope.Scope>;
	readonly edit: (command: EditQueuedInputCommand) => Effect.Effect<RunnerCommandReceipt, RunnerFailure, Scope.Scope>;
	readonly cancel: (
		command: CancelQueuedInputCommand,
	) => Effect.Effect<RunnerCommandReceipt, RunnerFailure, Scope.Scope>;
	readonly setActiveTools: (
		command: SetActiveToolsCommand,
	) => Effect.Effect<SetActiveToolsReceipt, RunnerFailure, Scope.Scope>;
	readonly replaceTodos: (
		command: ReplaceTodosCommand,
	) => Effect.Effect<ReplaceTodosReceipt, RunnerFailure, Scope.Scope>;
	readonly refreshSshTool: (
		command: RefreshSshToolCommand,
	) => Effect.Effect<RefreshSshToolReceipt, RunnerFailure, Scope.Scope>;
	readonly setModel: (command: SetModelCommand) => Effect.Effect<SetModelReceipt, RunnerFailure, Scope.Scope>;
	readonly cycleModel: (command: CycleModelCommand) => Effect.Effect<CycleModelReceipt, RunnerFailure, Scope.Scope>;
	readonly setThinkingLevel: (
		command: SetThinkingLevelCommand,
	) => Effect.Effect<SetThinkingLevelReceipt, RunnerFailure, Scope.Scope>;
	readonly transitionPlanMode: (
		command: TransitionPlanModeCommand,
	) => Effect.Effect<TransitionPlanModeReceipt, RunnerFailure, Scope.Scope>;
	readonly transitionGoalMode: (
		command: TransitionGoalModeCommand,
	) => Effect.Effect<TransitionGoalModeReceipt, RunnerFailure, Scope.Scope>;
	readonly shake: (command: RunShakeCommand) => Effect.Effect<RunShakeReceipt, RunnerFailure, Scope.Scope>;
	readonly cancelShake: (command: CancelShakeCommand) => Effect.Effect<CancelShakeReceipt, RunnerFailure, Scope.Scope>;
	readonly handoff: (command: RunHandoffCommand) => Effect.Effect<RunHandoffReceipt, RunnerFailure, Scope.Scope>;
	readonly cancelHandoff: (
		command: CancelHandoffCommand,
	) => Effect.Effect<CancelHandoffReceipt, RunnerFailure, Scope.Scope>;
	readonly getCheckpointState: (
		command: GetCheckpointStateCommand,
	) => Effect.Effect<GetCheckpointStateReceipt, RunnerFailure, Scope.Scope>;
	readonly setCheckpointState: (
		command: SetCheckpointStateCommand,
	) => Effect.Effect<SetCheckpointStateReceipt, RunnerFailure, Scope.Scope>;
	readonly reload: (command: ReloadSessionCommand) => Effect.Effect<ReloadSessionReceipt, RunnerFailure, Scope.Scope>;
	readonly compact: (command: RunCompactionCommand) => Effect.Effect<RunCompactionReceipt, RunnerFailure, Scope.Scope>;
	readonly cancelCompaction: (
		command: CancelCompactionCommand,
	) => Effect.Effect<CancelCompactionReceipt, RunnerFailure, Scope.Scope>;
	readonly runEphemeralTurn: (
		command: RunEphemeralTurnCommand,
	) => Effect.Effect<RunEphemeralTurnReceipt, RunnerFailure, Scope.Scope>;
	readonly cancelEphemeralTurn: (
		command: CancelEphemeralTurnCommand,
	) => Effect.Effect<CancelEphemeralTurnReceipt, RunnerFailure, Scope.Scope>;
	readonly runLocalOperation: (
		command: RunLocalOperationCommand,
	) => Effect.Effect<RunLocalOperationReceipt, RunnerFailure, Scope.Scope>;
	readonly cancelLocalOperation: (
		command: CancelLocalOperationCommand,
	) => Effect.Effect<CancelLocalOperationReceipt, RunnerFailure, Scope.Scope>;
	readonly interruptPrompt: (
		command: InterruptPromptCommand,
	) => Effect.Effect<InterruptPromptReceipt, RunnerFailure, Scope.Scope>;
	readonly detach: () => Effect.Effect<void, RunnerFailure, Scope.Scope>;
}
