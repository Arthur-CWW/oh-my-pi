import { mkdirSync, readFileSync, statSync, unlinkSync, writeFileSync } from "node:fs"
import { dirname, isAbsolute, relative, resolve } from "node:path"

import {
  decodeValidationCellManifest,
  decodeValidationCellReceipt,
  type ValidationCellManifest,
  type ValidationCellReceipt,
} from "./validation-cell-contract"

export interface ValidationCellArtifactPaths {
  root: string
  errors: string
  network: string
  serverStdout: string
  serverStderr: string
  receipt: string
}

export interface ValidationCellContext {
  manifest: ValidationCellManifest
  artifacts: ValidationCellArtifactPaths
}

export type ValidationCellExecutor = (context: ValidationCellContext) => Promise<ValidationCellReceipt>

export interface RunValidationCellOptions {
  manifestPath: string
  repositoryRoot: string
  outputRoot?: string
  executor: ValidationCellExecutor
}

const ARTIFACT_KINDS = [
  ["errors", "errors"],
  ["network", "network"],
  ["serverStdout", "server-stdout"],
  ["serverStderr", "server-stderr"],
] as const

export async function runValidationCell(options: RunValidationCellOptions): Promise<ValidationCellReceipt> {
  const manifest = decodeValidationCellManifest(JSON.parse(readFileSync(options.manifestPath, "utf8")) as unknown)
  const outputRoot = options.outputRoot === undefined
    ? resolve(options.repositoryRoot, manifest.artifacts.root)
    : resolve(options.outputRoot)
  const artifacts = resolveArtifactPaths(outputRoot, manifest)

  mkdirSync(outputRoot, { recursive: true })
  mkdirSync(dirname(artifacts.receipt), { recursive: true })
  try {
    unlinkSync(artifacts.receipt)
  } catch (error) {
    if ((error as { code?: string }).code !== "ENOENT") throw error
  }
  for (const [key] of ARTIFACT_KINDS) {
    const path = artifacts[key]
    mkdirSync(dirname(path), { recursive: true })
    writeFileSync(path, "")
  }

  const executed = await options.executor({ manifest, artifacts })
  let receiptBytes = 0
  for (let attempt = 0; attempt < 8; attempt += 1) {
    const artifactsReceipt: Array<ValidationCellReceipt["artifacts"][number]> = ARTIFACT_KINDS.map(([manifestKey, kind]) => ({
      kind,
      path: manifest.artifacts.paths[manifestKey],
      bytes: statSync(artifacts[manifestKey]).size,
    }))
    artifactsReceipt.push({
      kind: "receipt",
      path: manifest.artifacts.paths.receipt,
      bytes: receiptBytes,
    })
    const candidate = decodeValidationCellReceipt({ ...executed, artifacts: artifactsReceipt })
    const text = `${JSON.stringify(candidate, null, 2)}\n`
    const nextBytes = Buffer.byteLength(text)
    if (nextBytes !== receiptBytes) {
      receiptBytes = nextBytes
      continue
    }

    const totalBytes = artifactsReceipt.reduce((sum, artifact) => sum + artifact.bytes, 0)
    if (totalBytes > manifest.artifacts.maxTotalBytes) {
      throw new Error(`validation artifacts exceeded ${manifest.artifacts.maxTotalBytes} bytes`)
    }
    writeFileSync(artifacts.receipt, text)
    return candidate
  }
  throw new Error("validation receipt size did not converge")
}

function resolveArtifactPaths(root: string, manifest: ValidationCellManifest): ValidationCellArtifactPaths {
  const artifactPaths = manifest.artifacts.paths
  const resolved = {
    root,
    errors: resolveContained(root, artifactPaths.errors),
    network: resolveContained(root, artifactPaths.network),
    serverStdout: resolveContained(root, artifactPaths.serverStdout),
    serverStderr: resolveContained(root, artifactPaths.serverStderr),
    receipt: resolveContained(root, artifactPaths.receipt),
  }
  const uniquePaths = new Set([resolved.errors, resolved.network, resolved.serverStdout, resolved.serverStderr, resolved.receipt])
  if (uniquePaths.size !== 5) throw new Error("validation artifact paths must be distinct")
  return resolved
}

function resolveContained(root: string, path: string): string {
  if (isAbsolute(path)) throw new Error("validation artifact paths must be relative")
  const candidate = resolve(root, path)
  const fromRoot = relative(root, candidate)
  if (fromRoot === "" || fromRoot === ".." || fromRoot.startsWith(`..${process.platform === "win32" ? "\\" : "/"}`) || isAbsolute(fromRoot)) {
    throw new Error(`validation artifact path escapes output root: ${path}`)
  }
  return candidate
}
