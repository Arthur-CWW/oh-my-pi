import { getStreamedEditTargetPath } from "./tool-detail-render";
import type { ToolUIStatus } from "./render-utils";

export type ToolCallPhase = "pending" | "running" | "ok" | "error" | "interrupted";

export interface ToolResultSummary {
	content?: Array<{ type?: string; text?: string; data?: string }>;
	details?: unknown;
	isError?: boolean;
}

const MAX_HEADLINE_PART = 72;
const MAX_ARG_STRING_BYTES = 240;

function record(value: unknown): Record<string, unknown> | undefined {
	return value !== null && typeof value === "object" && !Array.isArray(value)
		? (value as Record<string, unknown>)
		: undefined;
}

function text(value: unknown): string | undefined {
	return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

function clip(value: string, max = MAX_HEADLINE_PART): string {
	const flat = value.replace(/\s+/g, " ").trim();
	return flat.length <= max ? flat : `${flat.slice(0, max - 1)}…`;
}

function displayToolName(toolName: string): string {
	const display = toolName
		.replace(/^mcp__/, "")
		.replace(/__/g, " ")
		.replace(/[\/_-]+/g, " ")
		.trim();
	return display ? `${display[0]!.toUpperCase()}${display.slice(1)}` : display;
}

function firstMeaningfulCodeLine(code: string): string | undefined {
	for (const raw of code.split("\n")) {
		const line = raw.trim();
		const dynamicImport = `await ${"import("}`;
		if (!line || line.startsWith("import ") || (line.includes(dynamicImport) && /^[a-z]+\s+\w+/.test(line))) continue;
		return clip(line);
	}
	return undefined;
}

function pathWithRange(args: Record<string, unknown>): string | undefined {
	const path = text(args.path) ?? text(args.file_path);
	if (!path) return undefined;
	const offset = typeof args.offset === "number" ? args.offset : undefined;
	const limit = typeof args.limit === "number" ? args.limit : undefined;
	if (offset === undefined && limit === undefined) return path;
	if (offset !== undefined && limit !== undefined) return `${path}:${offset}-${offset + Math.max(0, limit - 1)}`;
	return `${path}:${offset ?? `first ${limit}`}`;
}

function taskDetail(args: Record<string, unknown>): string | undefined {
	const tasks = Array.isArray(args.tasks) ? args.tasks : undefined;
	const first = record(tasks?.[0]) ?? args;
	const parts = [text(first.id), text(first.role), text(first.model) ?? text(args.model)].filter(Boolean) as string[];
	return parts.length ? parts.join(" · ") : text(args.agent);
}

function browserDetail(args: Record<string, unknown>): string | undefined {
	const action = text(args.action);
	const target = text(args.url) ?? text(args.selector) ?? text(args.name) ?? text(args.target);
	return [action, target].filter(Boolean).join(" · ") || undefined;
}

function ircDetail(args: Record<string, unknown>): string | undefined {
	const op = text(args.op);
	const peer = text(args.to) ?? text(args.from);
	const message = text(args.message);
	return [op, peer ? `${args.to ? "to" : "from"} ${peer}` : undefined, message ? clip(message, 42) : undefined]
		.filter(Boolean)
		.join(" · ") || undefined;
}

function commandDetail(args: Record<string, unknown>): string | undefined {
	const command = text(args.command);
	if (!command) return undefined;
	const tokens = command.split(/\s+/);
	let token = tokens[0];
	for (const candidate of tokens) {
		if (/^[A-Za-z_][A-Za-z0-9_]*=/.test(candidate) || candidate === "env" || candidate === "command" || candidate === "time") {
			continue;
		}
		token = candidate;
		break;
	}
	const cwd = text(args.cwd);
	return cwd ? `${token} · cwd ${cwd}` : token;
}

function findDetail(args: Record<string, unknown>): string | undefined {
	const pattern = text(args.pattern) ?? (Array.isArray(args.paths) ? args.paths.filter(value => typeof value === "string").join(", ") : undefined);
	return pattern ? clip(pattern) : undefined;
}

function salientDetail(toolName: string, args: Record<string, unknown>): string | undefined {
	const normalized = displayToolName(toolName).toLowerCase();
	if (normalized === "bash") return commandDetail(args);
	if (normalized === "read" || normalized === "write") return pathWithRange(args);
	if (normalized === "edit" || normalized === "apply patch") {
		return pathWithRange(args) ?? getStreamedEditTargetPath(args);
	}
	if (normalized === "task") return taskDetail(args);
	if (normalized.includes("node repl js") || normalized === "node repl js") {
		return text(args.title) ?? (text(args.code) ? firstMeaningfulCodeLine(text(args.code)!) : undefined);
	}
	if (normalized.includes("fetch")) return text(args.url);
	if (normalized === "browser") return browserDetail(args);
	if (normalized === "irc") return ircDetail(args);
	if (normalized === "search") return [text(args.pattern), findDetail({ paths: args.paths })].filter(Boolean).join(" · ") || undefined;
	if (normalized === "find") return findDetail(args);
	return text(args.title) ?? text(args.path) ?? text(args.url);
}

function detailAlreadyVisible(detail: string, lead: string): boolean {
	const normalizedDetail = detail.toLowerCase();
	const normalizedLead = lead.toLowerCase();
	if (normalizedLead.includes(normalizedDetail)) return true;
	const pathWithoutRange = normalizedDetail.replace(/:\d+(?:-\d+)?$/u, "");
	return pathWithoutRange !== normalizedDetail && normalizedLead.includes(pathWithoutRange);
}

function numericGist(result: ToolResultSummary | undefined): string | undefined {
	const details = record(result?.details);
	const candidates: Array<[string, unknown]> = [
		["matches", details?.matches ?? details?.matchCount],
		["files", details?.fileCount],
		["lines", details?.lineCount ?? details?.lines],
		["bytes", details?.bytes ?? details?.byteCount],
		["tests", details?.testsPassed ?? details?.passed],
	];
	for (const [label, value] of candidates) {
		if (typeof value === "number" && Number.isFinite(value)) return `${value} ${label}`;
	}
	const output = result?.content?.find(item => item.type === "text")?.text;
	if (output) {
		const lines = output.split("\n").length;
		if (lines > 1) return `${lines} lines`;
	}
	return undefined;
}

export function phaseStatus(phase: ToolCallPhase): ToolUIStatus {
	switch (phase) {
		case "pending": return "pending";
		case "running": return "running";
		case "ok": return "success";
		case "error": return "error";
		case "interrupted": return "aborted";
	}
}

export function composeToolHeadline(
	toolName: string,
	argsValue: unknown,
	phase: ToolCallPhase,
	result?: ToolResultSummary,
): string {
	const args = record(argsValue) ?? {};
	const intent = text(args._i);
	const detail = salientDetail(toolName, args);
	const lead = intent ? clip(intent) : displayToolName(toolName) || "tool";
	const parts = [lead];
	if (detail && !detailAlreadyVisible(detail, lead)) parts.push(clip(detail));
	parts.push(phase);
	const cause = phase === "error" ? text(record(result?.details)?.failureCause) ?? text(record(result?.details)?.cause) : undefined;
	if (cause) parts.push(clip(cause, 40));
	const gist = phase === "ok" || phase === "error" ? numericGist(result) : undefined;
	if (gist) parts.push(gist);
	return parts.join(" · ");
}

export class ToolHeadlineMemo {
	#toolName?: string;
	#args?: unknown;
	#phase?: ToolCallPhase;
	#resultVersion = -1;
	#value = "";

	get(toolName: string, args: unknown, phase: ToolCallPhase, resultVersion: number, build: () => string): string {
		if (this.#toolName === toolName && this.#args === args && this.#phase === phase && this.#resultVersion === resultVersion) {
			return this.#value;
		}
		this.#toolName = toolName;
		this.#args = args;
		this.#phase = phase;
		this.#resultVersion = resultVersion;
		this.#value = build();
		return this.#value;
	}
}

function bytes(value: string): number {
	return Buffer.byteLength(value, "utf8");
}

function scalar(value: unknown): string {
	if (typeof value === "string") {
		const count = bytes(value);
		return count <= MAX_ARG_STRING_BYTES ? value.replace(/\r?\n/g, "\\n") : `${value.slice(0, 160).replace(/\r?\n/g, "\\n")}… <${count} bytes>`;
	}
	if (value === null) return "null";
	if (value === undefined) return "undefined";
	return String(value);
}

export function formatToolArgsLines(value: unknown, indent = ""): string[] {
	const object = record(value);
	if (!object) return [`${indent}value: ${scalar(value)}`];
	const lines: string[] = [];
	for (const [label, item] of Object.entries(object)) {
		const nested = record(item);
		if (nested) {
			lines.push(`${indent}${label}:`);
			lines.push(...formatToolArgsLines(nested, `${indent}  `));
		} else if (Array.isArray(item)) {
			lines.push(`${indent}${label}: ${item.length} item${item.length === 1 ? "" : "s"}`);
			for (let index = 0; index < item.length; index++) {
				const entry = record(item[index]);
				if (entry) {
					lines.push(`${indent}  ${index + 1}:`);
					lines.push(...formatToolArgsLines(entry, `${indent}    `));
				} else lines.push(`${indent}  ${index + 1}: ${scalar(item[index])}`);
			}
		} else lines.push(`${indent}${label}: ${scalar(item)}`);
	}
	return lines;
}
