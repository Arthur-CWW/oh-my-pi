import { Container, ScrollView, Text } from "@oh-my-pi/pi-tui";
import { theme } from "../theme/theme";
import {
	matchesNavigationBottom,
	matchesNavigationDown,
	matchesNavigationPageDown,
	matchesNavigationPageUp,
	matchesNavigationTop,
	matchesNavigationUp,
	matchesUiDismiss,
} from "../utils/keybinding-matchers";
import { DynamicBorder } from "./dynamic-border";

const MAX_VISIBLE_LINES = 10;

/**
 * HUD-lane viewer for the provider usage report. The report remains a plain
 * rendered line list while ScrollView owns the viewport and clamping rules.
 */
export class UsageHudComponent extends Container {
	readonly #scrollView: ScrollView;
	readonly #onDismiss: () => void;
	readonly #terminalRows: () => number;

	constructor(message: string, onDismiss: () => void, terminalRows: () => number = () => 24) {
		super();
		this.#onDismiss = onDismiss;
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

	handleInput(data: string): void {
		if (matchesUiDismiss(data) || data === "q") {
			this.#onDismiss();
			return;
		}
		if (matchesNavigationUp(data)) {
			this.#scrollView.scroll(-1);
			return;
		}
		if (matchesNavigationDown(data)) {
			this.#scrollView.scroll(1);
			return;
		}
		if (matchesNavigationTop(data)) {
			this.#scrollView.scrollToTop();
			return;
		}
		if (matchesNavigationBottom(data)) {
			this.#scrollView.scrollToBottom();
			return;
		}
		if (matchesNavigationPageUp(data)) {
			this.#scrollView.page(-1);
			return;
		}
		if (matchesNavigationPageDown(data)) {
			this.#scrollView.page(1);
			return;
		}
		this.#scrollView.handleScrollKey(data);
	}
}
