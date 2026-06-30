import { mkdirSync, writeFileSync } from "node:fs"
import path from "node:path"
import { Schema } from "effect"
import {
  type JimengDiscoveryTriageFamilyId,
  type JimengDiscoveryValueRankedGap,
  selectJimengDiscoveryNextPacket,
  summarizeJimengDiscoveryTriageCoverage,
} from "./endpoint-registry"
import { jimengError } from "./errors"

export type JimengPacketId =
  | "gen-parity"
  | "persona-voice"
  | "lip-sync-human"
  | "reference-controls"
  | "template-mining"
  | "supporting-reads"

export type JimengPacketRisk = "none" | "paid_generation" | "provider_task_state" | "account_mutation" | "fresh_capture"

export interface JimengPacketExample {
  id: string
  title: string
  purpose: string
  command: string
  outputDir: string
  risks: JimengPacketRisk[]
  approvalNote?: string
}

export interface JimengPacketPlan {
  packetId: JimengPacketId
  title: string
  familyIds: JimengDiscoveryTriageFamilyId[]
  valueRank: number
  objective: string
  artifactRoot: string
  examples: JimengPacketExample[]
  gaps: JimengDiscoveryValueRankedGap[]
  approvalRequired: boolean
  approvalPrompt: string | null
  samplePlan: string[]
  promotionPlan: string[]
  acceptance: string[]
}

export interface JimengPacketPlanOutputFiles {
  manifestJson: string
  manifestMarkdown: string
  approvalPrompt: string | null
}

interface PacketDefinition {
  packetId: JimengPacketId
  title: string
  familyIds: JimengDiscoveryTriageFamilyId[]
  valueRank: number
  objective: string
  examples: Omit<JimengPacketExample, "outputDir">[]
  samplePlan: string[]
  promotionPlan: string[]
  acceptance: string[]
}

const PacketIdSchema = Schema.Union([
  Schema.Literal("gen-parity"),
  Schema.Literal("persona-voice"),
  Schema.Literal("lip-sync-human"),
  Schema.Literal("reference-controls"),
  Schema.Literal("template-mining"),
  Schema.Literal("supporting-reads"),
])

const PacketRiskSchema = Schema.Union([
  Schema.Literal("none"),
  Schema.Literal("paid_generation"),
  Schema.Literal("provider_task_state"),
  Schema.Literal("account_mutation"),
  Schema.Literal("fresh_capture"),
])

const TriageFamilyIdSchema = Schema.Union([
  Schema.Literal("G1"),
  Schema.Literal("G2"),
  Schema.Literal("P1"),
  Schema.Literal("V1"),
  Schema.Literal("L1"),
  Schema.Literal("R1"),
  Schema.Literal("R2"),
  Schema.Literal("T1"),
  Schema.Literal("A1"),
  Schema.Literal("C1"),
  Schema.Literal("Q1"),
  Schema.Literal("I1"),
  Schema.Literal("S1"),
  Schema.Literal("O1"),
  Schema.Literal("W1"),
  Schema.Literal("N1"),
  Schema.Literal("U1"),
  Schema.Literal("D1"),
  Schema.Literal("M1"),
  Schema.Literal("P2"),
  Schema.Literal("X1"),
])

const TriageStatusSchema = Schema.Union([
  Schema.Literal("implemented"),
  Schema.Literal("partial"),
  Schema.Literal("dry_run_only"),
  Schema.Literal("cataloged_only"),
  Schema.Literal("captured_only"),
  Schema.Literal("blocked"),
  Schema.Literal("missing"),
])

const PacketExampleSchema = Schema.Struct({
  id: Schema.String,
  title: Schema.String,
  purpose: Schema.String,
  command: Schema.String,
  outputDir: Schema.String,
  risks: Schema.Array(PacketRiskSchema),
  approvalNote: Schema.optional(Schema.String),
})

const PacketGapSchema = Schema.Struct({
  valueRank: Schema.Number,
  workflow: Schema.String,
  implementationRank: Schema.Number,
  familyId: TriageFamilyIdSchema,
  familyTitle: Schema.String,
  endpoint: Schema.String,
  status: TriageStatusSchema,
  command: Schema.NullOr(Schema.String),
  note: Schema.String,
  evidence: Schema.Array(Schema.String),
  nextProbe: Schema.NullOr(Schema.String),
})

const PacketPlanSchema = Schema.Struct({
  packetId: PacketIdSchema,
  title: Schema.String,
  familyIds: Schema.Array(TriageFamilyIdSchema),
  valueRank: Schema.Number,
  objective: Schema.String,
  artifactRoot: Schema.String,
  examples: Schema.Array(PacketExampleSchema),
  gaps: Schema.Array(PacketGapSchema),
  approvalRequired: Schema.Boolean,
  approvalPrompt: Schema.NullOr(Schema.String),
  samplePlan: Schema.Array(Schema.String),
  promotionPlan: Schema.Array(Schema.String),
  acceptance: Schema.Array(Schema.String),
})

export function buildJimengPacketPlan(input: {
  packetId?: JimengPacketId
  artifactRoot?: string
} = {}): JimengPacketPlan {
  const packetId = input.packetId ?? pickNextJimengPacketId()
  const definition = PACKET_DEFINITIONS[packetId]
  const artifactRoot = input.artifactRoot ?? `data/jimeng-lab/packet-${packetId}-<yyyymmdd>`
  const coverage = summarizeJimengDiscoveryTriageCoverage({ decisions: ["keep"] })
  const familySet = new Set<JimengDiscoveryTriageFamilyId>(definition.familyIds)
  const gaps = coverage.valueRankedGaps.filter((gap) => familySet.has(gap.familyId))
  const examples = definition.examples.map((example) => ({
    ...example,
    outputDir: `${artifactRoot}/${example.id}`,
  }))
  const approvalRequired = examples.some((example) => example.risks.some((risk) => risk !== "none"))

  return {
    packetId,
    title: definition.title,
    familyIds: [...definition.familyIds],
    valueRank: definition.valueRank,
    objective: definition.objective,
    artifactRoot,
    examples,
    gaps,
    approvalRequired,
    approvalPrompt: approvalRequired ? buildApprovalPrompt(definition, artifactRoot, examples) : null,
    samplePlan: [...definition.samplePlan],
    promotionPlan: definition.promotionPlan.map((step) => step.replaceAll("<artifactRoot>", artifactRoot)),
    acceptance: [...definition.acceptance],
  }
}

export function validateJimengPacketPlan(plan: JimengPacketPlan): JimengPacketPlan {
  decodePacketPlanContract(PacketPlanSchema, plan, "packet plan")
  return plan
}

export function writeJimengPacketPlanOutputs(plan: JimengPacketPlan, outDir: string): JimengPacketPlanOutputFiles {
  const validated = validateJimengPacketPlan(plan)
  mkdirSync(outDir, { recursive: true })

  const manifestJson = path.join(outDir, "packet-manifest.json")
  const manifestMarkdown = path.join(outDir, "packet-manifest.md")
  const approvalPrompt = validated.approvalPrompt ? path.join(outDir, "approval-prompt.txt") : null

  writeFileSync(manifestJson, `${JSON.stringify(validated, null, 2)}\n`, "utf8")
  writeFileSync(manifestMarkdown, writeJimengPacketPlanMarkdown(validated), "utf8")
  if (approvalPrompt) writeFileSync(approvalPrompt, `${validated.approvalPrompt}\n`, "utf8")

  return {
    manifestJson,
    manifestMarkdown,
    approvalPrompt,
  }
}

export function pickNextJimengPacketId(): JimengPacketId {
  return selectJimengDiscoveryNextPacket().id
}

export function writeJimengPacketPlanMarkdown(plan: JimengPacketPlan): string {
  const lines = [
    `# Jimeng Packet Plan: ${plan.packetId}`,
    "",
    `- Title: ${plan.title}`,
    `- Families: ${plan.familyIds.join(", ")}`,
    `- Value rank: ${plan.valueRank}`,
    `- Artifact root: \`${plan.artifactRoot}\``,
    `- Approval required: ${plan.approvalRequired ? "yes" : "no"}`,
    "",
    "## Objective",
    "",
    plan.objective,
    "",
    "## Examples",
    "",
  ]

  for (const example of plan.examples) {
    lines.push(`### ${example.id}: ${example.title}`, "")
    lines.push(example.purpose, "")
    lines.push(`- Output: \`${example.outputDir}\``)
    lines.push(`- Risks: ${example.risks.join(", ")}`)
    if (example.approvalNote) lines.push(`- Approval: ${example.approvalNote}`)
    lines.push("")
    lines.push("```bash")
    lines.push(example.command.replaceAll("<outDir>", example.outputDir))
    lines.push("```")
    lines.push("")
  }

  if (plan.approvalPrompt) {
    lines.push("## Approval Prompt", "", plan.approvalPrompt, "")
  }

  lines.push("## Sample Plan", "")
  for (const step of plan.samplePlan) lines.push(`- ${step}`)

  lines.push("", "## Promotion Plan", "")
  for (const step of plan.promotionPlan) lines.push(`- ${step}`)

  lines.push("", "## Acceptance", "")
  for (const step of plan.acceptance) lines.push(`- ${step}`)

  if (plan.gaps.length > 0) {
    lines.push("", "## Current Registry Gaps", "")
    for (const gap of plan.gaps) {
      lines.push(`- ${gap.valueRank}.${gap.implementationRank} \`${gap.familyId} ${gap.endpoint}\` ${gap.status}${gap.command ? ` command=${gap.command}` : ""}`)
      lines.push(`  - ${gap.note}`)
      if (gap.nextProbe) lines.push(`  - Next: ${gap.nextProbe}`)
    }
  }

  return `${lines.join("\n")}\n`
}

function decodePacketPlanContract<A>(schema: Schema.Decoder<A>, value: JimengPacketPlan, operation: string): A {
  try {
    return Schema.decodeUnknownSync(schema)(value)
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    throw jimengError({
      category: "validation",
      code: "JIMENG_PACKET_PLAN_CONTRACT_CHANGED",
      message: `${operation}: Jimeng packet plan did not match required manifest fields.`,
      retryable: false,
      details: { operation, error: message },
    })
  }
}

function packetIdFromFamily(familyId: JimengDiscoveryTriageFamilyId): JimengPacketId {
  if (familyId === "G1" || familyId === "G2" || familyId === "A1") return "gen-parity"
  if (familyId === "P1" || familyId === "V1") return "persona-voice"
  if (familyId === "L1") return "lip-sync-human"
  if (familyId === "R2") return "reference-controls"
  if (familyId === "T1" || familyId === "R1") return "template-mining"
  return "supporting-reads"
}

function buildApprovalPrompt(
  definition: PacketDefinition,
  artifactRoot: string,
  examples: JimengPacketExample[],
): string {
  const riskLabels = [...new Set(examples.flatMap((example) => example.risks).filter((risk) => risk !== "none"))]
  const commands = examples
    .filter((example) => example.risks.some((risk) => risk !== "none"))
    .map((example) => {
      const command = example.command.replaceAll("<outDir>", example.outputDir)
      return example.approvalNote ? `- ${example.id}: ${command}\n  Approval note: ${example.approvalNote}` : `- ${example.id}: ${command}`
    })
    .join("\n")

  return [
    `Approve running the ${definition.packetId} packet with concurrency 1?`,
    `Risks: ${riskLabels.join(", ") || "none"}.`,
    `Artifact root: ${artifactRoot}.`,
    "Commands/actions:",
    commands,
    "After the run, feed saved JSON/artifacts into contract-infer and replay tests before any promotion.",
  ].join("\n")
}

const PACKET_DEFINITIONS: Record<JimengPacketId, PacketDefinition> = {
  "gen-parity": {
    packetId: "gen-parity",
    title: "Generation parity and artifact proof",
    familyIds: ["G1", "G2", "A1"],
    valueRank: 1,
    objective: "Prove useful image/video submit, poll, download, and artifact contracts from real or captured generation examples, then promote the relied-on paths into typed services and replay tests.",
    examples: [
      {
        id: "kbeauty-still",
        title: "Korean beauty persona still",
        purpose: "Build and compare the direct image-generation request for a persona seed asset before any fresh live submit.",
        command: "bun packages/jimeng-client/src/browser-proxy-cli.ts text2image-plan --prompt \"韩系美妆UGC创作者手机自拍，干净卧室自然光，真实皮肤质感\" --ratio 9:16 --outDir <outDir>",
        risks: ["fresh_capture"],
      },
      {
        id: "faceless-hook-video",
        title: "Faceless product hook video",
        purpose: "Refresh text-to-video submit/poll/download proof for a short UGC hook format.",
        command: "bun packages/jimeng-client/src/browser-proxy-cli.ts text2video --capture data/jimeng-captures/<fresh-gen-parity>/capture-template.raw.json --prompt \"无露脸蛋白棒产品短视频，前三秒强钩子，真实手机拍摄，干净桌面\" --durationSec 3 --outDir <outDir>",
        risks: ["fresh_capture", "paid_generation"],
      },
      {
        id: "reference-omni-video",
        title: "Reference-profile omni video",
        purpose: "Capture or approve the mixed image/video reference path for pose/timing transfer.",
        command: "bun packages/jimeng-client/src/browser-proxy-cli.ts omni-video-plan --prompt \"参考视频动作节奏，替换为韩系美妆UGC创作者展示产品\" --imageUri tos-cn-i-tb4s082cfz/<persona>.png --videoVid <reference-vid> --outDir <outDir>",
        risks: ["fresh_capture", "paid_generation"],
      },
      {
        id: "material-audit",
        title: "Generation material audit",
        purpose: "Compare pre-audit material transforms used before generation submits.",
        command: "bun packages/jimeng-client/src/browser-proxy-cli.ts generate-audit-plan --materials '[{\"materialType\":\"image\",\"imageUri\":\"tos-cn-i-tb4s082cfz/<persona>.png\"}]' --outDir <outDir>",
        risks: ["fresh_capture"],
      },
    ],
    samplePlan: [
      "Record credit balance before and after approved paid examples.",
      "Keep generation/mutation concurrency at 1.",
      "Save raw request/response JSON, normalized summaries, media artifacts, exact commands, and credit deltas under the packet artifact root.",
      "Stop immediately on ret=1019, shark/risk-control, 429, auth drift, unexpected modal, or unexpected account mutation.",
    ],
    promotionPlan: [
      "Run `jimeng-browser-proxy contract-infer --input <artifactRoot> --endpoint /mweb/v1/aigc_draft/generate --outDir <artifactRoot>/contract-infer`.",
      "Run `jimeng-browser-proxy generation-contract --input <artifactRoot> --outDir <artifactRoot>/generation-contract` if result JSON includes completed generation proofs.",
      "Promote inferred stable paths into the typed generation client and replay fixtures.",
      "Update endpoint registry evidence and next probes for G1/G2/A1.",
    ],
    acceptance: [
      "`bun run jimeng:test` passes.",
      "`mise exec -- bun run typecheck` passes in packages/jimeng-client.",
      "`mise exec -- bun run test:vitest` passes in packages/jimeng-client.",
      "Playable/listenable artifacts exist for approved media examples, or passive captures are compared by the relevant compare gate.",
    ],
  },
  "persona-voice": {
    packetId: "persona-voice",
    title: "Persona and voice",
    familyIds: ["P1", "V1", "G2"],
    valueRank: 2,
    objective: "Prove reusable persona records, voice generation/clone/query, and voice application paths for UGC profiles.",
    examples: [
      {
        id: "subject-voice",
        title: "Subject voice generation compare",
        purpose: "Capture or compare the subject generate-voice request before any live voice generation.",
        command: "bun packages/jimeng-client/src/browser-proxy-cli.ts subject-generate-voice --imageUri tos-cn-i-tb4s082cfz/<persona>.png --dryRun --outDir <outDir>",
        risks: ["fresh_capture", "paid_generation"],
      },
      {
        id: "voice-clone-submit",
        title: "Disposable voice clone submit",
        purpose: "Build the disposable voice clone submit request before any asset-creating live call.",
        command: "bun packages/jimeng-client/src/browser-proxy-cli.ts voice-clone-submit --audioVid <uploaded-audio-vid> --name \"packet disposable voice\" --dryRun --outDir <outDir>",
        risks: ["account_mutation", "provider_task_state"],
        approvalNote: "Live voice clone submit is intentionally disabled in the CLI until a disposable source audio fixture and explicit mutation/spend approval exist.",
      },
      {
        id: "voice-mix",
        title: "Apply voice/audio to video",
        purpose: "Compare mix-audio task creation for one generated video item.",
        command: "bun packages/jimeng-client/src/browser-proxy-cli.ts mix-audio-plan --audioVid <audio-vid> --videoItemId <video-item-id> --outDir <outDir>",
        risks: ["fresh_capture", "provider_task_state"],
      },
    ],
    samplePlan: [
      "Prefer passive UI captures first for subject voice and voice clone flows.",
      "Use disposable assets for any cloned voice mutation.",
      "Record task ids and follow-up query responses as cassettes.",
    ],
    promotionPlan: [
      "Run contract-infer over captured submit/query/update/delete JSON.",
      "Promote task query response schemas and asset mutation summaries.",
      "Keep delete/update live paths approval-gated unless a disposable fixture is explicit.",
    ],
    acceptance: [
      "Replay tests cover submit/query/update/delete request and response shapes.",
      "Snapshots redact audio URLs, task ids where unstable, and signed credentials.",
    ],
  },
  "lip-sync-human": {
    packetId: "lip-sync-human",
    title: "Lip-sync and digital human",
    familyIds: ["L1", "V1", "G2", "A1"],
    valueRank: 3,
    objective: "Prove avatar/VOD lip-sync pre-process, submit, poll, and artifact download for talking-head UGC.",
    examples: [
      {
        id: "avatar-preprocess",
        title: "Avatar image pre-process",
        purpose: "Compare avatar image checks and voice recommendation tasks.",
        command: "bun packages/jimeng-client/src/browser-proxy-cli.ts video-preprocess-plan --mode image-create-avatar --imageUri tos-cn-i-tb4s082cfz/<persona>.png --outDir <outDir>",
        risks: ["fresh_capture", "provider_task_state"],
      },
      {
        id: "image-lipsync",
        title: "Image/avatar lip-sync",
        purpose: "Approve or capture a talking-head image lip-sync submit and result artifact.",
        command: "bun packages/jimeng-client/src/browser-proxy-cli.ts lip-sync --imageUri tos-cn-i-tb4s082cfz/<persona>.png --voice-id <tone-id> --text \"三秒告诉你为什么这款产品值得试。\" --outDir <outDir>",
        risks: ["paid_generation", "provider_task_state"],
      },
    ],
    samplePlan: [
      "Start with passive pre-process capture and compare against video-preprocess-plan.",
      "Use pre-process submit ids to record/replay mget_pre_process_result.",
      "Only then approve one image/avatar or VOD lip-sync submit.",
    ],
    promotionPlan: [
      "Run contract-infer over pre-process/result and lip-sync generation samples.",
      "Promote pre-process result schemas and generation artifact summaries.",
    ],
    acceptance: [
      "Request-plan compare passes for pre-process submit/result.",
      "Approved lip-sync media artifact is playable and tied to a typed history record.",
    ],
  },
  "reference-controls": {
    packetId: "reference-controls",
    title: "Reference controls",
    familyIds: ["R2", "G1", "G2"],
    valueRank: 4,
    objective: "Prove pose/depth/canny/style/reference controls and connect them to person-swap generation examples.",
    examples: [
      {
        id: "pose-preview",
        title: "Pose reference preview",
        purpose: "Validate pose detection/preview against a provider image.",
        command: "bun packages/jimeng-client/src/browser-proxy-cli.ts controlnet-preview --imageUri tos-cn-i-tb4s082cfz/<reference>.png --control pose --outDir <outDir>",
        risks: ["none"],
      },
    ],
    samplePlan: [
      "Reuse existing provider image URIs where possible.",
      "Capture any missing reference-generation submit only after preview contracts are stable.",
    ],
    promotionPlan: [
      "Promote preview/result schemas if new fields are needed for UGC UI.",
      "Link reference outputs to omni-reference generation examples.",
    ],
    acceptance: [
      "Replay tests cover pose/depth/canny and object mask summaries.",
    ],
  },
  "template-mining": {
    packetId: "template-mining",
    title: "Template and niche mining",
    familyIds: ["T1", "R1"],
    valueRank: 5,
    objective: "Prove template/profile mining paths that extract hooks, captions, formats, and faceless profile patterns.",
    examples: [
      {
        id: "capcut-search",
        title: "CapCut template search capture",
        purpose: "Capture exact signed search/preset payloads that safe probes could not guess.",
        command: "bun packages/jimeng-client/src/browser-proxy-cli.ts capcut-probe --endpoint /lv/v1/cc_web/replicate/search_templates --body '{\"keyword\":\"beauty\"}' --outDir <outDir>",
        risks: ["fresh_capture"],
      },
    ],
    samplePlan: [
      "Prefer passive UI capture for CapCut signed search/preset calls.",
      "Replay exact captured bodies through cassettes before adding typed search commands.",
    ],
    promotionPlan: [
      "Promote only non-mutating template search/detail rows.",
      "Keep payment/template mutation endpoints parked.",
    ],
    acceptance: [
      "Replay fixtures return non-empty template rows or exact blocked reasons.",
    ],
  },
  "supporting-reads": {
    packetId: "supporting-reads",
    title: "Supporting metadata reads",
    familyIds: ["A1", "C1", "Q1", "S1"],
    valueRank: 6,
    objective: "Fill supporting read gaps only when they unblock a higher-value packet.",
    examples: [
      {
        id: "history-refresh",
        title: "History and queue refresh",
        purpose: "Refresh read-only artifact lookup cassettes after generation packets.",
        command: "bun packages/jimeng-client/src/browser-proxy-cli.ts history-records --submitId <submit-id> --outDir <outDir>",
        risks: ["none"],
      },
    ],
    samplePlan: [
      "Run only after a higher-value packet creates or captures ids.",
    ],
    promotionPlan: [
      "Keep as replay cassettes and registry support evidence.",
    ],
    acceptance: [
      "Read-only replay tests prove the ids needed by the higher-value packet.",
    ],
  },
}
