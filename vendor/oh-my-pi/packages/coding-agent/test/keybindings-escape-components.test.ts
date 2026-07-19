import { afterEach, beforeAll, describe, expect, it, vi } from "bun:test";
import * as Effect from "effect/Effect";
import { Exit, Scope, SubscriptionRef } from "effect";
import { MVU_KEYMAP_TABLES } from "@oh-my-pi/pi-coding-agent/config/mvu-keybindings";
import type { SelectorSurfaceMountSpec } from "@oh-my-pi/pi-coding-agent/modes/components/selector-adapter";
import { compileKeymapRegistry } from "@oh-my-pi/pi-coding-agent/modes/mvu/keymap-registry";
import { makeTerminalInputAdapter } from "@oh-my-pi/pi-coding-agent/modes/mvu/input-adapter";
import { mountMvuRuntime } from "@oh-my-pi/pi-coding-agent/modes/mvu/runtime";
import { getBundledModel } from "@oh-my-pi/pi-catalog/models";
import { KeybindingsManager } from "@oh-my-pi/pi-coding-agent/config/keybindings";
import type { ModelRegistry } from "@oh-my-pi/pi-coding-agent/config/model-registry";
import { Settings } from "@oh-my-pi/pi-coding-agent/config/settings";
import { ModelSelectorComponent } from "@oh-my-pi/pi-coding-agent/modes/components/model-selector";
import { SessionSelectorComponent } from "@oh-my-pi/pi-coding-agent/modes/components/session-selector";
import { initTheme } from "@oh-my-pi/pi-coding-agent/modes/theme/theme";
import { matchesAppInterrupt, matchesUiDismiss } from "@oh-my-pi/pi-coding-agent/modes/utils/keybinding-matchers";
import type { SessionInfo } from "@oh-my-pi/pi-coding-agent/session/session-listing";
import {
	KeybindingsManager as TuiKeybindingsManager,
	setKeybindings,
	TUI_KEYBINDINGS,
	type TUI,
} from "@oh-my-pi/pi-tui";

beforeAll(() => {
	initTheme();
});

afterEach(async () => {
	await closeModelSelectorDrivers();
	setKeybindings(KeybindingsManager.inMemory());
	vi.restoreAllMocks();
});

function createSession(id: string, title: string): SessionInfo {
	return {
		path: `/tmp/${id}.jsonl`,
		id,
		cwd: "/tmp",
		title,
		created: new Date("2024-01-01T00:00:00Z"),
		modified: new Date("2024-01-02T00:00:00Z"),
		messageCount: 1,
		size: 0,
		firstMessage: `${title} first message`,
		allMessagesText: `${title} first message`,
	};
}
function driveSelector<Id, Item>(
	spec: SelectorSurfaceMountSpec<Id, Item>,
	keybindings: KeybindingsManager,
): (sequence: string) => void {
	const adapter = makeTerminalInputAdapter();
	const registry = Effect.runSync(compileKeymapRegistry(MVU_KEYMAP_TABLES, keybindings));
	let model = spec.initialModel;
	return sequence => {
		const event = adapter.decode(sequence);
		if (event === undefined || (event._tag !== "Press" && event._tag !== "Release")) {
			throw new Error(`Expected a decoded key event for ${JSON.stringify(sequence)}`);
		}
		const action = registry.resolve(spec.route.context(model), event.key);
		if (action === undefined) throw new Error(`Unmapped selector key ${JSON.stringify(sequence)}`);
		const envelope = spec.route.actionToMsg(action, event);
		if (envelope === undefined) throw new Error(`Unmapped selector action ${String(action)}`);
		const transition = spec.update(model, envelope);
		model = transition.model;

		for (const command of transition.commands) Effect.runSync(spec.interpret(command));
	};
}

type ModelSelectorDriver = {
	readonly press: (sequence: string) => Promise<void>;
	readonly close: () => Promise<void>;
};

const modelSelectorDrivers = new WeakMap<ModelSelectorComponent, ModelSelectorDriver>();
const activeModelSelectorDrivers = new Set<ModelSelectorDriver>();

const runIn = <A, E>(scope: Scope.Scope, effect: Effect.Effect<A, E, Scope.Scope>): Promise<A> =>
	Effect.runPromise(Scope.provide(scope)(effect));

async function makeModelSelectorDriver(
	selector: ModelSelectorComponent,
	keybindings: KeybindingsManager,
): Promise<ModelSelectorDriver> {
	const spec = selector.mountSpec;
	const adapter = makeTerminalInputAdapter();
	const keymap = Effect.runSync(compileKeymapRegistry(MVU_KEYMAP_TABLES, keybindings));
	const scope = Scope.makeUnsafe("sequential");
	const runtime = await runIn(
		scope,
		mountMvuRuntime({
			componentId: spec.componentId,
			initialModel: spec.initialModel,
			update: spec.update,
			interpret: spec.interpret,
			boundary: spec.boundary,
			inputCapacity: 16,
			messageCapacity: 16,
			commandCapacity: 16,
		}),
	);
	let closed = false;
	const driver: ModelSelectorDriver = {
		press: async sequence => {
			const event = adapter.decode(sequence);
			if (event === undefined || (event._tag !== "Press" && event._tag !== "Release")) {
				throw new Error(`Expected a decoded key event for ${JSON.stringify(sequence)}`);
			}
			const model = await runIn(scope, SubscriptionRef.get(runtime.model));
			const action = keymap.resolve(spec.route.context(model), event.key);
			if (action === undefined) return;
			const envelope = spec.route.actionToMsg(action, event);
			if (envelope === undefined) return;
			await runIn(scope, runtime.dispatch(envelope));
			await runIn(scope, Effect.sleep("10 millis"));
		},
		close: async () => {
			if (closed) return;
			closed = true;
			await Effect.runPromise(Scope.close(scope, Exit.void));
		},
	};
	activeModelSelectorDrivers.add(driver);
	return driver;
}

async function dispatchModelSelector(
	selector: ModelSelectorComponent,
	sequence: string,
	keybindings: KeybindingsManager,
): Promise<void> {
	let driver = modelSelectorDrivers.get(selector);
	if (driver === undefined) {
		driver = await makeModelSelectorDriver(selector, keybindings);
		modelSelectorDrivers.set(selector, driver);
	}
	await driver.press(sequence);
}

async function closeModelSelectorDrivers(): Promise<void> {
	const drivers = [...activeModelSelectorDrivers];
	activeModelSelectorDrivers.clear();
	await Promise.all(drivers.map(driver => driver.close()));
}


describe("component escape bindings", () => {
	it("keeps isolated-registry interrupt and dismissal fallbacks separate", () => {
		setKeybindings(new TuiKeybindingsManager(TUI_KEYBINDINGS));

		expect(matchesAppInterrupt("\x11")).toBe(true);
		expect(matchesAppInterrupt("\x1b")).toBe(false);
		expect(matchesUiDismiss("\x1b")).toBe(true);
		expect(matchesUiDismiss("\x11")).toBe(false);
	});

	it("respects an explicitly disabled ui.dismiss binding", () => {
		setKeybindings(
			KeybindingsManager.inMemory({
				"ui.dismiss": [],
			}),
		);

		expect(matchesUiDismiss("\x1b")).toBe(false);
	});

	it("keeps session selector ui.dismiss independent with only app.interrupt=ctrl+q configured", () => {
		const keybindings = KeybindingsManager.inMemory({
			"app.interrupt": "ctrl+q",
		});
		setKeybindings(keybindings);

		const onCancel = vi.fn();
		const selector = new SessionSelectorComponent(
			[createSession("session-a", "Alpha"), createSession("session-b", "Beta")],
			() => {},
			onCancel,
			() => {},
		);
		const dispatch = driveSelector(selector.mountSpec, keybindings);

		dispatch("\x11");
		expect(onCancel).not.toHaveBeenCalled();

		dispatch("\x1b");
		expect(onCancel).toHaveBeenCalledTimes(1);

	});

	it("uses ui.dismiss=ctrl+g for model selector independently of Escape", async () => {
		const keybindings = KeybindingsManager.inMemory({
			"ui.dismiss": "ctrl+g",
		});
		setKeybindings(keybindings);

		const model = getBundledModel("anthropic", "claude-sonnet-4-5");
		if (!model) {
			throw new Error("Expected bundled model anthropic/claude-sonnet-4-5");
		}

		const settings = Settings.isolated({
			modelRoles: {
				default: `${model.provider}/${model.id}`,
			},
		});
		const modelRegistry = {
			getAll: () => [model],
			getDiscoverableProviders: () => [],
			getCanonicalModelSelections: () => [],
		} as unknown as ModelRegistry;
		const ui = {
			requestRender: vi.fn(),
			requestComponentRender: vi.fn(),
		} as unknown as TUI;
		const onCancel = vi.fn();

		const selector = new ModelSelectorComponent(
			ui,
			model,
			settings,
			modelRegistry,
			[{ model, thinkingLevel: "off" }],
			() => {},
			onCancel,
		);

		await Bun.sleep(0);
		await dispatchModelSelector(selector, "\x1b", keybindings);
		expect(onCancel).not.toHaveBeenCalled();

		await dispatchModelSelector(selector, "\r", keybindings);
		const renderedMenu = Bun.stripANSI(selector.render(100).join("\n"));
		expect(renderedMenu).toContain("ctrl+g: cancel");

		await dispatchModelSelector(selector, "\x07", keybindings);
		expect(onCancel).not.toHaveBeenCalled();

		await dispatchModelSelector(selector, "\x07", keybindings);
		expect(onCancel).toHaveBeenCalledTimes(1);
	});
});
