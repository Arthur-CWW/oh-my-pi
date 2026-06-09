export type JsonPrimitive = string | number | boolean | null
export type JsonValue = JsonPrimitive | readonly JsonValue[] | { readonly [key: string]: JsonValue }

export type WorkspaceView =
  | "persona-atlas"
  | "exploration-board"
  | "batch-review"
  | "campaign-branch-map"
  | "final-editor"
  | "developer-graph"
  | "reference-profile-remix"

export type CreativeStageKind =
  | "product-brief"
  | "reference-profile"
  | "persona"
  | "format"
  | "hook"
  | "script"
  | "proof-demo"
  | "cta"
  | "non-cta"
  | "edit-style"
  | "final-polish"

export type CandidateKind = "persona-profile" | "profile-post" | "ad-clip" | "hook" | "cta" | "format-template"
export type CandidateStatus = "queued" | "generating" | "ready" | "starred" | "rejected" | "needs-revision" | "exported"
export type ReviewVerdict = "keep" | "fork" | "revise" | "reject" | "watch-again"
export type BranchStatus = "active" | "promising" | "dead-end" | "merged" | "archived"
export type ReferenceRightsStatus = "user-owned" | "public-research-target" | "rights-cleared" | "abstract-only"
export type RemixFieldMode = "preserve" | "swap" | "abstract" | "blocked"
export type EditorTrackKind = "host" | "product-demo" | "b-roll" | "captions" | "voice" | "audio" | "sticker" | "cta"
export type GraphNodeKind =
  | "input"
  | "llm"
  | "image"
  | "video"
  | "tts"
  | "pose"
  | "caption"
  | "compose"
  | "eval"
  | "export"

export interface WorkspaceMetric {
  readonly label: string
  readonly value: string
  readonly trend: "up" | "down" | "flat"
  readonly note: string
}

export interface ProductBrief {
  readonly id: string
  readonly productName: string
  readonly category: string
  readonly targetAudience: string
  readonly offer: string
  readonly constraints: readonly string[]
  readonly desiredOutcomes: readonly string[]
  readonly campaignMix: {
    readonly ctaPostsPercent: number
    readonly personaBuildingPostsPercent: number
  }
}

export interface WorkspaceAgent {
  readonly id: string
  readonly name: string
  readonly role: string
  readonly operatingMode: "creative-director" | "pipeline-programmer" | "review-assistant"
  readonly currentInstruction: string
  readonly selectedSetIds: readonly string[]
  readonly queuedActions: readonly AgentAction[]
}

export interface AgentAction {
  readonly id: string
  readonly label: string
  readonly targetKind: "persona" | "candidate" | "branch" | "stage" | "reference-profile"
  readonly targetIds: readonly string[]
  readonly instruction: string
  readonly expectedOutput: string
}

export interface PersonaProfile {
  readonly id: string
  readonly displayName: string
  readonly handle: string
  readonly status: "draft" | "promising" | "selected" | "paused"
  readonly avatarPrompt: string
  readonly genreLane: string
  readonly appearance: PersonaAppearance
  readonly voice: PersonaVoice
  readonly profileBible: PersonaProfileBible
  readonly postingStrategy: PostingStrategy
  readonly continuity: ContinuitySpec
  readonly sampleClipIds: readonly string[]
  readonly branchSnapshotIds: readonly string[]
  readonly notes: readonly string[]
}

export interface PersonaAppearance {
  readonly ageRange: string
  readonly ethnicityStyleLane: string
  readonly hair: string
  readonly wardrobe: readonly string[]
  readonly visualNotes: readonly string[]
  readonly imageReferenceIds: readonly string[]
}

export interface PersonaVoice {
  readonly voiceId: string
  readonly accent: string
  readonly speakingStyle: string
  readonly energy: number
  readonly catchphrases: readonly string[]
  readonly avoid: readonly string[]
}

export interface PersonaProfileBible {
  readonly niche: string
  readonly specialInterests: readonly string[]
  readonly influences: readonly string[]
  readonly promotes: readonly string[]
  readonly audiencePromise: string
  readonly toneRules: readonly string[]
}

export interface PostingStrategy {
  readonly weeklyCadence: readonly PostingCadenceItem[]
  readonly contentLanes: readonly ContentLane[]
}

export interface PostingCadenceItem {
  readonly laneId: string
  readonly postsPerWeek: number
  readonly purpose: "followers" | "conversion" | "authority" | "retention"
}

export interface ContentLane {
  readonly id: string
  readonly label: string
  readonly description: string
  readonly defaultStageIds: readonly string[]
}

export interface ContinuitySpec {
  readonly stableIdentityFields: readonly string[]
  readonly mutableIdentityFields: readonly string[]
  readonly continuityWarnings: readonly string[]
  readonly jsonManifest: JsonValue
}

export interface ReferenceProfile {
  readonly id: string
  readonly platform: "tiktok" | "instagram" | "youtube-shorts" | "internal-pack"
  readonly handle: string
  readonly displayName: string
  readonly rightsStatus: ReferenceRightsStatus
  readonly archiveStatus: "not-started" | "queued" | "sampled" | "decomposed"
  readonly styleLane: string
  readonly useCase: string
  readonly cleanRoomBoundary: readonly string[]
  readonly sampleClips: readonly ReferenceClip[]
  readonly extractedMechanics: ExtractedProfileMechanics
  readonly remixFields: readonly RemixField[]
}

export interface ReferenceClip {
  readonly id: string
  readonly title: string
  readonly sourceUrl: string | null
  readonly durationSeconds: number
  readonly storagePolicy: "store-source" | "store-metadata-only" | "store-abstract-mechanics"
  readonly extractedFields: readonly string[]
}

export interface ExtractedProfileMechanics {
  readonly poseTiming: string
  readonly gestureRhythm: string
  readonly shotStructure: readonly string[]
  readonly captionTemplate: string
  readonly hookFamilies: readonly string[]
  readonly ctaPatterns: readonly string[]
  readonly nonAdPatterns: readonly string[]
}

export interface RemixField {
  readonly id: string
  readonly label: string
  readonly mode: RemixFieldMode
  readonly sourceField: string
  readonly targetField: string
  readonly rationale: string
  readonly confidence: number
}

export interface FormatStage {
  readonly id: string
  readonly kind: CreativeStageKind
  readonly title: string
  readonly description: string
  readonly position: CanvasPosition
  readonly inputIds: readonly string[]
  readonly outputIds: readonly string[]
  readonly connectedStageIds: readonly string[]
  readonly exampleCarousel: readonly StageExample[]
  readonly agentPromptCard: AgentPromptCard
}

export interface StageExample {
  readonly id: string
  readonly title: string
  readonly mediaKind: "image" | "video" | "text" | "json"
  readonly previewUrl: string
  readonly summary: string
  readonly linkedCandidateId: string | null
}

export interface AgentPromptCard {
  readonly id: string
  readonly title: string
  readonly prompt: string
  readonly editableFields: readonly string[]
  readonly manifestJson: JsonValue
}

export interface CandidateBatch {
  readonly id: string
  readonly title: string
  readonly branchSnapshotId: string
  readonly stageId: string
  readonly personaIds: readonly string[]
  readonly referenceProfileIds: readonly string[]
  readonly candidateIds: readonly string[]
  readonly generationGoal: string
  readonly requestedCount: number
  readonly completedCount: number
  readonly reviewSummary: string
}

export interface CreativeCandidate {
  readonly id: string
  readonly kind: CandidateKind
  readonly title: string
  readonly status: CandidateStatus
  readonly stageId: string
  readonly batchId: string
  readonly personaId: string | null
  readonly referenceProfileId: string | null
  readonly durationSeconds: number
  readonly preview: CandidatePreview
  readonly scorecard: CandidateScorecard
  readonly tags: readonly string[]
  readonly recipe: CandidateRecipe
  readonly reviewNoteIds: readonly string[]
}

export interface CandidatePreview {
  readonly posterUrl: string
  readonly videoUrl: string | null
  readonly transcript: readonly TranscriptLine[]
  readonly visibleInputs: readonly VisibleInput[]
}

export interface TranscriptLine {
  readonly startSeconds: number
  readonly endSeconds: number
  readonly text: string
}

export interface VisibleInput {
  readonly label: string
  readonly value: string
  readonly kind: "persona" | "hook" | "product" | "reference" | "caption" | "voice" | "metric"
}

export interface CandidateScorecard {
  readonly overall: number
  readonly hookStrength: number
  readonly personaFit: number
  readonly formatFit: number
  readonly conversionPotential: number
  readonly novelty: number
  readonly issues: readonly string[]
}

export interface CandidateRecipe {
  readonly recipeId: string
  readonly providerRoute: string
  readonly sourceStageIds: readonly string[]
  readonly manifestJson: JsonValue
  readonly costEstimateUsd: number
}

export interface ReviewNote {
  readonly id: string
  readonly author: "arthur" | "agent"
  readonly createdAt: string
  readonly attachedTo: ReviewAttachment
  readonly verdict: ReviewVerdict
  readonly body: string
  readonly requestedChange: string | null
  readonly followUpActionId: string | null
}

export interface ReviewAttachment {
  readonly kind: "persona" | "candidate" | "batch" | "branch" | "stage" | "reference-profile"
  readonly id: string
}

export interface BranchSnapshot {
  readonly id: string
  readonly parentId: string | null
  readonly title: string
  readonly status: BranchStatus
  readonly createdAt: string
  readonly focus: string
  readonly decisionNote: string
  readonly selectedPersonaIds: readonly string[]
  readonly selectedCandidateIds: readonly string[]
  readonly candidateBatchIds: readonly string[]
  readonly childIds: readonly string[]
  readonly metrics: readonly WorkspaceMetric[]
}

export interface FinalEditorWorkspace {
  readonly id: string
  readonly selectedCandidateId: string
  readonly durationSeconds: number
  readonly resolution: {
    readonly width: number
    readonly height: number
  }
  readonly tracks: readonly EditorTrack[]
  readonly exportPresets: readonly ExportPreset[]
}

export interface EditorTrack {
  readonly id: string
  readonly kind: EditorTrackKind
  readonly label: string
  readonly locked: boolean
  readonly visible: boolean
  readonly clips: readonly EditorClip[]
}

export interface EditorClip {
  readonly id: string
  readonly label: string
  readonly startSeconds: number
  readonly durationSeconds: number
  readonly assetId: string
  readonly sourceCandidateId: string | null
  readonly editableFields: readonly string[]
}

export interface ExportPreset {
  readonly id: string
  readonly label: string
  readonly platform: "tiktok" | "reels" | "shorts" | "local"
  readonly manifestJson: JsonValue
}

export interface DeveloperGraph {
  readonly id: string
  readonly title: string
  readonly visibleByDefault: boolean
  readonly nodes: readonly DeveloperGraphNode[]
  readonly edges: readonly DeveloperGraphEdge[]
  readonly providerRoutes: readonly ProviderRoute[]
}

export interface DeveloperGraphNode {
  readonly id: string
  readonly kind: GraphNodeKind
  readonly title: string
  readonly status: "idle" | "ready" | "running" | "blocked"
  readonly position: CanvasPosition
  readonly inputs: readonly GraphPort[]
  readonly outputs: readonly GraphPort[]
  readonly parameters: readonly GraphParameter[]
}

export interface GraphPort {
  readonly id: string
  readonly label: string
  readonly valueType: "json" | "image" | "video" | "audio" | "pose" | "text" | "metrics"
}

export interface GraphParameter {
  readonly key: string
  readonly label: string
  readonly value: JsonValue
}

export interface DeveloperGraphEdge {
  readonly id: string
  readonly fromNodeId: string
  readonly fromPortId: string
  readonly toNodeId: string
  readonly toPortId: string
  readonly label: string
}

export interface ProviderRoute {
  readonly id: string
  readonly label: string
  readonly provider: string
  readonly model: string
  readonly maxConcurrency: number
  readonly spendCapUsd: number
}

export interface ReferenceProfileRemixPlan {
  readonly id: string
  readonly referenceProfileId: string
  readonly targetPersonaId: string
  readonly targetProductBriefId: string
  readonly goal: string
  readonly preservedFields: readonly RemixField[]
  readonly swappedFields: readonly RemixField[]
  readonly blockedFields: readonly RemixField[]
  readonly outputCandidateIds: readonly string[]
  readonly guardrails: readonly string[]
}

export interface CanvasPosition {
  readonly x: number
  readonly y: number
}

export interface UgcStudioWorkspace {
  readonly schemaVersion: "ugc-studio.workspace.v1"
  readonly id: string
  readonly title: string
  readonly activeView: WorkspaceView
  readonly updatedAt: string
  readonly productBrief: ProductBrief
  readonly agent: WorkspaceAgent
  readonly personas: readonly PersonaProfile[]
  readonly referenceProfiles: readonly ReferenceProfile[]
  readonly formatStages: readonly FormatStage[]
  readonly candidateBatches: readonly CandidateBatch[]
  readonly candidates: readonly CreativeCandidate[]
  readonly reviewNotes: readonly ReviewNote[]
  readonly branchSnapshots: readonly BranchSnapshot[]
  readonly finalEditor: FinalEditorWorkspace
  readonly developerGraph: DeveloperGraph
  readonly referenceRemixPlans: readonly ReferenceProfileRemixPlan[]
}

const remixFieldPoseTiming: RemixField = {
  id: "remix_field_pose_timing",
  label: "Pose timing",
  mode: "preserve",
  sourceField: "reference.extractedMechanics.poseTiming",
  targetField: "candidate.motion.poseTimeline",
  rationale: "The useful signal is the rhythm of gestures and cuts, not the source identity.",
  confidence: 0.82,
}

const remixFieldCaptionTemplate: RemixField = {
  id: "remix_field_caption_template",
  label: "Caption layout grammar",
  mode: "abstract",
  sourceField: "reference.extractedMechanics.captionTemplate",
  targetField: "candidate.captions.layoutRules",
  rationale: "Keep timing, placement, and emphasis rules while rewriting all visible text.",
  confidence: 0.76,
}

const remixFieldSyntheticPersona: RemixField = {
  id: "remix_field_synthetic_persona",
  label: "Synthetic persona",
  mode: "swap",
  sourceField: "reference.creatorIdentity",
  targetField: "persona.identity",
  rationale: "Use the generated persona profile rather than a real creator's face or body identity.",
  confidence: 0.94,
}

const remixFieldVoice: RemixField = {
  id: "remix_field_voice",
  label: "Voice and exact phrasing",
  mode: "swap",
  sourceField: "reference.audioVoice",
  targetField: "persona.voice",
  rationale: "Voice should be synthetic or licensed, and hooks should point to the current product.",
  confidence: 0.91,
}

const remixFieldSourceMedia: RemixField = {
  id: "remix_field_source_media",
  label: "Source pixels and audio",
  mode: "blocked",
  sourceField: "reference.rawMedia",
  targetField: "candidate.rawMedia",
  rationale: "Do not store or reuse source media unless it is user-owned or rights-cleared.",
  confidence: 1,
}

export const ugcStudioWorkspace = {
  schemaVersion: "ugc-studio.workspace.v1",
  id: "workspace_protein_bar_ads",
  title: "Protein Bar Ads",
  activeView: "persona-atlas",
  updatedAt: "2026-06-09T17:30:00+10:00",
  productBrief: {
    id: "brief_clean_fuel_bar",
    productName: "Clean Fuel Protein Bar",
    category: "fitness snack",
    targetAudience: "busy gym-adjacent people who want low-effort nutrition without supplement-bro energy",
    offer: "High-protein snack bar with low sugar and no sugar alcohols.",
    constraints: [
      "Do not make medical claims.",
      "Do not imply guaranteed weight loss.",
      "Keep visible text editable in post.",
      "Prefer generated or rights-cleared persona/reference media.",
    ],
    desiredOutcomes: [
      "Find three synthetic host personas worth turning into recurring TikTok profiles.",
      "Generate ten hook variations across demo, proof, and objection formats.",
      "Split campaign output between conversion CTAs and persona-building non-ad posts.",
    ],
    campaignMix: {
      ctaPostsPercent: 50,
      personaBuildingPostsPercent: 50,
    },
  },
  agent: {
    id: "agent_creative_operator",
    name: "Studio Operator",
    role: "Single agent that programs workflows, generates batches, critiques results, and prepares final edits.",
    operatingMode: "creative-director",
    currentInstruction:
      "Find a sharper Korean-beauty fitness persona lane, generate five more hooks with less generic enthusiasm, and preserve editable layers.",
    selectedSetIds: ["batch_hooks_round_02", "branch_kbeauty_soft_authority"],
    queuedActions: [
      {
        id: "action_generate_kbeauty_hooks",
        label: "Generate 5 softer hook variants",
        targetKind: "branch",
        targetIds: ["branch_kbeauty_soft_authority"],
        instruction: "Make the persona less salesy, more quietly confident, and keep CTA pressure low until the final beat.",
        expectedOutput: "Five playable ad-clip candidates with JSON manifests and layer timelines.",
      },
      {
        id: "action_remix_faceless_template",
        label: "Remix faceless template",
        targetKind: "reference-profile",
        targetIds: ["ref_faceless_caption_template_pack"],
        instruction: "Preserve timing and caption grammar, but swap product, hook copy, and voice.",
        expectedOutput: "A clean-room format template plus three generated candidates.",
      },
    ],
  },
  personas: [
    {
      id: "persona_seoul_gym_diary",
      displayName: "Seoul Gym Diary",
      handle: "@seoulgymdiary.ai",
      status: "promising",
      avatarPrompt:
        "Korean-beauty fitness creator, polished but casual gym outfit, soft indoor lighting, direct-to-camera confidence.",
      genreLane: "Korean beauty / K-pop-idol-adjacent fitness UGC",
      appearance: {
        ageRange: "early 20s",
        ethnicityStyleLane: "Korean beauty, idol-adjacent styling, rights-cleared synthetic identity",
        hair: "long dark hair with soft layers",
        wardrobe: ["white fitted tank", "neutral athleisure", "minimal jewelry"],
        visualNotes: ["striking but believable", "not glossy SaaS stock", "good for direct camera and mirror shots"],
        imageReferenceIds: ["asset_kbeauty_face_grid_01", "asset_athleisure_pose_sheet_02"],
      },
      voice: {
        voiceId: "voice_soft_confident_kr_en",
        accent: "light Korean-accented English",
        speakingStyle: "quiet confidence, short clauses, understated humor",
        energy: 68,
        catchphrases: ["I would not overthink it.", "This is the lazy version.", "Actually useful."],
        avoid: ["overly bubbly influencer voice", "medical claims", "hard-selling every clip"],
      },
      profileBible: {
        niche: "low-friction fitness habits for people who hate supplement culture",
        specialInterests: ["pilates", "desk snacks", "clean beauty", "morning gym routines"],
        influences: ["Korean beauty routine pacing", "faceless desk setup edits", "soft gym vlog captions"],
        promotes: ["protein bars", "hydration", "simple routines"],
        audiencePromise: "Make healthy defaults feel aesthetically easy instead of intense.",
        toneRules: ["minimal hype", "precise observations", "visual proof before CTA"],
      },
      postingStrategy: {
        weeklyCadence: [
          { laneId: "lane_persona_building", postsPerWeek: 4, purpose: "followers" },
          { laneId: "lane_conversion_demo", postsPerWeek: 3, purpose: "conversion" },
        ],
        contentLanes: [
          {
            id: "lane_persona_building",
            label: "Soft routine posts",
            description: "Non-CTA clips that build taste, continuity, and follower affinity.",
            defaultStageIds: ["stage_non_cta", "stage_edit_style"],
          },
          {
            id: "lane_conversion_demo",
            label: "Quiet product proof",
            description: "Demo/proof posts with lower-pressure CTAs and editable product slots.",
            defaultStageIds: ["stage_hook", "stage_proof_demo", "stage_cta"],
          },
        ],
      },
      continuity: {
        stableIdentityFields: ["face family", "hair length", "accent", "soft direct-camera persona", "fitness-snack niche"],
        mutableIdentityFields: ["outfit color", "room background", "CTA pressure", "caption template", "product demo prop"],
        continuityWarnings: ["Do not drift into generic Western gym influencer styling.", "Do not make every post an ad."],
        jsonManifest: {
          version: 1,
          personaId: "persona_seoul_gym_diary",
          continuityKey: "kbeauty-soft-fitness",
          stableSeedPolicy: "reuse_profile_seed_with_pose_variation",
        },
      },
      sampleClipIds: ["candidate_soft_demo_01", "candidate_non_cta_routine_01"],
      branchSnapshotIds: ["branch_kbeauty_soft_authority"],
      notes: ["Best current persona lane.", "Needs more specific gestures and less generic UGC smile."],
    },
    {
      id: "persona_deadpan_runner",
      displayName: "Deadpan Runner",
      handle: "@deadpanfuel.ai",
      status: "draft",
      avatarPrompt: "Synthetic runner creator, dry delivery, morning commute, practical snack review.",
      genreLane: "deadpan fitness micro-vlog",
      appearance: {
        ageRange: "mid 20s",
        ethnicityStyleLane: "synthetic mixed-ethnicity creator with everyday styling",
        hair: "short dark hair",
        wardrobe: ["running jacket", "plain tee", "wired earbuds"],
        visualNotes: ["more grounded", "less beauty optimized", "good for proof and pain-point hooks"],
        imageReferenceIds: ["asset_runner_pose_sheet_01"],
      },
      voice: {
        voiceId: "voice_deadpan_runner_en",
        accent: "neutral English",
        speakingStyle: "dry, clipped, practical",
        energy: 52,
        catchphrases: ["I tested this because I was annoyed.", "Fine. This works.", "Not glamorous."],
        avoid: ["cute dances", "high-gloss idol look"],
      },
      profileBible: {
        niche: "practical snacks for runners and commuters",
        specialInterests: ["running", "commuting", "desk lunches"],
        influences: ["deadpan product tests", "quick transit vlogs"],
        promotes: ["protein bars", "meal prep shortcuts"],
        audiencePromise: "No-nonsense tests for people who need food that behaves.",
        toneRules: ["dry joke first", "proof shot second", "CTA only if the product earns it"],
      },
      postingStrategy: {
        weeklyCadence: [
          { laneId: "lane_deadpan_tests", postsPerWeek: 5, purpose: "authority" },
          { laneId: "lane_conversion_demo", postsPerWeek: 2, purpose: "conversion" },
        ],
        contentLanes: [
          {
            id: "lane_deadpan_tests",
            label: "Deadpan tests",
            description: "Non-glossy test posts that make the persona feel less manufactured.",
            defaultStageIds: ["stage_format", "stage_proof_demo"],
          },
        ],
      },
      continuity: {
        stableIdentityFields: ["deadpan delivery", "commute/run contexts", "practical snack lane"],
        mutableIdentityFields: ["location", "weather", "hook family", "CTA wording"],
        continuityWarnings: ["May be less visually striking than the Korean-beauty lane."],
        jsonManifest: {
          version: 1,
          personaId: "persona_deadpan_runner",
          continuityKey: "deadpan-runner-practical",
        },
      },
      sampleClipIds: ["candidate_deadpan_test_01"],
      branchSnapshotIds: ["branch_deadpan_practical"],
      notes: ["Good contrast lane, but not the main visual direction."],
    },
  ],
  referenceProfiles: [
    {
      id: "ref_my_name_is_siko_research_target",
      platform: "tiktok",
      handle: "@mynameissiko",
      displayName: "My Name Is Siko",
      rightsStatus: "public-research-target",
      archiveStatus: "not-started",
      styleLane: "profile-level reference target",
      useCase: "Study pose timing, profile structure, recurring formats, and gesture rhythm before generating clean-room variants.",
      cleanRoomBoundary: [
        "Do not clone recognizable face, body identity, voice, exact captions, or raw media.",
        "Store abstract mechanics only until rights are confirmed.",
        "Prioritize pose/timing and format grammar over identity replication.",
      ],
      sampleClips: [
        {
          id: "ref_clip_siko_placeholder_01",
          title: "Research placeholder",
          sourceUrl: null,
          durationSeconds: 0,
          storagePolicy: "store-abstract-mechanics",
          extractedFields: ["pose timing", "gesture rhythm", "posting strategy"],
        },
      ],
      extractedMechanics: {
        poseTiming: "not extracted yet",
        gestureRhythm: "not extracted yet",
        shotStructure: ["profile archive needed"],
        captionTemplate: "not extracted yet",
        hookFamilies: ["to be mined"],
        ctaPatterns: ["to be mined"],
        nonAdPatterns: ["to be mined"],
      },
      remixFields: [
        remixFieldPoseTiming,
        remixFieldCaptionTemplate,
        remixFieldSyntheticPersona,
        remixFieldVoice,
        remixFieldSourceMedia,
      ],
    },
    {
      id: "ref_faceless_caption_template_pack",
      platform: "internal-pack",
      handle: "faceless-caption-pack",
      displayName: "Faceless Caption Template Pack",
      rightsStatus: "rights-cleared",
      archiveStatus: "decomposed",
      styleLane: "faceless TikTok template cloning",
      useCase: "Copy timing, b-roll structure, hook grammar, and caption mechanics while swapping product and copy.",
      cleanRoomBoundary: [
        "Use generated b-roll and source-owned product clips.",
        "Preserve abstract layout and cadence, not source pixels.",
      ],
      sampleClips: [
        {
          id: "ref_clip_faceless_01",
          title: "Hands + product + bold caption hook",
          sourceUrl: null,
          durationSeconds: 17,
          storagePolicy: "store-abstract-mechanics",
          extractedFields: ["caption template", "shot rhythm", "product slot", "CTA pattern"],
        },
      ],
      extractedMechanics: {
        poseTiming: "hands enter at 0.8s, product reveal at 2.4s, proof insert at 7.5s",
        gestureRhythm: "fast hand placement, two jump cuts, one hold for proof text",
        shotStructure: ["macro product setup", "hand interaction", "proof insert", "CTA card"],
        captionTemplate: "top-left problem text, center punchline, bottom CTA sticker",
        hookFamilies: ["I stopped buying X after this", "This is the lazy version of X"],
        ctaPatterns: ["tap link below", "try it risk-free today"],
        nonAdPatterns: ["routine montage", "desk snack reset"],
      },
      remixFields: [remixFieldPoseTiming, remixFieldCaptionTemplate, remixFieldSyntheticPersona, remixFieldVoice],
    },
  ],
  formatStages: [
    {
      id: "stage_persona",
      kind: "persona",
      title: "Persona Atlas",
      description: "Generate whole TikTok-profile-like synthetic hosts before making individual clips.",
      position: { x: 80, y: 120 },
      inputIds: ["brief_clean_fuel_bar"],
      outputIds: ["persona_seoul_gym_diary", "persona_deadpan_runner"],
      connectedStageIds: ["stage_format", "stage_non_cta"],
      exampleCarousel: [
        {
          id: "example_persona_seoul",
          title: "Seoul Gym Diary profile card",
          mediaKind: "json",
          previewUrl: "fixture://persona/persona_seoul_gym_diary",
          summary: "Promising Korean-beauty fitness lane with soft authority.",
          linkedCandidateId: null,
        },
      ],
      agentPromptCard: {
        id: "prompt_persona_generate",
        title: "Generate profile candidates",
        prompt: "Create 12 synthetic influencer profiles with stable voice, niche, posting strategy, and continuity JSON.",
        editableFields: ["genreLane", "voice.accent", "postingStrategy", "continuity"],
        manifestJson: {
          stage: "persona",
          count: 12,
          output: "persona_profile_collection",
        },
      },
    },
    {
      id: "stage_format",
      kind: "format",
      title: "Format Exploration",
      description: "Try reusable post structures before committing to final ads.",
      position: { x: 360, y: 110 },
      inputIds: ["persona_seoul_gym_diary", "ref_faceless_caption_template_pack"],
      outputIds: ["candidate_format_soft_demo_01"],
      connectedStageIds: ["stage_hook", "stage_proof_demo"],
      exampleCarousel: [
        {
          id: "example_format_demo",
          title: "Quiet demo format",
          mediaKind: "video",
          previewUrl: "fixture://candidate/candidate_soft_demo_01",
          summary: "Direct-camera hook with product macro insert and soft proof text.",
          linkedCandidateId: "candidate_soft_demo_01",
        },
      ],
      agentPromptCard: {
        id: "prompt_format_variants",
        title: "Generate format routes",
        prompt: "Produce six format routes, each with preserved editable slots for hook, proof, captions, CTA, and b-roll.",
        editableFields: ["hookFamily", "proofSlot", "captionTemplate", "ctaPressure"],
        manifestJson: {
          stage: "format",
          variants: 6,
          requiredSlots: ["hook", "proof", "caption", "cta", "broll"],
        },
      },
    },
    {
      id: "stage_hook",
      kind: "hook",
      title: "Hook Batch",
      description: "Babble-and-prune hooks with playable examples and quick notes.",
      position: { x: 650, y: 120 },
      inputIds: ["candidate_format_soft_demo_01"],
      outputIds: ["candidate_soft_demo_01", "candidate_soft_demo_02", "candidate_deadpan_test_01"],
      connectedStageIds: ["stage_proof_demo", "stage_cta"],
      exampleCarousel: [
        {
          id: "example_hook_soft_demo",
          title: "More energy, better focus",
          mediaKind: "video",
          previewUrl: "fixture://candidate/candidate_soft_demo_01",
          summary: "Best current hook, but still needs less generic product language.",
          linkedCandidateId: "candidate_soft_demo_01",
        },
        {
          id: "example_hook_non_cta",
          title: "Desk snack reset",
          mediaKind: "video",
          previewUrl: "fixture://candidate/candidate_non_cta_routine_01",
          summary: "Non-CTA routine post that builds profile continuity.",
          linkedCandidateId: "candidate_non_cta_routine_01",
        },
      ],
      agentPromptCard: {
        id: "prompt_hook_prune",
        title: "Revise selected hooks",
        prompt: "For selected candidates, make the host less salesy, preserve timing, and generate five alternate hooks.",
        editableFields: ["hookText", "energy", "ctaPressure", "captionTone"],
        manifestJson: {
          stage: "hook",
          selectedSet: "batch_hooks_round_02",
          generateMore: 5,
        },
      },
    },
    {
      id: "stage_cta",
      kind: "cta",
      title: "CTA Tests",
      description: "Test conversion pressure separately from persona-building posts.",
      position: { x: 930, y: 115 },
      inputIds: ["candidate_soft_demo_01"],
      outputIds: ["candidate_cta_risk_free_01"],
      connectedStageIds: ["stage_final_polish"],
      exampleCarousel: [
        {
          id: "example_cta_risk_free",
          title: "Try it risk-free today",
          mediaKind: "text",
          previewUrl: "fixture://candidate/candidate_cta_risk_free_01",
          summary: "Simple CTA card, needs metric tracking once exported.",
          linkedCandidateId: "candidate_cta_risk_free_01",
        },
      ],
      agentPromptCard: {
        id: "prompt_cta_test",
        title: "CTA matrix",
        prompt: "Create CTA variants across urgency, risk reversal, proof, and low-pressure follow-through.",
        editableFields: ["ctaCopy", "ctaTiming", "riskReversal", "productClaim"],
        manifestJson: {
          stage: "cta",
          variants: ["urgency", "risk_reversal", "proof", "low_pressure"],
        },
      },
    },
    {
      id: "stage_non_cta",
      kind: "non-cta",
      title: "Persona-Building Posts",
      description: "Generate non-ad clips that build the synthetic profile's taste and continuity.",
      position: { x: 360, y: 360 },
      inputIds: ["persona_seoul_gym_diary"],
      outputIds: ["candidate_non_cta_routine_01"],
      connectedStageIds: ["stage_hook"],
      exampleCarousel: [
        {
          id: "example_non_cta_routine",
          title: "Morning snack routine",
          mediaKind: "video",
          previewUrl: "fixture://candidate/candidate_non_cta_routine_01",
          summary: "No explicit CTA; useful for profile credibility and follower-building.",
          linkedCandidateId: "candidate_non_cta_routine_01",
        },
      ],
      agentPromptCard: {
        id: "prompt_non_cta_posts",
        title: "Generate profile filler",
        prompt: "Create non-CTA posts that make this synthetic host feel like a recurring profile, not a one-off ad.",
        editableFields: ["trendType", "personaContinuity", "captionStyle", "musicCue"],
        manifestJson: {
          stage: "non_cta",
          ratio: 0.5,
          goal: "profile_continuity",
        },
      },
    },
    {
      id: "stage_final_polish",
      kind: "final-polish",
      title: "Final Layer Editor",
      description: "Late-stage layer, caption, voice, b-roll, product demo, and export tuning.",
      position: { x: 1200, y: 120 },
      inputIds: ["candidate_soft_demo_01", "candidate_cta_risk_free_01"],
      outputIds: ["editor_clean_fuel_soft_demo"],
      connectedStageIds: [],
      exampleCarousel: [
        {
          id: "example_final_timeline",
          title: "Editable layer timeline",
          mediaKind: "json",
          previewUrl: "fixture://editor/editor_clean_fuel_soft_demo",
          summary: "Host, product demo, b-roll, captions, CTA, and audio tracks stay separate.",
          linkedCandidateId: "candidate_soft_demo_01",
        },
      ],
      agentPromptCard: {
        id: "prompt_final_polish",
        title: "Polish selected clip",
        prompt: "Tighten caption timing, lower CTA pressure, and keep all text as editable post layers.",
        editableFields: ["captionTiming", "audioMix", "ctaSticker", "exportPreset"],
        manifestJson: {
          stage: "final_polish",
          keepLayersEditable: true,
        },
      },
    },
  ],
  candidateBatches: [
    {
      id: "batch_persona_round_01",
      title: "Persona atlas first pass",
      branchSnapshotId: "branch_root",
      stageId: "stage_persona",
      personaIds: ["persona_seoul_gym_diary", "persona_deadpan_runner"],
      referenceProfileIds: [],
      candidateIds: [],
      generationGoal: "Find striking recurring hosts before generating individual ads.",
      requestedCount: 12,
      completedCount: 2,
      reviewSummary: "Korean-beauty soft authority lane is strongest; deadpan runner is useful contrast.",
    },
    {
      id: "batch_hooks_round_02",
      title: "Hook and proof variants",
      branchSnapshotId: "branch_kbeauty_soft_authority",
      stageId: "stage_hook",
      personaIds: ["persona_seoul_gym_diary"],
      referenceProfileIds: ["ref_faceless_caption_template_pack"],
      candidateIds: ["candidate_soft_demo_01", "candidate_soft_demo_02", "candidate_non_cta_routine_01"],
      generationGoal: "Generate playable hooks and profile-building posts while preserving editable layer manifests.",
      requestedCount: 10,
      completedCount: 3,
      reviewSummary: "One strong demo, one overly generic demo, one good non-CTA continuity post.",
    },
  ],
  candidates: [
    {
      id: "candidate_soft_demo_01",
      kind: "ad-clip",
      title: "More energy. Better focus. Every day.",
      status: "starred",
      stageId: "stage_hook",
      batchId: "batch_hooks_round_02",
      personaId: "persona_seoul_gym_diary",
      referenceProfileId: "ref_faceless_caption_template_pack",
      durationSeconds: 24,
      preview: {
        posterUrl: "fixture://poster/soft-demo-01.png",
        videoUrl: "fixture://video/soft-demo-01.mp4",
        transcript: [
          { startSeconds: 0, endSeconds: 2.2, text: "I needed a snack that did not feel like homework." },
          { startSeconds: 2.2, endSeconds: 8.1, text: "This one is simple: protein, low sugar, no weird crash later." },
          { startSeconds: 18.4, endSeconds: 23.1, text: "If you want the lazy version, try it below." },
        ],
        visibleInputs: [
          { label: "Persona", value: "Seoul Gym Diary", kind: "persona" },
          { label: "Hook", value: "snack that did not feel like homework", kind: "hook" },
          { label: "Product", value: "Clean Fuel Protein Bar", kind: "product" },
          { label: "Reference", value: "Faceless caption pack timing", kind: "reference" },
        ],
      },
      scorecard: {
        overall: 86,
        hookStrength: 82,
        personaFit: 91,
        formatFit: 84,
        conversionPotential: 78,
        novelty: 71,
        issues: ["CTA could be less abrupt.", "Caption should feel more native to the persona."],
      },
      tags: ["kbeauty", "soft-authority", "product-demo", "low-pressure-cta"],
      recipe: {
        recipeId: "recipe_soft_demo_01",
        providerRoute: "route_kie_video_then_post_layers",
        sourceStageIds: ["stage_persona", "stage_format", "stage_hook", "stage_cta"],
        manifestJson: {
          version: 1,
          candidateId: "candidate_soft_demo_01",
          layers: ["host", "product-demo", "b-roll", "captions", "voice", "cta"],
          editableText: true,
          referenceProfileId: "ref_faceless_caption_template_pack",
        },
        costEstimateUsd: 1.85,
      },
      reviewNoteIds: ["note_soft_demo_keep", "note_soft_demo_revision"],
    },
    {
      id: "candidate_soft_demo_02",
      kind: "ad-clip",
      title: "Stop buying chalky protein bars",
      status: "needs-revision",
      stageId: "stage_hook",
      batchId: "batch_hooks_round_02",
      personaId: "persona_seoul_gym_diary",
      referenceProfileId: null,
      durationSeconds: 22,
      preview: {
        posterUrl: "fixture://poster/soft-demo-02.png",
        videoUrl: "fixture://video/soft-demo-02.mp4",
        transcript: [
          { startSeconds: 0, endSeconds: 2.5, text: "Stop buying chalky protein bars." },
          { startSeconds: 2.5, endSeconds: 7, text: "This one actually tastes normal." },
        ],
        visibleInputs: [
          { label: "Persona", value: "Seoul Gym Diary", kind: "persona" },
          { label: "Hook", value: "Stop buying chalky protein bars", kind: "hook" },
          { label: "Issue", value: "too generic", kind: "metric" },
        ],
      },
      scorecard: {
        overall: 62,
        hookStrength: 58,
        personaFit: 70,
        formatFit: 65,
        conversionPotential: 61,
        novelty: 38,
        issues: ["Generic hook.", "Does not exploit persona specificity.", "Needs a better proof beat."],
      },
      tags: ["generic", "revise", "product-demo"],
      recipe: {
        recipeId: "recipe_soft_demo_02",
        providerRoute: "route_fast_draft_video",
        sourceStageIds: ["stage_persona", "stage_hook"],
        manifestJson: {
          version: 1,
          candidateId: "candidate_soft_demo_02",
          reviseInstruction: "less generic, more persona-specific",
        },
        costEstimateUsd: 0.95,
      },
      reviewNoteIds: ["note_soft_demo_revision"],
    },
    {
      id: "candidate_non_cta_routine_01",
      kind: "profile-post",
      title: "Desk snack reset",
      status: "ready",
      stageId: "stage_non_cta",
      batchId: "batch_hooks_round_02",
      personaId: "persona_seoul_gym_diary",
      referenceProfileId: null,
      durationSeconds: 15,
      preview: {
        posterUrl: "fixture://poster/non-cta-routine-01.png",
        videoUrl: "fixture://video/non-cta-routine-01.mp4",
        transcript: [
          { startSeconds: 0, endSeconds: 4, text: "My 3 p.m. reset is embarrassingly simple." },
          { startSeconds: 4, endSeconds: 12, text: "Water, snack, ten-minute walk, no dramatic productivity arc." },
        ],
        visibleInputs: [
          { label: "Purpose", value: "persona-building", kind: "metric" },
          { label: "CTA", value: "none", kind: "caption" },
        ],
      },
      scorecard: {
        overall: 77,
        hookStrength: 72,
        personaFit: 86,
        formatFit: 76,
        conversionPotential: 45,
        novelty: 66,
        issues: ["Good continuity post, but product presence should remain subtle."],
      },
      tags: ["non-cta", "profile-continuity", "routine"],
      recipe: {
        recipeId: "recipe_non_cta_routine_01",
        providerRoute: "route_fast_draft_video",
        sourceStageIds: ["stage_persona", "stage_non_cta"],
        manifestJson: {
          version: 1,
          candidateId: "candidate_non_cta_routine_01",
          cta: null,
          purpose: "followers",
        },
        costEstimateUsd: 0.8,
      },
      reviewNoteIds: ["note_non_cta_keep"],
    },
    {
      id: "candidate_deadpan_test_01",
      kind: "ad-clip",
      title: "I tested this because I was annoyed",
      status: "ready",
      stageId: "stage_hook",
      batchId: "batch_hooks_round_02",
      personaId: "persona_deadpan_runner",
      referenceProfileId: null,
      durationSeconds: 19,
      preview: {
        posterUrl: "fixture://poster/deadpan-test-01.png",
        videoUrl: "fixture://video/deadpan-test-01.mp4",
        transcript: [
          { startSeconds: 0, endSeconds: 2, text: "I tested this because I was annoyed." },
          { startSeconds: 2, endSeconds: 12, text: "Most bars melt, crumble, or taste like regret. This one behaved." },
        ],
        visibleInputs: [
          { label: "Persona", value: "Deadpan Runner", kind: "persona" },
          { label: "Hook", value: "tested this because I was annoyed", kind: "hook" },
        ],
      },
      scorecard: {
        overall: 74,
        hookStrength: 80,
        personaFit: 83,
        formatFit: 71,
        conversionPotential: 67,
        novelty: 69,
        issues: ["Less visually optimized than the main persona lane."],
      },
      tags: ["deadpan", "practical", "contrast-lane"],
      recipe: {
        recipeId: "recipe_deadpan_test_01",
        providerRoute: "route_fast_draft_video",
        sourceStageIds: ["stage_persona", "stage_hook", "stage_proof_demo"],
        manifestJson: {
          version: 1,
          candidateId: "candidate_deadpan_test_01",
          personaLane: "deadpan-practical",
        },
        costEstimateUsd: 0.9,
      },
      reviewNoteIds: [],
    },
    {
      id: "candidate_cta_risk_free_01",
      kind: "cta",
      title: "Try it risk-free today",
      status: "queued",
      stageId: "stage_cta",
      batchId: "batch_hooks_round_02",
      personaId: "persona_seoul_gym_diary",
      referenceProfileId: null,
      durationSeconds: 4,
      preview: {
        posterUrl: "fixture://poster/cta-risk-free-01.png",
        videoUrl: null,
        transcript: [{ startSeconds: 0, endSeconds: 4, text: "Try it risk-free today." }],
        visibleInputs: [
          { label: "CTA", value: "risk-free", kind: "caption" },
          { label: "Timing", value: "final four seconds", kind: "metric" },
        ],
      },
      scorecard: {
        overall: 68,
        hookStrength: 60,
        personaFit: 67,
        formatFit: 70,
        conversionPotential: 75,
        novelty: 40,
        issues: ["Needs A/B test against lower-pressure CTA copy."],
      },
      tags: ["cta", "risk-reversal", "needs-test"],
      recipe: {
        recipeId: "recipe_cta_risk_free_01",
        providerRoute: "route_post_layer_only",
        sourceStageIds: ["stage_cta"],
        manifestJson: {
          version: 1,
          candidateId: "candidate_cta_risk_free_01",
          renderAsLayer: true,
        },
        costEstimateUsd: 0.05,
      },
      reviewNoteIds: [],
    },
  ],
  reviewNotes: [
    {
      id: "note_soft_demo_keep",
      author: "arthur",
      createdAt: "2026-06-09T17:10:00+10:00",
      attachedTo: { kind: "candidate", id: "candidate_soft_demo_01" },
      verdict: "keep",
      body: "This is the closest to the right lane: quiet, visually optimized, not too salesy.",
      requestedChange: null,
      followUpActionId: null,
    },
    {
      id: "note_soft_demo_revision",
      author: "agent",
      createdAt: "2026-06-09T17:14:00+10:00",
      attachedTo: { kind: "batch", id: "batch_hooks_round_02" },
      verdict: "revise",
      body: "Selected set should be regenerated with more persona-specific hooks and lower generic UGC energy.",
      requestedChange: "Make her less enthusiastic and more precise; generate five more variations.",
      followUpActionId: "action_generate_kbeauty_hooks",
    },
    {
      id: "note_non_cta_keep",
      author: "arthur",
      createdAt: "2026-06-09T17:18:00+10:00",
      attachedTo: { kind: "candidate", id: "candidate_non_cta_routine_01" },
      verdict: "fork",
      body: "Useful for the whole-profile direction. Fork this into a few non-ad posts so the profile is not only CTA ads.",
      requestedChange: "Create five more routine posts without explicit CTA.",
      followUpActionId: null,
    },
  ],
  branchSnapshots: [
    {
      id: "branch_root",
      parentId: null,
      title: "Root product brief",
      status: "active",
      createdAt: "2026-06-09T16:40:00+10:00",
      focus: "Protein bar product brief and initial UGC directions.",
      decisionNote: "Start broad before deciding on persona lane.",
      selectedPersonaIds: [],
      selectedCandidateIds: [],
      candidateBatchIds: ["batch_persona_round_01"],
      childIds: ["branch_kbeauty_soft_authority", "branch_deadpan_practical"],
      metrics: [
        { label: "Personas generated", value: "12 requested / 2 modeled", trend: "flat", note: "Fixture keeps two representative lanes." },
      ],
    },
    {
      id: "branch_kbeauty_soft_authority",
      parentId: "branch_root",
      title: "Korean-beauty soft authority",
      status: "promising",
      createdAt: "2026-06-09T17:02:00+10:00",
      focus: "Visually striking recurring host with low-pressure fitness snack content.",
      decisionNote: "Main branch because the persona lane is more optimized and memorable.",
      selectedPersonaIds: ["persona_seoul_gym_diary"],
      selectedCandidateIds: ["candidate_soft_demo_01", "candidate_non_cta_routine_01"],
      candidateBatchIds: ["batch_hooks_round_02"],
      childIds: ["branch_kbeauty_cta_tests"],
      metrics: [
        { label: "Creative fit", value: "86", trend: "up", note: "Best current persona/format match." },
        { label: "CTA pressure", value: "medium", trend: "flat", note: "Needs lower-pressure variants." },
      ],
    },
    {
      id: "branch_deadpan_practical",
      parentId: "branch_root",
      title: "Deadpan practical runner",
      status: "active",
      createdAt: "2026-06-09T17:06:00+10:00",
      focus: "Dry practical test persona as contrast lane.",
      decisionNote: "Keep as comparison but do not make it the style north star.",
      selectedPersonaIds: ["persona_deadpan_runner"],
      selectedCandidateIds: ["candidate_deadpan_test_01"],
      candidateBatchIds: [],
      childIds: [],
      metrics: [
        { label: "Novelty", value: "69", trend: "flat", note: "Voice works; visual system is less differentiated." },
      ],
    },
    {
      id: "branch_kbeauty_cta_tests",
      parentId: "branch_kbeauty_soft_authority",
      title: "CTA pressure matrix",
      status: "active",
      createdAt: "2026-06-09T17:24:00+10:00",
      focus: "Compare low-pressure, risk-reversal, proof-led, and direct CTA endings.",
      decisionNote: "Future metrics should choose CTA behavior, not taste alone.",
      selectedPersonaIds: ["persona_seoul_gym_diary"],
      selectedCandidateIds: ["candidate_cta_risk_free_01"],
      candidateBatchIds: [],
      childIds: [],
      metrics: [
        { label: "CTA variants", value: "4 queued", trend: "up", note: "Needs export and metrics ingestion later." },
      ],
    },
  ],
  finalEditor: {
    id: "editor_clean_fuel_soft_demo",
    selectedCandidateId: "candidate_soft_demo_01",
    durationSeconds: 24,
    resolution: { width: 1080, height: 1920 },
    tracks: [
      {
        id: "track_host",
        kind: "host",
        label: "Host persona",
        locked: false,
        visible: true,
        clips: [
          {
            id: "clip_host_01",
            label: "Direct-camera host",
            startSeconds: 0,
            durationSeconds: 24,
            assetId: "asset_host_pose_render_01",
            sourceCandidateId: "candidate_soft_demo_01",
            editableFields: ["poseTimeline", "crop", "background"],
          },
        ],
      },
      {
        id: "track_product_demo",
        kind: "product-demo",
        label: "Product demo",
        locked: false,
        visible: true,
        clips: [
          {
            id: "clip_product_macro_01",
            label: "Protein bar macro cutaway",
            startSeconds: 3.5,
            durationSeconds: 7,
            assetId: "asset_product_macro_bar_01",
            sourceCandidateId: "candidate_soft_demo_01",
            editableFields: ["shotOrder", "colorGrade", "proofSlot"],
          },
        ],
      },
      {
        id: "track_captions",
        kind: "captions",
        label: "Captions",
        locked: false,
        visible: true,
        clips: [
          {
            id: "clip_caption_hook_01",
            label: "Hook caption",
            startSeconds: 0,
            durationSeconds: 4.2,
            assetId: "asset_caption_bold_soft_01",
            sourceCandidateId: "candidate_soft_demo_01",
            editableFields: ["text", "timing", "layout", "font"],
          },
          {
            id: "clip_caption_cta_01",
            label: "CTA sticker",
            startSeconds: 19.2,
            durationSeconds: 4.8,
            assetId: "asset_cta_sticker_01",
            sourceCandidateId: "candidate_cta_risk_free_01",
            editableFields: ["text", "position", "pressure"],
          },
        ],
      },
      {
        id: "track_voice",
        kind: "voice",
        label: "Voice",
        locked: false,
        visible: true,
        clips: [
          {
            id: "clip_voice_01",
            label: "Soft confident voice",
            startSeconds: 0,
            durationSeconds: 23,
            assetId: "asset_voice_soft_confident_kr_en_01",
            sourceCandidateId: "candidate_soft_demo_01",
            editableFields: ["script", "accent", "energy", "pace"],
          },
        ],
      },
      {
        id: "track_audio",
        kind: "audio",
        label: "Music bed",
        locked: false,
        visible: true,
        clips: [
          {
            id: "clip_music_bed_01",
            label: "Low-key beat",
            startSeconds: 0,
            durationSeconds: 24,
            assetId: "asset_audio_low_key_beat_01",
            sourceCandidateId: null,
            editableFields: ["volume", "ducking", "beatMarkers"],
          },
        ],
      },
    ],
    exportPresets: [
      {
        id: "preset_tiktok_9x16",
        label: "TikTok 9:16",
        platform: "tiktok",
        manifestJson: {
          fps: 30,
          width: 1080,
          height: 1920,
          captionsBurnedIn: true,
        },
      },
      {
        id: "preset_local_layers",
        label: "Local layered manifest",
        platform: "local",
        manifestJson: {
          export: "json_manifest_plus_assets",
          preserveEditableLayers: true,
        },
      },
    ],
  },
  developerGraph: {
    id: "graph_clean_fuel_workflow",
    title: "Clean Fuel UGC generation graph",
    visibleByDefault: false,
    nodes: [
      {
        id: "node_product_brief",
        kind: "input",
        title: "Product brief JSON",
        status: "ready",
        position: { x: 40, y: 90 },
        inputs: [],
        outputs: [{ id: "out_brief", label: "brief", valueType: "json" }],
        parameters: [{ key: "briefId", label: "Brief", value: "brief_clean_fuel_bar" }],
      },
      {
        id: "node_persona_agent",
        kind: "llm",
        title: "Persona/profile generator",
        status: "ready",
        position: { x: 320, y: 60 },
        inputs: [{ id: "in_brief", label: "brief", valueType: "json" }],
        outputs: [{ id: "out_personas", label: "personas", valueType: "json" }],
        parameters: [
          { key: "count", label: "Count", value: 12 },
          { key: "lane", label: "Lane", value: "korean_beauty_fitness" },
        ],
      },
      {
        id: "node_reference_pose",
        kind: "pose",
        title: "Reference pose/timing extraction",
        status: "blocked",
        position: { x: 320, y: 250 },
        inputs: [{ id: "in_reference", label: "reference profile", valueType: "video" }],
        outputs: [{ id: "out_pose", label: "pose timeline", valueType: "pose" }],
        parameters: [
          { key: "storagePolicy", label: "Storage policy", value: "abstract_mechanics_only" },
          { key: "rightsStatus", label: "Rights status", value: "public_research_target" },
        ],
      },
      {
        id: "node_video_gen",
        kind: "video",
        title: "Draft video generation",
        status: "ready",
        position: { x: 640, y: 115 },
        inputs: [
          { id: "in_personas", label: "personas", valueType: "json" },
          { id: "in_pose", label: "pose optional", valueType: "pose" },
        ],
        outputs: [{ id: "out_video", label: "video candidates", valueType: "video" }],
        parameters: [
          { key: "variants", label: "Variants", value: 10 },
          { key: "keepLayers", label: "Keep layers", value: true },
        ],
      },
      {
        id: "node_caption_layers",
        kind: "caption",
        title: "Caption/template layers",
        status: "ready",
        position: { x: 920, y: 130 },
        inputs: [
          { id: "in_video", label: "video", valueType: "video" },
          { id: "in_script", label: "script", valueType: "text" },
        ],
        outputs: [{ id: "out_captioned", label: "layered candidate", valueType: "json" }],
        parameters: [{ key: "editableText", label: "Editable text", value: true }],
      },
      {
        id: "node_review_eval",
        kind: "eval",
        title: "Creative review scorecard",
        status: "ready",
        position: { x: 1200, y: 130 },
        inputs: [{ id: "in_candidate", label: "candidate", valueType: "json" }],
        outputs: [{ id: "out_metrics", label: "scorecard", valueType: "metrics" }],
        parameters: [{ key: "rubric", label: "Rubric", value: "hook_persona_format_conversion" }],
      },
    ],
    edges: [
      {
        id: "edge_brief_to_persona",
        fromNodeId: "node_product_brief",
        fromPortId: "out_brief",
        toNodeId: "node_persona_agent",
        toPortId: "in_brief",
        label: "brief",
      },
      {
        id: "edge_persona_to_video",
        fromNodeId: "node_persona_agent",
        fromPortId: "out_personas",
        toNodeId: "node_video_gen",
        toPortId: "in_personas",
        label: "profile candidates",
      },
      {
        id: "edge_pose_to_video",
        fromNodeId: "node_reference_pose",
        fromPortId: "out_pose",
        toNodeId: "node_video_gen",
        toPortId: "in_pose",
        label: "optional pose timing",
      },
      {
        id: "edge_video_to_captions",
        fromNodeId: "node_video_gen",
        fromPortId: "out_video",
        toNodeId: "node_caption_layers",
        toPortId: "in_video",
        label: "draft candidates",
      },
      {
        id: "edge_captions_to_eval",
        fromNodeId: "node_caption_layers",
        fromPortId: "out_captioned",
        toNodeId: "node_review_eval",
        toPortId: "in_candidate",
        label: "layered manifest",
      },
    ],
    providerRoutes: [
      {
        id: "route_fast_draft_video",
        label: "Fast draft video",
        provider: "kie",
        model: "fast-video-draft",
        maxConcurrency: 1,
        spendCapUsd: 20,
      },
      {
        id: "route_kie_video_then_post_layers",
        label: "Video draft plus post layers",
        provider: "kie+local",
        model: "video-draft/post-layer-compose",
        maxConcurrency: 1,
        spendCapUsd: 35,
      },
      {
        id: "route_post_layer_only",
        label: "Post layer only",
        provider: "local",
        model: "editable-caption-compose",
        maxConcurrency: 4,
        spendCapUsd: 1,
      },
    ],
  },
  referenceRemixPlans: [
    {
      id: "remix_plan_siko_clean_room",
      referenceProfileId: "ref_my_name_is_siko_research_target",
      targetPersonaId: "persona_seoul_gym_diary",
      targetProductBriefId: "brief_clean_fuel_bar",
      goal: "Use a public profile as a research target for abstract timing/profile mechanics, then swap in a synthetic persona, voice, hooks, captions, and product.",
      preservedFields: [remixFieldPoseTiming, remixFieldCaptionTemplate],
      swappedFields: [remixFieldSyntheticPersona, remixFieldVoice],
      blockedFields: [remixFieldSourceMedia],
      outputCandidateIds: [],
      guardrails: [
        "No raw source media in generated output.",
        "No real creator face/body/voice cloning.",
        "Rewrite hooks and captions for the user's product.",
        "Prefer faceless or rights-cleared profiles for first implementation.",
      ],
    },
    {
      id: "remix_plan_faceless_caption_pack",
      referenceProfileId: "ref_faceless_caption_template_pack",
      targetPersonaId: "persona_seoul_gym_diary",
      targetProductBriefId: "brief_clean_fuel_bar",
      goal: "Preserve faceless caption timing and product-shot grammar while swapping all product claims, copy, and generated media.",
      preservedFields: [remixFieldPoseTiming, remixFieldCaptionTemplate],
      swappedFields: [remixFieldSyntheticPersona, remixFieldVoice],
      blockedFields: [],
      outputCandidateIds: ["candidate_soft_demo_01"],
      guardrails: [
        "Use generated or user-owned b-roll.",
        "Keep visible text editable.",
        "Track source mechanics in JSON, not in hidden prompt text.",
      ],
    },
  ],
} satisfies UgcStudioWorkspace
