import { beforeAll, describe, expect, test } from "bun:test";
import { stripVTControlCharacters } from "node:util";
import { ErrorsPanelComponent } from "../../../src/modes/components/errors-panel";
import { initTheme } from "../../../src/modes/theme/theme";
import { ErrorInbox } from "../../../src/modes/utils/error-inbox";

describe("ErrorsPanelComponent", () => {
	beforeAll(() => {
		initTheme(false);
	});

	test("tail-follows a newly recorded inbox event without replacing its focus target", async () => {
		const inbox = new ErrorInbox({ appendCustomEntry: () => "entry" });
		inbox.recordError("older failure", "provider", { id: "old", nowMs: 1 });
		await Promise.resolve();
		let renders = 0;
		const panel = new ErrorsPanelComponent(inbox, () => {}, () => {
			renders += 1;
		});
		panel.focused = true;

		inbox.recordError("new live failure", "provider", { id: "new", nowMs: 2 });
		await Promise.resolve();

		const output = stripVTControlCharacters(panel.render(80).join("\n"));
		expect(renders).toBe(1);
		expect(panel.focused).toBe(true);
		expect(output).toContain("new live failure");
		expect(output.indexOf("new live failure")).toBeLessThan(output.indexOf("older failure"));
		panel.dispose();
	});
});
