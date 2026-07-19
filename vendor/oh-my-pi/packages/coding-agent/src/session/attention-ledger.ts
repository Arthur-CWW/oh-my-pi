import { randomUUID } from "node:crypto";
import * as fs from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";

export const ATTENTION_LEDGER_VERSION = 1 as const;
export const DEFAULT_ATTENTION_LEDGER_PATH = path.join(os.homedir(), ".omp", "agent", "attention-v1.jsonl");

export type AttentionLedgerAction =
	| "now"
	| "next"
	| "waiting"
	| "later"
	| "hidden"
	| "snooze"
	| "tags"
	| "bookmark"
	| "note";

export interface AttentionLedgerTarget {
	readonly key: string;
	readonly label: string;
}

export interface AttentionLedgerRecord {
	readonly version: typeof ATTENTION_LEDGER_VERSION;
	readonly receiptId: string;
	readonly createdAt: string;
	readonly target: AttentionLedgerTarget;
	readonly action: AttentionLedgerAction;
}

export interface AttentionLedgerOptions {
	readonly filePath?: string;
	readonly now?: () => Date;
	readonly idFactory?: () => string;
}

function isAttentionAction(value: unknown): value is AttentionLedgerAction {
	return (
		value === "now" ||
		value === "next" ||
		value === "waiting" ||
		value === "later" ||
		value === "hidden" ||
		value === "snooze" ||
		value === "tags" ||
		value === "bookmark" ||
		value === "note"
	);
}

function decodeRecord(line: string): AttentionLedgerRecord | undefined {
	try {
		const value = JSON.parse(line) as Partial<AttentionLedgerRecord>;
		if (
			value.version !== ATTENTION_LEDGER_VERSION ||
			typeof value.receiptId !== "string" ||
			typeof value.createdAt !== "string" ||
			!Number.isFinite(Date.parse(value.createdAt)) ||
			typeof value.target !== "object" ||
			value.target === null ||
			typeof value.target.key !== "string" ||
			typeof value.target.label !== "string" ||
			!isAttentionAction(value.action)
		) {
			return undefined;
		}
		return value as AttentionLedgerRecord;
	} catch {
		return undefined;
	}
}


/** Production append-only writer for Hub triage receipts. */
export class AttentionLedger {
	readonly filePath: string;
	readonly #now: () => Date;
	readonly #idFactory: () => string;

	constructor(options: AttentionLedgerOptions = {}) {
		this.filePath = options.filePath ?? DEFAULT_ATTENTION_LEDGER_PATH;
		this.#now = options.now ?? (() => new Date());
		this.#idFactory = options.idFactory ?? randomUUID;
	}

	async commit(
		target: AttentionLedgerTarget,
		action: AttentionLedgerAction,
	): Promise<{ readonly receiptId: string; readonly message: string }> {
		const record: AttentionLedgerRecord = {
			version: ATTENTION_LEDGER_VERSION,
			receiptId: this.#idFactory(),
			createdAt: this.#now().toISOString(),
			target,
			action,
		};
		await fs.mkdir(path.dirname(this.filePath), { recursive: true, mode: 0o700 });
		await fs.appendFile(this.filePath, `${JSON.stringify(record)}\n`, { encoding: "utf8", mode: 0o600 });
		return { receiptId: record.receiptId, message: `${action} recorded for ${target.label}` };
	}

	async list(): Promise<AttentionLedgerRecord[]> {
		let raw: string;
		try {
			raw = await fs.readFile(this.filePath, "utf8");
		} catch (error) {
			if (error instanceof Error && "code" in error && error.code === "ENOENT") return [];
			throw error;
		}
		return raw.split("\n").flatMap(line => {
			const record = line.trim() ? decodeRecord(line) : undefined;
			return record === undefined ? [] : [record];
		});
	}
}
