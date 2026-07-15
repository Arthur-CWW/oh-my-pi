import { describe, expect, test } from "bun:test";
import type { Component, OverlayOptions } from "@oh-my-pi/pi-tui";
import {
	DockablePanelController,
	type DockablePanelHost,
	resolveDockablePanelLayout,
	SIDE_DOCK_MIN_TERMINAL_WIDTH,
} from "../../../src/modes/components/dockable-panel";

const OWNER: Component = { render: () => ["owner"] };
const CONTENT: Component = { render: () => ["panel"] };

function createHost(width = 120, height = 30): {
	host: DockablePanelHost;
	focused: () => Component | null;
	options: () => OverlayOptions | undefined;
	hideCount: () => number;
} {
	let focused: Component | null = OWNER;
	let overlayOptions: OverlayOptions | undefined;
	let hidden = 0;
	const terminal = { columns: width, rows: height };
	const host: DockablePanelHost = {
		terminal,
		showOverlay(component, options) {
			overlayOptions = options;
			focused = component;
			let isHidden = false;
			return {
				hide() {
					if (isHidden) return;
					isHidden = true;
					hidden++;
					if (focused === component) focused = OWNER;
				},
				setHidden(nextHidden) {
					isHidden = nextHidden;
				},
				isHidden() {
					return isHidden;
				},
			};
		},
		setFocus(component) {
			focused = component;
		},
		getFocused() {
			return focused;
		},
		requestRender() {},
	};
	return {
		host,
		focused: () => focused,
		options: () => overlayOptions,
		hideCount: () => hidden,
	};
}

describe("resolveDockablePanelLayout", () => {
	test("uses a one-third-height bottom dock below the side threshold", () => {
		const layout = resolveDockablePanelLayout(SIDE_DOCK_MIN_TERMINAL_WIDTH - 1, 30, "right");
		expect(layout).toEqual({ dock: "bottom", anchor: "bottom-center", width: "100%", maxHeight: 10 });
	});

	test("uses a 40-column right dock at the threshold", () => {
		const layout = resolveDockablePanelLayout(SIDE_DOCK_MIN_TERMINAL_WIDTH, 30, "right");
		expect(layout).toEqual({ dock: "right", anchor: "right-center", width: 40, maxHeight: "100%" });
	});

	test("honors a left-side preference on wide terminals and falls back on narrow ones", () => {
		expect(resolveDockablePanelLayout(160, 30, "left").dock).toBe("left");
		expect(resolveDockablePanelLayout(119, 30, "left").dock).toBe("bottom");
	});
});

describe("DockablePanelController", () => {
	test("mounts with resolved overlay options and Escape closes it", () => {
		const harness = createHost();
		const openChanges: boolean[] = [];
		const controller = new DockablePanelController(harness.host, CONTENT, {
			onOpenChange: open => openChanges.push(open),
		});

		controller.open();
		expect(harness.options()?.anchor).toBe("right-center");
		expect(harness.options()?.width).toBe(40);
		expect(controller.handleInput("\x1b")).toBe(true);
		expect(controller.isOpen).toBe(false);
		expect(harness.hideCount()).toBe(1);
		expect(openChanges).toEqual([true, false]);
	});

	test("p toggles the pinned state and hook", () => {
		const harness = createHost();
		const pinChanges: boolean[] = [];
		const controller = new DockablePanelController(harness.host, CONTENT, {
			onPinChange: pinned => pinChanges.push(pinned),
		});
		controller.open();

		expect(controller.handleInput("p")).toBe(true);
		expect(controller.isPinned).toBe(true);
		expect(controller.handleInput("p")).toBe(true);
		expect(controller.isPinned).toBe(false);
		expect(pinChanges).toEqual([true, false]);
	});

	test("Ctrl-W w toggles focus between panel and its prior owner", () => {
		const harness = createHost();
		const focusChanges: boolean[] = [];
		const controller = new DockablePanelController(harness.host, CONTENT, {
			onFocusChange: focused => focusChanges.push(focused),
		});
		controller.open();
		const panel = harness.focused();
		expect(panel).not.toBe(OWNER);

		expect(controller.handleInput("\x17")).toBe(true);
		expect(controller.handleInput("w")).toBe(true);
		expect(harness.focused()).toBe(OWNER);

		// The owner routes the same chord back to the controller.
		expect(controller.handleInput("\x17")).toBe(true);
		expect(controller.handleInput("w")).toBe(true);
		expect(harness.focused()).toBe(panel);
		expect(focusChanges).toEqual([true, false, true]);
	});
	test("reserves Ctrl-Q for the configured turn-owning editor", () => {
		const harness = createHost();
		const editor: Component = { render: () => ["editor"] };
		const controller = new DockablePanelController(harness.host, CONTENT, {
			interruptOwner: editor,
		});
		controller.open();
		expect(controller.handleInput("\x11")).toBe(true);
		expect(controller.isOpen).toBe(true);

		controller.toggleFocus();
		expect(harness.focused()).toBe(OWNER);
		expect(controller.handleGlobalInput("\x11")).toBe(true);
		harness.host.setFocus(editor);
		expect(controller.handleGlobalInput("\x11")).toBe(false);
	});
});
