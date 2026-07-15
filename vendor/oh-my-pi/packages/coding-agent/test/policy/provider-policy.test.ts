import { afterEach, describe, expect, it } from "bun:test";
import * as fs from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";
import { Effect } from "effect";
import { PolicyJournal } from "../../src/policy/policy-journal";
import { isModelDenied, isProviderDenied } from "../../src/policy/policy-projection";
import { makePolicyService } from "../../src/policy/policy-service";
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
});
