import { Schema } from "effect"

/**
 * Durable identity for one fault-cell execution. Everything else the runner observes
 * (pids, socket paths, qemu process ids, host addresses) is a host-local observation
 * and is never used as authority.
 */
export const RunIdSchema = Schema.String.pipe(
	Schema.check(Schema.isMinLength(8)),
	Schema.brand("RunId"),
)
export type RunId = Schema.Schema.Type<typeof RunIdSchema>

const RUN_ID_ALPHABET = "0123456789abcdefghjkmnpqrstvwxyz"

/**
 * Builds a lexicographically sortable RunId from a wall clock instant plus caller-supplied
 * entropy. Entropy is an argument rather than an ambient read so a scenario seed can make
 * the identity of a rerun reproducible.
 */
export function makeRunId(epochMs: number, entropy: Uint8Array): RunId {
	let stamp = ""
	let remaining = Math.trunc(epochMs)
	for (let index = 0; index < 10; index += 1) {
		stamp = `${RUN_ID_ALPHABET[remaining % 32] ?? "0"}${stamp}`
		remaining = Math.floor(remaining / 32)
	}
	let suffix = ""
	for (const byte of entropy) {
		suffix += RUN_ID_ALPHABET[byte % 32] ?? "0"
	}
	return `${stamp}${suffix}` as RunId
}

/** Logical process role inside a cell. Stable across restarts; a pid is not. */
export type ProcessName = string
/** Named synchronisation point emitted by a workload. */
export type BarrierName = string
/** Scratch filesystem declared by a scenario topology. */
export type MountName = string
/** Guest network interface declared by a scenario topology. */
export type LinkName = string
/** Named typed telemetry read. */
export type ProbeName = string
/** Named SQLite lock hold. */
export type HoldName = string
