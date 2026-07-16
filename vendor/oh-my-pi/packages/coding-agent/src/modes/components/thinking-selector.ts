import type { ReasoningEffort } from "@oh-my-pi/pi-ai";
import { Container, type SelectItem, SelectList } from "@oh-my-pi/pi-tui";
import { getSelectListTheme } from "../../modes/theme/theme";
import { getThinkingLevelMetadata } from "../../thinking";
import { matchesUiDismiss } from "../utils/keybinding-matchers";
import { DynamicBorder } from "./dynamic-border";

/**
 * Component that renders a thinking level selector with borders
 */
export class ThinkingSelectorComponent extends Container {
	#selectList: SelectList;
	readonly #onCancel: () => void;

	constructor(
		currentLevel: ReasoningEffort,
		availableLevels: ReasoningEffort[],
		onSelect: (level: ReasoningEffort) => void,
		onCancel: () => void,
	) {
		super();
		this.#onCancel = onCancel;

		const thinkingLevels: SelectItem[] = availableLevels.map(getThinkingLevelMetadata);

		// Add top border
		this.addChild(new DynamicBorder());

		// Create selector
		this.#selectList = new SelectList(thinkingLevels, thinkingLevels.length, getSelectListTheme());

		// Preselect current level
		const currentIndex = thinkingLevels.findIndex(item => item.value === currentLevel);
		if (currentIndex !== -1) {
			this.#selectList.setSelectedIndex(currentIndex);
		}

		this.#selectList.onSelect = item => {
			onSelect(item.value as ReasoningEffort);
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
