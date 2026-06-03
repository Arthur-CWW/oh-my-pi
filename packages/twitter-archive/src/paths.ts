import { mkdir } from "node:fs/promises"
import { join, resolve } from "node:path"

import { ENTITY_FILE_NAMES, type ArchiveEntityName } from "./schema"

export interface ArchiveRootOptions {
  /** Defaults to data/twitter-archive. */
  baseDir?: string
  /** Optional target namespace, e.g. pleometric. */
  target?: string
  /** Explicit archive root. If set, baseDir/target are ignored. */
  root?: string
}

export interface ArchivePaths {
  root: string
  rawDir: string
  rawFrontendDir: string
  rawToolRunsDir: string
  rawApiDir: string
  entitiesDir: string
  entityFiles: Record<ArchiveEntityName, string>
  mediaDir: string
  imagesDir: string
  videosDir: string
  indexesDir: string
  cacheDir: string
  logsDir: string
}

export function sanitizeArchiveTarget(target: string): string {
  const sanitized = target
    .trim()
    .replace(/^@+/, "")
    .toLowerCase()
    .replace(/[^a-z0-9_.-]+/g, "-")
    .replace(/^-+|-+$/g, "")

  if (sanitized.length === 0) {
    throw new Error("Archive target cannot be empty")
  }

  return sanitized
}

export function resolveArchiveRoot(options: ArchiveRootOptions = {}): string {
  if (options.root) {
    return resolve(options.root)
  }

  const baseDir = options.baseDir ?? "data/twitter-archive"
  if (!options.target) {
    return resolve(baseDir)
  }

  return resolve(baseDir, sanitizeArchiveTarget(options.target))
}

export function archivePaths(root: string): ArchivePaths {
  const entitiesDir = join(root, "entities")

  return {
    root,
    rawDir: join(root, "raw"),
    rawFrontendDir: join(root, "raw", "frontend"),
    rawToolRunsDir: join(root, "raw", "tool-runs"),
    rawApiDir: join(root, "raw", "api"),
    entitiesDir,
    entityFiles: {
      users: join(entitiesDir, ENTITY_FILE_NAMES.users),
      tweets: join(entitiesDir, ENTITY_FILE_NAMES.tweets),
      media: join(entitiesDir, ENTITY_FILE_NAMES.media),
      conversations: join(entitiesDir, ENTITY_FILE_NAMES.conversations),
      archiveRuns: join(entitiesDir, ENTITY_FILE_NAMES.archiveRuns),
      labels: join(entitiesDir, ENTITY_FILE_NAMES.labels),
      notes: join(entitiesDir, ENTITY_FILE_NAMES.notes),
    },
    mediaDir: join(root, "media"),
    imagesDir: join(root, "media", "images"),
    videosDir: join(root, "media", "videos"),
    indexesDir: join(root, "indexes"),
    cacheDir: join(root, "cache"),
    logsDir: join(root, "logs"),
  }
}

export function archivePathsForTarget(target: string, baseDir = "data/twitter-archive"): ArchivePaths {
  return archivePaths(resolveArchiveRoot({ baseDir, target }))
}

export async function ensureArchiveLayout(paths: ArchivePaths): Promise<void> {
  await Promise.all([
    mkdir(paths.rawFrontendDir, { recursive: true }),
    mkdir(paths.rawToolRunsDir, { recursive: true }),
    mkdir(paths.rawApiDir, { recursive: true }),
    mkdir(paths.entitiesDir, { recursive: true }),
    mkdir(paths.imagesDir, { recursive: true }),
    mkdir(paths.videosDir, { recursive: true }),
    mkdir(paths.indexesDir, { recursive: true }),
    mkdir(paths.cacheDir, { recursive: true }),
    mkdir(paths.logsDir, { recursive: true }),
  ])
}
