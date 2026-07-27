import { createHash, randomUUID } from "node:crypto";
import * as fs from "node:fs";
import * as path from "node:path";
import { type Api, type Context, completeSimple, type Model } from "@oh-my-pi/pi-ai";
import { type GeneratedProvider, getBundledModel } from "@oh-my-pi/pi-catalog/models";
import { getAgentDir, isEnoent } from "@oh-my-pi/pi-utils";
import { Schema } from "effect";

export const REFUSAL_CORPUS_SCHEMA_VERSION = 1 as const;
export const REFUSAL_PROMPT_EXCERPT_MAX = 160;
export const REFUSAL_REPLAY_PROMPT_MAX = 4_000;
export const REFUSAL_TEXT_MAX = 512;
export const REFUSAL_NOTE_MAX = 1_000;
export const REFUSAL_REDACTION_POLICY = "refusal-v1";
export const REFUSAL_CORPUS_ENV = "OMP_REFUSALS_PATH";
export const REFUSAL_CORPUS_FILENAME = "refusals.jsonl";

export type RefusalVerdict = "false-positive" | "true-positive" | "ambiguous" | "unreviewed";
export type RefusalVerdictInput = RefusalVerdict | "pending" | "confirmed";
export type RefusalReplayOutcome = "refused" | "passed" | "error";

export interface RefusalReplayRecord {
	readonly caseId: string;
	readonly timestamp: number;
	readonly refused: boolean;
	readonly outcome: RefusalReplayOutcome;
	readonly category: string | null;
	readonly textExcerpt: string | null;
	readonly refusalText: string | null;
	readonly error: string | null;
}

export interface RefusalReplayEnvelope {
	readonly prompt: string;
	readonly contextSources: readonly string[];
	readonly toolNames: readonly string[];
}

export interface RefusalCase {
	readonly schemaVersion: typeof REFUSAL_CORPUS_SCHEMA_VERSION;
	readonly id: string;
	readonly caseId: string;
	readonly timestamp: number;
	readonly provider: string;
	readonly model: string;
	readonly modelVersion: string;
	readonly version: string;
	readonly role: string;
	readonly category: string;
	readonly tool: string | null;
	readonly action: string | null;
	readonly sessionId: string | null;
	readonly turnId: string | null;
	readonly correlationId: string | null;
	readonly promptFingerprint: string;
	readonly promptExcerpt: string;
	readonly safeExcerpt: string;
	readonly contextSources: readonly string[];
	readonly refusalText: string;
	readonly rerouteOutcome: string | null;
	readonly verdict: RefusalVerdict;
	readonly remediationNote: string | null;
	readonly note: string | null;
	readonly requiresTools: boolean;
	readonly replayEnvelope: RefusalReplayEnvelope;
	readonly replayHistory: readonly RefusalReplayRecord[];
	readonly redactionPolicyId: typeof REFUSAL_REDACTION_POLICY;
}

export interface RefusalCaseInput {
	readonly id?: string;
	readonly caseId?: string;
	readonly timestamp?: number;
	readonly provider?: string;
	readonly model?: string;
	readonly modelVersion?: string;
	readonly version?: string;
	readonly role?: string;
	readonly category?: string;
	readonly tool?: string | null;
	readonly action?: string | null;
	readonly sessionId?: string | null;
	readonly turnId?: string | null;
	readonly correlationId?: string | null;
	readonly prompt?: string;
	readonly contextSources?: readonly string[];
	readonly refusalText?: string;
	readonly rerouteOutcome?: string | null;
	readonly verdict?: RefusalVerdictInput;
	readonly remediationNote?: string | null;
	readonly note?: string | null;
	readonly requiresTools?: boolean;
	readonly replayEnvelope?: Partial<RefusalReplayEnvelope>;
}

export interface RefusalCorpusOptions {
	readonly path?: string;
}

export interface RefusalListOptions {
	readonly limit?: number;
	readonly modelVersion?: string;
	readonly category?: string;
	readonly action?: string;
	readonly contextSource?: string;
	readonly verdict?: RefusalVerdictInput;
	readonly since?: number;
	readonly falsePositivesOnly?: boolean;
}

export interface RefusalCount {
	readonly value: string | null;
	readonly count: number;
}

export interface RefusalStats {
	readonly total: number;
	readonly modelVersion: readonly RefusalCount[];
	readonly category: readonly RefusalCount[];
	readonly action: readonly RefusalCount[];
	readonly contextSource: readonly RefusalCount[];
	readonly verdict: readonly RefusalCount[];
	readonly byModelVersion: readonly RefusalCount[];
	readonly byCategory: readonly RefusalCount[];
	readonly byAction: readonly RefusalCount[];
	readonly byContextSource: readonly RefusalCount[];
	readonly byVerdict: readonly RefusalCount[];
}

export interface RefusalReplayRequest extends RefusalReplayEnvelope {
	readonly provider: string;
	readonly model: string;
	readonly modelVersion: string;
	readonly role: string;
	/** Always empty: refusal replay is deliberately a no-tools request. */
	readonly tools: readonly [];
}

export interface RefusalReplayObservation {
	readonly outcome?: Exclude<RefusalReplayOutcome, "error">;
	readonly refused?: boolean;
	readonly category?: string | null;
	readonly refusalText?: string | null;
	readonly textExcerpt?: string | null;
}

export type RefusalReplayCompletion = (
	envelope: RefusalReplayRequest,
	refusalCase: RefusalCase,
) => RefusalReplayObservation | Promise<RefusalReplayObservation>;

export interface RefusalReplayOptions {
	readonly completion?: RefusalReplayCompletion;
	readonly resolveModel?: (
		provider: string,
		model: string,
	) => Model<Api> | undefined | Promise<Model<Api> | undefined>;
	readonly nowMs?: () => number;
}

export const RefusalReplayRecordSchema = Schema.Struct({
	caseId: Schema.String,
	timestamp: Schema.Number,
	refused: Schema.Boolean,
	outcome: Schema.Literals(["refused", "passed", "error"]),
	category: Schema.NullOr(Schema.String),
	textExcerpt: Schema.NullOr(Schema.String),
	refusalText: Schema.NullOr(Schema.String),
	error: Schema.NullOr(Schema.String),
});

export const RefusalReplayEnvelopeSchema = Schema.Struct({
	prompt: Schema.String,
	contextSources: Schema.Array(Schema.String),
	toolNames: Schema.Array(Schema.String),
});

export const RefusalCaseSchema = Schema.Struct({
	schemaVersion: Schema.Literal(REFUSAL_CORPUS_SCHEMA_VERSION),
	id: Schema.String,
	caseId: Schema.String,
	timestamp: Schema.Number,
	provider: Schema.String,
	model: Schema.String,
	modelVersion: Schema.String,
	version: Schema.String,
	role: Schema.String,
	category: Schema.String,
	tool: Schema.NullOr(Schema.String),
	action: Schema.NullOr(Schema.String),
	sessionId: Schema.NullOr(Schema.String),
	turnId: Schema.NullOr(Schema.String),
	correlationId: Schema.NullOr(Schema.String),
	promptFingerprint: Schema.String,
	promptExcerpt: Schema.String,
	safeExcerpt: Schema.String,
	contextSources: Schema.Array(Schema.String),
	refusalText: Schema.String,
	rerouteOutcome: Schema.NullOr(Schema.String),
	verdict: Schema.Literals(["false-positive", "true-positive", "ambiguous", "unreviewed"]),
	remediationNote: Schema.NullOr(Schema.String),
	note: Schema.NullOr(Schema.String),
	requiresTools: Schema.Boolean,
	replayEnvelope: RefusalReplayEnvelopeSchema,
	replayHistory: Schema.Array(RefusalReplayRecordSchema),
	redactionPolicyId: Schema.Literal(REFUSAL_REDACTION_POLICY),
});

export function decodeRefusalCase(input: unknown): RefusalCase {
	return Schema.decodeUnknownSync(RefusalCaseSchema)(input, { onExcessProperty: "error" });
}

const SECRET_PATTERNS: readonly [RegExp, string][] = [
	[/\bBearer\s+[A-Za-z0-9._~+/-]+=*/gi, "Bearer [REDACTED]"],
	[/\b(?:sk|pk|rk|api|key)-[A-Za-z0-9_-]{8,}\b/gi, "[REDACTED]"],
	[
		/\b(?:api[_-]?key|access[_-]?token|auth(?:orization)?|password|secret)\s*[:=]\s*["']?[^\s,"'};]+/gi,
		"$1=[REDACTED]",
	],
];

export function redactRefusalText(value: string): string {
	let redacted = value;
	for (const [pattern, replacement] of SECRET_PATTERNS) redacted = redacted.replace(pattern, replacement);
	return redacted;
}

export function redactContextSource(value: string): string {
	const normalized = value.replaceAll("\\", "/").trim();
	if (normalized.length === 0) return "[unknown]";
	const basename = normalized.slice(normalized.lastIndexOf("/") + 1);
	return basename;
}

function cap(value: string, maximum: number): string {
	return value.length <= maximum ? value : value.slice(0, maximum);
}

function safeLabel(value: string | undefined | null, maximum = 256): string {
	return cap(redactRefusalText(value?.trim() || "unknown"), maximum);
}

function safeNullable(value: string | null | undefined, maximum = 512): string | null {
	if (value === undefined || value === null || value.trim().length === 0) return null;
	return cap(redactRefusalText(value.trim()), maximum);
}

function uniqueStrings(values: readonly string[]): string[] {
	return [...new Set(values.filter(value => value.length > 0))];
}

function normalizeContextSources(values: readonly string[] | undefined): string[] {
	return uniqueStrings((values ?? []).map(redactContextSource)).slice(0, 128);
}

function normalizeVerdict(value: RefusalVerdictInput | undefined): RefusalVerdict {
	if (value === "pending") return "unreviewed";
	if (value === "confirmed") return "true-positive";
	return value ?? "unreviewed";
}

export function normalizeRefusalCase(input: RefusalCaseInput): RefusalCase {
	const prompt = redactRefusalText(input.prompt ?? "");
	const contextSources = normalizeContextSources(input.contextSources);
	const replayPrompt = redactRefusalText(input.replayEnvelope?.prompt ?? input.prompt ?? "");
	const toolNames = uniqueStrings(input.replayEnvelope?.toolNames ?? (input.tool ? [input.tool] : []));
	const id = input.id?.trim() || input.caseId?.trim() || randomUUID();
	const modelVersion = safeLabel(input.modelVersion ?? input.version);
	const note = safeNullable(input.note ?? input.remediationNote, REFUSAL_NOTE_MAX);
	return {
		schemaVersion: REFUSAL_CORPUS_SCHEMA_VERSION,
		id,
		caseId: id,
		timestamp: input.timestamp ?? Date.now(),
		provider: safeLabel(input.provider, 128),
		model: safeLabel(input.model),
		modelVersion,
		version: modelVersion,
		role: safeLabel(input.role),
		category: safeLabel(input.category),
		tool: safeNullable(input.tool),
		action: safeNullable(input.action),
		sessionId: safeNullable(input.sessionId, 256),
		turnId: safeNullable(input.turnId, 256),
		correlationId: safeNullable(input.correlationId, 256),
		promptFingerprint: createHash("sha256").update(prompt).digest("hex"),
		promptExcerpt: cap(prompt, REFUSAL_PROMPT_EXCERPT_MAX),
		safeExcerpt: cap(prompt, REFUSAL_PROMPT_EXCERPT_MAX),
		contextSources,
		refusalText: cap(redactRefusalText(input.refusalText ?? ""), REFUSAL_TEXT_MAX),
		rerouteOutcome: safeNullable(input.rerouteOutcome),
		verdict: normalizeVerdict(input.verdict),
		remediationNote: note,
		note,
		requiresTools: input.requiresTools ?? (input.tool !== undefined && input.tool !== null),
		replayEnvelope: {
			prompt: cap(replayPrompt, REFUSAL_REPLAY_PROMPT_MAX),
			contextSources,
			toolNames,
		},
		replayHistory: [],
		redactionPolicyId: REFUSAL_REDACTION_POLICY,
	};
}

export function defaultRefusalCorpusPath(): string {
	const override = Bun.env[REFUSAL_CORPUS_ENV]?.trim();
	return override || path.join(getAgentDir(), REFUSAL_CORPUS_FILENAME);
}

function readCases(filePath: string): Map<string, RefusalCase> {
	let raw: string;
	try {
		raw = fs.readFileSync(filePath, "utf8");
	} catch (error) {
		if (isEnoent(error)) return new Map();
		throw error;
	}
	const cases = new Map<string, RefusalCase>();
	for (const line of raw.split("\n")) {
		if (line.trim().length === 0) continue;
		try {
			const refusalCase = decodeRefusalCase(JSON.parse(line));
			cases.set(refusalCase.id, refusalCase);
		} catch {
			// A malformed line must not hide valid later records in this append-only file.
		}
	}
	return cases;
}

function appendLine(filePath: string, refusalCase: RefusalCase): void {
	fs.mkdirSync(path.dirname(filePath), { recursive: true });
	fs.appendFileSync(filePath, `${JSON.stringify(refusalCase)}\n`, "utf8");
}

function countBy(values: Iterable<string | null>): RefusalCount[] {
	const counts = new Map<string | null, number>();
	for (const value of values) counts.set(value, (counts.get(value) ?? 0) + 1);
	return [...counts.entries()]
		.sort((left, right) => right[1] - left[1] || String(left[0]).localeCompare(String(right[0])))
		.map(([value, count]) => ({ value, count }));
}

function modelVersionOf(refusalCase: RefusalCase): string {
	return refusalCase.modelVersion === "unknown"
		? refusalCase.model
		: `${refusalCase.model}@${refusalCase.modelVersion}`;
}

export function replayRequiresTools(refusalCase: RefusalCase): boolean {
	return refusalCase.requiresTools || refusalCase.tool !== null || refusalCase.replayEnvelope.toolNames.length > 0;
}

export class RefusalCorpus {
	readonly #path: string;
	#cases: Map<string, RefusalCase>;

	constructor(options: RefusalCorpusOptions = {}) {
		this.#path = options.path ?? defaultRefusalCorpusPath();
		this.#cases = readCases(this.#path);
	}

	get filePath(): string {
		return this.#path;
	}

	appendCase(input: RefusalCaseInput): RefusalCase {
		const refusalCase = normalizeRefusalCase(input);
		appendLine(this.#path, refusalCase);
		this.#cases.set(refusalCase.id, refusalCase);
		return refusalCase;
	}

	get(id: string): RefusalCase | undefined {
		return this.#cases.get(id);
	}

	list(options: RefusalListOptions = {}): readonly RefusalCase[] {
		const verdict =
			options.verdict === "pending"
				? "unreviewed"
				: options.verdict === "confirmed"
					? "true-positive"
					: options.verdict;
		const values = [...this.#cases.values()].filter(refusalCase => {
			if (options.modelVersion !== undefined && refusalCase.modelVersion !== options.modelVersion) return false;
			if (options.category !== undefined && refusalCase.category !== options.category) return false;
			if (options.action !== undefined && refusalCase.action !== options.action) return false;
			if (options.contextSource !== undefined && !refusalCase.contextSources.includes(options.contextSource))
				return false;
			if (verdict !== undefined && refusalCase.verdict !== verdict) return false;
			if (options.falsePositivesOnly && refusalCase.verdict !== "false-positive") return false;
			if (options.since !== undefined && refusalCase.timestamp < options.since) return false;
			return true;
		});
		const limit = options.limit === undefined ? values.length : Math.max(0, Math.min(500, options.limit));
		return values.slice(0, limit);
	}

	stats(): RefusalStats {
		const cases = this.list();
		const modelVersion = countBy(cases.map(modelVersionOf));
		const category = countBy(cases.map(refusalCase => refusalCase.category));
		const action = countBy(cases.map(refusalCase => refusalCase.action));
		const contextSource = countBy(cases.flatMap(refusalCase => refusalCase.contextSources));
		const verdict = countBy(cases.map(refusalCase => refusalCase.verdict));
		return {
			total: cases.length,
			modelVersion,
			category,
			action,
			contextSource,
			verdict,
			byModelVersion: modelVersion,
			byCategory: category,
			byAction: action,
			byContextSource: contextSource,
			byVerdict: verdict,
		};
	}

	mark(id: string, update: { verdict: RefusalVerdictInput; note?: string | null }): RefusalCase;
	mark(id: string, verdict: RefusalVerdictInput, note?: string | null): RefusalCase;
	mark(
		id: string,
		updateOrVerdict: { verdict: RefusalVerdictInput; note?: string | null } | RefusalVerdictInput,
		note?: string | null,
	): RefusalCase {
		const current = this.#cases.get(id);
		if (!current) throw new Error(`Refusal case not found: ${id}`);
		const verdict = typeof updateOrVerdict === "string" ? updateOrVerdict : updateOrVerdict.verdict;
		const noteValue = typeof updateOrVerdict === "string" ? note : updateOrVerdict.note;
		const safeNote = noteValue === undefined ? current.note : safeNullable(noteValue, REFUSAL_NOTE_MAX);
		const updated: RefusalCase = {
			...current,
			verdict: normalizeVerdict(verdict),
			remediationNote: safeNote,
			note: safeNote,
		};
		appendLine(this.#path, updated);
		this.#cases.set(id, updated);
		return updated;
	}

	async replay(id: string, options: RefusalReplayOptions = {}): Promise<RefusalReplayRecord> {
		const refusalCase = this.#cases.get(id);
		if (!refusalCase) throw new Error(`Refusal case not found: ${id}`);
		return replayRefusalCase(this, refusalCase, options);
	}

	async replayFalsePositives(options: RefusalReplayOptions = {}): Promise<readonly RefusalReplayRecord[]> {
		const results: RefusalReplayRecord[] = [];
		for (const refusalCase of this.list({ falsePositivesOnly: true })) {
			results.push(await replayRefusalCase(this, refusalCase, options));
		}
		return results;
	}

	recordReplay(refusalCase: RefusalCase, replay: RefusalReplayRecord): RefusalReplayRecord {
		const updated: RefusalCase = { ...refusalCase, replayHistory: [...refusalCase.replayHistory, replay] };
		appendLine(this.#path, updated);
		this.#cases.set(updated.id, updated);
		return replay;
	}
}

async function defaultReplayCompletion(
	request: RefusalReplayRequest,
	resolveModel?: RefusalReplayOptions["resolveModel"],
): Promise<RefusalReplayObservation> {
	const model =
		(await resolveModel?.(request.provider, request.model)) ??
		getBundledModel(request.provider as GeneratedProvider, request.model);
	if (!model) throw new Error(`Current Fable model is unavailable: ${request.provider}/${request.model}`);
	const context: Context = {
		messages: [{ role: "user", content: request.prompt, timestamp: Date.now() }],
		systemPrompt: request.contextSources.map(source => `Stored context source: ${source}`),
		tools: [],
	};
	const response = await completeSimple(model, context);
	const refused = response.stopDetails?.type === "refusal";
	return {
		refused,
		outcome: refused ? "refused" : "passed",
		category: refused ? (response.stopDetails?.category ?? null) : null,
		refusalText: refused ? (response.errorMessage ?? response.stopDetails?.explanation ?? null) : null,
	};
}

function normalizeReplayObservation(observation: RefusalReplayObservation): {
	readonly refused: boolean;
	readonly outcome: RefusalReplayOutcome;
	readonly category: string | null;
	readonly textExcerpt: string | null;
} {
	const refused = observation.refused ?? observation.outcome === "refused";
	return {
		refused,
		outcome: observation.outcome ?? (refused ? "refused" : "passed"),
		category: safeNullable(observation.category, 256),
		textExcerpt: safeNullable(observation.textExcerpt ?? observation.refusalText, REFUSAL_TEXT_MAX),
	};
}

async function replayRefusalCase(
	corpus: RefusalCorpus,
	refusalCase: RefusalCase,
	options: RefusalReplayOptions,
): Promise<RefusalReplayRecord> {
	if (replayRequiresTools(refusalCase)) {
		throw new Error(
			`Refusal replay requires tools (${refusalCase.tool ?? refusalCase.replayEnvelope.toolNames.join(", ")}); replay is read-only and no-tools by design.`,
		);
	}
	const request: RefusalReplayRequest = {
		provider: refusalCase.provider,
		model: refusalCase.model,
		modelVersion: refusalCase.modelVersion,
		role: refusalCase.role,
		prompt: refusalCase.replayEnvelope.prompt,
		contextSources: refusalCase.replayEnvelope.contextSources,
		toolNames: [],
		tools: [],
	};
	let replay: RefusalReplayRecord;
	try {
		const observation = await (
			options.completion ?? ((envelope, _case) => defaultReplayCompletion(envelope, options.resolveModel))
		)(request, refusalCase);
		const normalized = normalizeReplayObservation(observation);
		replay = {
			caseId: refusalCase.id,
			timestamp: options.nowMs?.() ?? Date.now(),
			refused: normalized.refused,
			outcome: normalized.outcome,
			category: normalized.category,
			textExcerpt: normalized.textExcerpt,
			refusalText: normalized.textExcerpt,
			error: null,
		};
	} catch (error) {
		replay = {
			caseId: refusalCase.id,
			timestamp: options.nowMs?.() ?? Date.now(),
			refused: false,
			outcome: "error",
			category: null,
			textExcerpt: null,
			refusalText: null,
			error: error instanceof Error ? cap(redactRefusalText(error.message), REFUSAL_TEXT_MAX) : "Replay failed",
		};
	}
	corpus.recordReplay(refusalCase, replay);
	return replay;
}
