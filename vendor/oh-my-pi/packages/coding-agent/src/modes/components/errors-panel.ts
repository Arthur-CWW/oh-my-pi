import type { Component, TUI } from "@oh-my-pi/pi-tui";
import { focusCmuxOwner } from "../utils/cmux-owner-navigation";
import type { ErrorInbox } from "../utils/error-inbox";
import { ErrorSelectorComponent } from "./error-selector";
import { DockablePanelController } from "./dockable-panel";

/**
 * Stable focus target for the docked errors projection. The selector itself is
 * rebuilt when the inbox changes because pi-tui SelectList has no mutable-items
 * API; focus remains on this wrapper and the newest record becomes selected.
 */
export class ErrorsPanelComponent implements Component {
	#selector: ErrorSelectorComponent;
	#focused = false;
	#disposed = false;
	readonly #unsubscribe: () => void;

	constructor(
		private readonly inbox: ErrorInbox,
		private readonly onDismiss: () => void,
		private readonly requestRender: () => void,
	) {
		this.#selector = this.#createSelector();
		this.#unsubscribe = inbox.subscribe(() => {
			if (this.#disposed) return;
			this.#selector = this.#createSelector();
			this.requestRender();
		});
	}

	get focused(): boolean {
		return this.#focused;
	}

	set focused(focused: boolean) {
		this.#focused = focused;
	}

	render(width: number): readonly string[] {
		return this.#selector.render(width);
	}

	handleInput(data: string): void {
		this.#selector.getSelectList().handleInput(data);
	}

	invalidate(): void {
		this.#selector.invalidate();
	}

	dispose(): void {
		if (this.#disposed) return;
		this.#disposed = true;
		this.#unsubscribe();
	}

	#createSelector(): ErrorSelectorComponent {
		const selector = new ErrorSelectorComponent(this.inbox.getErrors(), this.onDismiss, {
			onAction: focusCmuxOwner,
			onUpdate: this.requestRender,
		});
		return selector;
	}
}

export function createErrorsDock(
	ui: TUI,
	inbox: ErrorInbox,
	interruptOwner: Component,
	onPinChange: (pinned: boolean) => void,
): { panel: ErrorsPanelComponent; dock: DockablePanelController } {
	let dock: DockablePanelController;
	const panel = new ErrorsPanelComponent(inbox, () => dock.close(), () => ui.requestComponentRender(panel));
	dock = new DockablePanelController(ui, panel, { preferredDock: "right", interruptOwner, onPinChange });
	ui.addInputListener(data => {
		if (!dock.isOpen || dock.isFocused) return undefined;
		return dock.handleGlobalInput(data) ? { consume: true } : undefined;
	});
	return { panel, dock };
}
