import { Database } from "bun:sqlite";
import { createHash, randomUUID } from "node:crypto";
import * as fs from "node:fs/promises";
import * as path from "node:path";
import { getAgentDir, getAutoQaDbDir } from "@oh-my-pi/pi-utils";
import { Schema } from "effect";
import { DEFAULT_FRICTION_LEDGER_PATH, readFrictions } from "../session/friction-ledger";
import { collectFleetErrors, type FleetErrorRow, parseSince } from "./fleet-cli";

export const TOOL_ISSUE_DISPOSITIONS = [
	"fixed",
	"in-flight",
	"new",
	"stale",
	"duplicate",
	"declined",
] as const;
export type ToolIssueDisposition = (typeof TOOL_ISSUE_DISPOSITIONS)[number];
export type ToolIssueSource = "autoqa" | "friction" | "error-inbox";

const DispositionSchema = Schema.Literals(TOOL_ISSUE_DISPOSITIONS);
const NonEmptyStringSchema = Schema.String.pipe(Schema.check(Schema.isMinLength(1)));
const IsoTimestampSchema = Schema.String.pipe(
	Schema.refine((value): value is string => {
		const parsed = Date.parse(value);
		return Number.isFinite(parsed) && new Date(parsed).toISOString() === value;
	}),
);

export const ToolIssueDispositionEventSchema = Schema.Struct({
	version: Schema.Literal(1),
	eventId: NonEmptyStringSchema,
	ts: IsoTimestampSchema,
	issueKey: NonEmptyStringSchema,
	disposition: DispositionSchema,
	owner: Schema.optional(NonEmptyStringSchema),
	change: Schema.optional(NonEmptyStringSchema),
	proof: Schema.optional(NonEmptyStringSchema),
	reason: Schema.optional(NonEmptyStringSchema),
	canonicalIssueKey: Schema.optional(NonEmptyStringSchema),
	build: Schema.optional(NonEmptyStringSchema),
});

export type ToolIssueDispositionEvent = typeof ToolIssueDispositionEventSchema.Type;

export interface ToolIssueDispositionInput {
	readonly issueKey: string;
	readonly disposition: ToolIssueDisposition;
	readonly owner?: string;
	readonly change?: string;
	readonly proof?: string;
	readonly reason?: string;
	readonly canonicalIssueKey?: string;
	readonly build?: string;
	readonly ts?: string;
}

export interface ToolIssueOccurrence {
	readonly source: ToolIssueSource;
	readonly sourceRef: string;
	readonly timestamp: number;
	readonly signature: string;
	readonly tool: string;
	readonly buildVersion: string;
	readonly buildDigest: string;
	readonly count?: number;
	readonly model?: string;
	readonly session?: string;
	readonly agent?: string;
}

export interface ToolIssueBuildOccurrence {
	readonly fingerprint: string;
	readonly build: string;
	readonly count: number;
	readonly firstSeen: number;
	readonly lastSeen: number;
}

export interface ToolIssueProvenance {
	readonly source: ToolIssueSource;
	readonly ref: string;
	readonly timestamp: number;
	readonly build: string;
	readonly count: number;
	readonly model?: string;
	readonly session?: string;
	readonly agent?: string;
}

export interface ToolIssueProjectionRow {
	readonly issueKey: string;
	readonly signature: string;
	readonly tool: string;
	readonly disposition: ToolIssueDisposition;
	readonly owner?: string;
	readonly change?: string;
	readonly proof?: string;
	readonly reason?: string;
	readonly canonicalIssueKey?: string;
	readonly dispositionAt?: string;
	readonly dispositionBuild?: string;
	readonly count: number;
	readonly firstSeen: number;
	readonly lastSeen: number;
	readonly recurrenceAcrossBuilds: boolean;
	readonly recurrenceAfterDisposition: boolean;
	readonly builds: readonly ToolIssueBuildOccurrence[];
	readonly sources: readonly ToolIssueSource[];
	readonly provenance: readonly ToolIssueProvenance[];
}

export interface ToolIssueProjection {
	readonly generatedAt: string;
	readonly total: number;
	readonly issues: readonly ToolIssueProjectionRow[];
}

export interface ToolIssueProjectionOptions {
	readonly autoQaDbPath?: string;
	readonly frictionLedgerPath?: string;
	readonly dispositionLedgerPath?: string;
	readonly sessionsRoot?: string;
	readonly controlDbPath?: string;
	readonly since?: string;
	readonly session?: string;
	readonly workstream?: string;
	readonly disposition?: ToolIssueDisposition;
	readonly tool?: string;
	readonly limit?: number;
	readonly nowMs?: number;
}

interface AutoQaDbRow {
	readonly id: number;
	readonly model: string;
	readonly version: string;
	readonly tool: string;
	readonly report: string;
	readonly createdAt: string | null;
	readonly sessionId: string | null;
	readonly agentId: string | null;
	readonly buildDigest: string | null;
}

const AutoQaDbRowSchema = Schema.Struct({
	id: Schema.Number,
	model: Schema.String,
	version: Schema.String,
	tool: Schema.String,
	report: Schema.String,
	createdAt: Schema.NullOr(Schema.String),
	sessionId: Schema.NullOr(Schema.String),
	agentId: Schema.NullOr(Schema.String),
	buildDigest: Schema.NullOr(Schema.String),
});

const DEFAULT_DISPOSITION_LEDGER_PATH = path.join(getAgentDir(), "tool-issue-dispositions.jsonl");
const SECRET_ASSIGNMENT =
	/\b(token|api[-_]?key|authorization|password|passwd|cookie|secret)\b\s*[:=]\s*([^\s,;]+)/gi;
const BEARER_SECRET = /\bbearer\s+[^\s,;]+/gi;
const SECRET_PREFIX = /\b(?:sk|ghp|github_pat|xox[baprs])[-_][A-Za-z0-9_-]{8,}\b/g;
const EMAIL = /\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/gi;
const HOME_PATH = /\/Users\/[^/\s]+\//g;
const URL_QUERY = /\b(https?:\/\/[^\s?#]+)\?[^\s#]*/gi;
const UUID = /\b[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}\b/gi;
const LONG_HEX = /\b[0-9a-f]{16,}\b/gi;
const INTEGER = /\b\d+\b/g;

function digest(...parts: readonly string[]): string {
	const hash = createHash("sha256");
	for (const part of parts) hash.update(part).update("\0");
	return hash.digest("hex");
}

export function redactToolIssueText(value: string): string {
	return value
		.replaceAll("\0", " ")
		.replace(SECRET_ASSIGNMENT, (_match, label: string) => `${label}=[REDACTED]`)
		.replace(BEARER_SECRET, "Bearer [REDACTED]")
		.replace(SECRET_PREFIX, "[REDACTED_SECRET]")
		.replace(EMAIL, "[REDACTED_EMAIL]")
		.replace(HOME_PATH, "~/")
		.replace(URL_QUERY, "$1?[REDACTED]")
		.replace(/\s+/g, " ")
		.trim()
		.slice(0, 500);
}

function normalizeSignature(value: string): string {
	return redactToolIssueText(value)
		.toLowerCase()
		.replace(UUID, "<id>")
		.replace(LONG_HEX, "<hex>")
		.replace(INTEGER, "<n>")
		.replace(/\s+/g, " ")
		.trim();
}

function normalizeTool(value: string): string {
	return redactToolIssueText(value).toLowerCase() || "unknown";
}

function normalizeBuild(version: string, buildDigest: string): string {
	const safeVersion = redactToolIssueText(version) || "unknown/legacy";
	const safeDigest = redactToolIssueText(buildDigest) || "unknown/legacy";
	return `${safeVersion}@${safeDigest}`;
}

function decodeAutoQaRows(input: unknown): readonly AutoQaDbRow[] {
	return Schema.decodeUnknownSync(Schema.Array(AutoQaDbRowSchema))(input, {
		onExcessProperty: "error",
	});
}

function columns(db: Database): ReadonlySet<string> {
	const rows = db.prepare("PRAGMA table_info(grievances)").all() as Array<{
		readonly name: string;
	}>;
	return new Set(rows.map((row) => row.name));
}

function nullableColumn(available: ReadonlySet<string>, column: string, alias: string): string {
	return available.has(column) ? `${column} AS ${alias}` : `NULL AS ${alias}`;
}

async function readAutoQaOccurrences(dbPath: string): Promise<readonly ToolIssueOccurrence[]> {
	let db: Database | undefined;
	try {
		db = new Database(dbPath, { readonly: true });
		const available = columns(db);
		if (!["id", "model", "version", "tool", "report"].every((column) => available.has(column)))
			return [];
		const selected = [
			"id",
			"model",
			"version",
			"tool",
			"report",
			nullableColumn(available, "created_at", "createdAt"),
			nullableColumn(available, "session_id", "sessionId"),
			nullableColumn(available, "agent_id", "agentId"),
			nullableColumn(available, "build_digest", "buildDigest"),
		].join(", ");
		const rows = decodeAutoQaRows(
			db.prepare(`SELECT ${selected} FROM grievances ORDER BY id ASC`).all(),
		);
		return rows.map((row) => ({
			source: "autoqa",
			sourceRef: `autoqa:${row.id}`,
			timestamp: row.createdAt === null ? 0 : Date.parse(row.createdAt),
			signature: row.report,
			tool: row.tool,
			buildVersion: row.version,
			buildDigest: row.buildDigest ?? "unknown/legacy",
			model: row.model,
			...(row.sessionId === null ? {} : { session: row.sessionId }),
			...(row.agentId === null ? {} : { agent: row.agentId }),
		}));
	} catch {
		return [];
	} finally {
		db?.close();
	}
}

async function readFrictionOccurrences(
	ledgerPath: string,
): Promise<readonly ToolIssueOccurrence[]> {
	const rows = await readFrictions(undefined, ledgerPath);
	return rows.map((row, index) => ({
		source: "friction",
		sourceRef: `friction:${index + 1}`,
		timestamp: Date.parse(row.ts),
		signature: row.note,
		tool: row.class,
		buildVersion: row.binaryVersion,
		buildDigest: row.binaryDigest,
		model: row.model,
		session: row.sessionId,
		agent: row.agentId,
	}));
}

function errorOccurrence(row: FleetErrorRow): ToolIssueOccurrence {
	return {
		source: "error-inbox",
		sourceRef: `error-inbox:${row.sessionId}:${row.eventId}`,
		timestamp: row.timestamp,
		signature: row.message,
		tool: row.tool,
		buildVersion: row.buildVersion,
		buildDigest: row.buildDigest,
		count: row.count,
		session: row.sessionId,
	};
}

function decodeDispositionLine(
	line: string,
	toleratePartial: boolean,
): ToolIssueDispositionEvent | undefined {
	try {
		return Schema.decodeUnknownSync(ToolIssueDispositionEventSchema)(JSON.parse(line) as unknown, {
			onExcessProperty: "error",
		});
	} catch (error) {
		if (toleratePartial) return undefined;
		throw error;
	}
}

export async function readToolIssueDispositions(
	ledgerPath = DEFAULT_DISPOSITION_LEDGER_PATH,
): Promise<readonly ToolIssueDispositionEvent[]> {
	let raw: string;
	try {
		raw = await fs.readFile(ledgerPath, "utf8");
	} catch (error) {
		if (error instanceof Error && "code" in error && error.code === "ENOENT") return [];
		throw error;
	}
	const lines = raw.split("\n");
	const hasTrailingNewline = raw.endsWith("\n");
	const events: ToolIssueDispositionEvent[] = [];
	for (let index = 0; index < lines.length; index += 1) {
		const line = lines[index]?.trim() ?? "";
		if (line.length === 0) continue;
		const event = decodeDispositionLine(line, index === lines.length - 1 && !hasTrailingNewline);
		if (event) events.push(event);
	}
	return events;
}

function validateDispositionInput(input: ToolIssueDispositionInput): void {
	if (!input.issueKey.trim()) throw new Error("A tool-issue key is required");
	if (input.disposition === "fixed" && (!input.change?.trim() || !input.proof?.trim())) {
		throw new Error("A fixed tool issue requires both change and proof references");
	}
	if (input.disposition === "in-flight" && (!input.owner?.trim() || !input.change?.trim())) {
		throw new Error("An in-flight tool issue requires both owner and change references");
	}
	if (input.disposition === "duplicate" && !input.canonicalIssueKey?.trim()) {
		throw new Error("A duplicate tool issue requires a canonical issue key");
	}
	if (input.disposition === "declined" && !input.reason?.trim()) {
		throw new Error("A declined tool issue requires a reason");
	}
}

function safeMetadata(value: string | undefined): string | undefined {
	if (value === undefined) return undefined;
	const redacted = redactToolIssueText(value).slice(0, 256);
	return redacted || undefined;
}

export async function appendToolIssueDisposition(
	input: ToolIssueDispositionInput,
	ledgerPath = DEFAULT_DISPOSITION_LEDGER_PATH,
): Promise<ToolIssueDispositionEvent> {
	validateDispositionInput(input);
	const event = Schema.decodeUnknownSync(ToolIssueDispositionEventSchema)(
		{
			version: 1,
			eventId: randomUUID(),
			ts: input.ts ?? new Date().toISOString(),
			issueKey: input.issueKey.trim(),
			disposition: input.disposition,
			owner: safeMetadata(input.owner),
			change: safeMetadata(input.change),
			proof: safeMetadata(input.proof),
			reason: safeMetadata(input.reason),
			canonicalIssueKey: safeMetadata(input.canonicalIssueKey),
			build: safeMetadata(input.build),
		},
		{ onExcessProperty: "error" },
	);
	await fs.mkdir(path.dirname(ledgerPath), { recursive: true, mode: 0o700 });
	await fs.appendFile(ledgerPath, `${JSON.stringify(event)}\n`, {
		encoding: "utf8",
		mode: 0o600,
		flag: "a",
	});
	return event;
}

interface MutableDisposition {
	disposition: ToolIssueDisposition;
	owner?: string;
	change?: string;
	proof?: string;
	reason?: string;
	canonicalIssueKey?: string;
	dispositionAt?: string;
	build?: string;
}

function dispositionByIssue(
	events: readonly ToolIssueDispositionEvent[],
): ReadonlyMap<string, MutableDisposition> {
	const ordered = [...events].sort(
		(left, right) => left.ts.localeCompare(right.ts) || left.eventId.localeCompare(right.eventId),
	);
	const states = new Map<string, MutableDisposition>();
	for (const event of ordered) {
		const previous = states.get(event.issueKey);
		states.set(event.issueKey, {
			disposition: event.disposition,
			owner: event.owner ?? previous?.owner,
			change: event.change ?? previous?.change,
			proof: event.proof ?? previous?.proof,
			reason: event.reason ?? previous?.reason,
			canonicalIssueKey: event.canonicalIssueKey ?? previous?.canonicalIssueKey,
			dispositionAt: event.ts,
			build: event.build ?? previous?.build,
		});
	}
	return states;
}

function uniqueOccurrences(
	occurrences: readonly ToolIssueOccurrence[],
): readonly ToolIssueOccurrence[] {
	const byRef = new Map<string, ToolIssueOccurrence>();
	for (const occurrence of occurrences) {
		const ref = `${occurrence.source}\0${occurrence.sourceRef}`;
		const previous = byRef.get(ref);
		if (!previous || occurrence.timestamp >= previous.timestamp) byRef.set(ref, occurrence);
	}
	return [...byRef.values()];
}

interface MutableIssue {
	readonly issueKey: string;
	readonly normalizedSignature: string;
	readonly tool: string;
	displaySignature: string;
	displayTimestamp: number;
	readonly occurrences: ToolIssueOccurrence[];
}

export function projectToolIssues(
	occurrences: readonly ToolIssueOccurrence[],
	dispositions: readonly ToolIssueDispositionEvent[] = [],
): readonly ToolIssueProjectionRow[] {
	const grouped = new Map<string, MutableIssue>();
	for (const occurrence of uniqueOccurrences(occurrences)) {
		const normalizedSignature = normalizeSignature(occurrence.signature) || "unknown";
		const tool = normalizeTool(occurrence.tool);
		const issueKey = digest(normalizedSignature, tool);
		const existing = grouped.get(issueKey);
		if (existing) {
			existing.occurrences.push(occurrence);
			if (occurrence.timestamp >= existing.displayTimestamp) {
				existing.displaySignature = redactToolIssueText(occurrence.signature) || "unknown";
				existing.displayTimestamp = occurrence.timestamp;
			}
		} else {
			grouped.set(issueKey, {
				issueKey,
				normalizedSignature,
				tool,
				displaySignature: redactToolIssueText(occurrence.signature) || "unknown",
				displayTimestamp: occurrence.timestamp,
				occurrences: [occurrence],
			});
		}
	}

	const states = dispositionByIssue(dispositions);
	const issues: ToolIssueProjectionRow[] = [];
	for (const issue of grouped.values()) {
		const builds = new Map<string, ToolIssueBuildOccurrence>();
		const provenance: ToolIssueProvenance[] = [];
		const sources = new Set<ToolIssueSource>();
		let count = 0;
		let firstSeen = Number.POSITIVE_INFINITY;
		let lastSeen = 0;
		for (const occurrence of issue.occurrences) {
			const occurrenceCount = Math.max(1, Math.trunc(occurrence.count ?? 1));
			const build = normalizeBuild(occurrence.buildVersion, occurrence.buildDigest);
			const fingerprint = digest(issue.normalizedSignature, issue.tool, build);
			const previous = builds.get(build);
			builds.set(build, {
				fingerprint,
				build,
				count: (previous?.count ?? 0) + occurrenceCount,
				firstSeen: Math.min(previous?.firstSeen ?? Number.POSITIVE_INFINITY, occurrence.timestamp),
				lastSeen: Math.max(previous?.lastSeen ?? 0, occurrence.timestamp),
			});
			count += occurrenceCount;
			firstSeen = Math.min(firstSeen, occurrence.timestamp);
			lastSeen = Math.max(lastSeen, occurrence.timestamp);
			sources.add(occurrence.source);
			provenance.push({
				source: occurrence.source,
				ref: occurrence.sourceRef,
				timestamp: occurrence.timestamp,
				build,
				count: occurrenceCount,
				...(occurrence.model ? { model: redactToolIssueText(occurrence.model) } : {}),
				...(occurrence.session ? { session: redactToolIssueText(occurrence.session) } : {}),
				...(occurrence.agent ? { agent: redactToolIssueText(occurrence.agent) } : {}),
			});
		}
		const disposition = states.get(issue.issueKey);
		const dispositionTimestamp = disposition?.dispositionAt
			? Date.parse(disposition.dispositionAt)
			: undefined;
		const recurrenceAfterDisposition =
			disposition?.disposition === "fixed" &&
			dispositionTimestamp !== undefined &&
			issue.occurrences.some((occurrence) => {
				const build = normalizeBuild(occurrence.buildVersion, occurrence.buildDigest);
				return (
					occurrence.timestamp > dispositionTimestamp &&
					(disposition.build === undefined || build !== disposition.build)
				);
			});
		issues.push({
			issueKey: issue.issueKey,
			signature: issue.displaySignature,
			tool: issue.tool,
			disposition: disposition?.disposition ?? "new",
			owner: disposition?.owner,
			change: disposition?.change,
			proof: disposition?.proof,
			reason: disposition?.reason,
			canonicalIssueKey: disposition?.canonicalIssueKey,
			dispositionAt: disposition?.dispositionAt,
			dispositionBuild: disposition?.build,
			count,
			firstSeen: Number.isFinite(firstSeen) ? firstSeen : 0,
			lastSeen,
			recurrenceAcrossBuilds: builds.size > 1,
			recurrenceAfterDisposition,
			builds: [...builds.values()].sort(
				(left, right) => right.lastSeen - left.lastSeen || left.build.localeCompare(right.build),
			),
			sources: [...sources].sort(),
			provenance: provenance.sort(
				(left, right) =>
					right.timestamp - left.timestamp ||
					left.source.localeCompare(right.source) ||
					left.ref.localeCompare(right.ref),
			),
		});
	}
	return issues.sort(
		(left, right) =>
			right.count - left.count ||
			right.builds.length - left.builds.length ||
			right.sources.length - left.sources.length ||
			right.lastSeen - left.lastSeen ||
			left.issueKey.localeCompare(right.issueKey),
	);
}

export async function collectToolIssueProjection(
	options: ToolIssueProjectionOptions = {},
): Promise<ToolIssueProjection> {
	const nowMs = options.nowMs ?? Date.now();
	const since = parseSince(options.since, nowMs);
	const [autoQa, friction, fleet, dispositions] = await Promise.all([
		readAutoQaOccurrences(options.autoQaDbPath ?? getAutoQaDbDir()),
		readFrictionOccurrences(options.frictionLedgerPath ?? DEFAULT_FRICTION_LEDGER_PATH),
		collectFleetErrors({
			sessionsRoot: options.sessionsRoot,
			controlDbPath: options.controlDbPath,
			since: options.since,
			session: options.session,
			workstream: options.workstream,
			nowMs,
		}),
		readToolIssueDispositions(options.dispositionLedgerPath ?? DEFAULT_DISPOSITION_LEDGER_PATH),
	]);
	const occurrences = [
		...(options.workstream ? [] : autoQa),
		...(options.workstream ? [] : friction),
		...fleet.errors.map(errorOccurrence),
	].filter(
		(occurrence) =>
			(since === undefined || occurrence.timestamp >= since) &&
			(options.session === undefined || occurrence.session === options.session),
	);
	let issues = projectToolIssues(occurrences, dispositions);
	const tool = options.tool;
	if (tool !== undefined) issues = issues.filter((issue) => issue.tool === normalizeTool(tool));
	const disposition = options.disposition;
	if (disposition !== undefined)
		issues = issues.filter((issue) => issue.disposition === disposition);
	const total = issues.length;
	if (options.limit !== undefined) issues = issues.slice(0, Math.max(0, Math.trunc(options.limit)));
	return { generatedAt: new Date(nowMs).toISOString(), total, issues };
}

function printable(value: string | undefined): string {
	return (value ?? "-").replace(/[\t\r\n]+/g, " ");
}

function displayTimestamp(timestamp: number): string {
	return timestamp > 0 && Number.isFinite(timestamp)
		? new Date(timestamp).toISOString()
		: "unknown/legacy";
}

export function formatToolIssueProjection(projection: ToolIssueProjection): string {
	const lines = [
		"KEY\tDISPOSITION\tCOUNT\tBUILDS\tRECURRENCE\tLAST_SEEN\tTOOL\tSIGNATURE\tOWNER\tCHANGE\tPROOF\tSOURCES",
	];
	for (const issue of projection.issues) {
		lines.push(
			[
				issue.issueKey,
				issue.disposition,
				String(issue.count),
				String(issue.builds.length),
				issue.recurrenceAfterDisposition
					? "after-fixed"
					: issue.recurrenceAcrossBuilds
						? "across-builds"
						: "-",
				displayTimestamp(issue.lastSeen),
				issue.tool,
				issue.signature,
				issue.owner,
				issue.change,
				issue.proof,
				issue.sources.join(","),
			]
				.map(printable)
				.join("\t"),
		);
	}
	return `${lines.join("\n")}\n`;
}
