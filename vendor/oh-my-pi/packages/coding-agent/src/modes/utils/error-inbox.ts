import { randomUUID } from "node:crypto";
import { SessionOwnershipLostError } from "../../session/durable-input-queue";
import type { SessionEntry } from "../../session/session-entries";

export interface FocusCmuxOwnerAction {
	readonly kind: "focus_cmux_owner";
	readonly sessionFile: string;
	readonly sessionId: string;
	readonly lostOwnerEpoch: string;
}

export type DiagnosticAction = FocusCmuxOwnerAction;

export function diagnosticInputFromError(error: unknown, sessionFile: string | null | undefined): string | DiagnosticEventInput {
	const message = error instanceof Error ? error.message : String(error);
	if (!(error instanceof SessionOwnershipLostError) || !sessionFile) return message;
	return {
		message,
		action: {
			kind: "focus_cmux_owner",
			sessionFile,
			sessionId: error.sessionId,
			lostOwnerEpoch: error.ownerEpoch,
		},
	};
}

function decodeDiagnosticAction(value: unknown): DiagnosticAction | undefined {
	if (!isObject(value)) return undefined;
	const keys = Object.keys(value);
	if (
		keys.length !== 4 ||
		value.kind !== "focus_cmux_owner" ||
		typeof value.sessionFile !== "string" ||
		typeof value.sessionId !== "string" ||
		typeof value.lostOwnerEpoch !== "string" ||
		value.sessionFile.length === 0 ||
		value.sessionId.length === 0 ||
		value.lostOwnerEpoch.length === 0
	) {
		return undefined;
	}
	return {
		kind: value.kind,
		sessionFile: value.sessionFile,
		sessionId: value.sessionId,
		lostOwnerEpoch: value.lostOwnerEpoch,
	};
}

function isSameAction(a: DiagnosticAction | undefined, b: DiagnosticAction | undefined): boolean {
	if (a === b) return true;
	if (!a || !b) return false;
	return (
		a.kind === b.kind &&
		a.sessionFile === b.sessionFile &&
		a.sessionId === b.sessionId &&
		a.lostOwnerEpoch === b.lostOwnerEpoch
	);
}

export interface DiagnosticEvent {
	id: string;
	firstTimestamp: number;
	lastTimestamp: number;
	message: string;
	count: number;

	source?: string;
	category?: string;
	provider?: string;
	model?: string;
	session?: string;
	agent?: string;
	tool?: string;
	job?: string;
	operation?: string;
	status?: number | string;
	code?: string;
	retry?: boolean;
	reset?: number;
	requestFingerprint?: string;
	logPointer?: string;
	causeChain?: string[];

	action?: DiagnosticAction;
	unread: boolean;
	resolved: boolean;
}

export type DiagnosticEventInput = Omit<DiagnosticEvent, "id" | "firstTimestamp" | "lastTimestamp" | "count" | "unread" | "resolved"> & {
	id?: string;
};

export const DEDUPE_WINDOW_MS = 60 * 1000; // 1 minute window for deduping

function isObject(val: unknown): val is Record<string, unknown> {
	return typeof val === "object" && val !== null;
}

function isFiniteNumber(val: unknown): val is number {
	return typeof val === "number" && Number.isFinite(val);
}

class DecoderError extends Error {}

function requireString(data: Record<string, unknown>, key: string): string {
	const val = data[key];
	if (typeof val !== "string") throw new DecoderError(`${key} must be a string`);
	return val;
}

function requireFiniteNumber(data: Record<string, unknown>, key: string): number {
	const val = data[key];
	if (!isFiniteNumber(val)) throw new DecoderError(`${key} must be a finite number`);
	return val;
}

function requireBoolean(data: Record<string, unknown>, key: string): boolean {
	const val = data[key];
	if (typeof val !== "boolean") throw new DecoderError(`${key} must be a boolean`);
	return val;
}

function optionalString(data: Record<string, unknown>, key: string): string | undefined {
	const val = data[key];
	if (val === undefined) return undefined;
	if (typeof val !== "string") throw new DecoderError(`${key} must be a string or undefined`);
	return val;
}

function optionalFiniteNumber(data: Record<string, unknown>, key: string): number | undefined {
	const val = data[key];
	if (val === undefined) return undefined;
	if (!isFiniteNumber(val)) throw new DecoderError(`${key} must be a finite number or undefined`);
	return val;
}

function optionalBoolean(data: Record<string, unknown>, key: string): boolean | undefined {
	const val = data[key];
	if (val === undefined) return undefined;
	if (typeof val !== "boolean") throw new DecoderError(`${key} must be a boolean or undefined`);
	return val;
}

function optionalStringArray(data: Record<string, unknown>, key: string): string[] | undefined {
	const val = data[key];
	if (val === undefined) return undefined;
	if (!Array.isArray(val) || val.some(v => typeof v !== "string")) {
		throw new DecoderError(`${key} must be an array of strings or undefined`);
	}
	return val as string[];
}

function optionalStatus(data: Record<string, unknown>, key: string): number | string | undefined {
	const val = data[key];
	if (val === undefined) return undefined;
	if (typeof val === "string") return val;
	if (isFiniteNumber(val)) return val;
	throw new DecoderError(`${key} must be a finite number, string, or undefined`);
}

function decodeUiErrorV2(data: Record<string, unknown>): DiagnosticEvent {
	if (data.version !== 2) throw new DecoderError("expected version 2");

	const id = requireString(data, "id");
	const message = requireString(data, "message");
	const firstTimestamp = requireFiniteNumber(data, "firstTimestamp");
	const lastTimestamp = requireFiniteNumber(data, "lastTimestamp");
	if (firstTimestamp > lastTimestamp) throw new DecoderError("firstTimestamp must be <= lastTimestamp");
	const count = requireFiniteNumber(data, "count");
	if (count < 1 || Math.floor(count) !== count) throw new DecoderError("count must be a positive integer");
	const unread = requireBoolean(data, "unread");
	const resolved = requireBoolean(data, "resolved");

	return {
		id,
		firstTimestamp,
		lastTimestamp,
		message,
		count,
		source: optionalString(data, "source"),
		category: optionalString(data, "category"),
		provider: optionalString(data, "provider"),
		model: optionalString(data, "model"),
		session: optionalString(data, "session"),
		agent: optionalString(data, "agent"),
		tool: optionalString(data, "tool"),
		job: optionalString(data, "job"),
		operation: optionalString(data, "operation"),
		status: optionalStatus(data, "status"),
		code: optionalString(data, "code"),
		retry: optionalBoolean(data, "retry"),
		reset: optionalFiniteNumber(data, "reset"),
		requestFingerprint: optionalString(data, "requestFingerprint"),
		logPointer: optionalString(data, "logPointer"),
		causeChain: optionalStringArray(data, "causeChain"),
		action: decodeDiagnosticAction(data.action),
		unread,
		resolved,
	};
}

function decodeUiErrorV1(data: Record<string, unknown>): DiagnosticEvent {
	if (data.version !== 1) throw new DecoderError("expected version 1");

	const id = requireString(data, "id");
	const message = requireString(data, "message");
	const timestamp = requireFiniteNumber(data, "timestamp");
	const count = requireFiniteNumber(data, "count");
	if (count < 1 || Math.floor(count) !== count) throw new DecoderError("count must be a positive integer");

	return {
		id,
		firstTimestamp: timestamp,
		lastTimestamp: timestamp,
		message,
		count,
		source: optionalString(data, "source"),
		category: optionalString(data, "category"),
		provider: optionalString(data, "provider"),
		model: optionalString(data, "model"),
		session: optionalString(data, "session"),
		agent: optionalString(data, "agent"),
		tool: optionalString(data, "tool"),
		job: optionalString(data, "job"),
		operation: optionalString(data, "operation"),
		status: optionalStatus(data, "status"),
		code: optionalString(data, "code"),
		retry: optionalBoolean(data, "retry"),
		reset: optionalFiniteNumber(data, "reset"),
		requestFingerprint: optionalString(data, "requestFingerprint"),
		logPointer: optionalString(data, "logPointer"),
		causeChain: optionalStringArray(data, "causeChain"),
		action: decodeDiagnosticAction(data.action),
		unread: optionalBoolean(data, "unread") ?? true,
		resolved: optionalBoolean(data, "resolved") ?? false,
	};
}

function decodeUiErrorEntry(entry: SessionEntry): DiagnosticEvent | null {
	if (entry.type !== "custom" || entry.customType !== "ui_error") return null;
	if (!isObject(entry.data)) return null;

	try {
		const data = entry.data;
		if (data.version === 2) return decodeUiErrorV2(data);
		if (data.version === 1) return decodeUiErrorV1(data);
		return null;
	} catch {
		return null;
	}
}

function isClearMarker(entry: SessionEntry): boolean {
	if (entry.type !== "custom" || entry.customType !== "ui_error_clear") return false;
	if (!isObject(entry.data)) return false;
	return entry.data.version === 1 && isFiniteNumber(entry.data.clearedAt);
}

function isSameCauseChain(a: string[] | undefined, b: string[] | undefined): boolean {
	if (a === b) return true;
	if (a === undefined || b === undefined) return false;
	if (a.length !== b.length) return false;
	return a.every((val, i) => val === b[i]);
}

export class ErrorInbox {
	#errors: DiagnosticEvent[] = [];
	readonly #maxErrors = 100;
	readonly #sessionManager: { appendCustomEntry(type: string, data?: unknown): string };

	constructor(sessionManager: { appendCustomEntry(type: string, data?: unknown): string }) {
		this.#sessionManager = sessionManager;
	}

	/**
	 * Decode from existing session entries on startup. Clear markers truncate the
	 * visible ledger; later error records repopulate it. Entries that fail strict
	 * validation are ignored.
	 */
	reconcile(entries: ReadonlyArray<SessionEntry>): void {
		const decoded = new Map<string, DiagnosticEvent>();

		for (const entry of entries) {
			if (isClearMarker(entry)) {
				decoded.clear();
				continue;
			}

			const event = decodeUiErrorEntry(entry);
			if (event !== null) {
				decoded.set(event.id, event);
			}
		}

		this.#errors = Array.from(decoded.values())
			.sort((a, b) => b.lastTimestamp - a.lastTimestamp)
			.slice(0, this.#maxErrors);
	}

	getErrors(): ReadonlyArray<DiagnosticEvent> {
		return this.#errors;
	}

	recordError(
		input: string | DiagnosticEventInput,
		source?: string,
		options?: { nowMs?: number; id?: string },
	): void {
		const now = options?.nowMs ?? Date.now();
		let message: string;
		let details: Omit<DiagnosticEventInput, "message">;

		if (typeof input === "string") {
			message = input;
			details = {};
			if (source) details.source = source;
			if (options?.id) details.id = options.id;
		} else {
			message = input.message;
			details = { ...input };
			if (source && !details.source) details.source = source;
			if (options?.id && !details.id) details.id = options.id;
		}

		const match = this.#errors.find(existing =>
			existing.message === message &&
			existing.source === details.source &&
			existing.category === details.category &&
			existing.provider === details.provider &&
			existing.model === details.model &&
			existing.session === details.session &&
			existing.agent === details.agent &&
			existing.tool === details.tool &&
			existing.job === details.job &&
			existing.operation === details.operation &&
			existing.status === details.status &&
			existing.code === details.code &&
			existing.retry === details.retry &&
			existing.reset === details.reset &&
			existing.requestFingerprint === details.requestFingerprint &&
			existing.logPointer === details.logPointer &&
			isSameCauseChain(existing.causeChain, details.causeChain) &&
			isSameAction(existing.action, details.action) &&
			now >= existing.lastTimestamp &&
			now - existing.lastTimestamp <= DEDUPE_WINDOW_MS,
		);

		let record: DiagnosticEvent;

		if (match) {
			match.count++;
			match.lastTimestamp = now;
			match.unread = true;
			match.resolved = false;
			record = match;
			this.#errors.sort((a, b) => b.lastTimestamp - a.lastTimestamp);
		} else {
			record = {
				id: details.id ?? randomUUID(),
				firstTimestamp: now,
				lastTimestamp: now,
				message,
				count: 1,
				unread: true,
				resolved: false,
				source: details.source,
				category: details.category,
				provider: details.provider,
				model: details.model,
				session: details.session,
				agent: details.agent,
				tool: details.tool,
				job: details.job,
				operation: details.operation,
				status: details.status,
				code: details.code,
				retry: details.retry,
				reset: details.reset,
				requestFingerprint: details.requestFingerprint,
				logPointer: details.logPointer,
				causeChain: details.causeChain,
				action: details.action,
			};
			this.#errors.unshift(record);
			if (this.#errors.length > this.#maxErrors) {
				this.#errors.length = this.#maxErrors;
			}
		}

		try {
			this.#sessionManager.appendCustomEntry("ui_error", { ...record, version: 2 });
		} catch {
			// Persistence failure must never recursively surface as a new error.
		}
	}

	/**
	 * Append an append-only clear marker and empty the in-memory ledger. Later
	 * records recorded after the clear will still be recovered on restart.
	 */
	clear(nowMs = Date.now()): void {
		this.#errors = [];
		try {
			this.#sessionManager.appendCustomEntry("ui_error_clear", { clearedAt: nowMs, version: 1 });
		} catch {
			// Persistence failure must never recursively surface as a new error.
		}
	}

	/**
	 * Mark a single error resolved. Persists an updated snapshot with the same id.
	 */
	resolve(id: string): boolean {
		const idx = this.#errors.findIndex(e => e.id === id);
		if (idx === -1) return false;

		const event = this.#errors[idx];
		const resolvedEvent: DiagnosticEvent = {
			...event,
			unread: false,
			resolved: true,
		};
		this.#errors[idx] = resolvedEvent;

		try {
			this.#sessionManager.appendCustomEntry("ui_error", { ...resolvedEvent, version: 2 });
		} catch {
			// Persistence failure must never recursively surface as a new error.
		}
		return true;
	}
}
