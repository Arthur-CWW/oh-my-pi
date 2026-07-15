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

export type DockPosition = "bottom" | "right" | "left";

export const SIDE_PANEL_WIDTH = 40;
export const MIN_TRANSCRIPT_WIDTH_WITH_SIDE_PANEL = 80;
export const SIDE_DOCK_MIN_TERMINAL_WIDTH = SIDE_PANEL_WIDTH + MIN_TRANSCRIPT_WIDTH_WITH_SIDE_PANEL;

export interface DockablePanelLayout {
	readonly dock: DockPosition;
	readonly anchor: OverlayAnchor;
	readonly width: SizeValue;
	readonly maxHeight: SizeValue;
}

/** Resolve responsive overlay geometry without consulting terminal or UI state. */
export function resolveDockablePanelLayout(
	terminalWidth: number,
	terminalHeight: number,
	preferredDock: DockPosition = "right",
): DockablePanelLayout {
	const sideDock = preferredDock !== "bottom" && terminalWidth >= SIDE_DOCK_MIN_TERMINAL_WIDTH;
	if (sideDock) {
		return {
			dock: preferredDock,
			anchor: preferredDock === "left" ? "left-center" : "right-center",
			width: SIDE_PANEL_WIDTH,
			maxHeight: "100%",
		};
	}

	return {
		dock: "bottom",
		anchor: "bottom-center",
		width: "100%",
		maxHeight: Math.max(1, Math.floor(terminalHeight / 3)),
	};
}

export interface DockablePanelHost {
	readonly terminal: Pick<TUI["terminal"], "columns" | "rows">;
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
	/** A side preference falls back to bottom below 120 columns. */
	preferredDock?: DockPosition;
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
	#preferredDock: DockPosition;
	#returnFocus: Component | null = null;
	#pinned = false;
	#waitingForFocusChord = false;
	#cachedLayout: DockablePanelLayout | undefined;
	#cachedWidth = -1;
	#cachedHeight = -1;
	#cachedPreferredDock: DockPosition | undefined;

	constructor(
		private readonly host: DockablePanelHost,
		content: Component,
		private readonly options: DockablePanelOptions = {},
	) {
		this.#preferredDock = options.preferredDock ?? "right";
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
		const width = this.host.terminal.columns;
		const height = this.host.terminal.rows;
		if (
			!this.#cachedLayout ||
			width !== this.#cachedWidth ||
			height !== this.#cachedHeight ||
			this.#preferredDock !== this.#cachedPreferredDock
		) {
			this.#cachedWidth = width;
			this.#cachedHeight = height;
			this.#cachedPreferredDock = this.#preferredDock;
			this.#cachedLayout = resolveDockablePanelLayout(width, height, this.#preferredDock);
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

	setPreferredDock(dock: DockPosition): void {
		if (dock === this.#preferredDock) return;
		this.#preferredDock = dock;
		this.#cachedLayout = undefined;
		this.host.requestRender();
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
		if (matchesKey(data, "escape") || matchesKey(data, "esc")) {
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
