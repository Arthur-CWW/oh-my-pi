/**
 * Protocol handler for history:// URLs.
 *
 * Exposes agent transcripts as concise markdown. Live refs render from the
 * in-memory message array; parked refs (session disposed, sessionFile
 * retained) load read-only from the JSONL session file — no writer, no lock.
 *
 * URL forms:
 * - history:// - Index of all registry agents (id, status, kind, last activity)
 * - history://<agentId> - Concise markdown transcript of that agent
 */
import * as fs from "node:fs/promises";
import * as path from "node:path";
import type { AgentRef } from "../registry/agent-registry";
import { AgentRegistry } from "../registry/agent-registry";
import { formatSessionHistoryMarkdown } from "../session/session-history-format";
import { loadSessionMessagesReadOnly } from "../session/session-loader";
import type { FileEntry } from "../session/session-entries";
import {
	isTerminalChildLifecycleState,
	latestChildLifecycleRecord,
	type ChildLifecycleRecord,
} from "../task/child-lifecycle";
import type { InternalResource, InternalUrl, ProtocolHandler, UrlCompletion } from "./types";

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
			if (typeof entry !== "object" || entry === null || !("type" in entry) || typeof entry.type !== "string") return undefined;
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
		(metadata.thinkingLevel !== undefined && metadata.thinkingLevel !== null && typeof metadata.thinkingLevel !== "string") ||
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
		.sort((left, right) => right.updatedAt.localeCompare(left.updatedAt) || left.agentId.localeCompare(right.agentId));
}

/** List non-active child journals without registering or reviving them. */
export async function listArchivedChildHistories(refs: readonly AgentRef[]): Promise<ArchivedHistoryRef[]> {
	const main = refs.find(ref => ref.kind === "main" && ref.sessionFile);
	if (!main?.sessionFile || !main.sessionFile.endsWith(".jsonl")) return [];
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
		if (!entries.every(entry => typeof entry === "object" && entry !== null && typeof entry.type === "string")) continue;
		const lifecycle = latestChildLifecycleRecord(entries);
		const id = lifecycle?.agentId ?? path.basename(name, ".jsonl");
		const registered = refs.some(ref => ref.id === id && ref.sessionFile === sessionFile);
		if (registered) continue;
		const reason = lifecycle === undefined ? "legacy" : lifecycle === null ? "invalid lifecycle" : isTerminalChildLifecycleState(lifecycle.state) ? lifecycle.state : "not revivable";
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

/**
 * Handler for history:// URLs.
 *
 * Resolves agent ids against the global AgentRegistry, serving transcripts
 * for both live and parked agents.
 */
export class HistoryProtocolHandler implements ProtocolHandler {
	readonly scheme = "history";
	readonly immutable = false;

	async resolve(url: InternalUrl): Promise<InternalResource> {
		const agentId = url.rawHost || url.hostname;
		const registry = AgentRegistry.global();
		const refs = registry.list();
		const archives = await listArchivedChildHistories(refs);

		if (!agentId) {
			const content = this.#renderIndex(refs, archives);
			return { url: url.href, content, contentType: "text/markdown", size: Buffer.byteLength(content, "utf-8") };
		}

		let ref = registry.get(agentId);
		if (!ref) {
			const lower = agentId.toLowerCase();
			ref = refs.find(candidate => candidate.id.toLowerCase() === lower);
		}
		const archive = ref ? undefined : archives.find(candidate => candidate.id.toLowerCase() === agentId.toLowerCase());
		if (!ref && !archive) {
			const known = [...refs.map(candidate => candidate.id), ...archives.map(candidate => candidate.id)];
			const knownStr = known.length > 0 ? known.join(", ") : "none";
			throw new Error(`Unknown agent: ${agentId}\nKnown agents: ${knownStr}\nList all with history://`);
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
			throw new Error(`Agent ${ref?.id ?? agentId} has no transcript: session is gone and no session file was retained`);
		}

		const id = archive?.id ?? ref!.id;
		const status = archive ? "archived" : ref!.status;
		const content = formatSessionHistoryMarkdown(messages, { title: `${id} (${status})` });
		return {
			url: url.href,
			content,
			contentType: "text/markdown",
			size: Buffer.byteLength(content, "utf-8"),
			sourcePath: archive?.sessionFile ?? ref!.sessionFile ?? undefined,
			notes,
		};
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
