import { fuzzyMatch, type Keybinding, type KeyId } from "@oh-my-pi/pi-tui";
import type {
	KeyedRow,
	KeyedSelectorView,
	PreviewProjection,
	Viewport,
	ViewFocus,
} from "./keyed-view";
import { visibleKeyedRows } from "./keyed-view";
import type { StatusProjection } from "./status";
import type {
	CapabilityId,
	ComponentId,
	Transition,
	Update,
	ViewKey,
} from "./schema";

export interface Browse {
	readonly _tag: "Browse";
}

export interface Filter {
	readonly _tag: "Filter";
	readonly query: string;
}

export interface PreviewFocus {
	readonly _tag: "PreviewFocus";
	readonly returnTo: Browse | Filter;
}

export interface ResetArm<Id, Action extends Keybinding = Keybinding> {
	readonly action: Action;
	readonly targetId: Id;
	readonly sourceRevision: number;
	readonly nonce: string;
}

export interface Confirm<Id, Action extends Keybinding = Keybinding> {
	readonly _tag: "Confirm";
	readonly returnTo: PreviewFocus;
	readonly arm: ResetArm<Id, Action>;
}

export type SelectorMode<Id, Action extends Keybinding = Keybinding> = Browse | Filter | PreviewFocus | Confirm<Id, Action>;

export type PreviewState<Id> =
	| { readonly _tag: "Empty" }
	| { readonly _tag: "Loading"; readonly id: Id; readonly sourceRevision: number; readonly requestGeneration: number }
	| {
			readonly _tag: "Ready";
			readonly id: Id;
			readonly sourceRevision: number;
			readonly requestGeneration: number;
			readonly key: string;
		  }
	| {
			readonly _tag: "Failed";
			readonly id: Id;
			readonly sourceRevision: number;
			readonly requestGeneration: number;
			readonly error: string;
		  };
export interface SelectorActionStamp<Id, Action extends Keybinding = Keybinding> {
	readonly id: Id;
	readonly action: Action;
	readonly sourceRevision: number;
	readonly requestGeneration: number;
	readonly nonce: string;
}
export interface SelectorReceiptStamp<Id> {
	readonly action: string;
	readonly id: Id;
	readonly sourceRevision: number;
	readonly requestGeneration: number;
	readonly nonce: string;
}

export type SelectorReceiptState<Id> =
	| { readonly _tag: "None" }
	| (SelectorReceiptStamp<Id> & { readonly _tag: "Pending"; readonly receiptId: string })
	| (SelectorReceiptStamp<Id> & { readonly _tag: "Succeeded"; readonly receiptId: string; readonly message?: string })
	| (SelectorReceiptStamp<Id> & { readonly _tag: "Failed"; readonly receiptId: string; readonly error: string });

const noSelectorReceipt = <Id>(): SelectorReceiptState<Id> => ({ _tag: "None" });



export interface SelectorModel<Id, Action extends Keybinding = Keybinding> {
	readonly sourceRevision: number;
	readonly orderedIds: readonly Id[];
	readonly selectedId?: Id;
	readonly selectedIndex: number;
	readonly visibleIndexById: ReadonlyMap<Id, number>;
	readonly viewportOffset: number;
	readonly mode: SelectorMode<Id, Action>;
	readonly preview: PreviewState<Id>;
	readonly previewRequestGeneration: number;
	readonly actionRequestGeneration: number;
	readonly receipt: SelectorReceiptState<Id>;
	readonly filteredIds: readonly Id[];
	readonly viewportSize: number;
	readonly searchTextById?: ReadonlyMap<Id, string>;
}

export interface RowProjectionContext {
	readonly selected: boolean;
	readonly focused: boolean;
	readonly index: number;
}

export interface SelectorAdapter<Id, Item, Row, Preview, Action extends Keybinding> {
	readonly componentId: ComponentId;
	readonly capabilities: ReadonlySet<CapabilityId>;
	readonly keyOf: (item: Item) => Id;
	readonly searchText: (item: Item) => string;
	readonly row: (item: Item, context: RowProjectionContext) => Row;
	readonly preview: (item: Item) => Preview;
	readonly activate: (id: Id, model: SelectorModel<Id, Action>) => SelectorActivation<Action, Id>;
}

export type SelectorActivation<Action extends Keybinding, Id> =
	| { readonly _tag: "OpenPreview"; readonly id: Id }
	| { readonly _tag: "Command"; readonly action: Action; readonly id: Id }
	| { readonly _tag: "Confirm"; readonly action: Action; readonly id: Id; readonly nonce: string }
	| { readonly _tag: "Noop" };

export type SelectorCommand<Action extends Keybinding, Id> =
	| { readonly _tag: "CloseRequested" }
	| { readonly _tag: "PreviewRequested"; readonly id: Id; readonly requestGeneration: number }
	| ({ readonly _tag: "Activate" } & SelectorActionStamp<Id, Action>)
	| ({ readonly _tag: "SpendReset" } & SelectorActionStamp<Id, Action>);

export type SelectorMsg<Id, Action extends Keybinding = Keybinding> =
	| { readonly _tag: "Move"; readonly delta: -1 | 1 }
	| { readonly _tag: "Page"; readonly delta: -1 | 1 }
	| { readonly _tag: "Jump"; readonly target: "first" | "last" }
	| { readonly _tag: "BeginFilter" }
	| { readonly _tag: "FilterAppend"; readonly text: string }
	| { readonly _tag: "FilterDelete" }
	| { readonly _tag: "Back" }
	| { readonly _tag: "Activate"; readonly action?: Action }
	| { readonly _tag: "DirectActivate"; readonly action: Action }
	| { readonly _tag: "PreviewRequested"; readonly requestGeneration: number }
	| {
			readonly _tag: "PreviewLoaded";
			readonly id: Id;
			readonly sourceRevision: number;
			readonly requestGeneration: number;
			readonly key: string;
	  }
	| {
			readonly _tag: "PreviewFailed";
			readonly id: Id;
			readonly sourceRevision: number;
			readonly requestGeneration: number;
			readonly error: string;
	  }
	| { readonly _tag: "Arm"; readonly action: Action; readonly nonce: string }
	| {
			readonly _tag: "CommitArmed";
			readonly id: Id;
			readonly sourceRevision: number;
			readonly nonce: string;
			readonly redeemable: boolean;
	  }
	| ({ readonly _tag: "ActionSucceeded"; readonly receiptId: string; readonly message?: string } & SelectorActionStamp<Id, Action>)
	| ({ readonly _tag: "ActionFailed"; readonly receiptId: string; readonly error: string } & SelectorActionStamp<Id, Action>)
	| {
			readonly _tag: "SourceReplaced";
			readonly sourceRevision: number;
			readonly orderedIds: readonly Id[];
			readonly searchTextById?: ReadonlyMap<Id, string>;
	  }
	| { readonly _tag: "ViewportChanged"; readonly offset: number; readonly height: number };

const browse: Browse = { _tag: "Browse" };

function modeQuery<Id, Action extends Keybinding>(mode: SelectorMode<Id, Action>): string | undefined {
	if (mode._tag === "Filter") return mode.query;
	if (mode._tag === "PreviewFocus" || mode._tag === "Confirm") return modeQuery<Id, Action>(mode.returnTo);
	return undefined;
}

function visibleIds<Id, Action extends Keybinding>(model: SelectorModel<Id, Action>): readonly Id[] {
	return modeQuery<Id, Action>(model.mode) === undefined ? model.orderedIds : model.filteredIds;
}

function matchesQuery<Id>(id: Id, query: string, searchTextById: ReadonlyMap<Id, string> | undefined): boolean {
	if (query.length === 0) return true;
	const haystack = (searchTextById?.get(id) ?? String(id)).toLocaleLowerCase();
	return fuzzyMatch(query, haystack).matches;
}

function deriveFilteredIds<Id>(
	orderedIds: readonly Id[],
	query: string,
	searchTextById: ReadonlyMap<Id, string> | undefined,
): readonly Id[] {
	if (query.length === 0) return orderedIds;
	const normalizedQuery = query.toLocaleLowerCase();
	return orderedIds.filter(id => matchesQuery(id, normalizedQuery, searchTextById));
}
function deriveIndexById<Id>(ids: readonly Id[]): ReadonlyMap<Id, number> {
	const indexById = new Map<Id, number>();
	for (let index = 0; index < ids.length; index += 1) {
		const id = ids[index];
		if (id !== undefined) indexById.set(id, index);
	}
	return indexById;
}


function clampIndex(index: number, length: number): number {
	if (length <= 0) return -1;
	return Math.max(0, Math.min(index, length - 1));
}

function selectVisible<Id, Action extends Keybinding>(
	model: SelectorModel<Id, Action>,
	ids: readonly Id[],
	index: number,
): SelectorModel<Id, Action> {
	if (ids.length === 0) {
		return {
			...model,
			selectedId: undefined,
			selectedIndex: -1,
			viewportOffset: 0,
			receipt: noSelectorReceipt<Id>(),
		};
	}
	const selectedIndex = clampIndex(index, ids.length);
	const selectedId = ids[selectedIndex];
	if (selectedId === undefined) {
		return {
			...model,
			selectedId: undefined,
			selectedIndex: -1,
			viewportOffset: 0,
			receipt: noSelectorReceipt<Id>(),
		};
	}
	const viewportSize = Math.max(1, model.viewportSize);
	const viewportOffset = Math.max(0, Math.min(
		model.viewportOffset,
		Math.max(0, ids.length - viewportSize),
	));
	const nextOffset = selectedIndex < viewportOffset
		? selectedIndex
		: selectedIndex >= viewportOffset + viewportSize
			? selectedIndex - viewportSize + 1
			: viewportOffset;
	return {
		...model,
		selectedId,
		selectedIndex,
		viewportOffset: nextOffset,
		receipt: model.selectedId !== selectedId ? noSelectorReceipt<Id>() : model.receipt,
	};
}

function preserveSelection<Id, Action extends Keybinding>(
	model: SelectorModel<Id, Action>,
	ids: readonly Id[],
	indexById: ReadonlyMap<Id, number>,
): SelectorModel<Id, Action> {
	const currentIndex = model.selectedId === undefined ? undefined : indexById.get(model.selectedId);
	return selectVisible<Id, Action>(model, ids, currentIndex ?? 0);
}

function dirty<Id, Action extends Keybinding>(
	before: SelectorModel<Id, Action>,
	after: SelectorModel<Id, Action>,
	keys: readonly ViewKey[] = [],
): ReadonlySet<ViewKey> {
	const result = new Set<ViewKey>(keys);
	if (before.selectedId !== after.selectedId) {
		if (before.selectedId !== undefined) result.add(String(before.selectedId));
		if (after.selectedId !== undefined) result.add(String(after.selectedId));
	}
	if (modeQuery<Id, Action>(before.mode) !== modeQuery<Id, Action>(after.mode)) result.add("search");
	if (before.mode._tag !== after.mode._tag) result.add("focus");
	if (before.preview !== after.preview) result.add("preview");
	if (before.receipt !== after.receipt) result.add("status");
	return result;
}

function transition<Id, Action extends Keybinding, Command>(
	before: SelectorModel<Id, Action>,
	after: SelectorModel<Id, Action>,
	commands: readonly Command[] = [],
	keys: readonly ViewKey[] = [],
): Transition<SelectorModel<Id, Action>, Command> {
	return { model: after, commands, dirtyKeys: dirty(before, after, keys) };
}

function modeAfterConfirm<Id, Action extends Keybinding>(mode: Confirm<Id, Action>): PreviewFocus {
	return mode.returnTo;
}

function modeBeforeConfirm<Id, Action extends Keybinding>(
	mode: SelectorMode<Id, Action>,
): PreviewFocus | undefined {
	if (mode._tag === "Confirm") return undefined;
	if (mode._tag === "PreviewFocus") return mode;
	return { _tag: "PreviewFocus", returnTo: mode };
}

function returnToMode<Id, Action extends Keybinding>(mode: SelectorMode<Id, Action>): Browse | Filter {
	if (mode._tag === "PreviewFocus") return mode.returnTo;
	if (mode._tag === "Confirm") return mode.returnTo.returnTo;
	return mode;
}

export function makeSelectorModel<Id, Action extends Keybinding = Keybinding>(
	orderedIds: readonly Id[],
	sourceRevision = 0,
	searchTextById?: ReadonlyMap<Id, string>,
): SelectorModel<Id, Action> {
	const visibleIndexById = deriveIndexById(orderedIds);
	const model: SelectorModel<Id, Action> = {
		sourceRevision,
		orderedIds,
		selectedId: orderedIds[0],
		selectedIndex: orderedIds.length === 0 ? -1 : 0,
		visibleIndexById,
		viewportOffset: 0,
		mode: browse,
		preview: { _tag: "Empty" },
		previewRequestGeneration: 0,
		actionRequestGeneration: 0,
		receipt: noSelectorReceipt<Id>(),
		filteredIds: orderedIds,
		viewportSize: 10,
		searchTextById,
	};
	return model;
}

export const updateSelector: <Id, Action extends Keybinding = Keybinding>(
	model: SelectorModel<Id, Action>,
	msg: SelectorMsg<Id, Action>,
) => Transition<SelectorModel<Id, Action>, SelectorCommand<Action, Id>> = updateSelectorImpl;

function beginAction<Id, Action extends Keybinding>(
	model: SelectorModel<Id, Action>,
	action: Action,
	id: Id,
	nonce?: string,
): readonly [SelectorModel<Id, Action>, SelectorActionStamp<Id, Action>] {
	const requestGeneration = model.actionRequestGeneration + 1;
	const actionNonce = nonce ?? `selector:${model.sourceRevision}:${requestGeneration}:${String(id)}:${String(action)}`;
	const stamp: SelectorActionStamp<Id, Action> = {
		action,
		id,
		sourceRevision: model.sourceRevision,
		requestGeneration,
		nonce: actionNonce,
	};
	return [{
		...model,
		actionRequestGeneration: requestGeneration,
		receipt: {
			_tag: "Pending",
			action: String(action),
			id,
			sourceRevision: stamp.sourceRevision,
			requestGeneration,
			nonce: actionNonce,
			receiptId: actionNonce,
		},
	}, stamp];
}

function matchesPendingAction<Id, Action extends Keybinding>(
	model: SelectorModel<Id, Action>,
	stamp: SelectorActionStamp<Id, Action>,
): boolean {
	const pending = model.receipt;
	return pending._tag === "Pending" &&
		model.selectedId === stamp.id &&
		model.sourceRevision === stamp.sourceRevision &&
		pending.id === stamp.id &&
		pending.action === String(stamp.action) &&
		pending.sourceRevision === stamp.sourceRevision &&
		pending.requestGeneration === stamp.requestGeneration &&
		pending.nonce === stamp.nonce;
}

function updateSelectorImpl<Id, Action extends Keybinding>(
	model: SelectorModel<Id, Action>,
	msg: SelectorMsg<Id, Action>,
): Transition<SelectorModel<Id, Action>, SelectorCommand<Action, Id>> {
	const ids = visibleIds<Id, Action>(model);
	switch (msg._tag) {
		case "Move": {
			const next = selectVisible<Id, Action>(
				{ ...model, mode: returnToMode<Id, Action>(model.mode) },
				ids,
				(model.selectedIndex < 0 ? 0 : model.selectedIndex) + msg.delta,
			);
			return transition(model, next);
		}
		case "Page": {
			const next = selectVisible<Id, Action>(
				{ ...model, mode: returnToMode<Id, Action>(model.mode) },
				ids,
				Math.max(0, model.selectedIndex) + msg.delta * Math.max(1, model.viewportSize),
			);
			return transition(model, next);
		}
		case "Jump": {
			const next = selectVisible<Id, Action>({ ...model, mode: returnToMode<Id, Action>(model.mode) }, ids, msg.target === "first" ? 0 : ids.length - 1);
			return transition(model, next);
		}
		case "BeginFilter": {
			const filteredIds = deriveFilteredIds(model.orderedIds, "", model.searchTextById);
			const visibleIndexById = deriveIndexById(filteredIds);
			const next = preserveSelection<Id, Action>(
				{ ...model, mode: { _tag: "Filter", query: "" }, filteredIds, visibleIndexById },
				filteredIds,
				visibleIndexById,
			);
			return transition(model, next);
		}
		case "FilterAppend": {
			const query = `${model.mode._tag === "Filter" ? model.mode.query : ""}${msg.text}`;
			const filteredIds = deriveFilteredIds(model.orderedIds, query, model.searchTextById);
			const visibleIndexById = deriveIndexById(filteredIds);
			const next = preserveSelection<Id, Action>(
				{ ...model, mode: { _tag: "Filter", query }, filteredIds, visibleIndexById },
				filteredIds,
				visibleIndexById,
			);
			return transition(model, next);
		}
		case "FilterDelete": {
			if (model.mode._tag !== "Filter") return transition(model, model);
			const query = model.mode.query.slice(0, -1);
			const filteredIds = deriveFilteredIds(model.orderedIds, query, model.searchTextById);
			const visibleIndexById = deriveIndexById(filteredIds);
			const next = preserveSelection<Id, Action>(
				{ ...model, mode: { _tag: "Filter", query }, filteredIds, visibleIndexById },
				filteredIds,
				visibleIndexById,
			);
			return transition(model, next);
		}
		case "Back": {
			switch (model.mode._tag) {
				case "Confirm":
					return transition(model, { ...model, mode: modeAfterConfirm<Id, Action>(model.mode) });
				case "PreviewFocus":
					return transition(model, { ...model, mode: model.mode.returnTo });
				case "Filter": {
					const visibleIndexById = deriveIndexById(model.orderedIds);
					const next = preserveSelection<Id, Action>(
						{ ...model, mode: browse, filteredIds: model.orderedIds, visibleIndexById },
						model.orderedIds,
						visibleIndexById,
					);
					return transition(model, next);
				}
				case "Browse":
					return transition(model, model, [{ _tag: "CloseRequested" }]);
			}
		}
		case "Activate": {
			if (model.selectedId === undefined) return transition(model, model);
			if (model.mode._tag === "PreviewFocus" && msg.action !== undefined) {
				const [next, stamp] = beginAction(model, msg.action, model.selectedId);
				return transition(model, next, [{ _tag: "Activate", ...stamp }]);
			}
			if (model.mode._tag === "Browse" || model.mode._tag === "Filter") {
				const requestGeneration = model.previewRequestGeneration + 1;
				const next: SelectorModel<Id, Action> = {
					...model,
					mode: { _tag: "PreviewFocus", returnTo: model.mode },
					previewRequestGeneration: requestGeneration,
					preview: {
						_tag: "Loading",
						id: model.selectedId,
						sourceRevision: model.sourceRevision,
						requestGeneration,
					},
				};
				return transition(model, next, [
					{ _tag: "PreviewRequested", id: model.selectedId, requestGeneration },
				]);
			}
			return transition(model, model);
		}
		case "DirectActivate": {
			if (model.selectedId === undefined) return transition(model, model);
			const [pending, stamp] = beginAction(model, msg.action, model.selectedId);
			const next = { ...pending, mode: returnToMode<Id, Action>(model.mode) };
			return transition(model, next, [{ _tag: "Activate", ...stamp }]);
		}
		case "PreviewRequested": {
			if (model.selectedId === undefined) return transition(model, model);
			const requestGeneration = Math.max(model.previewRequestGeneration + 1, msg.requestGeneration);
			const next: SelectorModel<Id, Action> = {
				...model,
				previewRequestGeneration: requestGeneration,
				preview: {
					_tag: "Loading",
					id: model.selectedId,
					sourceRevision: model.sourceRevision,
					requestGeneration,
				},
			};
			return transition(model, next, [{ _tag: "PreviewRequested", id: model.selectedId, requestGeneration }]);
		}
		case "PreviewLoaded": {
			const current = model.preview;
			if (
				current._tag !== "Loading" ||
				current.id !== msg.id ||
				current.sourceRevision !== msg.sourceRevision ||
				current.requestGeneration !== msg.requestGeneration
			) {
				return transition(model, model);
			}
			return transition(model, {
				...model,
				preview: { _tag: "Ready", id: msg.id, sourceRevision: msg.sourceRevision, requestGeneration: msg.requestGeneration, key: msg.key },
			});
		}
		case "PreviewFailed": {
			const current = model.preview;
			if (
				current._tag !== "Loading" ||
				current.id !== msg.id ||
				current.sourceRevision !== msg.sourceRevision ||
				current.requestGeneration !== msg.requestGeneration
			) {
				return transition(model, model);
			}
			return transition(model, {
				...model,
				mode: returnToMode<Id, Action>(model.mode),
				preview: {
					_tag: "Failed",
					id: msg.id,
					sourceRevision: msg.sourceRevision,
					requestGeneration: msg.requestGeneration,
					error: msg.error,
				},
			});
		}
		case "Arm": {
			if (model.selectedId === undefined) return transition(model, model);
			const returnTo = modeBeforeConfirm<Id, Action>(model.mode);
			if (returnTo === undefined) return transition(model, model);
			const next: SelectorModel<Id, Action> = {
				...model,
				mode: {
					_tag: "Confirm",
					returnTo,
					arm: {
						action: msg.action,
						targetId: model.selectedId,
						sourceRevision: model.sourceRevision,
						nonce: msg.nonce,
					},
				},
			};
			return transition(model, next);
		}
		case "CommitArmed": {
			if (model.mode._tag !== "Confirm" || !msg.redeemable) return transition(model, model);
			const arm = model.mode.arm;
			if (
				arm.targetId !== msg.id ||
				model.selectedId !== msg.id ||
				arm.sourceRevision !== msg.sourceRevision ||
				model.sourceRevision !== msg.sourceRevision ||
				arm.nonce !== msg.nonce
			) {
				return transition(model, model);
			}
			const requestGeneration = model.actionRequestGeneration + 1;
			const stamp: SelectorActionStamp<Id, Action> = {
				action: arm.action,
				id: arm.targetId,
				sourceRevision: arm.sourceRevision,
				requestGeneration,
				nonce: arm.nonce,
			};
			const next: SelectorModel<Id, Action> = {
				...model,
				mode: model.mode.returnTo,
				actionRequestGeneration: requestGeneration,
				receipt: {
					_tag: "Pending",
					action: String(arm.action),
					id: arm.targetId,
					sourceRevision: arm.sourceRevision,
					requestGeneration,
					nonce: arm.nonce,
					receiptId: arm.nonce,
				},
			};
			return transition(model, next, [{ _tag: "SpendReset", ...stamp }]);
		}
		case "ActionSucceeded": {
			if (!matchesPendingAction(model, msg)) return transition(model, model);
			const next: SelectorModel<Id, Action> = {
				...model,
				receipt: {
					_tag: "Succeeded",
					action: String(msg.action),
					id: msg.id,
					sourceRevision: msg.sourceRevision,
					requestGeneration: msg.requestGeneration,
					nonce: msg.nonce,
					receiptId: msg.receiptId,
					message: msg.message,
				},
			};
			return transition(model, next);
		}
		case "ActionFailed": {
			if (!matchesPendingAction(model, msg)) return transition(model, model);
			const next: SelectorModel<Id, Action> = {
				...model,
				mode: returnToMode<Id, Action>(model.mode),
				receipt: {
					_tag: "Failed",
					action: String(msg.action),
					id: msg.id,
					sourceRevision: msg.sourceRevision,
					requestGeneration: msg.requestGeneration,
					nonce: msg.nonce,
					receiptId: msg.receiptId,
					error: msg.error,
				},
			};
			return transition(model, next);
		}
		case "SourceReplaced": {
			const query = modeQuery<Id, Action>(model.mode) ?? "";
			const searchTextById = msg.searchTextById;
			const filteredIds = deriveFilteredIds(msg.orderedIds, query, searchTextById);
			const orderedIndexById = deriveIndexById(msg.orderedIds);
			const filteredIndexById = query.length === 0 ? orderedIndexById : deriveIndexById(filteredIds);
			const returnTo = returnToMode<Id, Action>(model.mode);
			const staleArm = model.mode._tag === "Confirm" && (
				msg.sourceRevision !== model.sourceRevision ||
				model.mode.arm.sourceRevision !== msg.sourceRevision ||
				model.selectedId !== model.mode.arm.targetId ||
				!orderedIndexById.has(model.mode.arm.targetId) ||
				(returnTo._tag === "Filter" && !filteredIndexById.has(model.mode.arm.targetId))
			);
			const mode = staleArm ? returnTo : model.mode;
			const visibleIdsAfterReplace = modeQuery<Id, Action>(mode) === undefined ? msg.orderedIds : filteredIds;
			const visibleIndexById = modeQuery<Id, Action>(mode) === undefined ? orderedIndexById : filteredIndexById;
			const next = preserveSelection<Id, Action>(
				{
					...model,
					sourceRevision: msg.sourceRevision,
					orderedIds: msg.orderedIds,
					filteredIds,
					visibleIndexById,
					searchTextById,
					preview: { _tag: "Empty" },
					receipt: noSelectorReceipt<Id>(),
					mode,
				},
				visibleIdsAfterReplace,
				visibleIndexById,
			);
			return transition(model, next);
		}
		case "ViewportChanged": {
			const idsForViewport = visibleIds<Id, Action>(model);
			const next = selectVisible<Id, Action>(
				{ ...model, viewportSize: Math.max(1, msg.height), viewportOffset: Math.max(0, msg.offset) },
				idsForViewport,
				Math.max(0, model.selectedIndex),
			);
			return transition(model, next);
		}
	}
}

export function viewSelector<Id, Row, Preview>(
	model: SelectorModel<Id>,
	source: ReadonlyMap<Id, Row>,
	viewport: Viewport,
	preview: PreviewProjection<Preview>,
): KeyedSelectorView<Id, Row, Preview>;
export function viewSelector<Id, Row, Preview>(
	model: SelectorModel<Id>,
	source: ReadonlyMap<Id, Row>,
	viewport: Viewport,
	preview: PreviewProjection<Preview>,
	previewValue: Preview,
	status?: StatusProjection,
): KeyedSelectorView<Id, Row, Preview>;
export function viewSelector<Id, Row, Preview>(
	model: SelectorModel<Id>,
	source: ReadonlyMap<Id, Row>,
	viewport: Viewport,
	preview: PreviewProjection<Preview>,
	previewValue?: Preview,
	status?: StatusProjection,
): KeyedSelectorView<Id, Row, Preview> {
	const ids = visibleIds(model);
	const visibleRows: readonly KeyedRow<Id, Row>[] = visibleKeyedRows(ids, source, viewport);
	const focus: ViewFocus = model.mode._tag === "PreviewFocus" || model.mode._tag === "Confirm" ? "preview" : "table";
	const query = modeQuery<Id, Keybinding>(model.mode);
	const value = previewValue ?? (preview.value as Preview);
	const previewLines = preview.lines(value, viewport);
	return {
		visibleRows,
		selectedKey: model.selectedId,
		focus,
		query,
		status,
		preview: value,
		previewLines,
		dirtyKeys: new Set<ViewKey>(),
	};
}

export const selectorKey = (key: KeyId): KeyId => key;
export type SelectorUpdate<Id, Action extends Keybinding, Command> = Update<
	SelectorModel<Id, Action>,
	SelectorMsg<Id, Action>,
	Command
>;
