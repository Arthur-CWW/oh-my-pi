import * as fs from "node:fs";
import * as os from "node:os";

const GIB = 1_073_741_824;
const FALLBACK_MEMORY_BYTES = 8 * GIB;
const FALLBACK_CPU_COUNT = 1;
const RESERVED_MEMORY_RATIO = 0.2;
const RESERVED_CPU_RATIO = 0.2;
const MIN_RESERVED_MEMORY_BYTES = 8 * GIB;

export const DEFAULT_ATTEMPT_RESERVATION_BYTES = Math.floor(1.5 * GIB);

export type HostResourceLimitBound = "user-cap" | "cpu" | "memory";

export interface HostResourceProbe {
	readonly systemMemoryBytes: number;
	readonly systemCpuCount: number;
	readonly cgroupMemoryLimitBytes?: number;
	readonly cgroupCpuQuota?: number;
	readonly cgroupCpusetCpuCount?: number;
	readonly warnings: readonly string[];
}

export interface HostResourceProfileOptions {
	readonly userCap?: number;
	readonly memoryBudgetBytes?: number;
	readonly childReservationBytes?: number;
	readonly probe?: HostResourceProbe;
}

export interface HostResourceProfile {
	readonly mode: "resource-bounded" | "explicit-cap";
	readonly systemMemoryBytes: number;
	readonly cgroupMemoryLimitBytes: number | null;
	readonly effectiveMemoryBytes: number;
	readonly reservedHeadroomBytes: number;
	readonly memoryBudgetBytes: number;
	readonly childReservationBytes: number;
	readonly memoryCapacity: number;
	readonly systemCpuCount: number;
	readonly cgroupCpuLimit: number | null;
	readonly effectiveCpuCount: number;
	readonly reservedCpuCount: number;
	readonly cpuCapacity: number;
	readonly userCap: number | null;
	readonly effectiveLimit: number;
	readonly limitingBounds: readonly HostResourceLimitBound[];
	readonly explanation: string;
	readonly probeWarnings: readonly string[];
}

function positiveInteger(value: number | undefined, fallback: number): number {
	return value !== undefined && Number.isSafeInteger(value) && value > 0 ? value : fallback;
}

function positiveFinite(value: number | undefined): number | undefined {
	return value !== undefined && Number.isFinite(value) && value > 0 ? value : undefined;
}

function readText(path: string, warnings: string[]): string | undefined {
	try {
		return fs.readFileSync(path, "utf8").trim();
	} catch (error) {
		const code = error && typeof error === "object" && "code" in error ? String(error.code) : "unknown";
		if (code !== "ENOENT" && code !== "ENOTDIR") warnings.push(`${path}: ${code}`);
		return undefined;
	}
}

function parsePositiveInteger(text: string | undefined): number | undefined {
	if (!text || text === "max") return undefined;
	const value = Number(text);
	return Number.isSafeInteger(value) && value > 0 ? value : undefined;
}

function parseCpuSet(text: string | undefined): number | undefined {
	if (!text) return undefined;
	let count = 0;
	const seen = new Set<number>();
	for (const segment of text.split(",")) {
		const match = /^(\d+)(?:-(\d+))?$/.exec(segment.trim());
		if (!match) return undefined;
		const first = Number(match[1]);
		const last = match[2] === undefined ? first : Number(match[2]);
		if (!Number.isSafeInteger(first) || !Number.isSafeInteger(last) || first < 0 || last < first) return undefined;
		if (last - first > 1_000_000) return undefined;
		for (let cpu = first; cpu <= last; cpu++) seen.add(cpu);
	}
	count = seen.size;
	return count > 0 ? count : undefined;
}

function cgroupRoots(warnings: string[]): readonly string[] {
	const roots = new Set(["/sys/fs/cgroup"]);
	const membership = readText("/proc/self/cgroup", warnings);
	if (membership) {
		for (const line of membership.split("\n")) {
			const match = /^\d+:[^:]*:(\/.*)$/.exec(line);
			if (match && match[1] !== "/") roots.add(`/sys/fs/cgroup${match[1]}`);
		}
	}
	return [...roots];
}

function smallest(values: readonly (number | undefined)[]): number | undefined {
	const valid = values.filter((value): value is number => value !== undefined && Number.isFinite(value) && value > 0);
	return valid.length === 0 ? undefined : Math.min(...valid);
}

function readCgroupMemoryLimit(roots: readonly string[], warnings: string[]): number | undefined {
	const values: number[] = [];
	for (const root of roots) {
		const unified = parsePositiveInteger(readText(`${root}/memory.max`, warnings));
		if (unified !== undefined) values.push(unified);
		const legacy = parsePositiveInteger(readText(`${root}/memory/memory.limit_in_bytes`, warnings));
		if (legacy !== undefined) values.push(legacy);
	}
	return smallest(values);
}

function readCgroupCpuQuota(roots: readonly string[], warnings: string[]): number | undefined {
	const values: number[] = [];
	for (const root of roots) {
		const unified = readText(`${root}/cpu.max`, warnings);
		if (unified) {
			const [quotaText, periodText] = unified.split(/\s+/, 2);
			const quota = parsePositiveInteger(quotaText);
			const period = parsePositiveInteger(periodText);
			if (quota !== undefined && period !== undefined) values.push(quota / period);
		}
		const quota = parsePositiveInteger(readText(`${root}/cpu/cpu.cfs_quota_us`, warnings));
		const period = parsePositiveInteger(readText(`${root}/cpu/cpu.cfs_period_us`, warnings));
		if (quota !== undefined && period !== undefined) values.push(quota / period);
	}
	return smallest(values);
}

function readCgroupCpuSet(roots: readonly string[], warnings: string[]): number | undefined {
	const values: number[] = [];
	for (const root of roots) {
		for (const name of ["cpuset.cpus.effective", "cpuset.cpus", "cpuset/cpuset.cpus"] as const) {
			const count = parseCpuSet(readText(`${root}/${name}`, warnings));
			if (count !== undefined) values.push(count);
		}
	}
	return smallest(values);
}

/** Reads live sysconf-backed OS capacity and Linux cgroup constraints without spawning a shell. */
export function probeHostResources(): HostResourceProbe {
	const warnings: string[] = [];
	const systemMemoryBytes = positiveInteger(os.totalmem(), FALLBACK_MEMORY_BYTES);
	const availableParallelism =
		typeof os.availableParallelism === "function" ? os.availableParallelism() : os.cpus().length;
	const systemCpuCount = positiveInteger(availableParallelism, FALLBACK_CPU_COUNT);
	if (process.platform !== "linux") return { systemMemoryBytes, systemCpuCount, warnings };
	const roots = cgroupRoots(warnings);
	return {
		systemMemoryBytes,
		systemCpuCount,
		cgroupMemoryLimitBytes: readCgroupMemoryLimit(roots, warnings),
		cgroupCpuQuota: readCgroupCpuQuota(roots, warnings),
		cgroupCpusetCpuCount: readCgroupCpuSet(roots, warnings),
		warnings,
	};
}

export function computeHostResourceProfile(options: HostResourceProfileOptions = {}): HostResourceProfile {
	const probe = options.probe ?? probeHostResources();
	const systemMemoryBytes = positiveInteger(probe.systemMemoryBytes, FALLBACK_MEMORY_BYTES);
	const cgroupMemoryLimit = positiveFinite(probe.cgroupMemoryLimitBytes);
	const effectiveMemoryBytes = Math.floor(Math.min(systemMemoryBytes, cgroupMemoryLimit ?? systemMemoryBytes));
	const childReservationBytes = positiveInteger(options.childReservationBytes, DEFAULT_ATTEMPT_RESERVATION_BYTES);
	const desiredHeadroom = Math.max(MIN_RESERVED_MEMORY_BYTES, Math.ceil(effectiveMemoryBytes * RESERVED_MEMORY_RATIO));
	const reservedHeadroomBytes = Math.min(desiredHeadroom, Math.max(0, effectiveMemoryBytes - childReservationBytes));
	const derivedMemoryBudget = Math.max(childReservationBytes, effectiveMemoryBytes - reservedHeadroomBytes);
	const explicitMemoryBudget = positiveFinite(options.memoryBudgetBytes);
	const memoryBudgetBytes = Math.floor(Math.min(derivedMemoryBudget, explicitMemoryBudget ?? derivedMemoryBudget));
	const memoryCapacity = Math.max(1, Math.floor(memoryBudgetBytes / childReservationBytes));

	const systemCpuCount = positiveInteger(probe.systemCpuCount, FALLBACK_CPU_COUNT);
	const cgroupCpuLimit = smallest([probe.cgroupCpuQuota, probe.cgroupCpusetCpuCount]);
	const effectiveCpuCount = Math.max(1, Math.floor(Math.min(systemCpuCount, cgroupCpuLimit ?? systemCpuCount)));
	const reservedCpuCount = effectiveCpuCount <= 2 ? 0 : Math.max(1, Math.ceil(effectiveCpuCount * RESERVED_CPU_RATIO));
	const cpuCapacity = Math.max(1, effectiveCpuCount - reservedCpuCount);
	const configuredUserCap =
		options.userCap !== undefined && Number.isSafeInteger(options.userCap) && options.userCap > 0
			? options.userCap
			: undefined;
	const mode = configuredUserCap === undefined ? "resource-bounded" : "explicit-cap";
	const effectiveLimit = Math.min(configuredUserCap ?? Number.MAX_SAFE_INTEGER, cpuCapacity, memoryCapacity);
	const limitingBounds: HostResourceLimitBound[] = [];
	if (configuredUserCap === effectiveLimit) limitingBounds.push("user-cap");
	if (cpuCapacity === effectiveLimit) limitingBounds.push("cpu");
	if (memoryCapacity === effectiveLimit) limitingBounds.push("memory");
	const userTerm = configuredUserCap === undefined ? "resource-bounded" : `user ${configuredUserCap}`;
	const explanation = `effective ${effectiveLimit} = min(${userTerm}, cpu ${cpuCapacity}, memory ${memoryCapacity}); limited by ${limitingBounds.join("+")}`;
	return {
		mode,
		systemMemoryBytes,
		cgroupMemoryLimitBytes: cgroupMemoryLimit === undefined ? null : Math.floor(cgroupMemoryLimit),
		effectiveMemoryBytes,
		reservedHeadroomBytes,
		memoryBudgetBytes,
		childReservationBytes,
		memoryCapacity,
		systemCpuCount,
		cgroupCpuLimit: cgroupCpuLimit ?? null,
		effectiveCpuCount,
		reservedCpuCount,
		cpuCapacity,
		userCap: configuredUserCap ?? null,
		effectiveLimit,
		limitingBounds,
		explanation,
		probeWarnings: probe.warnings,
	};
}
