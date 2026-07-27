import { afterEach, describe, expect, it } from "bun:test";
import { randomUUID } from "node:crypto";
import * as fs from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";
import { collectImport, importMutations, runPolicyCommand } from "../../src/cli/policy-cli";
import { IrcExternalBus } from "../../src/irc/bus-external";
import { SessionControlBus } from "../../src/session/session-control";

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

	it("dry-runs and applies the HR-176 Claude provider-route deny with visible provenance", async () => {
		const directory = await temporaryDirectory();
		const options = { directory, now: fixedClock("2026-07-17T23:00:00.000Z") };
		const request = {
			action: "set" as const,
			key: "core.providers.deny.routes",
			value: '{"routes":[{"provider":"google-antigravity","modelFamily":"claude"},{"provider":"google-vertex","modelFamily":"claude"}]}',
			author: "fable-overnight",
			source: "HR-176",
			reason: "Arthur 2026-07-17: deny Claude on Antigravity and GCP/Vertex provider routes",
			json: true,
		};

		const dryRun = JSON.parse(await runPolicyCommand({ ...request, dryRun: true }, options));
		expect(dryRun).toMatchObject({
			committed: false,
			transaction: {
				author: { kind: "cli", sessionId: "fable-overnight" },
				source: { kind: "cli", uri: "HR-176" },
				reason: expect.stringContaining("Arthur 2026-07-17"),
				registry: { version: 4 },
				mutations: [
					{
						key: "core.providers.deny.routes",
						fragmentVersion: 2,
						value: {
							routes: [
								{ provider: "google-antigravity", modelFamily: "claude" },
								{ provider: "google-vertex", modelFamily: "claude" },
							],
						},
					},
				],
			},
		});

		const applied = JSON.parse(await runPolicyCommand(request, options));
		expect(applied.committed).toMatchObject({
			committed: true,
			transaction: {
				author: expect.objectContaining({ sessionId: "fable-overnight" }),
				source: { kind: "cli", uri: "HR-176" },
				reason: expect.stringContaining("Arthur 2026-07-17"),
			},
		});
		const get = JSON.parse(
			await runPolicyCommand({ action: "get", key: "core.providers.deny.routes", json: true }, options),
		);
		expect(get).toMatchObject({
			key: "core.providers.deny.routes",
			value: {
				routes: [
					{ provider: "google-antigravity", modelFamily: "claude" },
					{ provider: "google-vertex", modelFamily: "claude" },
				],
			},
		});
		const explain = JSON.parse(
			await runPolicyCommand({ action: "explain", key: "core.providers.deny.routes", json: true }, options),
		);
		expect(explain).toMatchObject({
			key: "core.providers.deny.routes",
			status: "active",
			stack: [
				expect.objectContaining({
					author: expect.objectContaining({ sessionId: "fable-overnight" }),
					source: { kind: "cli", uri: "HR-176" },
					reason: expect.stringContaining("Arthur 2026-07-17"),
				}),
			],
		});
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

	it("surfaces history, sequence diff, drift, impact, rebuild, and dry-run rollback without journal writes", async () => {
		const directory = await temporaryDirectory();
		const options = {
			directory,
			now: fixedClock("2026-01-01T10:00:00.000Z"),
			liveSessions: () => [{ sessionId: "session-behind", name: "Behind", workstream: "alpha", appliedSequence: 1 }],
		};
		await runPolicyCommand(
			{ action: "set", key: "core.routing.default", value: "openai/gpt-5.6", reason: "baseline" },
			options,
		);
		const replacement = JSON.parse(
			await runPolicyCommand(
				{
					action: "set",
					key: "core.routing.default",
					value: "anthropic/claude-fable-5",
					reason: "replacement",
					json: true,
				},
				options,
			),
		);
		const journalPath = path.join(directory, "policy-v1.jsonl");
		const journalBytes = await fs.readFile(journalPath);
		const assertJournalUnchanged = async (): Promise<void> => {
			expect(await fs.readFile(journalPath)).toEqual(journalBytes);
		};

		const explanation = JSON.parse(
			await runPolicyCommand({ action: "explain", key: "core.routing.default", json: true }, options),
		);
		expect(explanation.stack.map((entry: { reason: string }) => entry.reason)).toEqual(["replacement", "baseline"]);
		await assertJournalUnchanged();

		const history = JSON.parse(
			await runPolicyCommand({ action: "history", key: "core.routing.default", json: true }, options),
		);
		expect(history.map((row: { sequence: number }) => row.sequence)).toEqual([1, 2]);
		await assertJournalUnchanged();

		const diff = JSON.parse(await runPolicyCommand({ action: "diff", from: "1", to: "2", json: true }, options));
		expect(diff.changes.map((change: { key: string }) => change.key)).toEqual(["core.routing.default"]);
		await assertJournalUnchanged();

		const drift = JSON.parse(await runPolicyCommand({ action: "drift", json: true }, options));
		expect(drift).toEqual([
			expect.objectContaining({
				sessionId: "session-behind",
				rows: [expect.objectContaining({ key: "core.routing.default" })],
			}),
		]);
		await assertJournalUnchanged();

		const impact = JSON.parse(
			await runPolicyCommand(
				{ action: "impact", key: "core.routing.qa", value: "openai/gpt-5.6", json: true },
				options,
			),
		);
		expect(impact).toMatchObject({
			committed: false,
			sessions: [{ sessionId: "session-behind", keys: ["core.routing.qa"] }],
		});
		await assertJournalUnchanged();

		const rollbackPreview = JSON.parse(
			await runPolicyCommand(
				{
					action: "rollback",
					transactionId: replacement.committed.transaction.transactionId,
					dryRun: true,
					json: true,
				},
				options,
			),
		);
		expect(rollbackPreview.committed).toBe(false);
		await assertJournalUnchanged();

		const rebuilt = JSON.parse(await runPolicyCommand({ action: "rebuild", json: true }, options));
		expect(rebuilt.transactions).toHaveLength(2);
		await assertJournalUnchanged();
	});

	it("derives applied sequence from real fleet and policy-apply receipts", async () => {
		const directory = await temporaryDirectory();
		const ircDbPath = path.join(directory, "irc.sqlite");
		const controlDbPath = path.join(directory, "session-control.sqlite");
		const options = {
			directory,
			ircDbPath,
			controlDbPath,
			now: fixedClock("2026-01-01T10:00:00.000Z"),
		};
		const baseline = JSON.parse(
			await runPolicyCommand(
				{ action: "set", key: "core.routing.default", value: "openai/gpt-5.6", json: true },
				options,
			),
		).committed.transaction;
		await runPolicyCommand(
			{ action: "set", key: "core.routing.default", value: "anthropic/claude-fable-5" },
			options,
		);

		const ownerEpoch = randomUUID();
		const ircBus = new IrcExternalBus(ircDbPath);
		ircBus.registerPeer({
			sessionId: "session-receipt",
			name: "ReceiptPeer",
			cwd: directory,
			pid: process.pid,
			ownerEpoch,
		});
		ircBus.close();

		const controlBus = new SessionControlBus(controlDbPath);
		controlBus.bindTarget("session-receipt", ownerEpoch);
		const commandId = randomUUID();
		controlBus.request({
			schemaVersion: 2,
			commandId,
			source: { kind: "local-cli", instanceId: randomUUID(), pid: process.pid, uid: process.getuid?.() ?? 0 },
			sessionId: "session-receipt",
			targetOwnerEpoch: ownerEpoch,
			requestedAt: "2026-01-01T10:00:00.000Z",
			intent: {
				kind: "policy-apply",
				policyTransactionId: baseline.transactionId,
				policySequence: baseline.sequence,
				policyHeadHash: baseline.recordHash,
				expectedAppliedSequence: 0,
				impactedPolicyClasses: ["next-operation"],
			},
		});
		expect(controlBus.claimNext("session-receipt", ownerEpoch)?.commandId).toBe(commandId);
		controlBus.complete(commandId, ownerEpoch, { result: "applied", appliedSequence: baseline.sequence });
		controlBus.close();

		const drift = JSON.parse(await runPolicyCommand({ action: "drift", json: true }, options));
		expect(drift).toEqual([
			expect.objectContaining({
				sessionId: "session-receipt",
				name: "ReceiptPeer",
				appliedSequence: 1,
				headSequence: 2,
				rows: [
					expect.objectContaining({
						key: "core.routing.default",
						applied: expect.objectContaining({ sequence: 1 }),
						head: expect.objectContaining({ sequence: 2 }),
					}),
				],
			}),
		]);
	});
});
