import { afterEach, beforeAll, beforeEach, describe, expect, it } from "bun:test";
import { Effect, Exit, Scope, SubscriptionRef } from "effect";
import { TUI } from "@oh-my-pi/pi-tui";
import { KeybindingsManager } from "@oh-my-pi/pi-coding-agent/config/keybindings";
import { MVU_ACTIVE_KEYMAP_CONTEXT_MATRIX, MVU_KEYMAP_TABLES } from "@oh-my-pi/pi-coding-agent/config/mvu-keybindings";
import { resetSettingsForTest, Settings, settings } from "@oh-my-pi/pi-coding-agent/config/settings";
import { validateSettingValue } from "@oh-my-pi/pi-coding-agent/config/settings-schema";
import {
	makeSettingsModalModel,
	type SettingsModalCommand,
	type SettingsModalModel,
	SettingsSelectorComponent,
	updateSettingsModal,
} from "@oh-my-pi/pi-coding-agent/modes/components/settings-selector";
import { makeTerminalInputAdapter } from "@oh-my-pi/pi-coding-agent/modes/mvu/input-adapter";
import { makeInputLeaseManager, type MvuEnvelope } from "@oh-my-pi/pi-coding-agent/modes/mvu/input-lease";
import { compileKeymapRegistry } from "@oh-my-pi/pi-coding-agent/modes/mvu/keymap-registry";
import { mountMvuRuntime } from "@oh-my-pi/pi-coding-agent/modes/mvu/runtime";
import { makeComponentId } from "@oh-my-pi/pi-coding-agent/modes/mvu/schema";
import { initTheme } from "@oh-my-pi/pi-coding-agent/modes/theme/theme";
import { VirtualTerminal } from "../../../../tui/test/virtual-terminal";

beforeAll(async () => {
	await initTheme();
});

beforeEach(async () => {
	resetSettingsForTest();
	await Settings.init({ inMemory: true });
});

afterEach(() => {
	resetSettingsForTest();
});

const runIn = <A, E>(scope: Scope.Scope, effect: Effect.Effect<A, E, Scope.Scope>): Promise<A> =>
	Effect.runPromise(Scope.provide(scope)(effect));

describe("settings MVU input lease", () => {
	it("commits keyboard, mouse, search, paging, Tab, and nested Back without a Legacy handler", async () => {
		settings.set("memory.backend", "off");
		const scope = Scope.makeUnsafe("sequential");
		const terminal = new VirtualTerminal(100, 30);
		const tui = new TUI(terminal);
		let closeCount = 0;
		const component = new SettingsSelectorComponent(
			{ availableThinkingLevels: [], thinkingLevel: undefined, availableThemes: ["dark"] },
			{ onChange: () => {}, onCancel: () => { closeCount += 1; } },
		);
		const initialModel = makeSettingsModalModel("dark", {
			values: { defaultThinkingLevel: ["auto"], "theme.dark": ["dark"], "theme.light": ["dark"] },
		});
		component.apply(initialModel);
		tui.addChild(component);
		tui.setFocus(component);
		tui.start();

		const runtime = await runIn(
			scope,
			mountMvuRuntime<SettingsModalModel, MvuEnvelope, SettingsModalCommand, never>({
				componentId: makeComponentId("settings-selector-test"),
				initialModel,
				update: (model, envelope) => {
					const message = envelope.event._tag === "Mouse"
						? component.pointerMessage(model, envelope.event.event)
						: { _tag: "Input" as const, action: envelope.action, event: envelope.event };
					const transition = updateSettingsModal(model, message);
					return { ...transition, dirtyKeys: new Set() };
				},
				interpret: command => Effect.sync(() => {
					if (command._tag === "RenderSettings") component.apply(command.model);
					else if (command._tag === "PersistSettingRequested" && validateSettingValue(command.path, command.value)) {
						settings.set(command.path, command.value);
					} else if (command._tag === "CloseRequested") closeCount += 1;
					return [];
				}),
				inputCapacity: 32,
				messageCapacity: 32,
				commandCapacity: 32,
			}),
		);
		const registry = Effect.runSync(
			compileKeymapRegistry(MVU_KEYMAP_TABLES, KeybindingsManager.inMemory(), MVU_ACTIVE_KEYMAP_CONTEXT_MATRIX),
		);
		const manager = await runIn(scope, makeInputLeaseManager(tui, makeTerminalInputAdapter(), registry));
		await runIn(scope, manager.acquireMvu({
			componentId: makeComponentId("settings-selector-test"),
			focusedRoot: component,
			context: () => ({ contexts: ["modal.family", "modal.settings"], mode: "Browse", focus: "body", capabilities: new Set() }),
			actionToMsg: (action, event) => ({ _tag: "MvuInput", action, event }),
			pasteToMsg: event => ({ _tag: "MvuInput", action: "app.settings.input", event }),
			mouseToMsg: event => ({ _tag: "MvuInput", action: "app.settings.pointer", event }),
		}, runtime));

		terminal.sendInput("\x1b[C");
		for (const character of "memory backend") terminal.sendInput(character);
		terminal.sendInput("\n");
		await runIn(scope, Effect.sleep("40 millis"));
		let model = await runIn(scope, SubscriptionRef.get(runtime.model));
		expect(model.depth).toHaveLength(2);
		expect("handleInput" in component).toBe(false);

		terminal.sendInput("\x1b");
		terminal.sendInput("\x1b");
		terminal.sendInput("\t");
		terminal.sendInput("\x1b[6~");
		terminal.sendInput("\x1b[<65;10;10M");
		await runIn(scope, Effect.sleep("40 millis"));
		model = await runIn(scope, SubscriptionRef.get(runtime.model));
		expect(model.depth).toHaveLength(0);
		expect(model.focusIndex).toBeGreaterThanOrEqual(0);
		expect(closeCount).toBe(0);

		terminal.sendInput("\x1b");
		await runIn(scope, Effect.sleep("20 millis"));
		expect(closeCount).toBe(1);

		tui.stop();
		await Effect.runPromise(Scope.close(scope, Exit.void));
	});
});
