import { mkdir, writeFile } from "node:fs/promises"
import { extname, join, resolve, sep } from "node:path"
import puppeteer from "puppeteer"
import type { SceneSpec } from "./schema"

export interface CaptureOptions {
  readonly publicDir: string
  readonly runtimePath: string
  readonly outDir: string
  readonly frameRange?: readonly [number, number]
}

export interface CaptureResult {
  readonly framesDir: string
  readonly startFrame: number
  readonly endFrame: number
  readonly frameCount: number
}

interface RuntimeInitOptions {
  readonly width: number
  readonly height: number
  readonly fps: number
  readonly assetBaseUrl: string
}

interface SceneRuntimeGlobal {
  init(spec: SceneSpec, opts: RuntimeInitOptions): Promise<void>
  renderFrame(frame: number): void
  durationInFrames(): number
  start(): void
  stop(): void
}


export async function captureFrames(spec: SceneSpec, options: CaptureOptions): Promise<CaptureResult> {
  const framesDir = join(options.outDir, "frames")
  await mkdir(framesDir, { recursive: true })

  const fullFrameCount = Math.ceil(spec.durationSeconds * spec.fps)
  const startFrame = options.frameRange?.[0] ?? 0
  const endFrame = options.frameRange?.[1] ?? fullFrameCount - 1
  if (startFrame < 0 || endFrame < startFrame || endFrame >= fullFrameCount) {
    throw new Error(`frame range ${startFrame}-${endFrame} outside 0-${fullFrameCount - 1}`)
  }

  const publicDir = resolve(options.publicDir)
  const runtimePath = resolve(options.runtimePath)
  const server = Bun.serve({
    port: 0,
    async fetch(request) {
      const url = new URL(request.url)
      if (url.pathname === "/" || url.pathname === "/index.html") {
        return new Response(indexHtml(), { headers: { "content-type": "text/html; charset=utf-8" } })
      }
      if (url.pathname === "/runtime.js") {
        return new Response(Bun.file(runtimePath), { headers: { "content-type": "application/javascript; charset=utf-8" } })
      }
      const filePath = resolve(publicDir, `.${decodeURIComponent(url.pathname)}`)
      if (filePath !== publicDir && !filePath.startsWith(`${publicDir}${sep}`)) {
        return new Response("not found", { status: 404 })
      }
      const file = Bun.file(filePath)
      if (!(await file.exists())) return new Response("not found", { status: 404 })
      return new Response(file, { headers: { "content-type": contentType(filePath) } })
    },
  })

  const origin = `http://127.0.0.1:${server.port}`
  const browser = await puppeteer.launch({
    headless: true,
    args: ["--enable-unsafe-swiftshader", "--use-angle=swiftshader", "--no-sandbox"],
  })

  try {
    const page = await browser.newPage()
    await page.setViewport({ width: spec.width, height: spec.height, deviceScaleFactor: 1 })
    await page.goto(`${origin}/index.html`, { waitUntil: "load" })
    await page.evaluate(
      async (payload: { readonly spec: SceneSpec; readonly opts: RuntimeInitOptions }) => {
        const runtime = (window as Window & { SceneRuntime: SceneRuntimeGlobal }).SceneRuntime
        await runtime.init(payload.spec, payload.opts)
      },
      { spec, opts: { width: spec.width, height: spec.height, fps: spec.fps, assetBaseUrl: origin } },
    )

    for (let frame = startFrame; frame <= endFrame; frame += 1) {
      const dataUrl = await page.evaluate((currentFrame: number) => {
        const runtime = (window as Window & { SceneRuntime: SceneRuntimeGlobal }).SceneRuntime
        runtime.renderFrame(currentFrame)
        const canvas = document.querySelector("canvas#scene")
        if (!(canvas instanceof HTMLCanvasElement)) throw new Error("runtime did not create canvas#scene")
        return canvas.toDataURL("image/png")
      }, frame)
      await writePngDataUrl(join(framesDir, `${String(frame).padStart(6, "0")}.png`), dataUrl)
    }
  } finally {
    await browser.close()
    server.stop(true)
  }

  return { framesDir, startFrame, endFrame, frameCount: endFrame - startFrame + 1 }
}

function indexHtml(): string {
  return '<!doctype html><html><head><meta charset="utf-8"></head><body style="margin:0;overflow:hidden;background:#000"><script src="/runtime.js"></script></body></html>'
}

async function writePngDataUrl(path: string, dataUrl: string): Promise<void> {
  const prefix = "data:image/png;base64,"
  if (!dataUrl.startsWith(prefix)) throw new Error("canvas returned a non-PNG data URL")
  await writeFile(path, Buffer.from(dataUrl.slice(prefix.length), "base64"))
}

function contentType(path: string): string {
  const extension = extname(path).toLowerCase()
  if (extension === ".png") return "image/png"
  if (extension === ".jpg" || extension === ".jpeg") return "image/jpeg"
  if (extension === ".webp") return "image/webp"
  if (extension === ".mp3") return "audio/mpeg"
  if (extension === ".wav") return "audio/wav"
  if (extension === ".m4a") return "audio/mp4"
  return "application/octet-stream"
}
