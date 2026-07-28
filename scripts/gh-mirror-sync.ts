#!/usr/bin/env bun

import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { isAbsolute, join, resolve } from "node:path";

const MAX_BLOB_BYTES = 90 * 1024 * 1024;
const SYNCED_NB_REF = "refs/gh-mirror/nb-main";
const DEFAULT_REPO = "/srv/data/agents/workspaces/gh-filter";

type Options = {
	branch: string;
	dryRun: boolean;
	repo: string;
};

type BlobFact = {
	oid: string;
	path: string;
	size: number;
};

function usage(message?: string): never {
	if (message) console.error(message);
	console.error("Usage: bun scripts/gh-mirror-sync.ts [--dry-run] [--branch <name>] [--repo <filtered-clone>]");
	process.exit(2);
}

function parseOptions(argv: string[]): Options {
	let branch = "main";
	let dryRun = false;
	let repo = process.env.GH_MIRROR_DIR ?? DEFAULT_REPO;

	for (let index = 0; index < argv.length; index += 1) {
		const arg = argv[index];
		if (arg === "--dry-run") {
			dryRun = true;
			continue;
		}
		if (arg === "--branch" || arg === "--repo") {
			const value = argv[index + 1];
			if (!value) usage(`${arg} requires a value`);
			if (arg === "--branch") branch = value;
			else repo = value;
			index += 1;
			continue;
		}
		usage(`Unknown argument: ${arg}`);
	}

	return { branch, dryRun, repo: resolve(repo) };
}

const options = parseOptions(Bun.argv.slice(2));
const nbRemote = process.env.GH_MIRROR_NB_REMOTE ?? "nb";
const githubRemote = process.env.GH_MIRROR_GITHUB_REMOTE ?? "github";
const decoder = new TextDecoder();

function runGit(args: string[], allowFailure = false): string {
	const result = Bun.spawnSync(["git", ...args], {
		cwd: options.repo,
		stdout: "pipe",
		stderr: "pipe",
	});
	const stdout = decoder.decode(result.stdout).trim();
	const stderr = decoder.decode(result.stderr).trim();
	if (result.exitCode !== 0 && !allowFailure) {
		const detail = stderr || stdout || "no diagnostic";
		throw new Error(`git ${args.join(" ")} failed (${result.exitCode}): ${detail}`);
	}
	return result.exitCode === 0 ? stdout : "";
}

function gitSucceeds(args: string[]): boolean {
	const result = Bun.spawnSync(["git", ...args], {
		cwd: options.repo,
		stdout: "ignore",
		stderr: "ignore",
	});
	return result.exitCode === 0;
}

function requireRepository(): void {
	if (!existsSync(options.repo)) throw new Error(`Filtered clone does not exist: ${options.repo}`);
	if (runGit(["rev-parse", "--is-inside-git-dir"]) !== "true") {
		throw new Error(`Expected a bare or mirror clone: ${options.repo}`);
	}
	if (!runGit(["remote", "get-url", nbRemote], true)) throw new Error(`Missing remote '${nbRemote}' in ${options.repo}`);
	if (!runGit(["remote", "get-url", githubRemote], true)) throw new Error(`Missing remote '${githubRemote}' in ${options.repo}`);
	if (!runGit(["check-ref-format", "--branch", options.branch], true)) throw new Error(`Invalid branch name: ${options.branch}`);
}

function refValue(ref: string): string | null {
	return runGit(["rev-parse", "--verify", ref], true) || null;
}

function fetchRefs(): void {
	runGit(["fetch", "--no-tags", nbRemote, `+refs/heads/main:refs/remotes/${nbRemote}/main`]);
	if (options.branch !== "main") {
		runGit(["fetch", "--no-tags", nbRemote, `+refs/heads/${options.branch}:refs/remotes/${nbRemote}/${options.branch}`]);
	}
	runGit(["fetch", "--no-tags", githubRemote, `+refs/heads/main:refs/remotes/${githubRemote}/main`]);
}

function mappedNbCommit(githubMain: string): string | null {
	const gitDirText = runGit(["rev-parse", "--absolute-git-dir"]);
	const gitDir = isAbsolute(gitDirText) ? gitDirText : resolve(options.repo, gitDirText);
	const commitMap = join(gitDir, "filter-repo", "commit-map");
	if (!existsSync(commitMap)) return null;
	for (const line of readFileSync(commitMap, "utf8").split("\n").slice(1)) {
		const [oldCommit, newCommit] = line.trim().split(/\s+/);
		if (oldCommit && newCommit === githubMain) return oldCommit;
	}
	return null;
}

function requireAncestor(ancestor: string, descendant: string, label: string): void {
	if (!gitSucceeds(["merge-base", "--is-ancestor", ancestor, descendant])) {
		throw new Error(`${label}: ${ancestor} is not an ancestor of ${descendant}`);
	}
}

async function largestBlobInRange(range: string): Promise<BlobFact | null> {
	const objects = runGit(["rev-list", "--objects", range]);
	if (!objects) return null;
	const process = Bun.spawn(
		["git", "cat-file", "--batch-check=%(objecttype) %(objectsize) %(objectname) %(rest)"],
		{ cwd: options.repo, stdin: "pipe", stdout: "pipe", stderr: "pipe" },
	);
	process.stdin.write(`${objects}\n`);
	process.stdin.end();
	const [stdout, stderr, exitCode] = await Promise.all([
		new Response(process.stdout).text(),
		new Response(process.stderr).text(),
		process.exited,
	]);
	if (exitCode !== 0) throw new Error(`git cat-file failed (${exitCode}): ${stderr.trim()}`);

	let largest: BlobFact | null = null;
	for (const line of stdout.split("\n")) {
		const match = /^(\S+) (\d+) ([0-9a-f]+)(?: (.*))?$/.exec(line);
		if (!match || match[1] !== "blob") continue;
		const size = Number.parseInt(match[2], 10);
		if (!largest || size > largest.size) {
			largest = { oid: match[3], path: match[4] ?? "(path unavailable)", size };
		}
	}
	return largest;
}

function commitsInRange(range: string): string[] {
	const output = runGit(["rev-list", "--reverse", "--topo-order", range]);
	return output ? output.split("\n") : [];
}

function requireLinearCommits(commits: string[]): void {
	for (const commit of commits) {
		const fields = runGit(["rev-list", "--parents", "-n", "1", commit]).split(/\s+/);
		if (fields.length !== 2) {
			throw new Error(`Cannot replay merge commit ${commit}; land a linear changeset on nb first`);
		}
	}
}

function remoteBranchTip(branch: string): string | null {
	const output = runGit(["ls-remote", "--heads", githubRemote, `refs/heads/${branch}`]);
	return output ? output.split(/\s+/)[0] : null;
}

function replayAndPush(base: string, commits: string[], destination: string): string {
	const worktree = mkdtempSync(join(tmpdir(), "gh-mirror-sync-"));
	try {
		runGit(["worktree", "add", "--detach", worktree, base]);
		for (const commit of commits) runGit(["-C", worktree, "cherry-pick", commit]);
		const result = runGit(["-C", worktree, "rev-parse", "HEAD"]);
		const expected = remoteBranchTip(destination);
		const lease = expected
			? `--force-with-lease=refs/heads/${destination}:${expected}`
			: `--force-with-lease=refs/heads/${destination}:`;
		runGit(["-C", worktree, "push", lease, githubRemote, `HEAD:refs/heads/${destination}`]);
		return result;
	} finally {
		runGit(["worktree", "remove", "--force", worktree], true);
		rmSync(worktree, { force: true, recursive: true });
	}
}

async function syncMain(nbMain: string, githubMain: string): Promise<void> {
	const stored = refValue(SYNCED_NB_REF);
	const syncedNb = stored ?? mappedNbCommit(githubMain);
	if (!syncedNb) {
		throw new Error(`Missing ${SYNCED_NB_REF}; seed it with the nb SHA mapped to ${githubMain}`);
	}
	requireAncestor(syncedNb, nbMain, "nb main moved non-fast-forward");
	const range = `${syncedNb}..${nbMain}`;
	const commits = commitsInRange(range);
	const largest = await largestBlobInRange(range);
	console.log(`Last synced nb/main: ${syncedNb}`);
	console.log(`New commits: ${commits.length}`);
	console.log(largest ? `Largest new blob: ${largest.size} bytes ${largest.oid} ${largest.path}` : "Largest new blob: none");
	if (largest && largest.size > MAX_BLOB_BYTES) {
		throw new Error(`Refusing to sync blob over 90 MiB: ${largest.size} bytes ${largest.oid} ${largest.path}`);
	}
	if (commits.length === 0) {
		console.log("Already synchronized; nothing to push.");
		if (!options.dryRun && !stored) runGit(["update-ref", SYNCED_NB_REF, syncedNb]);
		return;
	}

	const nbTree = runGit(["rev-parse", `${nbMain}^{tree}`]);
	const githubTree = runGit(["rev-parse", `${githubMain}^{tree}`]);
	if (nbTree === githubTree) {
		console.log("GitHub and nb main already have identical trees; advancing the local sync marker only.");
		if (!options.dryRun) {
			const args = stored
				? ["update-ref", SYNCED_NB_REF, nbMain, syncedNb]
				: ["update-ref", SYNCED_NB_REF, nbMain];
			runGit(args);
		}
		return;
	}
	requireLinearCommits(commits);
	if (options.dryRun) {
		console.log(`Dry run: would replay ${commits.length} commit(s) onto ${githubMain} and push github/main.`);
		return;
	}
	const pushed = replayAndPush(githubMain, commits, "main");
	runGit(["update-ref", "refs/heads/main", pushed]);
	const markerArgs = stored
		? ["update-ref", SYNCED_NB_REF, nbMain, syncedNb]
		: ["update-ref", SYNCED_NB_REF, nbMain];
	runGit(markerArgs);
	console.log(`Pushed github/main: ${pushed}`);
}

async function pushChangeset(nbMain: string, githubMain: string): Promise<void> {
	const nbBranch = refValue(`refs/remotes/${nbRemote}/${options.branch}`);
	if (!nbBranch) throw new Error(`Fetched branch is missing: ${nbRemote}/${options.branch}`);
	requireAncestor(nbMain, nbBranch, `${options.branch} is not based on current nb/main`);
	const nbTree = runGit(["rev-parse", `${nbMain}^{tree}`]);
	const githubTree = runGit(["rev-parse", `${githubMain}^{tree}`]);
	if (nbTree !== githubTree) throw new Error("nb/main and github/main trees differ; sync main before pushing a changeset");
	const range = `${nbMain}..${nbBranch}`;
	const commits = commitsInRange(range);
	const largest = await largestBlobInRange(range);
	console.log(`Changeset base nb/main: ${nbMain}`);
	console.log(`Changeset commits: ${commits.length}`);
	console.log(largest ? `Largest changeset blob: ${largest.size} bytes ${largest.oid} ${largest.path}` : "Largest changeset blob: none");
	if (largest && largest.size > MAX_BLOB_BYTES) {
		throw new Error(`Refusing to push blob over 90 MiB: ${largest.size} bytes ${largest.oid} ${largest.path}`);
	}
	if (commits.length === 0) throw new Error(`Branch ${options.branch} has no commits beyond nb/main`);
	requireLinearCommits(commits);
	if (options.dryRun) {
		console.log(`Dry run: would replay ${commits.length} commit(s) onto ${githubMain} and push github/${options.branch}.`);
		return;
	}
	const pushed = replayAndPush(githubMain, commits, options.branch);
	console.log(`Pushed github/${options.branch}: ${pushed}`);
}

try {
	requireRepository();
	fetchRefs();
	const nbMain = refValue(`refs/remotes/${nbRemote}/main`);
	const githubMain = refValue(`refs/remotes/${githubRemote}/main`);
	if (!nbMain || !githubMain) throw new Error("Fetch did not produce both nb/main and github/main");
	console.log(`Filtered clone: ${options.repo}`);
	console.log(`Target branch: ${options.branch}`);
	console.log(`Fetched nb/main: ${nbMain}`);
	console.log(`Fetched github/main: ${githubMain}`);
	if (options.branch === "main") await syncMain(nbMain, githubMain);
	else await pushChangeset(nbMain, githubMain);
	if (options.dryRun) console.log("Dry run complete: no branch, marker, or remote ref was changed.");
} catch (error) {
	const message = error instanceof Error ? error.message : String(error);
	console.error(`gh-mirror-sync: ${message}`);
	process.exit(1);
}
