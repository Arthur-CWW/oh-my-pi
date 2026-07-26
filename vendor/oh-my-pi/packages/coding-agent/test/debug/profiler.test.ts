import { describe, expect, it } from "bun:test";
import { formatProfileAsMarkdown, startCpuProfile } from "@oh-my-pi/pi-coding-agent/debug/profiler";

function profileWithNodeCount(nodeCount: number): string {
	return JSON.stringify({
		nodes: Array.from({ length: nodeCount }, (_, index) => ({
			id: index + 1,
			callFrame: {
				functionName: `fn${index + 1}`,
				url: "file:///profile.ts",
				lineNumber: index + 1,
			},
		})),
		samples: Array.from({ length: nodeCount }, (_, index) => index + 1),
		timeDeltas: Array.from({ length: nodeCount }, () => 1_000),
	});
}

describe("CPU profiler", () => {
	it("uses the full profile for totals and percentages before top-30 slicing", () => {
		const markdown = formatProfileAsMarkdown(profileWithNodeCount(31));

		expect(markdown).toContain("Total profiled time: 31.0ms");
		expect(markdown).toContain("| fn1 | 1.0 | 3.2% | file:///profile.ts:1 |");
		expect(markdown).not.toContain("| fn31 |");
	});

	it("automatically expires and produces a real inspector profile", async () => {
		const session = await startCpuProfile({ durationMs: 20 });
		await session.expired;

		const profile = await session.stop();
		const data = JSON.parse(profile.data) as { nodes?: unknown[] };
		expect(data.nodes?.length).toBeGreaterThan(0);
		expect(profile.markdown).toStartWith("# CPU Profile Summary");
	});

	it("returns one stop operation and result across racing and repeated calls", async () => {
		const session = await startCpuProfile({ durationMs: 5_000 });
		const firstStop = session.stop();
		const racingStop = session.stop();

		expect(racingStop).toBe(firstStop);
		const firstProfile = await firstStop;
		expect(await racingStop).toBe(firstProfile);
		expect(await session.stop()).toBe(firstProfile);
	});
});
