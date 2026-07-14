import * as crypto from "node:crypto";
import * as fs from "node:fs/promises";
import * as path from "node:path";
import { Process, ProcessStatus } from "@oh-my-pi/pi-natives";
import { getActiveProfile, getProfileRootDir, logger } from "@oh-my-pi/pi-utils";
import { gracefulKillTreeOnce } from "./attach";

const MARKER_NAME = "owner.json";

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

function sessionDirectory(sessionId: string): string {
	const readable = sessionId.replace(/[^A-Za-z0-9._-]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 48) || "anonymous";
	const suffix = crypto.createHash("sha256").update(sessionId).digest("hex").slice(0, 12);
	return path.join(getProfileRootDir(getActiveProfile()), "browser-sessions", `${readable}-${suffix}`);
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
			typeof parsed.createdAt !== "string"
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

export async function prepareOwnedBrowserProfile(sessionId: string): Promise<OwnedBrowserProfile> {
	const sessionDir = sessionDirectory(sessionId);
	await fs.mkdir(sessionDir, { recursive: true, mode: 0o700 });
	await sweepStaleRuns(sessionDir);
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
	};
	await fs.writeFile(markerPath, `${JSON.stringify(marker)}\n`, { mode: 0o600 });
	return { profileDir, markerPath };
}

export async function recordOwnedBrowserPid(ownership: OwnedBrowserProfile, browserPid: number | null): Promise<void> {
	const marker = await readMarker(ownership.markerPath);
	if (!marker) return;
	await fs.writeFile(ownership.markerPath, `${JSON.stringify({ ...marker, browserPid })}\n`, { mode: 0o600 });
}

export async function removeOwnedBrowserProfile(ownership: OwnedBrowserProfile | undefined): Promise<void> {
	if (!ownership) return;
	await fs.rm(path.dirname(ownership.profileDir), { recursive: true, force: true });
}
