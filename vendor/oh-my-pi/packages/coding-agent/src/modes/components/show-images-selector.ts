import { Container, type SelectItem, SelectList } from "@oh-my-pi/pi-tui";
import { getSelectListTheme } from "../../modes/theme/theme";
import { matchesUiDismiss } from "../utils/keybinding-matchers";
import { DynamicBorder } from "./dynamic-border";

/**
 * Component that renders a show images selector with borders
 */
export class ShowImagesSelectorComponent extends Container {
	#selectList: SelectList;
	readonly #onCancel: () => void;

	constructor(currentValue: boolean, onSelect: (show: boolean) => void, onCancel: () => void) {
		super();
		this.#onCancel = onCancel;

		const items: SelectItem[] = [
			{ value: "yes", label: "Yes", description: "Show images inline in terminal" },
			{ value: "no", label: "No", description: "Show text placeholder instead" },
		];

		// Add top border
		this.addChild(new DynamicBorder());

		// Create selector
		this.#selectList = new SelectList(items, 5, getSelectListTheme());

		// Preselect current value
		this.#selectList.setSelectedIndex(currentValue ? 0 : 1);

		this.#selectList.onSelect = item => {
			onSelect(item.value === "yes");
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
