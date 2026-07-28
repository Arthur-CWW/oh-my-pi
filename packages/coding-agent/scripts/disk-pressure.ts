#!/usr/bin/env bun
import {
	checkDiskAdmission,
	type DiskOperationKind,
	probeDiskPressure,
} from "../src/resource/disk-pressure";

const OPERATIONS: Readonly<Record<string, DiskOperationKind>> = {
	heavy: "heavy",
	build: "heavy",
	download: "heavy",
	proof: "heavy",
	workspace: "heavy",
	"read-only": "readOnly",
	readOnly: "readOnly",
	status: "status",
	cleanup: "cleanup",
	offload: "offload",
	"already-running": "alreadyRunning",
	alreadyRunning: "alreadyRunning",
};

function usage(): never {
	process.stderr.write(
		"Usage: disk-pressure <status|notify|check|guard> [--operation <kind>] [--dry-run]\n" +
			"Kinds: heavy, build, download, proof, workspace, read-only, status, cleanup, offload, already-running\n",
	);
	process.exit(2);
}

function operationFromArgs(args: readonly string[]): DiskOperationKind {
	const index = args.indexOf("--operation");
	const raw = index >= 0 ? args[index + 1] : undefined;
	const operation = raw ? OPERATIONS[raw] : undefined;
	if (!operation) usage();
	return operation;
}

const [, , command, ...args] = Bun.argv;
const dryRun = args.includes("--dry-run");

try {
	if (command === "status") {
		process.stdout.write(`${JSON.stringify(await probeDiskPressure({ dryRun: true }), null, 2)}\n`);
		process.exit(0);
	}
	if (command === "notify") {
		process.stdout.write(`${JSON.stringify(await probeDiskPressure({ notify: true, dryRun }), null, 2)}\n`);
		process.exit(0);
	}
	if (command === "check") {
		const decision = await checkDiskAdmission("heavy", { notify: true, dryRun: true });
		process.stdout.write(`${JSON.stringify(decision, null, 2)}\n`);
		process.exit(0);
	}
	if (command === "guard") {
		const decision = await checkDiskAdmission(operationFromArgs(args), { notify: true, dryRun });
		process.stdout.write(`${JSON.stringify(decision, null, 2)}\n`);
		process.exit(decision.admitted || dryRun ? 0 : 75);
	}
	usage();
} catch (error) {
	process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
	process.exit(75);
}
