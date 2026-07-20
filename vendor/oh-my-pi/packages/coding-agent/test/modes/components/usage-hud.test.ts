import { beforeAll, describe, expect, test } from "bun:test";
import { UsageHudComponent } from "../../../src/modes/components/usage-hud";
import { initTheme } from "../../../src/modes/theme/theme";

describe("UsageHudComponent", () => {
	beforeAll(() => {
		initTheme(false);
	});

	test("scrolls and clamps through the shared Vim navigation seam", () => {
		const lines = Array.from({ length: 20 }, (_, index) => `line-${index}`).join("\n");
		const component = new UsageHudComponent(lines, () => {}, () => 14);
		component.render(80);

		expect(component.getScrollOffset()).toBe(0);
		component.handleInput("k");
		expect(component.getScrollOffset()).toBe(0);
		component.handleInput("j");
		component.handleInput("j");
		expect(component.getScrollOffset()).toBe(2);
		component.handleInput("G");
		expect(component.getScrollOffset()).toBe(component.getMaxScrollOffset());
		component.handleInput("j");
		expect(component.getScrollOffset()).toBe(component.getMaxScrollOffset());
		component.handleInput("g");
		expect(component.getScrollOffset()).toBe(0);
		component.handleInput("\x04");
		expect(component.getScrollOffset()).toBe(5);
		component.handleInput("\x15");
		expect(component.getScrollOffset()).toBe(0);
	});

	test("Escape and q dismiss the HUD", () => {
		let dismissals = 0;
		const component = new UsageHudComponent("usage", () => dismissals++, () => 14);
		component.render(80);

		component.handleInput("\x1b");
		component.handleInput("q");
		expect(dismissals).toBe(2);
	});
});
