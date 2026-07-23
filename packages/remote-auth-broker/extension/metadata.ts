import { Schema } from "effect"
import {
  PublicStatusSchema,
  ReceiptSchema,
  decodePublicStatus,
  decodeReceipt,
  type PublicStatus,
  type Receipt,
} from "./protocol.ts"

const STRICT_ENCODE_OPTIONS = { onExcessProperty: "error" } as const

export function serializeReceipt(receipt: Receipt): string {
  const metadata = decodeReceipt(receipt)
  return JSON.stringify(Schema.encodeSync(ReceiptSchema)(metadata, STRICT_ENCODE_OPTIONS))
}

export function serializePublicStatus(status: PublicStatus): string {
  const metadata = decodePublicStatus(status)
  return JSON.stringify(Schema.encodeSync(PublicStatusSchema)(metadata, STRICT_ENCODE_OPTIONS))
}
