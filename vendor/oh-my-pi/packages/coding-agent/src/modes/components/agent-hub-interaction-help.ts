import { replaceTabs, truncateToWidth } from "../../tools/render-utils";
import {
	renderInteractionHelp,
	renderInteractionLegend,
	type InteractionMode,
	type InteractionSurface,
	VIEWER_NAVIGATION_INTERACTION_IDS,
} from "../interaction-registry";
import { theme } from "../theme/theme";

type AgentHubInteractionSurface = Extract<InteractionSurface, "hub.table" | "hub.chat" | "hub.inspector">;

const NORMAL_FOOTER_IDS: Record<AgentHubInteractionSurface, readonly string[]> = {
	"hub.table": [
		...VIEWER_NAVIGATION_INTERACTION_IDS,
		"hub.table.next-agent",
		"hub.table.previous-agent",
		"hub.table.previous-group",
		"hub.table.next-group",
		"hub.table.search",
		"viewer.fold",
		"viewer.previous-sibling",
		"viewer.next-sibling",
		"viewer.help",
		"hub.table.history",
		"hub.table.rich",
		"hub.table.yank-identity",
		"hub.table.attach",
		"hub.table.close",
	],
	"hub.chat": [
		...VIEWER_NAVIGATION_INTERACTION_IDS,
		"hub.chat.search",
		"viewer.previous-sibling",
		"viewer.next-sibling",
		"viewer.help",
		"hub.chat.rich",
		"hub.chat.close",
	],
	"hub.inspector": [
		...VIEWER_NAVIGATION_INTERACTION_IDS,
		"viewer.previous-sibling",
		"viewer.next-sibling",
		"viewer.help",
	],
};

const NORMAL_FOOTER_PRIORITY_IDS: Record<AgentHubInteractionSurface, readonly string[]> = {
	"hub.table": ["hub.table.search"],
	"hub.chat": ["hub.chat.search"],
	"hub.inspector": [],
};

const EMPTY_INTERACTION_IDS: readonly string[] = [];
const NORMAL_FOOTER_REMAINDER_IDS: Record<AgentHubInteractionSurface, readonly string[]> = {
	"hub.table": NORMAL_FOOTER_IDS["hub.table"].filter(id => id !== "hub.table.search"),
	"hub.chat": NORMAL_FOOTER_IDS["hub.chat"].filter(id => id !== "hub.chat.search"),
	"hub.inspector": NORMAL_FOOTER_IDS["hub.inspector"],
};

const NORMAL_HELP_IDS: Record<AgentHubInteractionSurface, readonly string[]> = {
	"hub.table": [
		...NORMAL_FOOTER_IDS["hub.table"].filter(id => id !== "viewer.previous-sibling" && id !== "viewer.next-sibling"),
		"hub.table.cycle-siblings",
	],
	"hub.chat": [
		...NORMAL_FOOTER_IDS["hub.chat"].filter(id => id !== "viewer.previous-sibling" && id !== "viewer.next-sibling"),
		"hub.chat.cycle-siblings",
	],
	"hub.inspector": NORMAL_FOOTER_IDS["hub.inspector"],
};

function interactionSurfaces(
	surface: AgentHubInteractionSurface,
	mode: InteractionMode,
): readonly InteractionSurface[] {
	if (mode !== "normal") return [surface];
	return surface === "hub.inspector" ? ["viewer", "hub.table", surface] : ["viewer", surface];
}

export function renderAgentHubHelp(width: number, surface: AgentHubInteractionSurface): readonly string[] {
	const maxWidth = Math.max(10, width - 2);
	const body = renderInteractionHelp({
		surfaces: interactionSurfaces(surface, "normal"),
		ids: NORMAL_HELP_IDS[surface],
	});
	return [
		` ${theme.fg("accent", "Help (press ? to hide)")}`,
		`   ${theme.fg("success", "S")} subscription · ${theme.fg("warning", "A")} auth/paid`,
		...body.map(line => `   ${theme.fg("dim", line)}`),
	].map(line => truncateToWidth(replaceTabs(line), maxWidth));
}

export function renderAgentHubFooter(options: {
	readonly width: number;
	readonly surface: AgentHubInteractionSurface;
	readonly mode: InteractionMode;
	readonly extra?: readonly string[];
}): string {
	const ids = options.mode === "normal" ? NORMAL_FOOTER_REMAINDER_IDS[options.surface] : undefined;
	const priorityIds = options.mode === "normal" ? NORMAL_FOOTER_PRIORITY_IDS[options.surface] : EMPTY_INTERACTION_IDS;
	const surfaces = interactionSurfaces(options.surface, options.mode);
	const priorityLegend = renderInteractionLegend({
		surfaces,
		modes: [options.mode],
		ids: priorityIds,
	});
	const legend = renderInteractionLegend({
		surfaces,
		modes: [options.mode],
		ids,
	});
	const text = [...(options.extra ?? []), priorityLegend, legend].filter(Boolean).join("  ");
	return ` ${theme.fg("dim", truncateToWidth(replaceTabs(text), Math.max(10, options.width - 2)))}`;
}

export function renderAgentHubChatFooter(options: {
	readonly width: number;
	readonly filterEditing: boolean;
	readonly showHelp: boolean;
	readonly status?: readonly string[];
	readonly archive?: { readonly state: string; readonly modelId?: string; readonly thinkingLevel?: string | null };
	readonly extra?: readonly (string | undefined)[];
}): string[] {
	const mode: InteractionMode = options.filterEditing ? "filter" : "normal";
	const lines = options.showHelp ? [...renderAgentHubHelp(options.width, "hub.chat")] : [];
	if (options.archive) {
		const route = options.archive.modelId
			? `${options.archive.modelId}${options.archive.thinkingLevel ? `:${options.archive.thinkingLevel}` : ""}`
			: "route unavailable";
		lines.push(` ${theme.fg("dim", `${options.archive.state} archived · ${route} · read-only`)}`);
	}
	lines.push(...(options.status ?? []).filter(Boolean).map(line => ` ${theme.fg("dim", line)}`));
	lines.push(
		renderAgentHubFooter({
			width: options.width,
			surface: "hub.chat",
			mode,
			extra: options.extra?.filter((value): value is string => Boolean(value)),
		}),
	);
	return lines;
}
