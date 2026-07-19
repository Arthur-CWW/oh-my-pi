import type { Keybinding, KeyId, SgrMouseEvent } from "@oh-my-pi/pi-tui";
import * as Schema from "effect/Schema";

const NonEmptyString = Schema.String.pipe(Schema.check(Schema.isMinLength(1)));
const NonNegativeInteger = Schema.Int.pipe(Schema.check(Schema.isGreaterThanOrEqualTo(0)));

export const ComponentIdSchema = NonEmptyString.pipe(Schema.brand("MvuComponentId"));
export type ComponentId = typeof ComponentIdSchema.Type;

export function makeComponentId(value: string): ComponentId {
	return Schema.decodeSync(ComponentIdSchema)(value);
}

export const LeaseIdSchema = NonEmptyString.pipe(Schema.brand("MvuLeaseId"));
export type LeaseId = typeof LeaseIdSchema.Type;

export function makeLeaseId(value: string): LeaseId {
	return Schema.decodeSync(LeaseIdSchema)(value);
}

export const KeymapIdSchema = NonEmptyString.pipe(Schema.brand("MvuKeymapId"));
export type KeymapId = typeof KeymapIdSchema.Type;

export function makeKeymapId(value: string): KeymapId {
	return Schema.decodeSync(KeymapIdSchema)(value);
}

export const ContextIdSchema = NonEmptyString;
export type ContextId = typeof ContextIdSchema.Type;

export function makeContextId(value: string): ContextId {
	return Schema.decodeSync(ContextIdSchema)(value);
}

export const ModeIdSchema = Schema.Literals([
	"Browse",
	"Filter",
	"PreviewFocus",
	"Confirm",
	"Triage",
	"TreeBrowse",
	"TreeFilter",
	"TreePreview",
	"TreeLabelEdit",
	"TreeConfirm",
]);
export type ModeId = typeof ModeIdSchema.Type;

export const FocusIdSchema = Schema.Literals(["list", "table", "preview", "body", "input", "triage"]);
export type FocusId = typeof FocusIdSchema.Type;

export const CapabilityIdSchema = NonEmptyString;
export type CapabilityId = typeof CapabilityIdSchema.Type;

export function makeCapabilityId(value: string): CapabilityId {
	return Schema.decodeSync(CapabilityIdSchema)(value);
}

export type ActionId = Keybinding;

// KeyId is supplied by pi-tui. This schema validates the wire shape while
// retaining pi-tui's nominal key type for decoded events.
export const KeyIdSchema: Schema.Schema<KeyId> = Schema.String as Schema.Schema<KeyId>;

export interface RouteStamp {
	readonly componentId: ComponentId;
	readonly leaseGeneration: number;
	readonly sourceRevision: number;
	readonly requestGeneration: number;
}

export const RouteStampSchema = Schema.Struct({
	componentId: ComponentIdSchema,
	leaseGeneration: NonNegativeInteger,
	sourceRevision: NonNegativeInteger,
	requestGeneration: NonNegativeInteger,
});

export interface SourceEnvelope<Msg> {
	readonly _tag: "MvuSource";
	readonly stamp: RouteStamp;
	readonly message: Msg;
}

export const makeSourceEnvelopeSchema = <Msg>(
	messageSchema: Schema.ConstraintDecoder<Msg, never>,
) =>
	Schema.Struct({
		_tag: Schema.Literal("MvuSource"),
		stamp: RouteStampSchema,
		message: messageSchema,
	});

export interface Press {
	readonly _tag: "Press";
	readonly key: KeyId;
	readonly text?: string;
	readonly repeat: boolean;
}

export interface Release {
	readonly _tag: "Release";
	readonly key: KeyId;
	readonly text?: string;
	readonly repeat: boolean;
}

export interface Paste {
	readonly _tag: "Paste";
	readonly text: string;
}

export interface Resize {
	readonly _tag: "Resize";
	readonly columns: number;
	readonly rows: number;
}

export interface Mouse {
	readonly _tag: "Mouse";
	readonly event: SgrMouseEvent;
}

export type KeyEvent = Press | Release | Paste | Resize | Mouse;

const PressSchema = Schema.Struct({
	_tag: Schema.Literal("Press"),
	key: KeyIdSchema,
	text: Schema.optional(Schema.String),
	repeat: Schema.Boolean,
});
const ReleaseSchema = Schema.Struct({
	_tag: Schema.Literal("Release"),
	key: KeyIdSchema,
	text: Schema.optional(Schema.String),
	repeat: Schema.Boolean,
});
const PasteSchema = Schema.Struct({ _tag: Schema.Literal("Paste"), text: Schema.String });
const ResizeSchema = Schema.Struct({
	_tag: Schema.Literal("Resize"),
	columns: NonNegativeInteger,
	rows: NonNegativeInteger,
});
const MouseSchema = Schema.Struct({
	_tag: Schema.Literal("Mouse"),
	event: Schema.Struct({
		button: NonNegativeInteger,
		col: NonNegativeInteger,
		row: NonNegativeInteger,
		release: Schema.Boolean,
		wheel: Schema.NullOr(Schema.Literals([-1, 1])),
		motion: Schema.Boolean,
		leftClick: Schema.Boolean,
	}),
});

export const KeyEventSchema: Schema.Schema<KeyEvent> = Schema.Union(
	[PressSchema, ReleaseSchema, PasteSchema, ResizeSchema, MouseSchema],
) as Schema.Schema<KeyEvent>;

export const ViewKeySchema = NonEmptyString;
export type ViewKey = typeof ViewKeySchema.Type;

export function makeViewKey(value: string): ViewKey {
	return Schema.decodeSync(ViewKeySchema)(value);
}

export interface Transition<Model, Command> {
	readonly model: Model;
	readonly commands: readonly Command[];
	readonly dirtyKeys: ReadonlySet<ViewKey>;
}

export type Update<Model, Msg, Command> = (model: Model, msg: Msg) => Transition<Model, Command>;

/**
 * Route-local semantic claim compiled from constructor adapter keys.
 * The map in ActiveKeymapContext is keyed by canonical KeyId so dispatch does
 * not scan or reinterpret raw input.
 */
export interface AdapterKeymapClaim {
	readonly action: ActionId;
	readonly key: KeyId;
	readonly context: ContextId;
	readonly tableId: KeymapId;
}

export type AdapterKeymapClaims = ReadonlyMap<string, AdapterKeymapClaim>;

export interface ActiveKeymapContext {
	readonly contexts: readonly ContextId[];
	readonly mode: ModeId;
	readonly focus: FocusId;
	readonly capabilities: ReadonlySet<CapabilityId>;
	readonly adapterClaims?: AdapterKeymapClaims;
}

/** Concrete route states used to validate the combined context claim matrix. */
export type ActiveKeymapContextMatrix = readonly ActiveKeymapContext[];

export interface KeymapWhen {
	readonly mode: ModeId;
	readonly focus: FocusId;
	readonly capability?: CapabilityId;
}

export interface KeymapOverride {
	readonly replaces: ActionId;
	readonly reason: string;
}

interface KeymapBindingBase {
	readonly action: ActionId;
	readonly when: KeymapWhen;
	readonly override?: KeymapOverride;
}

export interface ResolvedActionKeySource {
	readonly _tag: "ResolvedAction";
	readonly literals?: readonly KeyId[];
}

export interface LiteralContextKeySource {
	readonly _tag: "Literal";
	/**
	 * Keep this literal only when no resolved or fixed claim already owns the
	 * same contextual key. Used for semantic printable input, never raw input.
	 */
	readonly whenUnclaimed?: true;
}

export type KeymapBindingSource = ResolvedActionKeySource | LiteralContextKeySource;

/**
 * A key-bearing declaration is a literal contextual grammar claim. A
 * ResolvedAction declaration has no seed key: it reads the action's resolved
 * user configuration and retains only literals named in its source.
 */
export type KeymapBinding =
	| (KeymapBindingBase & {
			readonly source: ResolvedActionKeySource;
			readonly key?: never;
	  })
	| (KeymapBindingBase & {
			readonly source?: LiteralContextKeySource;
			readonly key: KeyId;
	  });

export interface KeymapTable {
	readonly id: KeymapId;
	readonly layer: "global" | "family" | "adapter";
	readonly contexts: readonly ContextId[];
	/**
	 * Contexts whose lower-layer claims this table may intentionally shadow
	 * when both contexts are active. Binding-level overrides remain required
	 * for claims sharing one context.
	 */
	readonly supersedesContexts?: readonly ContextId[];
	readonly bindings: readonly KeymapBinding[];
}

export interface ResolvedBinding extends KeymapBindingBase {
	readonly source: KeymapBindingSource;
	readonly key: KeyId;
	readonly tableId: KeymapId;
	readonly layer: "global" | "family" | "adapter";
	readonly context: ContextId;
}

export class KeymapDecodeError extends Schema.TaggedErrorClass<KeymapDecodeError>()(
	"KeymapDecodeError",
	{ tableId: Schema.String, reason: Schema.String },
) {}

export class KeymapConflictError extends Schema.TaggedErrorClass<KeymapConflictError>()(
	"KeymapConflictError",
	{
		tableId: Schema.String,
		context: Schema.String,
		mode: Schema.String,
		focus: Schema.String,
		key: Schema.String,
		action: Schema.String,
		reason: Schema.Literals([
			"duplicate",
			"implicit-replacement",
			"missing-override-target",
			"override-chain",
			"active-context-collision",
		]),
	},
) {}
export type { KeymapRegistry } from "./keymap-registry";
