import { describe, expect, it } from "bun:test";
import { Effect } from "effect";
import {
	makeResetUsageSelectorAdapter,
	makeResetSpendDeduplication,
	makeSpendResetInterpreter,
} from "../src/modes/mvu/reset-usage-adapter";
import { makeSelectorModel, updateSelector } from "../src/modes/mvu/selector";

const reset = "tui.select.confirm";

describe("reset arm and spend invariant", () => {
	it("requires matching target, source revision, nonce, and redemption", () => {
		let model = makeSelectorModel(["account-a", "account-b"], 7);
		model = updateSelector(model, { _tag: "Arm", action: reset, nonce: "nonce-1" }).model;
		const wrongTarget = updateSelector(model, {
			_tag: "CommitArmed",
			id: "account-b",
			sourceRevision: 7,
			nonce: "nonce-1",
			redeemable: true,
		});
		expect(wrongTarget.commands).toEqual([]);
		const wrongRevision = updateSelector(model, {
			_tag: "CommitArmed",
			id: "account-a",
			sourceRevision: 8,
			nonce: "nonce-1",
			redeemable: true,
		});
		expect(wrongRevision.commands).toEqual([]);
		const notRedeemable = updateSelector(model, {
			_tag: "CommitArmed",
			id: "account-a",
			sourceRevision: 7,
			nonce: "nonce-1",
			redeemable: false,
		});
		expect(notRedeemable.commands).toEqual([]);
		const spent = updateSelector(model, {
			_tag: "CommitArmed",
			id: "account-a",
			sourceRevision: 7,
			nonce: "nonce-1",
			redeemable: true,
		});
		expect(spent.commands).toEqual([{
			_tag: "SpendReset",
			action: reset,
			id: "account-a",
			sourceRevision: 7,
			requestGeneration: 1,
			nonce: "nonce-1",
		}]);
		expect(spent.model.receipt).toEqual({
			_tag: "Pending",
			action: reset,
			id: "account-a",
			sourceRevision: 7,
			requestGeneration: 1,
			nonce: "nonce-1",
			receiptId: "nonce-1",
		});
		expect(updateSelector(spent.model, {
			_tag: "CommitArmed",
			id: "account-a",
			sourceRevision: 7,
			nonce: "nonce-1",
			redeemable: true,
		}).commands).toEqual([]);
	});

	it("disarms on movement, source replacement, and Back", () => {
		const armed = updateSelector(makeSelectorModel(["a", "b"], 1), { _tag: "Arm", action: reset, nonce: "n" }).model;
		expect(updateSelector(armed, { _tag: "Move", delta: 1 }).model.mode._tag).not.toBe("Confirm");
		const replaced = updateSelector(armed, { _tag: "SourceReplaced", sourceRevision: 2, orderedIds: ["a", "b"] });
		expect(replaced.model.mode._tag).not.toBe("Confirm");
		expect(updateSelector(replaced.model, {
			_tag: "CommitArmed",
			id: "a",
			sourceRevision: 2,
			nonce: "n",
			redeemable: true,
		}).commands).toEqual([]);
		expect(updateSelector(armed, { _tag: "Back" }).model.mode._tag).not.toBe("Confirm");
	});

	it("accepts only the settlement matching the pending action stamp", () => {
		const armed = updateSelector(
			makeSelectorModel(["a", "b"], 3),
			{ _tag: "Arm", action: reset, nonce: "unique-route-nonce" },
		).model;
		const spent = updateSelector(armed, {
			_tag: "CommitArmed",
			id: "a",
			sourceRevision: 3,
			nonce: "unique-route-nonce",
			redeemable: true,
		});
		const command = spent.commands[0];
		expect(command?._tag).toBe("SpendReset");
		if (command?._tag !== "SpendReset") return;

		const wrongRequest = updateSelector(spent.model, {
			...command,
			_tag: "ActionSucceeded",
			requestGeneration: command.requestGeneration + 1,
			receiptId: "wrong-request",
		});
		expect(wrongRequest.model).toBe(spent.model);

		const moved = updateSelector(spent.model, { _tag: "Move", delta: 1 }).model;
		const afterMove = updateSelector(moved, {
			...command,
			_tag: "ActionSucceeded",
			receiptId: "late-after-move",
		});
		expect(afterMove.model).toBe(moved);

		const replaced = updateSelector(spent.model, {
			_tag: "SourceReplaced",
			sourceRevision: 4,
			orderedIds: ["a", "b"],
		}).model;
		const afterReplace = updateSelector(replaced, {
			...command,
			_tag: "ActionFailed",
			receiptId: "late-after-replace",
			error: "stale",
		});
		expect(afterReplace.model).toBe(replaced);

		const remounted = makeSelectorModel(["a", "b"], 3);
		const afterRemount = updateSelector(remounted, {
			...command,
			_tag: "ActionSucceeded",
			receiptId: "late-after-remount",
		});
		expect(afterRemount.model).toBe(remounted);

		const settled = updateSelector(spent.model, {
			...command,
			_tag: "ActionSucceeded",
			receiptId: "accepted",
			message: "spent",
		});
		expect(settled.model.receipt).toMatchObject({
			_tag: "Succeeded",
			id: "a",
			action: reset,
			sourceRevision: 3,
			requestGeneration: command.requestGeneration,
			nonce: command.nonce,
			receiptId: "accepted",
		});
	});

	it("allocates mount-scoped nonces and deduplicates delivery across route remounts", async () => {
		const accounts = [{
			label: "a@example.com",
			availableCount: 1,
			target: { credentialId: 1 },
			active: true,
		}] as const;
		const adapter = makeResetUsageSelectorAdapter({
			accounts,
			sessionGeneration: "session-a",
			mountGeneration: 1,
			sourceRevision: 5,
		});
		const remountedAdapter = makeResetUsageSelectorAdapter({
			accounts,
			sessionGeneration: "session-a",
			mountGeneration: 2,
			sourceRevision: 6,
		});
		const id = adapter.initialModel.selectedId;
		expect(id).toBeDefined();
		if (id === undefined) return;
		const nonce = adapter.nonce(id);
		expect(remountedAdapter.nonce(id)).not.toBe(nonce);
		const armed = adapter.update(adapter.initialModel, {
			_tag: "Arm",
			action: reset,
			nonce,
		}).model;
		const spent = adapter.update(armed, {
			_tag: "CommitArmed",
			id,
			sourceRevision: 5,
			nonce,
			redeemable: true,
		});
		const command = spent.commands[0];
		expect(command?._tag).toBe("SpendReset");
		if (command?._tag !== "SpendReset") return;

		let redeemCalls = 0;
		const deduplication = makeResetSpendDeduplication();
		const redeem = () => Effect.sync(() => {
			redeemCalls += 1;
			return { ok: true, code: "reset", creditId: "credit-1" } as const;
		});
		const firstMount = makeSpendResetInterpreter({
			adapter,
			deduplication,
			redeem,
		});
		const secondMount = makeSpendResetInterpreter({
			adapter: remountedAdapter,
			deduplication,
			redeem,
		});
		const first = await Effect.runPromise(firstMount(command));
		const duplicateAfterRemount = await Effect.runPromise(secondMount(command));

		expect(redeemCalls).toBe(1);
		expect(first[0]).toMatchObject({
			_tag: "ResetSpendReceipt",
			id: command.id,
			action: command.action,
			sourceRevision: command.sourceRevision,
			requestGeneration: command.requestGeneration,
			nonce: command.nonce,
			duplicate: false,
		});
		expect(duplicateAfterRemount[0]).toMatchObject({
			_tag: "ResetSpendReceipt",
			id: command.id,
			action: command.action,
			sourceRevision: command.sourceRevision,
			requestGeneration: command.requestGeneration,
			nonce: command.nonce,
			duplicate: true,
		});
	});
});
