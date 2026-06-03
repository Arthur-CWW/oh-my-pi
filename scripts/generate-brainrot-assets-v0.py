# /// script
# requires-python = ">=3.12"
# dependencies = ["pillow>=11.0.0"]
# ///
"""Generate a small local brainrot overlay asset pack and register it in SQLite.

Outputs are ignored runtime artifacts under:
  data/assets/brainrot-props-v0/
  data/asset-catalog/assets.sqlite

These are intentionally procedural/local assets: no paid provider, no remote API, no
model-rendered text. Text-like elements are drawn locally so they remain editable.
"""

from __future__ import annotations

import hashlib
import json
import math
import os
import sqlite3
import subprocess
from dataclasses import dataclass
from pathlib import Path
from typing import Callable

from PIL import Image, ImageDraw, ImageFont

REPO = Path(__file__).resolve().parents[1]
OUT_ROOT = REPO / "data" / "assets" / "brainrot-props-v0"
DB_PATH = REPO / "data" / "asset-catalog" / "assets.sqlite"
SCHEMA_PATH = REPO / "docs" / "schemas" / "video-asset-catalog-v0.sql"
W, H = 720, 1280
FPS = 24
DURATION_SEC = 4
N = FPS * DURATION_SEC

FONT_CANDIDATES = [
    "/Library/Fonts/Arial Unicode.ttf",
    "/System/Library/Fonts/PingFang.ttc",
    "/System/Library/Fonts/STHeiti Light.ttc",
    "/System/Library/Fonts/Apple Symbols.ttf",
]


def load_font(size: int) -> ImageFont.FreeTypeFont | ImageFont.ImageFont:
    for path in FONT_CANDIDATES:
        if Path(path).exists():
            try:
                return ImageFont.truetype(path, size=size)
            except Exception:
                pass
    return ImageFont.load_default(size=size)


FONT_BIG = load_font(86)
FONT_MED = load_font(52)
FONT_SMALL = load_font(32)
FONT_TINY = load_font(24)


@dataclass(frozen=True)
class AssetSpec:
    id: str
    title: str
    description: str
    stage_role: str
    compositing_role: str
    prompt: str
    tags: dict[str, list[str]]
    vibe_scores: dict[str, tuple[float, str]]
    renderer: Callable[[int], Image.Image]


def sha256(path: Path) -> str:
    h = hashlib.sha256()
    with path.open("rb") as f:
        for chunk in iter(lambda: f.read(1024 * 1024), b""):
            h.update(chunk)
    return h.hexdigest()


def rgba() -> Image.Image:
    return Image.new("RGBA", (W, H), (0, 0, 0, 0))


def glow(draw: ImageDraw.ImageDraw, xy, fill, radius=4, width=3):
    x1, y1, x2, y2 = xy
    for i in range(radius, 0, -1):
        alpha = max(10, int(fill[3] * (i / radius) * 0.18))
        draw.line((x1, y1, x2, y2), fill=(*fill[:3], alpha), width=width + i * 2)
    draw.line((x1, y1, x2, y2), fill=fill, width=width)


def draw_text_center(draw: ImageDraw.ImageDraw, xy: tuple[int, int], text: str, font, fill, stroke=(0, 0, 0, 180), sw=3):
    bbox = draw.textbbox((0, 0), text, font=font, stroke_width=sw)
    x = xy[0] - (bbox[2] - bbox[0]) / 2
    y = xy[1] - (bbox[3] - bbox[1]) / 2
    draw.text((x, y), text, font=font, fill=fill, stroke_width=sw, stroke_fill=stroke)


def key_shape(draw: ImageDraw.ImageDraw, cx: float, cy: float, angle: float, scale: float, color: tuple[int, int, int, int]):
    # Draw a simple key in local coordinates and rotate points manually.
    def rot(pt):
        x, y = pt
        ca, sa = math.cos(angle), math.sin(angle)
        return (cx + scale * (x * ca - y * sa), cy + scale * (x * sa + y * ca))

    ring = [rot((math.cos(a) * 28, math.sin(a) * 28)) for a in [i * math.tau / 36 for i in range(36)]]
    draw.polygon(ring, fill=(*color[:3], 80))
    draw.line(ring + [ring[0]], fill=color, width=max(2, int(scale * 5)))
    hole = [rot((math.cos(a) * 13, math.sin(a) * 13)) for a in [i * math.tau / 24 for i in range(24)]]
    draw.polygon(hole, fill=(0, 0, 0, 0))
    draw.line([rot((26, 0)), rot((96, 0))], fill=color, width=max(3, int(scale * 9)))
    draw.line([rot((72, 0)), rot((72, 25))], fill=color, width=max(3, int(scale * 8)))
    draw.line([rot((92, 0)), rot((92, 18))], fill=color, width=max(3, int(scale * 8)))


def render_dangling_keys(i: int) -> Image.Image:
    img = rgba()
    d = ImageDraw.Draw(img, "RGBA")
    t = i / N
    anchor = (W - 150, 110)
    d.ellipse((anchor[0] - 9, anchor[1] - 9, anchor[0] + 9, anchor[1] + 9), fill=(255, 240, 120, 230))
    for idx, off in enumerate([-0.45, 0.0, 0.42]):
        phase = math.sin(t * math.tau + off)
        angle = 0.42 * phase + off * 0.2
        length = 230 + idx * 18
        cx = anchor[0] + math.sin(angle) * length
        cy = anchor[1] + math.cos(angle) * length
        glow(d, (anchor[0], anchor[1], cx, cy), (255, 220, 80, 200), radius=5, width=3)
        key_shape(d, cx, cy, angle * 1.8 + idx * 0.4, 0.85, (255, 214, 64, 235))
    draw_text_center(d, (W - 180, 420), "AGENCY?", FONT_SMALL, (255, 250, 190, 220), sw=2)
    return img


def render_market_rocket(i: int) -> Image.Image:
    img = rgba()
    d = ImageDraw.Draw(img, "RGBA")
    t = i / N
    # chart line behind character, subtitle-safe-ish top/mid overlay
    pts = []
    for k in range(9):
        x = 60 + k * 82
        y = 760 - k * 38 + math.sin(t * math.tau + k * 0.8) * 34
        pts.append((x, y))
    for a, b in zip(pts, pts[1:]):
        glow(d, (*a, *b), (70, 255, 120, 185), radius=4, width=5)
    for p in pts:
        d.ellipse((p[0] - 7, p[1] - 7, p[0] + 7, p[1] + 7), fill=(180, 255, 180, 210))
    # rocket body
    rx = 470 + math.sin(t * math.tau) * 25
    ry = 430 - math.sin(t * math.tau) * 18
    d.polygon([(rx, ry - 100), (rx - 50, ry + 30), (rx + 50, ry + 30)], fill=(240, 245, 255, 240), outline=(80, 120, 255, 230))
    d.rectangle((rx - 36, ry + 20, rx + 36, ry + 110), fill=(235, 235, 245, 235), outline=(80, 120, 255, 230), width=3)
    d.ellipse((rx - 22, ry - 10, rx + 22, ry + 34), fill=(80, 190, 255, 220), outline=(255, 255, 255, 230), width=3)
    d.polygon([(rx - 36, ry + 80), (rx - 80, ry + 135), (rx - 20, ry + 105)], fill=(255, 70, 80, 230))
    d.polygon([(rx + 36, ry + 80), (rx + 80, ry + 135), (rx + 20, ry + 105)], fill=(255, 70, 80, 230))
    flame = 1 + 0.25 * math.sin(t * math.tau * 4)
    d.polygon([(rx - 26, ry + 108), (rx, ry + 108 + 115 * flame), (rx + 26, ry + 108)], fill=(255, 180, 40, 210))
    d.polygon([(rx - 13, ry + 108), (rx, ry + 108 + 70 * flame), (rx + 13, ry + 108)], fill=(255, 60, 30, 230))
    draw_text_center(d, (200, 670), "NUMBER GO UP", FONT_SMALL, (140, 255, 170, 210), sw=2)
    return img


def render_stamp_pulse(i: int) -> Image.Image:
    img = rgba()
    d = ImageDraw.Draw(img, "RGBA")
    t = i / N
    pulse = 0.82 + 0.18 * math.sin(t * math.tau * 2)
    cx, cy = 190, 260
    w, h = 270 * pulse, 150 * pulse
    rect = (cx - w / 2, cy - h / 2, cx + w / 2, cy + h / 2)
    for r in range(8, 0, -1):
        alpha = int(34 * r)
        d.rounded_rectangle((rect[0] - r * 4, rect[1] - r * 4, rect[2] + r * 4, rect[3] + r * 4), radius=12, outline=(255, 20, 20, alpha), width=3)
    d.rounded_rectangle(rect, radius=12, outline=(255, 32, 32, 230), width=8)
    draw_text_center(d, (cx, cy - 22), "抽象", FONT_BIG, (255, 42, 42, 230), sw=2)
    draw_text_center(d, (cx, cy + 47), "合法", FONT_MED, (255, 42, 42, 210), sw=2)
    # local editable text: okay, not generated by video model
    d.line((cx - w / 2 + 20, cy + h / 2 - 25, cx + w / 2 - 20, cy - h / 2 + 25), fill=(255, 60, 60, 120), width=5)
    return img


def render_math_glyph_rain(i: int) -> Image.Image:
    img = rgba()
    d = ImageDraw.Draw(img, "RGBA")
    symbols = ["λ", "Σ", "∂", "股", "权", "内卷", "404", "算力", "∞", "打工", "AGI", "￥"]
    t = i / N
    for col in range(9):
        x = 35 + col * 86 + math.sin(col * 9.1) * 15
        speed = 180 + (col % 4) * 42
        base = (t * speed + col * 143) % (H + 300) - 180
        for row in range(5):
            y = base + row * 190
            sym = symbols[(col * 3 + row + i // 8) % len(symbols)]
            alpha = int(70 + 120 * ((row + col) % 3) / 2)
            d.text((x, y), sym, font=FONT_SMALL if len(sym) <= 3 else FONT_TINY, fill=(90, 245, 255, alpha), stroke_width=1, stroke_fill=(0, 25, 40, alpha))
    return img


def render_wooden_fish(i: int) -> Image.Image:
    img = rgba()
    d = ImageDraw.Draw(img, "RGBA")
    t = i / N
    cx, cy = 540, 980
    bob = math.sin(t * math.tau * 2) * 12
    # wooden fish / merit-clicker icon
    d.ellipse((cx - 88, cy - 52 + bob, cx + 88, cy + 52 + bob), fill=(160, 94, 45, 225), outline=(255, 190, 90, 220), width=4)
    d.arc((cx - 50, cy - 38 + bob, cx + 35, cy + 35 + bob), 20, 330, fill=(75, 38, 16, 220), width=6)
    d.ellipse((cx + 35, cy - 18 + bob, cx + 52, cy - 1 + bob), fill=(45, 20, 10, 230))
    # striker
    angle = -0.5 + 0.9 * (0.5 + 0.5 * math.sin(t * math.tau * 2 + 0.4))
    x1, y1 = cx - 125, cy - 120
    x2 = x1 + math.cos(angle) * 155
    y2 = y1 + math.sin(angle) * 155
    glow(d, (x1, y1, x2, y2), (220, 160, 80, 180), radius=3, width=8)
    d.ellipse((x2 - 16, y2 - 16, x2 + 16, y2 + 16), fill=(230, 170, 90, 220))
    if i % 24 < 12:
        draw_text_center(d, (cx - 10, cy - 115), "功德 +1", FONT_MED, (255, 220, 80, 220), sw=3)
    draw_text_center(d, (cx, cy + 100), "merit miner", FONT_TINY, (255, 230, 150, 160), sw=2)
    return img


def specs() -> list[AssetSpec]:
    return [
        AssetSpec(
            id="brainrot-v0.dangling-keys-of-agency",
            title="Dangling Keys of Agency",
            description="Transparent loop of hypnotic golden keys: agency anxiety, ownership token bait, baby-sensory brainrot.",
            stage_role="prop_overlay_loop",
            compositing_role="foreground_alpha",
            prompt="Procedural transparent overlay loop: shiny dangling keys hypnotically swing in front of a cold post-labor talking-head scene; vibes of agency anxiety, ownership tokens, and baby-sensory brainrot; no model-rendered subtitles.",
            tags={
                "semantic": ["keys", "ownership", "agency"],
                "meme": ["brainrot", "dangling-keys", "attention-bait"],
                "motion": ["swing", "shimmer", "loopable"],
                "composition": ["foreground-overlay", "alpha", "subtitle-safe"],
            },
            vibe_scores={
                "agency-anxiety": (0.95, "literal dangling agency tokens"),
                "post-labor-dread": (0.55, "choice panic over future stake"),
                "brainrot-density": (0.65, "sensory bait but not full-screen"),
                "caption-interference": (0.25, "top-right foreground, mostly subtitle-safe"),
            },
            renderer=render_dangling_keys,
        ),
        AssetSpec(
            id="brainrot-v0.market-ritual-rocket-chart",
            title="Market Ritual Rocket Chart",
            description="Transparent chart/rocket overlay: number-go-up cult ceremony and posthuman equity panic.",
            stage_role="prop_overlay_loop",
            compositing_role="midground_screen_or_alpha",
            prompt="Procedural transparent overlay loop: green chart line and toy rocket performing a financial market ritual, number-go-up cult energy, posthuman equity panic; no model-rendered subtitles.",
            tags={
                "semantic": ["rocket", "chart", "market", "equity"],
                "meme": ["number-go-up", "finance-cult", "stonks"],
                "motion": ["float", "pulse", "loopable"],
                "composition": ["midground-overlay", "alpha"],
            },
            vibe_scores={
                "market-ritual": (0.96, "rocket and chart as cult iconography"),
                "agency-anxiety": (0.68, "ownership/stake urgency"),
                "brainrot-density": (0.72, "bright moving finance symbols"),
                "caption-interference": (0.45, "chart crosses lower-middle; use with care"),
            },
            renderer=render_market_rocket,
        ),
        AssetSpec(
            id="brainrot-v0.abstract-legal-stamp-pulse",
            title="Abstract Legal Stamp Pulse",
            description="Red Chinese stamp overlay reading 抽象 / 合法: fake bureaucratic permission for absurdity.",
            stage_role="prop_overlay_loop",
            compositing_role="foreground_alpha",
            prompt="Procedural transparent overlay loop: red Chinese bureaucratic stamp pulse, locally rendered text 抽象 / 合法, granting fake official permission to absurd internet brainrot; no video-model text.",
            tags={
                "semantic": ["stamp", "bureaucracy", "permission"],
                "meme": ["抽象", "chinese-internet", "official-absurdity"],
                "motion": ["pulse", "loopable"],
                "composition": ["foreground-overlay", "alpha", "local-text"],
            },
            vibe_scores={
                "abstract-chinese-internet": (0.92, "explicit 抽象 stamp energy"),
                "bureaucratic-absurdity": (0.90, "fake official seal"),
                "brainrot-density": (0.58, "strong but isolated visual gag"),
                "caption-interference": (0.18, "upper-left, subtitle-safe"),
            },
            renderer=render_stamp_pulse,
        ),
        AssetSpec(
            id="brainrot-v0.math-glyph-rain",
            title="Math Glyph Rain",
            description="Transparent rain of math symbols, Chinese labor/equity glyphs, and compute-finance fragments.",
            stage_role="background_overlay_loop",
            compositing_role="screen_overlay_alpha",
            prompt="Procedural transparent overlay loop: falling math symbols, Chinese labor/equity glyphs, compute-finance fragments, cold cyan cyberspace rain; supports post-labor automation dread; locally rendered glyphs only.",
            tags={
                "semantic": ["math", "glyphs", "automation", "compute"],
                "meme": ["cyber", "内卷", "打工人", "matrix-rain"],
                "motion": ["rain", "loopable"],
                "composition": ["background-overlay", "alpha", "local-text"],
            },
            vibe_scores={
                "post-labor-dread": (0.82, "automation/math rain ambience"),
                "abstract-chinese-internet": (0.75, "Chinese glyph fragments"),
                "brainrot-density": (0.70, "busy moving texture"),
                "caption-interference": (0.62, "can conflict with subtitles if too bright"),
            },
            renderer=render_math_glyph_rain,
        ),
        AssetSpec(
            id="brainrot-v0.electronic-wooden-fish-merit-counter",
            title="Electronic Wooden Fish Merit Counter",
            description="Transparent electronic wooden-fish/功德 +1 loop: ritualized clicking, merit mining, absurd productivity spirituality.",
            stage_role="prop_overlay_loop",
            compositing_role="foreground_alpha",
            prompt="Procedural transparent overlay loop: electronic wooden fish merit counter, 功德 +1, absurd productivity spirituality, ritualized clicking as post-labor coping mechanism; local editable text.",
            tags={
                "semantic": ["wooden-fish", "merit", "ritual", "counter"],
                "meme": ["电子木鱼", "功德+1", "chinese-internet", "productivity-ritual"],
                "motion": ["tap", "bob", "loopable"],
                "composition": ["foreground-overlay", "alpha", "local-text"],
            },
            vibe_scores={
                "abstract-chinese-internet": (0.88, "电子木鱼 reference"),
                "bureaucratic-absurdity": (0.42, "ritual counter but not official"),
                "post-labor-dread": (0.64, "coping ritual for meaningless productivity"),
                "brainrot-density": (0.66, "repeating merit ding energy"),
                "caption-interference": (0.50, "bottom-right; may compete with captions"),
            },
            renderer=render_wooden_fish,
        ),
    ]


def init_db(conn: sqlite3.Connection) -> None:
    conn.executescript(SCHEMA_PATH.read_text())
    axes = {
        "agency-anxiety": ("agency anxiety", "calm/static", "dangling-choice-panic"),
        "post-labor-dread": ("automation and labor-market irrelevance dread", "neutral", "automation-ate-my-future"),
        "absurd-bureaucracy": ("official/procedural nonsense", "clean", "stamped/formal/ridiculous"),
        "bureaucratic-absurdity": ("official/procedural nonsense", "clean", "stamped/formal/ridiculous"),
        "market-ritual": ("finance symbols as cult ceremony", "non-financial", "number-go-up ritual"),
        "cute-menace": ("cute but spiritually threatening", "cute", "cute-menacing"),
        "abstract-chinese-internet": ("抽象/魔性/赛博/内卷 meme energy", "plain", "very 抽象"),
        "brainrot-density": ("amount of overstimulating novelty", "tasteful", "maximal overstimulus"),
        "caption-interference": ("likelihood of fighting readable subtitles", "safe", "caption-conflicting"),
    }
    for axis_id, (desc, low, high) in axes.items():
        conn.execute(
            "INSERT OR IGNORE INTO vibe_axis(id, name, description, low_label, high_label) VALUES (?, ?, ?, ?, ?)",
            (axis_id, axis_id, desc, low, high),
        )


def ensure_tag(conn: sqlite3.Connection, namespace: str, name: str) -> str:
    tag_id = f"{namespace}:{name}"
    category = "semantic" if namespace == "semantic" else namespace
    conn.execute(
        "INSERT OR IGNORE INTO tag(id, namespace, name, category) VALUES (?, ?, ?, ?)",
        (tag_id, namespace, name, category),
    )
    return tag_id


def run_ffmpeg(cmd: list[str]) -> bool:
    try:
        subprocess.run(cmd, check=True, cwd=REPO, stdout=subprocess.PIPE, stderr=subprocess.PIPE)
        return True
    except Exception as exc:
        print(f"ffmpeg failed: {' '.join(cmd)}\n{exc}")
        return False


def render_asset(spec: AssetSpec, conn: sqlite3.Connection) -> None:
    asset_dir = OUT_ROOT / spec.id
    frames_dir = asset_dir / "frames"
    frames_dir.mkdir(parents=True, exist_ok=True)
    print(f"render {spec.id}")
    for i in range(N):
        frame = spec.renderer(i)
        frame.save(frames_dir / f"frame_{i:03d}.png")
    thumb = asset_dir / "thumbnail.png"
    spec.renderer(0).save(thumb)
    preview = asset_dir / "preview.mp4"
    alpha_mov = asset_dir / "alpha.mov"
    frame_pattern = str(frames_dir / "frame_%03d.png")
    # Preview on dark background for easy inspection.
    run_ffmpeg([
        "ffmpeg", "-y",
        "-f", "lavfi", "-i", f"color=c=0x101018:s={W}x{H}:r={FPS}:d={DURATION_SEC}",
        "-framerate", str(FPS), "-i", frame_pattern,
        "-filter_complex", "[0:v][1:v]overlay=format=auto:shortest=1",
        "-c:v", "libx264", "-pix_fmt", "yuv420p", str(preview),
    ])
    # Alpha MOV for compositing. If ProRes alpha fails, frames still preserve alpha.
    run_ffmpeg([
        "ffmpeg", "-y", "-framerate", str(FPS), "-i", frame_pattern,
        "-c:v", "prores_ks", "-profile:v", "4", "-pix_fmt", "yuva444p10le", str(alpha_mov),
    ])

    gen_id = f"gen.{spec.id}"
    params = {"width": W, "height": H, "fps": FPS, "durationSec": DURATION_SEC, "procedural": True}
    conn.execute(
        "INSERT OR REPLACE INTO generation(id, provider, model, operation, status, parameters_json, notes) VALUES (?, ?, ?, ?, ?, ?, ?)",
        (gen_id, "local", "pillow+ffmpeg", "asset.prop_overlay.generate_brainrot_pack_v0", "succeeded", json.dumps(params), "Generated locally; no paid provider; text is local/editable."),
    )
    conn.execute(
        "INSERT OR REPLACE INTO prompt(id, generation_id, kind, language, text) VALUES (?, ?, ?, ?, ?)",
        (f"prompt.{spec.id}", gen_id, "asset_generation", "en+zh", spec.prompt),
    )
    technical = {"framesDir": str(frames_dir.relative_to(REPO)), "thumbnail": str(thumb.relative_to(REPO))}
    conn.execute(
        """
        INSERT OR REPLACE INTO asset(
          id, kind, title, description, stage_role, compositing_role, uri, local_path,
          mime_type, duration_sec, width, height, fps, has_alpha, loopable, sha256,
          technical_meta_json
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        """,
        (
            spec.id,
            "video_overlay",
            spec.title,
            spec.description,
            spec.stage_role,
            spec.compositing_role,
            f"asset://{spec.id}",
            str(asset_dir.relative_to(REPO)),
            "video/quicktime" if alpha_mov.exists() else "image/png-sequence",
            DURATION_SEC,
            W,
            H,
            FPS,
            1,
            1,
            sha256(alpha_mov) if alpha_mov.exists() else sha256(thumb),
            json.dumps(technical),
        ),
    )
    conn.execute("INSERT OR REPLACE INTO asset_generation(asset_id, generation_id, role) VALUES (?, ?, ?)", (spec.id, gen_id, "output"))
    variants = [
        ("thumbnail", thumb, "image/png", None, None, None, None, 1),
        ("preview", preview, "video/mp4", DURATION_SEC, W, H, FPS, 0),
        ("alpha", alpha_mov, "video/quicktime", DURATION_SEC, W, H, FPS, 1),
    ]
    for role, path, mime, dur, width, height, fps, has_alpha in variants:
        if not path.exists():
            continue
        conn.execute(
            """
            INSERT OR REPLACE INTO asset_variant(
              id, asset_id, variant_role, uri, local_path, mime_type, duration_sec,
              width, height, fps, has_alpha, sha256, meta_json
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            """,
            (
                f"{spec.id}.{role}", spec.id, role, f"file://{path.relative_to(REPO)}",
                str(path.relative_to(REPO)), mime, dur, width, height, fps, has_alpha,
                sha256(path), json.dumps({}),
            ),
        )
    for namespace, names in spec.tags.items():
        for name in names:
            tag_id = ensure_tag(conn, namespace, name)
            conn.execute("INSERT OR REPLACE INTO asset_tag(asset_id, tag_id, confidence, source) VALUES (?, ?, ?, ?)", (spec.id, tag_id, 1.0, "human+script"))
    for axis_id, (score, note) in spec.vibe_scores.items():
        conn.execute(
            "INSERT OR REPLACE INTO asset_vibe_score(asset_id, axis_id, score, note, source) VALUES (?, ?, ?, ?, ?)",
            (spec.id, axis_id, score, note, "human+script"),
        )


def main() -> None:
    OUT_ROOT.mkdir(parents=True, exist_ok=True)
    DB_PATH.parent.mkdir(parents=True, exist_ok=True)
    with sqlite3.connect(DB_PATH) as conn:
        init_db(conn)
        for spec in specs():
            render_asset(spec, conn)
        conn.commit()
    print(f"wrote {DB_PATH.relative_to(REPO)}")
    print(f"wrote {OUT_ROOT.relative_to(REPO)}")


if __name__ == "__main__":
    main()
