export type Serializable = null | boolean | number | string | Serializable[] | { [key: string]: Serializable };

export interface WorkerTurnPayload {
	value: Serializable;
	delayMs?: number;
	allocateBytes?: number;
	crash?: "before-result" | "after-result-before-ack";
}

export interface WorkerRunMessage {
	type: "run";
	leaseId: string;
	turnId: string;
	attempt: number;
	payload: WorkerTurnPayload;
	limits: {
		maxTurns: number;
		/** Recycle the worker after this turn once its RSS crosses this. 0 disables. */
		softRssBytes: number;
		/** Retire the worker immediately at this RSS, before it can take another turn. 0 disables. */
		hardRssBytes: number;
	};
}

/** Which memory watermark, if any, the worker crossed while running a turn. */
export type WorkerMemoryWatermark = "soft" | "hard";

export interface WorkerAckMessage {
	type: "ack";
	leaseId: string;
	turnId: string;
	attempt: number;
}

export type CoordinatorToWorkerMessage = WorkerRunMessage | WorkerAckMessage;

export interface WorkerReadyMessage {
	type: "ready";
	pid: number;
}

export interface WorkerResultMessage {
	type: "result";
	leaseId: string;
	turnId: string;
	attempt: number;
	payload: Serializable;
	pid: number;
	rssBytes: number;
	turnsCompleted: number;
	recycle: boolean;
	memoryWatermark?: WorkerMemoryWatermark;
}

export interface WorkerProtocolErrorMessage {
	type: "protocol-error";
	message: string;
}

export type WorkerToCoordinatorMessage = WorkerReadyMessage | WorkerResultMessage | WorkerProtocolErrorMessage;

function record(value: unknown): Record<string, unknown> | undefined {
	if (typeof value !== "object" || value === null || Array.isArray(value)) return undefined;
	const prototype = Object.getPrototypeOf(value);
	if (prototype !== Object.prototype && prototype !== null) return undefined;
	return value as Record<string, unknown>;
}

function stringField(value: unknown, field: string): string {
	if (typeof value !== "string" || value.length === 0) throw new Error(`${field} must be a non-empty string`);
	return value;
}

function integerField(value: unknown, field: string, minimum = 0): number {
	if (!Number.isSafeInteger(value) || (value as number) < minimum) {
		throw new Error(`${field} must be a safe integer >= ${minimum}`);
	}
	return value as number;
}

function decodeSerializable(value: unknown, field: string, seen = new Set<object>()): Serializable {
	if (value === null || typeof value === "boolean" || typeof value === "string") return value;
	if (typeof value === "number" && Number.isFinite(value)) return value;
	if (typeof value !== "object") throw new Error(`${field} must be serializable`);
	if (seen.has(value)) throw new Error(`${field} must not contain cycles`);
	seen.add(value);
	try {
		if (Array.isArray(value)) return value.map((item, index) => decodeSerializable(item, `${field}[${index}]`, seen));
		const input = record(value);
		if (!input) throw new Error(`${field} must be serializable`);
		const output: { [key: string]: Serializable } = {};
		for (const [key, item] of Object.entries(input)) output[key] = decodeSerializable(item, `${field}.${key}`, seen);
		return output;
	} finally {
		seen.delete(value);
	}
}

function decodePayload(value: unknown): WorkerTurnPayload {
	const input = record(value);
	if (!input || !("value" in input)) throw new Error("payload must be an object containing value");
	const payload: WorkerTurnPayload = { value: decodeSerializable(input.value, "payload.value") };
	if (input.delayMs !== undefined) payload.delayMs = integerField(input.delayMs, "payload.delayMs");
	if (input.allocateBytes !== undefined)
		payload.allocateBytes = integerField(input.allocateBytes, "payload.allocateBytes");
	if (input.crash !== undefined) {
		if (input.crash !== "before-result" && input.crash !== "after-result-before-ack") {
			throw new Error("payload.crash is invalid");
		}
		payload.crash = input.crash;
	}
	return payload;
}

export function decodeCoordinatorMessage(value: unknown): CoordinatorToWorkerMessage {
	const input = record(value);
	if (!input) throw new Error("coordinator message must be an object");
	if (input.type === "ack") {
		return {
			type: "ack",
			leaseId: stringField(input.leaseId, "leaseId"),
			turnId: stringField(input.turnId, "turnId"),
			attempt: integerField(input.attempt, "attempt", 1),
		};
	}
	if (input.type === "run") {
		const limits = record(input.limits);
		if (!limits) throw new Error("limits must be an object");
		return {
			type: "run",
			leaseId: stringField(input.leaseId, "leaseId"),
			turnId: stringField(input.turnId, "turnId"),
			attempt: integerField(input.attempt, "attempt", 1),
			payload: decodePayload(input.payload),
			limits: {
				maxTurns: integerField(limits.maxTurns, "limits.maxTurns", 1),
				softRssBytes: integerField(limits.softRssBytes, "limits.softRssBytes"),
				hardRssBytes: integerField(limits.hardRssBytes, "limits.hardRssBytes"),
			},
		};
	}
	throw new Error("unknown coordinator message type");
}

export function decodeWorkerMessage(value: unknown): WorkerToCoordinatorMessage {
	const input = record(value);
	if (!input) throw new Error("worker message must be an object");
	if (input.type === "ready") return { type: "ready", pid: integerField(input.pid, "pid", 1) };
	if (input.type === "protocol-error") {
		return { type: "protocol-error", message: stringField(input.message, "message") };
	}
	if (input.type === "result") {
		if (typeof input.recycle !== "boolean") throw new Error("recycle must be a boolean");
		if (
			input.memoryWatermark !== undefined &&
			input.memoryWatermark !== "soft" &&
			input.memoryWatermark !== "hard"
		) {
			throw new Error("memoryWatermark must be soft or hard");
		}
		return {
			type: "result",
			leaseId: stringField(input.leaseId, "leaseId"),
			turnId: stringField(input.turnId, "turnId"),
			attempt: integerField(input.attempt, "attempt", 1),
			payload: decodeSerializable(input.payload, "payload"),
			pid: integerField(input.pid, "pid", 1),
			rssBytes: integerField(input.rssBytes, "rssBytes"),
			turnsCompleted: integerField(input.turnsCompleted, "turnsCompleted", 1),
			recycle: input.recycle,
			...(input.memoryWatermark ? { memoryWatermark: input.memoryWatermark } : {}),
		};
	}
	throw new Error("unknown worker message type");
}
