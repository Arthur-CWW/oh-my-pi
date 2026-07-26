/**
 * Protocol handler for history:// URLs.
 *
 * Exposes agent transcripts as concise markdown. Live refs render from the
 * in-memory message array; parked refs (session disposed, sessionFile
 * retained) load read-only from the JSONL session file — no writer, no lock.
 *
 * URL forms:
 * - history:// - Index of all registry agents (id, status, kind, last activity)
 * - history://<agent-id> - Local live, parked, or archived agent transcript
 * - history://<session-id> - Fleet session's Main transcript
 * - history://<session-id>/<agent-id> - Fleet session child transcript
 */
import * as fs from "node:fs/promises";
import * as path from "node:path";
import { IrcExternalBus, type IrcExternalPeer } from "../irc/bus-external";
import type { AgentRef } from "../registry/agent-registry";
import { AgentRegistry } from "../registry/agent-registry";
import type { FileEntry } from "../session/session-entries";
import { formatSessionHistoryMarkdown } from "../session/session-history-format";
import { loadSessionMessagesReadOnly } from "../session/session-loader";
import {
	type ChildLifecycleRecord,
	isTerminalChildLifecycleState,
	latestChildLifecycleRecord,
} from "../task/child-lifecycle";
import { formatIdPreview } from "./id-preview";
import type { InternalResource, InternalUrl, ProtocolHandler, ResolveContext, UrlCompletion } from "./types";

/** Humanize a last-activity timestamp as `Ns/Nm/Nh/Nd ago`. */
function formatAgo(timestamp: number): string {
	const diffMs = Math.max(0, Date.now() - timestamp);
	const secs = Math.floor(diffMs / 1000);
	if (secs < 60) return `${secs}s ago`;
	const mins = Math.floor(secs / 60);
	if (mins < 60) return `${mins}m ago`;
	const hours = Math.floor(mins / 60);
	if (hours < 24) return `${hours}h ago`;
	return `${Math.floor(hours / 24)}d ago`;
}

export interface ArchivedHistoryRef {
	id: string;
	sessionFile: string;
	reason: string;
}

export type ArchivedDirectChildState = "completed" | "failed" | "interrupted" | "legacy";

export interface ArchivedDirectChildDescriptor {
	agentId: string;
	childSessionFile: string;
	state: ArchivedDirectChildState;
	updatedAt: string;
	modelId?: string;
	thinkingLevel?: string | null;
}

interface DirectChildCandidate {
	descriptor?: ArchivedDirectChildDescriptor;
	agentId: string;
}

function samePath(left: string, right: string): boolean {
	return path.resolve(left) === path.resolve(right);
}

function parseChildJournal(text: string): FileEntry[] | undefined {
	const entries: FileEntry[] = [];
	for (const line of text.split("\n")) {
		if (!line.trim()) continue;
		try {
			const entry: unknown = JSON.parse(line);
			if (typeof entry !== "object" || entry === null || !("type" in entry) || typeof entry.type !== "string")
				return undefined;
			entries.push(entry as FileEntry);
		} catch {
			return undefined;
		}
	}
	return entries.length > 0 ? entries : undefined;
}

function directChildCandidate(
	entries: readonly FileEntry[],
	childSessionFile: string,
	parentSessionFile: string,
): DirectChildCandidate | undefined {
	const init = [...entries].reverse().find(entry => entry.type === "session_init");
	const metadata = init?.subagent;
	if (
		!metadata ||
		typeof metadata.agentId !== "string" ||
		typeof metadata.parentSessionFile !== "string" ||
		metadata.isolated !== false ||
		(metadata.model !== undefined && typeof metadata.model !== "string") ||
		(metadata.thinkingLevel !== undefined &&
			metadata.thinkingLevel !== null &&
			typeof metadata.thinkingLevel !== "string") ||
		!samePath(metadata.parentSessionFile, parentSessionFile) ||
		typeof init?.timestamp !== "string"
	)
		return undefined;
	const lifecycle = latestChildLifecycleRecord(entries);
	if (lifecycle === null) return undefined;
	if (lifecycle === undefined) {
		const descriptor: ArchivedDirectChildDescriptor = {
			agentId: metadata.agentId,
			childSessionFile,
			state: "legacy",
			updatedAt: init.timestamp,
			...(typeof metadata.model === "string" ? { modelId: metadata.model } : {}),
			...(metadata.thinkingLevel === undefined ? {} : { thinkingLevel: metadata.thinkingLevel }),
		};
		return { agentId: metadata.agentId, descriptor: { ...descriptor, ...latestEffectiveRoute(entries, descriptor) } };
	}
	if (
		lifecycle.agentId !== metadata.agentId ||
		!samePath(lifecycle.childSessionFile, childSessionFile) ||
		!samePath(lifecycle.parentSessionFile, parentSessionFile)
	)
		return undefined;
	if (!isTerminalChildLifecycleState(lifecycle.state)) return { agentId: metadata.agentId };
	const descriptor = descriptorFromTerminalLifecycle(lifecycle);
	return {
		agentId: metadata.agentId,
		descriptor: { ...descriptor, ...latestEffectiveRoute(entries, descriptor) },
	};
}

/** Derive the last persisted model route without treating the journal as a live session. */
function latestEffectiveRoute(
	entries: readonly FileEntry[],
	fallback: Pick<ArchivedDirectChildDescriptor, "modelId" | "thinkingLevel">,
): Pick<ArchivedDirectChildDescriptor, "modelId" | "thinkingLevel"> {
	let modelId = fallback.modelId;
	let thinkingLevel = fallback.thinkingLevel;
	for (const entry of entries) {
		if (entry.type === "model_change" && typeof entry.model === "string" && entry.model.length > 0) {
			modelId = entry.model;
		} else if (
			entry.type === "thinking_level_change" &&
			(entry.thinkingLevel === undefined || entry.thinkingLevel === null || typeof entry.thinkingLevel === "string")
		) {
			thinkingLevel = entry.thinkingLevel;
		}
	}
	return {
		...(modelId === undefined ? {} : { modelId }),
		...(thinkingLevel === undefined ? {} : { thinkingLevel }),
	};
}

function descriptorFromTerminalLifecycle(lifecycle: ChildLifecycleRecord): ArchivedDirectChildDescriptor {
	return {
		agentId: lifecycle.agentId,
		childSessionFile: lifecycle.childSessionFile,
		state: lifecycle.state as ArchivedDirectChildState,
		updatedAt: lifecycle.updatedAt,
		...(lifecycle.modelId === undefined ? {} : { modelId: lifecycle.modelId }),
		...(lifecycle.thinkingLevel === undefined ? {} : { thinkingLevel: lifecycle.thinkingLevel }),
	};
}

/** List unique, direct terminal or legacy child journals without mutating the runtime registry. */
export async function listArchivedDirectChildren(parentSessionFile: string): Promise<ArchivedDirectChildDescriptor[]> {
	if (!parentSessionFile.endsWith(".jsonl")) return [];
	const childrenDir = parentSessionFile.slice(0, -".jsonl".length);
	let names: string[];
	try {
		names = await fs.readdir(childrenDir);
	} catch {
		return [];
	}
	const candidates: DirectChildCandidate[] = [];
	for (const name of names) {
		if (!name.endsWith(".jsonl") || name.includes(".bak")) continue;
		const childSessionFile = path.join(childrenDir, name);
		let entries: FileEntry[] | undefined;
		try {
			entries = parseChildJournal(await fs.readFile(childSessionFile, "utf8"));
		} catch {
			continue;
		}
		if (!entries) continue;
		const candidate = directChildCandidate(entries, childSessionFile, parentSessionFile);
		if (candidate) candidates.push(candidate);
	}
	const claims = new Map<string, number>();
	for (const candidate of candidates) claims.set(candidate.agentId, (claims.get(candidate.agentId) ?? 0) + 1);
	return candidates
		.filter(candidate => candidate.descriptor && claims.get(candidate.agentId) === 1)
		.map(candidate => candidate.descriptor!)
		.sort(
			(left, right) => right.updatedAt.localeCompare(left.updatedAt) || left.agentId.localeCompare(right.agentId),
		);
}

/** List non-active child journals without registering or reviving them. */
export async function listArchivedChildHistories(refs: readonly AgentRef[]): Promise<ArchivedHistoryRef[]> {
	const main = refs.find(ref => ref.kind === "main" && ref.sessionFile);
	if (!main?.sessionFile?.endsWith(".jsonl")) return [];
	let names: string[];
	try {
		names = await fs.readdir(main.sessionFile.slice(0, -".jsonl".length));
	} catch {
		return [];
	}
	const archived: ArchivedHistoryRef[] = [];
	for (const name of names) {
		if (!name.endsWith(".jsonl") || name.includes(".bak")) continue;
		const sessionFile = path.join(main.sessionFile.slice(0, -".jsonl".length), name);
		let entries: FileEntry[];
		try {
			entries = (await fs.readFile(sessionFile, "utf8"))
				.split("\n")
				.filter(line => line.trim())
				.map(line => JSON.parse(line) as FileEntry);
		} catch {
			continue;
		}
		if (!entries.every(entry => typeof entry === "object" && entry !== null && typeof entry.type === "string"))
			continue;
		const lifecycle = latestChildLifecycleRecord(entries);
		const id = lifecycle?.agentId ?? path.basename(name, ".jsonl");
		const registered = refs.some(ref => ref.id === id && ref.sessionFile === sessionFile);
		if (registered) continue;
		const reason =
			lifecycle === undefined
				? "legacy"
				: lifecycle === null
					? "invalid lifecycle"
					: isTerminalChildLifecycleState(lifecycle.state)
						? lifecycle.state
						: "not revivable";
		archived.push({ id, sessionFile, reason });
	}
	const counts = new Map<string, number>();
	for (const archive of archived) counts.set(archive.id, (counts.get(archive.id) ?? 0) + 1);
	return archived.map(archive =>
		(counts.get(archive.id) ?? 0) === 1 && !refs.some(ref => ref.id === archive.id)
			? archive
			: { ...archive, id: `${archive.id}--${path.basename(archive.sessionFile, ".jsonl")}` },
	);
}

function malformedHistoryPath(): Error {
	return new Error("Malformed history URL: expected history://<session-id>/<agent-id> with exactly one path segment");
}

function parseHistoryPath(url: InternalUrl): string[] {
	const rawPathname = url.rawPathname ?? url.pathname;
	if (!rawPathname) return [];
	if (!rawPathname.startsWith("/")) throw malformedHistoryPath();
	const rawSegments = rawPathname.slice(1).split("/");
	if (rawSegments.length !== 1 || rawSegments[0].length === 0) throw malformedHistoryPath();
	const rawSegment = rawSegments[0];
	if (/%2f|%5c|%2e/i.test(rawSegment)) throw malformedHistoryPath();
	let segment: string;
	try {
		segment = decodeURIComponent(rawSegment);
	} catch {
		throw malformedHistoryPath();
	}
	if (
		!segment ||
		segment === "." ||
		segment === ".." ||
		segment.includes("/") ||
		segment.includes("\\") ||
		/%2f|%5c|%2e/i.test(segment)
	)
		throw malformedHistoryPath();
	return [segment];
}

function findFleetPeer(peers: readonly IrcExternalPeer[], sessionId: string): IrcExternalPeer | undefined {
	return (
		peers.find(peer => peer.sessionId === sessionId) ??
		peers.find(peer => peer.sessionId.toLowerCase() === sessionId.toLowerCase())
	);
}

async function isJournalFile(file: string): Promise<boolean> {
	try {
		return (await fs.stat(file)).isFile();
	} catch {
		return false;
	}
}

function isWithinDirectory(directory: string, file: string): boolean {
	const root = path.resolve(directory);
	const target = path.resolve(file);
	return target === root || target.startsWith(`${root}${path.sep}`);
}

async function isWithinRealDirectory(directory: string, file: string): Promise<boolean> {
	try {
		const [realDirectory, realFile] = await Promise.all([fs.realpath(directory), fs.realpath(file)]);
		return isWithinDirectory(realDirectory, realFile);
	} catch {
		return false;
	}
}

function childJournalFile(parentSessionFile: string, childId: string): string {
	const childrenDir = parentSessionFile.endsWith(".jsonl") ? parentSessionFile.slice(0, -".jsonl".length) : "";
	const childFile = path.resolve(childrenDir, `${childId}.jsonl`);
	if (!childrenDir || !isWithinDirectory(childrenDir, childFile)) throw malformedHistoryPath();
	return childFile;
}

/** Supported `history://<target>?op=...` retrieval operations. */
const HISTORY_QUERY_OPS = ["search", "record"] as const;

/** Default and ceiling for the number of search matches returned. */
const DEFAULT_SEARCH_LIMIT = 20;
const MAX_SEARCH_LIMIT = 100;
/** Snippet context (characters) rendered on each side of a search hit. */
const DEFAULT_SNIPPET_CONTEXT = 80;
const MAX_SNIPPET_CONTEXT = 400;
/** Ceiling on records returned by a single `op=record` request. */
const MAX_RECORD_IDS = 10;

interface HistoryRenderQuery {
	kind: "render";
}
interface HistorySearchQuery {
	kind: "search";
	/** Raw needle; matched case-insensitively against decoded record text. */
	q: string;
	/** Maximum matches to include in the projection. */
	limit: number;
	/** Characters of context rendered on each side of the hit. */
	context: number;
}
interface HistoryRecordQuery {
	kind: "record";
	/** Distinct, ascending record indices to read. */
	ids: number[];
}
/** Parsed `history://` query string; `render` is the legacy full-transcript path. */
type HistoryQuery = HistoryRenderQuery | HistorySearchQuery | HistoryRecordQuery;

/** A single decoded transcript record projected for search/record retrieval. */
interface HistoryRecord {
	/** Stable 0-based position in the decoded message array. */
	index: number;
	/** Message role (e.g. `user`, `assistant`, `toolResult`, `bashExecution`). */
	speaker: string;
	/** Role, plus `:customType` for custom/hook families. */
	type: string;
	/** Decoded human-readable text used for matching and record display. */
	text: string;
}

function parseBoundedInt(raw: string | null, fallback: number, min: number, max: number): number {
	if (raw === null || raw.trim() === "") return fallback;
	const value = Number(raw);
	if (!Number.isInteger(value)) throw new Error(`history:// expected an integer, got '${raw}'`);
	if (value < min || value > max) throw new Error(`history:// value ${value} is out of range ${min}-${max}`);
	return value;
}

function parseNonNegativeInt(raw: string): number | undefined {
	if (raw.trim() === "") return undefined;
	const value = Number(raw);
	return Number.isInteger(value) && value >= 0 ? value : undefined;
}

function parseRecordIds(params: URLSearchParams): number[] {
	const ids = new Set<number>();
	const idParam = params.get("id");
	if (idParam !== null && idParam.trim() !== "") {
		for (const raw of idParam.split(",")) {
			const value = parseNonNegativeInt(raw);
			if (value === undefined)
				throw new Error(`history:// record 'id' must be non-negative integers: got '${raw.trim()}'`);
			ids.add(value);
		}
	}
	const fromParam = params.get("from");
	const toParam = params.get("to");
	if (fromParam !== null || toParam !== null) {
		const from = parseNonNegativeInt(fromParam ?? "");
		const to = parseNonNegativeInt(toParam ?? "");
		if (from === undefined || to === undefined)
			throw new Error("history:// record 'from'/'to' must be non-negative integers");
		if (to < from) throw new Error(`history:// record range 'to' (${to}) must be >= 'from' (${from})`);
		for (let i = from; i <= to; i++) ids.add(i);
	}
	if (ids.size === 0) {
		throw new Error(
			"history:// record requires 'id=<n>[,<n>...]' or 'from=<n>&to=<n>': history://<target>?op=record&id=12",
		);
	}
	if (ids.size > MAX_RECORD_IDS) {
		throw new Error(`history:// record is bounded to ${MAX_RECORD_IDS} records per request; requested ${ids.size}`);
	}
	return [...ids].sort((a, b) => a - b);
}

/** Parse the optional `?op=...` query into a typed retrieval request. */
function parseHistoryQuery(url: InternalUrl): HistoryQuery {
	const rawOp = url.searchParams.get("op");
	if (rawOp === null || rawOp === "") return { kind: "render" };
	const op = rawOp.toLowerCase();
	if (op === "search") {
		const q = url.searchParams.get("q");
		if (q === null || q === "") {
			throw new Error("history:// search requires a non-empty 'q' parameter: history://<target>?op=search&q=...");
		}
		return {
			kind: "search",
			q,
			limit: parseBoundedInt(url.searchParams.get("limit"), DEFAULT_SEARCH_LIMIT, 1, MAX_SEARCH_LIMIT),
			context: parseBoundedInt(url.searchParams.get("context"), DEFAULT_SNIPPET_CONTEXT, 0, MAX_SNIPPET_CONTEXT),
		};
	}
	if (op === "record") {
		return { kind: "record", ids: parseRecordIds(url.searchParams) };
	}
	throw new Error(
		`Unsupported history:// op: ${rawOp}\nSupported ops: ${HISTORY_QUERY_OPS.join(", ")} (e.g. history://<target>?op=search&q=...)`,
	);
}

/** Speaker/type metadata for a decoded message without rendering its body. */
function recordDescriptor(message: unknown): { speaker: string; type: string } {
	const shape = message as { role?: unknown; customType?: unknown };
	const speaker = typeof shape.role === "string" ? shape.role : "unknown";
	const customType = typeof shape.customType === "string" ? shape.customType : undefined;
	return { speaker, type: customType ? `${speaker}:${customType}` : speaker };
}

/**
 * Decoded, human-readable text for one message. Reuses the transcript
 * serializer so search matches exactly what `history://` renders: tool bodies
 * collapse to one-liners and thinking is elided, keeping the search surface
 * the human/message projection rather than raw JSONL bytes. The serializer
 * prepends a `## <role>` heading for user/assistant/developer turns; it is
 * stripped so snippets carry only the message body.
 */
function recordText(message: unknown): string {
	const block = formatSessionHistoryMarkdown([message]).trim();
	const headed = block.match(/^#{2,6} \S+\n\n([\s\S]*)$/);
	return headed ? headed[1] : block;
}

/** Collapse whitespace and window `text` around a hit, marking elisions. */
function buildSnippet(text: string, matchStart: number, matchLength: number, context: number): string {
	const from = Math.max(0, matchStart - context);
	const to = Math.min(text.length, matchStart + matchLength + context);
	const core = text.slice(from, to).replace(/\s+/g, " ").trim();
	return `${from > 0 ? "…" : ""}${core}${to < text.length ? "…" : ""}`;
}

/** Render bounded search matches over the decoded transcript projection. */
function renderSearchResults(query: HistorySearchQuery, messages: unknown[], title: string): string {
	const needle = query.q.toLowerCase();
	const matches: Array<{ index: number; speaker: string; type: string; snippet: string }> = [];
	let total = 0;
	for (let index = 0; index < messages.length; index++) {
		const text = recordText(messages[index]);
		if (!text) continue;
		const hit = text.toLowerCase().indexOf(needle);
		if (hit === -1) continue;
		total++;
		if (matches.length < query.limit) {
			const { speaker, type } = recordDescriptor(messages[index]);
			matches.push({ index, speaker, type, snippet: buildSnippet(text, hit, query.q.length, query.context) });
		}
	}
	const lines = [`# Search "${query.q}" · ${title}`, ""];
	if (total === 0) {
		lines.push(`No matches for "${query.q}" across ${messages.length} records.`);
		return `${lines.join("\n")}\n`;
	}
	lines.push(
		total > matches.length
			? `${total} matches across ${messages.length} records (showing first ${matches.length}).`
			: `${total} ${total === 1 ? "match" : "matches"} across ${messages.length} records.`,
		"Read a full record with `read history://<target>?op=record&id=<n>`.",
		"",
	);
	for (const match of matches) {
		lines.push(`## #${match.index} · ${match.speaker} (${match.type})`, "", match.snippet, "");
	}
	return `${lines.join("\n").trim()}\n`;
}

/** Render the exact decoded text for a bounded set of record indices. */
function renderRecordSlice(query: HistoryRecordQuery, messages: unknown[], title: string): string {
	const lines = [`# Records · ${title}`, ""];
	const missing: number[] = [];
	const found: HistoryRecord[] = [];
	for (const id of query.ids) {
		if (id >= messages.length) {
			missing.push(id);
			continue;
		}
		const { speaker, type } = recordDescriptor(messages[id]);
		found.push({ index: id, speaker, type, text: recordText(messages[id]) });
	}
	if (missing.length > 0) {
		const range = messages.length > 0 ? `0-${messages.length - 1}` : "none";
		lines.push(
			`No record at index ${missing.join(", ")} (transcript has ${messages.length} records, valid ids ${range}).`,
			"",
		);
	}
	for (const record of found) {
		lines.push(
			`## #${record.index} · ${record.speaker} (${record.type})`,
			"",
			record.text || "_(no readable text)_",
			"",
		);
	}
	return `${lines.join("\n").trim()}\n`;
}

/** Dispatch a resolved message array to the requested projection. */
function renderHistoryContent(
	query: HistoryQuery,
	messages: unknown[],
	title: string,
): { content: string; contentType: InternalResource["contentType"] } {
	switch (query.kind) {
		case "search":
			return { content: renderSearchResults(query, messages, title), contentType: "text/markdown" };
		case "record":
			return { content: renderRecordSlice(query, messages, title), contentType: "text/markdown" };
		default:
			return { content: formatSessionHistoryMarkdown(messages, { title }), contentType: "text/markdown" };
	}
}

/**
 * Handler for history:// URLs.
 *
 * Resolves agent ids against the global AgentRegistry, serving transcripts
 * for both live and parked agents.
 */
export class HistoryProtocolHandler implements ProtocolHandler {
	readonly scheme = "history";
	readonly immutable = true;

	async resolve(url: InternalUrl, context?: ResolveContext): Promise<InternalResource> {
		const agentId = url.rawHost || url.hostname;
		const pathSegments = parseHistoryPath(url);
		if (!agentId && pathSegments.length > 0) throw malformedHistoryPath();
		const query = parseHistoryQuery(url);
		if (query.kind !== "render" && !agentId) {
			throw new Error("history:// query ops require a target: history://<target>?op=search&q=...");
		}
		const registry = AgentRegistry.global();
		const refs = registry.list();
		const archives = await listArchivedChildHistories(refs);

		if (!agentId) {
			const content = this.#renderIndex(refs, archives);
			return { url: url.href, content, contentType: "text/markdown", size: Buffer.byteLength(content, "utf-8") };
		}

		if (pathSegments.length > 0) {
			const remote = await this.#resolveFleet(url.href, agentId, pathSegments[0], context?.ircDbPath, false, query);
			if (!remote) throw new Error(`Unknown session: ${agentId} (missing or stale from fleet sessions index)`);
			return remote;
		}

		// Preserve the short local form's precedence: a local registry agent wins
		// over a fleet session with the same id.
		let ref = registry.get(agentId);
		if (!ref) {
			const lower = agentId.toLowerCase();
			ref = refs.find(candidate => candidate.id.toLowerCase() === lower);
		}
		const archive = ref
			? undefined
			: archives.find(candidate => candidate.id.toLowerCase() === agentId.toLowerCase());
		if (!ref && !archive) {
			const remote = await this.#resolveFleet(url.href, agentId, undefined, context?.ircDbPath, true, query);
			if (remote) return remote;
			const known = [...refs.map(candidate => candidate.id), ...archives.map(candidate => candidate.id)];
			throw new Error(
				`Unknown agent: ${agentId}\nKnown agents: ${formatIdPreview(known)}\nList all with history://`,
			);
		}

		// A reserved-but-not-yet-live child (nonblocking spawn whose gated body has
		// not built a session) resolves as `starting` rather than unknown: the
		// identity is genuinely known and queued, it just has no transcript to
		// search or render yet. Unknown ids still fall through to the throw above.
		if (ref && !archive && ref.starting === true && !ref.session) {
			const content =
				`# ${ref.id} (starting)\n\n` +
				`Agent \`${ref.id}\` is queued and starting up; no transcript has been recorded yet. ` +
				`Re-read history://${ref.id} once it begins running.\n`;
			return {
				url: url.href,
				content,
				contentType: "text/markdown",
				size: Buffer.byteLength(content, "utf-8"),
				notes: ["Source: reserved lifecycle identity (starting)"],
			};
		}

		const notes: string[] = [];
		let messages: unknown[];
		if (archive) {
			messages = await loadSessionMessagesReadOnly(archive.sessionFile);
			notes.push(`Source: archived session file (read-only, ${archive.reason})`);
		} else if (ref?.session) {
			messages = ref.session.messages;
			notes.push("Source: live session");
		} else if (ref?.sessionFile) {
			messages = await loadSessionMessagesReadOnly(ref.sessionFile);
			notes.push(`Source: session file (read-only, ${ref.status})`);
		} else {
			throw new Error(
				`Agent ${ref?.id ?? agentId} has no transcript: session is gone and no session file was retained`,
			);
		}

		const id = archive?.id ?? ref!.id;
		const status = archive ? "archived" : ref!.status;
		const { content, contentType } = renderHistoryContent(query, messages, `${id} (${status})`);
		return {
			url: url.href,
			content,
			contentType,
			size: Buffer.byteLength(content, "utf-8"),
			sourcePath: archive?.sessionFile ?? ref!.sessionFile ?? undefined,
			notes,
		};
	}

	async #resolveFleet(
		url: string,
		sessionId: string,
		agentId: string | undefined,
		dbPath: string | undefined,
		allowMissing: boolean,
		query: HistoryQuery,
	): Promise<InternalResource | undefined> {
		let bus: IrcExternalBus;
		try {
			bus = new IrcExternalBus(dbPath, { readonly: true });
		} catch {
			if (allowMissing) return undefined;
			throw new Error(`Unable to read fleet sessions index for session ${sessionId}`);
		}
		try {
			const peer = findFleetPeer(bus.listPeers(), sessionId);
			if (!peer) {
				if (allowMissing) return undefined;
				throw new Error(`Unknown session: ${sessionId} (missing or stale from fleet sessions index)`);
			}
			const sessionFile = peer.sessionFile?.trim();
			if (!sessionFile) throw new Error(`Session ${sessionId} has no session_file in fleet sessions index`);
			if (!(await isJournalFile(sessionFile)))
				throw new Error(`Session ${sessionId} journal does not exist: ${sessionFile}`);

			const isMain = agentId === undefined || agentId.toLowerCase() === "main";
			let targetFile = sessionFile;
			if (!isMain) {
				targetFile = childJournalFile(sessionFile, agentId);
				const childDirectory = sessionFile.slice(0, -".jsonl".length);
				if (!isWithinDirectory(childDirectory, targetFile))
					throw new Error(`Session ${sessionId} child journal escapes the parent journal directory`);
				if (!(await isJournalFile(targetFile)))
					throw new Error(`Session ${sessionId} child journal does not exist: ${targetFile}`);
				if (!(await isWithinRealDirectory(childDirectory, targetFile)))
					throw new Error(`Session ${sessionId} child journal escapes the parent journal directory`);
			}

			const messages = await loadSessionMessagesReadOnly(targetFile);
			const displayId = isMain ? peer.sessionId : agentId;
			const { content, contentType } = renderHistoryContent(query, messages, `${displayId} (remote)`);
			return {
				url,
				content,
				contentType,
				size: Buffer.byteLength(content, "utf-8"),
				sourcePath: targetFile,
				notes: [`Source: remote session file (read-only, ${peer.state})`],
			};
		} finally {
			bus.close();
		}
	}

	#renderIndex(refs: AgentRef[], archives: readonly ArchivedHistoryRef[]): string {
		const lines: string[] = ["# Agents", "", "## Active and revivable", ""];
		if (refs.length === 0) lines.push("No active or revivable agents.");
		else {
			lines.push("| id | status | kind | parent | last activity |", "|---|---|---|---|---|");
			for (const ref of refs) {
				lines.push(
					`| ${ref.id} | ${ref.status} | ${ref.kind} | ${ref.parentId ?? "—"} | ${formatAgo(ref.lastActivity)} |`,
				);
			}
		}
		lines.push("", "## Archived", "");
		if (archives.length === 0) lines.push("No archived child journals.");
		else {
			lines.push("| id | reason |", "|---|---|");
			for (const archive of archives) lines.push(`| ${archive.id} | ${archive.reason} |`);
		}
		lines.push("", "Read a transcript with `read history://<id>`.");
		return `${lines.join("\n")}\n`;
	}

	async complete(): Promise<UrlCompletion[]> {
		const refs = AgentRegistry.global().list();
		const archives = await listArchivedChildHistories(refs);
		return [
			...refs.map(ref => ({
				value: ref.id,
				description: `${ref.status} · ${ref.kind}${ref.parentId ? ` · parent ${ref.parentId}` : ""}`,
			})),
			...archives.map(archive => ({ value: archive.id, description: `archived · ${archive.reason}` })),
		];
	}
}
