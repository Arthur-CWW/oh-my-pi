import { afterEach, describe, expect, it } from "bun:test";
import * as fs from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";
import { Effect } from "effect";
import { PolicyJournal } from "../../src/policy/policy-journal";
import { isModelDenied, isProviderDenied } from "../../src/policy/policy-projection";
import { makePolicyService } from "../../src/policy/policy-service";
import { PolicyProjectionStore } from "../../src/policy/policy-projection-store";
import { decodePolicyTransactionV1, POLICY_GENESIS_HASH } from "../../src/policy/policy-records";

const temporaryDirectories: string[] = [];
const openJournals: PolicyJournal[] = [];

async function createJournal(): Promise<PolicyJournal> {
	const directory = await fs.mkdtemp(path.join(os.tmpdir(), "omp-provider-policy-"));
	temporaryDirectories.push(directory);
	const journal = await PolicyJournal.acquire({ directory });
	openJournals.push(journal);
	return journal;
}

afterEach(async () => {
	for (const journal of openJournals.splice(0)) await journal.release();
	for (const directory of temporaryDirectories.splice(0)) await fs.rm(directory, { recursive: true, force: true });
});

describe("core.providers policy projection", () => {
	it("projects future, active, exact-expiry, and expired posture without mutating the journal", async () => {
		const journal = await createJournal();
		const service = makePolicyService(journal);
		const set = await Effect.runPromise(
			service.set({
				key: "core.providers.deny.providers",
				value: { providerIds: ["anthropic", "google"] },
				scope: { kind: "global" },
				reason: "temporary provider incident",
				effectiveFrom: "2026-01-01T10:00:00.000Z",
				expiresAt: "2026-01-01T11:00:00.000Z",
			}),
		);
		const journalBeforeProjection = await fs.readFile(journal.journalPath, "utf8");
		const recordCountBeforeProjection = (await journal.replay()).length;

		const preBoundary = await Effect.runPromise(service.snapshot({ at: "2026-01-01T09:59:00.000Z" }));
		expect(preBoundary.providerPosture).toMatchObject({
			deniedProviderIds: [],
			entries: [
				expect.objectContaining({
					transactionId: set.transaction.transactionId,
					sequence: set.transaction.sequence,
					state: "future",
					effective: false,
					remainingMs: 60_000,
					sourceLayer: "temporary-posture",
				}),
			],
		});
		expect(
			await Effect.runPromise(service.explain("core.providers.deny.providers", { at: preBoundary.at })),
		).toMatchObject({
			status: "future",
			countdownTo: "effectiveFrom",
			remainingMs: 60_000,
		});

		const active = await Effect.runPromise(service.snapshot({ at: "2026-01-01T10:30:00.000Z" }));
		expect(active.providerPosture).toMatchObject({
			deniedProviderIds: ["anthropic", "google"],
			entries: [expect.objectContaining({ state: "active", effective: true, remainingMs: 1_800_000 })],
		});
		expect(isProviderDenied(active, "anthropic")).toBe(true);
		expect(
			await Effect.runPromise(service.explain("core.providers.deny.providers", { at: active.at })),
		).toMatchObject({
			status: "active",
			countdownTo: "expiresAt",
			remainingMs: 1_800_000,
		});

		const exactExpiry = await Effect.runPromise(service.snapshot({ at: "2026-01-01T11:00:00.000Z" }));
		expect(exactExpiry.providerPosture).toMatchObject({
			deniedProviderIds: [],
			entries: [expect.objectContaining({ state: "expired", effective: false, remainingMs: 0 })],
		});
		expect(isProviderDenied(exactExpiry, "anthropic")).toBe(false);
		expect(
			await Effect.runPromise(service.explain("core.providers.deny.providers", { at: exactExpiry.at })),
		).toMatchObject({
			status: "expired",
			countdownTo: "none",
			remainingMs: 0,
		});

		const postExpiry = await Effect.runPromise(service.snapshot({ at: "2026-01-01T12:00:00.000Z" }));
		expect(postExpiry.providerPosture?.entries).toEqual([
			expect.objectContaining({ state: "expired", effective: false, remainingMs: 0 }),
		]);
		expect((await Effect.runPromise(service.diff({ from: active.at, to: exactExpiry.at }))).changes).toEqual([
			expect.objectContaining({ key: "core.providers.deny.providers", before: expect.any(Object) }),
		]);

		expect(await fs.readFile(journal.journalPath, "utf8")).toBe(journalBeforeProjection);
		expect((await journal.replay()).length).toBe(recordCountBeforeProjection);
	});

	it("matches exact provider/model selectors and restores the prior typed deny on rollback", async () => {
		const journal = await createJournal();
		const service = makePolicyService(journal);
		const baseline = await Effect.runPromise(
			service.set({
				key: "core.providers.deny.providers",
				value: { providerIds: ["openai"] },
				scope: { kind: "global" },
				reason: "baseline deny",
				effectiveFrom: "2026-01-01T00:00:00.000Z",
			}),
		);
		const replacement = await Effect.runPromise(
			service.set({
				key: "core.providers.deny.providers",
				value: { providerIds: ["anthropic"] },
				scope: { kind: "global" },
				reason: "replace deny",
				effectiveFrom: "2026-01-01T00:01:00.000Z",
			}),
		);
		await Effect.runPromise(
			service.set({
				key: "core.providers.deny.models",
				value: { models: [{ provider: "google", model: "gemini-2.5-pro" }] },
				scope: { kind: "global" },
				reason: "deny one model",
				effectiveFrom: "2026-01-01T00:00:00.000Z",
			}),
		);

		const beforeRollback = await Effect.runPromise(service.snapshot({ at: "2026-01-01T01:00:00.000Z" }));
		expect(isProviderDenied(beforeRollback, "anthropic")).toBe(true);
		expect(isProviderDenied(beforeRollback, "openai")).toBe(false);
		expect(isModelDenied(beforeRollback, "google", "gemini-2.5-pro")).toBe(true);
		expect(isModelDenied(beforeRollback, "google", "gemini-2.5-flash")).toBe(false);

		const rollback = await Effect.runPromise(
			service.rollback({
				transactionId: replacement.transaction.transactionId,
				reason: "restore baseline provider deny",
				effectiveFrom: "2026-01-01T00:02:00.000Z",
			}),
		);
		expect(rollback.transaction.rollbackOf).toBe(replacement.transaction.transactionId);
		expect(rollback.transaction.mutations).toEqual([
			{
				op: "set",
				key: "core.providers.deny.providers",
				scope: { kind: "global" },
				fragmentVersion: 1,
				value: { providerIds: ["openai"] },
			},
		]);
		const restored = await Effect.runPromise(service.snapshot({ at: "2026-01-01T01:00:00.000Z" }));
		expect(restored.providerPosture?.deniedProviderIds).toEqual(["openai"]);
		expect(restored.providerPosture?.values["core.providers.deny.providers"]?.transactionId).toBe(
			rollback.transaction.transactionId,
		);
		expect(baseline.transaction.sequence).toBeLessThan(rollback.transaction.sequence);
	});

	it("keeps registry-v1 routing records decodable and rejects invalid provider values", async () => {
		expect(
			decodePolicyTransactionV1({
				recordType: "policy-transaction",
				schemaVersion: 1,
				transactionId: "00000000-0000-4000-8000-000000000001",
				sequence: 1,
				previousHash: POLICY_GENESIS_HASH,
				recordHash: "1".repeat(64),
				createdAt: "2026-01-01T00:00:00.000Z",
				effectiveFrom: "2026-01-01T00:00:00.000Z",
				author: { kind: "cli", uid: 0, pid: 1 },
				source: { kind: "cli" },
				reason: "legacy routing record",
				registry: { version: 1, digest: "2".repeat(64) },
				mutations: [
					{
						op: "set",
						key: "core.routing.default",
						scope: { kind: "global" },
						fragmentVersion: 1,
						value: "slow",
					},
				],
			}).registry.version,
		).toBe(1);

		const journal = await createJournal();
		const service = makePolicyService(journal);
		const duplicateExit = await Effect.runPromiseExit(
			service.set({
				key: "core.providers.deny.providers",
				value: { providerIds: ["anthropic", "anthropic"] },
				scope: { kind: "global" },
				reason: "invalid duplicate deny",
			}),
		);
		expect(duplicateExit._tag).toBe("Failure");
		const excessExit = await Effect.runPromiseExit(
			service.set({
				key: "core.providers.deny.models",
				value: { models: [{ provider: "google", model: "gemini-2.5-pro", wildcard: true }] } as never,
				scope: { kind: "global" },
				reason: "invalid excess property",
			}),
		);
		expect(excessExit._tag).toBe("Failure");
		expect(await journal.replay()).toEqual([]);
	});
	it("rebuilds the SQLite projection identically and exposes immutable inspection surfaces", async () => {
		const journal = await createJournal();
		const projectionStore = new PolicyProjectionStore(journal.journalPath);
		const service = makePolicyService(journal, {}, projectionStore);
		const baseline = await Effect.runPromise(
			service.set({
				key: "core.routing.default",
				value: "openai/gpt-5.6",
				scope: { kind: "global" },
				reason: "global baseline",
				effectiveFrom: "2026-01-01T00:00:00.000Z",
			}),
		);
		await Effect.runPromise(
			service.set({
				key: "core.routing.default",
				value: "anthropic/claude-fable-5",
				scope: { kind: "workstream", workstream: "alpha" },
				reason: "alpha override",
				effectiveFrom: "2026-01-01T00:01:00.000Z",
			}),
		);
		const posture = await Effect.runPromise(
			service.set({
				key: "core.routing.default",
				value: "google/gemini-3-pro",
				scope: { kind: "global" },
				reason: "temporary incident route",
				effectiveFrom: "2026-01-01T00:02:00.000Z",
				expiresAt: "2099-01-01T00:00:00.000Z",
			}),
		);
		const at = "2027-01-01T00:00:00.000Z";
		const before = await Effect.runPromise(service.snapshot({ workstream: "alpha", at }));
		const journalBytes = await fs.readFile(journal.journalPath);
		const assertJournalUnchanged = async (): Promise<void> => {
			expect(await fs.readFile(journal.journalPath)).toEqual(journalBytes);
		};

		await Effect.runPromise(service.get("core.routing.default", { workstream: "alpha", at }));
		await assertJournalUnchanged();
		const explanation = await Effect.runPromise(
			service.explain("core.routing.default", { workstream: "alpha", at }),
		);
		expect(explanation.stack.map(entry => [entry.layer, entry.reason])).toEqual([
			["temporary-posture", "temporary incident route"],
			["workstream-durable", "alpha override"],
			["global-durable", "global baseline"],
		]);
		expect(explanation.stack).toEqual(
			explanation.stack.map(entry =>
				expect.objectContaining({
					author: expect.objectContaining({ kind: "cli" }),
					source: expect.objectContaining({ kind: "cli" }),
					effectiveFrom: expect.any(String),
					state: "active",
				}),
			),
		);
		await assertJournalUnchanged();

		const history = await Effect.runPromise(service.history({ key: "core.routing.default" }));
		expect(history.map(row => row.sequence)).toEqual([1, 2, 3]);
		expect(history.map(row => row.reason)).toEqual(["global baseline", "alpha override", "temporary incident route"]);
		await assertJournalUnchanged();

		const diff = await Effect.runPromise(service.diff({ from: "1", to: "3", workstream: "alpha" }));
		expect(diff.changes.map(change => change.key)).toEqual(["core.routing.default"]);
		await assertJournalUnchanged();

		const drift = await Effect.runPromise(
			service.drift(
				[{ sessionId: "session-behind", name: "Behind", workstream: "alpha", appliedSequence: 1 }],
				{ at },
			),
		);
		expect(drift).toEqual([
			expect.objectContaining({
				sessionId: "session-behind",
				appliedSequence: 1,
				headSequence: 3,
				rows: [
					expect.objectContaining({
						key: "core.routing.default",
						applied: { value: "openai/gpt-5.6", sequence: baseline.transaction.sequence },
						head: { value: "google/gemini-3-pro", sequence: posture.transaction.sequence },
					}),
				],
			}),
		]);
		await assertJournalUnchanged();

		const impact = await Effect.runPromise(
			service.impactSet(
				{
					key: "core.routing.qa",
					value: "openai/gpt-5.6",
					scope: { kind: "global" },
					reason: "preview QA route",
					effectiveFrom: at,
				},
				[
					{ sessionId: "session-behind", workstream: "alpha", appliedSequence: 1 },
					{ sessionId: "session-head", appliedSequence: 3 },
				],
			),
		);
		expect(impact.committed).toBe(false);
		expect(impact.sessions).toEqual([
			expect.objectContaining({ sessionId: "session-behind", keys: ["core.routing.qa"] }),
			expect.objectContaining({ sessionId: "session-head", keys: ["core.routing.qa"] }),
		]);
		expect((await journal.replay()).length).toBe(3);
		await assertJournalUnchanged();

		projectionStore.close();
		await fs.rm(projectionStore.dbPath, { force: true });
		const rebuilt = await Effect.runPromise(service.rebuildProjection({ workstream: "alpha", at }));
		expect(rebuilt).toEqual(before);
		await assertJournalUnchanged();
		expect(await Effect.runPromise(service.snapshot({ workstream: "alpha", at }))).toEqual(before);
		await assertJournalUnchanged();
	});
});
