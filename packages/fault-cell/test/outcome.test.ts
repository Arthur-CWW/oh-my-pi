import { describe, expect, test } from "bun:test"
import { decideOutcome, type InvariantRecord } from "../src/manifest"
import { Observation } from "../src/observation"
import { sqliteAtomicityScenario } from "../scenarios/sqlite-atomicity"
import type { RunId } from "../src/ids"

const record = (name: string, outcome: InvariantRecord["outcome"]): InvariantRecord => ({
	name,
	description: name,
	role: "invariant",
	outcome,
})

describe("run outcome", () => {
	test("missing telemetry fails the run even with no other violation", () => {
		expect(
			decideOutcome(
				[
					record("a", { _tag: "Satisfied", detail: "ok" }),
					record("b", { _tag: "Missing", detail: "probe absent" }),
				],
				null,
			),
		).toBe("failed")
	})

	test("a run with zero evaluated invariants cannot pass", () => {
		expect(decideOutcome([], null)).toBe("failed")
	})

	test("a step failure fails the run even when every invariant is satisfied", () => {
		expect(
			decideOutcome([record("a", { _tag: "Satisfied", detail: "ok" })], {
				tag: "CellTimeoutError",
				summary: "barrier never arrived",
				fields: {},
			}),
		).toBe("failed")
	})

	test("all satisfied invariants and no failure passes", () => {
		expect(decideOutcome([record("a", { _tag: "Satisfied", detail: "ok" })], null)).toBe("passed")
	})
})

const emptyObservation = new Observation({
	runId: "0000000000abcdef" as RunId,
	seed: 1,
	barriers: [],
	exits: [],
	processes: [],
	faults: [],
	probes: new Map(),
	artifacts: [],
})

describe("scenario invariants without telemetry", () => {
	test("every declared invariant reports Missing or Violated, never Satisfied", () => {
		for (const invariant of sqliteAtomicityScenario.invariants) {
			const outcome = invariant.evaluate(emptyObservation)
			expect(outcome._tag).not.toBe("Satisfied")
		}
	})

	test("the negative control is satisfied only when the faults never happened", () => {
		const [control] = sqliteAtomicityScenario.negativeControls
		expect(control).toBeDefined()
		expect(control?.evaluate(emptyObservation)._tag).toBe("Satisfied")
	})
})
