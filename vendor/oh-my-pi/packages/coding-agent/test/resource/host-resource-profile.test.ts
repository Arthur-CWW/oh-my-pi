import { describe, expect, it } from "bun:test";
import {
	computeHostResourceProfile,
	DEFAULT_ATTEMPT_RESERVATION_BYTES,
	type HostResourceProbe,
} from "@oh-my-pi/pi-coding-agent/resource/host-resource-profile";

const GIB = 1_073_741_824;

function probe(overrides: Partial<HostResourceProbe> = {}): HostResourceProbe {
	return {
		systemMemoryBytes: 512 * GIB,
		systemCpuCount: 128,
		warnings: [],
		...overrides,
	};
}

describe("host resource profile", () => {
	it("makes a 512 GiB/128 CPU H11 resource-bounded above the Mac emergency cap", () => {
		const profile = computeHostResourceProfile({ probe: probe() });
		expect(profile).toMatchObject({
			mode: "resource-bounded",
			userCap: null,
			effectiveMemoryBytes: 512 * GIB,
			childReservationBytes: DEFAULT_ATTEMPT_RESERVATION_BYTES,
			effectiveCpuCount: 128,
			reservedCpuCount: 26,
			cpuCapacity: 102,
			effectiveLimit: 102,
			limitingBounds: ["cpu"],
		});
		expect(profile.reservedHeadroomBytes).toBe(Math.ceil(512 * GIB * 0.2));
		expect(profile.memoryCapacity).toBe(273);
		expect(profile.explanation).toContain("resource-bounded");
	});

	it("keeps a Mac-sized host at its explicit cap of eight", () => {
		const profile = computeHostResourceProfile({
			probe: probe({ systemMemoryBytes: 64 * GIB, systemCpuCount: 16 }),
			userCap: 8,
		});
		expect(profile).toMatchObject({
			mode: "explicit-cap",
			userCap: 8,
			cpuCapacity: 12,
			memoryCapacity: 34,
			effectiveLimit: 8,
			limitingBounds: ["user-cap"],
		});
	});

	it("honors cgroup memory, quota, and cpuset limits", () => {
		const profile = computeHostResourceProfile({
			probe: probe({
				cgroupMemoryLimitBytes: 24 * GIB,
				cgroupCpuQuota: 4,
				cgroupCpusetCpuCount: 8,
			}),
		});
		expect(profile).toMatchObject({
			cgroupMemoryLimitBytes: 24 * GIB,
			effectiveMemoryBytes: 24 * GIB,
			memoryBudgetBytes: 16 * GIB,
			memoryCapacity: 10,
			cgroupCpuLimit: 4,
			effectiveCpuCount: 4,
			cpuCapacity: 3,
			effectiveLimit: 3,
			limitingBounds: ["cpu"],
		});
	});

	it("fails conservative when probes are invalid", () => {
		const profile = computeHostResourceProfile({
			probe: {
				systemMemoryBytes: Number.NaN,
				systemCpuCount: -1,
				cgroupMemoryLimitBytes: -1,
				cgroupCpuQuota: Number.POSITIVE_INFINITY,
				cgroupCpusetCpuCount: 0,
				warnings: ["bad sysconf"],
			},
		});
		expect(profile).toMatchObject({
			mode: "resource-bounded",
			effectiveMemoryBytes: 8 * GIB,
			memoryBudgetBytes: DEFAULT_ATTEMPT_RESERVATION_BYTES,
			memoryCapacity: 1,
			effectiveCpuCount: 1,
			cpuCapacity: 1,
			effectiveLimit: 1,
			limitingBounds: ["cpu", "memory"],
			probeWarnings: ["bad sysconf"],
		});
	});

	it("preserves an explicit cap below otherwise available resources", () => {
		const profile = computeHostResourceProfile({ probe: probe(), userCap: 12 });
		expect(profile).toMatchObject({
			mode: "explicit-cap",
			userCap: 12,
			effectiveLimit: 12,
			limitingBounds: ["user-cap"],
		});
	});
});
