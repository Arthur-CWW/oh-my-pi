export const meta = {
  name: "tiktok_recreate_bootstrap",
  description: "Clean-room TikTok recreation bootstrap for a public profile",
  whenToUse:
    "Use when you have a public TikTok download manifest and Antigravity decompositions for a profile, and you want to derive abstract mechanics, design a synthetic Jimeng persona, plan KIE image plates, plan MiniMax synthetic narration audio, and plan Remotion/Slotok handoff artifacts without copying likeness, voice, or copyrighted media.",
  phases: [
    { title: "Intake", detail: "Validate args and load the source manifest" },
    { title: "Decompose", detail: "Parallel analysis of frame/VTT and native MP4 probe lanes" },
    { title: "Persona", detail: "Design synthetic Jimeng persona" },
    { title: "Plan", detail: "Plan KIE image plates, MiniMax TTS narration, Remotion layers, and provider routes" },
    { title: "Synthesize", detail: "Review and emit JSON-safe handoff" },
  ],
}

const sourceProfile = args.sourceProfile || ""
const manifestPath = args.manifestPath || ""
const decompositionPaths = Array.isArray(args.decompositionPaths) ? args.decompositionPaths : []
const lane = args.lane || "frame-vtt-omp-antigravity"
const model = args.model || "google-antigravity/gemini-3.5-flash-low"
const jimengPersonaMode = args.jimengPersonaMode || "synthetic-narrator"
const kieMode = args.kieMode || "dry-run"
const kieOutDir = args.kieOutDir || ""
const kieMaxSpendUsd = typeof args.kieMaxSpendUsd === "number" ? args.kieMaxSpendUsd : 0.25
const minimaxMode = args.minimaxMode || "dry-run"
const minimaxOutDir = args.minimaxOutDir || ""
const minimaxVoiceId = args.minimaxVoiceId || "289066744107112"
const renderOutDir = args.renderOutDir || ""
const renderPlatesManifest = args.renderPlatesManifest || ""
const renderPersonaManifest = args.renderPersonaManifest || ""
const goal4HandoffBundle = args.goal4HandoffBundle || ""
const generatedClipsManifest = args.generatedClipsManifest || ""
const spatialAudioRenderOutput = args.spatialAudioRenderOutput || ""
const goal5OutDir = args.goal5OutDir || "data/asmr-companion/goal5-pipeline-proof"
const hyperframesOutDir = args.hyperframesOutDir || ""

phase("Intake")
const intake = await agent(
  "You are the intake validator for a TikTok recreation bootstrap workflow.\n" +
    "Validate the input arguments and summarize what is safe to use.\n" +
    "sourceProfile: " + sourceProfile + "\n" +
    "manifestPath: " + manifestPath + "\n" +
    "kieMode: " + kieMode + "\n" +
    "kieOutDir: " + kieOutDir + "\n" +
    "minimaxMode: " + minimaxMode + "\n" +
    "minimaxOutDir: " + minimaxOutDir + "\n" +
    "minimaxVoiceId: " + minimaxVoiceId + "\n" +
    "renderOutDir: " + renderOutDir + "\n" +
    "renderPlatesManifest: " + renderPlatesManifest + "\n" +
    "renderPersonaManifest: " + renderPersonaManifest + "\n" +
    "goal4HandoffBundle: " + goal4HandoffBundle + "\n" +
    "generatedClipsManifest: " + generatedClipsManifest + "\n" +
    "spatialAudioRenderOutput: " + spatialAudioRenderOutput + "\n" +
    "goal5OutDir: " + goal5OutDir + "\n" +
    "hyperframesOutDir: " + hyperframesOutDir + "\n" +
    "- Treat the source as public reference only.\n" +
    "- Do not extract or preserve the real creator's face, voice, private identity, or branding.\n" +
    "- Flag any decomposition path that points outside the expected bootstrap tree.\n" +
    "- When Goal 5 ASMR/Seedance paths are provided, validate that the workflow can hand them to workflows/tiktok-recreate/goal5-asmr-handoff.ts without reading provider/audio internals.",
  {
    label: "intake validator",
    phase: "Intake",
    schema: {
      type: "object",
      properties: {
        ok: { type: "boolean" },
        sourceProfile: { type: "string" },
        videoCount: { type: "number" },
        decompositionCount: { type: "number" },
        warnings: { type: "array", items: { type: "string" } },
      },
      required: ["ok", "sourceProfile", "videoCount", "decompositionCount", "warnings"],
    },
  },
)

phase("Decompose")
const decompositions = await parallel([
  () =>
    agent(
      "You are a script analyst. Read the decomposition files and the manifest.\n" +
        "Extract the abstract narrative mechanics: hook patterns, script structure, pacing, retention devices, and caption style.\n" +
        "Return only clean-room mechanics, not transcript snippets or creator identity.\n" +
        "decompositionPaths: " + JSON.stringify(decompositionPaths) + "\n" +
        "manifestPath: " + manifestPath,
      {
        label: "script analyst",
        phase: "Decompose",
        schema: {
          type: "object",
          properties: {
            hookPatterns: { type: "array", items: { type: "string" } },
            scriptStructures: { type: "array", items: { type: "string" } },
            pacingNotes: { type: "array", items: { type: "string" } },
            retentionDevices: { type: "array", items: { type: "string" } },
            captionStyles: { type: "array", items: { type: "string" } },
          },
          required: [
            "hookPatterns",
            "scriptStructures",
            "pacingNotes",
            "retentionDevices",
            "captionStyles",
          ],
        },
      },
    ),
  () =>
    agent(
      "You are a visual decomposer. Inspect the frame/VTT decomposition lane.\n" +
        "Describe visual mechanics abstractly: shot types, transitions, text overlays, color grading mood, motion patterns, and asset types.\n" +
        "Do not describe the real creator's face, body, clothing, or identifiable environment.\n" +
        "decompositionPaths: " + JSON.stringify(decompositionPaths),
      {
        label: "visual decomposer",
        phase: "Decompose",
        schema: {
          type: "object",
          properties: {
            shotTypes: { type: "array", items: { type: "string" } },
            transitions: { type: "array", items: { type: "string" } },
            textOverlayStyles: { type: "array", items: { type: "string" } },
            colorMood: { type: "string" },
            motionPatterns: { type: "array", items: { type: "string" } },
            assetTypes: { type: "array", items: { type: "string" } },
          },
          required: [
            "shotTypes",
            "transitions",
            "textOverlayStyles",
            "colorMood",
            "motionPatterns",
            "assetTypes",
          ],
        },
      },
    ),
  () =>
    agent(
      "You are a native video probe reviewer. Review the native MP4 probe lane if present.\n" +
        "Summarize what a direct video-upload analysis would add over the frame/VTT lane, and list the gaps that still require clean-room treatment.\n" +
        "lane: " + lane + "\n" +
        "decompositionPaths: " + JSON.stringify(decompositionPaths),
      {
        label: "native probe reviewer",
        phase: "Decompose",
        schema: {
          type: "object",
          properties: {
            nativeLanePresent: { type: "boolean" },
            advantages: { type: "array", items: { type: "string" } },
            gaps: { type: "array", items: { type: "string" } },
            recommendation: { type: "string" },
          },
          required: ["nativeLanePresent", "advantages", "gaps", "recommendation"],
        },
      },
    ),
])

phase("Persona")
const persona = await agent(
  "You are a persona designer for synthetic short-form narration.\n" +
    "Design a Jimeng synthetic persona that can deliver the abstract script mechanics identified by the script analyst.\n" +
    "The persona must be wholly synthetic: no imitation of the real creator's face, voice, name, or identity.\n" +
    "Mode: " + jimengPersonaMode + "\n" +
    "Return Chinese Jimeng prompts and an English description for the Remotion planner.",
  {
    label: "persona designer",
    phase: "Persona",
    schema: {
      type: "object",
      properties: {
        personaId: { type: "string" },
        displayName: { type: "string" },
        description: { type: "string" },
        jimengPersonaPromptZh: { type: "string" },
        jimengPersonaDescriptionZh: { type: "string" },
        voiceAndDeliveryNotes: { type: "array", items: { type: "string" } },
      },
      required: [
        "personaId",
        "displayName",
        "description",
        "jimengPersonaPromptZh",
        "jimengPersonaDescriptionZh",
        "voiceAndDeliveryNotes",
      ],
    },
  },
)

phase("Plan")
const plan = await parallel([
  () =>
    agent(
      "You are research fuel. Propose public, rights-safe research inputs that would strengthen the recreation without cloning the original.\n" +
        "Suggest data sources, fact checks, and alternate angles. Keep outputs abstract and citation-ready.",
      {
        label: "research fuel",
        phase: "Plan",
        schema: {
          type: "object",
          properties: {
            researchInputs: { type: "array", items: { type: "string" } },
            factCheckTargets: { type: "array", items: { type: "string" } },
            alternateAngles: { type: "array", items: { type: "string" } },
          },
          required: ["researchInputs", "factCheckTargets", "alternateAngles"],
        },
      },
    ),
  () =>
    agent(
      "You are a Remotion planner. Turn the visual mechanics into a deterministic Remotion composition plan.\n" +
        "Visual mechanics from the decomposer:\n" + JSON.stringify(decompositions[1]) + "\n" +
        "Specify layers, captions, timings, and asset slots. Assume 30fps and output layer names with start/end frames.",
      {
        label: "remotion planner",
        phase: "Plan",
        schema: {
          type: "object",
          properties: {
            compositionName: { type: "string" },
            fps: { type: "number" },
            width: { type: "number" },
            height: { type: "number" },
            layers: {
              type: "array",
              items: {
                type: "object",
                properties: {
                  layer: { type: "string" },
                  startFrame: { type: "number" },
                  endFrame: { type: "number" },
                  purpose: { type: "string" },
                  assetSlot: { type: "string" },
                },
                required: ["layer", "startFrame", "endFrame", "purpose", "assetSlot"],
              },
            },
            captionSpec: {
              type: "object",
              properties: {
                fontFamily: { type: "string" },
                safeArea: { type: "string" },
                maxCharsPerLine: { type: "number" },
              },
              required: ["fontFamily", "safeArea", "maxCharsPerLine"],
            },
          },
          required: ["compositionName", "fps", "width", "height", "layers", "captionSpec"],
        },
      },
    ),
  () =>
    agent(
      "You are a KIE image plate planner. Turn the visual mechanics and decomposition slide prompts into clean-room image-generation prompts.\n" +
        "Visual mechanics from the decomposer:\n" + JSON.stringify(decompositions[1]) + "\n" +
        "Decomposition paths:\n" + JSON.stringify(decompositionPaths) + "\n" +
        "For each slide_visual_prompt found in the decomposition files, produce one KIE image-text prompt in English.\n" +
        "Each prompt must be abstract and rights-safe: no source creator likeness, no source logos, no watermarks, no copyrighted characters, no identifiable private locations.\n" +
        "Return a plate manifest that the KIE boundary script can consume, including negative prompts and 9:16 aspect ratio.",
      {
        label: "kie plate planner",
        phase: "Plan",
        schema: {
          type: "object",
          properties: {
            plateOutDir: { type: "string" },
            spendCapUsd: { type: "number" },
            mode: { type: "string" },
            plates: {
              type: "array",
              items: {
                type: "object",
                properties: {
                  videoId: { type: "string" },
                  slideIndex: { type: "number" },
                  slideVisualPrompt: { type: "string" },
                  prefixedPrompt: { type: "string" },
                  negativePrompt: { type: "string" },
                  operation: { type: "string" },
                  aspectRatio: { type: "string" },
                  quality: { type: "string" },
                },
                required: [
                  "videoId",
                  "slideIndex",
                  "slideVisualPrompt",
                  "prefixedPrompt",
                  "negativePrompt",
                  "operation",
                  "aspectRatio",
                  "quality",
                ],
              },
            },
          },
          required: ["plateOutDir", "spendCapUsd", "mode", "plates"],
        },
      },
    ),
  () =>
    agent(
      "You are a MiniMax TTS narration planner for synthetic short-form audio.\n" +
        "Design the narration script and MiniMax TTS synthesis plan for each video.\n" +
        "Use the persona voice notes and script analysis to produce natural-sounding narration text per video.\n" +
        "The MiniMax wrapper will synthesize each segment via the HSK-deck generate-audio.mjs tool (async, model=speech-2.8-turbo).\n" +
        "Voice must be wholly synthetic — default to voiceId=" + minimaxVoiceId + " (Bashful Girl).\n" +
        "Mode: " + minimaxMode + "\n" +
        "Persona voice notes: " + JSON.stringify(persona) + "\n" +
        "Script analysis: " + JSON.stringify(decompositions[0]) + "\n" +
        "Visual analysis: " + JSON.stringify(decompositions[1]),
      {
        label: "minimax tts narration planner",
        phase: "Plan",
        schema: {
          type: "object",
          properties: {
            voiceId: { type: "string" },
            model: { type: "string" },
            format: { type: "string" },
            perVideoNarrations: {
              type: "array",
              items: {
                type: "object",
                properties: {
                  videoId: { type: "string" },
                  narrationText: { type: "string" },
                  durationSec: { type: "number" },
                },
                required: ["videoId", "narrationText", "durationSec"],
              },
            },
          },
          required: ["voiceId", "model", "format", "perVideoNarrations"],
        },
      },
    ),
])

phase("Synthesize")
const scriptAnalysis = decompositions[0]
const visualAnalysis = decompositions[1]
const nativeProbeReview = decompositions[2]
const researchFuel = plan[0]
const remotionPlan = plan[1]
const kiePlatePlan = plan[2]
const narrationPlan = plan[3]
const handoff = await agent(
  "You are a reviewer and synthesizer.\n" +
    "Combine the upstream results below into one JSON-safe Slotok handoff payload.\n" +
    "Apply clean-room rules: no real creator likeness, voice, private identity, or copyrighted media.\n" +
    "Enforce sourcePolicy=abstract-mechanics because the inputs are public reference metadata and frames only.\n" +
    "Include a concrete KIE plate lane: for each planned plate, emit a providerJob with provider=\"kie\", lane=\"image\", the slide prompts, prepared payload path, and expected downloaded plate paths under the KIE outDir.\n" +
    "Include a concrete MiniMax TTS narration lane: for each video, emit a providerJob with provider=\"local\", operation=\"minimax-tts\", expected audio artifact paths under the MiniMax outDir, and a note that the voice is synthetic (no creator imitation).\n" +
    "Include concrete MiniMax TTS narration expectations: the TTS boundary script will write <minimaxOutDir>/<videoId>/audio/narration.mp3, <minimaxOutDir>/<videoId>/audio/narration.response.json, and <minimaxOutDir>/<videoId>/tts-manifest.json when later run with --decomposition and --outDir.\n" +
    "Include concrete render artifact expectations: the Remotion renderer will write <outDir>/<videoId>/recreate.mp4 and <outDir>/<videoId>/manifest.json when it later runs with --manifest, --decomposition, --persona-manifest, --out, and --audio-manifest.\n" +
    "If Goal 5 ASMR/Seedance inputs are present, include a concrete ASMR pipeline handoff lane that calls workflows/tiktok-recreate/goal5-asmr-handoff.ts with the Goal 4 handoff, generated clip manifest, spatial render-output manifest, and goal5OutDir; include Remotion and HyperFrames artifact paths from that deterministic handoff.\n" +
    "\n--- INTAKE ---\n" + JSON.stringify(intake) + "\n" +
    "\n--- SCRIPT ANALYSIS ---\n" + JSON.stringify(scriptAnalysis) + "\n" +
    "\n--- VISUAL ANALYSIS ---\n" + JSON.stringify(visualAnalysis) + "\n" +
    "\n--- NATIVE PROBE REVIEW ---\n" + JSON.stringify(nativeProbeReview) + "\n" +
    "\n--- PERSONA ---\n" + JSON.stringify(persona) + "\n" +
    "\n--- RESEARCH FUEL ---\n" + JSON.stringify(researchFuel) + "\n" +
    "\n--- REMOTION PLAN ---\n" + JSON.stringify(remotionPlan) + "\n" +
    "\n--- KIE PLATE PLAN ---\n" + JSON.stringify(kiePlatePlan) + "\n" +
    "\n--- NARRATION PLAN ---\n" + JSON.stringify(narrationPlan) + "\n" +
    "\n--- METADATA ---\n" +
    "sourceProfile: " + sourceProfile + "\n" +
    "manifestPath: " + manifestPath + "\n" +
    "lane: " + lane + "\n" +
    "model: " + model + "\n" +
    "kieMode: " + kieMode + "\n" +
    "kieOutDir: " + kieOutDir + "\n" +
    "minimaxMode: " + minimaxMode + "\n" +
    "minimaxOutDir: " + minimaxOutDir + "\n" +
    "renderOutDir: " + renderOutDir + "\n" +
    "renderPlatesManifest: " + renderPlatesManifest + "\n" +
    "renderPersonaManifest: " + renderPersonaManifest + "\n" +
    "goal4HandoffBundle: " + goal4HandoffBundle + "\n" +
    "generatedClipsManifest: " + generatedClipsManifest + "\n" +
    "spatialAudioRenderOutput: " + spatialAudioRenderOutput + "\n" +
    "goal5OutDir: " + goal5OutDir + "\n" +
    "hyperframesOutDir: " + hyperframesOutDir,
  {
    label: "reviewer synthesizer",
    phase: "Synthesize",
    schema: {
      type: "object",
      properties: {
        lane: { type: "string" },
        sourcePolicy: { type: "string" },
        sourceProfile: { type: "string" },
        manifestPath: { type: "string" },
        decompositionLane: { type: "string" },
        model: { type: "string" },
        kieMode: { type: "string" },
        goal4HandoffBundle: { type: "string" },
        generatedClipsManifest: { type: "string" },
        spatialAudioRenderOutput: { type: "string" },
        goal5OutDir: { type: "string" },
        hyperframesOutDir: { type: "string" },
        kieOutDir: { type: "string" },
        renderOutDir: { type: "string" },
        renderPlatesManifest: { type: "string" },
        renderPersonaManifest: { type: "string" },
        minimaxMode: { type: "string" },
        minimaxOutDir: { type: "string" },
        minimaxVoiceId: { type: "string" },
        intake: { type: "object" },
        scriptAnalysis: { type: "object" },
        visualAnalysis: { type: "object" },
        nativeProbeReview: { type: "object" },
        persona: { type: "object" },
        researchFuel: { type: "object" },
        remotionPlan: { type: "object" },
        kiePlatePlan: { type: "object" },
        narrationPlan: { type: "object" },
        records: { type: "array" },
        providerJobs: { type: "array" },
        candidatePatches: { type: "array" },
        referenceArchives: { type: "array" },
        notes: { type: "array", items: { type: "string" } },
        artifactPaths: { type: "array", items: { type: "string" } },
        result: { type: "object" },
      },
      required: [
        "lane",
        "sourcePolicy",
        "sourceProfile",
        "manifestPath",
        "decompositionLane",
        "model",
        "kieMode",
        "goal4HandoffBundle",
        "generatedClipsManifest",
        "spatialAudioRenderOutput",
        "goal5OutDir",
        "hyperframesOutDir",
        "kieOutDir",
        "renderOutDir",
        "renderPlatesManifest",
        "renderPersonaManifest",
        "minimaxMode",
        "minimaxOutDir",
        "minimaxVoiceId",
        "intake",
        "scriptAnalysis",
        "visualAnalysis",
        "nativeProbeReview",
        "persona",
        "researchFuel",
        "remotionPlan",
        "kiePlatePlan",
        "narrationPlan",
        "records",
        "providerJobs",
        "candidatePatches",
        "referenceArchives",
        "notes",
        "artifactPaths",
        "result",
      ],
    },
  },
)

return handoff
