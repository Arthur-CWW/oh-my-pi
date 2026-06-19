/** @jsxImportSource react */
import * as React from "react"
import {
  ArrowUp,
  BarChart3,
  Bot,
  Braces,
  CheckCircle2,
  CircleDollarSign,
  Clapperboard,
  Clock,
  Copy,
  Download,
  Eye,
  FastForward,
  FileJson,
  GitBranch,
  GitFork,
  Home,
  Layers3,
  MessageSquare,
  Network,
  Pause,
  Play,
  PlayCircle,
  Plus,
  RefreshCw,
  Rewind,
  Settings,
  Sparkles,
  Target,
  Wand2,
  XCircle,
  Zap,
} from "lucide-react"
import { Button } from "./components/ui/button"
import { Input } from "./components/ui/input"
import { Tabs, type TabItem } from "./components/ui/tabs"
import { Textarea } from "./components/ui/textarea"
import {
  CommandSurface,
  InspectorPanel,
  MetricRow,
  PanelCard,
  PanelHeader,
  ScoreMeter,
  SidebarRow,
  StatusBadge,
  ToolbarCluster,
  WorkbenchCanvas,
  WorkbenchContent,
  WorkbenchMain,
  WorkbenchShell,
  WorkbenchSidebar,
  WorkbenchTopbar,
} from "./design-system/workbench"
import { cn } from "./lib/cn"
import { ugcStudioWorkspace, type BranchSnapshot, type CandidateStatus, type CreativeCandidate, type JsonValue, type PersonaProfile, type ReferenceProfile, type ReviewVerdict, type UgcStudioWorkspace } from "./ugcStudioModel"
import { createInitialLocalState, isLocalState, referenceProfileToArchive, type ReferenceArchiveFormatOutput, type UgcExportManifest, type UgcLocalState, type UgcProviderJob, type UgcProviderJobStatus, type UgcReferenceArchive, type UgcReferenceManifestAsset, type UgcWorkspaceBundle, type UgcWorkspaceBundleImportResult } from "../ugc/local-state"
import { deriveUgcDeveloperGraph, type DerivedGraphFamily } from "../ugc/developer-graph"

type ReactView = "atlas" | "explore" | "review" | "campaign" | "reference" | "editor" | "graph" | "provider"
type KieOperation = "image-text" | "image-to-image" | "video-text" | "image-to-video" | "reference-to-video" | "avatar" | "omni-video"

interface KieCapability {
  operation: KieOperation
  model: string
  label: string
  family: "image" | "video" | "character"
  estimatedCostUsd: number
  frugal: boolean
  notes: string
}

interface KieRequest {
  operation: KieOperation
  prompt: string
  aspectRatio: string
  durationSec: number
  resolution: string
  quality: "basic" | "standard" | "pro"
  imageUrl?: string
  maxSpendUsd?: number
  live?: boolean
}

type ProductLane = "brainrot" | "ugc-ads"
type LaneFilter = "all" | ProductLane
type WorkflowDemoLane = ProductLane | "all"

interface AnalysisToKieInput {
  readonly analysisJobId: string
  readonly lane: ProductLane
  readonly targetId?: string
  readonly targetKind?: "candidate" | "reference"
  readonly operation?: KieOperation
}

interface InspirationManifest {
  readonly provider: "higgsfield" | "arcads"
  readonly label: string
  readonly manifestPath: string
  readonly lane: ProductLane
  readonly summary: string
}

interface UgcMutationEnvelope {
  readonly state?: UgcLocalState
  readonly error?: string
}

interface CodexJobMediaSummary {
  readonly mediaUrl: string | null
  readonly referenceFrameUrls: readonly string[]
  readonly artifactPaths: readonly string[]
  readonly frameCount: number
  readonly artifactCount: number
  readonly framePreparation: string | null
}

type WorkflowStreamStatus = "loading" | "live" | "polling" | "unavailable"

interface WorkflowCounter {
  readonly label: string
  readonly value: string
}

interface WorkflowEventTelemetry {
  readonly id?: string
  readonly runId: string
  readonly type: string
  readonly lane: ProductLane
  readonly phase?: string
  readonly agent?: string
  readonly message: string
  readonly artifactPath?: string
  readonly resultPreview?: string
  readonly errorPreview?: string
  readonly createdAt?: string
  readonly sequence?: number
  readonly rawJson: JsonValue
}

interface WorkflowRunTelemetry {
  readonly id: string
  readonly lane: ProductLane
  readonly status: string
  readonly title: string
  readonly source: string
  readonly currentPhase: string
  readonly counters: readonly WorkflowCounter[]
  readonly events: readonly WorkflowEventTelemetry[]
  readonly artifactPaths: readonly string[]
  readonly resultPreview?: string
  readonly errorPreview?: string
  readonly createdAt?: string
  readonly updatedAt?: string
  readonly rawJson: JsonValue
}

interface WorkflowTelemetryState {
  readonly runs: readonly WorkflowRunTelemetry[]
  readonly streamStatus: WorkflowStreamStatus
  readonly routeAvailable: boolean
  readonly demoRouteUnavailable: boolean
  readonly message: string
  readonly demoRunningLane: WorkflowDemoLane | null
  readonly demoResult: JsonValue | null
}

interface WorkflowTelemetryController extends WorkflowTelemetryState {
  readonly refresh: () => Promise<void>
  readonly runDemoWorkflow: (lane: WorkflowDemoLane) => Promise<void>
}

interface WorkflowImportRequestResult {
  readonly ok: boolean
  readonly status: number
  readonly routeUnavailable: boolean
  readonly payload: JsonValue
}

interface PersonaCardModel {
  id: string
  name: string
  archetype: string
  niche: string
  voice: string
  accent: string
  status: "Approved" | "In Review" | "Draft" | "Rejected"
  clips: number
  branches: number
  followers: string
  conversions: string
  color: string
}

interface ExplorationItem {
  id: string
  title: string
  subtitle: string
  score: number
  status: "keep" | "review" | "new" | "risk"
  personaId?: string
  candidateId?: string
}

interface ExplorationRow {
  id: string
  step: string
  title: string
  description: string
  items: ExplorationItem[]
}

interface CampaignColumn {
  id: string
  title: string
  subtitle: string
  nodes: CampaignNode[]
}

interface CampaignNode {
  id: string
  title: string
  meta: string
  score: string
  status: "active" | "good" | "risk" | "dead"
  candidateId?: string
}

const fallbackLocalState = createInitialLocalState(ugcStudioWorkspace.updatedAt)
const UgcLocalStateContext = React.createContext<UgcLocalState>(fallbackLocalState)
const daemonBaseUrl = "http://127.0.0.1:47522"

const views: Array<{ value: ReactView; label: string; shortLabel: string; icon: React.ComponentType<{ className?: string; size?: number }> }> = [
  { value: "atlas", label: "Persona Atlas", shortLabel: "Atlas", icon: Sparkles },
  { value: "explore", label: "Exploration Board", shortLabel: "Explore", icon: Wand2 },
  { value: "review", label: "Batch Review", shortLabel: "Review", icon: Play },
  { value: "campaign", label: "Campaign Branch Map", shortLabel: "Campaign", icon: GitBranch },
  { value: "reference", label: "Reference Archive", shortLabel: "Refs", icon: Copy },
  { value: "editor", label: "Final Layer Editor", shortLabel: "Editor", icon: Layers3 },
  { value: "graph", label: "Developer Graph", shortLabel: "Graph", icon: Network },
  { value: "provider", label: "KIE Proxy", shortLabel: "KIE", icon: Braces },
]

export const reactUgcStudioViewMetadata: Array<Pick<(typeof views)[number], "value" | "label" | "shortLabel">> = views.map(({ value, label, shortLabel }) => ({ value, label, shortLabel }))


const viewTabs: Array<TabItem<ReactView>> = views.map((view) => ({ value: view.value, label: view.shortLabel }))

const productLaneFilters: Array<{ value: LaneFilter; label: string }> = [
  { value: "all", label: "All lanes" },
  { value: "brainrot", label: "Brainrot" },
  { value: "ugc-ads", label: "UGC ads" },
]

const inspirationManifests: InspirationManifest[] = [
  {
    provider: "higgsfield",
    label: "Higgsfield mechanics",
    manifestPath: "data/ugc-studio/reference-assets/higgsfield/manifest.json",
    lane: "brainrot",
    summary: "Reference-only motion, effects, and framing mechanics.",
  },
  {
    provider: "arcads",
    label: "Arcads UGC ads",
    manifestPath: "data/ugc-studio/reference-assets/arcads/manifest.json",
    lane: "ugc-ads",
    summary: "Reference-only ad structure, avatar pacing, and CTA patterns.",
  },
]

const fallbackCapabilities: KieCapability[] = [
  {
    operation: "image-text",
    model: "seedream/5-lite-text-to-image",
    label: "Seedream 5 Lite text-to-image",
    family: "image",
    estimatedCostUsd: 0.02,
    frugal: true,
    notes: "Default dry-run route for persona/reference stills.",
  },
  {
    operation: "video-text",
    model: "bytedance/v1-lite-text-to-video",
    label: "ByteDance V1 Lite text-to-video",
    family: "video",
    estimatedCostUsd: 0.18,
    frugal: true,
    notes: "Short, cheap motion drafts.",
  },
  {
    operation: "image-to-video",
    model: "bytedance/v1-lite-image-to-video",
    label: "ByteDance V1 Lite image-to-video",
    family: "video",
    estimatedCostUsd: 0.2,
    frugal: true,
    notes: "Animate a selected reference still.",
  },
]

const personaCards: PersonaCardModel[] = [
  {
    id: "persona_lena_park",
    name: "Lena Park",
    archetype: "Skincare Minimalist",
    niche: "Barrier repair, sensitive skin",
    voice: "Calm, clear",
    accent: "American / West Coast",
    status: "Approved",
    clips: 7,
    branches: 4,
    followers: "24k",
    conversions: "3",
    color: "rose",
  },
  {
    id: "persona_maya_thompson",
    name: "Maya Thompson",
    archetype: "Science Nerd",
    niche: "Ingredients, myth-busting",
    voice: "Warm, explanatory",
    accent: "American / Midwest",
    status: "In Review",
    clips: 4,
    branches: 3,
    followers: "18k",
    conversions: "2",
    color: "blue",
  },
  {
    id: "persona_sofia_rivera",
    name: "Sofia Rivera",
    archetype: "Lifestyle",
    niche: "Glow habit stacking",
    voice: "Upbeat, friendly",
    accent: "American / East Coast",
    status: "Approved",
    clips: 3,
    branches: 3,
    followers: "31k",
    conversions: "4",
    color: "green",
  },
  {
    id: "persona_jade_lin",
    name: "Jade Lin",
    archetype: "Relatable",
    niche: "Hormone-friendly routines",
    voice: "Direct, casual",
    accent: "American / West Coast",
    status: "Rejected",
    clips: 2,
    branches: 1,
    followers: "9k",
    conversions: "0",
    color: "slate",
  },
  {
    id: "persona_chloe_bennett",
    name: "Chloe Bennett",
    archetype: "Athletic",
    niche: "Post-workout reset",
    voice: "Soft, aspirational",
    accent: "British / relaxed",
    status: "In Review",
    clips: 5,
    branches: 2,
    followers: "21k",
    conversions: "2",
    color: "amber",
  },
  {
    id: "persona_hana_kim",
    name: "Hana Kim",
    archetype: "Trend Spotter",
    niche: "K-beauty timing",
    voice: "Bright, excited",
    accent: "Korean-accented English",
    status: "Approved",
    clips: 6,
    branches: 3,
    followers: "42k",
    conversions: "5",
    color: "violet",
  },
  {
    id: "persona_ava_rodriguez",
    name: "Ava Rodriguez",
    archetype: "Practical",
    niche: "Simple skin systems",
    voice: "Gentle, empathetic",
    accent: "American / South",
    status: "Draft",
    clips: 1,
    branches: 2,
    followers: "13k",
    conversions: "1",
    color: "cyan",
  },
  {
    id: "persona_tara_singh",
    name: "Tara Singh",
    archetype: "Performance",
    niche: "Gym bag rituals",
    voice: "Energetic, motivating",
    accent: "Australian",
    status: "In Review",
    clips: 4,
    branches: 2,
    followers: "27k",
    conversions: "2",
    color: "pink",
  },
]

const explorationRows: ExplorationRow[] = [
  {
    id: "row_product",
    step: "1",
    title: "Product / offer",
    description: "Skincare constraints",
    items: [
      { id: "offer_daily_spf", title: "Daily SPF", subtitle: "light gel, no cast", score: 8.4, status: "keep" },
      { id: "offer_hydration", title: "Hydration Boost", subtitle: "gel cream test", score: 7.9, status: "review" },
      { id: "offer_acne_rescue", title: "Acne Rescue", subtitle: "calm flare-ups", score: 7.4, status: "new" },
      { id: "offer_barrier", title: "Barrier Repair", subtitle: "redness relief", score: 8.2, status: "keep" },
      { id: "offer_bundle", title: "Bundle Offer", subtitle: "AM / PM pair", score: 7.3, status: "review" },
    ],
  },
  {
    id: "row_persona",
    step: "2",
    title: "Persona",
    description: "Pick the creator",
    items: [
      { id: "persona_lena", title: "Lena Park", subtitle: "minimalist educator", score: 8.7, status: "keep", personaId: "persona_lena_park" },
      { id: "persona_hana", title: "Hana Kim", subtitle: "K-beauty timing", score: 8.8, status: "keep", personaId: "persona_hana_kim" },
      { id: "persona_maya", title: "Maya T.", subtitle: "science nerd", score: 7.6, status: "review", personaId: "persona_maya_thompson" },
      { id: "persona_tara", title: "Tara Singh", subtitle: "athletic reset", score: 7.5, status: "new", personaId: "persona_tara_singh" },
      { id: "persona_chloe", title: "Chloe B.", subtitle: "soft authority", score: 7.4, status: "review", personaId: "persona_chloe_bennett" },
    ],
  },
  {
    id: "row_format",
    step: "3",
    title: "Format",
    description: "Reusable structure",
    items: [
      { id: "format_grwm", title: "Get Ready With Me", subtitle: "soft proof", score: 8.5, status: "keep" },
      { id: "format_diy", title: "Day in My Life", subtitle: "routine proof", score: 8.1, status: "keep" },
      { id: "format_quick_tip", title: "Quick Tip", subtitle: "15 sec format", score: 8.7, status: "keep" },
      { id: "format_pov", title: "POV / relatable", subtitle: "hook first", score: 7.9, status: "review" },
      { id: "format_test", title: "Test On Skin", subtitle: "split face", score: 7.5, status: "review" },
    ],
  },
  {
    id: "row_hook",
    step: "4",
    title: "Hook",
    description: "Why stop scrolling?",
    items: [
      { id: "hook_didnt_expect", title: "Didn’t expect this", subtitle: "curiosity", score: 8.8, status: "keep", candidateId: "candidate_soft_demo_01" },
      { id: "hook_weird", title: "My dry skin hack", subtitle: "specific", score: 8.4, status: "keep" },
      { id: "hook_pov", title: "POV: sensitive", subtitle: "relatable", score: 7.9, status: "review" },
      { id: "hook_test", title: "Test this once", subtitle: "challenge", score: 7.4, status: "review" },
      { id: "hook_before", title: "Before / after", subtitle: "proof-led", score: 8.1, status: "keep" },
    ],
  },
  {
    id: "row_script",
    step: "5",
    title: "Script",
    description: "Soft proof arc",
    items: [
      { id: "script_problem", title: "Problem → update", subtitle: "short pain", score: 8.1, status: "keep" },
      { id: "script_story", title: "Storytime", subtitle: "mild reveal", score: 7.1, status: "review" },
      { id: "script_tip", title: "Tip + proof", subtitle: "educator", score: 8.2, status: "keep" },
      { id: "script_list", title: "List / steps", subtitle: "3 reasons", score: 7.8, status: "new" },
      { id: "script_comment", title: "Comment Q&A", subtitle: "response", score: 7.6, status: "review" },
    ],
  },
  {
    id: "row_cta",
    step: "6",
    title: "CTA",
    description: "Conversion pressure",
    items: [
      { id: "cta_shop", title: "Shop now", subtitle: "direct", score: 6.8, status: "risk", candidateId: "candidate_cta_risk_free_01" },
      { id: "cta_limited", title: "Limited code", subtitle: "low pressure", score: 7.3, status: "review" },
      { id: "cta_use", title: "Use code", subtitle: "caption CTA", score: 8.0, status: "keep" },
      { id: "cta_link", title: "Link in bio", subtitle: "soft CTA", score: 8.1, status: "keep" },
      { id: "cta_comment", title: "Comment ‘GLOW’", subtitle: "engagement", score: 7.6, status: "review" },
    ],
  },
]

const campaignColumns: CampaignColumn[] = [
  {
    id: "concept",
    title: "01 Concept",
    subtitle: "1 snapshot",
    nodes: [
      { id: "node_root", title: "Root Concept", meta: "Hydrating skin", score: "May 9", status: "active" },
    ],
  },
  {
    id: "personas",
    title: "02 Personas",
    subtitle: "3 families",
    nodes: [
      { id: "node_clean_girl", title: "Clean Girl", meta: "Minimalist", score: "+17%", status: "good" },
      { id: "node_energy", title: "Energetic Bestie", meta: "Fun, bubbly", score: "-5%", status: "risk" },
      { id: "node_science", title: "Skincare Nerd", meta: "Informative", score: "new", status: "active" },
    ],
  },
  {
    id: "formats",
    title: "03 Formats",
    subtitle: "6 explorations",
    nodes: [
      { id: "node_talking", title: "Talking Head", meta: "direct", score: "+4%", status: "good" },
      { id: "node_routine", title: "Routine", meta: "GRWM", score: "+6%", status: "good" },
      { id: "node_demo", title: "Product Demo", meta: "macro proof", score: "+9%", status: "good", candidateId: "candidate_soft_demo_01" },
      { id: "node_story", title: "Storytime", meta: "paused", score: "-7%", status: "risk" },
    ],
  },
  {
    id: "hooks",
    title: "04 Hooks",
    subtitle: "12 batches",
    nodes: [
      { id: "node_curiosity", title: "Curiosity Hook", meta: "5 variants", score: "+18%", status: "good" },
      { id: "node_benefit", title: "Benefit Hook", meta: "5 variants", score: "+21%", status: "active" },
      { id: "node_relatable", title: "Relatable Hook", meta: "4 variants", score: "+8%", status: "good" },
      { id: "node_trend", title: "Trend Hook", meta: "3 variants", score: "-22%", status: "dead" },
    ],
  },
  {
    id: "campaign",
    title: "05 Campaign Mix",
    subtitle: "CTA / non-CTA",
    nodes: [
      { id: "node_theory", title: "CTA Theory", meta: "70% CTA", score: "+20%", status: "good" },
      { id: "node_blend", title: "Balanced Mix", meta: "50% CTA", score: "+31%", status: "active" },
      { id: "node_community", title: "Community First", meta: "20% CTA", score: "+12%", status: "good" },
    ],
  },
  {
    id: "checkpoints",
    title: "06 Checkpoints",
    subtitle: "Metrics & decisions",
    nodes: [
      { id: "node_checkpoint_a", title: "Checkpoint A", meta: "May 23", score: "CTR 2.8", status: "good" },
      { id: "node_checkpoint_b", title: "Checkpoint B", meta: "May 28", score: "CTR 3.7", status: "active" },
      { id: "node_checkpoint_c", title: "Checkpoint C", meta: "May 30", score: "CVR 5.7", status: "good" },
    ],
  },
]

function useUgcLocalState(): UgcLocalState {
  return React.useContext(UgcLocalStateContext)
}

function projectPersonaCard(persona: PersonaProfile, index: number): PersonaCardModel {
  return {
    id: persona.id,
    name: persona.displayName,
    archetype: persona.genreLane,
    niche: persona.profileBible.niche,
    voice: persona.voice.speakingStyle,
    accent: persona.voice.accent,
    status: personaStatusLabel(persona.status),
    clips: persona.sampleClipIds.length,
    branches: persona.branchSnapshotIds.length,
    followers: `${24 + index * 7}k`,
    conversions: String(Math.max(1, persona.postingStrategy.weeklyCadence.filter((item) => item.purpose === "conversion").length)),
    color: ["rose", "violet", "blue", "green", "amber", "cyan"][index % 6] ?? "slate",
  }
}

function projectExplorationRows(workspace: UgcStudioWorkspace): ExplorationRow[] {
  const laneCounts = workspace.referenceProfiles.reduce(
    (counts, profile) => {
      if (profile.styleLane === "brainrot") counts.brainrot += 1
      if (profile.styleLane === "ugc-ads") counts.ugcAds += 1
      return counts
    },
    { brainrot: 0, ugcAds: 0 },
  )
  const averageHookStrength = workspace.candidates.length
    ? workspace.candidates.reduce((sum, candidate) => sum + candidate.scorecard.hookStrength, 0) / workspace.candidates.length
    : 0

  return [
    {
      id: "row_product",
      step: "1",
      title: "Workspace focus",
      description: workspace.title,
      items: [
        {
          id: "workspace_candidates",
          title: workspace.title,
          subtitle: `${workspace.candidates.length} candidates / ${workspace.referenceProfiles.length} references`,
          score: Math.max(0, Math.min(9.5, averageHookStrength / 10)),
          status: "keep",
        },
        {
          id: "workspace_lane_ugc_ads",
          title: "UGC ads lane",
          subtitle: `${laneCounts.ugcAds} tagged references`,
          score: laneCounts.ugcAds > 0 ? 8 : 6,
          status: laneCounts.ugcAds > 0 ? "keep" : "review",
        },
        {
          id: "workspace_lane_brainrot",
          title: "Brainrot lane",
          subtitle: `${laneCounts.brainrot} tagged references`,
          score: laneCounts.brainrot > 0 ? 8 : 6,
          status: laneCounts.brainrot > 0 ? "keep" : "review",
        },
      ],
    },
    {
      id: "row_persona",
      step: "2",
      title: "Persona",
      description: "Pick the creator",
      items: workspace.personas.map((persona, index) => ({
        id: `explore_${persona.id}`,
        title: persona.displayName,
        subtitle: persona.profileBible.niche,
        score: Math.min(9.2, 7.6 + index * 0.4),
        status: persona.status === "selected" ? "keep" : persona.status === "paused" ? "risk" : "review",
        personaId: persona.id,
      })),
    },
    {
      id: "row_hook",
      step: "3",
      title: "Hook",
      description: "Why stop scrolling?",
      items: workspace.candidates.slice(0, 5).map((candidate) => ({
        id: `explore_${candidate.id}`,
        title: candidate.title,
        subtitle: candidate.kind,
        score: candidate.scorecard.hookStrength / 10,
        status: candidate.status === "rejected" ? "risk" : candidate.status === "starred" ? "keep" : "review",
        candidateId: candidate.id,
      })),
    },
  ]
}

function projectCampaignColumns(workspace: UgcStudioWorkspace): CampaignColumn[] {
  const branchNodes = workspace.branchSnapshots.map((branch) => ({
    id: branch.id,
    title: branch.title,
    meta: branch.focus,
    score: branch.metrics[0]?.value ?? branch.status,
    status: branch.status === "dead-end" ? "dead" : branch.status === "active" ? "active" : branch.status === "promising" ? "good" : "risk",
    candidateId: branch.selectedCandidateIds[0],
  } satisfies CampaignNode))
  return [
    campaignColumns[0] ?? { id: "concept", title: "01 Concept", subtitle: "Root", nodes: [] },
    {
      id: "branches",
      title: "02 Branches",
      subtitle: `${branchNodes.length} snapshots`,
      nodes: branchNodes,
    },
    ...campaignColumns.slice(2),
  ]
}

function personaStatusLabel(status: PersonaProfile["status"]): PersonaCardModel["status"] {
  if (status === "selected") return "Approved"
  if (status === "promising") return "In Review"
  if (status === "paused") return "Rejected"
  return "Draft"
}

function parseJson(text: string): JsonValue {
  try {
    return JSON.parse(text) as JsonValue
  } catch {
    return { raw: text }
  }
}

function parseJsonOrNull(text: string): JsonValue | null {
  try {
    return JSON.parse(text) as JsonValue
  } catch {
    return null
  }
}

function isWorkspaceBundle(value: unknown): value is UgcWorkspaceBundle {
  const root = jsonRecord(value)
  return root?.schemaVersion === "ugc-studio.workspace-bundle.v1"
    && typeof root.id === "string"
    && jsonRecord(root.state)?.schemaVersion === "ugc-studio.local-state.v1"
}

function isWorkspaceBundleImportResult(value: unknown): value is UgcWorkspaceBundleImportResult {
  const root = jsonRecord(value)
  return root?.schemaVersion === "ugc-studio.workspace-bundle-import-result.v1"
    && typeof root.dryRun === "boolean"
    && typeof root.valid === "boolean"
    && typeof root.imported === "boolean"
}

function compactBundleExportResult(bundle: UgcWorkspaceBundle): JsonValue {
  return {
    action: "export",
    bundleId: bundle.id,
    label: bundle.label,
    exportedAt: bundle.exportedAt,
    objectCounts: bundleObjectCountsJson(bundle.objectCounts),
    shardManifest: {
      workspace: bundle.shardManifest.workspace,
      collections: {
        personas: bundle.shardManifest.collections.personas,
        campaigns: bundle.shardManifest.collections.campaigns,
        branches: bundle.shardManifest.collections.branches,
        candidates: bundle.shardManifest.collections.candidates,
        notes: bundle.shardManifest.collections.notes,
        providerJobs: bundle.shardManifest.collections.providerJobs,
        referenceArchives: bundle.shardManifest.collections.referenceArchives,
        exports: bundle.shardManifest.collections.exports,
        researchTargets: bundle.shardManifest.collections.researchTargets,
        templateMiningJobs: bundle.shardManifest.collections.templateMiningJobs,
        bundles: bundle.shardManifest.collections.bundles,
      },
      assets: {
        source: bundle.shardManifest.assets.source,
        generated: bundle.shardManifest.assets.generated,
        exports: bundle.shardManifest.assets.exports,
      },
    },
  }
}

function compactBundleImportResult(result: UgcWorkspaceBundleImportResult): JsonValue {
  return {
    action: result.dryRun ? "import dry-run" : "import apply",
    valid: result.valid,
    imported: result.imported,
    bundleId: result.bundleId,
    workspaceId: result.workspaceId,
    errors: result.errors,
    warnings: result.warnings,
    objectCounts: result.objectCounts ? bundleObjectCountsJson(result.objectCounts) : null,
    checkedAt: result.checkedAt,
  }
}

function bundleObjectCountsJson(counts: UgcWorkspaceBundle["objectCounts"]): JsonValue {
  return {
    personas: counts.personas,
    branches: counts.branches,
    candidates: counts.candidates,
    notes: counts.notes,
    providerJobs: counts.providerJobs,
    referenceArchives: counts.referenceArchives,
    exportManifests: counts.exportManifests,
    researchTargets: counts.researchTargets,
    templateMiningJobs: counts.templateMiningJobs,
  }
}

function normalizeProductLane(text: string): ProductLane {
  const lower = text.toLowerCase()
  return lower.includes("brainrot") || lower.includes("pleometric") ? "brainrot" : "ugc-ads"
}

function productLaneLabel(lane: ProductLane): string {
  return lane === "brainrot" ? "Brainrot" : "UGC ads"
}

function productLaneForReference(reference: ReferenceProfile): ProductLane {
  return normalizeProductLane(`${reference.styleLane} ${reference.useCase} ${reference.cleanRoomBoundary.join(" ")}`)
}

function productLaneForResearchTarget(target: { readonly niche: string; readonly query: string; readonly notes: readonly string[] }): ProductLane {
  return normalizeProductLane(`${target.niche} ${target.query} ${target.notes.join(" ")}`)
}

function productLaneForCandidate(candidate: CreativeCandidate | undefined): ProductLane {
  if (!candidate) return "ugc-ads"
  return normalizeProductLane(`${candidate.kind} ${candidate.stageId} ${candidate.tags.join(" ")} ${candidate.recipe.sourceStageIds.join(" ")} ${candidate.preview.visibleInputs.map((input) => `${input.label} ${input.value}`).join(" ")}`)
}

function productLaneForProviderJob(job: UgcProviderJob, workspace: UgcStudioWorkspace): ProductLane {
  const targetCandidate = workspace.candidates.find((candidate) => job.targetIds.includes(candidate.id))
  if (targetCandidate) return productLaneForCandidate(targetCandidate)
  const targetReference = workspace.referenceProfiles.find((reference) => job.targetIds.includes(reference.id))
  if (targetReference) return productLaneForReference(targetReference)
  return normalizeProductLane(`${job.operation} ${job.provider} ${JSON.stringify(job.request)}`)
}

function mergeCaptionPayload(payload: JsonValue | null, text: string, editableFields: readonly string[]): JsonValue {
  const root = jsonRecord(payload)
  return {
    ...(root ?? {}),
    text,
    source: "final-editor",
    editableFields,
  }
}

function splitLines(text: string): readonly string[] {
  return text.split(/\r?\n/g).map((line) => line.trim()).filter(Boolean)
}

function sourcePolicyFor(reference: ReferenceProfile): ReferenceSourcePolicy {
  return reference.rightsStatus === "rights-cleared" || reference.rightsStatus === "user-owned"
    ? "rights-cleared-source"
    : "abstract-mechanics"
}

function displayProviderJobStatus(status: UgcProviderJobStatus): string {
  return status === "completed" ? "succeeded" : status
}

function providerJobStatusTone(status: UgcProviderJobStatus) {
  if (status === "succeeded" || status === "completed") return "success"
  if (status === "failed" || status === "blocked") return "danger"
  if (status === "running" || status === "queued") return "active"
  return "neutral"
}

function extractKieTaskId(value: JsonValue | null): string | null {
  const root = jsonRecord(value)
  if (!root) return null
  if (typeof root.taskId === "string") return root.taskId
  const response = jsonRecord(root.response)
  const data = jsonRecord(response?.data ?? null)
  return typeof data?.taskId === "string" ? data.taskId : null
}

function jsonRecord(value: unknown): { readonly [key: string]: JsonValue } | null {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return null
  return value as { readonly [key: string]: JsonValue }
}

function jsonStringArray(value: JsonValue | undefined | null): readonly string[] {
  if (!Array.isArray(value)) return []
  return value.filter((item): item is string => typeof item === "string")
}

function jsonArtifactRefs(value: JsonValue | undefined | null): readonly string[] {
  if (value === undefined || value === null) return []
  if (typeof value === "string") return [value]
  if (Array.isArray(value)) return value.flatMap(jsonArtifactRefs)
  const root = jsonRecord(value)
  if (!root) return []
  const direct = jsonText(root.path) ?? jsonText(root.artifactPath) ?? jsonText(root.url) ?? jsonText(root.id)
  return direct ? [direct] : []
}

function jsonArray(value: JsonValue | undefined | null): readonly JsonValue[] {
  return Array.isArray(value) ? value : []
}

function jsonText(value: JsonValue | undefined | null): string | null {
  if (typeof value === "string") return value
  if (typeof value === "number" || typeof value === "boolean") return String(value)
  return null
}

function previewJsonValue(value: JsonValue | undefined | null): string | undefined {
  if (value === undefined || value === null) return undefined
  const text = typeof value === "string" ? value : JSON.stringify(value)
  return text.length > 240 ? `${text.slice(0, 237)}…` : text
}

function workflowPayloadRuns(payload: JsonValue): readonly JsonValue[] {
  if (Array.isArray(payload)) return payload
  const root = jsonRecord(payload)
  if (!root) return []
  const directRun = root.run ?? root.workflowRun ?? root.createdRun ?? root.createdWorkflowRun
  if (jsonRecord(directRun)) return [directRun]
  if (typeof root.id === "string" || typeof root.runId === "string") return [payload]
  return jsonArray(root.createdWorkflowRuns).length ? jsonArray(root.createdWorkflowRuns)
    : jsonArray(root.createdRuns).length ? jsonArray(root.createdRuns)
      : jsonArray(root.workflowRuns).length ? jsonArray(root.workflowRuns)
        : jsonArray(root.workflows).length ? jsonArray(root.workflows)
          : jsonArray(root.runs).length ? jsonArray(root.runs)
            : jsonArray(root.data)
}

function workflowPayloadEvents(payload: JsonValue): readonly JsonValue[] {
  if (Array.isArray(payload)) return payload
  const root = jsonRecord(payload)
  if (!root) return []
  const directEvent = root.event ?? root.workflowEvent ?? root.createdEvent ?? root.createdWorkflowEvent
  if (jsonRecord(directEvent)) return [directEvent]
  if (typeof root.runId === "string" && typeof root.type === "string") return [payload]
  return jsonArray(root.createdWorkflowEvents).length ? jsonArray(root.createdWorkflowEvents)
    : jsonArray(root.createdEvents).length ? jsonArray(root.createdEvents)
      : jsonArray(root.workflowEvents).length ? jsonArray(root.workflowEvents)
        : jsonArray(root.events).length ? jsonArray(root.events)
          : jsonArray(root.data)
}

function normalizeWorkflowEvents(payload: JsonValue): readonly WorkflowEventTelemetry[] {
  return workflowPayloadEvents(payload)
    .map(normalizeWorkflowEvent)
    .filter((event): event is WorkflowEventTelemetry => event !== null)
}

function normalizeWorkflowRuns(payload: JsonValue): readonly WorkflowRunTelemetry[] {
  return workflowPayloadRuns(payload)
    .map(normalizeWorkflowRun)
    .filter((run): run is WorkflowRunTelemetry => run !== null)
}

function normalizeWorkflowRun(value: JsonValue): WorkflowRunTelemetry | null {
  const root = jsonRecord(value)
  if (!root) return null
  const id = jsonText(root.id) ?? jsonText(root.runId) ?? jsonText(root.workflowRunId)
  if (!id) return null
  const events = [
    ...normalizeWorkflowEvents(root.workflowEvents ?? []),
    ...normalizeWorkflowEvents(root.events ?? []),
    ...normalizeWorkflowEvents(root.recentEvents ?? []),
  ].filter((event) => event.runId === id)
  const eventStatus = workflowStatusFromEvents(events)
  const eventPhase = workflowPhaseFromEvents(events)
  const status = eventStatus !== "queued" ? eventStatus : jsonText(root.status) ?? jsonText(root.state) ?? "queued"
  const source = jsonText(root.scriptId) ?? jsonText(root.definitionId) ?? jsonText(root.workflowId) ?? jsonText(root.source) ?? "workflow"
  const title = jsonText(root.title) ?? jsonText(root.name) ?? source
  const artifactPaths = workflowArtifactPaths(root, events)
  const resultPreview = workflowResultPreview(root, events)
  const errorPreview = workflowErrorPreview(root, events)
  return {
    id,
    lane: workflowLane(root, events, `${source} ${title}`),
    status,
    title,
    source,
    currentPhase: eventPhase ?? jsonText(root.currentPhase) ?? jsonText(root.phase) ?? jsonText(root.currentStep) ?? "queued",
    counters: workflowCounters(root, events, artifactPaths),
    events: sortWorkflowEvents(events),
    artifactPaths,
    resultPreview,
    errorPreview,
    createdAt: jsonText(root.createdAt) ?? undefined,
    updatedAt: jsonText(root.updatedAt) ?? jsonText(root.finishedAt) ?? undefined,
    rawJson: value,
  }
}

function normalizeWorkflowEvent(value: JsonValue): WorkflowEventTelemetry | null {
  const root = jsonRecord(value)
  if (!root) return null
  const runId = jsonText(root.runId) ?? jsonText(root.workflowRunId)
  const type = jsonText(root.type) ?? jsonText(root.eventType)
  if (!runId || !type) return null
  const phase = jsonText(root.phase) ?? jsonText(root.currentPhase) ?? jsonText(root.step) ?? undefined
  const agent = jsonText(root.agent) ?? jsonText(root.agentId) ?? jsonText(root.persona) ?? jsonText(root.role) ?? jsonText(root.source) ?? undefined
  const artifactPath = jsonArtifactRefs(root.artifactPath ?? root.path ?? root.artifact ?? root.url)[0]
  const message = jsonText(root.message)
    ?? jsonText(root.log)
    ?? jsonText(root.text)
    ?? jsonText(root.summary)
    ?? artifactPath
    ?? phase
    ?? type
  return {
    id: jsonText(root.id) ?? jsonText(root.eventId) ?? undefined,
    runId,
    type,
    lane: workflowLane(root, [], `${phase ?? ""} ${agent ?? ""} ${message}`),
    phase,
    agent,
    message,
    artifactPath,
    resultPreview: previewJsonValue(root.result ?? root.output ?? root.records),
    errorPreview: previewJsonValue(root.error),
    createdAt: jsonText(root.createdAt) ?? jsonText(root.timestamp) ?? jsonText(root.time) ?? undefined,
    sequence: typeof root.sequence === "number" ? root.sequence : typeof root.seq === "number" ? root.seq : undefined,
    rawJson: value,
  }
}

function workflowLane(root: { readonly [key: string]: JsonValue }, events: readonly WorkflowEventTelemetry[], fallbackText: string): ProductLane {
  const explicitLane = jsonText(root.lane) ?? jsonText(root.productLane)
  if (explicitLane === "brainrot" || explicitLane === "ugc-ads") return explicitLane
  const eventLane = events.find((event) => event.lane === "brainrot")?.lane
  return eventLane ?? normalizeProductLane(fallbackText)
}

function workflowArtifactPaths(root: { readonly [key: string]: JsonValue }, events: readonly WorkflowEventTelemetry[]): readonly string[] {
  const direct = [
    ...jsonArtifactRefs(root.artifactPaths),
    ...jsonArtifactRefs(root.artifacts),
    ...jsonArtifactRefs(root.importedRecords),
    ...jsonArtifactRefs(root.imports),
  ]
  const fromEvents = events.map((event) => event.artifactPath).filter((path): path is string => Boolean(path))
  return uniqueStrings([...direct, ...fromEvents]).slice(0, 12)
}

function workflowResultPreview(root: { readonly [key: string]: JsonValue }, events: readonly WorkflowEventTelemetry[]): string | undefined {
  return events.find((event) => event.resultPreview)?.resultPreview
    ?? previewJsonValue(root.result ?? root.output ?? root.resultJson)
}

function workflowErrorPreview(root: { readonly [key: string]: JsonValue }, events: readonly WorkflowEventTelemetry[]): string | undefined {
  return events.find((event) => event.errorPreview)?.errorPreview
    ?? previewJsonValue(root.error)
}

function workflowCounters(root: { readonly [key: string]: JsonValue }, events: readonly WorkflowEventTelemetry[], artifactPaths: readonly string[]): readonly WorkflowCounter[] {
  const explicit = jsonRecord(root.counters) ?? jsonRecord(root.counts) ?? jsonRecord(root.metrics)
  if (explicit) {
    const counters = Object.entries(explicit)
      .map(([label, value]) => ({ label: workflowCounterLabel(label), value: jsonText(value) ?? previewJsonValue(value) ?? "n/a" }))
      .slice(0, 6)
    if (counters.length) return counters
  }
  const eventTypes = events.map((event) => event.type)
  return [
    { label: "events", value: String(events.length) },
    { label: "agents", value: String(new Set(events.map((event) => event.agent).filter(Boolean)).size) },
    { label: "artifacts", value: String(artifactPaths.length) },
    { label: "errors", value: String(eventTypes.filter((type) => type === "error").length) },
    { label: "imports", value: String(eventTypes.filter((type) => type === "import").length) },
    { label: "results", value: String(eventTypes.filter((type) => type === "result").length) },
  ]
}

function workflowCounterLabel(label: string): string {
  return label.replace(/([a-z0-9])([A-Z])/g, "$1 $2").replace(/[-_]/g, " ").toLowerCase()
}

function workflowStatusFromEvents(events: readonly WorkflowEventTelemetry[]): string {
  const latest = sortWorkflowEvents(events)[0]
  if (!latest) return "queued"
  if (latest.type === "error") return "failed"
  if (latest.type === "result" || latest.type === "import") return "succeeded"
  if (latest.type === "agent-end") return activeWorkflowAgents(events).length ? "running" : "waiting"
  if (latest.type === "phase" || latest.type === "log" || latest.type.startsWith("agent-") || latest.type === "artifact") return "running"
  return latest.type
}

function workflowPhaseFromEvents(events: readonly WorkflowEventTelemetry[]): string | null {
  return sortWorkflowEvents(events).find((event) => event.phase)?.phase ?? null
}

function activeWorkflowAgents(events: readonly WorkflowEventTelemetry[]): readonly WorkflowEventTelemetry[] {
  const latestByAgent = new Map<string, WorkflowEventTelemetry>()
  for (const event of sortWorkflowEvents(events).slice().reverse()) {
    if (event.agent) latestByAgent.set(event.agent, event)
  }
  return Array.from(latestByAgent.values()).filter((event) => event.type === "agent-start" || event.type === "agent-progress" || event.type === "log" || event.type === "phase")
}

function sortWorkflowEvents(events: readonly WorkflowEventTelemetry[]): readonly WorkflowEventTelemetry[] {
  return [...events].sort((left, right) => workflowEventOrder(right) - workflowEventOrder(left))
}

function workflowEventOrder(event: WorkflowEventTelemetry): number {
  if (typeof event.sequence === "number") return event.sequence
  if (event.createdAt) {
    const time = Date.parse(event.createdAt)
    if (Number.isFinite(time)) return time
  }
  return 0
}

function workflowEventKey(event: WorkflowEventTelemetry): string {
  return event.id ?? `${event.runId}:${event.sequence ?? event.createdAt ?? ""}:${event.type}:${event.message}`
}

function mergeWorkflowRuns(existingRuns: readonly WorkflowRunTelemetry[], incomingRuns: readonly WorkflowRunTelemetry[]): readonly WorkflowRunTelemetry[] {
  const byId = new Map(existingRuns.map((run) => [run.id, run]))
  for (const incoming of incomingRuns) {
    const existing = byId.get(incoming.id)
    byId.set(incoming.id, existing ? mergeWorkflowRunEvents(incoming, existing.events) : incoming)
  }
  return Array.from(byId.values()).sort((left, right) => workflowRunOrder(right) - workflowRunOrder(left))
}

function mergeWorkflowEvent(runs: readonly WorkflowRunTelemetry[], event: WorkflowEventTelemetry): readonly WorkflowRunTelemetry[] {
  const existing = runs.find((run) => run.id === event.runId)
  const run = existing ?? workflowRunFromEvent(event)
  const merged = mergeWorkflowRunEvents(run, [event])
  return mergeWorkflowRuns(runs.filter((item) => item.id !== event.runId), [merged])
}

function mergeWorkflowRunEvents(run: WorkflowRunTelemetry, events: readonly WorkflowEventTelemetry[]): WorkflowRunTelemetry {
  const byKey = new Map<string, WorkflowEventTelemetry>()
  for (const event of [...run.events, ...events]) byKey.set(workflowEventKey(event), event)
  const mergedEvents = sortWorkflowEvents(Array.from(byKey.values())).slice(0, 32)
  const root = jsonRecord(run.rawJson) ?? {}
  const artifactPaths = workflowArtifactPaths(root, mergedEvents)
  const derivedStatus = workflowStatusFromEvents(mergedEvents)
  return {
    ...run,
    status: derivedStatus === "queued" ? run.status : derivedStatus,
    currentPhase: workflowPhaseFromEvents(mergedEvents) ?? run.currentPhase,
    counters: workflowCounters(root, mergedEvents, artifactPaths),
    events: mergedEvents,
    artifactPaths,
    resultPreview: workflowResultPreview(root, mergedEvents) ?? run.resultPreview,
    errorPreview: workflowErrorPreview(root, mergedEvents) ?? run.errorPreview,
    updatedAt: mergedEvents[0]?.createdAt ?? run.updatedAt,
  }
}

function workflowRunFromEvent(event: WorkflowEventTelemetry): WorkflowRunTelemetry {
  const rawJson: JsonValue = { id: event.runId, lane: event.lane, status: workflowStatusFromEvents([event]), currentPhase: event.phase ?? "event stream" }
  const root = jsonRecord(rawJson) ?? {}
  return {
    id: event.runId,
    lane: event.lane,
    status: workflowStatusFromEvents([event]),
    title: event.agent ? `${event.agent} workflow` : "Workflow run",
    source: "event stream",
    currentPhase: event.phase ?? "event stream",
    counters: workflowCounters(root, [event], event.artifactPath ? [event.artifactPath] : []),
    events: [event],
    artifactPaths: event.artifactPath ? [event.artifactPath] : [],
    resultPreview: event.resultPreview,
    errorPreview: event.errorPreview,
    createdAt: event.createdAt,
    updatedAt: event.createdAt,
    rawJson,
  }
}

function workflowRunOrder(run: WorkflowRunTelemetry): number {
  const latestEvent = run.events[0]
  if (latestEvent) return workflowEventOrder(latestEvent)
  const updated = run.updatedAt ?? run.createdAt
  if (!updated) return 0
  const time = Date.parse(updated)
  return Number.isFinite(time) ? time : 0
}

function workflowLatestCursor(run: WorkflowRunTelemetry): string | null {
  const latest = run.events[0]
  if (!latest) return null
  if (typeof latest.sequence === "number") return String(latest.sequence)
  return latest.id ?? latest.createdAt ?? null
}

function uniqueStrings(values: readonly string[]): readonly string[] {
  return Array.from(new Set(values.filter(Boolean)))
}

function workflowRouteMissing(response: Response): boolean {
  return response.status === 404 || response.status === 405
}
function workflowDemoLaneLabel(lane: WorkflowDemoLane): string {
  if (lane === "all") return "both demos"
  return lane === "brainrot" ? "brainrot demo" : "UGC ads demo"
}

function compactWorkflowDemoResult(value: JsonValue, lane: WorkflowDemoLane, status: number): JsonValue {
  const root = jsonRecord(value)
  const runs = normalizeWorkflowRuns(value)
  const events = normalizeWorkflowEvents(value)
  const importResults = jsonArray(root?.importResults ?? root?.imports ?? null)
  return {
    route: "/api/ugc/workflows/demo",
    lane,
    status,
    runCount: runs.length,
    eventCount: events.length,
    importCount: importResults.length,
    runs: runs.slice(0, 4).map((run) => ({
      id: run.id,
      lane: run.lane,
      status: run.status,
      title: run.title,
    })),
    preview: previewJsonValue(value) ?? null,
  }
}

function workflowImportDryRunValid(value: JsonValue): boolean {
  return jsonRecord(value)?.valid === true
}

function compactWorkflowImportResult(value: JsonValue): JsonValue {
  const root = jsonRecord(value)
  if (!root) return value
  const compact: { [key: string]: JsonValue } = {}
  for (const [key, entry] of Object.entries(root)) {
    if (key === "state" || key === "importedState") {
      const state = isLocalState(entry) ? entry : null
      compact[key] = state ? {
        schemaVersion: state.schemaVersion,
        updatedAt: state.updatedAt,
        workspaceId: state.workspace.id,
        candidates: state.workspace.candidates.length,
        providerJobs: state.providerJobs.length,
        reviewNotes: state.workspace.reviewNotes.length,
      } : "[omitted from compact preview]"
    } else {
      compact[key] = entry
    }
  }
  return compact
}

function sampleWorkflowImportPayload(candidateId: string): JsonValue {
  const payload: { [key: string]: JsonValue } = {
    lane: "ugc-ads",
    sourcePolicy: "metadata-only",
    providerJobs: [
      {
        provider: "local",
        operation: "workflow-demo-plan",
        mode: "dry-run",
        status: "planned",
        targetIds: [],
        spendCapUsd: 0,
        estimatedCostUsd: 0,
        request: {
          summary: "UI demo dry-run",
          cleanRoom: true,
          sourcePolicy: "metadata-only",
        },
        response: {
          plannedOnly: true,
          liveProviderCalls: false,
        },
        artifactPaths: [],
      },
    ],
    artifactPaths: [],
    metadata: {
      source: "ReactUgcStudio workflow import sample",
      cleanRoom: "metadata-only local demo; no provider calls",
    },
  }
  if (candidateId) {
    payload.notes = [
      {
        author: "agent",
        attachedTo: { kind: "candidate", id: candidateId },
        verdict: "revise",
        body: "Workflow demo note imported from a clean-room handoff payload.",
        requestedChange: "Use the dry-run plan before applying this local note.",
      },
    ]
  }
  return payload
}

function workflowStatusTone(status: string): "success" | "danger" | "active" | "neutral" {
  if (["succeeded", "completed", "done", "imported"].includes(status)) return "success"
  if (["failed", "error", "blocked", "cancelled"].includes(status)) return "danger"
  if (["queued", "running", "active", "agent-start", "agent-progress", "phase", "log"].includes(status)) return "active"
  return "neutral"
}

function useWorkflowTelemetry(onRefreshWorkspaceState: () => Promise<void>): WorkflowTelemetryController {
  const [state, setState] = React.useState<WorkflowTelemetryState>({
    runs: [],
    streamStatus: "loading",
    routeAvailable: false,
    demoRouteUnavailable: false,
    message: "Loading workflow telemetry from the Slotok daemon…",
    demoRunningLane: null,
    demoResult: null,
  })
  const runsRef = React.useRef<readonly WorkflowRunTelemetry[]>([])

  const loadWorkflowSnapshot = React.useCallback(async (): Promise<readonly WorkflowRunTelemetry[]> => {
    try {
      const response = await fetch(`${daemonBaseUrl}/api/ugc/workflows`)
      const text = await response.text()
      if (workflowRouteMissing(response)) {
        setState((previous) => ({
          ...previous,
          runs: [],
          streamStatus: "unavailable",
          routeAvailable: false,
          message: "Daemon telemetry route is unavailable: GET /api/ugc/workflows returned 404/405.",
        }))
        return []
      }
      if (!response.ok) {
        setState((previous) => ({
          ...previous,
          streamStatus: previous.streamStatus === "live" ? "live" : "polling",
          routeAvailable: true,
          message: `Workflow telemetry route returned ${response.status}.`,
        }))
        return runsRef.current
      }
      const payload = parseJson(text)
      const incomingRuns = normalizeWorkflowRuns(payload)
      setState((previous) => ({
        ...previous,
        runs: mergeWorkflowRuns(previous.runs, incomingRuns),
        streamStatus: previous.streamStatus === "live" ? "live" : "polling",
        routeAvailable: true,
        message: incomingRuns.length ? "Workflow telemetry is replaying from the daemon event log." : "Workflow telemetry route is available; no workflow runs have been recorded yet.",
      }))
      return incomingRuns.length ? incomingRuns : runsRef.current
    } catch {
      setState((previous) => ({
        ...previous,
        streamStatus: "unavailable",
        routeAvailable: false,
        message: "Daemon telemetry route is unavailable: could not connect to /api/ugc/workflows.",
      }))
      return []
    }
  }, [])

  const loadWorkflowEvents = React.useCallback(async (runs: readonly WorkflowRunTelemetry[]) => {
    for (const run of runs.slice(0, 8)) {
      const after = workflowLatestCursor(run)
      const url = `${daemonBaseUrl}/api/ugc/workflows/${encodeURIComponent(run.id)}/events${after ? `?after=${encodeURIComponent(after)}` : ""}`
      try {
        const response = await fetch(url)
        if (!response.ok) continue
        const payload = parseJson(await response.text())
        const events = normalizeWorkflowEvents(payload)
        if (events.length) {
          setState((previous) => ({
            ...previous,
            runs: events.reduce((runsSoFar, event) => mergeWorkflowEvent(runsSoFar, event), previous.runs),
          }))
        }
      } catch {
        continue
      }
    }
  }, [])

  const refresh = React.useCallback(async () => {
    const runs = await loadWorkflowSnapshot()
    await loadWorkflowEvents(runs.length ? runs : runsRef.current)
  }, [loadWorkflowEvents, loadWorkflowSnapshot])

  const runDemoWorkflow = React.useCallback(async (lane: WorkflowDemoLane) => {
    setState((previous) => ({
      ...previous,
      demoRunningLane: lane,
      message: `Running deterministic local ${workflowDemoLaneLabel(lane)} with clean-room mechanics only…`,
    }))
    try {
      const response = await fetch(`${daemonBaseUrl}/api/ugc/workflows/demo`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ lane }),
      })
      const text = await response.text()
      const payload: JsonValue = text.trim() ? parseJson(text) : {}
      if (workflowRouteMissing(response)) {
        const demoResult: JsonValue = {
          unavailable: true,
          route: "/api/ugc/workflows/demo",
          lane,
          status: response.status,
          message: "Demo workflow route is unavailable in this daemon.",
        }
        setState((previous) => ({
          ...previous,
          demoRunningLane: null,
          demoRouteUnavailable: true,
          demoResult,
          message: `Demo workflow route unavailable: POST /api/ugc/workflows/demo returned ${response.status}.`,
        }))
        return
      }
      const incomingRuns = normalizeWorkflowRuns(payload)
      const incomingEvents = normalizeWorkflowEvents(payload)
      setState((previous) => ({
        ...previous,
        demoRunningLane: null,
        demoRouteUnavailable: false,
        runs: incomingEvents.reduce((runsSoFar, event) => mergeWorkflowEvent(runsSoFar, event), mergeWorkflowRuns(previous.runs, incomingRuns)),
        demoResult: compactWorkflowDemoResult(payload, lane, response.status),
        message: response.ok
          ? `Deterministic local ${workflowDemoLaneLabel(lane)} finished. Refreshing workflow telemetry and workspace state…`
          : `Demo workflow request returned ${response.status}. Inspect the compact result JSON.`,
      }))
      if (response.ok) {
        await Promise.all([refresh(), onRefreshWorkspaceState()])
        setState((previous) => ({
          ...previous,
          message: `Deterministic local ${workflowDemoLaneLabel(lane)} requested cleanly. Workflow telemetry and workspace refresh have been requested.`,
        }))
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      const demoResult: JsonValue = {
        unavailable: true,
        route: "/api/ugc/workflows/demo",
        lane,
        error: message,
      }
      setState((previous) => ({
        ...previous,
        demoRunningLane: null,
        demoRouteUnavailable: true,
        demoResult,
        message: "Demo workflow route is unavailable: could not connect to POST /api/ugc/workflows/demo.",
      }))
    }
  }, [onRefreshWorkspaceState, refresh])

  React.useEffect(() => {
    runsRef.current = state.runs
  }, [state.runs])

  React.useEffect(() => {
    let cancelled = false
    let pollTimer = 0
    let pollingStarted = false
    let eventSource: EventSource | null = null

    function beginPolling(message: string) {
      if (pollingStarted || cancelled) return
      pollingStarted = true
      setState((previous) => ({
        ...previous,
        streamStatus: previous.streamStatus === "unavailable" ? "unavailable" : "polling",
        message,
      }))
      schedulePoll()
    }

    function schedulePoll() {
      if (cancelled) return
      pollTimer = window.setTimeout(() => {
        void (async () => {
          await refresh()
          schedulePoll()
        })()
      }, 4000)
    }

    void (async () => {
      await refresh()
      if (cancelled) return
      if (typeof EventSource === "undefined") {
        beginPolling("EventSource is unavailable in this renderer; polling workflow events.")
        return
      }
      const source = new EventSource(`${daemonBaseUrl}/api/ugc/workflows/events/stream`)
      eventSource = source
      source.onopen = () => {
        if (!cancelled) {
          setState((previous) => ({
            ...previous,
            streamStatus: "live",
            routeAvailable: true,
            message: "Live workflow event stream connected.",
          }))
        }
      }
      source.onmessage = (message: MessageEvent<string>) => {
        const events = normalizeWorkflowEvents(parseJson(message.data))
        if (!events.length) return
        setState((previous) => ({
          ...previous,
          runs: events.reduce((runsSoFar, event) => mergeWorkflowEvent(runsSoFar, event), previous.runs),
          streamStatus: "live",
          routeAvailable: true,
          message: "Live workflow event stream connected.",
        }))
      }
      source.onerror = () => {
        source.close()
        beginPolling("Workflow event stream is unavailable; polling run events as fallback.")
      }
    })()

    return () => {
      cancelled = true
      if (eventSource) eventSource.close()
      if (pollTimer) window.clearTimeout(pollTimer)
    }
  }, [refresh])

  return {
    ...state,
    refresh,
    runDemoWorkflow,
  }
}

function codexJobMediaSummary(job: UgcProviderJob): CodexJobMediaSummary {
  const requestRoot = jsonRecord(job.request)
  const payload = jsonRecord(requestRoot?.payload ?? null)
  const metadata = jsonRecord(payload?.metadata ?? null)
  const framePreparation = jsonRecord(requestRoot?.framePreparation ?? null)
  const extraction = jsonRecord(framePreparation?.extraction ?? null)
  const referenceFrameUrls = jsonStringArray(metadata?.referenceFrameUrls ?? framePreparation?.referenceFrameUrls ?? null)
  const metadataArtifactPaths = jsonStringArray(metadata?.artifactPaths ?? null)
  const preparedArtifactPaths = jsonStringArray(framePreparation?.artifactPaths ?? null)
  const artifactPaths = metadataArtifactPaths.length ? metadataArtifactPaths : preparedArtifactPaths.length ? preparedArtifactPaths : job.artifactPaths
  const extractedFrameCount = typeof extraction?.frameCount === "number" ? extraction.frameCount : null
  const mediaUrl = typeof metadata?.mediaUrl === "string" ? metadata.mediaUrl : null
  const frameStatus = typeof extraction?.status === "string" ? extraction.status : null
  const frameSource = typeof extraction?.source === "string" ? extraction.source : null
  return {
    mediaUrl,
    referenceFrameUrls,
    artifactPaths,
    frameCount: extractedFrameCount ?? (referenceFrameUrls.length || artifactPaths.length),
    artifactCount: artifactPaths.length,
    framePreparation: frameStatus && frameSource ? `${frameStatus} / ${frameSource}` : frameStatus,
  }
}

export function ReactUgcStudio() {
  const [activeView, setActiveView] = React.useState<ReactView>("atlas")
  const [localState, setLocalState] = React.useState<UgcLocalState>(fallbackLocalState)
  const workspace = localState.workspace
  const [selectedCandidateId, setSelectedCandidateId] = React.useState(fallbackLocalState.workspace.finalEditor.selectedCandidateId)
  const [selectedPersonaId, setSelectedPersonaId] = React.useState(fallbackLocalState.workspace.personas[0]?.id ?? "")
  const [selectedBranchId, setSelectedBranchId] = React.useState(fallbackLocalState.workspace.branchSnapshots[0]?.id ?? "")
  const [capabilities, setCapabilities] = React.useState<KieCapability[]>(fallbackCapabilities)
  const [operation, setOperation] = React.useState<KieOperation>("image-text")
  const [prompt, setPrompt] = React.useState("Make the selected personas less polished and generate 8 warmer hooks")
  const [result, setResult] = React.useState("Dry-run a KIE payload to verify routing without spending credits.")
  const [busy, setBusy] = React.useState(false)
  const [workspaceBundle, setWorkspaceBundle] = React.useState<UgcWorkspaceBundle | null>(null)
  const [bundleResult, setBundleResult] = React.useState<JsonValue | null>(null)
  const personaCards = React.useMemo(() => workspace.personas.map(projectPersonaCard), [workspace.personas])
  const selectedCandidate = workspace.candidates.find((candidate) => candidate.id === selectedCandidateId) ?? workspace.candidates[0]
  const selectedPersona = personaCards.find((persona) => persona.id === selectedPersonaId) ?? personaCards[0]
  const selectedBranch = workspace.branchSnapshots.find((branch) => branch.id === selectedBranchId) ?? workspace.branchSnapshots[0]
  const selectedCapability = capabilities.find((capability) => capability.operation === operation) ?? capabilities[0]
  const activeViewMeta = views.find((view) => view.value === activeView) ?? views[0]

  const refreshWorkspaceState = React.useCallback(async (): Promise<void> => {
    try {
      const response = await fetch(`${daemonBaseUrl}/api/ugc/workspace`)
      if (!response.ok) return
      const payload = parseJson(await response.text())
      if (isLocalState(payload)) setLocalState(payload)
    } catch {
      return
    }
  }, [])

  React.useEffect(() => {
    void refreshWorkspaceState()
  }, [refreshWorkspaceState])

  React.useEffect(() => {
    if (!workspace.candidates.some((candidate) => candidate.id === selectedCandidateId)) {
      setSelectedCandidateId(workspace.finalEditor.selectedCandidateId || workspace.candidates[0]?.id || "")
    }
    if (!workspace.personas.some((persona) => persona.id === selectedPersonaId)) {
      setSelectedPersonaId(workspace.personas[0]?.id || "")
    }
    if (!workspace.branchSnapshots.some((branch) => branch.id === selectedBranchId)) {
      setSelectedBranchId(workspace.branchSnapshots[0]?.id || "")
    }
  }, [workspace, selectedBranchId, selectedCandidateId, selectedPersonaId])

  React.useEffect(() => {
    let cancelled = false
    fetch(`${daemonBaseUrl}/api/ugc/kie/capabilities`)
      .then((response) => response.ok ? response.json() : Promise.reject(new Error(`daemon ${response.status}`)))
      .then((payload: { capabilities?: KieCapability[] }) => {
        if (!cancelled && payload.capabilities?.length) setCapabilities(payload.capabilities)
      })
      .catch(() => undefined)
    return () => {
      cancelled = true
    }
  }, [])

  const request = React.useMemo<KieRequest>(() => ({
    operation,
    prompt,
    aspectRatio: selectedCapability?.family === "image" ? "1:1" : "9:16",
    durationSec: 5,
    resolution: selectedCapability?.family === "image" ? "1024" : "720p",
    quality: "basic",
    maxSpendUsd: 0.05,
  }), [operation, prompt, selectedCapability])

  async function callKie(path: string, body?: KieRequest) {
    setBusy(true)
    try {
      const response = await fetch(`${daemonBaseUrl}${path}`, body ? {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      } : undefined)
      const text = await response.text()
      setResult(text)
      if (body && response.ok) {
        await persistProviderJob(body, parseJson(text), path.includes("/create") && body.live === true ? "live" : "dry-run")
      }
    } catch (error) {
      setResult(error instanceof Error ? error.message : String(error))
    } finally {
      setBusy(false)
    }
  }

  async function mutateLocal(path: string, body: object) {
    setBusy(true)
    try {
      const response = await fetch(`${daemonBaseUrl}${path}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      })
      const payload = await response.json() as UgcLocalState | UgcMutationEnvelope
      const envelopeState = "state" in payload ? payload.state : undefined
      const nextState = isLocalState(payload) ? payload : isLocalState(envelopeState) ? envelopeState : null
      if (!response.ok || !nextState) {
        setResult(JSON.stringify(payload, null, 2))
        return
      }
      setLocalState(nextState)
      setResult(JSON.stringify({ ok: true, path, updatedAt: nextState.updatedAt }, null, 2))
    } catch (error) {
      setResult(error instanceof Error ? error.message : String(error))
    } finally {
      setBusy(false)
    }
  }

  async function exportWorkspaceBundle(label: string) {
    setBusy(true)
    try {
      const response = await fetch(`${daemonBaseUrl}/api/ugc/workspace/bundles/export`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ label }),
      })
      const text = await response.text()
      const payload = parseJson(text)
      if (response.ok && isWorkspaceBundle(payload)) {
        const compact = compactBundleExportResult(payload)
        setWorkspaceBundle(payload)
        setBundleResult(compact)
        setResult(JSON.stringify(compact))
        return
      }
      setBundleResult(payload)
      setResult(JSON.stringify(payload))
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      setBundleResult({ error: message })
      setResult(message)
    } finally {
      setBusy(false)
    }
  }

  async function importWorkspaceBundle(bundle: unknown, dryRun: boolean) {
    setBusy(true)
    try {
      const response = await fetch(`${daemonBaseUrl}/api/ugc/workspace/bundles/import`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ bundle, dryRun }),
      })
      const text = await response.text()
      const payload = parseJson(text)
      if (response.ok && isWorkspaceBundleImportResult(payload)) {
        const compact = compactBundleImportResult(payload)
        setBundleResult(compact)
        setResult(JSON.stringify(compact))
        if (isWorkspaceBundle(bundle)) setWorkspaceBundle(bundle)
        if (payload.importedState && isLocalState(payload.importedState)) setLocalState(payload.importedState)
        return
      }
      setBundleResult(payload)
      setResult(JSON.stringify(payload))
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      setBundleResult({ error: message })
      setResult(message)
    } finally {
      setBusy(false)
    }
  }

  async function importWorkflowHandoff(runId: string, payload: JsonValue, apply: boolean): Promise<WorkflowImportRequestResult> {
    setBusy(true)
    try {
      const response = await fetch(`${daemonBaseUrl}/api/ugc/workflows/${encodeURIComponent(runId)}/import`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ payload, apply }),
      })
      const responsePayload = parseJson(await response.text())
      const root = jsonRecord(responsePayload)
      const compact = compactWorkflowImportResult(responsePayload)
      if (response.ok && root) {
        if (isLocalState(root.state)) setLocalState(root.state)
        if (isLocalState(root.importedState)) setLocalState(root.importedState)
      }
      setResult(JSON.stringify(compact, null, 2))
      if (response.ok && apply) await refreshWorkspaceState()
      return {
        ok: response.ok,
        status: response.status,
        routeUnavailable: workflowRouteMissing(response),
        payload: responsePayload,
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      const responsePayload: JsonValue = {
        error: message,
        route: "/api/ugc/workflows/:runId/import",
        unavailable: true,
      }
      setResult(JSON.stringify(responsePayload, null, 2))
      return {
        ok: false,
        status: 0,
        routeUnavailable: true,
        payload: responsePayload,
      }
    } finally {
      setBusy(false)
    }
  }

  async function callAnalysisToKie(body: AnalysisToKieInput) {
    setBusy(true)
    try {
      const response = await fetch(`${daemonBaseUrl}/api/ugc/kie/analysis-to-kie`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      })
      const text = await response.text()
      if (response.status === 404) {
        setResult(JSON.stringify({
          unavailable: true,
          route: "/api/ugc/kie/analysis-to-kie",
          message: "Analysis-to-KIE dry-run route is not available in this daemon yet. Keep the Codex analysis job selected and retry after backend route rollout.",
          request: body,
        }, null, 2))
        return
      }
      const payload = parseJson(text)
      const root = jsonRecord(payload)
      if (response.ok && root && isLocalState(root.state)) setLocalState(root.state)
      setResult(JSON.stringify(payload, null, 2))
    } catch (error) {
      setResult(error instanceof Error ? error.message : String(error))
    } finally {
      setBusy(false)
    }
  }

  async function callReferenceCatalog(path: "/api/ugc/reference-catalog/plan" | "/api/ugc/reference-catalog/import", manifestPaths: readonly string[]) {
    setBusy(true)
    try {
      const response = await fetch(`${daemonBaseUrl}${path}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ manifestPaths }),
      })
      const text = await response.text()
      const payload = parseJson(text)
      const root = jsonRecord(payload)
      if (response.ok && root && isLocalState(root.state)) setLocalState(root.state)
      setResult(JSON.stringify(payload, null, 2))
    } catch (error) {
      setResult(error instanceof Error ? error.message : String(error))
    } finally {
      setBusy(false)
    }
  }

  async function persistProviderJob(body: KieRequest, responseJson: JsonValue, mode: "dry-run" | "live") {
    const response = await fetch(`${daemonBaseUrl}/api/ugc/provider-jobs`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        provider: "kie",
        operation: body.operation,
        mode,
        status: "planned",
        targetIds: [selectedPersonaId, selectedCandidateId].filter(Boolean),
        spendCapUsd: body.maxSpendUsd ?? 0.05,
        estimatedCostUsd: selectedCapability?.estimatedCostUsd ?? null,
        request: body,
        response: responseJson,
      }),
    })
    if (response.ok) setLocalState(await response.json() as UgcLocalState)
  }

  return (
    <UgcLocalStateContext.Provider value={localState}>
    <WorkbenchShell className="react-ugc-theme" data-ugc-studio-root>
      <Sidebar activeView={activeView} onViewChange={setActiveView} />
      <WorkbenchMain>
        <Topbar activeViewMeta={activeViewMeta} />
        <WorkbenchContent className="grid-cols-[minmax(0,1fr)_314px]">
          <WorkbenchCanvas className="grid grid-rows-[58px_minmax(0,1fr)_auto]">
            <ViewToolbar activeView={activeView} onViewChange={setActiveView} />
            <div className="rugc-stage">
              <WorkspaceView
                activeView={activeView}
                selectedCandidateId={selectedCandidateId}
                selectedPersonaId={selectedPersonaId}
                selectedBranchId={selectedBranchId}
                operation={operation}
                capabilities={capabilities}
                selectedCapability={selectedCapability}
                result={result}
                busy={busy}
                request={request}
                onSelectCandidate={setSelectedCandidateId}
                onSelectPersona={setSelectedPersonaId}
                onSelectBranch={setSelectedBranchId}
                onOperationChange={setOperation}
                onCallKie={callKie}
                onMutateLocal={mutateLocal}
                onPlanAnalysisToKie={callAnalysisToKie}
                onReferenceCatalog={callReferenceCatalog}
                workspaceBundle={workspaceBundle}
                bundleResult={bundleResult}
                onExportWorkspaceBundle={exportWorkspaceBundle}
                onImportWorkspaceBundle={importWorkspaceBundle}
                onImportWorkflowHandoff={importWorkflowHandoff}
                onRefreshWorkspaceState={refreshWorkspaceState}
              />
            </div>
            <CommandBar prompt={prompt} onPromptChange={setPrompt} onRun={() => callKie("/api/ugc/kie/plan", request)} busy={busy} />
          </WorkbenchCanvas>
          <Inspector
            activeView={activeView}
            selectedPersona={selectedPersona}
            selectedCandidate={selectedCandidate}
            selectedBranch={selectedBranch}
            selectedCapability={selectedCapability}
            result={result}
            busy={busy}
            onMutateLocal={mutateLocal}
            onPlanAnalysisToKie={callAnalysisToKie}
            workspaceBundle={workspaceBundle}
            bundleResult={bundleResult}
            onExportWorkspaceBundle={exportWorkspaceBundle}
            onImportWorkspaceBundle={importWorkspaceBundle}
          />
        </WorkbenchContent>
      </WorkbenchMain>
    </WorkbenchShell>
    </UgcLocalStateContext.Provider>
  )
}

function Sidebar(props: { activeView: ReactView; onViewChange: (view: ReactView) => void }) {
  const workspace = useUgcLocalState().workspace
  const candidates = workspace.candidates
  const total = candidates.length
  const ready = candidates.filter((candidate) => candidate.status === "ready").length
  const starred = candidates.filter((candidate) => candidate.status === "starred").length
  const exported = candidates.filter((candidate) => candidate.status === "exported").length
  const rejected = candidates.filter((candidate) => candidate.status === "rejected").length
  return (
    <WorkbenchSidebar>
      <div className="flex items-center gap-2">
        <span className="grid h-6 w-6 shrink-0 place-items-center rounded-md bg-primary text-primary-foreground">
          <Clapperboard size={14} />
        </span>
        <span className="truncate text-sm font-semibold">UGC Studio</span>
      </div>
      <SidebarSection title="Workspace">
        {views.map((view) => {
          const Icon = view.icon
          return (
            <SidebarRow
              key={view.value}
              type="button"
              active={props.activeView === view.value}
              icon={<Icon size={14} />}
              aria-label={view.label}
              shortcut={`g${view.value.slice(0, 1)}`}
              onClick={() => props.onViewChange(view.value)}
            >
              {view.label}
            </SidebarRow>
          )
        })}
      </SidebarSection>
      <SidebarSection title="Candidates">
        <div className="grid gap-1 px-1 text-xs text-muted-foreground">
          <div className="flex items-center justify-between">
            <span>Total</span>
            <span>{total}</span>
          </div>
          <div className="flex items-center justify-between">
            <span>Ready</span>
            <span>{ready}</span>
          </div>
          <div className="flex items-center justify-between">
            <span>Starred</span>
            <span>{starred}</span>
          </div>
          <div className="flex items-center justify-between">
            <span>Exported</span>
            <span>{exported}</span>
          </div>
          <div className="flex items-center justify-between">
            <span>Rejected</span>
            <span>{rejected}</span>
          </div>
        </div>
      </SidebarSection>
    </WorkbenchSidebar>
  )
}

function SidebarSection(props: { title: string; children: React.ReactNode }) {
  return (
    <section className="grid gap-1.5">
      <h2 className="mx-1 text-[10px] font-semibold uppercase tracking-normal text-muted-foreground">
        {props.title}
      </h2>
      <div className="grid gap-0.5">{props.children}</div>
    </section>
  )
}

function Topbar(props: { activeViewMeta: (typeof views)[number] }) {
  const workspace = useUgcLocalState().workspace
  return (
    <WorkbenchTopbar>
      <div className="flex min-w-0 items-center gap-2 text-muted-foreground">
        <Home size={13} />
        <span>UGC Studio</span>
        <span>/</span>
        <span className="truncate">{workspace.title}</span>
        <span>/</span>
        <strong className="truncate text-foreground">{props.activeViewMeta.label}</strong>
      </div>
    </WorkbenchTopbar>
  )
}

function ViewToolbar(props: { activeView: ReactView; onViewChange: (view: ReactView) => void }) {
  const workspace = useUgcLocalState().workspace
  return (
    <div className="flex h-[58px] items-center justify-between gap-3 border-b border-border bg-card/80 px-4">
      <div className="min-w-[190px] flex-1">
        <p className="m-0 truncate text-[11px] text-muted-foreground">{workspace.title}</p>
        <h1 data-ugc-view-title className="m-0 mt-0.5 truncate text-[15px] font-bold tracking-normal text-foreground">{views.find((view) => view.value === props.activeView)?.label}</h1>
      </div>
      <ToolbarCluster className="max-w-[72%] shrink overflow-x-auto">
        <Tabs value={props.activeView} items={viewTabs} onValueChange={props.onViewChange} className="shrink-0" />
      </ToolbarCluster>
    </div>
  )
}

function WorkspaceView(props: {
  activeView: ReactView
  selectedCandidateId: string
  selectedPersonaId: string
  selectedBranchId: string
  operation: KieOperation
  capabilities: KieCapability[]
  selectedCapability: KieCapability | undefined
  result: string
  busy: boolean
  request: KieRequest
  onSelectCandidate: (id: string) => void
  onSelectPersona: (id: string) => void
  onSelectBranch: (id: string) => void
  onOperationChange: (operation: KieOperation) => void
  onCallKie: (path: string, body?: KieRequest) => void
  onMutateLocal: (path: string, body: object) => void
  onPlanAnalysisToKie: (body: AnalysisToKieInput) => void
  onReferenceCatalog: (path: "/api/ugc/reference-catalog/plan" | "/api/ugc/reference-catalog/import", manifestPaths: readonly string[]) => void
  workspaceBundle: UgcWorkspaceBundle | null
  bundleResult: JsonValue | null
  onExportWorkspaceBundle: (label: string) => void
  onImportWorkspaceBundle: (bundle: unknown, dryRun: boolean) => void
  onImportWorkflowHandoff: (runId: string, payload: JsonValue, apply: boolean) => Promise<WorkflowImportRequestResult>
  onRefreshWorkspaceState: () => Promise<void>
}) {
  if (props.activeView === "atlas") {
    return <PersonaAtlas selectedPersonaId={props.selectedPersonaId} onSelectPersona={props.onSelectPersona} />
  }
  if (props.activeView === "explore") {
    return (
      <ExplorationBoard
        selectedCandidateId={props.selectedCandidateId}
        selectedPersonaId={props.selectedPersonaId}
        onSelectCandidate={props.onSelectCandidate}
        onSelectPersona={props.onSelectPersona}
      />
    )
  }
  if (props.activeView === "review") {
    return <BatchReview selectedCandidateId={props.selectedCandidateId} onSelectCandidate={props.onSelectCandidate} onMutateLocal={props.onMutateLocal} />
  }
  if (props.activeView === "campaign") {
    return <CampaignMap selectedBranchId={props.selectedBranchId} onSelectBranch={props.onSelectBranch} onSelectCandidate={props.onSelectCandidate} onMutateLocal={props.onMutateLocal} />
  }
  if (props.activeView === "reference") {
    return <ReferenceArchiveView onMutateLocal={props.onMutateLocal} onReferenceCatalog={props.onReferenceCatalog} />
  }
  if (props.activeView === "editor") {
    return <FinalEditor selectedCandidateId={props.selectedCandidateId} onSelectCandidate={props.onSelectCandidate} onMutateLocal={props.onMutateLocal} />
  }
  if (props.activeView === "graph") {
    return (
      <DeveloperGraphView
        onMutateLocal={props.onMutateLocal}
        workspaceBundle={props.workspaceBundle}
        bundleResult={props.bundleResult}
        onExportWorkspaceBundle={props.onExportWorkspaceBundle}
        onImportWorkspaceBundle={props.onImportWorkspaceBundle}
        onImportWorkflowHandoff={props.onImportWorkflowHandoff}
        onRefreshWorkspaceState={props.onRefreshWorkspaceState}
      />
    )
  }
  return (
    <ProviderView
      operation={props.operation}
      capabilities={props.capabilities}
      selectedCapability={props.selectedCapability}
      result={props.result}
      busy={props.busy}
      request={props.request}
      onOperationChange={props.onOperationChange}
      onCallKie={props.onCallKie}
      onMutateLocal={props.onMutateLocal}
      onPlanAnalysisToKie={props.onPlanAnalysisToKie}
    />
  )
}

function PersonaAtlas(props: { selectedPersonaId: string; onSelectPersona: (id: string) => void }) {
  const { workspace } = useUgcLocalState()
  const personaCards = workspace.personas.map(projectPersonaCard)
  return (
    <div className="rugc-atlas">
      <div className="rugc-atlas-grid">
        {personaCards.map((persona) => (
          <button
            key={persona.id}
            type="button"
            className={cn("rugc-persona-card", props.selectedPersonaId === persona.id && "selected")}
            onClick={() => props.onSelectPersona(persona.id)}
          >
            <div className={cn("rugc-persona-portrait", persona.color)}>
              <span>{persona.name.split(" ").map((part) => part[0]).join("")}</span>
              <em>{persona.clips} clips</em>
            </div>
            <div className="rugc-persona-body">
              <header>
                <strong>{persona.name}</strong>
                <StatusPill status={persona.status} />
              </header>
              <p>{persona.archetype}</p>
              <dl>
                <dt>Voice</dt><dd>{persona.voice}</dd>
                <dt>Accent</dt><dd>{persona.accent}</dd>
                <dt>Niche</dt><dd>{persona.niche}</dd>
              </dl>
              <footer>
                <span>{persona.branches} branches</span>
                <span>{persona.followers} followers / {persona.conversions} conversion</span>
              </footer>
            </div>
          </button>
        ))}
      </div>
      <div className="rugc-agent-panel">
        <header>
          <Bot size={15} />
          <strong>Agent critique</strong>
        </header>
        <p>Strong first signal is calm skincare POV. Hook performance above average in tests.</p>
        <p>Consider more personal story moments. Too many CTA-first product angles.</p>
        <button type="button">Generate 12 persona directions</button>
      </div>
    </div>
  )
}

function ExplorationBoard(props: {
  selectedCandidateId: string
  selectedPersonaId: string
  onSelectCandidate: (id: string) => void
  onSelectPersona: (id: string) => void
}) {
  const { workspace } = useUgcLocalState()
  const rows = projectExplorationRows(workspace)
  return (
    <div className="rugc-explore">
      {rows.map((row) => (
        <section key={row.id} className="rugc-explore-row">
          <div className="rugc-stage-label">
            <span>{row.step}</span>
            <div>
              <strong>{row.title}</strong>
              <p>{row.description}</p>
            </div>
          </div>
          <div className="rugc-example-strip">
            {row.items.map((item) => (
              <button
                key={item.id}
                type="button"
                className={cn(
                  "rugc-example-card",
                  item.candidateId === props.selectedCandidateId && "selected",
                  item.personaId === props.selectedPersonaId && "selected",
                )}
                onClick={() => {
                  if (item.candidateId) props.onSelectCandidate(item.candidateId)
                  if (item.personaId) props.onSelectPersona(item.personaId)
                }}
              >
                <MiniThumb status={item.status} label={item.title} />
                <div>
                  <strong>{item.title}</strong>
                  <span>{item.subtitle}</span>
                </div>
                <em>{item.score.toFixed(1)}</em>
              </button>
            ))}
            <button type="button" className="rugc-example-card add">
              <Plus size={14} />
              <span>Try more like this</span>
            </button>
          </div>
        </section>
      ))}
    </div>
  )
}

function BatchReview(props: { selectedCandidateId: string; onSelectCandidate: (id: string) => void; onMutateLocal: (path: string, body: object) => void }) {
  const { workspace } = useUgcLocalState()
  const [filter, setFilter] = React.useState<"needs-review" | "starred" | "needs-revision" | "rejected" | "all">("needs-review")
  const [sortBy, setSortBy] = React.useState<"score" | "status" | "persona">("score")
  const [selectedSetIds, setSelectedSetIds] = React.useState<readonly string[]>([])
  const [noteDraft, setNoteDraft] = React.useState("Needs a more casual middle beat and softer CTA.")
  const selectedCandidate = workspace.candidates.find((candidate) => candidate.id === props.selectedCandidateId) ?? workspace.candidates[0]
  const selectedCandidateId = selectedCandidate?.id ?? props.selectedCandidateId
  const selectedCandidateNotes = selectedCandidate
    ? workspace.reviewNotes.filter((note) => selectedCandidate.reviewNoteIds.includes(note.id) || (note.attachedTo.kind === "candidate" && note.attachedTo.id === selectedCandidate.id))
    : []
  const filteredCandidates = React.useMemo(() => {
    const candidates = workspace.candidates.filter((candidate) => {
      if (filter === "all") return true
      if (filter === "needs-review") return candidate.status === "ready" || candidate.status === "queued" || candidate.status === "generating"
      return candidate.status === filter
    })
    return [...candidates].sort((left, right) => {
      if (sortBy === "score") return right.scorecard.overall - left.scorecard.overall
      if (sortBy === "persona") return (left.personaId ?? "").localeCompare(right.personaId ?? "")
      return left.status.localeCompare(right.status)
    })
  }, [filter, sortBy, workspace.candidates])
  const selectedSet = selectedSetIds.length ? selectedSetIds : [selectedCandidateId].filter(Boolean)
  const filterItems: Array<{ id: typeof filter; label: string; count: number }> = [
    { id: "needs-review", label: "Needs Review", count: workspace.candidates.filter((candidate) => candidate.status === "ready" || candidate.status === "queued" || candidate.status === "generating").length },
    { id: "starred", label: "Starred", count: workspace.candidates.filter((candidate) => candidate.status === "starred").length },
    { id: "needs-revision", label: "Needs Revision", count: workspace.candidates.filter((candidate) => candidate.status === "needs-revision").length },
    { id: "rejected", label: "Rejected", count: workspace.candidates.filter((candidate) => candidate.status === "rejected").length },
    { id: "all", label: "All Candidates", count: workspace.candidates.length },
  ]

  React.useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      const target = event.target
      if (target instanceof HTMLInputElement || target instanceof HTMLTextAreaElement || target instanceof HTMLSelectElement) return
      if (event.key === "1") {
        event.preventDefault()
        applyStatusToSet("rejected")
      } else if (event.key === "2") {
        event.preventDefault()
        applyStatusToSet("needs-revision")
      } else if (event.key === "3") {
        event.preventDefault()
        applyStatusToSet("starred")
      } else if (event.key === "5") {
        event.preventDefault()
        addReviewNote("fork", "Fork this direction into a lower-pressure variation.")
      }
    }
    window.addEventListener("keydown", onKeyDown)
    return () => window.removeEventListener("keydown", onKeyDown)
  }, [selectedSetIds, selectedCandidateId, noteDraft])

  function applyStatusToSet(status: CandidateStatus) {
    props.onMutateLocal("/api/ugc/candidates/status", { candidateIds: selectedSet, status })
  }

  function addReviewNote(verdict: ReviewVerdict, requestedChange: string | null = null) {
    props.onMutateLocal("/api/ugc/notes", {
      attachedTo: { kind: "candidate", id: selectedCandidateId },
      verdict,
      body: noteDraft,
      requestedChange,
    })
  }

  function toggleSelectedSet(candidateId: string) {
    setSelectedSetIds((ids) => ids.includes(candidateId) ? ids.filter((id) => id !== candidateId) : [...ids, candidateId])
  }

  return (
    <div className="rugc-review grid grid-cols-[160px_1fr] gap-4">
      <aside className="rugc-review-queue flex flex-col gap-3 pr-2 border-r border-border/40 bg-transparent shadow-none border-t-0 border-b-0 border-l-0 rounded-none p-0">
        <div className="flex flex-col gap-0.5">
          <span className="text-[10px] font-semibold tracking-wider text-muted-foreground uppercase mb-1">Queue</span>
          {filterItems.map((item) => (
            <button
              key={item.id}
              type="button"
              className={cn(
                "flex items-center justify-between gap-2 px-2 py-1.5 text-[11px] rounded transition-colors text-left font-medium",
                filter === item.id
                  ? "bg-primary/10 text-primary font-semibold"
                  : "text-muted-foreground hover:bg-muted/45 hover:text-foreground"
              )}
              onClick={() => setFilter(item.id)}
            >
              <span className="truncate">{item.label}</span>
              <span className="shrink-0 text-[10px] text-muted-foreground">{item.count}</span>
            </button>
          ))}
        </div>
        <div className="h-px bg-border/40 my-1" />
        <label className="flex flex-col gap-1 text-[10px] font-medium text-muted-foreground">
          Sort
          <select
            value={sortBy}
            onChange={(event) => setSortBy(event.target.value as typeof sortBy)}
            className="h-7 w-full rounded border border-input bg-transparent px-1.5 text-[11px] text-foreground focus:outline-none focus:ring-1 focus:ring-primary"
          >
            <option value="score">Score</option>
            <option value="status">Status</option>
            <option value="persona">Persona</option>
          </select>
        </label>
        <div className="rounded-md border border-border/60 bg-background p-2 text-[10px] leading-4 text-muted-foreground">
          <strong className="block text-[10px] uppercase tracking-wider text-foreground">Keyboard review</strong>
          <span className="block">1 reject selected</span>
          <span className="block">2 needs revision</span>
          <span className="block">3 star selected</span>
          <span className="block">5 fork note</span>
        </div>
        <div className="grid gap-2 rounded-md border border-border/60 bg-background p-2">
          <div className="flex items-center justify-between gap-2 text-[10px] text-muted-foreground">
            <strong className="text-foreground">Selected set</strong>
            <span>{selectedSet.length} active</span>
          </div>
          <div className="grid grid-cols-2 gap-1">
            <Button size="xs" variant="workbench" onClick={() => setSelectedSetIds(filteredCandidates.map((candidate) => candidate.id))}>Select visible</Button>
            <Button size="xs" variant="ghost" onClick={() => setSelectedSetIds([])}>Clear</Button>
          </div>
        </div>
        <div className="grid gap-2 rounded-md border border-border/60 bg-background p-2">
          <strong className="text-[10px] uppercase tracking-wider text-foreground">Note draft</strong>
          <Textarea className="min-h-20 text-[11px]" value={noteDraft} onChange={(event) => setNoteDraft(event.currentTarget.value)} />
          <div className="grid grid-cols-2 gap-1">
            <Button size="xs" variant="workbench" onClick={() => addReviewNote("keep")}>Keep note</Button>
            <Button size="xs" variant="outline" onClick={() => addReviewNote("reject")}>Reject note</Button>
          </div>
        </div>
        <div className="grid gap-1 rounded-md border border-border/60 bg-background p-2">
          <strong className="text-[10px] uppercase tracking-wider text-foreground">Verdict history</strong>
          {selectedCandidateNotes.length ? selectedCandidateNotes.slice(0, 4).map((note) => (
            <div key={note.id} className="rounded border border-border bg-card p-1.5 text-[10px] leading-4">
              <span className="font-semibold text-foreground">{note.verdict}</span>
              <span className="ml-1 text-muted-foreground">{note.body}</span>
            </div>
          )) : <span className="text-[10px] text-muted-foreground">No notes for selected candidate.</span>}
        </div>
      </aside>
      <section className="rugc-player-wrap md:grid md:grid-cols-[64px_1fr] md:gap-4 lg:grid-cols-[74px_1fr]">
        <div className="rugc-variant-strip flex md:flex-col md:items-center gap-2 overflow-x-auto md:overflow-x-visible">
          {filteredCandidates.map((candidate, index) => (
            <button
              key={candidate.id}
              type="button"
              className={cn("w-12 h-12 flex flex-col items-center justify-center border rounded-md transition-all", candidate.id === props.selectedCandidateId ? "border-primary bg-primary/5 ring-1 ring-primary" : "border-border bg-card hover:bg-muted/50")}
              onClick={() => props.onSelectCandidate(candidate.id)}
            >
              <MiniThumb status={candidate.status === "needs-revision" ? "risk" : "keep"} label={`${index + 1}`} />
              <span className="text-[9px] mt-1 font-mono text-muted-foreground">0:{String(candidate.durationSeconds).padStart(2, "0")}</span>
            </button>
          ))}
        </div>
        <div className="rugc-player-container flex flex-col items-center bg-[#fcfbfa] border border-border/60 rounded-xl p-5 shadow-[0_1px_3px_rgba(0,0,0,0.02)] min-h-[460px] justify-between">
          <div className="w-full flex justify-between items-center border-b border-border/40 pb-2 mb-3">
            <span className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wider">Vertical Video Review (9:16)</span>
            <span className="px-2 py-0.5 rounded-full bg-primary/10 text-primary text-[9px] font-mono font-medium">{selectedCandidate?.kind || "9:16 ARTIFACT"}</span>
          </div>
          <div className="phone-artboard flex flex-col justify-end p-4 bg-zinc-950 border border-zinc-900 rounded-[28px] shadow-2xl relative overflow-hidden w-[200px] h-[356px] transition-transform hover:scale-[1.01]">
            <span className="rugc-player-badge absolute top-3 left-3 bg-black/70 backdrop-blur-md text-zinc-300 border border-white/10 px-2 py-0.5 rounded-full text-[9px] font-mono tracking-wider">PLAYING</span>
            <div className="absolute inset-0 bg-gradient-to-t from-black/80 via-black/15 to-black/25 pointer-events-none" />
            <div className="rugc-player-caption z-10 bg-black/85 backdrop-blur-sm p-3 rounded-xl border border-white/10 text-white text-[11px] leading-relaxed font-sans text-center shadow-lg">
              {selectedCandidate?.preview.transcript[0]?.text ?? "No transcript yet"}
            </div>
          </div>
          <div className="w-full max-w-[420px] bg-white border border-border/60 p-3.5 rounded-xl text-xs shadow-[0_1px_2px_rgba(0,0,0,0.01)] mt-4">
            <span className="text-[9px] font-bold text-primary uppercase tracking-wider block mb-1">Selected Candidate Transcript</span>
            <p className="text-foreground leading-relaxed font-normal text-[11.5px]">{selectedCandidate?.preview.transcript[0]?.text ?? "No transcript yet"}</p>
          </div>
        </div>
        <div className="rugc-player-controls flex items-center justify-between gap-3 px-4 py-2 bg-card border border-border rounded-xl text-muted-foreground shadow-sm mt-2 w-full grid-column-2">
          <div className="flex items-center gap-3">
            <Button type="button" size="xs" variant="ghost" className="h-7 w-7 p-0 rounded-full" aria-label="Rewind"><Rewind size={13} /></Button>
            <Button type="button" size="xs" variant="subtle" className="h-8 w-8 p-0 rounded-full bg-primary/10 text-primary hover:bg-primary/20" aria-label="Pause"><Pause size={13} /></Button>
            <Button type="button" size="xs" variant="ghost" className="h-7 w-7 p-0 rounded-full" aria-label="Fast Forward"><FastForward size={13} /></Button>
          </div>
          <div className="flex-1 mx-3 flex items-center gap-3">
            <span className="text-[10px] font-mono text-muted-foreground">0:07</span>
            <div className="rugc-progress flex-1 h-1 bg-muted rounded-full overflow-hidden relative cursor-pointer">
              <span className="absolute top-0 left-0 bottom-0 bg-primary rounded-full" style={{ width: "36%" }} />
            </div>
            <em className="text-[10px] font-mono font-normal text-muted-foreground">0:{String(selectedCandidate?.durationSeconds ?? 32).padStart(2, "0")}</em>
          </div>
          <div className="flex items-center gap-2">
            <Button type="button" size="xs" variant="outline" className="h-7 text-[10px] px-2 font-mono">1x speed</Button>
            <Button type="button" size="xs" variant="ghost" className="h-7 w-7 p-0 rounded-full" aria-label="Inspect"><Eye size={13} /></Button>
          </div>
        </div>
      </section>
      <div className="col-span-full flex items-center justify-between gap-3 rounded-lg border border-border bg-card px-3 py-1.5 shadow-sm mt-2">
        <div className="min-w-0 text-[11px] text-muted-foreground">
          <strong className="text-foreground">{selectedSet.length}</strong> selected
          <span className="ml-2">Filter: {filterItems.find((item) => item.id === filter)?.label}</span>
        </div>
        <div className="flex shrink-0 items-center gap-2">
          <Button size="xs" variant="workbench" onClick={() => setSelectedSetIds(filteredCandidates.map((candidate) => candidate.id))}>Select visible</Button>
          <Button size="xs" variant="ghost" onClick={() => setSelectedSetIds([])}>Clear</Button>
          <Button size="xs" variant="workbench" onClick={() => applyStatusToSet("starred")}>Star selected</Button>
          <Button size="xs" variant="workbench" onClick={() => applyStatusToSet("needs-revision")}>Revise selected</Button>
          <Button size="xs" variant="outline" onClick={() => applyStatusToSet("rejected")}>Reject selected</Button>
          <Button size="xs" variant="subtle" onClick={() => addReviewNote("revise", "Regenerate selected direction with a softer CTA.")}>Add note</Button>
        </div>
      </div>
      <table className="rugc-review-table mt-3 border border-border/30 rounded-xl overflow-hidden bg-white text-[11px] w-full border-collapse shadow-[0_1px_2px_rgba(0,0,0,0.01)]">
        <thead>
          <tr className="bg-muted/30 border-b border-border/50 text-muted-foreground">
            <th className="px-3 py-2 text-left font-semibold">Select</th>
            <th className="px-3 py-2 text-left font-semibold">Thumbnail</th>
            <th className="px-3 py-2 text-left font-semibold">Persona</th>
            <th className="px-3 py-2 text-left font-semibold">Format</th>
            <th className="px-3 py-2 text-left font-semibold">Hook</th>
            <th className="px-3 py-2 text-left font-semibold">CTA</th>
            <th className="px-3 py-2 text-left font-semibold">Scores</th>
            <th className="px-3 py-2 text-left font-semibold">Status</th>
          </tr>
        </thead>
        <tbody>
          {filteredCandidates.map((candidate, index) => (
            <tr
              key={candidate.id}
              className={cn(
                "border-b border-border/30 hover:bg-muted/10 cursor-pointer transition-colors",
                candidate.id === props.selectedCandidateId && "bg-primary/5 text-foreground font-semibold active"
              )}
              onClick={() => props.onSelectCandidate(candidate.id)}
            >
              <td className="px-3 py-2" onClick={(e) => e.stopPropagation()}>
                <input
                  type="checkbox"
                  checked={selectedSetIds.includes(candidate.id)}
                  onChange={() => toggleSelectedSet(candidate.id)}
                  className="rounded border-gray-300 text-primary focus:ring-primary h-3 w-3"
                  aria-label={`Select ${candidate.title}`}
                />
                <span className="ml-2 text-muted-foreground font-mono">#{index + 1}</span>
              </td>
              <td className="px-3 py-2"><MiniThumb status={candidate.status === "needs-revision" ? "risk" : "keep"} label="" /></td>
              <td className="px-3 py-2 font-medium">{candidate.personaId?.includes("deadpan") ? "Runner" : "Lily"}</td>
              <td className="px-3 py-2 text-muted-foreground">{candidate.kind}</td>
              <td className="px-3 py-2 font-medium truncate max-w-[150px]">{candidate.title}</td>
              <td className="px-3 py-2 text-muted-foreground">{candidate.kind === "cta" ? "Direct" : "Soft"}</td>
              <td className="px-3 py-2 font-mono font-medium text-foreground">{candidate.scorecard.overall} / {candidate.scorecard.personaFit}</td>
              <td className="px-3 py-2">
                <span className={cn(
                  "inline-flex items-center px-1.5 py-0.5 rounded text-[10px] font-medium border",
                  candidate.status === "starred" ? "bg-amber-50 text-amber-700 border-amber-200" :
                  candidate.status === "needs-revision" ? "bg-rose-50 text-rose-700 border-rose-200" :
                  candidate.status === "rejected" ? "bg-zinc-50 text-zinc-700 border-zinc-200" :
                  "bg-blue-50 text-blue-700 border-blue-200"
                )}>
                  {candidate.status === "starred" ? "Approved" : candidate.status === "needs-revision" ? "In Review" : candidate.status === "rejected" ? "Rejected" : "Draft"}
                </span>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
  }


function CampaignMap(props: { selectedBranchId: string; onSelectBranch: (id: string) => void; onSelectCandidate: (id: string) => void; onMutateLocal: (path: string, body: object) => void }) {
  const { workspace } = useUgcLocalState()
  const columns = projectCampaignColumns(workspace)
  const selectedBranch = workspace.branchSnapshots.find((branch) => branch.id === props.selectedBranchId) ?? workspace.branchSnapshots[0]
  const selectedCandidates = selectedBranch ? workspace.candidates.filter((candidate) => selectedBranch.selectedCandidateIds.includes(candidate.id)) : []
  function patchSelectedBranch(status: BranchSnapshot["status"], decisionNote: string) {
    if (!selectedBranch) return
    props.onMutateLocal(`/api/ugc/branches/${selectedBranch.id}`, { status, decisionNote })
  }
  function forkSelectedBranch() {
    if (!selectedBranch) return
    props.onMutateLocal("/api/ugc/branches", {
      parentId: selectedBranch.id,
      title: `${selectedBranch.title} fork`,
      focus: selectedBranch.focus,
      selectedPersonaIds: selectedBranch.selectedPersonaIds,
      selectedCandidateIds: selectedBranch.selectedCandidateIds,
      candidateBatchIds: selectedBranch.candidateBatchIds,
      decisionNote: "Forked from campaign map controls.",
    })
  }
  return (
    <div className="rugc-map">
      <div className="rugc-map-canvas">
        {columns.map((column) => (
          <section key={column.id} className="rugc-map-column">
            <header>
              <strong>{column.title}</strong>
              <span>{column.subtitle}</span>
            </header>
            <div>
              {column.nodes.map((node) => (
                <button
                  key={node.id}
                  type="button"
                  className={cn("rugc-map-node", node.status, props.selectedBranchId === node.id && "selected")}
                  onClick={() => {
                    props.onSelectBranch(node.id)
                    if (node.candidateId) props.onSelectCandidate(node.candidateId)
                  }}
                >
                  <MiniThumb status={node.status === "dead" ? "risk" : node.status === "active" ? "new" : "keep"} label="" />
                  <strong>{node.title}</strong>
                  <span>{node.meta}</span>
                  <em>{node.score}</em>
                </button>
              ))}
            </div>
          </section>
        ))}
      </div>
      <div className="rugc-snapshot-tray">
        <div>
          <strong>{selectedBranch?.title ?? "No snapshot selected"}</strong>
          <p>{selectedBranch?.decisionNote ?? "Select a branch snapshot to inspect rollback and fork controls."}</p>
          <span>{selectedBranch ? `${selectedBranch.status} / ${selectedBranch.childIds.length} forks` : "no branch"}</span>
          <div className="mt-2 grid grid-cols-4 gap-1.5">
            <Button size="xs" variant="workbench" disabled={!selectedBranch} onClick={() => patchSelectedBranch("active", "Rolled back to this branch from campaign map.")}>Rollback active</Button>
            <Button size="xs" variant="workbench" disabled={!selectedBranch} onClick={() => patchSelectedBranch("promising", "Selected as promising from campaign map.")}>Select promising</Button>
            <Button size="xs" variant="outline" disabled={!selectedBranch} onClick={forkSelectedBranch}>Fork</Button>
            <Button size="xs" variant="ghost" disabled={!selectedBranch} onClick={() => patchSelectedBranch("dead-end", "Marked dead-end from campaign map controls.")}>Dead end</Button>
          </div>
        </div>
        <div className="rugc-preview-strip">
          {(selectedCandidates.length ? selectedCandidates : workspace.candidates.slice(0, 3)).map((candidate) => (
            <button key={candidate.id} type="button" onClick={() => props.onSelectCandidate(candidate.id)}>
              <MiniThumb status="keep" label="" />
              <PlayCircle size={22} />
              <span>{candidate.title}</span>
            </button>
          ))}
        </div>
        <div className="mt-2 grid max-h-24 gap-1 overflow-auto text-[10px] leading-4 text-muted-foreground">
          {workspace.branchSnapshots.slice(0, 6).map((branch) => (
            <button key={branch.id} type="button" className="rounded border border-border bg-card px-2 py-1 text-left hover:bg-accent" onClick={() => props.onSelectBranch(branch.id)}>
              <strong className="text-foreground">{branch.title}</strong> — {branch.status}: {branch.decisionNote}
            </button>
          ))}
        </div>
      </div>
    </div>
  )
}

function FinalEditor(props: { selectedCandidateId: string; onSelectCandidate: (id: string) => void; onMutateLocal: (path: string, body: object) => void }) {
  const { workspace } = useUgcLocalState()
  const selectedCandidate = workspace.candidates.find((candidate) => candidate.id === props.selectedCandidateId) ?? workspace.candidates[0]
  const [selectedTrackId, setSelectedTrackId] = React.useState(workspace.finalEditor.tracks[0]?.id ?? "")
  const selectedTrack = workspace.finalEditor.tracks.find((track) => track.id === selectedTrackId) ?? workspace.finalEditor.tracks[0]
  const [selectedClipId, setSelectedClipId] = React.useState(selectedTrack?.clips[0]?.id ?? "")
  const selectedClip = selectedTrack?.clips.find((clip) => clip.id === selectedClipId) ?? selectedTrack?.clips[0]
  const [clipLabelDraft, setClipLabelDraft] = React.useState(selectedClip?.label ?? "")
  const [clipTextDraft, setClipTextDraft] = React.useState(clipTextFromPayload(selectedClip, selectedCandidate))
  const [startDraft, setStartDraft] = React.useState(String(selectedClip?.startSeconds ?? 0))
  const [durationDraft, setDurationDraft] = React.useState(String(selectedClip?.durationSeconds ?? 1))
  const [clipPayloadDraft, setClipPayloadDraft] = React.useState(JSON.stringify(selectedClip?.payloadJson ?? { text: clipTextFromPayload(selectedClip, selectedCandidate) }, null, 2))
  const parsedClipPayload = React.useMemo(() => parseJsonOrNull(clipPayloadDraft), [clipPayloadDraft])
  const captionPayloadPreview = selectedClip ? mergeCaptionPayload(parsedClipPayload, clipTextDraft.trim() || selectedClip.label, selectedClip.editableFields) : null
  const timelinePatchPreview = React.useMemo(() => ({
    selectedCandidateId: selectedCandidate?.id ?? null,
    trackUpdate: selectedTrack ? {
      id: selectedTrack.id,
      visible: selectedTrack.visible,
      locked: selectedTrack.locked,
    } : null,
    clipUpdate: selectedTrack && selectedClip ? {
      trackId: selectedTrack.id,
      clipId: selectedClip.id,
      label: clipLabelDraft,
      startSeconds: numberDraft(startDraft, selectedClip.startSeconds),
      durationSeconds: numberDraft(durationDraft, selectedClip.durationSeconds),
      payloadJson: captionPayloadPreview,
    } : null,
  }), [captionPayloadPreview, clipLabelDraft, durationDraft, selectedCandidate?.id, selectedClip, selectedTrack, startDraft])

  React.useEffect(() => {
    if (!workspace.finalEditor.tracks.some((track) => track.id === selectedTrackId)) {
      setSelectedTrackId(workspace.finalEditor.tracks[0]?.id ?? "")
      return
    }
    if (selectedTrack && !selectedTrack.clips.some((clip) => clip.id === selectedClipId)) {
      setSelectedClipId(selectedTrack.clips[0]?.id ?? "")
    }
  }, [selectedClipId, selectedTrack, selectedTrackId, workspace.finalEditor.tracks])

  React.useEffect(() => {
    setClipLabelDraft(selectedClip?.label ?? "")
    setClipTextDraft(clipTextFromPayload(selectedClip, selectedCandidate))
    setStartDraft(String(selectedClip?.startSeconds ?? 0))
    setDurationDraft(String(selectedClip?.durationSeconds ?? 1))
    setClipPayloadDraft(JSON.stringify(selectedClip?.payloadJson ?? { text: clipTextFromPayload(selectedClip, selectedCandidate) }, null, 2))
  }, [selectedCandidate, selectedClip])

  function selectCandidate(candidateId: string) {
    props.onSelectCandidate(candidateId)
    props.onMutateLocal("/api/ugc/final-editor", { selectedCandidateId: candidateId })
  }

  function patchTrack(trackId: string, patch: { readonly visible?: boolean; readonly locked?: boolean }) {
    props.onMutateLocal("/api/ugc/final-editor", { trackUpdates: [{ id: trackId, ...patch }] })
  }

  function saveSelectedClip() {
    if (!selectedTrack || !selectedClip || !selectedCandidate) return
    props.onMutateLocal("/api/ugc/final-editor", {
      selectedCandidateId: selectedCandidate.id,
      clipUpdates: [
        {
          trackId: selectedTrack.id,
          clipId: selectedClip.id,
          label: clipLabelDraft.trim() || selectedClip.label,
          startSeconds: numberDraft(startDraft, selectedClip.startSeconds),
          durationSeconds: Math.max(0.1, numberDraft(durationDraft, selectedClip.durationSeconds)),
          payloadJson: mergeCaptionPayload(parsedClipPayload, clipTextDraft.trim() || selectedClip.label, selectedClip.editableFields),
        },
      ],
    })
  }

  return (
    <div className="rugc-editor">
      <aside className="rugc-layer-list">
        <h3>Layers</h3>
        {workspace.finalEditor.tracks.map((track) => (
          <div key={track.id} className={cn("rugc-layer-row", selectedTrack?.id === track.id && "selected", !track.visible && "muted")}>
            <button
              type="button"
              className="rugc-layer-select"
              onClick={() => {
                setSelectedTrackId(track.id)
                setSelectedClipId(track.clips[0]?.id ?? "")
              }}
            >
              <span className={track.kind} />
              <strong>{track.label}</strong>
              <em>{track.clips.length} clips</em>
            </button>
            <button type="button" className={cn("rugc-layer-toggle", track.visible && "active")} onClick={() => patchTrack(track.id, { visible: !track.visible })}>
              {track.visible ? "Visible" : "Hidden"}
            </button>
            <button type="button" className={cn("rugc-layer-toggle", track.locked && "active")} onClick={() => patchTrack(track.id, { locked: !track.locked })}>
              {track.locked ? "Locked" : "Unlocked"}
            </button>
          </div>
        ))}
        <div className="mt-2 grid gap-2 border-t border-border/40 pt-3">
          <label className="grid gap-1 text-[10px] font-semibold uppercase text-muted-foreground">
            Candidate
            <select
              value={selectedCandidate?.id ?? ""}
              className="h-8 rounded-md border border-border bg-background px-2 text-xs normal-case text-foreground focus:outline-none focus:ring-1 focus:ring-primary shadow-sm"
              onChange={(event) => selectCandidate(event.currentTarget.value)}
            >
              {workspace.candidates.map((candidate) => (
                <option key={candidate.id} value={candidate.id}>{candidate.title}</option>
              ))}
            </select>
          </label>
        </div>
      </aside>
      <section className="rugc-editor-canvas">
        <div className="rugc-editor-toolbar">
          {["Select", "Crop", "Text", "Captions", "Audio", "JSON"].map((label) => <button key={label} type="button">{label}</button>)}
          <Button
            size="xs"
            variant="workbench"
            onClick={() => props.onMutateLocal("/api/ugc/exports", {
              selectedCandidateId: selectedCandidate?.id,
              label: `${selectedCandidate?.title ?? "Candidate"} draft export`,
              presetId: workspace.finalEditor.exportPresets[0]?.id,
              timelineJson: {
                timeline: workspace.finalEditor,
                pendingPatch: timelinePatchPreview,
              },
              notes: ["Created from Final Layer Editor", "Includes visible JSON diff preview as pendingPatch."],
            })}
          >
            Save export manifest
          </Button>
        </div>
        <div className="rugc-phone-row">
          {["Hook", "Product", "Proof", "CTA"].map((label, index) => (
            <article key={label} className={cn(index === 0 && "selected")}>
              <span>9:16</span>
              <strong>{label}</strong>
              <p>{index === 0 ? selectedCandidate?.preview.transcript[0]?.text : "Editable scene layer"}</p>
            </article>
          ))}
        </div>
        <div className="grid grid-cols-[minmax(0,1fr)_260px] overflow-hidden border-t border-border/40">
          <div className="rugc-editor-timeline">
            {workspace.finalEditor.tracks.map((track) => (
              <div key={track.id} className={cn("rugc-editor-track", !track.visible && "opacity-45")}>
                <span>{track.label}</span>
                <div>
                  {track.clips.map((clip) => (
                    <button
                      key={clip.id}
                      type="button"
                      className={cn("rugc-timeline-clip", selectedTrack?.id === track.id && selectedClip?.id === clip.id && "selected")}
                      style={{
                        left: `${Math.min(95, Math.max(0, (clip.startSeconds / workspace.finalEditor.durationSeconds) * 100))}%`,
                        width: `${Math.min(92, Math.max(10, (clip.durationSeconds / workspace.finalEditor.durationSeconds) * 100))}%`,
                      }}
                      onClick={() => {
                        setSelectedTrackId(track.id)
                        setSelectedClipId(clip.id)
                      }}
                    >
                      {clip.label}
                    </button>
                  ))}
                </div>
              </div>
            ))}
          </div>
          <aside className="grid gap-2 overflow-auto border-l border-border/40 bg-card p-3">
            <div>
              <strong className="text-xs">Clip edit</strong>
              <p className="m-0 mt-1 text-[11px] leading-4 text-muted-foreground">Timing and caption payload persist into the export manifest.</p>
            </div>
            <label className="grid gap-1 text-[10px] font-semibold uppercase text-muted-foreground">
              Clip label
              <Input value={clipLabelDraft} onChange={(event) => setClipLabelDraft(event.currentTarget.value)} />
            </label>
            <div className="grid grid-cols-2 gap-2">
              <label className="grid gap-1 text-[10px] font-semibold uppercase text-muted-foreground">
                Start
                <Input type="number" step="0.05" min="0" value={startDraft} onChange={(event) => setStartDraft(event.currentTarget.value)} />
              </label>
              <label className="grid gap-1 text-[10px] font-semibold uppercase text-muted-foreground">
                Duration
                <Input type="number" step="0.05" min="0.1" value={durationDraft} onChange={(event) => setDurationDraft(event.currentTarget.value)} />
              </label>
            </div>
            <label className="grid gap-1 text-[10px] font-semibold uppercase text-muted-foreground">
              Caption/Text payload
              <Textarea className="min-h-[74px]" value={clipTextDraft} onChange={(event) => setClipTextDraft(event.currentTarget.value)} />
            </label>
            <label className="grid gap-1 text-[10px] font-semibold uppercase text-muted-foreground">
              Caption payload JSON
              <Textarea className="min-h-[92px] font-mono text-[10px]" value={clipPayloadDraft} onChange={(event) => setClipPayloadDraft(event.currentTarget.value)} />
              <span className={cn("text-[10px] normal-case", parsedClipPayload ? "text-muted-foreground" : "text-amber-700")}>{parsedClipPayload ? "Valid JSON; text field is merged from caption draft." : "Invalid JSON; save falls back to caption text payload."}</span>
            </label>
            <Button size="xs" variant="selected" disabled={!selectedTrack || !selectedClip} onClick={saveSelectedClip}>
              Save clip edit
            </Button>
            <div className="min-h-0">
              <div className="mb-1 text-[10px] font-semibold uppercase text-muted-foreground">JSON diff preview</div>
              <pre className="rugc-json max-h-[138px]">{JSON.stringify(timelinePatchPreview, null, 2)}</pre>
            </div>
          </aside>
        </div>
      </section>
    </div>
  )
}

function clipTextFromPayload(clip: { readonly label: string; readonly payloadJson?: JsonValue } | undefined, candidate: CreativeCandidate | undefined): string {
  const payload = jsonRecord(clip?.payloadJson ?? null)
  if (typeof payload?.text === "string") return payload.text
  return candidate?.preview.transcript[0]?.text ?? clip?.label ?? ""
}

function numberDraft(value: string, fallback: number): number {
  const parsed = Number(value)
  return Number.isFinite(parsed) ? parsed : fallback
}

type ReferenceSourcePolicy = UgcReferenceArchive["sourcePolicy"]
type ReferenceArchiveStatus = UgcReferenceArchive["archiveStatus"]

function ReferenceArchiveView(props: {
  onMutateLocal: (path: string, body: object) => void
  onReferenceCatalog: (path: "/api/ugc/reference-catalog/plan" | "/api/ugc/reference-catalog/import", manifestPaths: readonly string[]) => void
}) {
  const { workspace, referenceArchives, researchTargets, templateMiningJobs } = useUgcLocalState()
  const [selectedReferenceId, setSelectedReferenceId] = React.useState(workspace.referenceProfiles[0]?.id ?? "")
  const [selectedResearchTargetId, setSelectedResearchTargetId] = React.useState(researchTargets[0]?.id ?? "")
  const [laneFilter, setLaneFilter] = React.useState<LaneFilter>("all")
  const visibleReferences = workspace.referenceProfiles.filter((reference) => laneFilter === "all" || productLaneForReference(reference) === laneFilter)
  const visibleResearchTargets = researchTargets.filter((target) => laneFilter === "all" || productLaneForResearchTarget(target) === laneFilter)
  const selectedReference = visibleReferences.find((reference) => reference.id === selectedReferenceId) ?? visibleReferences[0] ?? (laneFilter === "all" ? workspace.referenceProfiles[0] : undefined)
  const selectedResearchTarget = visibleResearchTargets.find((target) => target.id === selectedResearchTargetId) ?? visibleResearchTargets[0] ?? (laneFilter === "all" ? researchTargets[0] : undefined)
  const selectedLane = selectedReference ? productLaneForReference(selectedReference) : "ugc-ads"
  const selectedTemplateJobs = selectedResearchTarget ? templateMiningJobs.filter((job) => job.researchTargetId === selectedResearchTarget.id) : []
  const inspirationAssets = referenceArchives.flatMap((archive) => archive.referenceAssets)
  const persistedArchive = referenceArchives.find((archive) => archive.referenceProfileId === selectedReference?.id)
  const defaultArchive = selectedReference ? referenceProfileToArchive(workspace.id, selectedReference, workspace.updatedAt) : null
  const selectedArchive = persistedArchive ?? defaultArchive
  const [sourcePolicy, setSourcePolicy] = React.useState<ReferenceSourcePolicy>(selectedArchive?.sourcePolicy ?? "abstract-mechanics")
  const [archiveStatus, setArchiveStatus] = React.useState<ReferenceArchiveStatus>(selectedArchive?.archiveStatus ?? "sampled")
  const [mechanicsDraft, setMechanicsDraft] = React.useState(JSON.stringify(selectedArchive?.preservedMechanics ?? {}, null, 2))
  const [swappedDraft, setSwappedDraft] = React.useState((selectedArchive?.swappedFields ?? []).join("\n"))
  const [blockedDraft, setBlockedDraft] = React.useState((selectedArchive?.blockedFields ?? []).join("\n"))
  const [guardrailsDraft, setGuardrailsDraft] = React.useState((selectedArchive?.guardrails ?? []).join("\n"))
  const [notesDraft, setNotesDraft] = React.useState((selectedArchive?.notes ?? []).join("\n"))

  React.useEffect(() => {
    if (!visibleReferences.some((reference) => reference.id === selectedReferenceId)) {
      setSelectedReferenceId(visibleReferences[0]?.id ?? (laneFilter === "all" ? workspace.referenceProfiles[0]?.id ?? "" : ""))
    }
  }, [laneFilter, selectedReferenceId, visibleReferences, workspace.referenceProfiles])

  React.useEffect(() => {
    if (!visibleResearchTargets.some((target) => target.id === selectedResearchTargetId)) {
      setSelectedResearchTargetId(visibleResearchTargets[0]?.id ?? (laneFilter === "all" ? researchTargets[0]?.id ?? "" : ""))
    }
  }, [laneFilter, researchTargets, selectedResearchTargetId, visibleResearchTargets])

  React.useEffect(() => {
    setSourcePolicy(selectedArchive?.sourcePolicy ?? "abstract-mechanics")
    setArchiveStatus(selectedArchive?.archiveStatus ?? "sampled")
    setMechanicsDraft(JSON.stringify(selectedArchive?.preservedMechanics ?? {}, null, 2))
    setSwappedDraft((selectedArchive?.swappedFields ?? []).join("\n"))
    setBlockedDraft((selectedArchive?.blockedFields ?? []).join("\n"))
    setGuardrailsDraft((selectedArchive?.guardrails ?? []).join("\n"))
    setNotesDraft((selectedArchive?.notes ?? []).join("\n"))
  }, [selectedArchive?.id, selectedArchive?.updatedAt, selectedReference?.id])

  if (!selectedReference || !selectedArchive) {
    return (
      <div className="grid h-full min-h-0 grid-cols-[220px_minmax(0,1fr)] gap-3 overflow-hidden p-3">
        <PanelCard className="min-h-0 overflow-auto" density="compact">
          <PanelHeader
            eyebrow="Reference targets"
            title="Archive"
            actions={<StatusBadge tone="active">{referenceArchives.length}</StatusBadge>}
          />
          <div className="mb-3">
            <LaneFacet value={laneFilter} onChange={setLaneFilter} />
          </div>
          <p className="rounded-md border border-dashed border-border bg-background px-2.5 py-2 text-[10.5px] leading-4 text-muted-foreground">
            {workspace.referenceProfiles.length ? "No reference targets match this lane." : "Add a profile target before creating archive specs."}
          </p>
        </PanelCard>
        <PanelCard className="min-h-0 overflow-auto" density="compact">
          <PanelHeader title={workspace.referenceProfiles.length ? "No references in this lane" : "No reference profiles"} />
          <p className="text-xs leading-5 text-muted-foreground">{workspace.referenceProfiles.length ? "Import reference-only inspiration manifests or switch to All lanes." : "Add a profile target before creating archive specs."}</p>
          <InspirationManifestPanel
            assets={inspirationAssets}
            laneFilter={laneFilter}
            onReferenceCatalog={props.onReferenceCatalog}
          />
        </PanelCard>
      </div>
    )
  }

  const outputs = selectedArchive.candidateFormatOutputs
  const saveArchive = () => {
    props.onMutateLocal("/api/ugc/reference-archives", {
      referenceProfileId: selectedReference.id,
      sourcePolicy,
      archiveStatus,
      preservedMechanics: parseJson(mechanicsDraft),
      swappedFields: splitLines(swappedDraft),
      blockedFields: splitLines(blockedDraft),
      guardrails: splitLines(guardrailsDraft),
      candidateFormatOutputs: outputs,
      notes: splitLines(notesDraft),
    })
  }

  const planRemix = () => {
    props.onMutateLocal("/api/ugc/provider-jobs", {
      provider: "local",
      operation: "reference-remix-plan",
      mode: "dry-run",
      status: "planned",
      targetIds: [selectedReference.id, ...outputs.map((output) => output.id)],
      spendCapUsd: 0,
      estimatedCostUsd: 0,
      request: {
        referenceProfileId: selectedReference.id,
        sourcePolicy,
        archiveStatus,
        preservedMechanics: parseJson(mechanicsDraft),
        swappedFields: splitLines(swappedDraft),
        blockedFields: splitLines(blockedDraft),
        guardrails: splitLines(guardrailsDraft),
        candidateFormatOutputs: outputs,
        nextStep: "Generate synthetic persona/product/template remix candidates from abstract mechanics only.",
      },
    })
  }
  const queueResearchTarget = () => {
    props.onMutateLocal("/api/ugc/research-targets", {
      platform: selectedReference.platform === "internal-pack" ? "internal" : selectedReference.platform,
      niche: selectedReference.styleLane,
      query: `${selectedReference.styleLane} ${selectedReference.useCase} clean-room template mechanics`,
      sourcePolicy: "metadata-only",
      notes: [`Queued from ${selectedReference.displayName}; metadata and abstract mechanics only.`],
    })
  }
  const mineTemplate = () => {
    if (!selectedResearchTarget) return
    props.onMutateLocal("/api/ugc/template-mining-jobs", {
      researchTargetId: selectedResearchTarget.id,
      status: "planned",
      templateSpec: {
        schemaVersion: "ugc-studio.clean-room-template.v1",
        id: `template_${selectedResearchTarget.id}`,
        title: `${selectedResearchTarget.niche} template`,
        category: "format",
        preservedMechanics: {
          query: selectedResearchTarget.query,
          sourcePolicy: selectedResearchTarget.sourcePolicy,
          extractionGoal: "Preserve abstract timing, shot structure, caption grammar, and CTA mechanics.",
        },
        swapSlots: ["synthetic persona", "product", "hook", "caption", "voice", "CTA"],
        blockedFields: ["source face", "source voice", "exact captions", "source pixels", "brand marks"],
        proofNotes: ["Created from local queue. No live scraping performed."],
      },
    })
  }

  return (
    <div className="grid h-full min-h-0 grid-cols-[220px_minmax(0,1fr)] gap-3 overflow-hidden p-3">
      <PanelCard className="min-h-0 overflow-auto" density="compact">
        <PanelHeader
          eyebrow="Reference targets"
          title="Archive"
          actions={<StatusBadge tone="active">{referenceArchives.length}</StatusBadge>}
        />
        <div className="mb-3">
          <LaneFacet value={laneFilter} onChange={setLaneFilter} />
        </div>
        <div className="grid gap-2">
          {visibleReferences.map((reference) => {
            const archive = referenceArchives.find((item) => item.referenceProfileId === reference.id)
            return (
              <button
                key={reference.id}
                type="button"
                className={cn(
                  "grid gap-1 rounded-md border border-border bg-card px-2.5 py-2 text-left shadow-sm transition-colors hover:bg-accent",
                  selectedReference.id === reference.id && "border-primary/60 bg-primary/10",
                )}
                onClick={() => setSelectedReferenceId(reference.id)}
              >
                <span className="truncate text-xs font-semibold text-foreground">{reference.displayName}</span>
                <span className="truncate text-[11px] text-muted-foreground">{reference.platform} / {reference.handle}</span>
                <span className="flex items-center justify-between gap-2">
                  <ProductLaneBadge lane={productLaneForReference(reference)} />
                  <span className="truncate text-[10px] text-muted-foreground">{reference.styleLane}</span>
                </span>
                <span className="flex items-center justify-between gap-2 text-[10px] text-muted-foreground">
                  <span>{archive?.archiveStatus ?? reference.archiveStatus}</span>
                  <span>{archive?.sourcePolicy ?? sourcePolicyFor(reference)}</span>
                </span>
              </button>
            )
          })}
        </div>
        <div className="mt-3 border-t border-border pt-3">
          <div className="mb-2 flex items-center justify-between gap-2">
            <span className="text-[11px] font-semibold text-foreground">Research queue</span>
            <StatusBadge>{visibleResearchTargets.length}/{researchTargets.length}</StatusBadge>
          </div>
          <div className="grid gap-2">
            {visibleResearchTargets.slice(0, 4).map((target) => (
              <button
                key={target.id}
                type="button"
                className={cn(
                  "grid gap-1 rounded-md border border-border bg-background px-2.5 py-2 text-left hover:bg-accent",
                  selectedResearchTarget?.id === target.id && "border-primary/60 bg-primary/10",
                )}
                onClick={() => setSelectedResearchTargetId(target.id)}
              >
                <span className="truncate text-[11px] font-semibold text-foreground">{target.niche}</span>
                <span className="truncate text-[10px] text-muted-foreground">{target.platform} / {target.status}</span>
                <span className="flex items-center justify-between gap-2">
                  <ProductLaneBadge lane={productLaneForResearchTarget(target)} />
                  <span className="truncate text-[10px] text-muted-foreground">{target.sourcePolicy}</span>
                </span>
              </button>
            ))}
          </div>
          <Button className="mt-2 w-full" size="xs" variant="workbench" onClick={queueResearchTarget}>
            <Plus size={13} /> Queue current lane
          </Button>
        </div>
      </PanelCard>

      <PanelCard className="grid min-h-0 grid-rows-[auto_minmax(0,1fr)_auto] overflow-hidden" density="compact">
        <PanelHeader
          eyebrow={selectedReference.styleLane}
          title={selectedReference.displayName}
          actions={(
            <div className="flex items-center gap-1.5">
              <ProductLaneBadge lane={selectedLane} />
              <StatusBadge tone={sourcePolicy === "rights-cleared-source" ? "success" : "warning"}>{sourcePolicy}</StatusBadge>
            </div>
          )}
        />
        <div className="min-h-0 overflow-auto pr-1">
          <div className="grid grid-cols-2 gap-2">
            <label className="grid gap-1.5">
              <span className="text-[11px] font-medium text-muted-foreground">Source policy</span>
              <select
                value={sourcePolicy}
                className="h-8 rounded-md border border-input bg-background px-2 text-xs shadow-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                onChange={(event) => setSourcePolicy(event.target.value as ReferenceSourcePolicy)}
              >
                <option value="abstract-mechanics">abstract mechanics</option>
                <option value="metadata-only">metadata only</option>
                <option value="rights-cleared-source">rights-cleared source</option>
              </select>
            </label>
            <label className="grid gap-1.5">
              <span className="text-[11px] font-medium text-muted-foreground">Archive status</span>
              <select
                value={archiveStatus}
                className="h-8 rounded-md border border-input bg-background px-2 text-xs shadow-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                onChange={(event) => setArchiveStatus(event.target.value as ReferenceArchiveStatus)}
              >
                <option value="not-started">not started</option>
                <option value="queued">queued</option>
                <option value="sampled">sampled</option>
                <option value="decomposed">decomposed</option>
              </select>
            </label>
          </div>

          <div className="mt-3 grid grid-cols-4 gap-2">
            <MetricRow label="Lane" value={productLaneLabel(selectedLane)} />
            <MetricRow label="Rights" value={selectedReference.rightsStatus} />
            <MetricRow label="Samples" value={String(selectedReference.sampleClips.length)} />
            <MetricRow label="Outputs" value={String(outputs.length)} />
          </div>

          <div className="mt-3 grid gap-2">
            <label className="grid gap-1.5">
              <span className="text-[11px] font-medium text-muted-foreground">Preserved mechanics JSON</span>
              <Textarea
                value={mechanicsDraft}
                onChange={(event) => setMechanicsDraft(event.target.value)}
                className="min-h-36 font-mono text-[11px]"
                spellCheck={false}
              />
            </label>
            <div className="grid grid-cols-3 gap-2">
              <label className="grid gap-1.5">
                <span className="text-[11px] font-medium text-muted-foreground">Swap</span>
                <Textarea value={swappedDraft} onChange={(event) => setSwappedDraft(event.target.value)} className="min-h-24" />
              </label>
              <label className="grid gap-1.5">
                <span className="text-[11px] font-medium text-muted-foreground">Block</span>
                <Textarea value={blockedDraft} onChange={(event) => setBlockedDraft(event.target.value)} className="min-h-24" />
              </label>
              <label className="grid gap-1.5">
                <span className="text-[11px] font-medium text-muted-foreground">Guardrails</span>
                <Textarea value={guardrailsDraft} onChange={(event) => setGuardrailsDraft(event.target.value)} className="min-h-24" />
              </label>
            </div>
            <label className="grid gap-1.5">
              <span className="text-[11px] font-medium text-muted-foreground">Notes</span>
              <Textarea value={notesDraft} onChange={(event) => setNotesDraft(event.target.value)} className="min-h-20" placeholder="One note per line" />
            </label>
          </div>

          <div className="mt-3 grid gap-2 rounded-md border border-border bg-background p-3">
            <div className="flex items-center justify-between gap-2">
              <div>
                <p className="m-0 text-[11px] font-semibold text-foreground">Clean-room outputs</p>
                <p className="m-0 mt-0.5 text-[10px] text-muted-foreground">Derived local specs for format, pose, caption, hook, and CTA remixing.</p>
              </div>
              <Copy size={14} />
            </div>
            <div className="grid grid-cols-2 gap-2">
              {outputs.map((output) => <ReferenceFormatOutputCard key={output.id} output={output} />)}
            </div>
          </div>

          <div className="mt-3 grid gap-2 rounded-md border border-border bg-background p-3">
            <div className="flex items-center justify-between gap-2">
              <div>
                <p className="m-0 text-[11px] font-semibold text-foreground">Niche research and template mining</p>
                <p className="m-0 mt-0.5 text-[10px] text-muted-foreground">Local queue only. Use this to plan later niche/template research without scraping live sources.</p>
              </div>
              <Button size="xs" variant="workbench" disabled={!selectedResearchTarget} onClick={mineTemplate}>
                <Plus size={13} /> Mine template
              </Button>
            </div>
            {selectedResearchTarget ? (
              <div className="grid grid-cols-[minmax(0,1fr)_260px] gap-2">
                <div className="rounded-md border border-border bg-card p-2">
                  <div className="flex items-start justify-between gap-2">
                    <strong className="text-[11px] text-foreground">{selectedResearchTarget.niche}</strong>
                    <StatusBadge tone={selectedResearchTarget.status === "blocked" ? "danger" : selectedResearchTarget.status === "done" ? "success" : "active"}>{selectedResearchTarget.status}</StatusBadge>
                  </div>
                  <p className="mt-1 line-clamp-2 text-[11px] leading-4 text-muted-foreground">{selectedResearchTarget.query}</p>
                  <div className="mt-2 flex items-center justify-between text-[10px] text-muted-foreground">
                    <span>{selectedResearchTarget.sourcePolicy}</span>
                    <span>{selectedTemplateJobs.length} template jobs</span>
                  </div>
                </div>
                <div className="grid gap-1.5">
                  {selectedTemplateJobs.slice(0, 3).map((job) => (
                    <div key={job.id} className="rounded border border-border bg-card p-2">
                      <div className="flex items-center justify-between gap-2">
                        <span className="truncate text-[10px] font-semibold text-foreground">{job.templateSpec.title}</span>
                        <StatusBadge>{job.status}</StatusBadge>
                      </div>
                      <p className="m-0 mt-1 line-clamp-2 text-[10px] text-muted-foreground">{job.templateSpec.proofNotes.join(" ")}</p>
                    </div>
                  ))}
                </div>
              </div>
            ) : (
              <p className="m-0 text-[11px] text-muted-foreground">No local research targets queued.</p>
            )}
          </div>

          <InspirationManifestPanel
            assets={inspirationAssets}
            laneFilter={laneFilter}
            onReferenceCatalog={props.onReferenceCatalog}
          />

          <div className="mt-3 grid grid-cols-[minmax(0,1fr)_260px] gap-2">
            <div className="rounded-md border border-border bg-background p-3">
              <p className="m-0 text-[11px] font-semibold text-foreground">Sample clips</p>
              <div className="mt-2 grid gap-1.5">
                {selectedReference.sampleClips.map((clip) => (
                  <div key={clip.id} className="rounded border border-border bg-card p-2">
                    <strong className="block truncate text-[11px] text-foreground">{clip.title}</strong>
                    <span className="text-[10px] text-muted-foreground">{clip.durationSeconds}s / {clip.storagePolicy}</span>
                  </div>
                ))}
              </div>
            </div>
            <pre className="rugc-json m-0 max-h-48">{JSON.stringify({
              archiveId: selectedArchive.id,
              sampleClipIds: selectedArchive.sampleClipIds,
              outputs: selectedArchive.candidateFormatOutputs,
            }, null, 2)}</pre>
          </div>
        </div>

        <div className="mt-3 flex items-center justify-between gap-2 border-t border-border pt-3">
          <div className="flex items-center gap-2 text-[11px] text-muted-foreground">
            <FileJson size={13} />
            <span>{persistedArchive ? "Saved archive spec" : "Unsaved local spec"}</span>
          </div>
          <div className="flex items-center gap-2">
            {persistedArchive ? (
              <Button
                size="xs"
                variant="ghost"
                onClick={() => props.onMutateLocal(`/api/ugc/reference-archives/${persistedArchive.id}/delete`, {})}
              >
                Delete
              </Button>
            ) : null}
            <Button size="xs" variant="workbench" onClick={planRemix}><GitFork size={13} /> Plan remix</Button>
            <Button size="xs" onClick={saveArchive}><Download size={13} /> Save archive</Button>
          </div>
        </div>
      </PanelCard>
    </div>
  )
}

function InspirationManifestPanel(props: {
  assets: readonly UgcReferenceManifestAsset[]
  laneFilter: LaneFilter
  onReferenceCatalog: (path: "/api/ugc/reference-catalog/plan" | "/api/ugc/reference-catalog/import", manifestPaths: readonly string[]) => void
}) {
  const manifests = inspirationManifests.filter((manifest) => props.laneFilter === "all" || manifest.lane === props.laneFilter)
  return (
    <div className="mt-3 grid gap-2 rounded-md border border-amber-200 bg-amber-50/70 p-3">
      <div className="flex items-start justify-between gap-2">
        <div>
          <p className="m-0 text-[11px] font-semibold text-amber-900">Higgsfield / Arcads inspiration manifests</p>
          <p className="m-0 mt-0.5 text-[10px] leading-4 text-amber-800">
            Reference-only: study inspiration/mechanics/provenance only. Do not pass these assets as direct generation input unless a manifest explicitly marks them rights-cleared.
          </p>
        </div>
        <StatusBadge tone="warning">{props.assets.length} assets</StatusBadge>
      </div>
      <div className="grid gap-2">
        {manifests.map((manifest) => {
          const assets = props.assets.filter((asset) => asset.manifestPath === manifest.manifestPath || asset.manifestPath.endsWith(manifest.manifestPath))
          const unsafeInputs = assets.filter((asset) => asset.directGenerationInput)
          return (
            <div key={manifest.manifestPath} className="rounded-md border border-amber-200 bg-card p-2">
              <div className="flex items-start justify-between gap-2">
                <div className="min-w-0">
                  <div className="flex items-center gap-1.5">
                    <strong className="truncate text-[11px] text-foreground">{manifest.label}</strong>
                    <ProductLaneBadge lane={manifest.lane} />
                  </div>
                  <p className="m-0 mt-1 text-[10px] leading-4 text-muted-foreground">{manifest.summary}</p>
                  <p className="m-0 mt-1 truncate font-mono text-[10px] text-muted-foreground">{manifest.manifestPath}</p>
                </div>
                <StatusBadge tone={assets.length ? "success" : "neutral"}>{assets.length ? "imported" : "not imported"}</StatusBadge>
              </div>
              <div className="mt-2 grid grid-cols-3 gap-2">
                <MetricRow label="Assets" value={String(assets.length)} />
                <MetricRow label="Reference only" value={assets.length ? assets.every((asset) => asset.referenceOnly) ? "yes" : "mixed" : "pending"} />
                <MetricRow label="Gen input" value={unsafeInputs.length ? `${unsafeInputs.length} flagged` : "blocked"} />
              </div>
              {assets.length ? (
                <div className="mt-2 grid max-h-24 gap-1 overflow-auto">
                  {assets.slice(0, 4).map((asset) => (
                    <div key={asset.id} className="rounded border border-border/60 bg-background px-2 py-1 text-[10px] leading-4 text-muted-foreground">
                      <div className="flex items-center justify-between gap-2">
                        <span className="truncate font-semibold text-foreground">{asset.title}</span>
                        <span>{asset.sourcePolicy}</span>
                      </div>
                      <p className="m-0 truncate">{asset.provenance}</p>
                    </div>
                  ))}
                </div>
              ) : null}
              <div className="mt-2 flex items-center justify-end gap-2">
                <Button size="xs" variant="workbench" onClick={() => props.onReferenceCatalog("/api/ugc/reference-catalog/plan", [manifest.manifestPath])}>
                  Plan ingest
                </Button>
                <Button size="xs" variant="outline" onClick={() => props.onReferenceCatalog("/api/ugc/reference-catalog/import", [manifest.manifestPath])}>
                  Import reference-only
                </Button>
              </div>
            </div>
          )
        })}
      </div>
    </div>
  )
}

function ReferenceFormatOutputCard(props: { output: ReferenceArchiveFormatOutput }) {
  return (
    <div className="rounded-md border border-border bg-background p-2">
      <div className="flex items-start justify-between gap-2">
        <strong className="min-w-0 truncate text-[11px] text-foreground">{props.output.title}</strong>
        <StatusBadge>{props.output.kind}</StatusBadge>
      </div>
      <p className="mt-1 line-clamp-3 text-[11px] leading-4 text-muted-foreground">{props.output.summary}</p>
      <div className="mt-2 flex items-center justify-between gap-2 text-[10px] text-muted-foreground">
        <span>{props.output.stageIds.length} stages</span>
        <span>{props.output.candidateIds.length} candidates</span>
      </div>
    </div>
  )
}

function WorkflowTelemetryPanel(props: {
  demoCandidateId: string
  onImportWorkflowHandoff: (runId: string, payload: JsonValue, apply: boolean) => Promise<WorkflowImportRequestResult>
  onRefreshWorkspaceState: () => Promise<void>
}) {
  const telemetry = useWorkflowTelemetry(props.onRefreshWorkspaceState)
  const [selectedRunId, setSelectedRunId] = React.useState("")
  const [payloadText, setPayloadText] = React.useState("")
  const [importBusy, setImportBusy] = React.useState<"dry-run" | "apply" | null>(null)
  const [importRouteUnavailable, setImportRouteUnavailable] = React.useState(false)
  const [importPreview, setImportPreview] = React.useState<JsonValue | null>(null)
  const [importMessage, setImportMessage] = React.useState("Paste a handoff payload, dry-run it, then apply only after valid:true.")
  const [dryRunPayloadText, setDryRunPayloadText] = React.useState("")
  const [dryRunRunId, setDryRunRunId] = React.useState("")
  const [dryRunValid, setDryRunValid] = React.useState(false)
  const selectedRun = telemetry.runs.find((run) => run.id === selectedRunId) ?? telemetry.runs[0]
  const activeRuns = telemetry.runs.filter((run) => workflowStatusTone(run.status) === "active")
  const selectedAgents = selectedRun ? activeWorkflowAgents(selectedRun.events) : []
  const latestEvent = selectedRun?.events[0]
  const parsedPayload = payloadText.trim() ? parseJsonOrNull(payloadText) : null
  const payloadProblem = !payloadText.trim()
    ? "Paste a JSON handoff payload or load the safe sample."
    : parsedPayload
      ? null
      : "Payload is not valid JSON."
  const dryRunDisabled = Boolean(payloadProblem) || !selectedRun || importBusy !== null || importRouteUnavailable
  const dryRunHelp = importRouteUnavailable
    ? "Dry-run disabled because POST /api/ugc/workflows/:runId/import is unavailable."
    : !selectedRun
      ? "Select a workflow run before importing."
      : payloadProblem ?? "Dry-run validates the selected run import without mutating workspace records."
  const applyNeedsCurrentDryRun = !selectedRun || !dryRunValid || dryRunPayloadText !== payloadText || dryRunRunId !== selectedRun.id
  const applyDisabled = applyNeedsCurrentDryRun || importBusy !== null || importRouteUnavailable
  const applyHelp = importRouteUnavailable
    ? "Apply disabled because the import route is unavailable."
    : applyNeedsCurrentDryRun
      ? "Apply disabled until this exact payload dry-run returns valid:true for the selected run."
      : "Apply imports the validated handoff and refreshes workspace plus workflow telemetry."
  const demoPreview = telemetry.demoResult ?? {
    route: "/api/ugc/workflows/demo",
    nextClick: "Run both demos",
    lanes: ["brainrot", "ugc-ads", "all"],
    cleanRoom: true,
    liveProviders: false,
  }

  React.useEffect(() => {
    if (!selectedRunId || !telemetry.runs.some((run) => run.id === selectedRunId)) {
      setSelectedRunId(telemetry.runs[0]?.id ?? "")
    }
  }, [selectedRunId, telemetry.runs])

  function updatePayloadText(value: string) {
    setPayloadText(value)
    setDryRunValid(false)
    setDryRunPayloadText("")
    setDryRunRunId("")
    setImportMessage("Payload changed; dry-run again before apply.")
  }

  function loadSamplePayload() {
    updatePayloadText(JSON.stringify(sampleWorkflowImportPayload(props.demoCandidateId), null, 2))
    setImportPreview(null)
    setImportMessage(props.demoCandidateId
      ? "Loaded a metadata-only sample with a local planned provider job and note attachment."
      : "Loaded a metadata-only sample with a local planned provider job; no candidate note target is available.")
  }

  async function submitImport(apply: boolean) {
    if (!selectedRun || !parsedPayload) return
    const requestText = payloadText
    const runId = selectedRun.id
    setImportBusy(apply ? "apply" : "dry-run")
    setImportMessage(apply ? "Applying validated handoff import…" : "Dry-running handoff import…")
    try {
      const response = await props.onImportWorkflowHandoff(runId, parsedPayload, apply)
      const compact = compactWorkflowImportResult(response.payload)
      setImportPreview(compact)
      if (response.routeUnavailable) {
        setImportRouteUnavailable(true)
        setDryRunValid(false)
        setImportMessage(`Import route unavailable: POST /api/ugc/workflows/${runId}/import returned ${response.status || "network error"}.`)
        return
      }
      if (!response.ok) {
        if (!apply) setDryRunValid(false)
        setImportMessage(`Workflow import ${apply ? "apply" : "dry-run"} returned HTTP ${response.status}. Inspect the result JSON.`)
        return
      }
      if (apply) {
        await telemetry.refresh()
        setDryRunValid(false)
        setDryRunPayloadText("")
        setDryRunRunId("")
        setImportMessage(workflowImportDryRunValid(response.payload)
          ? "Import applied; workspace and workflow telemetry refresh requested."
          : "Apply returned OK but did not confirm valid:true; telemetry refresh requested for the selected run.")
        return
      }
      const valid = workflowImportDryRunValid(response.payload)
      setDryRunValid(valid)
      setDryRunPayloadText(requestText)
      setDryRunRunId(runId)
      await telemetry.refresh()
      setImportMessage(valid
        ? "Dry-run confirmed valid:true. Apply is enabled for this exact payload and run."
        : "Dry-run returned OK but did not confirm valid:true. Apply remains disabled.")
    } finally {
      setImportBusy(null)
    }
  }

  return (
    <div className="rugc-provider-note mt-3">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            <Bot size={15} className="text-muted-foreground" />
            <strong>Workflow telemetry</strong>
            <StatusBadge tone={telemetry.streamStatus === "live" ? "success" : telemetry.streamStatus === "unavailable" ? "danger" : "active"}>
              {telemetry.streamStatus}
            </StatusBadge>
          </div>
          <p className="mt-1">Event-sourced agent runs from Slotok workflows, dynamic-workflow adapters, and clean-room local planning lanes.</p>
        </div>
        <div className="flex flex-wrap items-center gap-1.5">
          <Button size="xs" variant="workbench" onClick={() => void telemetry.refresh()}>
            <RefreshCw size={13} /> Refresh
          </Button>
        </div>
      </div>

      <div className="mt-2 grid grid-cols-4 gap-2">
        <MetricRow label="Runs" value={String(telemetry.runs.length)} />
        <MetricRow label="Active" value={String(activeRuns.length)} />
        <MetricRow label="Brainrot" value={String(telemetry.runs.filter((run) => run.lane === "brainrot").length)} />
        <MetricRow label="UGC ads" value={String(telemetry.runs.filter((run) => run.lane === "ugc-ads").length)} />
      </div>

      <div className="mt-2 rounded-md border border-border bg-background p-2 text-[10px] leading-4 text-muted-foreground">
        <div className="flex items-start gap-2">
          {telemetry.streamStatus === "unavailable" ? <XCircle size={13} className="mt-0.5 text-red-700" /> : <Clock size={13} className="mt-0.5" />}
          <span>{telemetry.message}</span>
        </div>
      </div>

      <div className="mt-3 rounded-md border border-primary/30 bg-primary/5 p-2">
        <div className="flex flex-wrap items-start justify-between gap-2">
          <div className="min-w-0">
            <p className="text-[11px] font-semibold text-foreground">Deterministic local demo workflow launcher</p>
            <p className="mt-1 text-[10px] leading-4 text-muted-foreground">
              Start here: click <span className="font-semibold text-foreground">Run both demos</span> to trigger clean-room local planning runs, replay workflow events, and refresh workspace state. No live providers, no OMP RPC, no real background subagents.
            </p>
          </div>
          <StatusBadge tone="active">clean-room local</StatusBadge>
        </div>
        <div className="mt-2 flex flex-wrap gap-1.5">
          <Button size="xs" variant="outline" disabled={telemetry.demoRunningLane !== null} onClick={() => void telemetry.runDemoWorkflow("brainrot")}>
            <PlayCircle size={12} /> {telemetry.demoRunningLane === "brainrot" ? "Running brainrot…" : "Run brainrot demo"}
          </Button>
          <Button size="xs" variant="outline" disabled={telemetry.demoRunningLane !== null} onClick={() => void telemetry.runDemoWorkflow("ugc-ads")}>
            <PlayCircle size={12} /> {telemetry.demoRunningLane === "ugc-ads" ? "Running UGC ads…" : "Run UGC ads demo"}
          </Button>
          <Button size="xs" variant="selected" disabled={telemetry.demoRunningLane !== null} onClick={() => void telemetry.runDemoWorkflow("all")}>
            <Plus size={12} /> {telemetry.demoRunningLane === "all" ? "Running both…" : "Run both demos"}
          </Button>
        </div>
        <p className={cn("mt-2 text-[10px] leading-4", telemetry.demoRouteUnavailable ? "text-amber-700" : "text-muted-foreground")}>
          {telemetry.demoRouteUnavailable
            ? "Demo launcher route unavailable in this daemon build. The buttons stay visible so you can retry after the backend route lands."
            : "These buttons post to /api/ugc/workflows/demo and then refresh workflow telemetry plus /api/ugc/workspace."}
        </p>
        <pre className="rugc-json mt-2 max-h-32">{JSON.stringify(demoPreview, null, 2)}</pre>
      </div>

      <div className="mt-3 grid min-h-0 grid-cols-[minmax(0,1fr)_minmax(280px,0.9fr)] gap-3">
        <div className="grid max-h-[42rem] gap-2 overflow-auto pr-1">
          {telemetry.runs.length ? telemetry.runs.slice(0, 8).map((run) => {
            const runAgents = activeWorkflowAgents(run.events)
            return (
              <button
                key={run.id}
                type="button"
                className={cn(
                  "rounded-md border border-border bg-card p-2 text-left shadow-sm hover:bg-accent",
                  selectedRun?.id === run.id && "border-primary/60 bg-primary/10",
                )}
                onClick={() => setSelectedRunId(run.id)}
              >
                <div className="flex items-center justify-between gap-2">
                  <strong className="min-w-0 truncate text-[11px] text-foreground">{run.title}</strong>
                  <StatusBadge tone={workflowStatusTone(run.status)}>{run.status}</StatusBadge>
                </div>
                <div className="mt-1 flex items-center justify-between gap-2 text-[10px] text-muted-foreground">
                  <span className="truncate">{run.currentPhase}</span>
                  <ProductLaneBadge lane={run.lane} />
                </div>
                <div className="mt-1 grid gap-0.5 text-[10px] text-muted-foreground">
                  {runAgents.length ? runAgents.slice(0, 3).map((event) => (
                    <span key={workflowEventKey(event)} className="truncate">
                      {event.agent}: {event.message}
                    </span>
                  )) : (
                    <span className="truncate">{run.events[0]?.message ?? "No events replayed yet"}</span>
                  )}
                </div>
              </button>
            )
          }) : (
            <div className="grid min-h-32 place-items-center rounded-md border border-dashed border-border bg-background p-4 text-center">
              <div>
                <GitBranch className="mx-auto text-muted-foreground" size={22} />
                <p className="mt-2 text-[11px] font-semibold text-foreground">No workflow runs</p>
                <p className="mt-1 text-[10px] leading-4 text-muted-foreground">Click Run both demos above once the demo route exists, or use Refresh while waiting for telemetry routes to land.</p>
              </div>
            </div>
          )}
        </div>

        <div className="grid max-h-[42rem] gap-2 overflow-auto pr-1">
          {selectedRun ? (
            <>
              <div className="rounded-md border border-border bg-background p-2">
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0">
                    <strong className="block truncate text-[11px] text-foreground">{selectedRun.source}</strong>
                    <span className="block truncate text-[10px] text-muted-foreground">{selectedRun.id}</span>
                  </div>
                  <ProductLaneBadge lane={selectedRun.lane} />
                </div>
                <div className="mt-2 grid gap-1">
                  <MetricRow label="Status" value={selectedRun.status} />
                  <MetricRow label="Phase" value={selectedRun.currentPhase} />
                  <MetricRow label="Agents now" value={selectedAgents.length ? selectedAgents.map((event) => event.agent).filter(Boolean).join(", ") : latestEvent?.agent ?? "idle"} />
                  <MetricRow label="Artifacts" value={String(selectedRun.artifactPaths.length)} />
                </div>
              </div>

              <div className="grid grid-cols-3 gap-1">
                {selectedRun.counters.slice(0, 6).map((counter) => (
                  <div key={counter.label} className="rounded border border-border bg-card px-2 py-1">
                    <span className="block truncate text-[9px] uppercase tracking-[0.16em] text-muted-foreground">{counter.label}</span>
                    <strong className="text-[11px] text-foreground">{counter.value}</strong>
                  </div>
                ))}
              </div>

              <div className="rounded-md border border-border bg-background p-2">
                <p className="m-0 text-[11px] font-semibold text-foreground">Latest events</p>
                <div className="mt-2 grid gap-1.5">
                  {selectedRun.events.slice(0, 6).map((event) => (
                    <div key={workflowEventKey(event)} className="rounded border border-border bg-card p-2">
                      <div className="flex items-center justify-between gap-2">
                        <span className="rounded bg-primary/10 px-1.5 py-0.5 text-[9px] font-semibold text-primary">{event.type}</span>
                        <span className="truncate text-[9px] text-muted-foreground">{event.createdAt ?? event.phase ?? "event log"}</span>
                      </div>
                      <p className="mt-1 line-clamp-2 text-[10px] leading-4 text-muted-foreground">
                        {event.agent ? `${event.agent}: ` : ""}{event.message}
                      </p>
                    </div>
                  ))}
                  {selectedRun.events.length === 0 ? <span className="text-[10px] text-muted-foreground">No events replayed for this run yet.</span> : null}
                </div>
              </div>

              <div className="rounded-md border border-border bg-background p-2">
                <p className="m-0 text-[11px] font-semibold text-foreground">Artifacts</p>
                <div className="mt-1 grid gap-1 text-[10px] text-muted-foreground">
                  {selectedRun.artifactPaths.length ? selectedRun.artifactPaths.slice(0, 6).map((path) => (
                    <span key={path} className="truncate"><FileJson size={11} className="mr-1 inline" />{path}</span>
                  )) : <span>none yet</span>}
                </div>
              </div>

              <div className="rounded-md border border-border bg-background p-2">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <p className="m-0 text-[11px] font-semibold text-foreground">Import handoff payload</p>
                  <Button size="xs" variant="workbench" onClick={loadSamplePayload}>
                    <Copy size={12} /> Sample payload
                  </Button>
                </div>
                <div className="mt-2 rounded-md border border-amber-200 bg-amber-50/70 p-2 text-[10px] leading-4 text-amber-800">
                  Clean-room import only: use sourcePolicy metadata-only or abstract-mechanics unless rights-cleared proof exists. The sample records a local dry-run plan and note; it never calls a live provider.
                </div>
                <Textarea
                  className="mt-2 min-h-28 font-mono text-[10px]"
                  value={payloadText}
                  onChange={(event) => updatePayloadText(event.currentTarget.value)}
                  placeholder="{&quot;lane&quot;:&quot;ugc-ads&quot;,&quot;sourcePolicy&quot;:&quot;metadata-only&quot;,&quot;providerJobs&quot;:[...]}"
                />
                <div className="mt-2 grid grid-cols-2 gap-1">
                  <Button size="xs" variant="workbench" disabled={dryRunDisabled} onClick={() => void submitImport(false)}>
                    <CheckCircle2 size={12} /> {importBusy === "dry-run" ? "Dry-running…" : "Dry-run validate"}
                  </Button>
                  <Button size="xs" variant="selected" disabled={applyDisabled} onClick={() => void submitImport(true)}>
                    <PlayCircle size={12} /> {importBusy === "apply" ? "Applying…" : "Apply import"}
                  </Button>
                </div>
                <p className={cn("mt-2 text-[10px] leading-4", payloadProblem || applyDisabled ? "text-amber-700" : "text-muted-foreground")}>
                  {importMessage} {dryRunDisabled ? dryRunHelp : applyHelp}
                </p>
                <pre className="rugc-json mt-2 max-h-36">{JSON.stringify(importPreview ?? {
                  selectedRunId: selectedRun.id,
                  dryRunReady: !dryRunDisabled,
                  applyReady: !applyDisabled,
                }, null, 2)}</pre>
              </div>

              <pre className="rugc-json max-h-28">{selectedRun.errorPreview ? `error: ${selectedRun.errorPreview}` : selectedRun.resultPreview ? `result: ${selectedRun.resultPreview}` : JSON.stringify({ latestEvent: latestEvent?.message ?? null, raw: selectedRun.rawJson }, null, 2)}</pre>
            </>
          ) : (
            <div className="rounded-md border border-dashed border-border bg-background p-3 text-[11px] leading-4 text-muted-foreground">
              Select a workflow run to inspect event-derived phase, active agents, artifacts, result, and error previews.
            </div>
          )}
        </div>
      </div>
    </div>
  )
}

function DeveloperGraphView(props: {
  onMutateLocal: (path: string, body: object) => void
  workspaceBundle: UgcWorkspaceBundle | null
  bundleResult: JsonValue | null
  onExportWorkspaceBundle: (label: string) => void
  onImportWorkspaceBundle: (bundle: unknown, dryRun: boolean) => void
  onImportWorkflowHandoff: (runId: string, payload: JsonValue, apply: boolean) => Promise<WorkflowImportRequestResult>
  onRefreshWorkspaceState: () => Promise<void>
}) {
  const localState = useUgcLocalState()
  const { workspace, providerJobs, exportManifests, researchTargets, templateMiningJobs } = localState
  const derivedGraph = React.useMemo(() => deriveUgcDeveloperGraph(localState), [localState])
  const [selectedNodeId, setSelectedNodeId] = React.useState(derivedGraph.nodes[0]?.id ?? "")
  const [bundleImportText, setBundleImportText] = React.useState("")
  const selectedNode = derivedGraph.nodes.find((node) => node.id === selectedNodeId) ?? derivedGraph.nodes[0]
  const families: DerivedGraphFamily[] = ["brief", "persona", "reference", "branch", "candidate", "provider-job", "export", "research", "template"]
  const bundleImportPayload = bundleImportText.trim() ? parseJson(bundleImportText) : props.workspaceBundle

  React.useEffect(() => {
    if (!derivedGraph.nodes.some((node) => node.id === selectedNodeId)) {
      setSelectedNodeId(derivedGraph.nodes[0]?.id ?? "")
    }
  }, [derivedGraph.nodes, selectedNodeId])

  React.useEffect(() => {
    if (props.workspaceBundle) setBundleImportText(JSON.stringify(props.workspaceBundle, null, 2))
  }, [props.workspaceBundle])

  function importBundle(dryRun: boolean) {
    if (!bundleImportPayload) return
    props.onImportWorkspaceBundle(bundleImportPayload, dryRun)
  }

  return (
    <div className="rugc-provider rugc-dev-graph">
      <section>
        <Network size={32} />
        <h2>Local Workspace Graph</h2>
        <p>Derived from the current local JSON workspace: personas, references, candidates, branches, provider jobs, exports, research targets, and clean-room template jobs.</p>
        <div className="grid grid-cols-5 gap-2">
          <MetricRow label="Nodes" value={String(derivedGraph.nodes.length)} />
          <MetricRow label="Edges" value={String(derivedGraph.edges.length)} />
          <MetricRow label="Jobs" value={String(providerJobs.length)} />
          <MetricRow label="Exports" value={String(exportManifests.length)} />
          <MetricRow label="Research" value={String(researchTargets.length + templateMiningJobs.length)} />
        </div>
        <div className="mt-3 flex flex-wrap items-center gap-2 rounded-md border border-border bg-background p-2 text-[10px] font-semibold text-muted-foreground">
          <span className="text-foreground">Lane facet</span>
          <span className="rounded bg-primary/10 px-2 py-1 text-primary">UGC Studio ads</span>
          <span className="rounded border border-border bg-card px-2 py-1">Brainrot creation / Pleometric</span>
        </div>
        <WorkflowTelemetryPanel
          demoCandidateId={workspace.candidates[0]?.id ?? ""}
          onImportWorkflowHandoff={props.onImportWorkflowHandoff}
          onRefreshWorkspaceState={props.onRefreshWorkspaceState}
        />
        <div className="rugc-provider-note mt-3">
          <div className="flex items-center justify-between gap-2">
            <strong>Research and template proof queue</strong>
            <StatusBadge tone="active">{researchTargets.length + templateMiningJobs.length}</StatusBadge>
          </div>
          <div className="mt-2 grid grid-cols-2 gap-2">
            <div className="grid gap-2">
              {researchTargets.slice(0, 4).map((target) => (
                <div key={target.id} className="rounded border border-border bg-card p-2">
                  <div className="flex items-center justify-between gap-2">
                    <strong className="truncate text-[11px] text-foreground">{target.niche}</strong>
                    <StatusBadge tone={developerNodeTone(target.status)}>{target.status}</StatusBadge>
                  </div>
                  <p className="mt-1 line-clamp-2 text-[10px]">{target.query}</p>
                  <div className="mt-2 flex flex-wrap gap-1">
                    {(["queued", "sampling", "decomposed", "done", "blocked"] as const).map((status) => (
                      <Button key={status} size="xs" variant={target.status === status ? "selected" : "workbench"} onClick={() => props.onMutateLocal(`/api/ugc/research-targets/${target.id}`, { status })}>{status}</Button>
                    ))}
                  </div>
                </div>
              ))}
            </div>
            <div className="grid gap-2">
              {templateMiningJobs.slice(0, 4).map((job) => (
                <div key={job.id} className="rounded border border-border bg-card p-2">
                  <div className="flex items-center justify-between gap-2">
                    <strong className="truncate text-[11px] text-foreground">{job.templateSpec.title}</strong>
                    <StatusBadge tone={developerNodeTone(job.status)}>{job.status}</StatusBadge>
                  </div>
                  <div className="mt-1 grid gap-0.5 text-[10px] text-muted-foreground">
                    {job.templateSpec.proofNotes.slice(0, 3).map((note) => <span key={note} className="truncate">proof: {note}</span>)}
                    {job.error ? <span className="text-red-700">error: {job.error}</span> : null}
                  </div>
                  <div className="mt-2 flex flex-wrap gap-1">
                    {(["queued", "running", "ready", "done", "blocked"] as const).map((status) => (
                      <Button key={status} size="xs" variant={job.status === status ? "selected" : "workbench"} onClick={() => props.onMutateLocal(`/api/ugc/template-mining-jobs/${job.id}`, { status })}>{status}</Button>
                    ))}
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>
        <div className="mt-3 grid gap-3">
          {families.map((family) => {
            const nodes = derivedGraph.nodes.filter((node) => node.family === family)
            if (nodes.length === 0) return null
            return (
              <div key={family} className="rugc-provider-note">
                <div className="flex items-center justify-between gap-2">
                  <strong className="capitalize">{family.replace("-", " ")}</strong>
                  <StatusBadge>{nodes.length}</StatusBadge>
                </div>
                <div className="mt-2 grid grid-cols-2 gap-2">
                  {nodes.slice(0, 8).map((node) => (
                    <button
                      key={node.id}
                      type="button"
                      className={cn(
                        "rounded-md border border-border bg-card p-2 text-left shadow-sm hover:bg-accent",
                        selectedNode?.id === node.id && "border-primary/60 bg-primary/10",
                      )}
                      onClick={() => setSelectedNodeId(node.id)}
                    >
                      <div className="flex items-center justify-between gap-2">
                        <span className="truncate text-[11px] font-semibold text-foreground">{node.title}</span>
                        <StatusBadge tone={developerNodeTone(node.status)}>{node.status}</StatusBadge>
                      </div>
                      <p className="m-0 mt-1 line-clamp-2 text-[10px] leading-4 text-muted-foreground">{node.subtitle}</p>
                      <div className="mt-2 flex items-center justify-between text-[10px] text-muted-foreground">
                        <span>{node.inputs.length} in</span>
                        <span>{node.outputs.length} out</span>
                      </div>
                    </button>
                  ))}
                </div>
              </div>
            )
          })}
        </div>
        <div className="rugc-provider-note mt-3">
          <strong>Workspace bundle</strong>
          <p>Export the current local workspace, object shards, asset paths, provider jobs, archives, research queues, templates, and export manifests. Import defaults to validation dry-run; Apply writes only after a valid pasted or current bundle is chosen.</p>
          <div className="mt-2 flex flex-wrap items-center gap-2">
            <Button
              size="xs"
              variant="workbench"
              onClick={() => props.onExportWorkspaceBundle(`${workspace.title} developer export`)}
            >
              <Download size={13} /> Export bundle
            </Button>
            <Button size="xs" variant="ghost" disabled={!props.workspaceBundle} onClick={() => props.workspaceBundle && setBundleImportText(JSON.stringify(props.workspaceBundle, null, 2))}>
              Use current export
            </Button>
            <Button size="xs" variant="workbench" disabled={!bundleImportPayload} onClick={() => importBundle(true)}>Dry-run import</Button>
            <Button size="xs" variant="outline" disabled={!bundleImportPayload} onClick={() => importBundle(false)}>Apply import</Button>
          </div>
          <Textarea className="mt-2 min-h-32 font-mono text-[10px]" value={bundleImportText} onChange={(event) => setBundleImportText(event.currentTarget.value)} placeholder="Paste ugc-studio.workspace-bundle.v1 JSON here, or export and reuse current bundle." />
          <pre className="rugc-json mt-2 max-h-32">{JSON.stringify(props.bundleResult ?? { currentBundleId: props.workspaceBundle?.id ?? null, ready: Boolean(bundleImportPayload) })}</pre>
        </div>
      </section>
      <aside>
        {selectedNode ? (
          <>
            <div className="rugc-provider-note">
              <div className="flex items-center justify-between gap-2">
                <strong>{selectedNode.title}</strong>
                <StatusBadge tone={developerNodeTone(selectedNode.status)}>{selectedNode.family}</StatusBadge>
              </div>
              <p>{selectedNode.subtitle}</p>
              <MetricRow label="Status" value={selectedNode.status} />
              <MetricRow label="Inputs" value={String(selectedNode.inputs.length)} />
              <MetricRow label="Outputs" value={String(selectedNode.outputs.length)} />
              <MetricRow label="Artifacts" value={String(selectedNode.artifactPaths.length)} />
            </div>
            <div className="rugc-provider-note">
              <strong>Connected edges</strong>
              <div className="mt-2 grid gap-1.5">
                {derivedGraph.edges.filter((edge) => edge.fromId === selectedNode.id || edge.toId === selectedNode.id).slice(0, 10).map((edge) => (
                  <div key={edge.id} className="rounded border border-border bg-card p-2 text-[10px] text-muted-foreground">
                    <strong className="text-foreground">{edge.label}</strong>
                    <span className="block truncate">{edge.fromId} {"->"} {edge.toId}</span>
                  </div>
                ))}
              </div>
            </div>
            <pre>{JSON.stringify(selectedNode.rawJson, null, 2)}</pre>
          </>
        ) : (
          <div className="rugc-provider-note">
            <strong>No graph nodes</strong>
            <p>The local workspace has no derivable nodes.</p>
          </div>
        )}
      </aside>
    </div>
  )
}

function developerNodeTone(status: string): "success" | "danger" | "active" | "neutral" {
  if (["selected", "starred", "succeeded", "ready", "done", "rendered", "promising"].includes(status)) return "success"
  if (["failed", "blocked", "dead-end", "rejected"].includes(status)) return "danger"
  if (["queued", "running", "sampling", "active", "draft", "planned"].includes(status)) return "active"
  return "neutral"
}

function ProviderView(props: {
  operation: KieOperation
  capabilities: KieCapability[]
  selectedCapability: KieCapability | undefined
  result: string
  busy: boolean
  request: KieRequest
  onOperationChange: (operation: KieOperation) => void
  onCallKie: (path: string, body?: KieRequest) => void
  onMutateLocal: (path: string, body: object) => void
  onPlanAnalysisToKie: (body: AnalysisToKieInput) => void
}) {
  const { providerJobs, workspace } = useUgcLocalState()
  const [selectedJobId, setSelectedJobId] = React.useState(providerJobs[0]?.id ?? "")
  const [laneFilter, setLaneFilter] = React.useState<LaneFilter>("all")
  const visibleProviderJobs = providerJobs.filter((job) => laneFilter === "all" || productLaneForProviderJob(job, workspace) === laneFilter)
  const selectedJob = visibleProviderJobs.find((job) => job.id === selectedJobId) ?? visibleProviderJobs[0] ?? (laneFilter === "all" ? providerJobs[0] : undefined)
  const selectedLane = selectedJob ? productLaneForProviderJob(selectedJob, workspace) : "ugc-ads"
  const selectedTargetCandidate = selectedJob ? workspace.candidates.find((candidate) => selectedJob.targetIds.includes(candidate.id)) : undefined
  const selectedTargetReference = selectedJob ? workspace.referenceProfiles.find((reference) => selectedJob.targetIds.includes(reference.id)) : undefined
  const kieTaskId = extractKieTaskId(selectedJob?.response ?? null)
  const selectedCodexMedia = selectedJob?.provider === "codex" ? codexJobMediaSummary(selectedJob) : null
  const canPlanSelectedCodex = Boolean(selectedJob?.provider === "codex" && selectedCodexMedia && (selectedCodexMedia.mediaUrl || selectedCodexMedia.frameCount > 0 || selectedCodexMedia.artifactCount > 0))

  React.useEffect(() => {
    if (!visibleProviderJobs.some((job) => job.id === selectedJobId)) setSelectedJobId(visibleProviderJobs[0]?.id ?? (laneFilter === "all" ? providerJobs[0]?.id ?? "" : ""))
  }, [laneFilter, providerJobs, selectedJobId, visibleProviderJobs])

  return (
    <div className="grid h-full min-h-0 grid-cols-[minmax(0,1fr)_320px] gap-3 overflow-hidden p-3">
      <PanelCard className="grid min-h-0 grid-rows-[auto_minmax(0,1fr)] overflow-hidden" density="compact">
        <PanelHeader
          eyebrow="Local queue"
          title="Provider jobs"
          actions={<StatusBadge tone="active">{providerJobs.length}</StatusBadge>}
        />
        <div className="mb-3">
          <LaneFacet value={laneFilter} onChange={setLaneFilter} />
        </div>
        <div className="min-h-0 overflow-auto pr-1">
          {visibleProviderJobs.length === 0 ? (
            <div className="grid h-full min-h-52 place-items-center rounded-md border border-dashed border-border bg-background p-6 text-center">
              <div>
                <Braces className="mx-auto text-muted-foreground" size={26} />
                <p className="mt-2 text-xs font-semibold text-foreground">{providerJobs.length ? "No provider jobs in this lane" : "No provider jobs yet"}</p>
                <p className="mt-1 text-[11px] leading-4 text-muted-foreground">{providerJobs.length ? "Switch lanes or create a Codex/KIE dry-run job." : "Dry-run or live capped KIE calls create local job records."}</p>
              </div>
            </div>
          ) : (
            <div className="grid gap-2">
              {visibleProviderJobs.map((job) => (
                <button
                  key={job.id}
                  type="button"
                  className={cn(
                    "grid gap-1 rounded-md border border-border bg-card px-3 py-2 text-left shadow-sm transition-colors hover:bg-accent",
                    selectedJob?.id === job.id && "border-primary/60 bg-primary/10",
                  )}
                  onClick={() => setSelectedJobId(job.id)}
                >
                  <span className="flex items-center justify-between gap-2">
                    <strong className="min-w-0 truncate text-xs text-foreground">{job.operation}</strong>
                    <StatusBadge tone={providerJobStatusTone(job.status)}>{displayProviderJobStatus(job.status)}</StatusBadge>
                  </span>
                  <span className="text-[11px] text-muted-foreground">{job.provider} / {job.mode} / cap ${job.spendCapUsd.toFixed(2)}</span>
                  <span className="flex items-center justify-between gap-2">
                    <ProductLaneBadge lane={productLaneForProviderJob(job, workspace)} />
                    <span className="truncate text-[10px] text-muted-foreground">{job.updatedAt}</span>
                  </span>
                </button>
              ))}
            </div>
          )}
        </div>
      </PanelCard>

      <PanelCard className="grid min-h-0 grid-rows-[auto_auto_minmax(0,1fr)] overflow-hidden" density="compact">
        <PanelHeader eyebrow="KIE proxy" title="Route controls" actions={<CircleDollarSign size={14} />} />
        <label className="grid gap-1.5">
          <span className="text-[11px] font-medium text-muted-foreground">Operation</span>
          <select
            value={props.operation}
            className="h-8 rounded-md border border-input bg-background px-2 text-xs shadow-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            onChange={(event) => props.onOperationChange(event.target.value as KieOperation)}
          >
            {props.capabilities.map((capability) => (
              <option key={capability.operation} value={capability.operation}>
                {capability.operation} / {capability.model}
              </option>
            ))}
          </select>
        </label>
        <div className="rugc-provider-note">
          <strong>{props.selectedCapability?.label}</strong>
          <p>{props.selectedCapability?.notes}</p>
        </div>
        <div className="grid grid-cols-2 gap-2">
          <Button size="xs" onClick={() => props.onCallKie("/api/ugc/kie/plan", props.request)} disabled={props.busy}>Dry-run JSON</Button>
          <Button
            size="xs"
            variant="outline"
            onClick={() => props.onCallKie("/api/ugc/kie/create", { ...props.request, live: true, maxSpendUsd: 0.05 })}
            disabled={props.busy || (props.selectedCapability?.estimatedCostUsd ?? 1) > 0.05}
          >
            Live $0.05 cap
          </Button>
        </div>

        <div className="mt-3 min-h-0 overflow-auto pr-1">
          {selectedJob ? (
            <div className="grid gap-3">
              <div className="rounded-md border border-border bg-background p-3">
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0">
                    <p className="m-0 truncate text-xs font-semibold text-foreground">{selectedJob.operation}</p>
                    <p className="m-0 mt-0.5 text-[11px] text-muted-foreground">{selectedJob.id}</p>
                  </div>
                  <div className="flex items-center gap-1.5">
                    <ProductLaneBadge lane={selectedLane} />
                    <StatusBadge tone={providerJobStatusTone(selectedJob.status)}>{displayProviderJobStatus(selectedJob.status)}</StatusBadge>
                  </div>
                </div>
                <div className="mt-2 grid gap-1">
                  <MetricRow label="Provider" value={selectedJob.provider} />
                  <MetricRow label="Mode" value={selectedJob.mode} />
                  <MetricRow label="Lane" value={productLaneLabel(selectedLane)} />
                  <MetricRow label="Target" value={selectedTargetCandidate?.title ?? selectedTargetReference?.displayName ?? selectedJob.targetIds[0] ?? "n/a"} />
                  <MetricRow label="Estimate" value={selectedJob.estimatedCostUsd === null ? "n/a" : `$${selectedJob.estimatedCostUsd.toFixed(2)}`} />
                  <MetricRow label="Artifacts" value={String(selectedJob.artifactPaths.length)} />
                  <MetricRow label="KIE task" value={kieTaskId ?? "n/a"} />
                </div>
              </div>

              <div className="grid grid-cols-3 gap-1">
                {(["planned", "queued", "running", "succeeded", "completed", "blocked", "failed"] satisfies UgcProviderJobStatus[]).map((status) => (
                  <Button
                    key={status}
                    size="xs"
                    variant={selectedJob.status === status ? "selected" : "workbench"}
                    onClick={() => props.onMutateLocal(`/api/ugc/provider-jobs/${selectedJob.id}`, { status })}
                  >
                    {displayProviderJobStatus(status)}
                  </Button>
                ))}
              </div>

              {kieTaskId ? (
                <div className="rounded-md border border-border bg-background p-2">
                  <div className="flex items-center justify-between gap-2">
                    <span className="truncate font-mono text-[10px] text-muted-foreground">taskId: {kieTaskId}</span>
                    <Button size="xs" variant="workbench" onClick={() => props.onCallKie(`/api/ugc/kie/tasks/${kieTaskId}`)}>
                      <RefreshCw size={13} /> Poll KIE task
                    </Button>
                  </div>
                </div>
              ) : null}

              <div className="rounded-md border border-border bg-background p-2">
                <p className="m-0 text-[11px] font-semibold text-foreground">Artifact refs</p>
                <div className="mt-1 grid gap-1 text-[11px] text-muted-foreground">
                  {selectedJob.artifactPaths.length ? selectedJob.artifactPaths.map((path) => <span key={path} className="truncate">{path}</span>) : <span>none</span>}
                </div>
              </div>

              <div className="rounded-md border border-border bg-background p-2">
                <div className="flex items-start justify-between gap-2">
                  <div>
                    <p className="m-0 text-[11px] font-semibold text-foreground">Codex → KIE dry-run</p>
                    <p className="m-0 mt-0.5 text-[10px] leading-4 text-muted-foreground">
                      {selectedCodexMedia ? "Prepare a planned KIE job from this selected Codex analysis without live provider spend." : "Select a Codex analysis job with prepared media before planning KIE."}
                    </p>
                  </div>
                  <Button
                    size="xs"
                    variant="workbench"
                    disabled={props.busy || !canPlanSelectedCodex}
                    onClick={() => {
                      if (!selectedJob) return
                      props.onPlanAnalysisToKie({
                        analysisJobId: selectedJob.id,
                        lane: selectedLane,
                        operation: props.operation,
                        ...(selectedTargetCandidate ? { targetId: selectedTargetCandidate.id, targetKind: "candidate" as const } : selectedTargetReference ? { targetId: selectedTargetReference.id, targetKind: "reference" as const } : {}),
                      })
                    }}
                  >
                    <Zap size={13} /> Plan KIE
                  </Button>
                </div>
                {selectedCodexMedia ? (
                  <div className="mt-2 grid gap-1 text-[11px] text-muted-foreground">
                    <MetricRow label="Prepared" value={selectedCodexMedia.framePreparation ?? "n/a"} />
                    <MetricRow label="Frames" value={String(selectedCodexMedia.frameCount)} />
                    <MetricRow label="Media" value={selectedCodexMedia.mediaUrl ?? "n/a"} />
                    <CodexRefList label="Reference frames" values={selectedCodexMedia.referenceFrameUrls} />
                    <CodexRefList label="Frame artifact paths" values={selectedCodexMedia.artifactPaths} />
                  </div>
                ) : null}
              </div>

              <pre className="rugc-json">{JSON.stringify({
                request: selectedJob.request,
                response: selectedJob.response,
                error: selectedJob.error,
              }, null, 2)}</pre>
            </div>
          ) : providerJobs.length ? (
            <div className="rounded-md border border-dashed border-border bg-background p-3 text-[11px] leading-4 text-muted-foreground">
              No provider job matches the selected lane. Switch to All lanes or create a Codex/KIE dry-run for this lane.
            </div>
          ) : (
            <pre className="rugc-json">{props.result}</pre>
          )}
        </div>
      </PanelCard>
    </div>
  )
}

function Inspector(props: {
  activeView: ReactView
  selectedPersona: PersonaCardModel | undefined
  selectedCandidate: CreativeCandidate | undefined
  selectedBranch: BranchSnapshot | undefined
  selectedCapability: KieCapability | undefined
  result: string
  busy: boolean
  onMutateLocal: (path: string, body: object) => void
  onPlanAnalysisToKie: (body: AnalysisToKieInput) => void
  workspaceBundle: UgcWorkspaceBundle | null
  bundleResult: JsonValue | null
  onExportWorkspaceBundle: (label: string) => void
  onImportWorkspaceBundle: (bundle: unknown, dryRun: boolean) => void
}) {
  const { workspace, providerJobs, exportManifests, referenceArchives } = useUgcLocalState()
  const selectedFullPersona = workspace.personas.find((persona) => persona.id === props.selectedPersona?.id)
  const [personaDraft, setPersonaDraft] = React.useState({
    niche: selectedFullPersona?.profileBible.niche ?? "",
    speakingStyle: selectedFullPersona?.voice.speakingStyle ?? "",
    accent: selectedFullPersona?.voice.accent ?? "",
    energy: String(selectedFullPersona?.voice.energy ?? 60),
  })
  const [branchDecisionDraft, setBranchDecisionDraft] = React.useState(props.selectedBranch?.decisionNote ?? "")
  const [reviewNoteDraft, setReviewNoteDraft] = React.useState("Needs a more casual middle beat and softer CTA.")
  const [bundleImportText, setBundleImportText] = React.useState("")
  const inspectorBundlePayload = bundleImportText.trim() ? parseJson(bundleImportText) : props.workspaceBundle

  React.useEffect(() => {
    setPersonaDraft({
      niche: selectedFullPersona?.profileBible.niche ?? "",
      speakingStyle: selectedFullPersona?.voice.speakingStyle ?? "",
      accent: selectedFullPersona?.voice.accent ?? "",
      energy: String(selectedFullPersona?.voice.energy ?? 60),
    })
  }, [selectedFullPersona?.id, selectedFullPersona?.profileBible.niche, selectedFullPersona?.voice.accent, selectedFullPersona?.voice.energy, selectedFullPersona?.voice.speakingStyle])

  React.useEffect(() => {
    setBranchDecisionDraft(props.selectedBranch?.decisionNote ?? "")
  }, [props.selectedBranch?.decisionNote, props.selectedBranch?.id])

  React.useEffect(() => {
    if (props.workspaceBundle) setBundleImportText(JSON.stringify(props.workspaceBundle, null, 2))
  }, [props.workspaceBundle])

  function importInspectorBundle(dryRun: boolean) {
    if (!inspectorBundlePayload) return
    props.onImportWorkspaceBundle(inspectorBundlePayload, dryRun)
  }

  if (props.activeView === "graph") {
    return (
      <InspectorFrame>
        <InspectorHeader title="Developer Graph" />
        <InspectorCard title="Workspace bundle">
          <MetricRow label="Current export" value={props.workspaceBundle?.id ?? "none"} />
          <MetricRow label="Objects" value={props.workspaceBundle ? String(Object.values(props.workspaceBundle.objectCounts).reduce((sum, count) => sum + count, 0)) : "n/a"} />
          <div className="grid grid-cols-2 gap-1.5">
            <Button size="xs" variant="workbench" disabled={props.busy} onClick={() => props.onExportWorkspaceBundle(`${workspace.title} inspector export`)}>Export</Button>
            <Button size="xs" variant="ghost" disabled={!props.workspaceBundle} onClick={() => props.workspaceBundle && setBundleImportText(JSON.stringify(props.workspaceBundle, null, 2))}>Use current</Button>
            <Button size="xs" variant="workbench" disabled={!inspectorBundlePayload || props.busy} onClick={() => importInspectorBundle(true)}>Dry-run</Button>
            <Button size="xs" variant="outline" disabled={!inspectorBundlePayload || props.busy} onClick={() => importInspectorBundle(false)}>Apply</Button>
          </div>
          <Textarea className="min-h-28 font-mono text-[10px]" value={bundleImportText} onChange={(event) => setBundleImportText(event.currentTarget.value)} placeholder="Paste workspace bundle JSON, or export/use current bundle." />
        </InspectorCard>
        <InspectorCard title="Validation result">
          <pre className="rugc-json">{JSON.stringify(props.bundleResult ?? { ready: Boolean(inspectorBundlePayload), currentBundleId: props.workspaceBundle?.id ?? null })}</pre>
        </InspectorCard>
        <InspectorCard title="Graph scope">
          <MetricRow label="Personas" value={String(workspace.personas.length)} />
          <MetricRow label="Candidates" value={String(workspace.candidates.length)} />
          <MetricRow label="Provider jobs" value={String(providerJobs.length)} />
          <MetricRow label="Exports" value={String(exportManifests.length)} />
        </InspectorCard>
      </InspectorFrame>
    )
  }

  if (props.activeView === "provider") {
    return (
      <InspectorFrame>
        <InspectorHeader title="KIE Provider" />
        <InspectorCard title="Route policy">
          <MetricRow label="Default" value="dry-run" />
          <MetricRow label="Live cap" value="$0.05" />
          <MetricRow label="Model" value={props.selectedCapability?.model ?? "kie"} />
          <MetricRow label="Saved jobs" value={String(providerJobs.length)} />
        </InspectorCard>
        <InspectorCard title="Last response">
          <pre className="rugc-json">{props.result}</pre>
        </InspectorCard>
      </InspectorFrame>
    )
  }

  if (props.activeView === "campaign") {
    return (
      <InspectorFrame>
        <InspectorHeader title={props.selectedBranch?.title ?? "Snapshot"} />
        <InspectorCard title="Details">
          <MetricRow label="Stage" value={props.selectedBranch?.focus ?? "Branch"} />
          <MetricRow label="Variants" value={String(props.selectedBranch?.selectedCandidateIds.length ?? 0)} />
          <MetricRow label="Parent" value={props.selectedBranch?.parentId ?? "root"} />
          <MetricRow label="Children" value={String(props.selectedBranch?.childIds.length ?? 0)} />
        </InspectorCard>
        <InspectorCard title="Decision">
          <Textarea
            value={branchDecisionDraft}
            onChange={(event) => setBranchDecisionDraft(event.target.value)}
            className="min-h-24"
          />
          <Button
            size="xs"
            variant="workbench"
            disabled={props.busy || !props.selectedBranch}
            onClick={() => {
              if (!props.selectedBranch) return
              props.onMutateLocal(`/api/ugc/branches/${props.selectedBranch.id}`, {
                status: props.selectedBranch.status,
                decisionNote: branchDecisionDraft,
              })
            }}
          >
            Save branch note
          </Button>
          <div className="grid grid-cols-2 gap-2">
            <Button
              size="xs"
              variant="workbench"
              disabled={props.busy || !props.selectedBranch}
              onClick={() => {
                if (!props.selectedBranch) return
                props.onMutateLocal("/api/ugc/branches", {
                  parentId: props.selectedBranch.id,
                  title: `${props.selectedBranch.title} fork`,
                  focus: branchDecisionDraft || props.selectedBranch.focus,
                  selectedPersonaIds: props.selectedBranch.selectedPersonaIds,
                  selectedCandidateIds: props.selectedBranch.selectedCandidateIds,
                  candidateBatchIds: props.selectedBranch.candidateBatchIds,
                  decisionNote: "Forked from campaign inspector.",
                })
              }}
            >
              Fork branch
            </Button>
            <Button
              size="xs"
              variant="workbench"
              disabled={props.busy || !props.selectedBranch}
              onClick={() => {
                if (!props.selectedBranch) return
                props.onMutateLocal(`/api/ugc/branches/${props.selectedBranch.id}`, {
                  status: "promising",
                  decisionNote: branchDecisionDraft || "Marked promising from campaign inspector.",
                })
              }}
            >
              Mark promising
            </Button>
            <Button
              size="xs"
              variant="outline"
              disabled={props.busy || !props.selectedBranch}
              onClick={() => {
                if (!props.selectedBranch) return
                props.onMutateLocal(`/api/ugc/branches/${props.selectedBranch.id}`, {
                  status: "active",
                  decisionNote: branchDecisionDraft || "Rolled back to this branch as the active exploration path.",
                })
              }}
            >
              Set active
            </Button>
          </div>
        </InspectorCard>
        <InspectorCard title="Metrics">
          <ScoreBar label="CTR" value={82} />
          <ScoreBar label="CVR" value={64} />
          <ScoreBar label="Hook hold" value={78} />
        </InspectorCard>
        <InspectorCard title="Decision log">
          <div className="grid gap-2">
            {workspace.branchSnapshots.slice(0, 5).map((branch) => (
              <div key={branch.id} className="rounded-md border border-border bg-background p-2 text-[11px] leading-4">
                <div className="flex items-center justify-between gap-2">
                  <strong className="truncate text-foreground">{branch.title}</strong>
                  <StatusBadge tone={branch.status === "active" ? "active" : branch.status === "promising" ? "success" : branch.status === "dead-end" ? "danger" : "neutral"}>{branch.status}</StatusBadge>
                </div>
                <p className="m-0 mt-1 text-muted-foreground">{branch.decisionNote}</p>
              </div>
            ))}
          </div>
        </InspectorCard>
        <button
          type="button"
          className="rounded-md border border-red-200 bg-red-50 px-3 py-2 text-left text-xs font-medium text-red-700"
          disabled={props.busy || !props.selectedBranch}
          onClick={() => {
            if (!props.selectedBranch) return
            props.onMutateLocal(`/api/ugc/branches/${props.selectedBranch.id}`, {
              status: "dead-end",
              decisionNote: "Marked as a dead end from the campaign inspector; return to the parent and fork a softer direction.",
            })
          }}
        >
          Mark as dead end
        </button>
      </InspectorFrame>
    )
  }

  if (props.activeView === "reference") {
    return (
      <InspectorFrame>
        <InspectorHeader title="Reference Archive" />
        <InspectorCard title="Archive counts">
          <MetricRow label="Profiles" value={String(workspace.referenceProfiles.length)} />
          <MetricRow label="Saved archives" value={String(referenceArchives.length)} />
          <MetricRow label="Guardrail" value="abstract mechanics first" />
        </InspectorCard>
        <InspectorCard title="Latest archive">
          <pre className="rugc-json">{JSON.stringify(referenceArchives[0] ?? {}, null, 2)}</pre>
        </InspectorCard>
      </InspectorFrame>
    )
  }

  if (props.activeView === "editor") {
    return (
      <InspectorFrame>
        <InspectorHeader title="Export Manifests" />
        <InspectorCard title="Final editor">
          <MetricRow label="Tracks" value={String(workspace.finalEditor.tracks.length)} />
          <MetricRow label="Duration" value={`${workspace.finalEditor.durationSeconds}s`} />
          <MetricRow label="Exports" value={String(exportManifests.length)} />
        </InspectorCard>
        <InspectorCard title="Latest export">
          <pre className="rugc-json">{JSON.stringify(exportManifests[0] ?? {}, null, 2)}</pre>
        </InspectorCard>
      </InspectorFrame>
    )
  }
  if (props.activeView === "review") {
    const candidateNotes = props.selectedCandidate
      ? workspace.reviewNotes.filter(
          (note) =>
            props.selectedCandidate!.reviewNoteIds.includes(note.id) ||
            (note.attachedTo.kind === "candidate" && note.attachedTo.id === props.selectedCandidate!.id)
        )
      : []

    const addReviewNoteLocal = (verdict: "keep" | "fork" | "revise" | "reject") => {
      if (!props.selectedCandidate) return
      props.onMutateLocal("/api/ugc/notes", {
        attachedTo: { kind: "candidate", id: props.selectedCandidate.id },
        verdict,
        body: reviewNoteDraft,
        requestedChange: "Regenerate selected direction with a softer CTA.",
      })
    }

    const applyStatusLocal = (status: "queued" | "generating" | "ready" | "starred" | "rejected" | "needs-revision" | "exported") => {
      if (!props.selectedCandidate) return
      props.onMutateLocal("/api/ugc/candidates/status", { candidateIds: [props.selectedCandidate.id], status })
    }

    return (
      <InspectorFrame>
        <InspectorHeader title={props.selectedCandidate ? props.selectedCandidate.title : "Candidate details"} />
        <InspectorCard title="Scorecard">
          <div className="grid gap-1 py-1">
            <ScoreBar label="Hook Strength" value={props.selectedCandidate?.scorecard.hookStrength ?? 0} />
            <ScoreBar label="Persona Fit" value={props.selectedCandidate?.scorecard.personaFit ?? 0} />
            <ScoreBar label="CTA Pressure" value={props.selectedCandidate?.scorecard.conversionPotential ?? 0} warning />
            <ScoreBar label="Authenticity" value={props.selectedCandidate?.scorecard.formatFit ?? 0} />
            <ScoreBar label="Predicted Retention" value={props.selectedCandidate?.scorecard.overall ?? 0} />
          </div>
          {props.selectedCandidate?.scorecard.overall && props.selectedCandidate.scorecard.overall < 75 && (
            <blockquote className="m-0 mt-2 border-l-2 border-amber-300 pl-2 text-[11px] italic text-muted-foreground leading-normal">
              She feels slightly scripted in the middle. CTA could be softer.
            </blockquote>
          )}
        </InspectorCard>

        <CodexAnalysisSection
          candidate={props.selectedCandidate}
          providerJobs={providerJobs}
          busy={props.busy}
          onMutateLocal={props.onMutateLocal}
          onPlanAnalysisToKie={props.onPlanAnalysisToKie}
        />

        <InspectorCard title="Review decision">
          <Textarea
            value={reviewNoteDraft}
            onChange={(event) => setReviewNoteDraft(event.target.value)}
            className="min-h-16 text-[11px] p-2 leading-relaxed bg-white border border-border rounded"
            placeholder="Review notes draft..."
          />
          <div className="grid grid-cols-2 gap-1.5 mt-2">
            <Button size="xs" variant="workbench" className="w-full text-[10.5px] py-1" onClick={() => applyStatusLocal("starred")}>Star</Button>
            <Button size="xs" variant="workbench" className="w-full text-[10.5px] py-1" onClick={() => applyStatusLocal("needs-revision")}>Revise</Button>
            <Button size="xs" variant="outline" className="w-full text-[10.5px] py-1" onClick={() => applyStatusLocal("rejected")}>Reject</Button>
            <Button size="xs" variant="subtle" className="w-full text-[10.5px] py-1" onClick={() => addReviewNoteLocal("revise")}>Add note</Button>
          </div>
        </InspectorCard>

        <InspectorCard title="Recent Notes">
          <div className="grid gap-1.5">
            {candidateNotes.length ? candidateNotes.map((note) => (
              <div key={note.id} className="rounded border border-border/60 bg-white p-2 text-[10.5px] leading-relaxed text-muted-foreground shadow-[0_1px_1px_rgba(0,0,0,0.01)]">
                <span className="font-semibold text-foreground uppercase text-[9px] tracking-wider">{note.verdict}</span> — {note.body}
              </div>
            )) : <p className="m-0 text-[10.5px] text-muted-foreground font-medium italic">No notes recorded yet.</p>}
          </div>
        </InspectorCard>

        <InspectorCard title="Continuity JSON">
          <pre className="rugc-json text-[10px] leading-relaxed max-h-[120px] overflow-auto border-none p-0 bg-transparent">{JSON.stringify({
            persona: props.selectedPersona?.id,
            stable: ["voice", "niche", "posting cadence"],
            selectedCandidate: props.selectedCandidate?.id,
          }, null, 2)}</pre>
        </InspectorCard>
      </InspectorFrame>
    )
  }

  return (
    <InspectorFrame>
      <InspectorHeader title="Inspector" />
      <InspectorCard title="Product brief">
        <p className="font-medium text-foreground text-[11px] mb-2">{workspace.productBrief.productName} / {workspace.productBrief.offer}</p>
        <div className="grid gap-1.5">
          <ScoreBar label="CTA posts" value={workspace.productBrief.campaignMix.ctaPostsPercent} />
          <ScoreBar label="Profile posts" value={workspace.productBrief.campaignMix.personaBuildingPostsPercent} />
        </div>
      </InspectorCard>
      <InspectorCard title="Selected persona">
        <MetricRow label="Name" value={props.selectedPersona?.name ?? "None"} />
        <MetricRow label="Lane" value={props.selectedPersona?.archetype ?? "None"} />
        <div className="grid gap-2 mt-2 pt-2 border-t border-border/40">
          <label className="grid gap-1 text-[10px] font-medium text-muted-foreground uppercase">
            Niche
            <Input value={personaDraft.niche} onChange={(event) => setPersonaDraft((draft) => ({ ...draft, niche: event.target.value }))} className="h-7 text-xs px-2" />
          </label>
          <label className="grid gap-1 text-[10px] font-medium text-muted-foreground uppercase">
            Voice style
            <Input value={personaDraft.speakingStyle} onChange={(event) => setPersonaDraft((draft) => ({ ...draft, speakingStyle: event.target.value }))} className="h-7 text-xs px-2" />
          </label>
          <label className="grid gap-1 text-[10px] font-medium text-muted-foreground uppercase">
            Accent
            <Input value={personaDraft.accent} onChange={(event) => setPersonaDraft((draft) => ({ ...draft, accent: event.target.value }))} className="h-7 text-xs px-2" />
          </label>
          <label className="grid gap-1 text-[10px] font-medium text-muted-foreground uppercase">
            Energy
            <Input
              type="number"
              min={0}
              max={100}
              value={personaDraft.energy}
              onChange={(event) => setPersonaDraft((draft) => ({ ...draft, energy: event.target.value }))}
              className="h-7 text-xs px-2"
            />
          </label>
          <Button
            size="xs"
            variant="workbench"
            disabled={props.busy || !props.selectedPersona}
            onClick={() => {
              if (!props.selectedPersona) return
              props.onMutateLocal(`/api/ugc/personas/${props.selectedPersona.id}`, {
                status: "selected",
                profileBible: { niche: personaDraft.niche },
                voice: {
                  accent: personaDraft.accent,
                  speakingStyle: personaDraft.speakingStyle,
                  energy: Number(personaDraft.energy),
                },
              })
            }}
            className="w-full mt-1 text-[11px] py-1"
          >
            Save profile bible
          </Button>
        </div>
      </InspectorCard>
      <InspectorCard title="Selected candidate">
        <p className="text-muted-foreground text-[11px] leading-relaxed mb-3 italic">"{props.selectedCandidate?.preview.transcript[0]?.text ?? "No candidate selected."}"</p>
        <div className="grid gap-1.5 mb-3">
          <ScoreBar label="Overall" value={props.selectedCandidate?.scorecard.overall ?? 0} />
          <ScoreBar label="Persona fit" value={props.selectedCandidate?.scorecard.personaFit ?? 0} />
          <ScoreBar label="Conversion" value={props.selectedCandidate?.scorecard.conversionPotential ?? 0} warning />
        </div>
        <Button
          size="xs"
          variant="workbench"
          disabled={props.busy || !props.selectedCandidate}
          onClick={() => {
            if (!props.selectedCandidate) return
            props.onMutateLocal(`/api/ugc/candidates/${props.selectedCandidate.id}/status`, { status: "starred" })
          }}
          className="w-full text-[11px] py-1"
        >
          Star candidate
        </Button>
      </InspectorCard>
      <CodexAnalysisSection
        candidate={props.selectedCandidate}
        providerJobs={providerJobs}
        busy={props.busy}
        onMutateLocal={props.onMutateLocal}
        onPlanAnalysisToKie={props.onPlanAnalysisToKie}
      />
      <InspectorCard title="Continuity JSON">
        <pre className="rugc-json text-[10px] leading-relaxed border-none p-0 bg-transparent">{JSON.stringify({
          persona: props.selectedPersona?.id,
          stable: ["voice", "niche", "posting cadence"],
          selectedCandidate: props.selectedCandidate?.id,
        }, null, 2)}</pre>
      </InspectorCard>
    </InspectorFrame>
  )
}

function CodexAnalysisSection(props: {
  candidate: CreativeCandidate | undefined
  providerJobs: readonly UgcProviderJob[]
  busy: boolean
  onMutateLocal: (path: string, body: object) => void
  onPlanAnalysisToKie: (body: AnalysisToKieInput) => void
}) {
  const candidateId = props.candidate?.id ?? ""
  const jobs = candidateId
    ? props.providerJobs.filter((job) => job.provider === "codex" && job.targetIds.includes(candidateId))
    : []
  const hasPreviewVideo = Boolean(props.candidate?.preview.videoUrl)
  const mediaLabel = props.candidate
    ? hasPreviewVideo
      ? props.candidate.preview.posterUrl ? "video + poster" : "video only"
      : "missing video"
    : "no candidate"
  const candidateLane = productLaneForCandidate(props.candidate)

  return (
    <InspectorCard title="Codex analysis">
      <div className="flex items-center justify-between gap-2">
        <div className="min-w-0">
          <p className="m-0 text-[11px] font-medium text-foreground">Local video-understand jobs</p>
          <p className="m-0 mt-0.5 text-[10px] text-muted-foreground">{mediaLabel} / dry-run default</p>
          <div className="mt-1">
            <ProductLaneBadge lane={candidateLane} />
          </div>
        </div>
        <Button
          type="button"
          size="xs"
          variant="workbench"
          disabled={props.busy || !props.candidate || !hasPreviewVideo}
          onClick={() => {
            if (!props.candidate || !props.candidate.preview.videoUrl) return
            props.onMutateLocal(`/api/ugc/codex/candidates/${encodeURIComponent(props.candidate.id)}/analyze-video`, {
              live: false,
              prompt: "Analyze the selected candidate video from prepared local frames.",
            })
          }}
          className="shrink-0 text-[10.5px]"
        >
          Analyze selected
        </Button>
      </div>

      {!props.candidate || !hasPreviewVideo ? (
        <div className="rounded-md border border-dashed border-border bg-background px-2.5 py-2 text-[10.5px] leading-4 text-muted-foreground">
          Select a candidate with preview video metadata to prepare a dry-run Codex analysis job.
        </div>
      ) : null}

      <div className="grid gap-2">
        {jobs.length ? jobs.map((job) => {
          const media = codexJobMediaSummary(job)
          const canPlanJob = Boolean(media.mediaUrl || media.frameCount > 0 || media.artifactCount > 0)
          return (
            <div key={job.id} className="grid gap-2 rounded-md border border-border/70 bg-background p-2.5">
              <div className="flex items-start justify-between gap-2">
                <div className="min-w-0">
                  <p className="m-0 truncate text-xs font-semibold text-foreground">{job.operation}</p>
                  <p className="m-0 mt-0.5 truncate text-[10px] text-muted-foreground">{job.id}</p>
                </div>
                <div className="flex items-center gap-1.5">
                  <ProductLaneBadge lane={candidateLane} />
                  <StatusBadge tone={providerJobStatusTone(job.status)}>{displayProviderJobStatus(job.status)}</StatusBadge>
                </div>
              </div>
              <div className="grid gap-1">
                <MetricRow label="Operation" value={job.operation} />
                <MetricRow label="Status" value={displayProviderJobStatus(job.status)} />
                <MetricRow label="Mode" value={job.mode} />
                <MetricRow label="Lane" value={productLaneLabel(candidateLane)} />
                <MetricRow label="Updated" value={job.updatedAt} />
                <MetricRow label="Frames" value={String(media.frameCount)} />
                <MetricRow label="Artifacts" value={String(media.artifactCount)} />
                <MetricRow label="Prepared" value={media.framePreparation ?? "n/a"} />
              </div>
              {media.mediaUrl ? <p className="m-0 truncate text-[10px] text-muted-foreground">media: {media.mediaUrl}</p> : null}
              <CodexRefList label="Reference frames" values={media.referenceFrameUrls} />
              <CodexRefList label="Artifact paths" values={media.artifactPaths} />
              <Button
                type="button"
                size="xs"
                variant="workbench"
                disabled={props.busy || !props.candidate || !canPlanJob}
                onClick={() => {
                  if (!props.candidate) return
                  props.onPlanAnalysisToKie({
                    analysisJobId: job.id,
                    lane: candidateLane,
                    targetId: props.candidate.id,
                    targetKind: "candidate",
                  })
                }}
              >
                <Zap size={13} /> Plan KIE dry-run
              </Button>
              <div className="grid gap-1">
                <CodexJsonPreview label="Request JSON" value={job.request} />
                <CodexJsonPreview label="Response JSON" value={job.response} />
              </div>
            </div>
          )
        }) : (
          <div className="grid gap-2 rounded-md border border-border/60 bg-background px-2.5 py-2 text-[10.5px] text-muted-foreground">
            <p className="m-0">No Codex jobs target this candidate yet.</p>
            <Button type="button" size="xs" variant="workbench" disabled>
              Plan KIE dry-run requires a selected Codex analysis job
            </Button>
          </div>
        )}
      </div>
    </InspectorCard>
  )
}

function CodexRefList(props: { label: string; values: readonly string[] }) {
  return (
    <div className="rounded-md border border-border/50 bg-card/70 px-2 py-1.5">
      <p className="m-0 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">{props.label}</p>
      <div className="mt-1 grid max-h-20 gap-0.5 overflow-auto text-[10px] leading-4 text-muted-foreground">
        {props.values.length ? props.values.map((value) => (
          <span key={value} className="truncate font-mono">{value}</span>
        )) : <span>none</span>}
      </div>
    </div>
  )
}

function CodexJsonPreview(props: { label: string; value: JsonValue | null }) {
  return (
    <details className="rounded-md border border-border/50 bg-card/70 px-2 py-1.5 text-[10px] text-muted-foreground">
      <summary className="flex cursor-pointer items-center gap-1 font-semibold text-foreground">
        <FileJson size={11} />
        {props.label}
      </summary>
      <pre className="rugc-json mt-1 max-h-28 overflow-auto border-none bg-transparent p-0 text-[10px] leading-relaxed">{JSON.stringify(props.value, null, 2)}</pre>
    </details>
  )
}

function InspectorFrame(props: { children: React.ReactNode }) {
  return (
    <InspectorPanel data-ugc-inspector className="grid content-start gap-3 border-l border-border bg-card/80 p-3.5">
      {props.children}
    </InspectorPanel>
  )
}

function InspectorHeader(props: { title: string }) {
  return (
    <PanelHeader
      eyebrow="Inspector"
      title={props.title}
      className="mb-0"
    />
  )
}

function InspectorCard(props: { title: string; children: React.ReactNode }) {
  return (
    <PanelCard tone="default" density="compact" className="grid gap-2.5 p-3">
      <h3 className="m-0 text-xs font-semibold tracking-normal text-foreground">{props.title}</h3>
      {props.children}
    </PanelCard>
  )
}

function ProductLaneBadge(props: { lane: ProductLane }) {
  return (
    <StatusBadge tone={props.lane === "brainrot" ? "active" : "success"}>
      {productLaneLabel(props.lane)}
    </StatusBadge>
  )
}

function LaneFacet(props: { value: LaneFilter; onChange: (value: LaneFilter) => void }) {
  return (
    <div className="flex flex-wrap items-center gap-1.5">
      {productLaneFilters.map((lane) => (
        <Button
          key={lane.value}
          type="button"
          size="xs"
          variant={props.value === lane.value ? "selected" : "workbench"}
          onClick={() => props.onChange(lane.value)}
        >
          {lane.label}
        </Button>
      ))}
    </div>
  )
}

function CommandBar(props: { prompt: string; busy: boolean; onPromptChange: (value: string) => void; onRun: () => void }) {
  return (
    <CommandSurface
      value={props.prompt}
      onValueChange={props.onPromptChange}
      className="mx-5 mb-4"
      leading={<Sparkles size={16} />}
      runButton={(
        <Button type="button" size="icon" onClick={props.onRun} disabled={props.busy} aria-label="Run command">
          <ArrowUp size={15} />
        </Button>
      )}
    />
  )
}

function MiniThumb(props: { status: ExplorationItem["status"] | "good" | "active" | "dead" | "queued" | "starred" | "needs-revision"; label: string }) {
  return (
    <span className={cn("rugc-mini-thumb", props.status)}>
      {props.label ? <em>{props.label.slice(0, 2)}</em> : null}
    </span>
  )
}

function StatusPill(props: { status: PersonaCardModel["status"] }) {
  const tone = props.status === "Approved" ? "success" : props.status === "In Review" ? "warning" : props.status === "Rejected" ? "danger" : "neutral"
  return <StatusBadge tone={tone}>{props.status}</StatusBadge>
}

function ScoreBar(props: { label: string; value: number; warning?: boolean }) {
  return <ScoreMeter label={props.label} value={props.value} tone={props.warning ? "warning" : "default"} />
}
