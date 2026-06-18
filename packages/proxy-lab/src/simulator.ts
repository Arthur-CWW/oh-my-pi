import { Schema } from "effect"
import {
  type SyntheticRequestJob,
  type CustomerPolicy,
  type KillSwitches,
  type AbuseDecision,
  evaluateAbusePolicy,
} from "./policy.ts"
import {
  BandwidthLedgerEntry,
  type ParticipantAccounting,
  type CompensationRate,
  createBandwidthLedgerEntry,
  summarizeParticipantAccounting,
  defaultCompensationRate,
} from "./accounting.ts"

export const ConsentRecord = Schema.Struct({
  participantId: Schema.String,
  deviceId: Schema.String,
  consentedAt: Schema.Date,
  revokedAt: Schema.Union([Schema.Date, Schema.Null]),
  ipAddress: Schema.String,
  status: Schema.Union([Schema.Literal("consented"), Schema.Literal("revoked")]),
})
export type ConsentRecord = typeof ConsentRecord.Type

export const JobDecisionCode = Schema.Union([
  Schema.Literal("allowed"),
  Schema.Literal("global-kill-switch"),
  Schema.Literal("customer-kill-switch"),
  Schema.Literal("device-kill-switch"),
  Schema.Literal("destination-kill-switch"),
  Schema.Literal("customer-policy-missing"),
  Schema.Literal("prohibited-use-case"),
  Schema.Literal("use-case-not-approved"),
  Schema.Literal("destination-denied"),
  Schema.Literal("consent-required"),
  Schema.Literal("consent-revoked"),
])
export type JobDecisionCode = typeof JobDecisionCode.Type

export const JobDecision = Schema.Struct({
  allowed: Schema.Boolean,
  code: JobDecisionCode,
  reason: Schema.String,
})
export type JobDecision = typeof JobDecision.Type

export const JobExecutionResult = Schema.Struct({
  jobId: Schema.String,
  allowed: Schema.Boolean,
  decision: JobDecision,
  ledgerEntry: Schema.Union([BandwidthLedgerEntry, Schema.Null]),
})
export type JobExecutionResult = typeof JobExecutionResult.Type

export class ProxySimulator {
  private consentRecords: ConsentRecord[] = []
  private customerPolicies: Map<string, CustomerPolicy> = new Map()
  private killSwitches: KillSwitches
  private ledgerEntries: BandwidthLedgerEntry[] = []

  constructor(killSwitches?: Partial<KillSwitches>) {
    this.killSwitches = {
      global: killSwitches?.global ?? false,
      customerIds: killSwitches?.customerIds ?? [],
      deviceIds: killSwitches?.deviceIds ?? [],
      destinationHosts: killSwitches?.destinationHosts ?? [],
    }
  }

  // Consent Management
  grantConsent(participantId: string, deviceId: string, ipAddress: string): ConsentRecord {
    const record: ConsentRecord = {
      participantId,
      deviceId,
      consentedAt: new Date(),
      revokedAt: null,
      ipAddress,
      status: "consented",
    }
    this.consentRecords.push(record)
    return record
  }

  revokeConsent(participantId: string, deviceId: string): ConsentRecord {
    const existing = this.getConsentRecord(deviceId)
    const record: ConsentRecord = {
      participantId,
      deviceId,
      consentedAt: existing ? existing.consentedAt : new Date(),
      revokedAt: new Date(),
      ipAddress: existing ? existing.ipAddress : "0.0.0.0",
      status: "revoked",
    }
    this.consentRecords.push(record)
    return record
  }

  getConsentRecord(deviceId: string): ConsentRecord | undefined {
    // Find the latest consent record for this deviceId
    for (let i = this.consentRecords.length - 1; i >= 0; i--) {
      if (this.consentRecords[i].deviceId === deviceId) {
        return this.consentRecords[i]
      }
    }
    return undefined
  }

  hasConsent(deviceId: string): boolean {
    const record = this.getConsentRecord(deviceId)
    return record?.status === "consented"
  }

  // Customer Policies
  setCustomerPolicy(policy: CustomerPolicy): void {
    this.customerPolicies.set(policy.customerId, policy)
  }

  getCustomerPolicy(customerId: string): CustomerPolicy | undefined {
    return this.customerPolicies.get(customerId)
  }

  // Kill Switches
  updateKillSwitches(overrides: Partial<KillSwitches>): void {
    this.killSwitches = {
      global: overrides.global ?? this.killSwitches.global,
      customerIds: overrides.customerIds ?? this.killSwitches.customerIds,
      deviceIds: overrides.deviceIds ?? this.killSwitches.deviceIds,
      destinationHosts: overrides.destinationHosts ?? this.killSwitches.destinationHosts,
    }
  }

  getKillSwitches(): KillSwitches {
    return this.killSwitches
  }

  // Ledger / Accounting
  getLedgerEntries(): readonly BandwidthLedgerEntry[] {
    return this.ledgerEntries
  }

  getParticipantAccounting(
    participantId: string,
    deviceId: string,
    rate: CompensationRate = defaultCompensationRate
  ): ParticipantAccounting {
    return summarizeParticipantAccounting(participantId, deviceId, this.ledgerEntries, rate)
  }

  // Execution
  executeJob(job: SyntheticRequestJob): JobExecutionResult {
    // 1. Consent check
    const consent = this.getConsentRecord(job.deviceId)
    if (!consent) {
      const decision: JobDecision = {
        allowed: false,
        code: "consent-required",
        reason: `Consent required: Device ${job.deviceId} has not opted-in`,
      }
      return {
        jobId: job.id,
        allowed: false,
        decision,
        ledgerEntry: null,
      }
    }

    if (consent.status === "revoked") {
      const decision: JobDecision = {
        allowed: false,
        code: "consent-revoked",
        reason: `Consent revoked: Device ${job.deviceId} has opted-out`,
      }
      return {
        jobId: job.id,
        allowed: false,
        decision,
        ledgerEntry: null,
      }
    }

    // 2. Abuse Policy check
    const customerPolicy = this.getCustomerPolicy(job.customerId)
    const decision: AbuseDecision = evaluateAbusePolicy(job, customerPolicy, this.killSwitches)

    // 3. Accounting
    const ledgerEntry = createBandwidthLedgerEntry(job, consent.participantId, decision.allowed)
    this.ledgerEntries.push(ledgerEntry)

    return {
      jobId: job.id,
      allowed: decision.allowed,
      decision,
      ledgerEntry,
    }
  }
}
