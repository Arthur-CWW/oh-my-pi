#!/usr/bin/env bun
/**
 * Mechanical night reaper (HR-167). Runs as a command automation every 5 minutes.
 * Log-mostly by design: the ONLY kills are (a) headless/orphaned browser groups via the
 * existing browser-reaper policy, (b) sudo prompts pending >2 minutes (a stuck sudo blocks
 * the Touch ID queue overnight; killing it merely fails that command). Everything else is
 * evidence for the Sol night-warden automation and the morning review.
 *
 * Outputs (bounded):
 *   local/night/reaper.log          — cycle snapshots + ALERT lines
 *   local/night/sudo-evidence.log   — who invoked sudo (unified log + live catches)
 */
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import * as path from "node:path";

const ROOT = "/Users/arthur/agents";
const NIGHT_DIR = path.join(ROOT, "local", "night");
const REAPER_LOG = path.join(NIGHT_DIR, "reaper.log");
const SUDO_LOG = path.join(NIGHT_DIR, "sudo-evidence.log");
const LOG_MAX_LINES = 6000;
const SUDO_PENDING_KILL_SECONDS = 120;
const DISK_ALERT_GB = 15;
const OMP_RSS_ALERT_MB = 20_000;

function sh(cmd: string[], timeoutMs = 60_000): { code: number; out: string } {
	const proc = Bun.spawnSync(cmd, { stdout: "pipe", stderr: "pipe", timeout: timeoutMs });
	const out = `${proc.stdout?.toString() ?? ""}${proc.stderr?.toString() ?? ""}`.trim();
	return { code: proc.exitCode ?? -1, out };
}

function appendBounded(file: string, text: string): void {
	let existing = "";
	try {
		existing = readFileSync(file, "utf8");
	} catch {}
	const merged = `${existing}${text}`;
	const lines = merged.split("\n");
	const bounded = lines.length > LOG_MAX_LINES ? lines.slice(lines.length - LOG_MAX_LINES) : lines;
	writeFileSync(file, bounded.join("\n"));
}

interface PsRow {
	pid: number;
	ppid: number;
	etimes: number;
	rssKb: number;
	command: string;
}

function psSnapshot(): PsRow[] {
	// macOS ps has no etimes; parse etime ([[dd-]hh:]mm:ss) into seconds.
	const { out } = sh(["ps", "-axo", "pid=,ppid=,etime=,rss=,command="]);
	const rows: PsRow[] = [];
	for (const line of out.split("\n")) {
		const m = /^\s*(\d+)\s+(\d+)\s+(\S+)\s+(\d+)\s+(.+)$/.exec(line);
		if (!m) continue;
		const t = /^(?:(\d+)-)?(?:(\d+):)?(\d+):(\d+)$/.exec(m[3]!.trim());
		const etimes = t ? Number(t[1] ?? 0) * 86_400 + Number(t[2] ?? 0) * 3_600 + Number(t[3]) * 60 + Number(t[4]) : 0;
		rows.push({ pid: Number(m[1]), ppid: Number(m[2]), etimes, rssKb: Number(m[4]), command: m[5]! });
	}
	return rows;
}

function parentChain(rows: PsRow[], pid: number): string {
	const byPid = new Map(rows.map(r => [r.pid, r]));
	const chain: string[] = [];
	let cursor = byPid.get(pid);
	const seen = new Set<number>();
	while (cursor && !seen.has(cursor.pid) && chain.length < 6) {
		seen.add(cursor.pid);
		chain.push(`${cursor.pid}:${cursor.command.slice(0, 120)}`);
		cursor = byPid.get(cursor.ppid);
	}
	return chain.join("  <-  ");
}

function main(): void {
	mkdirSync(NIGHT_DIR, { recursive: true });
	const now = new Date().toISOString();
	const lines: string[] = [`\n===== cycle ${now} =====`];
	const rows = psSnapshot();

	// 1. Pending sudo prompts: evidence + unblock.
	const sudoRows = rows.filter(r => /^sudo(\s|$)|\/sudo\s/.test(r.command) && !r.command.includes("night-reaper"));
	for (const row of sudoRows) {
		const chain = parentChain(rows, row.pid);
		appendBounded(SUDO_LOG, `\n${now} LIVE pid=${row.pid} age=${row.etimes}s cmd=${row.command}\n  chain: ${chain}`);
		if (row.etimes > SUDO_PENDING_KILL_SECONDS) {
			const killed = sh(["kill", String(row.pid)]);
			lines.push(`ALERT sudo-pending-killed pid=${row.pid} age=${row.etimes}s code=${killed.code} cmd=${row.command.slice(0, 160)}`);
			appendBounded(SUDO_LOG, `  -> killed after ${row.etimes}s (blocked Touch ID queue)`);
		} else {
			lines.push(`sudo-pending pid=${row.pid} age=${row.etimes}s (grace)`);
		}
	}
	// Unified-log evidence for prompts that already resolved (6m window covers the 5m cadence).
	const logShow = sh(
		["log", "show", "--last", "6m", "--style", "compact", "--predicate", 'process == "sudo"'],
		45_000,
	);
	const authLines = logShow.out
		.split("\n")
		.filter(l => /sudo/i.test(l) && !/Filtering the log data|Timestamp/.test(l))
		.slice(0, 40);
	if (authLines.length > 0) appendBounded(SUDO_LOG, `\n${now} UNIFIED-LOG\n${authLines.join("\n")}`);

	// 2. Browser reaper (existing safe policy).
	const browsers = sh(["bun", path.join(ROOT, "scripts", "browser-reaper.ts"), "--apply", "--ttl-minutes", "90"], 120_000);
	lines.push(`browser-reaper: ${browsers.out.split("\n")[0] ?? "no output"}`);
	for (const l of browsers.out.split("\n")) if (/KILL/.test(l)) lines.push(`  ${l}`);

	// 3. Stale worktrees: leaked gate worktrees (repo .git/*) and dead isolated-spawn
	// clones (~/.omp/wt) older than 12h with no live process inside. 50GB class (2026-07-16).
	for (const repo of [ROOT, path.join(ROOT, "vendor", "oh-my-pi")]) {
		const prune = sh(["git", "-C", repo, "worktree", "prune", "--expire", "2.hours.ago"]);
		if (prune.out) lines.push(`worktree-prune ${repo}: ${prune.out}`);
	}
	const wtRoot = path.join(process.env.HOME ?? "/Users/arthur", ".omp", "wt");
	const wtList = sh(["find", wtRoot, "-maxdepth", "1", "-mindepth", "1", "-mmin", `+${12 * 60}`]);
	for (const stale of wtList.out.split("\n").filter(Boolean)) {
		if (sh(["lsof", "+D", stale], 30_000).out.length > 0) {
			lines.push(`worktree-stale-but-live: ${stale}`);
			continue;
		}
		const viaGit = sh(["git", "-C", ROOT, "worktree", "remove", "--force", stale]);
		if (viaGit.code !== 0) sh(["rm", "-rf", stale], 300_000);
		lines.push(`ALERT worktree-reclaimed: ${stale} (${viaGit.code === 0 ? "git" : "rm"})`);
	}

	// 4. Evidence-only inventories.
	const ompRows = rows.filter(r => /(?:^|\/)omp(?:\s|$)/.test(r.command) || /omp-release/.test(r.command));
	const ompRssMb = Math.round(ompRows.reduce((sum, r) => sum + r.rssKb, 0) / 1024);
	lines.push(`omp-processes: ${ompRows.length} totalRss=${ompRssMb}M`);
	if (ompRssMb > OMP_RSS_ALERT_MB) lines.push(`ALERT omp-rss ${ompRssMb}M > ${OMP_RSS_ALERT_MB}M`);
	const topRss = [...rows].sort((a, b) => b.rssKb - a.rssKb).slice(0, 8);
	lines.push("top-rss:");
	for (const r of topRss) lines.push(`  ${Math.round(r.rssKb / 1024)}M pid=${r.pid} ${r.command.slice(0, 110)}`);

	const disk = sh(["df", "-g", "/"]);
	const diskLine = disk.out.split("\n").at(-1) ?? "";
	const availGb = Number(diskLine.split(/\s+/)[3]) || 0;
	lines.push(`disk-avail: ${availGb}G`);
	if (availGb > 0 && availGb < DISK_ALERT_GB) lines.push(`ALERT disk-low ${availGb}G < ${DISK_ALERT_GB}G`);

	appendBounded(REAPER_LOG, lines.join("\n"));
	console.log(lines.join("\n"));
}

main();
