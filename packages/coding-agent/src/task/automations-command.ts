import { Effect, Option } from "effect";
import { Argument, Command, Flag } from "effect/unstable/cli";
import {
	type AutomationEntry,
	AutomationRunError,
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

function reportAutomationFailure(error: AutomationRunError, json: boolean): void {
	if (json) {
		process.stdout.write(`${JSON.stringify(error.result)}\n`);
	} else {
		process.stderr.write(
			`${error.result.name}: failed (${error.result.durationMs}ms)\n${error.message}\n`,
		);
	}
	process.exitCode = error.result.exitCode ?? 1;
}

export default Command.make(
	"automations",
	{
		action: Argument.choice("action", ["list", "run", "status", "daemon"] as const).pipe(
			Argument.withDescription("list (default), run, status, or daemon"),
			Argument.withDefault("list"),
		),
		name: Argument.optional(
			Argument.string("name").pipe(Argument.withDescription("Automation name")),
		),
		json: Flag.boolean("json").pipe(
			Flag.withAlias("j"),
			Flag.withDescription("Output JSON"),
			Flag.withDefault(false),
		),
	},
	config =>
		Effect.promise(async () => {
			const entries = await loadAutomationRegistry();
			switch (config.action) {
				case "list": {
					if (config.json) {
						process.stdout.write(`${JSON.stringify(entries, null, 2)}\n`);
						return;
					}
					printRows(
						["NAME", "SCHEDULE", "TYPE/LANE/MODEL", "ENABLED", "CWD"],
						entries.map(entry => [
							entry.name,
							entry.schedule,
							entry.command ? "command" : entry.model ?? entry.lane,
							entry.enabled ? "yes" : "no",
							entry.cwd,
						]),
					);
					return;
				}
				case "run": {
					try {
						const result = await runAutomationOnce(
							findAutomation(entries, Option.getOrUndefined(config.name)),
						);
						if (config.json) process.stdout.write(`${JSON.stringify(result)}\n`);
						else
							process.stdout.write(
								`${result.name}: ${result.status} (${result.durationMs}ms)\n${result.outputSummary}\n`,
							);
					} catch (error) {
						if (!(error instanceof AutomationRunError)) throw error;
						reportAutomationFailure(error, config.json);
					}
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
					if (config.json) {
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
						await runAutomationDaemon({
							signal: controller.signal,
							onError: (entry, error) => {
								const message = error instanceof Error ? error.message : String(error);
								process.stderr.write(`${entry.name}: failed\n${message}\n`);
							},
						});
					} catch (error) {
						if (!controller.signal.aborted) throw error;
					} finally {
						process.off("SIGINT", abort);
						process.off("SIGTERM", abort);
					}
					return;
				}
			}
		}),
).pipe(
	Command.withDescription("Run and supervise scheduled prompt, packet, or command automations"),
	Command.withExamples([
		{ command: "omp automations list" },
		{ command: "omp automations run nightly-triage" },
		{ command: "omp automations status" },
		{ command: "omp automations daemon" },
		{
			command:
				"launchd: use an absolute omp path with ProgramArguments [<omp>, automations, daemon] and KeepAlive=true, then run launchctl bootstrap gui/$UID <plist>",
		},
	]),
);
