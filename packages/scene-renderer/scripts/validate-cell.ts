#!/usr/bin/env bun
import { spawnSync } from "node:child_process"
import { fileURLToPath } from "node:url"
import { decodeValidationManifest, planBoundedExecution, type ValidationManifest } from "../src/validation-cell"
import { describeFailure, revokePublishedReceipt, runSceneValidationCell } from "../src/validation-cell-runner"

// An unbounded invocation still reaches the runner when the manifest cannot be decoded: only the
// runner invalidates the prior receipt. Under `--bounded` there is no budget to enforce, so the
// invocation refuses here instead, withdrawing the prior receipt on its way out.
async function readBudgetedManifest(): Promise<ValidationManifest | null> {
  try {
    return decodeValidationManifest(await Bun.file(new URL("../validation/cells/two-beat-scene.v1.json", import.meta.url)).json())
  } catch {
    return null
  }
}

// `--bounded` re-executes the cell inside a transient cgroup whose kernel-enforced ceiling is the
// manifest budget, so the receipt records an enforced MemoryMax/CPUQuota rather than an open scope.
const plan = planBoundedExecution(await readBudgetedManifest(), process.argv, process.env.SCENE_VALIDATION_BOUNDED === "1")

if (plan.kind === "refuse") {
  const withdrawal = await revokePublishedReceipt(describeFailure(new Error(plan.reason))).then(
    () => "",
    (error: unknown) => `\ncould not withdraw the prior receipt: ${error instanceof Error ? error.message : String(error)}`,
  )
  console.error(`${plan.reason}${withdrawal}`)
  process.exit(1)
}

if (plan.kind === "scope") {
  const runtimeDirectory = process.env.XDG_RUNTIME_DIR ?? `/run/user/${String(process.getuid?.() ?? 0)}`
  const scope = spawnSync("systemd-run", [
    "--user",
    "--scope",
    "--quiet",
    `--property=MemoryMax=${plan.memoryMaxBytes}`,
    "--property=CPUQuota=400%",
    process.execPath,
    fileURLToPath(import.meta.url),
  ], {
    stdio: "inherit",
    env: {
      ...process.env,
      SCENE_VALIDATION_BOUNDED: "1",
      XDG_RUNTIME_DIR: runtimeDirectory,
      DBUS_SESSION_BUS_ADDRESS: process.env.DBUS_SESSION_BUS_ADDRESS ?? `unix:path=${runtimeDirectory}/bus`,
    },
  })
  process.exit(scope.status ?? 1)
}

try {
  const receipt = await runSceneValidationCell()
  console.log(JSON.stringify({
    outcome: receipt.outcome,
    frames: receipt.proof.render.frameCount,
    firstBadMutantFrame: receipt.proof.state.negativeControl.firstBadFrame,
    artifacts: receipt.proof.budgets.artifactCount,
    renderPasses: receipt.proof.process.renderPasses,
    peakProcessTreeSize: receipt.proof.process.peakProcessTreeSize,
    priorReceiptRemoved: receipt.proof.process.priorReceiptRemoved,
    sourceDigest: receipt.proof.sources.digest,
    entropy: {
      postPassApplied: receipt.proof.state.entropy.postPassApplied,
      cloneCountApplied: receipt.proof.state.entropy.cloneCountApplied,
    },
    cgroup: {
      path: receipt.proof.host.cgroupPath,
      memoryMaxBytes: receipt.proof.host.memoryMaxBytes,
      memoryPeakBytes: receipt.proof.host.memoryPeakBytes,
      cpuQuotaMicroseconds: receipt.proof.host.cpuQuotaMicroseconds,
      cpuPeriodMicroseconds: receipt.proof.host.cpuPeriodMicroseconds,
      foreignProcessCount: receipt.proof.host.foreignProcessCount,
    },
  }))
} catch (error) {
  console.error(error instanceof Error ? error.stack ?? error.message : String(error))
  process.exitCode = 1
}
