import { beforeAll, describe, expect, test } from "bun:test";
import {
	makeUsageHudModel,
	UsageHudComponent,
	updateUsageHud,
	usageHudMsgFromInput,
} from "../../../src/modes/components/usage-hud";
import { initTheme } from "../../../src/modes/theme/theme";

describe("UsageHud MVU route", () => {
	beforeAll(() => {
		initTheme(false);
	});

	test("reducer scrolls and clamps through the shared Vim navigation seam", () => {
		let model = makeUsageHudModel(
			Array.from({ length: 20 }, (_, index) => `line-${index}`).join("\n"),
			14,
		);
		const component = new UsageHudComponent(model.lines.join("\n"), () => 14);
		component.apply(model);

		expect(component.getScrollOffset()).toBe(0);
		const up = usageHudMsgFromInput("app.navigation.up", {
			_tag: "Press",
			key: "k",
			repeat: false,
		});
		const down = usageHudMsgFromInput("app.navigation.down", {
			_tag: "Press",
			key: "j",
			repeat: false,
		});
		expect(up?._tag).toBe("Scroll");
		expect(down?._tag).toBe("Scroll");
		if (up?._tag !== "Scroll" || down?._tag !== "Scroll") throw new Error("navigation mapping missing");

		model = updateUsageHud(model, up).model;
		expect(model.offset).toBe(0);
		model = updateUsageHud(model, down).model;
		model = updateUsageHud(model, down).model;
		expect(model.offset).toBe(2);
		model = updateUsageHud(model, { _tag: "Jump", target: "bottom" }).model;
		expect(model.offset).toBe(10);
		model = updateUsageHud(model, down).model;
		expect(model.offset).toBe(10);
		model = updateUsageHud(model, { _tag: "Jump", target: "top" }).model;
		expect(model.offset).toBe(0);
		model = updateUsageHud(model, { _tag: "Page", delta: 1 }).model;
		expect(model.offset).toBe(5);
		model = updateUsageHud(model, { _tag: "Page", delta: -1 }).model;
		expect(model.offset).toBe(0);

		component.apply(model);
		expect(component.getScrollOffset()).toBe(0);
	});

	test("dismiss is a typed reducer command and q maps to the same route message", () => {
		const model = makeUsageHudModel("usage", 14);
		const dismiss = usageHudMsgFromInput("ui.dismiss", {
			_tag: "Press",
			key: "q",
			repeat: false,
		});
		expect(dismiss).toEqual({ _tag: "Dismiss" });
		if (dismiss === undefined) throw new Error("dismiss mapping missing");
		const transition = updateUsageHud(model, dismiss);
		expect(transition.model.closed).toBe(true);
		expect(transition.commands).toEqual([{ _tag: "CloseRequested" }]);
	});
});
