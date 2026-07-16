import { Schema } from "effect";

export const HANDOFF_PROVENANCE_CUSTOM_TYPE = "handoff_provenance" as const;
export const HANDOFF_PROVENANCE_SCHEMA_VERSION = 1 as const;

const NonEmptyStringSchema = Schema.String.pipe(Schema.check(Schema.isMinLength(1)));
const IsoTimestampSchema = Schema.String.pipe(
	Schema.refine((value): value is string => {
		const parsed = Date.parse(value);
		return Number.isFinite(parsed) && new Date(parsed).toISOString() === value;
	}),
);

/** Durable pointer to the provenance record written by an earlier handoff. */
export const HandoffProvenancePointerSchema = Schema.Struct({
	sessionId: NonEmptyStringSchema,
	journalPath: NonEmptyStringSchema,
	entryId: NonEmptyStringSchema,
});
export type HandoffProvenancePointer = typeof HandoffProvenancePointerSchema.Type;

/** Typed lineage recorded in the successor journal when a handoff is created. */
export const HandoffPredecessorProvenanceRecordSchema = Schema.Struct({
	schemaVersion: Schema.Literal(HANDOFF_PROVENANCE_SCHEMA_VERSION),
	predecessorSessionId: NonEmptyStringSchema,
	predecessorJournalPath: Schema.NullOr(NonEmptyStringSchema),
	predecessorSessionDir: NonEmptyStringSchema,
	binaryVersion: NonEmptyStringSchema,
	timestamp: IsoTimestampSchema,
	cwd: NonEmptyStringSchema,
	predecessorHandoff: Schema.NullOr(HandoffProvenancePointerSchema),
});
export type HandoffPredecessorProvenanceRecord = typeof HandoffPredecessorProvenanceRecordSchema.Type;

export const HandoffProvenanceEntrySchema = Schema.Struct({
	type: Schema.Literal("custom"),
	id: NonEmptyStringSchema,
	parentId: Schema.NullOr(Schema.String),
	timestamp: IsoTimestampSchema,
	customType: Schema.Literal(HANDOFF_PROVENANCE_CUSTOM_TYPE),
	data: HandoffPredecessorProvenanceRecordSchema,
});
export type HandoffProvenanceEntry = typeof HandoffProvenanceEntrySchema.Type;

/** Decode persisted handoff lineage at the session-journal trust boundary. */
export function decodeHandoffProvenanceEntry(value: unknown): HandoffProvenanceEntry | undefined {
	try {
		return Schema.decodeUnknownSync(HandoffProvenanceEntrySchema)(value, { onExcessProperty: "error" });
	} catch {
		return undefined;
	}
}

export function findLatestHandoffProvenanceEntry(entries: readonly unknown[]): HandoffProvenanceEntry | undefined {
	for (let index = entries.length - 1; index >= 0; index--) {
		const decoded = decodeHandoffProvenanceEntry(entries[index]);
		if (decoded) return decoded;
	}
	return undefined;
}

function inlineCode(value: string): string {
	return value.includes("`") ? `\`\` ${value} \`\`` : `\`${value}\``;
}

function renderPredecessorHandoff(pointer: HandoffProvenancePointer | null): string {
	if (!pointer) return "root → this handoff";
	return `${inlineCode(`${pointer.journalPath}#entry=${pointer.entryId}`)} → this handoff`;
}

/** Render the code-generated prefix prepended to every LLM-generated handoff body. */
export function renderHandoffProvenanceBlock(record: HandoffPredecessorProvenanceRecord): string {
	return [
		"## Provenance",
		"",
		`- Predecessor session: ${inlineCode(record.predecessorSessionId)}`,
		`- Predecessor journal: ${inlineCode(record.predecessorJournalPath ?? "<not persisted>")}`,
		`- Predecessor session dir: ${inlineCode(record.predecessorSessionDir)}`,
		`- Predecessor binary: ${inlineCode(record.binaryVersion)}`,
		`- Predecessor handoff chain: ${renderPredecessorHandoff(record.predecessorHandoff)}`,
		`- Written: ${record.timestamp}, cwd ${inlineCode(record.cwd)}, by OMP handoff`,
	].join("\n");
}
