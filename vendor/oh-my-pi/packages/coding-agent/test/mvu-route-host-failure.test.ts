import { beforeAll, describe, expect, it } from "bun:test";
import { Container, type Component, type Keybinding, TUI } from "@oh-my-pi/pi-tui";
import { Effect, Exit, Scope, Stream } from "effect";
import { SelectorController } from "../src/modes/controllers/selector-controller";
import { initTheme } from "../src/modes/theme/theme";
import type { InteractiveModeContext } from "../src/modes/types";
import { makeTerminalInputAdapter } from "../src/modes/mvu/input-adapter";
import {
	InputLeaseConflictError,
	makeInputLeaseManager,
	type InputLeaseManager,
	type MvuEnvelope,
	type MvuInputRoute,
} from "../src/modes/mvu/input-lease";
import { mountMvuEditorReplacement } from "../src/modes/mvu/route-host";
import { mountMvuRuntime, type MvuRuntimeConfig } from "../src/modes/mvu/runtime";
import {
	makeComponentId,
	type ActiveKeymapContext,
	type ComponentId,
	type KeyEvent,
	type KeymapRegistry,
} from "../src/modes/mvu/schema";
import { VirtualTerminal } from "../../tui/test/virtual-terminal";

type Model = { readonly revision: number };

class DraftComponent implements Component {
	disposed = false;

	constructor(private text: string) {}

	getText(): string {
		return this.text;
	}

	setText(text: string): void {
		this.text = text;
	}

	render(): readonly string[] {
		return [this.text];
	}

	dispose(): void {
		this.disposed = true;
	}
}

class OrderedDraftComponent extends DraftComponent {
	constructor(
		text: string,
		private readonly manager: InputLeaseManager,
		private readonly closeOrder: string[],
	) {
		super(text);
	}

	override dispose(): void {
		this.closeOrder.push(`${this.manager.current().kind}:dispose-component`);
		super.dispose();
	}
}

const activeContext: ActiveKeymapContext = {
	contexts: ["selector.global"],
	mode: "Browse",
	focus: "list",
	capabilities: new Set(),
};

const registry: KeymapRegistry = {
	resolve: () => "ui.dismiss" as Keybinding,
	bindings: () => [],
};

const runtimeConfig = (componentId: ComponentId): MvuRuntimeConfig<Model, MvuEnvelope, never, never> => ({
	componentId,
	initialModel: { revision: 0 },
	update: model => ({ model, commands: [], dirtyKeys: new Set() }),
	interpret: () => Effect.succeed([]),
	inputCapacity: 2,
	messageCapacity: 2,
	commandCapacity: 1,
});

const routeFor = (componentId: ComponentId, focusedRoot: Component): MvuInputRoute<Model> => ({
	componentId,
	focusedRoot,
	context: () => activeContext,
	actionToMsg: (action: Keybinding, event: KeyEvent) => ({ _tag: "MvuInput", action, event }),
});

const runIn = <A, E>(scope: Scope.Scope, effect: Effect.Effect<A, E, Scope.Scope>): Promise<A> =>
	Effect.runPromise(Scope.provide(scope)(effect));

async function makeFixture(): Promise<{
	readonly scope: Scope.Scope;
	readonly tui: TUI;
	readonly manager: InputLeaseManager;
	readonly editorContainer: Container;
	readonly editor: DraftComponent;
}> {
	const scope = Scope.makeUnsafe("sequential");
	const tui = new TUI(new VirtualTerminal(80, 24));
	const editorContainer = new Container();
	const editor = new DraftComponent("preserve this draft");
	editorContainer.addChild(editor);
	tui.addChild(editorContainer);
	tui.setFocus(editor);
	const manager = await runIn(scope, makeInputLeaseManager(tui, makeTerminalInputAdapter(), registry));
	return { scope, tui, manager, editorContainer, editor };
}

async function occupyLease(scope: Scope.Scope, manager: InputLeaseManager, component: Component) {
	const componentId = makeComponentId("occupied-route");
	const runtime = await runIn(scope, mountMvuRuntime(runtimeConfig(componentId)));
	return runIn(scope, manager.acquireMvu(routeFor(componentId, component), runtime));
}

async function waitForRouteTransition(predicate: () => boolean): Promise<void> {
	for (let attempt = 0; attempt < 100; attempt += 1) {
		if (predicate()) return;
		await Promise.resolve();
	}
	throw new Error("Route transition did not settle");
}

beforeAll(() => {
	initTheme();
});

describe("MVU route mount failure recovery", () => {
	it("does not hide the editor or lose its draft and focus when lease acquisition conflicts", async () => {
		const fixture = await makeFixture();
		const occupied = await occupyLease(fixture.scope, fixture.manager, new DraftComponent("occupied"));
		const candidate = new DraftComponent("candidate");
		let hideCalls = 0;
		let restoreCalls = 0;

		try {
			const conflict = await runIn(
				fixture.scope,
				Effect.flip(
					mountMvuEditorReplacement({
						tui: fixture.tui,
						leaseManager: fixture.manager,
						route: routeFor(makeComponentId("conflicting-route"), candidate),
						component: candidate,
						runtimeConfig: runtimeConfig(makeComponentId("conflicting-route")),
						hideEditor: Effect.sync(() => {
							hideCalls += 1;
							fixture.editorContainer.clear();
							fixture.editorContainer.addChild(candidate);
						}),
						restoreEditor: Effect.sync(() => {
							restoreCalls += 1;
							fixture.editorContainer.clear();
							fixture.editorContainer.addChild(fixture.editor);
						}),
						previousFocus: fixture.editor,
					}),
				),
			);
			expect(conflict).toBeInstanceOf(InputLeaseConflictError);

			expect(hideCalls).toBe(0);
			expect(restoreCalls).toBe(0);
			expect(fixture.editorContainer.children).toEqual([fixture.editor]);
			expect(fixture.tui.getFocused()).toBe(fixture.editor);
			expect(fixture.editor.getText()).toBe("preserve this draft");
		} finally {
			await runIn(fixture.scope, occupied.revoke());
			await Effect.runPromise(Scope.close(fixture.scope, Exit.void));
		}
	});

	it("rolls back a partial editor replacement and permits a later mount and ordered close", async () => {
		const fixture = await makeFixture();
		const failed = new DraftComponent("failed route");
		const failedId = makeComponentId("failed-route");
		let restoreCalls = 0;

		try {
			await expect(
				runIn(
					fixture.scope,
					mountMvuEditorReplacement({
						tui: fixture.tui,
						leaseManager: fixture.manager,
						route: routeFor(failedId, failed),
						component: failed,
						runtimeConfig: runtimeConfig(failedId),
						hideEditor: Effect.sync(() => {
							fixture.editorContainer.clear();
							fixture.editorContainer.addChild(failed);
							throw new Error("replacement failed");
						}),
						restoreEditor: Effect.sync(() => {
							restoreCalls += 1;
							fixture.editorContainer.clear();
							fixture.editorContainer.addChild(fixture.editor);
						}),
						previousFocus: fixture.editor,
					}),
				),
			).rejects.toThrow("replacement failed");

			expect(fixture.manager.current().kind).toBe("legacy");
			expect(failed.disposed).toBe(true);
			expect(restoreCalls).toBe(1);
			expect(fixture.editorContainer.children).toEqual([fixture.editor]);
			expect(fixture.tui.getFocused()).toBe(fixture.editor);
			expect(fixture.editor.getText()).toBe("preserve this draft");

			const closeOrder: string[] = [];
			const recovered = new OrderedDraftComponent("recovered route", fixture.manager, closeOrder);
			const recoveredId = makeComponentId("recovered-route");
			const handle = await runIn(
				fixture.scope,
				mountMvuEditorReplacement({
					tui: fixture.tui,
					leaseManager: fixture.manager,
					route: routeFor(recoveredId, recovered),
					component: recovered,
					runtimeConfig: {
						...runtimeConfig(recoveredId),
						sources: [
							Stream.fromEffect(
								Effect.never.pipe(
									Effect.ensuring(Effect.sync(() => {
										closeOrder.push("interrupt");
									})),
								),
							),
						],
					},
					hideEditor: Effect.sync(() => {
						fixture.editorContainer.clear();
						fixture.editorContainer.addChild(recovered);
					}),
					disposeRenderer: Effect.sync(() => {
						closeOrder.push("dispose-renderer");
					}),
					restoreEditor: Effect.sync(() => {
						closeOrder.push("restore");
						fixture.editorContainer.clear();
						fixture.editorContainer.addChild(fixture.editor);
					}),
					previousFocus: fixture.editor,
				}),
			);
			expect(fixture.manager.current().kind).toBe("mvu");
			expect(fixture.editorContainer.children).toEqual([recovered]);
			expect(fixture.tui.getFocused()).toBe(recovered);

			await Effect.runPromise(handle.close());
			expect(closeOrder).toEqual(["interrupt", "legacy:dispose-component", "dispose-renderer", "restore"]);
			expect(fixture.manager.current().kind).toBe("legacy");
			expect(recovered.disposed).toBe(true);
			expect(fixture.editorContainer.children).toEqual([fixture.editor]);
			expect(fixture.tui.getFocused()).toBe(fixture.editor);
			expect(fixture.editor.getText()).toBe("preserve this draft");
		} finally {
			await Effect.runPromise(Scope.close(fixture.scope, Exit.void));
		}
	});

	it("keeps selector route serialization usable after an individual mount rejection", async () => {
		const fixture = await makeFixture();
		const occupied = await occupyLease(fixture.scope, fixture.manager, new DraftComponent("occupied"));
		const errors: string[] = [];
		const ctx = {
			ui: fixture.tui,
			editorContainer: fixture.editorContainer,
			editor: fixture.editor,
			chatContainer: new Container(),
			session: {
				getUserMessagesForBranching: () => [{ entryId: "entry-1", text: "message" }],
				branch: async () => ({ cancelled: true, selectedText: "" }),
			},
			showStatus: () => {},
			showError: (message: string) => errors.push(message),
			renderInitialMessages: () => {},
			reloadTodos: async () => {},
		} as unknown as InteractiveModeContext;
		const controller = new SelectorController(ctx, () => fixture.manager, fixture.scope);

		try {
			controller.showUserMessageSelector();
			await waitForRouteTransition(() => errors.length === 1);
			expect(errors[0]).toContain("already active");
			expect(fixture.editorContainer.children).toEqual([fixture.editor]);
			expect(fixture.tui.getFocused()).toBe(fixture.editor);
			expect(fixture.editor.getText()).toBe("preserve this draft");

			await runIn(fixture.scope, occupied.revoke());
			controller.showUserMessageSelector();
			await waitForRouteTransition(() => fixture.manager.current().kind === "mvu");
			expect(fixture.editorContainer.children[0]).not.toBe(fixture.editor);
			expect(fixture.tui.getFocused()).toBe(fixture.editorContainer.children[0]);

			controller.hideHookSelector();
			await waitForRouteTransition(() => fixture.manager.current().kind === "legacy");
			expect(fixture.editorContainer.children).toEqual([fixture.editor]);
			expect(fixture.tui.getFocused()).toBe(fixture.editor);
			expect(fixture.editor.getText()).toBe("preserve this draft");
		} finally {
			if (fixture.manager.current().kind === "mvu") {
				controller.hideHookSelector();
				await waitForRouteTransition(() => fixture.manager.current().kind === "legacy");
			}
			await Effect.runPromise(Scope.close(fixture.scope, Exit.void));
		}
	});
});
