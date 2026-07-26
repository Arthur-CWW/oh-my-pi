import * as fs from "node:fs";

export interface ProcessIdentity {
	readonly bootId: string;
	readonly pid: number;
	readonly startFingerprint: string;
}

function commandOutput(command: string[]): string {
	const result = Bun.spawnSync({ cmd: command, stdout: "pipe", stderr: "ignore" });
	return result.exitCode === 0 ? new TextDecoder().decode(result.stdout).trim().replace(/\s+/g, " ") : "";
}

function bootIdentity(): string {
	if (process.platform === "linux") {
		try {
			return fs.readFileSync("/proc/sys/kernel/random/boot_id", "utf8").trim();
		} catch {
			return "";
		}
	}
	if (process.platform === "darwin") return commandOutput(["/usr/sbin/sysctl", "-n", "kern.boottime"]);
	return commandOutput(["/bin/ps", "-o", "lstart=", "-p", "1"]);
}

/** Capture a PID-reuse-safe process identity on platforms that expose both boot and start fingerprints. */
export function processIdentityFor(pid: number): ProcessIdentity | null {
	if (!Number.isSafeInteger(pid) || pid <= 0) return null;
	const bootId = bootIdentity();
	const startFingerprint = commandOutput(["/bin/ps", "-o", "lstart=", "-p", String(pid)]);
	return bootId && startFingerprint ? { bootId, pid, startFingerprint } : null;
}

export function decodeProcessIdentity(value: unknown): ProcessIdentity | undefined {
	if (typeof value === "string") {
		try {
			value = JSON.parse(value);
		} catch {
			return undefined;
		}
	}
	if (typeof value !== "object" || value === null || Array.isArray(value)) return undefined;
	const record = value as Record<string, unknown>;
	if (
		Object.keys(record).length !== 3 ||
		typeof record.bootId !== "string" ||
		typeof record.pid !== "number" ||
		!Number.isSafeInteger(record.pid) ||
		record.pid <= 0 ||
		typeof record.startFingerprint !== "string"
	) {
		return undefined;
	}
	return { bootId: record.bootId, pid: record.pid, startFingerprint: record.startFingerprint };
}

/** Verify both PID liveness and the process start fingerprint, never PID alone. */
export function processMatches(identity: ProcessIdentity): boolean {
	const current = processIdentityFor(identity.pid);
	return current !== null && current.bootId === identity.bootId && current.startFingerprint === identity.startFingerprint;
}
