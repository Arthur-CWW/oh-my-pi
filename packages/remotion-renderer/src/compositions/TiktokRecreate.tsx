import React, { useMemo } from "react"
import { z } from "zod"
import {
  AbsoluteFill,
  Audio,
  Easing,
  Img,
  OffthreadVideo,
  interpolate,
  Sequence,
  spring,
  staticFile,
  useCurrentFrame,
  useVideoConfig,
} from "remotion"
// ── Layer-plan schemas ─────────────────────────────────────────────────────

const LAYER_TYPES = [
  "BackgroundLayer",
  "GridOverlay",
  "PlateLayer",
  "PresenterLayer",
  "TypographyLayer",
  "CounterLayer",
  "FlashOverlay",
  "SplitRevealLayer",
  "ClipLayer",
  "DiagramLayer",
  "DocumentLayer",
  "MapLayer",
  "TimelineLayer",
] as const
export const layerDefSchema = z.object({
  type: z.enum(LAYER_TYPES),
  zIndex: z.number().optional(),
  props: z.record(z.unknown()).optional().default({}),
  inFrame: z.number().optional(),
  outFrame: z.number().optional(),
})

export const beatSchema = z.object({
  startFrame: z.number(),
  endFrame: z.number(),
  layers: z.array(layerDefSchema),
})

export const layerPlanSchema = z.object({
  beats: z.array(beatSchema),
})

export type LayerDef = z.infer<typeof layerDefSchema>
export type Beat = z.infer<typeof beatSchema>
export type LayerPlan = z.infer<typeof layerPlanSchema>

// ── Main composition schema ────────────────────────────────────────────────

const captionCueSchema = z.object({
  text: z.string(),
  startFrame: z.number(),
  endFrame: z.number(),
})

export const tiktokRecreateSchema = z.object({
  sourceVideoId: z.string(),
  title: z.string(),
  transcript: z.string(),
  durationInFrames: z.number(),
  segments: z.array(
    z.object({
      startFrame: z.number(),
      endFrame: z.number(),
      narrationFunction: z.string(),
      visualFunction: z.string(),
      caption: z.string(),
    }),
  ),
  layerPlan: layerPlanSchema.optional(),
  personaImageUrl: z.string().optional(),
  plates: z.array(z.string()).optional(),
  audioUrl: z.string().optional(),
  width: z.number().optional(),
  height: z.number().optional(),
  fps: z.number().optional(),
  captionCues: z.array(captionCueSchema).optional(),
})

export type TiktokRecreateProps = z.infer<typeof tiktokRecreateSchema>

// ── Theme helpers ──────────────────────────────────────────────────────────

const DARK_BG = "#0a0a0c"
const ACCENT_RED = "#ff2a2a"
const TEXT_GLOW = "rgba(255, 255, 255, 0.85)"

function hashString(str: string): number {
  let h = 0
  for (let i = 0; i < str.length; i += 1) {
    h = (h << 5) - h + str.charCodeAt(i)
    h |= 0
  }
  return Math.abs(h)
}

function generateDocumentaryGradient(seed: string): string {
  const h = hashString(seed)
  const hues = [210, 220, 230, 240, 200]
  const hue1 = hues[h % hues.length]
  const hue2 = hues[(h + 1) % hues.length]
  return `linear-gradient(160deg, hsl(${hue1}, 20%, 8%), hsl(${hue2}, 18%, 4%))`
}

function useBeatProgress(startFrame: number, endFrame: number) {
  const frame = useCurrentFrame()
  const duration = Math.max(1, endFrame - startFrame)
  const local = Math.max(0, Math.min(frame, duration))
  return local / duration
}

function useKenBurnsTransform(index: number, startFrame: number, endFrame: number) {
  const progress = useBeatProgress(startFrame, endFrame)
  const direction = index % 4
  const startX = direction === 0 || direction === 2 ? -5 : 5
  const endX = -startX
  const startY = direction === 0 || direction === 1 ? -3 : 3
  const endY = -startY
  const startScale = 1 + (index % 3) * 0.03
  const endScale = startScale + 0.08

  const x = interpolate(progress, [0, 1], [startX, endX], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
  })
  const y = interpolate(progress, [0, 1], [startY, endY], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
  })
  const scale = interpolate(progress, [0, 1], [startScale, endScale], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
  })

  return { x, y, scale }
}

function getLinesText(props: Record<string, unknown>): string {
  const lines = props.lines
  if (Array.isArray(lines)) {
    return lines
      .map((line) => (line && typeof line === "object" ? (line as Record<string, unknown>).text : ""))
      .filter((t): t is string => typeof t === "string")
      .join("\n")
  }
  return (props.text as string) || ""
}

function hasCaptionVariant(props: Record<string, unknown>): boolean {
  const lines = props.lines
  if (!Array.isArray(lines)) return false
  return lines.some(
    (line) =>
      line &&
      typeof line === "object" &&
      (line as Record<string, unknown>).variant === "caption",
  )
}

function collidesWithCaptionTrack(props: Record<string, unknown>): boolean {
  if (hasCaptionVariant(props)) return true
  const position = props.position
  if (!position || typeof position !== "object") return false
  const y = (position as Record<string, unknown>).y
  return typeof y === "number" && y >= 0.66
}

function resolveAssetSrc(value: string): string {
  if (
    value.startsWith("http://") ||
    value.startsWith("https://") ||
    value.startsWith("data:") ||
    value.startsWith("blob:") ||
    value.startsWith("file:")
  ) {
    return value
  }
  return staticFile(value)
}

function resolvePosition(
  position: unknown,
): { left?: string; top?: string; transform?: string; textAlign?: string } {
  if (
    position &&
    typeof position === "object" &&
    "x" in (position as object) &&
    "y" in (position as object)
  ) {
    const p = position as { x: number; y: number; anchor?: string }
    const anchor = p.anchor || "center"
    const tx = anchor.includes("left") ? "0" : anchor.includes("right") ? "-100%" : "-50%"
    const ty = anchor.includes("top") ? "0" : anchor.includes("bottom") ? "-100%" : "-50%"
    return {
      left: `${p.x * 100}%`,
      top: `${p.y * 100}%`,
      transform: `translate(${tx}, ${ty})`,
      textAlign: anchor as string,
    }
  }
  return {}
}

// ── Layer component interface ──────────────────────────────────────────────

interface LayerComponentProps {
  beatStartFrame: number
  beatEndFrame: number
  layer: LayerDef
  index: number
  hasCaptionTrack?: boolean
}

// ── Layer primitives ───────────────────────────────────────────────────────

const BackgroundLayer: React.FC<LayerComponentProps> = ({
  beatStartFrame,
  beatEndFrame,
  layer,
}) => {
  const localFrame = useCurrentFrame()
  const duration = Math.max(1, beatEndFrame - beatStartFrame)
  const props = layer.props as Record<string, unknown>
  const color = (props.color as string) || DARK_BG
  const imageUrl = props.imageUrl as string | undefined

  const opacity = interpolate(localFrame, [0, Math.min(12, duration * 0.08)], [0, 1], {
    extrapolateRight: "clamp",
  })
  const pulse = 1 + Math.sin(localFrame * 0.015) * 0.025

  return (
    <AbsoluteFill
      style={{
        backgroundColor: color,
        backgroundImage: imageUrl ? `url(${resolveAssetSrc(imageUrl)})` : undefined,
        backgroundSize: "cover",
        backgroundPosition: "center",
        opacity,
        transform: `scale(${pulse})`,
      }}
    >
      {(props.vignette as Record<string, unknown>)?.strength ? (
        <div
          style={{
            position: "absolute",
            inset: 0,
            background: `radial-gradient(circle at center, transparent 30%, ${
              (props.vignette as Record<string, unknown>).color as string
            } 100%)`,
            opacity: (props.vignette as Record<string, unknown>).strength as number,
          }}
        />
      ) : null}
    </AbsoluteFill>
  )
}

const GridOverlay: React.FC<LayerComponentProps> = ({
  beatStartFrame,
  beatEndFrame,
  layer,
}) => {
  const localFrame = useCurrentFrame()
  const duration = Math.max(1, beatEndFrame - beatStartFrame)
  const props = layer.props as Record<string, unknown>
  const gridColor = (props.color as string) || "rgba(255,42,42,0.06)"
  const divisions = props.divisions as { x?: number; y?: number } | undefined
  const cellX = divisions?.x ? Math.round(1080 / divisions.x) : 80
  const cellY = divisions?.y ? Math.round(1920 / divisions.y) : 80

  const opacity = interpolate(localFrame, [0, Math.min(15, duration * 0.1)], [0, (props.opacity as number) ?? 0.1], {
    extrapolateRight: "clamp",
  })
  const driftX = Math.sin(localFrame * 0.004) * 3
  const driftY = Math.cos(localFrame * 0.006) * 2

  return (
    <AbsoluteFill style={{ opacity, pointerEvents: "none" }}>
      <svg width="100%" height="100%" style={{ position: "absolute", inset: 0 }}>
        <defs>
          <pattern
            id={`g-${beatStartFrame}`}
            width={cellX}
            height={cellY}
            patternUnits="userSpaceOnUse"
            patternTransform={`translate(${driftX},${driftY})`}
          >
            <path
              d={`M ${cellX} 0 L 0 0 0 ${cellY}`}
              fill="none"
              stroke={gridColor}
              strokeWidth="0.5"
            />
          </pattern>
        </defs>
        <rect width="100%" height="100%" fill={`url(#g-${beatStartFrame})`} />
      </svg>
    </AbsoluteFill>
  )
}

const PlateLayer: React.FC<LayerComponentProps> = ({
  beatStartFrame,
  beatEndFrame,
  layer,
  index,
}) => {
  const frame = useCurrentFrame()
  const props = layer.props as Record<string, unknown>
  const plateUrl = (props.src as string) || (props.plateUrl as string) || undefined
  const visualFunction = (props.visualFunction as string) || "documentary background"
  const kenBurns = props.kenBurns !== false
  const opacity = (props.opacity as number) ?? 0.82
  const desaturate = (props.desaturate as number) ?? 0
  const blur = (props.blur as number) ?? 0

  const kbConfig = props.kenBurns as
    | { start?: { x?: number; y?: number; scale?: number }; end?: { x?: number; y?: number; scale?: number } }
    | undefined

  const progress = useBeatProgress(beatStartFrame, beatEndFrame)
  const baseX = interpolate(progress, [0, 1], [-5, 5], { extrapolateLeft: "clamp", extrapolateRight: "clamp" })
  const baseY = interpolate(progress, [0, 1], [-3, 3], { extrapolateLeft: "clamp", extrapolateRight: "clamp" })
  const baseScale = interpolate(progress, [0, 1], [1.02, 1.1], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
  })

  const startX = (kbConfig?.start?.x ?? 0.5) * 100 - 50
  const endX = (kbConfig?.end?.x ?? 0.5) * 100 - 50
  const startY = (kbConfig?.start?.y ?? 0.5) * 100 - 50
  const endY = (kbConfig?.end?.y ?? 0.5) * 100 - 50
  const startScale = kbConfig?.start?.scale ?? 1
  const endScale = kbConfig?.end?.scale ?? 1.08

  const x = kenBurns
    ? interpolate(progress, [0, 1], [startX, endX], { extrapolateLeft: "clamp", extrapolateRight: "clamp" })
    : baseX
  const y = kenBurns
    ? interpolate(progress, [0, 1], [startY, endY], { extrapolateLeft: "clamp", extrapolateRight: "clamp" })
    : baseY
  const scale = kenBurns
    ? interpolate(progress, [0, 1], [startScale, endScale], { extrapolateLeft: "clamp", extrapolateRight: "clamp" })
    : baseScale

  const localFrame = frame
  const enter = interpolate(localFrame, [0, 12], [0.85, 1], { extrapolateRight: "clamp" })

  if (!plateUrl) {
    const gradient = generateDocumentaryGradient(`${visualFunction}-${index}`)
    return (
      <AbsoluteFill
        style={{
          background: gradient,
          opacity: enter,
        }}
      >
        <div
          style={{
            width: "100%",
            height: "100%",
            backgroundImage:
              "radial-gradient(circle at 30% 20%, rgba(255,42,42,0.12), transparent 45%), radial-gradient(circle at 80% 80%, rgba(255,255,255,0.04), transparent 35%)",
          }}
        />
      </AbsoluteFill>
    )
  }

  return (
    <AbsoluteFill
      style={{
        transform: `translate(${x}%, ${y}%) scale(${scale})`,
        transformOrigin: "center center",
        overflow: "hidden",
        opacity: enter,
      }}
    >
      <Img
        src={resolveAssetSrc(plateUrl)}
        alt=""
        style={{
          position: "absolute",
          left: "-10%",
          top: "-10%",
          width: "120%",
          height: "120%",
          objectFit: "cover",
          opacity,
          filter: `grayscale(${desaturate}) blur(${blur}px)`,
        }}
      />
      <div
        style={{
          position: "absolute",
          inset: 0,
          background:
            "linear-gradient(to bottom, rgba(0,0,0,0.35) 0%, transparent 35%, transparent 60%, rgba(0,0,0,0.58) 100%)",
        }}
      />
    </AbsoluteFill>
  )
}

const ClipLayer: React.FC<LayerComponentProps> = ({
  beatStartFrame,
  beatEndFrame,
  layer,
  index,
}) => {
  const frame = useCurrentFrame()
  const props = layer.props as Record<string, unknown>
  const clipUrl =
    (props.src as string | undefined) ||
    (props.videoUrl as string | undefined) ||
    (props.clipUrl as string | undefined)
  const placeholderImage =
    (props.placeholderImage as string | undefined) ||
    (props.placeholderImagePath as string | undefined) ||
    (props.placeholderMediaPath as string | undefined)
  const missingLiveMedia = props.missingLiveMedia === true || props.mediaAvailable === false || !clipUrl
  const plannedArtifactPath = (props.plannedArtifactPath as string | undefined) || (props.artifactPath as string | undefined)
  const generatedClipId = (props.generatedClipId as string | undefined) || (props.clipId as string | undefined) || `clip-${index}`
  const reason =
    (props.missingLiveMediaReason as string | undefined) ||
    (plannedArtifactPath ? `Missing local MP4: ${plannedArtifactPath}` : "Missing generated MP4")
  const objectFit = (props.objectFit as React.CSSProperties["objectFit"]) || "cover"
  const opacity = (props.opacity as number) ?? 1
  const progress = useBeatProgress(beatStartFrame, beatEndFrame)
  const localFrame = frame
  const enter = interpolate(localFrame, [0, 12], [0, 1], { extrapolateRight: "clamp" })
  const drift = interpolate(progress, [0, 1], [-2, 2], { extrapolateLeft: "clamp", extrapolateRight: "clamp" })
  const glow = interpolate(progress, [0, 0.5, 1], [0.18, 0.32, 0.18], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
  })

  if (!missingLiveMedia && clipUrl) {
    return (
      <AbsoluteFill style={{ background: "#02040a", opacity: enter }}>
        <OffthreadVideo
          src={resolveAssetSrc(clipUrl)}
          muted
          style={{
            width: "100%",
            height: "100%",
            objectFit,
            opacity,
          }}
        />
        <div
          style={{
            position: "absolute",
            inset: 0,
            background:
              "linear-gradient(to bottom, rgba(0,0,0,0.12) 0%, transparent 42%, rgba(0,0,0,0.45) 100%)",
          }}
        />
      </AbsoluteFill>
    )
  }

  return (
    <AbsoluteFill
      style={{
        background:
          "radial-gradient(circle at 50% 24%, rgba(183, 215, 255, 0.22), transparent 36%), linear-gradient(150deg, #05070d 0%, #0b1122 45%, #02040a 100%)",
        opacity: enter,
        overflow: "hidden",
      }}
    >
      <div
        style={{
          position: "absolute",
          inset: "-8%",
          transform: `translate(${drift}%, ${-drift}%) scale(1.05)`,
          backgroundImage:
            `radial-gradient(circle at 25% 30%, rgba(168, 200, 255, ${glow}), transparent 18%), radial-gradient(circle at 72% 48%, rgba(255,255,255,0.1), transparent 14%), repeating-linear-gradient(92deg, rgba(183,215,255,0.08) 0 1px, transparent 1px 18px)`,
          filter: "blur(0.2px)",
        }}
      />
      {placeholderImage ? (
        <Img
          src={resolveAssetSrc(placeholderImage)}
          alt=""
          style={{
            position: "absolute",
            inset: 0,
            width: "100%",
            height: "100%",
            objectFit: "cover",
            opacity: 0.72,
          }}
        />
      ) : null}
      <div
        style={{
          position: "absolute",
          left: 72,
          right: 72,
          bottom: 180,
          padding: "28px 32px",
          border: "1px solid rgba(183, 215, 255, 0.26)",
          borderRadius: 28,
          background: "rgba(3, 7, 16, 0.68)",
          color: "rgba(236, 246, 255, 0.92)",
          fontFamily: "-apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif",
          boxShadow: "0 0 50px rgba(120, 170, 255, 0.16)",
        }}
      >
        <div style={{ fontSize: 30, fontWeight: 700, letterSpacing: "0.08em", textTransform: "uppercase" }}>
          Generated clip placeholder
        </div>
        <div style={{ marginTop: 14, fontSize: 24, lineHeight: 1.35, color: "rgba(236, 246, 255, 0.78)" }}>
          {generatedClipId}
        </div>
        <div style={{ marginTop: 10, fontSize: 20, lineHeight: 1.35, color: "rgba(236, 246, 255, 0.56)" }}>
          {reason}
        </div>
      </div>
    </AbsoluteFill>
  )
}

const PresenterLayer: React.FC<LayerComponentProps> = ({ layer }) => {
  const localFrame = useCurrentFrame()
  const props = layer.props as Record<string, unknown>
  const src = props.src as string | null | undefined
  const position = (props.position as string) || "lowerThird"
  const scale = (props.scale as number) ?? 0.7

  const opacity = interpolate(localFrame, [0, 20], [0, 1], { extrapolateRight: "clamp" })
  const y = interpolate(localFrame, [0, 20], [60, 0], {
    extrapolateRight: "clamp",
    easing: Easing.out(Easing.cubic),
  })
  const s = spring({
    frame: localFrame,
    fps: 30,
    config: { damping: 18, stiffness: 120 },
    from: 0.88,
    to: 1,
    durationInFrames: 22,
  })

  const isRight = position === "right" || position === "lowerThirdRight"
  const containerStyle: React.CSSProperties = {
    position: "absolute",
    bottom: position === "lowerThird" ? 0 : "15%",
    left: isRight ? "auto" : "-5%",
    right: isRight ? "-5%" : "auto",
    width: `${scale * 100}%`,
    height: `${scale * 100}%`,
    display: "flex",
    alignItems: "flex-end",
    justifyContent: isRight ? "flex-end" : "flex-start",
    opacity,
    transform: `translateY(${y}px) scale(${s})`,
    pointerEvents: "none",
  }

  const maskStyle: React.CSSProperties = {
    width: "60%",
    height: "90%",
    borderRadius: (props.mask as string) === "roundedRect" ? 24 : 0,
    overflow: "hidden",
    backgroundColor: (props.placeholder as Record<string, unknown>)?.color as string,
    boxShadow: `0 20px 60px rgba(0,0,0,0.55)`,
  }

  return (
    <div style={containerStyle}>
      <div style={maskStyle}>
        {src ? (
          <Img src={resolveAssetSrc(src)} alt="" style={{ width: "100%", height: "100%", objectFit: "cover" }} />
        ) : (
          <div
            style={{
              width: "100%",
              height: "100%",
              background: `linear-gradient(160deg, #2a2a30, #0f0f12)`,
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
            }}
          >
            <div
              style={{
                width: "45%",
                height: "35%",
                borderRadius: "50% 50% 45% 45%",
                background: "linear-gradient(180deg, #d4a5a5, #8b6b6b)",
                opacity: 0.6,
              }}
            />
          </div>
        )}
      </div>
    </div>
  )
}

const TypographyLayer: React.FC<LayerComponentProps> = ({ beatStartFrame, beatEndFrame, layer, hasCaptionTrack }) => {
  const localFrame = useCurrentFrame()
  const props = layer.props as Record<string, unknown>
  const text = getLinesText(props)
  const fontSize = (props.fontSize as number) || 52
  const color = (props.color as string) || TEXT_GLOW
  const align = (props.align as string) || "center"
  const position = props.position as { x: number; y: number; anchor?: string } | undefined
  const maxWidth = (props.maxWidth as number) ?? 0.9

  if (hasCaptionTrack && collidesWithCaptionTrack(props)) return null

  const duration = Math.max(1, beatEndFrame - beatStartFrame)
  const opacity = interpolate(localFrame, [0, Math.min(18, duration * 0.15)], [0, 1], {
    extrapolateRight: "clamp",
  })
  const tY = interpolate(localFrame, [0, 20], [36, 0], {
    extrapolateRight: "clamp",
    easing: Easing.out(Easing.cubic),
  })
  const sc = interpolate(localFrame, [0, 22], [0.92, 1], { extrapolateRight: "clamp" })

  const pos = resolvePosition(position)
  const isAbsolute = pos.left !== undefined

  const wrapperStyle: React.CSSProperties = isAbsolute
    ? {
        position: "absolute",
        left: pos.left,
        top: pos.top,
        transform: `${pos.transform || ""} translateY(${tY}px) scale(${sc})`,
        maxWidth: `${maxWidth * 100}%`,
        textAlign: (pos.textAlign as "left" | "right" | "center") || (align as "left" | "right" | "center"),
      }
    : {
        display: "flex",
        alignItems: align === "bottom" ? "flex-end" : "center",
        justifyContent: "center",
        width: "100%",
        height: "100%",
        padding: "0 60px",
        textAlign: align as "left" | "right" | "center",
        transform: `translateY(${tY}px) scale(${sc})`,
      }

  return (
    <div style={{ ...wrapperStyle, opacity, pointerEvents: "none" }}>
      <div
        style={{
          color,
          fontSize,
          lineHeight: (props.lineHeight as number) ?? 1.28,
          fontFamily:
            (props.fontFamily as string) === "sans"
              ? "-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif"
              : "Georgia, 'Times New Roman', Times, serif",
          fontWeight: 600,
          textShadow: "0 2px 24px rgba(0,0,0,0.7), 0 0 40px rgba(255,42,42,0.15)",
          whiteSpace: "pre-line",
        }}
      >
        {text}
      </div>
    </div>
  )
}

const CounterLayer: React.FC<LayerComponentProps> = ({ beatStartFrame, beatEndFrame, layer }) => {
  const localFrame = useCurrentFrame()
  const duration = Math.max(1, beatEndFrame - beatStartFrame)
  const props = layer.props as Record<string, unknown>
  const from = (props.startValue as number) ?? 0
  const to = (props.value as number) ?? 100
  const label = props.label as string | undefined
  const color = (props.color as string) || ACCENT_RED
  const fontSize = (props.fontSize as number) || 96
  const decimals = (props.decimals as number) ?? 0
  const prefix = (props.prefix as string) || ""
  const suffix = (props.suffix as string) || ""

  const progress = interpolate(localFrame, [5, duration * 0.65], [0, 1], {
    extrapolateRight: "clamp",
  })
  const currentValue = from + (to - from) * progress
  const opacity = interpolate(localFrame, [0, 10], [0, 1], { extrapolateRight: "clamp" })
  const pulse = 1 + Math.sin(localFrame * 0.12) * 0.015

  return (
    <AbsoluteFill
      style={{
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        justifyContent: "center",
        opacity,
        transform: `scale(${pulse})`,
      }}
    >
      <div
        style={{
          color,
          fontSize,
          fontWeight: 700,
          fontFamily: "-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif",
          textShadow: `0 0 30px ${color}, 0 4px 20px rgba(0,0,0,0.5)`,
          fontVariantNumeric: "tabular-nums",
        }}
      >
        {prefix}
        {currentValue.toFixed(decimals)}
        {suffix}
      </div>
      {label ? (
        <div
          style={{
            color: "rgba(255,255,255,0.6)",
            fontSize: 24,
            marginTop: 16,
            fontFamily: "Georgia, serif",
            letterSpacing: "0.05em",
          }}
        >
          {label}
        </div>
      ) : null}
    </AbsoluteFill>
  )
}

const FlashOverlay: React.FC<LayerComponentProps> = ({ layer }) => {
  const localFrame = useCurrentFrame()
  const props = layer.props as Record<string, unknown>
  const flashColor = (props.color as string) || "#ffffff"
  const intensity = (props.intensity as number) ?? 0.9
  const durationSeconds = (props.durationSeconds as number) ?? 0.22
  const durationFrames = Math.max(2, Math.round(durationSeconds * 30))

  const opacity = interpolate(localFrame, [0, 2, durationFrames, durationFrames + 10], [0, intensity, intensity * 0.35, 0], {
    extrapolateRight: "clamp",
  })

  if (opacity <= 0) return null

  return (
    <AbsoluteFill
      style={{
        backgroundColor: flashColor,
        opacity,
        pointerEvents: "none",
        mixBlendMode: (props.blendMode as React.CSSProperties["mixBlendMode"]) || "screen",
      }}
    />
  )
}

const SplitRevealLayer: React.FC<LayerComponentProps> = ({
  beatStartFrame,
  beatEndFrame,
  layer,
}) => {
  const localFrame = useCurrentFrame()
  const duration = Math.max(1, beatEndFrame - beatStartFrame)
  const props = layer.props as Record<string, unknown>
  const direction = (props.direction as string) || "horizontal"
  const fromPlate = props.fromPlate as string | undefined
  const toPlate = props.toPlate as string | undefined

  const progress = interpolate(localFrame, [5, duration * 0.5], [0, 1], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
  })
  const isHorizontal = direction === "horizontal" || direction === "left" || direction === "right"
  const gap = progress * 50

  return (
    <AbsoluteFill style={{ pointerEvents: "none" }}>
      {fromPlate ? (
        <Img
          src={resolveAssetSrc(fromPlate)}
          alt=""
          style={{
            position: "absolute",
            inset: 0,
            width: "100%",
            height: "100%",
            objectFit: "cover",
            opacity: 1 - progress,
          }}
        />
      ) : null}
      {toPlate ? (
        <Img
          src={resolveAssetSrc(toPlate)}
          alt=""
          style={{
            position: "absolute",
            inset: 0,
            width: "100%",
            height: "100%",
            objectFit: "cover",
            opacity: progress,
          }}
        />
      ) : null}
      {/* Panel A */}
      <div
        style={{
          position: "absolute",
          backgroundColor: DARK_BG,
          ...(isHorizontal
            ? { top: 0, bottom: 0, left: 0, width: `${50 - gap}%` }
            : { left: 0, right: 0, top: 0, height: `${50 - gap}%` }),
        }}
      />
      {/* Panel B */}
      <div
        style={{
          position: "absolute",
          backgroundColor: DARK_BG,
          ...(isHorizontal
            ? { top: 0, bottom: 0, right: 0, width: `${50 - gap}%` }
            : { left: 0, right: 0, bottom: 0, height: `${50 - gap}%` }),
        }}
      />
      {/* Reveal-glow seam */}
      {progress > 0.1 && progress < 0.9 ? (
        <div
          style={{
            position: "absolute",
            backgroundColor: ACCENT_RED,
            opacity: 1 - Math.abs(progress - 0.5) * 2,
            boxShadow: `0 0 20px ${ACCENT_RED}, 0 0 60px ${ACCENT_RED}`,
            ...(isHorizontal
              ? { top: 0, bottom: 0, left: `${50 - gap}%`, width: 2 }
              : { left: 0, right: 0, top: `${50 - gap}%`, height: 2 }),
          }}
        />
      ) : null}
    </AbsoluteFill>
  )
}

// ── Layer component registry ───────────────────────────────────────────────

const LAYER_COMPONENTS: Record<string, React.FC<LayerComponentProps>> = {
  BackgroundLayer,
  GridOverlay,
  PlateLayer,
  PresenterLayer,
  TypographyLayer,
  CounterLayer,
  FlashOverlay,
  SplitRevealLayer,
  ClipLayer,
  DiagramLayer: TypographyLayer,
  DocumentLayer: TypographyLayer,
  MapLayer: TypographyLayer,
  TimelineLayer: TypographyLayer,
}

// ── Beat renderer ──────────────────────────────────────────────────────────

const BeatRenderer: React.FC<{ beat: Beat; hasCaptionTrack: boolean }> = ({ beat, hasCaptionTrack }) => {
  const { startFrame, endFrame, layers } = beat
  const duration = Math.max(1, endFrame - startFrame)

  return (
    <Sequence from={startFrame} durationInFrames={duration}>
      {layers
        .slice()
        .sort((a, b) => (a.zIndex ?? 0) - (b.zIndex ?? 0))
        .map((layer, i) => {
          const Component = LAYER_COMPONENTS[layer.type]
          if (!Component) return null
          return (
            <Component
              key={i}
              beatStartFrame={startFrame}
              beatEndFrame={endFrame}
              layer={layer}
              index={i}
              hasCaptionTrack={hasCaptionTrack}
            />
          )
        })}
    </Sequence>
  )
}

// ── Legacy segment components (kept for backward compatibility) ────────────

const SegmentPlate: React.FC<{
  index: number
  startFrame: number
  endFrame: number
  visualFunction: string
  plateUrl?: string
}> = ({ index, startFrame, endFrame, visualFunction, plateUrl }) => {
  const { x, y, scale } = useKenBurnsTransform(index, startFrame, endFrame)

  return (
    <AbsoluteFill
      style={{
        transform: `translate(${x}%, ${y}%) scale(${scale})`,
        transformOrigin: "center center",
        background: plateUrl ? "#111" : generateDocumentaryGradient(`${visualFunction}-${index}`),
        overflow: "hidden",
      }}
    >
      {plateUrl ? (
        <Img
          src={resolveAssetSrc(plateUrl)}
          alt=""
          style={{
            width: "100%",
            height: "100%",
            objectFit: "cover",
            opacity: 0.82,
          }}
        />
      ) : (
        <div
          style={{
            width: "100%",
            height: "100%",
            backgroundImage:
              "radial-gradient(circle at 30% 20%, rgba(255,42,42,0.12), transparent 45%), radial-gradient(circle at 80% 80%, rgba(255,255,255,0.04), transparent 35%)",
          }}
        />
      )}
      <div
        style={{
          position: "absolute",
          inset: 0,
          background:
            "linear-gradient(to bottom, rgba(0,0,0,0.35) 0%, transparent 35%, transparent 60%, rgba(0,0,0,0.58) 100%)",
        }}
      />
    </AbsoluteFill>
  )
}

const SegmentCaption: React.FC<{ caption: string }> = ({ caption }) => {
  return (
    <div
      style={{
        position: "absolute",
        bottom: 120,
        left: 0,
        right: 0,
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        padding: "0 60px",
        textAlign: "center",
      }}
    >
      <div
        style={{
          color: TEXT_GLOW,
          fontSize: 52,
          lineHeight: 1.28,
          fontFamily: "Georgia, 'Times New Roman', Times, serif",
          fontWeight: 600,
          textShadow: "0 2px 24px rgba(0,0,0,0.7), 0 0 40px rgba(255,42,42,0.15)",
          maxWidth: "100%",
        }}
      >
        {caption}
      </div>
    </div>
  )
}

const ProgressBar: React.FC<{ durationInFrames: number }> = ({ durationInFrames }) => {
  const frame = useCurrentFrame()
  const progress = Math.min(1, Math.max(0, frame / durationInFrames))

  return (
    <div
      style={{
        position: "absolute",
        top: 0,
        left: 0,
        right: 0,
        height: 6,
        background: "rgba(255,255,255,0.08)",
      }}
    >
      <div
        style={{
          width: `${progress * 100}%`,
          height: "100%",
          background: ACCENT_RED,
          boxShadow: `0 0 14px ${ACCENT_RED}`,
        }}
      />
    </div>
  )
}

const CaptionTrack: React.FC<{ cues: Array<{ text: string; startFrame: number; endFrame: number }> }> = ({
  cues,
}) => {
  const frame = useCurrentFrame()
  const cue = cues.find((item) => frame >= item.startFrame && frame < item.endFrame)
  if (!cue) return null

  return (
    <div
      style={{
        position: "absolute",
        top: "72%",
        left: 0,
        right: 0,
        transform: "translateY(-50%)",
        display: "flex",
        justifyContent: "center",
        padding: "0 72px",
        textAlign: "center",
        pointerEvents: "none",
        zIndex: 900,
      }}
    >
      <div
        style={{
          color: "#fff",
          fontFamily: "Georgia, 'Times New Roman', Times, serif",
          fontSize: 64,
          fontWeight: 700,
          lineHeight: 1.08,
          textShadow: "0 2px 18px rgba(0,0,0,0.9)",
          whiteSpace: "pre-line",
        }}
      >
        {cue.text}
      </div>
    </div>
  )
}

// ── Composition ────────────────────────────────────────────────────────────

export const TiktokRecreate: React.FC<TiktokRecreateProps> = ({
  sourceVideoId,
  title,
  durationInFrames,
  segments,
  plates,
  personaImageUrl,
  audioUrl,
  layerPlan,
  captionCues,
}) => {
  const { width, height } = useVideoConfig()

  const safeSegments = useMemo(() => {
    if (segments.length > 0) return segments
    return [
      {
        startFrame: 0,
        endFrame: durationInFrames,
        narrationFunction: "explainer",
        visualFunction: "documentary background",
        caption: title || "Documentary explainer",
      },
    ]
  }, [segments, durationInFrames, title])

  return (
    <AbsoluteFill
      style={{
        width,
        height,
        backgroundColor: DARK_BG,
        fontFamily: "Georgia, 'Times New Roman', Times, serif",
      }}
    >
      {/* ── Content: beats or segments ── */}
      {layerPlan && layerPlan.beats.length > 0
        ? layerPlan.beats.map((beat, i) => <BeatRenderer key={i} beat={beat} hasCaptionTrack={!!captionCues?.length} />)
        : safeSegments.map((segment, index) => {
            const plateUrl =
              plates && plates.length > 0
                ? plates[index % plates.length]
                : personaImageUrl && index === 0
                  ? personaImageUrl
                  : undefined

            return (
              <Sequence
                key={`${segment.startFrame}-${segment.endFrame}-${index}`}
                from={segment.startFrame}
                durationInFrames={Math.max(1, segment.endFrame - segment.startFrame)}
              >
                <SegmentPlate
                  index={index}
                  startFrame={segment.startFrame}
                  endFrame={segment.endFrame}
                  visualFunction={segment.visualFunction}
                  plateUrl={plateUrl}
                />
                {!captionCues?.length ? <SegmentCaption caption={segment.caption} /> : null}
              </Sequence>
            )
          })}

      {captionCues?.length ? <CaptionTrack cues={captionCues} /> : null}

      {/* ── Chrome (both modes) ── */}
      {title ? (
        <div
          style={{
            position: "absolute",
            top: 48,
            left: 0,
            right: 0,
            padding: "0 48px",
            textAlign: "center",
            color: "rgba(255,255,255,0.92)",
            fontSize: 30,
            fontWeight: 700,
            letterSpacing: "0.02em",
            textShadow: "0 2px 16px rgba(0,0,0,0.7)",
            lineHeight: 1.2,
          }}
        >
          {title}
        </div>
      ) : null}

      <div
        style={{
          position: "absolute",
          bottom: 48,
          right: 48,
          color: "rgba(255,255,255,0.35)",
          fontSize: 16,
          fontFamily: "-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif",
          letterSpacing: "0.08em",
        }}
      >
        {sourceVideoId}
      </div>

      <ProgressBar durationInFrames={durationInFrames} />
      {audioUrl ? <Audio src={resolveAssetSrc(audioUrl)} /> : null}
    </AbsoluteFill>
  )
}
