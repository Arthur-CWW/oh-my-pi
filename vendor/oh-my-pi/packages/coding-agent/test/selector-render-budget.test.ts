import { beforeAll, describe, expect, it } from "bun:test";
import {
	SelectorSurface,
	type SelectorSurfaceModel,
} from "@oh-my-pi/pi-coding-agent/modes/components/selector-adapter";
import {
	createSessionTreeRoute,
	type SessionTreeModel,
	type SessionTreeMsg,
	updateSessionTree,
	viewSessionTree,
} from "@oh-my-pi/pi-coding-agent/modes/components/tree-selector";
import type { MvuEnvelope } from "@oh-my-pi/pi-coding-agent/modes/mvu/input-lease";
import { mountMvuRuntime, type MvuRuntime } from "@oh-my-pi/pi-coding-agent/modes/mvu/runtime";
import { makeComponentId } from "@oh-my-pi/pi-coding-agent/modes/mvu/schema";
import { initTheme } from "@oh-my-pi/pi-coding-agent/modes/theme/theme";
import type { BranchSummaryEntry, SessionTreeNode } from "@oh-my-pi/pi-coding-agent/session/session-entries";
import { Key, type Keybinding, type KeyId } from "@oh-my-pi/pi-tui";
import { Effect, Exit, Scope } from "effect";
import { MvuTestBackend } from "../../tui/test/mvu-test-backend";

interface Row {
	readonly id: string;
	readonly label: string;
}

interface SelectorHarness {
	readonly backend: MvuTestBackend;
	readonly runtime: MvuRuntime<SelectorSurfaceModel<string, Row>, MvuEnvelope>;
	readonly scope: Scope.Scope;
}

interface TreeRenderCommand {
	readonly model: SessionTreeModel;
	readonly dirtyKeys: ReadonlySet<string>;
}

interface TreeHarness {
	readonly backend: MvuTestBackend;
	readonly runtime: MvuRuntime<SessionTreeModel, SessionTreeMsg>;
	readonly scope: Scope.Scope;
	readonly actionToMsg: (action: Keybinding, event: MvuEnvelope["event"]) => SessionTreeMsg | undefined;
}

beforeAll(() => {
	initTheme();
});

const runIn = <A, E>(scope: Scope.Scope, effect: Effect.Effect<A, E, Scope.Scope>): Promise<A> =>
	Effect.runPromise(Scope.provide(scope)(effect));

function press(action: string, key: KeyId): MvuEnvelope {
	return {
		_tag: "MvuInput",
		action: action as Keybinding,
		event: { _tag: "Press", key, repeat: false },
	};
}

async function settle(scope: Scope.Scope): Promise<void> {
	await runIn(scope, Effect.sleep("10 millis"));
}

async function close(scope: Scope.Scope): Promise<void> {
	await Effect.runPromise(Scope.close(scope, Exit.void));
}

async function mountSelector(rows: readonly Row[], onRenderRow: () => void): Promise<SelectorHarness> {
	const surface = new SelectorSurface<string, Row>({
		componentId: makeComponentId("selector-render-budget"),
		items: rows,
		keyOf: row => row.id,
		searchText: row => row.label,
		renderRow: (row, context) => {
			onRenderRow();
			return [`${context.selected ? ">" : " "}${row.label}`];
		},
		viewportSize: 12,
	});
	const spec = surface.mountSpec;
	const scope = Scope.makeUnsafe("sequential");
	const runtime = await runIn(
		scope,
		mountMvuRuntime({
			componentId: spec.componentId,
			initialModel: spec.initialModel,
			update: spec.update,
			interpret: spec.interpret,
			boundary: spec.boundary,
			inputCapacity: 8,
			messageCapacity: 8,
			commandCapacity: 8,
		}),
	);
	const backend = new MvuTestBackend(64, 12);
	backend.mount(surface);
	return { backend, runtime, scope };
}

async function mountTree(nodes: readonly SessionTreeNode[]): Promise<TreeHarness> {
	const spec = createSessionTreeRoute(nodes);
	const viewport = (model: SessionTreeModel) => ({
		offset: model.tree.viewportOffset,
		height: model.tree.viewportSize,
	});
	spec.focusedRoot.apply(viewSessionTree(spec.initialModel, viewport(spec.initialModel), new Set(["viewport"])));
	const scope = Scope.makeUnsafe("sequential");
	const runtime = await runIn(
		scope,
		mountMvuRuntime<SessionTreeModel, SessionTreeMsg, TreeRenderCommand, never>({
			componentId: spec.componentId,
			initialModel: spec.initialModel,
			update: (model, message) => {
				const transition = updateSessionTree(model, message);
				return {
					model: transition.model,
					commands: [{ model: transition.model, dirtyKeys: transition.dirtyKeys }],
					dirtyKeys: transition.dirtyKeys,
				};
			},
			interpret: command =>
				Effect.sync(() => {
					spec.focusedRoot.apply(viewSessionTree(command.model, viewport(command.model), command.dirtyKeys));
					return [];
				}),
			inputCapacity: 8,
			messageCapacity: 8,
			commandCapacity: 8,
		}),
	);
	const backend = new MvuTestBackend(80, 16);
	backend.mount(spec.focusedRoot);
	return { backend, runtime, scope, actionToMsg: spec.actionToMsg };
}

describe("selector render budget", () => {
	it("patches only the old and new selector rows after 100k-row navigation", async () => {
		const source = Array.from({ length: 100_000 }, (_, index) => ({ id: `row-${index}`, label: `Row ${index}` }));
		let sourceReads = 0;
		const rows = new Proxy(source, {
			get(target, property, receiver) {
				if (typeof property === "string" && Number.isSafeInteger(Number(property))) sourceReads += 1;
				return Reflect.get(target, property, receiver);
			},
		});
		let rowRenders = 0;
		const harness = await mountSelector(rows, () => {
			rowRenders += 1;
		});
		harness.backend.render();
		expect(rowRenders).toBe(12);

		await runIn(harness.scope, harness.runtime.dispatch(press("tui.select.last", Key.end)));
		await settle(harness.scope);
		harness.backend.render();
		rowRenders = 0;
		sourceReads = 0;

		await runIn(harness.scope, harness.runtime.dispatch(press("tui.select.up", Key.up)));
		await settle(harness.scope);
		const grid = harness.backend.render();
		expect(grid.region({ x: 0, y: 0, width: 64, height: 12 }).join("\n")).toContain(">Row 99998");
		expect(rowRenders).toBe(2);
		expect(sourceReads).toBe(0);
		await close(harness.scope);
	});

	it("patches only two keyed tree rows after 100k-row navigation", async () => {
		let rowReads = 0;
		const nodes = Array.from({ length: 100_000 }, (_, index): SessionTreeNode => {
			const entry: BranchSummaryEntry = {
				type: "branch_summary",
				id: `node-${index}`,
				parentId: null,
				timestamp: "2026-01-01T00:00:00.000Z",
				summary: `Node ${index}`,
				fromId: `node-${index}`,
			};
			Object.defineProperty(entry, "summary", {
				get: () => {
					rowReads += 1;
					return `Node ${index}`;
				},
			});
			return { entry, children: [] };
		});
		const harness = await mountTree(nodes);
		harness.backend.render();

		const jump = harness.actionToMsg("tui.select.last" as Keybinding, press("tui.select.last", Key.end).event);
		expect(jump).toBeDefined();
		await runIn(harness.scope, harness.runtime.dispatch(jump!));
		await settle(harness.scope);
		harness.backend.render();
		rowReads = 0;

		const move = harness.actionToMsg("tui.select.up" as Keybinding, press("tui.select.up", Key.up).event);
		expect(move).toBeDefined();
		await runIn(harness.scope, harness.runtime.dispatch(move!));
		await settle(harness.scope);
		const grid = harness.backend.render();
		expect(grid.region({ x: 0, y: 0, width: 80, height: 16 }).join("\n")).toContain("Node 99998");
		expect(rowReads).toBe(2);
		await close(harness.scope);
	});
});
