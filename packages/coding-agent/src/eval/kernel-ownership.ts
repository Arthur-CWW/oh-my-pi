import * as fs from "node:fs/promises";
import * as path from "node:path";
import { getActiveProfile, getProfileRootDir, logger } from "@oh-my-pi/pi-utils";
import { Process, ProcessStatus } from "@oh-my-pi/pi-natives";

const OWNERSHIP_DIRECTORY = "eval-kernels";
const RECORD_VERSION = 1 as const;

export type EvalKernelKind = "python" | "node-repl";

export interface EvalKernelOwnershipRecord {
	readonly version: typeof RECORD_VERSION;
	readonly kind: EvalKernelKind;
	readonly kernelId: string;
	readonly sessionId: string;
	readonly ownerPid: number;
	readonly kernelPid: number;
	readonly createdAt: string;
	readonly argv?: readonly string[];
	readonly rssBytes?: number;
}

export interface KernelOwnershipHandle {
	readonly record: EvalKernelOwnershipRecord;
	readonly path: string;
	unregister(): Promise<void>;
}

export interface KernelOwnershipOptions {
	readonly kind: EvalKernelKind;
	readonly kernelId: string;
	readonly sessionId: string;
	readonly ownerPid: number;
	readonly kernelPid: number;
	readonly root?: string;
	readonly argv?: readonly string[];
}

export interface KernelProcessInfo {
	readonly pid: number;
	readonly ppid: number | null;
	readonly rssBytes?: number;
	readonly argv: readonly string[];
}

export function defaultKernelOwnershipRoot(): string {
	return path.join(getProfileRootDir(getActiveProfile()), OWNERSHIP_DIRECTORY);
}

function ownershipRoot(root?: string): string {
	return path.resolve(root ?? process.env.OMP_EVAL_KERNEL_ROOT ?? defaultKernelOwnershipRoot());
}

function recordPath(root: string, kernelId: string, kernelPid: number): string {
	const safeId = kernelId.replace(/[^A-Za-z0-9._-]+/g, "-").slice(0, 80) || "kernel";
	return path.join(root, `${safeId}-${kernelPid}.json`);
}

function validPid(value: unknown): value is number {
	return typeof value === "number" && Number.isSafeInteger(value) && value > 0;
}

function parseRecord(value: unknown): EvalKernelOwnershipRecord | undefined {
	if (!value || typeof value !== "object" || Array.isArray(value)) return undefined;
	const parsed = value as Partial<EvalKernelOwnershipRecord>;
	if (
		parsed.version !== RECORD_VERSION ||
		(parsed.kind !== "python" && parsed.kind !== "node-repl") ||
		typeof parsed.kernelId !== "string" ||
		typeof parsed.sessionId !== "string" ||
		!validPid(parsed.ownerPid) ||
		!validPid(parsed.kernelPid) ||
		typeof parsed.createdAt !== "string" ||
		(parsed.argv !== undefined && (!Array.isArray(parsed.argv) || parsed.argv.some(item => typeof item !== "string"))) ||
		(parsed.rssBytes !== undefined && (!Number.isSafeInteger(parsed.rssBytes) || parsed.rssBytes < 0))
	) {
		return undefined;
	}
	return parsed as EvalKernelOwnershipRecord;
}

export async function registerKernelOwnership(options: KernelOwnershipOptions): Promise<KernelOwnershipHandle> {
	if (!validPid(options.ownerPid) || !validPid(options.kernelPid)) {
		throw new Error("Kernel ownership requires positive owner and kernel PIDs");
	}
	const root = ownershipRoot(options.root);
	await fs.mkdir(root, { recursive: true, mode: 0o700 });
	const record: EvalKernelOwnershipRecord = {
		version: RECORD_VERSION,
		kind: options.kind,
		kernelId: options.kernelId,
		sessionId: options.sessionId,
		ownerPid: options.ownerPid,
		kernelPid: options.kernelPid,
		createdAt: new Date().toISOString(),
		...(options.argv === undefined ? {} : { argv: [...options.argv] }),
	};
	const target = recordPath(root, record.kernelId, record.kernelPid);
	const temp = `${target}.${process.pid}.${Date.now()}.tmp`;
	await fs.writeFile(temp, `${JSON.stringify(record)}\n`, { mode: 0o600 });
	await fs.rename(temp, target);
	let unregistered = false;
	return {
		record,
		path: target,
		async unregister() {
			if (unregistered) return;
			unregistered = true;
			try {
				await fs.rm(target, { force: true });
			} catch (error) {
				logger.debug("Failed to remove eval kernel ownership marker", { path: target, error: String(error) });
			}
		},
	};
}

export async function listKernelOwnershipRecords(root?: string): Promise<readonly { record: EvalKernelOwnershipRecord; path: string }[]> {
	const directory = ownershipRoot(root);
	let names: string[];
	try {
		names = await fs.readdir(directory);
	} catch (error) {
		if ((error as NodeJS.ErrnoException).code === "ENOENT") return [];
		throw error;
	}
	const records: Array<{ record: EvalKernelOwnershipRecord; path: string }> = [];
	for (const name of names) {
		if (!name.endsWith(".json")) continue;
		const markerPath = path.join(directory, name);
		try {
			const parsed = parseRecord(JSON.parse(await fs.readFile(markerPath, "utf8")));
			if (parsed) records.push({ record: parsed, path: markerPath });
		} catch {
			// A partial marker is not actionable. The next kernel spawn or doctor run
			// can safely ignore it without guessing ownership.
		}
	}
	return records.sort((a, b) => a.path.localeCompare(b.path));
}

export function inspectKernelProcess(pid: number): { readonly alive: boolean; readonly argv: readonly string[]; readonly ppid: number | null } {
	const processRef = Process.fromPid(pid);
	if (!processRef || processRef.status() !== ProcessStatus.Running) return { alive: false, argv: [], ppid: null };
	try {
		return { alive: true, argv: processRef.args(), ppid: processRef.ppid };
	} catch {
		return { alive: true, argv: [], ppid: processRef.ppid };
	}
}

export async function terminateKernelProcess(pid: number): Promise<boolean> {
	const processRef = Process.fromPid(pid);
	if (!processRef || processRef.status() !== ProcessStatus.Running) return true;
	try {
		return await processRef.terminate({ group: true, gracefulMs: 1_000, timeoutMs: 1_000 });
	} catch {
		try {
			process.kill(pid, "SIGTERM");
		} catch {
			return true;
		}
		await Bun.sleep(100);
		try {
			process.kill(pid, "SIGKILL");
		} catch {
			// The process exited during the grace period.
		}
		return true;
	}
}

export async function removeKernelOwnershipMarker(markerPath: string): Promise<boolean> {
	try {
		await fs.rm(markerPath, { force: true });
		return true;
	} catch {
		return false;
	}
}

export function isKernelProcessMatch(record: EvalKernelOwnershipRecord, processInfo: { readonly alive: boolean; readonly argv: readonly string[] }): boolean {
	if (!processInfo.alive) return false;
	if (record.argv === undefined || record.argv.length === 0 || processInfo.argv.length === 0) return true;
	return record.argv.every((arg, index) => processInfo.argv[index] === arg);
}

export function processInfoFromRecord(record: EvalKernelOwnershipRecord): KernelProcessInfo {
	const processInfo = inspectKernelProcess(record.kernelPid);
	return {
		pid: record.kernelPid,
		ppid: processInfo.ppid,
		argv: processInfo.argv,
	};
}
