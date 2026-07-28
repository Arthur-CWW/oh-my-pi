import { afterEach, describe, expect, it } from "bun:test";
import * as fs from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";
import { Effect } from "effect";
import { PolicyJournal } from "../../src/policy/policy-journal";
import { projectPolicy } from "../../src/policy/policy-projection";
import { makePolicyService } from "../../src/policy/policy-service";
import {
	POLICY_GENESIS_HASH,
	PolicyForkDetectedError,
	PolicyLeaseConflictError,
	TornPolicyJournalError,
	UnknownPolicyKeyError,
} from "../../src/policy/policy-records";

const temporaryDirectories: string[] = [];
const openJournals: PolicyJournal[] = [];

async function createJournal(): Promise<{ readonly directory: string; readonly journal: PolicyJournal }> {
	const directory = await fs.mkdtemp(path.join(os.tmpdir(), "omp-policy-"));
	temporaryDirectories.push(directory);
	const journal = await PolicyJournal.acquire({ directory });
	openJournals.push(journal);
	return { directory, journal };
}

afterEach(async () => {
	for (const journal of openJournals.splice(0)) await journal.release();
	for (const directory of temporaryDirectories.splice(0)) await fs.rm(directory, { recursive: true, force: true });
});

describe("policy journal authority", () => {
	it("fails closed when a committed record is tampered", async () => {
		const { journal } = await createJournal();
		const service = makePolicyService(journal);
		await Effect.runPromise(
			service.set({
				key: "core.routing.implementer",
				value: "slow",
				scope: { kind: "global" },
				reason: "route implementation work",
			}),
		);
		const bytes = await fs.readFile(journal.journalPath, "utf8");
		await fs.writeFile(journal.journalPath, bytes.replace('"value":"slow"', '"value":"smol"'));

		await expect(journal.replay()).rejects.toBeInstanceOf(PolicyForkDetectedError);
	});

	it("rejects a second concurrent foreground lease", async () => {
		const { directory, journal } = await createJournal();

		await expect(PolicyJournal.acquire({ directory })).rejects.toMatchObject({
			_tag: "PolicyLeaseConflictError",
			holderUid: journal.uid,
			holderPid: journal.pid,
			holderEpoch: journal.ownerEpoch,
		});
		await expect(PolicyJournal.acquire({ directory })).rejects.toBeInstanceOf(PolicyLeaseConflictError);
	});

	it("rejects stale expected heads without writing", async () => {
		const { journal } = await createJournal();
		const service = makePolicyService(journal);
		await Effect.runPromise(
			service.set({
				key: "core.routing.default",
				value: "smol",
				scope: { kind: "global" },
				reason: "establish head",
			}),
		);
		const bytesBefore = await fs.readFile(journal.journalPath, "utf8");

		const exit = await Effect.runPromiseExit(
			service.set({
				key: "core.routing.default",
				value: "slow",
				scope: { kind: "global" },
				reason: "stale write",
				expectedHead: { sequence: 0, hash: POLICY_GENESIS_HASH },
			}),
		);
		expect(String(exit)).toContain("StalePolicyHeadError");
		expect(await fs.readFile(journal.journalPath, "utf8")).toBe(bytesBefore);
		expect(await journal.replay()).toHaveLength(1);
	});

	it("fails closed on a torn final line", async () => {
		const { journal } = await createJournal();
		await fs.writeFile(journal.journalPath, '{"recordType":"policy-transaction"');

		await expect(journal.replay()).rejects.toBeInstanceOf(TornPolicyJournalError);
	});

	it("restores the prior snapshot by appending an inverse rollback", async () => {
		const { journal } = await createJournal();
		const service = makePolicyService(journal);
		const setResult = await Effect.runPromise(
			service.set({
				key: "core.routing.qa",
				value: "slow",
				scope: { kind: "global" },
				reason: "use the QA lane",
			}),
		);
		expect((await Effect.runPromise(service.snapshot())).values["core.routing.qa"]?.value).toBe("slow");

		const rolledBack = await Effect.runPromise(
			service.rollback({ transactionId: setResult.transaction.transactionId, reason: "restore the previous route" }),
		);
		expect(rolledBack.transaction.rollbackOf).toBe(setResult.transaction.transactionId);
		expect(rolledBack.transaction.mutations).toEqual([
			{ op: "clear", key: "core.routing.qa", scope: { kind: "global" }, fragmentVersion: 1 },
		]);
		expect(rolledBack.snapshot.values["core.routing.qa"]).toBeUndefined();
		expect((await journal.replay()).map(record => record.sequence)).toEqual([1, 2]);
	});

	it("uses committed sequence to resolve same-layer conflicts", async () => {
		const { journal } = await createJournal();
		const service = makePolicyService(journal);
		const first = await Effect.runPromise(
			service.set({
				key: "core.routing.operator",
				value: "smol",
				scope: { kind: "global" },
				reason: "initial operator route",
			}),
		);
		const second = await Effect.runPromise(
			service.set({
				key: "core.routing.operator",
				value: "slow",
				scope: { kind: "global" },
				reason: "replace operator route",
			}),
		);
		const winner = (await Effect.runPromise(service.snapshot())).values["core.routing.operator"];

		expect(winner).toMatchObject({
			value: "slow",
			sourceLayer: "global-durable",
			transactionId: second.transaction.transactionId,
			sequence: 2,
		});
		expect(winner?.shadowed).toEqual([
			expect.objectContaining({ transactionId: first.transaction.transactionId, sequence: 1, value: "smol" }),
		]);
	});

	it("keeps workstream durable policy above a later global sequence", async () => {
		const { journal } = await createJournal();
		const service = makePolicyService(journal);
		const scoped = await Effect.runPromise(
			service.set({
				key: "core.routing.implementer",
				value: "slow",
				scope: { kind: "workstream", workstream: "hr-129" },
				workstream: "hr-129",
				reason: "workstream route",
			}),
		);
		const global = await Effect.runPromise(
			service.set({
				key: "core.routing.implementer",
				value: "smol",
				scope: { kind: "global" },
				reason: "later global route",
			}),
		);
		const snapshot = await Effect.runPromise(service.snapshot({ workstream: "hr-129" }));

		expect(snapshot.values["core.routing.implementer"]).toMatchObject({
			value: "slow",
			sourceLayer: "workstream-durable",
			transactionId: scoped.transaction.transactionId,
			sequence: 1,
		});
		expect(snapshot.values["core.routing.implementer"]?.shadowed).toEqual([
			expect.objectContaining({ value: "smol", transactionId: global.transaction.transactionId, sequence: 2 }),
		]);
	});

	it("keeps expired transactions visible while excluding their values", async () => {
		const { journal } = await createJournal();
		const service = makePolicyService(journal);
		const result = await Effect.runPromise(
			service.set({
				key: "core.routing.synthesizer",
				value: "slow",
				scope: { kind: "global" },
				reason: "temporary synthesis posture",
				effectiveFrom: "2026-01-01T00:00:00.000Z",
				expiresAt: "2026-01-01T01:00:00.000Z",
			}),
		);
		const records = await journal.replay();
		const during = projectPolicy(records, { at: "2026-01-01T00:30:00.000Z" });
		const after = projectPolicy(records, { at: "2026-01-01T02:00:00.000Z" });

		expect(during.values["core.routing.synthesizer"]).toMatchObject({
			value: "slow",
			sourceLayer: "temporary-posture",
		});
		expect(after.values["core.routing.synthesizer"]).toBeUndefined();
		expect(after.transactions).toHaveLength(1);
		expect(after.expiredTransactionIds).toEqual([result.transaction.transactionId]);
		const diff = await Effect.runPromise(
			service.diff({ from: "2026-01-01T00:30:00.000Z", to: "2026-01-01T02:00:00.000Z" }),
		);
		expect(diff.changes).toEqual([
			expect.objectContaining({
				key: "core.routing.synthesizer",
				before: expect.objectContaining({ value: "slow" }),
			}),
		]);
	});

	it("does not append a journal record for dry-run", async () => {
		const { journal } = await createJournal();
		const service = makePolicyService(journal);
		const preview = await Effect.runPromise(
			service.set({
				key: "core.routing.plan",
				value: "slow",
				scope: { kind: "global" },
				reason: "preview route",
				dryRun: true,
			}),
		);

		expect(preview.committed).toBe(false);
		expect(preview.diff.after.values["core.routing.plan"]?.value).toBe("slow");
		expect(await journal.replay()).toEqual([]);
		await expect(fs.readFile(journal.journalPath, "utf8")).rejects.toMatchObject({ code: "ENOENT" });
	});

	it("explains winner and shadowed provenance through every precedence layer", async () => {
		const { journal } = await createJournal();
		const service = makePolicyService(journal);
		const first = await Effect.runPromise(
			service.set({
				key: "core.routing.default",
				value: "smol",
				scope: { kind: "global" },
				reason: "initial default",
			}),
		);
		const second = await Effect.runPromise(
			service.set({
				key: "core.routing.default",
				value: "slow",
				scope: { kind: "global" },
				reason: "current default",
			}),
		);
		const explanation = await Effect.runPromise(service.explain("core.routing.default"));

		expect(explanation.consultedLayers.map(layer => layer.layer)).toEqual([
			"invocation-override",
			"session-policy",
			"temporary-posture",
			"workstream-durable",
			"global-durable",
			"built-in",
		]);
		expect(explanation.winner).toMatchObject({
			value: "slow",
			transactionId: second.transaction.transactionId,
			sequence: 2,
		});
		expect(explanation.shadowed).toEqual([
			expect.objectContaining({ value: "smol", transactionId: first.transaction.transactionId, sequence: 1 }),
		]);
		expect(explanation.consultedLayers.find(layer => layer.layer === "global-durable")?.candidates).toHaveLength(2);
	});

	it("rejects keys outside the closed core.routing registry", async () => {
		const { journal } = await createJournal();
		const service = makePolicyService(journal);
		const exit = await Effect.runPromiseExit(
			service.set({
				key: "core.routing.unregistered",
				value: "slow",
				scope: { kind: "global" },
				reason: "must fail",
			}),
		);

		expect(exit._tag).toBe("Failure");
		expect(String(exit)).toContain(UnknownPolicyKeyError.name);
		expect(await journal.replay()).toEqual([]);
	});
});
