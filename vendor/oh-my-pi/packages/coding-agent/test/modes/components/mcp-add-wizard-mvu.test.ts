import { afterEach, beforeAll, beforeEach, describe, expect, test } from "bun:test";
import { KeybindingsManager } from "@oh-my-pi/pi-coding-agent/config/keybindings";
import { MVU_KEYMAP_TABLES } from "@oh-my-pi/pi-coding-agent/config/mvu-keybindings";
import {
	isMCPAddWizardInputStep,
	makeMCPAddWizardModel,
	MCPAddWizard,
	type MCPAddWizardCommand,
	type MCPAddWizardModel,
	type MCPAddWizardMsg,
	MCPAddWizardMsgSchema,
	mcpAddWizardStamp,
	updateMCPAddWizard,
} from "@oh-my-pi/pi-coding-agent/modes/components/mcp-add-wizard";
import { makeTerminalInputAdapter } from "@oh-my-pi/pi-coding-agent/modes/mvu/input-adapter";
import { makeInputLeaseManager, type MvuEnvelope, type MvuInputRoute } from "@oh-my-pi/pi-coding-agent/modes/mvu/input-lease";
import { compileKeymapRegistry } from "@oh-my-pi/pi-coding-agent/modes/mvu/keymap-registry";
import { mountMvuRuntime } from "@oh-my-pi/pi-coding-agent/modes/mvu/runtime";
import type { KeyEvent } from "@oh-my-pi/pi-coding-agent/modes/mvu/schema";
import { getThemeByName, setThemeInstance } from "@oh-my-pi/pi-coding-agent/modes/theme/theme";
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

function press(model: MCPAddWizardModel, key: string, text?: string, action = "setup.input"): MCPAddWizardModel {
	const event = { _tag: "Press", key, ...(text === undefined ? {} : { text }) } as KeyEvent;
	return updateMCPAddWizard(model, {
		_tag: "MvuInput",
		action: action as MvuEnvelope["action"],
		event,
		stamp: mcpAddWizardStamp(model),
	}).model;
}

describe("MCP add wizard MVU route", () => {
	test("a committed route model replays the complete visible form", () => {
		let model = makeMCPAddWizardModel();
		for (const character of "demo-server") model = press(model, character, character);
		model = press(model, "enter");
		expect(model.currentStep).toBe("transport");
		model = press(model, "down");
		model = press(model, "enter");
		expect(model.transport).toBe("http");
		for (const character of "https://example.test/mcp") model = press(model, character, character);

		const incrementallyProjected = new MCPAddWizard(makeMCPAddWizardModel());
		incrementallyProjected.apply(model);
		const replayed = new MCPAddWizard(model);

		expect(replayed.render(100)).toEqual(incrementallyProjected.render(100));
		expect(replayed.render(100).join("\n")).toContain("https://example.test/mcp");
		expect(model.drafts.name.value).toBe("demo-server");
		expect(model.drafts.url.value).toBe("https://example.test/mcp");
	});

	test("back invalidates an in-flight validation receipt and rejects its stale result", () => {
		let model = makeMCPAddWizardModel("demo");
		model = press(model, "down");
		model = press(model, "enter");
		for (const character of "https://example.test/mcp") model = press(model, character, character);
		const pending = press(model, "enter");
		expect(pending.receipt._tag).toBe("Pending");
		const pendingStamp = mcpAddWizardStamp(pending);

		const backed = press(pending, "escape", undefined, "ui.dismiss");
		expect(backed.currentStep).toBe("transport");
		expect(backed.receipt._tag).toBe("Idle");
		expect(mcpAddWizardStamp(backed)).not.toEqual(pendingStamp);

		const stale = updateMCPAddWizard(backed, {
			_tag: "ConnectionSettled",
			stamp: pendingStamp,
			outcome: { _tag: "Connected" },
		}).model;
		expect(stale).toBe(backed);
	});

	test("a matching async outcome commits its receipt and replayable notice", () => {
		let model = makeMCPAddWizardModel("demo");
		model = press(model, "down");
		model = press(model, "enter");
		for (const character of "https://example.test/mcp") model = press(model, character, character);
		model = press(model, "enter");
		const stamp = mcpAddWizardStamp(model);

		model = updateMCPAddWizard(model, {
			_tag: "ConnectionSettled",
			stamp,
			outcome: { _tag: "Connected" },
		}).model;

		expect(model.currentStep).toBe("scope");
		expect(model.receipt._tag).toBe("Succeeded");
		expect(model.outcome).toEqual({
			_tag: "ConnectionReady",
			message: "Connection successful; no authentication required.",
		});
		expect(new MCPAddWizard(model).render(100).join("\n")).toContain("Connection successful");
	});

	test("navigation, submit, back, and async validation stay under one live input lease", async () => {
		const initialModel = makeMCPAddWizardModel("demo");
		const component = new MCPAddWizard(initialModel);
		const terminal = new VirtualTerminal(100, 40);
		const tui = new TUI(terminal);
		const scope = Scope.makeUnsafe("sequential");
		const keybindings = KeybindingsManager.inMemory();
		setKeybindings(keybindings);
		const keymap = Effect.runSync(compileKeymapRegistry(MVU_KEYMAP_TABLES, keybindings));
		const validation = Promise.withResolvers<void>();
		const route: MvuInputRoute<MCPAddWizardModel> = {
			componentId: initialModel.componentId,
			focusedRoot: component,
			context: model => ({
				contexts: ["setup.glyph", "selector.global"],
				mode: "Browse",
				focus: isMCPAddWizardInputStep(model.currentStep) ? "input" : "list",
				capabilities: new Set(),
			}),
			actionToMsg: (action, event) => ({ _tag: "MvuInput", action, event }),
			pasteToMsg: event => ({ _tag: "MvuInput", action: "setup.input", event }),
		};
		const runtime = await runIn(scope, mountMvuRuntime<MCPAddWizardModel, MCPAddWizardMsg, MCPAddWizardCommand, never>({
			componentId: initialModel.componentId,
			initialModel,
			update: updateMCPAddWizard,
			interpret: command => {
				if (command._tag === "Render") {
					return Effect.sync(() => {
						component.apply(command.model);
						return [];
					});
				}
				if (command._tag === "TestConnection") {
					return Effect.promise(async () => {
						await validation.promise;
						return [{ _tag: "ConnectionSettled", stamp: command.stamp, outcome: { _tag: "Connected" } }] as const;
					});
				}
				return Effect.succeed([]);
			},
			boundary: {
				messageSchema: MCPAddWizardMsgSchema,
				currentStamp: mcpAddWizardStamp,
				commandStamp: command => command.stamp,
			},
			inputCapacity: 32,
			messageCapacity: 32,
			commandCapacity: 16,
		}));
		const manager = await runIn(scope, makeInputLeaseManager(tui, makeTerminalInputAdapter(), keymap));
		tui.addChild(component);
		tui.setFocus(component);
		tui.start();
		const lease = await runIn(scope, manager.acquireMvu(route, runtime));
		const leaseId = manager.current().leaseId;
		const send = async (input: string): Promise<void> => {
			terminal.sendInput(input);
			await runIn(scope, Effect.sleep("10 millis"));
		};

		try {
			await send("\x1b[B");
			await send("\n");
			for (const character of "https://example.test/mcp") await send(character);
			await send("\n");
			expect((await runIn(scope, SubscriptionRef.get(runtime.model))).receipt._tag).toBe("Pending");
			expect(manager.current().leaseId).toBe(leaseId);

			await send("\x1b");
			validation.resolve();
			await runIn(scope, Effect.sleep("20 millis"));
			const backed = await runIn(scope, SubscriptionRef.get(runtime.model));
			expect(backed.currentStep).toBe("transport");
			expect(backed.receipt._tag).toBe("Idle");
			expect(manager.current().leaseId).toBe(leaseId);
		} finally {
			await runIn(scope, lease.revoke());
			tui.stop();
			await Effect.runPromise(Scope.close(scope, Exit.void));
		}
	});
});
