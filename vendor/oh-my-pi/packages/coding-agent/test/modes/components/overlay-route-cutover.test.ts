import { beforeAll, describe, expect, it } from "bun:test";
import { Container, type Keybinding, TUI } from "@oh-my-pi/pi-tui";
import { Effect, Exit, Scope } from "effect";
import { KeybindingsManager } from "@oh-my-pi/pi-coding-agent/config/keybindings";
import {
	MVU_ACTIVE_KEYMAP_CONTEXT_MATRIX,
	MVU_KEYMAP_TABLES,
} from "@oh-my-pi/pi-coding-agent/config/mvu-keybindings";
import {
	COMMAND_OUTPUT_ROUTE,
	CommandOutputOverlayComponent,
	type CommandOutputModalCommand,
	type CommandOutputModalModel,
} from "@oh-my-pi/pi-coding-agent/modes/components/command-line";
import {
	PLAN_REVIEW_ROUTE,
	PlanReviewOverlay,
	type PlanModalCommand,
	type PlanModalModel,
	updatePlanModal,
} from "@oh-my-pi/pi-coding-agent/modes/components/plan-review-overlay";
import { makeTerminalInputAdapter } from "@oh-my-pi/pi-coding-agent/modes/mvu/input-adapter";
import { makeInputLeaseManager, type InputLeaseManager, type MvuEnvelope } from "@oh-my-pi/pi-coding-agent/modes/mvu/input-lease";
import { compileKeymapRegistry } from "@oh-my-pi/pi-coding-agent/modes/mvu/keymap-registry";
import { mountMvuOverlay, type MvuRouteHandle } from "@oh-my-pi/pi-coding-agent/modes/mvu/route-host";
import { initTheme } from "@oh-my-pi/pi-coding-agent/modes/theme/theme";
import { VirtualTerminal } from "../../../../tui/test/virtual-terminal";

const runIn = <A, E>(scope: Scope.Scope, effect: Effect.Effect<A, E, Scope.Scope>): Promise<A> =>
	Effect.runPromise(Scope.provide(scope)(effect));

async function fixture(): Promise<{
	readonly scope: Scope.Scope;
	readonly terminal: VirtualTerminal;
	readonly tui: TUI;
	readonly manager: InputLeaseManager;
}> {
	const scope = Scope.makeUnsafe("sequential");
	const terminal = new VirtualTerminal(80, 24);
	const tui = new TUI(terminal);
	tui.start();
	const registry = Effect.runSync(
		compileKeymapRegistry(MVU_KEYMAP_TABLES, KeybindingsManager.inMemory(), MVU_ACTIVE_KEYMAP_CONTEXT_MATRIX),
	);
	const manager = await runIn(scope, makeInputLeaseManager(tui, makeTerminalInputAdapter(), registry));
	return { scope, terminal, tui, manager };
}

async function waitForLease(manager: InputLeaseManager, kind: "mvu" | "legacy"): Promise<void> {
	for (let attempt = 0; attempt < 100; attempt++) {
		if (manager.current().kind === kind) return;
		await Effect.runPromise(Effect.yieldNow);
	}
	throw new Error(`Timed out waiting for ${kind} lease`);
}

beforeAll(initTheme);

describe("overlay MVU production leases", () => {
	it("mounts command output under a dismissible lease and restores focus", async () => {
		const infra = await fixture();
		const prior = new Container();
		infra.tui.addChild(prior);
		infra.tui.setFocus(prior);
		const initialModel = COMMAND_OUTPUT_ROUTE.makeInitialModel("command result");
		const component = new CommandOutputOverlayComponent(initialModel);
		let handle: MvuRouteHandle | undefined;
		try {
			handle = await runIn(
				infra.scope,
				mountMvuOverlay({
					tui: infra.tui,
					leaseManager: infra.manager,
					route: {
						componentId: COMMAND_OUTPUT_ROUTE.componentId,
						focusedRoot: component,
						context: () => ({ contexts: ["modal.family"], mode: "Browse", focus: "body", capabilities: new Set() }),
						actionToMsg: (action: Keybinding, event: MvuEnvelope["event"]) => ({ _tag: "MvuInput", action, event }),
					},
					component,
					runtimeConfig: {
						componentId: COMMAND_OUTPUT_ROUTE.componentId,
						initialModel,
						update: (model: CommandOutputModalModel, envelope: MvuEnvelope) => {
							if (envelope.action !== "ui.dismiss") return { model, commands: [], dirtyKeys: new Set<string>() };
							const transition = COMMAND_OUTPUT_ROUTE.update(model, { _tag: "Back" });
							return { ...transition, dirtyKeys: new Set<string>(["modal"]) };
						},
						interpret: (command: CommandOutputModalCommand) => Effect.sync(() => {
							if (command._tag === "CloseRequested") void Effect.runPromise(handle?.close() ?? Effect.void);
							return [];
						}),
						inputCapacity: 16,
						messageCapacity: 16,
						commandCapacity: 4,
					},
					overlayOptions: { fullscreen: true },
					restoreFocus: Effect.sync(() => infra.tui.setFocus(prior)),
				}),
			);
			infra.tui.setFocus(component);
			expect(infra.manager.current()).toMatchObject({ kind: "mvu", componentId: "command-output" });
			infra.terminal.sendInput("\x1b");
			await waitForLease(infra.manager, "legacy");
			expect(infra.tui.getFocused()).toBe(prior);
		} finally {
			infra.tui.stop();
			await Effect.runPromise(Scope.close(infra.scope, Exit.void));
		}
	});

	it("mounts plan review under one lease and root Back restores focus", async () => {
		const infra = await fixture();
		const prior = new Container();
		infra.tui.addChild(prior);
		infra.tui.setFocus(prior);
		const initialModel = PLAN_REVIEW_ROUTE.makeInitialModel({
			planContent: "# Plan\n\nBody",
			options: ["Approve"],
		});
		const component = new PlanReviewOverlay("# Plan\n\nBody", { options: ["Approve"] }, {
			onPick: () => {},
			onCancel: () => {},
		});
		component.apply(initialModel);
		let handle: MvuRouteHandle | undefined;
		try {
			handle = await runIn(
				infra.scope,
				mountMvuOverlay({
					tui: infra.tui,
					leaseManager: infra.manager,
					route: {
						componentId: PLAN_REVIEW_ROUTE.componentId,
						focusedRoot: component,
						context: () => ({ contexts: ["modal.family", PLAN_REVIEW_ROUTE.context], mode: "Browse", focus: "body", capabilities: new Set() }),
						actionToMsg: (action: Keybinding, event: MvuEnvelope["event"]) => ({ _tag: "MvuInput", action, event }),
					},
					component,
					runtimeConfig: {
						componentId: PLAN_REVIEW_ROUTE.componentId,
						initialModel,
						update: (model: PlanModalModel, envelope: MvuEnvelope) => {
							const transition = envelope.action === "ui.dismiss" ? updatePlanModal(model, { _tag: "Back" }) : { model, commands: [] };
							return { ...transition, dirtyKeys: new Set<string>(["plan"]) };
						},
						interpret: (command: PlanModalCommand) => Effect.sync(() => {
							if (command._tag === "CloseRequested") void Effect.runPromise(handle?.close() ?? Effect.void);
							return [];
						}),
						inputCapacity: 16,
						messageCapacity: 16,
						commandCapacity: 4,
					},
					overlayOptions: { fullscreen: true },
					restoreFocus: Effect.sync(() => infra.tui.setFocus(prior)),
				}),
			);
			infra.tui.setFocus(component);
			expect(infra.manager.current()).toMatchObject({ kind: "mvu", componentId: "plan-review" });
			infra.terminal.sendInput("\x1b");
			await waitForLease(infra.manager, "legacy");
			expect(infra.tui.getFocused()).toBe(prior);
		} finally {
			infra.tui.stop();
			await Effect.runPromise(Scope.close(infra.scope, Exit.void));
		}
	});
});
