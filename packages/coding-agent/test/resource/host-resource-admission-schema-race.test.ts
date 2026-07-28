import { Database } from "bun:sqlite";
import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import * as fs from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";
import { HostResourceAdmission } from "@oh-my-pi/pi-coding-agent/resource/host-resource-admission";

/**
 * Regression cover for the cross-process defect the nixbox load run reproduced.
 *
 * `#initializeSchema` used to `SELECT schema_version` and then `INSERT` the singleton
 * `resource_pool_state` row in two separate autocommit transactions. Every process that opened
 * the same cold authority concurrently observed "no row", and every one of them then inserted;
 * SQLite serialized the writes, one won, and the rest died with
 * `UNIQUE constraint failed: resource_pool_state.id`, surfaced as
 * `HostAdmissionRejectedError("authority-unavailable")` — a hard startup failure for that
 * coordinator (11/160 opens across 9/20 trials in the field reproduction).
 *
 * These cases run real OS processes against one real SQLite file. Nothing is mocked. The
 * handshake is a kernel barrier rather than a delay, so every process reaches the
 * check-and-create inside the same scheduler tick.
 */

const PACKAGE_ROOT = path.resolve(import.meta.dir, "..", "..");
const FIXTURE = path.join(import.meta.dir, "fixtures", "cold-open-authority.ts");
const CONCURRENCY = 8;
const GIB = 1_073_741_824;

interface OpenOutcome {
	readonly exitCode: number;
	readonly ok: boolean;
	readonly name?: string;
	readonly reason?: string | null;
	readonly message?: string;
}

interface PoolStateRow {
	readonly id: number;
	readonly schema_version: number;
	readonly next_ticket: number;
	readonly next_fence_token: number;
	readonly grant_sequence: number;
	readonly pressure_state: string;
	readonly pressure_epoch: number;
	readonly receipts_json: string;
}

/** Reads one newline-delimited record at a time off a child's stdout, awaiting the real event. */
function lineReader(stream: ReadableStream<Uint8Array>): () => Promise<string> {
	const reader = stream.getReader();
	const decoder = new TextDecoder();
	let buffer = "";
	let ended = false;
	return async function nextLine(): Promise<string> {
		for (;;) {
			const newline = buffer.indexOf("\n");
			if (newline >= 0) {
				const line = buffer.slice(0, newline);
				buffer = buffer.slice(newline + 1);
				return line;
			}
			if (ended) throw new Error(`child stdout ended before a line arrived: ${JSON.stringify(buffer)}`);
			const chunk = await reader.read();
			if (chunk.done) ended = true;
			else buffer += decoder.decode(chunk.value, { stream: true });
		}
	};
}

/**
 * The schema exactly as SQLite stores it. Comparing a raced authority against an uncontended one
 * asserts convergence without restating any DDL here, so the check cannot drift out of date as
 * the schema legitimately grows.
 */
function schemaFingerprint(dbPath: string): string[] {
	const audit = new Database(dbPath);
	try {
		return audit
			.query<{ type: string; name: string; sql: string | null }, []>(
				`SELECT type, name, sql FROM sqlite_master
				 WHERE name LIKE 'resource\\_%' ESCAPE '\\' OR name LIKE 'idx\\_resource\\_%' ESCAPE '\\'
				 ORDER BY type, name`,
			)
			.all()
			.map(row => `${row.type} ${row.name} :: ${(row.sql ?? "").replace(/\s+/g, " ").trim()}`);
	} finally {
		audit.close();
	}
}

function poolStateRows(dbPath: string): PoolStateRow[] {
	const audit = new Database(dbPath);
	try {
		return audit
			.query<PoolStateRow, []>(
				`SELECT id, schema_version, next_ticket, next_fence_token, grant_sequence,
				        pressure_state, pressure_epoch, receipts_json
				 FROM resource_pool_state ORDER BY id`,
			)
			.all();
	} finally {
		audit.close();
	}
}

function integrityCheck(dbPath: string): string {
	const audit = new Database(dbPath);
	try {
		return audit.query<{ integrity_check: string }, []>("PRAGMA integrity_check").get()!.integrity_check;
	} finally {
		audit.close();
	}
}

describe("HostResourceAdmission cross-process schema initialization", () => {
	let root: string;
	let referenceSchema: string[];
	let referenceState: PoolStateRow[];
	let previousHome: string | undefined;
	let previousControlDb: string | undefined;
	let previousAuthorityDb: string | undefined;

	beforeEach(async () => {
		root = await fs.mkdtemp(path.join(os.tmpdir(), "omp-admission-schema-race-"));
		previousHome = process.env.HOME;
		previousControlDb = process.env.OMP_SESSION_CONTROL_DB;
		previousAuthorityDb = process.env.OMP_RESOURCE_AUTHORITY_DB;
		process.env.HOME = root;
		process.env.OMP_SESSION_CONTROL_DB = path.join(root, "session-control.sqlite");
		process.env.OMP_RESOURCE_AUTHORITY_DB = path.join(root, "unused-authority.sqlite");
		// One uncontended initializer defines what "converged" means for every raced authority.
		const referenceDbPath = path.join(root, "reference", "resource-authority.sqlite");
		openAuthority(referenceDbPath).close();
		referenceSchema = schemaFingerprint(referenceDbPath);
		referenceState = poolStateRows(referenceDbPath);
		expect(referenceSchema.some(entry => entry.startsWith("table resource_pool_state ::"))).toBe(true);
		expect(referenceSchema.some(entry => entry.startsWith("index idx_resource_"))).toBe(true);
		expect(referenceState).toHaveLength(1);
	});

	afterEach(async () => {
		for (const [key, value] of [
			["HOME", previousHome],
			["OMP_SESSION_CONTROL_DB", previousControlDb],
			["OMP_RESOURCE_AUTHORITY_DB", previousAuthorityDb],
		] as const) {
			if (value === undefined) delete process.env[key];
			else process.env[key] = value;
		}
		await fs.rm(root, { recursive: true, force: true });
	});

	function openAuthority(dbPath: string): HostResourceAdmission {
		return new HostResourceAdmission({
			dbPath,
			memoryBudgetBytes: 5 * GIB,
			childReservationBytes: 512 * 1_048_576,
			queuePollMs: 5,
			sampleIntervalMs: 60_000,
			hostResourceProbe: { systemMemoryBytes: 512 * GIB, systemCpuCount: 128, warnings: [] },
			coordinatorRoots: () => [],
		});
	}

	/** Releases `concurrency` real processes into the same authority at one instant. */
	async function raceOpen(dbPath: string, concurrency: number): Promise<OpenOutcome[]> {
		const children = Array.from({ length: concurrency }, () =>
			Bun.spawn({
				cmd: [process.execPath, FIXTURE],
				cwd: PACKAGE_ROOT,
				env: { ...process.env, RACE_DB_PATH: dbPath },
				stdin: "pipe",
				stdout: "pipe",
				stderr: "pipe",
			}),
		);
		const nextLines = children.map(child => lineReader(child.stdout));
		const stderrs = children.map(child => new Response(child.stderr).text());
		try {
			const ready = await Promise.all(nextLines.map(nextLine => nextLine()));
			expect(ready).toEqual(Array.from({ length: concurrency }, () => "ready"));
		} catch (error) {
			for (const child of children) child.kill();
			throw new Error(`children never reached the barrier: ${(await Promise.all(stderrs)).join("\n").slice(-800)}`, {
				cause: error,
			});
		}
		// Back-to-back close syscalls: every parked child wakes inside the same scheduler tick.
		for (const child of children) child.stdin.write("g");
		for (const child of children) child.stdin.end();
		return await Promise.all(
			children.map(async (child, index) => {
				let line: string | undefined;
				try {
					line = await nextLines[index]!();
				} catch {
					line = undefined;
				}
				const exitCode = await child.exited;
				const stderr = await stderrs[index]!;
				if (line === undefined) return { exitCode, ok: false, name: "no-outcome", message: stderr.slice(-600) };
				try {
					return { exitCode, ...(JSON.parse(line) as Omit<OpenOutcome, "exitCode">) };
				} catch {
					return { exitCode, ok: false, name: "unparseable", message: `${line}\n${stderr}`.slice(-600) };
				}
			}),
		);
	}

	function expectConverged(dbPath: string): void {
		expect(schemaFingerprint(dbPath)).toEqual(referenceSchema);
		expect(poolStateRows(dbPath)).toEqual(referenceState);
		expect(integrityCheck(dbPath)).toBe("ok");
	}

	it("admits every process that cold-opens the same authority at once", async () => {
		const failures: OpenOutcome[] = [];
		for (let trial = 0; trial < 8; trial += 1) {
			const dbPath = path.join(root, `cold-${trial}`, "resource-authority.sqlite");
			const outcomes = await raceOpen(dbPath, CONCURRENCY);
			failures.push(...outcomes.filter(outcome => !outcome.ok));
			expectConverged(dbPath);
		}
		expect(failures).toEqual([]);
	}, 180_000);

	it("admits every process that races the seed row on a half-initialized authority", async () => {
		const failures: OpenOutcome[] = [];
		for (let trial = 0; trial < 4; trial += 1) {
			const dbPath = path.join(root, `seed-${trial}`, "resource-authority.sqlite");
			// Exactly the durable state a non-atomic initializer leaves behind when it commits its
			// DDL and then loses the machine before seeding the singleton row.
			openAuthority(dbPath).close();
			const audit = new Database(dbPath);
			audit.run("DELETE FROM resource_pool_state WHERE id=1");
			audit.close();
			expect(poolStateRows(dbPath)).toEqual([]);

			const outcomes = await raceOpen(dbPath, CONCURRENCY);
			failures.push(...outcomes.filter(outcome => !outcome.ok));
			expectConverged(dbPath);
		}
		expect(failures).toEqual([]);
	}, 180_000);

	it("refuses to migrate an unsupported schema even when every process opens it at once", async () => {
		const dbPath = path.join(root, "unsupported", "resource-authority.sqlite");
		await fs.mkdir(path.dirname(dbPath), { recursive: true });
		const old = new Database(dbPath);
		old.run(`CREATE TABLE resource_pool_state (
				id INTEGER PRIMARY KEY, schema_version INTEGER NOT NULL, next_ticket INTEGER NOT NULL,
				next_fence_token INTEGER NOT NULL, grant_sequence INTEGER NOT NULL, pressure_state TEXT NOT NULL,
				pressure_since_ms INTEGER, emergency_epoch INTEGER NOT NULL, sample_json TEXT, sample_at_ms INTEGER
			)`);
		old.run("INSERT INTO resource_pool_state VALUES (1, 1, 1, 1, 0, 'normal', NULL, 0, NULL, NULL)");
		old.close();
		const before = schemaFingerprint(dbPath);

		const outcomes = await raceOpen(dbPath, 4);
		expect(outcomes.map(outcome => outcome.name)).toEqual(
			Array.from({ length: 4 }, () => "HostAdmissionCorruptError"),
		);
		// Fail closed means the losing transaction rolls back: no table, index, or row is added.
		expect(schemaFingerprint(dbPath)).toEqual(before);
		const audit = new Database(dbPath);
		expect(
			audit.query<{ schema_version: number }, []>("SELECT schema_version FROM resource_pool_state").all(),
		).toEqual([{ schema_version: 1 }]);
		audit.close();
		expect(integrityCheck(dbPath)).toBe("ok");
	}, 60_000);
});
