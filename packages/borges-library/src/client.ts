import { Effect, Result } from "effect"
import type { HttpClient } from "effect/unstable/http"
import { searchAnnaArchive } from "./anna-archive"
import { BlockedError, FetchError, NotFoundError, ParseError, DownloadError } from "./errors"
import { searchLibraryGenesis, downloadLibraryGenesis, type DownloadOptions, type SearchPreferences } from "./library-genesis"
import type { OpenSlumDiscoveryOptions } from "./mirrors"
import type { BookResult, DownloadResult } from "./schemas"

export type SearchError = FetchError | ParseError | NotFoundError | BlockedError
export interface BorgesSearchOptions extends SearchPreferences {
  retries?: number
  baseUrl?: string
  baseUrls?: readonly string[]
  annaBaseUrl?: string
  annaBaseUrls?: readonly string[]
  libgenBaseUrl?: string
  libgenBaseUrls?: readonly string[]
  mirrorDiscovery?: boolean | OpenSlumDiscoveryOptions
}

export type BorgesDownloadOptions = Pick<DownloadOptions, "baseUrl" | "retries">

export function searchBorgesLibrary(
  query: string,
  limit = 25,
  options: BorgesSearchOptions = {},
): Effect.Effect<BookResult[], SearchError, HttpClient.HttpClient> {
  return Effect.gen(function* () {
    const annaResult = yield* Effect.result(
      searchAnnaArchive({
        query,
        limit,
        baseUrl: options.annaBaseUrl,
        baseUrls: options.annaBaseUrls,
        mirrorDiscovery: options.mirrorDiscovery,
      }),
    )
    if (Result.isSuccess(annaResult)) {
      return annaResult.success
    }
    return yield* searchLibraryGenesis({
      query,
      limit,
      ...options,
      baseUrl: options.libgenBaseUrl ?? options.baseUrl,
      baseUrls: [...(options.libgenBaseUrls ?? []), ...(options.baseUrls ?? [])],
    })
  })
}

export function downloadBorgesLibrary(
  result: BookResult,
  outDir?: string,
  options: BorgesDownloadOptions = {},
): Effect.Effect<DownloadResult, FetchError | ParseError | DownloadError | BlockedError, HttpClient.HttpClient> {
  return downloadLibraryGenesis({ result, outDir, ...options })
}
