import { beforeAll, describe, expect, it } from "bun:test";
import { TablePreviewComponent, type TablePreviewPatch } from "@oh-my-pi/pi-coding-agent/modes/components/table-preview";
import { initTheme } from "@oh-my-pi/pi-coding-agent/modes/theme/theme";
import { Effect, Exit, Scope } from "effect";

interface Row {
	readonly id: string;
	readonly label: string;
}

function makePatch(
	rows: readonly Row[],
	selectedKey: string | undefined,
	preview: string,
	dirtyKeys: ReadonlySet<string>,
): TablePreviewPatch<Row, string, string> {
	return {
		visibleRows: rows.map(row => ({ key: row.id, row })),
		selectedKey,
		focus: "table",
		preview: { revision: preview, value: preview },
		dirtyKeys,
	};
}

beforeAll(() => {
	initTheme();
});

describe("TablePreviewComponent", () => {
	it("renders committed patches and refreshes keyed rows without owning selection or input", async () => {
		const scope = Scope.makeUnsafe("sequential");
		let requestedRoot: TablePreviewComponent<Row, string, string> | undefined;
		let renderedRows = 0;
		let component!: TablePreviewComponent<Row, string, string>;
		component = await Effect.runPromise(
			Scope.provide(scope)(
				TablePreviewComponent.mount<Row, string, string>({
					renderRow: (row, context) => {
						renderedRows += 1;
						return `${context.selected ? ">" : " "}${row.label}`;
					},
					renderPreview: preview => [`Preview ${preview}`],
					height: () => 6,
					requestComponentRender: () => {
						requestedRoot = component;
					},
					layout: "columns",
				}),
			),
		);
		const alpha = { id: "alpha", label: "Alpha" };
		const beta = { id: "beta", label: "Beta" };
		component.apply(makePatch([alpha, beta], "alpha", "Alpha", new Set(["alpha", "beta"])));
		expect(requestedRoot).toBe(component);
		let rendered = component.render(60).join("\n");
		expect(rendered).toContain(">Alpha");
		expect(rendered).toContain("Preview Alpha");
		expect(renderedRows).toBe(2);

		const refreshedBeta = { id: "beta", label: "Beta refreshed" };
		component.apply(makePatch([alpha, refreshedBeta], "beta", "Beta refreshed", new Set(["alpha", "beta"])));
		expect(requestedRoot).toBe(component);
		rendered = component.render(60).join("\n");
		expect(rendered).toContain(">Beta refreshed");
		expect(rendered).toContain("Preview Beta refreshed");
		expect(renderedRows).toBe(4);

		await Effect.runPromise(Scope.close(scope, Exit.void));
	});

	it("finalizes renderer resources when its mount Scope closes", async () => {
		let disposed = false;
		const scope = Scope.makeUnsafe("sequential");
		const component = await Effect.runPromise(
			Scope.provide(scope)(
				TablePreviewComponent.mount<Row, string, string>({
					renderRow: row => row.label,
					renderPreview: preview => [preview],
					height: () => 6,
					requestComponentRender: () => {},
					dispose: () => {
						disposed = true;
					},
				}),
			),
		);

		component.apply(makePatch([{ id: "timer", label: "Timer" }], "timer", "Timer preview", new Set(["timer"])));
		expect(component.render(40).join("\n")).toContain("Timer preview");
		expect(disposed).toBe(false);
		await Effect.runPromise(Scope.close(scope, Exit.void));
		expect(disposed).toBe(true);
	});


	it("invalidates a mutable preview resource only through its immutable descriptor revision", async () => {
		const scope = Scope.makeUnsafe("sequential");
		const preview = { line: "first" };
		let previewRenders = 0;
		const component = await Effect.runPromise(
			Scope.provide(scope)(
				TablePreviewComponent.mount<Row, string, typeof preview>({
					renderRow: row => row.label,
					renderPreview: value => {
						previewRenders += 1;
						return [value.line];
					},
					height: () => 4,
					requestComponentRender: () => {},
				}),
			),
		);
		const rows = [{ id: "row", label: "Row" }];
		const base = {
			visibleRows: rows.map(row => ({ key: row.id, row })),
			selectedKey: "row",
			focus: "table" as const,
			dirtyKeys: new Set<string>(),
		};
		component.apply({ ...base, preview: { revision: 1, value: preview } });
		expect(component.render(40).join("\n")).toContain("first");
		preview.line = "second";
		component.apply({ ...base, preview: { revision: 1, value: preview } });
		expect(component.render(40).join("\n")).toContain("first");
		expect(previewRenders).toBe(1);
		component.apply({ ...base, preview: { revision: 2, value: preview } });
		expect(component.render(40).join("\n")).toContain("second");
		expect(previewRenders).toBe(2);
		await Effect.runPromise(Scope.close(scope, Exit.void));
	});
});
