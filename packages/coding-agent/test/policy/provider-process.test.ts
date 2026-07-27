import { afterEach, describe, expect, it } from "bun:test";
import * as fs from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";

const roots: string[] = [];

interface TransactionObservation {
	transactionId: string;
	sequence: number;
	rollbackOf?: string;
}

interface JournalObservation {
	recordCount: number;
	bytes: number;
}

interface SeedResult {
	pid: number;
	journalPath: string;
	baseline: TransactionObservation;
	temporary: TransactionObservation;
	journal: JournalObservation;
}

interface ProviderWinnerObservation {
	value: { providerIds: string[] };
	sourceLayer: string;
	transactionId: string;
	sequence: number;
}

interface ProviderEntryObservation {
	state: string;
	effective: boolean;
	transactionId: string;
	sequence: number;
	effectiveFrom: string;
	expiresAt?: string;
	remainingMs?: number;
	sourceLayer: string;
}

interface ProviderMatchObservation {
	kind: string;
	key: string;
	entry: ProviderEntryObservation;
}

interface ProviderObservation {
	pid: number;
	at: string;
	journal: JournalObservation;
	deniedProviderIds: string[];
	winner?: ProviderWinnerObservation;
	entries: ProviderEntryObservation[];
	baselineDenied: boolean;
	incidentDenied: boolean;
	baselineMatches: ProviderMatchObservation[];
	incidentMatches: ProviderMatchObservation[];
	lastTransaction?: TransactionObservation;
}

interface RollbackResult {
	pid: number;
	transaction: TransactionObservation;
	journal: JournalObservation;
}

const SEED_SOURCE = String.raw`
import * as fs from "node:fs/promises";
import { Effect } from "effect";
import { PolicyJournal } from "@oh-my-pi/pi-coding-agent/policy/policy-journal";
import { makePolicyService } from "@oh-my-pi/pi-coding-agent/policy/policy-service";

const directory = process.env.POLICY_DIRECTORY;
if (!directory) throw new Error("missing provider policy seed directory");

const journal = await PolicyJournal.acquire({ directory });
try {
	const service = makePolicyService(journal);
	const baseline = await Effect.runPromise(service.set({
		key: "core.providers.deny.providers",
		value: { providerIds: ["baseline-provider"] },
		scope: { kind: "global" },
		reason: "establish prior provider posture",
		effectiveFrom: "2026-01-01T09:00:00.000Z",
	}));
	const temporary = await Effect.runPromise(service.set({
		key: "core.providers.deny.providers",
		value: { providerIds: ["incident-provider"] },
		scope: { kind: "global" },
		reason: "temporary provider incident",
		effectiveFrom: "2026-01-01T10:00:00.000Z",
		expiresAt: "2026-01-01T11:00:00.000Z",
	}));
	const stat = await fs.stat(journal.journalPath);
	console.log(JSON.stringify({
		pid: process.pid,
		journalPath: journal.journalPath,
		baseline: {
			transactionId: baseline.transaction.transactionId,
			sequence: baseline.transaction.sequence,
		},
		temporary: {
			transactionId: temporary.transaction.transactionId,
			sequence: temporary.transaction.sequence,
		},
		journal: { recordCount: (await journal.replay()).length, bytes: stat.size },
	}));
} finally {
	await journal.release();
}
process.exit(0);
`;

const READER_SOURCE = String.raw`
import * as fs from "node:fs/promises";
import { Effect } from "effect";
import { PolicyJournal } from "@oh-my-pi/pi-coding-agent/policy/policy-journal";
import {
	isProviderDenied,
	providerDenyMatches,
} from "@oh-my-pi/pi-coding-agent/policy/policy-projection";
import { makePolicyService } from "@oh-my-pi/pi-coding-agent/policy/policy-service";

const directory = process.env.POLICY_DIRECTORY;
const at = process.env.PROJECTION_AT;
if (!directory || !at) throw new Error("missing provider policy reader environment");

const journal = await PolicyJournal.acquire({ directory });
try {
	const snapshot = await Effect.runPromise(makePolicyService(journal).snapshot({ at }));
	const records = await journal.replay();
	const stat = await fs.stat(journal.journalPath);
	console.log(JSON.stringify({
		pid: process.pid,
		at: snapshot.at,
		journal: { recordCount: records.length, bytes: stat.size },
		deniedProviderIds: snapshot.providerPosture?.deniedProviderIds ?? [],
		winner: snapshot.providerPosture?.values["core.providers.deny.providers"],
		entries: snapshot.providerPosture?.entries.filter(entry => entry.key === "core.providers.deny.providers") ?? [],
		baselineDenied: isProviderDenied(snapshot, "baseline-provider"),
		incidentDenied: isProviderDenied(snapshot, "incident-provider"),
		baselineMatches: providerDenyMatches(snapshot, "baseline-provider", "model-a"),
		incidentMatches: providerDenyMatches(snapshot, "incident-provider", "model-b"),
		lastTransaction: records.at(-1),
	}));
} finally {
	await journal.release();
}
process.exit(0);
`;

const ROLLBACK_SOURCE = String.raw`
import * as fs from "node:fs/promises";
import { Effect } from "effect";
import { PolicyJournal } from "@oh-my-pi/pi-coding-agent/policy/policy-journal";
import { makePolicyService } from "@oh-my-pi/pi-coding-agent/policy/policy-service";

const directory = process.env.POLICY_DIRECTORY;
const transactionId = process.env.TRANSACTION_ID;
if (!directory || !transactionId) throw new Error("missing provider policy rollback environment");

const journal = await PolicyJournal.acquire({ directory });
try {
	const rollback = await Effect.runPromise(makePolicyService(journal).rollback({
		transactionId,
		reason: "restore prior provider posture",
		effectiveFrom: "2026-01-01T11:00:00.000Z",
	}));
	const stat = await fs.stat(journal.journalPath);
	console.log(JSON.stringify({
		pid: process.pid,
		transaction: {
			transactionId: rollback.transaction.transactionId,
			sequence: rollback.transaction.sequence,
			rollbackOf: rollback.transaction.rollbackOf,
		},
		journal: { recordCount: (await journal.replay()).length, bytes: stat.size },
	}));
} finally {
	await journal.release();
}
process.exit(0);
`;

function parseLastJsonLine<T>(stdout: string, label: string): T {
	const line = stdout.trim().split("\n").at(-1);
	if (!line) throw new Error(`${label} emitted no result`);
	try {
		return JSON.parse(line) as T;
	} catch {
		throw new Error(`${label} emitted invalid JSON`);
	}
}

async function runProcess<T>(source: string, environment: Record<string, string>, label: string): Promise<T> {
	const child = Bun.spawn({
		cmd: [process.execPath, "-e", source],
		cwd: path.resolve(import.meta.dir, "../.."),
		env: { ...process.env, ...environment },
		stdout: "pipe",
		stderr: "pipe",
	});
	const output = Promise.all([new Response(child.stdout).text(), new Response(child.stderr).text()]);
	const exit = await Promise.race([
		child.exited.then(exitCode => ({ kind: "exit" as const, exitCode })),
		Bun.sleep(8_000).then(() => ({ kind: "timeout" as const })),
	]);
	if (exit.kind === "timeout") {
		try {
			child.kill("SIGKILL");
		} catch {}
		await child.exited;
	}
	const [stdout, stderr] = await output;
	if (exit.kind === "timeout") throw new Error(`${label} timed out after 8000ms; stderr=${stderr}`);
	if (exit.exitCode !== 0) throw new Error(`${label} failed (${exit.exitCode}): ${stderr}`);
	return parseLastJsonLine<T>(stdout, label);
}

afterEach(async () => {
	await Promise.all(roots.splice(0).map(root => fs.rm(root, { recursive: true, force: true })));
});

describe("provider posture process observation", () => {
	it("observes temporary deny activation, passive expiry, and rollback across independent processes", async () => {
		const root = await fs.mkdtemp(path.join(os.tmpdir(), "omp-provider-policy-process-"));
		roots.push(root);
		const policyDirectory = path.join(root, "policy");
		const environment = { POLICY_DIRECTORY: policyDirectory };

		const seed = await runProcess<SeedResult>(SEED_SOURCE, environment, "provider policy seed process");
		const prior = await runProcess<ProviderObservation>(
			READER_SOURCE,
			{ ...environment, PROJECTION_AT: "2026-01-01T09:30:00.000Z" },
			"prior posture reader process",
		);
		const active = await runProcess<ProviderObservation>(
			READER_SOURCE,
			{ ...environment, PROJECTION_AT: "2026-01-01T10:30:00.000Z" },
			"active posture reader process",
		);
		const expired = await runProcess<ProviderObservation>(
			READER_SOURCE,
			{ ...environment, PROJECTION_AT: "2026-01-01T11:00:00.000Z" },
			"expired posture reader process",
		);

		expect(seed.journalPath).toBe(path.join(policyDirectory, "policy-v1.jsonl"));
		expect(seed.baseline.sequence).toBe(1);
		expect(seed.temporary.sequence).toBe(2);
		expect(new Set([seed.pid, prior.pid, active.pid, expired.pid]).size).toBe(4);
		expect(prior).toMatchObject({
			at: "2026-01-01T09:30:00.000Z",
			deniedProviderIds: ["baseline-provider"],
			baselineDenied: true,
			incidentDenied: false,
			winner: {
				value: { providerIds: ["baseline-provider"] },
				sourceLayer: "global-durable",
				transactionId: seed.baseline.transactionId,
				sequence: 1,
			},
		});
		expect(prior.baselineMatches).toEqual([
			expect.objectContaining({
				kind: "provider",
				key: "core.providers.deny.providers",
				entry: expect.objectContaining({ transactionId: seed.baseline.transactionId, sequence: 1 }),
			}),
		]);
		expect(prior.incidentMatches).toEqual([]);

		expect(active).toMatchObject({
			at: "2026-01-01T10:30:00.000Z",
			deniedProviderIds: ["incident-provider"],
			baselineDenied: false,
			incidentDenied: true,
			winner: {
				value: { providerIds: ["incident-provider"] },
				sourceLayer: "temporary-posture",
				transactionId: seed.temporary.transactionId,
				sequence: 2,
			},
		});
		expect(active.incidentMatches).toEqual([
			expect.objectContaining({
				kind: "provider",
				key: "core.providers.deny.providers",
				entry: expect.objectContaining({
					state: "active",
					effective: true,
					transactionId: seed.temporary.transactionId,
					sequence: 2,
					effectiveFrom: "2026-01-01T10:00:00.000Z",
					expiresAt: "2026-01-01T11:00:00.000Z",
					remainingMs: 1_800_000,
					sourceLayer: "temporary-posture",
				}),
			}),
		]);
		expect(active.baselineMatches).toEqual([]);

		expect(expired).toMatchObject({
			at: "2026-01-01T11:00:00.000Z",
			deniedProviderIds: ["baseline-provider"],
			baselineDenied: true,
			incidentDenied: false,
			winner: {
				value: { providerIds: ["baseline-provider"] },
				sourceLayer: "global-durable",
				transactionId: seed.baseline.transactionId,
				sequence: 1,
			},
		});
		expect(expired.entries).toContainEqual(
			expect.objectContaining({
				state: "expired",
				effective: false,
				transactionId: seed.temporary.transactionId,
				sequence: 2,
				remainingMs: 0,
			}),
		);
		expect(expired.incidentMatches).toEqual([]);
		expect(expired.baselineMatches).toEqual(prior.baselineMatches);
		expect(prior.journal).toEqual(seed.journal);
		expect(active.journal).toEqual(seed.journal);
		expect(expired.journal).toEqual(seed.journal);

		const rollback = await runProcess<RollbackResult>(
			ROLLBACK_SOURCE,
			{ ...environment, TRANSACTION_ID: seed.temporary.transactionId },
			"provider policy rollback process",
		);
		const restored = await runProcess<ProviderObservation>(
			READER_SOURCE,
			{ ...environment, PROJECTION_AT: "2026-01-01T11:01:00.000Z" },
			"restored posture reader process",
		);

		expect(new Set([seed.pid, prior.pid, active.pid, expired.pid, rollback.pid, restored.pid]).size).toBe(6);
		expect(rollback.transaction).toMatchObject({
			sequence: 3,
			rollbackOf: seed.temporary.transactionId,
		});
		expect(rollback.journal.recordCount).toBe(3);
		expect(rollback.journal.bytes).toBeGreaterThan(seed.journal.bytes);
		expect(restored).toMatchObject({
			at: "2026-01-01T11:01:00.000Z",
			journal: rollback.journal,
			deniedProviderIds: prior.deniedProviderIds,
			baselineDenied: prior.baselineDenied,
			incidentDenied: prior.incidentDenied,
			winner: {
				value: { providerIds: ["baseline-provider"] },
				sourceLayer: "global-durable",
				transactionId: rollback.transaction.transactionId,
				sequence: 3,
			},
			lastTransaction: rollback.transaction,
		});
		expect(restored.baselineMatches).toEqual([
			expect.objectContaining({
				kind: "provider",
				entry: expect.objectContaining({
					transactionId: rollback.transaction.transactionId,
					sequence: 3,
				}),
			}),
		]);
		expect(restored.incidentMatches).toEqual([]);
	}, 30_000);
});
