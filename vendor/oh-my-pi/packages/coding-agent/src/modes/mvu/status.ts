import * as Schema from "effect/Schema";
import type { Transition, ViewKey } from "./schema";

export const ReadinessSchema = Schema.Literals(["ready", "busy", "blocked", "unavailable", "unknown"]);
export type Readiness = typeof ReadinessSchema.Type;

export const AttentionSchema = Schema.Literals(["now", "next", "waiting", "later", "hidden"]);
export type Attention = typeof AttentionSchema.Type;

export const PrioritySchema = Schema.Literals(["critical", "high", "normal", "low"]);
export type Priority = typeof PrioritySchema.Type;

export interface ReceiptStamp {
	readonly sourceRevision?: number;
	readonly requestGeneration?: number;
	readonly nonce?: string;
}

export interface ReceiptProjection extends ReceiptStamp {
	readonly receiptId: string;
	readonly action: string;
	readonly state: "pending" | "succeeded" | "failed";
	readonly message?: string;
}

export interface StatusProjection {
	readonly readiness: Readiness;
	readonly attention?: Attention;
	readonly priority?: Priority;
	readonly label: string;
	readonly receipt?: ReceiptProjection;
}

export type ReceiptState<Id> =
	| { readonly _tag: "None" }
	| (ReceiptStamp & { readonly _tag: "Pending"; readonly action: string; readonly id: Id; readonly receiptId: string })
	| (ReceiptStamp & { readonly _tag: "Succeeded"; readonly action: string; readonly id: Id; readonly receiptId: string; readonly message?: string })
	| (ReceiptStamp & { readonly _tag: "Failed"; readonly action: string; readonly id: Id; readonly receiptId: string; readonly error: string });

export const noneReceipt = <Id>(): ReceiptState<Id> => ({ _tag: "None" });

export type StatusMsg =
	| { readonly _tag: "SetReadiness"; readonly readiness: Readiness; readonly label?: string }
	| { readonly _tag: "SetAttention"; readonly attention?: Attention }
	| { readonly _tag: "SetPriority"; readonly priority?: Priority }
	| { readonly _tag: "SetReceipt"; readonly receipt?: ReceiptProjection };

const noCommands = (): readonly never[] => [];

export function updateStatus(model: StatusProjection, msg: StatusMsg): Transition<StatusProjection, never> {
	let next = model;
	switch (msg._tag) {
		case "SetReadiness":
			next = { ...model, readiness: msg.readiness, label: msg.label ?? model.label };
			break;
		case "SetAttention":
			next = { ...model, attention: msg.attention };
			break;
		case "SetPriority":
			next = { ...model, priority: msg.priority };
			break;
		case "SetReceipt":
			next = { ...model, receipt: msg.receipt };
			break;
	}
	const dirty: ReadonlySet<ViewKey> = new Set(["status"]);
	return { model: next, commands: noCommands(), dirtyKeys: dirty };
}

function receiptStampProjection<Id>(
	state: Exclude<ReceiptState<Id>, { readonly _tag: "None" }>,
): ReceiptStamp {
	return {
		...(state.sourceRevision === undefined ? {} : { sourceRevision: state.sourceRevision }),
		...(state.requestGeneration === undefined ? {} : { requestGeneration: state.requestGeneration }),
		...(state.nonce === undefined ? {} : { nonce: state.nonce }),
	};
}

export function receiptProjection<Id>(state: ReceiptState<Id>): ReceiptProjection | undefined {
	switch (state._tag) {
		case "None":
			return undefined;
		case "Pending":
			return { ...receiptStampProjection(state), receiptId: state.receiptId, action: state.action, state: "pending" };
		case "Succeeded":
			return {
				...receiptStampProjection(state),
				receiptId: state.receiptId,
				action: state.action,
				state: "succeeded",
				message: state.message,
			};
		case "Failed":
			return {
				...receiptStampProjection(state),
				receiptId: state.receiptId,
				action: state.action,
				state: "failed",
				message: state.error,
			};
	}
}
