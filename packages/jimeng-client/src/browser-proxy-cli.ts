#!/usr/bin/env bun
import { mkdirSync, readFileSync, writeFileSync } from "node:fs"
import path from "node:path"
import { loadJimengSessionFromBrowser } from "./browser-session"
import {
  fetchVoiceLibraryFromCapture,
  generateTextToSpeech,
  getDefaultVoiceLibraryCapturePath,
  parseCatalogEndpointIds,
  runCatalogProbe,
  summarizeVoiceLibrary,
  type JimengVoiceCatalogItem,
} from "./catalog"
import { prepareFromCapture, redactHeaders, type CaptureFile, type JimengOp, type JimengSessionBundle } from "./capture"
import { JimengClient } from "./client"
import { JimengError } from "./errors"
import {
  buildExploreRequestBody,
  buildShortVideoExploreQuery,
  fetchExploreTemplates,
  parseExploreWorkTypes,
  summarizeExploreShortVideos,
  summarizeExploreTemplates,
} from "./explore"
import { buildJimengLipSyncVideoPlan, lipSyncVideoReferenceFromUploadSummary, type JimengLipSyncVideoReference } from "./lip-sync"
import { getJimengUploadToken, parseUploadTokenScene, uploadJimengImage, uploadJimengVideo, type JimengImageUploadResult, type JimengVideoUploadResult } from "./upload"

const DEFAULT_CDP_URL = "http://127.0.0.1:9340"

const USAGE = `Usage: jimeng-browser-proxy <command> [options]

Browser-backed Jimeng proxy for the dedicated background Helium/CDP profile.
It refreshes the live frontend session from the browser, then uses the direct client.

Commands:
  session       Save a fresh session bundle from the logged-in Jimeng browser profile
  catalog       Probe non-generating model/tool/persona/voice config endpoints
  voices        Fetch the built-in voice library from a captured signed feed request
  tts           Generate one MP3 text-to-speech sample from a voice id
  sample-voices Generate sequential MP3 samples for voices from the built-in library
  templates     Fetch no-spend Explore/template examples for prompt/template mining
  short-videos  Fetch no-spend Explore short videos for reference/profile mining
  upload-token  Fetch temporary upload credentials for image/video/file upload scenes
  upload-image  Upload a local image to Jimeng ImageX and return a provider URI
  upload-video  Upload a local video to Jimeng VOD and return a provider video reference
  text2image    Submit text-to-image from a captured workbench/agent template
  text2video    Submit text-to-video from a captured workbench template
  image2video   Upload/use a first-frame image URI, then submit image-to-video
  frames2video  Upload/use first and end-frame image URIs, then submit image-to-video
  lip-sync      Dry-run VOD video-reference lip-sync payload plan from text/voice

Options:
  --cdp <url>                   CDP URL (default: ${DEFAULT_CDP_URL})
  --target-url <substring>      Existing Jimeng page URL/title substring (default: jimeng.jianying.com)
  --session <file>              Load a saved session bundle instead of refreshing from CDP
  --session-out <file>          session command output (default: data/jimeng-lab/raw/session-bundle-current.json)
  --capture <file>              Capture template JSON for generation commands
  --endpoints <ids|all>          Catalog endpoints, comma-separated (default: all)
  --text <text>                 TTS/sample-voices text
  --voice-id <id>               TTS voice id from voices command
  --voice-title <title>         Optional display title for TTS output filename
  --tone-key <key>               Optional lip-sync voice display/key field
  --tone-category-id <id>        Optional lip-sync voice category id
  --tone-category-key <key>      Optional lip-sync voice category key
  --speed <n>                    TTS/lip-sync speech speed (default: 1.0)
  --item-platform <n>           Voice item platform (default: 1, Loki/built-in)
  --limit <n>                   sample-voices limit or Explore count
  --offset <n>                  Explore offset (default: 0)
  --category-id <n>             Explore category id (default: 11222)
  --work-types <csv>            templates work types: video,image,canvas,short_video
  --feed-refer <value>          Explore feed refer, e.g. feed_refresh, feed_enterauto, or feed_loadmore
  --scene <image|video|file|n>   upload-token scene (default: image)
  --file <path>                  Local media file for upload-image/upload-video; alias for --image in image2video
  --video <path>                 Local reference video for lip-sync; uploads to VOD in dry-run planning
  --vid <vid>                    Existing VOD vid for lip-sync
  --videoUri <uri>               Existing VOD/tos provider URI for lip-sync
  --videoWidth <n>               Existing reference video width for lip-sync
  --videoHeight <n>              Existing reference video height for lip-sync
  --videoDurationSec <sec>       Existing reference video duration for lip-sync
  --videoMode <value>            Lip-sync videoMode override from a confirmed frontend capture
  --image <path>                 Local first-frame image for image2video
  --lastImage <path>             Local end-frame image for frames2video
  --firstFrameUri <uri>          Existing Jimeng/ImageX provider URI for image2video
  --lastFrameUri <uri>           Existing provider URI for end-frame experiments
  --ratio <ratio>                Video aspect ratio flag patched into text_to_video_params
  --videoResolution <value>      Video resolution value patched into video_gen_inputs and sceneOptions
  --modelVersion <value>         Confirmed shorthand model version, e.g. 3.0fast
  --modelReqKey <value>          Raw confirmed model_req_key override
  --seed <n>                     Deterministic seed, 0..4294967295
  --prompt <text>               Generation prompt
  --outDir <dir>                Output directory (default: data/jimeng-lab/browser-proxy)
  --dryRun                      Write patched plan only; image2video still uploads --image to obtain a provider URI
  --noDownload                  Submit/poll but do not download artifacts
  --pollIntervalMs <ms>         Poll interval (default: 3000)
  --maxPolls <n>                Max polls (default: 30)
  --durationSec <sec>           Video duration seconds for text2video (default from capture/client)

Examples:
  jimeng-browser-proxy session

  jimeng-browser-proxy text2image \\
    --capture data/jimeng-captures/<run>/capture-template.raw.json \\
    --prompt "韩系美妆健身UGC创作者，手机自拍，无文字，无水印" \\
    --dryRun

  jimeng-browser-proxy voices \\
    --capture data/jimeng-captures/<run>/capture-template.raw.json

  jimeng-browser-proxy tts \\
    --voice-id 7597003459665072686 \\
    --text "这条视频值得试一下。"

  jimeng-browser-proxy upload-token --scene image

  jimeng-browser-proxy templates \\
    --limit 10 \\
    --category-id 11222 \\
    --work-types image,video,canvas

  jimeng-browser-proxy short-videos \\
    --limit 5 \\
    --category-id 11222 \\
    --feed-refer feed_enterauto

  jimeng-browser-proxy upload-image \\
    --file data/jimeng-lab/image-upload-probe/aws4-live/proof-1x1.png \\
    --outDir data/jimeng-lab/cli-image-upload-smoke

  jimeng-browser-proxy upload-video \\
    --file data/jimeng-lab/proof-20260609-image2video-live/artifacts/aa83d0e1-a20c-4b85-ab59-ee3a7894296f-00.mp4 \\
    --outDir data/jimeng-lab/cli-video-upload-smoke

  jimeng-browser-proxy image2video \\
    --capture data/jimeng-captures/<run>/capture-template.raw.json \\
    --image data/tiktok-catalogue/mynameissico/2026-05-21_7642426706115972365.jpg \\
    --prompt "韩系美妆达人自拍风格，干净卧室自然光，前三秒有明确痛点钩子，无字幕，无水印" \\
    --durationSec 3 \\
    --dryRun

  jimeng-browser-proxy frames2video \\
    --capture data/jimeng-captures/<run>/capture-template.raw.json \\
    --image data/jimeng-lab/references/start.png \\
    --lastImage data/jimeng-lab/references/end.png \\
    --prompt "韩系美妆达人从自然站姿走到产品特写，真实手机拍摄感，无字幕，无水印" \\
    --durationSec 5 \\
    --dryRun

  jimeng-browser-proxy lip-sync \\
    --session data/jimeng-lab/raw/session-bundle-current.json \\
    --video data/jimeng-lab/proof-20260609-image2video-live/artifacts/aa83d0e1-a20c-4b85-ab59-ee3a7894296f-00.mp4 \\
    --voice-id 7597003459665072686 \\
    --text "三秒告诉你为什么这款补水精华适合熬夜后的底妆。" \\
    --dryRun

Live generation uses the browser session but does not foreground the browser. Keep concurrency at 1.`

interface CliArgs {
  command:
    | "session"
    | "catalog"
    | "voices"
    | "tts"
    | "sample-voices"
    | "templates"
    | "short-videos"
    | "upload-token"
    | "upload-image"
    | "upload-video"
    | "text2image"
    | "text2video"
    | "image2video"
    | "frames2video"
    | "lip-sync"
  cdpUrl: string
  targetUrl?: string
  session?: string
  sessionOut: string
  capture?: string
  endpoints?: string
  text?: string
  voiceId?: string
  voiceTitle?: string
  toneKey?: string
  toneCategoryId?: string
  toneCategoryKey?: string
  speed?: number
  itemPlatform?: number
  limit?: number
  offset?: number
  categoryId?: number
  workTypes?: string
  feedRefer?: string
  scene?: string
  file?: string
  video?: string
  vid?: string
  videoUri?: string
  videoWidth?: number
  videoHeight?: number
  videoDurationSec?: number
  videoMode?: string
  image?: string
  lastImage?: string
  firstFrameUri?: string
  lastFrameUri?: string
  ratio?: string
  videoResolution?: string
  modelVersion?: string
  modelReqKey?: string
  seed?: number
  prompt?: string
  outDir: string
  dryRun: boolean
  noDownload: boolean
  pollIntervalMs: number
  maxPolls: number
  durationSec?: number
}

async function main(argv: string[]): Promise<void> {
  const args = parseArgs(argv)

  if (args.command === "session") {
    const session = await loadJimengSessionFromBrowser({ cdpUrl: args.cdpUrl, targetUrl: args.targetUrl })
    const file = path.resolve(args.sessionOut)
    mkdirSync(path.dirname(file), { recursive: true })
    writeJson(file, session)
    console.log(`[jimeng-browser-proxy] session saved: ${file}`)
    return
  }

  const session = await loadSession(args)

  if (args.command === "catalog") {
    const dirs = ensureOutputDirs(path.resolve(args.outDir))
    const endpointIds = parseCatalogEndpointIds(args.endpoints)
    const results = await runCatalogProbe({ session, endpointIds })
    const runId = `catalog-${new Date().toISOString().replace(/[-:.TZ]/g, "").slice(0, 14)}`
    writeJson(path.join(dirs.rawDir, `${runId}.json`), results)
    writeJson(path.join(dirs.normalizedDir, `${runId}-summary.json`), results.map((result) => ({
      endpoint: result.endpoint,
      description: result.description,
      http_status: result.httpStatus,
      ret: result.ret,
      errmsg: result.errmsg,
      response_text_sha256: result.responseTextSha256,
      summary: result.summary,
    })))
    console.log(`[jimeng-browser-proxy] catalog saved endpoints=${results.length}`)
    return
  }

  if (args.command === "voices") {
    const dirs = ensureOutputDirs(path.resolve(args.outDir))
    const capture = readVoiceCapture(args.capture)
    const result = await fetchVoiceLibraryFromCapture({ session, capture })
    const runId = `voices-${new Date().toISOString().replace(/[-:.TZ]/g, "").slice(0, 14)}`
    writeJson(path.join(dirs.rawDir, `${runId}.json`), {
      http_status: result.httpStatus,
      response_text_sha256: result.responseTextSha256,
      body: result.body,
    })
    writeJson(path.join(dirs.normalizedDir, `${runId}-voices.json`), {
      response_text_sha256: result.responseTextSha256,
      summary: summarizeVoiceLibrary(result.voices),
      voices: result.voices,
    })
    console.log(`[jimeng-browser-proxy] voices saved count=${result.voices.length}`)
    return
  }

  if (args.command === "tts") {
    if (!args.voiceId) throw new Error("--voice-id is required")
    const text = args.text ?? "这条视频值得试一下。"
    const dirs = ensureOutputDirs(path.resolve(args.outDir))
    const plan = {
      command: args.command,
      endpoint: "/mweb/v1/tts_generate",
      text,
      voice_id: args.voiceId,
      voice_title: args.voiceTitle,
      item_platform: args.itemPlatform ?? 1,
      browser_session: redactSession(session),
    }
    const runId = `tts-${new Date().toISOString().replace(/[-:.TZ]/g, "").slice(0, 14)}`
    if (args.dryRun) {
      writeJson(path.join(dirs.rawDir, `${runId}-dry-run-plan.json`), plan)
      console.log(`[jimeng-browser-proxy] tts dry run saved`)
      return
    }

    const result = await generateTextToSpeech({
      session,
      tts: { text, voiceId: args.voiceId, itemPlatform: args.itemPlatform },
    })
    const file = path.join(dirs.artifactsDir, `${slug(`${args.voiceTitle ?? "voice"}-${args.voiceId}`)}.mp3`)
    writeFileSync(file, Buffer.from(result.audioBytes))
    writeJson(path.join(dirs.normalizedDir, `${runId}-result.json`), {
      ...plan,
      http_status: result.httpStatus,
      ret: result.ret,
      errmsg: result.errmsg,
      response_text_sha256: result.responseTextSha256,
      artifact: file,
      bytes: result.audioBytes.length,
    })
    console.log(`[jimeng-browser-proxy] tts saved: ${file}`)
    return
  }

  if (args.command === "sample-voices") {
    const dirs = ensureOutputDirs(path.resolve(args.outDir))
    const capture = readVoiceCapture(args.capture)
    const library = await fetchVoiceLibraryFromCapture({ session, capture })
    const text = args.text ?? "这条视频值得试一下。"
    const voices = typeof args.limit === "number" ? library.voices.slice(0, args.limit) : library.voices
    const plan = {
      command: args.command,
      endpoint: "/mweb/v1/tts_generate",
      text,
      voice_count: voices.length,
      dry_run: args.dryRun,
      browser_session: redactSession(session),
    }
    const runId = `sample-voices-${new Date().toISOString().replace(/[-:.TZ]/g, "").slice(0, 14)}`
    if (args.dryRun) {
      writeJson(path.join(dirs.rawDir, `${runId}-dry-run-plan.json`), { ...plan, voices })
      console.log(`[jimeng-browser-proxy] sample-voices dry run saved count=${voices.length}`)
      return
    }

    const samples: Array<Record<string, unknown>> = []
    for (let i = 0; i < voices.length; i += 1) {
      const voice = voices[i]!
      const result = await generateTextToSpeech({
        session,
        tts: { text, voiceId: voice.id, itemPlatform: voice.itemPlatform },
      })
      const file = path.join(dirs.artifactsDir, `${String(i + 1).padStart(3, "0")}-${slug(`${voice.title}-${voice.id}`)}.mp3`)
      writeFileSync(file, Buffer.from(result.audioBytes))
      samples.push({
        index: i + 1,
        voice,
        file,
        bytes: result.audioBytes.length,
        ret: result.ret,
        errmsg: result.errmsg,
        response_text_sha256: result.responseTextSha256,
      })
      if ((i + 1) % 10 === 0 || i === voices.length - 1) {
        console.log(`[jimeng-browser-proxy] sampled voices ${i + 1}/${voices.length}`)
      }
    }
    writeJson(path.join(dirs.normalizedDir, `${runId}-result.json`), {
      ...plan,
      voice_library_sha256: library.responseTextSha256,
      samples,
    })
    console.log(`[jimeng-browser-proxy] sample-voices done count=${samples.length}`)
    return
  }

  if (args.command === "templates") {
    const dirs = ensureOutputDirs(path.resolve(args.outDir))
    const query = {
      count: args.limit,
      offset: args.offset,
      categoryId: args.categoryId,
      workTypes: parseExploreWorkTypes(args.workTypes),
      feedRefer: args.feedRefer,
    }
    const request = buildExploreRequestBody(query)
    const runId = `templates-${new Date().toISOString().replace(/[-:.TZ]/g, "").slice(0, 14)}`
    if (args.dryRun) {
      writeJson(path.join(dirs.rawDir, `${runId}-dry-run-plan.json`), {
        command: args.command,
        endpoint: "/mweb/v1/get_explore",
        request,
        browser_session: redactSession(session),
      })
      console.log(`[jimeng-browser-proxy] templates dry run saved`)
      return
    }

    const result = await fetchExploreTemplates({ session, query })
    writeJson(path.join(dirs.rawDir, `${runId}.json`), {
      http_status: result.httpStatus,
      ret: result.ret,
      errmsg: result.errmsg,
      response_text_sha256: result.responseTextSha256,
      request: result.request,
      body: result.body,
    })
    writeJson(path.join(dirs.normalizedDir, `${runId}-summary.json`), {
      command: args.command,
      endpoint: result.endpoint,
      http_status: result.httpStatus,
      ret: result.ret,
      errmsg: result.errmsg,
      response_text_sha256: result.responseTextSha256,
      request: result.request,
      summary: summarizeExploreTemplates(result),
      items: result.items,
    })
    console.log(`[jimeng-browser-proxy] templates saved count=${result.items.length} nextOffset=${result.nextOffset ?? "none"}`)
    return
  }

  if (args.command === "short-videos") {
    const dirs = ensureOutputDirs(path.resolve(args.outDir))
    const query = buildShortVideoExploreQuery({
      count: args.limit,
      offset: args.offset,
      categoryId: args.categoryId,
      feedRefer: args.feedRefer,
    })
    const request = buildExploreRequestBody(query)
    const runId = `short-videos-${new Date().toISOString().replace(/[-:.TZ]/g, "").slice(0, 14)}`
    if (args.dryRun) {
      writeJson(path.join(dirs.rawDir, `${runId}-dry-run-plan.json`), {
        command: args.command,
        endpoint: "/mweb/v1/get_explore",
        request,
        browser_session: redactSession(session),
      })
      console.log(`[jimeng-browser-proxy] short-videos dry run saved`)
      return
    }

    const result = await fetchExploreTemplates({ session, query })
    writeJson(path.join(dirs.rawDir, `${runId}.json`), {
      http_status: result.httpStatus,
      ret: result.ret,
      errmsg: result.errmsg,
      response_text_sha256: result.responseTextSha256,
      request: result.request,
      body: result.body,
    })
    writeJson(path.join(dirs.normalizedDir, `${runId}-summary.json`), {
      command: args.command,
      endpoint: result.endpoint,
      http_status: result.httpStatus,
      ret: result.ret,
      errmsg: result.errmsg,
      response_text_sha256: result.responseTextSha256,
      request: result.request,
      summary: summarizeExploreShortVideos(result),
      items: result.items,
    })
    console.log(`[jimeng-browser-proxy] short-videos saved count=${result.items.length} nextOffset=${result.nextOffset ?? "none"}`)
    return
  }

  if (args.command === "upload-token") {
    const dirs = ensureOutputDirs(path.resolve(args.outDir))
    const scene = parseUploadTokenScene(args.scene)
    const result = await getJimengUploadToken({ session, token: { scene } })
    const runId = `upload-token-${new Date().toISOString().replace(/[-:.TZ]/g, "").slice(0, 14)}`
    writeJson(path.join(dirs.rawDir, `${runId}.json`), {
      http_status: result.httpStatus,
      response_text_sha256: result.responseTextSha256,
      body: result.body,
    })
    writeJson(path.join(dirs.normalizedDir, `${runId}-summary.json`), {
      scene,
      http_status: result.httpStatus,
      ret: result.ret,
      errmsg: result.errmsg,
      response_text_sha256: result.responseTextSha256,
      summary: result.summary,
    })
    console.log(`[jimeng-browser-proxy] upload-token saved scene=${scene}`)
    return
  }

  if (args.command === "upload-image") {
    if (!args.file) throw new Error("--file is required")
    const dirs = ensureOutputDirs(path.resolve(args.outDir))
    const sourceFile = path.resolve(args.file)
    const bytes = readFileSync(sourceFile)
    const runId = `upload-image-${new Date().toISOString().replace(/[-:.TZ]/g, "").slice(0, 14)}`
    const artifactFile = path.join(dirs.artifactsDir, path.basename(sourceFile))
    writeFileSync(artifactFile, bytes)
    const plan = {
      command: args.command,
      endpoint_sequence: [
        "/mweb/v1/get_upload_token",
        "ImageX ApplyImageUpload",
        "ImageX direct POST /upload/v1/{StoreUri}",
        "ImageX CommitImageUpload",
      ],
      source_file: sourceFile,
      artifact_copy: artifactFile,
      file_name: path.basename(sourceFile),
      bytes: bytes.byteLength,
      browser_session: redactSession(session),
    }
    if (args.dryRun) {
      writeJson(path.join(dirs.rawDir, `${runId}-dry-run-plan.json`), plan)
      console.log(`[jimeng-browser-proxy] upload-image dry run saved`)
      return
    }

    const result = await uploadJimengImage({
      session,
      image: {
        fileName: path.basename(sourceFile),
        bytes,
      },
    })
    writeJson(path.join(dirs.rawDir, `${runId}-raw.json`), {
      token: {
        http_status: result.token.httpStatus,
        response_text_sha256: result.token.responseTextSha256,
        body: result.token.body,
      },
      apply: {
        http_status: result.apply.httpStatus,
        response_text_sha256: result.apply.responseTextSha256,
        body: result.apply.body,
      },
      upload: {
        http_status: result.upload.httpStatus,
        response_text_sha256: result.upload.responseTextSha256,
        body: result.upload.body,
      },
      commit: {
        http_status: result.commit.httpStatus,
        response_text_sha256: result.commit.responseTextSha256,
        body: result.commit.body,
      },
    })
    writeJson(path.join(dirs.normalizedDir, `${runId}-summary.json`), {
      ...plan,
      token_summary: result.token.summary,
      image_upload: result.summary,
    })
    console.log(`[jimeng-browser-proxy] upload-image saved uri=${result.summary.imageUris[0] ?? "missing"}`)
    return
  }

  if (args.command === "upload-video") {
    if (!args.file) throw new Error("--file is required")
    const dirs = ensureOutputDirs(path.resolve(args.outDir))
    const sourceFile = path.resolve(args.file)
    const bytes = readFileSync(sourceFile)
    const runId = `upload-video-${new Date().toISOString().replace(/[-:.TZ]/g, "").slice(0, 14)}`
    const artifactFile = path.join(dirs.artifactsDir, path.basename(sourceFile))
    writeFileSync(artifactFile, bytes)
    const plan = {
      command: args.command,
      endpoint_sequence: [
        "/mweb/v1/get_upload_token scene=1",
        "VOD ApplyUploadInner",
        "VOD direct POST /upload/v1/{StoreUri}",
        "VOD CommitUploadInner",
      ],
      source_file: sourceFile,
      artifact_copy: artifactFile,
      file_name: path.basename(sourceFile),
      bytes: bytes.byteLength,
      browser_session: redactSession(session),
    }
    if (args.dryRun) {
      writeJson(path.join(dirs.rawDir, `${runId}-dry-run-plan.json`), plan)
      console.log(`[jimeng-browser-proxy] upload-video dry run saved`)
      return
    }

    const result = await uploadJimengVideo({
      session,
      video: {
        fileName: path.basename(sourceFile),
        bytes,
      },
    })
    writeJson(path.join(dirs.rawDir, `${runId}-raw.json`), {
      token: {
        http_status: result.token.httpStatus,
        response_text_sha256: result.token.responseTextSha256,
        body: result.token.body,
      },
      apply: {
        http_status: result.apply.httpStatus,
        response_text_sha256: result.apply.responseTextSha256,
        body: result.apply.body,
      },
      upload: {
        http_status: result.upload.httpStatus,
        response_text_sha256: result.upload.responseTextSha256,
        body: result.upload.body,
      },
      commit: {
        http_status: result.commit.httpStatus,
        response_text_sha256: result.commit.responseTextSha256,
        body: result.commit.body,
      },
    })
    writeJson(path.join(dirs.normalizedDir, `${runId}-summary.json`), {
      ...plan,
      token_summary: result.token.summary,
      video_upload: result.summary,
    })
    console.log(`[jimeng-browser-proxy] upload-video saved vid=${result.summary.vid ?? "missing"} storeUri=${result.summary.storeUri}`)
    return
  }

  if (args.command === "lip-sync") {
    if (!args.dryRun) {
      throw new Error("lip-sync live submit is not implemented yet; pass --dryRun to write the confirmed provider-input plan")
    }
    if (!args.voiceId) throw new Error("--voice-id is required for lip-sync text-to-speech planning")

    const dirs = ensureOutputDirs(path.resolve(args.outDir))
    const runId = `lip-sync-${new Date().toISOString().replace(/[-:.TZ]/g, "").slice(0, 14)}-${Math.random().toString(36).slice(2, 8)}`
    const referenceUploads: ReferenceVideoUploadSummary[] = []
    const videoFile = args.video ?? args.file
    const videoUpload = videoFile
      ? await uploadReferenceVideo({
        session,
        dirs,
        runId,
        role: "lip_sync_video",
        index: 0,
        sourceFile: videoFile,
      })
      : undefined
    if (videoUpload) referenceUploads.push(videoUpload)
    const videoReference = videoUpload
      ? lipSyncVideoReferenceFromUploadSummary(videoUpload.video_upload)
      : lipSyncVideoReferenceFromArgs(args)

    const plan = buildJimengLipSyncVideoPlan({
      prompt: args.prompt,
      modelReqKey: args.modelReqKey,
      videoMode: args.videoMode,
      video: videoReference,
      ttsInfo: {
        sourceType: "text-to-speech",
        text: args.text ?? "三秒告诉你为什么这款补水精华适合熬夜后的底妆。",
        speed: args.speed ?? 1,
        toneId: args.voiceId,
        toneKey: args.toneKey ?? args.voiceTitle,
        toneCategoryId: args.toneCategoryId,
        toneCategoryKey: args.toneCategoryKey,
      },
    })
    const file = path.join(dirs.rawDir, `${runId}-dry-run-plan.json`)
    writeJson(file, {
      plan,
      reference_uploads: referenceUploads,
      browser_session: redactSession(session),
    })
    writeJson(path.join(dirs.normalizedDir, `${runId}-summary.json`), {
      command: "lip-sync",
      status: plan.status,
      reason: plan.reason,
      model_req_key: plan.modelReqKey,
      video_reference: videoReference,
      tts_info: plan.providerInput.videoGenInputs.v2vOpt.lipSyncUserVideo.ttsInfo,
      reference_uploads: referenceUploads.map((upload) => ({
        index: upload.index,
        role: upload.role,
        source_file: upload.source_file,
        artifact_copy: upload.artifact_copy,
        vid: upload.video_upload.vid,
        uri: upload.video_upload.uri,
        width: upload.video_upload.width,
        height: upload.video_upload.height,
        duration: upload.video_upload.duration,
      })),
      next_probe: plan.nextProbe,
    })
    console.log(`[jimeng-browser-proxy] lip-sync dry run saved: ${file}`)
    return
  }

  if (!args.capture) throw new Error("--capture is required")

  const op: JimengOp = args.command === "text2image" ? "image" : "video"
  const runId = `${args.command}-${new Date().toISOString().replace(/[-:.TZ]/g, "").slice(0, 14)}-${Math.random().toString(36).slice(2, 8)}`
  const dirs = ensureOutputDirs(path.resolve(args.outDir))
  const capture = readJson(args.capture) as CaptureFile
  const referenceUploads: ReferenceUploadSummary[] = []
  let firstFrameUri = args.firstFrameUri
  let lastFrameUri = args.lastFrameUri

  if (args.command === "image2video" || args.command === "frames2video") {
    const imageFile = args.image ?? args.file
    if (imageFile) {
      const upload = await uploadReferenceImage({
        session,
        dirs,
        runId,
        role: "first_frame",
        index: 0,
        sourceFile: imageFile,
      })
      referenceUploads.push(upload)
      firstFrameUri = upload.uri
    }

    if (!firstFrameUri) {
      throw new Error(`${args.command} requires --image, --file, or --firstFrameUri`)
    }

    if (args.command === "frames2video") {
      if (args.lastImage) {
        const upload = await uploadReferenceImage({
          session,
          dirs,
          runId,
          role: "end_frame",
          index: 1,
          sourceFile: args.lastImage,
        })
        referenceUploads.push(upload)
        lastFrameUri = upload.uri
      }

      if (!lastFrameUri) {
        throw new Error("frames2video requires --lastImage or --lastFrameUri")
      }
    }
  }

  const prepared = prepareFromCapture({
    op,
    capture,
    session,
    prompt: args.prompt,
    durationSec: args.durationSec,
    firstFrameUri,
    lastFrameUri,
    ratio: args.ratio,
    videoResolution: args.videoResolution,
    modelVersion: args.modelVersion,
    modelReqKey: args.modelReqKey,
    seed: args.seed,
  })

  const plan = {
    command: args.command,
    op: prepared.op,
    submit_kind: prepared.submitKind,
    poll_kind: prepared.pollKind,
    submit_id: prepared.submitId,
    submit_url: prepared.submitUrl,
    poll_url: prepared.pollUrl,
    submit_headers: redactHeaders(prepared.submitHeaders),
    poll_headers: redactHeaders(prepared.pollHeaders),
    submit_body: prepared.submitBody,
    poll_body: prepared.pollBody,
    terminal_status: prepared.terminalStatus,
    reference_uploads: referenceUploads,
    browser_session: redactSession(session),
  }

  if (args.dryRun) {
    const file = path.join(dirs.rawDir, `${runId}-dry-run-plan.json`)
    writeJson(file, plan)
    console.log(`[jimeng-browser-proxy] dry run saved: ${file}`)
    return
  }

  const client = new JimengClient()
  console.log(`[jimeng-browser-proxy] live submit command=${args.command} submitKind=${prepared.submitKind} pollKind=${prepared.pollKind}`)
  const submit = await client.submitPrepared(prepared)
  writeJson(path.join(dirs.rawDir, `${runId}-submit.json`), submit)
  console.log(`[jimeng-browser-proxy] submit accepted submitId=${submit.submitId} historyId=${submit.historyId ?? "n/a"}`)

  const poll = await client.pollUntilTerminal({
    pollUrl: prepared.pollUrl,
    pollHeaders: prepared.pollHeaders,
    submitId: submit.submitId,
    terminalStatus: prepared.terminalStatus,
    pollKind: prepared.pollKind,
    pollBody: prepared.pollBody,
    pollIntervalMs: args.pollIntervalMs,
    maxPolls: args.maxPolls,
  })
  writeJson(path.join(dirs.rawDir, `${runId}-poll.json`), poll)
  console.log(`[jimeng-browser-proxy] poll complete status=${poll.record.status ?? "unknown"} trace=${poll.trace.length}`)

  const artifacts = args.noDownload ? [] : await client.downloadArtifacts(prepared.op, poll.record)
  const manifest = []
  for (let i = 0; i < artifacts.length; i += 1) {
    const artifact = artifacts[i]!
    const ext = artifact.kind === "video" ? "mp4" : "png"
    const file = path.join(dirs.artifactsDir, `${submit.submitId}-${String(i).padStart(2, "0")}.${ext}`)
    writeFileSync(file, Buffer.from(artifact.bytes))
    manifest.push({ kind: artifact.kind, url: artifact.url, saved_file: file })
  }

  writeJson(path.join(dirs.normalizedDir, `${runId}-result.json`), { plan, submit, pollTrace: poll.trace, artifacts: manifest })
  console.log(`[jimeng-browser-proxy] done artifacts=${manifest.length}`)
}

function parseArgs(argv: string[]): CliArgs {
  if (argv.includes("--help") || argv.includes("-h") || argv.length === 0) {
    console.log(USAGE)
    process.exit(0)
  }

  const command = argv[0]
  if (
    command !== "session"
    && command !== "catalog"
    && command !== "voices"
    && command !== "tts"
    && command !== "sample-voices"
    && command !== "templates"
    && command !== "short-videos"
    && command !== "upload-token"
    && command !== "upload-image"
    && command !== "upload-video"
    && command !== "text2image"
    && command !== "text2video"
    && command !== "image2video"
    && command !== "frames2video"
    && command !== "lip-sync"
  ) {
    throw new Error(`Unknown command: ${String(command)}`)
  }

  const flags = parseFlags(argv.slice(1))
  const durationSec = flags.durationSec
  const videoWidth = flags.videoWidth ? Number(flags.videoWidth) : undefined
  const videoHeight = flags.videoHeight ? Number(flags.videoHeight) : undefined
  const videoDurationSec = flags.videoDurationSec ? Number(flags.videoDurationSec) : undefined
  const speed = flags.speed ? Number(flags.speed) : undefined
  const seed = flags.seed ? Number(flags.seed) : undefined
  const itemPlatform = flags["item-platform"] ? Number(flags["item-platform"]) : undefined
  const limit = flags.limit ? Number(flags.limit) : undefined
  const offset = flags.offset ? Number(flags.offset) : undefined
  const categoryId = flags["category-id"] ? Number(flags["category-id"]) : undefined
  if (seed !== undefined && (!Number.isInteger(seed) || seed < 0 || seed > 4294967295)) {
    throw new Error("--seed must be an integer from 0 to 4294967295")
  }
  if (itemPlatform !== undefined && (!Number.isInteger(itemPlatform) || itemPlatform < 1)) {
    throw new Error("--item-platform must be a positive integer")
  }
  if (limit !== undefined && (!Number.isInteger(limit) || limit < 1)) {
    throw new Error("--limit must be a positive integer")
  }
  if (offset !== undefined && (!Number.isInteger(offset) || offset < 0)) {
    throw new Error("--offset must be a non-negative integer")
  }
  if (categoryId !== undefined && (!Number.isInteger(categoryId) || categoryId < 1)) {
    throw new Error("--category-id must be a positive integer")
  }
  if (videoWidth !== undefined && (!Number.isInteger(videoWidth) || videoWidth < 1)) {
    throw new Error("--videoWidth must be a positive integer")
  }
  if (videoHeight !== undefined && (!Number.isInteger(videoHeight) || videoHeight < 1)) {
    throw new Error("--videoHeight must be a positive integer")
  }
  if (videoDurationSec !== undefined && (!Number.isFinite(videoDurationSec) || videoDurationSec <= 0)) {
    throw new Error("--videoDurationSec must be a positive number")
  }
  if (speed !== undefined && (!Number.isFinite(speed) || speed < 0.5 || speed > 2)) {
    throw new Error("--speed must be a number from 0.5 to 2")
  }
  return {
    command,
    cdpUrl: flags.cdp ?? DEFAULT_CDP_URL,
    targetUrl: flags["target-url"],
    session: flags.session,
    sessionOut: flags["session-out"] ?? "data/jimeng-lab/raw/session-bundle-current.json",
    capture: flags.capture,
    endpoints: flags.endpoints,
    text: flags.text,
    voiceId: flags["voice-id"],
    voiceTitle: flags["voice-title"],
    toneKey: flags["tone-key"],
    toneCategoryId: flags["tone-category-id"],
    toneCategoryKey: flags["tone-category-key"],
    speed,
    itemPlatform,
    limit,
    offset,
    categoryId,
    workTypes: flags["work-types"],
    feedRefer: flags["feed-refer"],
    scene: flags.scene,
    file: flags.file,
    video: flags.video,
    vid: flags.vid,
    videoUri: flags.videoUri,
    videoWidth,
    videoHeight,
    videoDurationSec,
    videoMode: flags.videoMode,
    image: flags.image,
    lastImage: flags.lastImage,
    firstFrameUri: flags.firstFrameUri,
    lastFrameUri: flags.lastFrameUri,
    ratio: flags.ratio,
    videoResolution: flags.videoResolution,
    modelVersion: flags.modelVersion,
    modelReqKey: flags.modelReqKey,
    seed,
    prompt: flags.prompt,
    outDir: flags.outDir ?? "data/jimeng-lab/browser-proxy",
    dryRun: flags.dryRun === "true",
    noDownload: flags.noDownload === "true",
    pollIntervalMs: Number(flags.pollIntervalMs ?? 3000),
    maxPolls: Number(flags.maxPolls ?? 30),
    durationSec: durationSec ? Number(durationSec) : undefined,
  }
}

function loadSession(args: CliArgs): Promise<JimengSessionBundle> | JimengSessionBundle {
  if (args.session) return readJson(args.session) as JimengSessionBundle
  return loadJimengSessionFromBrowser({ cdpUrl: args.cdpUrl, targetUrl: args.targetUrl })
}

function parseFlags(argv: string[]): Record<string, string> {
  const flags: Record<string, string> = {}
  for (let i = 0; i < argv.length; i += 1) {
    const token = argv[i]
    if (!token?.startsWith("--")) continue

    const eq = token.indexOf("=")
    if (eq > 2) {
      flags[token.slice(2, eq)] = token.slice(eq + 1)
      continue
    }

    const key = token.slice(2)
    const next = argv[i + 1]
    if (next && !next.startsWith("--")) {
      flags[key] = next
      i += 1
    } else {
      flags[key] = "true"
    }
  }
  return flags
}

interface OutputDirs {
  rawDir: string
  normalizedDir: string
  artifactsDir: string
}

interface ReferenceUploadSummary {
  index: number
  role: ReferenceImageRole
  source_file: string
  artifact_copy: string
  raw_file: string
  uri: string
  image_upload: JimengImageUploadResult["summary"]
}

type ReferenceImageRole = "first_frame" | "end_frame"

interface ReferenceVideoUploadSummary {
  index: number
  role: ReferenceVideoRole
  source_file: string
  artifact_copy: string
  raw_file: string
  video_upload: JimengVideoUploadResult["summary"]
}

type ReferenceVideoRole = "lip_sync_video"

async function uploadReferenceImage(input: {
  session: JimengSessionBundle
  dirs: OutputDirs
  runId: string
  role: ReferenceImageRole
  index: number
  sourceFile: string
}): Promise<ReferenceUploadSummary> {
  const sourceFile = path.resolve(input.sourceFile)
  const bytes = readFileSync(sourceFile)
  const artifactFile = path.join(input.dirs.artifactsDir, `${input.runId}-${input.role}-${path.basename(sourceFile)}`)
  writeFileSync(artifactFile, bytes)

  const result = await uploadJimengImage({
    session: input.session,
    image: {
      fileName: path.basename(sourceFile),
      bytes,
    },
  })
  const rawFile = path.join(input.dirs.rawDir, `${input.runId}-reference-upload-${input.index}-raw.json`)
  writeJson(rawFile, {
    token: {
      http_status: result.token.httpStatus,
      response_text_sha256: result.token.responseTextSha256,
      body: result.token.body,
    },
    apply: {
      http_status: result.apply.httpStatus,
      response_text_sha256: result.apply.responseTextSha256,
      body: result.apply.body,
    },
    upload: {
      http_status: result.upload.httpStatus,
      response_text_sha256: result.upload.responseTextSha256,
      body: result.upload.body,
    },
    commit: {
      http_status: result.commit.httpStatus,
      response_text_sha256: result.commit.responseTextSha256,
      body: result.commit.body,
    },
  })

  const uri = result.summary.imageUris[0]
  if (!uri) {
    throw new Error("Image upload did not return an image URI")
  }

  return {
    index: input.index,
    role: input.role,
    source_file: sourceFile,
    artifact_copy: artifactFile,
    raw_file: rawFile,
    uri,
    image_upload: result.summary,
  }
}

async function uploadReferenceVideo(input: {
  session: JimengSessionBundle
  dirs: OutputDirs
  runId: string
  role: ReferenceVideoRole
  index: number
  sourceFile: string
}): Promise<ReferenceVideoUploadSummary> {
  const sourceFile = path.resolve(input.sourceFile)
  const bytes = readFileSync(sourceFile)
  const artifactFile = path.join(input.dirs.artifactsDir, `${input.runId}-${input.role}-${path.basename(sourceFile)}`)
  writeFileSync(artifactFile, bytes)

  const result = await uploadJimengVideo({
    session: input.session,
    video: {
      fileName: path.basename(sourceFile),
      bytes,
    },
  })
  const rawFile = path.join(input.dirs.rawDir, `${input.runId}-reference-video-upload-${input.index}-raw.json`)
  writeJson(rawFile, {
    token: {
      http_status: result.token.httpStatus,
      response_text_sha256: result.token.responseTextSha256,
      body: result.token.body,
    },
    apply: {
      http_status: result.apply.httpStatus,
      response_text_sha256: result.apply.responseTextSha256,
      body: result.apply.body,
    },
    upload: {
      http_status: result.upload.httpStatus,
      response_text_sha256: result.upload.responseTextSha256,
      body: result.upload.body,
    },
    commit: {
      http_status: result.commit.httpStatus,
      response_text_sha256: result.commit.responseTextSha256,
      body: result.commit.body,
    },
  })

  const summary: ReferenceVideoUploadSummary = {
    index: input.index,
    role: input.role,
    source_file: sourceFile,
    artifact_copy: artifactFile,
    raw_file: rawFile,
    video_upload: result.summary,
  }
  writeJson(path.join(input.dirs.normalizedDir, `${input.runId}-reference-video-upload-${input.index}-summary.json`), summary)
  return summary
}

function lipSyncVideoReferenceFromArgs(args: CliArgs): JimengLipSyncVideoReference {
  if (!args.vid || !args.videoWidth || !args.videoHeight || !args.videoDurationSec) {
    throw new Error("lip-sync requires --video/--file or existing --vid with --videoWidth, --videoHeight, and --videoDurationSec")
  }

  return {
    vid: args.vid,
    uri: args.videoUri ?? null,
    width: args.videoWidth,
    height: args.videoHeight,
    duration: args.videoDurationSec,
  }
}

function ensureOutputDirs(outDir: string): { rawDir: string; normalizedDir: string; artifactsDir: string } {
  const rawDir = path.join(outDir, "raw")
  const normalizedDir = path.join(outDir, "normalized")
  const artifactsDir = path.join(outDir, "artifacts")
  mkdirSync(rawDir, { recursive: true })
  mkdirSync(normalizedDir, { recursive: true })
  mkdirSync(artifactsDir, { recursive: true })
  return { rawDir, normalizedDir, artifactsDir }
}

function readVoiceCapture(file: string | undefined): CaptureFile {
  const captureFile = file ?? getDefaultVoiceLibraryCapturePath()
  return readJson(captureFile) as CaptureFile
}

function readJson(file: string): unknown {
  return JSON.parse(readFileSync(path.resolve(file), "utf8"))
}

function writeJson(file: string, value: unknown): void {
  writeFileSync(file, `${JSON.stringify(value, null, 2)}\n`, "utf8")
}

function redactSession(session: JimengSessionBundle): JimengSessionBundle {
  return {
    ...session,
    cookie: `[REDACTED ${session.cookie.length} chars]`,
  }
}

function slug(value: string): string {
  const normalized = value
    .replace(/[\\/:*"<>|\s]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 96)
  return normalized || "jimeng"
}

if (import.meta.main) {
  main(process.argv.slice(2)).catch((error) => {
    if (error instanceof JimengError) {
      console.error(JSON.stringify(error.toJSON(), null, 2))
      process.exit(error.retryable ? 2 : 1)
    }
    console.error(error instanceof Error ? error.message : String(error))
    process.exit(1)
  })
}
