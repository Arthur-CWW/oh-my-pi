import { Args, Command, Flags } from "@oh-my-pi/pi-utils/cli";
import {
	type AutomationEntry,
	getAutomationLedgerPath,
	isAutomationDue,
	latestAutomationRun,
	loadAutomationRegistry,
	readAutomationLedger,
	runAutomationDaemon,
	runAutomationOnce,
} from "./automations";

function findAutomation(entries: readonly AutomationEntry[], name: string | undefined): AutomationEntry {
	if (!name) throw new Error("Automation name is required");
	const entry = entries.find(candidate => candidate.name === name);
	if (!entry) throw new Error(`Unknown automation: ${name}`);
	return entry;
}

function printRows(headers: readonly string[], rows: readonly (readonly string[])[]): void {
	const widths = headers.map((header, index) =>
		Math.max(header.length, ...rows.map(row => (row[index] ?? "").length)),
	);
	process.stdout.write(`${headers.map((header, index) => header.padEnd(widths[index])).join("  ")}\n`);
	for (const row of rows) {
		process.stdout.write(`${row.map((value, index) => value.padEnd(widths[index])).join("  ")}\n`);
	}
}

export default class Automations extends Command {
	static description = "Run and supervise headless, resumable agent automations";

	static args = {
		action: Args.string({
			description: "list (default), run, status, or daemon",
			required: false,
			options: ["list", "run", "status", "daemon"],
			default: "list",
		}),
		name: Args.string({ description: "Automation name", required: false }),
	};

	static flags = {
		json: Flags.boolean({ char: "j", description: "Output JSON", default: false }),
	};

	static examples = [
		"omp automations list",
		"omp automations run nightly-triage",
		"omp automations status",
		"omp automations daemon",
		"launchd: use an absolute omp path with ProgramArguments [<omp>, automations, daemon] and KeepAlive=true, then run launchctl bootstrap gui/$UID <plist>",
	];

	async run(): Promise<void> {
		const { args, flags } = await this.parse(Automations);
		const entries = await loadAutomationRegistry();
		switch (args.action) {
			case "list": {
				if (flags.json) {
					process.stdout.write(`${JSON.stringify(entries, null, 2)}\n`);
					return;
				}
				printRows(
					["NAME", "SCHEDULE", "LANE/MODEL", "ENABLED", "CWD"],
					entries.map(entry => [
						entry.name,
						entry.schedule,
						entry.model ?? entry.lane,
						entry.enabled ? "yes" : "no",
						entry.cwd,
					]),
				);
				return;
			}
			case "run": {
				const result = await runAutomationOnce(findAutomation(entries, args.name));
				if (flags.json) process.stdout.write(`${JSON.stringify(result)}\n`);
				else
					process.stdout.write(
						`${result.name}: ${result.status} (${result.durationMs}ms)\n${result.outputSummary}\n`,
					);
				return;
			}
			case "status": {
				const now = Date.now();
				const statuses = await Promise.all(
					entries.map(async entry => {
						const latest = latestAutomationRun(await readAutomationLedger(entry));
						return {
							name: entry.name,
							enabled: entry.enabled,
							due: entry.enabled && isAutomationDue(entry.schedule, now, latest?.runAt),
							lastRun: latest,
							ledger: getAutomationLedgerPath(entry),
						};
					}),
				);
				if (flags.json) {
					process.stdout.write(`${JSON.stringify(statuses, null, 2)}\n`);
					return;
				}
				printRows(
					["NAME", "STATE", "LAST RUN", "STATUS", "SUMMARY"],
					statuses.map(status => [
						status.name,
						!status.enabled ? "disabled" : status.due ? "due" : "waiting",
						status.lastRun ? new Date(status.lastRun.runAt).toISOString() : "never",
						status.lastRun?.status ?? "-",
						status.lastRun?.outputSummary ?? "-",
					]),
				);
				return;
			}
			case "daemon": {
				const controller = new AbortController();
				const abort = (): void => controller.abort();
				process.once("SIGINT", abort);
				process.once("SIGTERM", abort);
				try {
					await runAutomationDaemon({ signal: controller.signal });
				} catch (error) {
					if (!controller.signal.aborted) throw error;
				} finally {
					process.off("SIGINT", abort);
					process.off("SIGTERM", abort);
				}
				return;
			}
		}
	}
}
