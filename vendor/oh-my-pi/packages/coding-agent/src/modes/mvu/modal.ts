import type { ComponentId, Transition, ViewKey } from "./schema";
import { type ReceiptState, noneReceipt } from "./status";

export interface ModalActionStamp<Region extends string, Depth> {
	readonly region: Region;
	readonly depth: readonly Depth[];
	readonly componentId: ComponentId;
	readonly leaseGeneration: number;
	readonly sourceRevision: number;
	readonly requestGeneration: number;
}

export interface ModalModel<Region extends string, Depth> {
	readonly region: Region;
	readonly depth: readonly Depth[];
	readonly receipt: ReceiptState<string>;
	readonly pendingAction?: ModalActionStamp<Region, Depth>;
	readonly focusIndex: number;
}

export type ModalMsg<Region extends string, Depth> =
	| { readonly _tag: "SetRegion"; readonly region: Region }
	| { readonly _tag: "FocusNext"; readonly count: number }
	| { readonly _tag: "FocusPrevious"; readonly count: number }
	| { readonly _tag: "Push"; readonly depth: Depth; readonly region?: Region }
	| { readonly _tag: "Pop" }
	| { readonly _tag: "Back" }
	| { readonly _tag: "Close" }
	| ({ readonly _tag: "ActionPending"; readonly receiptId: string } & ModalActionStamp<Region, Depth>)
	| ({ readonly _tag: "ActionSucceeded"; readonly receiptId: string; readonly message?: string } & ModalActionStamp<Region, Depth>)
	| ({ readonly _tag: "ActionFailed"; readonly receiptId: string; readonly error: string } & ModalActionStamp<Region, Depth>);

export type ModalCommand<Region extends string, Depth> =
	| { readonly _tag: "CloseRequested" }
	| { readonly _tag: "FocusChanged"; readonly index: number }
	| { readonly _tag: "RegionChanged"; readonly region: Region };
function sameDepth<Depth>(left: readonly Depth[], right: readonly Depth[]): boolean {
	if (left.length !== right.length) return false;
	for (let index = 0; index < left.length; index++) {
		if (!Object.is(left[index], right[index])) return false;
	}
	return true;
}

function matchesPendingAction<Region extends string, Depth>(
	model: ModalModel<Region, Depth>,
	msg: ModalActionStamp<Region, Depth> & { readonly receiptId: string },
): boolean {
	const pending = model.pendingAction;
	const receipt = model.receipt;
	return pending !== undefined &&
		receipt._tag === "Pending" &&
		receipt.receiptId === msg.receiptId &&
		model.region === msg.region &&
		sameDepth(model.depth, msg.depth) &&
		pending.region === msg.region &&
		sameDepth(pending.depth, msg.depth) &&
		pending.componentId === msg.componentId &&
		pending.leaseGeneration === msg.leaseGeneration &&
		pending.sourceRevision === msg.sourceRevision &&
		pending.requestGeneration === msg.requestGeneration;
}


function transition<Region extends string, Depth>(
	before: ModalModel<Region, Depth>,
	after: ModalModel<Region, Depth>,
	commands: readonly ModalCommand<Region, Depth>[] = [],
	keys: readonly ViewKey[] = [],
): Transition<ModalModel<Region, Depth>, ModalCommand<Region, Depth>> {
	const dirty = new Set<ViewKey>(keys);
	if (before.region !== after.region) dirty.add("region");
	if (before.depth.length !== after.depth.length) dirty.add("depth");
	if (before.focusIndex !== after.focusIndex) dirty.add("focus");
	if (before.receipt !== after.receipt || before.pendingAction !== after.pendingAction) dirty.add("status");
	return { model: after, commands, dirtyKeys: dirty };
}

export function makeModalModel<Region extends string, Depth>(region: Region): ModalModel<Region, Depth> {
	return { region, depth: [], receipt: noneReceipt<string>(), focusIndex: 0 };
}

export function updateModal<Region extends string, Depth>(
	model: ModalModel<Region, Depth>,
	msg: ModalMsg<Region, Depth>,
): Transition<ModalModel<Region, Depth>, ModalCommand<Region, Depth>> {
	switch (msg._tag) {
		case "SetRegion":
			return transition(model, { ...model, region: msg.region }, [{ _tag: "RegionChanged", region: msg.region }]);
		case "FocusNext": {
			const count = Math.max(1, msg.count);
			const focusIndex = (model.focusIndex + 1) % count;
			return transition(model, { ...model, focusIndex }, [{ _tag: "FocusChanged", index: focusIndex }]);
		}
		case "FocusPrevious": {
			const count = Math.max(1, msg.count);
			const focusIndex = (model.focusIndex - 1 + count) % count;
			return transition(model, { ...model, focusIndex }, [{ _tag: "FocusChanged", index: focusIndex }]);
		}
		case "Push":
			return transition(model, { ...model, depth: [...model.depth, msg.depth], region: msg.region ?? model.region, focusIndex: 0 });
		case "Pop":
			if (model.depth.length === 0) return transition(model, model, [{ _tag: "CloseRequested" }]);
			return transition(model, { ...model, depth: model.depth.slice(0, -1), focusIndex: 0 });
		case "Back":
			if (model.depth.length > 0) return transition(model, { ...model, depth: model.depth.slice(0, -1), focusIndex: 0 });
			return transition(model, model, [{ _tag: "CloseRequested" }]);
		case "Close":
			return transition(model, model, [{ _tag: "CloseRequested" }]);
		case "ActionPending":
			return transition(model, {
				...model,
				pendingAction: msg,
				receipt: {
					_tag: "Pending",
					action: msg.region,
					id: msg.region,
					sourceRevision: msg.sourceRevision,
					requestGeneration: msg.requestGeneration,
					nonce: msg.receiptId,
					receiptId: msg.receiptId,
				},
			});
		case "ActionSucceeded":
			if (!matchesPendingAction(model, msg)) return transition(model, model);
			return transition(model, {
				...model,
				pendingAction: undefined,
				receipt: {
					_tag: "Succeeded",
					action: msg.region,
					id: msg.region,
					sourceRevision: msg.sourceRevision,
					requestGeneration: msg.requestGeneration,
					nonce: msg.receiptId,
					receiptId: msg.receiptId,
					message: msg.message,
				},
			});
		case "ActionFailed":
			if (!matchesPendingAction(model, msg)) return transition(model, model);
			return transition(model, {
				...model,
				pendingAction: undefined,
				receipt: {
					_tag: "Failed",
					action: msg.region,
					id: msg.region,
					sourceRevision: msg.sourceRevision,
					requestGeneration: msg.requestGeneration,
					nonce: msg.receiptId,
					receiptId: msg.receiptId,
					error: msg.error,
				},
			});
	}
}
