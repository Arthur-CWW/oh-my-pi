import * as crypto from "node:crypto";
import * as fs from "node:fs/promises";
import * as path from "node:path";
import { Process, ProcessStatus } from "@oh-my-pi/pi-natives";
import { getActiveProfile, getProfileRootDir, logger } from "@oh-my-pi/pi-utils";
import { gracefulKillTreeOnce } from "./attach";
import { ToolError } from "../tool-errors";

const MARKER_NAME = "owner.json";
const BUDGET_LOCK_NAME = ".budget-lock";

export const DEFAULT_MAX_OWNED_PER_SESSION = 2;
export const DEFAULT_MAX_OWNED_GLOBAL = 6;

export interface OwnedBrowserProfile {
	profileDir: string;
	markerPath: string;
}

export interface OwnedBrowserMarker {
	version: 1;
	sessionId: string;
	ownerPid: number;
	browserPid: number | null;
	profileDir: string;
	createdAt: string;
	/** null while launch is in progress; a number once the browser is acquired. */
	activeTabs?: number | null;
}

export interface OwnedBrowserRecord {
	marker: OwnedBrowserMarker;
	runDir: string;
	ownerAlive: boolean;
	browserAlive: boolean;
	idle: boolean;
}

export type BrowserBudgetScope = "session" | "global";

export class BrowserResourceBudgetError extends ToolError {
	readonly code = "BROWSER_RESOURCE_CAP_REACHED" as const;

	constructor(
		readonly scope: BrowserBudgetScope,
		readonly limit: number,
		readonly sessionId: string,
		readonly openBrowsers: readonly OwnedBrowserRecord[],
	) {
		const scopeLabel = scope === "session" ? `session ${JSON.stringify(sessionId)}` : "machine";
		const rows = openBrowsers.length
			? openBrowsers.map(record => {
					const marker = record.marker;
					const pid = marker.browserPid === null ? "launching" : `PID ${marker.browserPid}`;
					const state = record.idle ? "idle" : "active";
					return `- session ${JSON.stringify(marker.sessionId)} (${pid}, ${state}, profile ${marker.profileDir})`;
				}).join("\n")
			: "- no browser details available";
		super(
				`Cannot open browser: ${scopeLabel} owned-browser cap (${limit}) is reached. Open owned browsers:\n${rows}\n` +
					"Close a browser tab with {\"action\":\"close\",\"all\":true,\"kill\":true} and retry.",
			{
				code: "BROWSER_RESOURCE_CAP_REACHED",
				scope,
				limit,
				sessionId,
				openBrowsers,
			},
		);
		this.name = "BrowserResourceBudgetError";
	}
}

export function normalizeBrowserOwnershipCap(value: unknown, fallback: number): number {
	return typeof value === "number" && Number.isSafeInteger(value) && value > 0 ? value : fallback;
}

export function shouldReapOwnedProfile(
	marker: OwnedBrowserMarker,
	ownerAlive: boolean,
	browserArgs: readonly string[] | null,
): boolean {
	if (ownerAlive) return false;
	if (marker.browserPid === null || browserArgs === null) return true;
	return browserArgs.some(arg => arg === `--user-data-dir=${marker.profileDir}` || arg === marker.profileDir);
}

function browserSessionsDirectory(): string {
	return path.join(getProfileRootDir(getActiveProfile()), "browser-sessions");
}

function sessionDirectory(sessionId: string): string {
	const readable = sessionId.replace(/[^A-Za-z0-9._-]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 48) || "anonymous";
	const suffix = crypto.createHash("sha256").update(sessionId).digest("hex").slice(0, 12);
	return path.join(browserSessionsDirectory(), `${readable}-${suffix}`);
}

async function readMarker(markerPath: string): Promise<OwnedBrowserMarker | null> {
	try {
		const parsed = JSON.parse(await fs.readFile(markerPath, "utf8")) as Partial<OwnedBrowserMarker>;
		if (
			parsed.version !== 1 ||
			typeof parsed.sessionId !== "string" ||
			typeof parsed.ownerPid !== "number" ||
			(parsed.browserPid !== null && typeof parsed.browserPid !== "number") ||
			typeof parsed.profileDir !== "string" ||
			typeof parsed.createdAt !== "string" ||
			(parsed.activeTabs !== undefined &&
				parsed.activeTabs !== null &&
				(!Number.isSafeInteger(parsed.activeTabs) || parsed.activeTabs < 0))
		) {
			return null;
		}
		return parsed as OwnedBrowserMarker;
	} catch {
		return null;
	}
}

function inspectProcess(pid: number): { alive: boolean; args: string[] | null } {
	const proc = Process.fromPid(pid);
	if (!proc || proc.status() !== ProcessStatus.Running) return { alive: false, args: null };
	try {
		return { alive: true, args: proc.args() };
	} catch {
		return { alive: true, args: [] };
	}
}

async function sweepStaleRuns(sessionDir: string): Promise<void> {
	let entries: string[];
	try {
		entries = await fs.readdir(sessionDir);
	} catch (error) {
		if ((error as NodeJS.ErrnoException).code === "ENOENT") return;
		throw error;
	}
	for (const entry of entries) {
		const runDir = path.join(sessionDir, entry);
		const marker = await readMarker(path.join(runDir, MARKER_NAME));
		if (!marker) continue;
		const owner = inspectProcess(marker.ownerPid);
		const browser = marker.browserPid === null ? { alive: false, args: null } : inspectProcess(marker.browserPid);
		if (!shouldReapOwnedProfile(marker, owner.alive, browser.alive ? browser.args : null)) continue;
		if (marker.browserPid !== null && browser.alive) {
			await gracefulKillTreeOnce(marker.browserPid).catch(error => {
				logger.debug("Failed to reap stale owned browser", { pid: marker.browserPid, error: String(error) });
			});
		}
		await fs.rm(runDir, { recursive: true, force: true });
		logger.debug("Reaped stale OMP browser profile", { path: runDir, ownerPid: marker.ownerPid });
	}
}

async function listOwnedBrowserRecordsUnlocked(): Promise<OwnedBrowserRecord[]> {
	const root = browserSessionsDirectory();
	let sessionEntries: string[];
	try {
		sessionEntries = await fs.readdir(root);
	} catch (error) {
		if ((error as NodeJS.ErrnoException).code === "ENOENT") return [];
		throw error;
	}
	const records: OwnedBrowserRecord[] = [];
	for (const sessionEntry of sessionEntries) {
		if (sessionEntry === BUDGET_LOCK_NAME) continue;
		const sessionDir = path.join(root, sessionEntry);
		await sweepStaleRuns(sessionDir);
		let runEntries: string[];
		try {
			runEntries = await fs.readdir(sessionDir);
		} catch (error) {
			if ((error as NodeJS.ErrnoException).code === "ENOENT") continue;
			throw error;
		}
		for (const runEntry of runEntries) {
			const runDir = path.join(sessionDir, runEntry);
			const marker = await readMarker(path.join(runDir, MARKER_NAME));
			if (!marker) continue;
			const owner = inspectProcess(marker.ownerPid);
			const browserAlive = marker.browserPid !== null && inspectProcess(marker.browserPid).alive;
			records.push({
				marker,
				runDir,
				ownerAlive: owner.alive,
				browserAlive,
				idle: owner.alive && browserAlive && marker.activeTabs === 0,
			});
		}
	}
	return records.sort((a, b) => {
		const created = a.marker.createdAt.localeCompare(b.marker.createdAt);
		return created || a.runDir.localeCompare(b.runDir);
	});
}

export async function listOwnedBrowserMarkers(): Promise<OwnedBrowserRecord[]> {
	return listOwnedBrowserRecordsUnlocked();
}

export const listOwnedBrowserRecords = listOwnedBrowserMarkers;

function isCountedRecord(record: OwnedBrowserRecord): boolean {
	return record.ownerAlive && (record.marker.browserPid === null || record.browserAlive);
}

async function reclaimIdleBrowser(record: OwnedBrowserRecord): Promise<void> {
	if (!record.idle || record.marker.browserPid === null) return;
	await gracefulKillTreeOnce(record.marker.browserPid);
	await fs.rm(record.runDir, { recursive: true, force: true });
	logger.debug("Reclaimed idle owned OMP browser", {
		pid: record.marker.browserPid,
		sessionId: record.marker.sessionId,
	});
}

export interface OwnedBrowserBudgetOptions {
	sessionId: string;
	maxOwnedPerSession?: number;
	maxOwnedGlobal?: number;
}

async function enforceOwnedBrowserBudgetUnlocked(opts: OwnedBrowserBudgetOptions): Promise<void> {
	const maxPerSession = normalizeBrowserOwnershipCap(opts.maxOwnedPerSession, DEFAULT_MAX_OWNED_PER_SESSION);
	const maxGlobal = normalizeBrowserOwnershipCap(opts.maxOwnedGlobal, DEFAULT_MAX_OWNED_GLOBAL);
	let records = await listOwnedBrowserRecordsUnlocked();
	for (;;) {
		const counted = records.filter(isCountedRecord);
		const sessionCount = counted.filter(record => record.marker.sessionId === opts.sessionId).length;
		const scope: BrowserBudgetScope | undefined = sessionCount >= maxPerSession ? "session" : counted.length >= maxGlobal ? "global" : undefined;
		if (!scope) return;
		const candidate = records.find(record => record.idle && (scope === "global" || record.marker.sessionId === opts.sessionId));
		if (!candidate) {
			throw new BrowserResourceBudgetError(scope, scope === "session" ? maxPerSession : maxGlobal, opts.sessionId, counted);
		}
		await reclaimIdleBrowser(candidate);
		records = await listOwnedBrowserRecordsUnlocked();
	}
}

async function withBudgetLock<T>(fn: () => Promise<T>): Promise<T> {
	const root = browserSessionsDirectory();
	await fs.mkdir(root, { recursive: true, mode: 0o700 });
	const lockDir = path.join(root, BUDGET_LOCK_NAME);
	for (let attempt = 0; attempt < 250; attempt++) {
		try {
			await fs.mkdir(lockDir, { mode: 0o700 });
			await fs.writeFile(path.join(lockDir, "owner"), `${process.pid}\n`, { mode: 0o600 });
			try {
				return await fn();
			} finally {
				await fs.rm(lockDir, { recursive: true, force: true });
			}
		} catch (error) {
			if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
			try {
				const ownerPid = Number((await fs.readFile(path.join(lockDir, "owner"), "utf8")).trim());
				if (!Number.isSafeInteger(ownerPid) || !inspectProcess(ownerPid).alive) {
					await fs.rm(lockDir, { recursive: true, force: true });
					continue;
				}
			} catch {
				// A lock owner may be between mkdir and writing its PID.
			}
			await Bun.sleep(10);
		}
	}
	throw new ToolError("Timed out waiting for the browser ownership budget lock; retry the browser open.");
}

export async function enforceOwnedBrowserBudget(opts: OwnedBrowserBudgetOptions): Promise<void> {
	await withBudgetLock(() => enforceOwnedBrowserBudgetUnlocked(opts));
}

export interface OwnedBrowserProfileOptions {
	maxOwnedPerSession?: number;
	maxOwnedGlobal?: number;
}

export async function prepareOwnedBrowserProfile(
	sessionId: string,
	options: OwnedBrowserProfileOptions = {},
): Promise<OwnedBrowserProfile> {
	const sessionDir = sessionDirectory(sessionId);
	await fs.mkdir(sessionDir, { recursive: true, mode: 0o700 });
	return withBudgetLock(async () => {
		await enforceOwnedBrowserBudgetUnlocked({ sessionId, ...options });
		const runDir = await fs.mkdtemp(path.join(sessionDir, `${process.pid}-`));
		const profileDir = path.join(runDir, "profile");
		const markerPath = path.join(runDir, MARKER_NAME);
		await fs.mkdir(profileDir, { recursive: true, mode: 0o700 });
		const marker: OwnedBrowserMarker = {
			version: 1,
			sessionId,
			ownerPid: process.pid,
			browserPid: null,
			profileDir,
			createdAt: new Date().toISOString(),
			activeTabs: null,
		};
		await fs.writeFile(markerPath, `${JSON.stringify(marker)}\n`, { mode: 0o600 });
		return { profileDir, markerPath };
	});
}

export async function recordOwnedBrowserPid(ownership: OwnedBrowserProfile, browserPid: number | null): Promise<void> {
	const marker = await readMarker(ownership.markerPath);
	if (!marker) return;
	await fs.writeFile(ownership.markerPath, `${JSON.stringify({ ...marker, browserPid })}\n`, { mode: 0o600 });
}

export async function recordOwnedBrowserActiveTabs(ownership: OwnedBrowserProfile, activeTabs: number | null): Promise<void> {
	if (activeTabs !== null && (!Number.isSafeInteger(activeTabs) || activeTabs < 0)) return;
	const marker = await readMarker(ownership.markerPath);
	if (!marker) return;
	await fs.writeFile(ownership.markerPath, `${JSON.stringify({ ...marker, activeTabs })}\n`, { mode: 0o600 });
}

export async function removeOwnedBrowserProfile(ownership: OwnedBrowserProfile | undefined): Promise<void> {
	if (!ownership) return;
	await fs.rm(path.dirname(ownership.profileDir), { recursive: true, force: true });
}
