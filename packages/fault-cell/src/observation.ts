import { Schema } from "effect"
import type { RunId } from "./ids"
import {
	type BarrierEvent,
	type CollectedArtifact,
	type FileProbeResult,
	type JsonValue,
	JsonValueSchema,
	type ObservedProcess,
	type ProcessExit,
	type SqliteProbeResult,
} from "./protocol"

/** A fault injection plus the measurement that proves it landed. */
export const AppliedFaultSchema = Schema.Struct({
	stepIndex: Schema.Int,
	tag: Schema.String,
	target: Schema.String,
	requested: Schema.Record(Schema.String, JsonValueSchema),
	observed: Schema.Record(Schema.String, JsonValueSchema),
	wallMs: Schema.Number,
})
export type AppliedFault = Schema.Schema.Type<typeof AppliedFaultSchema>

export const ArtifactRecordSchema = Schema.Struct({
	guestPath: Schema.String,
	hostPath: Schema.String,
	relPath: Schema.String,
	bytes: Schema.Int,
	guestSha256: Schema.String,
	hostSha256: Schema.String,
	intact: Schema.Boolean,
})
export type ArtifactRecord = Schema.Schema.Type<typeof ArtifactRecordSchema>

export type ProbeValue =
	| { readonly _tag: "Sqlite"; readonly value: SqliteProbeResult }
	| { readonly _tag: "File"; readonly value: FileProbeResult }
	| { readonly _tag: "ProcessTable"; readonly value: readonly ObservedProcess[] }

export interface ObservationInput {
	readonly runId: RunId
	readonly seed: number
	readonly barriers: readonly BarrierEvent[]
	readonly exits: readonly ProcessExit[]
	readonly processes: readonly ObservedProcess[]
	readonly faults: readonly AppliedFault[]
	readonly probes: ReadonlyMap<string, ProbeValue>
	readonly artifacts: readonly ArtifactRecord[]
}

export type SqliteRow = { readonly [column: string]: JsonValue }

/**
 * Read-only, fully decoded view of one run, and the only thing an invariant ever sees.
 *
 * Every accessor returns `undefined` for telemetry that was never produced so an invariant
 * can report `Missing` explicitly. Nothing here can execute a command.
 */
export class Observation {
	readonly runId: RunId
	readonly seed: number
	readonly barriers: readonly BarrierEvent[]
	readonly exits: readonly ProcessExit[]
	readonly processes: readonly ObservedProcess[]
	readonly faults: readonly AppliedFault[]
	readonly artifacts: readonly ArtifactRecord[]
	readonly #probes: ReadonlyMap<string, ProbeValue>

	constructor(input: ObservationInput) {
		this.runId = input.runId
		this.seed = input.seed
		this.barriers = input.barriers
		this.exits = input.exits
		this.processes = input.processes
		this.faults = input.faults
		this.artifacts = input.artifacts
		this.#probes = input.probes
	}

	barriersNamed(name: string): readonly BarrierEvent[] {
		return this.barriers.filter((event) => event.name === name)
	}

	barrierAt(name: string, occurrence: number): BarrierEvent | undefined {
		return this.barriersNamed(name)[occurrence - 1]
	}

	exitsOf(process: string): readonly ProcessExit[] {
		return this.exits.filter((exit) => exit.process === process)
	}

	incarnationsOf(process: string): readonly ObservedProcess[] {
		return this.processes.filter((entry) => entry.process === process)
	}

	faultsTagged(tag: string): readonly AppliedFault[] {
		return this.faults.filter((fault) => fault.tag === tag)
	}

	probe(name: string): ProbeValue | undefined {
		return this.#probes.get(name)
	}

	/** Decoded SQLite probe as column-keyed records, or `undefined` when the probe is absent. */
	rows(probeName: string): readonly SqliteRow[] | undefined {
		const probe = this.#probes.get(probeName)
		if (probe === undefined || probe._tag !== "Sqlite") return undefined
		const columns = probe.value.columns
		return probe.value.rows.map((row) => {
			const record: Record<string, JsonValue> = {}
			for (let index = 0; index < columns.length; index += 1) {
				const column = columns[index]
				if (column === undefined) continue
				record[column] = row[index] ?? null
			}
			return record
		})
	}

	file(probeName: string): FileProbeResult | undefined {
		const probe = this.#probes.get(probeName)
		return probe !== undefined && probe._tag === "File" ? probe.value : undefined
	}

	artifact(relPath: string): ArtifactRecord | undefined {
		return this.artifacts.find((entry) => entry.relPath === relPath)
	}
}

export function collectedToRecord(
	artifact: CollectedArtifact,
	hostPath: string,
	hostSha256: string,
): ArtifactRecord {
	return {
		guestPath: artifact.guestPath,
		hostPath,
		relPath: artifact.relPath,
		bytes: artifact.bytes,
		guestSha256: artifact.sha256,
		hostSha256,
		intact: artifact.sha256 === hostSha256,
	}
}

/** Narrows a decoded SQLite cell to a finite number, or `undefined` when it is not one. */
export function numberCell(row: SqliteRow | undefined, column: string): number | undefined {
	if (row === undefined) return undefined
	const value = row[column]
	return typeof value === "number" && Number.isFinite(value) ? value : undefined
}

/** Narrows a decoded SQLite cell to a string, or `undefined` when it is not one. */
export function stringCell(row: SqliteRow | undefined, column: string): string | undefined {
	if (row === undefined) return undefined
	const value = row[column]
	return typeof value === "string" ? value : undefined
}
