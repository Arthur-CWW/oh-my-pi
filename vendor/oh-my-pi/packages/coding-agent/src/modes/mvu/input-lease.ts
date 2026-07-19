import { Deferred, Effect, Queue, Scope, Stream, SubscriptionRef } from "effect";
import type {
	Component,
	InputDispatchRecord,
	InputRouteDecision,
	InputRouteTrace,
	InputRouter,
	Keybinding,
	TUI,
} from "@oh-my-pi/pi-tui";
import type {
	ActiveKeymapContext,
	ComponentId,
	KeyEvent,
	KeymapRegistry,
	LeaseId,
	Mouse,
	Paste,
	RouteStamp,
} from "./schema";
import type { MvuRuntime } from "./runtime";
import type { TerminalInputAdapter } from "./input-adapter";

export type InputLease =
	| {
			readonly kind: "mvu";
			readonly leaseId: LeaseId;
			readonly componentId: ComponentId;
			readonly generation: number;
			readonly focusedRoot: Component;
	  }
	| {
			readonly kind: "legacy";
			readonly leaseId: LeaseId;
			readonly generation: number;
			readonly focusedRoot: Component | null;
	  };

export interface MvuEnvelope {
	readonly _tag: "MvuInput";
	readonly action: Keybinding;
	readonly event: KeyEvent;
	readonly stamp?: RouteStamp;
}

export const KEY_RELEASE_CAPABILITY = "input.key-release";

export interface MvuInputRoute<Model> {
	readonly componentId: ComponentId;
	readonly focusedRoot: Component;
	context(model: Model): ActiveKeymapContext;
	actionToMsg(action: Keybinding, event: KeyEvent): MvuEnvelope | undefined;
	/** Maps printable text without a finite keymap claim into a route-owned action. */
	textToMsg?(event: Extract<KeyEvent, { readonly _tag: "Press" }>): MvuEnvelope | undefined;
	mouseToMsg?(event: Mouse): MvuEnvelope | undefined;
	pasteToMsg?(event: Paste): MvuEnvelope | undefined;
	/** Commits lease-dependent route state before this route can accept terminal input. */
	activateLease?(model: Model, generation: number): Model;
}

export interface InputLeaseHandle {
	readonly lease: InputLease;
	revoke(): Effect.Effect<void>;
}

export class InputLeaseConflictError extends Error {
	readonly _tag = "InputLeaseConflictError";

	constructor(readonly componentId: ComponentId) {
		super(`An MVU input lease is already active for ${String(componentId)}`);
	}
}
export class InputLeaseSaturatedError extends Error {
	readonly _tag = "InputLeaseSaturatedError";

	constructor(readonly leaseId: LeaseId, readonly sequenceId: number, readonly capacity: number) {
		super(
			`MVU input lease ${String(leaseId)} could not accept sequence ${sequenceId}: bridge capacity ${capacity} exhausted`,
		);
	}
}

export interface InputLeaseHandoff {
	/** Restore the suspended route unless a replacement lease adopted it. */
	complete(): Effect.Effect<void>;
}

export type MvuGlobalInputHandler = (data: string, event: KeyEvent) => boolean;

export interface MvuLeaseReservationOptions {
	/** Suspend the current MVU route and restore it when this lease closes. */
	readonly replaceActive?: boolean;
}

export interface InputLeaseManager {
	acquireMvu<Model>(
		route: MvuInputRoute<Model>,
		runtime: MvuRuntime<Model, MvuEnvelope>,
	): Effect.Effect<InputLeaseHandle, InputLeaseConflictError, Scope.Scope>;
	/** Claim input synchronously while the runtime and renderer finish mounting. */
	reserveMvu<Model>(route: MvuInputRoute<Model>, options?: MvuLeaseReservationOptions): InputLeaseHandle;
	/** Release the current route while allowing the next route to adopt its suspended parent. */
	beginHandoff(componentId: ComponentId): Effect.Effect<InputLeaseHandoff, InputLeaseConflictError>;
	/** Handle decoded global actions before the active route's finite keymap. */
	addGlobalInputHandler(handler: MvuGlobalInputHandler): () => void;
	current(): InputLease;
}

const initialLease = (): InputLease => ({
	kind: "legacy",
	leaseId: "legacy:0" as LeaseId,
	generation: 0,
	focusedRoot: null,
});

const traceFor = (lease: InputLease, sequenceId: number, action: Keybinding | undefined): InputRouteTrace => ({
	sequenceId,
	leaseId: String(lease.leaseId),
	...(action === undefined ? {} : { resolvedAction: String(action) }),
	expectedConsumer: lease.kind === "mvu" ? "mvu" : "legacy",
});

/**
 * Installs the process-wide MVU router and serializes lease ownership.
 *
 * Terminal callbacks synchronously decode each complete sequence and perform one
 * bounded offer. The scoped bridge resolves the queued event against the latest
 * committed model, dispatches it, and waits for that reducer commit before
 * resolving the next event. Retained TUI globals bypass the lease before decode.
 */
export const makeInputLeaseManager = (
	tui: TUI,
	adapter: TerminalInputAdapter,
	registry: KeymapRegistry,
	bridgeCapacity = 256,
): Effect.Effect<InputLeaseManager, never, Scope.Scope> =>
	Effect.gen(function* () {
		if (bridgeCapacity <= 0 || !Number.isSafeInteger(bridgeCapacity)) {
			return yield* Effect.die(
				new RangeError(`MVU input bridge capacity must be a positive integer: ${bridgeCapacity}`),
			);
		}

		interface BridgeItem {
			readonly leaseId: LeaseId;
			readonly generation: number;
			readonly event: KeyEvent;
			readonly revoked: Deferred.Deferred<void>;
		}

		interface RouteState {
			readonly lease: Extract<InputLease, { readonly kind: "mvu" }>;
			readonly routeRef: object;
			readonly revoked: Deferred.Deferred<void>;
			previous: RouteState | undefined;
			closed: boolean;
			attached: boolean;
			enqueue(sequenceId: number, data: string): InputRouteDecision;
			drain(event: KeyEvent): Effect.Effect<void>;
			attach(runtime: MvuRuntime<unknown, MvuEnvelope>): Effect.Effect<void, InputLeaseConflictError>;
		}

		interface HandoffState {
			parent: RouteState | undefined;
		}

		let generation = 0;
		let active: InputLease = initialLease();
		let activeRoute: RouteState | undefined;
		let pendingHandoff: HandoffState | undefined;
		const globalHandlers = new Set<MvuGlobalInputHandler>();
		const bridge = yield* Queue.bounded<BridgeItem>(bridgeCapacity);

		yield* Stream.runForEach(Stream.fromQueue(bridge), item => {
			const route = activeRoute;
			if (
				route === undefined ||
				route.lease.leaseId !== item.leaseId ||
				route.lease.generation !== item.generation
			) {
				return Effect.void;
			}
			return Effect.race(route.drain(item.event), Deferred.await(item.revoked));
		}).pipe(Effect.forkScoped);

		const drain = <Model>(
			lease: Extract<InputLease, { readonly kind: "mvu" }>,
			route: MvuInputRoute<Model>,
			runtime: MvuRuntime<Model, MvuEnvelope>,
			event: KeyEvent,
		): Effect.Effect<void> =>
			Effect.gen(function* () {
				const model = yield* SubscriptionRef.get(runtime.model);
				let message: MvuEnvelope | undefined;
				let resolvedAction: Keybinding | undefined;
				if (event._tag === "Paste") {
					message = route.pasteToMsg?.(event);
					resolvedAction = message?.action;
				} else if (event._tag === "Mouse") {
					message = route.mouseToMsg?.(event);
					resolvedAction = message?.action;
				} else if (event._tag === "Press" || event._tag === "Release") {
					const context = route.context(model);
					if (event._tag === "Release" && !context.capabilities.has(KEY_RELEASE_CAPABILITY)) return;
					resolvedAction = registry.resolve(context, event.key);
					if (resolvedAction === undefined && event._tag === "Press" && event.text !== undefined) {
						message = route.textToMsg?.(event);
						resolvedAction = message?.action;
					} else if (resolvedAction !== undefined) {
						message = route.actionToMsg(resolvedAction, event);
					}
				}
				// A decoded event belongs to MVU even when the route has no action for it.
				if (message === undefined || resolvedAction === undefined) return;

				const stamp: RouteStamp = {
					componentId: route.componentId,
					leaseGeneration: lease.generation,
					sourceRevision: message.stamp?.sourceRevision ?? 0,
					requestGeneration: message.stamp?.requestGeneration ?? 0,
				};
				yield* runtime.dispatchCommitted({ ...message, stamp });
			});

		const firstOpen = (state: RouteState | undefined): RouteState | undefined => {
			let current = state;
			while (current?.closed) current = current.previous;
			return current;
		};

		const setLegacy = (): void => {
			generation += 1;
			activeRoute = undefined;
			active = {
				kind: "legacy",
				leaseId: `legacy:${generation}` as LeaseId,
				generation,
				focusedRoot: null,
			};
		};

		const setHandoffLease = (state: RouteState): void => {
			generation += 1;
			activeRoute = undefined;
			active = {
				kind: "mvu",
				leaseId: `handoff:${generation}` as LeaseId,
				componentId: state.lease.componentId,
				generation,
				focusedRoot: state.lease.focusedRoot,
			};
		};

		const setActiveRoute = (state: RouteState): void => {
			activeRoute = state;
			active = state.lease;
		};

		const unlink = (chain: RouteState | undefined, target: RouteState): RouteState | undefined => {
			const current = firstOpen(chain);
			if (current === undefined) return undefined;
			if (current === target) return firstOpen(current.previous);
			current.previous = unlink(current.previous, target);
			return current;
		};

		const revokeState = (state: RouteState): Effect.Effect<void> =>
			Effect.suspend(() => {
				if (state.closed) return Effect.void;
				state.closed = true;
				if (activeRoute === state) {
					const restored = firstOpen(state.previous);
					if (restored === undefined) setLegacy();
					else setActiveRoute(restored);
				} else {
					if (activeRoute !== undefined) activeRoute.previous = unlink(activeRoute.previous, state);
					if (pendingHandoff !== undefined) {
						pendingHandoff.parent = unlink(pendingHandoff.parent, state);
					}
				}
				return Deferred.succeed(state.revoked, undefined).pipe(Effect.asVoid);
			});

		const handleFor = (state: RouteState): InputLeaseHandle => ({
			lease: state.lease,
			revoke: () => revokeState(state),
		});

		const takeHandoffParent = (): RouteState | undefined => {
			const handoff = pendingHandoff;
			if (handoff === undefined) return undefined;
			pendingHandoff = undefined;
			return firstOpen(handoff.parent);
		};

		const enqueue = (
			state: RouteState,
			sequenceId: number,
			data: string,
		): InputRouteDecision => {
			const unresolvedTrace = traceFor(state.lease, sequenceId, undefined);
			if (adapter.retains(data)) {
				return { consume: false, data, trace: { ...unresolvedTrace, expectedConsumer: "legacy" } };
			}

			const event = adapter.decode(data);
			if (event === undefined) {
				return { consume: false, data, trace: { ...unresolvedTrace, expectedConsumer: "legacy" } };
			}
			for (const handler of globalHandlers) {
				if (handler(data, event)) return { consume: true, trace: unresolvedTrace };
			}
			const accepted = Queue.offerUnsafe(bridge, {
				leaseId: state.lease.leaseId,
				generation: state.lease.generation,
				event,
				revoked: state.revoked,
			});
			if (!accepted) {
				throw new InputLeaseSaturatedError(state.lease.leaseId, sequenceId, bridgeCapacity);
			}
			return { consume: true, trace: unresolvedTrace };
		};

		const makeState = <Model>(
			route: MvuInputRoute<Model>,
			previous: RouteState | undefined,
		): RouteState => {
			generation += 1;
			const lease = {
				kind: "mvu",
				leaseId: `${String(route.componentId)}:${generation}` as LeaseId,
				componentId: route.componentId,
				generation,
				focusedRoot: route.focusedRoot,
			} as const satisfies Extract<InputLease, { readonly kind: "mvu" }>;
			const revoked = Deferred.makeUnsafe<void>();
			const ready = Deferred.makeUnsafe<void>();
			let runtime: MvuRuntime<Model, MvuEnvelope> | undefined;
			let state: RouteState;
			state = {
				lease,
				routeRef: route,
				revoked,
				previous,
				closed: false,
				attached: false,
				enqueue: (sequenceId, data) => enqueue(state, sequenceId, data),
				drain: event =>
					Effect.gen(function* () {
						yield* Deferred.await(ready);
						if (activeRoute !== state || runtime === undefined) return;
						yield* drain(lease, route, runtime, event);
					}),
				attach(candidate) {
					return Effect.gen(function* () {
						if (state.closed || state.attached) {
							return yield* Effect.fail(new InputLeaseConflictError(route.componentId));
						}
						const typedRuntime = candidate as unknown as MvuRuntime<Model, MvuEnvelope>;
						if (route.activateLease !== undefined) {
							yield* SubscriptionRef.update(typedRuntime.model, model =>
								route.activateLease!(model, lease.generation),
							);
						}
						runtime = typedRuntime;
						state.attached = true;
						yield* Deferred.succeed(ready, undefined);
					});
				},
			};
			return state;
		};

		const findReserved = (chain: RouteState | undefined, routeRef: object): RouteState | undefined => {
			let current = chain;
			while (current !== undefined) {
				if (!current.closed && current.routeRef === routeRef && !current.attached) return current;
				current = current.previous;
			}
			return undefined;
		};

		const router: InputRouter = (data, sequenceId) => {
			const lease = active;
			if (lease.kind === "legacy") return undefined;
			const route = activeRoute;
			if (route !== undefined && route.lease.leaseId === lease.leaseId) {
				return route.enqueue(sequenceId, data);
			}
			if (pendingHandoff === undefined) return undefined;
			const unresolvedTrace = traceFor(lease, sequenceId, undefined);
			if (adapter.retains(data)) {
				return { consume: false, data, trace: { ...unresolvedTrace, expectedConsumer: "legacy" } };
			}
			const event = adapter.decode(data);
			return event === undefined
				? { consume: false, data, trace: { ...unresolvedTrace, expectedConsumer: "legacy" } }
				: { consume: true, trace: unresolvedTrace };
		};
		tui.setInputRouter(router);

		let lastValidatedSequence = 0;
		if (process.env.NODE_ENV !== "production") {
			tui.setInputDispatchValidator((record: InputDispatchRecord) => {
				if (record.sequenceId <= lastValidatedSequence) {
					throw new Error(`Input sequence ${record.sequenceId} was observed more than once or out of order`);
				}
				lastValidatedSequence = record.sequenceId;
				if (record.actualConsumer === "none") {
					throw new Error(`Input sequence ${record.sequenceId} had no consumer`);
				}
				const correct =
					record.expectedConsumer === "mvu"
						? record.actualConsumer === "router"
						: record.actualConsumer !== "router";
				if (!correct) {
					throw new Error(
						`Input sequence ${record.sequenceId} expected ${record.expectedConsumer} but reached ${record.actualConsumer}`,
					);
				}
			});
		}

		yield* Effect.addFinalizer(() =>
			Effect.gen(function* () {
				while (activeRoute !== undefined) yield* revokeState(activeRoute);
				let suspended = firstOpen(pendingHandoff?.parent);
				while (suspended !== undefined) {
					yield* revokeState(suspended);
					suspended = firstOpen(pendingHandoff?.parent);
				}
				yield* Queue.shutdown(bridge);
				tui.setInputRouter(undefined);
				if (process.env.NODE_ENV !== "production") tui.setInputDispatchValidator(undefined);
			}),
		);

		const manager: InputLeaseManager = {
			acquireMvu<Model>(route: MvuInputRoute<Model>, runtime: MvuRuntime<Model, MvuEnvelope>) {
				return Effect.suspend(() => {
					const reserved =
						findReserved(activeRoute, route) ?? findReserved(pendingHandoff?.parent, route);
					if (reserved !== undefined) {
						return reserved.attach(runtime as unknown as MvuRuntime<unknown, MvuEnvelope>).pipe(
							Effect.as(handleFor(reserved)),
							Effect.onError(() => revokeState(reserved)),
						);
					}
					if (activeRoute !== undefined) {
						return Effect.fail(new InputLeaseConflictError(route.componentId));
					}
					const state = makeState(route, takeHandoffParent());
					setActiveRoute(state);
					return state.attach(runtime as unknown as MvuRuntime<unknown, MvuEnvelope>).pipe(
						Effect.as(handleFor(state)),
						Effect.onError(() => revokeState(state)),
					);
				});
			},
			reserveMvu<Model>(route: MvuInputRoute<Model>, options?: MvuLeaseReservationOptions) {
				if (findReserved(activeRoute, route) !== undefined) {
					throw new InputLeaseConflictError(route.componentId);
				}
				let previous: RouteState | undefined;
				if (activeRoute !== undefined) {
					if (!options?.replaceActive) throw new InputLeaseConflictError(route.componentId);
					previous = activeRoute;
				} else {
					previous = takeHandoffParent();
				}
				const state = makeState(route, previous);
				setActiveRoute(state);
				return handleFor(state);
			},
			beginHandoff(componentId: ComponentId) {
				return Effect.gen(function* () {
					const state = activeRoute;
					if (state === undefined || state.lease.componentId !== componentId || pendingHandoff !== undefined) {
						return yield* Effect.fail(new InputLeaseConflictError(componentId));
					}
					const handoff: HandoffState = { parent: firstOpen(state.previous) };
					state.previous = undefined;
					state.closed = true;
					pendingHandoff = handoff;
					setHandoffLease(state);
					yield* Deferred.succeed(state.revoked, undefined);
					let completed = false;
					return {
						complete: () =>
							Effect.sync(() => {
								if (completed) return;
								completed = true;
								if (pendingHandoff !== handoff) return;
								pendingHandoff = undefined;
								const restored = firstOpen(handoff.parent);
								if (activeRoute === undefined) {
									if (restored === undefined) setLegacy();
									else setActiveRoute(restored);
								}
							}),
					} satisfies InputLeaseHandoff;
				});
			},
			addGlobalInputHandler(handler: MvuGlobalInputHandler) {
				globalHandlers.add(handler);
				return () => {
					globalHandlers.delete(handler);
				};
			},
			current: () => active,
		};

		return manager;
	});
