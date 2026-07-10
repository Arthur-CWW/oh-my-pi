import { Effect } from "effect"

import { StorageError } from "./errors"

import { RoutingStore, type LaneStateInput, type RoutingObservationInput } from "./routing"

const CHARTER_TS = 1_783_036_800_000
const CURRENT_ACCOUNT_TS = 1_783_382_400_000
const CHARTER_EVIDENCE = "docs/fable/charter.md lane temperaments"
const CURRENT_ACCOUNT_EVIDENCE = "Arthur in-session 2026-07-07"

export interface RoutingSeedResult {
  readonly observationsInserted: number
  readonly observationsIgnored: number
  readonly laneStatesWritten: number
}

const seedObservations: readonly RoutingObservationInput[] = [
  {
    id: "seed:2026-07-03:gpt-5-5:strength:implementation-review",
    ts: CHARTER_TS,
    machine: "seed",
    agent: "gpt-5.5",
    lane: "openai-codex/gpt-5.5",
    workType: "implementation-review",
    verdict: "strength",
    note: "[hypothesis, pre-empirical] literal complete-packet implementation plus pedantic review.",
    evidence: CHARTER_EVIDENCE,
    confidence: 0.5,
  },
  {
    id: "seed:2026-07-03:gpt-5-5:weakness:ui-sandbox",
    ts: CHARTER_TS,
    machine: "seed",
    agent: "gpt-5.5",
    lane: "openai-codex/gpt-5.5",
    workType: "ui-design",
    verdict: "weakness",
    note: "[hypothesis, pre-empirical] UI taste and sandbox learned-helplessness.",
    evidence: CHARTER_EVIDENCE,
    confidence: 0.5,
  },
  {
    id: "seed:2026-07-03:opus-designer:strength:telos-design",
    ts: CHARTER_TS,
    machine: "seed",
    agent: "opus/designer",
    lane: "anthropic/claude-opus-4-6",
    workType: "creative-design",
    verdict: "strength",
    note: "[hypothesis, pre-empirical] telos-driven design, needs editing not operating.",
    evidence: CHARTER_EVIDENCE,
    confidence: 0.5,
  },
  {
    id: "seed:2026-07-03:opus-designer:weakness:precision",
    ts: CHARTER_TS,
    machine: "seed",
    agent: "opus/designer",
    lane: "anthropic/claude-opus-4-6",
    workType: "detail-precision",
    verdict: "weakness",
    note: "[hypothesis, pre-empirical] detail precision.",
    evidence: CHARTER_EVIDENCE,
    confidence: 0.5,
  },
  {
    id: "seed:2026-07-03:kimi:strength:constraint-retrieval",
    ts: CHARTER_TS,
    machine: "seed",
    agent: "kimi",
    lane: "kimi-code",
    workType: "retrieval",
    verdict: "strength",
    note: "[hypothesis, pre-empirical] inventive-under-constraint and retrieval.",
    evidence: CHARTER_EVIDENCE,
    confidence: 0.5,
  },
  {
    id: "seed:2026-07-03:kimi:weakness:supervision-slicing",
    ts: CHARTER_TS,
    machine: "seed",
    agent: "kimi",
    lane: "kimi-code",
    workType: "orchestration-supervision",
    verdict: "weakness",
    note: "[hypothesis, pre-empirical] needs teardown supervision and wall-clock slicing.",
    evidence: CHARTER_EVIDENCE,
    confidence: 0.5,
  },
  {
    id: "seed:2026-07-03:gemini-flash:strength:vision-scout",
    ts: CHARTER_TS,
    machine: "seed",
    agent: "gemini-flash",
    lane: "google-antigravity",
    workType: "vision-scout",
    verdict: "strength",
    note: "[hypothesis, pre-empirical] stateless one-shot vision/scout.",
    evidence: CHARTER_EVIDENCE,
    confidence: 0.5,
  },
  {
    id: "seed:2026-07-03:gemini-flash:failure-mode:agentic-loops",
    ts: CHARTER_TS,
    machine: "seed",
    agent: "gemini-flash",
    lane: "google-antigravity",
    workType: "agentic-loop",
    verdict: "failure_mode",
    note: "[hypothesis, pre-empirical] agentic loops, including a 60-request zero-output spinout.",
    evidence: CHARTER_EVIDENCE,
    confidence: 0.5,
  },
  {
    id: "seed:2026-07-07:gpt-5-5:quota:primary-account-broken",
    ts: CURRENT_ACCOUNT_TS,
    machine: "seed",
    agent: "gpt-5.5",
    lane: "openai-codex/gpt-5.5",
    workType: "account-quota",
    verdict: "quota",
    note: "Primary ChatGPT Pro account is broken with a support case open.",
    evidence: CURRENT_ACCOUNT_EVIDENCE,
    confidence: 0.9,
  },
  {
    id: "seed:2026-07-07:gpt-5-5:quota:secondary-rate-limit",
    ts: CURRENT_ACCOUNT_TS,
    machine: "seed",
    agent: "gpt-5.5",
    lane: "openai-codex/gpt-5.5",
    workType: "account-quota",
    verdict: "quota",
    note: "Running on secondary account at about one twentieth the normal rate limit.",
    evidence: CURRENT_ACCOUNT_EVIDENCE,
    confidence: 0.9,
  },
]

const seedLaneStates: readonly LaneStateInput[] = [
  {
    lane: "openai-codex/gpt-5.5",
    updatedTs: CURRENT_ACCOUNT_TS,
    updatedBy: "routing-seed",
    status: "degraded",
    costTier: "subscription",
    defaultFor: "implementation-review,literal-complete-packet-implementation,pedantic-review",
    notes: "primary ChatGPT Pro account broken (support case open); running on secondary account at ~1/20 rate limit",
  },
  {
    lane: "kimi-code",
    updatedTs: CURRENT_ACCOUNT_TS,
    updatedBy: "routing-seed",
    status: "available",
    costTier: "subscription",
    defaultFor: "retrieval,inventive-under-constraint",
    notes: "subscription KEPT (Arthur 2026-07-07, supersedes charter cancellation note); underutilized",
  },
  {
    lane: "google-antigravity",
    updatedTs: CURRENT_ACCOUNT_TS,
    updatedBy: "routing-seed",
    status: "available",
    costTier: "subscription",
    defaultFor: "vision-scout,stateless-one-shot,video-understanding",
    notes: "underutilized — flash + video understanding; headless auth investigation queued",
  },
  {
    lane: "anthropic/claude-fable-5",
    updatedTs: CURRENT_ACCOUNT_TS,
    updatedBy: "routing-seed",
    status: "available",
    costTier: "scarce",
    defaultFor: "orchestration,synthesis,creative-direction",
    notes: "Finite non-renewing frontier quota; medium thinking only; shares the Claude Max 20x 5h window with opus",
  },
  {
    lane: "anthropic/claude-opus-4-6",
    updatedTs: CURRENT_ACCOUNT_TS,
    updatedBy: "routing-seed",
    status: "available",
    costTier: "subscription",
    defaultFor: "creative-design,telos-driven-design",
    notes: "Claude Max 20x ($200); designer lane",
  },
]

export function seedRoutingStore(): Effect.Effect<RoutingSeedResult, StorageError, RoutingStore> {
  return Effect.gen(function* () {
    const store = yield* RoutingStore
    let observationsInserted = 0
    let observationsIgnored = 0
    let laneStatesWritten = 0

    for (const observation of seedObservations) {
      const result = yield* store.recordObservation(observation)
      if (result.inserted) {
        observationsInserted += 1
      } else {
        observationsIgnored += 1
      }
    }

    for (const state of seedLaneStates) {
      const result = yield* store.setLaneState(state)
      if (result.written) {
        laneStatesWritten += 1
      }
    }

    return { observationsInserted, observationsIgnored, laneStatesWritten }
  })
}
