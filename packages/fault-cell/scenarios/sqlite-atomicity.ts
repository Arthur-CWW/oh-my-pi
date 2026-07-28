import { dirname, join } from "node:path"
import { fileURLToPath } from "node:url"
import { numberCell, type Observation, stringCell } from "../src/observation"
import { missing, satisfied, type ScenarioDefinition, violated } from "../src/scenario"

/**
 * Worked example: a two-process SQLite ledger, deliberately not an OMP workload.
 *
 * It exists to prove the fault layer is reusable by any application. The cell knows nothing
 * about SQLite; the scenario knows nothing about qemu. The contract between them is the
 * declarative plan plus decoded probe rows.
 */

const here = dirname(fileURLToPath(import.meta.url))
const PAYLOAD_DIR = join(here, "sqlite-atomicity")

const DATA_MOUNT = "data"
const LEDGER_DB = "/data/ledger.db"
/** Status lives outside the scratch mount so ENOSPC on /data cannot erase the evidence. */
const STATUS_DB = "/var/lib/faultcell-status/status.db"
const LEAVE_FREE_BYTES = 64 * 1024
const SQLITE_FULL = 13

const BATCH_HEALTH_SQL =
	"SELECT (SELECT count(*) FROM batches b WHERE b.rows <> " +
	"(SELECT count(*) FROM ledger l WHERE l.batch = b.batch)) AS torn, " +
	"(SELECT count(*) FROM ledger WHERE batch NOT IN (SELECT batch FROM batches)) AS orphans, " +
	"(SELECT count(*) FROM batches) AS committed, " +
	"(SELECT count(*) FROM ledger) AS rows"

export const sqliteAtomicityScenario: ScenarioDefinition = {
	id: "sqlite-atomicity",
	version: "1.0.0",
	description:
		"A SQLite writer and verifier prove batch atomicity across a real SIGKILL at a named barrier and a real ENOSPC on a quota-bounded ext4 mount.",
	guestPayloadDir: PAYLOAD_DIR,
	cell: {
		memoryMiB: 2048,
		cores: 2,
		diskMiB: 3072,
		timeZone: "UTC",
		guestPackages: ["sqlite"],
		kernelModules: ["sch_netem"],
		mounts: [{ name: DATA_MOUNT, path: "/data", quotaMiB: 64, fs: "ext4" }],
		links: [{ name: "primary", guestInterface: "eth0" }],
	},
	plan: ({ seed }) => {
		const writer = {
			name: "writer",
			argv: [
				"python3",
				"/etc/faultcell/payload/workload.py",
				"write",
				"--db",
				LEDGER_DB,
				"--status",
				STATUS_DB,
				"--rows",
				String(24 + (seed % 8)),
				"--payload-bytes",
				"512",
				"--steady-every",
				"5",
				"--commit-delay-ms",
				"20",
			],
			cwd: "/",
			env: {},
			tz: null,
		}
		const reader = {
			name: "reader",
			argv: [
				"python3",
				"/etc/faultcell/payload/workload.py",
				"verify",
				"--db",
				LEDGER_DB,
				"--status",
				STATUS_DB,
			],
			cwd: "/",
			env: {},
			tz: null,
		}
		return {
			processes: [writer, reader],
			steps: [
				{ _tag: "Start", process: "writer" },
				{ _tag: "WaitForBarrier", barrier: "writer:steady", occurrence: 1, timeoutMs: 60_000 },
				{ _tag: "Probe", probe: "ledger-at-kill" },
				{ _tag: "Signal", process: "writer", signal: "SIGKILL" },
				{ _tag: "WaitForExit", process: "writer", timeoutMs: 30_000 },
				{ _tag: "Probe", probe: "ledger-after-kill" },
				{ _tag: "Restart", process: "writer" },
				{ _tag: "WaitForBarrier", barrier: "writer:resumed", occurrence: 1, timeoutMs: 60_000 },
				{ _tag: "Probe", probe: "ledger-after-resume" },
				{ _tag: "FillFilesystem", mount: DATA_MOUNT, leaveFreeBytes: LEAVE_FREE_BYTES },
				{ _tag: "WaitForBarrier", barrier: "writer:enospc", occurrence: 1, timeoutMs: 120_000 },
				{ _tag: "WaitForExit", process: "writer", timeoutMs: 30_000 },
				{ _tag: "ReleaseFilesystem", mount: DATA_MOUNT },
				{ _tag: "Start", process: "reader" },
				{ _tag: "WaitForExit", process: "reader", timeoutMs: 120_000 },
				{ _tag: "Probe", probe: "ledger-final" },
				{ _tag: "Probe", probe: "integrity" },
				{ _tag: "Probe", probe: "writer-status" },
			],
			probes: [
				{ _tag: "Sqlite", name: "ledger-at-kill", path: LEDGER_DB, sql: BATCH_HEALTH_SQL, params: [] },
				{
					_tag: "Sqlite",
					name: "ledger-after-kill",
					path: LEDGER_DB,
					sql: BATCH_HEALTH_SQL,
					params: [],
				},
				{
					_tag: "Sqlite",
					name: "ledger-after-resume",
					path: LEDGER_DB,
					sql: BATCH_HEALTH_SQL,
					params: [],
				},
				{ _tag: "Sqlite", name: "ledger-final", path: LEDGER_DB, sql: BATCH_HEALTH_SQL, params: [] },
				{
					_tag: "Sqlite",
					name: "integrity",
					path: LEDGER_DB,
					sql: "PRAGMA integrity_check",
					params: [],
				},
				{
					_tag: "Sqlite",
					name: "writer-status",
					path: STATUS_DB,
					sql: "SELECT incarnation, phase, sqlite_errno, sqlite_message, batches_committed, exit_code FROM status ORDER BY id",
					params: [],
				},
			],
			artifacts: [LEDGER_DB, STATUS_DB],
		}
	},
	invariants: [
		{
			name: "committed-batches-are-complete",
			description:
				"Every batch recorded in `batches` has exactly the row count it recorded, after both faults.",
			evaluate: (observation) => {
				const row = observation.rows("ledger-final")?.[0]
				const torn = numberCell(row, "torn")
				if (torn === undefined) return missing("probe ledger-final produced no `torn` count")
				return torn === 0
					? satisfied(`no torn batches across ${numberCell(row, "committed") ?? 0} commits`)
					: violated(`${torn} committed batches have a mismatched row count`)
			},
		},
		{
			name: "no-orphan-rows",
			description: "No ledger row survives from a transaction that never committed its batch.",
			evaluate: (observation) => {
				const orphans = numberCell(observation.rows("ledger-final")?.[0], "orphans")
				if (orphans === undefined) return missing("probe ledger-final produced no `orphans` count")
				return orphans === 0
					? satisfied("no rows belong to an uncommitted batch")
					: violated(`${orphans} rows belong to an uncommitted batch`)
			},
		},
		{
			name: "database-integrity-ok",
			description: "PRAGMA integrity_check reports ok after SIGKILL and ENOSPC.",
			evaluate: (observation) => {
				const rows = observation.rows("integrity")
				if (rows === undefined || rows.length === 0) return missing("probe integrity returned nothing")
				const verdict = stringCell(rows[0], "integrity_check")
				if (verdict === undefined) return missing("integrity_check column absent")
				return verdict === "ok" ? satisfied("integrity_check = ok") : violated(verdict)
			},
		},
		{
			name: "writer-killed-at-named-barrier",
			description:
				"The first writer incarnation died from a real SIGKILL delivered after the steady barrier.",
			evaluate: (observation) => {
				const barrier = observation.barrierAt("writer:steady", 1)
				if (barrier === undefined) return missing("barrier writer:steady#1 was never observed")
				const killed = observation
					.exitsOf("writer")
					.find((exit) => exit.termSignal === "SIGKILL" && exit.incarnation === 1)
				if (killed === undefined) return violated("no writer incarnation exited on SIGKILL")
				return killed.wallMs >= barrier.wallMs
					? satisfied(`writer pid ${killed.pid} killed after ${barrier.name}#1`)
					: violated("the SIGKILL exit precedes the barrier it was supposed to follow")
			},
		},
		{
			name: "writer-made-progress-after-restart",
			description:
				"The restarted writer resumed from the committed prefix and committed strictly more batches.",
			evaluate: (observation) => {
				const before = numberCell(observation.rows("ledger-at-kill")?.[0], "committed")
				const after = numberCell(observation.rows("ledger-after-resume")?.[0], "committed")
				if (before === undefined || after === undefined) {
					return missing("kill-time or resume-time committed batch count is absent")
				}
				const incarnations = observation.exitsOf("writer").length
				if (incarnations < 2) return violated(`writer only produced ${incarnations} incarnation(s)`)
				return after > before
					? satisfied(`committed batches ${before} -> ${after} across the restart`)
					: violated(`no progress after restart: ${before} -> ${after}`)
			},
		},
		{
			name: "enospc-surfaced-as-sqlite-full",
			description:
				"The injected ENOSPC produced SQLITE_FULL in the application and the declared exit code 28.",
			evaluate: (observation) => {
				const rows = observation.rows("writer-status")
				if (rows === undefined) return missing("probe writer-status returned nothing")
				const failure = rows.find((row) => stringCell(row, "phase") === "write-failed")
				if (failure === undefined) return violated("the writer never reported a failed write")
				const code = numberCell(failure, "sqlite_errno")
				const exitCode = numberCell(failure, "exit_code")
				if (code === undefined || exitCode === undefined) {
					return missing("writer-status rows lack sqlite_errno or exit_code")
				}
				if (code !== SQLITE_FULL) return violated(`expected SQLITE_FULL (13), observed ${code}`)
				const observedExit = observation
					.exitsOf("writer")
					.find((exit) => exit.exitCode === 28)
				if (observedExit === undefined) {
					return violated("no writer incarnation exited with the declared ENOSPC code 28")
				}
				return satisfied(`SQLITE_FULL reported and exit code ${observedExit.exitCode}`)
			},
		},
		{
			name: "enospc-fault-was-actually-applied",
			description:
				"The runner measured free space on the scratch mount collapsing to the requested headroom.",
			evaluate: (observation) => {
				const fault = observation.faultsTagged("FillFilesystem")[0]
				if (fault === undefined) return missing("no FillFilesystem fault was recorded")
				const before = fault.observed.freeBytesBefore
				const after = fault.observed.freeBytesAfter
				if (typeof before !== "number" || typeof after !== "number") {
					return missing("FillFilesystem telemetry lacks free-space measurements")
				}
				if (before <= LEAVE_FREE_BYTES) {
					return violated(`mount was already full before injection (${before} bytes free)`)
				}
				return after <= LEAVE_FREE_BYTES
					? satisfied(`free space ${before} -> ${after} bytes`)
					: violated(`free space only fell to ${after} bytes`)
			},
		},
		{
			name: "verifier-accepted-the-ledger",
			description: "The independent reader process exited 0 after checking the ledger itself.",
			evaluate: (observation) => {
				const exit = observation.exitsOf("reader")[0]
				if (exit === undefined) return missing("the reader never exited")
				return exit.exitCode === 0
					? satisfied("reader verified the ledger in-guest")
					: violated(`reader exited ${exit.exitCode ?? "on " + String(exit.termSignal)}`)
			},
		},
	],
	negativeControls: [
		{
			name: "negative-control:writer-was-never-interrupted",
			description:
				"Deliberately false: asserts the writer ran to completion untouched. A harness that cannot fail will report this as satisfied.",
			evaluate: (observation) => {
				const kills = observation.exitsOf("writer").filter((exit) => exit.termSignal !== null)
				return kills.length === 0
					? satisfied("writer was never signalled")
					: violated(`writer was signalled ${kills.length} time(s), as the scenario intended`)
			},
		},
	],
}
