import { afterEach, beforeAll, describe, expect, it, vi } from "bun:test";
import { KeybindingsManager } from "@oh-my-pi/pi-coding-agent/config/keybindings";
import {
	TablePreviewComponent,
	type TablePreviewSession,
} from "@oh-my-pi/pi-coding-agent/modes/components/table-preview";
import { initTheme } from "@oh-my-pi/pi-coding-agent/modes/theme/theme";
import { setKeybindings } from "@oh-my-pi/pi-tui";
import { Effect, Exit, Scope } from "effect";

interface Row {
	id: string;
	label: string;
}

beforeAll(() => {
	initTheme();
});

afterEach(() => {
	setKeybindings(KeybindingsManager.inMemory());
	vi.useRealTimers();
});

describe("TablePreviewComponent", () => {
	it("keeps keyed selection through a flushed refresh, updates preview on navigation, and dismisses via ui.dismiss", async () => {
		setKeybindings(
			KeybindingsManager.inMemory({
				"tui.select.down": "ctrl+n",
				"ui.dismiss": "ctrl+g",
			}),
		);
		let rows: readonly Row[] = [
			{ id: "alpha", label: "Alpha" },
			{ id: "beta", label: "Beta" },
		];
		let pendingRows: readonly Row[] | undefined;
		let flushCount = 0;
		let closeCount = 0;
		const opened: string[] = [];
		const disposed: string[] = [];
		const scope = Scope.makeUnsafe("sequential");
		const component = await Effect.runPromise(
			Scope.provide(scope)(
				TablePreviewComponent.mount<Row, string>({
					rows: () => rows,
					keyOf: row => row.id,
					searchText: row => row.label,
					renderRow: row => row.label,
					preview: {
						open: row => {
							opened.push(row.id);
							return {
								render: () => [`Preview ${row.label}`],
								dispose: () => {
									disposed.push(row.id);
								},
							};
						},
					},
					height: () => 8,
					requestRender: () => {},
					onClose: () => {
						closeCount += 1;
					},
					flush: () => {
						flushCount += 1;
						if (pendingRows) {
							rows = pendingRows;
							pendingRows = undefined;
						}
					},
					layout: "columns",
				}),
			),
		);

		expect(component.selectedKey).toBe("alpha");
		component.handleInput("\x0e");
		expect(component.selectedKey).toBe("beta");
		expect(opened).toEqual(["alpha", "beta"]);
		expect(disposed).toEqual(["alpha"]);
		expect(component.render(60).join("\n")).toContain("Preview Beta");

		pendingRows = [
			{ id: "beta", label: "Beta refreshed" },
			{ id: "alpha", label: "Alpha refreshed" },
		];
		component.render(60);
		expect(flushCount).toBeGreaterThan(0);
		expect(component.selectedKey).toBe("beta");
		expect(opened.at(-1)).toBe("beta");
		expect(component.render(60).join("\n")).toContain("Preview Beta refreshed");

		component.handleInput("x");
		expect(component.searchQuery).toBe("x");
		component.handleInput("\x07");
		expect(component.searchQuery).toBe("");
		expect(closeCount).toBe(0);
		component.handleInput("\x07");
		expect(closeCount).toBe(1);

		await Effect.runPromise(Scope.close(scope, Exit.void));
	});

	it("runs preview and provider finalizers when its mount Scope closes", async () => {
		vi.useFakeTimers();
		let ticks = 0;
		let sessionDisposed = false;
		let providerDisposed = false;
		const scope = Scope.makeUnsafe("sequential");
		const component = await Effect.runPromise(
			Scope.provide(scope)(
				TablePreviewComponent.mount<Row, string>({
					rows: () => [{ id: "timer", label: "Timer" }],
					keyOf: row => row.id,
					renderRow: row => row.label,
					preview: {
						open: () => {
							const timer = setInterval(() => {
								ticks += 1;
							}, 2);
							const session: TablePreviewSession = {
								render: () => ["timer preview"],
								dispose: () => {
									clearInterval(timer);
									sessionDisposed = true;
								},
							};
							return session;
						},
						dispose: () => {
							providerDisposed = true;
						},
					},
					height: () => 6,
					requestRender: () => {},
					onClose: () => {},
				}),
			),
		);

		component.render(40);
		vi.advanceTimersByTime(12);
		expect(ticks).toBeGreaterThan(0);
		await Effect.runPromise(Scope.close(scope, Exit.void));
		const ticksAfterClose = ticks;
		vi.advanceTimersByTime(12);
		expect(ticks).toBe(ticksAfterClose);
		expect(sessionDisposed).toBe(true);
		expect(providerDisposed).toBe(true);
	});
});
