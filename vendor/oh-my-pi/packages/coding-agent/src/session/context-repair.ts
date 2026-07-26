import * as fs from "node:fs/promises";
import { Schema } from "effect";

export const CONTEXT_REPAIR_SCHEMA_VERSION = 1 as const;
export const CONTEXT_REPAIR_OVERLAY_CUSTOM_TYPE = "context_repair_overlay";
export const CONTEXT_REPAIR_CONTROL_CUSTOM_TYPE = "context_repair_control";
export const CONTEXT_REPAIR_REDACTION = "[redacted]";
export const CONTEXT_REPAIR_SUMMARY_PREFIX = "[Context repair summary] ";

const STRICT_DECODE_OPTIONS = { onExcessProperty: "error" } as const;
const RECORD_KINDS = ["system", "user", "assistant", "tool-call", "tool-result", "irc", "error"] as const;
const PROTECTIONS = ["system", "user-intent", "owner", "policy", "auth"] as const;
const CONTROL_ACTIONS = ["disable", "enable", "revert"] as const;

export type ContextRepairRecordKind = (typeof RECORD_KINDS)[number];
export type ContextRepairProtection = (typeof PROTECTIONS)[number];
export type ContextRepairControlAction = (typeof CONTROL_ACTIONS)[number];

export interface ContextRepairMetadataField {
	readonly key: string;
	readonly value: string;
	readonly discloseToPlanner: boolean;
}

/** A bounded, already-decoded context event. The original record is never mutated. */
export interface ContextRepairRecord {
	readonly id: string;
	readonly kind: ContextRepairRecordKind;
	readonly content: string;
	/** Explicitly allowed planner view. null means content is withheld. */
	readonly plannerContent: string | null;
	readonly metadata: readonly ContextRepairMetadataField[];
	readonly protections: readonly ContextRepairProtection[];
	readonly toolCallId: string | null;
	readonly dependsOn: readonly string[];
	readonly tokenCount: number;
}

export interface RefusalCheckpoint {
	readonly id: string;
	readonly sourceDigest: string;
	readonly refusalRecordId: string;
}

export interface ContextRepairPlannerRoute {
	readonly coreRoutingSmol: string;
	readonly safePlanner?: string;
}

export interface ContextRepairPlannerRequestRecord {
	readonly id: string;
	readonly kind: ContextRepairRecordKind;
	readonly content: string | null;
	readonly metadata: readonly ContextRepairMetadataField[];
	readonly protections: readonly ContextRepairProtection[];
	readonly toolCallId: string | null;
	readonly dependsOn: readonly string[];
	readonly tokenCount: number;
}

export interface ContextRepairPlannerRequest {
	readonly schemaVersion: 1;
	readonly refusalCheckpointId: string;
	readonly sourceDigest: string;
	readonly sourceRecordIds: readonly string[];
	readonly records: readonly ContextRepairPlannerRequestRecord[];
}

export interface ContextRepairRedaction {
	readonly start: number;
	readonly end: number;
	readonly replacement: typeof CONTEXT_REPAIR_REDACTION;
}

export interface ContextRepairOmitAction {
	readonly operation: "omit";
	readonly recordId: string;
	readonly summary: string | null;
	readonly rationale: string;
}

export interface ContextRepairRedactAction {
	readonly operation: "redact";
	readonly recordId: string;
	readonly redactions: readonly ContextRepairRedaction[];
	readonly rationale: string;
}

export interface ContextRepairReplaceAction {
	readonly operation: "replace";
	readonly recordId: string;
	readonly summary: string;
	readonly rationale: string;
}

export type ContextRepairAction = ContextRepairOmitAction | ContextRepairRedactAction | ContextRepairReplaceAction;

export interface ContextRepairPlannerProposal {
	readonly schemaVersion: 1;
	readonly refusalCheckpointId: string;
	readonly sourceDigest: string;
	readonly sourceRecordIds: readonly string[];
	readonly actions: readonly ContextRepairAction[];
	readonly rationale: string;
	readonly confidence: number;
	readonly escalationRequired: boolean;
}

export interface ContextRepairOverlayEvent extends ContextRepairPlannerProposal {
	readonly kind: typeof CONTEXT_REPAIR_OVERLAY_CUSTOM_TYPE;
	readonly id: string;
	readonly createdAt: string;
	readonly plannerModel: string;
}

export interface ContextRepairControlEvent {
	readonly schemaVersion: 1;
	readonly kind: typeof CONTEXT_REPAIR_CONTROL_CUSTOM_TYPE;
	readonly id: string;
	readonly overlayId: string;
	readonly action: ContextRepairControlAction;
	readonly createdAt: string;
	readonly reason: string;
}

export type ContextRepairLedgerEvent = ContextRepairOverlayEvent | ContextRepairControlEvent;

export interface ContextRepairDependencyGraph {
	readonly dependencies: ReadonlyMap<string, ReadonlySet<string>>;
	readonly dependents: ReadonlyMap<string, ReadonlySet<string>>;
	readonly missingDependencies: readonly { readonly recordId: string; readonly dependencyId: string }[];
}

export interface ContextRepairValidationOptions {
	readonly maxTokenReductionRatio?: number;
	readonly maxProjectedTokens?: number;
	readonly minimumConfidence?: number;
}

export interface ContextRepairPlanner {
	(input: { readonly model: string; readonly request: ContextRepairPlannerRequest }): Promise<unknown>;
}

export interface CreateContextRepairOverlayOptions extends ContextRepairValidationOptions {
	readonly checkpoint: RefusalCheckpoint;
	readonly records: readonly ContextRepairRecord[];
	readonly route: ContextRepairPlannerRoute;
	readonly planner: ContextRepairPlanner;
	readonly existingEvents?: readonly ContextRepairLedgerEvent[];
	readonly appendEvent: (event: ContextRepairOverlayEvent) => void | Promise<void>;
	readonly mintId?: () => string;
	readonly now?: () => string;
}

export type CreateContextRepairOverlayResult =
	| { readonly status: "appended"; readonly overlay: ContextRepairOverlayEvent }
	| {
			readonly status: "requires-review";
			readonly proposal: ContextRepairPlannerProposal;
			readonly reasons: readonly string[];
	  };

export interface ProjectedContextRepairRecord extends ContextRepairRecord {
	readonly sourceRecordId: string;
	readonly projection: "unchanged" | "redacted" | "summary";
}

export interface ContextRepairOverlayState {
	readonly overlay: ContextRepairOverlayEvent;
	readonly enabled: boolean;
	readonly reverted: boolean;
	readonly lastControl: ContextRepairControlEvent | null;
}

export class ContextRepairValidationError extends Error {
	readonly issues: readonly string[];

	constructor(issues: readonly string[]) {
		super(`Context repair rejected: ${issues.join("; ")}`);
		this.name = "ContextRepairValidationError";
		this.issues = [...issues];
	}
}

const MetadataFieldSchema = Schema.Struct({
	key: Schema.String,
	value: Schema.String,
	discloseToPlanner: Schema.Boolean,
});
const RedactionSchema = Schema.Struct({
	start: Schema.Int,
	end: Schema.Int,
	replacement: Schema.Literal(CONTEXT_REPAIR_REDACTION),
});
const OmitActionSchema = Schema.Struct({
	operation: Schema.Literal("omit"),
	recordId: Schema.String,
	summary: Schema.NullOr(Schema.String),
	rationale: Schema.String,
});
const RedactActionSchema = Schema.Struct({
	operation: Schema.Literal("redact"),
	recordId: Schema.String,
	redactions: Schema.Array(RedactionSchema),
	rationale: Schema.String,
});
const ReplaceActionSchema = Schema.Struct({
	operation: Schema.Literal("replace"),
	recordId: Schema.String,
	summary: Schema.String,
	rationale: Schema.String,
});
export const ContextRepairActionSchema = Schema.Union([OmitActionSchema, RedactActionSchema, ReplaceActionSchema]);
export const ContextRepairPlannerProposalSchema = Schema.Struct({
	schemaVersion: Schema.Literal(CONTEXT_REPAIR_SCHEMA_VERSION),
	refusalCheckpointId: Schema.String,
	sourceDigest: Schema.String,
	sourceRecordIds: Schema.Array(Schema.String),
	actions: Schema.Array(ContextRepairActionSchema),
	rationale: Schema.String,
	confidence: Schema.Number,
	escalationRequired: Schema.Boolean,
});
export const ContextRepairOverlayEventSchema = Schema.Struct({
	kind: Schema.Literal(CONTEXT_REPAIR_OVERLAY_CUSTOM_TYPE),
	id: Schema.String,
	createdAt: Schema.String,
	plannerModel: Schema.String,
	...ContextRepairPlannerProposalSchema.fields,
});
export const ContextRepairControlEventSchema = Schema.Struct({
	schemaVersion: Schema.Literal(CONTEXT_REPAIR_SCHEMA_VERSION),
	kind: Schema.Literal(CONTEXT_REPAIR_CONTROL_CUSTOM_TYPE),
	id: Schema.String,
	overlayId: Schema.String,
	action: Schema.Literals(CONTROL_ACTIONS),
	createdAt: Schema.String,
	reason: Schema.String,
});
export const ContextRepairLedgerEventSchema = Schema.Union([
	ContextRepairOverlayEventSchema,
	ContextRepairControlEventSchema,
]);


export function decodeContextRepairPlannerProposal(input: unknown): ContextRepairPlannerProposal {
	return Schema.decodeUnknownSync(ContextRepairPlannerProposalSchema)(input, STRICT_DECODE_OPTIONS);
}

export function decodeContextRepairOverlayEvent(input: unknown): ContextRepairOverlayEvent {
	return Schema.decodeUnknownSync(ContextRepairOverlayEventSchema)(input, STRICT_DECODE_OPTIONS);
}

export function decodeContextRepairLedgerEvent(input: unknown): ContextRepairLedgerEvent {
	return Schema.decodeUnknownSync(ContextRepairLedgerEventSchema)(input, STRICT_DECODE_OPTIONS);
}

function canonicalRecord(record: ContextRepairRecord): string {
	const metadata = [...record.metadata]
		.sort((left, right) => left.key.localeCompare(right.key) || left.value.localeCompare(right.value))
		.map(field => [field.key, field.value, field.discloseToPlanner] as const);
	return JSON.stringify([
		record.id,
		record.kind,
		record.content,
		record.plannerContent,
		metadata,
		[...record.protections].sort(),
		record.toolCallId,
		[...record.dependsOn].sort(),
		record.tokenCount,
	]);
}

/** Digest the exact immutable bounded source that an overlay may project. */
export function digestContextRepairSource(records: readonly ContextRepairRecord[]): string {
	const hasher = new Bun.CryptoHasher("sha256");
	for (const record of records) {
		const encoded = canonicalRecord(record);
		hasher.update(`${encoded.length}:`);
		hasher.update(encoded);
	}
	return hasher.digest("hex");
}

function sanitizePlannerText(text: string): string {
	return text
		.replace(/\bBearer\s+[A-Za-z0-9._~+/=-]+/gi, "Bearer [redacted]")
		.replace(/\b(api[_ -]?key|password|secret|access[_ -]?token)\s*[:=]\s*[^\s,;]+/gi, "$1=[redacted]")
		.replace(/\b(?:sk|ghp|github_pat)_[A-Za-z0-9_-]{8,}\b/g, "[redacted]");
}

export function buildContextRepairPlannerRequest(
	checkpoint: RefusalCheckpoint,
	records: readonly ContextRepairRecord[],
): ContextRepairPlannerRequest {
	const digest = digestContextRepairSource(records);
	if (checkpoint.sourceDigest !== digest) {
		throw new ContextRepairValidationError(["refusal checkpoint source digest is stale"]);
	}
	return {
		schemaVersion: CONTEXT_REPAIR_SCHEMA_VERSION,
		refusalCheckpointId: checkpoint.id,
		sourceDigest: digest,
		sourceRecordIds: records.map(record => record.id),
		records: records.map(record => ({
			id: record.id,
			kind: record.kind,
			content: record.plannerContent === null ? null : sanitizePlannerText(record.plannerContent),
			metadata: record.metadata
				.filter(field => field.discloseToPlanner)
				.map(field => ({ ...field, value: sanitizePlannerText(field.value) })),
			protections: record.protections,
			toolCallId: record.toolCallId,
			dependsOn: record.dependsOn,
			tokenCount: record.tokenCount,
		})),
	};
}

export function buildContextRepairDependencyGraph(
	records: readonly ContextRepairRecord[],
): ContextRepairDependencyGraph {
	const ids = new Set(records.map(record => record.id));
	const callByToolId = new Map<string, string>();
	for (const record of records) {
		if (record.kind === "tool-call" && record.toolCallId) callByToolId.set(record.toolCallId, record.id);
	}
	const mutableDependencies = new Map<string, Set<string>>();
	const mutableDependents = new Map<string, Set<string>>();
	const missingDependencies: Array<{ recordId: string; dependencyId: string }> = [];
	for (const record of records) {
		const dependencies = new Set(record.dependsOn);
		if (record.kind === "tool-result" && record.toolCallId) {
			const callId = callByToolId.get(record.toolCallId);
			if (callId) dependencies.add(callId);
			else missingDependencies.push({ recordId: record.id, dependencyId: `tool-call:${record.toolCallId}` });
		}
		mutableDependencies.set(record.id, dependencies);
		for (const dependencyId of dependencies) {
			if (!ids.has(dependencyId)) {
				missingDependencies.push({ recordId: record.id, dependencyId });
				continue;
			}
			const dependents = mutableDependents.get(dependencyId) ?? new Set<string>();
			dependents.add(record.id);
			mutableDependents.set(dependencyId, dependents);
		}
	}
	return {
		dependencies: mutableDependencies,
		dependents: mutableDependents,
		missingDependencies,
	};
}

function estimateTokens(content: string): number {
	return content.length === 0 ? 0 : Math.max(1, Math.ceil(content.length / 4));
}

const INJECTION_PATTERNS = [
	/ignore\s+(?:all\s+)?(?:previous|prior)\s+instructions/i,
	/(?:^|\n)\s*(?:system|developer|assistant|tool)\s*:/i,
	/<\/?(?:system|developer|assistant|tool|system-directive)\b/i,
	/```/,
	/\b(?:execute|invoke|call)\s+(?:the\s+)?(?:tool|command)\b/i,
	/\b(?:must|shall)\s+(?:now\s+)?(?:follow|obey|execute|invoke|ignore)\b/i,
] as const;

function validateNeutralSummary(summary: string, label: string, issues: string[]): void {
	if (summary.trim() !== summary || summary.length === 0 || summary.length > 500 || summary.includes("\n")) {
		issues.push(`${label} must be a non-empty single-line summary of at most 500 characters`);
		return;
	}
	if (INJECTION_PATTERNS.some(pattern => pattern.test(summary))) {
		issues.push(`${label} contains instruction-like content`);
	}
}

function validateBasicRecords(records: readonly ContextRepairRecord[], issues: string[]): void {
	const ids = new Set<string>();
	for (const record of records) {
		if (!record.id || ids.has(record.id)) issues.push(`source record ID is empty or duplicated: ${record.id}`);
		ids.add(record.id);
		if (!Number.isSafeInteger(record.tokenCount) || record.tokenCount < 0) {
			issues.push(`record ${record.id} has invalid token count`);
		}
		const metadataKeys = new Set<string>();
		for (const field of record.metadata) {
			if (!field.key || metadataKeys.has(field.key)) issues.push(`record ${record.id} has duplicate/empty metadata key`);
			metadataKeys.add(field.key);
		}
	}
}


export function validateContextRepairOverlay(
	overlay: ContextRepairPlannerProposal,
	checkpoint: RefusalCheckpoint,
	records: readonly ContextRepairRecord[],
	options: ContextRepairValidationOptions = {},
): void {
	const issues: string[] = [];
	validateBasicRecords(records, issues);
	const digest = digestContextRepairSource(records);
	if (checkpoint.sourceDigest !== digest) issues.push("refusal checkpoint source digest is stale");
	if (overlay.sourceDigest !== digest) issues.push("overlay source digest does not match immutable source");
	if (overlay.refusalCheckpointId !== checkpoint.id) issues.push("overlay refusal checkpoint ID does not match");
	const sourceIds = records.map(record => record.id);
	if (overlay.sourceRecordIds.length !== sourceIds.length || overlay.sourceRecordIds.some((id, index) => id !== sourceIds[index])) {
		issues.push("overlay source record IDs/range do not exactly match the bounded source");
	}
	if (!Number.isFinite(overlay.confidence) || overlay.confidence < 0 || overlay.confidence > 1) {
		issues.push("overlay confidence must be between 0 and 1");
	}
	if (overlay.actions.length === 0) issues.push("overlay must contain at least one repair action");

	const recordById = new Map(records.map(record => [record.id, record] as const));
	const actionById = new Map<string, ContextRepairAction>();
	for (const action of overlay.actions) {
		const record = recordById.get(action.recordId);
		if (!record) {
			issues.push(`action targets unknown record ${action.recordId}`);
			continue;
		}
		if (actionById.has(action.recordId)) issues.push(`record ${action.recordId} has multiple actions`);
		actionById.set(action.recordId, action);
		if (action.rationale.trim().length === 0 || action.rationale.length > 500) {
			issues.push(`action ${action.recordId} has invalid rationale`);
		}
		if (action.operation === "redact") {
			if (action.redactions.length === 0) issues.push(`record ${record.id} has an empty redaction list`);
			let previousEnd = -1;
			for (const redaction of [...action.redactions].sort((left, right) => left.start - right.start)) {
				if (redaction.start < 0 || redaction.end <= redaction.start || redaction.end > record.content.length) {
					issues.push(`record ${record.id} has an out-of-range redaction`);
				}
				if (redaction.start < previousEnd) issues.push(`record ${record.id} has overlapping redactions`);
				previousEnd = redaction.end;
			}
			continue;
		}
		const isAuthorityRecord = record.protections.some(protection =>
			protection === "owner" || protection === "policy" || protection === "auth",
		);
		if (isAuthorityRecord) issues.push(`protected owner/policy/auth record ${record.id} cannot be removed or replaced`);
		const requiresSummary =
			record.kind === "system" || record.kind === "user" || record.protections.includes("user-intent");
		const summary = action.operation === "replace" ? action.summary : action.summary;
		if (requiresSummary && summary === null) issues.push(`system/user intent record ${record.id} requires a summary`);
		if (summary !== null) validateNeutralSummary(summary, `record ${record.id} summary`, issues);
	}

	const graph = buildContextRepairDependencyGraph(records);
	for (const missing of graph.missingDependencies) {
		issues.push(`record ${missing.recordId} has missing dependency ${missing.dependencyId}`);
	}
	for (const record of records) {
		if (record.kind !== "tool-call") continue;
		const callAction = actionById.get(record.id);
		if (callAction?.operation !== "omit" && callAction?.operation !== "replace") continue;
		for (const dependentId of graph.dependents.get(record.id) ?? []) {
			const dependent = recordById.get(dependentId);
			if (dependent?.kind !== "tool-result") continue;
			const dependentAction = actionById.get(dependentId);
			if (dependentAction?.operation !== "omit" && dependentAction?.operation !== "replace") {
				issues.push(`tool call ${record.id} removal must close result ${dependentId}`);
			}
		}
	}
	for (const record of records) {
		if (record.kind !== "tool-result") continue;
		const resultAction = actionById.get(record.id);
		if (resultAction?.operation !== "omit" && resultAction?.operation !== "replace") continue;
		for (const dependencyId of graph.dependencies.get(record.id) ?? []) {
			const dependency = recordById.get(dependencyId);
			if (dependency?.kind !== "tool-call") continue;
			const callAction = actionById.get(dependencyId);
			if (callAction?.operation !== "omit" && callAction?.operation !== "replace") {
				issues.push(`tool result ${record.id} removal must close call ${dependencyId}`);
			}
		}
	}

	const maxReduction = options.maxTokenReductionRatio ?? 0.5;
	if (!Number.isFinite(maxReduction) || maxReduction < 0 || maxReduction > 1) {
		issues.push("max token reduction ratio must be between 0 and 1");
	} else {
		const before = records.reduce((total, record) => total + record.tokenCount, 0);
		let after = before;
		for (const action of overlay.actions) {
			const record = recordById.get(action.recordId);
			if (!record) continue;
			if (action.operation === "redact") {
				let content = record.content;
				for (const redaction of [...action.redactions].sort((left, right) => right.start - left.start)) {
					content = `${content.slice(0, redaction.start)}${CONTEXT_REPAIR_REDACTION}${content.slice(redaction.end)}`;
				}
				after += estimateTokens(content) - record.tokenCount;
			} else {
				const summaryTokens = action.summary === null ? 0 : estimateTokens(CONTEXT_REPAIR_SUMMARY_PREFIX + action.summary);
				after += summaryTokens - record.tokenCount;
			}
		}
		if (before > 0 && (before - after) / before > maxReduction) {
			issues.push(`overlay exceeds maximum token reduction ratio ${maxReduction}`);
		}
		const maxProjectedTokens = options.maxProjectedTokens ?? before;
		if (!Number.isSafeInteger(maxProjectedTokens) || maxProjectedTokens < 0 || after > maxProjectedTokens) {
			issues.push(`projected retry context exceeds token bound ${maxProjectedTokens}`);
		}
	}
	if (issues.length > 0) throw new ContextRepairValidationError(issues);
}

export function resolveContextRepairPlannerModel(route: ContextRepairPlannerRoute): string {
	const model = route.safePlanner?.trim() || route.coreRoutingSmol.trim();
	if (!model) throw new ContextRepairValidationError(["a safe planner or core.routing.smol route is required"]);
	if (/(?:^|[\/-])fable(?:$|[\/-])/i.test(model)) {
		throw new ContextRepairValidationError(["Fable cannot be used as the context repair planner"]);
	}
	return model;
}

export function contextRepairOverlayStates(events: readonly ContextRepairLedgerEvent[]): ContextRepairOverlayState[] {
	const states = new Map<string, ContextRepairOverlayState>();
	const overlayByCheckpoint = new Map<string, string>();
	for (const event of events) {
		if (event.kind === CONTEXT_REPAIR_OVERLAY_CUSTOM_TYPE) {
			if (states.has(event.id)) throw new ContextRepairValidationError([`duplicate overlay ID ${event.id}`]);
			const priorOverlayId = overlayByCheckpoint.get(event.refusalCheckpointId);
			if (priorOverlayId) {
				throw new ContextRepairValidationError([
					`refusal checkpoint ${event.refusalCheckpointId} has multiple overlays (${priorOverlayId}, ${event.id})`,
				]);
			}
			overlayByCheckpoint.set(event.refusalCheckpointId, event.id);
			states.set(event.id, { overlay: event, enabled: true, reverted: false, lastControl: null });
			continue;
		}
		const current = states.get(event.overlayId);
		if (!current) throw new ContextRepairValidationError([`control targets unknown overlay ${event.overlayId}`]);
		if (current.reverted && event.action !== "revert") {
			throw new ContextRepairValidationError([`reverted overlay ${event.overlayId} cannot be re-enabled or disabled`]);
		}
		states.set(event.overlayId, {
			...current,
			enabled: event.action === "enable",
			reverted: current.reverted || event.action === "revert",
			lastControl: event,
		});
	}
	return [...states.values()];
}

export async function createContextRepairOverlay(
	options: CreateContextRepairOverlayOptions,
): Promise<CreateContextRepairOverlayResult> {
	const sameCheckpoint = (options.existingEvents ?? []).filter(
		event => event.kind === CONTEXT_REPAIR_OVERLAY_CUSTOM_TYPE && event.refusalCheckpointId === options.checkpoint.id,
	);
	if (sameCheckpoint.length > 0) {
		throw new ContextRepairValidationError([`refusal checkpoint ${options.checkpoint.id} already has an overlay`]);
	}
	const request = buildContextRepairPlannerRequest(options.checkpoint, options.records);
	const plannerModel = resolveContextRepairPlannerModel(options.route);
	let proposal: ContextRepairPlannerProposal;
	try {
		proposal = decodeContextRepairPlannerProposal(await options.planner({ model: plannerModel, request }));
	} catch {
		throw new ContextRepairValidationError(["planner output does not match the strict context repair schema"]);
	}
	validateContextRepairOverlay(proposal, options.checkpoint, options.records, options);
	const minimumConfidence = options.minimumConfidence ?? 0.8;
	const reviewReasons: string[] = [];
	if (proposal.escalationRequired) reviewReasons.push("planner requested escalation");
	if (proposal.confidence < minimumConfidence) reviewReasons.push(`confidence ${proposal.confidence} is below ${minimumConfidence}`);
	if (reviewReasons.length > 0) return { status: "requires-review", proposal, reasons: reviewReasons };
	const overlay: ContextRepairOverlayEvent = {
		...proposal,
		kind: CONTEXT_REPAIR_OVERLAY_CUSTOM_TYPE,
		id: options.mintId?.() ?? Bun.randomUUIDv7(),
		createdAt: options.now?.() ?? new Date().toISOString(),
		plannerModel,
	};
	await options.appendEvent(overlay);
	return { status: "appended", overlay };
}

export function projectContextWithRepairOverlay(
	records: readonly ContextRepairRecord[],
	overlay: ContextRepairOverlayEvent,
	controls: readonly ContextRepairControlEvent[] = [],
	options: ContextRepairValidationOptions = {},
): ProjectedContextRepairRecord[] {
	validateContextRepairOverlay(overlay, {
		id: overlay.refusalCheckpointId,
		sourceDigest: overlay.sourceDigest,
		refusalRecordId: "projection",
	}, records, options);
	const state = contextRepairOverlayStates([overlay, ...controls]).find(candidate => candidate.overlay.id === overlay.id);
	if (!state?.enabled) {
		return records.map(record => ({ ...record, sourceRecordId: record.id, projection: "unchanged" }));
	}
	const actions = new Map(overlay.actions.map(action => [action.recordId, action] as const));
	const projected: ProjectedContextRepairRecord[] = [];
	for (const record of records) {
		const action = actions.get(record.id);
		if (!action) {
			projected.push({ ...record, sourceRecordId: record.id, projection: "unchanged" });
			continue;
		}
		if (action.operation === "redact") {
			let content = record.content;
			for (const redaction of [...action.redactions].sort((left, right) => right.start - left.start)) {
				content = `${content.slice(0, redaction.start)}${CONTEXT_REPAIR_REDACTION}${content.slice(redaction.end)}`;
			}
			projected.push({
				...record,
				content,
				plannerContent: null,
				tokenCount: estimateTokens(content),
				sourceRecordId: record.id,
				projection: "redacted",
			});
			continue;
		}
		if (action.summary === null) continue;
		const content = CONTEXT_REPAIR_SUMMARY_PREFIX + action.summary;
		projected.push({
			...record,
			kind: record.kind === "tool-call" || record.kind === "tool-result" ? "assistant" : record.kind,
			content,
			plannerContent: null,
			toolCallId: null,
			dependsOn: [],
			tokenCount: estimateTokens(content),
			sourceRecordId: record.id,
			projection: "summary",
		});
	}
	return projected;
}

export function makeContextRepairControlEvent(input: {
	readonly overlayId: string;
	readonly action: ContextRepairControlAction;
	readonly reason: string;
	readonly id?: string;
	readonly createdAt?: string;
}): ContextRepairControlEvent {
	if (!input.overlayId || !input.reason.trim()) {
		throw new ContextRepairValidationError(["overlay ID and control reason are required"]);
	}
	return {
		schemaVersion: CONTEXT_REPAIR_SCHEMA_VERSION,
		kind: CONTEXT_REPAIR_CONTROL_CUSTOM_TYPE,
		id: input.id ?? Bun.randomUUIDv7(),
		overlayId: input.overlayId,
		action: input.action,
		createdAt: input.createdAt ?? new Date().toISOString(),
		reason: input.reason.trim(),
	};
}

export async function readContextRepairLedger(path: string): Promise<ContextRepairLedgerEvent[]> {
	let body: string;
	try {
		body = await Bun.file(path).text();
	} catch (error) {
		if (error instanceof Error && "code" in error && error.code === "ENOENT") return [];
		throw error;
	}
	const events: ContextRepairLedgerEvent[] = [];
	for (const [index, line] of body.split("\n").entries()) {
		if (!line.trim()) continue;
		try {
			events.push(decodeContextRepairLedgerEvent(JSON.parse(line)));
		} catch {
			throw new ContextRepairValidationError([`invalid context repair ledger event at line ${index + 1}`]);
		}
	}
	contextRepairOverlayStates(events);
	return events;
}

export async function appendContextRepairLedgerEvent(path: string, event: ContextRepairLedgerEvent): Promise<void> {
	const decoded = decodeContextRepairLedgerEvent(event);
	await fs.appendFile(path, `${JSON.stringify(decoded)}\n`, { encoding: "utf8", flag: "a" });
}
