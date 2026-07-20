import { randomBytes } from "node:crypto"
import { closeSync, chmodSync, constants, fstatSync, fsyncSync, lstatSync, mkdirSync, openSync, readFileSync, writeSync } from "node:fs"
import { homedir } from "node:os"
import { dirname, resolve } from "node:path"
import { fileURLToPath } from "node:url"

/** Repo root (~/agents), derived from this module's location so defaults are cwd-independent. */
const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..", "..")

export interface DaemonPaths {
  browserDb: string
  browserContextDb: string
  browserContextSocket: string
  browserContextArtifacts: string
  browserContextManifests: string
  dashboardAuthSecret: string
  twitterDb: string
  readerDb: string
  learningCardsDb: string
  readerSite: string
  ledgerDb: string
  reviewFeed: string
  errorLog: string
  ankiProfile: string
  cedictDb: string
  zhdictDb?: string
  hanlyDb?: string
  generationStore: string
  shadowingDir: string
  readerMediaDir: string
}

export function resolveDaemonPaths(env: Record<string, string | undefined> = {}): DaemonPaths {
  const home = env.HOME ?? homedir()
  const browserContextRoot = env.PRIMER_BROWSER_CONTEXT_DIR ?? resolve(home, "state/browser-context")
  return {
    browserDb: env.PRIMER_BROWSER_DB ?? resolve(browserContextRoot, "browser_context.sqlite"),
    browserContextDb: env.PRIMER_BROWSER_CONTEXT_DB ?? resolve(browserContextRoot, "primer-browser-context.sqlite"),
    browserContextSocket: env.PRIMER_BROWSER_CONTEXT_SOCKET ?? resolve(browserContextRoot, "browser-context.sock"),
    browserContextArtifacts: env.PRIMER_BROWSER_CONTEXT_ARTIFACTS ?? resolve(browserContextRoot, "artifacts"),
    browserContextManifests: env.PRIMER_BROWSER_CONTEXT_MANIFESTS ?? resolve(browserContextRoot, "manifests"),
    dashboardAuthSecret: env.PRIMER_DASHBOARD_AUTH_SECRET_FILE ?? resolve(browserContextRoot, "dashboard-auth-secret"),
    twitterDb: env.PRIMER_TWITTER_DB ?? resolve(REPO_ROOT, "data/twitter-archive/twitter-archive.sqlite"),
    readerDb:
      env.PRIMER_READER_DB ??
      resolve(REPO_ROOT, "streams/primer/wrapped-commentary-reader/site/meltdown-annotations.sqlite"),
    learningCardsDb:
      env.PRIMER_CARDS_DB ??
      resolve(REPO_ROOT, "streams/primer/wrapped-commentary-reader/artifacts/learning-card-system/learning-card-system.sqlite"),
    readerSite:
      env.PRIMER_READER_SITE ?? resolve(REPO_ROOT, "streams/primer/wrapped-commentary-reader/site"),
    ledgerDb: env.PRIMER_LEDGER_DB ?? resolve(REPO_ROOT, "data/primer/daemon-ledger.sqlite"),
    reviewFeed: env.PRIMER_REVIEW_FEED ?? resolve(REPO_ROOT, "data/xanadu/feed.jsonl"),
    errorLog: env.PRIMER_ERROR_LOG ?? resolve(REPO_ROOT, "data/primer/errors.log"),
    ankiProfile: env.PRIMER_ANKI_PROFILE ?? resolve(REPO_ROOT, "data/primer/anki-reviewed.json"),
    cedictDb: env.PRIMER_CEDICT_DB ?? resolve(REPO_ROOT, "data/primer/cedict.sqlite"),
    zhdictDb: env.PRIMER_ZHDICT_DB ?? resolve(REPO_ROOT, "data/primer/zhdict.sqlite"),
    generationStore: env.PRIMER_GENERATION_STORE ?? resolve(REPO_ROOT, "data/primer/generation-store.sqlite"),
    shadowingDir: env.PRIMER_SHADOWING_DIR ?? resolve(REPO_ROOT, "data/primer/shadowing"),
    readerMediaDir: env.PRIMER_READER_MEDIA_DIR ?? resolve(REPO_ROOT, "data/primer/reader-media"),
    hanlyDb: env.PRIMER_HANLY_DB ?? resolve(home, "apps/hsk-deck/hanly-re/output/hanly-content.sqlite"),
  }
}

export function ensureDaemonDirectories(paths: DaemonPaths): void {
  const directories = new Set([
    dirname(paths.browserDb),
    dirname(paths.browserContextDb),
    dirname(paths.browserContextSocket),
    paths.browserContextArtifacts,
    paths.browserContextManifests,
    dirname(paths.dashboardAuthSecret),
  ])
  for (const directory of directories) ensureOwnerOnlyDirectory(directory)
}

export function readDaemonOwnerSecret(paths: Pick<DaemonPaths, "dashboardAuthSecret">): string {
  const path = paths.dashboardAuthSecret
  ensureOwnerOnlyDirectory(dirname(path))
  let descriptor: number
  let created = false
  try {
    descriptor = openSync(
      path,
      constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | constants.O_NOFOLLOW,
      0o600,
    )
    created = true
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error
    descriptor = openSync(path, constants.O_RDONLY | constants.O_NOFOLLOW)
  }
  try {
    const stats = fstatSync(descriptor)
    const getuid = process.getuid
    if (
      !stats.isFile()
      || getuid === undefined
      || stats.uid !== getuid()
      || (stats.mode & 0o077) !== 0
    ) {
      throw new Error(`Dashboard credential is not an owner-only regular file: ${path}`)
    }
    if (created) {
      const secret = randomBytes(32).toString("base64url")
      if (writeSync(descriptor, secret) !== secret.length) {
        throw new Error(`Dashboard credential could not be written completely: ${path}`)
      }
      fsyncSync(descriptor)
      return secret
    }
    const secret = readFileSync(descriptor, "utf8")
    if (!/^[A-Za-z0-9_-]{43}$/u.test(secret)) {
      throw new Error(`Dashboard credential is malformed: ${path}`)
    }
    return secret
  } finally {
    closeSync(descriptor)
  }
}

function ensureOwnerOnlyDirectory(path: string): void {
  mkdirSync(path, { recursive: true, mode: 0o700 })
  const stats = lstatSync(path)
  if (!stats.isDirectory() || stats.isSymbolicLink()) {
    throw new Error(`Browser Context state path is not a directory: ${path}`)
  }
  const getuid = process.getuid
  if (getuid === undefined || stats.uid !== getuid()) {
    throw new Error(`Browser Context state directory is not owned by the current user: ${path}`)
  }
  chmodSync(path, 0o700)
}
