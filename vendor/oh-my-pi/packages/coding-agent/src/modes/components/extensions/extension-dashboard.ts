import {
	Container,
	type Component,
	Spacer,
	Text,
	wrapTextWithAnsi,
} from "@oh-my-pi/pi-tui";
import { Effect, Exit, Scope } from "effect";
import { Settings } from "../../../config/settings";
import { DynamicBorder } from "../../../modes/components/dynamic-border";
import { keyHint } from "../../../modes/components/keybinding-hints";
import { theme } from "../../../modes/theme/theme";
import { renderExtensionListRow, type ExtensionListRow } from "./extension-list";
import { InspectorPanel, type InspectorProjection } from "./inspector-panel";
import {
	createExtensionDashboardModel,
	projectExtensionRows,
	reduceExtensionDashboard,
	type ExtensionDashboardModel,
	type ExtensionProjectionRow,
} from "./state-manager";
import { makeComponentId } from "../../mvu/schema";
import { TablePreviewComponent } from "../table-preview";

const EXT_FOOTER_PREFIX = " ↑/↓: navigate  Enter: preview  Space: toggle  ←/→: provider  ";

export const EXTENSION_DASHBOARD_ROUTE = {
	componentId: makeComponentId("extension-dashboard"),
	context: "selector.global",
	makeInitialModel: createExtensionDashboardModel,
	update: reduceExtensionDashboard,
	actions: {
		"app.navigation.up": "Move",
		"app.navigation.down": "Move",
		"tui.select.confirm": "Activate",
		"app.selector.preview": "ToggleSelected",
		"app.selector.sourcePrevious": "ProviderMove",
		"app.selector.sourceNext": "ProviderMove",
		"ui.dismiss": "Back",
	},
} as const;

/** MVU route adapter for extension inventory, provider actions, and inspector projection. */
export class ExtensionDashboard extends Container {
	#model!: ExtensionDashboardModel;
	#table!: TablePreviewComponent<ExtensionListRow, string, InspectorProjection>;
	readonly #inspectorRenderer = new InspectorPanel();
	readonly #scope = Scope.makeUnsafe("sequential");
	#builtRows = -1;
	#builtCols = -1;
	#disposed = false;
	#committedRender: readonly string[] | undefined;

	onRequestComponentRender?: (component: Component) => void;

	private constructor(
		private readonly cwd: string,
		private readonly settings: Settings | null,
		private readonly terminalHeight: number,
	) {
		super();
	}

	static async create(
		cwd: string,
		settings: Settings | null = null,
		terminalHeight?: number,
	): Promise<ExtensionDashboard> {
		const dashboard = new ExtensionDashboard(cwd, settings, terminalHeight ?? process.stdout.rows ?? 24);
		await dashboard.#init();
		return dashboard;
	}

	static async fromModel(
		model: ExtensionDashboardModel,
		settings: Settings | null = null,
		terminalHeight = 24,
	): Promise<ExtensionDashboard> {
		const dashboard = new ExtensionDashboard("", settings, terminalHeight);
		await dashboard.#mountModel(model);
		return dashboard;
	}


	async #init(): Promise<void> {
		const settings = this.settings ?? (await Settings.init());
		const disabledIds = (settings.get("disabledExtensions") as string[] | undefined) ?? [];
		await this.#mountModel(await createExtensionDashboardModel(this.cwd, disabledIds));
	}

	async #mountModel(model: ExtensionDashboardModel): Promise<void> {
		this.#model = model;
		this.#table = await Effect.runPromise(
			Scope.provide(this.#scope)(
				TablePreviewComponent.mount<ExtensionListRow, string, InspectorProjection>({
					renderRow: (row, context) =>
						renderExtensionListRow(
							row,
							context.selected,
							context.width,
							this.#model.activeTabId === "all" ? undefined : this.#model.activeTabId,
						),
					renderPreview: (projection, width) => this.#inspectorRenderer.renderProjection(projection, width),
					height: () => this.#computeBodyHeight(),
					requestComponentRender: () => this.onRequestComponentRender?.(this),
					layout: "columns",
					tableRatio: 0.55,
					emptyMessage: "No extensions found for this provider.",
					previewEmptyMessage: "Select an extension to inspect it",
				}),
			),
		);
		this.#applyProjection();
		this.#buildLayout();
	}

	get initialModel(): ExtensionDashboardModel {
		return this.#model;
	}

	/** Applies one model committed by the route runtime. */
	apply(model: ExtensionDashboardModel): void {
		if (this.#disposed) return;
		this.#model = model;
		this.#applyProjection();
		this.#buildLayout();
		this.onRequestComponentRender?.(this);
	}

	/** Live terminal height so the dashboard tracks resize while open. */
	#terminalRows(): number {
		return process.stdout.rows || this.terminalHeight || 24;
	}

	#uiWidth(): number {
		return Math.max(20, process.stdout.columns || 80);
	}

	#footer(): string {
		return theme.fg("dim", EXT_FOOTER_PREFIX) + keyHint("ui.dismiss", "close");
	}

	#footerLines(): number {
		return Math.max(1, wrapTextWithAnsi(this.#footer(), this.#uiWidth()).length);
	}

	#computeBodyHeight(): number {
		const chrome = 4 + 1 + this.#footerLines() + 1;
		return Math.max(5, this.#terminalRows() - chrome);
	}

	#maxVisibleItems(): number {
		return Math.max(3, this.#computeBodyHeight() - 3);
	}

	override render(width: number): readonly string[] {
		if (this.#disposed && this.#committedRender !== undefined) return this.#committedRender;
		if (this.#terminalRows() !== this.#builtRows || this.#uiWidth() !== this.#builtCols) this.#buildLayout();
		const lines = super.render(width);
		const rows = this.#terminalRows();
		if (lines.length >= rows) {
			this.#committedRender = lines;
			return lines;
		}
		const padded = lines.slice();
		while (padded.length < rows) padded.push("");
		this.#committedRender = padded;
		return padded;
	}

	#buildLayout(): void {
		this.clear();
		this.addChild(new DynamicBorder());
		this.addChild(new Text(theme.bold(theme.fg("accent", " Extension Control Center")), 0, 0));
		this.addChild(new Text(this.#renderTabBar(), 0, 0));
		this.addChild(new Spacer(1));
		if (this.#model.loadState === "Failed") {
			this.addChild(new Text(theme.fg("error", `Refresh failed: ${this.#model.loadError ?? "Unknown error"}`), 0, 0));
		} else {
			this.addChild(this.#table);
		}
		this.addChild(new Spacer(1));
		this.addChild(new Text(this.#footer(), 0, 0));
		this.addChild(new DynamicBorder());
		this.#builtRows = this.#terminalRows();
		this.#builtCols = this.#uiWidth();
	}

	#renderTabBar(): string {
		return [" ", ...this.#model.tabs.map((tab, index) => {
			const active = tab.id === this.#model.activeTabId;
			const label = `${tab.label}${tab.count > 0 ? ` (${tab.count})` : ""}`;
			const display = !tab.enabled && tab.id !== "all" ? `${theme.status.disabled} ${label}` : label;
			if (active) return theme.bg("selectedBg", ` ${display} `);
			if (!tab.enabled || (tab.count === 0 && tab.id !== "all")) return theme.fg("dim", ` ${display} `);
			return theme.fg("muted", ` ${label} `);
		})].join("");
	}

	#applyProjection(): void {
		if (!this.#table) return;
		const allRows = projectExtensionRows(this.#model);
		const maxVisible = this.#maxVisibleItems();
		const start = Math.max(0, Math.min(this.#model.viewportOffset, allRows.length));
		const visibleRows = allRows.slice(start, start + maxVisible).map(row => {
			const rendered = this.#toListRow(row);
			return { key: rendered.key, row: rendered };
		});
		const selected = this.#model.selectedKey?.startsWith("provider:")
			? null
			: this.#model.extensions.find(extension => extension.id === this.#model.selectedKey) ?? null;
		this.#table.apply({
			visibleRows,
			selectedKey: this.#model.selectedKey,
			focus: this.#model.mode === "PreviewFocus" ? "preview" : "table",
			query: this.#model.query,
			preview: {
				revision: this.#model.sourceRevision,
				value: { extension: selected },
			},
			dirtyKeys: new Set(visibleRows.map(row => row.key)),
		});
	}

	#toListRow(row: ExtensionProjectionRow): ExtensionListRow {
		switch (row._tag) {
			case "Master":
				return {
					_tag: "Master",
					key: row.key,
					providerId: row.providerId ?? this.#model.activeTabId,
					providerName: row.providerName ?? this.#model.activeTabId,
					enabled: row.enabled ?? false,
				};
			case "Kind":
				return {
					_tag: "Kind",
					key: row.key,
					kind: row.kind!,
					label: row.label ?? row.kind!,
					icon: row.icon ?? "•",
					count: row.count ?? 0,
				};
			case "Extension":
				return { _tag: "Extension", key: row.key, extension: row.extension! };
		}
	}



	async dispose(): Promise<void> {
		if (this.#disposed) return;
		this.#committedRender ??= this.render(this.#uiWidth());
		this.#disposed = true;
		await Effect.runPromise(Scope.close(this.#scope, Exit.void));
	}
}

