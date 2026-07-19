import { describe, expect, it } from "bun:test";
import { makeModalModel, updateModal, type ModalActionStamp } from "@oh-my-pi/pi-coding-agent/modes/mvu/modal";
import type { ComponentId } from "@oh-my-pi/pi-coding-agent/modes/mvu/schema";

const origin: ModalActionStamp<"root" | "child", string> = {
	region: "root",
	depth: ["child"],
	componentId: "modal.test" as ComponentId,
	leaseGeneration: 3,
	sourceRevision: 4,
	requestGeneration: 5,
};

const pending = () => updateModal(makeModalModel<"root" | "child", string>("root"), {
	_tag: "ActionPending",
	receiptId: "receipt-1",
	...origin,
}).model;

describe("modal action receipt fencing", () => {
	it("settles a matching pending action", () => {
		const model = pending();
		const settled = updateModal(model, {
			_tag: "ActionSucceeded",
			receiptId: "receipt-1",
			message: "saved",
			...origin,
		}).model;

		expect(settled.pendingAction).toBeUndefined();
		expect(settled.receipt).toMatchObject({ _tag: "Succeeded", receiptId: "receipt-1", message: "saved" });
	});

	it("ignores late results from another region, depth, or route generation", () => {
		const model = pending();
		const changedRegion = updateModal(model, { _tag: "SetRegion", region: "child" }).model;
		const staleRegion = updateModal(changedRegion, {
			_tag: "ActionFailed",
			receiptId: "receipt-1",
			error: "late",
			...origin,
		}).model;
		expect(staleRegion).toBe(changedRegion);

		const staleDepth = updateModal(model, {
			_tag: "ActionSucceeded",
			receiptId: "receipt-1",
			...origin,
			depth: ["other"],
		}).model;
		expect(staleDepth).toBe(model);

		const staleLease = updateModal(model, {
			_tag: "ActionSucceeded",
			receiptId: "receipt-1",
			...origin,
			leaseGeneration: origin.leaseGeneration + 1,
		}).model;
		expect(staleLease).toBe(model);
	});
});
