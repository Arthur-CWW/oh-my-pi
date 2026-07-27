import {
	isFocusable,
	matchesKey,
	type Component,
	type OverlayAnchor,
	type OverlayHandle,
	type OverlayOptions,
	type SizeValue,
	type TUI,
} from "@oh-my-pi/pi-tui";
import { matchesUiDismiss } from "../utils/keybinding-matchers";

export interface DockablePanelLayout {
	readonly anchor: OverlayAnchor;
	readonly width: SizeValue;
	readonly maxHeight: SizeValue;
}

/** Resolve the full-width bottom HUD geometry without consulting UI state. */
export function resolveDockablePanelLayout(terminalHeight: number): DockablePanelLayout {
	return {
		anchor: "bottom-center",
		width: "100%",
		maxHeight: Math.max(1, Math.floor(terminalHeight / 2)),
	};
}

export interface DockablePanelHost {
	readonly terminal: Pick<TUI["terminal"], "rows">;
	showOverlay(component: Component, options?: OverlayOptions): OverlayHandle;
	setFocus(component: Component | null): void;
	getFocused(): Component | null;
	requestRender(): void;
}

export interface DockablePanelCallbacks {
	onOpenChange?: (open: boolean) => void;
	onPinChange?: (pinned: boolean) => void;
	onFocusChange?: (focused: boolean) => void;
}

export interface DockablePanelOptions extends DockablePanelCallbacks {
	/** Explicit focus destination when Ctrl-W w leaves the panel. */
	returnFocus?: Component;
	/** The only focus target allowed to receive Ctrl-Q while the panel is open. */
	interruptOwner?: Component;
}

class DockablePanelOverlay implements Component {
	#focused = false;

	constructor(
		private readonly content: Component,
		private readonly onInput: (data: string) => boolean,
	) {}

	get focused(): boolean {
		return this.#focused;
	}

	set focused(focused: boolean) {
		this.#focused = focused;
		if (isFocusable(this.content)) this.content.focused = focused;
	}

	render(width: number): readonly string[] {
		return this.content.render(width);
	}

	handleInput(data: string): void {
		if (!this.onInput(data)) this.content.handleInput?.(data);
	}

	invalidate(): void {
		this.content.invalidate?.();
	}
}

/**
 * Owns one pi-tui overlay while keeping panel state and key behavior independent
 * of the content it renders. Owners may also route keys here while transcript
 * focus is active so the Ctrl-W w chord can return focus to the panel.
 */
export class DockablePanelController {
	readonly #overlay: DockablePanelOverlay;
	readonly #overlayOptions: OverlayOptions;
	#handle: OverlayHandle | undefined;
	#returnFocus: Component | null = null;
	#pinned = false;
	#waitingForFocusChord = false;
	#cachedLayout: DockablePanelLayout | undefined;
	#cachedHeight = -1;

	constructor(
		private readonly host: DockablePanelHost,
		content: Component,
		private readonly options: DockablePanelOptions = {},
	) {
		this.#overlay = new DockablePanelOverlay(content, data => this.handleInput(data));
		const controller = this;
		this.#overlayOptions = {
			get anchor() {
				return controller.layout.anchor;
			},
			get width() {
				return controller.layout.width;
			},
			get maxHeight() {
				return controller.layout.maxHeight;
			},
			margin: 0,
		};
	}

	get isOpen(): boolean {
		return this.#handle !== undefined;
	}

	get isPinned(): boolean {
		return this.#pinned;
	}

	get isFocused(): boolean {
		return this.isOpen && this.host.getFocused() === this.#overlay;
	}

	get layout(): DockablePanelLayout {
		const height = this.host.terminal.rows;
		if (!this.#cachedLayout || height !== this.#cachedHeight) {
			this.#cachedHeight = height;
			this.#cachedLayout = resolveDockablePanelLayout(height);
		}
		return this.#cachedLayout;
	}

	open(): void {
		if (this.#handle) return;
		this.#returnFocus = this.options.returnFocus ?? this.host.getFocused();
		this.#handle = this.host.showOverlay(this.#overlay, this.#overlayOptions);
		this.options.onOpenChange?.(true);
		this.options.onFocusChange?.(true);
	}

	close(): void {
		const handle = this.#handle;
		if (!handle) return;
		const wasFocused = this.isFocused;
		this.#handle = undefined;
		this.#waitingForFocusChord = false;
		handle.hide();
		if (wasFocused) this.options.onFocusChange?.(false);
		this.options.onOpenChange?.(false);
	}

	toggle(): void {
		if (this.isOpen) this.close();
		else this.open();
	}

	setPinned(pinned: boolean): void {
		if (pinned === this.#pinned) return;
		this.#pinned = pinned;
		this.options.onPinChange?.(pinned);
		this.host.requestRender();
	}

	togglePin(): void {
		this.setPinned(!this.#pinned);
	}

	toggleFocus(): boolean {
		if (!this.isOpen) return false;
		if (this.isFocused) {
			if (!this.#returnFocus) return false;
			this.host.setFocus(this.#returnFocus);
			this.options.onFocusChange?.(false);
		} else {
			this.host.setFocus(this.#overlay);
			this.options.onFocusChange?.(true);
		}
		this.host.requestRender();
		return true;
	}

	/** Route only keys that are global while focus remains on the companion view. */
	handleGlobalInput(data: string): boolean {
		if (
			this.isOpen &&
			matchesKey(data, "ctrl+q") &&
			(!this.options.interruptOwner || this.host.getFocused() !== this.options.interruptOwner)
		) {
			return true;
		}
		if (this.#waitingForFocusChord) {
			this.#waitingForFocusChord = false;
			if (matchesKey(data, "w")) return this.toggleFocus();
		}
		if (matchesKey(data, "ctrl+w")) {
			this.#waitingForFocusChord = true;
			return true;
		}
		if (matchesUiDismiss(data)) {
			if (!this.isOpen) return false;
			this.close();
			return true;
		}
		return false;
	}

	/** Returns true when the key belongs to panel-level behavior. */
	handleInput(data: string): boolean {
		if (this.handleGlobalInput(data)) return true;
		if (matchesKey(data, "p")) {
			if (!this.isOpen) return false;
			this.togglePin();
			return true;
		}
		return false;
	}
}
