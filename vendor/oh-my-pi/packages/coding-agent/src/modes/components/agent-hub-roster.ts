import * as fs from "node:fs/promises";
import * as path from "node:path";
import type { AssistantMessage } from "@oh-my-pi/pi-ai";
import { getSessionsDir } from "@oh-my-pi/pi-utils";
import type { AgentRef } from "../../registry/agent-registry";

export interface DurableJournalModel {
	modelId?: string;
	thinkingLevel?: string | null;
}

export function durableModelSelector(model: DurableJournalModel | undefined): string | undefined {
	return model?.modelId ? `${model.modelId}${model.thinkingLevel ? `:${model.thinkingLevel}` : ""}` : undefined;
}

export interface JournalMetadataIo {
	mtimeMs(sessionFile: string): Promise<number>;
	readText(sessionFile: string): Promise<string>;
}

const journalMetadataIo: JournalMetadataIo = {
	mtimeMs: async sessionFile => (await fs.stat(sessionFile)).mtimeMs,
	readText: sessionFile => fs.readFile(sessionFile, "utf8"),
};

function durableJournalModel(text: string): DurableJournalModel | undefined {
	let modelId: string | undefined;
	let thinkingLevel: string | null | undefined;
	for (const line of text.split("\n")) {
		if (!line.trim()) continue;
		let entry: Record<string, unknown>;
		try {
			entry = JSON.parse(line) as Record<string, unknown>;
		} catch {
			continue;
		}
		if (entry.type === "session_init" && typeof entry.subagent === "object" && entry.subagent !== null) {
			const metadata = entry.subagent as Record<string, unknown>;
			if (typeof metadata.model === "string" && metadata.model) modelId = metadata.model;
			if (metadata.thinkingLevel === null || typeof metadata.thinkingLevel === "string")
				thinkingLevel = metadata.thinkingLevel;
		} else if (entry.type === "model_change" && typeof entry.model === "string" && entry.model) {
			modelId = entry.model;
		} else if (
			entry.type === "thinking_level_change" &&
			(entry.thinkingLevel === null || typeof entry.thinkingLevel === "string")
		) {
			thinkingLevel = entry.thinkingLevel;
		}
	}
	return modelId === undefined && thinkingLevel === undefined ? undefined : { modelId, thinkingLevel };
}

/** Durable model metadata, cached by journal path and mtime so renders remain filesystem-free. */
export class DurableJournalModelCache {
	readonly #cache = new Map<string, { mtimeMs: number; model: DurableJournalModel | undefined }>();
	readonly #io: JournalMetadataIo;

	constructor(io: JournalMetadataIo = journalMetadataIo) {
		this.#io = io;
	}

	peek(sessionFile: string | null | undefined): DurableJournalModel | undefined {
		return sessionFile ? this.#cache.get(sessionFile)?.model : undefined;
	}

	async load(sessionFile: string): Promise<DurableJournalModel | undefined> {
		let mtimeMs: number;
		try {
			mtimeMs = await this.#io.mtimeMs(sessionFile);
		} catch {
			return undefined;
		}
		const cached = this.#cache.get(sessionFile);
		if (cached?.mtimeMs === mtimeMs) return cached.model;
		let model: DurableJournalModel | undefined;
		try {
			model = durableJournalModel(await this.#io.readText(sessionFile));
		} catch {
			return undefined;
		}
		this.#cache.set(sessionFile, { mtimeMs, model });
		return model;
	}
}

export interface AutomationJournalRow {
	agentId: string;
	childSessionFile: string;
	state: "legacy";
	updatedAt: string;
}

/** Discover journals written by task/automations.ts without scanning ordinary project session directories. */
export async function listAutomationJournalRows(
	sessionsDir?: string,
	parentSessionFile?: string,
): Promise<AutomationJournalRow[]> {
	const root = sessionsDir ?? getSessionsDir();
	const relativeParent = parentSessionFile ? path.relative(root, parentSessionFile) : undefined;
	if (!sessionsDir && (!relativeParent || relativeParent.startsWith("..") || path.isAbsolute(relativeParent)))
		return [];
	let directories: Array<{ name: string; isDirectory(): boolean }>;
	try {
		directories = await fs.readdir(root, { withFileTypes: true });
	} catch {
		return [];
	}
	const rows: AutomationJournalRow[] = [];
	for (const directory of directories) {
		if (!directory.isDirectory() || !directory.name.startsWith("automation-")) continue;
		const slug = directory.name.slice("automation-".length);
		if (!slug) continue;
		const sessionFile = path.join(root, directory.name, `${slug}.jsonl`);
		try {
			const [text, stat] = await Promise.all([
				Bun.file(sessionFile)
					.slice(0, 64 * 1024)
					.text(),
				fs.stat(sessionFile),
			]);
			let name: string | undefined;
			let automation = false;
			for (const line of text.split("\n")) {
				if (!line.trim()) continue;
				let entry: Record<string, unknown>;
				try {
					entry = JSON.parse(line) as Record<string, unknown>;
				} catch {
					continue;
				}
				if (entry.type === "session" && typeof entry.title === "string" && entry.title.startsWith("automation: "))
					name = entry.title.slice("automation: ".length);
				if (entry.type === "custom" && entry.customType === "automation") {
					automation = true;
					const data = entry.data as Record<string, unknown> | undefined;
					if (typeof data?.name === "string") name = data.name;
				}
			}
			if (automation) {
				rows.push({
					agentId: `automation: ${name ?? slug}`,
					childSessionFile: sessionFile,
					state: "legacy",
					updatedAt: stat.mtime.toISOString(),
				});
			}
		} catch {}
	}
	return rows.sort(
		(left, right) => right.updatedAt.localeCompare(left.updatedAt) || left.agentId.localeCompare(right.agentId),
	);
}

/** A finished registry row that the Hub's history toggle may omit. */
export function isHistoricalAgent(ref: AgentRef, completed: boolean): boolean {
	return ref.status === "parked" || completed;
}

/** Group active work before completed and parked history while preserving spawn order within each group. */
export function agentHistoryRank(ref: AgentRef, completed: boolean): number {
	if (ref.status === "running") return 0;
	if (ref.status === "idle") return completed ? 2 : 1;
	if (ref.status === "parked") return 3;
	return 4;
}

export interface AgentRosterRollup {
	descendants: number;
	running: number;
}

export interface AgentRosterRow {
	ref: AgentRef;
	depth: number;
	guide: string;
	hasChildren: boolean;
	parentId?: string;
	collapsed?: AgentRosterRollup;
}

interface AgentRosterTopology {
	refs: AgentRef[];
	parentById: Map<string, string | undefined>;
	childrenByParent: Map<string | undefined, AgentRef[]>;
}

function buildTopology(refs: readonly AgentRef[]): AgentRosterTopology {
	const orderedRefs: AgentRef[] = [];
	const byId = new Map<string, AgentRef>();
	for (const ref of refs) {
		if (byId.has(ref.id)) continue;
		byId.set(ref.id, ref);
		orderedRefs.push(ref);
	}

	const cycleIds = new Set<string>();
	for (const ref of orderedRefs) {
		const seen = new Map<string, number>();
		let currentId: string | undefined = ref.id;
		while (currentId !== undefined) {
			if (cycleIds.has(currentId)) break;
			const previousIndex = seen.get(currentId);
			if (previousIndex !== undefined) {
				let mark = false;
				for (const seenId of seen.keys()) {
					if (seenId === currentId) mark = true;
					if (mark) cycleIds.add(seenId);
				}
				break;
			}
			seen.set(currentId, seen.size);
			const parentId: string | undefined = byId.get(currentId)?.parentId;
			currentId = parentId !== undefined && byId.has(parentId) ? parentId : undefined;
		}
	}

	const parentById = new Map<string, string | undefined>();
	const childrenByParent = new Map<string | undefined, AgentRef[]>();
	for (const ref of orderedRefs) {
		const parentId =
			ref.parentId !== undefined && byId.has(ref.parentId) && !cycleIds.has(ref.id) ? ref.parentId : undefined;
		parentById.set(ref.id, parentId);
		const children = childrenByParent.get(parentId);
		if (children) children.push(ref);
		else childrenByParent.set(parentId, [ref]);
	}
	return { refs: orderedRefs, parentById, childrenByParent };
}

function includedIds(
	topology: AgentRosterTopology,
	matchedIds: ReadonlySet<string> | undefined,
): Set<string> | undefined {
	if (matchedIds === undefined) return undefined;
	const included = new Set<string>();
	for (const id of matchedIds) {
		if (!topology.parentById.has(id)) continue;
		let currentId: string | undefined = id;
		while (currentId !== undefined && !included.has(currentId)) {
			included.add(currentId);
			currentId = topology.parentById.get(currentId);
		}
	}
	return included;
}

function subtreeRollups(
	_topology: AgentRosterTopology,
	visibleChildrenByParent: ReadonlyMap<string | undefined, readonly AgentRef[]>,
): Map<string, AgentRosterRollup> {
	const rollups = new Map<string, AgentRosterRollup>();
	const order: AgentRef[] = [];
	const pending = [...(visibleChildrenByParent.get(undefined) ?? [])];
	while (pending.length > 0) {
		const ref = pending.pop()!;
		order.push(ref);
		for (const child of visibleChildrenByParent.get(ref.id) ?? []) pending.push(child);
	}
	for (let index = order.length - 1; index >= 0; index--) {
		const ref = order[index]!;
		let descendants = 0;
		let running = 0;
		for (const child of visibleChildrenByParent.get(ref.id) ?? []) {
			const childRollup = rollups.get(child.id);
			descendants += 1 + (childRollup?.descendants ?? 0);
			running += (child.status === "running" ? 1 : 0) + (childRollup?.running ?? 0);
		}
		rollups.set(ref.id, { descendants, running });
	}
	return rollups;
}
/** Project an ordered registry snapshot into a visible, navigable roster tree. */
export function projectAgentRoster(
	refs: readonly AgentRef[],
	collapsedIds: ReadonlySet<string>,
	includedAgentIds?: ReadonlySet<string>,
	revealIncludedPaths = false,
): AgentRosterRow[] {
	const topology = buildTopology(refs);
	const included = includedIds(topology, includedAgentIds);
	const visibleChildrenByParent = new Map<string | undefined, AgentRef[]>();
	for (const ref of topology.refs) {
		if (included && !included.has(ref.id)) continue;
		const parentId = topology.parentById.get(ref.id);
		const children = visibleChildrenByParent.get(parentId);
		if (children) children.push(ref);
		else visibleChildrenByParent.set(parentId, [ref]);
	}
	const rollups = revealIncludedPaths ? undefined : subtreeRollups(topology, visibleChildrenByParent);
	const rows: AgentRosterRow[] = [];
	const visit = (ref: AgentRef, depth: number, continuations: readonly boolean[]): void => {
		const parentId = topology.parentById.get(ref.id);
		const siblings = visibleChildrenByParent.get(parentId) ?? [];
		const siblingIndex = siblings.indexOf(ref);
		let guide = "";
		for (let index = 0; index + 1 < continuations.length; index++) guide += continuations[index] ? "│ " : "  ";
		if (depth > 0) guide += siblingIndex + 1 < siblings.length ? "├ • " : "└ • ";
		const children = visibleChildrenByParent.get(ref.id) ?? [];
		const row: AgentRosterRow = {
			ref,
			depth,
			guide,
			hasChildren: children.length > 0,
		};
		if (parentId !== undefined) row.parentId = parentId;
		if (rollups && collapsedIds.has(ref.id)) {
			const collapsed = rollups.get(ref.id);
			if (collapsed && collapsed.descendants > 0) row.collapsed = collapsed;
		}
		rows.push(row);
		if (!revealIncludedPaths && collapsedIds.has(ref.id)) return;
		for (let index = 0; index < children.length; index++) {
			visit(children[index]!, depth + 1, [...continuations, index + 1 < children.length]);
		}
	};
	for (const root of visibleChildrenByParent.get(undefined) ?? []) visit(root, 0, []);
	return rows;
}

/** Return a normalized root-to-agent path, including the requested id. */
export function agentAncestorPath(refs: readonly AgentRef[], id: string): string[] {
	const topology = buildTopology(refs);
	if (!topology.parentById.has(id)) return [];
	const reversed: string[] = [];
	const seen = new Set<string>();
	let currentId: string | undefined = id;
	while (currentId !== undefined && !seen.has(currentId)) {
		seen.add(currentId);
		reversed.push(currentId);
		currentId = topology.parentById.get(currentId);
	}
	reversed.reverse();
	return reversed;
}

/** Return a copy of collapsed ids with every ancestor of id expanded. */
export function expandAgentAncestors(
	refs: readonly AgentRef[],
	collapsedIds: ReadonlySet<string>,
	id: string,
): Set<string> {
	const expanded = new Set(collapsedIds);
	const path = agentAncestorPath(refs, id);
	for (let index = 0; index + 1 < path.length; index++) expanded.delete(path[index]!);
	return expanded;
}

/** Cycle to the next visible sibling at the current row's depth and parent. */
export function cycleVisibleAgentSibling(
	refs: readonly AgentRef[],
	currentId: string,
	direction: -1 | 1,
): AgentRef | undefined {
	const visibleIds = new Set(refs.map(ref => ref.id));
	const current = refs.find(ref => ref.id === currentId);
	if (!current) return undefined;
	const normalizedParent = current.parentId && visibleIds.has(current.parentId) ? current.parentId : undefined;
	const siblings = refs.filter(ref => {
		const parentId = ref.parentId && visibleIds.has(ref.parentId) ? ref.parentId : undefined;
		return parentId === normalizedParent;
	});
	const siblingIndex = siblings.findIndex(ref => ref.id === currentId);
	if (siblingIndex < 0) return undefined;
	return siblings[(siblingIndex + direction + siblings.length) % siblings.length];
}

/** Copy only a byte-bounded visible suffix from an in-flight assistant message. */
export function boundedStreamingAssistant(message: AssistantMessage, maxBytes: number): AssistantMessage {
	let remaining = maxBytes;
	const content: AssistantMessage["content"] = [];
	for (let index = message.content.length - 1; index >= 0 && remaining > 0; index--) {
		const block = message.content[index]!;
		if (block.type !== "text" && block.type !== "thinking") continue;
		const source = block.type === "text" ? block.text : block.thinking;
		const suffix = source.slice(-remaining);
		const bytes = Buffer.from(suffix);
		const clipped =
			bytes.length <= remaining
				? suffix
				: bytes
						.subarray(bytes.length - remaining)
						.toString("utf8")
						.replace(/^\uFFFD/, "");
		remaining -= Buffer.byteLength(clipped);
		content.unshift(block.type === "text" ? { ...block, text: clipped } : { ...block, thinking: clipped });
	}
	return { ...message, content };
}

export interface ResolvedModelParts {
	provider: string | undefined;
	id: string;
	thinking: string | undefined;
	raw: string;
}

const MODEL_ABBREVIATIONS: Record<string, string> = {
	"openai-codex/gpt-5.5": "GPT-5.5",
	"kimi-code/kimi-for-coding": "KimiCode",
	"deepseek/deepseek-v4-pro": "DS V4 Pro",
	"google-antigravity/gemini-3.5-flash": "Gem3.5F",
};
const PROVIDER_SHORT_NAMES: Record<string, string> = {
	anthropic: "AN",
	openai: "OA",
	"openai-codex": "OX",
	google: "GO",
	"google-antigravity": "GM",
	deepseek: "DS",
	"kimi-code": "KM",
	openrouter: "OR",
	mistral: "MI",
};

export function shortProviderName(provider: string): string {
	return PROVIDER_SHORT_NAMES[provider] ?? provider.slice(0, 2).toUpperCase();
}

function splitThinkingSuffix(value: string): { id: string; thinking: string | undefined } {
	const suffixStart = value.lastIndexOf(":");
	if (suffixStart <= 0 || suffixStart === value.length - 1) return { id: value, thinking: undefined };
	return { id: value.slice(0, suffixStart), thinking: value.slice(suffixStart + 1) };
}

export function parseResolvedModel(resolvedModel: string): ResolvedModelParts {
	const raw = resolvedModel.trim().replaceAll("\t", "    ");
	const providerEnd = raw.indexOf("/");
	if (providerEnd <= 0 || providerEnd === raw.length - 1) {
		const { id, thinking } = splitThinkingSuffix(raw);
		return { provider: undefined, id, thinking, raw };
	}
	const provider = raw.slice(0, providerEnd);
	const { id, thinking } = splitThinkingSuffix(raw.slice(providerEnd + 1));
	return { provider, id, thinking, raw };
}

const VARIANT_ALIASES: Record<string, string> = {
	terra: "Tr",
	sonnet: "So",
	luna: "Lu",
	flash: "Fl",
	pro: "Pr",
	coding: "Cd",
	opus: "Op",
	haiku: "Hk",
};

export function abbreviateResolvedModel(parts: ResolvedModelParts): string {
	const modelKey = parts.provider ? `${parts.provider}/${parts.id}` : parts.id;
	const abbreviation = MODEL_ABBREVIATIONS[modelKey];
	if (abbreviation) return abbreviation;
	const id = parts.id
		.replace(/^gpt-/, "")
		.replace(/^claude-/, "")
		.toLowerCase();
	let family = "";
	for (const candidate of Object.keys(VARIANT_ALIASES)) {
		if (id.includes(candidate)) {
			family = candidate;
			break;
		}
	}
	const versionMatch = id.match(/(\d+)[-.](\d+)/);
	let version = "";
	if (versionMatch) version = `${versionMatch[1]}.${versionMatch[2]}`;
	else {
		const singleMatch = id.match(/\d+/);
		if (singleMatch) version = singleMatch[0];
	}
	if (family) {
		const alias = VARIANT_ALIASES[family];
		return version ? `${version}${alias}` : alias;
	}
	return version || parts.id;
}

export function getModelLaneWidth(width: number): number {
	if (width <= 80) return 13;
	if (width <= 120) return 14;
	return 15;
}

export function getStateLaneWidth(width: number): number {
	return width <= 80 ? 6 : 7;
}
