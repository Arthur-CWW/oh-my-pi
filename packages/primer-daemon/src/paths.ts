import { homedir } from "node:os"
import { resolve } from "node:path"

export interface DaemonPaths {
  browserDb: string
  twitterDb: string
  readerDb: string
  ledgerDb: string
}

export function resolveDaemonPaths(env: Record<string, string | undefined> = {}): DaemonPaths {
  return {
    browserDb: env.PRIMER_BROWSER_DB ?? `${homedir()}/state/browser-context/browser_context.sqlite`,
    twitterDb: env.PRIMER_TWITTER_DB ?? resolve("data/twitter-archive/twitter-archive.sqlite"),
    readerDb:
      env.PRIMER_READER_DB ??
      resolve("streams/primer/wrapped-commentary-reader/site/meltdown-annotations.sqlite"),
    ledgerDb: env.PRIMER_LEDGER_DB ?? resolve("data/primer/daemon-ledger.sqlite"),
  }
}
