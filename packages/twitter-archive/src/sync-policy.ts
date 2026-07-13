import { join } from "node:path"
import { fileURLToPath } from "node:url"
import { Schema } from "effect"

const PACKAGE_ROOT = fileURLToPath(new URL("..", import.meta.url))
export const DEFAULT_SYNC_POLICY_PATH = join(PACKAGE_ROOT, "corpus", "accounts.json")

export const SyncTierSchema = Schema.Literals(["corpus", "news"])
export type SyncTier = typeof SyncTierSchema.Type

const AccountPolicySchema = Schema.Struct({
  handle: Schema.String,
  tier: SyncTierSchema,
})

const MirrorPolicySchema = Schema.Struct({
  url: Schema.String,
  capacity: Schema.Number,
  refillPerHour: Schema.Number,
})

const TierPolicySchema = Schema.Struct({
  cadenceMinutes: Schema.Number,
  pagesPerTick: Schema.Number,
})

const SyncPolicySchema = Schema.Struct({
  version: Schema.Literal(1),
  maxAccountsPerTick: Schema.Number,
  delayMs: Schema.Number,
  jitterMs: Schema.Number,
  mirrors: Schema.Array(MirrorPolicySchema),
  tiers: Schema.Struct({
    corpus: TierPolicySchema,
    news: TierPolicySchema,
  }),
  accounts: Schema.Array(AccountPolicySchema),
})

export type SyncAccountPolicy = typeof AccountPolicySchema.Type
export type SyncMirrorPolicy = typeof MirrorPolicySchema.Type
export type SyncPolicy = typeof SyncPolicySchema.Type

export async function loadSyncPolicy(path = DEFAULT_SYNC_POLICY_PATH): Promise<SyncPolicy> {
  const text = await Bun.file(path).text()
  const policy = Schema.decodeUnknownSync(Schema.fromJsonString(SyncPolicySchema))(text)
  validatePolicy(policy)
  return policy
}

function validatePolicy(policy: SyncPolicy): void {
  positiveInteger(policy.maxAccountsPerTick, "maxAccountsPerTick")
  nonNegative(policy.delayMs, "delayMs")
  nonNegative(policy.jitterMs, "jitterMs")
  positiveInteger(policy.tiers.corpus.pagesPerTick, "tiers.corpus.pagesPerTick")
  positiveInteger(policy.tiers.news.pagesPerTick, "tiers.news.pagesPerTick")
  positive(policy.tiers.corpus.cadenceMinutes, "tiers.corpus.cadenceMinutes")
  positive(policy.tiers.news.cadenceMinutes, "tiers.news.cadenceMinutes")
  if (policy.mirrors.length === 0) throw new Error("sync policy requires at least one mirror")
  if (policy.accounts.length === 0) throw new Error("sync policy requires at least one account")

  const handles = new Set<string>()
  for (const account of policy.accounts) {
    const handle = account.handle.replace(/^@/, "").trim().toLowerCase()
    if (!handle) throw new Error("sync policy account handle must not be empty")
    if (handles.has(handle)) throw new Error(`duplicate sync policy account: ${handle}`)
    handles.add(handle)
  }
  const mirrors = new Set<string>()
  for (const mirror of policy.mirrors) {
    const url = new URL(mirror.url)
    if (url.protocol !== "https:" && url.protocol !== "http:") throw new Error(`unsupported mirror protocol: ${url.protocol}`)
    if (mirrors.has(url.origin)) throw new Error(`duplicate sync mirror: ${url.origin}`)
    mirrors.add(url.origin)
    positive(mirror.capacity, `mirror ${url.origin} capacity`)
    positive(mirror.refillPerHour, `mirror ${url.origin} refillPerHour`)
  }
}

function positiveInteger(value: number, name: string): void {
  if (!Number.isSafeInteger(value) || value <= 0) throw new Error(`${name} must be a positive integer`)
}

function positive(value: number, name: string): void {
  if (!Number.isFinite(value) || value <= 0) throw new Error(`${name} must be positive`)
}

function nonNegative(value: number, name: string): void {
  if (!Number.isFinite(value) || value < 0) throw new Error(`${name} must be non-negative`)
}
