import { homedir } from "node:os"
import { dirname, resolve } from "node:path"
import { fileURLToPath } from "node:url"

/** Repo root (~/agents), derived from this module's location so defaults are cwd-independent. */
const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..", "..")

export interface DaemonPaths {
  browserDb: string
  twitterDb: string
  readerDb: string
  learningCardsDb: string
  readerSite: string
  ledgerDb: string
  cedictDb: string
  generationStore: string
  shadowingDir: string
}

export function resolveDaemonPaths(env: Record<string, string | undefined> = {}): DaemonPaths {
  return {
    browserDb: env.PRIMER_BROWSER_DB ?? `${homedir()}/state/browser-context/browser_context.sqlite`,
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
    cedictDb: env.PRIMER_CEDICT_DB ?? resolve(REPO_ROOT, "data/primer/cedict.sqlite"),
    generationStore: env.PRIMER_GENERATION_STORE ?? resolve(REPO_ROOT, "data/primer/generation-store.sqlite"),
    shadowingDir: env.PRIMER_SHADOWING_DIR ?? resolve(REPO_ROOT, "data/primer/shadowing"),
  }
}
