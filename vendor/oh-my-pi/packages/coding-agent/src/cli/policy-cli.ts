import { createHash, randomUUID } from "node:crypto";
import * as path from "node:path";
import { getAgentDir } from "@oh-my-pi/pi-utils";
import { YAML } from "bun";
import { Effect, Schema } from "effect";
import { commitPolicyWithPreview } from "../policy/policy-apply";
import { POLICY_REGISTRY_DIGEST, PolicyJournal } from "../policy/policy-journal";
import {
	CORE_ROUTING_KEYS,
	type CoreRoutingValue,
	CoreRoutingValueSchema,
	POLICY_REGISTRY_VERSION,
	type PolicyMutationV1,
	type PolicyScope,
	type PolicyTransactionDraftV1,
	type PolicyTransactionV1,
} from "../policy/policy-records";
import { makePolicyService, type PolicyService } from "../policy/policy-service";

export type PolicyCliAction = "get" | "explain" | "diff" | "set" | "rollback" | "import" | "export";

export interface PolicyCliRequest {
	readonly action: PolicyCliAction;
	readonly key?: string;
	readonly value?: string;
	readonly from?: string;
	readonly to?: string;
	readonly transactionId?: string;
	readonly sourcePaths?: readonly string[];
	readonly frontmatterPaths?: readonly string[];
	readonly dryRun?: boolean;
	readonly json?: boolean;
	readonly reason?: string;
	readonly workstream?: string;
	readonly configPath?: string;
}

export interface PolicyCliOptions {
	readonly directory?: string;
	readonly journalPath?: string;
	readonly now?: () => Date;
}

export interface PolicyImportConflict {
	readonly sourcePath: string;
	readonly key: string;
	readonly candidates: readonly string[];
	readonly winningValue?: string;
	readonly shadowedValues: readonly string[];
	readonly classification: "policy" | "unsupported";
	readonly requiredManualResolution: boolean;
}

export interface PolicyImportReport {
	readonly digest: string;
	readonly sourcePaths: readonly string[];
	readonly conflicts: readonly PolicyImportConflict[];
	readonly unsupported: readonly string[];
	readonly transaction?: PolicyTransactionV1;
	readonly committed: boolean;
}

interface ImportCandidate {
	readonly sourcePath: string;
	readonly key: string;
	readonly value: string;
}

type ParsedYaml = Record<string, unknown>;

function routingKey(role: string): string {
	return `core.routing.${role}`;
}

function decodeRoutingValue(value: string): CoreRoutingValue {
	return Schema.decodeUnknownSync(CoreRoutingValueSchema)(value);
}

function isRecord(value: unknown): value is ParsedYaml {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}

async function readYamlCandidate(filePath: string, role: string): Promise<ImportCandidate[]> {
	const content = await Bun.file(filePath).text();
	const parsed: unknown = YAML.parse(content);
	if (!isRecord(parsed)) return [];
	const rawRoles = parsed.modelRoles;
	if (!isRecord(rawRoles)) return [];
	const raw = rawRoles[role];
	return typeof raw === "string" && raw.trim().length > 0
		? [{ sourcePath: filePath, key: routingKey(role), value: decodeRoutingValue(raw) }]
		: [];
}

async function readFrontmatterCandidate(filePath: string): Promise<ImportCandidate[]> {
	const content = await Bun.file(filePath).text();
	const match = /^---\s*\n([\s\S]*?)\n---(?:\s*\n|$)/.exec(content);
	if (!match?.[1]) return [];
	const parsed: unknown = YAML.parse(match[1]);
	if (!isRecord(parsed) || typeof parsed.model !== "string" || parsed.model.trim().length === 0) return [];
	return [{ sourcePath: filePath, key: "core.routing.task", value: decodeRoutingValue(parsed.model) }];
}

async function sourceDigest(paths: readonly string[]): Promise<string> {
	const hash = createHash("sha256");
	for (const filePath of paths) {
		hash.update(filePath, "utf8");
		hash.update("\0", "utf8");
		hash.update(new Uint8Array(await Bun.file(filePath).arrayBuffer()));
		hash.update("\0", "utf8");
	}
	return hash.digest("hex");
}

function importMutations(candidates: readonly ImportCandidate[]): {
	readonly mutations: readonly PolicyMutationV1[];
	readonly conflicts: readonly PolicyImportConflict[];
	readonly unsupported: readonly string[];
} {
	const grouped = new Map<string, ImportCandidate[]>();
	const unsupported: string[] = [];
	for (const candidate of candidates) {
		if (!(CORE_ROUTING_KEYS as readonly string[]).includes(candidate.key)) {
			unsupported.push(`${candidate.sourcePath}:${candidate.key}`);
			continue;
		}
		let values = grouped.get(candidate.key);
		if (!values) {
			values = [];
			grouped.set(candidate.key, values);
		}
		values.push(candidate);
	}
	const conflicts: PolicyImportConflict[] = [];
	const mutations: PolicyMutationV1[] = [];
	for (const [key, values] of grouped) {
		const winner = values.at(-1);
		if (!winner) continue;
		const candidatesForKey = values.map(value => value.value);
		const shadowedValues = values.slice(0, -1).map(value => value.value);
		conflicts.push({
			sourcePath: winner.sourcePath,
			key,
			candidates: candidatesForKey,
			winningValue: winner.value,
			shadowedValues,
			classification: "policy",
			requiredManualResolution: new Set(candidatesForKey).size > 1,
		});
		mutations.push({
			op: "set",
			key: key as PolicyMutationV1["key"],
			scope: { kind: "global" },
			fragmentVersion: POLICY_REGISTRY_VERSION,
			value: winner.value as CoreRoutingValue,
		});
	}
	return { mutations, conflicts, unsupported };
}

async function collectImport(
	configPath: string,
	frontmatterPaths: readonly string[],
): Promise<{
	readonly candidates: readonly ImportCandidate[];
	readonly report: Omit<PolicyImportReport, "transaction" | "committed">;
}> {
	const candidates: ImportCandidate[] = [];
	const roles = [
		"default",
		"smol",
		"slow",
		"vision",
		"plan",
		"designer",
		"commit",
		"title",
		"implementer",
		"qa",
		"operator",
		"synthesizer",
		"task",
		"advisor",
	];
	for (const role of roles) candidates.push(...(await readYamlCandidate(configPath, role)));
	for (const filePath of frontmatterPaths) candidates.push(...(await readFrontmatterCandidate(filePath)));
	const sourcePaths = [configPath, ...frontmatterPaths];
	const { mutations: _, ...details } = importMutations(candidates);
	return {
		candidates,
		report: { digest: await sourceDigest(sourcePaths), sourcePaths, ...details },
	};
}

function authorFor(journal: PolicyJournal, kind: "cli" | "import"): PolicyTransactionDraftV1["author"] {
	return { kind, uid: journal.uid, pid: journal.pid };
}

function sourceFor(digest: string, uri: string): PolicyTransactionDraftV1["source"] {
	return { kind: "import", uri, importDigest: digest };
}

async function runImport(
	journal: PolicyJournal,
	request: PolicyCliRequest,
	now: () => Date,
): Promise<PolicyImportReport> {
	const sourcePaths = request.sourcePaths ?? [];
	const configPath = sourcePaths[0] ?? request.configPath ?? path.join(getAgentDir(), "config.yml");
	const frontmatterPaths = [...(request.frontmatterPaths ?? []), ...sourcePaths.slice(1)];
	const collected = await collectImport(configPath, frontmatterPaths);
	const detail = importMutations(collected.candidates);
	const at = now();
	const draft: PolicyTransactionDraftV1 = {
		transactionId: randomUUID(),
		createdAt: at.toISOString(),
		effectiveFrom: at.toISOString(),
		author: authorFor(journal, "import"),
		source: sourceFor(collected.report.digest, configPath),
		reason: request.reason ?? "bootstrap policy import",
		registry: { version: POLICY_REGISTRY_VERSION, digest: POLICY_REGISTRY_DIGEST },
		mutations: detail.mutations,
	};
	if (draft.mutations.length === 0) throw new Error("policy import found no supported routing candidates");
	const preview = await journal.previewAppend(draft);
	const transaction =
		request.dryRun === true
			? preview
			: await journal.append(draft, {
					expectedHead: { sequence: preview.sequence - 1, hash: preview.previousHash },
				});
	return { ...collected.report, transaction, committed: request.dryRun !== true };
}

function redactedTransaction(transaction: PolicyTransactionV1): Record<string, unknown> {
	return {
		...transaction,
		author: {
			kind: transaction.author.kind,
			...(transaction.author.sessionId ? { sessionId: transaction.author.sessionId } : {}),
		},
		source: {
			kind: transaction.source.kind,
			...(transaction.source.importDigest ? { importDigest: transaction.source.importDigest } : {}),
		},
	};
}

function formatOutput(value: unknown, json: boolean): string {
	return json ? `${JSON.stringify(value, null, 2)}\n` : `${JSON.stringify(value)}\n`;
}

async function withPolicyService<T>(
	options: PolicyCliOptions,
	run: (journal: PolicyJournal, service: PolicyService) => Promise<T>,
): Promise<T> {
	const journal = await PolicyJournal.acquire({
		directory: options.directory,
		journalPath: options.journalPath,
		now: options.now,
	});
	try {
		return await run(journal, makePolicyService(journal));
	} finally {
		await journal.release();
	}
}

export async function runPolicyCommand(request: PolicyCliRequest, options: PolicyCliOptions = {}): Promise<string> {
	const json = request.json === true;
	if (request.action === "import") {
		const report = await withPolicyService(options, journal =>
			runImport(journal, request, options.now ?? (() => new Date())),
		);
		return formatOutput(report, json);
	}
	if (request.action === "export") {
		const records = await withPolicyService(options, journal => journal.replay());
		return formatOutput({ schemaVersion: 1, transactions: records.map(redactedTransaction) }, json);
	}
	return withPolicyService(options, async (journal, service) => {
		switch (request.action) {
			case "get":
				if (!request.key) throw new Error("policy get requires a key");
				return formatOutput(
					await Effect.runPromise(service.get(request.key, { workstream: request.workstream })),
					json,
				);
			case "explain":
				if (!request.key) throw new Error("policy explain requires a key");
				return formatOutput(
					await Effect.runPromise(service.explain(request.key, { workstream: request.workstream })),
					json,
				);
			case "diff":
				if (!request.from || !request.to) throw new Error("policy diff requires --from and --to");
				return formatOutput(
					await Effect.runPromise(
						service.diff({ from: request.from, to: request.to, workstream: request.workstream }),
					),
					json,
				);
			case "set": {
				if (!request.key || request.value === undefined) throw new Error("policy set requires a key and value");
				const value = decodeRoutingValue(request.value);
				const previewAndCommit = await commitPolicyWithPreview({
					service,
					set: {
						key: request.key,
						value,
						scope: { kind: "global" } satisfies PolicyScope,
						reason: request.reason ?? "policy set",
						author: authorFor(journal, "cli"),
						source: { kind: "cli", uri: journal.journalPath },
					},
				});
				return formatOutput(previewAndCommit, json);
			}
			case "rollback":
				if (!request.transactionId) throw new Error("policy rollback requires a transaction ID");
				return formatOutput(
					await Effect.runPromise(
						service.rollback({
							transactionId: request.transactionId,
							reason: request.reason ?? "policy rollback",
							author: authorFor(journal, "cli"),
							source: { kind: "cli", uri: journal.journalPath },
						}),
					),
					json,
				);
			default:
				throw new Error(`Unsupported policy action: ${request.action}`);
		}
	});
}

export { collectImport, importMutations, redactedTransaction };
