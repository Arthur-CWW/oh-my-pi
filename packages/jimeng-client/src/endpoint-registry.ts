export type JimengDiscoveryKnownStatus =
  | "implemented"
  | "partial"
  | "dry_run_only"
  | "cataloged_only"
  | "captured_only"
  | "blocked"

export interface JimengDiscoveryKnownEndpoint {
  endpoint: string
  status: JimengDiscoveryKnownStatus
  command: string | null
  note: string
  evidence: string[]
  nextProbe: string | null
}

export type JimengDiscoveryTriageDecision = "keep" | "maybe" | "skip"

export type JimengDiscoveryTriageFamilyId =
  | "G1"
  | "G2"
  | "P1"
  | "V1"
  | "L1"
  | "R1"
  | "R2"
  | "T1"
  | "A1"
  | "C1"
  | "Q1"
  | "I1"
  | "S1"
  | "O1"
  | "W1"
  | "N1"
  | "U1"
  | "D1"
  | "M1"
  | "P2"
  | "X1"

export interface JimengDiscoveryTriageFamily {
  id: JimengDiscoveryTriageFamilyId
  decision: JimengDiscoveryTriageDecision
  title: string
  endpoints: string[]
}

export type JimengDiscoveryTriageStatusKey = JimengDiscoveryKnownStatus | "missing"

export interface JimengDiscoveryTriageFamilyCoverage {
  id: JimengDiscoveryTriageFamilyId
  decision: JimengDiscoveryTriageDecision
  title: string
  endpointCount: number
  statusCounts: Record<JimengDiscoveryTriageStatusKey, number>
  missingEndpoints: string[]
  notImplementedEndpoints: string[]
}

export interface JimengDiscoveryEndpointAudit {
  evidence: string[]
  nextProbe: string
}

export interface JimengDiscoveryValueRankedGap {
  valueRank: number
  workflow: string
  implementationRank: number
  familyId: JimengDiscoveryTriageFamilyId
  familyTitle: string
  endpoint: string
  status: JimengDiscoveryTriageStatusKey
  command: string | null
  note: string
  evidence: string[]
  nextProbe: string | null
}

export interface JimengDiscoveryTriageCoverage {
  decisions: JimengDiscoveryTriageDecision[]
  familyCount: number
  uniqueEndpointCount: number
  missingEndpointCount: number
  statusCounts: Record<JimengDiscoveryTriageStatusKey, number>
  families: JimengDiscoveryTriageFamilyCoverage[]
  valueRankedGaps: JimengDiscoveryValueRankedGap[]
}

export function getJimengDiscoveryKnownEndpoints(): JimengDiscoveryKnownEndpoint[] {
  return KNOWN_ENDPOINTS.map(cloneKnownEndpoint)
}

export function buildJimengDiscoveryKnownEndpointMap(): Map<string, JimengDiscoveryKnownEndpoint> {
  return new Map(KNOWN_ENDPOINTS.map((endpoint) => [endpoint.endpoint, cloneKnownEndpoint(endpoint)]))
}

export function getJimengDiscoveryKnownEndpointNote(endpoint: string): string | null {
  return KNOWN_ENDPOINTS.find((knownEndpoint) => knownEndpoint.endpoint === endpoint)?.note ?? null
}

export function getJimengDiscoveryTriageFamilies(): JimengDiscoveryTriageFamily[] {
  return TRIAGE_FAMILIES.map((family) => ({ ...family, endpoints: [...family.endpoints] }))
}

export function parseJimengDiscoveryTriageDecisions(value: string | undefined): JimengDiscoveryTriageDecision[] {
  if (!value?.trim()) return ["keep"]
  const decisions: JimengDiscoveryTriageDecision[] = []
  for (const item of value.split(",")) {
    const decision = item.trim()
    if (!decision) continue
    if (decision !== "keep" && decision !== "maybe" && decision !== "skip") {
      throw new Error(`Unknown triage decision: ${decision}`)
    }
    if (!decisions.includes(decision)) decisions.push(decision)
  }
  return decisions.length > 0 ? decisions : ["keep"]
}

export function summarizeJimengDiscoveryTriageCoverage(input: {
  decisions?: JimengDiscoveryTriageDecision[]
} = {}): JimengDiscoveryTriageCoverage {
  const decisions = input.decisions ?? ["keep", "maybe", "skip"]
  const decisionSet = new Set<JimengDiscoveryTriageDecision>(decisions)
  const knownByEndpoint = buildJimengDiscoveryKnownEndpointMap()
  const statusCounts = emptyTriageStatusCounts()
  const uniqueEndpoints = new Set<string>()

  const families = TRIAGE_FAMILIES
    .filter((family) => decisionSet.has(family.decision))
    .map((family): JimengDiscoveryTriageFamilyCoverage => {
      const familyStatusCounts = emptyTriageStatusCounts()
      const missingEndpoints: string[] = []
      const notImplementedEndpoints: string[] = []

      for (const endpoint of family.endpoints) {
        uniqueEndpoints.add(endpoint)
        const known = knownByEndpoint.get(endpoint)
        if (!known) {
          familyStatusCounts.missing += 1
          statusCounts.missing += 1
          missingEndpoints.push(endpoint)
          notImplementedEndpoints.push(endpoint)
          continue
        }

        familyStatusCounts[known.status] += 1
        statusCounts[known.status] += 1
        if (known.status !== "implemented") notImplementedEndpoints.push(endpoint)
      }

      return {
        id: family.id,
        decision: family.decision,
        title: family.title,
        endpointCount: family.endpoints.length,
        statusCounts: familyStatusCounts,
        missingEndpoints,
        notImplementedEndpoints,
      }
    })

  return {
    decisions: [...decisions],
    familyCount: families.length,
    uniqueEndpointCount: uniqueEndpoints.size,
    missingEndpointCount: statusCounts.missing,
    statusCounts,
    families,
    valueRankedGaps: buildJimengDiscoveryValueRankedGaps(families, knownByEndpoint),
  }
}

export function writeJimengDiscoveryTriageCoverageMarkdown(coverage: JimengDiscoveryTriageCoverage): string {
  const lines = [
    "# Jimeng Triage Coverage",
    "",
    `- Decisions: ${coverage.decisions.join(", ")}`,
    `- Families: ${coverage.familyCount}`,
    `- Unique endpoints: ${coverage.uniqueEndpointCount}`,
    `- Missing endpoints: ${coverage.missingEndpointCount}`,
    "",
    "| ID | Decision | Family | Endpoints | Statuses | Not implemented |",
    "|---|---|---|---:|---|---:|",
  ]

  for (const family of coverage.families) {
    lines.push(`| ${family.id} | ${family.decision} | ${family.title} | ${family.endpointCount} | ${formatTriageStatusCounts(family.statusCounts)} | ${family.notImplementedEndpoints.length} |`)
  }

  if (coverage.valueRankedGaps.length > 0) {
    lines.push("", "## Value-Ranked Remaining Work", "")
    for (const gap of coverage.valueRankedGaps) {
      const command = gap.command ? ` command=${gap.command}` : ""
      lines.push(`${gap.valueRank}. ${gap.workflow} - \`${gap.familyId} ${gap.endpoint}\` - ${gap.status}${command} - ${gap.note}`)
      if (gap.nextProbe) {
        lines.push(`   - Next probe: ${gap.nextProbe}`)
      }
    }
  }

  const knownByEndpoint = buildJimengDiscoveryKnownEndpointMap()
  const unfinishedFamilies = coverage.families.filter((family) => family.notImplementedEndpoints.length > 0)
  if (unfinishedFamilies.length > 0) {
    lines.push("", "## Not Implemented Endpoints", "")
    for (const family of unfinishedFamilies) {
      lines.push(`### ${family.id} ${family.title}`, "")
      for (const endpoint of family.notImplementedEndpoints) {
        const row = knownByEndpoint.get(endpoint)
        const status = row?.status ?? "missing"
        const command = row?.command ? ` command=${row.command}` : ""
        const note = row?.note ? ` - ${row.note}` : ""
        lines.push(`- \`${endpoint}\` - ${status}${command}${note}`)
        if (row?.evidence.length) {
          lines.push(`  - Evidence: ${row.evidence.map((item) => `\`${item}\``).join("; ")}`)
        }
        if (row?.nextProbe) {
          lines.push(`  - Next probe: ${row.nextProbe}`)
        }
      }
      lines.push("")
    }
  }

  return `${lines.join("\n")}\n`
}

function buildJimengDiscoveryValueRankedGaps(
  families: JimengDiscoveryTriageFamilyCoverage[],
  knownByEndpoint: Map<string, JimengDiscoveryKnownEndpoint>,
): JimengDiscoveryValueRankedGap[] {
  const familyById = new Map(TRIAGE_FAMILIES.map((family) => [family.id, family]))
  const gaps: JimengDiscoveryValueRankedGap[] = []

  for (const family of families) {
    for (const endpoint of family.notImplementedEndpoints) {
      const row = knownByEndpoint.get(endpoint)
      const status = row?.status ?? "missing"
      const priority = jimengWorkflowPriority(endpoint, family.id)
      gaps.push({
        valueRank: priority.rank,
        workflow: priority.workflow,
        implementationRank: jimengImplementationRank(status),
        familyId: family.id,
        familyTitle: familyById.get(family.id)?.title ?? family.title,
        endpoint,
        status,
        command: row?.command ?? null,
        note: row?.note ?? "missing registry row",
        evidence: row ? [...row.evidence] : [],
        nextProbe: row?.nextProbe ?? null,
      })
    }
  }

  return gaps.sort((left, right) =>
    left.valueRank - right.valueRank
    || left.implementationRank - right.implementationRank
    || left.familyId.localeCompare(right.familyId)
    || left.endpoint.localeCompare(right.endpoint),
  )
}

function jimengWorkflowPriority(endpoint: string, familyId: JimengDiscoveryTriageFamilyId): { rank: number; workflow: string } {
  if (endpoint === "/mweb/v1/mget_story") {
    return { rank: 6, workflow: "Supporting metadata reads" }
  }
  if (familyId === "G1" || familyId === "G2" || familyId === "A1") {
    return { rank: 1, workflow: "Generation parity and artifact proof" }
  }
  if (familyId === "P1" || familyId === "V1") {
    return { rank: 2, workflow: "Persona and voice" }
  }
  if (familyId === "L1") {
    return { rank: 3, workflow: "Lip-sync / digital human" }
  }
  if (familyId === "R2") {
    return { rank: 4, workflow: "Reference controls" }
  }
  if (familyId === "T1" || familyId === "R1") {
    return { rank: 5, workflow: "Template and niche mining" }
  }
  return { rank: 6, workflow: "Supporting metadata reads" }
}

function jimengImplementationRank(status: JimengDiscoveryTriageStatusKey): number {
  switch (status) {
    case "partial":
      return 1
    case "dry_run_only":
      return 2
    case "captured_only":
      return 3
    case "blocked":
      return 4
    case "cataloged_only":
      return 5
    case "missing":
      return 6
    case "implemented":
      return 99
  }
}

const TRIAGE_STATUS_KEYS: JimengDiscoveryTriageStatusKey[] = [
  "implemented",
  "partial",
  "dry_run_only",
  "cataloged_only",
  "captured_only",
  "blocked",
  "missing",
]

function emptyTriageStatusCounts(): Record<JimengDiscoveryTriageStatusKey, number> {
  return {
    implemented: 0,
    partial: 0,
    dry_run_only: 0,
    cataloged_only: 0,
    captured_only: 0,
    blocked: 0,
    missing: 0,
  }
}

function formatTriageStatusCounts(statusCounts: Record<JimengDiscoveryTriageStatusKey, number>): string {
  return TRIAGE_STATUS_KEYS
    .filter((status) => statusCounts[status] > 0)
    .map((status) => `${status}=${statusCounts[status]}`)
    .join(", ")
}

const TRIAGE_FAMILIES: JimengDiscoveryTriageFamily[] = [
  triageFamily("G1", "keep", "Text/image/video generation", [
    "/mweb/v1/aigc_draft/generate",
    "/mweb/v1/execute_generate_audit",
    "/mweb/v1/get_common_config",
  ]),
  triageFamily("G2", "keep", "Upload and provider asset references", [
    "/mweb/v1/get_upload_token",
    "/mweb/v1/imagex/submit_audit_job",
    "/mweb/v1/get_image_by_uri",
    "/mweb/v1/get_video_by_vid",
    "/mweb/v1/mpack_image",
  ]),
  triageFamily("P1", "keep", "Persona/subject lifecycle", [
    "/mweb/v1/dreamina_subject/get",
    "/mweb/v1/dreamina_subject/create",
    "/mweb/v1/dreamina_subject/update",
    "/mweb/v1/dreamina_subject/delete",
    "/mweb/v1/dreamina_subject/generate_voice",
  ]),
  triageFamily("V1", "keep", "Voice and speech", [
    "/mweb/v1/get_user_local_item_list",
    "/mweb/v1/voice/submit_task",
    "/mweb/v1/voice/query_task",
    "/mweb/v1/voice/update",
    "/mweb/v1/voice/delete",
    "/mweb/v1/feed",
    "/mweb/v1/tts_generate",
    "/mweb/v1/mix_audio_video",
    "/mweb/v1/mix_audio_videos",
  ]),
  triageFamily("L1", "keep", "Lip-sync / digital human", [
    "/mweb/v1/video_generate/get_common_config",
    "/mweb/v1/video_generate/get_switch_model_queue_info",
    "/mweb/v1/video_generate/pre_process",
    "/mweb/v1/video_generate/mget_pre_process_result",
    "/mweb/v1/video_generate/face_auth/skip",
    "/mweb/v1/video_generate/face_auth/skip/query",
  ]),
  triageFamily("R1", "keep", "Reference profile research", [
    "/mweb/v1/get_user_info",
    "/mweb/v1/get_homepage",
    "/mweb/v1/get_favorite_list",
    "/mweb/v1/get_user_story_list",
    "/mweb/v1/mget_story",
    "/mweb/v1/get_follow_list",
    "/mweb/v1/get_item_info",
    "/mweb/v1/mget_item_info",
  ]),
  triageFamily("R2", "keep", "Reference controls", [
    "/mweb/v1/get_image_description",
    "/mweb/v1/face_recognize",
    "/mweb/v1/blend_preview",
    "/mweb/v1/pose_detect",
    "/mweb/v1/saliency_seg",
  ]),
  triageFamily("T1", "keep", "CapCut/template mining", [
    "/mweb/v1/get_explore",
    "/mweb/v1/feed_short_video",
    "/lv/v1/effect/get_panel_info",
    "/lv/v1/effect/get_category_effects",
    "/lv/v1/effect/get_all_fonts",
    "/lv/v1/editor/plane/color/feed",
    "/lv/v1/cc_web/plane/get_categories",
    "/lv/v1/cc_web/plane/get_collections",
    "/lv/v1/cc_web/plane/get_collection_templates",
    "/lv/v1/cc_web/plane/get_template_detail",
    "/lv/v1/cc_web/replicate/get_search_words",
    "/lv/v1/cc_web/replicate/search_templates",
    "/lv/v1/cc_web/plane/batch_get_collection_templates",
    "/lv/v1/cc_web/plane/get_collection_presets",
    "/lv/v1/cc_web/plane/preset_template_detail",
    "/lv/v1/cc_web/plane/fuzzy_search_templates",
  ]),
  triageFamily("A1", "keep", "Assets/history/queue/video info", [
    "/mweb/v1/get_asset_list",
    "/mweb/v1/get_history",
    "/mweb/v1/get_history_by_ids",
    "/mweb/v1/get_history_queue_info",
    "/mweb/v1/get_video_by_vid",
    "/mweb/v1/get_local_item_list",
  ]),
  triageFamily("C1", "maybe", "Commerce/quota/benefits/pricing", [
    "/commerce/v1/benefits/user_credit",
    "/commerce/v1/subscription/price_list",
    "/commerce/v1/purchase/price_list",
    "/commerce/v1/subscription/cc_price_list",
    "/commerce/v1/subscription/get_change_plan_info",
    "/commerce/v3/resource/benefit_metadata",
    "/commerce/v3/benefits/batch_get_user_benefit",
  ]),
  triageFamily("Q1", "maybe", "Runtime/config/model catalogs", [
    "/mweb/v1/get_settings",
    "/mweb/v1/get_ug_info",
    "/mweb/v1/get_invite_status",
    "/mweb/v1/get_experiment_params",
    "/mweb/v1/get_home_header_banner_config",
    "/mweb/v1/get_help_desk_entrance",
    "/mweb/v1/speech/asr_token",
    "/mweb/v1/speech/asr_hotwords",
    "/mweb/v1/creation_agent/v2/get_agent_config",
    "/mweb/v1/creation_agent/v2/skill/list",
  ]),
  triageFamily("I1", "maybe", "Infinite canvas", [
    "/mweb/v1/infinite_canvas/list_project",
    "/mweb/v1/infinite_canvas/project_detail",
    "/mweb/v1/infinite_canvas/v1/get_canvas_custom_ratio",
    "/mweb/v1/infinite_canvas/get_conversation_list",
    "/mweb/v1/infinite_canvas/fetch_conversation",
    "/mweb/v1/infinite_canvas/conversation",
    "/mweb/v1/infinite_canvas/create_conversation",
    "/mweb/v1/infinite_canvas/del_conversation",
    "/mweb/v1/infinite_canvas/delete_turn",
    "/mweb/v1/infinite_canvas/update_conversation",
    "/mweb/v1/infinite_canvas/create_project",
    "/mweb/v1/infinite_canvas/delete_project",
    "/mweb/v1/infinite_canvas/edit",
    "/mweb/v1/infinite_canvas/update_project",
    "/mweb/v1/infinite_canvas/v1/submit_changeset",
    "/mweb/v1/infinite_canvas/v1/update_canvas_custom_ratio",
  ]),
  triageFamily("S1", "maybe", "Story/archive/export", [
    "/mweb/v1/mget_story",
    "/mweb/v1/submit_async_task",
    "/mweb/v1/mget_async_task",
    "/mweb/v1/create_story",
    "/mweb/v1/update_story",
    "/mweb/v1/delete_story",
  ]),
  triageFamily("O1", "maybe", "Rate/concurrency probes", [
    "/mweb/v1/get_history_queue_info",
    "/commerce/v1/benefits/user_credit",
  ]),
  triageFamily("W1", "skip", "Weekly challenges / activities", [
    "/mweb/v1/get_weekly_challenge_list",
    "/mweb/v1/get_weekly_challenge_detail",
    "/mweb/v1/get_weekly_challenge_work_list",
  ]),
  triageFamily("N1", "skip", "Notices, panels, banners, helpdesk", [
    "/mweb/v1/get_notice_list",
    "/mweb/v1/get_panel_info",
    "/mweb/v1/get_home_header_banner_config",
    "/mweb/v1/get_help_desk_entrance",
    "/mweb/v1/get_unread_count",
  ]),
  triageFamily("U1", "skip", "URL shortener", [
    "/mweb/v1/get_short_url",
  ]),
  triageFamily("D1", "skip", "CapCut account-token/data-sync credentials", [
    "/mweb/v1/cc_data_sync/get_account_info",
    "/mweb/v1/cc_data_sync/get_account_token",
  ]),
  triageFamily("M1", "skip", "Mutating LV asset/template/draft endpoints", [
    "/lv/v1/asset/copy",
    "/lv/v1/asset/create",
    "/lv/v1/asset/create_cloud_asset",
    "/lv/v1/asset/delete",
    "/lv/v1/asset/label_as_exported",
    "/lv/v1/asset/prepare_upload_cloud",
    "/lv/v1/asset/rename",
    "/lv/v1/editor/template/add",
    "/lv/v1/editor/template/add_async",
    "/lv/v1/editor/template/add_query",
    "/lv/v1/cc_web/plane/del_presets_template",
    "/mweb/v1/workspace/create",
    "/mweb/v1/workspace/update",
  ]),
  triageFamily("P2", "skip", "Payment/order/refund flows", [
    "/commerce/v3/trade/query_trade",
    "/commerce/v3/trade/user/can_refund_list",
    "/commerce/v3/trade/user/refund_record_list",
  ]),
  triageFamily("X1", "skip", "Surveys, remove history, update BGM, cancel/accelerate", [
    "/mweb/v1/submit_survey",
    "/mweb/v1/remove_history",
    "/mweb/v1/update_video_default_bgm",
    "/mweb/v1/aigc_draft/cancel_generate",
    "/mweb/v1/aigc_draft/generate_accelerate",
  ]),
]

function triageFamily(
  id: JimengDiscoveryTriageFamilyId,
  decision: JimengDiscoveryTriageDecision,
  title: string,
  endpoints: string[],
): JimengDiscoveryTriageFamily {
  return { id, decision, title, endpoints }
}

const KEEP_GAP_AUDIT_BY_ENDPOINT: Record<string, JimengDiscoveryEndpointAudit> = {
  "/mweb/v1/aigc_draft/generate": {
    evidence: [
      "docs/qa/jimeng-direct-compare-gates-20260611.md",
      "docs/qa/jimeng-omni-video-plan-20260611.md",
      "data/jimeng-lab/proof-20260610-text2image-plan-direct/",
      "data/jimeng-lab/text2video-plan-current/",
      "data/jimeng-lab/proof-20260610-subscription-api-live-check/",
      "data/jimeng-lab/proof-20260611-omni-video-plan/",
      "data/jimeng-lab/proof-20260612-live-generation-matrix/contract-infer/normalized/contract/",
      "data/jimeng-lab/proof-20260612-live-generation-matrix/generation-contract/normalized/generation-contract/",
    ],
    nextProbe: "Repeat the matrix/infer/promote loop for lip-sync, end-frame, multi-frame, or omni-reference generation, then run the matching compare gate before any approval-gated live submit.",
  },
  "/mweb/v1/execute_generate_audit": {
    evidence: [
      "docs/qa/jimeng-generate-audit-plan-20260611.md",
      "data/jimeng-lab/proof-20260611-static-locate-media-helper-blockers/",
      "data/jimeng-lab/proof-20260611-static-inventory-media-helper-blockers/",
    ],
    nextProbe: "Passively capture the frontend material-audit request around a generation submit, then compare it with generate-audit-plan using request-plan-compare before any live replay.",
  },
  "/mweb/v1/mpack_image": {
    evidence: [
      "data/jimeng-lab/proof-20260611-static-locate-media-helper-blockers/",
      "data/jimeng-lab/proof-20260611-static-inventory-media-helper-blockers/",
    ],
    nextProbe: "Passively capture an image-pack/material-data-service UI flow, then replay only with cassette redaction after the exact caller input shape is known.",
  },
  "/mweb/v1/dreamina_subject/generate_voice": {
    evidence: [
      "docs/qa/jimeng-request-plan-compare-20260611.md",
      "data/jimeng-lab/proof-20260610-subject-lifecycle/",
      "data/jimeng-lab/cli-request-plan-compare-smoke/",
    ],
    nextProbe: "Capture a subject generate-voice UI submit and compare it with subject-generate-voice dry-run using request-plan-compare before any approved live voice generation.",
  },
  "/mweb/v1/voice/submit_task": {
    evidence: [
      "docs/qa/jimeng-request-plan-compare-20260611.md",
      "data/jimeng-lab/proof-20260610-voice-clone/",
      "data/jimeng-lab/cli-request-plan-compare-smoke/",
    ],
    nextProbe: "Capture a voice-clone submit UI request with disposable source audio and compare the dry-run plan before any approved asset-creating submit.",
  },
  "/mweb/v1/voice/query_task": {
    evidence: [
      "docs/qa/jimeng-request-plan-compare-20260611.md",
      "data/jimeng-lab/proof-20260610-voice-clone/",
    ],
    nextProbe: "Use a real task id from an approved voice-clone submit flow, then record/replay voice-clone-query as a cassette-backed read.",
  },
  "/mweb/v1/voice/update": {
    evidence: [
      "docs/qa/jimeng-request-plan-compare-20260611.md",
      "data/jimeng-lab/proof-20260610-voice-clone/",
      "data/jimeng-lab/cli-request-plan-compare-smoke/",
    ],
    nextProbe: "Capture or create a disposable cloned voice asset, compare voice-clone-update dry-run against the UI request, then require approval before mutation.",
  },
  "/mweb/v1/voice/delete": {
    evidence: [
      "docs/qa/jimeng-request-plan-compare-20260611.md",
      "data/jimeng-lab/proof-20260610-voice-clone/",
      "data/jimeng-lab/cli-request-plan-compare-smoke/",
    ],
    nextProbe: "Capture or create a disposable cloned voice asset, compare voice-clone-delete dry-run against the UI request, then require approval before mutation.",
  },
  "/mweb/v1/feed": {
    evidence: [
      "data/jimeng-lab/cli-voices-smoke/",
      "data/jimeng-lab/cli-voices-smoke-2/",
      "data/jimeng-lab/voice-library-samples/",
    ],
    nextProbe: "Refresh a signed voice-library feed request from passive UI capture and record/replay the voices command without relying on stale capture templates.",
  },
  "/mweb/v1/mix_audio_video": {
    evidence: [
      "docs/qa/jimeng-mix-audio-plan-20260611.md",
      "data/jimeng-lab/proof-20260611-static-locate-media-helper-blockers/",
      "data/jimeng-lab/proof-20260611-static-inventory-media-helper-blockers/",
      "data/jimeng-lab/proof-20260611-mix-audio-plan/",
    ],
    nextProbe: "Capture a single audio/video mix UI submit, then compare it with mix-audio-plan using request-plan-compare before any approval-gated live replay because it creates task state.",
  },
  "/mweb/v1/mix_audio_videos": {
    evidence: [
      "docs/qa/jimeng-mix-audio-plan-20260611.md",
      "data/jimeng-lab/proof-20260611-static-locate-media-helper-blockers/",
      "data/jimeng-lab/proof-20260611-static-inventory-media-helper-blockers/",
      "data/jimeng-lab/proof-20260611-mix-audio-plan/",
    ],
    nextProbe: "Capture a batch audio/video mix UI submit, then compare it with mix-audio-plan --batch using request-plan-compare before any approval-gated live replay because it creates task state.",
  },
  "/mweb/v1/video_generate/get_switch_model_queue_info": {
    evidence: [
      "data/jimeng-lab/proof-20260610-static-locate-video-generate-helpers/",
      "data/jimeng-lab/proof-20260610-switch-model-queue-probe/",
    ],
    nextProbe: "Capture the frontend switch-model queue request from the lip-sync/video UI and replay the exact body through endpoint-probe record/replay.",
  },
  "/mweb/v1/video_generate/pre_process": {
    evidence: [
      "docs/qa/jimeng-video-preprocess-plan-20260612.md",
      "docs/qa/jimeng-lip-sync-human-preprocess-client-20260612.md",
      "data/jimeng-lab/proof-20260610-static-locate-video-generate-helpers/",
      "data/jimeng-lab/proof-20260612-video-preprocess-plan/",
      "data/jimeng-lab/proof-20260612-lip-sync-human-contract-infer/preprocess/",
    ],
    nextProbe: "Passively capture the video pre-process submit flow, compare it with video-preprocess-plan using request-plan-compare, then record/replay through submitJimengVideoPreprocess only after explicit approval because it creates task state.",
  },
  "/mweb/v1/video_generate/mget_pre_process_result": {
    evidence: [
      "docs/qa/jimeng-video-preprocess-plan-20260612.md",
      "docs/qa/jimeng-lip-sync-human-preprocess-client-20260612.md",
      "data/jimeng-lab/proof-20260610-static-locate-video-generate-helpers/",
      "data/jimeng-lab/proof-20260612-video-preprocess-query-plan/",
      "data/jimeng-lab/proof-20260612-lip-sync-human-contract-infer/preprocess-query/",
    ],
    nextProbe: "Use task ids from a captured or approved video_generate/pre_process flow, compare with video-preprocess-query-plan, then record/replay through fetchJimengVideoPreprocessResults.",
  },
  "/mweb/v1/video_generate/face_auth/skip": {
    evidence: [
      "data/jimeng-lab/proof-20260610-static-locate-video-generate-helpers/",
    ],
    nextProbe: "Capture the Seedance face-auth skip flow, compare payloads offline, and require explicit approval before live replay because it can create provider-side task state.",
  },
  "/mweb/v1/video_generate/face_auth/skip/query": {
    evidence: [
      "data/jimeng-lab/proof-20260610-static-locate-video-generate-helpers/",
    ],
    nextProbe: "Use a task id from a captured face_auth/skip flow and record/replay the paired status query.",
  },
  "/mweb/v1/mget_story": {
    evidence: [
      "data/jimeng-lab/proof-20260611-probe-user-story-list/",
      "data/jimeng-lab/proof-20260611-story-archive-dryrun/",
      "data/jimeng-lab/proof-20260611-static-inventory-story-archive/",
      "data/jimeng-lab/proof-20260611-profile-story-sweep-puai/",
      "data/jimeng-lab/proof-20260611-profile-story-sweep-xiaobodeng/",
      "data/jimeng-lab/proof-20260611-profile-story-sweep-fuqiang/",
    ],
    nextProbe: "Find or capture a public profile with a non-empty story list, then run story-records with real story_id_list values and record/replay the cassette; the 2026-06-11 no-spend sweep over three followed profiles returned ret=0 with story_count=0.",
  },
  "/lv/v1/cc_web/replicate/get_search_words": {
    evidence: [
      "data/jimeng-lab/proof-20260610-capcut-search-words-probe/",
      "data/jimeng-lab/proof-20260610-capcut-probe-hot-words/",
    ],
    nextProbe: "Passively capture the CapCut replicate search UI call that returns keyword data, then replay with signed CapCut headers and a cassette.",
  },
  "/lv/v1/cc_web/replicate/search_templates": {
    evidence: [
      "data/jimeng-lab/proof-20260610-capcut-probe-search/",
      "data/jimeng-lab/proof-20260610-capcut-probe-search-templates-v2/",
    ],
    nextProbe: "Capture an exact CapCut template-search UI request including keyword/category/search-id fields, then add a typed replay fixture.",
  },
  "/lv/v1/cc_web/plane/batch_get_collection_templates": {
    evidence: [
      "data/jimeng-lab/proof-20260610-capcut-probe-batch-collection-templates/",
      "data/jimeng-lab/proof-20260610-capcut-probe-batch-collection-templates-v2/",
    ],
    nextProbe: "Capture the collection-row batch UI payload and compare it against the signed no-spend variants that returned ret=1000.",
  },
  "/lv/v1/cc_web/plane/get_collection_presets": {
    evidence: [
      "data/jimeng-lab/proof-20260610-capcut-probe-presets/",
      "data/jimeng-lab/proof-20260610-capcut-probe-presets-confirmed-collection/",
    ],
    nextProbe: "Capture a preset-list UI request with the required LV auth/header context, then replay with a confirmed collection id.",
  },
  "/lv/v1/cc_web/plane/preset_template_detail": {
    evidence: [
      "data/jimeng-lab/proof-20260610-capcut-probe-template-detail/",
      "data/jimeng-lab/proof-20260610-capcut-probe-presets-confirmed-collection/",
    ],
    nextProbe: "First unblock get_collection_presets, then use a real preset id from that listing to record/replay preset_template_detail.",
  },
  "/lv/v1/cc_web/plane/fuzzy_search_templates": {
    evidence: [
      "data/jimeng-lab/proof-20260610-capcut-probe-fuzzy/",
    ],
    nextProbe: "Capture a non-empty fuzzy-search UI request and replay the exact signed body instead of guessed keyword/title variants.",
  },
}

const KNOWN_ENDPOINTS: JimengDiscoveryKnownEndpoint[] = [
  known("/mweb/v1/aigc_draft/generate", "partial", "text2image-plan/text2image-compare/text2video-plan/omni-video-plan/text2video-compare/omni-video-compare/generation-contract/text2video/image2video/frames2video/lip-sync", "Unified generation submit; direct image/video, first/end-frame, and Seedance omni-reference request builders are dry-run covered with semantic compare gates; saved live text/image-to-video proofs are now schema-validated by generation-contract; live lip-sync/end-frame/omni-reference still require capture compare or approval-gated submit."),
  known("/mweb/v1/execute_generate_audit", "dry_run_only", "generate-audit-plan/request-plan-compare", "Generation pre-audit material transform is modeled for image/video/audio/subject dry-run plans; live replay still needs passive UI capture compare."),
  known("/mweb/v1/get_asset_list", "implemented", "assets", "No-spend workspace asset/history listing."),
  known("/mweb/v1/get_history", "implemented", "history-list", "No-spend paginated history list; prior live probes returned a valid empty records_list, so use assets/history-records for richer known-populated lookups."),
  known("/mweb/v1/get_history_by_ids", "implemented", "history-records", "No-spend history lookup by submit/history id."),
  known("/mweb/v1/get_history_queue_info", "implemented", "history-queue", "No-spend queue/progress lookup."),
  known("/mweb/v1/get_video_by_vid", "implemented", "video-info", "No-spend VOD metadata lookup."),
  known("/mweb/v1/get_common_config", "implemented", "image-models", "No-spend image model/common config catalog."),
  known("/mweb/v1/get_user_info", "implemented", "profile-research", "No-spend public profile metadata lookup by sec_uid."),
  known("/mweb/v1/get_homepage", "implemented", "profile-research", "No-spend public profile work/homepage listing by sec_uid."),
  known("/mweb/v1/get_favorite_list", "implemented", "profile-research", "No-spend public profile favorite/reference work listing by sec_uid."),
  known("/mweb/v1/get_user_story_list", "implemented", "profile-research", "No-spend public profile story/archive listing by sec_uid; current proof returned an empty but valid story_list."),
  known("/mweb/v1/mget_story", "partial", "story-records", "No-spend story detail lookup by story_id_list is implemented; live proof still needs real story ids from a non-empty story list or UI capture."),
  known("/mweb/v1/submit_async_task", "dry_run_only", "story-export-plan", "Story export task submit uses type=pack_story_mode and stringified payload; live submit creates task state and needs approval or a disposable story fixture."),
  known("/mweb/v1/mget_async_task", "partial", "async-tasks", "No-spend async task lookup by task_id_list is implemented; live proof needs a real task id from an approved export flow."),
  known("/mweb/v1/create_story", "blocked", null, "Creates story/archive state; require a disposable story fixture or exact UI capture before live replay."),
  known("/mweb/v1/update_story", "blocked", null, "Mutates story/archive state; require a disposable story fixture or exact UI capture before live replay."),
  known("/mweb/v1/delete_story", "blocked", null, "Deletes story/archive state; require a disposable story fixture or explicit approval before live replay."),
  known("/mweb/v1/mix_audio_video", "dry_run_only", "mix-audio-plan/request-plan-compare", "Single audio/video mix task request transform is dry-run covered with body snake-case plus optional babi_param query compare; live replay creates task state and needs capture approval."),
  known("/mweb/v1/mix_audio_videos", "dry_run_only", "mix-audio-plan/request-plan-compare", "Batch audio/video mix task request transform is dry-run covered with input_list plus optional babi_param query compare; live replay creates task state and needs capture approval."),
  known("/mweb/v1/mpack_image", "blocked", null, "Packs image material through dreamina-material-data-service; capture the exact caller input shape before promotion."),
  known("/mweb/v1/submit_survey", "blocked", null, "Submits feature beta-test survey state, currently seen in the lip-sync feature-gate bundle; mutation requires explicit approval."),
  known("/mweb/v1/get_follow_list", "implemented", "profile-research", "No-spend current-account following/follower listing; this endpoint does not accept a public target sec_uid."),
  known("/mweb/v1/get_item_info", "implemented", "profile-research", "No-spend published work detail with generation prompt, model, reference frame, media, and engagement metadata."),
  known("/mweb/v1/mget_item_info", "implemented", "profile-research", "No-spend batch published work detail by item_id_list; frontend callers pass itemIdList before snake-case conversion."),
  known("/mweb/v1/workspace/list", "implemented", "workspace-context", "No-spend workspace listing for logged-in project/workspace context."),
  known("/mweb/v1/workspace/get_by_ids", "implemented", "workspace-context", "No-spend workspace lookup by ids inferred from workspace list or supplied explicitly."),
  known("/mweb/search/v1/sug", "implemented", "research-keywords", "No-spend keyword suggestions for inspiration and short-film research channels; asset suggestions are explicitly skipped after ret=1000 proof."),
  known("/mweb/search/v1/guess", "implemented", "research-keywords", "No-spend guessed/trending research keywords for inspiration, short-film, and asset channels."),
  known("/mweb/search/v1/search", "implemented", "research-search", "No-spend inspiration, short-film, and workspace asset search with Effect Schema boundary validation and the recovered frontend AES media transform."),
  known("/mweb/search/v1/fetch_debug/search", "blocked", null, "Frontend debug-wrapper path is not the production search request; use implemented research-search for /mweb/search/v1/search."),
  known("/commerce/v1/benefits/user_credit", "implemented", "account-credit", "Signed no-spend account credit balance read used to gate paid generation tests."),
  known("/commerce/v1/subscription/price_list", "implemented", "commerce-pricing", "Signed no-spend VIP subscription price-list read; frontend body uses aid=513695, region=cn, platform=7, scene=vip."),
  known("/commerce/v1/purchase/price_list", "implemented", "commerce-pricing", "Signed no-spend credit purchase price-list read; frontend body uses goodsTypes=[\"credit\"]."),
  known("/commerce/v1/subscription/cc_price_list", "blocked", null, "Overseas subscription price-list variant; current Jimeng host/session returned HTTP 404 text/plain, so it likely needs overseas gateway or region context."),
  known("/commerce/v1/subscription/get_change_plan_info", "blocked", null, "Requires selected plan context including pid, skuId, scene=vip, and pmsTrade from a real subscription plan UI selection."),
  known("/commerce/v3/trade/query_trade", "blocked", null, "Trade/order status read depends on a real trade/order id from a payment flow; do not probe with guessed payment state."),
  known("/commerce/v3/trade/user/can_refund_list", "blocked", null, "Refund eligibility list depends on order/refund context; capture exact account order UI request before promotion."),
  known("/commerce/v3/trade/user/refund_record_list", "blocked", null, "Refund record list depends on order/refund context; capture exact account order UI request before promotion."),
  known("/commerce/v3/resource/benefit_metadata", "implemented", "commerce-benefits", "Signed no-spend benefit metadata read for AIGC/function quota and pay-mode strategy fields."),
  known("/commerce/v3/benefits/batch_get_user_benefit", "implemented", "commerce-benefits", "Signed no-spend user benefit asset read for current quota/pay-mode rows."),
  known("/mweb/v1/get_settings", "implemented", "account-config", "No-spend current-account user custom settings read."),
  known("/mweb/v1/get_ug_info", "implemented", "account-config", "No-spend current-account web registration state read."),
  known("/mweb/v1/get_invite_status", "implemented", "account-config", "No-spend current-account invite status read."),
  known("/mweb/v1/get_notice_list", "blocked", null, "No-spend empty/count/pagination probes returned ret=1000 invalid parameter; capture the exact home notice UI request before promotion."),
  known("/mweb/v1/get_panel_info", "blocked", null, "No-spend empty/panel/type probes returned ret=2012 get panel info failed; capture the exact panel/favorite-voice UI request before promotion."),
  known("/mweb/v1/get_short_url", "cataloged_only", null, "No-spend probe showed long_url returns ret=0, but this is a low-value URL shortener service rather than a UGC GenAI capability."),
  known("/mweb/v1/get_weekly_challenge_list", "cataloged_only", null, "Back burner: no-spend Jimeng activity/challenge listing. Cataloged as trend/contest metadata, but not important for the current UGC generation pipeline."),
  known("/mweb/v1/get_weekly_challenge_detail", "cataloged_only", null, "Back burner: no-spend Jimeng activity/challenge detail by act_key. Removed from active CLI scope because it is not core UGC workflow surface."),
  known("/mweb/v1/get_weekly_challenge_work_list", "cataloged_only", null, "Back burner: activity work-list likely needs exact detail UI payload; skip unless challenge/trend mining becomes a real product requirement."),
  known("/mweb/v1/cc_data_sync/get_account_info", "cataloged_only", null, "No-spend probe with account_type=capcut returned ret=0, but this only exposes CapCut binding status and is not a UGC GenAI surface."),
  known("/mweb/v1/cc_data_sync/get_account_token", "blocked", null, "CapCut data-sync token read can expose account credentials; do not replay or persist raw output without a dedicated credential-safe flow."),
  known("/mweb/v1/get_experiment_params", "implemented", "runtime-config", "No-spend frontend experiment parameter read."),
  known("/mweb/v1/get_home_header_banner_config", "implemented", "runtime-config", "No-spend home header banner/runtime config read."),
  known("/mweb/v1/get_help_desk_entrance", "implemented", "runtime-config", "No-spend help desk entrance read with URL redacted in normalized output."),
  known("/mweb/v1/speech/asr_token", "implemented", "runtime-config", "No-spend ASR websocket token read with token and ws_url redacted in normalized output."),
  known("/mweb/v1/speech/asr_hotwords", "implemented", "runtime-config", "No-spend ASR hotword list read."),
  known("/mweb/v1/infinite_canvas/list_project", "implemented", "infinite-canvas", "No-spend infinite-canvas project listing."),
  known("/mweb/v1/infinite_canvas/project_detail", "implemented", "infinite-canvas", "No-spend infinite-canvas project detail lookup by project_id."),
  known("/mweb/v1/infinite_canvas/v1/get_canvas_custom_ratio", "implemented", "infinite-canvas", "No-spend infinite-canvas custom ratio listing by user_id."),
  known("/mweb/v1/infinite_canvas/get_conversation_list", "implemented", "infinite-canvas", "No-spend infinite-canvas conversation listing by project_id."),
  known("/mweb/v1/infinite_canvas/fetch_conversation", "blocked", null, "Read path requires a real conversation_id from a non-empty get_conversation_list result; current no-spend project has zero conversations."),
  known("/mweb/v1/infinite_canvas/conversation", "blocked", null, "Infinite-canvas conversation SSE/generation endpoint may consume points or create turns; capture exact UI submit and compare before live replay."),
  known("/mweb/v1/infinite_canvas/create_conversation", "blocked", null, "Creates conversation state under a project; require disposable project context or exact UI capture."),
  known("/mweb/v1/infinite_canvas/del_conversation", "blocked", null, "Deletes conversation state; require disposable conversation id or explicit approval."),
  known("/mweb/v1/infinite_canvas/delete_turn", "blocked", null, "Deletes a generated conversation turn; require disposable turn id or explicit approval."),
  known("/mweb/v1/infinite_canvas/update_conversation", "blocked", null, "Renames/updates conversation state; require disposable conversation id or explicit approval."),
  known("/mweb/v1/infinite_canvas/create_project", "blocked", null, "Creates infinite-canvas project state; require disposable fixture or explicit approval."),
  known("/mweb/v1/infinite_canvas/delete_project", "blocked", null, "Deletes infinite-canvas project state; require disposable project id or explicit approval."),
  known("/mweb/v1/infinite_canvas/edit", "blocked", null, "Infinite-canvas edit endpoint can modify canvas/generation state; capture exact UI payload before promotion."),
  known("/mweb/v1/infinite_canvas/update_project", "blocked", null, "Updates infinite-canvas project metadata/draft state; require disposable project id or explicit approval."),
  known("/mweb/v1/infinite_canvas/v1/submit_changeset", "blocked", null, "Submits canvas changesets and mutates project draft state; require disposable project/draft fixture or exact UI capture."),
  known("/mweb/v1/infinite_canvas/v1/update_canvas_custom_ratio", "blocked", null, "Mutates custom ratio presets; require disposable ratio/user context or explicit approval."),
  known("/mweb/v1/video_generate/get_common_config", "implemented", "lip-sync-config", "No-spend video/lip-sync model config."),
  known("/mweb/v1/video_generate/get_switch_model_queue_info", "blocked", null, "No-spend probes with empty, model_req_key, model_req_keys, and scene bodies returned ret=1000 invalid parameter; capture the exact frontend switch-model queue body before promotion."),
  known("/mweb/v1/video_generate/pre_process", "partial", "video-preprocess-plan/request-plan-compare/submitJimengVideoPreprocess", "Frontend data service pre-process task body is modeled for avatar image checks, voice recommendation, audio detect, and audio silence checks; typed service and cassette replay exist, but live replay creates task state and needs passive capture compare plus approval."),
  known("/mweb/v1/video_generate/mget_pre_process_result", "partial", "video-preprocess-query-plan/request-plan-compare/fetchJimengVideoPreprocessResults", "Pre-process result lookup body is modeled by submit_id_list and has typed service/cassette replay coverage; live replay needs task ids from a captured or approved pre_process flow."),
  known("/mweb/v1/video_generate/face_auth/skip", "blocked", null, "Seedance face-auth skip submit task can create provider-side task state; capture exact UI payload and approval context before live replay."),
  known("/mweb/v1/video_generate/face_auth/skip/query", "blocked", null, "Face-auth skip status query depends on a task id from video_generate/face_auth/skip; capture that flow before promotion."),
  known("/mweb/v1/aigc_draft/cancel_generate", "blocked", null, "Cancels an in-flight generation and mutates provider job state; use only with an active disposable job or exact UI capture."),
  known("/mweb/v1/aigc_draft/generate_accelerate", "blocked", null, "Generation acceleration may spend quota or alter queue priority; require exact UI capture and explicit approval before live replay."),
  known("/cc/v1/workspace/get_user_workspaces", "blocked", null, "LV workspace list requires exact lite_aid/session gateway context; no-spend count/cursor/lite_aid probes returned ret=1014 system busy."),
  known("/lv/v1/user/get_enable_list", "blocked", null, "No-spend empty/null probes returned ret=1014 system busy; capture the exact LV authority request/auth context before promotion."),
  known("/lv/v1/web/get_lite_user", "blocked", null, "No-spend empty/need_cache/app probes returned ret=1014 system busy; capture exact LV lite-user auth context before promotion."),
  known("/lv/v1/ad_maker/user/get_enable_list", "blocked", null, "Safe Jimeng-host probes returned HTML instead of JSON, so this likely needs the correct LV/ad-maker gateway or UI auth context."),
  known("/lv/v1/commerce/get_entrances", "blocked", null, "Safe Jimeng-host probes returned HTML instead of JSON; static evidence shows custom commerce headers/gateway are needed before replay."),
  known("/lv/v1/platform/query_auth_status", "blocked", null, "Safe Jimeng-host probes returned HTML instead of JSON; capture exact platform auth-status UI request and gateway before promotion."),
  known("/lv/v1/asset/list", "blocked", null, "LV EverCloud material list needs exact workspace_id/space_id context from the workspace service; capture the UI request before promotion."),
  known("/lv/v1/asset/query", "blocked", null, "LV user asset query needs exact workspace/session context; no-spend workspace variants returned ret=1014 system busy."),
  known("/lv/v1/asset/detail", "blocked", null, "LV material detail lookup depends on asset ids plus workspace_id/space_id from a successful LV asset list/query capture."),
  known("/lv/v1/asset/query_process", "blocked", null, "LV asset async process query depends on process_id values from mutating copy/create/upload flows; capture a matching UI flow before promotion."),
  known("/lv/v1/editor/image/ai_model/submit_task", "blocked", null, "CapCut/LV editor image AI model task submit; capture exact UI payload and approval context before live replay."),
  known("/lv/v1/editor/image/ai_model/batch_get_results", "blocked", null, "CapCut/LV editor image AI result lookup depends on task ids from ai_model/submit_task; capture a matching task flow before promotion."),
  known("/lv/v1/editor/image/ai_model/materials", "blocked", null, "CapCut/LV editor image AI materials endpoint needs exact model/material UI context before CLI promotion."),
  known("/lv/v1/editor/image/ai_model/create_cloth_mask", "blocked", null, "CapCut/LV editor cloth-mask task endpoint may create provider-side task state; capture exact UI payload before live replay."),
  known("/lv/v1/editor/image/batch_get_url", "blocked", null, "CapCut/LV editor image URL resolver needs exact resource id/URI list and auth context from UI before promotion."),
  known("/lv/v1/editor/image/embed_resource", "blocked", null, "CapCut/LV editor image embed-resource endpoint needs exact source resource payload before promotion."),
  known("/lv/v1/editor/image/gen_background", "blocked", null, "CapCut/LV editor AI background generation endpoint; capture exact UI payload and approval context before live replay."),
  known("/lv/v1/editor/image/interactive_matting", "blocked", null, "CapCut/LV editor interactive matting endpoint; capture exact brush/image payload before promotion."),
  known("/lv/v1/editor/image/saliency_seg", "blocked", null, "CapCut/LV editor cutout endpoint is distinct from implemented Jimeng /mweb/v1/saliency_seg; capture exact editor payload before promotion."),
  known("/api/biz/v1/image/entity_seg", "blocked", null, "CapCut/LV auto-selection entity segmentation endpoint; capture exact editor UI payload before promotion."),
  known("/lv/v1/cc_web/plane/del_presets_template", "blocked", null, "Deletes saved preset-template state; signed probe intentionally rejects this mutating path without a disposable fixture or explicit approval."),
  known("/lv/v1/editor/template/recent_list", "blocked", null, "Signed no-session LV probes with count/lang and cursor bodies returned ret=1015 check login error; capture the logged-in editor request and auth context before promotion."),
  known("/lv/v1/editor/template/check_post_permission", "blocked", null, "Signed no-session LV permission probe returned ret=1015 check login error; capture the logged-in editor request before promotion."),
  known("/lv/v1/editor/draft/get_template_file", "blocked", null, "Signed LV probe with empty uris returned ret=1016 ERR_PARAM; promotion needs real template file URIs from a captured template/draft flow."),
  known("/lv/v1/editor/draft/get_version_list", "blocked", null, "LV draft version listing depends on a real editor draft id and signed LV auth context; capture an editor version-history UI request before promotion."),
  known("/lv/v1/editor/plane/intelligence/query_recommend_template", "blocked", null, "Signed LV template recommendation probe with no assets returned ret=-3 bad request; capture exact workspace/assets/aspect-ratio payload before promotion."),
  known("/lv/v2/cc_web_task/get_task_draft", "blocked", null, "Signed feed-api task-draft probes with empty/zero task ids returned ret=1015 check login error; requires real commercial-photo task id plus auth context."),
  known("/lv/v1/asset/copy", "blocked", null, "Copies asset records across workspaces and then polls asset/query_process; require a disposable workspace/asset fixture or explicit approval."),
  known("/lv/v1/asset/create", "blocked", null, "Creates LV asset/folder records in a workspace; require a disposable workspace fixture or explicit approval."),
  known("/lv/v1/asset/create_cloud_asset", "blocked", null, "Creates cloud asset records after upload preparation; require a disposable workspace/space fixture or explicit approval."),
  known("/lv/v1/asset/delete", "blocked", null, "Deletes LV asset records; require disposable asset ids or explicit approval."),
  known("/lv/v1/asset/label_as_exported", "blocked", null, "Marks LV assets as exported and mutates account asset state; require disposable asset ids or exact UI capture."),
  known("/lv/v1/asset/prepare_upload_cloud", "blocked", null, "Prepares LV cloud upload state and may allocate upload resources; require disposable workspace/space context or approval."),
  known("/lv/v1/asset/rename", "blocked", null, "Renames LV asset records; require disposable asset ids or explicit approval."),
  known("/lv/v1/editor/template/add", "blocked", null, "Publishes/adds an editor template from draft data; mutates account/template state and requires explicit approval."),
  known("/lv/v1/editor/template/add_async", "blocked", null, "Async template add/publish submit; capture exact UI payload and use only with disposable draft/template context."),
  known("/lv/v1/editor/template/add_query", "blocked", null, "Async template add status query depends on ids from add_async; capture a matching template publish flow before promotion."),
  known("/lv/v1/ever_photo/batch_sync_asset", "blocked", null, "Batch syncs EverPhoto/LV assets and requires verified asset/context state; require exact UI capture or disposable fixture."),
  known("/lv/v1/ever_photo/promote_asset", "blocked", null, "Promotes EverPhoto/LV assets into workspace/cloud asset state; require disposable asset/space fixture or approval."),
  known("/mweb/v1/remove_history", "blocked", null, "Removes generated history/workbench records; require disposable history ids or explicit approval."),
  known("/mweb/v1/update_video_default_bgm", "blocked", null, "Mutates a video/workbench record's default BGM state; require disposable item context or explicit approval."),
  known("/mweb/v1/get_user_local_item_list", "implemented", "voice-clones", "No-spend cloned voice/user local item listing."),
  known("/mweb/v1/get_local_item_list", "implemented", "local-items", "No-spend current-account unpublished/generated item detail by local item_id_list."),
  known("/mweb/v1/voice/submit_task", "dry_run_only", "voice-clone-submit/request-plan-compare", "Voice clone submit may create assets or consume quota; dry-run request shape can be compared offline against UI captures."),
  known("/mweb/v1/voice/query_task", "partial", "voice-clone-query/request-plan-compare", "Query command exists; live proof needs a real task id, and dry-run request shape can be compared offline against UI captures."),
  known("/mweb/v1/voice/update", "dry_run_only", "voice-clone-update/request-plan-compare", "Mutates cloned voice assets; dry-run request shape can be compared offline against UI captures."),
  known("/mweb/v1/voice/delete", "dry_run_only", "voice-clone-delete/request-plan-compare", "Mutates cloned voice assets; dry-run request shape can be compared offline against UI captures."),
  known("/mweb/v1/feed", "partial", "voices", "Built-in voice library replay is implemented for captured signed feed requests."),
  known("/mweb/v1/tts_generate", "implemented", "tts/sample-voices", "Direct TTS MP3 generation."),
  known("/mweb/v1/get_upload_token", "implemented", "upload-token/upload-image/upload-video", "Scene 1/2/3 upload token support."),
  known("/mweb/v1/imagex/submit_audit_job", "implemented", "subject-create/subject-update", "Used in subject image creation/update path."),
  known("/mweb/v1/get_image_by_uri", "implemented", "subject-create/subject-update", "Provider image URI lookup used in subject flows."),
  known("/mweb/v1/get_explore", "implemented", "templates/short-videos", "No-spend Explore/template/short-video mining."),
  known("/mweb/v1/feed_short_video", "implemented", "overseas-short-videos", "No-spend overseas/reference short-video mining."),
  known("/mweb/v1/get_image_description", "implemented", "describe-image", "No-spend reference image description."),
  known("/mweb/v1/face_recognize", "implemented", "describe-image", "No-spend face probe."),
  known("/mweb/v1/blend_preview", "implemented", "controlnet-preview", "No-spend pose/depth/canny preview."),
  known("/mweb/v1/pose_detect", "implemented", "controlnet-preview", "Pose validation for ControlNet preview."),
  known("/mweb/v1/saliency_seg", "implemented", "object-mask", "No-spend object/mask segmentation."),
  known("/mweb/v1/dreamina_subject/get", "implemented", "subjects", "No-spend subject/persona listing."),
  known("/mweb/v1/dreamina_subject/create", "implemented", "subject-create", "Subject/persona creation from image."),
  known("/mweb/v1/dreamina_subject/update", "implemented", "subject-update", "Subject/persona update."),
  known("/mweb/v1/dreamina_subject/delete", "implemented", "subject-delete", "Subject/persona delete."),
  known("/mweb/v1/dreamina_subject/generate_voice", "dry_run_only", "subject-generate-voice/request-plan-compare", "Subject voice generation may consume quota; dry-run request shape can be compared offline against UI captures before approval."),
  known("/lv/v1/effect/get_panel_info", "implemented", "capcut-editor-catalog", "No-spend LV editor panel/category catalog for fonts/effects."),
  known("/lv/v1/effect/get_category_effects", "implemented", "capcut-editor-catalog", "No-spend LV editor category effect/font rows."),
  known("/lv/v1/effect/get_all_fonts", "implemented", "capcut-editor-catalog", "No-spend LV editor all-font catalog."),
  known("/lv/v1/editor/plane/color/feed", "implemented", "capcut-editor-catalog", "No-spend LV editor color palette feed."),
  known("/lv/v1/editor/effect/recent_list", "blocked", "capcut-probe", "Signed no-spend probes returned ret=1015 check login error; needs exact LV editor auth context or UI capture."),
  known("/lv/v2/editor/effect/recent_list", "blocked", "capcut-probe", "Signed no-spend probes returned ret=1015 check login error; needs exact LV editor auth context or UI capture."),
  known("/lv/v1/editor/plane/common/recent_list", "blocked", "capcut-probe", "Signed no-spend probes returned ret=0 but empty item_list; needs a non-empty UI capture before promotion."),
  known("/lv/v1/editor/plane_draft/get_content_map", "blocked", "capcut-probe", "Signed no-spend probes returned ret=1016 ERR_PARAM for empty/zero draft ids; needs a real draft/content-map id capture."),
  known("/lv/v1/editor/plane_draft/get_draft_detail", "blocked", "capcut-probe", "Signed no-spend probes returned ret=1015 check login error for empty/zero draft ids; needs exact LV auth and real draft id context."),
  known("/lv/v1/ever_photo/batch_get_sync_state", "blocked", "capcut-probe", "Signed no-spend probes returned ret=1015 check login error for empty id lists; needs exact EverPhoto/LV auth and real asset ids."),
  known("/lv/v1/ever_photo/get_user_space", "blocked", "capcut-probe", "Signed no-spend probes returned ret=1015 check login error; needs exact EverPhoto/LV auth context."),
  known("/lv/v1/intelligence/preset_resource_list", "blocked", "capcut-probe", "Signed no-spend probes returned ret=-1 system busy across empty/image-editor/query bodies; needs exact UI payload capture."),
  known("/lv/v2/task/multi_get_tasks", "blocked", "capcut-probe", "Signed no-spend probes returned ret=1015 check login error for empty/zero task ids; needs real task ids and signed feed auth context."),
  known("/lv/v1/cc_web/plane/get_categories", "implemented", "capcut-categories", "No-spend CapCut commercial category catalog."),
  known("/lv/v1/cc_web/plane/get_collections", "implemented", "capcut-collections", "No-spend CapCut template collection/category ids."),
  known("/lv/v1/cc_web/plane/get_collection_templates", "implemented", "capcut-collection-templates", "No-spend CapCut template rows by collection id; exact body uses id, not category_id."),
  known("/lv/v1/cc_web/plane/get_template_detail", "implemented", "capcut-template-detail", "No-spend CapCut template detail by template web id."),
  known("/lv/v1/cc_web/replicate/get_search_words", "blocked", null, "Signed no-spend probes returned ret=0 but only region metadata, not usable search words; capture a UI call that returns keyword data before promotion."),
  known("/lv/v1/cc_web/replicate/search_templates", "blocked", null, "Signed no-spend probes returned ret=1000 param error across recovered keyword/category/search-id variants; capture an exact template-search UI request before promotion."),
  known("/lv/v1/cc_web/plane/batch_get_collection_templates", "blocked", null, "Signed no-spend probes returned ret=1000 param error across object, list, and nested collection variants; capture the exact batch row UI payload before promotion."),
  known("/lv/v1/cc_web/plane/get_collection_presets", "blocked", null, "Signed no-spend probes using confirmed collection ids returned ret=1015 check login error; capture the exact preset UI call and required auth/header context before promotion."),
  known("/lv/v1/cc_web/plane/preset_template_detail", "blocked", null, "Preset detail depends on get_collection_presets data, but preset listing currently returns ret=1015 in safe probes; capture a real preset UI flow before promotion."),
  known("/lv/v1/cc_web/plane/fuzzy_search_templates", "blocked", null, "Signed no-spend probes returned ret=0 with empty lists for guessed keyword/title bodies; capture a non-empty fuzzy-search UI request before promotion."),
  known("/mweb/v1/get_unread_count", "cataloged_only", null, "Low-value notification count endpoint."),
  known("/mweb/v1/workspace/create", "captured_only", null, "Workspace mutation; low priority until needed for automated project setup."),
  known("/mweb/v1/workspace/update", "captured_only", null, "Workspace mutation; low priority until needed for automated project setup."),
  known("/mweb/v1/creation_agent/v2/conversation", "partial", null, "Older SSE agent submit preserved but not a current high-priority UGC surface."),
  known("/mweb/v1/creation_agent/v2/get_agent_config", "implemented", "agent-catalog", "Schema-backed agent/model config catalog."),
  known("/mweb/v1/creation_agent/v2/skill/list", "implemented", "agent-catalog", "Schema-backed official/custom agent skill catalog."),
]

function known(endpoint: string, status: JimengDiscoveryKnownStatus, command: string | null, note: string): JimengDiscoveryKnownEndpoint {
  const audit = KEEP_GAP_AUDIT_BY_ENDPOINT[endpoint]
  return {
    endpoint,
    status,
    command,
    note,
    evidence: audit ? [...audit.evidence] : [],
    nextProbe: audit?.nextProbe ?? null,
  }
}

function cloneKnownEndpoint(endpoint: JimengDiscoveryKnownEndpoint): JimengDiscoveryKnownEndpoint {
  return {
    ...endpoint,
    evidence: [...endpoint.evidence],
  }
}
