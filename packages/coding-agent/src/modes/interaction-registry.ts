import { getKeybindings, matchesKey } from "@oh-my-pi/pi-tui";
import { formatKeyHints, KEYBINDINGS, type Keybinding } from "../config/keybindings";

export type InteractionSurface = "viewer" | "hub.table" | "hub.chat" | "hub.inspector" | "command-line";
export type InteractionMode = "normal" | "input" | "filter" | "completion";
export type InteractionGroup = "move" | "navigate" | "view" | "mode" | "finish";
export type InteractionSemantics =
	| "line-down"
	| "line-up"
	| "display-row-down"
	| "display-row-up"
	| "five-lines-down"
	| "five-lines-up"
	| "half-page-down"
	| "half-page-up"
	| "full-page-down"
	| "full-page-up"
	| "first-line"
	| "last-line"
	| "unwind"
	| "enter-filter"
	| "show-help"
	| "enter-command"
	| "toggle-fold"
	| "previous-sibling"
	| "next-sibling"
	| "cycle-siblings"
	| "cycle-sections"
	| "previous-item"
	| "next-item"
	| "previous-group"
	| "next-group"
	| "toggle-history"
	| "toggle-rich"
	| "attach"
	| "yank-identity"
	| "close"
	| "literal-input"
	| "previous-completion"
	| "next-completion"
	| "previous-completion-page"
	| "next-completion-page"
	| "accept-completion"
	| "submit-command"
	| "cancel-command";

type InteractionBinding =
	| { readonly keys: readonly string[]; readonly action?: never; readonly repeat?: never }
	| { readonly action: Keybinding; readonly keys?: readonly string[]; readonly repeat?: number };

export type InteractionEntry = {
	readonly id: string;
	readonly surface: InteractionSurface;
	readonly mode: InteractionMode;
	readonly description: string;
	readonly semantics: InteractionSemantics;
	readonly group: InteractionGroup;
} & InteractionBinding;

export const INTERACTIONS: readonly InteractionEntry[] = [
	{
		id: "viewer.line-down",
		surface: "viewer",
		mode: "normal",
		action: "app.navigation.down",
		keys: ["j"],
		description: "scroll one line down",
		semantics: "line-down",
		group: "move",
	},
	{
		id: "viewer.line-up",
		surface: "viewer",
		mode: "normal",
		action: "app.navigation.up",
		keys: ["k"],
		description: "scroll one line up",
		semantics: "line-up",
		group: "move",
	},
	{
		id: "viewer.display-row-down",
		surface: "viewer",
		mode: "normal",
		keys: ["gj"],
		description: "scroll one display row down",
		semantics: "display-row-down",
		group: "move",
	},
	{
		id: "viewer.display-row-up",
		surface: "viewer",
		mode: "normal",
		keys: ["gk"],
		description: "scroll one display row up",
		semantics: "display-row-up",
		group: "move",
	},
	{
		id: "viewer.five-lines-down",
		surface: "viewer",
		mode: "normal",
		keys: ["J"],
		description: "scroll five lines down",
		semantics: "five-lines-down",
		group: "move",
	},
	{
		id: "viewer.five-lines-up",
		surface: "viewer",
		mode: "normal",
		keys: ["K"],
		description: "scroll five lines up",
		semantics: "five-lines-up",
		group: "move",
	},
	{
		id: "viewer.half-page-down",
		surface: "viewer",
		mode: "normal",
		action: "app.navigation.pageDown",
		keys: ["d"],
		description: "scroll half-page down",
		semantics: "half-page-down",
		group: "move",
	},
	{
		id: "viewer.half-page-up",
		surface: "viewer",
		mode: "normal",
		action: "app.navigation.pageUp",
		keys: ["u"],
		description: "scroll half-page up",
		semantics: "half-page-up",
		group: "move",
	},
	{
		id: "viewer.full-page-down",
		surface: "viewer",
		mode: "normal",
		keys: ["PgDn"],
		description: "scroll full page down",
		semantics: "full-page-down",
		group: "move",
	},
	{
		id: "viewer.full-page-up",
		surface: "viewer",
		mode: "normal",
		keys: ["PgUp"],
		description: "scroll full page up",
		semantics: "full-page-up",
		group: "move",
	},
	{
		id: "viewer.first-line",
		surface: "viewer",
		mode: "normal",
		action: "app.navigation.top",
		repeat: 2,
		description: "jump to the first line",
		semantics: "first-line",
		group: "navigate",
	},
	{
		id: "viewer.last-line",
		surface: "viewer",
		mode: "normal",
		action: "app.navigation.bottom",
		description: "jump to the last line",
		semantics: "last-line",
		group: "navigate",
	},
	{
		id: "viewer.unwind",
		surface: "viewer",
		mode: "normal",
		action: "ui.dismiss",
		description: "unwind one level",
		semantics: "unwind",
		group: "finish",
	},
	{
		id: "viewer.filter",
		surface: "viewer",
		mode: "normal",
		keys: ["/"],
		description: "filter or search",
		semantics: "enter-filter",
		group: "mode",
	},
	{
		id: "viewer.help",
		surface: "viewer",
		mode: "normal",
		keys: ["?"],
		description: "show contextual help",
		semantics: "show-help",
		group: "mode",
	},
	{
		id: "viewer.command",
		surface: "viewer",
		mode: "normal",
		keys: [":"],
		description: "open command line",
		semantics: "enter-command",
		group: "mode",
	},
	{
		id: "viewer.fold",
		surface: "viewer",
		mode: "normal",
		keys: ["za"],
		description: "toggle fold",
		semantics: "toggle-fold",
		group: "view",
	},
	{
		id: "viewer.previous-sibling",
		surface: "viewer",
		mode: "normal",
		keys: ["["],
		description: "previous sibling",
		semantics: "previous-sibling",
		group: "navigate",
	},
	{
		id: "viewer.next-sibling",
		surface: "viewer",
		mode: "normal",
		keys: ["]"],
		description: "next sibling",
		semantics: "next-sibling",
		group: "navigate",
	},

	{
		id: "hub.table.search",
		surface: "hub.table",
		mode: "normal",
		keys: ["/"],
		description: "search",
		semantics: "enter-filter",
		group: "mode",
	},
	{
		id: "hub.table.next-row",
		surface: "hub.table",
		mode: "normal",
		keys: ["j", "↓"],
		description: "select next visible row",
		semantics: "next-item",
		group: "navigate",
	},
	{
		id: "hub.table.previous-row",
		surface: "hub.table",
		mode: "normal",
		keys: ["k", "↑"],
		description: "select previous visible row",
		semantics: "previous-item",
		group: "navigate",
	},
	{
		id: "hub.table.next-orchestrator",
		surface: "hub.table",
		mode: "normal",
		keys: ["n"],
		description: "next orchestrator root",
		semantics: "next-group",
		group: "navigate",
	},
	{
		id: "hub.table.previous-orchestrator",
		surface: "hub.table",
		mode: "normal",
		keys: ["p"],
		description: "previous orchestrator root",
		semantics: "previous-group",
		group: "navigate",
	},
	{
		id: "hub.table.history",
		surface: "hub.table",
		mode: "normal",
		keys: ["."],
		description: "toggle agent history",
		semantics: "toggle-history",
		group: "view",
	},
	{
		id: "hub.table.rich",
		surface: "hub.table",
		mode: "normal",
		keys: ["v"],
		description: "rich/plain preview",
		semantics: "toggle-rich",
		group: "view",
	},
	{
		id: "hub.table.yank-identity",
		surface: "hub.table",
		mode: "normal",
		keys: ["y"],
		description: "yank selected child identity",
		semantics: "yank-identity",
		group: "finish",
	},
	{
		id: "hub.table.attach",
		surface: "hub.table",
		mode: "normal",
		keys: ["Enter"],
		description: "attach to selected agent",
		semantics: "attach",
		group: "finish",
	},
	{
		id: "hub.table.close",
		surface: "hub.table",
		mode: "normal",
		keys: ["q"],
		description: "close Hub",
		semantics: "close",
		group: "finish",
	},
	{
		id: "hub.table.filter-literals",
		surface: "hub.table",
		mode: "filter",
		keys: ["text"],
		description: "enter filter text",
		semantics: "literal-input",
		group: "mode",
	},
	{
		id: "hub.table.filter-unwind",
		surface: "hub.table",
		mode: "filter",
		action: "ui.dismiss",
		description: "clear filter and return",
		semantics: "unwind",
		group: "finish",
	},

	{
		id: "hub.inspector.cycle-sections",
		surface: "hub.inspector",
		mode: "normal",
		keys: ["[ / ]", "← / →"],
		description: "cycle inspector sections",
		semantics: "cycle-sections",
		group: "navigate",
	},
	{
		id: "hub.chat.search",
		surface: "hub.chat",
		mode: "normal",
		keys: ["/"],
		description: "search",
		semantics: "enter-filter",
		group: "mode",
	},
	{
		id: "hub.chat.rich",
		surface: "hub.chat",
		mode: "normal",
		keys: ["v"],
		description: "rich/plain preview",
		semantics: "toggle-rich",
		group: "view",
	},
	{
		id: "hub.chat.close",
		surface: "hub.chat",
		mode: "normal",
		keys: ["q"],
		description: "close Hub",
		semantics: "close",
		group: "finish",
	},
	{
		id: "hub.chat.filter-literals",
		surface: "hub.chat",
		mode: "filter",
		keys: ["text"],
		description: "enter search text",
		semantics: "literal-input",
		group: "mode",
	},
	{
		id: "hub.chat.filter-unwind",
		surface: "hub.chat",
		mode: "filter",
		action: "ui.dismiss",
		description: "clear search and return",
		semantics: "unwind",
		group: "finish",
	},

	{
		id: "command-line.previous",
		surface: "command-line",
		mode: "completion",
		keys: ["Up"],
		description: "previous completion",
		semantics: "previous-completion",
		group: "navigate",
	},
	{
		id: "command-line.next",
		surface: "command-line",
		mode: "completion",
		keys: ["Down"],
		description: "next completion",
		semantics: "next-completion",
		group: "navigate",
	},
	{
		id: "command-line.previous-page",
		surface: "command-line",
		mode: "completion",
		keys: ["PgUp"],
		description: "previous completion page",
		semantics: "previous-completion-page",
		group: "navigate",
	},
	{
		id: "command-line.next-page",
		surface: "command-line",
		mode: "completion",
		keys: ["PgDn"],
		description: "next completion page",
		semantics: "next-completion-page",
		group: "navigate",
	},
	{
		id: "command-line.accept",
		surface: "command-line",
		mode: "completion",
		keys: ["Tab"],
		description: "accept completion",
		semantics: "accept-completion",
		group: "finish",
	},
	{
		id: "command-line.submit",
		surface: "command-line",
		mode: "input",
		keys: ["Enter"],
		description: "run command",
		semantics: "submit-command",
		group: "finish",
	},
	{
		id: "command-line.cancel",
		surface: "command-line",
		mode: "input",
		action: "ui.dismiss",
		keys: ["Ctrl+C"],
		description: "close command line locally",
		semantics: "cancel-command",
		group: "finish",
	},
];

const VIEWER_SCROLL_INTERACTION_IDS: readonly string[] = [
	"viewer.line-down",
	"viewer.line-up",
	"viewer.five-lines-down",
	"viewer.display-row-down",
	"viewer.display-row-up",
	"viewer.five-lines-up",
	"viewer.half-page-down",
	"viewer.half-page-up",
	"viewer.full-page-down",
	"viewer.full-page-up",
];

export const VIEWER_NAVIGATION_INTERACTION_IDS: readonly string[] = [
	...VIEWER_SCROLL_INTERACTION_IDS,
	"viewer.first-line",
	"viewer.last-line",
];
export const AGENT_HUB_SHORTCUT_INTERACTION_IDS: readonly string[] = [
	...VIEWER_NAVIGATION_INTERACTION_IDS,
	"viewer.unwind",
	"viewer.fold",
	"viewer.previous-sibling",
	"viewer.next-sibling",
	"viewer.help",
	"hub.table.search",
	"hub.table.next-row",
	"hub.table.previous-row",
	"hub.table.next-orchestrator",
	"hub.table.previous-orchestrator",
	"hub.table.history",
	"hub.table.rich",
	"hub.table.yank-identity",
	"hub.table.attach",
	"hub.table.close",
	"hub.chat.search",
	"hub.chat.rich",
	"hub.chat.close",
];
function matchesDirectInteractionKey(keyData: string, key: string): boolean {
	if (key === "J") return keyData === "J" || matchesKey(keyData, "shift+j");
	if (key === "K") return keyData === "K" || matchesKey(keyData, "shift+k");
	if (key === "PgDn") return matchesKey(keyData, "pageDown");
	if (key === "PgUp") return matchesKey(keyData, "pageUp");
	return keyData === key;
}

function matchesInteractionEntry(keyData: string, entry: InteractionEntry): boolean {
	if (entry.action !== undefined) {
		const keybindings = getKeybindings();
		if (keybindings.getKeys(entry.action).length > 0 && keybindings.matches(keyData, entry.action)) return true;
	}
	return entry.keys?.some(key => matchesDirectInteractionKey(keyData, key)) ?? false;
}

/** Resolve a read-only viewer scroll key from the same registry used by footer/help rendering. */
export function resolveViewerScrollDelta(keyData: string, viewportHeight: number): number | undefined {
	const viewport = Math.max(1, viewportHeight);
	for (const entry of INTERACTIONS) {
		if (!VIEWER_SCROLL_INTERACTION_IDS.includes(entry.id) || !matchesInteractionEntry(keyData, entry)) continue;
		switch (entry.semantics) {
			case "line-down":
				return 1;
			case "line-up":
				return -1;
			case "five-lines-down":
				return 5;
			case "five-lines-up":
				return -5;
			case "half-page-down":
				return Math.max(1, Math.floor(viewport / 2));
			case "half-page-up":
				return -Math.max(1, Math.floor(viewport / 2));
			case "full-page-down":
				return viewport;
			case "full-page-up":
				return -viewport;
			default:
				return undefined;
		}
	}
	return undefined;
}

export type InteractionKeyResolver = (action: Keybinding) => string;

export interface InteractionQuery {
	readonly surfaces: readonly InteractionSurface[];
	readonly modes?: readonly InteractionMode[];
	readonly ids?: readonly string[];
	readonly resolveAction?: InteractionKeyResolver;
}

interface RenderedInteraction {
	readonly keys: string;
	readonly description: string;
	readonly semantics: InteractionSemantics;
	readonly group: InteractionGroup;
}

function entryKeyLabel(entry: InteractionEntry, resolveAction: InteractionKeyResolver): string {
	const actionKeys =
		entry.action !== undefined
			? resolveAction(entry.action)
					.split("/")
					.filter(Boolean)
					.map(key => (entry.repeat && entry.repeat > 1 ? key.repeat(entry.repeat) : key))
			: [];
	const labels = [...actionKeys, ...(entry.keys ?? [])];
	const unique = labels.filter(
		(label, index) => labels.findIndex(candidate => candidate.toLowerCase() === label.toLowerCase()) === index,
	);
	return unique.join("/") || "Disabled";
}

export function getInteractions(query: InteractionQuery): readonly InteractionEntry[] {
	const surfaces = new Set(query.surfaces);
	const modes = new Set(query.modes ?? ["normal"]);
	const ids = query.ids ? new Set(query.ids) : undefined;
	return INTERACTIONS.filter(
		entry => surfaces.has(entry.surface) && modes.has(entry.mode) && (!ids || ids.has(entry.id)),
	);
}

function resolveRegisteredAction(action: Keybinding): string {
	const keybindings = getKeybindings();
	const keys = keybindings.getKeys(action);
	if (keys.length > 0 || keybindings.getDefinition(action) !== undefined) return formatKeyHints(keys);
	const defaultKeys = KEYBINDINGS[action]?.defaultKeys;
	if (defaultKeys === undefined) return "";
	return formatKeyHints(typeof defaultKeys === "string" ? defaultKeys : [...defaultKeys]);
}

function renderedInteractions(query: InteractionQuery): readonly RenderedInteraction[] {
	const resolveAction = query.resolveAction ?? resolveRegisteredAction;
	const rendered: RenderedInteraction[] = [];
	for (const entry of getInteractions(query)) {
		const keys = entryKeyLabel(entry, resolveAction);
		const existing = rendered.find(
			item =>
				item.semantics === entry.semantics && item.description === entry.description && item.group === entry.group,
		);
		if (existing) {
			(
				rendered as Array<{
					keys: string;
					description: string;
					semantics: InteractionSemantics;
					group: InteractionGroup;
				}>
			)[rendered.indexOf(existing)] = { ...existing, keys: `${existing.keys}/${keys}` };
		} else {
			rendered.push({ keys, description: entry.description, semantics: entry.semantics, group: entry.group });
		}
	}
	return rendered;
}

export function renderInteractionLegend(query: InteractionQuery): string {
	return renderedInteractions(query)
		.map(entry => `${entry.keys}:${entry.description}`)
		.join("  ");
}

const GROUP_LABELS: Record<InteractionGroup, string> = {
	move: "Move",
	navigate: "Navigate",
	view: "View",
	mode: "Mode",
	finish: "Close",
};

export function renderInteractionHelp(query: InteractionQuery): readonly string[] {
	const entries = renderedInteractions(query);
	const groups: InteractionGroup[] = ["move", "navigate", "view", "mode", "finish"];
	return groups.flatMap(group => {
		const items = entries.filter(entry => entry.group === group);
		const lines: string[] = [];
		for (let offset = 0; offset < items.length; offset += 3) {
			const chunk = items.slice(offset, offset + 3);
			lines.push(
				`${offset === 0 ? GROUP_LABELS[group] : " ".repeat(GROUP_LABELS[group].length)}  ${chunk.map(entry => `${entry.keys} ${entry.description}`).join(" · ")}`,
			);
		}
		return lines;
	});
}

export function renderInteractionMarkdown(
	sections: readonly {
		readonly title: string;
		readonly surfaces: readonly InteractionSurface[];
		readonly modes?: readonly InteractionMode[];
	}[],
	resolveAction: InteractionKeyResolver,
): string {
	return sections
		.map(section => {
			const rows = renderedInteractions({ ...section, resolveAction }).map(
				entry => `| \`${entry.keys}\` | ${entry.description} |`,
			);
			return [`**${section.title}**`, "| Key | Action |", "|-----|--------|", ...rows].join("\n");
		})
		.join("\n\n");
}

export function renderCommandShortcutSection(): string {
	const viewer = renderInteractionHelp({ surfaces: ["viewer"] });
	const hub = renderInteractionHelp({
		surfaces: ["viewer", "hub.table", "hub.chat", "hub.inspector"],
		ids: AGENT_HUB_SHORTCUT_INTERACTION_IDS,
	});
	const commandLine = renderInteractionHelp({ surfaces: ["command-line"], modes: ["input", "completion"] });
	return [
		"",
		"Viewer shortcuts",
		...viewer,
		"",
		"Agent Hub shortcuts",
		...hub,
		"",
		"Command-line shortcuts",
		...commandLine,
	].join("\n");
}
