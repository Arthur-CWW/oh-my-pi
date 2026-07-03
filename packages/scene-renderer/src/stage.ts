import { mkdir, copyFile, readdir, rm, stat } from "node:fs/promises"
import { basename, dirname, extname, isAbsolute, join, resolve } from "node:path"
import { spawn } from "node:child_process"
import type { SceneAsset, SceneSpec } from "./schema"

export interface StageOptions {
  readonly outDir: string
  readonly sceneDir?: string
}

export interface StageResult {
  readonly spec: SceneSpec
  readonly publicDir: string
  readonly audioFilePath?: string
}

interface StagedAsset {
  readonly asset: SceneAsset
  readonly absolutePath: string
  readonly stagedPath: string
  readonly publicPath: string
}

interface ResolvedAsset {
  readonly asset: SceneAsset
  readonly index: number
  readonly absolutePath: string
}

export async function stageAssets(spec: SceneSpec, options: StageOptions): Promise<StageResult> {
  const publicDir = join(options.outDir, "public")
  const assetsDir = join(publicDir, "assets")
  const sceneDir = options.sceneDir ?? process.cwd()
  const resolvedAssets: ResolvedAsset[] = []
  for (let index = 0; index < spec.assets.length; index += 1) {
    const asset = spec.assets[index]
    resolvedAssets.push({ asset, index, absolutePath: await resolveAssetPath(asset.path, sceneDir) })
  }

  await rm(assetsDir, { recursive: true, force: true })
  await mkdir(assetsDir, { recursive: true })

  const stagedByKey = new Map<string, StagedAsset>()
  const rewrittenAssets: SceneAsset[] = []

  for (const { asset, index, absolutePath } of resolvedAssets) {
    const dedupeKey = `${asset.kind}:${absolutePath}`
    const existing = stagedByKey.get(dedupeKey)
    if (existing) {
      rewrittenAssets.push({ ...asset, path: existing.stagedPath, frameCount: existing.asset.frameCount })
      continue
    }

    const stem = stagedStem(index, asset.path, asset.kind)
    const stagedPath = `assets/${stem}`
    const publicPath = join(assetsDir, stem)
    let rewritten: SceneAsset

    if (asset.kind === "videoFrames") {
      await mkdir(publicPath, { recursive: true })
      await extractVideoFrames(absolutePath, publicPath, spec.fps)
      const frameCount = await countPngFrames(publicPath)
      rewritten = { ...asset, path: stagedPath, frameCount }
    } else {
      await copyFile(absolutePath, publicPath)
      rewritten = { ...asset, path: stagedPath }
    }

    stagedByKey.set(dedupeKey, { asset: rewritten, absolutePath, stagedPath, publicPath })
    rewrittenAssets.push(rewritten)
  }

  const stagedSpec: SceneSpec = { ...spec, assets: rewrittenAssets }
  const audioFilePath = spec.audio ? findStagedAudioPath(stagedSpec.assets, stagedByKey, spec.audio.asset) : undefined
  return { spec: stagedSpec, publicDir, audioFilePath }
}

function findStagedAudioPath(
  assets: readonly SceneAsset[],
  stagedByKey: ReadonlyMap<string, StagedAsset>,
  audioAssetId: string,
): string | undefined {
  const stagedAsset = assets.find((asset) => asset.id === audioAssetId && asset.kind === "audio")
  if (!stagedAsset) return undefined

  for (const entry of stagedByKey.values()) {
    if (entry.stagedPath === stagedAsset.path) return entry.publicPath
  }
  return undefined
}

async function resolveAssetPath(assetPath: string, sceneDir: string): Promise<string> {
  if (isAbsolute(assetPath)) return assetPath

  const specRelativePath = resolve(sceneDir, assetPath)
  const repoRoot = await findRepoRoot(sceneDir)
  if (repoRoot) {
    const repoRelativePath = resolve(repoRoot, assetPath)
    if (await pathExists(repoRelativePath)) return repoRelativePath
    if (await pathExists(specRelativePath)) return specRelativePath
    throw new Error(`asset path '${assetPath}' not found; tried:\n${repoRelativePath}\n${specRelativePath}`)
  }

  if (await pathExists(specRelativePath)) return specRelativePath
  throw new Error(`asset path '${assetPath}' not found; tried:\n${specRelativePath}`)
}

async function findRepoRoot(startDir: string): Promise<string | undefined> {
  let current = resolve(startDir)
  for (let depth = 0; depth < 12; depth += 1) {
    if (await pathExists(join(current, ".git"))) return current
    const parent = dirname(current)
    if (parent === current) return undefined
    current = parent
  }
  return undefined
}

async function pathExists(path: string): Promise<boolean> {
  try {
    await stat(path)
    return true
  } catch (error) {
    if (error instanceof Error && "code" in error && error.code === "ENOENT") return false
    throw error
  }
}

function stagedStem(index: number, assetPath: string, kind: SceneAsset["kind"]): string {
  const rawBase = basename(assetPath)
  const base = kind === "videoFrames" ? rawBase.slice(0, rawBase.length - extname(rawBase).length) : rawBase
  const sanitized = base.replace(/[^A-Za-z0-9._-]+/g, "_").replace(/^_+|_+$/g, "")
  return `${index}-${sanitized.length > 0 ? sanitized : "asset"}`
}

async function extractVideoFrames(inputPath: string, outputDir: string, fps: number): Promise<void> {
  await runProcess("ffmpeg", ["-y", "-i", inputPath, "-vf", `fps=${fps}`, join(outputDir, "%06d.png")], dirname(outputDir))
}

async function countPngFrames(dir: string): Promise<number> {
  const entries = await readdir(dir)
  return entries.filter((entry) => entry.endsWith(".png")).length
}

export async function runProcess(command: string, args: readonly string[], cwd: string): Promise<void> {
  const child = spawn(command, args, { cwd, stdio: ["ignore", "pipe", "pipe"] })
  const stdoutChunks: Buffer[] = []
  const stderrChunks: Buffer[] = []
  child.stdout.on("data", (chunk: Buffer) => stdoutChunks.push(chunk))
  child.stderr.on("data", (chunk: Buffer) => stderrChunks.push(chunk))

  const code = await new Promise<number | null>((resolveCode, reject) => {
    child.on("error", reject)
    child.on("close", resolveCode)
  })

  if (code !== 0) {
    const stdout = Buffer.concat(stdoutChunks).toString("utf8").trim()
    const stderr = Buffer.concat(stderrChunks).toString("utf8").trim()
    const detail = [stdout, stderr].filter((part) => part.length > 0).join("\n")
    throw new Error(`${command} exited ${code}${detail.length > 0 ? `\n${detail}` : ""}`)
  }
}
