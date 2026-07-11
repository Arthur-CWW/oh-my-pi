import { randomUUID } from "node:crypto";
import { Effect, Exit, Scope } from "effect";
import type { RunnerCommandReceipt, RunnerImageContent } from "../runner/protocol";
import {
	decodeCancelQueuedInputCommand,
	decodeEditQueuedInputCommand,
	decodeSubmitInputCommand,
	RUNNER_SCHEMA_VERSION,
} from "../runner/protocol";
import type { AgentSessionEvent } from "../session/agent-session";
import type { RunnerFailure, SessionRunner } from "../runner/session-runner";
import type { TerminalSessionSnapshot, TerminalSessionView } from "../runner/terminal-session-view";

export interface TerminalSubmitIntent {
	readonly text: string;
	readonly images?: ReadonlyArray<RunnerImageContent>;
	readonly deliveryClass: "steer" | "followUp";
	readonly commandId?: string;
	readonly correlationId?: string;
	readonly causationId?: string;
}

export interface TerminalEditIntent {
	readonly inputId: string;
	readonly itemRevision: number;
	readonly text: string;
	readonly images?: ReadonlyArray<RunnerImageContent>;
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
	readonly refresh: () => Promise<TerminalSessionSnapshot>;
	readonly submit: (intent: TerminalSubmitIntent) => Promise<RunnerCommandReceipt>;
	readonly edit: (intent: TerminalEditIntent) => Promise<RunnerCommandReceipt>;
	readonly cancel: (intent: TerminalCancelIntent) => Promise<RunnerCommandReceipt>;
	readonly close: () => Promise<void>;
}

const metadata = (intent: { readonly commandId?: string; readonly correlationId?: string }) => {
	const commandId = intent.commandId ?? randomUUID();
	return { commandId, correlationId: intent.correlationId ?? commandId };
};

/** Promise boundary for terminal code; all authority remains in the Effect-native view. */
export async function createTerminalSessionController(
	runner: SessionRunner,
	options: TerminalSessionControllerOptions = {},
): Promise<TerminalSessionController> {
	const scope = Scope.makeUnsafe("sequential");
	const run = <A>(effect: Effect.Effect<A, RunnerFailure, Scope.Scope>): Promise<A> =>
		Effect.runPromise(Scope.provide(scope)(effect));
	const runnerSnapshot = await run(runner.snapshot());
	const viewId = options.viewId ?? `terminal:${randomUUID()}`;
	const attachCommandId = options.commandId ?? randomUUID();
	let view: TerminalSessionView | undefined;
	let closed = false;
	try {
		view = await run(
			runner.attachTerminalView({
				schemaVersion: RUNNER_SCHEMA_VERSION,
				kind: "attachView",
				commandId: attachCommandId,
				correlationId: options.correlationId ?? attachCommandId,
				expectedRevision: runnerSnapshot.revision,
				viewId,
				capability: "controller",
			}),
		);
		const subscription = await run(view.subscribe());
		let latest = await run(view.snapshot());
		const listeners = new Set<(event: AgentSessionEvent) => void>();
		const refresh = async (): Promise<TerminalSessionSnapshot> => {
			latest = await run(view!.snapshot());
			return latest;
		};
		const pump = Effect.forever(
			subscription.take.pipe(
				Effect.flatMap((delivery) =>
					Effect.tryPromise({
						try: async () => {
							if (delivery.kind === "resyncRequired") {
								latest = delivery.snapshot;
								return;
							}
							if (delivery.kind === "runnerEvent") {
								await refresh();
								return;
							}
							for (const listener of listeners) listener(delivery.event);
						},
						catch: () => undefined,
					}),
				),
			),
		);
		await Effect.runPromise(Scope.provide(scope)(Effect.forkScoped(pump)));
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
			epoch: view.epoch,
			snapshot: () => latest,
			subscribeAgentEvents: (listener) => {
				listeners.add(listener);
				return () => listeners.delete(listener);
			},
			refresh,
			submit: (intent) =>
				fenced(async (current) => {
					const ids = metadata(intent);
					return run(
						view!.submit(
							decodeSubmitInputCommand({
							schemaVersion: RUNNER_SCHEMA_VERSION,
							kind: "submitInput",
							...ids,
							...(intent.causationId === undefined ? {} : { causationId: intent.causationId }),
							expectedRevision: current.runner.revision,
							viewId,
							controllerEpoch: view!.epoch,
							payload: {
								text: intent.text,
								...(intent.images === undefined ? {} : { images: [...intent.images] }),
								deliveryClass: intent.deliveryClass,
							},
							}),
						),
					);
				}),
			edit: (intent) =>
				fenced(async (current) => {
					const ids = metadata(intent);
					return run(
						view!.edit(
							decodeEditQueuedInputCommand({
							schemaVersion: RUNNER_SCHEMA_VERSION,
							kind: "editQueuedInput",
							...ids,
							...(intent.causationId === undefined ? {} : { causationId: intent.causationId }),
							expectedRevision: current.runner.revision,
							viewId,
							controllerEpoch: view!.epoch,
							inputId: intent.inputId,
							itemRevision: intent.itemRevision,
							payload: {
								text: intent.text,
								...(intent.images === undefined ? {} : { images: [...intent.images] }),
							},
							}),
						),
					);
				}),
			cancel: (intent) =>
				fenced(async (current) => {
					const ids = metadata(intent);
					return run(
						view!.cancel(
							decodeCancelQueuedInputCommand({
							schemaVersion: RUNNER_SCHEMA_VERSION,
							kind: "cancelQueuedInput",
							...ids,
							...(intent.causationId === undefined ? {} : { causationId: intent.causationId }),
							expectedRevision: current.runner.revision,
							viewId,
							controllerEpoch: view!.epoch,
							inputId: intent.inputId,
							itemRevision: intent.itemRevision,
							}),
						),
					);
				}),
			close: async () => {
				if (closed) return;
				closed = true;
				try {
					await run(view!.detach());
				} finally {
					listeners.clear();
					await Effect.runPromise(Scope.close(scope, Exit.void));
				}
			},
		};
	} catch (error) {
		await Effect.runPromise(Scope.close(scope, Exit.void));
		throw error;
	}
}
