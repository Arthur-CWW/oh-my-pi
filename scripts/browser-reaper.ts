#!/usr/bin/env bun

export interface ProcessRow {
	pid: number;
	ppid: number;
	ageSeconds: number;
	rssKb: number;
	command: string;
}

export interface ProcessGroup {
	root: ProcessRow;
	members: ProcessRow[];
	rssKb: number;
	automation: boolean;
	liveOmpAncestor: boolean;
	orphaned: boolean;
	protectedReason?: string;
}

export interface ReapDecision {
	reap: boolean;
	reason: string;
}

const BROWSER_PROCESS_RE = /(?:Google Chrome|google-chrome(?:-stable)?|Chromium|chromium-browser|chrome-headless-shell|headless_shell|playwright|puppeteer|\/cmux(?:\.app)?\/|cmux Helper)/i;
const OMP_PROCESS_RE = /(?:^|\s|\/)(?:omp|omp-dev)(?:\s|$)/i;
const AUTOMATION_RE = /(?:--headless(?:=\S+)?|headless_shell|chrome-headless-shell|playwright[_/-]|puppeteer[_/-]|\.omp\/browser-sessions\/)/i;
const OMP_OWNED_PROFILE_RE = /\.omp\/browser-sessions\//i;
const GUARDED_PROFILE_RE = /(?:remote-chrome|guarded[-_/ ]chrome|chrome-automation-profile|\/chrome-agent(?:\/|$))/i;
const DEFAULT_TTL_SECONDS = 60 * 60;

export function parseElapsed(raw: string): number {
	const match = /^(?:(\d+)-)?(?:(\d+):)?(\d+):(\d+)$/.exec(raw.trim());
	if (!match) return 0;
	const [, days = "0", hours = "0", minutes = "0", seconds = "0"] = match;
	return Number(days) * 86_400 + Number(hours) * 3_600 + Number(minutes) * 60 + Number(seconds);
}

export function parsePs(output: string): ProcessRow[] {
	const rows: ProcessRow[] = [];
	for (const line of output.split("\n")) {
		const match = /^\s*(\d+)\s+(\d+)\s+(\S+)\s+(\d+)\s+(.+)$/.exec(line);
		if (!match) continue;
		rows.push({
			pid: Number(match[1]),
			ppid: Number(match[2]),
			ageSeconds: parseElapsed(match[3]!),
			rssKb: Number(match[4]),
			command: match[5]!,
		});
	}
	return rows;
}

function isBrowserish(row: ProcessRow): boolean {
	return BROWSER_PROCESS_RE.test(row.command);
}

function ancestorHasOmp(row: ProcessRow, allByPid: Map<number, ProcessRow>): boolean {
	const seen = new Set<number>();
	let cursor: ProcessRow | undefined = row;
	while (cursor && !seen.has(cursor.pid)) {
		seen.add(cursor.pid);
		if (OMP_PROCESS_RE.test(cursor.command)) return true;
		cursor = allByPid.get(cursor.ppid);
	}
	return false;
}

export function groupBrowserProcesses(rows: ProcessRow[]): ProcessGroup[] {
	const allByPid = new Map(rows.map(row => [row.pid, row]));
	const relevant = new Map(rows.filter(isBrowserish).map(row => [row.pid, row]));
	const roots = new Map<number, ProcessRow>();
	for (const row of relevant.values()) {
		let root = row;
		const seen = new Set([root.pid]);
		while (relevant.has(root.ppid) && !seen.has(root.ppid)) {
			root = relevant.get(root.ppid)!;
			seen.add(root.pid);
		}
		roots.set(root.pid, root);
	}

	const groups: ProcessGroup[] = [];
	for (const root of roots.values()) {
		const members = [...relevant.values()].filter(row => {
			let cursor: ProcessRow | undefined = row;
			const seen = new Set<number>();
			while (cursor && !seen.has(cursor.pid)) {
				if (cursor.pid === root.pid) return true;
				seen.add(cursor.pid);
				cursor = relevant.get(cursor.ppid);
			}
			return false;
		});
		const joined = members.map(member => member.command).join("\n");
		let protectedReason: string | undefined;
		if (GUARDED_PROFILE_RE.test(joined)) protectedReason = "guarded Chrome profile";
		else if (/(?:Google Chrome|google-chrome)/i.test(joined) && !AUTOMATION_RE.test(joined)) protectedReason = "interactive/default Chrome";
		const rootParent = allByPid.get(root.ppid);
		groups.push({
			root,
			members,
			rssKb: members.reduce((sum, member) => sum + member.rssKb, 0),
			automation: AUTOMATION_RE.test(joined),
			liveOmpAncestor: ancestorHasOmp(root, allByPid),
			orphaned: root.ppid <= 1 || rootParent === undefined,
			protectedReason,
		});
	}
	return groups.sort((a, b) => b.rssKb - a.rssKb);
}

export function classifyGroup(group: ProcessGroup, ttlSeconds = DEFAULT_TTL_SECONDS): ReapDecision {
	if (group.protectedReason) return { reap: false, reason: `protected: ${group.protectedReason}` };
	if (!group.automation) return { reap: false, reason: "protected: no headless/automation marker" };
	if (group.liveOmpAncestor) return { reap: false, reason: "protected: live OMP ancestor" };
	if (!group.orphaned) return { reap: false, reason: "protected: live non-OMP parent" };
	if (group.root.ageSeconds < ttlSeconds) return { reap: false, reason: `young orphan (<${Math.ceil(ttlSeconds / 60)}m)` };
	return { reap: true, reason: OMP_OWNED_PROFILE_RE.test(group.members.map(p => p.command).join("\n")) ? "stale OMP-owned headless orphan" : "stale parentless headless orphan" };
}

function formatAge(seconds: number): string {
	if (seconds >= 86_400) return `${Math.floor(seconds / 86_400)}d${Math.floor((seconds % 86_400) / 3_600)}h`;
	if (seconds >= 3_600) return `${Math.floor(seconds / 3_600)}h${Math.floor((seconds % 3_600) / 60)}m`;
	return `${Math.floor(seconds / 60)}m`;
}

function formatMb(kb: number): string {
	return `${(kb / 1024).toFixed(1)}M`;
}

async function inventory(): Promise<ProcessRow[]> {
	const proc = Bun.spawn(["ps", "-axo", "pid=,ppid=,etime=,rss=,command="], { stdout: "pipe", stderr: "pipe" });
	const [stdout, stderr, exitCode] = await Promise.all([
		new Response(proc.stdout).text(),
		new Response(proc.stderr).text(),
		proc.exited,
	]);
	if (exitCode !== 0) throw new Error(`ps failed (${exitCode}): ${stderr.trim()}`);
	return parsePs(stdout);
}

async function terminateMembers(group: ProcessGroup, ttlSeconds: number): Promise<boolean> {
	const refreshed = groupBrowserProcesses(await inventory()).find(
		candidate => candidate.root.pid === group.root.pid && candidate.root.command === group.root.command,
	);
	if (!refreshed || !classifyGroup(refreshed, ttlSeconds).reap) return false;

	for (const member of refreshed.members) {
		try {
			process.kill(member.pid, "SIGTERM");
		} catch (error) {
			if ((error as NodeJS.ErrnoException).code !== "ESRCH") throw error;
		}
	}
	await Bun.sleep(750);

	// Re-inventory before escalation so a PID reused during the grace window is
	// never killed based on stale identity.
	const remaining = groupBrowserProcesses(await inventory()).find(
		candidate => candidate.root.pid === group.root.pid && candidate.root.command === group.root.command,
	);
	if (!remaining || !classifyGroup(remaining, ttlSeconds).reap) return true;
	for (const member of remaining.members) {
		try {
			process.kill(member.pid, "SIGKILL");
		} catch (error) {
			if ((error as NodeJS.ErrnoException).code !== "ESRCH") throw error;
		}
	}
	return true;
}

function usage(): string {
	return `Usage: bun scripts/browser-reaper.ts [--apply] [--ttl-minutes N]\n\nDry-run is the default. --apply terminates only stale, parentless headless/automation groups.\nFor cron/launchd-free daily automation, add this typed command to the existing daily runner:\n  bun ~/agents/scripts/browser-reaper.ts --apply --ttl-minutes 60\nDo not install a launchd job without explicit approval.`;
}

async function main(argv: string[]): Promise<void> {
	if (argv.includes("--help") || argv.includes("-h")) {
		console.log(usage());
		return;
	}
	const apply = argv.includes("--apply");
	const ttlIndex = argv.indexOf("--ttl-minutes");
	const ttlMinutes = ttlIndex >= 0 ? Number(argv[ttlIndex + 1]) : DEFAULT_TTL_SECONDS / 60;
	if (!Number.isFinite(ttlMinutes) || ttlMinutes < 1) throw new Error("--ttl-minutes must be a number >= 1");
	const ttlSeconds = ttlMinutes * 60;
	const groups = groupBrowserProcesses(await inventory());
	console.log(`${apply ? "APPLY" : "DRY RUN"}: ${groups.length} browser/driver group(s), ${formatMb(groups.reduce((sum, group) => sum + group.rssKb, 0))} RSS`);
	console.log("PID     PPID    AGE     RSS      PROCS  DECISION");
	const targets: ProcessGroup[] = [];
	for (const group of groups) {
		const decision = classifyGroup(group, ttlSeconds);
		if (decision.reap) targets.push(group);
		console.log(`${String(group.root.pid).padEnd(8)}${String(group.root.ppid).padEnd(8)}${formatAge(group.root.ageSeconds).padEnd(8)}${formatMb(group.rssKb).padEnd(9)}${String(group.members.length).padEnd(7)}${decision.reap ? apply ? "KILL" : "WOULD KILL" : "KEEP"} — ${decision.reason}`);
	}
	const targetRss = targets.reduce((sum, group) => sum + group.rssKb, 0);
	if (!apply) {
		console.log(`Would kill ${targets.length} group(s), reclaiming approximately ${formatMb(targetRss)} RSS. Re-run with --apply to act.`);
		return;
	}
	let killed = 0;
	let reclaimedRss = 0;
	for (const group of targets) {
		if (!(await terminateMembers(group, ttlSeconds))) continue;
		killed++;
		reclaimedRss += group.rssKb;
	}
	console.log(`Killed ${killed} group(s), reclaiming approximately ${formatMb(reclaimedRss)} RSS.`);
}

if (import.meta.main) await main(Bun.argv.slice(2));
