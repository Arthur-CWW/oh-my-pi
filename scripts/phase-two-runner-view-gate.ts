#!/usr/bin/env bun
import { createHash } from "node:crypto";
import * as fs from "node:fs/promises";
import * as path from "node:path";

interface CheckEvidence {
	name: string;
	command: readonly string[];
	exitCode: number;
	durationMs: number;
	stdout: string;
	stderr: string;
}

const root = path.resolve(import.meta.dir, "..");
const output = path.resolve(root, process.argv[2] ?? "local/phase-two-runner-view-gate.json");
const decoder = new TextDecoder();
const commands: ReadonlyArray<{ name: string; command: readonly string[] }> = [
	{
		name: "runner-view-reload-and-stale-epoch",
		command: ["bun", "test", "packages/coding-agent/test/runner/session-runner-process.test.ts", "packages/coding-agent/test/modes/disposable-terminal-host.test.ts", "packages/coding-agent/test/modes/disposable-interactive-mode.test.ts"],
	},
	{
		name: "real-pty-terminal-restoration",
		command: ["bun", "packages/coding-agent/test/process/disposable-tui-pty-proof.ts"],
	},
	{
		name: "encrypted-collaboration-authority",
		command: ["bun", "test", "packages/coding-agent/test/collab/crypto.test.ts", "packages/coding-agent/test/collab/host-v2.test.ts"],
	},
	{
		name: "durable-queue-restart-and-identity",
		command: ["bun", "test", "packages/coding-agent/test/session/durable-input-queue-process.test.ts", "packages/coding-agent/test/session/durable-input-queue-agent-session-process.test.ts", "packages/coding-agent/test/agent-session-queued-steer-delivery.test.ts"],
	},
	{
		name: "candidate-registry-bless-rollback-handoff",
		command: ["bun", "test", "scripts/link-omp.test.ts"],
	},
];

async function runCheck(name: string, command: readonly string[]): Promise<CheckEvidence> {
	const started = performance.now();
	const child = Bun.spawn([...command], { cwd: root, env: process.env, stdout: "pipe", stderr: "pipe" });
	const [exitCode, stdout, stderr] = await Promise.all([
		child.exited,
		new Response(child.stdout).text(),
		new Response(child.stderr).text(),
	]);
	return { name, command, exitCode, durationMs: Math.round(performance.now() - started), stdout, stderr };
}

const checks: CheckEvidence[] = [];
for (const entry of commands) checks.push(await runCheck(entry.name, entry.command));
const build = await runCheck("actual-candidate-build", ["bun", "--cwd=packages/coding-agent", "run", "build"]);
checks.push(build);
if (build.exitCode === 0) {
	const binary = path.join(root, "packages/coding-agent/dist/omp");
	const candidateDigest = createHash("sha256").update(await fs.readFile(binary)).digest("hex");
	const candidate = path.join(root, "local", `omp-${candidateDigest}`);
	const fixtureRoot = path.join(root, "local", "phase-two-canary-fixture");
	await fs.mkdir(fixtureRoot, { recursive: true });
	await fs.copyFile(binary, candidate);
	await fs.chmod(candidate, 0o755);
	checks.push(await runCheck("actual-candidate-readiness-receipt", [
		"bun",
		"packages/coding-agent/scripts/runner-canary-readiness.ts",
		"--candidate",
		candidate,
		"--fixture-root",
		fixtureRoot,
		"--output",
		path.join(root, "local", "phase-two-canary-receipt.json"),
	]));
}

const [mainSource, interactiveTypesSource] = await Promise.all([
	fs.readFile(path.join(root, "packages/coding-agent/src/main.ts"), "utf8"),
	fs.readFile(path.join(root, "packages/coding-agent/src/modes/types.ts"), "utf8"),
]);
const residuals: Array<{ id: string; severity: "phase-blocker"; detail: string }> = [];
if (/new\s+InteractiveMode\s*\(/.test(mainSource)) {
	residuals.push({
		id: "default-terminal-selection",
		severity: "phase-blocker",
		detail: "The default interactive launch still constructs legacy InteractiveMode; disposable runner/view shell remains opt-in.",
	});
}
if (
	/import\s+type\s+\{\s*AgentSession\s*\}/.test(interactiveTypesSource) ||
	/import\s+type\s+\{\s*SessionManager\s*\}/.test(interactiveTypesSource) ||
	/^\s*(?:readonly\s+)?(?:session|sessionManager|viewSession|agent)\s*:/m.test(interactiveTypesSource)
) {
	residuals.push({
		id: "interactive-view-authority",
		severity: "phase-blocker",
		detail: "InteractiveModeContext still exposes raw AgentSession, SessionManager, viewSession, or agent authority.",
	});
}
const failed = checks.filter(check => check.exitCode !== 0);
const status = failed.length > 0 || residuals.length > 0 ? "fail" : "pass";
const artifact = {
	schemaVersion: 1,
	gate: "phase-two-runner-view",
	observedAt: new Date().toISOString(),
	status,
	checks,
	residuals,
	summary: { passed: checks.length - failed.length, failed: failed.length, residualCount: residuals.length },
};
const serialized = `${JSON.stringify(artifact, null, 2)}\n`;
await fs.mkdir(path.dirname(output), { recursive: true });
await fs.writeFile(output, serialized);
const digest = createHash("sha256").update(serialized).digest("hex");
process.stdout.write(`${JSON.stringify({ status, output: path.relative(root, output), sha256: digest, summary: artifact.summary })}\n`);
if (failed.length > 0 || residuals.length > 0) process.exitCode = 1;
