import { Schema } from "effect"

export const UseCase = Schema.Union([
  Schema.Literal("search-quality-research"),
  Schema.Literal("availability-monitoring"),
  Schema.Literal("ad-verification"),
  Schema.Literal("credential-stuffing"),
  Schema.Literal("scraping-paywalled-content"),
  Schema.Literal("spam"),
])
export type UseCase = typeof UseCase.Type

export const SyntheticRequestJob = Schema.Struct({
  id: Schema.String,
  customerId: Schema.String,
  deviceId: Schema.String,
  destinationHost: Schema.String,
  useCase: UseCase,
  syntheticBytesUp: Schema.Number,
  syntheticBytesDown: Schema.Number,
})
export type SyntheticRequestJob = typeof SyntheticRequestJob.Type

export const CustomerPolicy = Schema.Struct({
  customerId: Schema.String,
  approvedUseCases: Schema.Array(UseCase),
  deniedDestinations: Schema.Array(Schema.String),
})
export type CustomerPolicy = typeof CustomerPolicy.Type

export const KillSwitches = Schema.Struct({
  global: Schema.Boolean,
  customerIds: Schema.Array(Schema.String),
  deviceIds: Schema.Array(Schema.String),
  destinationHosts: Schema.Array(Schema.String),
})
export type KillSwitches = typeof KillSwitches.Type

export const AbuseDecision = Schema.Struct({
  allowed: Schema.Boolean,
  code: Schema.Union([
    Schema.Literal("allowed"),
    Schema.Literal("global-kill-switch"),
    Schema.Literal("customer-kill-switch"),
    Schema.Literal("device-kill-switch"),
    Schema.Literal("destination-kill-switch"),
    Schema.Literal("customer-policy-missing"),
    Schema.Literal("prohibited-use-case"),
    Schema.Literal("use-case-not-approved"),
    Schema.Literal("destination-denied"),
  ]),
  reason: Schema.String,
})
export type AbuseDecision = typeof AbuseDecision.Type

export const prohibitedUseCases: ReadonlySet<UseCase> = new Set([
  "credential-stuffing",
  "scraping-paywalled-content",
  "spam",
])

export function createKillSwitches(overrides: Partial<KillSwitches> = {}): KillSwitches {
  return {
    global: overrides.global ?? false,
    customerIds: overrides.customerIds ?? [],
    deviceIds: overrides.deviceIds ?? [],
    destinationHosts: overrides.destinationHosts ?? [],
  }
}

export function evaluateAbusePolicy(
  job: SyntheticRequestJob,
  customerPolicy: CustomerPolicy | undefined,
  killSwitches: KillSwitches,
): AbuseDecision {
  if (killSwitches.global) {
    return deny("global-kill-switch", "Global simulator kill switch is active")
  }

  if (killSwitches.customerIds.includes(job.customerId)) {
    return deny("customer-kill-switch", "Customer kill switch is active")
  }

  if (killSwitches.deviceIds.includes(job.deviceId)) {
    return deny("device-kill-switch", "Device kill switch is active")
  }

  if (killSwitches.destinationHosts.includes(job.destinationHost)) {
    return deny("destination-kill-switch", "Destination kill switch is active")
  }

  if (customerPolicy === undefined) {
    return deny("customer-policy-missing", "Customer policy is required")
  }

  if (prohibitedUseCases.has(job.useCase)) {
    return deny("prohibited-use-case", "Use case is prohibited by abuse policy")
  }

  if (!customerPolicy.approvedUseCases.includes(job.useCase)) {
    return deny("use-case-not-approved", "Use case is not approved for customer")
  }

  if (customerPolicy.deniedDestinations.includes(job.destinationHost)) {
    return deny("destination-denied", "Destination is denied for customer")
  }

  return {
    allowed: true,
    code: "allowed",
    reason: "Synthetic request is permitted by simulator policy",
  }
}

function deny(code: AbuseDecision["code"], reason: string): AbuseDecision {
  return { allowed: false, code, reason }
}
