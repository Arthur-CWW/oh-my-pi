#!/usr/bin/env bun
import * as fs from "node:fs/promises";
import * as path from "node:path";

export const CLAUDE_ROUTE_POSTURE =
	"sonnet → haiku-class slots only; never via antigravity/gcp" as const;

export interface CatalogModel {
	readonly contextWindow?: number | null;
	readonly maxTokens?: number | null;
	readonly [field: string]: unknown;
}

export type CatalogSnapshot = Readonly<Record<string, Readonly<Record<string, CatalogModel>>>>;

export interface ModelLimits {
	readonly contextWindow: number | null;
	readonly maxTokens: number | null;
}

export type MaterialCatalogRow =
	| {
			readonly kind: "addition";
			readonly provider: string;
			readonly modelId: string;
			readonly after: ModelLimits;
	  }
	| {
			readonly kind: "removal";
			readonly provider: string;
			readonly modelId: string;
			readonly before: ModelLimits;
	  }
	| {
			readonly kind: "limit-change";
			readonly provider: string;
			readonly modelId: string;
			readonly before: ModelLimits;
			readonly after: ModelLimits;
	  };

export interface NewClaudeRow {
	readonly provider: "anthropic";
	readonly modelId: string;
	readonly source: "anthropic-discovery" | "bundled-models-dev-reference";
	readonly routePosture: typeof CLAUDE_ROUTE_POSTURE;
}

export interface CatalogProposalDiff {
	readonly rows: readonly MaterialCatalogRow[];
	readonly newClaudeRows: readonly NewClaudeRow[];
	readonly counts: {
		readonly additions: number;
		readonly removals: number;
		readonly limitChanges: number;
	};
}

export interface BuildProposalOptions {
	/** A non-null set means first-party Anthropic discovery was available and probed. */
	readonly anthropicDiscoveryIds?: ReadonlySet<string> | null;
}

function limitsOf(model: CatalogModel): ModelLimits {
	return {
		contextWindow: typeof model.contextWindow === "number" ? model.contextWindow : null,
		maxTokens: typeof model.maxTokens === "number" ? model.maxTokens : null,
	};
}

/** Pure material diff: identity and token limits matter; names, prices, capabilities, and provenance do not. */
export function buildCatalogProposalDiff(
	before: CatalogSnapshot,
	after: CatalogSnapshot,
	options: BuildProposalOptions = {},
): CatalogProposalDiff {
	const rows: MaterialCatalogRow[] = [];
	const providers = new Set([...Object.keys(before), ...Object.keys(after)]);
	for (const provider of providers) {
		const previousModels = before[provider] ?? {};
		const nextModels = after[provider] ?? {};
		const modelIds = new Set([...Object.keys(previousModels), ...Object.keys(nextModels)]);
		for (const modelId of modelIds) {
			const previous = previousModels[modelId];
			const next = nextModels[modelId];
			if (previous === undefined && next !== undefined) {
				rows.push({ kind: "addition", provider, modelId, after: limitsOf(next) });
				continue;
			}
			if (previous !== undefined && next === undefined) {
				rows.push({ kind: "removal", provider, modelId, before: limitsOf(previous) });
				continue;
			}
			if (previous !== undefined && next !== undefined) {
				const previousLimits = limitsOf(previous);
				const nextLimits = limitsOf(next);
				if (
					previousLimits.contextWindow !== nextLimits.contextWindow ||
					previousLimits.maxTokens !== nextLimits.maxTokens
				) {
					rows.push({
						kind: "limit-change",
						provider,
						modelId,
						before: previousLimits,
						after: nextLimits,
					});
				}
			}
		}
	}
	rows.sort(
		(left, right) =>
			left.provider.localeCompare(right.provider) ||
			left.modelId.localeCompare(right.modelId) ||
			left.kind.localeCompare(right.kind),
	);

	const discoveryIds = options.anthropicDiscoveryIds;
	const previousAnthropicIds = new Set(Object.keys(before.anthropic ?? {}));
	const newClaudeById = new Map<string, NewClaudeRow>();
	for (const row of rows) {
		if (
			row.kind !== "addition" ||
			row.provider !== "anthropic" ||
			!/^claude(?:[-._]|$)/i.test(row.modelId)
		) {
			continue;
		}
		newClaudeById.set(row.modelId, {
			provider: "anthropic",
			modelId: row.modelId,
			source: discoveryIds?.has(row.modelId)
				? "anthropic-discovery"
				: "bundled-models-dev-reference",
			routePosture: CLAUDE_ROUTE_POSTURE,
		});
	}
	if (discoveryIds !== null && discoveryIds !== undefined) {
		for (const modelId of discoveryIds) {
			if (previousAnthropicIds.has(modelId) || !/^claude(?:[-._]|$)/i.test(modelId)) continue;
			newClaudeById.set(modelId, {
				provider: "anthropic",
				modelId,
				source: "anthropic-discovery",
				routePosture: CLAUDE_ROUTE_POSTURE,
			});
		}
	}
	const newClaudeRows = [...newClaudeById.values()].sort((left, right) =>
		left.modelId.localeCompare(right.modelId),
	);

	return {
		rows,
		newClaudeRows,
		counts: {
			additions: rows.filter((row) => row.kind === "addition").length,
			removals: rows.filter((row) => row.kind === "removal").length,
			limitChanges: rows.filter((row) => row.kind === "limit-change").length,
		},
	};
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function decodeCatalogSnapshot(text: string): CatalogSnapshot {
	const decoded: unknown = JSON.parse(text);
	if (!isRecord(decoded)) throw new Error("catalog root must be an object");
	const snapshot: Record<string, Record<string, CatalogModel>> = {};
	for (const [provider, value] of Object.entries(decoded)) {
		if (!isRecord(value)) throw new Error(`catalog provider ${provider} must be an object`);
		const models: Record<string, CatalogModel> = {};
		for (const [modelId, model] of Object.entries(value)) {
			if (!isRecord(model))
				throw new Error(`catalog model ${provider}/${modelId} must be an object`);
			for (const field of ["contextWindow", "maxTokens"] as const) {
				const limit = model[field];
				if (limit !== undefined && limit !== null && typeof limit !== "number") {
					throw new Error(`catalog model ${provider}/${modelId} has invalid ${field}`);
				}
			}
			models[modelId] = model;
		}
		snapshot[provider] = models;
	}
	return snapshot;
}

export interface CommandRequest {
	readonly argv: readonly string[];
	readonly cwd: string;
}

export interface CommandResult {
	readonly exitCode: number;
	readonly stdout: string;
	readonly stderr: string;
}

export type CommandRunner = (request: CommandRequest) => Promise<CommandResult>;

async function command(request: CommandRequest): Promise<CommandResult> {
	const child = Bun.spawn([...request.argv], { cwd: request.cwd, stdout: "pipe", stderr: "pipe" });
	const [exitCode, stdout, stderr] = await Promise.all([
		child.exited,
		new Response(child.stdout).text(),
		new Response(child.stderr).text(),
	]);
	return { exitCode, stdout, stderr };
}

export type CatalogSyncStage =
	| "tracking"
	| "fetch"
	| "fast-forward"
	| "pull"
	| "snapshot"
	| "generate"
	| "codex-bundle-drift"
	| "anthropic-discovery"
	| "proposal"
	| "sync";

export type CatalogSyncFailureReport =
	| {
			readonly ok: false;
			readonly kind: "no-tracking";
			readonly stage: "tracking";
			readonly repository: string;
			readonly message: string;
	  }
	| {
			readonly ok: false;
			readonly kind: "non-fast-forward";
			readonly stage: "fast-forward" | "pull";
			readonly repository: string;
			readonly branch?: string;
			readonly upstream?: string;
			readonly message: string;
	  }
	| {
			readonly ok: false;
			readonly kind: "command-failure";
			readonly stage: CatalogSyncStage;
			readonly command: readonly string[];
			readonly cwd: string;
			readonly exitCode: number;
			readonly stdout: string;
			readonly stderr: string;
			readonly message: string;
	  }
	| {
			readonly ok: false;
			readonly kind: "operational-failure";
			readonly stage: CatalogSyncStage;
			readonly message: string;
	  };

class CatalogSyncError extends Error {
	constructor(readonly report: CatalogSyncFailureReport) {
		super(report.message);
		this.name = "CatalogSyncError";
	}
}

function commandFailure(
	stage: CatalogSyncStage,
	request: CommandRequest,
	result: CommandResult,
): CatalogSyncError {
	return new CatalogSyncError({
		ok: false,
		kind: "command-failure",
		stage,
		command: request.argv,
		cwd: request.cwd,
		exitCode: result.exitCode,
		stdout: result.stdout,
		stderr: result.stderr,
		message: `${request.argv.join(" ")} failed with exit ${result.exitCode}`,
	});
}

async function invokeCommand(
	runner: CommandRunner,
	stage: CatalogSyncStage,
	request: CommandRequest,
): Promise<CommandResult> {
	try {
		return await runner(request);
	} catch (error) {
		throw new CatalogSyncError({
			ok: false,
			kind: "operational-failure",
			stage,
			message: error instanceof Error ? error.message : String(error),
		});
	}
}

async function runRequired(
	runner: CommandRunner,
	stage: CatalogSyncStage,
	request: CommandRequest,
): Promise<CommandResult> {
	const result = await invokeCommand(runner, stage, request);
	if (result.exitCode !== 0) throw commandFailure(stage, request, result);
	return result;
}

async function inspectTracking(
	runner: CommandRunner,
	codexRoot: string,
): Promise<{ branch: string; upstream: string }> {
	const branchRequest = {
		argv: ["git", "symbolic-ref", "--quiet", "--short", "HEAD"],
		cwd: codexRoot,
	} as const;
	const branchResult = await invokeCommand(runner, "tracking", branchRequest);
	if (
		branchResult.exitCode === 1 ||
		(branchResult.exitCode === 0 && branchResult.stdout.trim() === "")
	) {
		throw new CatalogSyncError({
			ok: false,
			kind: "no-tracking",
			stage: "tracking",
			repository: codexRoot,
			message: "vendored Codex checkout is detached or has no current branch",
		});
	}
	if (branchResult.exitCode !== 0) throw commandFailure("tracking", branchRequest, branchResult);
	const upstreamRequest = {
		argv: ["git", "rev-parse", "--abbrev-ref", "--symbolic-full-name", "@{upstream}"],
		cwd: codexRoot,
	} as const;
	const upstreamResult = await invokeCommand(runner, "tracking", upstreamRequest);
	if (upstreamResult.exitCode !== 0 || upstreamResult.stdout.trim() === "") {
		const detail = `${upstreamResult.stderr}\n${upstreamResult.stdout}`.toLowerCase();
		if (
			upstreamResult.exitCode !== 128 ||
			(!detail.includes("upstream") && !detail.includes("upstream branch"))
		) {
			throw commandFailure("tracking", upstreamRequest, upstreamResult);
		}
		throw new CatalogSyncError({
			ok: false,
			kind: "no-tracking",
			stage: "tracking",
			repository: codexRoot,
			message: `vendored Codex branch ${branchResult.stdout.trim()} has no upstream tracking branch`,
		});
	}
	return { branch: branchResult.stdout.trim(), upstream: upstreamResult.stdout.trim() };
}

async function requireFastForwardable(
	runner: CommandRunner,
	codexRoot: string,
	tracking: { branch: string; upstream: string },
): Promise<void> {
	const localToUpstreamRequest = {
		argv: ["git", "merge-base", "--is-ancestor", "HEAD", "@{upstream}"],
		cwd: codexRoot,
	} as const;
	const localToUpstream = await invokeCommand(runner, "fast-forward", localToUpstreamRequest);
	if (localToUpstream.exitCode === 0) return;
	if (localToUpstream.exitCode !== 1) {
		throw commandFailure("fast-forward", localToUpstreamRequest, localToUpstream);
	}
	const upstreamToLocalRequest = {
		argv: ["git", "merge-base", "--is-ancestor", "@{upstream}", "HEAD"],
		cwd: codexRoot,
	} as const;
	const upstreamToLocal = await invokeCommand(runner, "fast-forward", upstreamToLocalRequest);
	if (upstreamToLocal.exitCode === 0) return;
	if (upstreamToLocal.exitCode !== 1) {
		throw commandFailure("fast-forward", upstreamToLocalRequest, upstreamToLocal);
	}
	throw new CatalogSyncError({
		ok: false,
		kind: "non-fast-forward",
		stage: "fast-forward",
		repository: codexRoot,
		branch: tracking.branch,
		upstream: tracking.upstream,
		message: `vendored Codex branch ${tracking.branch} has diverged from ${tracking.upstream}`,
	});
}

async function fastForwardCodex(runner: CommandRunner, codexRoot: string): Promise<void> {
	const tracking = await inspectTracking(runner, codexRoot);
	await runRequired(runner, "fetch", { argv: ["git", "fetch", "--prune"], cwd: codexRoot });
	await requireFastForwardable(runner, codexRoot, tracking);
	const request = { argv: ["git", "pull", "--ff-only", "--no-rebase"], cwd: codexRoot } as const;
	const result = await invokeCommand(runner, "pull", request);
	if (result.exitCode === 0) return;
	const detail = `${result.stderr}\n${result.stdout}`.toLowerCase();
	if (detail.includes("fast-forward") || detail.includes("diverg")) {
		throw new CatalogSyncError({
			ok: false,
			kind: "non-fast-forward",
			stage: "pull",
			repository: codexRoot,
			branch: tracking.branch,
			upstream: tracking.upstream,
			message: `git pull refused a non-fast-forward update for ${tracking.branch}`,
		});
	}
	throw commandFailure("pull", request, result);
}

async function probeAnthropicDiscovery(
	environment: NodeJS.ProcessEnv,
): Promise<ReadonlySet<string> | null> {
	const credential = environment.ANTHROPIC_API_KEY ?? environment.ANTHROPIC_OAUTH_TOKEN;
	if (!credential) return null;
	const oauth = credential.startsWith("sk-ant-oat");
	const response = await fetch("https://api.anthropic.com/v1/models?limit=1000", {
		headers: {
			"anthropic-version": "2023-06-01",
			...(oauth ? { Authorization: `Bearer ${credential}` } : { "x-api-key": credential }),
		},
	});
	if (!response.ok) throw new Error(`Anthropic discovery failed with HTTP ${response.status}`);
	const payload: unknown = await response.json();
	if (!isRecord(payload)) throw new Error("Anthropic discovery returned a non-object payload");
	const data = payload.data;
	if (!Array.isArray(data)) throw new Error("Anthropic discovery returned no model list");
	const ids = new Set<string>();
	for (const entry of data) {
		if (isRecord(entry) && typeof entry.id === "string") ids.add(entry.id);
	}
	return ids;
}

export function renderCatalogProposal(date: string, diff: CatalogProposalDiff): string {
	const lines = [
		`# Catalog sync proposal — ${date}`,
		"",
		"Generated for manual adoption. This script does not commit or bless generated changes.",
		"",
		"## Material summary",
		"",
		`- Additions: ${diff.counts.additions}`,
		`- Removals: ${diff.counts.removals}`,
		`- Limit changes: ${diff.counts.limitChanges}`,
		"",
		"## Material rows",
		"",
	];
	for (const row of diff.rows) {
		if (row.kind === "addition") {
			lines.push(
				`- ADD \`${row.provider}/${row.modelId}\` — context ${row.after.contextWindow ?? "unknown"}, output ${row.after.maxTokens ?? "unknown"}`,
			);
		} else if (row.kind === "removal") {
			lines.push(
				`- REMOVE \`${row.provider}/${row.modelId}\` — context ${row.before.contextWindow ?? "unknown"}, output ${row.before.maxTokens ?? "unknown"}`,
			);
		} else {
			lines.push(
				`- LIMIT \`${row.provider}/${row.modelId}\` — context ${row.before.contextWindow ?? "unknown"} → ${row.after.contextWindow ?? "unknown"}; output ${row.before.maxTokens ?? "unknown"} → ${row.after.maxTokens ?? "unknown"}`,
			);
		}
	}
	if (diff.newClaudeRows.length > 0) {
		lines.push("", "## NEW claude-series rows", "");
		for (const row of diff.newClaudeRows) {
			lines.push(`- NEW \`${row.provider}/${row.modelId}\` (${row.source}) — ${row.routePosture}`);
		}
	}
	return `${lines.join("\n")}\n`;
}

export interface CatalogSyncConfig {
	readonly repoRoot: string;
	readonly environment?: NodeJS.ProcessEnv;
	readonly now?: Date;
}

export interface CatalogSyncDependencies {
	readonly runCommand?: CommandRunner;
	readonly discoverAnthropicIds?: (
		environment: NodeJS.ProcessEnv,
	) => Promise<ReadonlySet<string> | null>;
}

export type CatalogSyncResult =
	| { readonly ok: true; readonly exitCode: 0; readonly diff: CatalogProposalDiff }
	| {
			readonly ok: true;
			readonly exitCode: 2;
			readonly diff: CatalogProposalDiff;
			readonly proposalPath: string;
	  };

export async function syncCatalog(
	config: CatalogSyncConfig,
	dependencies: CatalogSyncDependencies = {},
): Promise<CatalogSyncResult> {
	const runner = dependencies.runCommand ?? command;
	const environment = config.environment ?? process.env;
	const repoRoot = path.resolve(config.repoRoot);
	const codexRoot = path.join(repoRoot, "vendor", "openai", "codex");
	const catalogRoot = path.join(repoRoot, "vendor", "oh-my-pi", "packages", "catalog");
	const ompRoot = path.join(repoRoot, "vendor", "oh-my-pi");
	const modelsPath = path.join(catalogRoot, "src", "models.json");

	await fastForwardCodex(runner, codexRoot);
	let before: CatalogSnapshot;
	try {
		before = decodeCatalogSnapshot(await fs.readFile(modelsPath, "utf8"));
	} catch (error) {
		throw new CatalogSyncError({
			ok: false,
			kind: "operational-failure",
			stage: "snapshot",
			message: error instanceof Error ? error.message : String(error),
		});
	}

	await runRequired(runner, "generate", {
		argv: ["bun", "--cwd=vendor/oh-my-pi/packages/catalog", "run", "generate"],
		cwd: repoRoot,
	});
	await runRequired(runner, "codex-bundle-drift", {
		argv: ["bun", "test", "packages/catalog/test/codex-bundle-drift.test.ts"],
		cwd: ompRoot,
	});

	let after: CatalogSnapshot;
	try {
		after = decodeCatalogSnapshot(await fs.readFile(modelsPath, "utf8"));
	} catch (error) {
		throw new CatalogSyncError({
			ok: false,
			kind: "operational-failure",
			stage: "snapshot",
			message: error instanceof Error ? error.message : String(error),
		});
	}

	let anthropicDiscoveryIds: ReadonlySet<string> | null;
	try {
		anthropicDiscoveryIds = await (dependencies.discoverAnthropicIds ?? probeAnthropicDiscovery)(
			environment,
		);
	} catch (error) {
		throw new CatalogSyncError({
			ok: false,
			kind: "operational-failure",
			stage: "anthropic-discovery",
			message: error instanceof Error ? error.message : String(error),
		});
	}
	const diff = buildCatalogProposalDiff(before, after, { anthropicDiscoveryIds });
	if (diff.rows.length === 0 && diff.newClaudeRows.length === 0)
		return { ok: true, exitCode: 0, diff };

	const date = (config.now ?? new Date()).toISOString().slice(0, 10);
	const proposalPath = path.join(repoRoot, "local", "catalog-sync", `${date}.md`);
	try {
		await fs.mkdir(path.dirname(proposalPath), { recursive: true });
		await fs.writeFile(proposalPath, renderCatalogProposal(date, diff));
	} catch (error) {
		throw new CatalogSyncError({
			ok: false,
			kind: "operational-failure",
			stage: "proposal",
			message: error instanceof Error ? error.message : String(error),
		});
	}
	return { ok: true, exitCode: 2, diff, proposalPath };
}

if (import.meta.main) {
	syncCatalog({ repoRoot: process.env.CATALOG_SYNC_REPO_ROOT ?? path.join(import.meta.dir, "..") })
		.then((result) => {
			if (result.exitCode === 0) {
				console.log("catalog sync clean: no material drift");
			} else {
				console.log(`catalog sync proposal: ${result.proposalPath}`);
			}
			process.exitCode = result.exitCode;
		})
		.catch((error: unknown) => {
			const report: CatalogSyncFailureReport =
				error instanceof CatalogSyncError
					? error.report
					: {
							ok: false,
							kind: "operational-failure",
							stage: "sync",
							message: error instanceof Error ? error.message : String(error),
						};
			console.error(JSON.stringify(report));
			process.exitCode = 1;
		});
}
