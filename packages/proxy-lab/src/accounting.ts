import { Schema } from "effect"

import type { SyntheticRequestJob } from "./policy.ts"

export const BandwidthLedgerEntry = Schema.Struct({
  jobId: Schema.String,
  participantId: Schema.String,
  deviceId: Schema.String,
  customerId: Schema.String,
  destinationHost: Schema.String,
  syntheticBytesUp: Schema.Number,
  syntheticBytesDown: Schema.Number,
  billable: Schema.Boolean,
})
export type BandwidthLedgerEntry = typeof BandwidthLedgerEntry.Type

export const ParticipantAccounting = Schema.Struct({
  participantId: Schema.String,
  deviceId: Schema.String,
  syntheticBytesUp: Schema.Number,
  syntheticBytesDown: Schema.Number,
  totalSyntheticBytes: Schema.Number,
  compensationEstimateCents: Schema.Number,
})
export type ParticipantAccounting = typeof ParticipantAccounting.Type

export interface CompensationRate {
  readonly centsPerSyntheticGiB: number
}

export const defaultCompensationRate: CompensationRate = {
  centsPerSyntheticGiB: 125,
}

const BYTES_PER_GIB = 1_073_741_824

export function createBandwidthLedgerEntry(
  job: SyntheticRequestJob,
  participantId: string,
  billable: boolean,
): BandwidthLedgerEntry {
  return {
    jobId: job.id,
    participantId,
    deviceId: job.deviceId,
    customerId: job.customerId,
    destinationHost: job.destinationHost,
    syntheticBytesUp: billable ? job.syntheticBytesUp : 0,
    syntheticBytesDown: billable ? job.syntheticBytesDown : 0,
    billable,
  }
}

export function summarizeParticipantAccounting(
  participantId: string,
  deviceId: string,
  entries: readonly BandwidthLedgerEntry[],
  rate: CompensationRate = defaultCompensationRate,
): ParticipantAccounting {
  let syntheticBytesUp = 0
  let syntheticBytesDown = 0

  for (const entry of entries) {
    if (entry.participantId === participantId && entry.deviceId === deviceId && entry.billable) {
      syntheticBytesUp += entry.syntheticBytesUp
      syntheticBytesDown += entry.syntheticBytesDown
    }
  }

  const totalSyntheticBytes = syntheticBytesUp + syntheticBytesDown
  const compensationEstimateCents = Math.round((totalSyntheticBytes / BYTES_PER_GIB) * rate.centsPerSyntheticGiB)

  return {
    participantId,
    deviceId,
    syntheticBytesUp,
    syntheticBytesDown,
    totalSyntheticBytes,
    compensationEstimateCents,
  }
}
