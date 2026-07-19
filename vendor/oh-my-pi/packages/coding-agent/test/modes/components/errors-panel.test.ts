import { beforeAll, describe, expect, test } from "bun:test";
import { stripVTControlCharacters } from "node:util";
import { type Component, type InputDispatchRecord, type Keybinding, TUI } from "@oh-my-pi/pi-tui";
import { Effect, Exit, Scope } from "effect";
import { VirtualTerminal } from "../../../../tui/test/virtual-terminal";
import { makeTerminalInputAdapter } from "../../../src/modes/mvu/input-adapter";
import { makeInputLeaseManager } from "../../../src/modes/mvu/input-lease";
import type { KeymapRegistry } from "../../../src/modes/mvu/schema";
import { createErrorsDock, ErrorsPanelComponent } from "../../../src/modes/components/errors-panel";
import { initTheme } from "../../../src/modes/theme/theme";
import { ErrorInbox } from "../../../src/modes/utils/error-inbox";

class InputOwner implements Component {
	focused = false;
	readonly inputs: string[] = [];

	render(): readonly string[] {
		return ["owner"];
	}

	handleInput(data: string): void {
		this.inputs.push(data);
	}
}

const runIn = <A, E>(scope: Scope.Scope, effect: Effect.Effect<A, E, Scope.Scope>): Promise<A> =>
	Effect.runPromise(Scope.provide(scope)(effect));

const waitForInput = (scope: Scope.Scope): Promise<void> => runIn(scope, Effect.sleep("20 millis"));

describe("ErrorsPanelComponent", () => {
	beforeAll(() => {
		initTheme(false);
	});

	test("commits a stamped inbox update before the next leased navigation", async () => {
		const scope = Scope.makeUnsafe("sequential");
		const terminal = new VirtualTerminal(80, 24);
		const tui = new TUI(terminal);
		const owner = new InputOwner();
		tui.addChild(owner);
		tui.setFocus(owner);
		tui.start();
		const registry: KeymapRegistry = {
			resolve: (_context, key) => {
				switch (String(key)) {
					case "k": return "app.navigation.up" as Keybinding;
					case "escape": return "ui.dismiss" as Keybinding;
					default: return undefined;
				}
			},
			bindings: () => [],
		};
		const manager = await runIn(scope, makeInputLeaseManager(tui, makeTerminalInputAdapter(), registry));
		const inbox = new ErrorInbox({ appendCustomEntry: () => "entry" });
		inbox.recordError("older failure", "provider", { id: "old", nowMs: 1 });
		await Promise.resolve();
		const { panel, dock } = createErrorsDock(tui, inbox, owner, () => {}, () => manager, scope);

		try {
			dock.open();
			await waitForInput(scope);
			expect(manager.current().kind).toBe("mvu");
			expect(panel.selectedId).toBe("old");

			inbox.recordError("new live failure", "provider", { id: "new", nowMs: 2 });
			await waitForInput(scope);
			expect(panel.selectedId).toBe("old");
			expect(stripVTControlCharacters(panel.render(80).join("\n"))).toContain("new live failure");

			terminal.sendInput("k");
			await waitForInput(scope);
			expect(panel.selectedId).toBe("new");
			expect(stripVTControlCharacters(panel.render(80).join("\n"))).toContain("new live failure");
		} finally {
			dock.close();
			await waitForInput(scope);
			panel.dispose();
			await Effect.runPromise(Scope.close(scope, Exit.void));
			tui.stop();
		}
	});

	test("owns exactly one input consumer only while focused and restores the real TUI owner across pin, blur, and close", async () => {
		const scope = Scope.makeUnsafe("sequential");
		const terminal = new VirtualTerminal(80, 24);
		const tui = new TUI(terminal);
		const owner = new InputOwner();
		tui.addChild(owner);
		tui.setFocus(owner);
		tui.start();
		const records: InputDispatchRecord[] = [];
		tui.setInputDispatchObserver(record => records.push(record));
		const registry: KeymapRegistry = {
			resolve: (_context, key) => {
				switch (String(key)) {
					case "p": return "app.errors.togglePin" as Keybinding;
					case "ctrl+w": return "app.errors.beginFocusChord" as Keybinding;
					case "w": return "app.errors.finishFocusChord" as Keybinding;
					case "j": return "app.navigation.down" as Keybinding;
					case "escape": return "ui.dismiss" as Keybinding;
					default: return undefined;
				}
			},
			bindings: () => [],
		};
		const manager = await runIn(
			scope,
			makeInputLeaseManager(tui, makeTerminalInputAdapter(), registry),
		);
		const inbox = new ErrorInbox({ appendCustomEntry: () => "entry" });
		inbox.recordError("first failure", "provider", { id: "first", nowMs: 1 });
		await Promise.resolve();
		const { panel, dock } = createErrorsDock(
			tui,
			inbox,
			owner,
			() => {},
			() => manager,
			scope,
		);

		try {
			dock.open();
			await waitForInput(scope);
			expect(dock.isFocused).toBe(true);
			expect(manager.current().kind).toBe("mvu");

			terminal.sendInput("p");
			await waitForInput(scope);
			expect(dock.isPinned).toBe(true);
			expect(records.at(-1)?.actualConsumer).toBe("router");

			terminal.sendInput("\u0017");
			terminal.sendInput("w");
			await waitForInput(scope);
			expect(dock.isFocused).toBe(false);
			expect(tui.getFocused()).toBe(owner);
			expect(manager.current().kind).toBe("legacy");
			expect(dock.isPinned).toBe(true);

			terminal.sendInput("x");
			expect(owner.inputs).toEqual(["x"]);
			expect(records.at(-1)?.actualConsumer).toBe("focused");

			terminal.sendInput("\u0017");
			terminal.sendInput("w");
			await waitForInput(scope);
			expect(dock.isFocused).toBe(true);
			expect(manager.current().kind).toBe("mvu");

			dock.close();
			await waitForInput(scope);
			expect(manager.current().kind).toBe("legacy");
			expect(tui.getFocused()).toBe(owner);
		} finally {
			dock.close();
			panel.dispose();
			await Effect.runPromise(Scope.close(scope, Exit.void));
			tui.stop();
		}
	});
});
