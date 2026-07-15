export type NavigationDirection = -1 | 1;

export type CompletionNavigation<T> =
	| { kind: "selection"; item: T; index: number }
	| { kind: "history"; value: string }
	| { kind: "none" };

/**
 * Pure state for completion menus and their fallback command history.
 *
 * History entries are ordered oldest to newest. Navigating backward first
 * recalls the newest entry; navigating forward past it restores the draft that
 * was present when history navigation began.
 */
export class CompletionBehavior<T> {
	#items: ReadonlyArray<T> = [];
	#isOpen = false;
	#selectedIndex = 0;
	#history: ReadonlyArray<string> = [];
	#historyCursor = 0;
	#draft = "";

	constructor(items: ReadonlyArray<T> = []) {
		this.setItems(items);
	}

	get items(): ReadonlyArray<T> {
		return this.#items;
	}

	get isOpen(): boolean {
		return this.#isOpen;
	}

	get selectedIndex(): number {
		return this.#selectedIndex;
	}

	get selectedItem(): T | undefined {
		return this.#items[this.#selectedIndex];
	}

	get history(): ReadonlyArray<string> {
		return this.#history;
	}

	get historyCursor(): number {
		return this.#historyCursor;
	}

	get draft(): string {
		return this.#draft;
	}

	setItems(items: ReadonlyArray<T>): void {
		this.#items = items;
		this.#selectedIndex = 0;
		this.#isOpen = items.length > 0;
	}

	open(items?: ReadonlyArray<T>): boolean {
		if (items) {
			this.setItems(items);
		}
		this.#isOpen = this.#items.length > 0;
		return this.#isOpen;
	}

	dismiss(): boolean {
		const wasOpen = this.#isOpen;
		this.#isOpen = false;
		return wasOpen;
	}

	accept(): T | undefined {
		if (!this.#isOpen) return undefined;
		const selected = this.selectedItem;
		this.#isOpen = false;
		return selected;
	}

	select(index: number): T | undefined {
		if (this.#items.length === 0) {
			this.#selectedIndex = 0;
			return undefined;
		}
		this.#selectedIndex = Math.max(0, Math.min(index, this.#items.length - 1));
		return this.selectedItem;
	}

	cycle(direction: NavigationDirection): T | undefined {
		if (!this.#isOpen || this.#items.length === 0) return undefined;
		const length = this.#items.length;
		this.#selectedIndex = (this.#selectedIndex + direction + length) % length;
		return this.selectedItem;
	}

	page(direction: NavigationDirection, pageSize: number): T | undefined {
		if (!this.#isOpen || this.#items.length === 0) return undefined;
		const distance = Math.max(1, Math.trunc(pageSize));
		return this.select(this.#selectedIndex + direction * distance);
	}

	loadHistory(entries: ReadonlyArray<string>): void {
		this.#history = entries;
		this.#resetHistoryNavigation();
	}

	recordHistory(entry: string): void {
		if (entry.length === 0 || this.#history.at(-1) === entry) {
			this.#resetHistoryNavigation();
			return;
		}
		this.#history = [...this.#history, entry];
		this.#resetHistoryNavigation();
	}

	navigate(direction: NavigationDirection, currentDraft: string): CompletionNavigation<T> {
		if (this.#isOpen) {
			const item = this.cycle(direction);
			return item === undefined ? { kind: "none" } : { kind: "selection", item, index: this.#selectedIndex };
		}

		if (this.#history.length === 0) return { kind: "none" };

		if (direction === -1) {
			if (this.#historyCursor === this.#history.length) {
				this.#draft = currentDraft;
			}
			this.#historyCursor = Math.max(0, this.#historyCursor - 1);
			return { kind: "history", value: this.#history[this.#historyCursor]! };
		}

		if (this.#historyCursor >= this.#history.length) {
			return { kind: "history", value: this.#draft };
		}
		this.#historyCursor += 1;
		return {
			kind: "history",
			value: this.#historyCursor === this.#history.length ? this.#draft : this.#history[this.#historyCursor]!,
		};
	}

	#resetHistoryNavigation(): void {
		this.#historyCursor = this.#history.length;
		this.#draft = "";
	}
}
