import type {
	DurableInputCommandMetadata,
	DurableInputDeliveryClass,
	DurableInputPayload,
	DurableInputState,
} from "./durable-input-queue";
import { decodeDurablePayload } from "./durable-media-codec";
import { hasOnlyKeys, isPositiveSafeInteger, isRecord } from "./durable-queue-decode";

export const QUEUE_VERSION = 3 as const;

export interface QueueHead {
	readonly version: typeof QUEUE_VERSION;
	readonly epoch: string;
	readonly ownershipEpoch?: string;
	readonly predecessor?: string;
	readonly predecessorBytes?: number;
	readonly adoptedAt: number;
}

export type QueueRecord =
	| {
			readonly version: typeof QUEUE_VERSION;
			readonly type: "enqueue";
			readonly id: string;
			readonly payload: DurableInputPayload;
			readonly sequence: number;
			readonly deliveryClass: DurableInputDeliveryClass;
			readonly revision: number;
			readonly command?: DurableInputCommandMetadata;
			readonly runnerRevision?: number;
			readonly ownerEpoch: string;
	  }
	| {
			readonly version: typeof QUEUE_VERSION;
			readonly type: "revision";
			readonly inputId: string;
			readonly revision: number;
			readonly payload: DurableInputPayload;
			readonly command?: DurableInputCommandMetadata;
			readonly runnerRevision?: number;
			readonly ownerEpoch: string;
	  }
	| {
			readonly version: typeof QUEUE_VERSION;
			readonly type: "state";
			readonly id: string;
			readonly state: DurableInputState;
			readonly revision?: number;
			readonly command?: DurableInputCommandMetadata;
			readonly runnerRevision?: number;
			readonly ownerEpoch: string;
	  }
	| {
			readonly version: typeof QUEUE_VERSION;
			readonly type: "attempt";
			readonly id: string;
			readonly inputId: string;
			readonly revision: number;
			readonly ownerEpoch: string;
	  }
	| {
			readonly version: typeof QUEUE_VERSION;
			readonly type: "request-start";
			readonly attemptId: string;
			readonly inputId: string;
			readonly ownerEpoch: string;
	  }
	| {
			readonly version: typeof QUEUE_VERSION;
			readonly type: "terminal";
			readonly attemptId: string;
			readonly inputId: string;
			readonly state: "completed" | "failed-rate-limit";
			readonly retryAt?: number;
			readonly ownerEpoch: string;
	  }
	| {
			readonly version: typeof QUEUE_VERSION;
			readonly type: "requeue";
			readonly inputId: string;
			readonly ownerEpoch: string;
	  }
	| {
			readonly version: typeof QUEUE_VERSION;
			readonly type: "adopt";
			readonly ownerEpoch: string;
			readonly previousEpoch: string | undefined;
	  };

function isValidState(value: unknown): value is DurableInputState {
	return (
		typeof value === "string" &&
		["queued", "admitted", "running", "uncertain", "completed", "failed-rate-limit", "cancelled"].includes(value)
	);
}

export function isDeliveryClass(value: unknown): value is DurableInputDeliveryClass {
	return value === "steer" || value === "followUp";
}

export function decodeCommandMetadata(value: unknown): DurableInputCommandMetadata | undefined {
	if (!isRecord(value)) return undefined;
	const hasCausationId = Object.hasOwn(value, "causationId");
	if (
		Object.keys(value).length !== (hasCausationId ? 7 : 6) ||
		!Object.hasOwn(value, "schemaVersion") ||
		!Object.hasOwn(value, "commandId") ||
		!Object.hasOwn(value, "correlationId") ||
		!Object.hasOwn(value, "viewId") ||
		!Object.hasOwn(value, "controllerEpoch") ||
		!Object.hasOwn(value, "expectedRevision") ||
		value.schemaVersion !== 1 ||
		typeof value.commandId !== "string" ||
		typeof value.correlationId !== "string" ||
		(value.causationId !== undefined && typeof value.causationId !== "string") ||
		typeof value.viewId !== "string" ||
		!Number.isSafeInteger(value.controllerEpoch) ||
		(value.controllerEpoch as number) < 0 ||
		!Number.isSafeInteger(value.expectedRevision) ||
		(value.expectedRevision as number) < 0
	) {
		return undefined;
	}
	return {
		schemaVersion: 1,
		commandId: value.commandId,
		correlationId: value.correlationId,
		...(value.causationId === undefined ? {} : { causationId: value.causationId as string }),
		viewId: value.viewId,
		controllerEpoch: value.controllerEpoch as number,
		expectedRevision: value.expectedRevision as number,
	};
}

export function decodeRecord(value: unknown): QueueRecord | undefined {
	if (
		!isRecord(value) ||
		value.version !== QUEUE_VERSION ||
		typeof value.type !== "string" ||
		typeof value.ownerEpoch !== "string"
	) {
		return undefined;
	}
	switch (value.type) {
		case "enqueue": {
			if (
				!hasOnlyKeys(value, [
					"version",
					"type",
					"id",
					"payload",
					"sequence",
					"deliveryClass",
					"revision",
					"command",
					"runnerRevision",
					"ownerEpoch",
				])
			) {
				return undefined;
			}
			const command = value.command === undefined ? undefined : decodeCommandMetadata(value.command);
			const payload = decodeDurablePayload(value.payload);
			if (
				typeof value.id !== "string" ||
				payload === undefined ||
				!isPositiveSafeInteger(value.sequence) ||
				!isDeliveryClass(value.deliveryClass) ||
				!isPositiveSafeInteger(value.revision) ||
				(value.command !== undefined && command === undefined) ||
				(value.runnerRevision !== undefined && !isPositiveSafeInteger(value.runnerRevision)) ||
				(command === undefined) !== (value.runnerRevision === undefined)
			) {
				return undefined;
			}
			return {
				version: QUEUE_VERSION,
				type: "enqueue",
				id: value.id,
				payload,
				sequence: value.sequence,
				deliveryClass: value.deliveryClass,
				revision: value.revision,
				...(command === undefined ? {} : { command }),
				...(value.runnerRevision === undefined ? {} : { runnerRevision: value.runnerRevision }),
				ownerEpoch: value.ownerEpoch,
			};
		}
		case "revision": {
			if (
				!hasOnlyKeys(value, [
					"version",
					"type",
					"inputId",
					"revision",
					"payload",
					"command",
					"runnerRevision",
					"ownerEpoch",
				])
			) {
				return undefined;
			}
			const payload = decodeDurablePayload(value.payload);
			const command = value.command === undefined ? undefined : decodeCommandMetadata(value.command);
			if (
				typeof value.inputId !== "string" ||
				!isPositiveSafeInteger(value.revision) ||
				!payload ||
				(value.command !== undefined && command === undefined) ||
				(value.runnerRevision !== undefined && !isPositiveSafeInteger(value.runnerRevision)) ||
				(command === undefined) !== (value.runnerRevision === undefined)
			) {
				return undefined;
			}
			return {
				version: QUEUE_VERSION,
				type: "revision",
				inputId: value.inputId,
				revision: value.revision,
				payload,
				...(command === undefined ? {} : { command }),
				...(value.runnerRevision === undefined ? {} : { runnerRevision: value.runnerRevision }),
				ownerEpoch: value.ownerEpoch,
			};
		}
		case "state": {
			if (
				!hasOnlyKeys(value, [
					"version",
					"type",
					"id",
					"state",
					"revision",
					"command",
					"runnerRevision",
					"ownerEpoch",
				])
			) {
				return undefined;
			}
			const command = value.command === undefined ? undefined : decodeCommandMetadata(value.command);
			if (
				typeof value.id !== "string" ||
				!isValidState(value.state) ||
				(value.revision !== undefined && !isPositiveSafeInteger(value.revision)) ||
				(value.command !== undefined && command === undefined) ||
				(value.runnerRevision !== undefined && !isPositiveSafeInteger(value.runnerRevision)) ||
				(command === undefined) !== (value.runnerRevision === undefined) ||
				(command !== undefined && value.revision === undefined)
			) {
				return undefined;
			}
			return {
				version: QUEUE_VERSION,
				type: "state",
				id: value.id,
				state: value.state,
				...(value.revision === undefined ? {} : { revision: value.revision }),
				...(command === undefined ? {} : { command }),
				...(value.runnerRevision === undefined ? {} : { runnerRevision: value.runnerRevision }),
				ownerEpoch: value.ownerEpoch,
			};
		}
		case "attempt":
			if (
				!hasOnlyKeys(value, ["version", "type", "id", "inputId", "revision", "ownerEpoch"]) ||
				typeof value.id !== "string" ||
				typeof value.inputId !== "string" ||
				!isPositiveSafeInteger(value.revision)
			) {
				return undefined;
			}
			return {
				version: QUEUE_VERSION,
				type: "attempt",
				id: value.id,
				inputId: value.inputId,
				revision: value.revision,
				ownerEpoch: value.ownerEpoch,
			};
		case "request-start":
			if (
				!hasOnlyKeys(value, ["version", "type", "attemptId", "inputId", "ownerEpoch"]) ||
				typeof value.attemptId !== "string" ||
				typeof value.inputId !== "string"
			) {
				return undefined;
			}
			return {
				version: QUEUE_VERSION,
				type: "request-start",
				attemptId: value.attemptId,
				inputId: value.inputId,
				ownerEpoch: value.ownerEpoch,
			};
		case "terminal":
			if (
				!hasOnlyKeys(value, ["version", "type", "attemptId", "inputId", "state", "retryAt", "ownerEpoch"]) ||
				typeof value.attemptId !== "string" ||
				typeof value.inputId !== "string" ||
				(value.state !== "completed" && value.state !== "failed-rate-limit") ||
				(value.retryAt !== undefined && (typeof value.retryAt !== "number" || !Number.isFinite(value.retryAt)))
			) {
				return undefined;
			}
			return {
				version: QUEUE_VERSION,
				type: "terminal",
				attemptId: value.attemptId,
				inputId: value.inputId,
				state: value.state,
				...(value.retryAt === undefined ? {} : { retryAt: value.retryAt }),
				ownerEpoch: value.ownerEpoch,
			};
		case "requeue":
			if (
				!hasOnlyKeys(value, ["version", "type", "inputId", "ownerEpoch"]) ||
				typeof value.inputId !== "string"
			) {
				return undefined;
			}
			return { version: QUEUE_VERSION, type: "requeue", inputId: value.inputId, ownerEpoch: value.ownerEpoch };
		case "adopt":
			if (
				!hasOnlyKeys(value, ["version", "type", "ownerEpoch", "previousEpoch"]) ||
				(value.previousEpoch !== undefined && typeof value.previousEpoch !== "string")
			) {
				return undefined;
			}
			return {
				version: QUEUE_VERSION,
				type: "adopt",
				ownerEpoch: value.ownerEpoch,
				previousEpoch: value.previousEpoch,
			};
		default:
			return undefined;
	}
}

export function decodeHead(value: unknown): QueueHead | undefined {
	if (
		!isRecord(value) ||
		!hasOnlyKeys(value, [
			"version",
			"epoch",
			"ownershipEpoch",
			"predecessor",
			"predecessorBytes",
			"adoptedAt",
		]) ||
		value.version !== QUEUE_VERSION ||
		typeof value.epoch !== "string" ||
		(typeof value.ownershipEpoch !== "string" && value.ownershipEpoch !== undefined) ||
		(typeof value.predecessor !== "string" && value.predecessor !== undefined) ||
		(typeof value.predecessorBytes !== "number" && value.predecessorBytes !== undefined) ||
		typeof value.adoptedAt !== "number"
	) {
		return undefined;
	}
	return {
		version: QUEUE_VERSION,
		epoch: value.epoch,
		ownershipEpoch: typeof value.ownershipEpoch === "string" ? value.ownershipEpoch : undefined,
		predecessor: typeof value.predecessor === "string" ? value.predecessor : undefined,
		predecessorBytes: typeof value.predecessorBytes === "number" ? value.predecessorBytes : undefined,
		adoptedAt: value.adoptedAt,
	};
}
