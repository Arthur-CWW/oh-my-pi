import type { KeyId } from "@oh-my-pi/pi-tui";
import {
	type ActionId,
	type ActiveKeymapContext,
	type ActiveKeymapContextMatrix,
	type KeymapBinding,
	type KeymapTable,
	makeKeymapId,
} from "../modes/mvu/schema";

const key = (value: string): KeyId => value as KeyId;
const action = (value: string): ActionId => value as ActionId;

const when = (mode: KeymapBinding["when"]["mode"], focus: KeymapBinding["when"]["focus"], capability?: string) =>
	capability === undefined ? { mode, focus } : { mode, focus, capability };

const literal = (
	keyValue: string,
	actionValue: string,
	mode: KeymapBinding["when"]["mode"],
	focus: KeymapBinding["when"]["focus"],
	capability?: string,
): KeymapBinding => ({
	source: { _tag: "Literal" },
	key: key(keyValue),
	action: action(actionValue),
	when: when(mode, focus, capability),
});
const unclaimedLiteral = (
	keyValue: string,
	actionValue: string,
	mode: KeymapBinding["when"]["mode"],
	focus: KeymapBinding["when"]["focus"],
): KeymapBinding => ({
	source: { _tag: "Literal", whenUnclaimed: true },
	key: key(keyValue),
	action: action(actionValue),
	when: when(mode, focus),
});

const printable = (
	keyValue: string,
	mode: KeymapBinding["when"]["mode"],
): KeymapBinding => ({
	source: { _tag: "Literal", whenUnclaimed: true },
	key: key(keyValue),
	action: action("app.selector.filterAppend"),
	when: when(mode, "list", "selector.filter"),
});
const labelPrintable = (keyValue: string): KeymapBinding =>
	unclaimedLiteral(keyValue, "app.tree.labelAppend", "TreeLabelEdit", "preview");


const resolved = (
	actionValue: string,
	mode: KeymapBinding["when"]["mode"],
	focus: KeymapBinding["when"]["focus"],
	literals: readonly string[] = [],
	capability?: string,
): KeymapBinding => ({
	source: {
		_tag: "ResolvedAction",
		...(literals.length === 0 ? {} : { literals: literals as readonly KeyId[] }),
	},
	action: action(actionValue),
	when: when(mode, focus, capability),
});

const hubRouteKeys: readonly KeyId[] = [
	...Array.from(
		{ length: 95 },
		(_, index) => (index === 0 ? "space" : String.fromCharCode(index + 32)) as KeyId,
	).filter(keyValue => keyValue !== ":"),
	"enter",
	"escape",
	"backspace",
	"delete",
	"tab",
	"shift+tab",
	"up",
	"down",
	"left",
	"right",
	"home",
	"end",
	"pageUp",
	"pageDown",
	"ctrl+enter",
	...Array.from({ length: 26 }, (_, index) => `ctrl+${String.fromCharCode(97 + index)}` as KeyId),
];

const hubRouteContexts = [
	["Browse", "list"],
	["Filter", "list"],
	["PreviewFocus", "preview"],
	["Triage", "triage"],
] as const;
const isHubTriageLifecycleKey = (keyValue: KeyId): boolean =>
	keyValue === "enter" || keyValue === "q" || keyValue === "ctrl+c";
const hubRouteBindings: readonly KeymapBinding[] = hubRouteContexts.flatMap(([mode, focus]) => [
	resolved("ui.dismiss", mode, focus),
	resolved("app.interrupt", mode, focus),
	...(mode === "Triage" ? hubRouteKeys.filter(isHubTriageLifecycleKey) : hubRouteKeys)
		.map(keyValue => unclaimedLiteral(keyValue, "app.agents.hub", mode, focus)),
]);

const printableSelectorKeys: readonly string[] = Array.from(
	{ length: 95 },
	(_, index) => index === 0 ? "space" : String.fromCharCode(index + 32),
);

const selectorGlobalBindings: readonly KeymapBinding[] = [
	resolved("app.navigation.down", "Browse", "list", ["down"]),
	resolved("app.navigation.up", "Browse", "list", ["up"]),
	resolved("tui.select.pageDown", "Browse", "list"),
	resolved("tui.select.pageUp", "Browse", "list"),
	resolved("tui.select.halfPageDown", "Browse", "list"),
	resolved("tui.select.halfPageUp", "Browse", "list"),
	resolved("tui.select.first", "Browse", "list", ["home"]),
	resolved("tui.select.last", "Browse", "list", ["end"]),
	resolved("app.selector.filter", "Browse", "list"),
	resolved("tui.select.confirm", "Browse", "list"),
	resolved("app.selector.preview", "Browse", "list"),
	resolved("ui.dismiss", "Browse", "list"),
	resolved("app.interrupt", "Browse", "list"),
	resolved("ui.dismiss", "Filter", "list"),
	resolved("ui.dismiss", "PreviewFocus", "preview"),
	resolved("ui.dismiss", "Confirm", "preview"),
	resolved("tui.select.confirm", "Filter", "list"),
	resolved("tui.select.confirm", "PreviewFocus", "preview"),
	resolved("tui.select.confirm", "Confirm", "preview"),
	resolved("app.navigation.down", "TreeBrowse", "list", ["down"]),
	resolved("app.navigation.up", "TreeBrowse", "list", ["up"]),
	resolved("tui.select.pageDown", "TreeBrowse", "list"),
	resolved("tui.select.pageUp", "TreeBrowse", "list"),
	resolved("tui.select.first", "TreeBrowse", "list", ["home"]),
	resolved("tui.select.last", "TreeBrowse", "list", ["end"]),
	resolved("app.selector.filter", "TreeBrowse", "list"),
	resolved("tui.select.confirm", "TreeBrowse", "list"),
	resolved("ui.dismiss", "TreeBrowse", "list"),
	resolved("app.tree.label", "TreeBrowse", "list", ["shift+l"]),
	resolved("app.interrupt", "TreeBrowse", "list", ["ctrl+c"]),
	resolved("ui.dismiss", "TreeFilter", "list"),
	resolved("ui.dismiss", "TreePreview", "preview"),
	resolved("ui.dismiss", "TreeLabelEdit", "preview"),
	literal("backspace", "app.tree.labelDelete", "TreeLabelEdit", "preview"),
	literal("enter", "app.tree.labelCommit", "TreeLabelEdit", "preview"),
	...printableSelectorKeys.map(labelPrintable),
	resolved("ui.dismiss", "TreeConfirm", "preview"),
];

const selectorFilterBindings: readonly KeymapBinding[] = [
	resolved("tui.select.up", "Filter", "list"),
	resolved("tui.select.down", "Filter", "list"),
	resolved("tui.select.pageUp", "Filter", "list"),
	resolved("tui.select.pageDown", "Filter", "list"),
	resolved("tui.select.halfPageUp", "Filter", "list"),
	resolved("tui.select.halfPageDown", "Filter", "list"),
	literal("backspace", "app.selector.filterDelete", "Filter", "list", "selector.filter"),
	...printableSelectorKeys.map(keyValue => printable(keyValue, "Filter")),
	resolved("tui.select.up", "TreeFilter", "list"),
	resolved("tui.select.down", "TreeFilter", "list"),
	resolved("tui.select.pageUp", "TreeFilter", "list"),
	resolved("tui.select.pageDown", "TreeFilter", "list"),
	literal("backspace", "app.selector.filterDelete", "TreeFilter", "list", "selector.filter"),
	...printableSelectorKeys.map(keyValue => printable(keyValue, "TreeFilter")),
];

const hookRouteBindings: readonly KeymapBinding[] = [
	literal("left", "app.hook.sliderLeft", "Browse", "list", "hook.slider"),
	literal("right", "app.hook.sliderRight", "Browse", "list", "hook.slider"),
	literal("left", "app.hook.sliderLeft", "Filter", "list", "hook.slider"),
	literal("right", "app.hook.sliderRight", "Filter", "list", "hook.slider"),
	literal("left", "tui.editor.cursorLeft", "Filter", "list", "hook.editor"),
	literal("right", "tui.editor.cursorRight", "Filter", "list", "hook.editor"),
	literal("ctrl+enter", "app.hook.submit", "Filter", "list", "hook.editor"),
	resolved("app.editor.external", "Filter", "list", [], "hook.editor"),
];

const attentionFamilyBindings: readonly KeymapBinding[] = [
	resolved("app.attention.open", "Browse", "list", [], "attention"),
	resolved("app.attention.now", "Triage", "triage", [], "attention"),
	resolved("app.attention.next", "Triage", "triage", [], "attention"),
	resolved("app.attention.waiting", "Triage", "triage", [], "attention"),
	resolved("app.attention.later", "Triage", "triage", [], "attention"),
	resolved("app.attention.hidden", "Triage", "triage", [], "attention"),
	resolved("app.attention.snooze", "Triage", "triage", [], "attention"),
	resolved("app.attention.tags", "Triage", "triage", [], "attention"),
	resolved("app.attention.bookmark", "Triage", "triage", [], "attention"),
	resolved("app.attention.note", "Triage", "triage", [], "attention"),
	resolved("ui.dismiss", "Triage", "triage", [], "attention"),
];

const modalFamilyBindings: readonly KeymapBinding[] = [
	resolved("app.modal.focusNext", "Browse", "body"),
	resolved("app.modal.focusPrevious", "Browse", "body"),
	resolved("ui.dismiss", "Browse", "body"),
];

const settingsRouteKeys: readonly KeyId[] = [
	...printableSelectorKeys.map(keyValue => keyValue as KeyId),
	"enter",
	"escape",
	"backspace",
	"delete",
	"tab",
	"shift+tab",
	"left",
	"right",
	"up",
	"down",
	"home",
	"end",
	"pageUp",
	"pageDown",
	"alt+backspace",
	"ctrl+a",
	"ctrl+e",
	"ctrl+u",
	"ctrl+w",
];

const settingsRouteBindings: readonly KeymapBinding[] = settingsRouteKeys.map(keyValue =>
	literal(keyValue, keyValue === "escape" ? "ui.dismiss" : "app.settings.input", "Browse", "body"),
);

const commandRouteBindings: readonly KeymapBinding[] = [
	literal("escape", "ui.dismiss", "Browse", "body"),
	literal("ctrl+c", "ui.dismiss", "Browse", "body"),
	literal("enter", "app.command.submit", "Browse", "body"),
	literal("backspace", "app.command.backspace", "Browse", "body"),
	literal("tab", "app.command.completionNext", "Browse", "body"),
	literal("shift+tab", "app.command.completionPrevious", "Browse", "body"),
	literal("up", "app.command.previous", "Browse", "body"),
	literal("ctrl+p", "app.command.previous", "Browse", "body"),
	literal("down", "app.command.next", "Browse", "body"),
	literal("ctrl+n", "app.command.next", "Browse", "body"),
	literal("pageUp", "app.command.previous", "Browse", "body"),
	literal("pageDown", "app.command.next", "Browse", "body"),
	literal("delete", "tui.editor.deleteCharForward", "Browse", "body"),
	literal("left", "tui.editor.cursorLeft", "Browse", "body"),
	literal("right", "tui.editor.cursorRight", "Browse", "body"),
	literal("home", "tui.editor.cursorLineStart", "Browse", "body"),
	literal("ctrl+a", "tui.editor.cursorLineStart", "Browse", "body"),
	literal("end", "tui.editor.cursorLineEnd", "Browse", "body"),
	literal("ctrl+e", "tui.editor.cursorLineEnd", "Browse", "body"),
	literal("alt+backspace", "tui.editor.deleteWordBackward", "Browse", "body"),
	literal("ctrl+w", "tui.editor.deleteWordBackward", "Browse", "body"),
	...printableSelectorKeys.map(keyValue => literal(keyValue, "app.command.input", "Browse", "body")),
];

const planReviewRouteKeys: readonly KeyId[] = [
	...Array.from({ length: 95 }, (_, index) =>
		(index === 0 ? "space" : String.fromCharCode(index + 32)) as KeyId,
	),
	"enter",
	"backspace",
	"delete",
	"tab",
	"shift+tab",
	"left",
	"right",
	"up",
	"down",
	"home",
	"end",
	"pageUp",
	"pageDown",
];

const planReviewRouteBindings: readonly KeymapBinding[] = [
	resolved("ui.dismiss", "Browse", "body"),
	resolved("app.editor.external", "Browse", "body"),
	...planReviewRouteKeys.map(keyValue => literal(keyValue, "app.plan.reviewInput", "Browse", "body")),
];

const setupRouteKeys: readonly KeyId[] = [
	...Array.from({ length: 95 }, (_, index) =>
		(index === 0 ? "space" : String.fromCharCode(index + 32)) as KeyId,
	),
	"enter",
	"escape",
	"backspace",
	"tab",
	"left",
	"right",
	"up",
	"down",
	"home",
	"end",
	"pageUp",
	"pageDown",
];

const setupRouteBindings: readonly KeymapBinding[] = [
	literal("ctrl+c", "setup.cancel", "Browse", "list"),
	literal("ctrl+c", "setup.cancel", "Browse", "input"),
	...setupRouteKeys.map(keyValue =>
		literal(keyValue, keyValue === "escape" ? "ui.dismiss" : "setup.input", "Browse", "list"),
	),
	...setupRouteKeys.map(keyValue =>
		literal(keyValue, keyValue === "escape" ? "ui.dismiss" : "setup.input", "Browse", "input"),
	),
];

export const SELECTOR_GLOBAL_KEYMAP: KeymapTable = {
	id: makeKeymapId("selector.global"),
	layer: "global",
	contexts: ["selector.global"],
	bindings: selectorGlobalBindings,
};

export const SELECTOR_FILTER_KEYMAP: KeymapTable = {
	id: makeKeymapId("selector.filter"),
	layer: "family",
	contexts: ["selector.filter"],
	bindings: selectorFilterBindings,
};

export const ATTENTION_FAMILY_KEYMAP: KeymapTable = {
	id: makeKeymapId("attention.family"),
	layer: "family",
	contexts: ["attention.family"],
	bindings: attentionFamilyBindings,
};

export const MODAL_FAMILY_KEYMAP: KeymapTable = {
	id: makeKeymapId("modal.family"),
	layer: "family",
	contexts: ["modal.family"],
	bindings: modalFamilyBindings,
};

export const SETTINGS_MVU_KEYMAP: KeymapTable = {
	id: makeKeymapId("settings.route"),
	layer: "adapter",
	contexts: ["modal.settings"],
	supersedesContexts: ["modal.family"],
	bindings: settingsRouteBindings,
};

export const COMMAND_LINE_MVU_KEYMAP: KeymapTable = {
	id: makeKeymapId("command.line"),
	layer: "adapter",
	contexts: ["modal.command"],
	supersedesContexts: ["modal.family"],
	bindings: commandRouteBindings,
};

export const PLAN_REVIEW_MVU_KEYMAP: KeymapTable = {
	id: makeKeymapId("plan.review"),
	layer: "adapter",
	contexts: ["modal.plan-review"],
	supersedesContexts: ["modal.family"],
	bindings: planReviewRouteBindings,
};

export const MODEL_SELECTOR_MVU_KEYMAP: KeymapTable = {
	id: makeKeymapId("model.selector"),
	layer: "adapter",
	contexts: ["modal.model"],
	bindings: [literal("tab", "app.selector.sourceNext", "Browse", "list")],
};

export const SESSION_SELECTOR_MVU_KEYMAP: KeymapTable = {
	id: makeKeymapId("session.selector"),
	layer: "adapter",
	contexts: ["session.selector"],
	supersedesContexts: ["selector.global", "selector.filter"],
	bindings: [
		resolved("app.session.delete", "Browse", "list"),
		resolved("app.session.delete", "Filter", "list"),
	],
};

export const HOOK_FLOW_MVU_KEYMAP: KeymapTable = {
	id: makeKeymapId("hook.flow"),
	layer: "adapter",
	contexts: ["hook.route"],
	bindings: hookRouteBindings,
};

export const SETUP_WIZARD_MVU_KEYMAP: KeymapTable = {
	id: makeKeymapId("setup.route"),
	layer: "adapter",
	contexts: ["setup.glyph", "setup.theme", "setup.providers", "oauth.prompt"],
	supersedesContexts: ["selector.global"],
	bindings: setupRouteBindings,
};

export const AGENT_HUB_MVU_KEYMAP: KeymapTable = {
	id: makeKeymapId("hub.adapter"),
	layer: "adapter",
	contexts: ["hub.route"],
	// Hub owns raw route grammar outside triage. Triage retains only lifecycle
	// literals so attention.family dispatches its remappable semantic actions.
	supersedesContexts: ["selector.global", "selector.filter", "attention.family"],
	bindings: hubRouteBindings,
};

const usageHudBindings: readonly KeymapBinding[] = [
	resolved("app.navigation.down", "Browse", "list"),
	resolved("app.navigation.up", "Browse", "list"),
	resolved("app.navigation.pageDown", "Browse", "list"),
	resolved("app.navigation.pageUp", "Browse", "list"),
	resolved("app.navigation.top", "Browse", "list"),
	resolved("app.navigation.bottom", "Browse", "list"),
	resolved("ui.dismiss", "Browse", "list"),
	literal("q", "ui.dismiss", "Browse", "list"),
];

export const USAGE_HUD_MVU_KEYMAP: KeymapTable = {
	id: makeKeymapId("usage.hud"),
	layer: "adapter",
	contexts: ["usage.hud"],
	supersedesContexts: ["selector.global", "selector.filter"],
	bindings: usageHudBindings,
};

const errorsDockBindings: readonly KeymapBinding[] = [
	literal("p", "app.errors.togglePin", "Browse", "list"),
	literal("ctrl+w", "app.errors.beginFocusChord", "Browse", "list"),
	literal("w", "app.errors.finishFocusChord", "Browse", "list"),
];

export const ERRORS_DOCK_MVU_KEYMAP: KeymapTable = {
	id: makeKeymapId("errors.dock"),
	layer: "adapter",
	contexts: ["errors.dock"],
	supersedesContexts: ["selector.global", "selector.filter"],
	bindings: errorsDockBindings,
};

const activeContext = (
	contexts: readonly string[],
	mode: ActiveKeymapContext["mode"],
	focus: ActiveKeymapContext["focus"],
	capabilities: readonly string[] = [],
): ActiveKeymapContext => ({
	contexts,
	mode,
	focus,
	capabilities: new Set(capabilities),
});

/**
 * Concrete context combinations which can own input at the same time.
 *
 * Adapter routes appear in separate entries because the input lease makes
 * them mutually exclusive. Family/global contexts share an entry only when
 * the route actually activates them together.
 */
export const MVU_ACTIVE_KEYMAP_CONTEXT_MATRIX: ActiveKeymapContextMatrix = [
	activeContext(["selector.global", "selector.filter"], "Browse", "list", ["selector.filter"]),
	activeContext(["selector.global", "selector.filter"], "Filter", "list", ["selector.filter"]),
	activeContext(["selector.global", "selector.filter"], "PreviewFocus", "preview", ["selector.filter"]),
	activeContext(["selector.global", "selector.filter"], "Confirm", "preview", ["selector.filter"]),
	activeContext(["selector.global", "selector.filter", "session.selector"], "Browse", "list", ["selector.filter"]),
	activeContext(["selector.global", "selector.filter", "session.selector"], "Filter", "list", ["selector.filter"]),
	activeContext(["selector.global", "selector.filter", "session.selector"], "PreviewFocus", "preview", ["selector.filter"]),
	activeContext(["selector.global", "selector.filter", "session.selector"], "Confirm", "preview", ["selector.filter"]),
	activeContext(
		["selector.global", "selector.filter", "hook.route"],
		"Browse",
		"list",
		["selector.filter", "hook.slider"],
	),
	activeContext(
		["selector.global", "selector.filter", "hook.route"],
		"Filter",
		"list",
		["selector.filter", "hook.slider"],
	),
	activeContext(
		["selector.global", "selector.filter", "hook.route"],
		"Filter",
		"list",
		["selector.filter", "hook.editor"],
	),
	activeContext(["selector.global", "selector.filter", "hook.route"], "Filter", "list", ["selector.filter"]),
	activeContext(["selector.global", "selector.filter"], "TreeBrowse", "list", ["selector.filter"]),
	activeContext(["selector.global", "selector.filter"], "TreeFilter", "list", ["selector.filter"]),
	activeContext(["selector.global", "selector.filter"], "TreePreview", "preview"),
	activeContext(["selector.global", "selector.filter"], "TreeLabelEdit", "preview"),
	activeContext(["selector.global", "selector.filter"], "TreeConfirm", "preview"),
	activeContext(["attention.family"], "Browse", "list", ["attention"]),
	activeContext(["attention.family"], "Triage", "triage", ["attention"]),
	activeContext(["attention.family", "selector.global", "hub.route"], "Browse", "list", ["attention"]),
	activeContext(["selector.filter", "selector.global", "hub.route"], "Filter", "list", ["attention"]),
	activeContext(["selector.global", "hub.route"], "PreviewFocus", "preview", ["attention"]),
	activeContext(["attention.family", "hub.route"], "Triage", "triage", ["attention"]),
	activeContext(["modal.family"], "Browse", "body"),
	activeContext(["modal.family", "modal.command"], "Browse", "body"),
	activeContext(["modal.family", "modal.plan-review"], "Browse", "body"),
	activeContext(["modal.family", "modal.settings"], "Browse", "body"),
	activeContext(["selector.global", "selector.filter", "modal.model"], "Browse", "list", ["selector.filter"]),
	activeContext(["setup.glyph", "selector.global"], "Browse", "list", ["selector.preview"]),
	activeContext(["setup.glyph", "selector.global"], "Browse", "input"),
	activeContext(["setup.theme", "selector.global"], "Browse", "list", ["selector.preview"]),
	activeContext(["setup.providers", "providers.tabs"], "Browse", "list", ["selector.preview"]),
	activeContext(["setup.providers", "oauth.prompt"], "Browse", "input", ["oauth.prompt"]),
	activeContext(["usage.hud"], "Browse", "list"),
	activeContext(["errors.dock", "selector.global", "selector.filter"], "Browse", "list", ["errors", "selector.filter"]),
	activeContext(["errors.dock", "selector.global", "selector.filter"], "Filter", "list", ["errors", "selector.filter"]),
	activeContext(["errors.dock", "selector.global", "selector.filter"], "PreviewFocus", "preview", ["errors", "selector.filter"]),
	activeContext(["errors.dock", "selector.global", "selector.filter"], "Confirm", "preview", ["errors", "selector.filter"]),
];

export const MVU_KEYMAP_TABLES: readonly KeymapTable[] = [
	SELECTOR_GLOBAL_KEYMAP,
	SELECTOR_FILTER_KEYMAP,
	SESSION_SELECTOR_MVU_KEYMAP,
	HOOK_FLOW_MVU_KEYMAP,
	ERRORS_DOCK_MVU_KEYMAP,
	ATTENTION_FAMILY_KEYMAP,
	MODAL_FAMILY_KEYMAP,
	COMMAND_LINE_MVU_KEYMAP,
	PLAN_REVIEW_MVU_KEYMAP,
	SETTINGS_MVU_KEYMAP,
	MODEL_SELECTOR_MVU_KEYMAP,
	AGENT_HUB_MVU_KEYMAP,
	SETUP_WIZARD_MVU_KEYMAP,
	USAGE_HUD_MVU_KEYMAP,
];
