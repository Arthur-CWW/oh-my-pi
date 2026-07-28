import { afterEach, expect, test } from "bun:test";
import * as fs from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";

const roots: string[] = [];

afterEach(async () => {
	await Promise.all(roots.splice(0).map(root => fs.rm(root, { recursive: true, force: true })));
});

test("routes escaped session-state collisions without raw rejection output or process exit", async () => {
	const root = await fs.mkdtemp(path.join(os.tmpdir(), "omp-session-rejection-belt-"));
	roots.push(root);
	const fixture = path.join(import.meta.dir, "fixtures", "session-state-command-rejection-belt.ts");
	const processResult = Bun.spawn([process.execPath, fixture], {
		cwd: root,
		env: {
			...process.env,
			HOME: root,
			OMP_SESSION_CONTROL_DB: path.join(root, "session-control.sqlite"),
		},
		stdout: "pipe",
		stderr: "pipe",
	});
	const [stdout, stderr, exitCode] = await Promise.all([
		new Response(processResult.stdout).text(),
		new Response(processResult.stderr).text(),
		processResult.exited,
	]);

	expect(exitCode).toBe(0);
	expect(stderr).not.toContain("[Unhandled Rejection]");
	expect(JSON.parse(stdout)).toEqual([
		expect.objectContaining({
			id: "session-control:restart-command",
			message: "SessionStateCommandInFlightError: A session state command is awaiting durable persistence",
			count: 2,
			category: "session-control",
			source: "process-unhandled-rejection",
			errorClass: "SessionStateCommandInFlightError",
			session: "session-process-proof",
			operation: "unhandledRejection:restart-command",
			code: "session_state_command_in_flight",
		}),
	]);
});
