import { afterEach, beforeAll, beforeEach, describe, expect, it } from "bun:test";
import { stripVTControlCharacters } from "node:util";
import { Effect, Exit, Scope, SubscriptionRef } from "effect";
import { type Keybinding, TUI, setKeybindings } from "@oh-my-pi/pi-tui";
import { KeybindingsManager } from "@oh-my-pi/pi-coding-agent/config/keybindings";
import {
	type CopySelectorCommand,
	type CopySelectorModel,
	type CopySelectorMsg,
	CopySelectorComponent,
	createCopySelectorRoute,
	updateCopySelector,
	viewCopySelector,
} from "@oh-my-pi/pi-coding-agent/modes/components/copy-selector";
import { MVU_KEYMAP_TABLES } from "@oh-my-pi/pi-coding-agent/config/mvu-keybindings";
import { compileKeymapRegistry } from "@oh-my-pi/pi-coding-agent/modes/mvu/keymap-registry";
import { makeTerminalInputAdapter } from "@oh-my-pi/pi-coding-agent/modes/mvu/input-adapter";
import { makeInputLeaseManager } from "@oh-my-pi/pi-coding-agent/modes/mvu/input-lease";
import { type KeyEvent } from "@oh-my-pi/pi-coding-agent/modes/mvu/schema";
import { mountMvuRuntime } from "@oh-my-pi/pi-coding-agent/modes/mvu/runtime";
import { getThemeByName, setThemeInstance } from "@oh-my-pi/pi-coding-agent/modes/theme/theme";
import type { CopyTarget } from "@oh-my-pi/pi-coding-agent/modes/utils/copy-targets";
import { VirtualTerminal } from "../../../../tui/test/virtual-terminal";

const runIn = <A, E>(scope: Scope.Scope, effect: Effect.Effect<A, E, Scope.Scope>): Promise<A> =>
	Effect.runPromise(Scope.provide(scope)(effect));

const UP = "\x1b[A";
const DOWN = "\x1b[B";
const ENTER = "\n";
const ESCAPE = "\x1b";
const INTERRUPT = "\x11"; // ctrl+q
const DISMISS_CTRL_G = "\x07";

let darkTheme = await getThemeByName("dark");

// Flatten order (always expanded): msg:1, Block 1, Block 2, msg:2.
function makeRoots(): CopyTarget[] {
	return [
		{
			id: "msg:1",
			label: "Newest message",
			hint: "5 lines · 2 code",
			preview: "newest-preview-text",
			content: "FULL_MESSAGE",
			copyMessage: "Copied last message to clipboard",
			children: [
				{
					id: "msg:1:code:0",
					label: "Block 1",
					hint: "ts",
					language: "ts",
					preview: "alpha()",
					content: "BLOCK0",
					copyMessage: "Copied block 1",
				},
				{
					id: "msg:1:code:1",
					label: "Block 2",
					hint: "py",
					language: "python",
					preview: "beta()",
					content: "BLOCK1",
					copyMessage: "Copied block 2",
				},
			],
		},
		{
			id: "msg:2",
			label: "Older message",
			hint: "3 lines",
			preview: "older-text",
			content: "OLDER",
			copyMessage: "Copied message",
		},
	];
}

type CopyRouteEnvelope = {
	readonly _tag: "MvuInput";
	readonly action: Keybinding;
	readonly event: KeyEvent;
	readonly message: CopySelectorMsg;
};

const VIEWPORT = { offset: 0, height: 8 } as const;

interface CopyRouteHarness {
	readonly component: CopySelectorComponent;
	readonly commands: CopySelectorCommand[];
	readonly model: () => Promise<CopySelectorModel>;
	readonly patch: () => Promise<ReturnType<typeof viewCopySelector>>;
	readonly output: () => string;
	readonly press: (sequence: string) => Promise<void>;
	readonly close: () => Promise<void>;
}

async function makeHarness(
	overrides: Parameters<typeof KeybindingsManager.inMemory>[0] = {},
): Promise<CopyRouteHarness> {
	const keybindings = KeybindingsManager.inMemory(overrides);
	setKeybindings(keybindings);
	const registry = Effect.runSync(compileKeymapRegistry(MVU_KEYMAP_TABLES, keybindings));
	const scope = Scope.makeUnsafe("sequential");
	const route = createCopySelectorRoute(makeRoots());
	const component = route.focusedRoot;
	const commands: CopySelectorCommand[] = [];
	const sync = (model: CopySelectorModel, dirtyKeys: ReadonlySet<string>): void => {
		component.apply(viewCopySelector(model, VIEWPORT, dirtyKeys));
	};
	sync(route.initialModel, new Set());

	const terminal = new VirtualTerminal(80, 40);
	const tui = new TUI(terminal);
	tui.addChild(component);
	tui.setFocus(component);
	tui.start();
	const runtime = await runIn(
		scope,
		mountMvuRuntime<CopySelectorModel, CopyRouteEnvelope, CopySelectorCommand, never>({
			componentId: route.componentId,
			initialModel: route.initialModel,
			update: (model, envelope) => {
				const transition = updateCopySelector(model, envelope.message);
				commands.push(...transition.commands);
				sync(transition.model, transition.dirtyKeys);
				return transition;
			},
			interpret: () => Effect.succeed([]),
			inputCapacity: 8,
			messageCapacity: 8,
			commandCapacity: 8,
		}),
	);
	const manager = await runIn(scope, makeInputLeaseManager(tui, makeTerminalInputAdapter(), registry));
	const inputRoute = {
		componentId: route.componentId,
		focusedRoot: component,
		context: route.context,
		actionToMsg: (action: Keybinding, event: KeyEvent): CopyRouteEnvelope | undefined => {
			const message = route.actionToMsg(action, event);
			return message === undefined ? undefined : { _tag: "MvuInput", action, event, message };
		},
	};
	const lease = await runIn(scope, manager.acquireMvu(inputRoute, runtime));

	return {
		component,
		commands,
		model: () => runIn(scope, SubscriptionRef.get(runtime.model)),
		patch: async () => viewCopySelector(await runIn(scope, SubscriptionRef.get(runtime.model)), VIEWPORT),
		output: () => render(component),
		press: async sequence => {
			terminal.sendInput(sequence);
			await runIn(scope, Effect.sleep("10 millis"));
		},
		close: async () => {
			await runIn(scope, lease.revoke());
			tui.stop();
			await Effect.runPromise(Scope.close(scope, Exit.void));
		},
	};
}

function render(component: CopySelectorComponent): string {
	return stripVTControlCharacters(component.render(80).join("\n"));
}

describe("CopySelectorComponent MVU route", () => {
	beforeAll(async () => {
		darkTheme = await getThemeByName("dark");
		if (!darkTheme) throw new Error("Failed to load dark theme");
	});

	beforeEach(() => {
		setThemeInstance(darkTheme!);
		setKeybindings(KeybindingsManager.inMemory());
	});

	afterEach(() => {
		setKeybindings(KeybindingsManager.inMemory());
	});

	it("renders an outlined, bounded tree with code blocks nested under their message", async () => {
		const harness = await makeHarness();
		try {
			const out = harness.output();
			expect(out).toContain("┌");
			expect(out).toContain("│");
			expect(out).toContain("Copy to clipboard");
			expect(out).toContain("Newest message");
			expect(out).toContain("Block 1");
			expect(out).toContain("Block 2");
			expect(out).toContain("Older message");
			expect(out).toMatch(/[├└]/);
			expect((await harness.patch()).visibleRows).toHaveLength(4);
		} finally {
			await harness.close();
		}
	});

	it("copies the message node itself through the routed Enter action", async () => {
		const harness = await makeHarness();
		try {
			await harness.press(ENTER);
			const copied = harness.commands.find(command => command._tag === "CopyRequested");
			expect(copied?._tag).toBe("CopyRequested");
			if (copied?._tag !== "CopyRequested") throw new Error("Expected CopyRequested command");
			expect(copied.target.content).toBe("FULL_MESSAGE");
			expect(copied.target.copyMessage).toBe("Copied last message to clipboard");
			expect((await harness.model()).tree.mode).toBe("TreePreview");
			expect((await harness.patch()).preview.status).toBe("Copied last message to clipboard");
		} finally {
			await harness.close();
		}
	});

	it("navigates into a nested code block and copies it", async () => {
		const harness = await makeHarness();
		try {
			await harness.press(DOWN);
			await harness.press(ENTER);
			const copied = harness.commands.find(command => command._tag === "CopyRequested");
			expect(copied?._tag).toBe("CopyRequested");
			if (copied?._tag !== "CopyRequested") throw new Error("Expected CopyRequested command");
			expect(copied.target.content).toBe("BLOCK0");
			expect(copied.target.copyMessage).toBe("Copied block 1");
		} finally {
			await harness.close();
		}
	});

	it("traverses past nested blocks, tracks preview, and backs out of preview", async () => {
		const harness = await makeHarness();
		try {
			await harness.press(DOWN);
			expect(harness.output()).toContain("alpha()");

			await harness.press(DOWN);
			await harness.press(DOWN);
			expect(harness.output()).toContain("older-text");

			await harness.press(UP);
			expect(harness.output()).toContain("beta()");

			await harness.press(ESCAPE);
			expect((await harness.model()).tree.mode).toBe("TreeBrowse");
			expect(harness.commands.some(command => command._tag === "CloseRequested")).toBe(false);
		} finally {
			await harness.close();
		}
	});

	it("keeps the preview open on Ctrl+Q and dismisses on Escape when only app.interrupt is remapped", async () => {
		const harness = await makeHarness({ "app.interrupt": "ctrl+q" });
		try {
			const before = harness.output();
			await harness.press(INTERRUPT);
			expect(harness.commands.some(command => command._tag === "CloseRequested")).toBe(false);
			expect(harness.output()).toBe(before);

			await harness.press(ESCAPE);
			expect(harness.commands.some(command => command._tag === "CloseRequested")).toBe(true);
		} finally {
			await harness.close();
		}
	});

	it("dispatches remapped ui.dismiss through the route", async () => {
		const harness = await makeHarness({ "ui.dismiss": "ctrl+g" });
		try {
			await harness.press(ESCAPE);
			expect(harness.commands.some(command => command._tag === "CloseRequested")).toBe(false);

			await harness.press(DISMISS_CTRL_G);
			expect(harness.commands.some(command => command._tag === "CloseRequested")).toBe(true);
		} finally {
			await harness.close();
		}
	});
});
