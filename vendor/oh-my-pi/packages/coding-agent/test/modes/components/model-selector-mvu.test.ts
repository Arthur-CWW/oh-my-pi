import { afterEach, beforeAll, beforeEach, describe, expect, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { buildModel } from "@oh-my-pi/pi-catalog/build";
import { KeybindingsManager } from "@oh-my-pi/pi-coding-agent/config/keybindings";
import { ModelRegistry } from "@oh-my-pi/pi-coding-agent/config/model-registry";
import { MVU_KEYMAP_TABLES } from "@oh-my-pi/pi-coding-agent/config/mvu-keybindings";
import { Settings } from "@oh-my-pi/pi-coding-agent/config/settings";
import { ModelSelectorComponent } from "@oh-my-pi/pi-coding-agent/modes/components/model-selector";
import { makeTerminalInputAdapter } from "@oh-my-pi/pi-coding-agent/modes/mvu/input-adapter";
import { makeInputLeaseManager } from "@oh-my-pi/pi-coding-agent/modes/mvu/input-lease";
import { compileKeymapRegistry } from "@oh-my-pi/pi-coding-agent/modes/mvu/keymap-registry";
import { mountMvuRuntime } from "@oh-my-pi/pi-coding-agent/modes/mvu/runtime";
import { getThemeByName, setThemeInstance } from "@oh-my-pi/pi-coding-agent/modes/theme/theme";
import { AuthStorage } from "@oh-my-pi/pi-coding-agent/session/auth-storage";
import { setKeybindings, TUI } from "@oh-my-pi/pi-tui";
import { Effect, Exit, Scope, SubscriptionRef } from "effect";
import { VirtualTerminal } from "../../../../tui/test/virtual-terminal";

const runIn = <A, E>(scope: Scope.Scope, effect: Effect.Effect<A, E, Scope.Scope>): Promise<A> =>
	Effect.runPromise(Scope.provide(scope)(effect));

let darkTheme = await getThemeByName("dark");

beforeAll(async () => {
	darkTheme = await getThemeByName("dark");
	if (darkTheme === undefined) throw new Error("Dark theme unavailable");
});

beforeEach(() => {
	setThemeInstance(darkTheme!);
	setKeybindings(KeybindingsManager.inMemory());
});

afterEach(() => setKeybindings(KeybindingsManager.inMemory()));

describe("model selector MVU route", () => {
	test("filters, navigates, activates, and backs through one real TUI lease", async () => {
		const stateDir = await mkdtemp(join(tmpdir(), "model-selector-mvu-"));
		const authStorage = await AuthStorage.create(join(stateDir, "auth.db"));
		const registry = new ModelRegistry(authStorage, join(stateDir, "models.json"));
		const alpha = buildModel({
			id: "alpha",
			name: "Alpha",
			api: "ollama-chat",
			provider: "test",
			baseUrl: "https://example.invalid",
			reasoning: false,
			input: ["text"],
			cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
			contextWindow: 32_000,
			maxTokens: 1024,
		});
		const beta = buildModel({
			...alpha,
			id: "beta",
			name: "Beta",
		});
		const selected: string[] = [];
		let cancelled = 0;
		const terminal = new VirtualTerminal(100, 40);
		const tui = new TUI(terminal);
		const component = new ModelSelectorComponent(
			tui,
			alpha,
			Settings.isolated({}),
			registry,
			[{ model: alpha }, { model: beta }],
			model => { selected.push(model.id); },
			() => { cancelled += 1; },
			{ temporaryOnly: true },
		);
		const spec = component.mountSpec;
		const scope = Scope.makeUnsafe("sequential");
		const keybindings = KeybindingsManager.inMemory();
		setKeybindings(keybindings);
		const keymap = Effect.runSync(compileKeymapRegistry(MVU_KEYMAP_TABLES, keybindings));
		const runtime = await runIn(scope, mountMvuRuntime({
			componentId: spec.componentId,
			initialModel: spec.initialModel,
			update: spec.update,
			interpret: spec.interpret,
			boundary: spec.boundary,
			inputCapacity: 16,
			messageCapacity: 16,
			commandCapacity: 16,
		}));
		const manager = await runIn(scope, makeInputLeaseManager(tui, makeTerminalInputAdapter(), keymap));
		tui.addChild(component);
		tui.setFocus(component);
		tui.start();
		const lease = await runIn(scope, manager.acquireMvu(spec.route, runtime));
		const press = async (input: string): Promise<void> => {
			terminal.sendInput(input);
			await runIn(scope, Effect.sleep("10 millis"));
		};

		try {
			expect(manager.current().kind).toBe("mvu");
			await press("/");
			await press("b");
			let model = await runIn(scope, SubscriptionRef.get(runtime.model));
			expect(model.selector.mode).toEqual({ _tag: "Filter", query: "b" });
			expect(model.selector.filteredIds).toEqual(["test/beta"]);

			await press("\x1b");
			model = await runIn(scope, SubscriptionRef.get(runtime.model));
			expect(model.selector.mode).toEqual({ _tag: "Browse" });
			await press("\x1b[B");
			expect((await runIn(scope, SubscriptionRef.get(runtime.model))).selector.selectedId).toBe("test/beta");
			await press("\n");
			expect(selected).toEqual(["beta"]);
			await press("\x1b");
			expect(cancelled).toBe(1);
		} finally {
			await runIn(scope, lease.revoke());
			tui.stop();
			await Effect.runPromise(Scope.close(scope, Exit.void));
			await authStorage.close();
			await rm(stateDir, { recursive: true, force: true });
		}
	});
});
