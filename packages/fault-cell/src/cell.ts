import { Effect, Schema } from "effect"
import { type ChildProcess, spawn } from "node:child_process"
import {
	createWriteStream,
	existsSync,
	mkdirSync,
	readlinkSync,
	rmSync,
	writeFileSync,
} from "node:fs"
import { join } from "node:path"
import { setTimeout as delay } from "node:timers/promises"
import { GuestChannel, GuestReplyFailure, type ResultDecoder } from "./channel"
import {
	CellProvisionError,
	CellTimeoutError,
	ControlChannelError,
	type FaultCellError,
	GuestOperationError,
} from "./errors"
import {
	AckResultSchema,
	type BarrierEvent,
	CgroupCpuResultSchema,
	CgroupMemoryResultSchema,
	type CollectedArtifact,
	CollectResultSchema,
	FileProbeResultSchema,
	FillResultSchema,
	type GuestRequestBody,
	type JsonValue,
	MountInfoSchema,
	NetworkResultSchema,
	type ObservedProcess,
	ObservedProcessSchema,
	type ProcessExit,
	ProcessTableResultSchema,
	ReleaseResultSchema,
	type SignalName,
	SqliteHoldResultSchema,
	SqliteProbeResultSchema,
	TzResultSchema,
} from "./protocol"
import { capture, type ResolvedNixpkgs } from "./provenance"
import type { CellSpec, ProcessSpec } from "./scenario"
import { QmpClient } from "./qmp"

const decoders = {
	ack: Schema.decodeUnknownResult(AckResultSchema),
	mount: Schema.decodeUnknownResult(MountInfoSchema),
	process: Schema.decodeUnknownResult(ObservedProcessSchema),
	tz: Schema.decodeUnknownResult(TzResultSchema),
	memory: Schema.decodeUnknownResult(CgroupMemoryResultSchema),
	cpu: Schema.decodeUnknownResult(CgroupCpuResultSchema),
	fill: Schema.decodeUnknownResult(FillResultSchema),
	release: Schema.decodeUnknownResult(ReleaseResultSchema),
	hold: Schema.decodeUnknownResult(SqliteHoldResultSchema),
	network: Schema.decodeUnknownResult(NetworkResultSchema),
	sqlite: Schema.decodeUnknownResult(SqliteProbeResultSchema),
	file: Schema.decodeUnknownResult(FileProbeResultSchema),
	table: Schema.decodeUnknownResult(ProcessTableResultSchema),
	collect: Schema.decodeUnknownResult(CollectResultSchema),
} as const

function asCellError<Cause>(cause: Cause, context: string): FaultCellError {
	if (cause instanceof GuestReplyFailure) {
		return new GuestOperationError({
			op: cause.op,
			code: cause.code,
			message: cause.message,
			detail: cause.detail,
		})
	}
	if (
		cause instanceof ControlChannelError ||
		cause instanceof CellProvisionError ||
		cause instanceof CellTimeoutError ||
		cause instanceof GuestOperationError
	) {
		return cause
	}
	return new ControlChannelError({
		reason: "protocol",
		message: `${context}: ${cause instanceof Error ? cause.message : String(cause)}`,
	})
}

export interface CellBootOptions {
	/** Isolated directory owning the disk image, sockets, console log, and shared directory. */
	readonly runDir: string
	readonly spec: CellSpec
	readonly nixExprPath: string
	readonly agentPath: string
	readonly payloadDir: string
	readonly nixpkgs: ResolvedNixpkgs
	readonly bootTimeoutMs: number
	readonly defaultRequestTimeoutMs: number
}

export interface CellAcceleration {
	readonly requested: string
	readonly kvmPresent: boolean
	readonly kvmEnabled: boolean
}

interface BarrierWaiter {
	readonly name: string
	readonly occurrence: number
	readonly resolve: (event: BarrierEvent) => void
}

interface ExitWaiter {
	readonly process: string
	readonly resolve: (exit: ProcessExit) => void
}

interface CellInternals {
	readonly channel: GuestChannel
	readonly qmp: QmpClient
	readonly qemu: ChildProcess
	readonly vmStorePath: string
	readonly acceleration: CellAcceleration
	readonly qemuVersion: string
	readonly runDir: string
	readonly timeoutMs: number
	readonly barriers: BarrierEvent[]
	readonly exits: ProcessExit[]
	readonly logLines: string[]
	readonly barrierWaiters: BarrierWaiter[]
	readonly exitWaiters: ExitWaiter[]
}

/**
 * A running disposable NixOS cell and the complete set of scenario operations.
 *
 * The runner owns this object; a scenario never does. Every operation returns a decoded value
 * or a typed error — there is no "run a command and read stdout" verb, which is structurally
 * why a scenario cannot assert success through an untyped check.
 */
export class FaultCell {
	readonly barriers: readonly BarrierEvent[]
	readonly exits: readonly ProcessExit[]
	readonly observedProcesses: ObservedProcess[] = []
	readonly vmStorePath: string
	readonly acceleration: CellAcceleration
	readonly qemuVersion: string
	readonly runDir: string

	readonly #internals: CellInternals

	private constructor(internals: CellInternals) {
		this.#internals = internals
		this.barriers = internals.barriers
		this.exits = internals.exits
		this.vmStorePath = internals.vmStorePath
		this.acceleration = internals.acceleration
		this.qemuVersion = internals.qemuVersion
		this.runDir = internals.runDir
	}

	get agentLog(): readonly string[] {
		return this.#internals.logLines
	}

	static boot = Effect.fn("FaultCell.boot")(function* (options: CellBootOptions) {
		const cell = yield* Effect.tryPromise({
			try: () => FaultCell.#bootAsync(options),
			catch: (cause) => asCellError(cause, "boot"),
		})
		for (const mount of options.spec.mounts) {
			yield* cell.mountScratch(mount.name, mount.path, mount.quotaMiB, mount.fs)
		}
		return cell
	})

	/* ------------------------------------------------------------ topology */

	mountScratch = Effect.fn("FaultCell.mountScratch")(
		(mount: string, path: string, quotaMiB: number, fs: "ext4" | "tmpfs") =>
			this.#call({ op: "mountScratch", mount, path, quotaMiB, fs }, decoders.mount, "mountScratch"),
	)

	/* ----------------------------------------------------------- processes */

	start = Effect.fn("FaultCell.start")((process: ProcessSpec) =>
		this.#call(
			{
				op: "spawn",
				process: process.name,
				argv: process.argv,
				cwd: process.cwd,
				env: process.env,
				tz: process.tz,
			},
			decoders.process,
			`start ${process.name}`,
		).pipe(Effect.tap((observed) => Effect.sync(() => this.observedProcesses.push(observed)))),
	)

	signal = Effect.fn("FaultCell.signal")((process: string, signal: SignalName) =>
		this.#call({ op: "signal", process, signal }, decoders.process, `signal ${process}`),
	)

	setProcessTz = Effect.fn("FaultCell.setProcessTz")((process: string, tz: string) =>
		this.#call({ op: "setProcessTz", process, tz }, decoders.tz, `setProcessTz ${process}`),
	)

	/* -------------------------------------------------------------- faults */

	setCgroupMemory = Effect.fn("FaultCell.setCgroupMemory")((process: string, maxBytes: number) =>
		this.#call(
			{ op: "setCgroupMemory", process, maxBytes },
			decoders.memory,
			`setCgroupMemory ${process}`,
		),
	)

	setCgroupCpu = Effect.fn("FaultCell.setCgroupCpu")((process: string, quotaPercent: number) =>
		this.#call(
			{ op: "setCgroupCpu", process, quotaPercent },
			decoders.cpu,
			`setCgroupCpu ${process}`,
		),
	)

	fillFilesystem = Effect.fn("FaultCell.fillFilesystem")((mount: string, leaveFreeBytes: number) =>
		this.#call(
			{ op: "fillFilesystem", mount, leaveFreeBytes },
			decoders.fill,
			`fillFilesystem ${mount}`,
		),
	)

	releaseFilesystem = Effect.fn("FaultCell.releaseFilesystem")((mount: string) =>
		this.#call(
			{ op: "releaseFilesystem", mount },
			decoders.release,
			`releaseFilesystem ${mount}`,
		),
	)

	sqliteLockHold = Effect.fn("FaultCell.sqliteLockHold")(
		(hold: string, path: string, mode: "shared" | "reserved" | "exclusive") =>
			this.#call({ op: "sqliteLockHold", hold, path, mode }, decoders.hold, "sqliteLockHold"),
	)

	sqliteLockRelease = Effect.fn("FaultCell.sqliteLockRelease")((hold: string) =>
		this.#call({ op: "sqliteLockRelease", hold }, decoders.hold, "sqliteLockRelease"),
	)

	networkPartition = Effect.fn("FaultCell.networkPartition")((link: string) =>
		this.#call({ op: "networkPartition", link }, decoders.network, `networkPartition ${link}`),
	)

	networkDelay = Effect.fn("FaultCell.networkDelay")(
		(link: string, delayMs: number, jitterMs: number) =>
			this.#call(
				{ op: "networkDelay", link, delayMs, jitterMs },
				decoders.network,
				`networkDelay ${link}`,
			),
	)

	networkReset = Effect.fn("FaultCell.networkReset")((link: string) =>
		this.#call({ op: "networkReset", link }, decoders.network, `networkReset ${link}`),
	)

	/* ----------------------------------------------------------- telemetry */

	probeSqlite = Effect.fn("FaultCell.probeSqlite")(
		(path: string, sql: string, params: readonly JsonValue[]) =>
			this.#call({ op: "probeSqlite", path, sql, params }, decoders.sqlite, `probeSqlite ${path}`),
	)

	probeFile = Effect.fn("FaultCell.probeFile")((path: string, includeText: boolean) =>
		this.#call({ op: "probeFile", path, includeText }, decoders.file, `probeFile ${path}`),
	)

	processTable = Effect.fn("FaultCell.processTable")(() =>
		this.#call({ op: "processTable" }, decoders.table, "processTable"),
	)

	collectArtifacts = Effect.fn("FaultCell.collectArtifacts")(
		(paths: readonly string[], into: string) =>
			this.#call({ op: "collectArtifacts", paths, into }, decoders.collect, "collectArtifacts"),
	)

	/* --------------------------------------------------------------- waits */

	waitForBarrier = Effect.fn("FaultCell.waitForBarrier")(
		(name: string, occurrence: number, timeoutMs: number) =>
			Effect.tryPromise({
				try: () => this.#awaitBarrier(name, occurrence, timeoutMs),
				catch: (cause) => asCellError(cause, `waitForBarrier ${name}`),
			}),
	)

	waitForExit = Effect.fn("FaultCell.waitForExit")((process: string, timeoutMs: number) =>
		Effect.tryPromise({
			try: () => this.#awaitExit(process, timeoutMs),
			catch: (cause) => asCellError(cause, `waitForExit ${process}`),
		}),
	)

	/* ----------------------------------------------------------- lifecycle */

	teardown = Effect.fn("FaultCell.teardown")(() =>
		Effect.promise(async () => {
			const { channel, qmp, qemu } = this.#internals
			try {
				await channel.request({ op: "shutdown" }, decoders.ack, 5_000)
			} catch {
				// A cell that cannot acknowledge shutdown is still torn down below.
			}
			channel.close()
			qmp.close()
			qemu.kill("SIGTERM")
			const deadline = Date.now() + 10_000
			while (qemu.exitCode === null && qemu.signalCode === null) {
				if (Date.now() > deadline) {
					qemu.kill("SIGKILL")
					break
				}
				await delay(100)
			}
			rmSync(join(this.runDir, "state"), { recursive: true, force: true })
		}),
	)

	/* ------------------------------------------------------------- private */

	#call<A>(
		body: GuestRequestBody,
		decode: ResultDecoder<A>,
		context: string,
	): Effect.Effect<A, FaultCellError> {
		return Effect.tryPromise({
			try: () => this.#internals.channel.request(body, decode, this.#internals.timeoutMs),
			catch: (cause) => asCellError(cause, context),
		})
	}

	#awaitBarrier(name: string, occurrence: number, timeoutMs: number): Promise<BarrierEvent> {
		const { barriers, barrierWaiters } = this.#internals
		const already = barriers.filter((event) => event.name === name)[occurrence - 1]
		if (already !== undefined) return Promise.resolve(already)
		const { promise, resolve, reject } = Promise.withResolvers<BarrierEvent>()
		const waiter: BarrierWaiter = { name, occurrence, resolve }
		barrierWaiters.push(waiter)
		const timer = setTimeout(() => {
			const index = barrierWaiters.indexOf(waiter)
			if (index >= 0) barrierWaiters.splice(index, 1)
			reject(
				new CellTimeoutError({
					waitingFor: `barrier ${name}#${occurrence}`,
					timeoutMs,
					observed:
						barriers.map((event) => `${event.name}#${event.occurrence}`).join(",") ||
						"no barriers observed",
				}),
			)
		}, timeoutMs)
		return promise.finally(() => clearTimeout(timer))
	}

	#awaitExit(process: string, timeoutMs: number): Promise<ProcessExit> {
		const { exits, exitWaiters } = this.#internals
		const pending = exitWaiters.filter((waiter) => waiter.process === process).length
		const already = exits.filter((exit) => exit.process === process)[pending]
		if (already !== undefined) return Promise.resolve(already)
		const { promise, resolve, reject } = Promise.withResolvers<ProcessExit>()
		const waiter: ExitWaiter = { process, resolve }
		exitWaiters.push(waiter)
		const timer = setTimeout(() => {
			const index = exitWaiters.indexOf(waiter)
			if (index >= 0) exitWaiters.splice(index, 1)
			reject(
				new CellTimeoutError({
					waitingFor: `exit ${process}`,
					timeoutMs,
					observed: exits.map((exit) => exit.process).join(",") || "no exits observed",
				}),
			)
		}, timeoutMs)
		return promise.finally(() => clearTimeout(timer))
	}

	static async #bootAsync(options: CellBootOptions): Promise<FaultCell> {
		const { runDir } = options
		const stateDir = join(runDir, "state")
		const sharedDir = join(runDir, "shared")
		const tmpDir = join(runDir, "tmp")
		for (const directory of [runDir, stateDir, sharedDir, tmpDir, join(tmpDir, "xchg")]) {
			mkdirSync(directory, { recursive: true })
		}

		const specFile = join(runDir, "cell-spec.json")
		writeFileSync(specFile, `${JSON.stringify(options.spec, null, 2)}\n`, "utf8")

		const outLink = join(runDir, "vm")
		const build = capture([
			"nix",
			"build",
			"--impure",
			"--file",
			options.nixExprPath,
			"--argstr",
			"nixpkgs",
			options.nixpkgs.storePath,
			"--argstr",
			"specFile",
			specFile,
			"--argstr",
			"agentFile",
			options.agentPath,
			"--argstr",
			"payloadDir",
			options.payloadDir,
			"--out-link",
			outLink,
		])
		if (!build.ok) {
			throw new CellProvisionError({
				phase: "nix-build",
				message: "nix could not build the fault cell",
				detail: build.stderr.trim().slice(-4096),
			})
		}
		const vmStorePath = readlinkSync(outLink)

		const controlSocket = join(runDir, "control.sock")
		const qmpSocket = join(runDir, "qmp.sock")
		const consoleLog = createWriteStream(join(runDir, "console.log"), { flags: "a" })
		const runner = join(outLink, "bin", "run-fault-cell-vm")
		if (!existsSync(runner)) {
			throw new CellProvisionError({
				phase: "launch",
				message: `built cell does not expose ${runner}`,
			})
		}

		const qemu = spawn(runner, [], {
			cwd: runDir,
			stdio: ["ignore", "pipe", "pipe"],
			env: {
				...process.env,
				TMPDIR: tmpDir,
				USE_TMPDIR: "1",
				SHARED_DIR: sharedDir,
				NIX_DISK_IMAGE: join(stateDir, "root.qcow2"),
				FAULT_CELL_CONTROL_SOCKET: controlSocket,
				FAULT_CELL_QMP_SOCKET: qmpSocket,
			},
		})
		qemu.stdout?.pipe(consoleLog)
		qemu.stderr?.pipe(consoleLog)

		const deadline = Date.now() + options.bootTimeoutMs
		while (!existsSync(controlSocket) || !existsSync(qmpSocket)) {
			if (qemu.exitCode !== null) {
				throw new CellProvisionError({
					phase: "launch",
					message: `qemu exited with ${qemu.exitCode} before exposing its control sockets`,
					detail: `see ${join(runDir, "console.log")}`,
				})
			}
			if (Date.now() > deadline) {
				qemu.kill("SIGKILL")
				throw new CellProvisionError({
					phase: "launch",
					message: "qemu did not expose its control sockets before the boot deadline",
				})
			}
			await delay(100)
		}

		const qmp = await QmpClient.connect(qmpSocket, 10_000)
		await qmp.handshake(10_000)
		const kvm = await qmp.queryKvm(10_000)
		const version = qmp.qemuVersion
		const qemuVersion =
			version === undefined
				? "unknown"
				: `${version.qemu.major}.${version.qemu.minor}.${version.qemu.micro}${version.package}`

		const barriers: BarrierEvent[] = []
		const exits: ProcessExit[] = []
		const logLines: string[] = []
		const barrierWaiters: BarrierWaiter[] = []
		const exitWaiters: ExitWaiter[] = []

		const channel = await GuestChannel.connect(
			controlSocket,
			{
				onBarrier: (event) => {
					barriers.push(event)
					const index = barrierWaiters.findIndex(
						(waiter) => waiter.name === event.name && waiter.occurrence === event.occurrence,
					)
					if (index >= 0) barrierWaiters.splice(index, 1)[0]?.resolve(event)
				},
				onExit: (exit) => {
					exits.push(exit)
					const index = exitWaiters.findIndex((waiter) => waiter.process === exit.process)
					if (index >= 0) exitWaiters.splice(index, 1)[0]?.resolve(exit)
				},
				onLog: (event) => {
					logLines.push(`[${event.level}] ${event.message}`)
				},
			},
			Math.max(1_000, deadline - Date.now()),
		)

		const readyDeadline = Date.now() + options.bootTimeoutMs
		while (channel.ready === undefined) {
			if (channel.closedWith !== undefined) throw channel.closedWith
			if (Date.now() > readyDeadline) {
				throw new CellProvisionError({
					phase: "connect",
					message: "guest agent never announced readiness on the control channel",
					detail: `see ${join(runDir, "console.log")}`,
				})
			}
			await delay(100)
		}

		const cell = new FaultCell({
			channel,
			qmp,
			qemu,
			vmStorePath,
			acceleration: { requested: "kvm:tcg", kvmPresent: kvm.present, kvmEnabled: kvm.enabled },
			qemuVersion,
			runDir,
			timeoutMs: options.defaultRequestTimeoutMs,
			barriers,
			exits,
			logLines,
			barrierWaiters,
			exitWaiters,
		})

		return cell
	}
}

export type CellSpecInput = CellSpec
