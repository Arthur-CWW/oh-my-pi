import * as fs from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";
import type { AgentTool } from "@oh-my-pi/pi-agent-core";
import { VERSION } from "@oh-my-pi/pi-utils";
import { Schema } from "effect";
import { z } from "zod/v4";
import type { ToolSession } from "../tools";

export const FRICTION_CLASSES = [
	"tool-defect",
	"capability-gap",
	"model-trait",
	"instruction-gap",
	"environment",
] as const;

export type FrictionClass = (typeof FRICTION_CLASSES)[number];

const FrictionClassSchema = Schema.Literals(FRICTION_CLASSES);
const IsoTimestampSchema = Schema.String.pipe(
	Schema.refine((value): value is string => {
		const parsed = Date.parse(value);
		return Number.isFinite(parsed) && new Date(parsed).toISOString() === value;
	}),
);
const FrictionNoteSchema = Schema.String.pipe(Schema.refine((value): value is string => value.length <= 500));

export const FrictionRowSchema = Schema.Struct({
	ts: IsoTimestampSchema,
	sessionId: Schema.String,
	agentId: Schema.String,
	model: Schema.String,
	class: FrictionClassSchema,
	note: FrictionNoteSchema,
	binaryVersion: Schema.String,
	binaryDigest: Schema.String,
});

export type FrictionRow = typeof FrictionRowSchema.Type;

export interface FrictionFilter {
	readonly class?: FrictionClass;
	readonly model?: string;
	readonly sessionId?: string;
	readonly since?: string;
}

export const DEFAULT_FRICTION_LEDGER_PATH = path.join(os.homedir(), ".omp", "agent", "friction.jsonl");

/** Decode one ledger row at the JSONL boundary. */
export function decodeFrictionRow(input: unknown): FrictionRow {
	return Schema.decodeUnknownSync(FrictionRowSchema)(input, { onExcessProperty: "error" });
}

function decodeLine(line: string, toleratePartial: boolean): FrictionRow | undefined {
	try {
		return decodeFrictionRow(JSON.parse(line) as unknown);
	} catch (error) {
		if (toleratePartial) return undefined;
		throw error;
	}
}

/** Append one validated row as a single atomic JSONL write. */
export async function appendFriction(row: FrictionRow, dbPath = DEFAULT_FRICTION_LEDGER_PATH): Promise<void> {
	const decoded = decodeFrictionRow(row);
	await fs.mkdir(path.dirname(dbPath), { recursive: true, mode: 0o700 });
	await fs.appendFile(dbPath, `${JSON.stringify(decoded)}\n`, { encoding: "utf8", mode: 0o600, flag: "a" });
}

/** Read typed rows, ignoring only an incomplete final JSONL line. */
export async function readFrictions(
	filter?: FrictionFilter,
	dbPath = DEFAULT_FRICTION_LEDGER_PATH,
): Promise<FrictionRow[]> {
	let raw: string;
	try {
		raw = await fs.readFile(dbPath, "utf8");
	} catch (error) {
		if (error instanceof Error && "code" in error && error.code === "ENOENT") return [];
		throw error;
	}

	const since = filter?.since === undefined ? undefined : Date.parse(filter.since);
	if (since !== undefined && !Number.isFinite(since)) {
		throw new Error(`Invalid friction filter since timestamp: ${filter?.since}`);
	}

	const lines = raw.split("\n");
	const hasTrailingNewline = raw.endsWith("\n");
	const rows: FrictionRow[] = [];
	for (let index = 0; index < lines.length; index += 1) {
		const line = lines[index]?.trim() ?? "";
		if (line.length === 0) continue;
		const isTrailingPartial = index === lines.length - 1 && !hasTrailingNewline;
		const row = decodeLine(line, isTrailingPartial);
		if (row === undefined) continue;
		if (filter?.class !== undefined && row.class !== filter.class) continue;
		if (filter?.model !== undefined && row.model !== filter.model) continue;
		if (filter?.sessionId !== undefined && row.sessionId !== filter.sessionId) continue;
		if (since !== undefined && Date.parse(row.ts) < since) continue;
		rows.push(row);
	}
	return rows;
}

const ReportFrictionParameters = z.object({
	class: z.enum(FRICTION_CLASSES),
	note: z.string().max(500, "note must be 500 characters or fewer"),
});

type ReportFrictionParameters = z.infer<typeof ReportFrictionParameters>;

function provenanceRevision(session: ToolSession): { readonly version?: string; readonly digest?: string } {
	try {
		return session.sessionManager?.getSessionOwnership()?.buildRevision ?? {};
	} catch {
		return {};
	}
}

function invalidReportResult(message: string) {
	return {
		content: [{ type: "text" as const, text: `Invalid report_friction input: ${message.replace(/\s+/g, " ").trim()}` }],
		isError: true,
	};
}

export function createReportFrictionTool(
	session: ToolSession,
	dbPath = DEFAULT_FRICTION_LEDGER_PATH,
): AgentTool {
	return {
		name: "report_friction",
		label: "Report Friction",
		strict: false,
		approval: "write",
		description:
			"Report crude friction symptoms for shared visibility (tool failed, capability missing, instruction unclear); never analyze.",
		parameters: ReportFrictionParameters,
		intent: "omit",
		async execute(_toolCallId, rawParams) {
			const parsed = ReportFrictionParameters.safeParse(rawParams);
			if (!parsed.success) {
				const issue = parsed.error.issues[0];
				if (issue?.path[0] === "class") {
					return invalidReportResult(`class must be one of: ${FRICTION_CLASSES.join(", ")}`);
				}
				return invalidReportResult(issue?.message ?? "class and note are required");
			}

			const params: ReportFrictionParameters = parsed.data;
			const revision = provenanceRevision(session);
			const row: FrictionRow = {
				ts: new Date().toISOString(),
				sessionId: session.getSessionId?.() ?? "unknown",
				agentId: session.getAgentId?.() ?? "unknown",
				model: session.getActiveModelString?.() ?? session.getModelString?.() ?? "unknown",
				class: params.class,
				note: params.note,
				binaryVersion: session.buildVersion ?? revision.version ?? VERSION,
				binaryDigest: session.buildDigest ?? revision.digest ?? "unknown",
			};

			try {
				await appendFriction(row, dbPath);
			} catch (error) {
				return {
					content: [
						{
							type: "text" as const,
							text: `Unable to record friction: ${(error instanceof Error ? error.message : String(error)).replace(/\s+/g, " ").trim()}`,
						},
					],
					isError: true,
				};
			}

			return { content: [{ type: "text" as const, text: "Friction noted." }] };
		},
	};
}
