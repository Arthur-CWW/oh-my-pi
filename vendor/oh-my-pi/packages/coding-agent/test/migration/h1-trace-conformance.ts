import { Schema } from "effect";
import { h1CheckTrace, type H1Event, type H1Violation } from "./model/h1-model";

const MAX_VIOLATIONS = 64;

const MessageContentSchema = Schema.Array(
	Schema.Struct({
		type: Schema.String,
		name: Schema.optional(Schema.String),
		toolCallId: Schema.optional(Schema.String),
		toolName: Schema.optional(Schema.String),
	}),
);

const MessageDetailsSchema = Schema.Struct({
	status: Schema.optional(Schema.String),
	error: Schema.optional(Schema.String),
});

const MessageSchema = Schema.Struct({
	role: Schema.String,
	stopReason: Schema.optional(Schema.String),
	toolCallId: Schema.optional(Schema.String),
	toolName: Schema.optional(Schema.String),
	content: Schema.optional(MessageContentSchema),
	details: Schema.optional(MessageDetailsSchema),
});

const SubagentSchema = Schema.Struct({
	agentId: Schema.optional(Schema.String),
});

const DataSchema = Schema.Struct({
	state: Schema.optional(Schema.String),
	agentId: Schema.optional(Schema.String),
	kind: Schema.optional(Schema.String),
	fromState: Schema.optional(Schema.String),
	toState: Schema.optional(Schema.String),
	cause: Schema.optional(Schema.String),
	reason: Schema.optional(Schema.String),
	status: Schema.optional(Schema.String),
});

const JournalRecordSchema = Schema.Struct({
	type: Schema.String,
	id: Schema.optional(Schema.String),
	childId: Schema.optional(Schema.String),
	agentId: Schema.optional(Schema.String),
	seq: Schema.optional(Schema.Number),
	at: Schema.optional(Schema.Number),
	timestamp: Schema.optional(Schema.String),
	message: Schema.optional(MessageSchema),
	customType: Schema.optional(Schema.String),
	data: Schema.optional(DataSchema),
	subagent: Schema.optional(SubagentSchema),
});

type JournalRecord = Schema.Schema.Type<typeof JournalRecordSchema>;

interface DecodedRecord {
	readonly line: number;
	readonly record: JournalRecord;
}

export interface H1ConformanceReport {
	readonly violations: readonly H1Violation[];
	readonly skippedRecords: number;
	readonly eventCounts: Readonly<Record<string, number>>;
}

function isFiniteNumber(value: number | undefined): value is number {
	return value !== undefined && Number.isFinite(value);
}

function eventAt(record: JournalRecord, line: number): number {
	if (isFiniteNumber(record.at)) return record.at;
	if (record.timestamp !== undefined) {
		const parsed = Date.parse(record.timestamp);
		if (Number.isFinite(parsed)) return parsed;
	}
	return line;
}

function eventSeq(record: JournalRecord, line: number): number {
	return isFiniteNumber(record.seq) && record.seq >= 0 ? Math.trunc(record.seq) : line;
}

function childIdFor(record: JournalRecord): string | undefined {
	return (
		record.childId ??
		record.agentId ??
		record.subagent?.agentId ??
		record.data?.agentId
	);
}

function isYieldToolCall(record: JournalRecord): boolean {
	const message = record.message;
	if (!message) return false;
	if (message.role === "toolResult") return message.toolName === "yield";
	if (message.role !== "assistant" || !message.content) return false;
	return message.content.some(content => content.type === "toolCall" && content.name === "yield");
}

function yieldCallId(record: JournalRecord): string | undefined {
	const message = record.message;
	if (!message) return undefined;
	if (message.role === "toolResult" && message.toolName === "yield") return message.toolCallId;
	if (message.role === "assistant" && message.content) {
		return message.content.find(content => content.type === "toolCall" && content.name === "yield")?.toolCallId;
	}
	return undefined;
}

function eventKindFor(record: JournalRecord): string | undefined {
	if (record.type === "session") return "admitted";
	if (record.type === "session_init") return "started";

	if (record.type === "message" && record.message) {
		if (isYieldToolCall(record)) return "yieldWritten";
		if (record.message.role === "assistant") {
			if (record.message.stopReason === "aborted") return "interrupted";
			if (record.message.stopReason === "error" || record.message.stopReason === "errored") return "crashed";
		}
		return "progress";
	}

	if (record.type !== "custom") return undefined;
	if (record.customType === "child_lifecycle") {
		switch (record.data?.state) {
			case "running":
				return "started";
			case "parked":
				return "parked";
			case "interrupted":
				return "interrupted";
			case "failed":
				return "crashed";
			case "completed":
				return "delivered";
			default:
				return undefined;
		}
	}
	if (record.customType === "omp:agent-timeline:v1") {
		if (record.data?.kind === "park") return "parked";
		if (record.data?.kind === "revive") return "revived";
		return undefined;
	}
	if (record.customType === "h1:delivered" || record.customType === "child_delivered") return "delivered";
	if (record.customType === "h1:timeout") return "timeoutFired";
	if (record.customType === "h1:interrupt-request") return "interruptRequested";
	if (record.customType === "h1:interrupt-done") return "interruptDone";
	if (record.customType === "h1:reaped") return "reaped";
	return undefined;
}

function terminalCause(record: JournalRecord): string | undefined {
	if (record.data?.cause) return record.data.cause;
	if (record.data?.reason) return record.data.reason;
	if (record.message?.details?.error) return record.message.details.error;
	if (record.message?.stopReason) return record.message.stopReason;
	return undefined;
}

function decodeRecords(jsonlText: string): { records: DecodedRecord[]; skippedRecords: number } {
	const records: DecodedRecord[] = [];
	let skippedRecords = 0;
	const lines = jsonlText.split("\n");
	for (let index = 0; index < lines.length; index += 1) {
		const line = lines[index];
		if (line === undefined || line.trim().length === 0) continue;
		try {
			const decoded = Schema.decodeUnknownSync(JournalRecordSchema)(JSON.parse(line));
			records.push({ line: index + 1, record: decoded });
		} catch {
			skippedRecords += 1;
		}
	}
	return { records, skippedRecords };
}

function mapRecords(jsonlText: string): { events: H1Event[]; skippedRecords: number } {
	const decoded = decodeRecords(jsonlText);
	const childId = decoded.records.map(item => childIdFor(item.record)).find(value => value !== undefined) ?? "journal-child";
	const yieldResultIds = new Set(
		decoded.records
			.map(item => item.record)
			.filter(record => record.type === "message" && record.message?.role === "toolResult" && record.message.toolName === "yield")
			.map(record => yieldCallId(record))
			.filter((value): value is string => value !== undefined),
	);
	const events: H1Event[] = [];
	let skippedRecords = decoded.skippedRecords;
	let fallbackSeq = 0;
	for (const item of decoded.records) {
		const kind = eventKindFor(item.record);
		if (kind === undefined) {
			skippedRecords += 1;
			continue;
		}
		if (kind === "yieldWritten" && item.record.message?.role === "assistant") {
			const callId = yieldCallId(item.record);
			if (callId !== undefined && yieldResultIds.has(callId)) continue;
		}
		const candidateSeq = eventSeq(item.record, item.line);
		const seq = candidateSeq > fallbackSeq ? candidateSeq : fallbackSeq + 1;
		fallbackSeq = seq;
		events.push({
			kind,
			childId,
			seq: seq > 0 ? seq : (fallbackSeq += 1),
			at: eventAt(item.record, item.line),
			...(terminalCause(item.record) === undefined ? {} : { cause: terminalCause(item.record) }),
		});
	}
	return { events, skippedRecords };
}

/** Map one child session journal into the frozen H1 event vocabulary. */
export function journalToH1Events(jsonlText: string): H1Event[] {
	return mapRecords(jsonlText).events;
}

/** Check a child journal and return bounded violations plus mapping coverage. */
export function checkH1Journal(jsonlText: string): H1ConformanceReport {
	const mapped = mapRecords(jsonlText);
	const checked = h1CheckTrace(mapped.events);
	const eventCounts: Record<string, number> = {};
	for (const event of mapped.events) eventCounts[event.kind] = (eventCounts[event.kind] ?? 0) + 1;
	return {
		violations: checked.slice(0, MAX_VIOLATIONS),
		skippedRecords: mapped.skippedRecords,
		eventCounts,
	};
}

export function formatH1ConformanceReport(report: H1ConformanceReport): string {
	return JSON.stringify({
		violations: report.violations,
		skippedRecords: report.skippedRecords,
		eventCounts: report.eventCounts,
	});
}
