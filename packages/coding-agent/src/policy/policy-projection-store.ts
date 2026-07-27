import { Database } from "bun:sqlite";
import * as fs from "node:fs";
import * as path from "node:path";
import { POLICY_GENESIS_HASH, decodePolicyTransactionV1, type PolicyTransactionV1 } from "./policy-records";

export const POLICY_PROJECTION_FILENAME = "policy-projection-v1.sqlite";

interface ProjectionMetaRow {
	sequence: number;
	head_hash: string;
	record_count: number;
}

interface ProjectionRecordRow {
	record_json: string;
}

function projectionHead(records: readonly PolicyTransactionV1[]): ProjectionMetaRow {
	const head = records.at(-1);
	return {
		sequence: head?.sequence ?? 0,
		head_hash: head?.recordHash ?? POLICY_GENESIS_HASH,
		record_count: records.length,
	};
}

/** Disposable SQLite read-model. The hash-chained JSONL journal remains the only authority. */
export class PolicyProjectionStore {
	readonly dbPath: string;
	#database: Database | undefined;

	constructor(journalPath: string, dbPath = path.join(path.dirname(journalPath), POLICY_PROJECTION_FILENAME)) {
		this.dbPath = dbPath;
	}

	close(): void {
		this.#database?.close();
		this.#database = undefined;
	}

	load(records: readonly PolicyTransactionV1[]): readonly PolicyTransactionV1[] {
		try {
			if (!fs.existsSync(this.dbPath)) return this.rebuild(records);
			const database = this.#open();
			const expected = projectionHead(records);
			const actual = database
				.query<ProjectionMetaRow, []>("SELECT sequence, head_hash, record_count FROM projection_meta WHERE id=1")
				.get();
			if (
				actual?.sequence !== expected.sequence ||
				actual.head_hash !== expected.head_hash ||
				actual.record_count !== expected.record_count
			) {
				return this.rebuild(records);
			}
			return database
				.query<ProjectionRecordRow, []>("SELECT record_json FROM policy_transactions ORDER BY sequence")
				.all()
				.map(row => decodePolicyTransactionV1(JSON.parse(row.record_json)));
		} catch {
			return this.rebuild(records);
		}
	}

	rebuild(records: readonly PolicyTransactionV1[]): readonly PolicyTransactionV1[] {
		this.close();
		for (const suffix of ["", "-wal", "-shm"]) fs.rmSync(`${this.dbPath}${suffix}`, { force: true });
		fs.mkdirSync(path.dirname(this.dbPath), { recursive: true, mode: 0o700 });
		const database = this.#open();
		const head = projectionHead(records);
		database.transaction(() => {
			database.run("DELETE FROM policy_transactions");
			database.run("DELETE FROM projection_meta");
			const insert = database.query(
				"INSERT INTO policy_transactions(sequence, transaction_id, record_hash, record_json) VALUES ($sequence,$transactionId,$recordHash,$recordJson)",
			);
			for (const record of records) {
				insert.run({
					$sequence: record.sequence,
					$transactionId: record.transactionId,
					$recordHash: record.recordHash,
					$recordJson: JSON.stringify(record),
				});
			}
			database
				.query(
					"INSERT INTO projection_meta(id, sequence, head_hash, record_count) VALUES (1,$sequence,$headHash,$recordCount)",
				)
				.run({ $sequence: head.sequence, $headHash: head.head_hash, $recordCount: head.record_count });
		})();
		fs.chmodSync(this.dbPath, 0o600);
		return [...records];
	}

	#open(): Database {
		if (this.#database) return this.#database;
		const database = new Database(this.dbPath);
		database.run("PRAGMA busy_timeout = 3000");
		database.run("PRAGMA journal_mode = WAL");
		database.run(`
			CREATE TABLE IF NOT EXISTS projection_meta (
				id INTEGER PRIMARY KEY CHECK(id=1),
				sequence INTEGER NOT NULL,
				head_hash TEXT NOT NULL,
				record_count INTEGER NOT NULL
			)
		`);
		database.run(`
			CREATE TABLE IF NOT EXISTS policy_transactions (
				sequence INTEGER PRIMARY KEY,
				transaction_id TEXT NOT NULL UNIQUE,
				record_hash TEXT NOT NULL,
				record_json TEXT NOT NULL
			)
		`);
		this.#database = database;
		return database;
	}
}
