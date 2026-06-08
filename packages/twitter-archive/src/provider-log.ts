import { appendJsonl } from "./jsonl"
import { nowIso, stableId } from "./normalize"

export type ProviderRunStatus =
  | "planned"
  | "cache_hit"
  | "cache_miss"
  | "submitted"
  | "completed"
  | "failed"
  | "skipped"

export type ProviderCacheStatus = "hit" | "miss" | "bypass" | "write" | "unknown"

export interface ProviderRunCacheInfo {
  status: ProviderCacheStatus
  key?: string
  reason?: string
}

export interface ProviderRunPricingInfo {
  currency?: "USD" | string
  estimatedCostUsd?: number
  billedCostUsd?: number
  inputTokens?: number
  outputTokens?: number
  inputPricePerMillionTokensUsd?: number
  outputPricePerMillionTokensUsd?: number
  rawPricing?: unknown
}

export interface ProviderRunErrorInfo {
  code?: string
  message: string
  retryable?: boolean
  raw?: unknown
}

export interface ProviderRunLogEntry {
  id: string
  createdAt: string
  task: string
  provider: string
  model?: string
  route?: string
  modality?: string
  status: ProviderRunStatus
  requestHash?: string
  cache?: ProviderRunCacheInfo
  pricing?: ProviderRunPricingInfo
  inputArtifactPaths?: string[]
  outputArtifactPaths?: string[]
  error?: ProviderRunErrorInfo
  notes?: string
}

export interface CreateProviderRunLogInput extends Omit<ProviderRunLogEntry, "id" | "createdAt"> {
  id?: string
  createdAt?: string
}

export function stableProviderRequestHash(value: unknown): string {
  return stableId([stableStringify(value)])
}

export function createProviderRunLogEntry(input: CreateProviderRunLogInput): ProviderRunLogEntry {
  const createdAt = input.createdAt ?? nowIso()
  const requestHash = input.requestHash
  const id =
    input.id ??
    `provider_${createdAt.replace(/[^0-9]/g, "").slice(0, 14)}_${stableId([
      input.task,
      input.provider,
      input.model ?? "",
      input.route ?? "",
      input.status,
      requestHash ?? "",
      createdAt,
    ]).slice(0, 10)}`

  return {
    ...input,
    id,
    createdAt,
    ...(requestHash ? { requestHash } : {}),
  }
}

export async function appendProviderRunLog(
  filePath: string,
  entries: ProviderRunLogEntry | readonly ProviderRunLogEntry[],
): Promise<void> {
  await appendJsonl(filePath, entries)
}

function stableStringify(value: unknown): string {
  if (value === null || typeof value !== "object") {
    return JSON.stringify(value)
  }

  if (Array.isArray(value)) {
    return `[${value.map((item) => stableStringify(item)).join(",")}]`
  }

  const object = value as Record<string, unknown>
  const entries = Object.keys(object)
    .sort()
    .map((key) => `${JSON.stringify(key)}:${stableStringify(object[key])}`)
  return `{${entries.join(",")}}`
}
