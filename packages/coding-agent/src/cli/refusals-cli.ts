import chalk from "chalk";
import {
	type RefusalCase,
	RefusalCorpus,
	type RefusalReplayCompletion,
	type RefusalReplayRecord,
	type RefusalStats,
	type RefusalVerdictInput,
} from "../session/refusal-corpus";

export type RefusalsAction = "list" | "show" | "stats" | "mark" | "replay";

export interface RefusalsCommandOptions {
	readonly action: RefusalsAction;
	readonly id?: string;
	readonly path?: string;
	readonly flags?: {
		readonly limit?: number;
		readonly json?: boolean;
		readonly verdict?: string;
		readonly note?: string;
		readonly falsePositives?: boolean;
	};
	readonly completion?: RefusalReplayCompletion;
}

const VERDICTS: readonly RefusalVerdictInput[] = [
	"false-positive",
	"true-positive",
	"ambiguous",
	"unreviewed",
	"pending",
	"confirmed",
];

function writeLine(value = ""): void {
	process.stdout.write(`${value}\n`);
}

function writeError(message: string): void {
	process.stderr.write(`${chalk.red(`Error: ${message}`)}\n`);
	process.exitCode = 1;
}

function formatCase(refusalCase: RefusalCase): string[] {
	const model = `${refusalCase.provider}/${refusalCase.model}@${refusalCase.modelVersion}`;
	const lines = [
		`${chalk.bold(refusalCase.id)} ${chalk.dim(new Date(refusalCase.timestamp).toISOString())}`,
		`  model: ${model}  role: ${refusalCase.role}`,
		`  category: ${refusalCase.category}  verdict: ${refusalCase.verdict}`,
		`  action: ${refusalCase.action ?? "-"}  tool: ${refusalCase.tool ?? "-"}`,
		`  excerpt: ${refusalCase.safeExcerpt}`,
		`  refusal: ${refusalCase.refusalText || "-"}`,
	];
	if (refusalCase.contextSources.length > 0) lines.push(`  context: ${refusalCase.contextSources.join(", ")}`);
	if (refusalCase.note) lines.push(`  note: ${refusalCase.note}`);
	if (refusalCase.replayHistory.length > 0) lines.push(`  replays: ${refusalCase.replayHistory.length}`);
	return lines;
}

function formatCounts(label: string, counts: readonly { value: string | null; count: number }[]): string[] {
	const lines = [chalk.bold(label)];
	for (const count of counts) lines.push(`  ${count.value ?? "(none)"}: ${count.count}`);
	if (counts.length === 0) lines.push(`  ${chalk.dim("(none)")}`);
	return lines;
}

function validateVerdict(value: string | undefined): RefusalVerdictInput {
	if (!value || !VERDICTS.includes(value as RefusalVerdictInput)) {
		throw new Error(`--verdict must be one of: ${VERDICTS.join(", ")}`);
	}
	return value as RefusalVerdictInput;
}

function renderStats(stats: RefusalStats): string[] {
	return [
		chalk.bold(`Total refusals: ${stats.total}`),
		...formatCounts("Model version", stats.modelVersion),
		...formatCounts("Category", stats.category),
		...formatCounts("Action", stats.action),
		...formatCounts("Context source", stats.contextSource),
		...formatCounts("Verdict", stats.verdict),
	];
}

function renderReplay(replay: RefusalReplayRecord): string[] {
	const result =
		replay.outcome === "error" ? `error: ${replay.error ?? "unknown"}` : replay.refused ? "refused" : "passed";
	const category = replay.category ? ` (${replay.category})` : "";
	return [`${replay.caseId}: ${result}${category}`, `  ${replay.textExcerpt ?? "No refusal text"}`];
}

export async function runRefusalsCommand(options: RefusalsCommandOptions): Promise<void> {
	const corpus = new RefusalCorpus({ path: options.path });
	const flags = options.flags ?? {};
	try {
		switch (options.action) {
			case "list": {
				const cases = corpus.list({ limit: flags.limit ?? 50, falsePositivesOnly: flags.falsePositives });
				if (flags.json) {
					writeLine(JSON.stringify(cases, null, 2));
					return;
				}
				if (cases.length === 0) {
					writeLine(chalk.dim("No refusal cases recorded."));
					return;
				}
				for (const refusalCase of cases) writeLine(formatCase(refusalCase).join("\n"));
				return;
			}
			case "show": {
				if (!options.id) throw new Error("show requires a refusal case id");
				const refusalCase = corpus.get(options.id);
				if (!refusalCase) throw new Error(`Refusal case not found: ${options.id}`);
				if (flags.json) writeLine(JSON.stringify(refusalCase, null, 2));
				else writeLine(formatCase(refusalCase).join("\n"));
				return;
			}
			case "stats": {
				const stats = corpus.stats();
				if (flags.json) writeLine(JSON.stringify(stats, null, 2));
				else writeLine(renderStats(stats).join("\n"));
				return;
			}
			case "mark": {
				if (!options.id) throw new Error("mark requires a refusal case id");
				const verdict = validateVerdict(flags.verdict);
				const refusalCase = corpus.mark(options.id, { verdict, note: flags.note });
				if (flags.json) writeLine(JSON.stringify(refusalCase, null, 2));
				else writeLine(`Marked ${refusalCase.id} as ${refusalCase.verdict}.`);
				return;
			}
			case "replay": {
				const replays = flags.falsePositives
					? await corpus.replayFalsePositives({ completion: options.completion })
					: options.id
						? [await corpus.replay(options.id, { completion: options.completion })]
						: (() => {
								throw new Error("replay requires a refusal case id or --false-positives");
							})();
				if (flags.json) writeLine(JSON.stringify(replays, null, 2));
				else for (const replay of replays) writeLine(renderReplay(replay).join("\n"));
				return;
			}
		}
	} catch (error) {
		writeError(error instanceof Error ? error.message : String(error));
	}
}
