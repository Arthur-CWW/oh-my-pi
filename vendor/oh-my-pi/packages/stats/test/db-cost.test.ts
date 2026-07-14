import { Database } from "bun:sqlite";
import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import * as os from "node:os";
import * as path from "node:path";
import { closeDb, getRecentRequests, initDb, insertMessageStats } from "@oh-my-pi/omp-stats/db";
import type { MessageStats } from "@oh-my-pi/omp-stats/types";
import { getBundledModel } from "@oh-my-pi/pi-catalog/models";
import { getAgentDir, getStatsDbPath, setAgentDir, TempDir } from "@oh-my-pi/pi-utils";

const originalConfigDir = process.env.PI_CONFIG_DIR;
const originalAgentDir = getAgentDir();
let tempDir: TempDir | null = null;

beforeEach(() => {
	tempDir = TempDir.createSync("@pi-stats-db-");
	const configDir = path.relative(os.homedir(), tempDir.join("config"));
	process.env.PI_CONFIG_DIR = configDir;
	setAgentDir(path.join(os.homedir(), configDir, "agent"));
});

afterEach(() => {
	closeDb();
	if (originalConfigDir === undefined) {
		delete process.env.PI_CONFIG_DIR;
	} else {
		process.env.PI_CONFIG_DIR = originalConfigDir;
	}
	setAgentDir(originalAgentDir);
	tempDir?.removeSync();
	tempDir = null;
});

const TOKENS = { input: 1000, output: 500, cacheRead: 200, cacheWrite: 100 };

function createCodexStats(entryId: string, model: string): MessageStats {
	return {
		sessionFile: "/tmp/session.jsonl",
		entryId,
		folder: "/tmp/project",
		model,
		provider: "openai-codex",
		api: "openai-codex-responses",
		timestamp: Date.now(),
		duration: 1000,
		ttft: 100,
		stopReason: "stop",
		errorMessage: null,
		usage: {
			...TOKENS,
			totalTokens: TOKENS.input + TOKENS.output + TOKENS.cacheRead + TOKENS.cacheWrite,
			cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
		},
	};
}

function expectedCost(rates: { input: number; output: number; cacheRead: number; cacheWrite: number }) {
	const input = (rates.input / 1_000_000) * TOKENS.input;
	const output = (rates.output / 1_000_000) * TOKENS.output;
	const cacheRead = (rates.cacheRead / 1_000_000) * TOKENS.cacheRead;
	const cacheWrite = (rates.cacheWrite / 1_000_000) * TOKENS.cacheWrite;
	return { input, output, cacheRead, cacheWrite, total: input + output + cacheRead + cacheWrite };
}

function expectStoredCost(model: string, rates: Parameters<typeof expectedCost>[0]) {
	const request = getRecentRequests(10).find(candidate => candidate.model === model);
	const expected = expectedCost(rates);
	expect(request?.usage.cost.input).toBeCloseTo(expected.input, 8);
	expect(request?.usage.cost.output).toBeCloseTo(expected.output, 8);
	expect(request?.usage.cost.cacheRead).toBeCloseTo(expected.cacheRead, 8);
	expect(request?.usage.cost.cacheWrite).toBeCloseTo(expected.cacheWrite, 8);
	expect(request?.usage.cost.total).toBeCloseTo(expected.total, 8);
	return expected;
}

function insertRawZeroCost(database: Database, stats: MessageStats): void {
	database
		.prepare(`
			INSERT INTO messages (
				session_file, entry_id, folder, model, provider, api, timestamp,
				duration, ttft, stop_reason, error_message,
				input_tokens, output_tokens, cache_read_tokens, cache_write_tokens, total_tokens, premium_requests,
				cost_input, cost_output, cost_cache_read, cost_cache_write, cost_total
			) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
		`)
		.run(
			stats.sessionFile,
			stats.entryId,
			stats.folder,
			stats.model,
			stats.provider,
			stats.api,
			stats.timestamp,
			stats.duration,
			stats.ttft,
			stats.stopReason,
			stats.errorMessage,
			stats.usage.input,
			stats.usage.output,
			stats.usage.cacheRead,
			stats.usage.cacheWrite,
			stats.usage.totalTokens,
			stats.usage.premiumRequests ?? 0,
			0,
			0,
			0,
			0,
			0,
		);
}

describe("stats GPT cost correction", () => {
	it("stores catalog-derived cost when OpenAI Codex session usage has zero cost", async () => {
		await initDb();
		insertMessageStats([createCodexStats("catalog", "gpt-5.4")]);

		const rates = getBundledModel("openai-codex", "gpt-5.4").cost;
		expect(expectedCost(rates).total).toBeGreaterThan(0);
		expectStoredCost("gpt-5.4", rates);
	});

	it("resolves the zero-priced gpt-5-codex-mini alias to Luna pricing", async () => {
		expect(getBundledModel("openai-codex", "gpt-5-codex-mini").cost).toEqual({
			input: 0,
			output: 0,
			cacheRead: 0,
			cacheWrite: 0,
		});
		await initDb();
		insertMessageStats([createCodexStats("alias", "gpt-5-codex-mini")]);

		expectStoredCost("gpt-5-codex-mini", { input: 1, output: 6, cacheRead: 0.1, cacheWrite: 1.25 });
	});

	it("uses the GPT-5.6 family price", async () => {
		await initDb();
		insertMessageStats([createCodexStats("terra", "gpt-5.6-terra")]);

		expectStoredCost("gpt-5.6-terra", { input: 2.5, output: 15, cacheRead: 0.25, cacheWrite: 3.125 });
	});

	it("leaves an unknown zero-priced model at zero", async () => {
		await initDb();
		insertMessageStats([createCodexStats("unknown", "gpt-unknown-unpriced")]);

		const request = getRecentRequests(1)[0];
		expect(request?.usage.cost).toEqual({ input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 });
	});

	it("runs resolver-backed backfill once when its version changes", async () => {
		await initDb();
		closeDb();

		const database = new Database(getStatsDbPath());
		insertRawZeroCost(database, createCodexStats("backfilled", "gpt-5-codex-mini"));
		database
			.prepare(`
				INSERT INTO meta (key, value) VALUES ('cost_backfill_version', '1')
				ON CONFLICT(key) DO UPDATE SET value = excluded.value
			`)
			.run();
		database.close();

		await initDb();
		const expected = expectStoredCost("gpt-5-codex-mini", {
			input: 1,
			output: 6,
			cacheRead: 0.1,
			cacheWrite: 1.25,
		});
		closeDb();

		const versionDatabase = new Database(getStatsDbPath());
		const version = versionDatabase
			.prepare("SELECT value FROM meta WHERE key = 'cost_backfill_version'")
			.get() as { value: string };
		expect(version.value).toBe("2");
		insertRawZeroCost(versionDatabase, createCodexStats("after-version", "gpt-5-codex-mini"));
		versionDatabase.close();

		await initDb();
		const requests = getRecentRequests(10);
		const backfilled = requests.find(request => request.entryId === "backfilled");
		const afterVersion = requests.find(request => request.entryId === "after-version");
		expect(backfilled?.usage.cost.total).toBeCloseTo(expected.total, 8);
		expect(afterVersion?.usage.cost.total).toBe(0);
	});
});
