import { beforeAll, describe, expect, it } from "bun:test";
import {
	SelectorSurface,
	type SelectorSurfaceModel,
} from "@oh-my-pi/pi-coding-agent/modes/components/selector-adapter";
import type { MvuEnvelope } from "@oh-my-pi/pi-coding-agent/modes/mvu/input-lease";
import { mountMvuRuntime, type MvuRuntime } from "@oh-my-pi/pi-coding-agent/modes/mvu/runtime";
import { makeComponentId } from "@oh-my-pi/pi-coding-agent/modes/mvu/schema";
import { initTheme } from "@oh-my-pi/pi-coding-agent/modes/theme/theme";
import { Effect, Exit, Scope, SubscriptionRef } from "effect";
import { Key, type Keybinding, type KeyId } from "@oh-my-pi/pi-tui";
import { MvuTestBackend, type Grid } from "../../tui/test/mvu-test-backend";

interface Row {
	readonly id: string;
	readonly label: string;
}

interface SelectorHarness {
	readonly backend: MvuTestBackend;
	readonly scope: Scope.Scope;
	readonly runtime: MvuRuntime<SelectorSurfaceModel<string, Row>, MvuEnvelope>;
}

beforeAll(() => {
	initTheme();
});

const runIn = <A, E>(scope: Scope.Scope, effect: Effect.Effect<A, E, Scope.Scope>): Promise<A> =>
	Effect.runPromise(Scope.provide(scope)(effect));

function lines(grid: Grid): readonly string[] {
	return grid.region({ x: 0, y: 0, width: grid.columns, height: grid.rows });
}

function press<TAction extends Keybinding>(action: TAction, key: KeyId): MvuEnvelope {
	return {
		_tag: "MvuInput",
		action,
		event: { _tag: "Press", key, repeat: false },
	};
}

function paste<TAction extends Keybinding>(action: TAction, text: string): MvuEnvelope {
	return {
		_tag: "MvuInput",
		action,
		event: { _tag: "Paste", text },
	};
}


async function mountSelector(
	rows: readonly Row[],
	onRenderRow: () => void,
	onFilterChanged?: (query: string) => readonly Row[] | Promise<readonly Row[]>,
): Promise<SelectorHarness> {
	const surface = new SelectorSurface<string, Row>({
		componentId: makeComponentId("mvu-test-backend-selector"),
		items: rows,
		keyOf: row => row.id,
		searchText: row => row.label,
		renderRow: (row, context) => {
			onRenderRow();
			return [`${context.selected ? ">" : " "}${row.label}`];
		},
		viewportSize: 6,
		...(onFilterChanged === undefined
			? {}
			: {
					onFilterChanged: (query: string) => onFilterChanged(query),
					encodeItems: (items: readonly Row[]) => JSON.stringify(items),
					decodeItems: (encoded: string) => JSON.parse(encoded) as readonly Row[],
			  }),
	});
	const spec = surface.mountSpec;
	const scope = Scope.makeUnsafe("sequential");
	const mounted = await runIn(
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
	const backend = new MvuTestBackend(48, 6);
	backend.mount(surface);
	return { backend, runtime: mounted, scope };
}

async function dispatch(harness: SelectorHarness, envelope: MvuEnvelope): Promise<void> {
	await runIn(harness.scope, harness.runtime.dispatch(envelope));
	await runIn(harness.scope, Effect.sleep("10 millis"));
}

async function close(harness: SelectorHarness): Promise<void> {
	await Effect.runPromise(Scope.close(harness.scope, Exit.void));
}

describe("MvuTestBackend", () => {
	it("drives open, move, filter, and Esc through the runtime and preserves the draft row", async () => {
		const rows = [
			{ id: "draft", label: "Draft (unchanged)" },
			{ id: "alpha", label: "Alpha" },
			{ id: "beta", label: "Beta" },
		] as const;
		let rowRenders = 0;
		const harness = await mountSelector(rows, () => {
			rowRenders += 1;
		});

		let rendered = lines(harness.backend.render()).join("\n");
		expect(rendered).toContain(">Draft (unchanged)");
		expect(rowRenders).toBe(3);

		await dispatch(harness, press("tui.select.down", Key.down));
		rendered = lines(harness.backend.render()).join("\n");
		expect(rendered).toContain(">Alpha");
		expect(rowRenders).toBe(5);

		await dispatch(harness, press("app.selector.filter", Key.slash));
		await dispatch(harness, paste("app.selector.filterAppend", "be"));
		rendered = lines(harness.backend.render()).join("\n");
		expect(rendered).toContain(">Beta");
		expect(rendered).not.toContain("Alpha");

		await dispatch(harness, press("ui.dismiss", Key.escape));
		rendered = lines(harness.backend.render()).join("\n");
		expect(rendered).toContain("Draft (unchanged)");
		expect(rendered).toContain(">Beta");
		await close(harness);
	});

	it("keeps a superseded source result and its selection receipt invisible", async () => {
		const first = Promise.withResolvers<readonly Row[]>();
		const second = Promise.withResolvers<readonly Row[]>();
		let request = 0;
		const harness = await mountSelector(
			[
				{ id: "alpha", label: "Alpha" },
				{ id: "beta", label: "Beta" },
			],
			() => {},
			() => (++request === 1 ? first.promise : second.promise),
		);
		harness.backend.render();
		await dispatch(harness, press("app.selector.filter", Key.slash));
		await dispatch(harness, paste("app.selector.filterAppend", "b"));
		await dispatch(harness, paste("app.selector.filterAppend", "e"));

		second.resolve([{ id: "beta", label: "Beta newest" }]);
		await runIn(harness.scope, Effect.sleep("20 millis"));
		first.resolve([{ id: "alpha", label: "Alpha stale" }]);
		await runIn(harness.scope, Effect.sleep("20 millis"));

		const rendered = lines(harness.backend.render()).join("\n");
		expect(rendered).toContain(">Beta newest");
		expect(rendered).not.toContain("Alpha stale");
		const model = await runIn(harness.scope, SubscriptionRef.get(harness.runtime.model));
		expect(model.selector.selectedId).toBe("beta");
		expect(model.selector.receipt._tag).toBe("None");
		await close(harness);
	});
});
