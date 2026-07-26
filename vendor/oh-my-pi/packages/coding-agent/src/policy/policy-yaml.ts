import { createHash } from "node:crypto";
import { YAML } from "bun";
import type { PolicyFragmentRegistry, PolicyJsonValue } from "./policy-fragment-registry";
import { projectPolicy, type PolicyFragmentNotice } from "./policy-projection";
import {
	CORE_BUDGET_FRAGMENT_VERSION,
	CORE_FALLBACK_FRAGMENT_VERSION,
	CORE_PROVIDER_FRAGMENT_VERSION,
	CORE_ROUTING_FRAGMENT_VERSION,
	decodePolicyValueForKey,
	isCoreBudgetKey,
	isCoreFallbackKey,
	isCoreProviderKey,
	isCoreRoutingKey,
	isPolicyKey,
	type ExtensionPolicyKey,
	isExtensionPolicyKey,
	type PolicyKey,
	type PolicyMutationV1,
	type PolicyScope,
	type PolicyTransactionV1,
	type PolicyValue,
} from "./policy-records";

const MODEL_ROLES: Record<string, true> = {
	default: true,
	smol: true,
	slow: true,
	vision: true,
	plan: true,
	designer: true,
	commit: true,
	title: true,
	implementer: true,
	qa: true,
	operator: true,
	synthesizer: true,
	task: true,
	advisor: true,
};

const TASK_BUDGET_KEYS = {
	maxConcurrency: "core.budgets.task.maxConcurrency",
	maxRuntimeMs: "core.budgets.task.maxRuntimeMs",
	softRequestBudget: "core.budgets.task.softRequestBudget",
} as const;

const SECRET_KEY_SEGMENT =
	/(?:api[-_]?key|access[-_]?key|private[-_]?key|token|secret|password|passwd|credential|credentials|oauth|authorization|refresh[-_]?token)$/i;
const SECRET_VALUE_PATTERNS: readonly {
	readonly classification: PolicySecretClassification;
	readonly pattern: RegExp;
}[] = [
	{ classification: "api-key", pattern: /\bsk-(?:ant-|proj-)?[A-Za-z0-9_-]{16,}\b/ },
	{ classification: "access-token", pattern: /\bgh[pousr]_[A-Za-z0-9]{20,}\b/ },
	{ classification: "access-token", pattern: /\bxox[baprs]-[A-Za-z0-9-]{16,}\b/ },
	{ classification: "bearer-token", pattern: /\bBearer\s+[A-Za-z0-9._~+/-]{16,}={0,2}\b/i },
	{ classification: "oauth-token", pattern: /\beyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\b/ },
	{ classification: "private-key", pattern: /-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/ },
];

export type PolicyYamlLayer = "global" | "project" | "overlay" | "frontmatter";
export type PolicySecretClassification =
	| "api-key"
	| "access-token"
	| "bearer-token"
	| "oauth-token"
	| "private-key"
	| "credential";

export interface PolicyYamlSource {
	readonly sourcePath: string;
	readonly layer: PolicyYamlLayer;
	readonly scope?: PolicyScope;
}

export interface PolicyImportCandidate {
	readonly sourcePath: string;
	readonly keyPath: string;
	readonly layer: PolicyYamlLayer;
	readonly key: PolicyKey;
	readonly value: PolicyValue;
	readonly scope: PolicyScope;
}

export interface PolicyImportConflictCandidate {
	readonly sourcePath: string;
	readonly keyPath: string;
	readonly layer: PolicyYamlLayer;
	readonly value: PolicyValue;
}

export interface PolicyImportConflictV1 {
	readonly key: PolicyKey;
	readonly classification: "policy";
	readonly mergeSemantics: "scalar-last-wins" | "array-replace" | "map-replace";
	readonly legacyMergeSemantics: "deep-merge";
	readonly candidates: readonly PolicyImportConflictCandidate[];
	readonly chosen: PolicyImportConflictCandidate;
	readonly shadowed: readonly PolicyImportConflictCandidate[];
	readonly requiredManualResolution: boolean;
}

export interface PolicyImportResultV1 {
	readonly digest: string;
	readonly sourcePaths: readonly string[];
	readonly candidates: readonly PolicyImportCandidate[];
	readonly conflicts: readonly PolicyImportConflictV1[];
	readonly mutations: readonly PolicyMutationV1[];
}

export interface PolicyImportIssue {
	readonly sourcePath: string;
	readonly keyPath: string;
	readonly reason: string;
}

export interface PolicySecretOffense {
	readonly sourcePath: string;
	readonly keyPath: string;
	readonly classification: PolicySecretClassification;
}

export class PolicyImportYamlError extends Error {
	readonly _tag = "PolicyImportYamlError" as const;
	constructor(
		readonly sourcePath: string,
		readonly reason: string,
	) {
		super(`Failed to parse policy YAML ${sourcePath}: ${reason}`);
		this.name = "PolicyImportYamlError";
	}
}

export class PolicyImportValidationError extends Error {
	readonly _tag = "PolicyImportValidationError" as const;
	constructor(readonly issues: readonly PolicyImportIssue[]) {
		super(
			`Policy YAML contains malformed or unknown routing keys: ${issues.map(issue => `${issue.sourcePath}:${issue.keyPath} (${issue.reason})`).join(", ")}`,
		);
		this.name = "PolicyImportValidationError";
	}
}

export class PolicyImportSecretRefusalError extends Error {
	readonly _tag = "PolicyImportSecretRefusalError" as const;
	constructor(readonly offendingPaths: readonly PolicySecretOffense[]) {
		super(
			`Policy import refused secret-class values at: ${offendingPaths.map(offense => `${offense.sourcePath}:${offense.keyPath}`).join(", ")}`,
		);
		this.name = "PolicyImportSecretRefusalError";
	}
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}

function stableValue(value: PolicyValue): string {
	if (typeof value !== "object" || value === null) return JSON.stringify(value);
	if (Array.isArray(value)) return `[${value.map(item => stableValue(item as PolicyValue)).join(",")}]`;
	return `{${Object.entries(value)
		.sort(([left], [right]) => left.localeCompare(right))
		.map(([key, item]) => `${JSON.stringify(key)}:${stableValue(item as PolicyValue)}`)
		.join(",")}}`;
}

function sourceScope(source: PolicyYamlSource): PolicyScope {
	return source.scope ?? { kind: "global" };
}

function secretClassification(keyPath: string, value: unknown): PolicySecretClassification | undefined {
	const segment = keyPath.split(".").at(-1) ?? keyPath;
	if (SECRET_KEY_SEGMENT.test(segment)) return "credential";
	if (typeof value !== "string") return undefined;
	return SECRET_VALUE_PATTERNS.find(candidate => candidate.pattern.test(value))?.classification;
}

function collectSecretOffenses(sourcePath: string, value: unknown, keyPath = ""): PolicySecretOffense[] {
	const offenses: PolicySecretOffense[] = [];
	if (keyPath.length > 0) {
		const classification = secretClassification(keyPath, value);
		if (classification) offenses.push({ sourcePath, keyPath, classification });
	}
	if (Array.isArray(value)) {
		for (let index = 0; index < value.length; index += 1) {
			offenses.push(...collectSecretOffenses(sourcePath, value[index], `${keyPath}[${index}]`));
		}
	} else if (isRecord(value)) {
		for (const [key, nested] of Object.entries(value)) {
			offenses.push(...collectSecretOffenses(sourcePath, nested, keyPath.length === 0 ? key : `${keyPath}.${key}`));
		}
	}
	return offenses;
}

function decodeCandidate(
	source: PolicyYamlSource,
	keyPath: string,
	key: PolicyKey,
	input: unknown,
	issues: PolicyImportIssue[],
): PolicyImportCandidate | undefined {
	try {
		return {
			sourcePath: source.sourcePath,
			keyPath,
			layer: source.layer,
			key,
			value: decodePolicyValueForKey(key, input),
			scope: sourceScope(source),
		};
	} catch (error) {
		issues.push({
			sourcePath: source.sourcePath,
			keyPath,
			reason: error instanceof Error ? error.message : String(error),
		});
		return undefined;
	}
}

function candidatesFromSettings(
	source: PolicyYamlSource,
	parsed: Record<string, unknown>,
	issues: PolicyImportIssue[],
): PolicyImportCandidate[] {
	const candidates: PolicyImportCandidate[] = [];
	if (parsed.modelRoles !== undefined) {
		if (!isRecord(parsed.modelRoles)) {
			issues.push({ sourcePath: source.sourcePath, keyPath: "modelRoles", reason: "expected a mapping" });
		} else {
			for (const [role, value] of Object.entries(parsed.modelRoles)) {
				if (!(role in MODEL_ROLES)) {
					issues.push({
						sourcePath: source.sourcePath,
						keyPath: `modelRoles.${role}`,
						reason: "unknown policy model role",
					});
					continue;
				}
				const candidate = decodeCandidate(
					source,
					`modelRoles.${role}`,
					`core.routing.${role}` as PolicyKey,
					value,
					issues,
				);
				if (candidate) candidates.push(candidate);
			}
		}
	}
	if (parsed.disabledProviders !== undefined) {
		const value = Array.isArray(parsed.disabledProviders)
			? { providerIds: [...new Set(parsed.disabledProviders)] }
			: parsed.disabledProviders;
		const candidate = decodeCandidate(source, "disabledProviders", "core.providers.deny.providers", value, issues);
		if (candidate) candidates.push(candidate);
	}
	if (parsed.disabledModels !== undefined) {
		const models = Array.isArray(parsed.disabledModels)
			? parsed.disabledModels.map(value => {
					if (typeof value !== "string") return value;
					const separator = value.indexOf("/");
					return separator > 0
						? { provider: value.slice(0, separator), model: value.slice(separator + 1) }
						: value;
				})
			: parsed.disabledModels;
		const candidate = decodeCandidate(source, "disabledModels", "core.providers.deny.models", { models }, issues);
		if (candidate) candidates.push(candidate);
	}
	if (parsed.retry !== undefined && !isRecord(parsed.retry)) {
		issues.push({ sourcePath: source.sourcePath, keyPath: "retry", reason: "expected a mapping" });
	} else if (isRecord(parsed.retry) && parsed.retry.proposableFallbackChains !== undefined) {
		const candidate = decodeCandidate(
			source,
			"retry.proposableFallbackChains",
			"core.fallback.chains",
			{ chains: parsed.retry.proposableFallbackChains },
			issues,
		);
		if (candidate) candidates.push(candidate);
	}
	if (parsed.task !== undefined && !isRecord(parsed.task)) {
		issues.push({ sourcePath: source.sourcePath, keyPath: "task", reason: "expected a mapping" });
	} else if (isRecord(parsed.task)) {
		for (const [legacyKey, policyKey] of Object.entries(TASK_BUDGET_KEYS)) {
			if (parsed.task[legacyKey] === undefined) continue;
			const candidate = decodeCandidate(source, `task.${legacyKey}`, policyKey, parsed.task[legacyKey], issues);
			if (candidate) candidates.push(candidate);
		}
	}
	return candidates;
}

function candidatesFromFrontmatter(
	source: PolicyYamlSource,
	parsed: Record<string, unknown>,
	issues: PolicyImportIssue[],
): PolicyImportCandidate[] {
	const model = parsed.model;
	if (model === undefined) return [];
	let role = "task";
	if (typeof parsed.modelRole === "string") role = parsed.modelRole;
	else if (typeof parsed.role === "string" && parsed.role in MODEL_ROLES) role = parsed.role;
	if (!(role in MODEL_ROLES)) {
		issues.push({ sourcePath: source.sourcePath, keyPath: "modelRole", reason: `unknown policy model role ${role}` });
		return [];
	}
	const candidate = decodeCandidate(source, "model", `core.routing.${role}` as PolicyKey, model, issues);
	return candidate ? [candidate] : [];
}

async function parseSource(
	source: PolicyYamlSource,
): Promise<{ readonly parsed: Record<string, unknown>; readonly bytes: Uint8Array }> {
	const bytes = new Uint8Array(await Bun.file(source.sourcePath).arrayBuffer());
	const content = new TextDecoder().decode(bytes);
	let parsed: unknown;
	try {
		if (source.layer === "frontmatter") {
			const match = /^---\s*\n([\s\S]*?)\n---(?:\s*\n|$)/.exec(content);
			if (!match?.[1]) throw new Error("missing YAML frontmatter block");
			parsed = YAML.parse(match[1]);
		} else {
			parsed = YAML.parse(content);
		}
	} catch (error) {
		throw new PolicyImportYamlError(source.sourcePath, error instanceof Error ? error.message : String(error));
	}
	if (!isRecord(parsed)) throw new PolicyImportYamlError(source.sourcePath, "document root must be a mapping");
	return { parsed, bytes };
}

function mutationFor(candidate: PolicyImportCandidate): PolicyMutationV1 {
	const common = {
		op: "set" as const,
		key: candidate.key,
		scope: candidate.scope,
		value: candidate.value,
		importProvenance: { sourcePath: candidate.sourcePath, keyPath: candidate.keyPath },
	};
	if (isCoreProviderKey(candidate.key))
		return { ...common, key: candidate.key, fragmentVersion: CORE_PROVIDER_FRAGMENT_VERSION } as PolicyMutationV1;
	if (isCoreFallbackKey(candidate.key))
		return { ...common, key: candidate.key, fragmentVersion: CORE_FALLBACK_FRAGMENT_VERSION } as PolicyMutationV1;
	if (isCoreBudgetKey(candidate.key))
		return { ...common, key: candidate.key, fragmentVersion: CORE_BUDGET_FRAGMENT_VERSION } as PolicyMutationV1;
	if (isCoreRoutingKey(candidate.key))
		return { ...common, key: candidate.key, fragmentVersion: CORE_ROUTING_FRAGMENT_VERSION } as PolicyMutationV1;
	throw new Error(`Unsupported policy import key: ${candidate.key}`);
}

function scopeIdentity(scope: PolicyScope): string {
	return scope.kind === "global" ? "global" : `workstream:${scope.workstream}`;
}

function mergeSemantics(key: PolicyKey): PolicyImportConflictV1["mergeSemantics"] {
	if (key === "core.providers.deny.providers" || key === "core.providers.deny.models") return "array-replace";
	if (key === "core.fallback.chains") return "map-replace";
	return "scalar-last-wins";
}

export async function importPolicyYaml(sources: readonly PolicyYamlSource[]): Promise<PolicyImportResultV1> {
	if (sources.length === 0)
		throw new PolicyImportValidationError([
			{ sourcePath: "<none>", keyPath: "<sources>", reason: "at least one source is required" },
		]);
	const candidates: PolicyImportCandidate[] = [];
	const issues: PolicyImportIssue[] = [];
	const secrets: PolicySecretOffense[] = [];
	const digest = createHash("sha256");
	for (const source of sources) {
		const { parsed, bytes } = await parseSource(source);
		digest.update(source.sourcePath, "utf8");
		digest.update("\0", "utf8");
		digest.update(bytes);
		digest.update("\0", "utf8");
		secrets.push(...collectSecretOffenses(source.sourcePath, parsed));
		candidates.push(
			...(source.layer === "frontmatter"
				? candidatesFromFrontmatter(source, parsed, issues)
				: candidatesFromSettings(source, parsed, issues)),
		);
	}
	if (secrets.length > 0) throw new PolicyImportSecretRefusalError(secrets);
	if (issues.length > 0) throw new PolicyImportValidationError(issues);

	const { conflicts, mutations } = compilePolicyImportCandidates(candidates);
	return {
		digest: digest.digest("hex"),
		sourcePaths: sources.map(source => source.sourcePath),
		candidates,
		conflicts,
		mutations,
	};
}

export function compilePolicyImportCandidates(candidates: readonly PolicyImportCandidate[]): {
	readonly conflicts: readonly PolicyImportConflictV1[];
	readonly mutations: readonly PolicyMutationV1[];
} {
	const candidatesByKey = new Map<PolicyKey, PolicyImportCandidate[]>();
	for (const candidate of candidates) {
		const current = candidatesByKey.get(candidate.key);
		if (current) current.push(candidate);
		else candidatesByKey.set(candidate.key, [candidate]);
	}
	const conflicts: PolicyImportConflictV1[] = [];
	for (const [key, values] of candidatesByKey) {
		if (values.length < 2) continue;
		const reports = values.map(({ sourcePath, keyPath, layer, value }) => ({ sourcePath, keyPath, layer, value }));
		conflicts.push({
			key,
			classification: "policy",
			mergeSemantics: mergeSemantics(key),
			legacyMergeSemantics: "deep-merge",
			candidates: reports,
			chosen: reports.at(-1)!,
			shadowed: reports.slice(0, -1),
			requiredManualResolution: new Set(values.map(value => stableValue(value.value))).size > 1,
		});
	}
	const winnersByScopedKey = new Map<string, PolicyImportCandidate>();
	for (const candidate of candidates)
		winnersByScopedKey.set(`${candidate.key}\0${scopeIdentity(candidate.scope)}`, candidate);
	return { conflicts, mutations: [...winnersByScopedKey.values()].map(mutationFor) };
}

export interface GeneratedLegacyPolicyExport {
	readonly yaml: string;
	readonly sequence: number;
	readonly hash: string;
	readonly redactedPaths: readonly string[];
}

export function exportLegacyPolicyYaml(records: readonly PolicyTransactionV1[]): GeneratedLegacyPolicyExport {
	const head = records.at(-1);
	const applied = new Map<PolicyKey, PolicyValue>();
	for (const record of records) {
		for (const mutation of record.mutations) {
			if (mutation.scope.kind !== "global") continue;
			if (!isPolicyKey(mutation.key)) continue;
			if (mutation.op === "clear") applied.delete(mutation.key);
			else applied.set(mutation.key, mutation.value as PolicyValue);
		}
	}
	const modelRoles: Record<string, string> = {};
	const task: Record<string, number> = {};
	const redactedPaths: string[] = [];
	let disabledProviders: readonly string[] | undefined;
	let disabledModels: readonly string[] | undefined;
	let fallbackChains: Readonly<Record<string, readonly string[]>> | undefined;
	for (const [key, value] of applied) {
		if (isCoreRoutingKey(key)) {
			const role = key.slice("core.routing.".length);
			if (typeof value === "string" && !secretClassification(`modelRoles.${role}`, value)) modelRoles[role] = value;
			else redactedPaths.push(`modelRoles.${role}`);
		} else if (key === "core.providers.deny.providers" && typeof value === "object" && "providerIds" in value) {
			disabledProviders = value.providerIds;
		} else if (key === "core.providers.deny.models" && typeof value === "object" && "models" in value) {
			disabledModels = value.models.map(model => `${model.provider}/${model.model}`);
		} else if (key === "core.fallback.chains" && typeof value === "object" && "chains" in value) {
			fallbackChains = value.chains;
		} else if (isCoreBudgetKey(key) && typeof value === "number") {
			task[key.slice("core.budgets.task.".length)] = value;
		}
	}
	const document: Record<string, unknown> = {
		generatedPolicySnapshot: {
			generated: true,
			doNotEdit: true,
			redacted: true,
			policySequence: head?.sequence ?? 0,
			policyHash: head?.recordHash ?? "0".repeat(64),
			redactedPaths,
		},
		...(Object.keys(modelRoles).length === 0 ? {} : { modelRoles }),
		...(disabledProviders === undefined ? {} : { disabledProviders }),
		...(disabledModels === undefined ? {} : { disabledModels }),
		...(fallbackChains === undefined ? {} : { retry: { proposableFallbackChains: fallbackChains } }),
		...(Object.keys(task).length === 0 ? {} : { task }),
	};
	const yaml = [
		"# GENERATED BY omp policy export — DO NOT EDIT",
		"# Redacted compatibility snapshot; the policy journal remains authoritative.",
		YAML.stringify(document, null, 2).trimEnd(),
		"",
	].join("\n");
	return { yaml, sequence: head?.sequence ?? 0, hash: head?.recordHash ?? "0".repeat(64), redactedPaths };
}

const emittedIgnoreNotices = new Set<string>();

export interface PolicyYamlIgnoreResult {
	readonly settings: Record<string, unknown>;
	readonly ignoredKeyPaths: readonly string[];
	readonly notice?: string;
}

export function ignoreImportedYamlForPolicyRuntime(
	settings: Record<string, unknown>,
	options: {
		readonly policyCapable: boolean;
		readonly sourcePath: string;
		readonly runtimeId?: string;
		readonly onNotice?: (notice: string) => void;
	},
): PolicyYamlIgnoreResult {
	if (!options.policyCapable) return { settings, ignoredKeyPaths: [] };
	const filtered = { ...settings };
	const ignoredKeyPaths: string[] = [];
	if ("modelRoles" in filtered) {
		delete filtered.modelRoles;
		ignoredKeyPaths.push("modelRoles");
	}
	for (const key of ["disabledProviders", "disabledModels"] as const) {
		if (!(key in filtered)) continue;
		delete filtered[key];
		ignoredKeyPaths.push(key);
	}
	if (isRecord(filtered.retry) && "proposableFallbackChains" in filtered.retry) {
		const retry = { ...filtered.retry };
		delete retry.proposableFallbackChains;
		filtered.retry = retry;
		ignoredKeyPaths.push("retry.proposableFallbackChains");
	}
	if (isRecord(filtered.task)) {
		const task = { ...filtered.task };
		for (const key of Object.keys(TASK_BUDGET_KEYS)) {
			if (!(key in task)) continue;
			delete task[key];
			ignoredKeyPaths.push(`task.${key}`);
		}
		filtered.task = task;
	}
	if (ignoredKeyPaths.length === 0) return { settings: filtered, ignoredKeyPaths };
	const noticeKey = `${options.runtimeId ?? "runtime"}\0${options.sourcePath}`;
	if (emittedIgnoreNotices.has(noticeKey)) return { settings: filtered, ignoredKeyPaths };
	emittedIgnoreNotices.add(noticeKey);
	const notice = `Policy-capable runtime ignored journal-owned YAML keys from ${options.sourcePath}: ${ignoredKeyPaths.join(", ")}`;
	options.onNotice?.(notice);
	return { settings: filtered, ignoredKeyPaths, notice };
}

export interface PolicyFragmentExportEntry {
	readonly fragmentVersion: number;
	readonly registration: string;
	readonly value: PolicyJsonValue;
	readonly provenance: {
		readonly sourceLayer: string;
		readonly scope: PolicyScope;
		readonly transactionId: string;
		readonly sequence: number;
		readonly recordHash: string;
		readonly author: PolicyTransactionV1["author"];
		readonly source: PolicyTransactionV1["source"];
		readonly reason: string;
	};
}

export interface GeneratedPolicyFragmentExport {
	readonly sequence: number;
	readonly hash: string;
	readonly fragments: Readonly<Partial<Record<ExtensionPolicyKey, PolicyFragmentExportEntry>>>;
	readonly notices: readonly PolicyFragmentNotice[];
	readonly preservedMutations: readonly {
		readonly transactionId: string;
		readonly sequence: number;
		readonly recordHash: string;
		readonly author: PolicyTransactionV1["author"];
		readonly source: PolicyTransactionV1["source"];
		readonly reason: string;
		readonly mutation: PolicyTransactionV1["mutations"][number];
	}[];
}

export interface PolicyFragmentImportResult {
	readonly mutations: readonly PolicyMutationV1[];
	readonly keys: readonly ExtensionPolicyKey[];
}

/**
 * Exports decoded effective values plus every inert/raw mutation. Raw journal
 * bytes remain authoritative; this is a read-only transfer representation.
 */
export function exportPolicyFragments(
	records: readonly PolicyTransactionV1[],
	fragmentRegistry: PolicyFragmentRegistry,
	options: { readonly at?: string; readonly workstream?: string } = {},
): GeneratedPolicyFragmentExport {
	const head = records.at(-1);
	const snapshot = projectPolicy(records, {
		at: options.at ?? head?.createdAt ?? new Date(0).toISOString(),
		workstream: options.workstream,
		fragmentRegistry,
	});
	const fragments: Partial<Record<ExtensionPolicyKey, PolicyFragmentExportEntry>> = {};
	for (const [rawKey, effective] of Object.entries(snapshot.fragmentValues ?? {})) {
		if (effective === undefined || !isExtensionPolicyKey(rawKey)) continue;
		const transaction = records.find(record => record.transactionId === effective.transactionId);
		if (transaction === undefined) continue;
		fragments[rawKey] = {
			fragmentVersion: effective.fragmentVersion,
			registration: effective.registration,
			value: effective.value,
			provenance: {
				sourceLayer: effective.sourceLayer,
				scope: effective.scope,
				transactionId: effective.transactionId,
				sequence: effective.sequence,
				recordHash: effective.recordHash,
				author: transaction.author,
				source: transaction.source,
				reason: transaction.reason,
			},
		};
	}
	const preservedMutations: GeneratedPolicyFragmentExport["preservedMutations"][number][] = [];
	for (const record of records) {
		for (const mutation of record.mutations) {
			if (!isExtensionPolicyKey(mutation.key)) continue;
			preservedMutations.push({
				transactionId: record.transactionId,
				sequence: record.sequence,
				recordHash: record.recordHash,
				author: record.author,
				source: record.source,
				reason: record.reason,
				mutation,
			});
		}
	}
	return {
		sequence: head?.sequence ?? 0,
		hash: head?.recordHash ?? "0".repeat(64),
		fragments,
		notices: snapshot.fragmentNotices ?? [],
		preservedMutations,
	};
}

/**
 * Imports effective fragment entries through the currently registered schema.
 * Older entries migrate in memory and are journaled at the current version.
 */
export function importPolicyFragments(
	input: Pick<GeneratedPolicyFragmentExport, "fragments">,
	fragmentRegistry: PolicyFragmentRegistry,
	options: { readonly sourcePath: string; readonly scope?: PolicyScope },
): PolicyFragmentImportResult {
	const mutations: PolicyMutationV1[] = [];
	const keys: ExtensionPolicyKey[] = [];
	const issues: PolicyImportIssue[] = [];
	for (const [rawKey, entry] of Object.entries(input.fragments)) {
		if (!isExtensionPolicyKey(rawKey) || entry === undefined) {
			issues.push({ sourcePath: options.sourcePath, keyPath: rawKey, reason: "invalid extension policy key" });
			continue;
		}
		const projected = fragmentRegistry.project(rawKey, entry.fragmentVersion, entry.value);
		if (projected.status !== "active") {
			issues.push({ sourcePath: options.sourcePath, keyPath: rawKey, reason: projected.notice });
			continue;
		}
		const registration = fragmentRegistry.resolve(rawKey);
		if (registration === undefined) {
			issues.push({
				sourcePath: options.sourcePath,
				keyPath: rawKey,
				reason: "extension namespace is not registered",
			});
			continue;
		}
		mutations.push({
			op: "set",
			key: rawKey,
			scope: options.scope ?? { kind: "global" },
			fragmentVersion: registration.version,
			value: projected.value,
			importProvenance: { sourcePath: options.sourcePath, keyPath: `fragments.${rawKey}.value` },
		});
		keys.push(rawKey);
	}
	if (issues.length > 0) throw new PolicyImportValidationError(issues);
	return { mutations, keys };
}
