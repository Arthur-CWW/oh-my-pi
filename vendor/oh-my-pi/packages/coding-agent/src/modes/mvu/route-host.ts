import { Effect, Exit, Scope } from "effect";
import type { Component, OverlayHandle, OverlayOptions, TUI } from "@oh-my-pi/pi-tui";
import { mountMvuRuntime, type MvuRuntime, type MvuRuntimeConfig } from "./runtime";
import type { ComponentId } from "./schema";
import type { InputLeaseConflictError, InputLeaseHandle, InputLeaseManager, MvuEnvelope, MvuInputRoute } from "./input-lease";

export interface MvuRouteHandle {
	readonly componentId: ComponentId;
	close(): Effect.Effect<void>;
}

interface MvuRouteMountOptions<Model, Msg, Command, R> {
	readonly tui: TUI;
	readonly leaseManager: InputLeaseManager;
	readonly route: MvuInputRoute<Model>;
	readonly component: Component;
	readonly runtime?: MvuRuntime<Model, Msg>;
	readonly runtimeConfig?: MvuRuntimeConfig<Model, Msg, Command, R>;
	readonly bindRuntime?: (runtime: MvuRuntime<Model, Msg>) => void;
	readonly runtimeScope?: Scope.Scope;
	readonly mountRenderer?: Effect.Effect<void>;
	readonly disposeRenderer?: Effect.Effect<void>;
}
export interface MvuChildOptions<Model, Msg, Command, R> extends MvuRouteMountOptions<Model, Msg, Command, R> {}

export interface MvuOverlayOptions<Model, Msg, Command, R> extends MvuRouteMountOptions<Model, Msg, Command, R> {
	readonly overlayOptions?: OverlayOptions;
	readonly restoreFocus?: Effect.Effect<void>;
}

export interface MvuEditorReplacementOptions<Model, Msg, Command, R>
	extends MvuRouteMountOptions<Model, Msg, Command, R> {
	readonly hideEditor?: Effect.Effect<void>;
	readonly restoreEditor?: Effect.Effect<void>;
	readonly previousFocus?: Component | null;
	readonly restoreFocus?: Effect.Effect<void>;
}

interface MountedRoute {
	readonly componentId: ComponentId;
	readonly lease: InputLeaseHandle;
	readonly routeScope: Scope.Scope | undefined;
	overlay: OverlayHandle | undefined;
	readonly component: Component;
	readonly disposeRenderer: Effect.Effect<void> | undefined;
	readonly restore: Effect.Effect<void>;
}

const closeMountedRoute = (mounted: MountedRoute): Effect.Effect<void> =>
	Effect.gen(function* () {
		yield* mounted.lease.revoke();
		if (mounted.routeScope !== undefined) yield* Scope.close(mounted.routeScope, Exit.void);
		mounted.component.dispose?.();
		if (mounted.disposeRenderer !== undefined) yield* mounted.disposeRenderer;
		mounted.overlay?.hide();
	}).pipe(Effect.ensuring(mounted.restore));

const mountRoute = <Model, Msg, Command, R>(
	options: MvuRouteMountOptions<Model, Msg, Command, R>,
	show: (tui: TUI, component: Component) => OverlayHandle | undefined,
	restore: Effect.Effect<void>,
): Effect.Effect<MvuRouteHandle, InputLeaseConflictError, R | Scope.Scope> =>
	Effect.gen(function* () {
		const parentScope = yield* Effect.service(Scope.Scope);
		const routeScope = options.runtime === undefined ? yield* Scope.fork(parentScope, "sequential") : undefined;
		const prepared = yield* Effect.gen(function* () {
			let runtime: MvuRuntime<Model, Msg> | undefined = options.runtime;
			if (runtime === undefined && options.runtimeConfig !== undefined && routeScope !== undefined) {
				runtime = yield* Scope.provide(routeScope)(mountMvuRuntime(options.runtimeConfig));
			}
			if (runtime === undefined) return yield* Effect.die(new Error("An MVU runtime or runtimeConfig is required"));

			const lease = yield* options.leaseManager.acquireMvu(
				options.route,
				runtime as MvuRuntime<Model, MvuEnvelope>,
			);
			options.bindRuntime?.(runtime);
			return { lease };
		}).pipe(
			Effect.onError(() => routeScope === undefined ? Effect.void : Scope.close(routeScope, Exit.void)),
		);

		const mounted: MountedRoute = {
			componentId: options.route.componentId,
			lease: prepared.lease,
			routeScope: options.runtime === undefined ? routeScope : options.runtimeScope,
			overlay: undefined,
			component: options.component,
			disposeRenderer: options.disposeRenderer,
			restore,
		};
		yield* Effect.gen(function* () {
			if (options.mountRenderer !== undefined) yield* options.mountRenderer;
			mounted.overlay = show(options.tui, options.component);
		}).pipe(Effect.onError(() => closeMountedRoute(mounted)));

		let closed = false;
		const close = (): Effect.Effect<void> =>
			Effect.suspend(() => {
				if (closed) return Effect.void;
				closed = true;
				return closeMountedRoute(mounted);
			});
		yield* Effect.addFinalizer(() => close());
		return { componentId: options.route.componentId, close } satisfies MvuRouteHandle;
	});

/** Mount an MVU-owned renderer that already lives inside a parent component tree. */
export const mountMvuChild = <Model, Msg, Command, R>(
	options: MvuChildOptions<Model, Msg, Command, R>,
): Effect.Effect<MvuRouteHandle, InputLeaseConflictError, R | Scope.Scope> =>
	mountRoute(options, () => undefined, Effect.void);

export const mountMvuOverlay = <Model, Msg, Command, R>(
	options: MvuOverlayOptions<Model, Msg, Command, R>,
): Effect.Effect<MvuRouteHandle, InputLeaseConflictError, R | Scope.Scope> =>
	mountRoute(
		options,
		(tui, component) => tui.showOverlay(component, options.overlayOptions),
		options.restoreFocus ?? Effect.void,
	);

export const mountMvuEditorReplacement = <Model, Msg, Command, R>(
	options: MvuEditorReplacementOptions<Model, Msg, Command, R>,
): Effect.Effect<MvuRouteHandle, InputLeaseConflictError, R | Scope.Scope> =>
	Effect.gen(function* () {
		const previousFocus = options.previousFocus ?? options.tui.getFocused();
		return yield* mountRoute(
			{
				...options,
				mountRenderer: Effect.gen(function* () {
					if (options.hideEditor !== undefined) yield* options.hideEditor;
					if (options.mountRenderer !== undefined) yield* options.mountRenderer;
				}),
			},
			(tui, component) => {
				tui.setFocus(component);
				return undefined;
			},
			Effect.gen(function* () {
				if (options.restoreEditor !== undefined) yield* options.restoreEditor;
				if (options.restoreFocus !== undefined) {
					yield* options.restoreFocus;
				} else {
					options.tui.setFocus(previousFocus);
				}
			}),
		);
	});
