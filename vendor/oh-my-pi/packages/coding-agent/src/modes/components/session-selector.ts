import {
	type Component,
	Container,
	fuzzyMatch,
	type Keybinding,
	ScrollView,
	Spacer,
	Text,
	truncateToWidth,
	visibleWidth,
} from "@oh-my-pi/pi-tui";
import { formatBytes } from "@oh-my-pi/pi-utils";
import * as Schema from "effect/Schema";
import { makeComponentId } from "../mvu/schema";
import { theme } from "../../modes/theme/theme";
import type { SessionInfo, SessionStatus } from "../../session/session-listing";
import { shortenPath } from "../../tools/render-utils";
import { DynamicBorder } from "./dynamic-border";
import { editorKey } from "./keybinding-hints";
import { SelectorSurface, type SelectorSurfaceMountSpec } from "./selector-adapter";

function formatSessionStatus(status: SessionStatus | undefined): string | undefined {
	switch (status) {
		case "complete": return theme.fg("success", `${theme.status.success} done`);
		case "interrupted": return theme.fg("warning", `${theme.status.warning} interrupted`);
		case "aborted": return theme.fg("muted", `${theme.status.aborted} aborted`);
		case "error": return theme.fg("error", `${theme.status.error} error`);
		case "pending": return theme.fg("accent", `${theme.status.pending} pending`);
		default: return undefined;
	}
}

export type SessionHistoryMatcher = (query: string) => string[];

function sessionSearchText(session: SessionInfo): string {
	const workstream = session.workstream
		? session.workstream.kind === "workstream"
			? `${session.workstream.id} ${session.workstream.kind}`
			: session.workstream.kind
		: "";
	return [session.id, session.title ?? "", session.cwd ?? "", session.firstMessage ?? "", session.allMessagesText, session.path, workstream]
		.filter(Boolean)
		.join(" ");
}

function formatSessionWorkstream(workstream: SessionInfo["workstream"]): string | undefined {
	switch (workstream?.kind) {
		case "workstream": return theme.fg("accent", `[${workstream.id}]`);
		case "adhoc": return theme.fg("warning", "[adhoc]");
		default: return undefined;
	}
}

function tokenizeSessionQuery(query: string): string[] {
	const trimmed = query.trim().toLowerCase();
	return trimmed ? trimmed.split(/\s+/) : [];
}

function compareSessionRecency(a: SessionInfo, b: SessionInfo): number {
	return b.modified.getTime() - a.modified.getTime();
}

const MIN_PURE_FUZZY_TOKEN_SCORE = -20;

export function rankSessionSearchMatches(allSessions: SessionInfo[], query: string): SessionInfo[] {
	const tokens = tokenizeSessionQuery(query);
	if (tokens.length === 0) return allSessions;
	const results: Array<{ session: SessionInfo; score: number; literal: boolean; index: number }> = [];
	for (let index = 0; index < allSessions.length; index++) {
		const session = allSessions[index]!;
		const textLower = sessionSearchText(session).toLowerCase();
		let score = 0;
		let worstTokenScore = Number.NEGATIVE_INFINITY;
		let literal = true;
		let matches = true;
		for (const token of tokens) {
			const match = fuzzyMatch(token, textLower);
			if (!match.matches) {
				matches = false;
				break;
			}
			score += match.score;
			worstTokenScore = Math.max(worstTokenScore, match.score);
			if (!textLower.includes(token)) literal = false;
		}
		if (matches && (literal || worstTokenScore < MIN_PURE_FUZZY_TOKEN_SCORE)) results.push({ session, score, literal, index });
	}
	results.sort((a, b) => {
		if (a.literal !== b.literal) return a.literal ? -1 : 1;
		if (a.literal) return compareSessionRecency(a.session, b.session) || a.index - b.index;
		return a.score - b.score || compareSessionRecency(a.session, b.session) || a.index - b.index;
	});
	return results.map(result => result.session);
}

export function mergeSessionRanking(
	allSessions: SessionInfo[],
	fuzzy: SessionInfo[],
	historyIds: string[],
): SessionInfo[] {
	if (historyIds.length === 0) return fuzzy;
	const sessionsById = new Map<string, SessionInfo>();
	for (const session of allSessions) if (!sessionsById.has(session.id)) sessionsById.set(session.id, session);
	const historyMatches: SessionInfo[] = [];
	const historyPaths = new Set<string>();
	for (const id of historyIds) {
		const session = sessionsById.get(id);
		if (!session || historyPaths.has(session.path)) continue;
		historyMatches.push(session);
		historyPaths.add(session.path);
	}
	if (historyMatches.length === 0) return fuzzy;
	return [...historyMatches, ...fuzzy.filter(session => !historyPaths.has(session.path))];
}

function sessionPath(session: SessionInfo): string {
	return session.path;
}

function formatDate(date: Date): string {
	const diffMs = Math.max(0, Date.now() - date.getTime());
	const diffMins = Math.floor(diffMs / 60000);
	if (diffMins < 1) return "just now";
	const diffHours = Math.floor(diffMs / 3600000);
	if (diffHours < 24) return `${diffHours} hour${diffHours === 1 ? "" : "s"} ago`;
	const diffDays = Math.floor(diffMs / 86400000);
	if (diffDays === 1) return "1 day ago";
	if (diffDays < 7) return `${diffDays} days ago`;
	return date.toLocaleDateString();
}

const SessionStatusSchema = Schema.Literals(["complete", "interrupted", "aborted", "error", "pending", "unknown"]);
const SessionWorkstreamSchema = Schema.Union([
	Schema.Struct({ kind: Schema.Literal("workstream"), id: Schema.String }),
	Schema.Struct({ kind: Schema.Literal("adhoc") }),
]);
const SessionOwnerSchema = Schema.Struct({
	ownerEpoch: Schema.String,
	pid: Schema.Number,
	cwd: Schema.String,
	startedAt: Schema.String,
	muxHint: Schema.NullOr(Schema.String),
});
const SessionInfoWireSchema = Schema.Struct({
	path: Schema.String,
	id: Schema.String,
	cwd: Schema.String,
	title: Schema.optional(Schema.String),
	workstream: Schema.optional(SessionWorkstreamSchema),
	parentSessionPath: Schema.optional(Schema.String),
	created: Schema.String,
	modified: Schema.String,
	messageCount: Schema.Number,
	size: Schema.Number,
	firstMessage: Schema.String,
	allMessagesText: Schema.String,
	status: Schema.optional(SessionStatusSchema),
	owner: Schema.optional(SessionOwnerSchema),
});
const SessionInfoWiresSchema = Schema.Array(SessionInfoWireSchema);

function encodeSessions(sessions: readonly SessionInfo[]): string {
	return JSON.stringify(sessions.map(session => ({
		...session,
		created: session.created.toISOString(),
		modified: session.modified.toISOString(),
	})));
}

function decodeSessions(encoded: string): readonly SessionInfo[] {
	const decoded = Schema.decodeUnknownSync(SessionInfoWiresSchema)(JSON.parse(encoded), { onExcessProperty: "error" });
	return decoded.map(session => ({
		...session,
		created: new Date(session.created),
		modified: new Date(session.modified),
	}));
}

export interface SessionSelectorOptions {
	onDelete?: (session: SessionInfo) => Promise<boolean>;
	historyMatcher?: SessionHistoryMatcher;
	loadAllSessions?: () => Promise<SessionInfo[]>;
	allSessions?: SessionInfo[];
	startInAllScope?: boolean;
	getTerminalRows?: () => number;
}

/** Renderer-only viewport decoration; selector offset remains owned by the committed model. */
class SessionRowsComponent implements Component {
	readonly #scrollView = new ScrollView([], {
		height: 0,
		scrollbar: "auto",
		theme: {
			track: text => theme.fg("dim", text),
			thumb: text => theme.fg("accent", text),
		},
	});
	#totalRows = 0;
	#scrollOffset = 0;
	#showScrollbar = true;

	constructor(private readonly renderRows: (width: number) => readonly string[]) {}

	apply(
		sessions: readonly SessionInfo[],
		filteredIds: readonly string[],
		viewportOffset: number,
		showScrollbar: boolean,
	): void {
		const sessionsByPath = new Map<string, SessionInfo>();
		for (const session of sessions) sessionsByPath.set(session.path, session);
		let totalRows = 0;
		let scrollOffset = 0;
		for (let index = 0; index < filteredIds.length; index++) {
			const rowHeight = sessionsByPath.get(filteredIds[index]!)?.title ? 4 : 3;
			totalRows += rowHeight;
			if (index < viewportOffset) scrollOffset += rowHeight;
		}
		this.#totalRows = totalRows;
		this.#scrollOffset = scrollOffset;
		this.#showScrollbar = showScrollbar;
	}

	render(width: number): readonly string[] {
		const lines = this.renderRows(width);
		this.#scrollView.setLines(lines);
		this.#scrollView.setHeight(lines.length);
		this.#scrollView.setTotalRows(this.#totalRows);
		this.#scrollView.setScrollOffset(this.#scrollOffset);
		this.#scrollView.setScrollbar(this.#showScrollbar ? "auto" : "never");
		return this.#scrollView.render(width);
	}

	invalidate(): void {
		this.#scrollView.invalidate();
	}
}

export class SessionSelectorComponent extends Container {
	readonly #surface: SelectorSurface<string, SessionInfo>;
	readonly #sessionRows: SessionRowsComponent;
	readonly #headerText: Text;
	readonly #messageText: Text;
	#onRequestRender?: () => void;

	constructor(
		sessions: SessionInfo[],
		onSelect: (session: SessionInfo) => void,
		onCancel: () => void,
		onExit: () => void,
		options: SessionSelectorOptions = {},
	) {
		super();
		const folderSessions = [...sessions];
		const initialSourceTag = options.startInAllScope && options.allSessions !== undefined ? "all" : "folder";
		const initial = initialSourceTag === "all" ? [...options.allSessions!] : folderSessions;
		const initialSources = new Map<string, readonly SessionInfo[]>([["folder", folderSessions]]);
		if (options.allSessions !== undefined) initialSources.set("all", [...options.allSessions]);
		this.#headerText = new Text("", 1, 0);
		this.#messageText = new Text("", 1, 0);
		let surface!: SelectorSurface<string, SessionInfo, Keybinding>;
		this.#sessionRows = new SessionRowsComponent(width => surface.render(width));
		surface = new SelectorSurface<string, SessionInfo, Keybinding>({
			componentId: makeComponentId("session-selector"),
			keymapContexts: ["session.selector"],
			items: initial,
			keyOf: sessionPath,
			searchText: sessionSearchText,
			initialSourceTag,
			initialSources,
			renderRow: (session, context, width) => {
				const cursorSymbol = `${theme.nav.cursor} `;
				const cursor = context.selected ? theme.fg("accent", cursorSymbol) : " ".repeat(visibleWidth(cursorSymbol));
				const badge = formatSessionWorkstream(session.workstream);
				const first = session.title ? `${badge ? `${badge} ` : ""}${session.title}` : `${badge ? `${badge} ` : ""}${session.firstMessage.replace(/\n/g, " ").trim()}`;
				const lines = [truncateToWidth(cursor + (context.selected ? theme.bold(first) : first), width)];
				if (session.title) lines.push(truncateToWidth(`  ${theme.fg("dim", session.firstMessage.replace(/\n/g, " ").trim())}`, width));
				const dot = theme.fg("dim", theme.sep.dot);
				let metadata = `  ${theme.fg("dim", formatDate(session.modified))} ${dot} ${theme.fg("dim", formatBytes(session.size))}`;
				const status = formatSessionStatus(session.status);
				if (status) metadata += ` ${dot} ${status}`;
				if (session.owner) {
					const mux = session.owner.muxHint ? ` · mux ${session.owner.muxHint}` : "";
					metadata += ` ${dot} ${theme.fg("dim", `active pid ${session.owner.pid} · ${session.owner.cwd}${mux} · started ${session.owner.startedAt}`)}`;
				}
				if (context.sourceTag === "all" && session.cwd) metadata += ` ${dot} ${theme.fg("dim", shortenPath(session.cwd))}`;
				lines.push(truncateToWidth(metadata, width));
				lines.push("");
				return lines;
			},
			renderEmpty: (_query, _width, sourceTag) => [
				theme.fg("muted", sourceTag === "all" ? "  No sessions found" : "  No sessions in current folder. Press Tab to view all."),
			],
			renderConfirm: (session, width) => [
				truncateToWidth(theme.bold(`Delete session? ${session.title || session.firstMessage.slice(0, 40) || session.id}`), width),
				theme.fg("muted", "  Enter confirm · Esc back"),
			],
			onSelect,
			onCancel,
			onExit,
			onToggleSource: async snapshot => {
				const target = snapshot.sourceTag === "all" ? "folder" : "all";
				const cached = snapshot.sources.get(target);
				if (cached !== undefined) return { items: cached, sourceTag: target };
				if (target === "all" && options.loadAllSessions !== undefined) {
					return { items: await options.loadAllSessions(), sourceTag: "all" };
				}
				return { items: snapshot.items, sourceTag: snapshot.sourceTag };
			},
			onFilterChanged: (query, snapshot) => {
				const source = snapshot.sourceTag === undefined
					? snapshot.items
					: snapshot.sources.get(snapshot.sourceTag) ?? snapshot.items;
				const fuzzy = rankSessionSearchMatches([...source], query);
				return query.trim().length > 0 && options.historyMatcher
					? mergeSessionRanking([...source], fuzzy, options.historyMatcher(query.trim()))
					: fuzzy;
			},
			onAction: async (_action, session) => {
				if (options.onDelete === undefined || !(await options.onDelete(session))) return;
				return { removeKey: session.path };
			},
			encodeItems: encodeSessions,
			decodeItems: decodeSessions,
			onProjection: model => {
				const all = model.sourceTag === "all";
				this.#headerText.setText(`${theme.bold("Resume Session")} ${theme.fg("muted", `(${all ? "all projects" : "current folder"})`)}`);
				this.#messageText.setText(model.sourcePending === "toggle" ? theme.fg("muted", "  Loading sessions…") : "");
				this.#sessionRows.apply(
					model.items,
					model.selector.filteredIds,
					model.selector.viewportOffset,
					model.selector.mode._tag !== "Confirm",
				);
				this.#onRequestRender?.();
			},
			viewportSize: Math.max(2, Math.floor(((options.getTerminalRows?.() ?? 24) - 13) / 4)),
		});
		this.#surface = surface;
		this.#sessionRows.apply(initial, initial.map(sessionPath), 0, true);
		this.#headerText.setText(`${theme.bold("Resume Session")} ${theme.fg("muted", `(${initialSourceTag === "all" ? "all projects" : "current folder"})`)}`);
		this.addChild(new Spacer(1));
		this.addChild(this.#headerText);
		this.addChild(new Spacer(1));
		this.addChild(new DynamicBorder());
		this.addChild(new Spacer(1));
		this.addChild(this.#messageText);
		this.addChild(this.#sessionRows);
		this.addChild(new Spacer(1));
		this.addChild(new Text(theme.fg("muted", `  [Del delete · Enter select · Tab switch scope · ${editorKey("ui.dismiss")} cancel]`), 1, 0));
		this.addChild(new DynamicBorder());
	}

	setOnRequestRender(callback: () => void): void {
		this.#onRequestRender = callback;
	}

	get mountSpec(): SelectorSurfaceMountSpec<string, SessionInfo> {
		return this.#surface.mountSpec;
	}
}
