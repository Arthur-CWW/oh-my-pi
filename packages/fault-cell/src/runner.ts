import { Effect, Schema } from "effect"
import { createHash } from "node:crypto"
import { existsSync, mkdirSync, writeFileSync } from "node:fs"
import { join } from "node:path"
import { FaultCell } from "./cell"
import { type FaultCellError, FaultNotAppliedError, ScenarioDefinitionError, toTypedFailure } from "./errors"
import type { RunId } from "./ids"
import {
	decideOutcome,
	type InputHash,
	type InvariantRecord,
	MANIFEST_VERSION,
	type ProbeRecord,
	type RunManifest,
	type StepRecord,
} from "./manifest"
import {
	type AppliedFault,
	type ArtifactRecord,
	Observation,
	type ProbeValue,
} from "./observation"
import { JsonValueSchema, PROTOCOL_VERSION } from "./protocol"
import type { JsonValue, ObservedProcess } from "./protocol"
import {
	inputHash,
	resolveGit,
	resolveHost,
	type ResolvedNixpkgs,
	sha256OfFile,
	sha256OfText,
} from "./provenance"
import type { ProbeSpec, ProcessSpec, ScenarioDefinition, ScenarioStep } from "./scenario"

export const RUNNER_VERSION = "0.1.0"

export interface RunOptions {
	readonly scenario: ScenarioDefinition
	readonly scenarioModulePath: string
	readonly runId: RunId
	readonly seed: number
	readonly runDir: string
	readonly repoRoot: string
	readonly nixExprPath: string
	readonly agentPath: string
	readonly nixpkgs: ResolvedNixpkgs
	readonly bootTimeoutMs: number
	readonly requestTimeoutMs: number
	readonly includeNegativeControls: boolean
	readonly onProgress: (line: string) => void
}

export interface RunOutcome {
	readonly manifest: RunManifest
	readonly manifestPath: string
	readonly consoleLogPath: string
}

const canonicalDigest = (value: JsonValue): string =>
	createHash("sha256").update(JSON.stringify(value), "utf8").digest("hex")
const toJsonValue = Schema.decodeUnknownSync(JsonValueSchema)

/**
 * Normalises a step result into a plain JSON object. Step handlers report different field sets,
 * and an absent field must disappear from the manifest rather than serialise as `undefined`.
 */
function jsonDetail(
	fields: Readonly<Record<string, JsonValue | undefined>>,
): Record<string, JsonValue> {
	const normalised: Record<string, JsonValue> = {}
	for (const [key, value] of Object.entries(fields)) {
		if (value !== undefined) normalised[key] = value
	}
	return normalised
}

/**
 * Executes one scenario against a freshly provisioned cell and emits the run manifest.
 *
 * Failure handling is deliberately asymmetric: a step failure, an unverified fault, an
 * undecodable probe, and a violated invariant all end in a manifest that says `failed`. There
 * is no path where the runner stops early and reports success.
 */
export const runScenario = Effect.fn("fault-cell.runScenario")(function* (options: RunOptions) {
	const { scenario } = options
	const plan = scenario.plan({ seed: options.seed, runId: options.runId })
	validatePlan(scenario.id, scenario.cell.mounts.map((mount) => mount.name), plan.processes, plan)

	mkdirSync(options.runDir, { recursive: true })
	const planJson = JSON.stringify(plan, null, 2)
	const planPath = join(options.runDir, "scenario-plan.json")
	writeFileSync(planPath, `${planJson}\n`, "utf8")

	const startedAtWallMs = Date.now()
	const processesByName = new Map(plan.processes.map((entry) => [entry.name, entry]))
	const probesByName = new Map(plan.probes.map((entry) => [entry.name, entry]))

	const steps: StepRecord[] = []
	const faults: AppliedFault[] = []
	const probeRecords: ProbeRecord[] = []
	const probeValues = new Map<string, ProbeValue>()
	const artifacts: ArtifactRecord[] = []
	let observedProcesses: readonly ObservedProcess[] = []
	let failure: FaultCellError | undefined

	const cell = yield* FaultCell.boot({
		runDir: options.runDir,
		spec: scenario.cell,
		nixExprPath: options.nixExprPath,
		agentPath: options.agentPath,
		payloadDir: scenario.guestPayloadDir,
		nixpkgs: options.nixpkgs,
		bootTimeoutMs: options.bootTimeoutMs,
		defaultRequestTimeoutMs: options.requestTimeoutMs,
	})
	options.onProgress(
		`cell booted: ${cell.vmStorePath} (kvm ${cell.acceleration.kvmEnabled ? "enabled" : "DISABLED — running under TCG"})`,
	)

	const running = new Set<string>()

	const executed = yield* Effect.result(
		Effect.gen(function* () {
			for (let index = 0; index < plan.steps.length; index += 1) {
				const step = plan.steps[index]
				if (step === undefined) continue
				const stepStart = Date.now()
				options.onProgress(`step ${index}: ${describeStep(step)}`)
				const detail = yield* executeStep({
					cell,
					step,
					index,
					processesByName,
					probesByName,
					probeValues,
					probeRecords,
					faults,
					running,
				})
				steps.push({
					index,
					tag: step._tag,
					summary: describeStep(step),
					startedAtWallMs: stepStart,
					durationMs: Date.now() - stepStart,
					outcome: "ok",
					detail: jsonDetail(detail),
				})
			}
		}),
	)

	if (executed._tag === "Failure") {
		failure = executed.failure
		const index = steps.length
		const step = plan.steps[index]
		steps.push({
			index,
			tag: step?._tag ?? "Unknown",
			summary: step === undefined ? "unknown step" : describeStep(step),
			startedAtWallMs: Date.now(),
			durationMs: 0,
			outcome: "failed",
			detail: { error: toTypedFailure(executed.failure).summary },
		})
	}

	const table = yield* Effect.result(cell.processTable())
	if (table._tag === "Success") observedProcesses = table.success.processes
	else if (failure === undefined) failure = table.failure

	if (plan.artifacts.length > 0) {
		const collected = yield* Effect.result(cell.collectArtifacts(plan.artifacts, options.runId))
		if (collected._tag === "Success") {
			for (const entry of collected.success.artifacts) {
				const hostPath = join(options.runDir, "shared", "artifacts", options.runId, entry.relPath)
				const hostSha256 = existsSync(hostPath) ? sha256OfFile(hostPath).sha256 : ""
				artifacts.push({
					guestPath: entry.guestPath,
					hostPath,
					relPath: entry.relPath,
					bytes: entry.bytes,
					guestSha256: entry.sha256,
					hostSha256,
					intact: hostSha256.length > 0 && hostSha256 === entry.sha256,
				})
			}
		} else if (failure === undefined) {
			failure = collected.failure
		}
	}

	yield* cell.teardown()

	const observation = new Observation({
		runId: options.runId,
		seed: options.seed,
		barriers: cell.barriers,
		exits: cell.exits,
		processes: observedProcesses,
		faults,
		probes: probeValues,
		artifacts,
	})

	const invariants: InvariantRecord[] = scenario.invariants.map((spec) => ({
		name: spec.name,
		description: spec.description,
		role: "invariant" as const,
		outcome: spec.evaluate(observation),
	}))
	if (options.includeNegativeControls) {
		for (const spec of scenario.negativeControls) {
			invariants.push({
				name: spec.name,
				description: spec.description,
				role: "negative-control",
				outcome: spec.evaluate(observation),
			})
		}
	}

	const finishedAtWallMs = Date.now()
	const inputs: InputHash[] = [
		{
			name: "scenario-plan",
			kind: "scenario-plan",
			path: planPath,
			bytes: Buffer.byteLength(planJson, "utf8"),
			sha256: sha256OfText(planJson),
		},
		inputHash("cell-spec", "cell-spec", join(options.runDir, "cell-spec.json")),
		inputHash("guest-agent", "guest-agent", options.agentPath),
		inputHash("guest-payload", "guest-payload", scenario.guestPayloadDir),
		inputHash("nix-expr", "nix-expr", options.nixExprPath),
	]

	const manifest: RunManifest = {
		manifestVersion: MANIFEST_VERSION,
		runId: options.runId,
		outcome: decideOutcome(invariants, failure ?? null),
		startedAtWallMs,
		finishedAtWallMs,
		durationMs: finishedAtWallMs - startedAtWallMs,
		seed: options.seed,
		scenario: {
			id: scenario.id,
			version: scenario.version,
			description: scenario.description,
			modulePath: options.scenarioModulePath,
			sha256: sha256OfFile(options.scenarioModulePath).sha256,
		},
		provenance: {
			git: resolveGit(options.repoRoot),
			nix: {
				nixVersion: options.nixpkgs.nixVersion,
				nixpkgsStorePath: options.nixpkgs.storePath,
				nixpkgsNarHash: options.nixpkgs.narHash,
				nixpkgsLastModified: options.nixpkgs.lastModified,
				vmStorePath: cell.vmStorePath,
			},
			host: resolveHost(cell.qemuVersion),
			runnerVersion: RUNNER_VERSION,
			protocolVersion: PROTOCOL_VERSION,
		},
		acceleration: {
			requested: cell.acceleration.requested,
			kvmPresent: cell.acceleration.kvmPresent,
			kvmEnabled: cell.acceleration.kvmEnabled,
			source: "qmp:query-kvm",
		},
		inputs,
		cell: scenario.cell,
		plan,
		steps,
		faults,
		barriers: cell.barriers,
		exits: cell.exits,
		observedProcesses,
		probes: probeRecords,
		invariants,
		artifacts,
		failure: failure === undefined ? null : toTypedFailure(failure),
	}

	const manifestPath = join(options.runDir, "manifest.json")
	writeFileSync(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`, "utf8")
	const agentLogPath = join(options.runDir, "agent.log")
	writeFileSync(agentLogPath, `${cell.agentLog.join("\n")}\n`, "utf8")

	return {
		manifest,
		manifestPath,
		consoleLogPath: join(options.runDir, "console.log"),
	} satisfies RunOutcome
})

interface StepContext {
	readonly cell: FaultCell
	readonly step: ScenarioStep
	readonly index: number
	readonly processesByName: ReadonlyMap<string, ProcessSpec>
	readonly probesByName: ReadonlyMap<string, ProbeSpec>
	readonly probeValues: Map<string, ProbeValue>
	readonly probeRecords: ProbeRecord[]
	readonly faults: AppliedFault[]
	readonly running: Set<string>
}

const executeStep = Effect.fn("fault-cell.executeStep")(function* (context: StepContext) {
	const { cell, step, index, running } = context
	const record = (
		tag: string,
		target: string,
		requested: Record<string, JsonValue>,
		observed: Record<string, JsonValue>,
	): void => {
		context.faults.push({ stepIndex: index, tag, target, requested, observed, wallMs: Date.now() })
	}

	switch (step._tag) {
		case "Start": {
			const spec = requireProcess(context, step.process)
			const observed = yield* cell.start(spec)
			running.add(step.process)
			return { pid: observed.pid, startTicks: observed.startTicks, cgroup: observed.cgroup }
		}
		case "Restart": {
			const spec = requireProcess(context, step.process)
			if (running.has(step.process)) {
				yield* cell.signal(step.process, "SIGTERM")
				yield* cell.waitForExit(step.process, 30_000)
				running.delete(step.process)
			}
			const observed = yield* cell.start(spec)
			running.add(step.process)
			return {
				pid: observed.pid,
				startTicks: observed.startTicks,
				incarnation: observed.incarnation,
			}
		}
		case "Signal": {
			const observed = yield* cell.signal(step.process, step.signal)
			record("Signal", step.process, { signal: step.signal }, {
				pid: observed.pid,
				startTicks: observed.startTicks,
				incarnation: observed.incarnation,
			})
			return { pid: observed.pid, signal: step.signal }
		}
		case "WaitForBarrier": {
			const event = yield* cell.waitForBarrier(step.barrier, step.occurrence, step.timeoutMs)
			return { occurrence: event.occurrence, monotonicNs: event.monotonicNs, detail: event.detail }
		}
		case "WaitForExit": {
			const exit = yield* cell.waitForExit(step.process, step.timeoutMs)
			running.delete(step.process)
			return { exitCode: exit.exitCode, termSignal: exit.termSignal, pid: exit.pid }
		}
		case "SetCgroupMemory": {
			const result = yield* cell.setCgroupMemory(step.process, step.maxBytes)
			if (result.readBackBytes !== step.maxBytes) {
				return yield* Effect.fail(
					new FaultNotAppliedError({
						fault: "SetCgroupMemory",
						target: step.process,
						expected: `memory.max=${step.maxBytes}`,
						observed: `memory.max=${result.readBackBytes}`,
					}),
				)
			}
			record("SetCgroupMemory", step.process, { maxBytes: step.maxBytes }, {
				cgroup: result.cgroup,
				readBackBytes: result.readBackBytes,
			})
			return { cgroup: result.cgroup, readBackBytes: result.readBackBytes }
		}
		case "SetCgroupCpu": {
			const result = yield* cell.setCgroupCpu(step.process, step.quotaPercent)
			const expected = `${step.quotaPercent * 1000} 100000`
			if (result.readBack !== expected) {
				return yield* Effect.fail(
					new FaultNotAppliedError({
						fault: "SetCgroupCpu",
						target: step.process,
						expected: `cpu.max=${expected}`,
						observed: `cpu.max=${result.readBack}`,
					}),
				)
			}
			record("SetCgroupCpu", step.process, { quotaPercent: step.quotaPercent }, {
				cgroup: result.cgroup,
				readBack: result.readBack,
			})
			return { cgroup: result.cgroup, readBack: result.readBack }
		}
		case "FillFilesystem": {
			const result = yield* cell.fillFilesystem(step.mount, step.leaveFreeBytes)
			if (result.freeBytesAfter > step.leaveFreeBytes) {
				return yield* Effect.fail(
					new FaultNotAppliedError({
						fault: "FillFilesystem",
						target: step.mount,
						expected: `free <= ${step.leaveFreeBytes} bytes`,
						observed: `free = ${result.freeBytesAfter} bytes after writing ${result.balloonBytes}`,
					}),
				)
			}
			record("FillFilesystem", step.mount, { leaveFreeBytes: step.leaveFreeBytes }, {
				freeBytesBefore: result.freeBytesBefore,
				freeBytesAfter: result.freeBytesAfter,
				balloonBytes: result.balloonBytes,
			})
			return {
				freeBytesBefore: result.freeBytesBefore,
				freeBytesAfter: result.freeBytesAfter,
				balloonBytes: result.balloonBytes,
			}
		}
		case "ReleaseFilesystem": {
			const result = yield* cell.releaseFilesystem(step.mount)
			record("ReleaseFilesystem", step.mount, {}, {
				freeBytesAfter: result.freeBytesAfter,
				removedBytes: result.removedBytes,
			})
			return { freeBytesAfter: result.freeBytesAfter, removedBytes: result.removedBytes }
		}
		case "SqliteLockHold": {
			const result = yield* cell.sqliteLockHold(step.hold, step.path, step.mode)
			if (!result.held) {
				return yield* Effect.fail(
					new FaultNotAppliedError({
						fault: "SqliteLockHold",
						target: step.hold,
						expected: `${step.mode} lock held on ${step.path}`,
						observed: "guest reported the lock was not held",
					}),
				)
			}
			record("SqliteLockHold", step.hold, { path: step.path, mode: step.mode }, {
				journalMode: result.journalMode,
			})
			return { journalMode: result.journalMode }
		}
		case "SqliteLockRelease": {
			const result = yield* cell.sqliteLockRelease(step.hold)
			return { hold: result.hold }
		}
		case "NetworkPartition": {
			const result = yield* cell.networkPartition(step.link)
			if (result.adminUp) {
				return yield* Effect.fail(
					new FaultNotAppliedError({
						fault: "NetworkPartition",
						target: step.link,
						expected: "link administratively down",
						observed: `operstate=${result.operState} adminUp=true`,
					}),
				)
			}
			record("NetworkPartition", step.link, {}, { operState: result.operState })
			return { operState: result.operState }
		}
		case "NetworkDelay": {
			const result = yield* cell.networkDelay(step.link, step.delayMs, step.jitterMs)
			if (result.delayMs !== step.delayMs) {
				return yield* Effect.fail(
					new FaultNotAppliedError({
						fault: "NetworkDelay",
						target: step.link,
						expected: `netem delay ${step.delayMs}ms`,
						observed: `qdisc=${result.qdisc}`,
					}),
				)
			}
			record("NetworkDelay", step.link, { delayMs: step.delayMs, jitterMs: step.jitterMs }, {
				qdisc: result.qdisc,
			})
			return { qdisc: result.qdisc, delayMs: result.delayMs }
		}
		case "NetworkReset": {
			const result = yield* cell.networkReset(step.link)
			if (!result.adminUp) {
				return yield* Effect.fail(
					new FaultNotAppliedError({
						fault: "NetworkReset",
						target: step.link,
						expected: "link administratively up with no netem qdisc",
						observed: `operstate=${result.operState} qdisc=${result.qdisc}`,
					}),
				)
			}
			record("NetworkReset", step.link, {}, { operState: result.operState, qdisc: result.qdisc })
			return { operState: result.operState, qdisc: result.qdisc }
		}
		case "SetProcessTz": {
			const result = yield* cell.setProcessTz(step.process, step.tz)
			record("SetProcessTz", step.process, { tz: step.tz }, { tz: result.tz })
			return { tz: result.tz }
		}
		case "Probe": {
			const spec = context.probesByName.get(step.probe)
			if (spec === undefined) {
				return yield* Effect.fail(
					new ScenarioDefinitionError({
						scenario: step.probe,
						message: `step ${index} references probe "${step.probe}" which the plan never declares`,
					}),
				)
			}
			return yield* runProbe(context, spec, index)
		}
	}
})

const runProbe = Effect.fn("fault-cell.runProbe")(function* (
	context: StepContext,
	spec: ProbeSpec,
	index: number,
) {
	const { cell } = context
	if (spec._tag === "Sqlite") {
		const result = yield* cell.probeSqlite(spec.path, spec.sql, spec.params)
		const value = toJsonValue(result)
		context.probeValues.set(spec.name, { _tag: "Sqlite", value: result })
		context.probeRecords.push({
			name: spec.name,
			kind: "Sqlite",
			stepIndex: index,
			target: spec.path,
			rowCount: result.rows.length,
			sha256: canonicalDigest(value),
			value,
		})
		return { rowCount: result.rows.length }
	}
	if (spec._tag === "File") {
		const result = yield* cell.probeFile(spec.path, spec.includeText)
		const value = toJsonValue(result)
		context.probeValues.set(spec.name, { _tag: "File", value: result })
		context.probeRecords.push({
			name: spec.name,
			kind: "File",
			stepIndex: index,
			target: spec.path,
			rowCount: result.exists ? 1 : 0,
			sha256: result.sha256,
			value,
		})
		return { exists: result.exists, bytes: result.bytes }
	}
	const result = yield* cell.processTable()
	const value = toJsonValue(result.processes)
	context.probeValues.set(spec.name, { _tag: "ProcessTable", value: result.processes })
	context.probeRecords.push({
		name: spec.name,
		kind: "ProcessTable",
		stepIndex: index,
		target: "guest",
		rowCount: result.processes.length,
		sha256: canonicalDigest(value),
		value,
	})
	return { processCount: result.processes.length }
})

function requireProcess(context: StepContext, name: string): ProcessSpec {
	const spec = context.processesByName.get(name)
	if (spec === undefined) {
		throw new ScenarioDefinitionError({
			scenario: name,
			message: `step ${context.index} references process "${name}" which the plan never declares`,
		})
	}
	return spec
}

function describeStep(step: ScenarioStep): string {
	switch (step._tag) {
		case "Start":
		case "Restart":
			return `${step._tag} ${step.process}`
		case "Signal":
			return `Signal ${step.process} ${step.signal}`
		case "WaitForBarrier":
			return `WaitForBarrier ${step.barrier}#${step.occurrence}`
		case "WaitForExit":
			return `WaitForExit ${step.process}`
		case "SetCgroupMemory":
			return `SetCgroupMemory ${step.process} ${step.maxBytes}`
		case "SetCgroupCpu":
			return `SetCgroupCpu ${step.process} ${step.quotaPercent}%`
		case "FillFilesystem":
			return `FillFilesystem ${step.mount} leave=${step.leaveFreeBytes}`
		case "ReleaseFilesystem":
			return `ReleaseFilesystem ${step.mount}`
		case "SqliteLockHold":
			return `SqliteLockHold ${step.hold} ${step.mode}`
		case "SqliteLockRelease":
			return `SqliteLockRelease ${step.hold}`
		case "NetworkPartition":
			return `NetworkPartition ${step.link}`
		case "NetworkDelay":
			return `NetworkDelay ${step.link} ${step.delayMs}ms`
		case "NetworkReset":
			return `NetworkReset ${step.link}`
		case "SetProcessTz":
			return `SetProcessTz ${step.process} ${step.tz}`
		case "Probe":
			return `Probe ${step.probe}`
	}
}

/**
 * Rejects a plan that references undeclared topology before a VM is ever built. Catching this
 * at boot time keeps a typo from surfacing as a mysterious mid-run guest error.
 */
function validatePlan(
	scenarioId: string,
	mountNames: readonly string[],
	processes: readonly ProcessSpec[],
	plan: { readonly steps: readonly ScenarioStep[]; readonly probes: readonly ProbeSpec[] },
): void {
	const processNames = new Set(processes.map((entry) => entry.name))
	const probeNames = new Set(plan.probes.map((entry) => entry.name))
	const mounts = new Set(mountNames)
	const problems: string[] = []
	for (const [index, step] of plan.steps.entries()) {
		if ("process" in step && !processNames.has(step.process)) {
			problems.push(`step ${index} (${step._tag}) uses undeclared process "${step.process}"`)
		}
		if ("mount" in step && !mounts.has(step.mount)) {
			problems.push(`step ${index} (${step._tag}) uses undeclared mount "${step.mount}"`)
		}
		if (step._tag === "Probe" && !probeNames.has(step.probe)) {
			problems.push(`step ${index} uses undeclared probe "${step.probe}"`)
		}
	}
	if (problems.length > 0) {
		throw new ScenarioDefinitionError({ scenario: scenarioId, message: problems.join("; ") })
	}
}
