import type { AgentMessage } from "@oh-my-pi/pi-agent-core";
import type { Model } from "@oh-my-pi/pi-ai";
import type { Effect, Scope } from "effect";
import type { ConfiguredThinkingLevel } from "../thinking";
import type { AgentSessionEvent } from "../session/agent-session";
import type {
	CancelQueuedInputCommand,
	EditQueuedInputCommand,
	RunnerCommandReceipt,
	RunnerEvent,
	SessionRunnerSnapshot,
	SubmitInputCommand,
} from "./protocol";
import type { RunnerFailure } from "./session-runner";

export type TerminalModelSnapshot = Readonly<Pick<Model, "provider" | "id" | "name" | "contextWindow">>;

export interface TerminalSessionStateSnapshot {
	readonly sessionId: string;
	readonly modelSummary: TerminalModelSnapshot | undefined;
	readonly configuredThinkingLevel: ConfiguredThinkingLevel | undefined;
	readonly autoCompactionEnabled: boolean;
	readonly isStreaming: boolean;
	readonly isCompacting: boolean;
	readonly hasPostPromptWork: boolean;
	readonly isBashRunning: boolean;
	readonly isEvalRunning: boolean;
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
	readonly detach: () => Effect.Effect<void, RunnerFailure, Scope.Scope>;
}
