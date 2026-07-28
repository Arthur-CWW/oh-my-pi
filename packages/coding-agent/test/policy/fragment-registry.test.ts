import { afterEach, describe, expect, it } from "bun:test";
import * as fs from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";
import { Effect, Schema } from "effect";
import { FragmentRegistrationError, PolicyFragmentRegistry } from "../../src/policy/policy-fragment-registry";
import { POLICY_REGISTRY_DIGEST, PolicyJournal } from "../../src/policy/policy-journal";
import { makePolicyService } from "../../src/policy/policy-service";
import { exportPolicyFragments, importPolicyFragments } from "../../src/policy/policy-yaml";

const temporaryDirectories: string[] = [];
const openJournals: PolicyJournal[] = [];

async function createJournal(): Promise<PolicyJournal> {
	const directory = await fs.mkdtemp(path.join(os.tmpdir(), "omp-policy-fragments-"));
	temporaryDirectories.push(directory);
	const journal = await PolicyJournal.acquire({ directory });
	openJournals.push(journal);
	return journal;
}

function registryV1(): PolicyFragmentRegistry {
	const registry = new PolicyFragmentRegistry(POLICY_REGISTRY_DIGEST);
	registry.register({
		namespace: "ext.acme",
		registration: "acme-theme",
		version: 1,
		schema: Schema.Struct({ color: Schema.String }),
	});
	return registry;
}

function registryV2(): PolicyFragmentRegistry {
	const registry = new PolicyFragmentRegistry(POLICY_REGISTRY_DIGEST);
	registry.register({
		namespace: "ext.acme",
		registration: "acme-theme",
		version: 2,
		schema: Schema.Struct({ color: Schema.String, contrast: Schema.Boolean }),
		migrations: {
			1: value => {
				if (typeof value !== "object" || value === null || Array.isArray(value))
					throw new Error("expected v1 object");
				return { ...value, contrast: false };
			},
		},
	});
	return registry;
}

afterEach(async () => {
	for (const journal of openJournals.splice(0)) await journal.release();
	for (const directory of temporaryDirectories.splice(0)) await fs.rm(directory, { recursive: true, force: true });
});

describe("extension policy fragment registry", () => {
	it("registers and participates in set, get, explain, diff, import, and export with provenance", async () => {
		const journal = await createJournal();
		const registry = registryV1();
		const service = makePolicyService(journal, { fragmentRegistry: registry });
		const set = await Effect.runPromise(
			service.set({
				key: "ext.acme.theme",
				value: { color: "amber" },
				scope: { kind: "global" },
				reason: "select extension theme",
			}),
		);

		expect(await Effect.runPromise(service.get("ext.acme.theme"))).toMatchObject({
			value: { color: "amber" },
			registration: "acme-theme",
			fragmentVersion: 1,
			transactionId: set.transaction.transactionId,
		});
		const explanation = await Effect.runPromise(service.explain("ext.acme.theme"));
		expect(explanation.stack[0]).toMatchObject({
			projectionStatus: "active",
			registration: "acme-theme",
			reason: "select extension theme",
		});
		expect((await Effect.runPromise(service.diff({ from: "0", to: "1" }))).changes).toEqual([
			expect.objectContaining({
				key: "ext.acme.theme",
				after: expect.objectContaining({ value: { color: "amber" } }),
			}),
		]);

		const exported = exportPolicyFragments(await journal.replay(), registry);
		expect(exported.fragments["ext.acme.theme"]?.provenance).toMatchObject({
			transactionId: set.transaction.transactionId,
			reason: "select extension theme",
		});
		const imported = importPolicyFragments(exported, registry, { sourcePath: "fragment-export.json" });
		expect(imported.mutations).toEqual([
			expect.objectContaining({ key: "ext.acme.theme", fragmentVersion: 1, value: { color: "amber" } }),
		]);
	});

	it("rejects namespace collisions and core shadowing with typed errors", () => {
		const registry = registryV1();
		expect(() =>
			registry.register({
				namespace: "ext.acme.theme",
				registration: "other-owner",
				version: 1,
				schema: Schema.Struct({ enabled: Schema.Boolean }),
			}),
		).toThrow(FragmentRegistrationError);
		try {
			registry.register({
				namespace: "core.routing" as "ext.routing",
				registration: "shadow-owner",
				version: 1,
				schema: Schema.String,
			});
			expect.unreachable();
		} catch (error) {
			expect(error).toMatchObject({ _tag: "FragmentRegistrationError", reason: "core-shadow" });
		}
	});

	it("purely migrates v1 journal values to v2 without rewriting journal bytes", async () => {
		const journal = await createJournal();
		await Effect.runPromise(
			makePolicyService(journal, { fragmentRegistry: registryV1() }).set({
				key: "ext.acme.theme",
				value: { color: "blue" },
				scope: { kind: "global" },
				reason: "old plugin value",
			}),
		);
		const before = await fs.readFile(journal.journalPath);
		const projected = await Effect.runPromise(
			makePolicyService(journal, { fragmentRegistry: registryV2() }).get("ext.acme.theme"),
		);
		const after = await fs.readFile(journal.journalPath);

		expect(projected).toMatchObject({
			value: { color: "blue", contrast: false },
			fragmentVersion: 2,
			registration: "acme-theme",
		});
		expect(after.equals(before)).toBe(true);
		expect((await journal.replay())[0]?.mutations[0]).toMatchObject({
			fragmentVersion: 1,
			value: { color: "blue" },
		});
	});

	it("preserves unregistered mutations as inert provenance in history and explain", async () => {
		const journal = await createJournal();
		await Effect.runPromise(
			makePolicyService(journal, { fragmentRegistry: registryV1() }).set({
				key: "ext.acme.theme",
				value: { color: "violet" },
				scope: { kind: "global" },
				reason: "plugin later absent",
			}),
		);
		const absentService = makePolicyService(journal);
		expect(await Effect.runPromise(absentService.get("ext.acme.theme"))).toBeUndefined();
		const explanation = await Effect.runPromise(absentService.explain("ext.acme.theme"));
		expect(explanation.stack[0]).toMatchObject({
			value: { color: "violet" },
			projectionStatus: "unregistered",
			storedVersion: 1,
		});
		expect(await Effect.runPromise(absentService.history({ key: "ext.acme.theme" }))).toHaveLength(1);
	});

	it("keeps newer-version mutations inert with an explicit notice", async () => {
		const journal = await createJournal();
		await Effect.runPromise(
			makePolicyService(journal, { fragmentRegistry: registryV2() }).set({
				key: "ext.acme.theme",
				value: { color: "green", contrast: true },
				scope: { kind: "global" },
				reason: "new plugin value",
			}),
		);
		const oldService = makePolicyService(journal, { fragmentRegistry: registryV1() });
		expect(await Effect.runPromise(oldService.get("ext.acme.theme"))).toBeUndefined();
		const explanation = await Effect.runPromise(oldService.explain("ext.acme.theme"));
		expect(explanation.stack[0]).toMatchObject({
			projectionStatus: "newer-version",
			storedVersion: 2,
			currentVersion: 1,
		});
		expect("notices" in explanation ? explanation.notices[0] : undefined).toMatchObject({
			status: "newer-version",
			storedVersion: 2,
			currentVersion: 1,
		});
	});

	it("rejects excess properties with the property path and governing registration", async () => {
		const journal = await createJournal();
		const service = makePolicyService(journal, { fragmentRegistry: registryV1() });
		const error = await Effect.runPromise(
			Effect.flip(
				service.set({
					key: "ext.acme.theme",
					value: { color: "amber", nested: { surprise: true } },
					scope: { kind: "global" },
					reason: "invalid extension value",
				}),
			),
		);
		expect(error).toMatchObject({
			_tag: "FragmentValueError",
			propertyPath: "$.nested",
			registration: "acme-theme",
		});
		expect(await journal.replay()).toEqual([]);
	});
});
