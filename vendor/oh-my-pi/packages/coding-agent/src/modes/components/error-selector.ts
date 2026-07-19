import {
	type Component,
	Container,
	type Keybinding,
	type SelectItem,
	SelectList,
	Spacer,
	Text,
} from "@oh-my-pi/pi-tui";
import { Effect } from "effect";
import * as Schema from "effect/Schema";
import type { MvuEnvelope, MvuInputRoute } from "../mvu/input-lease";
import type { MvuRuntimeBoundary } from "../mvu/runtime";
import type { ActiveKeymapContext, ComponentId, RouteStamp, SourceEnvelope, Transition } from "../mvu/schema";
import { KeyEventSchema, makeComponentId, RouteStampSchema } from "../mvu/schema";
import type { SelectorModel, SelectorReceiptState } from "../mvu/selector";
import { makeSelectorModel, updateSelector } from "../mvu/selector";
import { noneReceipt, type ReceiptState, receiptProjection, type StatusProjection } from "../mvu/status";
import { getSelectListTheme, theme } from "../theme/theme";
import { CMUX_OWNER_UNAVAILABLE_MESSAGE, type FocusCmuxOwnerResult } from "../utils/cmux-owner-navigation";
import type { DiagnosticEvent, ErrorInboxProjection, FocusCmuxOwnerAction } from "../utils/error-inbox";
import { DynamicBorder } from "./dynamic-border";
import { keyHint } from "./keybinding-hints";
import { selectorActionToMsg } from "./selector-adapter";

export type DiagnosticActionHandler = (action: FocusCmuxOwnerAction) => Promise<FocusCmuxOwnerResult>;

// Leave room for the selected detail in a half-height HUD on a 20-row terminal.
const ERROR_LIST_MAX_VISIBLE = 5;
const ERROR_COMPONENT_ID = makeComponentId("errors-content");

export type ErrorSelectorModel = SelectorModel<string> & {
	readonly routeGeneration: number;
};

export type ErrorSource = ErrorInboxProjection;
function isErrorInboxProjection(source: ReadonlyArray<DiagnosticEvent> | ErrorSource): source is ErrorSource {
	return !Array.isArray(source);
}

function normalizeErrorSource(source: ReadonlyArray<DiagnosticEvent> | ErrorSource): ErrorSource {
	return isErrorInboxProjection(source) ? source : { sourceRevision: 0, errors: source };
}
const NonNegativeInteger = Schema.Int.pipe(Schema.check(Schema.isGreaterThanOrEqualTo(0)));
const MvuInputSchema = Schema.Struct({
	_tag: Schema.Literal("MvuInput"),
	action: Schema.String,
	event: KeyEventSchema,
	stamp: Schema.optional(RouteStampSchema),
});
const FocusResultSchema = Schema.Union([
	Schema.Struct({ kind: Schema.Literal("focused") }),
	Schema.Struct({ kind: Schema.Literal("unavailable") }),
	Schema.Struct({ kind: Schema.Literal("failed"), reason: Schema.String }),
]);

export type ErrorsContentMessage =
	| MvuEnvelope
	| { readonly _tag: "SourceReplaced"; readonly sourceRevision: number; readonly errors: readonly DiagnosticEvent[] }
	| { readonly _tag: "RouteDeactivated" }
	| { readonly _tag: "SelectionChanged"; readonly id: string }
	| { readonly _tag: "ActivateRequested"; readonly id: string }
	| {
			readonly _tag: "ActionSettled";
			readonly id: string;
			readonly receiptId: string;
			readonly sourceRevision: number;
			readonly requestGeneration: number;
			readonly result: FocusCmuxOwnerResult;
	  };

const ErrorsContentMessageSchema: Schema.ConstraintDecoder<ErrorsContentMessage, never> = Schema.toType(
	Schema.Union([
		MvuInputSchema,
		Schema.Struct({
			_tag: Schema.Literal("SourceReplaced"),
			sourceRevision: NonNegativeInteger,
			errors: Schema.Array(Schema.Unknown),
		}),
		Schema.Struct({ _tag: Schema.Literal("RouteDeactivated") }),
		Schema.Struct({ _tag: Schema.Literal("SelectionChanged"), id: Schema.String }),
		Schema.Struct({ _tag: Schema.Literal("ActivateRequested"), id: Schema.String }),
		Schema.Struct({
			_tag: Schema.Literal("ActionSettled"),
			id: Schema.String,
			receiptId: Schema.String,
			sourceRevision: NonNegativeInteger,
			requestGeneration: NonNegativeInteger,
			result: FocusResultSchema,
		}),
	]),
) as Schema.ConstraintDecoder<ErrorsContentMessage, never>;

function errorsContentStamp(model: ErrorSelectorModel): RouteStamp {
	return {
		componentId: ERROR_COMPONENT_ID,
		leaseGeneration: model.routeGeneration,
		sourceRevision: model.sourceRevision,
		requestGeneration: model.actionRequestGeneration,
	};
}

function noSelectorReceipt<Id>(): SelectorReceiptState<Id> {
	return { _tag: "None" };
}

export interface ErrorSelectorOptions {
	readonly onAction?: DiagnosticActionHandler;
	readonly onUpdate?: () => void;
	readonly onDockAction?: (action: "togglePin" | "beginFocusChord" | "finishFocusChord") => void;
}

export interface DiagnosticRowProjection {
	readonly id: string;
	readonly label: string;
	readonly description: string;
}

export type ErrorsContentCommand =
	| { readonly _tag: "Project"; readonly model: ErrorSelectorModel; readonly source?: ErrorSource }
	| { readonly _tag: "Activate"; readonly id: string; readonly receiptId: string; readonly stamp: RouteStamp }
	| { readonly _tag: "Dismiss" }
	| { readonly _tag: "DockAction"; readonly action: "togglePin" | "beginFocusChord" | "finishFocusChord" };

export interface ErrorsContentRouteSpec {
	readonly componentId: ComponentId;
	readonly initialModel: ErrorSelectorModel;
	readonly route: MvuInputRoute<ErrorSelectorModel>;
	readonly update: (
		model: ErrorSelectorModel,
		message: ErrorsContentMessage,
	) => Transition<ErrorSelectorModel, ErrorsContentCommand>;
	readonly interpret: (
		command: ErrorsContentCommand,
	) => Effect.Effect<readonly (ErrorsContentMessage | SourceEnvelope<ErrorsContentMessage>)[]>;
	readonly boundary: MvuRuntimeBoundary<ErrorSelectorModel, ErrorsContentMessage, ErrorsContentCommand>;
}

function isOpenFleetIncident(err: DiagnosticEvent): boolean {
	return !err.resolved && err.source === "fleet" && err.category === "fleet-incident" && err.status === "open";
}

/** Pure list-row projection. The inbox remains the only diagnostic authority. */
export function projectDiagnosticRow(err: DiagnosticEvent): DiagnosticRowProjection {
	const time = new Date(err.lastTimestamp).toISOString();
	let label = `[${time}]`;
	if (err.source) label += ` ${err.source}:`;
	if (err.count > 1) label += ` (x${err.count})`;

	if (err.resolved) label = `[resolved] ${label}`;
	else if (isOpenFleetIncident(err)) label = `[incident open] ${label}`;
	if (err.unread && !err.resolved) label = `[unread] ${label}`;

	return { id: err.id, label, description: err.message.replace(/\n/g, " ") };
}

export function formatDiagnosticLabel(err: DiagnosticEvent): string {
	return projectDiagnosticRow(err).label;
}

export function projectDiagnosticStatus(
	err: DiagnosticEvent,
	receipt: ReceiptState<string> = noneReceipt<string>(),
): StatusProjection {
	const projection = receiptProjection(receipt);
	const readiness =
		projection?.state === "pending"
			? "busy"
			: projection?.state === "failed"
				? "unavailable"
				: err.resolved
					? "ready"
					: err.action
						? "ready"
						: "blocked";
	return {
		readiness,
		label: err.resolved ? "Resolved diagnostic" : "Diagnostic action",
		...(projection === undefined ? {} : { receipt: projection }),
	};
}

/** Pure detail projection; receipt text is supplied by the shared status layer. */
export function formatDiagnosticDetail(err: DiagnosticEvent | null, status?: StatusProjection): string {
	if (!err) return "";
	let out = isOpenFleetIncident(err) ? `${theme.bold("[incident open]")}\n` : "";
	if (err.count > 1) {
		out +=
			theme.bold(`Occurrences: `) +
			`${err.count} (first: ${new Date(err.firstTimestamp).toISOString()}, last: ${new Date(err.lastTimestamp).toISOString()})\n`;
	} else {
		out += `${theme.bold(`Timestamp: `)}${new Date(err.lastTimestamp).toISOString()}\n`;
	}

	const fields: Array<[string, string | number | boolean | undefined]> = [
		["ID", err.id],
		["Source", err.source],
		["Category", err.category],
		["Cause", err.cause],
		["Disposition", err.disposition],
		["Provider", err.provider],
		["Model", err.model],
		["Session", err.session],
		["Agent", err.agent],
		["Tool", err.tool],
		["Job", err.job],
		["Operation", err.operation],
		["Status", err.status],
		["Code", err.code],
		["Retry", err.retry],
		["Reset", err.reset !== undefined ? new Date(err.reset).toISOString() : undefined],
		["Fingerprint", err.requestFingerprint],
		["Build", err.buildVersion],
		["Build digest", err.buildDigest],
		["Log pointer", err.logPointer],
		["Unread", err.unread],
		["Resolved", err.resolved],
	];

	for (const [key, val] of fields) {
		if (val !== undefined && val !== null && val !== "") {
			out += `${theme.bold(`${key}: `) + String(val)}\n`;
		}
	}

	out += `\n${theme.bold("Headline:\n")}${err.message}`;
	if (err.detail) out += `\n\n${theme.bold("Raw detail:\n")}${err.detail}`;

	if (err.causeChain && err.causeChain.length > 0) {
		out += `\n\n${theme.bold("Cause chain:\n")}`;
		for (let i = 0; i < err.causeChain.length; i++) {
			out += `${i + 1}. ${err.causeChain[i]}\n`;
		}
	}

	const receipt = status?.receipt;
	if (receipt) {
		const receiptText =
			receipt.state === "pending"
				? `Action in progress: ${receipt.action}`
				: (receipt.message ?? `Action ${receipt.state}: ${receipt.action}`);
		out += `\n\n${receiptText}`;
	}

	if (err.action) {
		out += `\n${theme.fg("dim", "Focus active cmux session: Enter   ")}${keyHint("ui.dismiss", "close")}`;
	} else if (!err.resolved) {
		out +=
			"\n" +
			theme.fg("dim", `Resolve: :errors resolve ${err.id}   `) +
			keyHint("ui.dismiss", "close or press Enter");
	}

	return out.trimEnd();
}

/** Retained renderer node used to patch a SelectList without rebuilding the panel. */
class SelectListRenderer implements Component {
	#delegate: SelectList;

	constructor(delegate: SelectList) {
		this.#delegate = delegate;
	}

	setDelegate(delegate: SelectList): void {
		this.#delegate = delegate;
	}

	render(width: number): readonly string[] {
		return this.#delegate.render(width);
	}

	handleInput(data: string): void {
		this.#delegate.handleInput(data);
	}

	invalidate(): void {
		this.#delegate.invalidate();
	}
}

function routeContext(model: ErrorSelectorModel): ActiveKeymapContext {
	return {
		contexts: ["errors.dock", "selector.global", "selector.filter"],
		mode: model.mode._tag,
		focus: model.mode._tag === "PreviewFocus" || model.mode._tag === "Confirm" ? "preview" : "list",
		capabilities: new Set(["errors", "selector.filter"]),
	};
}

type ErrorsDockAction = Extract<ErrorsContentCommand, { readonly _tag: "DockAction" }>;

function dockAction(action: Keybinding): ErrorsDockAction["action"] | undefined {
	switch (String(action)) {
		case "app.errors.togglePin":
			return "togglePin";
		case "app.errors.beginFocusChord":
			return "beginFocusChord";
		case "app.errors.finishFocusChord":
			return "finishFocusChord";
		default:
			return undefined;
	}
}
function beginErrorAction(model: ErrorSelectorModel, id: string): Transition<ErrorSelectorModel, ErrorsContentCommand> {
	if (!model.orderedIds.includes(id)) return { model, commands: [], dirtyKeys: new Set() };
	const current = model.receipt;
	if (current._tag === "Pending" && current.id === id) return { model, commands: [], dirtyKeys: new Set() };
	const requestGeneration = model.actionRequestGeneration + 1;
	const receiptId = `errors:${model.routeGeneration}:${id}:${requestGeneration}`;
	const next: ErrorSelectorModel = {
		...model,
		selectedId: id,
		actionRequestGeneration: requestGeneration,
		receipt: {
			_tag: "Pending",
			action: "focus_cmux_owner",
			id,
			sourceRevision: model.sourceRevision,
			requestGeneration,
			nonce: receiptId,
			receiptId,
		},
	};
	return {
		model: next,
		commands: [
			{ _tag: "Project", model: next },
			{ _tag: "Activate", id, receiptId, stamp: errorsContentStamp(next) },
		],
		dirtyKeys: new Set(["receipt", "selection"]),
	};
}

export function updateErrorsContent(
	model: ErrorSelectorModel,
	message: ErrorsContentMessage,
): Transition<ErrorSelectorModel, ErrorsContentCommand> {
	if (message._tag === "SourceReplaced") {
		if (message.sourceRevision < model.sourceRevision) return { model, commands: [], dirtyKeys: new Set() };
		const source: ErrorSource = { sourceRevision: message.sourceRevision, errors: message.errors };
		const transition = updateSelector(model, {
			_tag: "SourceReplaced",
			sourceRevision: source.sourceRevision,
			orderedIds: source.errors.map(error => error.id),
			searchTextById: new Map(source.errors.map(error => [error.id, error.message])),
		});
		const next: ErrorSelectorModel = { ...transition.model, routeGeneration: model.routeGeneration };
		return {
			model: next,
			commands: [{ _tag: "Project", model: next, source }],
			dirtyKeys: transition.dirtyKeys,
		};
	}
	if (message._tag === "RouteDeactivated") {
		const next: ErrorSelectorModel = {
			...model,
			routeGeneration: model.routeGeneration + 1,
			receipt: noSelectorReceipt<string>(),
		};
		return {
			model: next,
			commands: [{ _tag: "Project", model: next }],
			dirtyKeys: new Set(["receipt"]),
		};
	}
	if (message._tag === "SelectionChanged") {
		if (!model.orderedIds.includes(message.id)) return { model, commands: [], dirtyKeys: new Set() };
		const next = { ...model, selectedId: message.id };
		return {
			model: next,
			commands: [{ _tag: "Project", model: next }],
			dirtyKeys: new Set(["selection"]),
		};
	}
	if (message._tag === "ActivateRequested") return beginErrorAction(model, message.id);
	if (message._tag === "ActionSettled") {
		const current = model.receipt;
		if (
			current._tag !== "Pending" ||
			current.id !== message.id ||
			current.receiptId !== message.receiptId ||
			current.sourceRevision !== message.sourceRevision ||
			current.requestGeneration !== message.requestGeneration
		)
			return { model, commands: [], dirtyKeys: new Set() };
		const receipt: SelectorReceiptState<string> =
			message.result.kind === "focused"
				? {
						_tag: "Succeeded",
						action: current.action,
						id: current.id,
						sourceRevision: current.sourceRevision,
						requestGeneration: current.requestGeneration,
						nonce: current.nonce,
						receiptId: current.receiptId,
						message: "Focused the active cmux session.",
					}
				: {
						_tag: "Failed",
						action: current.action,
						id: current.id,
						sourceRevision: current.sourceRevision,
						requestGeneration: current.requestGeneration,
						nonce: current.nonce,
						receiptId: current.receiptId,
						error:
							message.result.kind === "unavailable"
								? CMUX_OWNER_UNAVAILABLE_MESSAGE
								: `Could not focus the active cmux session: ${message.result.reason}. This view remains read-only.`,
					};
		const next = { ...model, receipt };
		return {
			model: next,
			commands: [{ _tag: "Project", model: next }],
			dirtyKeys: new Set(["receipt"]),
		};
	}

	const panelAction = dockAction(message.action);
	if (panelAction !== undefined) {
		return { model, commands: [{ _tag: "DockAction", action: panelAction }], dirtyKeys: new Set() };
	}
	const selectorMessage = selectorActionToMsg(String(message.action), message.event, model, ERROR_COMPONENT_ID);
	if (selectorMessage === undefined) return { model, commands: [], dirtyKeys: new Set() };
	if (selectorMessage._tag === "Activate") {
		return model.selectedId === undefined
			? { model, commands: [], dirtyKeys: new Set() }
			: beginErrorAction(model, model.selectedId);
	}
	const transition = updateSelector(model, selectorMessage);
	const next: ErrorSelectorModel = { ...transition.model, routeGeneration: model.routeGeneration };
	const commands: ErrorsContentCommand[] = [{ _tag: "Project", model: next }];
	if (transition.commands.some(command => command._tag === "CloseRequested")) commands.push({ _tag: "Dismiss" });
	return { model: next, commands, dirtyKeys: transition.dirtyKeys };
}

export class ErrorSelectorComponent extends Container {
	#selectList: SelectList;
	readonly #listRenderer: SelectListRenderer;
	readonly #onDismiss: () => void;
	readonly #onAction: DiagnosticActionHandler | undefined;
	readonly #onUpdate: (() => void) | undefined;
	readonly #onDockAction: ErrorSelectorOptions["onDockAction"];
	#dispatch: ((message: ErrorsContentMessage) => void) | undefined;
	readonly #detailText: Text;
	#errors: readonly DiagnosticEvent[];
	#byId = new Map<string, DiagnosticEvent>();
	#model: ErrorSelectorModel;

	constructor(
		errors: ReadonlyArray<DiagnosticEvent> | ErrorSource,
		onDismiss: () => void,
		options: ErrorSelectorOptions = {},
	) {
		super();
		this.#onDismiss = onDismiss;
		this.#onAction = options.onAction;
		this.#onUpdate = options.onUpdate;
		this.#onDockAction = options.onDockAction;
		const source = normalizeErrorSource(errors);

		this.#errors = source.errors;
		this.#byId = new Map(this.#errors.map(error => [error.id, error]));
		this.#model = {
			...makeSelectorModel(
				this.#errors.map(error => error.id),
				source.sourceRevision,
				this.#searchText(),
			),
			routeGeneration: 0,
		};
		this.#selectList = this.#createSelectList();
		this.#listRenderer = new SelectListRenderer(this.#selectList);
		this.#detailText = new Text(this.#detailForSelected(), 1, 0);

		this.addChild(new Spacer(1));
		this.addChild(new DynamicBorder(str => theme.fg("dim", str)));
		this.addChild(
			new Text(
				theme.bold("Error History") +
					theme.fg("dim", "  p pin/unpin · Ctrl-W w focus · ") +
					keyHint("tui.select.vimDown", "down") +
					theme.fg("dim", " · ") +
					keyHint("tui.select.vimUp", "up") +
					theme.fg("dim", " · ") +
					keyHint("tui.select.first", "first") +
					theme.fg("dim", " · ") +
					keyHint("tui.select.last", "last") +
					theme.fg("dim", " · ") +
					keyHint("tui.select.halfPageDown", "half-page down") +
					theme.fg("dim", " · ") +
					keyHint("tui.select.halfPageUp", "half-page up") +
					theme.fg("dim", " · ") +
					keyHint("ui.dismiss", "close"),
				1,
				0,
			),
		);
		this.addChild(this.#listRenderer);
		this.addChild(new DynamicBorder(str => theme.fg("dim", str)));
		this.addChild(this.#detailText);
		this.addChild(new Spacer(1));
	}

	getSelectList(): SelectList {
		return this.#selectList;
	}

	get selectedId(): string | undefined {
		return this.#model.selectedId;
	}

	get model(): ErrorSelectorModel {
		return this.#model;
	}

	getRouteSpec(): ErrorsContentRouteSpec {
		const route: MvuInputRoute<ErrorSelectorModel> = {
			componentId: ERROR_COMPONENT_ID,
			focusedRoot: this,
			context: routeContext,
			actionToMsg: (action, event): MvuEnvelope | undefined =>
				event._tag === "Resize" ? undefined : { _tag: "MvuInput", action, event },
		};
		return {
			componentId: ERROR_COMPONENT_ID,
			initialModel: this.#model,
			route,
			update: updateErrorsContent,
			interpret: command => {
				switch (command._tag) {
					case "Project":
						return Effect.sync(() => this.#applyModel(command.model, command.source)).pipe(Effect.as([]));
					case "Activate":
						return this.#interpretAction(command);
					case "Dismiss":
						return Effect.sync(() => this.#onDismiss()).pipe(Effect.as([]));
					case "DockAction":
						return Effect.sync(() => this.#onDockAction?.(command.action)).pipe(Effect.as([]));
				}
			},
			boundary: {
				messageSchema: ErrorsContentMessageSchema,
				currentStamp: errorsContentStamp,
				commandStamp: command => (command._tag === "Activate" ? command.stamp : undefined),
			},
		};
	}

	bindRuntime(dispatch: (message: ErrorsContentMessage) => void): void {
		this.#dispatch = dispatch;
	}

	dispatchSource(source: ErrorSource): void {
		this.#dispatch?.({
			_tag: "SourceReplaced",
			sourceRevision: source.sourceRevision,
			errors: source.errors,
		});
	}

	deactivateRoute(): void {
		this.#dispatch?.({ _tag: "RouteDeactivated" });
	}

	render(width: number): readonly string[] {
		return super.render(width);
	}

	handleInput(data: string): void {
		this.#selectList.handleInput(data);
	}

	#applyModel(model: ErrorSelectorModel, source?: ErrorSource): void {
		if (source !== undefined) {
			this.#errors = source.errors;
			this.#byId = new Map(source.errors.map(error => [error.id, error]));
		}
		this.#model = model;
		const previous = this.#selectList;
		this.#selectList = this.#createSelectList();
		this.#listRenderer.setDelegate(this.#selectList);
		previous.invalidate();
		this.#syncDetail();
		this.invalidate();
		this.#onUpdate?.();
	}

	#searchText(): ReadonlyMap<string, string> {
		return new Map(this.#errors.map(error => [error.id, error.message]));
	}

	#createSelectList(): SelectList {
		const visibleIds = this.#model.mode._tag === "Filter" ? this.#model.filteredIds : this.#model.orderedIds;
		const items: SelectItem[] = visibleIds.flatMap(id => {
			const error = this.#byId.get(id);
			if (error === undefined) return [];
			const row = projectDiagnosticRow(error);
			return [{ value: row.id, label: row.label, description: row.description }];
		});
		if (items.length === 0) items.push({ value: "none", label: "No recent errors" });
		const list = new SelectList(items, Math.min(items.length, ERROR_LIST_MAX_VISIBLE), getSelectListTheme(), {
			overflowSearch: false,
		});
		const selectedIndex =
			this.#model.selectedId === undefined ? 0 : items.findIndex(item => item.value === this.#model.selectedId);
		list.setSelectedIndex(selectedIndex >= 0 ? selectedIndex : 0);
		list.onSelect = item => this.#activate(item.value);
		list.onSelectionChange = item => this.#select(item.value);
		return list;
	}

	#select(id: string): void {
		if (id === "none" || !this.#byId.has(id)) return;
		this.#dispatch?.({ _tag: "SelectionChanged", id });
	}

	#activate(id: string): void {
		if (id === "none" || !this.#byId.has(id)) {
			this.#onDismiss();
			return;
		}
		this.#dispatch?.({ _tag: "ActivateRequested", id });
	}

	#interpretAction(
		command: Extract<ErrorsContentCommand, { readonly _tag: "Activate" }>,
	): Effect.Effect<readonly SourceEnvelope<ErrorsContentMessage>[]> {
		const selected = this.#byId.get(command.id);
		const action = selected?.action;
		const onAction = this.#onAction;
		if (action === undefined || action.kind !== "focus_cmux_owner" || onAction === undefined) {
			return Effect.sync(() => this.#onDismiss()).pipe(Effect.as([]));
		}
		const settled = (result: FocusCmuxOwnerResult): readonly SourceEnvelope<ErrorsContentMessage>[] => [
			{
				_tag: "MvuSource",
				stamp: command.stamp,
				message: {
					_tag: "ActionSettled",
					id: command.id,
					receiptId: command.receiptId,
					sourceRevision: command.stamp.sourceRevision,
					requestGeneration: command.stamp.requestGeneration,
					result,
				},
			},
		];
		return Effect.tryPromise({
			try: () => onAction(action),
			catch: error => (error instanceof Error ? error.message : String(error)),
		}).pipe(
			Effect.match({
				onFailure: reason => settled({ kind: "failed", reason }),
				onSuccess: settled,
			}),
		);
	}

	#detailForSelected(): string {
		const selected = this.#model.selectedId === undefined ? undefined : this.#byId.get(this.#model.selectedId);
		if (!selected) return formatDiagnosticDetail(null);
		const receipt = this.#model.receipt;
		const selectedReceipt =
			receipt._tag !== "None" && receipt.id === selected.id ? receipt : noSelectorReceipt<string>();
		return formatDiagnosticDetail(selected, projectDiagnosticStatus(selected, selectedReceipt));
	}

	#syncDetail(): void {
		this.#detailText.setText(this.#detailForSelected());
	}
}
