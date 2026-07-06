import { homedir } from "node:os"
import { dirname, resolve } from "node:path"
import { fileURLToPath } from "node:url"

/** Repo root (~/agents), derived from this module's location so defaults are cwd-independent. */
const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..", "..")

export interface DaemonPaths {
  browserDb: string
  twitterDb: string
  readerDb: string
  readerSite: string
  ledgerDb: string
}

export function resolveDaemonPaths(env: Record<string, string | undefined> = {}): DaemonPaths {
  return {
    browserDb: env.PRIMER_BROWSER_DB ?? `${homedir()}/state/browser-context/browser_context.sqlite`,
    twitterDb: env.PRIMER_TWITTER_DB ?? resolve(REPO_ROOT, "data/twitter-archive/twitter-archive.sqlite"),
    readerDb:
      env.PRIMER_READER_DB ??
      resolve(REPO_ROOT, "streams/primer/wrapped-commentary-reader/site/meltdown-annotations.sqlite"),
    readerSite:
      env.PRIMER_READER_SITE ?? resolve(REPO_ROOT, "streams/primer/wrapped-commentary-reader/site"),
    ledgerDb: env.PRIMER_LEDGER_DB ?? resolve(REPO_ROOT, "data/primer/daemon-ledger.sqlite"),
  }
}
