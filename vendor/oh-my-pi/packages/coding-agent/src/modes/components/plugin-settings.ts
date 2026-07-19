/**
 * Plugin settings UI components.
 *
 * Provides a hierarchical settings interface:
 * - Plugin list (npm plugins + marketplace plugins)
 *   - npm plugin detail (enable/disable, features, config)
 *   - Marketplace plugin detail (enable/disable + read-only metadata)
 *     - Feature toggles
 *     - Config value editor
 */
import {
	Container,
	Input,
	type SelectItem,
	SelectList,
	type SettingItem,
	SettingsList,
	type SgrMouseEvent,
	Spacer,
	Text,
} from "@oh-my-pi/pi-tui";
import { logger } from "@oh-my-pi/pi-utils";
import { clearPluginRootsAndCaches, resolveOrDefaultProjectRegistryPath } from "../../discovery/helpers";
import { PluginManager } from "../../extensibility/plugins/manager";
import type { InstalledPluginSummary } from "../../extensibility/plugins/marketplace";
import {
	getInstalledPluginsRegistryPath,
	getMarketplacesCacheDir,
	getMarketplacesRegistryPath,
	getPluginsCacheDir,
	MarketplaceManager,
} from "../../extensibility/plugins/marketplace";
import type { InstalledPlugin, PluginSettingSchema } from "../../extensibility/plugins/types";
import { getSelectListTheme, getSettingsListTheme, theme } from "../../modes/theme/theme";
import { matchesSelectCancel, matchesUiDismiss } from "../../modes/utils/keybinding-matchers";
import { shortenPath } from "../../tools/render-utils";
import { DynamicBorder } from "./dynamic-border";
import { keyHint, rawKeyHint } from "./keybinding-hints";
import type { ModalActionStamp } from "../mvu/modal";
import { makeComponentId, type KeyEvent } from "../mvu/schema";
import { noneReceipt, type ReceiptState } from "../mvu/status";

export interface ModalDepthFrame<Region extends string, Layer> {
	readonly layer: Layer;
	readonly returnRegion: Region;
	readonly returnFocusIndex: number;
}

export interface SurfaceModalModel<Region extends string, Layer> {
	readonly region: Region;
	readonly depth: readonly ModalDepthFrame<Region, Layer>[];
	readonly focusIndex: number;
}

export type SurfaceModalMsg<Region extends string, Layer> =
	| { readonly _tag: "SetRegion"; readonly region: Region; readonly focusIndex?: number }
	| { readonly _tag: "FocusNext"; readonly count: number }
	| { readonly _tag: "FocusPrevious"; readonly count: number }
	| { readonly _tag: "Push"; readonly layer: Layer; readonly region: Region }
	| { readonly _tag: "Back" }
	| { readonly _tag: "Close" };

export type SurfaceModalCommand = { readonly _tag: "CloseRequested" };

export interface SurfaceModalTransition<Region extends string, Layer> {
	readonly model: SurfaceModalModel<Region, Layer>;
	readonly commands: readonly SurfaceModalCommand[];
}

export function makeSurfaceModalModel<Region extends string, Layer>(
	region: Region,
	focusIndex = 0,
): SurfaceModalModel<Region, Layer> {
	return { region, depth: [], focusIndex };
}

/** Pure nested-modal reducer shared by the production modal adapters below. */
export function updateSurfaceModal<Region extends string, Layer>(
	model: SurfaceModalModel<Region, Layer>,
	msg: SurfaceModalMsg<Region, Layer>,
): SurfaceModalTransition<Region, Layer> {
	switch (msg._tag) {
		case "SetRegion":
			return { model: { ...model, region: msg.region, focusIndex: msg.focusIndex ?? 0 }, commands: [] };
		case "FocusNext": {
			const count = Math.max(1, msg.count);
			return { model: { ...model, focusIndex: (model.focusIndex + 1) % count }, commands: [] };
		}
		case "FocusPrevious": {
			const count = Math.max(1, msg.count);
			return { model: { ...model, focusIndex: (model.focusIndex - 1 + count) % count }, commands: [] };
		}
		case "Push":
			return {
				model: {
					region: msg.region,
					focusIndex: 0,
					depth: [
						...model.depth,
						{ layer: msg.layer, returnRegion: model.region, returnFocusIndex: model.focusIndex },
					],
				},
				commands: [],
			};
		case "Back": {
			const frame = model.depth.at(-1);
			if (!frame) return { model, commands: [{ _tag: "CloseRequested" }] };
			return {
				model: {
					region: frame.returnRegion,
					focusIndex: frame.returnFocusIndex,
					depth: model.depth.slice(0, -1),
				},
				commands: [],
			};
		}
		case "Close":
			return { model, commands: [{ _tag: "CloseRequested" }] };
	}
}

/**
 * Forwards a keystroke to `input`, but cancels via the configured modal dismissal key.
 */
export function handleInputOrDismiss(
	data: string,
	input: { handleInput(data: string): void },
	onCancel: () => void,
): void {
	if (matchesUiDismiss(data)) {
		onCancel();
		return;
	}
	input.handleInput(data);
}

// =============================================================================
// Plugin List Component
// =============================================================================

/**
 * One row in the unified plugin list. npm and marketplace plugins live in
 * separate registries with different shapes, so a tagged union keeps both
 * paths type-safe end-to-end (list rendering, value lookup, detail callback).
 */
export type PluginListEntry =
	| { kind: "npm"; plugin: InstalledPlugin }
	| { kind: "marketplace"; plugin: InstalledPluginSummary };

export interface PluginListCallbacks {
	onNpmSelect: (plugin: InstalledPlugin) => void;
	onMarketplaceSelect: (plugin: InstalledPluginSummary) => void;
	onCancel: () => void;
}

/**
 * True when the marketplace summary's first entry is not explicitly disabled.
 * Mirrors the `/plugins list` convention: a missing `enabled` flag means enabled.
 */
function marketplaceEnabled(summary: InstalledPluginSummary): boolean {
	return summary.entries[0]?.enabled !== false;
}

/**
 * Stable SelectList value for a list entry. Combined with `findEntryByValue`
 * this keeps lookup correct even when the same plugin id exists in both user
 * and project scope (one of which is `shadowedBy: "project"`).
 */
function entryValue(entry: PluginListEntry): string {
	if (entry.kind === "npm") return `npm:${entry.plugin.name}`;
	return `mkt:${entry.plugin.scope}:${entry.plugin.id}`;
}

function findEntryByValue(entries: ReadonlyArray<PluginListEntry>, value: string): PluginListEntry | undefined {
	return entries.find(e => entryValue(e) === value);
}

/**
 * Shows installed plugins from both registries (npm + marketplace) with
 * enable/disable status, scope tag, and shadow indicator. Selecting an entry
 * fans out to the kind-specific detail callback.
 */
export class PluginListComponent extends Container {
	readonly #selectList: SelectList;

	constructor(
		private readonly entries: ReadonlyArray<PluginListEntry>,
		private readonly callbacks: PluginListCallbacks,
	) {
		super();

		// Title
		this.addChild(new DynamicBorder());
		this.addChild(new Text(theme.bold(theme.fg("accent", "  Plugins")), 0, 0));
		this.addChild(new Spacer(1));

		if (entries.length === 0) {
			this.addChild(new Text(theme.fg("muted", "  No plugins installed"), 0, 0));
			this.addChild(new Spacer(1));
			this.addChild(new Text(theme.fg("dim", "  Install npm plugins:        omp plugin install <package>"), 0, 0));
			this.addChild(
				new Text(theme.fg("dim", "  Install marketplace plugins: omp plugin install <name>@<marketplace>"), 0, 0),
			);
			this.addChild(new Spacer(1));
			this.addChild(new DynamicBorder());

			// Empty list still accepts the modal dismissal action so the user can leave the panel.
			this.#selectList = new SelectList([], 1, getSelectListTheme());
			return;
		}

		const items: SelectItem[] = entries.map(entry => this.#renderItem(entry));

		// Marketplace plugin ids (`name@marketplace`) routinely run past the
		// SelectList default primary column (32 chars). Widen the bound so the
		// id remains readable; the description gets whatever width is left.
		this.#selectList = new SelectList(items, Math.min(items.length, 8), getSelectListTheme(), {
			minPrimaryColumnWidth: 24,
			maxPrimaryColumnWidth: 64,
		});

		this.#selectList.onSelect = item => {
			const found = findEntryByValue(this.entries, item.value);
			if (!found) return;
			if (found.kind === "npm") callbacks.onNpmSelect(found.plugin);
			else callbacks.onMarketplaceSelect(found.plugin);
		};

		this.addChild(this.#selectList);
		this.addChild(new Spacer(1));
		const hint = [rawKeyHint("enter", "configure"), keyHint("ui.dismiss", "go back")].join(theme.fg("dim", " · "));
		this.addChild(new Text(`  ${hint}`, 0, 0));
		this.addChild(new DynamicBorder());
	}

	#renderItem(entry: PluginListEntry): SelectItem {
		const kindBadge = theme.fg("dim", entry.kind === "npm" ? "[npm]" : "[marketplace]");

		if (entry.kind === "npm") {
			const p = entry.plugin;
			const status = p.enabled
				? theme.fg("success", theme.status.enabled)
				: theme.fg("muted", theme.status.disabled);
			const featureCount = p.manifest.features ? Object.keys(p.manifest.features).length : 0;
			const enabledCount = p.enabledFeatures?.length ?? featureCount;

			let details = `${kindBadge} ${theme.sep.dot} v${p.version}`;
			if (featureCount > 0) {
				details += ` ${theme.sep.dot} ${enabledCount}/${featureCount} features`;
			}

			return {
				value: entryValue(entry),
				label: `${status} ${p.name}`,
				description: details,
			};
		}

		const summary = entry.plugin;
		const enabled = marketplaceEnabled(summary);
		const status = enabled ? theme.fg("success", theme.status.enabled) : theme.fg("muted", theme.status.disabled);
		const scopeTag = theme.fg("dim", `[${summary.scope}]`);
		const shadowMarker = summary.shadowedBy ? ` ${theme.fg("warning", theme.status.shadowed)}` : "";
		const version = summary.entries[0]?.version ?? "?";

		let details = `${kindBadge} ${scopeTag} ${theme.sep.dot} v${version}`;
		if (summary.shadowedBy) {
			details += ` ${theme.sep.dot} shadowed by ${summary.shadowedBy}`;
		}

		return {
			value: entryValue(entry),
			label: `${status} ${summary.id}${shadowMarker}`,
			description: details,
		};
	}

	handleInput(data: string): void {
		if (matchesUiDismiss(data)) {
			this.callbacks.onCancel();
			return;
		}
		// SelectList's generic cancel binding must not bypass a disabled/remapped ui.dismiss.
		if (matchesSelectCancel(data)) return;
		this.#selectList.handleInput(data);
	}

	setSelectedIndex(index: number): void {
		this.#selectList.setSelectedIndex(index);
	}

	/** Resolve a line in this component to the committed entry index. */
	hitTest(line: number): number | undefined {
		return this.#selectList.hitTest(line - 3);
	}
}

// =============================================================================
// Plugin Detail Component
// =============================================================================

export interface PluginDetailCallbacks {
	onEnabledChange: (enabled: boolean) => void;
	onFeatureChange: (feature: string, enabled: boolean) => void;
	onConfigChange: (key: string, value: unknown) => void;
	onBack: () => void;
}

/**
 * Shows detail settings for a single plugin:
 * - Enable/disable toggle
 * - Feature toggles
 * - Config settings
 */
export class PluginDetailComponent extends Container {
	#settingsList!: SettingsList;

	constructor(
		private plugin: InstalledPlugin,
		private readonly manager: PluginManager,
		private readonly callbacks: PluginDetailCallbacks,
	) {
		super();

		void this.#rebuild();
	}

	async #rebuild(): Promise<void> {
		this.clear();

		const plugin = this.plugin;
		const manifest = plugin.manifest;

		// Header
		this.addChild(new DynamicBorder());
		this.addChild(new Text(theme.bold(theme.fg("accent", `  ${plugin.name}`)), 0, 0));
		if (manifest.description) {
			this.addChild(new Text(theme.fg("muted", `  ${manifest.description}`), 0, 0));
		}
		this.addChild(new Spacer(1));

		const items: SettingItem[] = [];

		// Enable/disable toggle
		items.push({
			id: "__enabled__",
			label: "Enabled",
			description: "Enable or disable this plugin",
			currentValue: plugin.enabled ? "true" : "false",
			values: ["true", "false"],
		});

		// Feature toggles
		if (manifest.features && Object.keys(manifest.features).length > 0) {
			const enabledSet = new Set(plugin.enabledFeatures ?? []);
			const defaultFeatures = Object.entries(manifest.features)
				.filter(([_, f]) => f.default)
				.map(([name]) => name);

			// If enabledFeatures is null, use defaults
			const effectiveEnabled = plugin.enabledFeatures === null ? new Set(defaultFeatures) : enabledSet;

			for (const [featName, feat] of Object.entries(manifest.features)) {
				const isEnabled = effectiveEnabled.has(featName);
				items.push({
					id: `feature:${featName}`,
					label: `  ${featName}`,
					description: feat.description || `Enable ${featName} feature`,
					currentValue: isEnabled ? "true" : "false",
					values: ["true", "false"],
				});
			}
		}

		// Config settings
		if (manifest.settings && Object.keys(manifest.settings).length > 0) {
			const settings = await this.manager.getPluginSettings(plugin.name);

			for (const [key, schema] of Object.entries(manifest.settings)) {
				const currentValue = settings[key] ?? schema.default;
				const displayValue = schema.secret && currentValue ? "••••••••" : String(currentValue ?? "(not set)");

				if (schema.type === "boolean") {
					items.push({
						id: `config:${key}`,
						label: `  ${key}`,
						description: schema.description || `Configure ${key}`,
						currentValue: currentValue ? "true" : "false",
						values: ["true", "false"],
					});
				} else if (schema.type === "enum") {
					items.push({
						id: `config:${key}`,
						label: `  ${key}`,
						description: schema.description || `Configure ${key}`,
						currentValue: String(currentValue ?? schema.default ?? ""),
						submenu: (cv, done) =>
							new ConfigEnumSubmenu(
								key,
								schema.description || `Select value for ${key}`,
								schema.values,
								cv,
								value => {
									this.callbacks.onConfigChange(key, value);
									done(value);
								},
								() => done(),
							),
					});
				} else {
					// string or number - show as submenu with input
					items.push({
						id: `config:${key}`,
						label: `  ${key}`,
						description: schema.description || `Configure ${key}`,
						currentValue: displayValue,
						submenu: (cv, done) =>
							new ConfigInputSubmenu(
								key,
								schema,
								cv === "(not set)" ? "" : cv,
								value => {
									const parsed = schema.type === "number" ? Number(value) : value;
									this.callbacks.onConfigChange(key, parsed);
									done(String(value));
								},
								() => done(),
							),
					});
				}
			}
		}

		this.#settingsList = new SettingsList(
			items,
			Math.min(items.length, 10),
			getSettingsListTheme(),
			(id, newValue) => {
				if (id === "__enabled__") {
					this.callbacks.onEnabledChange(newValue === "true");
					this.plugin = { ...this.plugin, enabled: newValue === "true" };
				} else if (id.startsWith("feature:")) {
					const featName = id.slice(8);
					this.callbacks.onFeatureChange(featName, newValue === "true");
					// Update local state
					const current = new Set(this.plugin.enabledFeatures ?? []);
					if (newValue === "true") {
						current.add(featName);
					} else {
						current.delete(featName);
					}
					this.plugin = { ...this.plugin, enabledFeatures: [...current] };
				} else if (id.startsWith("config:")) {
					const key = id.slice(7);
					const schema = this.plugin.manifest.settings?.[key];
					if (schema?.type === "boolean") {
						this.callbacks.onConfigChange(key, newValue === "true");
					}
				}
			},
			this.callbacks.onBack,
		);

		this.addChild(this.#settingsList);
		this.addChild(new Spacer(1));
		const hint = [rawKeyHint("enter", "edit"), keyHint("ui.dismiss", "go back")].join(theme.fg("dim", " · "));
		this.addChild(new Text(`  ${hint}`, 0, 0));
		this.addChild(new DynamicBorder());
	}

	handleInput(data: string): void {
		if (!this.#settingsList) return;
		if (matchesUiDismiss(data)) {
			if (this.#settingsList.hasOpenSubmenu()) this.#settingsList.handleInput(data);
			else this.callbacks.onBack();
			return;
		}
		if (matchesSelectCancel(data)) return;
		this.#settingsList.handleInput(data);
	}
}

// =============================================================================
// Marketplace Plugin Detail Component
// =============================================================================

export interface MarketplacePluginDetailCallbacks {
	onEnabledChange: (enabled: boolean) => void;
	onBack: () => void;
}

/**
 * Detail view for a marketplace plugin. Marketplace plugins do not declare
 * features or settings, so the panel exposes a single enable/disable toggle
 * plus the read-only metadata from the installed-plugins registry.
 */
export class MarketplacePluginDetailComponent extends Container {
	#settingsList: SettingsList;

	constructor(
		private plugin: InstalledPluginSummary,
		private readonly callbacks: MarketplacePluginDetailCallbacks,
	) {
		super();

		const entry = plugin.entries[0];
		const enabled = marketplaceEnabled(plugin);

		// Header
		this.addChild(new DynamicBorder());
		this.addChild(new Text(theme.bold(theme.fg("accent", `  ${plugin.id}`)), 0, 0));

		const subtitleParts = [`[${plugin.scope}]`];
		if (plugin.shadowedBy) subtitleParts.push(`${theme.status.shadowed} shadowed by ${plugin.shadowedBy}`);
		this.addChild(new Text(theme.fg("muted", `  ${subtitleParts.join(" ")}`), 0, 0));
		this.addChild(new Spacer(1));

		const items: SettingItem[] = [
			{
				id: "__enabled__",
				label: "Enabled",
				description: "Enable or disable this marketplace plugin",
				currentValue: enabled ? "true" : "false",
				values: ["true", "false"],
			},
		];

		this.#settingsList = new SettingsList(
			items,
			items.length,
			getSettingsListTheme(),
			(id, newValue) => {
				if (id === "__enabled__") {
					const next = newValue === "true";
					this.callbacks.onEnabledChange(next);
					this.plugin = {
						...this.plugin,
						entries: this.plugin.entries.map(e => ({ ...e, enabled: next })),
					};
				}
			},
			this.callbacks.onBack,
		);

		this.addChild(this.#settingsList);
		this.addChild(new Spacer(1));

		// Read-only metadata. SettingsList rejects items without `values`/`submenu`,
		// so we render the metadata as plain text rows beneath the toggle.
		this.addChild(new Text(theme.fg("dim", `  version       ${entry?.version ?? "(unknown)"}`), 0, 0));
		this.addChild(new Text(theme.fg("dim", `  scope         ${plugin.scope}`), 0, 0));
		this.addChild(
			new Text(
				theme.fg("dim", `  install path  ${entry?.installPath ? shortenPath(entry.installPath) : "(unknown)"}`),
				0,
				0,
			),
		);
		this.addChild(new Text(theme.fg("dim", `  installed at  ${entry?.installedAt ?? "(unknown)"}`), 0, 0));
		this.addChild(new Text(theme.fg("dim", `  last updated  ${entry?.lastUpdated ?? "(unknown)"}`), 0, 0));
		if (entry?.gitCommitSha) {
			this.addChild(new Text(theme.fg("dim", `  git sha       ${entry.gitCommitSha}`), 0, 0));
		}

		this.addChild(new Spacer(1));
		const hint = [rawKeyHint("enter", "toggle"), keyHint("ui.dismiss", "go back")].join(theme.fg("dim", " · "));
		this.addChild(new Text(`  ${hint}`, 0, 0));
		this.addChild(new DynamicBorder());
	}

	handleInput(data: string): void {
		if (matchesUiDismiss(data)) {
			if (this.#settingsList.hasOpenSubmenu()) this.#settingsList.handleInput(data);
			else this.callbacks.onBack();
			return;
		}
		if (matchesSelectCancel(data)) return;
		this.#settingsList.handleInput(data);
	}
}

// =============================================================================
// Config Submenus
// =============================================================================

/**
 * Submenu for enum config values.
 */
class ConfigEnumSubmenu extends Container {
	#selectList: SelectList;
	readonly #listOffset: number;

	constructor(
		key: string,
		description: string,
		values: string[],
		currentValue: string,
		onSelect: (value: string) => void,
		private readonly onCancel: () => void,
	) {
		super();
		this.#listOffset = description.length > 0 ? 4 : 2;

		this.addChild(new Text(theme.bold(theme.fg("accent", key)), 0, 0));
		if (description) {
			this.addChild(new Spacer(1));
			this.addChild(new Text(theme.fg("muted", description), 0, 0));
		}
		this.addChild(new Spacer(1));

		const items: SelectItem[] = values.map(v => ({ value: v, label: v }));
		this.#selectList = new SelectList(items, Math.min(items.length, 8), getSelectListTheme());

		const currentIndex = values.indexOf(currentValue);
		if (currentIndex !== -1) {
			this.#selectList.setSelectedIndex(currentIndex);
		}

		this.#selectList.onSelect = item => onSelect(item.value);

		this.addChild(this.#selectList);
		this.addChild(new Spacer(1));
		const hint = [rawKeyHint("enter", "select"), keyHint("ui.dismiss", "cancel")].join(theme.fg("dim", " · "));
		this.addChild(new Text(`  ${hint}`, 0, 0));
	}

	handleInput(data: string): void {
		if (matchesUiDismiss(data)) {
			this.onCancel();
			return;
		}
		if (matchesSelectCancel(data)) return;
		this.#selectList.handleInput(data);
	}

	setSelectedIndex(index: number): void {
		this.#selectList.setSelectedIndex(index);
	}

	hitTest(line: number): number | undefined {
		return this.#selectList.hitTest(line - this.#listOffset);
	}
}

/**
 * Submenu for string/number config values with text input.
 */
class ConfigInputSubmenu extends Container {
	#input: Input;

	constructor(
		key: string,
		schema: PluginSettingSchema,
		currentValue: string,
		private readonly onSubmit: (value: string) => void,
		private readonly onCancel: () => void,
	) {
		super();

		this.addChild(new Text(theme.bold(theme.fg("accent", key)), 0, 0));
		if (schema.description) {
			this.addChild(new Spacer(1));
			this.addChild(new Text(theme.fg("muted", schema.description), 0, 0));
		}

		// Type hint
		let typeHint = `Type: ${schema.type}`;
		if (schema.type === "number") {
			const numSchema = schema as { min?: number; max?: number };
			if (numSchema.min !== undefined || numSchema.max !== undefined) {
				typeHint += ` (${numSchema.min ?? ""}..${numSchema.max ?? ""})`;
			}
		}
		this.addChild(new Spacer(1));
		this.addChild(new Text(theme.fg("dim", typeHint), 0, 0));

		this.addChild(new Spacer(1));

		// Input field
		this.#input = new Input();
		if (!schema.secret && currentValue) {
			this.#input.setValue(currentValue);
		}

		this.#input.onSubmit = value => {
			if (value.trim()) {
				this.onSubmit(value);
			} else {
				this.onCancel();
			}
		};

		this.addChild(this.#input);
		this.addChild(new Spacer(1));
		const hint = [rawKeyHint("enter", "save"), keyHint("ui.dismiss", "cancel")].join(theme.fg("dim", " · "));
		this.addChild(new Text(`  ${hint}`, 0, 0));
	}

	handleInput(data: string): void {
		handleInputOrDismiss(data, this.#input, this.onCancel);
	}
}

// =============================================================================
// Main Plugin Settings Selector
// =============================================================================

export type PluginSettingsRegion = "list" | "detail" | "config";
export type PluginSettingsLayer =
	| { readonly _tag: "PluginDetail"; readonly id: string; readonly kind: PluginListEntry["kind"] }
	| { readonly _tag: "Config"; readonly pluginId: string; readonly key: string };
export type PluginSettingsActionStamp = ModalActionStamp<
	PluginSettingsRegion,
	ModalDepthFrame<PluginSettingsRegion, PluginSettingsLayer>
>;
export type PluginSettingsOperation = "enable" | "disable" | "save-config";

export interface PluginConfigEditorState {
	readonly pluginId: string;
	readonly key: string;
	readonly schemaType: PluginSettingSchema["type"];
	readonly options: readonly string[];
	readonly selectedIndex: number;
	readonly draft: string;
	readonly cursor: number;
}

export interface PluginSettingsPendingOperation {
	readonly operation: PluginSettingsOperation;
	readonly pluginId: string;
	readonly kind: PluginListEntry["kind"];
	readonly scope?: InstalledPluginSummary["scope"];
	readonly key?: string;
	readonly value?: string | number | boolean;
}

export interface PluginSettingsModalModel extends SurfaceModalModel<PluginSettingsRegion, PluginSettingsLayer> {
	readonly componentId: PluginSettingsActionStamp["componentId"];
	readonly leaseGeneration: number;
	readonly sourceRevision: number;
	readonly requestGeneration: number;
	readonly receipt: ReceiptState<string>;
	readonly entries: readonly PluginListEntry[];
	readonly loaded: boolean;
	readonly loading: boolean;
	readonly error?: string;
	readonly configValues: Readonly<Record<string, Readonly<Record<string, unknown>>>>;
	readonly loadedConfigPluginIds: readonly string[];
	readonly loadingConfigPluginId?: string;
	readonly editor?: PluginConfigEditorState;
	readonly pendingEntries?: PluginSettingsActionStamp;
	readonly pendingConfig?: PluginSettingsActionStamp;
	readonly pendingAction?: PluginSettingsActionStamp;
	readonly pendingOperation?: PluginSettingsPendingOperation;
}

export type PluginSettingsModalMsg =
	| SurfaceModalMsg<PluginSettingsRegion, PluginSettingsLayer>
	| { readonly _tag: "Input"; readonly action: string; readonly event: KeyEvent }
	| { readonly _tag: "MoveSelection"; readonly delta: -1 | 1 }
	| { readonly _tag: "SelectIndex"; readonly index: number; readonly activate: boolean }
	| { readonly _tag: "LoadEntries" }
	| ({ readonly _tag: "EntriesLoaded"; readonly entries: readonly PluginListEntry[] } & PluginSettingsActionStamp)
	| ({ readonly _tag: "EntriesFailed"; readonly error: string } & PluginSettingsActionStamp)
	| { readonly _tag: "LoadPluginConfig"; readonly pluginId: string }
	| ({
			readonly _tag: "PluginConfigLoaded";
			readonly pluginId: string;
			readonly values: Readonly<Record<string, unknown>>;
	  } & PluginSettingsActionStamp)
	| ({ readonly _tag: "PluginConfigFailed"; readonly pluginId: string; readonly error: string } & PluginSettingsActionStamp)
	| {
			readonly _tag: "RunPluginOperation";
			readonly operation: PluginSettingsOperation;
			readonly pluginId: string;
			readonly key?: string;
			readonly value?: string | number | boolean;
			readonly receiptId?: string;
	  }
	| ({ readonly _tag: "ActionPending"; readonly receiptId: string } & PluginSettingsActionStamp)
	| ({ readonly _tag: "ActionSucceeded"; readonly receiptId: string; readonly message?: string } & PluginSettingsActionStamp)
	| ({ readonly _tag: "ActionFailed"; readonly receiptId: string; readonly error: string } & PluginSettingsActionStamp);

export type PluginSettingsModalCommand =
	| SurfaceModalCommand
	| { readonly _tag: "LoadPluginEntriesRequested"; readonly stamp: PluginSettingsActionStamp }
	| {
			readonly _tag: "LoadPluginConfigRequested";
			readonly pluginId: string;
			readonly stamp: PluginSettingsActionStamp;
	  }
	| {
			readonly _tag: "PluginOperationRequested";
			readonly operation: PluginSettingsOperation;
			readonly pluginId: string;
			readonly kind: PluginListEntry["kind"];
			readonly scope?: InstalledPluginSummary["scope"];
			readonly key?: string;
			readonly value?: string | number | boolean;
			readonly receiptId: string;
			readonly stamp: PluginSettingsActionStamp;
	  };

export type PluginSettingsServiceCommand = Exclude<PluginSettingsModalCommand, SurfaceModalCommand>;

export interface PluginSettingsTransition {
	readonly model: PluginSettingsModalModel;
	readonly commands: readonly PluginSettingsModalCommand[];
}

export const PLUGIN_SETTINGS_COMPONENT_ID = makeComponentId("plugin-settings");

export const makePluginSettingsModalModel = (): PluginSettingsModalModel => ({
	...makeSurfaceModalModel<PluginSettingsRegion, PluginSettingsLayer>("list"),
	componentId: PLUGIN_SETTINGS_COMPONENT_ID,
	leaseGeneration: 0,
	sourceRevision: 0,
	requestGeneration: 0,
	receipt: noneReceipt<string>(),
	entries: [],
	loaded: false,
	loading: false,
	configValues: {},
	loadedConfigPluginIds: [],
});

function sameDepth(
	left: readonly ModalDepthFrame<PluginSettingsRegion, PluginSettingsLayer>[],
	right: readonly ModalDepthFrame<PluginSettingsRegion, PluginSettingsLayer>[],
): boolean {
	if (left.length !== right.length) return false;
	for (let index = 0; index < left.length; index += 1) {
		const a = left[index];
		const b = right[index];
		if (a?.returnRegion !== b?.returnRegion || a?.returnFocusIndex !== b?.returnFocusIndex) return false;
		if (a?.layer._tag !== b?.layer._tag) return false;
		if (a?.layer._tag === "PluginDetail" && b?.layer._tag === "PluginDetail") {
			if (a.layer.id !== b.layer.id || a.layer.kind !== b.layer.kind) return false;
		} else if (a?.layer._tag === "Config" && b?.layer._tag === "Config") {
			if (a.layer.pluginId !== b.layer.pluginId || a.layer.key !== b.layer.key) return false;
		}
	}
	return true;
}

function actionStampFor(model: PluginSettingsModalModel, requestGeneration: number): PluginSettingsActionStamp {
	return {
		region: model.region,
		depth: model.depth,
		componentId: model.componentId,
		leaseGeneration: model.leaseGeneration,
		sourceRevision: model.sourceRevision,
		requestGeneration,
	};
}

function matchesStamp(model: PluginSettingsModalModel, pending: PluginSettingsActionStamp | undefined, stamp: PluginSettingsActionStamp): boolean {
	return pending !== undefined &&
		pending.componentId === stamp.componentId &&
		pending.leaseGeneration === stamp.leaseGeneration &&
		pending.sourceRevision === stamp.sourceRevision &&
		pending.requestGeneration === stamp.requestGeneration &&
		pending.region === stamp.region &&
		model.region === stamp.region &&
		sameDepth(pending.depth, stamp.depth) &&
		sameDepth(model.depth, stamp.depth);
}

function matchesPendingAction(
	model: PluginSettingsModalModel,
	msg: PluginSettingsActionStamp & { readonly receiptId: string },
): boolean {
	const receipt = model.receipt;
	return receipt._tag === "Pending" &&
		receipt.receiptId === msg.receiptId &&
		matchesStamp(model, model.pendingAction, msg);
}

function pluginEntryId(entry: PluginListEntry): string {
	return entry.kind === "npm" ? entry.plugin.name : entry.plugin.id;
}

function findPluginEntry(model: PluginSettingsModalModel, id: string, kind?: PluginListEntry["kind"]): PluginListEntry | undefined {
	return model.entries.find(entry => pluginEntryId(entry) === id && (kind === undefined || entry.kind === kind));
}

function pluginDetailLayer(
	model: PluginSettingsModalModel,
): Extract<PluginSettingsLayer, { readonly _tag: "PluginDetail" }> | undefined {
	for (let index = model.depth.length - 1; index >= 0; index -= 1) {
		const layer = model.depth[index]?.layer;
		if (layer?._tag === "PluginDetail") return layer;
	}
	return undefined;
}

interface PluginDetailRow {
	readonly id: string;
	readonly value: string;
	readonly schema?: PluginSettingSchema;
}

function effectiveFeatures(plugin: InstalledPlugin): ReadonlySet<string> {
	if (plugin.enabledFeatures !== null) return new Set(plugin.enabledFeatures);
	return new Set(
		Object.entries(plugin.manifest.features ?? {})
			.filter(([, feature]) => feature.default)
			.map(([name]) => name),
	);
}

function pluginDetailRows(model: PluginSettingsModalModel, entry: PluginListEntry): readonly PluginDetailRow[] {
	if (entry.kind === "marketplace") {
		return [{ id: "__enabled__", value: marketplaceEnabled(entry.plugin) ? "true" : "false" }];
	}
	const plugin = entry.plugin;
	const rows: PluginDetailRow[] = [{ id: "__enabled__", value: plugin.enabled ? "true" : "false" }];
	const enabledFeatures = effectiveFeatures(plugin);
	for (const feature of Object.keys(plugin.manifest.features ?? {})) {
		rows.push({ id: `feature:${feature}`, value: enabledFeatures.has(feature) ? "true" : "false" });
	}
	if (!model.loadedConfigPluginIds.includes(plugin.name)) return rows;
	const values = model.configValues[plugin.name] ?? {};
	for (const [key, schema] of Object.entries(plugin.manifest.settings ?? {})) {
		const value = values[key] ?? schema.default;
		rows.push({ id: `config:${key}`, value: String(value ?? ""), schema });
	}
	return rows;
}

function moveFocus(model: PluginSettingsModalModel, delta: -1 | 1): PluginSettingsModalModel {
	const count =
		model.region === "list"
			? model.entries.length
			: model.region === "detail"
				? (() => {
						const layer = pluginDetailLayer(model);
						const entry = layer === undefined ? undefined : findPluginEntry(model, layer.id, layer.kind);
						return entry === undefined ? 0 : pluginDetailRows(model, entry).length;
					})()
				: model.editor?.schemaType === "enum"
					? model.editor.options.length
					: 0;
	if (count === 0) return model;
	const focusIndex = (model.focusIndex + delta + count) % count;
	if (model.region === "config" && model.editor?.schemaType === "enum") {
		return { ...model, focusIndex, editor: { ...model.editor, selectedIndex: focusIndex } };
	}
	return { ...model, focusIndex };
}

function setFocus(model: PluginSettingsModalModel, index: number): PluginSettingsModalModel {
	const focusIndex = Math.max(0, index);
	if (model.region === "config" && model.editor?.schemaType === "enum") {
		if (model.editor.options.length === 0) return model;
		const selectedIndex = Math.min(model.editor.options.length - 1, focusIndex);
		return { ...model, focusIndex: selectedIndex, editor: { ...model.editor, selectedIndex } };
	}
	return { ...model, focusIndex };
}

function requestEntries(model: PluginSettingsModalModel): PluginSettingsTransition {
	if (model.loading || model.loaded) return { model, commands: [] };
	const requestGeneration = model.requestGeneration + 1;
	const stamp = actionStampFor(model, requestGeneration);
	return {
		model: {
			...model,
			requestGeneration,
			loading: true,
			error: undefined,
			pendingEntries: stamp,
		},
		commands: [{ _tag: "LoadPluginEntriesRequested", stamp }],
	};
}

function requestPluginConfig(model: PluginSettingsModalModel, pluginId: string): PluginSettingsTransition {
	if (model.loadedConfigPluginIds.includes(pluginId) || model.loadingConfigPluginId === pluginId) {
		return { model, commands: [] };
	}
	const requestGeneration = model.requestGeneration + 1;
	const stamp = actionStampFor(model, requestGeneration);
	return {
		model: {
			...model,
			requestGeneration,
			loadingConfigPluginId: pluginId,
			pendingConfig: stamp,
			error: undefined,
		},
		commands: [{ _tag: "LoadPluginConfigRequested", pluginId, stamp }],
	};
}

function backPluginSettings(model: PluginSettingsModalModel): PluginSettingsTransition {
	const leaving = model.region;
	const transition = updateSurfaceModal(model, { _tag: "Back" });
	if (transition.commands.length > 0) return { model, commands: transition.commands };
	return {
		model: {
			...model,
			...transition.model,
			...(leaving === "config" ? { editor: undefined } : {}),
			...(leaving === "detail"
				? { loadingConfigPluginId: undefined, pendingConfig: undefined }
				: {}),
		},
		commands: [],
	};
}

function openPluginSelection(model: PluginSettingsModalModel): PluginSettingsTransition {
	if (model.region === "list") {
		const entry = model.entries[model.focusIndex];
		if (entry === undefined) return { model, commands: [] };
		const transition = updateSurfaceModal(model, {
			_tag: "Push",
			region: "detail",
			layer: { _tag: "PluginDetail", id: pluginEntryId(entry), kind: entry.kind },
		});
		const next: PluginSettingsModalModel = { ...model, ...transition.model, editor: undefined, error: undefined };
		if (entry.kind === "npm" && Object.keys(entry.plugin.manifest.settings ?? {}).length > 0) {
			return requestPluginConfig(next, entry.plugin.name);
		}
		return { model: next, commands: [] };
	}
	if (model.region === "detail") {
		const layer = pluginDetailLayer(model);
		const entry = layer === undefined ? undefined : findPluginEntry(model, layer.id, layer.kind);
		if (entry === undefined) return { model, commands: [] };
		const row = pluginDetailRows(model, entry)[model.focusIndex];
		if (row === undefined) return { model, commands: [] };
		if (row.id === "__enabled__") {
			return updatePluginSettingsModal(model, {
				_tag: "RunPluginOperation",
				operation: row.value === "true" ? "disable" : "enable",
				pluginId: pluginEntryId(entry),
			});
		}
		if (row.id.startsWith("feature:")) {
			return updatePluginSettingsModal(model, {
				_tag: "RunPluginOperation",
				operation: "save-config",
				pluginId: pluginEntryId(entry),
				key: row.id,
				value: row.value !== "true",
			});
		}
		if (!row.id.startsWith("config:") || entry.kind !== "npm" || row.schema === undefined) {
			return { model, commands: [] };
		}
		const key = row.id.slice(7);
		if (row.schema.type === "boolean") {
			return updatePluginSettingsModal(model, {
				_tag: "RunPluginOperation",
				operation: "save-config",
				pluginId: entry.plugin.name,
				key,
				value: row.value !== "true",
			});
		}
		const options = row.schema.type === "enum" ? row.schema.values : [];
		const selectedIndex = Math.max(0, options.indexOf(row.value));
		const draft = row.schema.secret ? "" : row.value;
		const transition = updateSurfaceModal(model, {
			_tag: "Push",
			region: "config",
			layer: { _tag: "Config", pluginId: entry.plugin.name, key },
		});
		return {
			model: {
				...model,
				...transition.model,
				editor: {
					pluginId: entry.plugin.name,
					key,
					schemaType: row.schema.type,
					options,
					selectedIndex,
					draft,
					cursor: draft.length,
				},
				focusIndex: selectedIndex,
			},
			commands: [],
		};
	}
	const editor = model.editor;
	if (editor === undefined) return backPluginSettings(model);
	const value =
		editor.schemaType === "enum"
			? editor.options[editor.selectedIndex]
			: editor.schemaType === "number"
				? Number(editor.draft)
				: editor.draft;
	if (value === undefined || (typeof value === "string" && value.trim().length === 0)) {
		return backPluginSettings(model);
	}
	const popped = backPluginSettings(model);
	return updatePluginSettingsModal(popped.model, {
		_tag: "RunPluginOperation",
		operation: "save-config",
		pluginId: editor.pluginId,
		key: editor.key,
		value,
	});
}

function editConfigDraft(model: PluginSettingsModalModel, key: string, text: string | undefined): PluginSettingsModalModel {
	const editor = model.editor;
	if (editor === undefined || editor.schemaType === "enum") return model;
	let draft = editor.draft;
	let cursor = editor.cursor;
	if (text !== undefined && text.length > 0) {
		draft = `${draft.slice(0, cursor)}${text}${draft.slice(cursor)}`;
		cursor += text.length;
	} else {
		switch (key) {
			case "left":
				cursor = Math.max(0, cursor - 1);
				break;
			case "right":
				cursor = Math.min(draft.length, cursor + 1);
				break;
			case "home":
			case "ctrl+a":
				cursor = 0;
				break;
			case "end":
			case "ctrl+e":
				cursor = draft.length;
				break;
			case "backspace":
				if (cursor > 0) {
					draft = `${draft.slice(0, cursor - 1)}${draft.slice(cursor)}`;
					cursor -= 1;
				}
				break;
			case "delete":
				draft = `${draft.slice(0, cursor)}${draft.slice(cursor + 1)}`;
				break;
			case "ctrl+u":
				draft = draft.slice(cursor);
				cursor = 0;
				break;
			case "alt+backspace":
			case "ctrl+w": {
				let start = cursor;
				while (start > 0 && /\s/.test(draft[start - 1] ?? "")) start -= 1;
				while (start > 0 && !/\s/.test(draft[start - 1] ?? "")) start -= 1;
				draft = `${draft.slice(0, start)}${draft.slice(cursor)}`;
				cursor = start;
				break;
			}
		}
	}
	return { ...model, editor: { ...editor, draft, cursor } };
}

function updatePluginSettingsInput(
	model: PluginSettingsModalModel,
	action: string,
	event: KeyEvent,
): PluginSettingsTransition {
	if (action === "ui.dismiss") return backPluginSettings(model);
	if (event._tag === "Release" || event._tag === "Resize" || event._tag === "Mouse") return { model, commands: [] };
	const key = event._tag === "Press" ? String(event.key) : "";
	const text = event.text;
	if (model.region === "config" && model.editor?.schemaType !== "enum") {
		if (key === "enter") return openPluginSelection(model);
		return { model: editConfigDraft(model, key, text), commands: [] };
	}
	if (key === "up") return { model: moveFocus(model, -1), commands: [] };
	if (key === "down") return { model: moveFocus(model, 1), commands: [] };
	if (key === "pageUp") {
		let next = model;
		for (let count = 0; count < 8; count += 1) next = moveFocus(next, -1);
		return { model: next, commands: [] };
	}
	if (key === "pageDown") {
		let next = model;
		for (let count = 0; count < 8; count += 1) next = moveFocus(next, 1);
		return { model: next, commands: [] };
	}
	if (key === "home") return { model: setFocus(model, 0), commands: [] };
	if (key === "end") {
		const count =
			model.region === "list"
				? model.entries.length
				: model.region === "detail"
					? (() => {
							const layer = pluginDetailLayer(model);
							const entry = layer === undefined ? undefined : findPluginEntry(model, layer.id, layer.kind);
							return entry === undefined ? 0 : pluginDetailRows(model, entry).length;
						})()
					: model.editor?.options.length ?? 0;
		return { model: setFocus(model, Math.max(0, count - 1)), commands: [] };
	}
	if (key === "enter" || key === "space") return openPluginSelection(model);
	return { model, commands: [] };
}

function applyPendingOperation(model: PluginSettingsModalModel): PluginSettingsModalModel {
	const pending = model.pendingOperation;
	if (pending === undefined) return model;
	let entries = model.entries;
	let configValues = model.configValues;
	if (pending.operation === "enable" || pending.operation === "disable") {
		const enabled = pending.operation === "enable";
		entries = entries.map(entry => {
			if (pluginEntryId(entry) !== pending.pluginId || entry.kind !== pending.kind) return entry;
			if (entry.kind === "npm") return { ...entry, plugin: { ...entry.plugin, enabled } };
			return {
				...entry,
				plugin: {
					...entry.plugin,
					entries: entry.plugin.entries.map(installed => ({ ...installed, enabled })),
				},
			};
		});
	} else if (pending.key?.startsWith("feature:")) {
		const feature = pending.key.slice(8);
		entries = entries.map(entry => {
			if (entry.kind !== "npm" || entry.plugin.name !== pending.pluginId) return entry;
			const enabled = new Set(effectiveFeatures(entry.plugin));
			if (pending.value === true) enabled.add(feature);
			else enabled.delete(feature);
			return { ...entry, plugin: { ...entry.plugin, enabledFeatures: [...enabled] } };
		});
	} else if (pending.key !== undefined) {
		configValues = {
			...configValues,
			[pending.pluginId]: {
				...configValues[pending.pluginId],
				[pending.key]: pending.value,
			},
		};
	}
	return { ...model, entries, configValues };
}

export function updatePluginSettingsModal(
	model: PluginSettingsModalModel,
	msg: PluginSettingsModalMsg,
): PluginSettingsTransition {
	switch (msg._tag) {
		case "Input":
			return updatePluginSettingsInput(model, msg.action, msg.event);
		case "Back":
			return backPluginSettings(model);
		case "MoveSelection":
			return { model: moveFocus(model, msg.delta), commands: [] };
		case "SelectIndex": {
			const selected = setFocus(model, msg.index);
			return msg.activate ? openPluginSelection(selected) : { model: selected, commands: [] };
		}
		case "LoadEntries":
			return requestEntries(model);
		case "EntriesLoaded":
			if (!matchesStamp(model, model.pendingEntries, msg)) return { model, commands: [] };
			return {
				model: {
					...model,
					entries: msg.entries,
					loaded: true,
					loading: false,
					error: undefined,
					pendingEntries: undefined,
					sourceRevision: model.sourceRevision + 1,
					focusIndex: Math.min(model.focusIndex, Math.max(0, msg.entries.length - 1)),
				},
				commands: [],
			};
		case "EntriesFailed":
			if (!matchesStamp(model, model.pendingEntries, msg)) return { model, commands: [] };
			return {
				model: {
					...model,
					loaded: true,
					loading: false,
					error: msg.error,
					pendingEntries: undefined,
					sourceRevision: model.sourceRevision + 1,
				},
				commands: [],
			};
		case "LoadPluginConfig":
			return requestPluginConfig(model, msg.pluginId);
		case "PluginConfigLoaded":
			if (
				model.loadingConfigPluginId !== msg.pluginId ||
				!matchesStamp(model, model.pendingConfig, msg)
			) {
				return { model, commands: [] };
			}
			return {
				model: {
					...model,
					configValues: { ...model.configValues, [msg.pluginId]: msg.values },
					loadedConfigPluginIds: [...new Set([...model.loadedConfigPluginIds, msg.pluginId])],
					loadingConfigPluginId: undefined,
					pendingConfig: undefined,
					error: undefined,
					sourceRevision: model.sourceRevision + 1,
				},
				commands: [],
			};
		case "PluginConfigFailed":
			if (
				model.loadingConfigPluginId !== msg.pluginId ||
				!matchesStamp(model, model.pendingConfig, msg)
			) {
				return { model, commands: [] };
			}
			return {
				model: {
					...model,
					loadingConfigPluginId: undefined,
					pendingConfig: undefined,
					error: msg.error,
					sourceRevision: model.sourceRevision + 1,
				},
				commands: [],
			};
		case "RunPluginOperation": {
			const entry = findPluginEntry(model, msg.pluginId);
			const detail = pluginDetailLayer(model);
			const kind = entry?.kind ?? (detail?.id === msg.pluginId ? detail.kind : undefined);
			if (kind === undefined) return { model, commands: [] };
			const requestGeneration = model.requestGeneration + 1;
			const stamp = actionStampFor(model, requestGeneration);
			const receiptId = msg.receiptId ?? `plugin-settings:${requestGeneration}`;
			const pending: ReceiptState<string> = {
				_tag: "Pending",
				action: msg.operation,
				id: msg.pluginId,
				sourceRevision: stamp.sourceRevision,
				requestGeneration: stamp.requestGeneration,
				nonce: receiptId,
				receiptId,
			};
			const pendingOperation: PluginSettingsPendingOperation = {
				operation: msg.operation,
				pluginId: msg.pluginId,
				kind,
				...(entry?.kind === "marketplace" ? { scope: entry.plugin.scope } : {}),
				...(msg.key === undefined ? {} : { key: msg.key }),
				...(msg.value === undefined ? {} : { value: msg.value }),
			};
			return {
				model: { ...model, requestGeneration, pendingAction: stamp, pendingOperation, receipt: pending, error: undefined },
				commands: [
					{
						_tag: "PluginOperationRequested",
						...pendingOperation,
						receiptId,
						stamp,
					},
				],
			};
		}
		case "ActionPending": {
			const receipt: ReceiptState<string> = {
				_tag: "Pending",
				action: msg.region,
				id: msg.region,
				sourceRevision: msg.sourceRevision,
				requestGeneration: msg.requestGeneration,
				nonce: msg.receiptId,
				receiptId: msg.receiptId,
			};
			return { model: { ...model, pendingAction: msg, receipt }, commands: [] };
		}
		case "ActionSucceeded":
			if (!matchesPendingAction(model, msg)) return { model, commands: [] };
			return {
				model: {
					...applyPendingOperation(model),
					pendingAction: undefined,
					pendingOperation: undefined,
					sourceRevision: model.sourceRevision + 1,
					receipt: {
						_tag: "Succeeded",
						action: msg.region,
						id: msg.region,
						sourceRevision: msg.sourceRevision,
						requestGeneration: msg.requestGeneration,
						nonce: msg.receiptId,
						receiptId: msg.receiptId,
						...(msg.message === undefined ? {} : { message: msg.message }),
					},
				},
				commands: [],
			};
		case "ActionFailed":
			if (!matchesPendingAction(model, msg)) return { model, commands: [] };
			return {
				model: {
					...model,
					pendingAction: undefined,
					pendingOperation: undefined,
					error: msg.error,
					receipt: {
						_tag: "Failed",
						action: msg.region,
						id: msg.region,
						sourceRevision: msg.sourceRevision,
						requestGeneration: msg.requestGeneration,
						nonce: msg.receiptId,
						receiptId: msg.receiptId,
						error: msg.error,
					},
				},
				commands: [],
			};
		default: {
			const transition = updateSurfaceModal(model, msg);
			return { model: { ...model, ...transition.model }, commands: transition.commands };
		}
	}
}

function detailSettingItems(model: PluginSettingsModalModel, entry: PluginListEntry): SettingItem[] {
	if (entry.kind === "marketplace") {
		return [
			{
				id: "__enabled__",
				label: "Enabled",
				description: "Enable or disable this marketplace plugin",
				currentValue: marketplaceEnabled(entry.plugin) ? "true" : "false",
				values: ["true", "false"],
			},
		];
	}
	const plugin = entry.plugin;
	const features = plugin.manifest.features ?? {};
	return pluginDetailRows(model, entry).map(row => {
		if (row.id === "__enabled__") {
			return {
				id: row.id,
				label: "Enabled",
				description: "Enable or disable this plugin",
				currentValue: row.value,
				values: ["true", "false"],
			};
		}
		if (row.id.startsWith("feature:")) {
			const feature = row.id.slice(8);
			return {
				id: row.id,
				label: `  ${feature}`,
				description: features[feature]?.description || `Enable ${feature} feature`,
				currentValue: row.value,
				values: ["true", "false"],
			};
		}
		const key = row.id.slice(7);
		const schema = row.schema;
		const displayValue = schema?.secret && row.value ? "••••••••" : row.value || "(not set)";
		return schema?.type === "boolean"
			? {
					id: row.id,
					label: `  ${key}`,
					description: schema.description || `Configure ${key}`,
					currentValue: row.value === "true" ? "true" : "false",
					values: ["true", "false"],
				}
			: {
					id: row.id,
					label: `  ${key}`,
					description: schema?.description || `Configure ${key}`,
					currentValue: displayValue,
					submenu: () => new Container(),
				};
	});
}

/**
 * Projection-only renderer for the plugin settings subtree. Every interactive
 * value comes from `apply`; terminal input and service work stay in Settings MVU.
 */
export class PluginSettingsComponent extends Container {
	#hitTest: ((line: number, col: number) => number | undefined) | undefined;

	apply(model: PluginSettingsModalModel): void {
		this.#hitTest = undefined;
		this.clear();

		if (model.region === "list") {
			if (model.loading) {
				this.addChild(new Text(theme.fg("muted", "  Loading plugins…"), 0, 0));
				return;
			}
			const list = new PluginListComponent(model.entries, {
				onNpmSelect: () => {},
				onMarketplaceSelect: () => {},
				onCancel: () => {},
			});
			list.setSelectedIndex(model.focusIndex);
			this.#hitTest = line => list.hitTest(line);
			this.addChild(list);
			if (model.error) this.addChild(new Text(theme.fg("error", `  ${model.error}`), 0, 0));
			return;
		}

		if (model.region === "config" && model.editor !== undefined) {
			const layer = model.depth.at(-1)?.layer;
			const entry =
				layer?._tag === "Config"
					? findPluginEntry(model, layer.pluginId, "npm")
					: undefined;
			const schema =
				entry?.kind === "npm"
					? entry.plugin.manifest.settings?.[model.editor.key]
					: undefined;
			if (schema === undefined) return;
			if (model.editor.schemaType === "enum") {
				const submenu = new ConfigEnumSubmenu(
					model.editor.key,
					schema.description || `Select value for ${model.editor.key}`,
					[...model.editor.options],
					model.editor.options[model.editor.selectedIndex] ?? "",
					() => {},
					() => {},
				);
				submenu.setSelectedIndex(model.editor.selectedIndex);
				this.#hitTest = line => submenu.hitTest(line);
				this.addChild(submenu);
				return;
			}
			const submenu = new ConfigInputSubmenu(
				model.editor.key,
				schema,
				model.editor.draft,
				() => {},
				() => {},
			);
			for (let count = model.editor.draft.length - model.editor.cursor; count > 0; count -= 1) {
				submenu.handleInput("\x1b[D");
			}
			this.addChild(submenu);
			return;
		}

		const layer = pluginDetailLayer(model);
		const entry = layer === undefined ? undefined : findPluginEntry(model, layer.id, layer.kind);
		if (entry === undefined) return;
		const content = new Container();
		let listOffset = 0;
		content.addChild(new DynamicBorder());
		listOffset += 1;
		const title = entry.kind === "npm" ? entry.plugin.name : entry.plugin.id;
		content.addChild(new Text(theme.bold(theme.fg("accent", `  ${title}`)), 0, 0));
		listOffset += 1;
		if (entry.kind === "npm" && entry.plugin.manifest.description) {
			content.addChild(new Text(theme.fg("muted", `  ${entry.plugin.manifest.description}`), 0, 0));
			listOffset += 1;
		} else if (entry.kind === "marketplace") {
			const shadow = entry.plugin.shadowedBy ? ` ${theme.status.shadowed} shadowed by ${entry.plugin.shadowedBy}` : "";
			content.addChild(new Text(theme.fg("muted", `  [${entry.plugin.scope}]${shadow}`), 0, 0));
			listOffset += 1;
		}
		content.addChild(new Spacer(1));
		listOffset += 1;
		if (entry.kind === "npm" && model.loadingConfigPluginId === entry.plugin.name) {
			content.addChild(new Text(theme.fg("muted", "  Loading plugin settings…"), 0, 0));
			listOffset += 1;
		}
		const rows = pluginDetailRows(model, entry);
		const list = new SettingsList(
			detailSettingItems(model, entry),
			Math.max(1, Math.min(rows.length, 10)),
			getSettingsListTheme(),
			() => {},
			() => {},
		);
		const selected = rows[model.focusIndex];
		if (selected !== undefined) list.selectItem(selected.id);
		this.#hitTest = (line, col) => {
			const id = list.hitTest(line - listOffset, col);
			return id === undefined ? undefined : rows.findIndex(row => row.id === id);
		};
		content.addChild(list);
		content.addChild(new Spacer(1));
		if (entry.kind === "marketplace") {
			const installed = entry.plugin.entries[0];
			content.addChild(new Text(theme.fg("dim", `  version       ${installed?.version ?? "(unknown)"}`), 0, 0));
			content.addChild(new Text(theme.fg("dim", `  scope         ${entry.plugin.scope}`), 0, 0));
			content.addChild(
				new Text(
					theme.fg(
						"dim",
						`  install path  ${installed?.installPath ? shortenPath(installed.installPath) : "(unknown)"}`,
					),
					0,
					0,
				),
			);
		}
		const hint = [rawKeyHint("enter", "edit"), keyHint("ui.dismiss", "go back")].join(theme.fg("dim", " · "));
		content.addChild(new Text(`  ${hint}`, 0, 0));
		content.addChild(new DynamicBorder());
		this.addChild(content);
		if (model.error) this.addChild(new Text(theme.fg("error", `  ${model.error}`), 0, 0));
	}

	pointerMessage(model: PluginSettingsModalModel, event: SgrMouseEvent): PluginSettingsModalMsg {
		if (event.wheel !== null) return { _tag: "MoveSelection", delta: event.wheel };
		if (!event.leftClick) return { _tag: "SelectIndex", index: model.focusIndex, activate: false };
		const index = this.#hitTest?.(event.row, event.col);
		return index === undefined
			? { _tag: "SelectIndex", index: model.focusIndex, activate: false }
			: { _tag: "SelectIndex", index, activate: model.focusIndex === index };
	}
}

async function buildMarketplaceManager(cwd: string): Promise<MarketplaceManager> {
	return new MarketplaceManager({
		marketplacesRegistryPath: getMarketplacesRegistryPath(),
		installedRegistryPath: getInstalledPluginsRegistryPath(),
		projectInstalledRegistryPath: await resolveOrDefaultProjectRegistryPath(cwd),
		marketplacesCacheDir: getMarketplacesCacheDir(),
		pluginsCacheDir: getPluginsCacheDir(),
		clearPluginRootsCache: clearPluginRootsAndCaches,
	});
}

/** Execute one Settings-owned plugin service command and return its stamped source message. */
export async function interpretPluginSettingsCommand(
	cwd: string,
	command: PluginSettingsServiceCommand,
): Promise<PluginSettingsModalMsg> {
	switch (command._tag) {
		case "LoadPluginEntriesRequested": {
			const manager = new PluginManager(cwd);
			const [npmPlugins, marketplacePlugins] = await Promise.all([
				manager.list().catch(error => {
					logger.error("Settings → Plugins: failed to list npm plugins", {
						error: error instanceof Error ? error.message : String(error),
					});
					return [] as InstalledPlugin[];
				}),
				buildMarketplaceManager(cwd)
					.then(marketplace => marketplace.listInstalledPlugins())
					.catch(error => {
						logger.error("Settings → Plugins: failed to list marketplace plugins", {
							error: error instanceof Error ? error.message : String(error),
						});
						return [] as InstalledPluginSummary[];
					}),
			]);
			return {
				_tag: "EntriesLoaded",
				entries: [
					...npmPlugins.map(plugin => ({ kind: "npm" as const, plugin })),
					...marketplacePlugins.map(plugin => ({ kind: "marketplace" as const, plugin })),
				],
				...command.stamp,
			};
		}
		case "LoadPluginConfigRequested":
			try {
				const values = await new PluginManager(cwd).getPluginSettings(command.pluginId);
				return { _tag: "PluginConfigLoaded", pluginId: command.pluginId, values, ...command.stamp };
			} catch (error) {
				return {
					_tag: "PluginConfigFailed",
					pluginId: command.pluginId,
					error: error instanceof Error ? error.message : String(error),
					...command.stamp,
				};
			}
		case "PluginOperationRequested":
			try {
				if (command.kind === "marketplace") {
					const marketplace = await buildMarketplaceManager(cwd);
					await marketplace.setPluginEnabled(
						command.pluginId,
						command.operation === "enable",
						command.scope,
					);
				} else {
					const manager = new PluginManager(cwd);
					if (command.operation === "enable" || command.operation === "disable") {
						await manager.setEnabled(command.pluginId, command.operation === "enable");
					} else if (command.key?.startsWith("feature:")) {
						const feature = command.key.slice(8);
						const enabled = new Set((await manager.getEnabledFeatures(command.pluginId)) ?? []);
						if (command.value === true) enabled.add(feature);
						else enabled.delete(feature);
						await manager.setEnabledFeatures(command.pluginId, [...enabled]);
					} else if (command.key !== undefined) {
						await manager.setPluginSetting(command.pluginId, command.key, command.value);
					}
				}
				return {
					_tag: "ActionSucceeded",
					receiptId: command.receiptId,
					message: "saved",
					...command.stamp,
				};
			} catch (error) {
				const message = error instanceof Error ? error.message : String(error);
				logger.error("Settings → Plugins: operation failed", {
					operation: command.operation,
					pluginId: command.pluginId,
					error: message,
				});
				return {
					_tag: "ActionFailed",
					receiptId: command.receiptId,
					error: message,
					...command.stamp,
				};
			}
	}
}
