import type { AgentMessage } from "@oh-my-pi/pi-agent-core";
import type { Model } from "@oh-my-pi/pi-ai";
import type { Effect, Scope } from "effect";
import type { ConfiguredThinkingLevel } from "../thinking";
import type { AgentSessionEvent } from "../session/agent-session";
import type { WorkflowModeSnapshot } from "../session/session-entries";
import type {
	CancelQueuedInputCommand,
	CancelCompactionCommand,
	CancelCompactionReceipt,
	EditQueuedInputCommand,
	InterruptPromptCommand,
	InterruptPromptReceipt,
	RunnerCommandReceipt,
	RunnerEvent,
	RunCompactionCommand,
	RunCompactionReceipt,
	SessionRunnerSnapshot,
	SetModelCommand,
	SetModelReceipt,
	SetThinkingLevelCommand,
	SetThinkingLevelReceipt,
	SubmitInputCommand,
	TransitionPlanModeCommand,
	TransitionPlanModeReceipt,
} from "./protocol";
import type { RunnerFailure } from "./session-runner";

export type TerminalModelSnapshot = Readonly<Pick<Model, "provider" | "id" | "name" | "contextWindow">>;

export interface TerminalSessionStateSnapshot {
	readonly sessionId: string;
	readonly modelSummary: TerminalModelSnapshot | undefined;
	readonly configuredThinkingLevel: ConfiguredThinkingLevel | undefined;
	readonly workflow: WorkflowModeSnapshot;
	readonly activeToolNames: ReadonlyArray<string>;
	readonly autoCompactionEnabled: boolean;
	readonly isStreaming: boolean;
	readonly isCompacting: boolean;
	readonly hasPostPromptWork: boolean;
	readonly isBashRunning: boolean;
	readonly isEvalRunning: boolean;
	readonly promptOperation: { readonly generation: number; readonly active: boolean };
	readonly messages: ReadonlyArray<AgentMessage>;
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
	readonly submit: (command: SubmitInputCommand) => Effect.Effect<RunnerCommandReceipt, RunnerFailure, Scope.Scope>;
	readonly edit: (command: EditQueuedInputCommand) => Effect.Effect<RunnerCommandReceipt, RunnerFailure, Scope.Scope>;
	readonly cancel: (command: CancelQueuedInputCommand) => Effect.Effect<RunnerCommandReceipt, RunnerFailure, Scope.Scope>;
	readonly setModel: (command: SetModelCommand) => Effect.Effect<SetModelReceipt, RunnerFailure, Scope.Scope>;
	readonly setThinkingLevel: (
		command: SetThinkingLevelCommand,
	) => Effect.Effect<SetThinkingLevelReceipt, RunnerFailure, Scope.Scope>;
	readonly transitionPlanMode: (
		command: TransitionPlanModeCommand,
	) => Effect.Effect<TransitionPlanModeReceipt, RunnerFailure, Scope.Scope>;
	readonly compact: (
		command: RunCompactionCommand,
	) => Effect.Effect<RunCompactionReceipt, RunnerFailure, Scope.Scope>;
	readonly cancelCompaction: (
		command: CancelCompactionCommand,
	) => Effect.Effect<CancelCompactionReceipt, RunnerFailure, Scope.Scope>;
	readonly interruptPrompt: (
		command: InterruptPromptCommand,
	) => Effect.Effect<InterruptPromptReceipt, RunnerFailure, Scope.Scope>;
	readonly detach: () => Effect.Effect<void, RunnerFailure, Scope.Scope>;
}
