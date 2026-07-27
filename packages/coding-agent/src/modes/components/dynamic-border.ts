import type { Component } from "@oh-my-pi/pi-tui";

/**
 * Full-width layout separator.
 *
 * The visible horizontal rule was removed for the borderless contract; the
 * component now emits a single blank line so surrounding layouts and their
 * height math (which count it as one row) are unchanged. The optional `color`
 * argument is retained for call-site compatibility and is intentionally unused.
 */
export class DynamicBorder implements Component {
	#cachedWidth = -1;
	#cachedLines: string[] | undefined;

	constructor(_color?: (str: string) => string) {}

	invalidate(): void {
		this.#cachedWidth = -1;
		this.#cachedLines = undefined;
	}

	render(width: number): readonly string[] {
		if (this.#cachedLines && this.#cachedWidth === width) {
			return this.#cachedLines;
		}
		const lines = [""];
		this.#cachedWidth = width;
		this.#cachedLines = lines;
		return lines;
	}
}
