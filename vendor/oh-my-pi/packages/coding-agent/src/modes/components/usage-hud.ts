import type { Keybinding } from "@oh-my-pi/pi-tui";
import { Container, ScrollView, Text } from "@oh-my-pi/pi-tui";
import { type MvuEnvelope, type MvuInputRoute } from "../mvu/input-lease";
import { makeComponentId, type ActiveKeymapContext, type ComponentId, type KeyEvent, type Transition } from "../mvu/schema";
import { theme } from "../theme/theme";
import { DynamicBorder } from "./dynamic-border";

const MAX_VISIBLE_LINES = 10;
const USAGE_VIEW_KEY = "usage-hud";

export type UsageHudMsg =
	| { readonly _tag: "Scroll"; readonly delta: number }
	| { readonly _tag: "Page"; readonly delta: -1 | 1 }
	| { readonly _tag: "Jump"; readonly target: "top" | "bottom" }
	| { readonly _tag: "Resize"; readonly rows: number }
	| { readonly _tag: "Dismiss" };

export type UsageHudCommand = { readonly _tag: "CloseRequested" };

export interface UsageHudModel {
	readonly lines: readonly string[];
	readonly offset: number;
	readonly viewportRows: number;
	readonly closed: boolean;
}

const clampViewportRows = (rows: number): number =>
	Number.isFinite(rows) ? Math.max(1, Math.min(MAX_VISIBLE_LINES, Math.trunc(rows))) : MAX_VISIBLE_LINES;

const maxOffset = (model: UsageHudModel): number => Math.max(0, model.lines.length - MAX_VISIBLE_LINES);

const clampOffset = (model: UsageHudModel, offset: number): number =>
	Math.max(0, Math.min(maxOffset(model), Number.isFinite(offset) ? Math.trunc(offset) : 0));

export function makeUsageHudModel(message: string, terminalRows = 24): UsageHudModel {
	return {
		lines: message.split(/\r?\n/),
		offset: 0,
		viewportRows: clampViewportRows(terminalRows - 8),
		closed: false,
	};
}

export function updateUsageHud(
	model: UsageHudModel,
	msg: UsageHudMsg,
): Transition<UsageHudModel, UsageHudCommand> {
	switch (msg._tag) {
		case "Scroll": {
			const next = { ...model, offset: clampOffset(model, model.offset + msg.delta) };
			return { model: next, commands: [], dirtyKeys: new Set([USAGE_VIEW_KEY]) };
		}
		case "Page": {
			const next = {
				...model,
				offset: clampOffset(model, model.offset + msg.delta * Math.max(1, model.viewportRows - 1)),
			};
			return { model: next, commands: [], dirtyKeys: new Set([USAGE_VIEW_KEY]) };
		}
		case "Jump": {
			const next = { ...model, offset: msg.target === "top" ? 0 : maxOffset(model) };
			return { model: next, commands: [], dirtyKeys: new Set([USAGE_VIEW_KEY]) };
		}
		case "Resize": {
			const viewportRows = clampViewportRows(msg.rows - 8);
			const next = { ...model, viewportRows, offset: clampOffset({ ...model, viewportRows }, model.offset) };
			return { model: next, commands: [], dirtyKeys: new Set([USAGE_VIEW_KEY]) };
		}
		case "Dismiss":
			return {
				model: { ...model, closed: true },
				commands: [{ _tag: "CloseRequested" }],
				dirtyKeys: new Set([USAGE_VIEW_KEY]),
			};
	}
}

export interface UsageHudRouteSpec {
	readonly componentId: ComponentId;
	readonly component: UsageHudComponent;
	readonly route: MvuInputRoute<UsageHudModel>;
	readonly initialModel: UsageHudModel;
}

const usageHudContext = (_model: UsageHudModel): ActiveKeymapContext => ({
	contexts: ["usage.hud"],
	mode: "Browse",
	focus: "list",
	capabilities: new Set(),
});

const usageHudInput = (action: Keybinding, event: KeyEvent): MvuEnvelope => ({
	_tag: "MvuInput",
	action,
	event,
});

export function usageHudMsgFromInput(action: Keybinding, event: KeyEvent): UsageHudMsg | undefined {
	if (event._tag === "Resize") return { _tag: "Resize", rows: event.rows };
	if (event._tag !== "Press") return undefined;
	switch (String(action)) {
		case "app.navigation.up":
		case "tui.select.up":
			return { _tag: "Scroll", delta: -1 };
		case "app.navigation.down":
		case "tui.select.down":
			return { _tag: "Scroll", delta: 1 };
		case "app.navigation.pageUp":
		case "tui.select.pageUp":
			return { _tag: "Page", delta: -1 };
		case "app.navigation.pageDown":
		case "tui.select.pageDown":
			return { _tag: "Page", delta: 1 };
		case "app.navigation.top":
		case "tui.select.first":
			return { _tag: "Jump", target: "top" };
		case "app.navigation.bottom":
		case "tui.select.last":
			return { _tag: "Jump", target: "bottom" };
		case "ui.dismiss":
			return { _tag: "Dismiss" };
		default:
			return undefined;
	}
}

export function createUsageHudRoute(message: string, terminalRows = 24): UsageHudRouteSpec {
	const componentId = makeComponentId("usage-hud");
	const component = new UsageHudComponent(message, () => terminalRows);
	return {
		componentId,
		component,
		initialModel: makeUsageHudModel(message, terminalRows),
		route: {
			componentId,
			focusedRoot: component,
			context: usageHudContext,
			actionToMsg: (action, event) => {
				if (event._tag === "Resize") return usageHudInput(action, event);
				if (event._tag !== "Press") return undefined;
				return usageHudInput(action, event);
			},
		},
	};
}

export class UsageHudComponent extends Container {
	readonly #scrollView: ScrollView;
	readonly #terminalRows: () => number;

	constructor(message: string, terminalRows: () => number = () => 24) {
		super();
		this.#terminalRows = terminalRows;
		this.#scrollView = new ScrollView(message.split(/\r?\n/), {
			height: 1,
			scrollbar: "auto",
			theme: {
				track: text => theme.fg("dim", text),
				thumb: text => theme.fg("accent", text),
			},
		});

		this.addChild(new DynamicBorder(str => theme.fg("dim", str)));
		this.addChild(this.#scrollView);
		this.addChild(new DynamicBorder(str => theme.fg("dim", str)));
		this.addChild(
			new Text(
				theme.fg("dim", "j/k scroll · g/G first/last · Ctrl-D/Ctrl-U half-page · Esc/q close"),
				1,
				0,
			),
		);
	}

	apply(model: UsageHudModel): void {
		this.#scrollView.setLines(model.lines);
		this.#scrollView.setHeight(model.viewportRows);
		this.#scrollView.setScrollOffset(model.offset);
	}

	getScrollOffset(): number {
		return this.#scrollView.getScrollOffset();
	}

	getMaxScrollOffset(): number {
		return this.#scrollView.getMaxScrollOffset();
	}

	override render(width: number): readonly string[] {
		const terminalRows = this.#terminalRows();
		const rows = Number.isFinite(terminalRows) ? Math.trunc(terminalRows) : 24;
		this.#scrollView.setHeight(Math.max(1, Math.min(MAX_VISIBLE_LINES, rows - 8)));
		return super.render(width);
	}
}
