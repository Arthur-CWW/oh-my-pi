#!/usr/bin/env bun
/**
 * Test fixture: opens one host resource authority, reports the outcome as one JSON line, exits.
 *
 * `host-resource-admission-schema-race.test.ts` spawns N of these to put N real OS processes
 * through `HostResourceAdmission`'s first-open path against a single SQLite authority. The
 * handshake is a kernel barrier, not a delay: the child announces `ready` on stdout and then
 * parks in `read(2)` on stdin until the parent releases every child back to back, so all of
 * them reach the check-and-create inside the same scheduler tick.
 *
 * Writes go through `fs.writeSync` so the parent observes them without waiting on a userspace
 * flush, and the module under test is imported by relative path because this runs as a bare
 * `bun <file>` process, outside the test runner's resolver.
 */
import * as fs from "node:fs";
import { HostResourceAdmission } from "../../../src/resource/host-resource-admission";

const GIB = 1_073_741_824;
const dbPath = process.env.RACE_DB_PATH;
if (!dbPath) throw new Error("RACE_DB_PATH is required");

function awaitRelease(): void {
	const byte = new Uint8Array(1);
	for (;;) {
		try {
			// Returns on the release byte or on EOF when the parent closes the pipe.
			fs.readSync(0, byte, 0, 1, null);
			return;
		} catch (error) {
			// A non-blocking inherited stdin yields EAGAIN instead of parking; spin only then.
			if ((error as NodeJS.ErrnoException).code !== "EAGAIN") throw error;
		}
	}
}

fs.writeSync(1, "ready\n");
awaitRelease();

try {
	const admission = new HostResourceAdmission({
		dbPath,
		memoryBudgetBytes: 5 * GIB,
		childReservationBytes: 512 * 1_048_576,
		queuePollMs: 5,
		sampleIntervalMs: 60_000,
		hostResourceProbe: { systemMemoryBytes: 512 * GIB, systemCpuCount: 128, warnings: [] },
		coordinatorRoots: () => [],
	});
	const snapshot = admission.inspect();
	admission.close();
	fs.writeSync(1, `${JSON.stringify({ ok: true, effectiveLimit: snapshot.effectiveLimit })}\n`);
	process.exit(0);
} catch (error) {
	fs.writeSync(
		1,
		`${JSON.stringify({
			ok: false,
			name: error instanceof Error ? error.name : "unknown",
			reason: (error as { reason?: string }).reason ?? null,
			message: error instanceof Error ? error.message : String(error),
		})}\n`,
	);
	process.exit(3);
}
