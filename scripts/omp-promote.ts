#!/usr/bin/env bun
import { createHash, randomUUID } from "node:crypto";
import * as fs from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";

const SHA256 = /^[a-f0-9]{64}$/;
const DEFAULT_STALE_LOCK_MS = 10 * 60 * 1000;

export interface BuildRevision {
	buildDigest: string;
	version: string;
}

export type PromotionDecision =
	| { kind: "noop"; message: "no new commits" }
	| { kind: "continue" }
	| { kind: "refuse"; message: string };

/** Pure policy shared by the command and its boundary tests. */
export function decidePromotion(hasVendorChanges: boolean, readiness: "not-run" | "green" | "red"): PromotionDecision {
	if (!hasVendorChanges) return { kind: "noop", message: "no new commits" };
	if (readiness === "red") return { kind: "refuse", message: "readiness failed; refusing promotion" };
	return { kind: "continue" };
}

export function blessedCommitFromVersion(version: string): string {
	const match = /\+fork\.([0-9a-f]{7,40})$/i.exec(version);
	if (!match) throw new Error(`stable version has no fork commit suffix: ${version}`);
	return match[1];
}

export function parseBuildRevision(value: string): BuildRevision {
	let parsed: unknown;
	try {
		parsed = JSON.parse(value);
	} catch {
		throw new Error("candidate binary returned invalid build revision JSON");
	}
	if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed)) throw new Error("invalid build revision");
	const revision = parsed as Record<string, unknown>;
	if (Object.keys(revision).sort().join(",") !== "buildDigest,version") throw new Error("build revision has unexpected fields");
	if (typeof revision.buildDigest !== "string" || !SHA256.test(revision.buildDigest)) throw new Error("invalid build digest");
	if (typeof revision.version !== "string" || revision.version.length === 0) throw new Error("invalid build version");
	return revision as unknown as BuildRevision;
}

export function parseInstalledVersion(value: string): string {
	const match = /^omp\/(\S+)$/.exec(value);
	if (!match) throw new Error("stable binary returned invalid version");
	return match[1];
}

export function promotionBuildEnvironment(environment: NodeJS.ProcessEnv): NodeJS.ProcessEnv {
	const buildEnvironment = { ...environment };
	delete buildEnvironment.RUSTUP_TOOLCHAIN;
	return buildEnvironment;
}

export interface PromotionCommandResult {
	exitCode: number;
	stdout: string;
	stderr: string;
}

async function command(argv: string[], cwd: string, env: NodeJS.ProcessEnv = process.env): Promise<PromotionCommandResult> {
	const child = Bun.spawn(argv, { cwd, env, stdout: "pipe", stderr: "pipe" });
	const [exitCode, stdout, stderr] = await Promise.all([
		child.exited,
		new Response(child.stdout).text(),
		new Response(child.stderr).text(),
	]);
	return { exitCode, stdout, stderr };
}

async function run(argv: string[], cwd: string, env: NodeJS.ProcessEnv = process.env): Promise<string> {
	const result = await command(argv, cwd, env);
	if (result.exitCode !== 0) {
		const detail = result.stderr.trim() || result.stdout.trim();
		throw new Error(`${argv.join(" ")} failed (exit ${result.exitCode})${detail ? `: ${detail}` : ""}`);
	}
	return result.stdout.trim();
}

export interface PromotionReport {
	readonly blessedLine: string;
	readonly rolloutStdout: string;
	readonly incompleteLine?: string;
}

export function composePromotionReport(
	version: string,
	digest: string,
	rollout: Pick<PromotionCommandResult, "exitCode" | "stdout" | "stderr">,
): PromotionReport {
	const report: PromotionReport = {
		blessedLine: `BLESSED ${version} ${digest}`,
		rolloutStdout: rollout.stdout,
	};
	if (rollout.exitCode === 0) return report;
	const reason = rollout.stderr.trim() || rollout.stdout.trim() || `rollout exited with code ${rollout.exitCode}`;
	return { ...report, incompleteLine: `ROLLOUT incomplete: ${reason}` };
}

async function readCandidateBuildRevision(binary: string, cwd: string): Promise<BuildRevision> {
	return parseBuildRevision(await run([binary, "--runner-build-revision"], cwd));
}

export async function readInstalledBuildRevision(
	binary: string,
	cwd: string,
	invoke: (argv: string[], cwd: string) => Promise<string> = run,
): Promise<BuildRevision> {
	const version = parseInstalledVersion(await invoke([binary, "--version"], cwd));
	const buildDigest = await sha256(binary);
	return { buildDigest, version };
}

async function sha256(file: string): Promise<string> {
	return createHash("sha256").update(await fs.readFile(file)).digest("hex");
}

interface LockOwner {
	token: string;
	pid: number;
	createdAt: string;
}

function isLivePid(pid: number): boolean {
	try {
		process.kill(pid, 0);
		return true;
	} catch (error) {
		return (error as NodeJS.ErrnoException).code === "EPERM";
	}
}

async function readLockOwner(lockPath: string): Promise<LockOwner | undefined> {
	try {
		const value = JSON.parse(await fs.readFile(path.join(lockPath, "owner.json"), "utf8")) as Partial<LockOwner>;
		if (typeof value.token === "string" && Number.isSafeInteger(value.pid) && typeof value.createdAt === "string") return value as LockOwner;
	} catch {}
	return undefined;
}

export interface PromotionLock {
	path: string;
	token: string;
	release(): Promise<void>;
}

/** mkdir is the mutex. Dead owners recover immediately; ownerless/corrupt locks age out. */
export async function acquirePromotionLock(lockPath: string, staleAfterMs = DEFAULT_STALE_LOCK_MS): Promise<PromotionLock> {
	await fs.mkdir(path.dirname(lockPath), { recursive: true });
	const token = randomUUID();
	for (;;) {
		try {
			await fs.mkdir(lockPath);
			const owner: LockOwner = { token, pid: process.pid, createdAt: new Date().toISOString() };
			try {
				await fs.writeFile(path.join(lockPath, "owner.json"), `${JSON.stringify(owner)}\n`, { flag: "wx", mode: 0o600 });
			} catch (error) {
				await fs.rm(lockPath, { recursive: true, force: true });
				throw error;
			}
			return {
				path: lockPath,
				token,
				async release() {
					const current = await readLockOwner(lockPath);
					if (current?.token !== token) throw new Error("promotion lock ownership changed before release");
					await fs.rm(lockPath, { recursive: true });
				},
			};
		} catch (error) {
			if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
		}

		const recoveryClaim = path.join(lockPath, ".recovery");
		try {
			await fs.mkdir(recoveryClaim);
		} catch (error) {
			const code = (error as NodeJS.ErrnoException).code;
			if (code === "ENOENT") continue;
			if (code === "EEXIST") throw new Error(`another promoter is recovering ${lockPath}`);
			throw error;
		}

		const quarantined = `${lockPath}.stale-${token}`;
		let claimed = true;
		try {
			const owner = await readLockOwner(lockPath);
			const lockStat = await fs.stat(lockPath);
			const stale = owner ? !isLivePid(owner.pid) : Date.now() - lockStat.birthtimeMs >= staleAfterMs;
			if (!stale) throw new Error(`another OMP promotion holds ${lockPath}${owner ? ` (pid ${owner.pid})` : ""}`);
			await fs.rename(lockPath, quarantined);
			claimed = false;
		} finally {
			if (claimed) await fs.rm(recoveryClaim, { recursive: true, force: true });
		}
		await fs.rm(quarantined, { recursive: true, force: true });
	}
}

interface Config {
	repoRoot: string;
	binDir: string;
	fixtureRoot: string;
}

function configFromEnvironment(): Config {
	const repoRoot = path.resolve(process.env.OMP_PROMOTE_REPO_ROOT ?? path.join(import.meta.dir, ".."));
	const defaultBin = process.env.BUN_INSTALL ? path.join(process.env.BUN_INSTALL, "bin") : path.join(os.homedir(), ".bun", "bin");
	return {
		repoRoot,
		binDir: path.resolve(process.env.OMP_PROMOTE_BIN_DIR ?? defaultBin),
		fixtureRoot: path.resolve(process.env.OMP_PROMOTE_FIXTURE_ROOT ?? path.join(repoRoot, "local", "canary-slice-a", "fixture")),
	};
}

async function vendorChanged(repoRoot: string, blessedCommit: string, head: string): Promise<boolean> {
	await run(["git", "cat-file", "-e", `${blessedCommit}^{commit}`], repoRoot);
	const result = await command(["git", "diff", "--quiet", blessedCommit, head, "--", "vendor/oh-my-pi"], repoRoot);
	if (result.exitCode === 0) return false;
	if (result.exitCode === 1) return true;
	throw new Error(`git diff failed (exit ${result.exitCode})${result.stderr.trim() ? `: ${result.stderr.trim()}` : ""}`);
}

async function writePromotionNote(temporary: string, digest: string, version: string, receipt: string, receiptDigest: string, previousDigest: string): Promise<void> {
	const lines = [
		`candidate ${digest} ${version}`,
		`receipt ${receipt} ${receiptDigest}`,
		`previous ${previousDigest} rollback-retained`,
	];
	await fs.writeFile(temporary, `${lines.join("\n")}\n`, { flag: "wx", mode: 0o600 });
}

class RolloutIncompleteError extends Error {
	constructor(readonly reportLine: string) {
		super(reportLine);
		this.name = "RolloutIncompleteError";
	}
}

export async function promote(config: Config = configFromEnvironment()): Promise<void> {
	const stable = path.join(config.binDir, "omp");
	const linkEnvironment = {
		...process.env,
		OMP_LINK_GLOBAL_BIN: config.binDir,
		OMP_LINK_READINESS_FIXTURE_ROOT: config.fixtureRoot,
	};
	const lock = await acquirePromotionLock(path.join(config.binDir, ".omp-promote.lock"));
	let worktree: string | undefined;
	let worktreeAdded = false;
	let noteTemporary: string | undefined;
	try {
		const head = await run(["git", "rev-parse", "HEAD"], config.repoRoot);
		const stableRevision = await readInstalledBuildRevision(stable, config.repoRoot);
		const blessedCommit = blessedCommitFromVersion(stableRevision.version);
		const initialDecision = decidePromotion(await vendorChanged(config.repoRoot, blessedCommit, head), "not-run");
		if (initialDecision.kind === "noop") {
			console.log(initialDecision.message);
			return;
		}

		worktree = await fs.mkdtemp(path.join(os.tmpdir(), "omp-promote-"));
		await run(["git", "worktree", "add", "--detach", worktree, head], config.repoRoot);
		worktreeAdded = true;
		const fork = path.join(worktree, "vendor", "oh-my-pi");
		const linkScript = path.join(fork, "scripts", "link-omp.sh");
		await run(["bun", "install", "--frozen-lockfile"], fork);
		if ((await fs.lstat(path.join(fork, "node_modules"))).isSymbolicLink()) {
			throw new Error("isolated install produced a symlinked node_modules");
		}
		await run(["bun", "run", "build:native"], fork, promotionBuildEnvironment(process.env));
		await run(["bun", "--cwd=packages/coding-agent", "run", "generate"], fork);
		await run(["bun", "--cwd=packages/coding-agent", "run", "check:types"], fork);
		await run(["bun", "test", "scripts/link-omp.test.ts"], fork);
		await run(["bun", "--cwd=packages/coding-agent", "run", "build"], fork);

		const builtBinary = path.join(fork, "packages", "coding-agent", "dist", "omp");
		const digest = await sha256(builtBinary);
		await run(["bash", linkScript, "candidate", builtBinary], fork, { ...linkEnvironment, OMP_LINK_REPO_ROOT: fork });
		const candidate = path.join(config.binDir, ".omp-releases", `omp-${digest}`);
		const revision = await readCandidateBuildRevision(candidate, fork);
		if (revision.buildDigest !== digest) throw new Error("materialized candidate identity does not match its digest");

		const receiptDir = path.join(config.repoRoot, "vendor", "oh-my-pi", "local");
		await fs.mkdir(receiptDir, { recursive: true });
		const receiptPath = path.join(receiptDir, `readiness-receipt-${digest}.json`);
		const readiness = await command([
			"bun",
			path.join(fork, "packages", "coding-agent", "scripts", "runner-canary-readiness.ts"),
			"--candidate", candidate,
			"--fixture-root", config.fixtureRoot,
			"--output", receiptPath,
		], fork, linkEnvironment);
		const readinessDecision = decidePromotion(true, readiness.exitCode === 0 ? "green" : "red");
		if (readinessDecision.kind === "refuse") {
			const detail = readiness.stderr.trim() || readiness.stdout.trim();
			throw new Error(`${readinessDecision.message}${detail ? `: ${detail}` : ""}`);
		}
		const receiptDigest = await sha256(receiptPath);
		const receiptDisplay = path.relative(config.repoRoot, receiptPath);
		const notePath = path.join(receiptDir, `promotion-note-${digest}.txt`);
		noteTemporary = `${notePath}.tmp-${process.pid}-${randomUUID()}`;
		await writePromotionNote(noteTemporary, digest, revision.version, receiptDisplay, receiptDigest, stableRevision.buildDigest);

		await run(["bash", linkScript, "bless", digest, receiptPath], fork, { ...linkEnvironment, OMP_LINK_REPO_ROOT: fork });
		await fs.rename(noteTemporary, notePath);
		noteTemporary = undefined;
		const blessedReport = composePromotionReport(revision.version, digest, { exitCode: 0, stdout: "", stderr: "" });
		console.log(blessedReport.blessedLine);
		console.log(`digest ${digest}`);
		console.log(`version ${revision.version}`);
		console.log(`receipt ${receiptDisplay} ${receiptDigest}`);
		let rollout: PromotionCommandResult;
		try {
			rollout = await command([stable, "rollout", "--auto"], config.repoRoot);
		} catch (error) {
			const reason = error instanceof Error ? error.message : String(error);
			throw new RolloutIncompleteError(`ROLLOUT incomplete: ${reason}`);
		}
		const rolloutReport = composePromotionReport(revision.version, digest, rollout);
		if (rolloutReport.rolloutStdout) process.stdout.write(rolloutReport.rolloutStdout);
		if (rolloutReport.incompleteLine) throw new RolloutIncompleteError(rolloutReport.incompleteLine);
	} finally {
		if (noteTemporary) await fs.rm(noteTemporary, { force: true });
		if (worktreeAdded && worktree) {
			const cleanup = await command(["git", "worktree", "remove", "--force", worktree], config.repoRoot);
			if (cleanup.exitCode !== 0) {
				await fs.rm(worktree, { recursive: true, force: true });
				await command(["git", "worktree", "prune"], config.repoRoot);
			}
		} else if (worktree) {
			await fs.rm(worktree, { recursive: true, force: true });
		}
		await lock.release();
	}
}

if (import.meta.main) {
	promote().catch(error => {
		console.error(error instanceof RolloutIncompleteError ? error.reportLine : `ERROR task failed: ${error instanceof Error ? error.message : String(error)}`);
		process.exitCode = 1;
	});
}
