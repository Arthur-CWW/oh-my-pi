import { Effect } from "effect";
import { Argument, Command, Flag } from "effect/unstable/cli";
import {
	checkDiskAdmission,
	type DiskOperationKind,
	probeDiskPressure,
} from "../resource/disk-pressure";

const ACTIONS = ["status", "check", "notify", "guard"] as const;
const OPERATION_NAMES = [
	"heavy",
	"build",
	"download",
	"proof",
	"workspace",
	"read-only",
	"status",
	"cleanup",
	"offload",
	"already-running",
] as const;

const OPERATION_BY_NAME: Readonly<Record<(typeof OPERATION_NAMES)[number], DiskOperationKind>> = {
	heavy: "heavy",
	build: "heavy",
	download: "heavy",
	proof: "heavy",
	workspace: "heavy",
	"read-only": "readOnly",
	status: "status",
	cleanup: "cleanup",
	offload: "offload",
	"already-running": "alreadyRunning",
};

export default Command.make(
	"disk",
	{
		action: Argument.choice("action", ACTIONS).pipe(Argument.withDescription("Disk pressure action")),
		operation: Flag.choice("operation", OPERATION_NAMES).pipe(
			Flag.withDescription("Operation class for guard admission"),
			Flag.withDefault("heavy"),
		),
		dryRun: Flag.boolean("dry-run").pipe(
			Flag.withDescription("Report notification and guard effects without mutating state"),
			Flag.withDefault(false),
		),
	},
	config =>
		Effect.promise(async () => {
			if (config.action === "status") {
				process.stdout.write(`${JSON.stringify(await probeDiskPressure({ dryRun: true }), null, 2)}\n`);
				return;
			}
			if (config.action === "notify") {
				process.stdout.write(
					`${JSON.stringify(await probeDiskPressure({ notify: true, dryRun: config.dryRun }), null, 2)}\n`,
				);
				return;
			}
			const decision = await checkDiskAdmission(OPERATION_BY_NAME[config.operation], {
				notify: true,
				dryRun: config.action === "check" || config.dryRun,
			});
			process.stdout.write(`${JSON.stringify(decision, null, 2)}\n`);
			if (config.action === "guard" && !decision.admitted && !config.dryRun) process.exitCode = 75;
		}),
).pipe(
	Command.withDescription("Inspect disk pressure, notify on transitions, and guard new heavy work"),
	Command.withExamples([
		{ command: "omp disk status", description: "Print the live disk-pressure projection" },
		{ command: "omp disk check", description: "Dry-run notification and heavy-work admission" },
		{ command: "omp disk notify", description: "Notify once on a pressure transition or recovery" },
		{ command: "omp disk guard --operation build", description: "Refuse a new build under blocking pressure" },
	]),
);
