import { afterEach, describe, expect, it } from "bun:test";
import * as fs from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";
import { collectImport, importMutations, runPolicyCommand } from "../../src/cli/policy-cli";

const temporaryDirectories: string[] = [];

async function temporaryDirectory(): Promise<string> {
	const directory = await fs.mkdtemp(path.join(os.tmpdir(), "omp-provider-policy-cli-"));
	temporaryDirectories.push(directory);
	return directory;
}

function fixedClock(iso: string, calls?: { count: number }): () => Date {
	return () => {
		if (calls) calls.count += 1;
		return new Date(iso);
	};
}

afterEach(async () => {
	for (const directory of temporaryDirectories.splice(0)) {
		await fs.rm(directory, { recursive: true, force: true });
	}
});

describe("provider policy CLI", () => {
	it("validates keys and strict provider JSON while preserving routing string values", async () => {
		const directory = await temporaryDirectory();
		const options = { directory, now: fixedClock("2026-01-01T10:00:00.000Z") };

		const providerResult = JSON.parse(
			await runPolicyCommand(
				{
					action: "set",
					key: "core.providers.deny.providers",
					value: '{"providerIds":["anthropic","openai"]}',
					json: true,
				},
				options,
			),
		);
		expect(providerResult.committed.transaction.mutations).toEqual([
			expect.objectContaining({
				key: "core.providers.deny.providers",
				value: { providerIds: ["anthropic", "openai"] },
			}),
		]);

		const modelResult = JSON.parse(
			await runPolicyCommand(
				{
					action: "set",
					key: "core.providers.deny.models",
					value: '{"models":[{"provider":"openai","model":"gpt-5.4"}]}',
					json: true,
				},
				options,
			),
		);
		expect(modelResult.committed.transaction.mutations).toEqual([
			expect.objectContaining({
				key: "core.providers.deny.models",
				value: { models: [{ provider: "openai", model: "gpt-5.4" }] },
			}),
		]);

		const routingResult = JSON.parse(
			await runPolicyCommand(
				{ action: "set", key: "core.routing.default", value: "openai/gpt-5.4", json: true },
				options,
			),
		);
		expect(routingResult.committed.transaction.mutations[0].value).toBe("openai/gpt-5.4");

		await expect(
			runPolicyCommand({ action: "set", key: "core.providers.unknown", value: "{}" }, options),
		).rejects.toThrow("Unknown policy key");
		await expect(
			runPolicyCommand({ action: "set", key: "core.providers.deny.providers", value: "not-json" }, options),
		).rejects.toThrow("requires a valid JSON object");
		await expect(
			runPolicyCommand({ action: "set", key: "core.providers.deny.providers", value: '["anthropic"]' }, options),
		).rejects.toThrow("requires a JSON object");
		await expect(
			runPolicyCommand(
				{
					action: "set",
					key: "core.providers.deny.providers",
					value: '{"providerIds":["anthropic"],"extra":true}',
				},
				options,
			),
		).rejects.toThrow(/extra|is unexpected/);
		await expect(
			runPolicyCommand(
				{
					action: "set",
					key: "core.providers.deny.models",
					value: '{"models":[{"provider":"openai","model":"gpt-5.4","extra":true}]}',
				},
				options,
			),
		).rejects.toThrow(/extra|is unexpected/);
	});

	it("canonicalizes effective and expiry timestamps and rejects invalid intervals", async () => {
		const directory = await temporaryDirectory();
		const options = { directory, now: fixedClock("2026-01-01T10:00:00.000Z") };
		const result = JSON.parse(
			await runPolicyCommand(
				{
					action: "set",
					key: "core.providers.deny.providers",
					value: '{"providerIds":["anthropic"]}',
					effectiveFrom: "2026-01-02T10:00:00Z",
					expiresIn: "90m",
					json: true,
				},
				options,
			),
		);
		expect(result.committed.transaction).toMatchObject({
			effectiveFrom: "2026-01-02T10:00:00.000Z",
			expiresAt: "2026-01-02T11:30:00.000Z",
		});

		const baseRequest = {
			action: "set" as const,
			key: "core.providers.deny.providers",
			value: '{"providerIds":["anthropic"]}',
		};
		await expect(
			runPolicyCommand({ ...baseRequest, expiresAt: "2026-01-01T11:00:00Z", expiresIn: "1h" }, options),
		).rejects.toThrow("cannot be used together");
		for (const expiresIn of ["0m", "-1h", "1.5h", "soon"]) {
			await expect(runPolicyCommand({ ...baseRequest, expiresIn }, options)).rejects.toThrow(
				"positive integer duration",
			);
		}
		await expect(runPolicyCommand({ ...baseRequest, effectiveFrom: "not-a-time" }, options)).rejects.toThrow(
			"--effective-from requires a valid timestamp",
		);
		await expect(runPolicyCommand({ ...baseRequest, expiresAt: "2026-01-01T10:00:00Z" }, options)).rejects.toThrow(
			"must be later",
		);
	});

	it("explains active and expired posture with deterministic countdowns from one clock reading", async () => {
		const directory = await temporaryDirectory();
		await runPolicyCommand(
			{
				action: "set",
				key: "core.providers.deny.providers",
				value: '{"providerIds":["anthropic"]}',
				effectiveFrom: "2026-01-01T10:00:00Z",
				expiresAt: "2026-01-01T11:00:00Z",
			},
			{ directory, now: fixedClock("2026-01-01T09:00:00.000Z") },
		);

		const activeCalls = { count: 0 };
		const active = JSON.parse(
			await runPolicyCommand(
				{ action: "explain", key: "core.providers.deny.providers" },
				{ directory, now: fixedClock("2026-01-01T10:30:00.000Z", activeCalls) },
			),
		);
		expect(activeCalls.count).toBe(1);
		expect(active).toMatchObject({ status: "active", countdownTo: "expiresAt", remainingMs: 1_800_000 });
		expect(active.entries).toEqual([
			expect.objectContaining({ state: "active", effective: true, remainingMs: 1_800_000 }),
		]);

		const expiredCalls = { count: 0 };
		const expired = JSON.parse(
			await runPolicyCommand(
				{ action: "explain", key: "core.providers.deny.providers", json: true },
				{ directory, now: fixedClock("2026-01-01T11:00:00.000Z", expiredCalls) },
			),
		);
		expect(expiredCalls.count).toBe(1);
		expect(expired).toMatchObject({ status: "expired", countdownTo: "none", remainingMs: 0 });
		expect(expired.entries).toEqual([
			expect.objectContaining({ state: "expired", effective: false, remainingMs: 0 }),
		]);
	});

	it("imports the existing global disabledProviders list as a typed provider deny", async () => {
		const directory = await temporaryDirectory();
		const configPath = path.join(directory, "config.yml");
		await fs.writeFile(
			configPath,
			"disabledProviders:\n  - anthropic\n  - openai\n  - anthropic\nmodelRoles:\n  default: openai/gpt-5.4\n",
		);
		const collected = await collectImport(configPath, []);
		const detail = importMutations(collected.candidates);
		expect(detail.mutations).toEqual(
			expect.arrayContaining([
				expect.objectContaining({
					key: "core.providers.deny.providers",
					value: { providerIds: ["anthropic", "openai"] },
				}),
			]),
		);
	});
});
