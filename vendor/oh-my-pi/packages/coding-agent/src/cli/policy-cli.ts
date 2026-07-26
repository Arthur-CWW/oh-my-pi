import { randomUUID } from "node:crypto";
import * as path from "node:path";
import { getAgentDir } from "@oh-my-pi/pi-utils";
import { Effect } from "effect";
import { commitPolicyWithPreview } from "../policy/policy-apply";
import type { PolicyFragmentRegistry, PolicyJsonValue } from "../policy/policy-fragment-registry";
import { listLivePolicySessions, type PolicyLiveSession } from "../policy/policy-inspection";
import { POLICY_REGISTRY_DIGEST, PolicyJournal } from "../policy/policy-journal";
import {
	type AnyPolicyValue,
	decodePolicyValueForKey,
	isCoreBudgetKey,
	isCoreRoutingKey,
	isExtensionPolicyKey,
	isPolicyKey,
	POLICY_REGISTRY_VERSION,
	type PolicyScope,
	type PolicyTransactionDraftV1,
	type PolicyTransactionV1,
} from "../policy/policy-records";
import { makePolicyService, type PolicyService } from "../policy/policy-service";
import {
	compilePolicyImportCandidates,
	exportLegacyPolicyYaml,
	importPolicyYaml,
	type PolicyImportCandidate,
	type PolicyImportConflictV1,
} from "../policy/policy-yaml";

export type PolicyCliAction =
	| "get"
	| "explain"
	| "diff"
	| "history"
	| "drift"
	| "impact"
	| "rebuild"
	| "set"
	| "rollback"
	| "import"
	| "export";

export interface PolicyCliRequest {
	readonly action: PolicyCliAction;
	readonly key?: string;
	readonly value?: string;
	readonly from?: string;
	readonly to?: string;
	readonly effectiveFrom?: string;
	readonly expiresAt?: string;
	readonly expiresIn?: string;
	readonly transactionId?: string;
	readonly sourcePaths?: readonly string[];
	readonly frontmatterPaths?: readonly string[];
	readonly dryRun?: boolean;
	readonly apply?: boolean;
	readonly json?: boolean;
	readonly reason?: string;
	readonly workstream?: string;
	readonly author?: string;
	readonly source?: string;
	readonly since?: string;
	readonly configPath?: string;
}

export interface PolicyCliOptions {
	readonly directory?: string;
	readonly journalPath?: string;
	readonly now?: () => Date;
	readonly ircDbPath?: string;
	readonly controlDbPath?: string;
	readonly liveSessions?: () => readonly PolicyLiveSession[];
	readonly fragmentRegistry?: PolicyFragmentRegistry;
}

export interface PolicyImportReport {
	readonly digest: string;
	readonly sourcePaths: readonly string[];
	readonly conflicts: readonly PolicyImportConflictV1[];
	readonly transaction?: PolicyTransactionV1;
	readonly committed: boolean;
}

const DURATION_UNITS_MS = {
	ms: 1,
	s: 1_000,
	m: 60_000,
	h: 3_600_000,
	d: 86_400_000,
	w: 604_800_000,
} as const;

function decodeSetValue(key: string, value: string, fragmentRegistry?: PolicyFragmentRegistry): AnyPolicyValue {
	if (isCoreRoutingKey(key)) return decodePolicyValueForKey(key, value);
	let parsed: unknown;
	try {
		parsed = JSON.parse(value);
	} catch (error) {
		const reason = error instanceof Error ? error.message : String(error);
		throw new Error(
			`policy set ${key} requires ${isCoreBudgetKey(key) ? "valid JSON" : "a valid JSON object"}: ${reason}`,
		);
	}
	if (isExtensionPolicyKey(key)) {
		if (fragmentRegistry === undefined) throw new Error(`Extension policy namespace is not registered: ${key}`);
		return fragmentRegistry.decodeCurrent(key, parsed as PolicyJsonValue);
	}
	if (!isPolicyKey(key)) throw new Error(`Unknown policy key: ${key}`);
	if (!isCoreBudgetKey(key) && !isRecord(parsed)) throw new Error(`policy set ${key} requires a JSON object`);
	return decodePolicyValueForKey(key, parsed);
}

function canonicalTimestamp(flag: string, value: string): string {
	const timestamp = Date.parse(value);
	if (!Number.isFinite(timestamp)) throw new Error(`${flag} requires a valid timestamp`);
	return new Date(timestamp).toISOString();
}

function parsePositiveDuration(value: string): number {
	const match = /^([1-9]\d*)(ms|s|m|h|d|w)$/.exec(value);
	if (!match) throw new Error("--expires-in requires a positive integer duration with unit ms, s, m, h, d, or w");
	const amount = Number(match[1]);
	const unit = match[2] as keyof typeof DURATION_UNITS_MS;
	const durationMs = amount * DURATION_UNITS_MS[unit];
	if (!Number.isSafeInteger(durationMs) || durationMs <= 0) {
		throw new Error("--expires-in duration is outside the supported range");
	}
	return durationMs;
}

function resolveSetInterval(
	request: Pick<PolicyCliRequest, "effectiveFrom" | "expiresAt" | "expiresIn">,
	now: Date,
): { readonly effectiveFrom: string; readonly expiresAt?: string } {
	if (request.expiresAt !== undefined && request.expiresIn !== undefined) {
		throw new Error("--expires-at and --expires-in cannot be used together");
	}
	const effectiveFrom =
		request.effectiveFrom === undefined
			? now.toISOString()
			: canonicalTimestamp("--effective-from", request.effectiveFrom);
	const effectiveFromMs = Date.parse(effectiveFrom);
	let expiresAt: string | undefined;
	if (request.expiresIn !== undefined) {
		const expiresAtMs = effectiveFromMs + parsePositiveDuration(request.expiresIn);
		if (!Number.isSafeInteger(expiresAtMs) || Math.abs(expiresAtMs) > 8_640_000_000_000_000) {
			throw new Error("--expires-in produces an unsupported expiry timestamp");
		}
		expiresAt = new Date(expiresAtMs).toISOString();
	} else if (request.expiresAt !== undefined) {
		expiresAt = canonicalTimestamp("--expires-at", request.expiresAt);
	}
	if (expiresAt !== undefined && Date.parse(expiresAt) <= effectiveFromMs) {
		throw new Error("--expires-at must be later than --effective-from");
	}
	return { effectiveFrom, ...(expiresAt === undefined ? {} : { expiresAt }) };
}

function resolveNow(now: (() => Date) | undefined): Date {
	const resolved = (now ?? (() => new Date()))();
	if (!(resolved instanceof Date) || !Number.isFinite(resolved.getTime())) {
		throw new Error("Policy clock returned an invalid date");
	}
	return resolved;
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}

function importMutations(candidates: readonly PolicyImportCandidate[]): {
	readonly mutations: ReturnType<typeof compilePolicyImportCandidates>["mutations"];
	readonly conflicts: ReturnType<typeof compilePolicyImportCandidates>["conflicts"];
	readonly unsupported: readonly [];
} {
	return { ...compilePolicyImportCandidates(candidates), unsupported: [] };
}

async function collectImport(
	configPath: string,
	frontmatterPaths: readonly string[],
	projectPaths: readonly string[] = [],
	workstream?: string,
): Promise<{
	readonly candidates: readonly PolicyImportCandidate[];
	readonly report: Omit<PolicyImportReport, "transaction" | "committed">;
}> {
	const projectScope: PolicyScope = workstream === undefined ? { kind: "global" } : { kind: "workstream", workstream };
	const imported = await importPolicyYaml([
		{ sourcePath: configPath, layer: "global", scope: { kind: "global" } },
		...projectPaths.map(sourcePath => ({ sourcePath, layer: "project" as const, scope: projectScope })),
		...frontmatterPaths.map(sourcePath => ({ sourcePath, layer: "frontmatter" as const, scope: projectScope })),
	]);
	return {
		candidates: imported.candidates,
		report: {
			digest: imported.digest,
			sourcePaths: imported.sourcePaths,
			conflicts: imported.conflicts,
		},
	};
}

function authorFor(
	journal: PolicyJournal,
	kind: "cli" | "import",
	identity?: string,
): PolicyTransactionDraftV1["author"] {
	return {
		kind,
		uid: journal.uid,
		pid: journal.pid,
		...(identity === undefined ? {} : { sessionId: identity }),
	};
}

function sourceFor(digest: string, uri: string): PolicyTransactionDraftV1["source"] {
	return { kind: "import", uri, importDigest: digest };
}

function cliSourceFor(journal: PolicyJournal, source: string | undefined): PolicyTransactionDraftV1["source"] {
	return { kind: "cli", uri: source ?? journal.journalPath };
}

async function runImport(
	journal: PolicyJournal,
	request: PolicyCliRequest,
	now: () => Date,
): Promise<PolicyImportReport> {
	const explicitPaths = request.sourcePaths ?? [];
	const configPath = request.configPath ?? explicitPaths[0] ?? path.join(getAgentDir(), "config.yml");
	const projectPaths = request.configPath === undefined ? explicitPaths.slice(1) : explicitPaths;
	const collected = await collectImport(configPath, request.frontmatterPaths ?? [], projectPaths, request.workstream);
	const detail = importMutations(collected.candidates);
	const at = now();
	const interval = resolveSetInterval(request, at);
	const draft: PolicyTransactionDraftV1 = {
		transactionId: randomUUID(),
		createdAt: at.toISOString(),
		...interval,
		author: authorFor(journal, "import", request.author),
		source: sourceFor(collected.report.digest, configPath),
		reason: request.reason ?? "bootstrap policy import",
		registry: { version: POLICY_REGISTRY_VERSION, digest: POLICY_REGISTRY_DIGEST },
		mutations: detail.mutations,
	};
	if (draft.mutations.length === 0) throw new Error("policy import found no supported policy candidates");
	const preview = await journal.previewAppend(draft);
	const shouldCommit = request.apply === true && request.dryRun !== true;
	const transaction = shouldCommit
		? await journal.append(draft, {
				expectedHead: { sequence: preview.sequence - 1, hash: preview.previousHash },
			})
		: preview;
	return { ...collected.report, transaction, committed: shouldCommit };
}

function formatOutput(value: unknown, json: boolean): string {
	return json ? `${JSON.stringify(value, null, 2)}\n` : `${JSON.stringify(value)}\n`;
}

function formatExplainOutput(value: unknown, json: boolean): string {
	if (
		!json &&
		isRecord(value) &&
		typeof value.status === "string" &&
		typeof value.countdownTo === "string" &&
		Array.isArray(value.entries)
	) {
		return `${JSON.stringify(value, null, 2)}\n`;
	}
	return formatOutput(value, json);
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
		return await run(journal, makePolicyService(journal, { fragmentRegistry: options.fragmentRegistry }));
	} finally {
		await journal.release();
	}
}

export async function runPolicyCommand(request: PolicyCliRequest, options: PolicyCliOptions = {}): Promise<string> {
	const json = request.json === true;
	const now = resolveNow(options.now);
	const nowIso = now.toISOString();
	const resolvedOptions: PolicyCliOptions = { ...options, now: () => now };
	if (request.action === "import") {
		const report = await withPolicyService(resolvedOptions, journal => runImport(journal, request, () => now));
		return formatOutput(report, json);
	}
	if (request.action === "export") {
		const records = await withPolicyService(resolvedOptions, journal => journal.replay());
		return exportLegacyPolicyYaml(records).yaml;
	}
	return withPolicyService(resolvedOptions, async (journal, service) => {
		switch (request.action) {
			case "get":
				if (!request.key) throw new Error("policy get requires a key");
				return formatOutput(
					await Effect.runPromise(service.get(request.key, { workstream: request.workstream, at: nowIso })),
					json,
				);
			case "explain":
				if (!request.key) throw new Error("policy explain requires a key");
				return formatExplainOutput(
					await Effect.runPromise(service.explain(request.key, { workstream: request.workstream, at: nowIso })),
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
			case "history":
				return formatOutput(
					await Effect.runPromise(
						service.history({ key: request.key, author: request.author, since: request.since }),
					),
					json,
				);
			case "drift": {
				const sessions =
					resolvedOptions.liveSessions?.() ??
					listLivePolicySessions({
						ircDbPath: resolvedOptions.ircDbPath,
						controlDbPath: resolvedOptions.controlDbPath,
						nowMs: now.getTime(),
					});
				return formatOutput(await Effect.runPromise(service.drift(sessions, { at: nowIso })), json);
			}
			case "impact": {
				if (!request.key) throw new Error("policy impact requires a policy key or transaction ID");
				const sessions =
					resolvedOptions.liveSessions?.() ??
					listLivePolicySessions({
						ircDbPath: resolvedOptions.ircDbPath,
						controlDbPath: resolvedOptions.controlDbPath,
						nowMs: now.getTime(),
					});
				if (request.value === undefined) {
					return formatOutput(
						await Effect.runPromise(
							service.impactRollback(
								{
									transactionId: request.transactionId ?? request.key,
									reason: request.reason ?? "policy rollback impact preview",
									author: authorFor(journal, "cli", request.author),
									source: cliSourceFor(journal, request.source),
								},
								sessions,
							),
						),
						json,
					);
				}
				const value = decodeSetValue(request.key, request.value, resolvedOptions.fragmentRegistry);
				const interval = resolveSetInterval(request, now);
				return formatOutput(
					await Effect.runPromise(
						service.impactSet(
							{
								key: request.key,
								value,
								scope: { kind: "global" },
								reason: request.reason ?? "policy set impact preview",
								author: authorFor(journal, "cli", request.author),
								source: cliSourceFor(journal, request.source),
								...interval,
							},
							sessions,
						),
					),
					json,
				);
			}
			case "rebuild":
				return formatOutput(
					await Effect.runPromise(service.rebuildProjection({ workstream: request.workstream, at: nowIso })),
					json,
				);
			case "set": {
				if (!request.key || request.value === undefined) throw new Error("policy set requires a key and value");
				const value = decodeSetValue(request.key, request.value, resolvedOptions.fragmentRegistry);
				const interval = resolveSetInterval(request, now);
				const set = {
					key: request.key,
					value,
					scope: { kind: "global" } satisfies PolicyScope,
					reason: request.reason ?? "policy set",
					author: authorFor(journal, "cli", request.author),
					source: cliSourceFor(journal, request.source),
					...interval,
				};
				if (request.dryRun === true) {
					return formatOutput(await Effect.runPromise(service.set({ ...set, dryRun: true })), json);
				}
				return formatOutput(await commitPolicyWithPreview({ service, set }), json);
			}
			case "rollback":
				if (!request.transactionId) throw new Error("policy rollback requires a transaction ID");
				return formatOutput(
					await Effect.runPromise(
						service.rollback({
							transactionId: request.transactionId,
							reason: request.reason ?? "policy rollback",
							author: authorFor(journal, "cli", request.author),
							source: cliSourceFor(journal, request.source),
							dryRun: request.dryRun,
						}),
					),
					json,
				);
			default:
				throw new Error(`Unsupported policy action: ${request.action}`);
		}
	});
}

export { collectImport, importMutations };
