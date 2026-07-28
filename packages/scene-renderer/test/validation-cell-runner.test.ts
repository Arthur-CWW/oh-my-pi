import { afterEach, describe, expect, test } from "bun:test"
import { createHash } from "node:crypto"
import { existsSync } from "node:fs"
import { mkdir, mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { dirname, join } from "node:path"
import { fileURLToPath } from "node:url"
import { decodeValidationManifest, planBoundedExecution } from "../src/validation-cell"
import { assertCertifiedBytes } from "../src/render"
import {
  assertDigestUnchanged,
  assertSourcesUnchanged,
  assertSupportedHost,
  describeFailure,
  digestSources,
  observeHost,
  publishReceipt,
  revokePublishedReceipt,
  runSceneValidationCell,
  stageRenderInput,
  type HostFacts,
  type SourceDigestProof,
} from "../src/validation-cell-runner"

const PACKAGE_ROOT = fileURLToPath(new URL("..", import.meta.url))
const MANIFEST_RELATIVE = "packages/scene-renderer/validation/cells/two-beat-scene.v1.json"
const SCENE_RELATIVE = "packages/scene-renderer/validation/scenes/two-beat.scene.json"
const RENDERER_RELATIVE = "packages/scene-renderer/src/render.ts"
const manifestText = await Bun.file(new URL("../validation/cells/two-beat-scene.v1.json", import.meta.url)).text()
const sceneText = await Bun.file(new URL("../validation/scenes/two-beat.scene.json", import.meta.url)).text()
const packageText = await Bun.file(new URL("../package.json", import.meta.url)).text()
const manifest = decodeValidationManifest(JSON.parse(manifestText))

const roots: string[] = []

interface RepositoryOptions {
  readonly scene?: string
  readonly runtimeBundle?: boolean
  readonly lock?: boolean
  readonly installed?: readonly string[]
  readonly versions?: Readonly<Record<string, string>>
  readonly staleReceipt?: boolean
}

function lockedVersion(name: string): string {
  return (manifest.sources.dependencies.find((dependency) => dependency.name === name)?.declared ?? "0.0.0").replace(/^[\^~]/, "")
}

async function repository(options: RepositoryOptions = {}): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), "scene-validation-cell-"))
  roots.push(root)
  await Promise.all([
    writeInto(root, MANIFEST_RELATIVE, manifestText),
    writeInto(root, SCENE_RELATIVE, options.scene ?? sceneText),
    writeInto(root, manifest.sources.packagePath, packageText),
    writeInto(root, manifest.sources.runtimeEntry, "export const SceneRuntime = {}\n"),
    writeInto(root, RENDERER_RELATIVE, "export const render = 0\n"),
  ])
  if (options.runtimeBundle !== false) await writeInto(root, manifest.sources.runtimePath, "globalThis.SceneRuntime = {}\n")
  if (options.lock !== false) await writeInto(root, manifest.sources.lockPath, '{"lockfileVersion":1}\n')
  for (const name of options.installed ?? manifest.sources.dependencies.map((dependency) => dependency.name)) {
    await writeInto(root, `node_modules/${name}/package.json`, `{"name":"${name}","version":"${options.versions?.[name] ?? lockedVersion(name)}"}\n`)
  }
  if (options.staleReceipt === true) await writeInto(root, manifest.artifacts.receiptPath, '{"outcome":"passed"}\n')
  return root
}

async function writeInto(root: string, relativePath: string, contents: string): Promise<void> {
  const target = join(root, relativePath)
  await mkdir(dirname(target), { recursive: true })
  await writeFile(target, contents)
}

async function stagingWorkspace(): Promise<string> {
  const workspace = await mkdtemp(join(tmpdir(), "scene-validation-staging-"))
  roots.push(workspace)
  return workspace
}

function sha256(text: string): string {
  return createHash("sha256").update(text).digest("hex")
}

function runIn(root: string, overrides: { readonly manifestPath?: string; readonly runtimePath?: string } = {}): Promise<unknown> {
  return runSceneValidationCell({
    repositoryRoot: root,
    manifestPath: overrides.manifestPath ?? join(root, MANIFEST_RELATIVE),
    runtimePath: overrides.runtimePath,
  })
}

/** Stages the fixture's declared render inputs and digests every source the receipt would name. */
async function digestFixture(root: string, workspace: string): Promise<SourceDigestProof> {
  const scene = await stageRenderInput(join(root, SCENE_RELATIVE), manifest.scene.path, workspace, "canonical.scene.json")
  const runtime = await stageRenderInput(join(root, manifest.sources.runtimePath), manifest.sources.runtimePath, workspace, "runtime.js")
  return digestSources(root, manifest, Buffer.from(manifestText, "utf8"), scene, runtime)
}

/** Runs the real renderer entrypoint the validation cell spawns, and reports how it refused. */
async function runRenderer(args: readonly string[]): Promise<{ readonly exitCode: number; readonly stderr: string }> {
  const child = Bun.spawn([process.execPath, "src/render.ts", ...args], { cwd: PACKAGE_ROOT, stdout: "ignore", stderr: "pipe" })
  const stderr = await new Response(child.stderr).text()
  return { exitCode: await child.exited, stderr }
}

const linuxFacts: HostFacts = {
  platform: "linux",
  hostname: "nixbox",
  architecture: "x64",
  cgroupVersion: 2,
  cgroupPath: "/user.slice/user-1000.slice/user@1000.service/app.slice/run-p1.scope",
  controllers: ["cpu", "memory", "pids"],
  memoryMaxBytes: 1_610_612_736,
  memoryPeakBytes: 800_000_000,
  memoryCurrentBytes: 4_000_000,
  cpuQuotaMicroseconds: 400_000,
  cpuPeriodMicroseconds: 100_000,
  pidsMax: null,
  pidsPeak: 32,
  cgroupProcessCount: 3,
  foreignProcessCount: 0,
}

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })))
})

describe("validation cell preflight", () => {
  test("removes a prior receipt before a preflight failure can return", async () => {
    const root = await repository({ staleReceipt: true, runtimeBundle: false })
    const receiptPath = join(root, manifest.artifacts.receiptPath)
    expect(existsSync(receiptPath)).toBe(true)

    await expect(runIn(root)).rejects.toThrow(/dist\/runtime\.js/)

    expect(existsSync(receiptPath)).toBe(false)
    const errors = await readFile(join(root, manifest.artifacts.errorsPath), "utf8")
    expect(errors).toContain("dist/runtime.js")
  })

  test("refuses a runtime bundle the manifest does not declare", async () => {
    const root = await repository({ staleReceipt: true })
    await expect(runIn(root, { runtimePath: join(root, "packages/scene-renderer/dist/smuggled.js") }))
      .rejects.toThrow(/is not the runtime bundle declared by the manifest/)
    expect(existsSync(join(root, manifest.artifacts.receiptPath))).toBe(false)
  })

  test("refuses a manifest that is not the declared cell source", async () => {
    const root = await repository({ staleReceipt: true })
    const copied = "packages/scene-renderer/validation/cells/two-beat-scene.copy.json"
    await writeInto(root, copied, manifestText)

    await expect(runIn(root, { manifestPath: join(root, copied) }))
      .rejects.toThrow(/is not the cell source declared by the manifest/)
    expect(existsSync(join(root, manifest.artifacts.receiptPath))).toBe(false)
  })

  test("refuses a scene whose clone seeds drift from the manifest", async () => {
    const root = await repository({ scene: sceneText.replace('"seed": 202', '"seed": 999') })
    await expect(runIn(root)).rejects.toThrow(/scene clone seeds \[101, 999\] do not match/)
  })

  test("refuses a scene whose clone counts drift from the manifest", async () => {
    const root = await repository({ scene: sceneText.replace('"count": 3', '"count": 4') })
    await expect(runIn(root)).rejects.toThrow(/scene clone counts \[4, 3\] do not match/)
  })

  test("refuses a scene whose post chain drops the manifest pass", async () => {
    const scene = JSON.parse(sceneText) as Record<string, unknown>
    const root = await repository({ scene: JSON.stringify({ ...scene, post: [] }) })
    await expect(runIn(root)).rejects.toThrow(/scene post chain \[\] does not match the manifest post pass halftone/)
  })

  test("refuses to digest an install without the declared dependency closure", async () => {
    const root = await repository({ installed: ["effect", "puppeteer"] })
    await expect(runIn(root)).rejects.toThrow(/three is not installed/)
  })

  test("refuses an install whose resolved version shadows the locked dependency", async () => {
    const root = await repository({ versions: { effect: "4.0.0-beta.92" } })
    await expect(runIn(root)).rejects.toThrow(/effect@4\.0\.0-beta\.92 is installed where bun\.lock/)
  })

  test("refuses to digest a workspace without the declared lockfile", async () => {
    const root = await repository({ lock: false })
    await expect(runIn(root)).rejects.toThrow(/bun\.lock/)
  })
})

describe("validation cell host gate", () => {
  test("accepts the declared bounded Linux cgroup host", () => {
    expect(() => assertSupportedHost(linuxFacts, manifest)).not.toThrow()
  })

  test("refuses a Darwin host instead of falling back to self-reported measurements", () => {
    expect(() => assertSupportedHost({ ...linuxFacts, platform: "darwin" }, manifest)).toThrow(/refusing to certify darwin/)
  })

  test("refuses a foreign hostname", () => {
    expect(() => assertSupportedHost({ ...linuxFacts, hostname: "macbook" }, manifest)).toThrow(/must run on nixbox/)
  })

  test("refuses cgroup v1 accounting", () => {
    expect(() => assertSupportedHost({ ...linuxFacts, cgroupVersion: 1 }, manifest)).toThrow(/requires cgroup v2/)
  })

  test("refuses a cgroup without the memory and pids controllers", () => {
    expect(() => assertSupportedHost({ ...linuxFacts, controllers: ["cpu"] }, manifest)).toThrow(/required controllers: memory, pids/)
  })

  test("refuses a cgroup shared with processes outside the validated tree", () => {
    expect(() => assertSupportedHost({ ...linuxFacts, foreignProcessCount: 3 }, manifest)).toThrow(/outside the validated process tree/)
  })

  test("refuses observed or enforced cgroup memory above the manifest budget", () => {
    expect(() => assertSupportedHost({ ...linuxFacts, memoryPeakBytes: manifest.budgets.maxPeakRssBytes + 1 }, manifest))
      .toThrow(/peaked at/)
    expect(() => assertSupportedHost({ ...linuxFacts, memoryMaxBytes: manifest.budgets.maxPeakRssBytes * 2 }, manifest))
      .toThrow(/allows/)
  })

  test.if(process.platform === "linux")("observes live cgroup v2 bounds and process membership", async () => {
    const facts = await observeHost()
    expect(facts.platform).toBe("linux")
    expect(facts.cgroupVersion).toBe(2)
    expect(facts.cgroupPath.startsWith("/")).toBe(true)
    expect(facts.controllers).toContain("memory")
    expect(facts.controllers).toContain("pids")
    expect(facts.memoryPeakBytes).toBeGreaterThan(0)
    expect(facts.memoryCurrentBytes).toBeGreaterThan(0)
    expect(facts.cgroupProcessCount).toBeGreaterThan(0)
    expect(facts.pidsPeak).toBeGreaterThan(0)
    expect(facts.foreignProcessCount).toBeLessThanOrEqual(facts.cgroupProcessCount)
  })

  test.if(process.platform !== "linux")("refuses to observe a non-Linux host at all", async () => {
    await expect(observeHost()).rejects.toThrow(/requires a Linux host with cgroup v2/)
  })
})

describe("validation cell source binding", () => {
  test("stages the declared scene before the run can decode it", async () => {
    const root = await repository({ staleReceipt: true })
    await rm(join(root, SCENE_RELATIVE))

    await expect(runIn(root)).rejects.toThrow(/cannot stage packages\/scene-renderer\/validation\/scenes\/two-beat\.scene\.json for rendering/)
    expect(existsSync(join(root, manifest.artifacts.receiptPath))).toBe(false)
  })

  test("keeps certifying the staged bytes when the declared sources are swapped after digesting", async () => {
    const root = await repository()
    const workspace = await stagingWorkspace()
    const declaredScene = join(root, SCENE_RELATIVE)
    const declaredRuntime = join(root, manifest.sources.runtimePath)
    const originalRuntime = await readFile(declaredRuntime, "utf8")
    const stagedScene = await stageRenderInput(declaredScene, manifest.scene.path, workspace, "canonical.scene.json")
    const stagedRuntime = await stageRenderInput(declaredRuntime, manifest.sources.runtimePath, workspace, "runtime.js")
    expect(stagedScene.sha256).toBe(sha256(sceneText))
    expect(stagedRuntime.sha256).toBe(sha256(originalRuntime))

    const swappedScene = sceneText.replace('"seed": 202', '"seed": 999')
    const swappedRuntime = "globalThis.SceneRuntime = { swapped: true }\n"
    await writeFile(declaredScene, swappedScene)
    await writeFile(declaredRuntime, swappedRuntime)

    // The digested bytes are the rendered bytes: the swap reaches neither the staged copies the
    // renderer opens nor the digests the receipt certifies.
    expect(await readFile(stagedScene.path, "utf8")).toBe(sceneText)
    expect(await readFile(stagedRuntime.path, "utf8")).toBe(originalRuntime)
    expect(stagedScene.sha256).not.toBe(sha256(swappedScene))
    expect(stagedRuntime.sha256).not.toBe(sha256(swappedRuntime))

    // The declared paths the receipt names no longer hold the certified bytes, so the run refuses
    // rather than shipping provenance a later reader would re-hash to something else.
    await expect(assertDigestUnchanged(declaredScene, stagedScene.sha256, manifest.scene.path))
      .rejects.toThrow(/two-beat\.scene\.json changed after it was digested/)
    await expect(assertDigestUnchanged(declaredRuntime, stagedRuntime.sha256, manifest.sources.runtimePath))
      .rejects.toThrow(/dist\/runtime\.js changed after it was digested/)
  })

  test("refuses a staged copy written outside the run workspace", async () => {
    const root = await repository()
    const workspace = await stagingWorkspace()
    const outside = join(workspace, "..", "smuggled-runtime.js")

    await expect(stageRenderInput(join(root, manifest.sources.runtimePath), manifest.sources.runtimePath, workspace, "../smuggled-runtime.js"))
      .rejects.toThrow(/escapes the run workspace/)
    await expect(stageRenderInput(join(root, manifest.sources.runtimePath), manifest.sources.runtimePath, workspace, outside))
      .rejects.toThrow(/escapes the run workspace/)
    expect(existsSync(outside)).toBe(false)
  })
})

// The renderer verifies in its own process that the bytes it just read are the bytes the runner
// digested, so no window exists between the check and the open for a same-user process to use.
describe("render input certification", () => {
  test("accepts bytes whose digest is the certified one", () => {
    const bytes = Buffer.from(sceneText, "utf8")
    expect(() => assertCertifiedBytes(bytes, sha256(sceneText), "scene")).not.toThrow()
    expect(() => assertCertifiedBytes(bytes, undefined, "scene")).not.toThrow()
  })

  test("refuses a staged scene replaced between the digest and the render", async () => {
    const root = await repository()
    const workspace = await stagingWorkspace()
    const scene = await stageRenderInput(join(root, SCENE_RELATIVE), manifest.scene.path, workspace, "canonical.scene.json")
    const runtime = await stageRenderInput(join(root, manifest.sources.runtimePath), manifest.sources.runtimePath, workspace, "runtime.js")
    const outDir = join(workspace, "out")
    await writeFile(scene.path, sceneText.replace('"seed": 202', '"seed": 999'))

    const refusal = await runRenderer([
      "--scene", scene.path,
      "--scene-sha256", scene.sha256,
      "--out", outDir,
      "--runtime", runtime.path,
      "--runtime-sha256", runtime.sha256,
    ])

    expect(refusal.exitCode).toBe(1)
    expect(refusal.stderr).toContain(`not the certified ${scene.sha256}`)
    expect(existsSync(outDir)).toBe(false)
  })

  test("refuses a staged runtime bundle replaced between the digest and the render", async () => {
    const root = await repository()
    const workspace = await stagingWorkspace()
    const scene = await stageRenderInput(join(root, SCENE_RELATIVE), manifest.scene.path, workspace, "canonical.scene.json")
    const runtime = await stageRenderInput(join(root, manifest.sources.runtimePath), manifest.sources.runtimePath, workspace, "runtime.js")
    const outDir = join(workspace, "out")
    await writeFile(runtime.path, "globalThis.SceneRuntime = { tampered: true }\n")

    const refusal = await runRenderer([
      "--scene", scene.path,
      "--scene-sha256", scene.sha256,
      "--out", outDir,
      "--runtime", runtime.path,
      "--runtime-sha256", runtime.sha256,
    ])

    expect(refusal.exitCode).toBe(1)
    expect(refusal.stderr).toContain(`not the certified ${runtime.sha256}`)
    expect(existsSync(outDir)).toBe(false)
  })

  test("refuses a digest argument that is not a sha-256 hex digest", async () => {
    const workspace = await stagingWorkspace()
    const refusal = await runRenderer(["--scene", join(workspace, "missing.json"), "--scene-sha256", "nope", "--out", join(workspace, "out")])

    expect(refusal.exitCode).toBe(1)
    expect(refusal.stderr).toContain("--scene-sha256 must be a lowercase hex sha-256 digest")
  })
})

describe("validation cell manifest refusal", () => {
  test("leaves no receipt when the manifest cannot be parsed", async () => {
    const root = await repository({ staleReceipt: true })
    await writeInto(root, MANIFEST_RELATIVE, "{ not json")
    const receiptPath = join(root, manifest.artifacts.receiptPath)
    expect(existsSync(receiptPath)).toBe(true)

    await expect(runIn(root)).rejects.toThrow()

    expect(existsSync(receiptPath)).toBe(false)
    expect(await readFile(join(root, manifest.artifacts.errorsPath), "utf8")).toContain("invalid JSON")
  })

  test("leaves no receipt when the manifest declares an escaping artifact path", async () => {
    const root = await repository({ staleReceipt: true })
    const escaping = JSON.parse(manifestText) as { readonly artifacts: Record<string, string> }
    escaping.artifacts.receiptPath = "../../../../receipt.json"
    await writeInto(root, MANIFEST_RELATIVE, JSON.stringify(escaping))
    const receiptPath = join(root, manifest.artifacts.receiptPath)
    expect(existsSync(receiptPath)).toBe(true)

    await expect(runIn(root)).rejects.toThrow()

    expect(existsSync(receiptPath)).toBe(false)
    expect(await readFile(join(root, manifest.artifacts.errorsPath), "utf8")).toContain("receiptPath")
  })
})

describe("validation cell refusal evidence", () => {
  test("states the refusal reason even when the runtime drops it from the stack", () => {
    const stackless = new Error("cannot stage packages/scene-renderer/dist/runtime.js for rendering: ENOENT")
    stackless.stack = "Error\n    at stageRenderInput (validation-cell-runner.ts:1:1)"

    expect(describeFailure(stackless)).toBe([
      "Error: cannot stage packages/scene-renderer/dist/runtime.js for rendering: ENOENT",
      "    at stageRenderInput (validation-cell-runner.ts:1:1)",
      "",
    ].join("\n"))
  })

  test("records a reason for a thrown non-error", () => {
    expect(describeFailure("renderer vanished").split("\n")[0]).toBe("Error: renderer vanished")
  })
})

describe("validation cell receipt publication", () => {
  test("publishes the receipt once the certified artifact inventory matches", async () => {
    const artifactRoot = await stagingWorkspace()
    await writeFile(join(artifactRoot, "two-beat.mp4"), "mp4")
    const receiptPath = join(artifactRoot, "receipt.json")

    await publishReceipt(artifactRoot, receiptPath, '{"outcome":"passed"}\n', 2)

    expect(await readFile(receiptPath, "utf8")).toBe('{"outcome":"passed"}\n')
    expect((await readdir(artifactRoot)).sort()).toEqual(["receipt.json", "two-beat.mp4"])
  })

  test("leaves no receipt when finalization observes an unexpected artifact", async () => {
    const artifactRoot = await stagingWorkspace()
    await writeFile(join(artifactRoot, "two-beat.mp4"), "mp4")
    await writeFile(join(artifactRoot, "smuggled.png"), "png")
    const receiptPath = join(artifactRoot, "receipt.json")

    await expect(publishReceipt(artifactRoot, receiptPath, '{"outcome":"passed"}\n', 2))
      .rejects.toThrow(/artifact count changed after receipt: expected 2, found 3/)

    expect(existsSync(receiptPath)).toBe(false)
    expect(existsSync(`${receiptPath}.staging`)).toBe(false)
    expect((await readdir(artifactRoot)).sort()).toEqual(["smuggled.png", "two-beat.mp4"])
  })

  test("leaves no receipt when the artifact inventory cannot be counted", async () => {
    const workspace = await stagingWorkspace()
    const artifactRoot = join(workspace, "not-a-directory")
    await writeFile(artifactRoot, "")
    const receiptPath = join(workspace, "receipt.json")

    await expect(publishReceipt(artifactRoot, receiptPath, '{"outcome":"passed"}\n', 1)).rejects.toThrow(/ENOTDIR|not a directory/i)

    expect(existsSync(receiptPath)).toBe(false)
    expect(existsSync(`${receiptPath}.staging`)).toBe(false)
  })

  test("leaves no residue when the staged proof itself cannot be written", async () => {
    const artifactRoot = await stagingWorkspace()
    const receiptPath = join(artifactRoot, "receipt.json")
    await mkdir(`${receiptPath}.staging`)

    await expect(publishReceipt(artifactRoot, receiptPath, '{"outcome":"passed"}\n', 1)).rejects.toThrow(/EISDIR|illegal operation on a directory|directory/i)

    expect(existsSync(receiptPath)).toBe(false)
    expect(existsSync(`${receiptPath}.staging`)).toBe(false)
  })
})

// Every source the receipt names is re-hashed by a later reader reproducing the proof, so all of them
// — not just the two the renderer opened — must still hold the digested bytes when the run finishes.
describe("validation cell source recheck", () => {
  const drifts = [
    { source: "manifest", relativePath: MANIFEST_RELATIVE, refusal: /two-beat-scene\.v1\.json changed after it was digested/ },
    { source: "scene", relativePath: SCENE_RELATIVE, refusal: /two-beat\.scene\.json changed after it was digested/ },
    { source: "runtime bundle", relativePath: manifest.sources.runtimePath, refusal: /dist\/runtime\.js changed after it was digested/ },
    { source: "package manifest", relativePath: manifest.sources.packagePath, refusal: /scene-renderer\/package\.json changed after it was digested/ },
    { source: "lockfile", relativePath: manifest.sources.lockPath, refusal: /bun\.lock changed after it was digested/ },
    { source: "renderer source", relativePath: RENDERER_RELATIVE, refusal: /renderer source root packages\/scene-renderer\/src changed during the run/ },
  ] as const

  test("accepts a workspace whose sources all still hold the digested bytes", async () => {
    const root = await repository()
    const sources = await digestFixture(root, await stagingWorkspace())

    await expect(assertSourcesUnchanged(root, sources)).resolves.toBeUndefined()
  })

  for (const drift of drifts) {
    test(`refuses when the ${drift.source} changes after the run digested it`, async () => {
      const root = await repository()
      const sources = await digestFixture(root, await stagingWorkspace())
      const drifted = join(root, drift.relativePath)
      await writeFile(drifted, `${await readFile(drifted, "utf8")}\n`)

      await expect(assertSourcesUnchanged(root, sources)).rejects.toThrow(drift.refusal)
    })
  }

  test("digests sources from their bytes so a later sha256sum reproduces the receipt", async () => {
    const root = await repository()
    const sources = await digestFixture(root, await stagingWorkspace())

    expect(sources.manifest.sha256).toBe(sha256(manifestText))
    expect(sources.scene.sha256).toBe(sha256(sceneText))
    expect(sources.package.sha256).toBe(sha256(packageText))
    expect(sources.lock.sha256).toBe(sha256('{"lockfileVersion":1}\n'))
  })
})

// `--bounded` promises a kernel-enforced cgroup. A preflight that cannot read the budget must refuse,
// never fall through to the unbounded run the operator did not ask for.
describe("bounded execution plan", () => {
  test("refuses --bounded when the manifest budget cannot be read", () => {
    const plan = planBoundedExecution(null, ["bun", "scripts/validate-cell.ts", "--bounded"], false)

    expect(plan.kind).toBe("refuse")
    expect(plan.kind === "refuse" ? plan.reason : "").toContain("refusing to run the cell outside the cgroup")
  })

  test("re-executes --bounded in a scope carrying the manifest memory budget", () => {
    const plan = planBoundedExecution(manifest, ["bun", "scripts/validate-cell.ts", "--bounded"], false)

    expect(plan).toEqual({ kind: "scope", memoryMaxBytes: manifest.budgets.maxPeakRssBytes })
  })

  test("runs the cell once the bounded scope has been entered", () => {
    expect(planBoundedExecution(manifest, ["bun", "scripts/validate-cell.ts", "--bounded"], true)).toEqual({ kind: "run" })
    expect(planBoundedExecution(null, ["bun", "scripts/validate-cell.ts", "--bounded"], true)).toEqual({ kind: "run" })
  })

  test("runs unbounded only when --bounded was never requested", () => {
    expect(planBoundedExecution(null, ["bun", "scripts/validate-cell.ts"], false)).toEqual({ kind: "run" })
  })
})

describe("validation cell receipt revocation", () => {
  test("withdraws a prior receipt and records why the invocation refused", async () => {
    const root = await repository({ staleReceipt: true })
    const receiptPath = join(root, manifest.artifacts.receiptPath)
    await writeFile(`${receiptPath}.staging`, '{"outcome":"passed"}\n')

    expect(await revokePublishedReceipt("bounded preflight refused\n", root)).toBe(true)

    expect(existsSync(receiptPath)).toBe(false)
    expect(existsSync(`${receiptPath}.staging`)).toBe(false)
    expect(await readFile(join(root, manifest.artifacts.errorsPath), "utf8")).toBe("bounded preflight refused\n")
  })

  test("reports that no proof was published when there was none to withdraw", async () => {
    const root = await repository()

    expect(await revokePublishedReceipt("", root)).toBe(false)
  })

  test("keeps the refusal the caller sees when errors.log cannot be written", async () => {
    const root = await repository({ staleReceipt: true, runtimeBundle: false })
    const errorsPath = join(root, manifest.artifacts.errorsPath)
    await mkdir(errorsPath, { recursive: true })

    await expect(runIn(root)).rejects.toThrow(/dist\/runtime\.js/)

    expect(existsSync(join(root, manifest.artifacts.receiptPath))).toBe(false)
  })
})
