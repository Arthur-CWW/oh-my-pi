/** @jsxImportSource react */
import * as React from "react"
import {
  ArrowUp,
  BarChart3,
  Bell,
  Bot,
  Braces,
  CheckCircle2,
  ChevronDown,
  CircleDollarSign,
  Clapperboard,
  Clock,
  Copy,
  Download,
  Eye,
  FastForward,
  FileJson,
  Filter,
  Folder,
  GitBranch,
  GitFork,
  Grid2X2,
  Home,
  Inbox,
  Layers3,
  MessageSquare,
  MoreHorizontal,
  Network,
  Pause,
  Play,
  PlayCircle,
  Plus,
  RefreshCw,
  Rewind,
  Search,
  Settings,
  Share2,
  SlidersHorizontal,
  Sparkles,
  Star,
  Table2,
  Target,
  UserCircle,
  Wand2,
  XCircle,
  Zap,
} from "lucide-react"
import { Badge } from "./components/ui/badge"
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
import { createInitialLocalState, referenceProfileToArchive, type ReferenceArchiveFormatOutput, type UgcExportManifest, type UgcLocalState, type UgcProviderJob, type UgcProviderJobStatus, type UgcReferenceArchive } from "../ugc/local-state"
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
  return explorationRows.map((row) => {
    if (row.id === "row_persona") {
      return {
        ...row,
        items: workspace.personas.map((persona, index) => ({
          id: `explore_${persona.id}`,
          title: persona.displayName,
          subtitle: persona.profileBible.niche,
          score: Math.min(9.2, 7.6 + index * 0.4),
          status: persona.status === "selected" ? "keep" : persona.status === "paused" ? "risk" : "review",
          personaId: persona.id,
        })),
      }
    }
    if (row.id === "row_hook") {
      return {
        ...row,
        items: workspace.candidates.slice(0, 5).map((candidate) => ({
          id: `explore_${candidate.id}`,
          title: candidate.title,
          subtitle: candidate.kind,
          score: candidate.scorecard.hookStrength / 10,
          status: candidate.status === "rejected" ? "risk" : candidate.status === "starred" ? "keep" : "review",
          candidateId: candidate.id,
        })),
      }
    }
    return row
  })
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

function jsonRecord(value: JsonValue | undefined | null): { readonly [key: string]: JsonValue } | null {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return null
  return value as { readonly [key: string]: JsonValue }
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
  const personaCards = React.useMemo(() => workspace.personas.map(projectPersonaCard), [workspace.personas])
  const selectedCandidate = workspace.candidates.find((candidate) => candidate.id === selectedCandidateId) ?? workspace.candidates[0]
  const selectedPersona = personaCards.find((persona) => persona.id === selectedPersonaId) ?? personaCards[0]
  const selectedBranch = workspace.branchSnapshots.find((branch) => branch.id === selectedBranchId) ?? workspace.branchSnapshots[0]
  const selectedCapability = capabilities.find((capability) => capability.operation === operation) ?? capabilities[0]
  const activeViewMeta = views.find((view) => view.value === activeView) ?? views[0]

  React.useEffect(() => {
    let cancelled = false
    fetch(`${daemonBaseUrl}/api/ugc/workspace`)
      .then((response) => response.ok ? response.json() : Promise.reject(new Error(`daemon ${response.status}`)))
      .then((payload: UgcLocalState) => {
        if (!cancelled && payload.schemaVersion === "ugc-studio.local-state.v1") setLocalState(payload)
      })
      .catch(() => undefined)
    return () => {
      cancelled = true
    }
  }, [])

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
      const payload = await response.json() as UgcLocalState | { error?: string }
      if (!response.ok || !("schemaVersion" in payload) || payload.schemaVersion !== "ugc-studio.local-state.v1") {
        setResult(JSON.stringify(payload, null, 2))
        return
      }
      setLocalState(payload)
      setResult(JSON.stringify({ ok: true, path, updatedAt: payload.updatedAt }, null, 2))
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
          />
        </WorkbenchContent>
      </WorkbenchMain>
    </WorkbenchShell>
    </UgcLocalStateContext.Provider>
  )
}

function Sidebar(props: { activeView: ReactView; onViewChange: (view: ReactView) => void }) {
  return (
    <WorkbenchSidebar>
      <div className="flex h-3 items-center gap-1.5" aria-hidden="true">
        <span className="h-2 w-2 rounded-full bg-[#ff5f57]" />
        <span className="h-2 w-2 rounded-full bg-[#ffbd2e]" />
        <span className="h-2 w-2 rounded-full bg-[#28c840]" />
      </div>
      <div className="flex items-center justify-between gap-2">
        <div className="flex min-w-0 items-center gap-2">
          <span className="grid h-6 w-6 shrink-0 place-items-center rounded-md bg-primary text-primary-foreground">
            <Clapperboard size={14} />
          </span>
          <Button type="button" variant="ghost" size="xs" className="min-w-0 px-1 font-semibold">
            <span className="truncate">UGC Studio</span>
            <ChevronDown size={12} />
          </Button>
        </div>
      </div>
      <Button type="button" variant="workbench" size="sm" className="w-full justify-between">
        <span className="inline-flex items-center gap-2"><Plus size={13} /> New Command</span>
        <kbd className="rounded border border-border bg-background px-1 text-[10px] text-muted-foreground">⌘N</kbd>
      </Button>
      <label className="flex items-center gap-2 rounded-md border border-border bg-card px-2 py-1.5">
        <Search size={13} />
        <Input value="" readOnly placeholder="Search personas, hooks..." className="h-5 border-0 bg-transparent p-0 text-xs shadow-none focus-visible:ring-0" />
      </label>
      <SidebarSection title="Workspace">
        {views.map((view) => {
          const Icon = view.icon
          return (
            <SidebarRow
              key={view.value}
              type="button"
              active={props.activeView === view.value}
              icon={<Icon size={14} />}
              shortcut={`g${view.value.slice(0, 1)}`}
              onClick={() => props.onViewChange(view.value)}
            >
              {view.label}
            </SidebarRow>
          )
        })}
      </SidebarSection>
      <SidebarSection title="Campaigns">
        {["Summer Skincare", "Protein Bar Ads", "Hydration Boost", "Coffee Brand", "Archived"].map((label, index) => (
          <SidebarRow key={label} type="button" active={index === 0} icon={<Folder size={13} />} className="h-7">
            {label}
          </SidebarRow>
        ))}
      </SidebarSection>
      <SidebarSection title="Review Queues">
        {[
          ["Needs My Review", "18"],
          ["Starred", "7"],
          ["Approved", "23"],
          ["Rejected", "12"],
        ].map(([label, count]) => (
          <SidebarRow
            key={label}
            type="button"
            icon={label === "Starred" ? <Star size={13} /> : label === "Approved" ? <CheckCircle2 size={13} /> : label === "Rejected" ? <XCircle size={13} /> : <Inbox size={13} />}
            count={count}
            className="h-7"
          >
            {label}
          </SidebarRow>
        ))}
      </SidebarSection>
      <div className="mt-auto flex items-center gap-2 border-t border-border pt-3">
        <span className="grid h-6 w-6 place-items-center rounded-full bg-foreground text-[11px] text-background">A</span>
        <strong>Arthur</strong>
        <Badge className="ml-auto">Pro</Badge>
      </div>
    </WorkbenchSidebar>
  )
}

function SidebarSection(props: { title: string; children: React.ReactNode }) {
  return (
    <section className="grid gap-1.5">
      <h2 className="mx-1 flex items-center justify-between text-[10px] font-semibold uppercase tracking-normal text-muted-foreground">
        {props.title}
        <Plus size={12} />
      </h2>
      <div className="grid gap-0.5">{props.children}</div>
    </section>
  )
}

function Topbar(props: { activeViewMeta: (typeof views)[number] }) {
  return (
    <WorkbenchTopbar>
      <div className="flex min-w-0 items-center gap-2 text-muted-foreground">
        <Home size={13} />
        <span>UGC Studio</span>
        <span>/</span>
        <span>Summer Skincare</span>
        <span>/</span>
        <strong className="truncate text-foreground">{props.activeViewMeta.label}</strong>
      </div>
      <div className="flex shrink-0 items-center gap-2">
        <label className="flex h-8 w-48 items-center gap-2 rounded-md border border-border bg-card px-2">
          <Search size={13} />
          <Input value="" readOnly placeholder="Search" className="h-5 border-0 bg-transparent p-0 text-xs shadow-none focus-visible:ring-0" />
          <kbd className="rounded border border-border bg-background px-1 text-[10px] text-muted-foreground">⌘K</kbd>
        </label>
        <Button type="button" size="icon-sm" variant="workbench" aria-label="Notifications"><Bell size={14} /></Button>
        <Button type="button" size="icon-sm" variant="workbench" aria-label="History"><Clock size={14} /></Button>
        <Button type="button" size="icon-sm" variant="subtle" className="rounded-full" aria-label="Arthur">A</Button>
        <Button size="sm" variant="outline">Preview</Button>
        <Button size="sm">Export</Button>
      </div>
    </WorkbenchTopbar>
  )
}

function ViewToolbar(props: { activeView: ReactView; onViewChange: (view: ReactView) => void }) {
  return (
    <div className="flex h-[58px] items-center justify-between gap-3 border-b border-border bg-card/80 px-4">
      <div className="min-w-[190px] flex-1">
        <p className="m-0 truncate text-[11px] text-muted-foreground">Summer Skincare / creative search graph</p>
        <h1 data-ugc-view-title className="m-0 mt-0.5 truncate text-[15px] font-bold tracking-normal text-foreground">{views.find((view) => view.value === props.activeView)?.label}</h1>
      </div>
      <ToolbarCluster className="max-w-[72%] shrink overflow-x-auto">
        <Tabs value={props.activeView} items={viewTabs} onValueChange={props.onViewChange} className="shrink-0" />
        <Button type="button" size="xs" variant="workbench" className="shrink-0 max-[1400px]:hidden"><Grid2X2 size={13} /> Board</Button>
        <Button type="button" size="xs" variant="workbench" className="shrink-0 max-[1400px]:hidden"><Table2 size={13} /> Table</Button>
        <Button type="button" size="xs" variant="workbench" className="shrink-0 max-[1400px]:hidden"><Network size={13} /> Graph</Button>
        <Button type="button" size="xs" variant="workbench" className="shrink-0 max-[1400px]:hidden"><Filter size={13} /> Filter</Button>
        <Button type="button" size="xs" variant="workbench" className="shrink-0 max-[1400px]:hidden"><SlidersHorizontal size={13} /> Sort</Button>
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
    return <CampaignMap selectedBranchId={props.selectedBranchId} onSelectBranch={props.onSelectBranch} onSelectCandidate={props.onSelectCandidate} />
  }
  if (props.activeView === "reference") {
    return <ReferenceArchiveView onMutateLocal={props.onMutateLocal} />
  }
  if (props.activeView === "editor") {
    return <FinalEditor selectedCandidateId={props.selectedCandidateId} onSelectCandidate={props.onSelectCandidate} onMutateLocal={props.onMutateLocal} />
  }
  if (props.activeView === "graph") {
    return <DeveloperGraphView onMutateLocal={props.onMutateLocal} />
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


function CampaignMap(props: { selectedBranchId: string; onSelectBranch: (id: string) => void; onSelectCandidate: (id: string) => void }) {
  const { workspace } = useUgcLocalState()
  const columns = projectCampaignColumns(workspace)
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
          <strong>Snapshot 18</strong>
          <p>Benefit Hook, created May 27. Fork selected winners into softer CTA variants.</p>
          <span>+27% vs parent</span>
        </div>
        <div className="rugc-preview-strip">
          {workspace.candidates.slice(0, 3).map((candidate) => (
            <button key={candidate.id} type="button" onClick={() => props.onSelectCandidate(candidate.id)}>
              <MiniThumb status="keep" label="" />
              <PlayCircle size={22} />
              <span>{candidate.title}</span>
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
      payloadJson: { text: clipTextDraft, source: "final-editor" },
    } : null,
  }), [clipLabelDraft, clipTextDraft, durationDraft, selectedCandidate?.id, selectedClip, selectedTrack, startDraft])

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
          payloadJson: {
            text: clipTextDraft.trim() || selectedClip.label,
            source: "final-editor",
            editableFields: selectedClip.editableFields,
          },
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
              timelineJson: workspace.finalEditor,
              notes: ["Created from Final Layer Editor"],
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

function ReferenceArchiveView(props: { onMutateLocal: (path: string, body: object) => void }) {
  const { workspace, referenceArchives, researchTargets, templateMiningJobs } = useUgcLocalState()
  const [selectedReferenceId, setSelectedReferenceId] = React.useState(workspace.referenceProfiles[0]?.id ?? "")
  const [selectedResearchTargetId, setSelectedResearchTargetId] = React.useState(researchTargets[0]?.id ?? "")
  const selectedReference = workspace.referenceProfiles.find((reference) => reference.id === selectedReferenceId) ?? workspace.referenceProfiles[0]
  const selectedResearchTarget = researchTargets.find((target) => target.id === selectedResearchTargetId) ?? researchTargets[0]
  const selectedTemplateJobs = selectedResearchTarget ? templateMiningJobs.filter((job) => job.researchTargetId === selectedResearchTarget.id) : []
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
    if (!workspace.referenceProfiles.some((reference) => reference.id === selectedReferenceId)) {
      setSelectedReferenceId(workspace.referenceProfiles[0]?.id ?? "")
    }
  }, [selectedReferenceId, workspace.referenceProfiles])

  React.useEffect(() => {
    if (!researchTargets.some((target) => target.id === selectedResearchTargetId)) {
      setSelectedResearchTargetId(researchTargets[0]?.id ?? "")
    }
  }, [researchTargets, selectedResearchTargetId])

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
      <div className="grid h-full place-items-center p-6">
        <PanelCard className="max-w-sm text-center">
          <PanelHeader title="No reference profiles" />
          <p className="text-xs leading-5 text-muted-foreground">Add a profile target before creating archive specs.</p>
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
        <div className="grid gap-2">
          {workspace.referenceProfiles.map((reference) => {
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
            <StatusBadge>{researchTargets.length}</StatusBadge>
          </div>
          <div className="grid gap-2">
            {researchTargets.slice(0, 4).map((target) => (
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
          actions={<StatusBadge tone={sourcePolicy === "rights-cleared-source" ? "success" : "warning"}>{sourcePolicy}</StatusBadge>}
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

          <div className="mt-3 grid grid-cols-3 gap-2">
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

function DeveloperGraphView(props: { onMutateLocal: (path: string, body: object) => void }) {
  const localState = useUgcLocalState()
  const { workspace, providerJobs, exportManifests, researchTargets, templateMiningJobs } = localState
  const derivedGraph = React.useMemo(() => deriveUgcDeveloperGraph(localState), [localState])
  const [selectedNodeId, setSelectedNodeId] = React.useState(derivedGraph.nodes[0]?.id ?? "")
  const selectedNode = derivedGraph.nodes.find((node) => node.id === selectedNodeId) ?? derivedGraph.nodes[0]
  const families: DerivedGraphFamily[] = ["brief", "persona", "reference", "branch", "candidate", "provider-job", "export", "research", "template"]

  React.useEffect(() => {
    if (!derivedGraph.nodes.some((node) => node.id === selectedNodeId)) {
      setSelectedNodeId(derivedGraph.nodes[0]?.id ?? "")
    }
  }, [derivedGraph.nodes, selectedNodeId])

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
          <p>Export the current local workspace, object shards, asset paths, provider jobs, archives, research queues, templates, and export manifests.</p>
          <Button
            size="xs"
            variant="workbench"
            onClick={() => props.onMutateLocal("/api/ugc/workspace/bundles/export", {
              label: `${workspace.title} developer export`,
            })}
          >
            <Download size={13} /> Export bundle
          </Button>
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
}) {
  const { providerJobs } = useUgcLocalState()
  const [selectedJobId, setSelectedJobId] = React.useState(providerJobs[0]?.id ?? "")
  const selectedJob = providerJobs.find((job) => job.id === selectedJobId) ?? providerJobs[0]
  const kieTaskId = extractKieTaskId(selectedJob?.response ?? null)

  React.useEffect(() => {
    if (!providerJobs.some((job) => job.id === selectedJobId)) setSelectedJobId(providerJobs[0]?.id ?? "")
  }, [providerJobs, selectedJobId])

  return (
    <div className="grid h-full min-h-0 grid-cols-[minmax(0,1fr)_320px] gap-3 overflow-hidden p-3">
      <PanelCard className="grid min-h-0 grid-rows-[auto_minmax(0,1fr)] overflow-hidden" density="compact">
        <PanelHeader
          eyebrow="Local queue"
          title="Provider jobs"
          actions={<StatusBadge tone="active">{providerJobs.length}</StatusBadge>}
        />
        <div className="min-h-0 overflow-auto pr-1">
          {providerJobs.length === 0 ? (
            <div className="grid h-full min-h-52 place-items-center rounded-md border border-dashed border-border bg-background p-6 text-center">
              <div>
                <Braces className="mx-auto text-muted-foreground" size={26} />
                <p className="mt-2 text-xs font-semibold text-foreground">No provider jobs yet</p>
                <p className="mt-1 text-[11px] leading-4 text-muted-foreground">Dry-run or live capped KIE calls create local job records.</p>
              </div>
            </div>
          ) : (
            <div className="grid gap-2">
              {providerJobs.map((job) => (
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
                  <span className="truncate text-[10px] text-muted-foreground">{job.updatedAt}</span>
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
                  <StatusBadge tone={providerJobStatusTone(selectedJob.status)}>{displayProviderJobStatus(selectedJob.status)}</StatusBadge>
                </div>
                <div className="mt-2 grid gap-1">
                  <MetricRow label="Provider" value={selectedJob.provider} />
                  <MetricRow label="Mode" value={selectedJob.mode} />
                  <MetricRow label="Estimate" value={selectedJob.estimatedCostUsd === null ? "n/a" : `$${selectedJob.estimatedCostUsd.toFixed(2)}`} />
                  <MetricRow label="Artifacts" value={String(selectedJob.artifactPaths.length)} />
                </div>
              </div>

              <div className="grid grid-cols-3 gap-1">
                {(["queued", "running", "succeeded", "blocked", "failed"] satisfies UgcProviderJobStatus[]).map((status) => (
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
                <Button size="xs" variant="workbench" onClick={() => props.onCallKie(`/api/ugc/kie/tasks/${kieTaskId}`)}>
                  <RefreshCw size={13} /> Poll KIE task
                </Button>
              ) : null}

              <div className="rounded-md border border-border bg-background p-2">
                <p className="m-0 text-[11px] font-semibold text-foreground">Artifact refs</p>
                <div className="mt-1 grid gap-1 text-[11px] text-muted-foreground">
                  {selectedJob.artifactPaths.length ? selectedJob.artifactPaths.map((path) => <span key={path} className="truncate">{path}</span>) : <span>none</span>}
                </div>
              </div>

              <pre className="rugc-json">{JSON.stringify({
                request: selectedJob.request,
                response: selectedJob.response,
                error: selectedJob.error,
              }, null, 2)}</pre>
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
      actions={(
        <>
          <Button type="button" size="xs" variant="selected">Creative</Button>
          <Button type="button" size="xs" variant="ghost">JSON</Button>
        </>
      )}
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

function CommandBar(props: { prompt: string; busy: boolean; onPromptChange: (value: string) => void; onRun: () => void }) {
  return (
    <CommandSurface
      value={props.prompt}
      onValueChange={props.onPromptChange}
      className="mx-5 mb-4"
      leading={<Sparkles size={16} />}
      actions={(
        <>
          <Button type="button" size="xs" variant="subtle"><Plus size={13} /> Add context</Button>
          <Button type="button" size="xs" variant="subtle"><Target size={13} /> Targets</Button>
          <Button type="button" size="xs" variant="subtle"><Settings size={13} /> Agent</Button>
        </>
      )}
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
