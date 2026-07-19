import type { AgentMessage } from "@oh-my-pi/pi-agent-core";
import type { ToolCall } from "@oh-my-pi/pi-ai";

/** A fenced code block extracted from assistant markdown. */
export interface CodeBlock {
	/** Info string after the opening fence (language id), trimmed. */
	lang: string;
	/** Block body with the trailing newline stripped. */
	code: string;
}

/** A blockquote block: a maximal run of `>`-prefixed lines from markdown. */
export interface QuoteBlock {
	/** Block body with each line's `>` marker (and one optional space) removed. */
	text: string;
}

/** A drillable block within an assistant message, in document order. */
export type MessageBlock = ({ kind: "code" } & CodeBlock) | ({ kind: "quote" } & QuoteBlock);

/** A runnable command found in the transcript. */
export interface LastCommand {
	kind: "bash" | "eval";
	code: string;
	/** Highlight language: "bash" for bash, "python"/"javascript" for eval. */
	language: string;
}

/**
 * A node in the `/copy` picker tree. Leaves carry `content` (placed on the
 * clipboard) plus `copyMessage` (the status shown afterwards); groups carry
 * `children` to drill into.
 */
export interface CopyTarget {
	/** Stable identity derived from transcript identity, never display order. */
	readonly id: string;
	readonly label: string;
	/** Dim annotation: line/block counts, language, or tool name. */
	hint?: string;
	/** Full text rendered in the preview pane. */
	preview: string;
	/** Highlight language for code/command previews (undefined = plain/markdown). */
	language?: string;
	/** Leaf: text copied to the clipboard. */
	content?: string;
	/** Leaf: status message shown after copying. */
	copyMessage?: string;
	/** Group: nested targets to drill into. */
	children?: CopyTarget[];
}

/** Minimal session surface needed to assemble copy targets (eases testing). */
export interface CopySource {
	readonly messages: readonly AgentMessage[];
	getLastVisibleHandoffText(): string | undefined;
}

/** Cap on how many recent assistant messages the picker lists. */
const MAX_MESSAGES = 50;

const OPEN_FENCE_RE = /^```([^\n]*)$/;
const CLOSE_FENCE_RE = /^```/;
const QUOTE_LINE_RE = /^>(.*)$/;

/**
 * Split assistant markdown into drillable blocks — fenced code and `>`-quoted
 * runs — in document order. Fences mask their bodies, so a `>` line inside a
 * code block is never mistaken for a quote. An unclosed fence is treated as
 * ordinary text, matching the fenced-block grammar.
 */
export function extractBlocks(text: string): MessageBlock[] {
	const blocks: MessageBlock[] = [];
	const lines = text.split("\n");
	let quote: string[] | undefined;
	const flushQuote = () => {
		if (quote) {
			blocks.push({ kind: "quote", text: quote.join("\n") });
			quote = undefined;
		}
	};

	for (let i = 0; i < lines.length; i++) {
		const line = lines[i]!;
		const open = OPEN_FENCE_RE.exec(line);
		if (open) {
			let close = -1;
			for (let k = i + 1; k < lines.length; k++) {
				if (CLOSE_FENCE_RE.test(lines[k]!)) {
					close = k;
					break;
				}
			}
			if (close !== -1) {
				flushQuote();
				blocks.push({ kind: "code", lang: open[1].trim(), code: lines.slice(i + 1, close).join("\n") });
				i = close;
				continue;
			}
		}

		const quoted = QUOTE_LINE_RE.exec(line);
		if (quoted) {
			quote ??= [];
			quote.push(quoted[1].startsWith(" ") ? quoted[1].slice(1) : quoted[1]);
		} else {
			flushQuote();
		}
	}
	flushQuote();
	return blocks;
}

/** Extract fenced code blocks from assistant markdown, in document order. */
export function extractCodeBlocks(text: string): CodeBlock[] {
	return extractBlocks(text)
		.filter((b): b is { kind: "code" } & CodeBlock => b.kind === "code")
		.map(b => ({ lang: b.lang, code: b.code }));
}

/** Extract `>`-quoted blocks from assistant markdown, in document order. */
export function extractQuoteBlocks(text: string): QuoteBlock[] {
	return extractBlocks(text)
		.filter((b): b is { kind: "quote" } & QuoteBlock => b.kind === "quote")
		.map(b => ({ text: b.text }));
}

function extractEvalCode(args: unknown): { code: string; language: string } | undefined {
	if (!args || typeof args !== "object") return undefined;
	const cells = (args as { cells?: unknown }).cells;
	if (!Array.isArray(cells)) return undefined;

	const codeBlocks: string[] = [];
	let language = "python";
	let languageResolved = false;
	for (const cell of cells) {
		if (!cell || typeof cell !== "object") continue;
		const code = (cell as { code?: unknown }).code;
		if (typeof code !== "string" || code.length === 0) continue;
		codeBlocks.push(code);
		if (!languageResolved) {
			language = (cell as { language?: unknown }).language === "js" ? "javascript" : "python";
			languageResolved = true;
		}
	}

	return codeBlocks.length > 0 ? { code: codeBlocks.join("\n\n"), language } : undefined;
}

function commandFromToolCall(tc: ToolCall): LastCommand | undefined {
	if (tc.name === "bash" && typeof tc.arguments.command === "string") {
		return { kind: "bash", code: tc.arguments.command, language: "bash" };
	}
	if (tc.name === "eval") {
		const evalResult = extractEvalCode(tc.arguments);
		if (evalResult) return { kind: "eval", code: evalResult.code, language: evalResult.language };
	}
	return undefined;
}

/** Walk the transcript backwards for the most recent bash command or eval code. */
export function extractLastCommand(messages: readonly AgentMessage[]): LastCommand | undefined {
	for (let i = messages.length - 1; i >= 0; i--) {
		const msg = messages[i];
		if (msg.role !== "assistant") continue;
		const toolCalls = msg.content.filter((c): c is ToolCall => c.type === "toolCall");
		for (let j = toolCalls.length - 1; j >= 0; j--) {
			const command = commandFromToolCall(toolCalls[j]!);
			if (command) return command;
		}
	}
	return undefined;
}

/** Concatenated visible text of an assistant message, or undefined when empty. */
function assistantText(msg: AgentMessage): string | undefined {
	if (msg.role !== "assistant") return undefined;
	let text = "";
	for (const content of msg.content) {
		if (content.type === "text") text += content.text;
	}
	return text.trim() || undefined;
}

function pluralLines(text: string): string {
	const count = text.length === 0 ? 0 : text.split("\n").length;
	return `${count} line${count === 1 ? "" : "s"}`;
}

function blockHint(block: CodeBlock): string {
	const lines = pluralLines(block.code);
	return block.lang ? `${block.lang} · ${lines}` : lines;
}

/** First non-empty line, whitespace-collapsed, used as a message label. */
function firstLine(text: string): string {
	for (const line of text.split("\n")) {
		const trimmed = line.trim();
		if (trimmed) return trimmed.replace(/\s+/g, " ");
	}
	return text.trim().replace(/\s+/g, " ");
}

/** "<n> lines · <c> code · <q> quote" — omitting block kinds that are absent. */
function blockSummaryHint(text: string, codeCount: number, quoteCount: number): string {
	const parts = [pluralLines(text)];
	if (codeCount > 0) parts.push(`${codeCount} code`);
	if (quoteCount > 0) parts.push(`${quoteCount} quote`);
	return parts.join(" · ");
}

/** A compact deterministic digest for sources without persisted entry IDs. */
function stableDigest(value: string): string {
	let hash = 2166136261;
	for (let index = 0; index < value.length; index++) {
		hash ^= value.charCodeAt(index);
		hash = Math.imul(hash, 16777619);
	}
	return (hash >>> 0).toString(36);
}

function stableMessageId(message: AgentMessage, text: string): string {
	const candidate = message as AgentMessage & { id?: string; timestamp?: number };
	if (typeof candidate.id === "string" && candidate.id.length > 0) return `msg:${candidate.id}`;
	const timestamp = typeof candidate.timestamp === "number" ? String(candidate.timestamp) : "none";
	return `msg:${timestamp}:${stableDigest(text)}`;
}

function stableCommandId(command: LastCommand): string {
	return `cmd:${command.kind}:${stableDigest(command.code)}`;
}

/** Build the target node for one assistant message. */
function messageTarget(text: string, id: string): CopyTarget {
	const label = firstLine(text);
	const blocks = extractBlocks(text);
	const messageCopy = "Copied message to clipboard";

	if (blocks.length === 0) {
		return { id, label, hint: pluralLines(text), preview: text, content: text, copyMessage: messageCopy };
	}

	const children: CopyTarget[] = [];
	const codeBlocks: CodeBlock[] = [];
	const quoteBlocks: QuoteBlock[] = [];
	for (const block of blocks) {
		if (block.kind === "code") {
			const index = codeBlocks.length;
			codeBlocks.push(block);
			children.push({
				id: `${id}:code:${index}`,
				label: `Block ${index + 1}`,
				hint: blockHint(block),
				preview: block.code,
				language: block.lang || undefined,
				content: block.code,
				copyMessage: `Copied code block ${index + 1} to clipboard`,
			});
		} else {
			const index = quoteBlocks.length;
			quoteBlocks.push(block);
			children.push({
				id: `${id}:quote:${index}`,
				label: `Quote ${index + 1}`,
				hint: pluralLines(block.text),
				preview: block.text,
				content: block.text,
				copyMessage: `Copied quote block ${index + 1} to clipboard`,
			});
		}
	}

	if (codeBlocks.length > 1) {
		const combined = codeBlocks.map(block => block.code).join("\n\n");
		children.push({
			id: `${id}:all`,
			label: `All ${codeBlocks.length} blocks`,
			hint: pluralLines(combined),
			preview: combined,
			content: combined,
			copyMessage: `Copied ${codeBlocks.length} code blocks to clipboard`,
		});
	}
	if (quoteBlocks.length > 1) {
		const combined = quoteBlocks.map(block => block.text).join("\n\n");
		children.push({
			id: `${id}:all-quotes`,
			label: `All ${quoteBlocks.length} quotes`,
			hint: pluralLines(combined),
			preview: combined,
			content: combined,
			copyMessage: `Copied ${quoteBlocks.length} quote blocks to clipboard`,
		});
	}

	return {
		id,
		label,
		hint: blockSummaryHint(text, codeBlocks.length, quoteBlocks.length),
		preview: text,
		content: text,
		copyMessage: messageCopy,
		children,
	};
}

function commandTitle(command: LastCommand): string {
	return command.kind === "bash" ? "Bash command" : "Eval code";
}

function commandTarget(command: LastCommand): CopyTarget {
	const title = commandTitle(command);
	return {
		id: stableCommandId(command),
		label: firstLine(command.code) || title,
		hint: `${command.kind} · ${pluralLines(command.code)}`,
		preview: command.code,
		language: command.language,
		content: command.code,
		copyMessage: `Copied ${command.kind === "bash" ? "bash command" : "eval code"} to clipboard`,
	};
}

/**
 * Assemble the unified `/copy` target tree. Stable target IDs are derived from
 * persisted message identity/content, so reorder does not turn one target into
 * another and removal clamps selection by ID in the keyed tree reducer.
 */
export function buildCopyTargets(source: CopySource): CopyTarget[] {
	const targets: CopyTarget[] = [];
	const pendingCommands: LastCommand[] = [];
	let messageCount = 0;

	const appendCommands = (commands: readonly LastCommand[]) => {
		for (const command of commands) targets.push(commandTarget(command));
	};

	for (let index = source.messages.length - 1; index >= 0 && messageCount < MAX_MESSAGES; index--) {
		const message = source.messages[index];
		if (message.role !== "assistant") continue;

		const toolCalls = message.content.filter((content): content is ToolCall => content.type === "toolCall");
		const commands: LastCommand[] = [];
		for (let callIndex = toolCalls.length - 1; callIndex >= 0; callIndex--) {
			const command = commandFromToolCall(toolCalls[callIndex]!);
			if (command) commands.push(command);
		}

		const text = assistantText(message);
		if (!text) {
			pendingCommands.push(...commands);
			continue;
		}

		messageCount += 1;
		targets.push(messageTarget(text, stableMessageId(message, text)));
		appendCommands(pendingCommands);
		appendCommands(commands);
		pendingCommands.length = 0;
	}

	if (messageCount === 0) {
		const handoff = source.getLastVisibleHandoffText();
		if (handoff) {
			targets.unshift({
				id: "handoff",
				label: "Handoff context",
				hint: pluralLines(handoff),
				preview: handoff,
				content: handoff,
				copyMessage: "Copied handoff context to clipboard",
			});
		}
		appendCommands(pendingCommands);
	}

	return targets;
}
