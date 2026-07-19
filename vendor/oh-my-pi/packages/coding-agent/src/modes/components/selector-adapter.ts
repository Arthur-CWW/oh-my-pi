import { Effect } from "effect";
import * as Schema from "effect/Schema";
import { Container, type Keybinding, truncateToWidth } from "@oh-my-pi/pi-tui";
import type { MvuEnvelope, MvuInputRoute } from "../mvu/input-lease";
import type { MvuRuntimeBoundary } from "../mvu/runtime";
import {
	makeSelectorModel,
	type RowProjectionContext,
	type SelectorActionStamp,
	type SelectorCommand,
	type SelectorModel,
	type SelectorMsg,
	updateSelector,
	viewSelector,
} from "../mvu/selector";
import { KeyEventSchema, RouteStampSchema, type ComponentId, type ContextId, type KeyEvent, type RouteStamp, type Transition, type ViewKey } from "../mvu/schema";

const SELECTOR_RESULT_ACTION = "mvu.selector.result" as Keybinding;
const NonNegativeInteger = Schema.Int.pipe(Schema.check(Schema.isGreaterThanOrEqualTo(0)));
const RouteStampTypeSchema = Schema.toType(RouteStampSchema);
const MvuEnvelopeSchema: Schema.ConstraintDecoder<MvuEnvelope, never> = Schema.toType(
	Schema.Struct({
		_tag: Schema.Literal("MvuInput"),
		action: Schema.String as Schema.Schema<Keybinding>,
		event: KeyEventSchema,
		stamp: Schema.optional(RouteStampSchema),
	}),
);
const SelectorResultWireSchema = Schema.Union([
	Schema.Struct({
		kind: Schema.Literal("SourceResolved"),
		purpose: Schema.Literals(["filter", "toggle"]),
		requestGeneration: NonNegativeInteger,
		encodedItems: Schema.String,
		sourceTag: Schema.optional(Schema.String),
	}),
	Schema.Struct({
		kind: Schema.Literal("SourceFailed"),
		purpose: Schema.Literals(["filter", "toggle"]),
		requestGeneration: NonNegativeInteger,
		error: Schema.String,
	}),
	Schema.Struct({
		kind: Schema.Literal("ActionSucceeded"),
		receiptId: Schema.String,
		action: Schema.String,
		id: Schema.String,
		sourceRevision: NonNegativeInteger,
		requestGeneration: NonNegativeInteger,
		nonce: Schema.String,
		removeKey: Schema.optional(Schema.String),
		message: Schema.optional(Schema.String),
	}),
	Schema.Struct({
		kind: Schema.Literal("ActionFailed"),
		receiptId: Schema.String,
		action: Schema.String,
		id: Schema.String,
		sourceRevision: NonNegativeInteger,
		requestGeneration: NonNegativeInteger,
		nonce: Schema.String,
		error: Schema.String,
	}),
]);
type SelectorResultWire = typeof SelectorResultWireSchema.Type;

export interface SelectorSurfaceProjectionContext extends RowProjectionContext {
	readonly query: string;
	readonly sourceTag: string | undefined;
	readonly totalItems: number;
}

export interface SelectorSourceSnapshot<Item> {
	readonly items: readonly Item[];
	readonly sources: ReadonlyMap<string, readonly Item[]>;
	readonly sourceTag: string | undefined;
}

export interface SelectorSourceResult<Item> {
	readonly items: readonly Item[];
	readonly sourceTag?: string;
}
function isSelectorSourceResult<Item>(
	result: readonly Item[] | SelectorSourceResult<Item>,
): result is SelectorSourceResult<Item> {
	return !Array.isArray(result);
}

export interface SelectorActionResult {
	readonly removeKey?: string;
	readonly message?: string;
}

export interface SelectorSurfaceOptions<Id, Item, Action extends Keybinding = Keybinding> {
	readonly componentId: ComponentId;
	readonly items: readonly Item[];
	readonly keyOf: (item: Item) => Id;
	readonly searchText?: (item: Item) => string;
	readonly renderRow: (item: Item, context: SelectorSurfaceProjectionContext, width: number) => readonly string[];
	readonly renderEmpty?: (query: string, width: number, sourceTag: string | undefined) => readonly string[];
	readonly renderConfirm?: (item: Item, width: number) => readonly string[];
	readonly renderStatus?: (model: SelectorModel<Id, Action>, width: number) => readonly string[];
	readonly initialSelectedId?: Id;
	readonly initialQuery?: string;
	readonly viewportSize?: number;
	readonly initialSourceTag?: string;
	readonly initialSources?: ReadonlyMap<string, readonly Item[]>;
	readonly keymapContexts?: readonly ContextId[];
	readonly onSelect?: (item: Item) => void;
	readonly onCancel?: () => void;
	readonly onExit?: () => void;
	readonly onAction?: (action: Action, item: Item) => void | SelectorActionResult | Promise<void | SelectorActionResult>;
	readonly closeOnFilterDismiss?: boolean;
	readonly onFilterChanged?: (query: string, snapshot: SelectorSourceSnapshot<Item>) => readonly Item[] | Promise<readonly Item[]>;
	readonly onToggleSource?: (snapshot: SelectorSourceSnapshot<Item>) => SelectorSourceResult<Item> | Promise<SelectorSourceResult<Item>>;
	readonly encodeItems?: (items: readonly Item[]) => string;
	readonly decodeItems?: (encoded: string) => readonly Item[];
	readonly onProjection?: (model: SelectorSurfaceModel<Id, Item, Action>) => void;
	readonly actionToMsg?: (
		action: Action,
		event: KeyEvent,
		model: SelectorModel<Id, Action>,
	) => SelectorMsg<Id, Action> | undefined;
}

export interface SelectorSurfaceModel<Id, Item, Action extends Keybinding = Keybinding> {
	readonly selector: SelectorModel<Id, Action>;
	readonly items: readonly Item[];
	readonly filterBaseItems: readonly Item[];
	readonly sources: ReadonlyMap<string, readonly Item[]>;
	readonly sourceTag: string | undefined;
	readonly requestGeneration: number;
	readonly leaseGeneration: number | undefined;
	readonly sourcePending: "toggle" | undefined;
}

type SelectorSurfaceCommand<Id, Item, Action extends Keybinding> =
	| {
			readonly _tag: "Render";
			readonly projection: SelectorSurfaceModel<Id, Item, Action>;
			readonly dirtyKeys: ReadonlySet<ViewKey>;
	  }
	| { readonly _tag: "Select"; readonly id: Id; readonly items: readonly Item[] }
	| { readonly _tag: "Cancel" }
	| { readonly _tag: "Exit" }
	| ({
			readonly _tag: "RunAction";
			readonly items: readonly Item[];
			readonly routeStamp: RouteStamp;
			readonly receiptId: string;
	  } & SelectorActionStamp<Id, Action>)
	| {
			readonly _tag: "ResolveSource";
			readonly purpose: "filter" | "toggle";
			readonly query: string;
			readonly snapshot: SelectorSourceSnapshot<Item>;
			readonly stamp: RouteStamp;
	  };

export interface SelectorSurfaceMountSpec<Id, Item, Action extends Keybinding = Keybinding> {
	readonly componentId: ComponentId;
	readonly component: SelectorSurface<Id, Item, Action>;
	readonly initialModel: SelectorSurfaceModel<Id, Item, Action>;
	readonly route: MvuInputRoute<SelectorSurfaceModel<Id, Item, Action>>;
	readonly boundary: MvuRuntimeBoundary<
		SelectorSurfaceModel<Id, Item, Action>,
		MvuEnvelope,
		SelectorSurfaceCommand<Id, Item, Action>
	>;
	readonly update: (
		model: SelectorSurfaceModel<Id, Item, Action>,
		message: MvuEnvelope,
	) => Transition<SelectorSurfaceModel<Id, Item, Action>, SelectorSurfaceCommand<Id, Item, Action>>;
	readonly interpret: (
		command: SelectorSurfaceCommand<Id, Item, Action>,
	) => Effect.Effect<readonly MvuEnvelope[]>;
}

/** Maps a resolved MVU action to the pure selector reducer message. */
export function selectorActionToMsg<Id, Action extends Keybinding = Keybinding>(
	action: string,
	event: KeyEvent,
	model: SelectorModel<Id, Action>,
	componentId: ComponentId,
): SelectorMsg<Id, Action> | undefined {
	if (event._tag !== "Press" && event._tag !== "Paste") return undefined;
	const text = event._tag === "Paste" ? event.text : event.text ?? String(event.key);
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
		case "app.selector.preview": return { _tag: "Activate" };
		case "tui.select.confirm":
			if (model.mode._tag === "Confirm") {
				return {
					_tag: "CommitArmed",
					id: model.selectedId as Id,
					sourceRevision: model.sourceRevision,
					nonce: model.mode.arm.nonce,
					redeemable: true,
				};
			}
			return { _tag: "DirectActivate", action: action as Action };
		case "ui.dismiss": return { _tag: "Back" };
		case "tui.select.delete":
		case "app.selector.delete":
		case "app.session.delete":
			return model.selectedId === undefined
				? undefined
				: { _tag: "Arm", action: action as Action, nonce: `${componentId}:${model.sourceRevision}:${String(model.selectedId)}` };
		case "app.history.cycle":
		case "history.search.cycle":
		case "tui.history.cycle": {
			const ids = model.filteredIds;
			if (ids.length === 0) return undefined;
			const index = model.selectedId === undefined ? -1 : ids.indexOf(model.selectedId);
			return index >= ids.length - 1 ? { _tag: "Jump", target: "first" } : { _tag: "Move", delta: 1 };
		}
		default: return undefined;
	}
}

function queryOf<Id, Action extends Keybinding>(model: SelectorModel<Id, Action>): string {
	const mode = model.mode;
	if (mode._tag === "Filter") return mode.query;
	if (mode._tag === "PreviewFocus" || mode._tag === "Confirm") return mode.returnTo._tag === "Filter" ? mode.returnTo.query : "";
	return "";
}

interface SelectorSurfaceCachedRow<Id, Item> {
	readonly id: Id;
	readonly item: Item;
	readonly selected: boolean;
	readonly focused: boolean;
	readonly index: number;
	readonly query: string;
	readonly sourceTag: string | undefined;
	readonly totalItems: number;
	readonly width: number;
	readonly lines: readonly string[];
}

/** Renderer-only adapter. Its mutable fields are a projection of runtime commits, never reducer authority. */
export class SelectorSurface<Id, Item, Action extends Keybinding = Keybinding> extends Container {
	readonly #options: SelectorSurfaceOptions<Id, Item, Action>;
	readonly #mountSpec: SelectorSurfaceMountSpec<Id, Item, Action>;
	#projection: SelectorSurfaceModel<Id, Item, Action>;
	#itemsById: ReadonlyMap<Id, Item>;
	#dirtyKeys: ReadonlySet<ViewKey> = new Set(["selector.rows"]);
	#rowCache = new Map<Id, SelectorSurfaceCachedRow<Id, Item>>();

	constructor(options: SelectorSurfaceOptions<Id, Item, Action>) {
		super();
		this.#options = options;
		const searchTextById = this.#searchTextById(options.items);
		let selector = makeSelectorModel<Id, Action>(options.items.map(options.keyOf), 0, searchTextById);
		if (options.initialSelectedId !== undefined) {
			const selectedIndex = options.items.findIndex(item => options.keyOf(item) === options.initialSelectedId);
			if (selectedIndex >= 0) {
				selector = {
					...selector,
					selectedId: options.initialSelectedId,
					selectedIndex,
					viewportOffset: Math.max(0, selectedIndex - selector.viewportSize + 1),
				};
			}
		}
		if (options.initialQuery !== undefined && options.initialQuery.length > 0) {
			selector = updateSelector(selector, { _tag: "BeginFilter" }).model;
			selector = updateSelector(selector, { _tag: "FilterAppend", text: options.initialQuery }).model;
		}
		if (options.viewportSize !== undefined && options.viewportSize !== selector.viewportSize) {
			selector = updateSelector(selector, {
				_tag: "ViewportChanged",
				offset: selector.viewportOffset,
				height: Math.max(1, options.viewportSize),
			}).model;
		}
		const sources = new Map(options.initialSources ?? []);
		if (options.initialSourceTag !== undefined && !sources.has(options.initialSourceTag)) {
			sources.set(options.initialSourceTag, options.items);
		}
		this.#projection = {
			selector,
			items: options.items,
			filterBaseItems: options.items,
			sources,
			sourceTag: options.initialSourceTag,
			requestGeneration: 0,
			leaseGeneration: undefined,
			sourcePending: undefined,
		};
		this.#itemsById = this.#buildMap(options.items);
		this.#mountSpec = this.#buildMountSpec();
	}

	#buildMap(items: readonly Item[]): ReadonlyMap<Id, Item> {
		return new Map(items.map(item => [this.#options.keyOf(item), item]));
	}

	#searchTextById(items: readonly Item[]): ReadonlyMap<Id, string> {
		const searchTextById = new Map<Id, string>();
		for (const item of items) {
			searchTextById.set(this.#options.keyOf(item), this.#options.searchText?.(item) ?? String(this.#options.keyOf(item)));
		}
		return searchTextById;
	}

	#modelWithSource(model: SelectorModel<Id, Action>, items: readonly Item[], resetSelection: boolean): SelectorModel<Id, Action> {
		const replaced = updateSelector(model, {
			_tag: "SourceReplaced",
			sourceRevision: model.sourceRevision + 1,
			orderedIds: items.map(this.#options.keyOf),
			searchTextById: this.#searchTextById(items),
		}).model;
		return resetSelection ? updateSelector(replaced, { _tag: "Jump", target: "first" }).model : replaced;
	}

	#applyProjection(
		projection: SelectorSurfaceModel<Id, Item, Action>,
		dirtyKeys: ReadonlySet<ViewKey>,
	): void {
		if (projection.items !== this.#projection.items) {
			this.#itemsById = this.#buildMap(projection.items);
			const retained = new Set(projection.items.map(this.#options.keyOf));
			for (const key of this.#rowCache.keys()) {
				if (!retained.has(key)) this.#rowCache.delete(key);
			}
		}
		this.#projection = projection;
		this.#dirtyKeys = dirtyKeys;
		this.#options.onProjection?.(projection);
	}

	get mountSpec(): SelectorSurfaceMountSpec<Id, Item, Action> {
		return this.#mountSpec;
	}

	#currentStamp(model: SelectorSurfaceModel<Id, Item, Action>): RouteStamp {
		return {
			componentId: this.#options.componentId,
			leaseGeneration: model.leaseGeneration ?? 0,
			sourceRevision: model.selector.sourceRevision,
			requestGeneration: model.requestGeneration,
		};
	}

	#stamp(model: SelectorSurfaceModel<Id, Item, Action>, input: MvuEnvelope): RouteStamp {
		return input.stamp ?? this.#currentStamp(model);
	}

	#resultEnvelope(wire: SelectorResultWire, stamp: RouteStamp): MvuEnvelope {
		const decodedStamp = Schema.decodeSync(RouteStampTypeSchema)(stamp, { onExcessProperty: "error" });
		return {
			_tag: "MvuInput",
			action: SELECTOR_RESULT_ACTION,
			event: { _tag: "Paste", text: JSON.stringify(wire) },
			stamp: decodedStamp,
		};
	}

	#decodeResult(envelope: MvuEnvelope): SelectorResultWire | undefined {
		if (envelope.action !== SELECTOR_RESULT_ACTION || envelope.event._tag !== "Paste") return undefined;
		try {
			if (envelope.stamp === undefined) return undefined;
			Schema.decodeSync(RouteStampTypeSchema)(envelope.stamp, { onExcessProperty: "error" });
			return Schema.decodeUnknownSync(SelectorResultWireSchema)(JSON.parse(envelope.event.text), { onExcessProperty: "error" });
		} catch {
			return undefined;
		}
	}

	#validInputStamp(model: SelectorSurfaceModel<Id, Item, Action>, envelope: MvuEnvelope): boolean {
		const stamp = envelope.stamp;
		if (stamp === undefined) return true;
		if (stamp.componentId !== this.#options.componentId) return false;
		return model.leaseGeneration === undefined || model.leaseGeneration === stamp.leaseGeneration;
	}

	#validResultStamp(model: SelectorSurfaceModel<Id, Item, Action>, envelope: MvuEnvelope, requestGeneration: number): boolean {
		const stamp = envelope.stamp;
		return stamp !== undefined &&
			stamp.componentId === this.#options.componentId &&
			(model.leaseGeneration === undefined || stamp.leaseGeneration === model.leaseGeneration) &&
			stamp.sourceRevision === model.selector.sourceRevision &&
			stamp.requestGeneration === requestGeneration &&
			requestGeneration === model.requestGeneration;
	}

	#renderCommand(
		model: SelectorSurfaceModel<Id, Item, Action>,
		dirtyKeys: ReadonlySet<ViewKey>,
	): SelectorSurfaceCommand<Id, Item, Action> {
		return { _tag: "Render", projection: model, dirtyKeys };
	}

	#applyResult(
		model: SelectorSurfaceModel<Id, Item, Action>,
		envelope: MvuEnvelope,
		wire: SelectorResultWire,
	): Transition<SelectorSurfaceModel<Id, Item, Action>, SelectorSurfaceCommand<Id, Item, Action>> {
		if (wire.kind === "SourceResolved" || wire.kind === "SourceFailed") {
			if (!this.#validResultStamp(model, envelope, wire.requestGeneration)) return { model, commands: [], dirtyKeys: new Set() };
			if (wire.kind === "SourceFailed") {
				const next = { ...model, sourcePending: undefined };
				const dirtyKeys = new Set<ViewKey>(["selector.status"]);
				return { model: next, commands: [this.#renderCommand(next, dirtyKeys)], dirtyKeys };
			}
			let items: readonly Item[];
			try {
				items = this.#options.decodeItems?.(wire.encodedItems) ?? [];
			} catch {
				const next = { ...model, sourcePending: undefined };
				const dirtyKeys = new Set<ViewKey>(["selector.status"]);
				return { model: next, commands: [this.#renderCommand(next, dirtyKeys)], dirtyKeys };
			}
			const selector = this.#modelWithSource(model.selector, items, true);
			if (wire.purpose === "toggle") {
				const sourceTag = wire.sourceTag;
				const sources = new Map(model.sources);
				if (sourceTag !== undefined) sources.set(sourceTag, items);
				const next = { ...model, selector, items, filterBaseItems: items, sources, sourceTag, sourcePending: undefined };
				const dirtyKeys = new Set<ViewKey>(["selector.rows", "selector.status"]);
				return { model: next, commands: [this.#renderCommand(next, dirtyKeys)], dirtyKeys };
			}
			const next = { ...model, selector, items, sourcePending: undefined };
			const dirtyKeys = new Set<ViewKey>(["selector.rows"]);
			return { model: next, commands: [this.#renderCommand(next, dirtyKeys)], dirtyKeys };
		}

		if (!this.#validResultStamp(model, envelope, model.requestGeneration)) return { model, commands: [], dirtyKeys: new Set() };
		const pending = model.selector.receipt;
		if (pending._tag !== "Pending" ||
			String(pending.id) !== wire.id ||
			pending.action !== wire.action ||
			pending.sourceRevision !== wire.sourceRevision ||
			pending.requestGeneration !== wire.requestGeneration ||
			pending.nonce !== wire.nonce ||
			pending.receiptId !== wire.receiptId) {
			return { model, commands: [], dirtyKeys: new Set() };
		}
		const actionStamp: SelectorActionStamp<Id, Action> = {
			id: pending.id,
			action: wire.action as Action,
			sourceRevision: wire.sourceRevision,
			requestGeneration: wire.requestGeneration,
			nonce: wire.nonce,
		};
		let selector = updateSelector(
			model.selector,
			wire.kind === "ActionSucceeded"
				? { _tag: "ActionSucceeded", ...actionStamp, receiptId: wire.receiptId, ...(wire.message === undefined ? {} : { message: wire.message }) }
				: { _tag: "ActionFailed", ...actionStamp, receiptId: wire.receiptId, error: wire.error },
		).model;
		let items = model.items;
		let filterBaseItems = model.filterBaseItems;
		let sources = model.sources;
		if (wire.kind === "ActionSucceeded" && wire.removeKey !== undefined) {
			const keep = (item: Item): boolean => String(this.#options.keyOf(item)) !== wire.removeKey;
			items = items.filter(keep);
			filterBaseItems = filterBaseItems.filter(keep);
			sources = new Map([...sources].map(([tag, source]) => [tag, source.filter(keep)] as const));
			selector = this.#modelWithSource(selector, items, false);
		}
		const dirtyKeys = new Set<ViewKey>(["selector.rows", "selector.status"]);
		const next: SelectorSurfaceModel<Id, Item, Action> = { ...model, selector, items, filterBaseItems, sources };
		return { model: next, commands: [this.#renderCommand(next, dirtyKeys)], dirtyKeys };
	}

	#buildMountSpec(): SelectorSurfaceMountSpec<Id, Item, Action> {
		const componentId = this.#options.componentId;
		const keymapContexts: readonly ContextId[] = ["selector.global", "selector.filter", ...(this.#options.keymapContexts ?? [])];
		return {
			componentId,
			component: this,
			initialModel: this.#projection,
			route: {
				componentId,
				focusedRoot: this,
				context: model => ({
					contexts: keymapContexts,
					mode: model.selector.mode._tag,
					focus: model.selector.mode._tag === "PreviewFocus" || model.selector.mode._tag === "Confirm" ? "preview" : "list",
					capabilities: new Set(["selector.filter"]),
				}),
				activateLease: (model, leaseGeneration) => {
					const activated = { ...model, leaseGeneration };
					this.#projection = activated;
					return activated;
				},
				actionToMsg: (action, event) => ({ _tag: "MvuInput", action, event }),
			},
			boundary: {
				messageSchema: MvuEnvelopeSchema,
				currentStamp: model => this.#currentStamp(model),
				commandStamp: command => {
					switch (command._tag) {
						case "Render": return this.#currentStamp(command.projection);
						case "Select":
						case "Cancel":
						case "Exit": return this.#currentStamp(this.#projection);
						case "RunAction": return command.routeStamp;
						case "ResolveSource": return command.stamp;
					}
				},
			},
			update: (current, envelope) => {
				const result = this.#decodeResult(envelope);
				if (result !== undefined) return this.#applyResult(current, envelope, result);
				if (!this.#validInputStamp(current, envelope)) return { model: current, commands: [], dirtyKeys: new Set() };
				let model = current.leaseGeneration === undefined && envelope.stamp !== undefined
					? { ...current, leaseGeneration: envelope.stamp.leaseGeneration }
					: current;
				const action = String(envelope.action);
				if (action === "app.exit") return { model, commands: [{ _tag: "Exit" }], dirtyKeys: new Set() };
				if (action === "app.session.toggleScope" || action === "app.session.togglePath" || action === "app.selector.toggleScope") {
					if (this.#options.onToggleSource === undefined || this.#options.encodeItems === undefined || this.#options.decodeItems === undefined) {
						return { model, commands: [], dirtyKeys: new Set() };
					}
					const requestGeneration = model.requestGeneration + 1;
					model = { ...model, requestGeneration, sourcePending: "toggle" };
					const stamp = { ...this.#stamp(model, envelope), sourceRevision: model.selector.sourceRevision, requestGeneration };
					const dirtyKeys = new Set<ViewKey>(["selector.status"]);
					return {
						model,
						commands: [this.#renderCommand(model, dirtyKeys), {
							_tag: "ResolveSource",
							purpose: "toggle",
							query: queryOf(model.selector),
							snapshot: { items: model.items, sources: model.sources, sourceTag: model.sourceTag },
							stamp,
						}],
						dirtyKeys,
					};
				}
				if (action === "ui.dismiss" && this.#options.closeOnFilterDismiss && model.selector.mode._tag === "Filter") {
					return { model, commands: [{ _tag: "Cancel" }], dirtyKeys: new Set() };
				}
				const message = this.#options.actionToMsg?.(envelope.action as Action, envelope.event, model.selector)
					?? selectorActionToMsg(action, envelope.event, model.selector, componentId);
				if (message === undefined) return { model, commands: [], dirtyKeys: new Set() };
				const previousQuery = queryOf(model.selector);
				const previousMode = model.selector.mode;
				const reducer = updateSelector(model.selector, message);
				let selector = reducer.model;
				let items = model.items;
				let filterBaseItems = message._tag === "BeginFilter" ? model.items : model.filterBaseItems;
				if (message._tag === "Back" && previousMode._tag === "Filter" && selector.mode._tag === "Browse") {
					items = filterBaseItems;
					selector = this.#modelWithSource(selector, items, false);
				}
				let next: SelectorSurfaceModel<Id, Item, Action> = { ...model, selector, items, filterBaseItems };
				const commands: SelectorSurfaceCommand<Id, Item, Action>[] = [this.#renderCommand(next, reducer.dirtyKeys)];
				const stamp = { ...this.#stamp(next, envelope), sourceRevision: next.selector.sourceRevision, requestGeneration: next.requestGeneration };
				for (const command of reducer.commands) {
					switch (command._tag) {
						case "CloseRequested": commands.push({ _tag: "Cancel" }); break;
						case "PreviewRequested": commands.push({ _tag: "Select", id: command.id, items: next.items }); break;
						case "Activate":
							if (String(command.action) === "tui.select.confirm") commands.push({ _tag: "Select", id: command.id, items: next.items });
							else commands.push({ ...command, _tag: "RunAction", items: next.items, routeStamp: stamp, receiptId: command.nonce });
							break;
						case "SpendReset": commands.push({ ...command, _tag: "RunAction", items: next.items, routeStamp: stamp, receiptId: command.nonce }); break;
					}
				}
				const nextQuery = queryOf(selector);
				if (nextQuery !== previousQuery && this.#options.onFilterChanged !== undefined && this.#options.encodeItems !== undefined && this.#options.decodeItems !== undefined) {
					const requestGeneration = next.requestGeneration + 1;
					next = { ...next, requestGeneration };
					commands[0] = this.#renderCommand(next, reducer.dirtyKeys);
					commands.push({
						_tag: "ResolveSource",
						purpose: "filter",
						query: nextQuery,
						snapshot: { items: next.items, sources: next.sources, sourceTag: next.sourceTag },
						stamp: { ...stamp, sourceRevision: next.selector.sourceRevision, requestGeneration },
					});
				}
				return { model: next, commands, dirtyKeys: reducer.dirtyKeys };
			},
			interpret: command => {
				switch (command._tag) {
					case "Render": return Effect.sync(() => { this.#applyProjection(command.projection, command.dirtyKeys); return []; });
					case "Select": return Effect.sync(() => { const item = command.items.find(candidate => this.#options.keyOf(candidate) === command.id); if (item !== undefined) this.#options.onSelect?.(item); return []; });
					case "Cancel": return Effect.sync(() => { this.#options.onCancel?.(); return []; });
					case "Exit": return Effect.sync(() => { this.#options.onExit?.(); return []; });
					case "RunAction": {
						const item = command.items.find(candidate => this.#options.keyOf(candidate) === command.id);
						if (item === undefined) return Effect.succeed([]);
						const resultStamp = {
							action: String(command.action),
							id: String(command.id),
							sourceRevision: command.sourceRevision,
							requestGeneration: command.requestGeneration,
							nonce: command.nonce,
						};
						return Effect.tryPromise({
							try: () => Promise.resolve(this.#options.onAction?.(command.action, item)),
							catch: error => String(error),
						}).pipe(Effect.match({
							onFailure: error => [this.#resultEnvelope({ kind: "ActionFailed", ...resultStamp, receiptId: command.receiptId, error }, command.routeStamp)],
							onSuccess: outcome => [this.#resultEnvelope({
								kind: "ActionSucceeded",
								...resultStamp,
								receiptId: command.receiptId,
								...(outcome?.removeKey === undefined ? {} : { removeKey: outcome.removeKey }),
								...(outcome?.message === undefined ? {} : { message: outcome.message }),
							}, command.routeStamp)],
						}));
					}
					case "ResolveSource":
						return Effect.suspend(() => {
							const succeeded = (
								result: readonly Item[] | SelectorSourceResult<Item> | undefined,
							): readonly MvuEnvelope[] => {
								if (result === undefined || this.#options.encodeItems === undefined) {
									return [this.#resultEnvelope({ kind: "SourceFailed", purpose: command.purpose, requestGeneration: command.stamp.requestGeneration, error: "Selector source returned no result" }, command.stamp)];
								}
								const resolved: SelectorSourceResult<Item> = isSelectorSourceResult(result)
									? result
									: { items: result };
								return [this.#resultEnvelope({
									kind: "SourceResolved",
									purpose: command.purpose,
									requestGeneration: command.stamp.requestGeneration,
									encodedItems: this.#options.encodeItems(resolved.items),
									...(resolved.sourceTag === undefined ? {} : { sourceTag: resolved.sourceTag }),
								}, command.stamp)];
							};
							const failed = (error: string): readonly MvuEnvelope[] => [
								this.#resultEnvelope({ kind: "SourceFailed", purpose: command.purpose, requestGeneration: command.stamp.requestGeneration, error }, command.stamp),
							];
							try {
								if (command.purpose === "filter") {
									const result = this.#options.onFilterChanged?.(command.query, command.snapshot);
									return result instanceof Promise
										? Effect.tryPromise({ try: () => result, catch: error => String(error) }).pipe(
												Effect.match({ onFailure: failed, onSuccess: succeeded }),
										  )
										: Effect.succeed(succeeded(result));
								}
								const result = this.#options.onToggleSource?.(command.snapshot);
								return result instanceof Promise
									? Effect.tryPromise({ try: () => result, catch: error => String(error) }).pipe(
											Effect.match({ onFailure: failed, onSuccess: succeeded }),
									  )
									: Effect.succeed(succeeded(result));
							} catch (error) {
								return Effect.succeed(failed(String(error)));
							}
						});
				}
			},
		};
	}

	#isDirty(id: Id): boolean {
		if (this.#dirtyKeys.has("selector.rows")) return true;
		for (const dirtyKey of this.#dirtyKeys) {
			if (Object.is(dirtyKey, id)) return true;
		}
		return false;
	}

	#renderRow(
		id: Id,
		item: Item,
		context: SelectorSurfaceProjectionContext,
		width: number,
	): readonly string[] {
		const cached = this.#rowCache.get(id);
		if (
			cached !== undefined &&
			!this.#isDirty(id) &&
			Object.is(cached.item, item) &&
			cached.selected === context.selected &&
			cached.focused === context.focused &&
			cached.index === context.index &&
			cached.query === context.query &&
			cached.sourceTag === context.sourceTag &&
			cached.totalItems === context.totalItems &&
			cached.width === width
		) {
			return cached.lines;
		}
		const lines = this.#options.renderRow(item, context, width);
		this.#rowCache.set(id, {
			id,
			item,
			selected: context.selected,
			focused: context.focused,
			index: context.index,
			query: context.query,
			sourceTag: context.sourceTag,
			totalItems: context.totalItems,
			width,
			lines,
		});
		return lines;
	}

	render(width: number): readonly string[] {
		const projection = this.#projection;
		const selector = projection.selector;
		const view = viewSelector(
			selector,
			this.#itemsById,
			{ offset: selector.viewportOffset, height: selector.viewportSize },
			{ value: null, lines: () => [] },
		);
		const query = queryOf(selector);
		if (selector.mode._tag === "Confirm") {
			const item = selector.selectedId === undefined ? undefined : this.#itemsById.get(selector.selectedId);
			this.#dirtyKeys = new Set();
			return item === undefined ? [] : this.#options.renderConfirm?.(item, width) ?? this.#options.renderRow(item, { selected: true, focused: true, index: 0, query, sourceTag: projection.sourceTag, totalItems: projection.items.length }, width);
		}
		if (view.visibleRows.length === 0) {
			this.#rowCache.clear();
			this.#dirtyKeys = new Set();
			return this.#options.renderEmpty?.(query, width, projection.sourceTag) ?? [];
		}
		const visibleKeys = new Set(view.visibleRows.map(row => row.key));
		for (const key of this.#rowCache.keys()) {
			if (!visibleKeys.has(key)) this.#rowCache.delete(key);
		}
		const lines: string[] = [];
		for (let index = 0; index < view.visibleRows.length; index++) {
			const keyed = view.visibleRows[index]!;
			const item = this.#itemsById.get(keyed.key);
			if (item === undefined) continue;
			lines.push(...this.#renderRow(keyed.key, item, {
				selected: keyed.key === view.selectedKey,
				focused: view.focus === "table",
				index: selector.viewportOffset + index,
				query,
				sourceTag: projection.sourceTag,
				totalItems: projection.items.length,
			}, width));
		}
		this.#dirtyKeys = new Set();
		const status = this.#options.renderStatus?.(selector, width);
		if (status !== undefined) lines.push(...status);
		else if (selector.receipt._tag === "Failed") lines.push(truncateToWidth(`  Error: ${selector.receipt.error.replace(/\s+/g, " ")}`, width));
		return lines;
	}
}
