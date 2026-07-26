import chalk from "chalk";
import {
	type RefusalRecord,
	type RefusalRetryHandler,
	type RefusalStats,
	RefusalStore,
	type RefusalVerdict,
} from "../session/refusal-corpus";

export type RefusalsAction = "list" | "show" | "stats" | "review" | "retry";

export interface RefusalsCommandOptions {
	readonly action: RefusalsAction;
	readonly id?: string;
	readonly dbPath?: string;
	readonly legacyPath?: string | null;
	readonly flags?: {
		readonly limit?: number;
		readonly json?: boolean;
		readonly verdict?: string;
	};
	readonly retry?: RefusalRetryHandler;
}

const VERDICTS: readonly RefusalVerdict[] = ["false-positive", "true-positive", "ambiguous"];

function writeLine(value = ""): void {
	process.stdout.write(`${value}\n`);
}

function writeError(message: string): void {
	process.stderr.write(`${chalk.red(`Error: ${message}`)}\n`);
	process.exitCode = 1;
}

function formatRecord(record: RefusalRecord): string[] {
	return [
		`${chalk.bold(record.id)} ${chalk.dim(new Date(record.timestamp).toISOString())}`,
		`  session: ${record.sessionId}  child: ${record.childId ?? "-"}`,
		`  turn: ${record.turnId}  attempt: ${record.attemptId}`,
		`  model: ${record.provider}/${record.model}  reason: ${record.reasonClass}`,
		`  prompt digest: ${record.promptDigest}`,
		`  recovery: ${record.recoveryState}  route: ${record.recoveryModel ?? "-"}`,
		`  review: ${record.reviewStatus}  verdict: ${record.verdict ?? "-"}`,
	];
}

function formatCounts(label: string, counts: readonly { value: string | null; count: number }[]): string[] {
	const lines = [chalk.bold(label)];
	for (const count of counts) lines.push(`  ${count.value ?? "(none)"}: ${count.count}`);
	if (counts.length === 0) lines.push(`  ${chalk.dim("(none)")}`);
	return lines;
}

function validateVerdict(value: string | undefined): RefusalVerdict {
	if (!value || !VERDICTS.includes(value as RefusalVerdict)) {
		throw new Error(`--verdict must be one of: ${VERDICTS.join(", ")}`);
	}
	return value as RefusalVerdict;
}

function renderStats(stats: RefusalStats): string[] {
	return [
		chalk.bold(`Total refusals: ${stats.total}`),
		...formatCounts("Provider", stats.provider),
		...formatCounts("Model", stats.model),
		...formatCounts("Reason class", stats.reasonClass),
		...formatCounts("Recovery state", stats.recoveryState),
		...formatCounts("Review status", stats.reviewStatus),
		...formatCounts("Verdict", stats.verdict),
	];
}

export async function runRefusalsCommand(options: RefusalsCommandOptions): Promise<void> {
	const store = new RefusalStore({ dbPath: options.dbPath, legacyPath: options.legacyPath });
	const flags = options.flags ?? {};
	try {
		switch (options.action) {
			case "list": {
				const records = store.list({ limit: flags.limit ?? 50 });
				if (flags.json) writeLine(JSON.stringify(records, null, 2));
				else if (records.length === 0) writeLine(chalk.dim("No refusal records found."));
				else for (const record of records) writeLine(formatRecord(record).join("\n"));
				return;
			}
			case "show": {
				if (!options.id) throw new Error("show requires a refusal record id");
				const record = store.get(options.id);
				if (!record) throw new Error(`Refusal record not found: ${options.id}`);
				if (flags.json) writeLine(JSON.stringify({ ...record, events: store.events(record.id) }, null, 2));
				else writeLine([...formatRecord(record), `  events: ${store.events(record.id).length}`].join("\n"));
				return;
			}
			case "stats": {
				const stats = store.stats();
				if (flags.json) writeLine(JSON.stringify(stats, null, 2));
				else writeLine(renderStats(stats).join("\n"));
				return;
			}
			case "review": {
				if (!options.id) throw new Error("review requires a refusal record id");
				const record = store.review(options.id, validateVerdict(flags.verdict));
				if (flags.json) writeLine(JSON.stringify(record, null, 2));
				else writeLine(`Reviewed ${record.id} as ${record.verdict}.`);
				return;
			}
			case "retry": {
				if (!options.id) throw new Error("retry requires a refusal record id");
				const record = await store.retry(options.id, options.retry);
				if (flags.json) writeLine(JSON.stringify(record, null, 2));
				else writeLine(`Retry ${record.recoveryState} for ${record.id}; receipt ${record.recoveryReceipt}.`);
				return;
			}
		}
	} catch (error) {
		writeError(error instanceof Error ? error.message : String(error));
	} finally {
		store.close();
	}
}
