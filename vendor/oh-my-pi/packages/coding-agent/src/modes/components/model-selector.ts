import { ThinkingLevel } from "@oh-my-pi/pi-agent-core";
import type { Model } from "@oh-my-pi/pi-ai";
import { getSupportedEfforts } from "@oh-my-pi/pi-catalog/model-thinking";
import { modelsAreEqual } from "@oh-my-pi/pi-catalog/models";
import { Container, type Keybinding, type TUI } from "@oh-my-pi/pi-tui";
import { Effect } from "effect";
import * as Schema from "effect/Schema";
import type { ModelAvailabilitySnapshot } from "../../config/model-availability";
import type { ModelRegistry } from "../../config/model-registry";
import { getModelMatchPreferences, resolveModelRoleValue } from "../../config/model-resolver";
import { getKnownRoleIds, getRoleInfo, MODEL_ROLES } from "../../config/model-roles";
import type { Settings } from "../../config/settings";
import type { MvuEnvelope, MvuInputRoute } from "../mvu/input-lease";
import type { MvuRuntime } from "../mvu/runtime";
import { makeSelectorModel, type SelectorModel, type SelectorMsg, updateSelector } from "../mvu/selector";
import {
	KeyEventSchema,
	makeComponentId,
	RouteStampSchema,
	type ComponentId,
	type KeyEvent,
	type RouteStamp,
	type SourceEnvelope,
	type Transition,
} from "../mvu/schema";
import { type ThemeColor, theme } from "../theme/theme";
import { AUTO_THINKING, type ConfiguredThinkingLevel, getConfiguredThinkingLevelMetadata } from "../../thinking";
import { DynamicBorder } from "./dynamic-border";
import { editorKey } from "./keybinding-hints";
import {
	classifyModelSelectorItem,
	formatAuthStatusSuffix,
	formatContextWarningSuffix,
	formatDiscoveryAge,
	formatProviderEmptyStateMessage,
	formatProviderRefreshStatus,
	formatProviderTabLabel,
} from "./model-selector-availability";
import {
	makeSurfaceModalModel,
	type SurfaceModalCommand,
	type SurfaceModalModel,
	type SurfaceModalMsg,
	updateSurfaceModal,
} from "./plugin-settings";

interface ScopedModelItem {
	readonly model: Model;
	readonly thinkingLevel?: string;
}

interface RoleAssignment {
	readonly model: Model;
	readonly thinkingLevel: ConfiguredThinkingLevel;
	readonly autoSelected: boolean;
}

type RoleSelectCallback = (
	model: Model,
	role: string | null,
	thinkingLevel?: ConfiguredThinkingLevel,
	selector?: string,
) => void | Promise<void>;

type ModelRow = {
	readonly _tag: "Model";
	readonly key: string;
	readonly selector: string;
	readonly model: Model;
	readonly provider: string;
	readonly label: string;
	readonly variantCount?: number;
};
type RoleRow = { readonly _tag: "Role"; readonly key: string; readonly role: string; readonly label: string };
type ThinkingRow = {
	readonly _tag: "Thinking";
	readonly key: string;
	readonly level: ConfiguredThinkingLevel;
	readonly label: string;
};
type ModelSelectorRow = ModelRow | RoleRow | ThinkingRow;
type ModelSelectorAction = Keybinding;

type ProviderTab = { readonly id: string; readonly label: string; readonly providerId?: string };
const ALL_TAB = "ALL";
const CANONICAL_TAB = "CANONICAL";
const STATIC_TABS: readonly ProviderTab[] = [
	{ id: ALL_TAB, label: ALL_TAB },
	{ id: CANONICAL_TAB, label: CANONICAL_TAB },
];

export type ModelModalRegion = "providers" | "models" | "role" | "thinking";
export type ModelModalLayer =
	| { readonly _tag: "Role"; readonly modelId: string }
	| { readonly _tag: "Thinking"; readonly modelId: string; readonly role: string | null };
export interface ModelModalModel extends SurfaceModalModel<ModelModalRegion, ModelModalLayer> {
	readonly providerId?: string;
	readonly modelId?: string;
	readonly role: string | null;
}
export type ModelModalMsg =
	| SurfaceModalMsg<ModelModalRegion, ModelModalLayer>
	| { readonly _tag: "SelectProvider"; readonly providerId: string }
	| { readonly _tag: "SelectModel"; readonly modelId: string }
	| { readonly _tag: "SelectRole"; readonly role: string | null; readonly requiresThinking: boolean }
	| { readonly _tag: "SelectThinking"; readonly level: ConfiguredThinkingLevel };
export type ModelModalCommand =
	| SurfaceModalCommand
	| {
			readonly _tag: "ModelSelectionRequested";
			readonly modelId: string;
			readonly role: string | null;
			readonly thinkingLevel?: ConfiguredThinkingLevel;
	  };

export const makeModelModalModel = (): ModelModalModel => ({
	...makeSurfaceModalModel<ModelModalRegion, ModelModalLayer>("providers"),
	role: null,
});

export function updateModelModal(
	model: ModelModalModel,
	msg: ModelModalMsg,
): { readonly model: ModelModalModel; readonly commands: readonly ModelModalCommand[] } {
	switch (msg._tag) {
		case "SelectProvider":
			return { model: { ...model, providerId: msg.providerId, region: "models", focusIndex: 0 }, commands: [] };
		case "SelectModel":
			return {
				model: {
					...model,
					modelId: msg.modelId,
					role: null,
					region: "role",
					focusIndex: 0,
					depth: [...model.depth, { layer: { _tag: "Role", modelId: msg.modelId }, returnRegion: "models", returnFocusIndex: model.focusIndex }],
				},
				commands: [],
			};
		case "SelectRole": {
			if (!model.modelId) return { model, commands: [] };
			if (!msg.requiresThinking) {
				return { model: { ...model, role: msg.role }, commands: [{ _tag: "ModelSelectionRequested", modelId: model.modelId, role: msg.role }] };
			}
			return {
				model: {
					...model,
					role: msg.role,
					region: "thinking",
					focusIndex: 0,
					depth: [...model.depth, { layer: { _tag: "Thinking", modelId: model.modelId, role: msg.role }, returnRegion: "role", returnFocusIndex: model.focusIndex }],
				},
				commands: [],
			};
		}
		case "SelectThinking":
			return model.modelId
				? { model, commands: [{ _tag: "ModelSelectionRequested", modelId: model.modelId, role: model.role, thinkingLevel: msg.level }] }
				: { model, commands: [] };
		default: {
			const transition = updateSurfaceModal(model, msg);
			return { model: { ...model, ...transition.model }, commands: transition.commands };
		}
	}
}

export const MODEL_SELECTOR_ROUTE = {
	componentId: makeComponentId("model-selector"),
	context: "modal.model",
	makeInitialModel: makeModelModalModel,
	update: updateModelModal,
} as const;

type ModelSelectorScreen =
	| { readonly _tag: "Browse" }
	| { readonly _tag: "Role"; readonly modelKey: string }
	| { readonly _tag: "Thinking"; readonly modelKey: string; readonly role: string };

export interface ModelSelectorRouteModel {
	readonly selector: SelectorModel<string, ModelSelectorAction>;
	readonly rows: readonly ModelSelectorRow[];
	readonly allModels: readonly ModelRow[];
	readonly canonicalModels: readonly ModelRow[];
	readonly tabs: readonly ProviderTab[];
	readonly activeTabIndex: number;
	readonly screen: ModelSelectorScreen;
	readonly roles: Readonly<Record<string, RoleAssignment | undefined>>;
	readonly staleProviders: ReadonlySet<string>;
	readonly refreshingProviders: ReadonlySet<string>;
	readonly providerRefreshes: ReadonlySet<string>;
	readonly availabilityGeneration: number;
	readonly error?: string;
	readonly leaseGeneration?: number;
	readonly requestGeneration: number;
}

interface ModelAvailabilitySource {
	readonly snapshot?: ModelAvailabilitySnapshot;
	readonly error?: string;
}

const ModelAvailabilitySnapshotSchema = Schema.declare<ModelAvailabilitySnapshot>(
	(input): input is ModelAvailabilitySnapshot => {
		if (typeof input !== "object" || input === null) return false;
		const snapshot = input as Partial<ModelAvailabilitySnapshot>;
		return typeof snapshot.generation === "number" &&
			Number.isSafeInteger(snapshot.generation) &&
			Array.isArray(snapshot.models) &&
			Array.isArray(snapshot.refreshingProviders) &&
			Array.isArray(snapshot.staleProviders);
	},
);

type ModelSelectorMsg =
	| MvuEnvelope
	| {
			readonly _tag: "AvailabilityChanged";
			readonly stamp: RouteStamp;
			readonly snapshot?: ModelAvailabilitySnapshot;
			readonly error?: string;
	  }
	| { readonly _tag: "RegistrySettled"; readonly stamp: RouteStamp; readonly providerId: string; readonly error?: string }
	| { readonly _tag: "SelectionSettled"; readonly stamp: RouteStamp; readonly error?: string };
const ModelSelectorMsgSchema: Schema.ConstraintDecoder<ModelSelectorMsg, never> = Schema.toType(
	Schema.Union([
		Schema.Struct({
			_tag: Schema.Literal("MvuInput"),
			action: Schema.String as Schema.Schema<Keybinding>,
			event: KeyEventSchema,
			stamp: Schema.optional(RouteStampSchema),
		}),
		Schema.Struct({
			_tag: Schema.Literal("RegistrySettled"),
			stamp: RouteStampSchema,
			providerId: Schema.String,
			error: Schema.optional(Schema.String),
		}),
		Schema.Struct({
			_tag: Schema.Literal("SelectionSettled"),
			stamp: RouteStampSchema,
			error: Schema.optional(Schema.String),
		}),
		Schema.Struct({
			_tag: Schema.Literal("AvailabilityChanged"),
			stamp: RouteStampSchema,
			snapshot: Schema.optional(ModelAvailabilitySnapshotSchema),
			error: Schema.optional(Schema.String),
		}),
	]),
);

type ModelSelectorCommand =
	| { readonly _tag: "Render"; readonly model: ModelSelectorRouteModel }
	| { readonly _tag: "Cancel" }
	| { readonly _tag: "RefreshProvider"; readonly providerId: string; readonly stamp: RouteStamp }
	| {
			readonly _tag: "Select";
			readonly item: ModelRow;
			readonly role: string | null;
			readonly thinkingLevel?: ConfiguredThinkingLevel;
			readonly stamp: RouteStamp;
	  };

export interface ModelSelectorMountSpec {
	readonly componentId: ComponentId;
	readonly component: ModelSelectorComponent;
	readonly initialModel: ModelSelectorRouteModel;
	readonly route: MvuInputRoute<ModelSelectorRouteModel>;
	readonly update: (model: ModelSelectorRouteModel, message: ModelSelectorMsg) => Transition<ModelSelectorRouteModel, ModelSelectorCommand>;
	readonly interpret: (command: ModelSelectorCommand) => Effect.Effect<readonly (ModelSelectorMsg | SourceEnvelope<ModelSelectorMsg>)[]>;
	readonly boundary: {
		readonly messageSchema: Schema.ConstraintDecoder<ModelSelectorMsg, never>;
		readonly currentStamp: (model: ModelSelectorRouteModel) => RouteStamp;
		readonly commandStamp: (command: ModelSelectorCommand) => RouteStamp;
	};
	readonly bindRuntime: (runtime: MvuRuntime<ModelSelectorRouteModel, ModelSelectorMsg>) => void;
}

function makeInvertedBadge(label: string, color: ThemeColor): string {
	const fgAnsi = theme.getFgAnsi(color);
	const bgAnsi = fgAnsi.replace(/\x1b\[38;/g, "\x1b[48;");
	return `${bgAnsi}\x1b[30m ${label} \x1b[39m\x1b[49m`;
}

function makeAutoSelectedBadge(label: string, color: ThemeColor): string {
	return `${theme.fg("dim", "[")}${theme.fg(color, label)}${theme.fg("dim", " auto]")}`;
}

function roleBadge(label: string, color: ThemeColor, assignment: RoleAssignment): string {
	const badge = assignment.autoSelected ? makeAutoSelectedBadge(label, color) : makeInvertedBadge(label, color);
	if (assignment.autoSelected && assignment.thinkingLevel === ThinkingLevel.Inherit) return badge;
	return `${badge} ${theme.fg("dim", `(${getConfiguredThinkingLevelMetadata(assignment.thinkingLevel).label})`)}`;
}

function selectorMessage(action: string, event: KeyEvent, model: SelectorModel<string, ModelSelectorAction>): SelectorMsg<string, ModelSelectorAction> | undefined {
	const text =
		event._tag === "Paste" ? event.text :
		event._tag === "Press" || event._tag === "Release" ? event.text ?? "" :
		"";
	switch (action) {
		case "app.navigation.up":
		case "tui.select.up": return { _tag: "Move", delta: -1 };
		case "app.navigation.down":
		case "tui.select.down": return { _tag: "Move", delta: 1 };
		case "tui.select.pageUp":
		case "tui.select.halfPageUp": return { _tag: "Page", delta: -1 };
		case "tui.select.pageDown":
		case "tui.select.halfPageDown": return { _tag: "Page", delta: 1 };
		case "tui.select.first": return { _tag: "Jump", target: "first" };
		case "tui.select.last": return { _tag: "Jump", target: "last" };
		case "app.selector.filter": return { _tag: "BeginFilter" };
		case "app.selector.filterAppend":
			return text.length > 0 ? { _tag: "FilterAppend", text } : undefined;
		case "app.selector.filterDelete": return { _tag: "FilterDelete" };
		case "ui.dismiss": return { _tag: "Back" };
		default: return undefined;
	}
}

function rowMap(rows: readonly ModelSelectorRow[]): ReadonlyMap<string, ModelSelectorRow> {
	return new Map(rows.map(row => [row.key, row]));
}

function searchText(rows: readonly ModelSelectorRow[]): ReadonlyMap<string, string> {
	return new Map(rows.map(row => [row.key, row._tag === "Model" ? `${row.selector} ${row.model.name}` : row.label]));
}

function replaceRows(
	model: ModelSelectorRouteModel,
	rows: readonly ModelSelectorRow[],
	selectedKey?: string,
): ModelSelectorRouteModel {
	let selector = updateSelector(model.selector, {
		_tag: "SourceReplaced",
		sourceRevision: model.selector.sourceRevision + 1,
		orderedIds: rows.map(row => row.key),
		searchTextById: searchText(rows),
	}).model;
	if (selectedKey !== undefined) {
		const index = selector.filteredIds.indexOf(selectedKey);
		if (index >= 0) {
			selector = { ...selector, selectedId: selectedKey, selectedIndex: index };
		}
	}
	return { ...model, selector, rows };
}

function currentStamp(model: ModelSelectorRouteModel): RouteStamp {
	return {
		componentId: MODEL_SELECTOR_ROUTE.componentId,
		leaseGeneration: model.leaseGeneration ?? 0,
		sourceRevision: model.selector.sourceRevision,
		requestGeneration: model.requestGeneration,
	};
}

function sameStamp(model: ModelSelectorRouteModel, stamp: RouteStamp): boolean {
	const current = currentStamp(model);
	return stamp.componentId === current.componentId && stamp.leaseGeneration === current.leaseGeneration &&
		stamp.sourceRevision === current.sourceRevision && stamp.requestGeneration === current.requestGeneration;
}

function visibleModels(model: ModelSelectorRouteModel, tabIndex = model.activeTabIndex): readonly ModelRow[] {
	const tab = model.tabs[tabIndex] ?? model.tabs[0];
	if (tab?.id === CANONICAL_TAB) return model.canonicalModels;
	if (tab?.providerId !== undefined) return model.allModels.filter(row => row.provider === tab.providerId);
	return model.allModels;
}


export class ModelSelectorComponent extends Container {
	readonly #settings: Settings;
	readonly #tui: TUI;
	readonly #registry: ModelRegistry;
	readonly #onSelect: RoleSelectCallback;
	readonly #onCancel: () => void;
	readonly #temporaryOnly: boolean;
	readonly #currentContextTokens: number;
	readonly #mountSpec: ModelSelectorMountSpec;
	#unsubscribeAvailability: () => void = () => {};
	#disposed = false;
	#projection: ModelSelectorRouteModel;
	#availabilityDispatch: ((source: ModelAvailabilitySource) => void) | undefined;
	#pendingAvailability: ModelAvailabilitySource | undefined;

	constructor(
		tui: TUI,
		currentModel: Model | undefined,
		settings: Settings,
		modelRegistry: ModelRegistry,
		scopedModels: ReadonlyArray<ScopedModelItem>,
		onSelect: RoleSelectCallback,
		onCancel: () => void,
		options?: { readonly temporaryOnly?: boolean; readonly initialSearchInput?: string; readonly currentContextTokens?: number },
	) {
		super();
		this.#tui = tui;
		this.#settings = settings;
		this.#registry = modelRegistry;
		this.#onSelect = onSelect;
		this.#onCancel = onCancel;
		this.#temporaryOnly = options?.temporaryOnly ?? false;
		this.#currentContextTokens = Math.max(0, Math.floor(options?.currentContextTokens ?? 0));
		this.#projection = this.#initialModel(scopedModels, options?.initialSearchInput, currentModel);
		this.#mountSpec = this.#buildMountSpec();
		if (scopedModels.length === 0) {
			this.#unsubscribeAvailability = this.#registry.onAvailabilityChanged(snapshot => {
				this.#dispatchAvailability({ snapshot });
			});
			void this.#registry.refresh("offline").then(
				() => this.#dispatchAvailability({ snapshot: this.#registry.getAvailabilitySnapshot() }),
				error => {
					this.#dispatchAvailability({ error: error instanceof Error ? error.message : String(error) });
				},
			);
		}
	}

	get mountSpec(): ModelSelectorMountSpec {
		return this.#mountSpec;
	}

	#loadRoles(candidates: readonly Model[]): Readonly<Record<string, RoleAssignment | undefined>> {
		const roles: Record<string, RoleAssignment | undefined> = {};
		const allModels = this.#registry.getAll();
		const preferences = getModelMatchPreferences(this.#settings);
		for (const role of getKnownRoleIds(this.#settings)) {
			const configured = this.#settings.getModelRole(role);
			const value = configured ?? `pi/${role}`;
			const resolved = resolveModelRoleValue(value, configured === undefined ? [...candidates] : allModels, {
				settings: this.#settings,
				matchPreferences: preferences,
				modelRegistry: this.#registry,
			});
			if (resolved.model === undefined) {
				if (configured === undefined && role === "smol" && candidates[0] !== undefined) {
					roles[role] = {
						model: candidates[0],
						thinkingLevel: ThinkingLevel.Inherit,
						autoSelected: true,
					};
				}
				continue;
			}
			roles[role] = {
				model: resolved.model,
				thinkingLevel: resolved.explicitThinkingLevel && resolved.thinkingLevel !== undefined ? resolved.thinkingLevel : ThinkingLevel.Inherit,
				autoSelected: configured === undefined,
			};
		}
		return roles;
	}

	#registryRows(scopedModels: ReadonlyArray<ScopedModelItem>, snapshot?: ModelAvailabilitySnapshot): {
		readonly models: readonly ModelRow[];
		readonly canonical: readonly ModelRow[];
		readonly stale: ReadonlySet<string>;
		readonly refreshing: ReadonlySet<string>;
		readonly generation: number;
		readonly error?: string;
	} {
		try {
			const availability = snapshot ?? (scopedModels.length > 0
				? { generation: 0, models: scopedModels.map(entry => entry.model), refreshingProviders: [], staleProviders: [] }
				: this.#registry.getAvailabilitySnapshot());
			const models = availability.models
				.map((model): ModelRow => ({
					_tag: "Model",
					key: `${model.provider}/${model.id}`,
					selector: `${model.provider}/${model.id}`,
					model,
					provider: model.provider,
					label: model.id,
				}))
				.sort((left, right) => left.provider.localeCompare(right.provider) || left.label.localeCompare(right.label));
			const canonical = this.#registry.getCanonicalModelSelections({ availableOnly: false, candidates: models.map(row => row.model) })
				.map(({ record, model }): ModelRow => ({
					_tag: "Model",
					key: `canonical:${record.id}`,
					selector: record.id,
					model,
					provider: model.provider,
					label: record.id,
					variantCount: record.variants.length,
				}));
			const registryError = this.#registry.getError?.();
			return {
				models,
				canonical,
				stale: new Set(availability.staleProviders),
				refreshing: new Set(availability.refreshingProviders),
				generation: availability.generation,
				...(registryError === undefined ? {} : { error: String(registryError) }),
			};
		} catch (error) {
			return { models: [], canonical: [], stale: new Set(), refreshing: new Set(), generation: snapshot?.generation ?? 0, error: error instanceof Error ? error.message : String(error) };
		}
	}
	#preserveCurrentContextWindows(
		model: ModelSelectorRouteModel,
		rows: readonly ModelRow[],
		snapshot: ModelAvailabilitySnapshot,
	): readonly ModelRow[] {
		const staleProviders = new Set(snapshot.staleProviders);
		const snapshotIsNewer = snapshot.generation > model.availabilityGeneration;
		const currentBySelector = new Map(model.allModels.map(row => [row.selector, row]));
		return rows.map(row => {
			if (
				(snapshotIsNewer || model.staleProviders.has(row.provider)) &&
				!staleProviders.has(row.provider)
			) return row;
			const current = currentBySelector.get(`${row.model.provider}/${row.model.id}`);
			if (current === undefined || current.model.contextWindow === row.model.contextWindow) return row;
			return { ...row, model: { ...row.model, contextWindow: current.model.contextWindow } };
		});
	}

	#dispatchAvailability(source: ModelAvailabilitySource): void {
		if (this.#disposed) return;
		if (this.#availabilityDispatch !== undefined) {
			this.#availabilityDispatch(source);
			return;
		}
		const pendingGeneration = this.#pendingAvailability?.snapshot?.generation;
		const sourceGeneration = source.snapshot?.generation;
		if (
			pendingGeneration !== undefined &&
			sourceGeneration !== undefined &&
			sourceGeneration < pendingGeneration
		) return;
		this.#pendingAvailability =
			source.snapshot === undefined && this.#pendingAvailability?.snapshot !== undefined
				? { ...source, snapshot: this.#pendingAvailability.snapshot }
				: source;
	}

	#updateAvailability(
		model: ModelSelectorRouteModel,
		source: ModelAvailabilitySource,
	): Transition<ModelSelectorRouteModel, ModelSelectorCommand> {
		const snapshot = source.snapshot;
		if (snapshot === undefined) {
			if (source.error === undefined) return { model, commands: [], dirtyKeys: new Set() };
			const next = { ...model, error: source.error };
			return { model: next, commands: [{ _tag: "Render", model: next }], dirtyKeys: new Set(["selector.status"]) };
		}
		if (snapshot.generation < model.availabilityGeneration) {
			return { model, commands: [], dirtyKeys: new Set() };
		}
		const loadedSnapshot = this.#registryRows([], snapshot);
		const loaded = {
			...loadedSnapshot,
			models: this.#preserveCurrentContextWindows(model, loadedSnapshot.models, snapshot),
			canonical: this.#preserveCurrentContextWindows(model, loadedSnapshot.canonical, snapshot),
		};
		const previousKeys = model.allModels.map(row => row.key);
		const nextKeys = loaded.models.map(row => row.key);
		const sameKeys =
			previousKeys.length === nextKeys.length && previousKeys.every((key, index) => key === nextKeys[index]);
		const nextBase: ModelSelectorRouteModel = {
			...model,
			allModels: loaded.models,
			canonicalModels: loaded.canonical,
			roles: this.#loadRoles(loaded.models.map(row => row.model)),
			staleProviders: loaded.stale,
			refreshingProviders: loaded.refreshing,
			availabilityGeneration: loaded.generation,
			...(source.error !== undefined
				? { error: source.error }
				: loaded.error === undefined ? {} : { error: loaded.error }),
		};
		const next = nextBase.screen._tag !== "Browse"
			? nextBase
			: sameKeys
				? { ...nextBase, rows: visibleModels(nextBase) }
				: replaceRows(nextBase, visibleModels(nextBase), model.selector.selectedId);
		return {
			model: next,
			commands: [{ _tag: "Render", model: next }],
			dirtyKeys: new Set(["selector.rows", "selector.status"]),
		};
	}

	#initialModel(scopedModels: ReadonlyArray<ScopedModelItem>, initialQuery?: string, currentModel?: Model): ModelSelectorRouteModel {
		const loaded = this.#registryRows(scopedModels);
		const providers = new Set(loaded.models.map(row => row.provider));
		for (const provider of this.#registry.getDiscoverableProviders()) providers.add(provider);
		const tabs = [...STATIC_TABS, ...[...providers].sort().map(providerId => ({ id: providerId, label: formatProviderTabLabel(providerId), providerId }))];
		const roles = this.#loadRoles(loaded.models.map(row => row.model));
		let selector = makeSelectorModel<string, ModelSelectorAction>(loaded.models.map(row => row.key), 0, searchText(loaded.models));
		if (initialQuery !== undefined && initialQuery.length > 0) {
			selector = updateSelector(selector, { _tag: "BeginFilter" }).model;
			selector = updateSelector(selector, { _tag: "FilterAppend", text: initialQuery }).model;
		}
		const currentRow = currentModel === undefined ? undefined : loaded.models.find(row => modelsAreEqual(row.model, currentModel));
		if (currentRow !== undefined) {
			const selectedIndex = selector.filteredIds.indexOf(currentRow.key);
			if (selectedIndex >= 0) selector = { ...selector, selectedId: currentRow.key, selectedIndex };
		}
		return {
			selector,
			rows: loaded.models,
			allModels: loaded.models,
			canonicalModels: loaded.canonical,
			tabs,
			activeTabIndex: 0,
			screen: { _tag: "Browse" },
			roles,
			staleProviders: loaded.stale,
			refreshingProviders: loaded.refreshing,
			providerRefreshes: new Set(),
			availabilityGeneration: loaded.generation,
			...(loaded.error === undefined ? {} : { error: loaded.error }),
			requestGeneration: 0,
		};
	}

	#roleRows(): readonly RoleRow[] {
		const roles: string[] = [];
		const seen = new Set<string>();
		const addRole = (role: string) => {
			if (seen.has(role)) return;
			seen.add(role);
			roles.push(role);
		};
		for (const role of this.#settings.get("cycleOrder")) addRole(role);
		for (const role in this.#settings.getModelRoles()) addRole(role);
		for (const role in this.#settings.get("modelTags")) addRole(role);
		for (const role of getKnownRoleIds(this.#settings)) addRole(role);
		return roles.map(role => {
			const info = getRoleInfo(role, this.#settings);
			return { _tag: "Role", key: `role:${role}`, role, label: info.tag ? `Set as ${info.tag} (${info.name})` : `Set as ${info.name}` };
		});
	}

	#thinkingRows(model: Model): readonly ThinkingRow[] {
		return [ThinkingLevel.Inherit, ThinkingLevel.Off, AUTO_THINKING, ...getSupportedEfforts(model)].map(level => ({
			_tag: "Thinking",
			key: `thinking:${level}`,
			level,
			label: getConfiguredThinkingLevelMetadata(level).label,
		}));
	}

	#browseAfter(model: ModelSelectorRouteModel, selectedKey?: string): ModelSelectorRouteModel {
		return replaceRows({ ...model, screen: { _tag: "Browse" } }, visibleModels(model), selectedKey);
	}

	#inputUpdate(model: ModelSelectorRouteModel, envelope: MvuEnvelope): Transition<ModelSelectorRouteModel, ModelSelectorCommand> {
		if (envelope.stamp !== undefined) {
			if (envelope.stamp.componentId !== MODEL_SELECTOR_ROUTE.componentId) return { model, commands: [], dirtyKeys: new Set() };
			if (model.leaseGeneration !== undefined && envelope.stamp.leaseGeneration !== model.leaseGeneration) return { model, commands: [], dirtyKeys: new Set() };
			if (model.leaseGeneration === undefined) model = { ...model, leaseGeneration: envelope.stamp.leaseGeneration };
		}
		const action = String(envelope.action);
		if (model.screen._tag === "Browse" && (action === "app.selector.sourcePrevious" || action === "app.selector.sourceNext")) {
			const delta = action === "app.selector.sourcePrevious" ? -1 : 1;
			const activeTabIndex = (model.activeTabIndex + delta + model.tabs.length) % model.tabs.length;
			const providerId = model.tabs[activeTabIndex]?.providerId;
			const providerRefreshes =
				providerId === undefined ? model.providerRefreshes : new Set([...model.providerRefreshes, providerId]);
			const next = replaceRows(
				{ ...model, activeTabIndex, providerRefreshes, requestGeneration: model.requestGeneration + 1 },
				visibleModels(model, activeTabIndex),
			);
			const commands: ModelSelectorCommand[] = [{ _tag: "Render", model: next }];
			if (providerId !== undefined) commands.push({ _tag: "RefreshProvider", providerId, stamp: currentStamp(next) });
			return { model: next, commands, dirtyKeys: new Set(["model.tabs", "selector.rows", "selector.status"]) };
		}
		if (action === "tui.select.confirm" || action === "app.selector.preview") {
			const selectedKey = model.selector.selectedId;
			const selected = selectedKey === undefined ? undefined : rowMap(model.rows).get(selectedKey);
			if (selected === undefined) return { model, commands: [], dirtyKeys: new Set() };
			if (model.screen._tag === "Browse" && selected._tag === "Model") {
				if (this.#temporaryOnly) {
					const next = { ...model, requestGeneration: model.requestGeneration + 1 };
					return { model: next, commands: [{ _tag: "Select", item: selected, role: null, stamp: currentStamp(next) }], dirtyKeys: new Set(["selector.status"]) };
				}
				const next = replaceRows({ ...model, screen: { _tag: "Role", modelKey: selected.key } }, this.#roleRows());
				return { model: next, commands: [{ _tag: "Render", model: next }], dirtyKeys: new Set(["selector.rows", "focus"]) };
			}
			const screen = model.screen;
			if (screen._tag === "Role" && selected._tag === "Role") {
				const item = model.allModels.concat(model.canonicalModels).find(row => row.key === screen.modelKey);
				if (item === undefined) return { model, commands: [], dirtyKeys: new Set() };
				const next = replaceRows({ ...model, screen: { _tag: "Thinking", modelKey: item.key, role: selected.role } }, this.#thinkingRows(item.model), `thinking:${model.roles[selected.role]?.thinkingLevel ?? ThinkingLevel.Inherit}`);
				return { model: next, commands: [{ _tag: "Render", model: next }], dirtyKeys: new Set(["selector.rows", "focus"]) };
			}
			if (screen._tag === "Thinking" && selected._tag === "Thinking") {
				const item = model.allModels.concat(model.canonicalModels).find(row => row.key === screen.modelKey);
				if (item === undefined) return { model, commands: [], dirtyKeys: new Set() };
				const next = { ...model, requestGeneration: model.requestGeneration + 1 };
				return { model: next, commands: [{ _tag: "Select", item, role: screen.role, thinkingLevel: selected.level, stamp: currentStamp(next) }], dirtyKeys: new Set(["selector.status"]) };
			}
		}
		if (action === "ui.dismiss") {
			if (model.screen._tag === "Thinking") {
				const next = replaceRows({ ...model, screen: { _tag: "Role", modelKey: model.screen.modelKey } }, this.#roleRows(), `role:${model.screen.role}`);
				return { model: next, commands: [{ _tag: "Render", model: next }], dirtyKeys: new Set(["selector.rows", "focus"]) };
			}
			if (model.screen._tag === "Role") {
				const next = this.#browseAfter(model, model.screen.modelKey);
				return { model: next, commands: [{ _tag: "Render", model: next }], dirtyKeys: new Set(["selector.rows", "focus"]) };
			}
			if (model.selector.mode._tag === "Browse") return { model, commands: [{ _tag: "Cancel" }], dirtyKeys: new Set() };
		}
		if (
			model.screen._tag !== "Browse" &&
			(action === "app.selector.filter" ||
				action === "app.selector.filterAppend" ||
				action === "app.selector.filterDelete")
		) return { model, commands: [], dirtyKeys: new Set() };
		const message = selectorMessage(action, envelope.event, model.selector);
		if (message === undefined) return { model, commands: [], dirtyKeys: new Set() };
		let transition = updateSelector(model.selector, message);
		if (message._tag === "BeginFilter" && envelope.event._tag === "Paste" && envelope.event.text.length > 0) {
			transition = updateSelector(transition.model, { _tag: "FilterAppend", text: envelope.event.text });
		}
		const next = { ...model, selector: transition.model };
		return { model: next, commands: [{ _tag: "Render", model: next }], dirtyKeys: transition.dirtyKeys };
	}

	#updateRoute(
		model: ModelSelectorRouteModel,
		message: ModelSelectorMsg,
	): Transition<ModelSelectorRouteModel, ModelSelectorCommand> {
		if (message._tag === "MvuInput") return this.#inputUpdate(model, message);
		if (!sameStamp(model, message.stamp)) return { model, commands: [], dirtyKeys: new Set() };
		if (message._tag === "AvailabilityChanged") return this.#updateAvailability(model, message);
		if (message._tag === "RegistrySettled") {
			if (message.error !== undefined) {
				const providerRefreshes = new Set(model.providerRefreshes);
				providerRefreshes.delete(message.providerId);
				const next = { ...model, providerRefreshes, error: message.error };
				return { model: next, commands: [{ _tag: "Render", model: next }], dirtyKeys: new Set(["selector.status"]) };
			}
			const loaded = this.#registryRows([]);
			const providerRefreshes = new Set(model.providerRefreshes);
			providerRefreshes.delete(message.providerId);
			const nextBase: ModelSelectorRouteModel = {
				...model,
				allModels: loaded.models,
				canonicalModels: loaded.canonical,
				roles: this.#loadRoles(loaded.models.map(row => row.model)),
				staleProviders: loaded.stale,
				refreshingProviders: loaded.refreshing,
				providerRefreshes,
				availabilityGeneration: loaded.generation,
				...(loaded.error === undefined ? {} : { error: loaded.error }),
			};
			const next = this.#browseAfter(nextBase, model.selector.selectedId);
			return { model: next, commands: [{ _tag: "Render", model: next }], dirtyKeys: new Set(["selector.rows", "selector.status"]) };
		}
		if (message.error !== undefined) {
			const next = { ...model, error: message.error };
			return { model: next, commands: [{ _tag: "Render", model: next }], dirtyKeys: new Set(["selector.status"]) };
		}
		const refreshed = { ...model, roles: this.#loadRoles(model.allModels.map(row => row.model)) };
		const next = this.#browseAfter(refreshed, model.screen._tag === "Browse" ? model.selector.selectedId : undefined);
		return { model: next, commands: [{ _tag: "Render", model: next }], dirtyKeys: new Set(["selector.rows", "selector.status"]) };
	}

	#buildMountSpec(): ModelSelectorMountSpec {
		let currentModel = this.#projection;
		return {
			componentId: MODEL_SELECTOR_ROUTE.componentId,
			component: this,
			initialModel: this.#projection,
			route: {
				componentId: MODEL_SELECTOR_ROUTE.componentId,
				focusedRoot: this,
				context: model => ({
					contexts: ["selector.global", "selector.filter", MODEL_SELECTOR_ROUTE.context],
					mode: model.selector.mode._tag,
					focus: "list",
					capabilities: model.screen._tag === "Browse" ? new Set(["selector.filter"]) : new Set(),
				}),
				activateLease: (model, leaseGeneration) => {
					const activated = { ...model, leaseGeneration };
					currentModel = activated;
					this.#projection = activated;
					return activated;
				},
				actionToMsg: (action, event) => ({ _tag: "MvuInput", action, event }),
				pasteToMsg: event => ({ _tag: "MvuInput", action: "app.selector.filter", event }),
			},
			boundary: {
				messageSchema: ModelSelectorMsgSchema,
				currentStamp,
				commandStamp: command => {
					switch (command._tag) {
						case "Render": return currentStamp(command.model);
						case "Cancel": return currentStamp(this.#projection);
						case "RefreshProvider":
						case "Select": return command.stamp;
					}
				},
			},
			bindRuntime: runtime => {
				this.#availabilityDispatch = source => {
					const stamp = currentStamp(currentModel);
					const message: ModelSelectorMsg = { _tag: "AvailabilityChanged", stamp, ...source };
					void Effect.runPromise(runtime.dispatchSource({ _tag: "MvuSource", stamp, message }));
				};
				const pending = this.#pendingAvailability;
				this.#pendingAvailability = undefined;
				if (pending !== undefined) this.#availabilityDispatch(pending);
			},
			update: (model, message) => {
				const transition = this.#updateRoute(model, message);
				currentModel = transition.model;
				return transition;
			},
			interpret: command => {
				switch (command._tag) {
					case "Render": return Effect.sync(() => {
						this.apply(command.model);
						this.#tui.requestComponentRender(this);
						return [];
					});
					case "Cancel": return Effect.sync(() => { this.#onCancel(); return []; });
					case "RefreshProvider":
						return Effect.sleep("100 millis").pipe(
							Effect.andThen(Effect.tryPromise({
								try: async () => { await this.#registry.refreshProvider(command.providerId, "online"); },
								catch: error => error instanceof Error ? error.message : String(error),
							})),
							Effect.match({
							onFailure: error => [{
								_tag: "MvuSource",
								stamp: command.stamp,
								message: { _tag: "RegistrySettled", stamp: command.stamp, providerId: command.providerId, error },
							} satisfies SourceEnvelope<ModelSelectorMsg>],
							onSuccess: () => [{
								_tag: "MvuSource",
								stamp: command.stamp,
								message: { _tag: "RegistrySettled", stamp: command.stamp, providerId: command.providerId },
							} satisfies SourceEnvelope<ModelSelectorMsg>],
							}),
						);
					case "Select":
						return Effect.tryPromise({
							try: () => Promise.resolve(this.#onSelect(command.item.model, command.role, command.thinkingLevel, command.item.selector)),
							catch: error => error instanceof Error ? error.message : String(error),
						}).pipe(Effect.match({
							onFailure: error => [{
								_tag: "MvuSource",
								stamp: command.stamp,
								message: { _tag: "SelectionSettled", stamp: command.stamp, error },
							} satisfies SourceEnvelope<ModelSelectorMsg>],
							onSuccess: () => [{
								_tag: "MvuSource",
								stamp: command.stamp,
								message: { _tag: "SelectionSettled", stamp: command.stamp },
							} satisfies SourceEnvelope<ModelSelectorMsg>],
						}));
				}
			},
		};
	}

	apply(model: ModelSelectorRouteModel): void {
		this.#projection = model;
	}
	override dispose(): void {
		if (this.#disposed) return;
		this.#disposed = true;
		this.#unsubscribeAvailability();
		this.#availabilityDispatch = undefined;
		this.#pendingAvailability = undefined;
		super.dispose();
	}

	render(width: number): readonly string[] {
		const model = this.#projection;
		const lines: string[] = [];
		lines.push(...new DynamicBorder().render(width));
		lines.push("");
		lines.push(theme.fg("warning", "Only showing models with configured API keys (see README for details)"));
		lines.push("");
		const tabs = model.tabs.map((tab, index) => index === model.activeTabIndex ? theme.fg("accent", `[${tab.label}]`) : theme.fg("dim", tab.label));
		lines.push(`Models  ${tabs.join("  ")}`);
		const refresh = formatProviderRefreshStatus({
			providerId: model.tabs[model.activeTabIndex]?.providerId,
			providerRefreshes: model.providerRefreshes,
			authRefreshes: model.refreshingProviders,
			staleProviders: model.staleProviders,
			spinnerFrame: Math.floor(Date.now() / 80),
		});
		if (refresh) lines.push(refresh);
		lines.push("");
		const query = model.selector.mode._tag === "Filter" ? model.selector.mode.query : "";
		const roleScreen = model.screen._tag === "Role" ? model.screen : undefined;
		const roleModel = roleScreen === undefined
			? undefined
			: model.allModels.concat(model.canonicalModels).find(row => row.key === roleScreen.modelKey);
		lines.push(model.screen._tag === "Browse" ? `Filter: ${query}` : roleScreen === undefined ? "Thinking" : `Action for ${roleModel?.selector ?? roleScreen.modelKey}`);
		lines.push("");
		const ids = model.selector.mode._tag === "Filter" ? model.selector.filteredIds : model.selector.orderedIds;
		const byId = rowMap(model.rows);
		const start = Math.max(0, Math.min(model.selector.viewportOffset, Math.max(0, ids.length - 10)));
		for (const key of ids.slice(start, start + 10)) {
			const row = byId.get(key);
			if (row === undefined) continue;
			const selected = key === model.selector.selectedId;
			const prefix = selected ? theme.fg("accent", `${theme.nav.cursor} `) : "  ";
			if (row._tag !== "Model") {
				lines.push(`${prefix}${selected ? theme.fg("accent", row.label) : row.label}`);
				continue;
			}
			const badges: string[] = [];
			for (const [role, assignment] of Object.entries(model.roles)) {
				if (assignment === undefined || !modelsAreEqual(assignment.model, row.model)) continue;
				const info = getRoleInfo(role, this.#settings);
				if (info.hidden) continue;
				const label = info.tag ?? (role in MODEL_ROLES ? "" : info.name);
				if (label) badges.push(roleBadge(label, info.color ?? "success", assignment));
			}
			const provider = model.tabs[model.activeTabIndex]?.id === ALL_TAB ? theme.fg("dim", `${row.provider}/`) : "";
			const variants = row.variantCount === undefined ? "" : theme.fg("dim", ` [${row.variantCount}] -> ${row.model.provider}/${row.model.id}`);
			const label = selected ? theme.fg("accent", row.label) : row.label;
			lines.push(`${prefix}${provider}${label}${variants}${badges.length > 0 ? ` ${badges.join(" ")}` : ""}${formatContextWarningSuffix(row.model, this.#currentContextTokens)}${formatAuthStatusSuffix(row.provider, model.staleProviders, model.refreshingProviders)}`);
		}
		if (ids.length === 0) {
			const providerId = model.tabs[model.activeTabIndex]?.providerId;
			const discovery = providerId === undefined ? undefined : this.#registry.getProviderDiscoveryState(providerId);
			const empty = (discovery === undefined ? undefined : formatProviderEmptyStateMessage(discovery, formatDiscoveryAge(discovery.fetchedAt))) ?? "  No matching models";
			lines.push(theme.fg("muted", empty));
		}
		if (model.error !== undefined) lines.push(theme.fg("error", model.error));
		const selected = model.selector.selectedId === undefined ? undefined : byId.get(model.selector.selectedId);
		if (selected?._tag === "Model") {
			const classification = classifyModelSelectorItem({ currentContextTokens: this.#currentContextTokens, contextWindow: selected.model.contextWindow });
			lines.push("");
			lines.push(theme.fg("muted", `  Model Name: ${selected.model.name}${classification.contextWarning ? ` — ${classification.contextWarning}` : ""}`));
		}
		lines.push("");
		const dismissDescription = model.screen._tag === "Role" ? "cancel" : "back";
		lines.push(theme.fg("dim", model.screen._tag === "Browse" ? `${editorKey("tui.select.confirm")}: select  ${editorKey("ui.dismiss")}: ${dismissDescription}` : `${editorKey("tui.select.confirm")}: continue  ${editorKey("ui.dismiss")}: ${dismissDescription}`));
		lines.push(...new DynamicBorder().render(width));
		return lines;
	}
}
