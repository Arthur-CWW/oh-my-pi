import { Effect, Exit, Scope } from "effect";
import { TUI, type Keybinding } from "@oh-my-pi/pi-tui";
import { KeybindingsManager } from "../../src/config/keybindings";
import { MVU_ACTIVE_KEYMAP_CONTEXT_MATRIX, MVU_KEYMAP_TABLES } from "../../src/config/mvu-keybindings";
import { compileKeymapRegistry, type KeymapRegistry } from "../../src/modes/mvu/keymap-registry";
import { makeTerminalInputAdapter, type TerminalInputAdapter } from "../../src/modes/mvu/input-adapter";
import { makeInputLeaseManager, type InputLeaseManager } from "../../src/modes/mvu/input-lease";
import type { SelectorSurfaceMountSpec } from "../../src/modes/components/selector-adapter";
import { VirtualTerminal } from "../../../tui/test/virtual-terminal";

export interface ControllerFixture {
	readonly scope: Scope.Scope;
	readonly tui: TUI;
	readonly keybindings: KeybindingsManager;
	readonly registry: KeymapRegistry;
	readonly adapter: TerminalInputAdapter;
	readonly getInputLeaseManager: () => InputLeaseManager;
	readonly close: () => Promise<void>;
}

export async function createControllerFixture(): Promise<ControllerFixture> {
	const keybindings = KeybindingsManager.inMemory();
	const registry = Effect.runSync(
		compileKeymapRegistry(MVU_KEYMAP_TABLES, keybindings, MVU_ACTIVE_KEYMAP_CONTEXT_MATRIX),
	);
	const adapter = makeTerminalInputAdapter();
	const scope = Scope.makeUnsafe("sequential");
	const tui = new TUI(new VirtualTerminal(120, 40));
	const inputLeaseManager = await Effect.runPromise(
		Scope.provide(scope)(makeInputLeaseManager(tui, adapter, registry)),
	);
	let closed = false;
	return {
		scope,
		tui,
		keybindings,
		registry,
		adapter,
		getInputLeaseManager: () => inputLeaseManager,
		close: async () => {
			if (closed) return;
			closed = true;
			await Effect.runPromise(Scope.close(scope, Exit.void));
		},
	};
}

export async function withControllerFixture<T>(run: (fixture: ControllerFixture) => T | Promise<T>): Promise<T> {
	const fixture = await createControllerFixture();
	try {
		return await run(fixture);
	} finally {
		await fixture.close();
	}
}

export function driveSelectorRoute<Id, Item>(
	spec: SelectorSurfaceMountSpec<Id, Item>,
	fixture: ControllerFixture,
): {
	dispatchSequence(sequence: string): Promise<void>;
	dispatchAction(action: Keybinding, sequence: string): Promise<void>;
} {
	let model = spec.initialModel;
	const dispatchAction = async (action: Keybinding, sequence: string): Promise<void> => {
		const event = fixture.adapter.decode(sequence);
		if (event === undefined || (event._tag !== "Press" && event._tag !== "Release")) {
			throw new Error(`Expected a decoded key event for ${JSON.stringify(sequence)}`);
		}
		const envelope = spec.route.actionToMsg(action, event);
		if (envelope === undefined) throw new Error(`Unmapped selector action ${String(action)}`);
		const transition = spec.update(model, envelope);
		model = transition.model;
		for (const command of transition.commands) await Effect.runPromise(spec.interpret(command));
	};
	return {
		dispatchSequence: async sequence => {
			const event = fixture.adapter.decode(sequence);
			if (event === undefined || (event._tag !== "Press" && event._tag !== "Release")) {
				throw new Error(`Expected a decoded key event for ${JSON.stringify(sequence)}`);
			}
			const action = fixture.registry.resolve(spec.route.context(model), event.key);
			if (action === undefined) throw new Error(`Unmapped selector key ${JSON.stringify(sequence)}`);
			await dispatchAction(action, sequence);
		},
		dispatchAction,
	};
}
