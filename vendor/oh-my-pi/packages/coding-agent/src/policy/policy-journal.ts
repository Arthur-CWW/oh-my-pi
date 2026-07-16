import { createHash, randomUUID } from "node:crypto";
import * as fs from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";
import { Schema } from "effect";
import {
	decodePolicyTransactionV1,
	NonNegativeIntSchema,
	POLICY_GENESIS_HASH,
	POLICY_REGISTRY_VERSION,
	POLICY_SCHEMA_VERSION,
	PolicyForkDetectedError,
	PolicyJournalIoError,
	PolicyLeaseConflictError,
	type PolicyMutationV1,
	type PolicyTransactionDraftV1,
	type PolicyTransactionV1,
	PositiveIntSchema,
	StalePolicyHeadError,
	TimestampSchema,
	TornPolicyJournalError,
	UUIDSchema,
} from "./policy-records";

export const DEFAULT_POLICY_DIRECTORY = path.join(os.homedir(), ".omp", "agent", "policy");
export const POLICY_JOURNAL_FILENAME = "policy-v1.jsonl";
const POLICY_LEASE_FILENAME = "policy-v1.lease";
const POLICY_LOCK_FILENAME = "policy-v1.lock";

export const POLICY_REGISTRY_DIGEST = createHash("sha256")
	.update(
		"registry:v3;core.routing:v1-3:default,smol,slow,vision,plan,designer,commit,title,implementer,qa,operator,synthesizer,task,advisor;core.providers:v1:deny.providers{providerIds[]},deny.models{models[{provider,model}]};core.fallback:v1:chains{role:[selector+]};core.budgets.task:v1:maxConcurrency,maxLiveChildren,maxRuntimeMs,softRequestBudget{nonnegative-int}",
	)
	.digest("hex");

const PolicyLeaseClaimSchema = Schema.Struct({
	uid: NonNegativeIntSchema,
	pid: PositiveIntSchema,
	epoch: UUIDSchema,
	acquiredAt: TimestampSchema,
});
type PolicyLeaseClaim = typeof PolicyLeaseClaimSchema.Type;

type CanonicalJson =
	| null
	| boolean
	| number
	| string
	| readonly CanonicalJson[]
	| { readonly [key: string]: CanonicalJson };

export interface PolicyHead {
	readonly sequence: number;
	readonly hash: string;
}

export interface PolicyJournalOptions {
	readonly directory?: string;
	readonly journalPath?: string;
	readonly uid?: number;
	readonly pid?: number;
	readonly now?: () => Date;
}

export interface PolicyAppendOptions {
	readonly expectedHead?: PolicyHead;
}

export interface PolicyRollbackInput {
	readonly transactionId: string;
	readonly author: PolicyTransactionDraftV1["author"];
	readonly source: PolicyTransactionDraftV1["source"];
	readonly reason: string;
	readonly effectiveFrom?: string;
	readonly expectedHead?: PolicyHead;
}

function currentUid(): number {
	return process.getuid?.() ?? 0;
}

function errorReason(error: unknown): string {
	return error instanceof Error ? error.message : String(error);
}

function isEnoent(error: unknown): error is NodeJS.ErrnoException {
	return error instanceof Error && "code" in error && error.code === "ENOENT";
}

function isEexist(error: unknown): error is NodeJS.ErrnoException {
	return error instanceof Error && "code" in error && error.code === "EEXIST";
}

function isPolicyFailure(error: unknown): error is PolicyJournalIoError {
	return error instanceof Error && "_tag" in error && typeof error._tag === "string";
}

/** Typed boundary that canonicalizes values already validated by PolicyTransactionV1Schema. */
function toCanonicalJson(value: unknown): CanonicalJson {
	if (value === null || typeof value === "boolean" || typeof value === "number" || typeof value === "string")
		return value;
	if (Array.isArray(value)) return value.map(toCanonicalJson);
	if (typeof value !== "object") throw new TypeError(`Unsupported policy JSON value: ${typeof value}`);
	const output: Record<string, CanonicalJson> = {};
	for (const [key, member] of Object.entries(value).sort(([left], [right]) =>
		left < right ? -1 : left > right ? 1 : 0,
	)) {
		if (member !== undefined) output[key] = toCanonicalJson(member);
	}
	return output;
}

function canonicalStringify(value: PolicyTransactionV1 | Omit<PolicyTransactionV1, "recordHash">): string {
	return JSON.stringify(toCanonicalJson(value));
}

export function computePolicyRecordHash(record: Omit<PolicyTransactionV1, "recordHash"> | PolicyTransactionV1): string {
	const { recordHash: _recordHash, ...content } = record as PolicyTransactionV1;
	return createHash("sha256").update(canonicalStringify(content)).digest("hex");
}

function headOf(records: readonly PolicyTransactionV1[]): PolicyHead {
	const last = records.at(-1);
	return last === undefined
		? { sequence: 0, hash: POLICY_GENESIS_HASH }
		: { sequence: last.sequence, hash: last.recordHash };
}

function samePolicyScope(left: PolicyMutationV1["scope"], right: PolicyMutationV1["scope"]): boolean {
	if (left.kind !== right.kind) return false;
	return left.kind === "global" || (right.kind === "workstream" && left.workstream === right.workstream);
}

function decodeLease(raw: string, leasePath: string): PolicyLeaseClaim {
	try {
		return Schema.decodeUnknownSync(PolicyLeaseClaimSchema)(JSON.parse(raw), { onExcessProperty: "error" });
	} catch (error) {
		throw new PolicyJournalIoError({ operation: "decode lease", path: leasePath, reason: errorReason(error) });
	}
}

async function syncDirectory(directory: string): Promise<void> {
	const handle = await fs.open(directory, "r");
	try {
		await handle.sync();
	} finally {
		await handle.close();
	}
}

export class PolicyJournal {
	readonly journalPath: string;
	readonly directory: string;
	readonly leasePath: string;
	readonly lockPath: string;
	readonly ownerEpoch: string;
	readonly uid: number;
	readonly pid: number;
	readonly #now: () => Date;
	readonly #claim: PolicyLeaseClaim;
	#released = false;

	constructor(options: PolicyJournalOptions, claim: PolicyLeaseClaim) {
		this.journalPath =
			options.journalPath ?? path.join(options.directory ?? DEFAULT_POLICY_DIRECTORY, POLICY_JOURNAL_FILENAME);
		this.directory = path.dirname(this.journalPath);
		this.leasePath = path.join(this.directory, POLICY_LEASE_FILENAME);
		this.lockPath = path.join(this.directory, POLICY_LOCK_FILENAME);
		this.uid = claim.uid;
		this.pid = claim.pid;
		this.ownerEpoch = claim.epoch;
		this.#claim = claim;
		this.#now = options.now ?? (() => new Date());
	}

	static async acquire(options: PolicyJournalOptions = {}): Promise<PolicyJournal> {
		const journalPath =
			options.journalPath ?? path.join(options.directory ?? DEFAULT_POLICY_DIRECTORY, POLICY_JOURNAL_FILENAME);
		const directory = path.dirname(journalPath);
		const leasePath = path.join(directory, POLICY_LEASE_FILENAME);
		const uid = options.uid ?? currentUid();
		const pid = options.pid ?? process.pid;
		if (uid !== currentUid() || pid !== process.pid) {
			throw new PolicyJournalIoError({
				operation: "acquire lease",
				path: leasePath,
				reason: "lease uid and pid must match the foreground process",
			});
		}
		await fs.mkdir(directory, { recursive: true, mode: 0o700 });
		const claim: PolicyLeaseClaim = {
			uid,
			pid,
			epoch: randomUUID(),
			acquiredAt: (options.now ?? (() => new Date()))().toISOString(),
		};
		let handle: fs.FileHandle;
		try {
			handle = await fs.open(leasePath, "wx", 0o600);
		} catch (error) {
			if (!isEexist(error))
				throw new PolicyJournalIoError({ operation: "acquire lease", path: leasePath, reason: errorReason(error) });
			let holder: PolicyLeaseClaim;
			try {
				holder = decodeLease(await fs.readFile(leasePath, "utf8"), leasePath);
			} catch (readError) {
				if (isPolicyFailure(readError)) throw readError;
				throw new PolicyJournalIoError({
					operation: "read lease",
					path: leasePath,
					reason: errorReason(readError),
				});
			}
			throw new PolicyLeaseConflictError({
				leasePath,
				holderUid: holder.uid,
				holderPid: holder.pid,
				holderEpoch: holder.epoch,
			});
		}
		try {
			await handle.writeFile(`${JSON.stringify(claim)}\n`, "utf8");
			await handle.sync();
		} finally {
			await handle.close();
		}
		await syncDirectory(directory);
		return new PolicyJournal({ ...options, journalPath }, claim);
	}

	async release(): Promise<void> {
		if (this.#released) return;
		this.#released = true;
		try {
			const current = decodeLease(await fs.readFile(this.leasePath, "utf8"), this.leasePath);
			if (current.epoch === this.ownerEpoch && current.uid === this.uid && current.pid === this.pid) {
				await fs.rm(this.leasePath);
				await syncDirectory(this.directory);
			}
		} catch (error) {
			if (!isEnoent(error)) throw error;
		}
	}

	async replay(): Promise<readonly PolicyTransactionV1[]> {
		let raw: string;
		try {
			raw = await fs.readFile(this.journalPath, "utf8");
		} catch (error) {
			if (isEnoent(error)) return [];
			throw new PolicyJournalIoError({
				operation: "read journal",
				path: this.journalPath,
				reason: errorReason(error),
			});
		}
		if (raw.length === 0) return [];
		const lines = raw.split("\n");
		if (lines.at(-1) !== "") {
			throw new TornPolicyJournalError({
				journalPath: this.journalPath,
				line: lines.length,
				reason: "journal does not end in a newline",
			});
		}
		lines.pop();
		const records: PolicyTransactionV1[] = [];
		const transactionIds = new Set<string>();
		let expectedSequence = 1;
		let expectedPreviousHash = POLICY_GENESIS_HASH;
		for (let index = 0; index < lines.length; index += 1) {
			const lineNumber = index + 1;
			const line = lines[index];
			if (line === undefined || line.trim().length === 0) {
				throw new TornPolicyJournalError({
					journalPath: this.journalPath,
					line: lineNumber,
					reason: "empty record line",
				});
			}
			let record: PolicyTransactionV1;
			try {
				record = decodePolicyTransactionV1(JSON.parse(line));
			} catch (error) {
				throw new TornPolicyJournalError({
					journalPath: this.journalPath,
					line: lineNumber,
					reason: errorReason(error),
				});
			}
			const computedHash = computePolicyRecordHash(record);
			if (
				record.sequence !== expectedSequence ||
				record.previousHash !== expectedPreviousHash ||
				record.recordHash !== computedHash ||
				transactionIds.has(record.transactionId)
			) {
				throw new PolicyForkDetectedError({
					journalPath: this.journalPath,
					line: lineNumber,
					expectedSequence,
					actualSequence: record.sequence,
					expectedPreviousHash,
					actualPreviousHash: record.previousHash,
				});
			}
			transactionIds.add(record.transactionId);
			records.push(record);
			expectedSequence += 1;
			expectedPreviousHash = record.recordHash;
		}
		return records;
	}

	async previewAppend(
		draft: PolicyTransactionDraftV1,
		options: PolicyAppendOptions = {},
	): Promise<PolicyTransactionV1> {
		await this.#assertLease();
		const records = await this.replay();
		return this.#buildRecord(draft, records, options);
	}

	async append(draft: PolicyTransactionDraftV1, options: PolicyAppendOptions = {}): Promise<PolicyTransactionV1> {
		await this.#assertLease();
		const lockHandle = await this.#acquireAppendLock();
		try {
			const records = await this.replay();
			const record = this.#buildRecord(draft, records, options);
			const journalHandle = await fs.open(this.journalPath, "a", 0o600);
			try {
				await journalHandle.writeFile(`${canonicalStringify(record)}\n`, "utf8");
				await journalHandle.sync();
			} finally {
				await journalHandle.close();
			}
			await syncDirectory(this.directory);
			return record;
		} finally {
			await lockHandle.close();
			await fs.rm(this.lockPath, { force: true });
		}
	}

	async previewRollback(input: PolicyRollbackInput): Promise<PolicyTransactionV1> {
		const records = await this.replay();
		return this.previewAppend(this.#rollbackDraft(input, records), {
			expectedHead: input.expectedHead ?? headOf(records),
		});
	}

	async rollback(input: PolicyRollbackInput): Promise<PolicyTransactionV1> {
		const records = await this.replay();
		return this.append(this.#rollbackDraft(input, records), {
			expectedHead: input.expectedHead ?? headOf(records),
		});
	}

	#rollbackDraft(input: PolicyRollbackInput, records: readonly PolicyTransactionV1[]): PolicyTransactionDraftV1 {
		const target = records.find(record => record.transactionId === input.transactionId);
		if (target === undefined) {
			throw new PolicyJournalIoError({
				operation: "rollback",
				path: this.journalPath,
				reason: `transaction not found: ${input.transactionId}`,
			});
		}
		return {
			transactionId: randomUUID(),
			createdAt: this.#now().toISOString(),
			effectiveFrom: input.effectiveFrom ?? this.#now().toISOString(),
			author: input.author,
			source: input.source,
			reason: input.reason,
			rollbackOf: target.transactionId,
			registry: target.registry,
			mutations: target.mutations.map(mutation => this.#inverseMutation(records, target.sequence, mutation)),
		};
	}

	#inverseMutation(
		records: readonly PolicyTransactionV1[],
		beforeSequence: number,
		mutation: PolicyMutationV1,
	): PolicyMutationV1 {
		for (let recordIndex = records.length - 1; recordIndex >= 0; recordIndex -= 1) {
			const record = records[recordIndex];
			if (record === undefined || record.sequence >= beforeSequence) continue;
			for (let mutationIndex = record.mutations.length - 1; mutationIndex >= 0; mutationIndex -= 1) {
				const prior = record.mutations[mutationIndex];
				if (prior === undefined || prior.key !== mutation.key || !samePolicyScope(prior.scope, mutation.scope))
					continue;
				return prior;
			}
		}
		const { key, scope, fragmentVersion } = mutation;
		return { op: "clear", key, scope, fragmentVersion } as PolicyMutationV1;
	}

	#buildRecord(
		draft: PolicyTransactionDraftV1,
		records: readonly PolicyTransactionV1[],
		options: PolicyAppendOptions,
	): PolicyTransactionV1 {
		const head = headOf(records);
		if (
			options.expectedHead !== undefined &&
			(options.expectedHead.sequence !== head.sequence || options.expectedHead.hash !== head.hash)
		) {
			throw new StalePolicyHeadError({
				expectedSequence: options.expectedHead.sequence,
				actualSequence: head.sequence,
				expectedHash: options.expectedHead.hash,
				actualHash: head.hash,
			});
		}
		if (draft.author.uid !== this.uid || draft.author.pid !== this.pid) {
			throw new PolicyJournalIoError({
				operation: "append",
				path: this.journalPath,
				reason: "author uid and pid must own the foreground lease",
			});
		}
		if (draft.registry.version !== POLICY_REGISTRY_VERSION) {
			throw new PolicyJournalIoError({
				operation: "append",
				path: this.journalPath,
				reason: "registry version is not supported by this policy journal",
			});
		}
		if (records.some(record => record.transactionId === draft.transactionId)) {
			throw new PolicyJournalIoError({
				operation: "append",
				path: this.journalPath,
				reason: "duplicate transaction id",
			});
		}
		const withoutHash: Omit<PolicyTransactionV1, "recordHash"> = {
			recordType: "policy-transaction",
			schemaVersion: POLICY_SCHEMA_VERSION,
			...draft,
			sequence: head.sequence + 1,
			previousHash: head.hash,
		};
		const record: PolicyTransactionV1 = { ...withoutHash, recordHash: computePolicyRecordHash(withoutHash) };
		return decodePolicyTransactionV1(record);
	}

	async #assertLease(): Promise<void> {
		if (this.#released) {
			throw new PolicyJournalIoError({
				operation: "append",
				path: this.journalPath,
				reason: "lease has been released",
			});
		}
		let current: PolicyLeaseClaim;
		try {
			current = decodeLease(await fs.readFile(this.leasePath, "utf8"), this.leasePath);
		} catch (error) {
			if (isPolicyFailure(error)) throw error;
			throw new PolicyJournalIoError({
				operation: "verify lease",
				path: this.leasePath,
				reason: errorReason(error),
			});
		}
		if (current.epoch !== this.ownerEpoch || current.uid !== this.uid || current.pid !== this.pid) {
			throw new PolicyLeaseConflictError({
				leasePath: this.leasePath,
				holderUid: current.uid,
				holderPid: current.pid,
				holderEpoch: current.epoch,
			});
		}
	}

	async #acquireAppendLock(): Promise<fs.FileHandle> {
		try {
			const handle = await fs.open(this.lockPath, "wx", 0o600);
			await handle.writeFile(`${JSON.stringify(this.#claim)}\n`, "utf8");
			await handle.sync();
			return handle;
		} catch (error) {
			if (!isEexist(error))
				throw new PolicyJournalIoError({
					operation: "lock journal",
					path: this.lockPath,
					reason: errorReason(error),
				});
			throw new PolicyLeaseConflictError({
				leasePath: this.lockPath,
				holderUid: this.uid,
				holderPid: this.pid,
				holderEpoch: this.ownerEpoch,
			});
		}
	}
}

export async function acquirePolicyJournal(options: PolicyJournalOptions = {}): Promise<PolicyJournal> {
	return PolicyJournal.acquire(options);
}
