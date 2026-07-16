import { Container, type SelectItem, SelectList } from "@oh-my-pi/pi-tui";
import { getSelectListTheme } from "../../modes/theme/theme";
import { matchesUiDismiss } from "../utils/keybinding-matchers";
import { DynamicBorder } from "./dynamic-border";

/**
 * Component that renders a queue mode selector with borders
 */
export class QueueModeSelectorComponent extends Container {
	#selectList: SelectList;
	readonly #onCancel: () => void;

	constructor(
		currentMode: "all" | "one-at-a-time",
		onSelect: (mode: "all" | "one-at-a-time") => void,
		onCancel: () => void,
	) {
		super();
		this.#onCancel = onCancel;

		const queueModes: SelectItem[] = [
			{
				value: "one-at-a-time",
				label: "one-at-a-time",
				description: "Process queued messages one by one (recommended)",
			},
			{ value: "all", label: "all", description: "Process all queued messages at once" },
		];

		// Add top border
		this.addChild(new DynamicBorder());

		// Create selector
		this.#selectList = new SelectList(queueModes, 2, getSelectListTheme());

		// Preselect current mode
		const currentIndex = queueModes.findIndex(item => item.value === currentMode);
		if (currentIndex !== -1) {
			this.#selectList.setSelectedIndex(currentIndex);
		}

		this.#selectList.onSelect = item => {
			onSelect(item.value as "all" | "one-at-a-time");
		};

		this.addChild(this.#selectList);

		// Add bottom border
		this.addChild(new DynamicBorder());
	}

	handleInput(data: string): void {
		if (matchesUiDismiss(data)) {
			this.#onCancel();
			return;
		}
		this.#selectList.handleInput(data);
	}

	getSelectList(): SelectList {
		return this.#selectList;
	}
}
