import { describe, expect, it } from "bun:test";
import { Deferred, Effect, Exit, Scope, Stream, SubscriptionRef } from "effect";
import {
	isKittyProtocolActive,
	setKittyProtocolActive,
	type Component,
	type InputDispatchRecord,
	type Keybinding,
	TUI,
} from "@oh-my-pi/pi-tui";
import { VirtualTerminal } from "../../tui/test/virtual-terminal";
import { makeComponentId, type ActiveKeymapContext, type KeymapRegistry } from "../src/modes/mvu/schema";
import { makeTerminalInputAdapter } from "../src/modes/mvu/input-adapter";
import {
	InputLeaseSaturatedError,
	KEY_RELEASE_CAPABILITY,
	makeInputLeaseManager,
	type MvuEnvelope,
} from "../src/modes/mvu/input-lease";
import { mountMvuRuntime } from "../src/modes/mvu/runtime";

type Model = { readonly received: number };

class LegacyRoot implements Component {
	readonly inputs: string[] = [];

	render(): readonly string[] {
		return ["legacy"];
	}

	handleInput(data: string): void {
		this.inputs.push(data);
	}
}

const runIn = <A, E>(scope: Scope.Scope, effect: Effect.Effect<A, E, Scope.Scope>): Promise<A> =>
	Effect.runPromise(Scope.provide(scope)(effect));

const context: ActiveKeymapContext = {
	contexts: ["selector"],
	mode: "Browse",
	focus: "list",
	capabilities: new Set(),
};


describe("MVU and Legacy input ownership", () => {
	it("consumes active MVU input once, then forwards Legacy input once after revoke", async () => {
		const scope = Scope.makeUnsafe("sequential");
		const terminal = new VirtualTerminal(40, 6);
		const tui = new TUI(terminal);
		const focused = new LegacyRoot();
		tui.addChild(focused);
		tui.setFocus(focused);
		tui.start();
		const records: InputDispatchRecord[] = [];
		tui.setInputDispatchObserver(record => records.push(record));
		const registry: KeymapRegistry = {
			resolve: (_active, _key) => "app.selector.move" as Keybinding,
			bindings: () => [],
		};
		const routedMessages: MvuEnvelope[] = [];
		const runtime = await runIn(
			scope,
			mountMvuRuntime<Model, MvuEnvelope, never, never>({
				componentId: makeComponentId("ownership"),
				initialModel: { received: 0 },
				update: (model, message) => {
					routedMessages.push(message);
					return { model: { received: model.received + 1 }, commands: [], dirtyKeys: new Set() };
				},
				interpret: () => Effect.succeed([]),
				inputCapacity: 2,
				messageCapacity: 2,
				commandCapacity: 1,
			}),
		);
		const manager = await runIn(scope, makeInputLeaseManager(tui, makeTerminalInputAdapter(), registry));
		const releaseCapabilities = new Set<string>();
		const route = {
			componentId: makeComponentId("ownership"),
			focusedRoot: focused,
			context: () => ({ ...context, capabilities: releaseCapabilities }),
			actionToMsg: (action: Keybinding, event: MvuEnvelope["event"]): MvuEnvelope | undefined =>
				event._tag === "Press" && event.text === "x"
					? undefined
					: {
							_tag: "MvuInput",
							action,
							event,
						},
			pasteToMsg: (event: MvuEnvelope["event"]): MvuEnvelope => ({
				_tag: "MvuInput",
				action: "app.input.paste" as Keybinding,
				event,
			}),
		};
		const lease = await runIn(scope, manager.acquireMvu(route, runtime));
		terminal.sendInput("j");
		terminal.sendInput("\x1b[200~pasted text\x1b[201~");
		await runIn(
			scope,
			SubscriptionRef.changes(runtime.model).pipe(
				Stream.filter(model => model.received >= 2),
				Stream.runHead,
				Effect.asVoid,
			),
		);
		expect(focused.inputs).toEqual([]);
		expect((await runIn(scope, SubscriptionRef.get(runtime.model))).received).toBe(2);
		expect(routedMessages.map(message => message.event)).toEqual([
			{ _tag: "Press", key: "j", text: "j", repeat: false },
			{ _tag: "Paste", text: "pasted text" },
		]);
		expect(records.at(-1)?.actualConsumer).toBe("router");
		expect(routedMessages[0]?.action).toBe("app.selector.move" as Keybinding);
		expect(routedMessages[1]?.action).toBe("app.input.paste" as Keybinding);

		const previousKittyState = isKittyProtocolActive();
		setKittyProtocolActive(true);
		terminal.sendInput("\x1b[106;1:3u");
		terminal.sendInput("j");
		await runIn(
			scope,
			SubscriptionRef.changes(runtime.model).pipe(
				Stream.filter(model => model.received >= 3),
				Stream.runHead,
				Effect.asVoid,
			),
		);
		expect(routedMessages).toHaveLength(3);
		expect(routedMessages.at(-1)?.event).toEqual({ _tag: "Press", key: "j", text: "j", repeat: false });
		releaseCapabilities.add(KEY_RELEASE_CAPABILITY);
		terminal.sendInput("\x1b[106;1:3u");
		await runIn(
			scope,
			SubscriptionRef.changes(runtime.model).pipe(
				Stream.filter(model => model.received >= 4),
				Stream.runHead,
				Effect.asVoid,
			),
		);
		expect(routedMessages).toHaveLength(4);
		expect(routedMessages.at(-1)?.event).toEqual({ _tag: "Release", key: "j", repeat: false });
		releaseCapabilities.delete(KEY_RELEASE_CAPABILITY);
		terminal.sendInput("x");
		terminal.sendInput("j");
		await runIn(
			scope,
			SubscriptionRef.changes(runtime.model).pipe(
				Stream.filter(model => model.received >= 5),
				Stream.runHead,
				Effect.asVoid,
			),
		);
		expect(routedMessages).toHaveLength(5);
		expect(routedMessages.at(-1)?.event).toEqual({ _tag: "Press", key: "j", text: "j", repeat: false });
		expect(records.filter(record => record.actualConsumer === "router")).toHaveLength(7);
		expect(focused.inputs).toEqual([]);
		focused.inputs.length = 0;

		let debugCalls = 0;
		tui.onDebug = () => {
			debugCalls += 1;
		};
		terminal.sendInput("\x1b[100;6u");
		expect(debugCalls).toBe(1);
		expect(records.at(-1)?.actualConsumer).toBe("global");
		setKittyProtocolActive(previousKittyState);
		await runIn(scope, lease.revoke());
		terminal.sendInput("j");
		expect(focused.inputs).toEqual(["j"]);
		expect(routedMessages).toHaveLength(5);
		expect(records.at(-1)?.actualConsumer).toBe("focused");
		tui.stop();
		await Effect.runPromise(Scope.close(scope, Exit.void));
	});

	it("backpressures saturation without acknowledging or losing an accepted event", async () => {
		const scope = Scope.makeUnsafe("sequential");
		const terminal = new VirtualTerminal(40, 6);
		const tui = new TUI(terminal);
		const focused = new LegacyRoot();
		tui.addChild(focused);
		tui.setFocus(focused);
		tui.start();
		const records: InputDispatchRecord[] = [];
		tui.setInputDispatchObserver(record => records.push(record));
		const releaseCommands = await Effect.runPromise(Deferred.make<void>());
		const registry: KeymapRegistry = {
			resolve: () => "app.selector.move" as Keybinding,
			bindings: () => [],
		};
		const runtime = await runIn(
			scope,
			mountMvuRuntime<Model, MvuEnvelope, { readonly id: number }, never>({
				componentId: makeComponentId("ownership-saturation"),
				initialModel: { received: 0 },
				update: (model, _message) => {
					const received = model.received + 1;
					return {
						model: { received },
						commands: [{ id: received }],
						dirtyKeys: new Set(),
					};
				},
				interpret: () => Deferred.await(releaseCommands).pipe(Effect.as([])),
				inputCapacity: 1,
				messageCapacity: 1,
				commandCapacity: 1,
			}),
		);
		const manager = await runIn(
			scope,
			makeInputLeaseManager(tui, makeTerminalInputAdapter(), registry, 1),
		);
		const lease = await runIn(scope, manager.acquireMvu({
			componentId: makeComponentId("ownership-saturation"),
			focusedRoot: focused,
			context: () => context,
			actionToMsg: (action: Keybinding, event: MvuEnvelope["event"]): MvuEnvelope => ({
				_tag: "MvuInput",
				action,
				event,
			}),
		}, runtime));

		const saturated: InputLeaseSaturatedError[] = [];
		for (let index = 0; index < 32; index += 1) {
			try {
				terminal.sendInput("j");
			} catch (error) {
				expect(error).toBeInstanceOf(InputLeaseSaturatedError);
				if (!(error instanceof InputLeaseSaturatedError)) throw error;
				saturated.push(error);
			}
		}
		const accepted = 32 - saturated.length;
		expect(accepted).toBe(1);
		expect(saturated[0]).toMatchObject({
			_tag: "InputLeaseSaturatedError",
			leaseId: lease.lease.leaseId,
			sequenceId: 2,
			capacity: 1,
		});
		expect(saturated.map(error => error.sequenceId)).toEqual(
			Array.from({ length: 31 }, (_, index) => index + 2),
		);
		expect(focused.inputs).toEqual([]);
		expect(records).toHaveLength(accepted);
		expect(records[0]).toMatchObject({
			expectedConsumer: "mvu",
			actualConsumer: "router",
		});
		await runIn(
			scope,
			SubscriptionRef.changes(runtime.model).pipe(
				Stream.filter(model => model.received >= accepted),
				Stream.runHead,
				Effect.asVoid,
			),
		);
		expect((await runIn(scope, SubscriptionRef.get(runtime.model))).received).toBe(accepted);

		await Effect.runPromise(Deferred.succeed(releaseCommands, undefined));
		expect((await runIn(scope, SubscriptionRef.get(runtime.model))).received).toBe(accepted);
		tui.stop();
		await Effect.runPromise(Scope.close(scope, Exit.void));
	});

	it("blocks missing, wrong, and duplicate input consumers in development", async () => {
		const scope = Scope.makeUnsafe("sequential");
		const terminal = new VirtualTerminal(40, 6);
		const tui = new TUI(terminal);
		tui.start();
		const registry: KeymapRegistry = {
			resolve: () => undefined,
			bindings: () => [],
		};
		await runIn(scope, makeInputLeaseManager(tui, makeTerminalInputAdapter(), registry));

		expect(() => terminal.sendInput("x")).toThrow("had no consumer");

		const focused = new LegacyRoot();
		tui.addChild(focused);
		tui.setFocus(focused);
		tui.setInputRouter((_data, sequenceId) => ({
			consume: false,
			trace: {
				sequenceId,
				leaseId: "wrong",
				expectedConsumer: "mvu",
			},
		}));
		expect(() => terminal.sendInput("x")).toThrow("expected mvu");

		tui.setInputRouter(() => ({
			consume: false,
			trace: {
				sequenceId: 100,
				leaseId: "duplicate",
				expectedConsumer: "legacy",
			},
		}));
		terminal.sendInput("x");
		expect(() => terminal.sendInput("x")).toThrow("more than once or out of order");

		tui.stop();
		await Effect.runPromise(Scope.close(scope, Exit.void));
	});
});
