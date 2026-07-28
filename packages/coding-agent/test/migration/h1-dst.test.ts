import { describe, expect, it } from "bun:test";
import {
	H1_DELIVERY_BOUND,
	h1CheckTrace,
	h1Step,
	type H1Event,
	type H1Snapshot,
} from "./model/h1-model";
import {
	runH1Dst,
	type H1DstFaultStats,
	type H1FaultProfile,
} from "./h1-dst-driver";

const PROFILES: readonly H1FaultProfile[] = ["clean", "lossy-pipe", "kill-happy", "race-heavy"];

function sequenceEvent(kind: string, seq: number, at: number, cause?: string): H1Event {
	if (cause === undefined) return { kind, childId: "unit-child", seq, at };
	return { kind, childId: "unit-child", seq, at, cause };
}

function parseInteger(value: string | undefined, fallback: number): number {
	if (value === undefined || value.trim() === "") return fallback;
	const parsed = Number(value);
	return Number.isInteger(parsed) && parsed > 0 ? parsed : fallback;
}

function selectedSeeds(): readonly number[] {
	const exact = process.env.OMP_DST_SEED;
	if (exact !== undefined) return [parseInteger(exact, 1)];
	const widened = process.env.OMP_DST_SEEDS;
	if (widened === undefined) return Array.from({ length: 300 }, (_, index) => index + 1);
	if (widened.includes("-")) {
		const [first, last] = widened.split("-", 2).map(part => parseInteger(part, 1));
		const start = Math.min(first!, last!);
		const end = Math.max(first!, last!);
		return Array.from({ length: end - start + 1 }, (_, index) => start + index);
	}
	if (widened.includes(",")) {
		return widened
			.split(",")
			.map(value => parseInteger(value, 1))
			.filter((value, index, values) => values.indexOf(value) === index);
	}
	const end = parseInteger(widened, 300);
	return Array.from({ length: end }, (_, index) => index + 1);
}

function statsTotal(stats: H1DstFaultStats): number {
	return Object.values(stats).reduce((total, count) => total + count, 0);
}

function printViolation(seed: number, profile: H1FaultProfile, trace: readonly H1Event[], detail: string): void {
	process.stdout.write(`H1 DST violation seed=${seed} profile=${profile} ${detail}\n`);
	process.stdout.write(`${JSON.stringify(trace)}\n`);
}

function hasInvariant(violations: readonly { invariant: string }[], invariant: string): boolean {
	return violations.some(violation => violation.invariant === invariant);
}

describe("H1 child lifecycle deterministic simulation", () => {
	it("conforms to the frozen interface and rejects representative invariant violations", () => {
		const initial: H1Snapshot = { state: "spawned", seq: 0, journal: [] };
		const admitted = h1Step(initial, sequenceEvent("admitted", 1, 0));
		expect(admitted.ok).toBe(true);
		if (!admitted.ok) return;
		const started = h1Step(admitted.next, sequenceEvent("started", 2, 0));
		expect(started.ok).toBe(true);
		if (!started.ok) return;
		const yielded = h1Step(started.next, sequenceEvent("yieldWritten", 3, 1));
		expect(yielded.ok).toBe(true);
		expect(
			h1CheckTrace([
				sequenceEvent("admitted", 1, 0),
				sequenceEvent("started", 2, 0),
				sequenceEvent("yieldWritten", 3, 1),
				sequenceEvent("timeoutFired", 4, 2),
			]),
		).toSatisfy(violations => hasInvariant(violations, "I3"));
		expect(
			h1CheckTrace([
				sequenceEvent("admitted", 1, 0),
				sequenceEvent("started", 2, 0),
				sequenceEvent("yieldWritten", 3, 1),
				sequenceEvent("crashed", 4, 2),
			]),
		).toSatisfy(violations => hasInvariant(violations, "I2"));
		expect(
			h1CheckTrace([
				sequenceEvent("admitted", 1, 0),
				sequenceEvent("started", 2, 0),
				sequenceEvent("yieldWritten", 3, 1),
				sequenceEvent("delivered", 4, 1, "outcome=result"),
				sequenceEvent("delivered", 5, 1, "outcome=result"),
			]),
		).toSatisfy(violations => hasInvariant(violations, "I1"));
		expect(
			h1CheckTrace([
				sequenceEvent("admitted", 1, 0),
				sequenceEvent("started", 3, 0),
				sequenceEvent("progress", 2, 0),
			]),
		).toSatisfy(violations => hasInvariant(violations, "I6"));
		expect(
			h1CheckTrace([
				sequenceEvent("admitted", 1, 0),
				sequenceEvent("started", 2, 0),
				sequenceEvent("yieldWritten", 3, 1),
				sequenceEvent("wallClockTick", 4, 10),
			]),
		).toSatisfy(violations => hasInvariant(violations, "I5"));
		expect(
			h1CheckTrace([
				sequenceEvent("admitted", 1, 0),
				sequenceEvent("started", 2, 0),
				sequenceEvent("yieldWritten", 3, 0),
				sequenceEvent("parentPoll", 4, 9, "receipt=running"),
			]),
		).toSatisfy(violations => hasInvariant(violations, "I9"));
		expect(
			h1CheckTrace([
				sequenceEvent("admitted", 1, 0),
				sequenceEvent("started", 2, 0),
				sequenceEvent("message:yieldWritten", 3, 1),
				sequenceEvent("delivered", 4, 1, "outcome=result"),
			]),
		).toSatisfy(violations => hasInvariant(violations, "I4"));
		expect(H1_DELIVERY_BOUND).toBeGreaterThan(0);
	});

	it("explores the fixed seed range against every fault profile", () => {
		const seeds = selectedSeeds();
		const verbose = process.env.OMP_DST_SEED !== undefined;
		const counts = new Map<string, number>();
		let runs = 0;
		let faultInterventions = 0;
		const startedAt = performance.now();
		for (const seed of seeds) {
			for (const profile of PROFILES) {
				runs += 1;
				const result = runH1Dst({ seed, profile });
				faultInterventions += statsTotal(result.faultStats);
				for (const violation of result.violations) {
					counts.set(violation.invariant, (counts.get(violation.invariant) ?? 0) + 1);
					printViolation(seed, profile, result.shrunkTrace, `invariant=${violation.invariant} detail=${violation.detail}`);
				}
				if (verbose) {
					process.stdout.write(
						`H1 DST seed=${seed} profile=${profile} events=${result.trace.length} faults=${statsTotal(result.faultStats)}\n`,
					);
				}
				expect(result.violations, `${profile} seed ${seed} violated H1`).toEqual([]);
			}
		}
		const elapsed = performance.now() - startedAt;
		if (verbose || process.env.OMP_DST_SEEDS !== undefined) {
			process.stdout.write(
				`H1 DST audit seeds=${seeds.length} profiles=${PROFILES.length} runs=${runs} faultInterventions=${faultInterventions} runtimeMs=${elapsed.toFixed(1)} violations=${JSON.stringify(Object.fromEntries(counts))}\n`,
			);
		}
		expect(runs).toBe(seeds.length * PROFILES.length);
		expect(elapsed).toBeLessThan(30_000);
	});
});
