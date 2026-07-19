import type { Component, TUI } from "@oh-my-pi/pi-tui";
import { Effect, Scope } from "effect";
import type { InputLeaseManager } from "../mvu/input-lease";
import { mountMvuChild, type MvuRouteHandle } from "../mvu/route-host";
import { mountMvuRuntime } from "../mvu/runtime";
import { focusCmuxOwner } from "../utils/cmux-owner-navigation";
import type { ErrorInbox } from "../utils/error-inbox";
import { ErrorSelectorComponent, type ErrorsContentRouteSpec } from "./error-selector";
import { DockablePanelController } from "./dockable-panel";
const EMPTY_ROUTE_LINES: readonly string[] = [];
const ERRORS_ROUTE_LIFECYCLE_COMPONENT: Component = { render: () => EMPTY_ROUTE_LINES };


/**
 * Stable focus target for the docked errors projection. The renderer is retained
 * while authoritative inbox snapshots are applied as keyed source patches.
 */
export class ErrorsPanelComponent implements Component {
	readonly #selector: ErrorSelectorComponent;
	#focused = false;
	#disposed = false;
	readonly #unsubscribe: () => void;

	constructor(
		private readonly inbox: ErrorInbox,
		private readonly onDismiss: () => void,
		private readonly requestRender: () => void,
		private readonly onDockAction?: (action: "togglePin" | "beginFocusChord" | "finishFocusChord") => void,
	) {
		this.#selector = new ErrorSelectorComponent(inbox.getProjection(), this.onDismiss, {
			onAction: focusCmuxOwner,
			onUpdate: this.requestRender,
			onDockAction: this.onDockAction,
		});
		this.#unsubscribe = inbox.subscribe(() => {
			if (this.#disposed) return;
			this.#selector.dispatchSource(this.inbox.getProjection());
		});
	}

	get focused(): boolean {
		return this.#focused;
	}

	set focused(focused: boolean) {
		this.#focused = focused;
	}

	get selectedId(): string | undefined {
		return this.#selector.selectedId;
	}

	get contentRouteSpec(): ErrorsContentRouteSpec {
		return this.#selector.getRouteSpec();
	}
	bindRuntime(dispatch: Parameters<ErrorSelectorComponent["bindRuntime"]>[0]): void {
		this.#selector.bindRuntime(dispatch);
	}

	deactivateContentRoute(): void {
		this.#selector.deactivateRoute();
	}

	render(width: number): readonly string[] {
		return this.#selector.render(width);
	}


	invalidate(): void {
		this.#selector.invalidate();
	}

	dispose(): void {
		if (this.#disposed) return;
		this.#disposed = true;
		this.#unsubscribe();
		this.#selector.dispose();
	}
}

export function createErrorsDock(
	ui: TUI,
	inbox: ErrorInbox,
	interruptOwner: Component,
	onPinChange: (pinned: boolean) => void,
	getInputLeaseManager: () => InputLeaseManager,
	mvuScope: Scope.Scope,
): { panel: ErrorsPanelComponent; dock: DockablePanelController } {
	let dock: DockablePanelController;
	const routeDockAction = (action: "togglePin" | "beginFocusChord" | "finishFocusChord"): void => {
		switch (action) {
			case "togglePin": dock.togglePin(); break;
			case "beginFocusChord": dock.handleGlobalInput("\u0017"); break;
			case "finishFocusChord": dock.handleGlobalInput("w"); break;
		}
	};
	const panel = new ErrorsPanelComponent(
		inbox,
		() => dock.close(),
		() => ui.requestComponentRender(panel),
		routeDockAction,
	);
	const spec = panel.contentRouteSpec;
	const runtimePromise = Effect.runPromise(
		Scope.provide(mvuScope)(mountMvuRuntime({
			componentId: spec.componentId,
			initialModel: spec.initialModel,
			update: spec.update,
			interpret: spec.interpret,
			boundary: spec.boundary,
			inputCapacity: 64,
			messageCapacity: 128,
			commandCapacity: 64,
		})),
	);
	let runtimeDispatch = Promise.resolve();
	panel.bindRuntime(message => {
		runtimeDispatch = runtimeDispatch.then(async () => {
			const runtime = await runtimePromise;
			await Effect.runPromise(runtime.dispatch(message));
		});
	});

	let routeHandle: MvuRouteHandle | undefined;
	let focusGeneration = 0;
	let desiredFocus = false;
	let routeTransition = Promise.resolve();
	const syncContentRoute = (focused: boolean): void => {
		desiredFocus = focused;
		const generation = ++focusGeneration;
		if (!focused) panel.deactivateContentRoute();
		let closing: Promise<void> | undefined;
		if (!focused && routeHandle !== undefined) {
			const handle = routeHandle;
			routeHandle = undefined;
			closing = Effect.runPromise(handle.close());
		}
		routeTransition = routeTransition.then(async () => {
			if (closing !== undefined) await closing;
			if (!desiredFocus || generation !== focusGeneration || routeHandle !== undefined) return;
			const runtime = await runtimePromise;
			const handle = await Effect.runPromise(
				Scope.provide(mvuScope)(mountMvuChild({
					tui: ui,
					leaseManager: getInputLeaseManager(),
					route: spec.route,
					component: ERRORS_ROUTE_LIFECYCLE_COMPONENT,
					runtime,
				})),
			);
			if (!desiredFocus || generation !== focusGeneration || !dock.isFocused) {
				await Effect.runPromise(handle.close());
				return;
			}
			routeHandle = handle;
		});
	};
	dock = new DockablePanelController(ui, panel, {
		interruptOwner,
		onPinChange,
		onFocusChange: syncContentRoute,
	});
	ui.addInputListener(data => {
		if (!dock.isOpen || dock.isFocused) return undefined;
		return dock.handleGlobalInput(data) ? { consume: true } : undefined;
	});
	return { panel, dock };
}
