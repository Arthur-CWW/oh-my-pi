export interface ProcessIdentity {
	readonly bootId: string;
	readonly pid: number;
	readonly startFingerprint: string;
}

function commandOutput(command: readonly string[]): string {
	const result = Bun.spawnSync({ cmd: [...command], stdout: "pipe", stderr: "ignore" });
	return result.exitCode === 0 ? new TextDecoder().decode(result.stdout).trim().replace(/\s+/g, " ") : "";
}

let cachedBootId = "";

function readBootId(): string {
	if (cachedBootId) return cachedBootId;
	const bootId =
		process.platform === "linux"
			? commandOutput(["/bin/cat", "/proc/sys/kernel/random/boot_id"])
			: process.platform === "darwin"
				? commandOutput(["/usr/sbin/sysctl", "-n", "kern.boottime"])
				: "";
	if (bootId) cachedBootId = bootId;
	return bootId;
}

/** Read a PID-reuse-safe identity for one live process. */
export function readProcessIdentity(pid: number): ProcessIdentity | null {
	if (!Number.isSafeInteger(pid) || pid <= 0) return null;
	const bootId = readBootId();
	const startFingerprint = commandOutput(["/bin/ps", "-o", "lstart=", "-p", String(pid)]);
	return bootId && startFingerprint ? { bootId, pid, startFingerprint } : null;
}

/** True only when the same process still owns this PID on the same boot. */
export function matchesProcessIdentity(identity: ProcessIdentity): boolean {
	const current = readProcessIdentity(identity.pid);
	return (
		current !== null && current.bootId === identity.bootId && current.startFingerprint === identity.startFingerprint
	);
}
