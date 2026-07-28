import type { AgentMessage, ThinkingLevel } from "@oh-my-pi/pi-agent-core";
import type { CompactionPreparation, SessionEntry } from "@oh-my-pi/pi-agent-core/compaction";
import type { MediaContent, Model, TextContent, UserContent } from "@oh-my-pi/pi-ai";
import { contextHasVideo, supportsNativeVideoInput } from "@oh-my-pi/pi-ai";
import { formatModelString, parseModelString } from "../config/model-resolver";
import type { ConfiguredThinkingLevel } from "../thinking";
import { normalizeModelContextAttachments } from "../utils/image-loading";
import {
	convertToLlm,
	type FileMentionMessage,
	readQueueChipText,
	stripMediaFromMessage,
} from "./messages";

export type RetryFallbackChains = Record<string, string[]>;

export type RetryFallbackRevertPolicy = "never" | "cooldown-expiry";

export interface RetryFallbackSelector {
	raw: string;
	provider: string;
	id: string;
	thinkingLevel: ThinkingLevel | undefined;
}

export interface ActiveRetryFallbackState {
	role: string;
	originalSelector: string;
	originalThinkingLevel: ConfiguredThinkingLevel | undefined;
	lastAppliedFallbackThinkingLevel: ConfiguredThinkingLevel | undefined;
	pinned: boolean;
}

export interface RetryFallbackValidationDependencies {
	configuredChains: RetryFallbackChains | undefined;
	modelExists: (provider: string, id: string) => boolean;
	reportWarning: (message: string) => void;
}

export interface RetryFallbackCandidate {
	role: string;
	selector: RetryFallbackSelector;
}

export interface RetryFallbackCandidateDependencies {
	requiresVideo: boolean;
	currentSelector: string;
	role: string | undefined;
	visionSelector: RetryFallbackSelector | undefined;
	fallbackSelectors: RetryFallbackSelector[];
	isSuppressed: (selector: RetryFallbackSelector) => boolean;
	findModel: (selector: RetryFallbackSelector) => Model | undefined;
	hasApiKey: (model: Model) => Promise<boolean>;
}

export function parseRetryFallbackSelector(selector: string): RetryFallbackSelector | undefined {
	const trimmed = selector.trim();
	if (!trimmed) return undefined;
	const parsed = parseModelString(trimmed);
	if (!parsed) return undefined;
	return {
		raw: trimmed,
		provider: parsed.provider,
		id: parsed.id,
		thinkingLevel: parsed.thinkingLevel,
	};
}

export function formatRetryFallbackSelector(model: Model, thinkingLevel: ThinkingLevel | undefined): string {
	const selector = formatModelString(model);
	return thinkingLevel ? `${selector}:${thinkingLevel}` : selector;
}

export function formatRetryFallbackBaseSelector(selector: RetryFallbackSelector): string {
	return `${selector.provider}/${selector.id}`;
}

export function validateRetryFallbackChains(dependencies: RetryFallbackValidationDependencies): void {
	const { configuredChains, modelExists, reportWarning } = dependencies;
	if (configuredChains === undefined) return;
	if (!configuredChains || typeof configuredChains !== "object" || Array.isArray(configuredChains)) {
		reportWarning("retry.proposableFallbackChains must be a mapping of role names to selector arrays.");
		return;
	}

	for (const [role, chain] of Object.entries(configuredChains)) {
		if (!Array.isArray(chain)) {
			reportWarning(`Proposable fallback chain for role '${role}' must be an array of selector strings.`);
			continue;
		}
		for (const selectorStr of chain) {
			if (typeof selectorStr !== "string") {
				reportWarning(`Proposable fallback chain for role '${role}' contains a non-string selector.`);
				continue;
			}
			const parsed = parseRetryFallbackSelector(selectorStr);
			if (!parsed) {
				reportWarning(`Invalid proposable fallback selector format in role '${role}': ${selectorStr}`);
				continue;
			}
			if (!modelExists(parsed.provider, parsed.id)) {
				reportWarning(`Proposable fallback chain for role '${role}' references unknown model: ${selectorStr}`);
			}
		}
	}
}

export function resolveRetryFallbackRole(
	currentSelector: string,
	roles: Iterable<string>,
	getPrimarySelector: (role: string) => RetryFallbackSelector | undefined,
): string | undefined {
	const parsedCurrent = parseRetryFallbackSelector(currentSelector);
	if (!parsedCurrent) return undefined;
	const currentBaseSelector = formatRetryFallbackBaseSelector(parsedCurrent);
	for (const role of roles) {
		const primarySelector = getPrimarySelector(role);
		if (!primarySelector) continue;
		if (primarySelector.raw === currentSelector) return role;
		if (formatRetryFallbackBaseSelector(primarySelector) === currentBaseSelector) return role;
	}
	return undefined;
}

export function getRetryFallbackEffectiveChain(
	primarySelector: RetryFallbackSelector | undefined,
	configuredChain: readonly string[],
): RetryFallbackSelector[] {
	if (!primarySelector) return [];
	const chain = [primarySelector];
	const seen = new Set<string>([primarySelector.raw]);
	for (const selector of configuredChain) {
		const parsed = parseRetryFallbackSelector(selector);
		if (!parsed || seen.has(parsed.raw)) continue;
		seen.add(parsed.raw);
		chain.push(parsed);
	}
	return chain;
}

export function findRetryFallbackCandidates(
	chain: readonly RetryFallbackSelector[],
	currentSelector: string,
): RetryFallbackSelector[] {
	if (chain.length <= 1) return [];
	const parsedCurrent = parseRetryFallbackSelector(currentSelector);
	const currentBaseSelector = parsedCurrent ? formatRetryFallbackBaseSelector(parsedCurrent) : undefined;
	const exactIndex = chain.findIndex(selector => selector.raw === currentSelector);
	if (exactIndex >= 0) return chain.slice(exactIndex + 1);
	const baseIndex = currentBaseSelector
		? chain.findIndex(selector => formatRetryFallbackBaseSelector(selector) === currentBaseSelector)
		: -1;
	if (baseIndex >= 0) return chain.slice(baseIndex + 1);
	return chain.slice(1);
}

export async function selectRetryFallbackCandidate(
	dependencies: RetryFallbackCandidateDependencies,
): Promise<RetryFallbackCandidate | undefined> {
	const {
		requiresVideo,
		currentSelector,
		role,
		visionSelector,
		fallbackSelectors,
		isSuppressed,
		findModel,
		hasApiKey,
	} = dependencies;

	if (requiresVideo && visionSelector) {
		const parsedCurrent = parseRetryFallbackSelector(currentSelector);
		const sameAsCurrent =
			parsedCurrent && formatRetryFallbackBaseSelector(visionSelector) === formatRetryFallbackBaseSelector(parsedCurrent);
		if (!sameAsCurrent && !isSuppressed(visionSelector)) {
			const visionModel = findModel(visionSelector);
			if (visionModel && supportsNativeVideoInput(visionModel) && (await hasApiKey(visionModel))) {
				return { role: role ?? "vision", selector: visionSelector };
			}
		}
	}

	if (!role) return undefined;
	for (const selector of fallbackSelectors) {
		if (isSuppressed(selector)) continue;
		const candidate = findModel(selector);
		if (!candidate || (requiresVideo && !supportsNativeVideoInput(candidate))) continue;
		if (await hasApiKey(candidate)) return { role, selector };
	}
	return undefined;
}

export type RestoredQueuedMessage = { text: string; attachments?: MediaContent[] };

function queuedTextContent(message: AgentMessage): string | undefined {
	if (!("content" in message)) return undefined;
	const content = message.content;
	if (typeof content === "string") return content;
	return content.find((part): part is TextContent => part.type === "text")?.text;
}

export function queuedMediaContent(message: AgentMessage): MediaContent[] | undefined {
	if (!("content" in message) || typeof message.content === "string") return undefined;
	const attachments = message.content.filter(
		(part): part is MediaContent =>
			(part.type === "image" || part.type === "video") &&
			typeof part.data === "string" &&
			typeof part.mimeType === "string",
	);
	return attachments.length > 0 ? attachments : undefined;
}

export function queueChipText(message: AgentMessage): string {
	if (message.role === "custom") {
		return readQueueChipText(message.details) ?? queuedTextContent(message) ?? "";
	}
	const text = queuedTextContent(message) ?? "";
	if (text) return text;
	const attachments = queuedMediaContent(message);
	if (!attachments) return "";
	return attachments.some(attachment => attachment.type === "video") ? "[Video]" : "[Image]";
}

export function toRestoredQueuedMessage(message: AgentMessage): RestoredQueuedMessage {
	return { text: queueChipText(message), attachments: queuedMediaContent(message) };
}

export function normalizeAttachmentsForModel(
	attachments: MediaContent[] | undefined,
	model: Model | null | undefined,
): Promise<MediaContent[] | undefined> {
	if (!model) return Promise.resolve(attachments);
	return normalizeModelContextAttachments(attachments, { model });
}

export async function normalizeMessageContentImages(
	content: string | UserContent[],
	model: Model | null | undefined,
): Promise<string | UserContent[]> {
	if (typeof content === "string") return content;
	const attachments = content.filter((part): part is MediaContent => part.type !== "text");
	const normalizedAttachments = await normalizeAttachmentsForModel(attachments, model);
	if (!normalizedAttachments || normalizedAttachments === attachments) return content;
	let attachmentIndex = 0;
	return content.map(part => (part.type === "text" ? part : normalizedAttachments[attachmentIndex++]!));
}

export async function normalizeAgentMessageImages<T extends AgentMessage>(
	message: T,
	model: Model | null | undefined,
): Promise<T> {
	if (message.role === "fileMention") {
		const fileMention = message as FileMentionMessage;
		const attachments = fileMention.files.flatMap(file => (file.attachment ? [file.attachment] : []));
		const normalizedAttachments = await normalizeAttachmentsForModel(attachments, model);
		if (!normalizedAttachments || normalizedAttachments === attachments) return message;
		let attachmentIndex = 0;
		return {
			...fileMention,
			files: fileMention.files.map(file =>
				file.attachment ? { ...file, attachment: normalizedAttachments[attachmentIndex++]! } : file,
			),
		} as T;
	}
	if (!("content" in message)) return message;
	const content = message.content;
	if (typeof content !== "string" && !Array.isArray(content)) return message;
	const normalized = await normalizeMessageContentImages(content as string | UserContent[], model);
	if (normalized === content) return message;
	return { ...message, content: normalized } as T;
}

export function messagesHaveVideo(messages: AgentMessage[]): boolean {
	return contextHasVideo({ messages: convertToLlm(messages) });
}

export function compactionPreparationHasVideo(preparation: CompactionPreparation): boolean {
	return messagesHaveVideo([
		...preparation.messagesToSummarize,
		...preparation.turnPrefixMessages,
		...preparation.recentMessages,
	]);
}

export interface CompactionCandidateDependencies {
	preferredModel: Model | null | undefined;
	availableModels: Model[];
	requiresVideo: boolean;
	roleIds: readonly string[];
	resolveRoleModel: (role: string, availableModels: Model[], preferredModel: Model | undefined) => Model | undefined;
}

export function resolveCompactionModelCandidates(dependencies: CompactionCandidateDependencies): Model[] {
	const { preferredModel, availableModels, requiresVideo, roleIds, resolveRoleModel } = dependencies;
	const candidates: Model[] = [];
	const seen = new Set<string>();
	const modelKey = (model: Model): string => `${model.provider}/${model.id}`;

	const addCandidate = (model: Model | undefined): void => {
		if (!model || (requiresVideo && !supportsNativeVideoInput(model))) return;
		const key = modelKey(model);
		if (seen.has(key)) return;
		seen.add(key);
		candidates.push(model);
	};

	if (requiresVideo) {
		addCandidate(resolveRoleModel("vision", availableModels, preferredModel ?? undefined));
	}
	addCandidate(preferredModel ?? undefined);
	for (const role of roleIds) {
		addCandidate(resolveRoleModel(role, availableModels, preferredModel ?? undefined));
	}

	const sortedByContext = [...availableModels].sort((a, b) => (b.contextWindow ?? 0) - (a.contextWindow ?? 0));
	for (const model of sortedByContext) {
		if (seen.has(modelKey(model))) continue;
		const candidateCount = candidates.length;
		addCandidate(model);
		if (candidates.length > candidateCount) break;
	}
	return candidates;
}

export function stripMediaFromBranch(entries: SessionEntry[]): number {
	let removed = 0;
	for (const entry of entries) {
		if (entry.type === "message") {
			removed += stripMediaFromMessage(entry.message);
			continue;
		}
		if (entry.type !== "custom_message" || typeof entry.content === "string") continue;
		let stripped: typeof entry.content | undefined;
		for (let index = 0; index < entry.content.length; index++) {
			const part = entry.content[index];
			if (part.type === "text") {
				stripped?.push(part);
				continue;
			}
			if (!stripped) stripped = entry.content.slice(0, index);
			stripped.push({
				type: "text",
				text: part.type === "video" ? "[video omitted]" : "[image omitted]",
			});
			removed++;
		}
		if (stripped) entry.content = stripped;
	}
	return removed;
}
