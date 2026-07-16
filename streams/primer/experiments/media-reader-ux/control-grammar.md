# Media Reader — Control Grammar

**Status:** design brief, 2026-07-16. Author: interaction design (reading+media hybrid).
Binds the press-to-listen zh reader (`packages/primer-daemon` web dashboard). Consumed by
`MediaReaderUI` (impl in flight) + `MediaReaderBackend` (alignment contract pinned).
**Non-goals:** no visual-style redesign, no dictionary-content design (separate lane),
no new features beyond control semantics.

## 0. One mental model, one invariant

The **text is the timeline.** Characters are not decorations over a hidden scrubber — they *are*
the seek surface. Every control follows from this: click a char = move the playhead there;
the highlight is the playhead made visible on the text. There is no second, competing transport.

> **Invariant (load-bearing):** *the confidence of the visual never exceeds the confidence of the
> data.* A char-precise highlight is only shown when timing is char-precise (`charTiming:"native"`).
> This directly fixes Arthur's known failure: never highlight the WRONG char confidently.

Contract hooks (from `src/alignment.ts`): sentences carry `charTiming:"native"|"interpolated"|null`;
`chars[]` are **CJK-only** (punctuation is interspersed at render, un-timed, inert).

## 1. Pointer semantics ladder

| Gesture | Action | Norm status | Rationale |
|---|---|---|---|
| **Hover** char | **Telegraph only** — neutral accent wash + `cursor:pointer`, meaning "click plays here". **No audio.** | keeps reader/web norm (hover = affordance) | Arthur asked for audio "synced with hovering"; literal hover-audio is rejected (see ledger #1). We deliver the *felt* sync: hover uses the highlight family so char↔audio reads as one substance, without autoplay. |
| Hover punctuation / gap | nothing (not a target) | — | Punctuation is un-timed; never a seek point. |
| **Click** char | **Seek to `char.startMs` + play** from there (resume if paused) | audiobook press-to-play, video click-to-position | The primary reading verb; the whole point. Keep. |
| Click punctuation/margin | seek to the **nearest following CJK char's** start (else preceding) | graceful | No dead zones when the pointer lands between glyphs; tolerates imperfect targeting. |
| **Alt/Option-click** char (touch: **long-press**) | dictionary lookup + auto-queue + priority push | deviation from DuChinese tap=popup | Plain tap is *occupied* by the higher-frequency seek/play, so lookup moves to a modifier. Alt/Option (not Ctrl) is canonical — Ctrl-click is macOS context-menu. Ctrl also accepted off-Mac. Long-press is the touch equal. Double-click rejected (collides with browser word-select + double-seek). |
| **Drag** over text | native text selection; **suppress seek** on the mouseup that ends a drag | must survive | Selection/copy stays intact; a click is a down-up under the drag threshold with empty selection. |

## 2. Keyboard grammar

Bare keys only (no Cmd/Ctrl/Meta held — those stay the browser's). Reading is sentence-structured,
so navigation is by **sentence**, not by fixed seconds (a 5 s jump lands mid-sentence at a
meaningless char).

| Key | Action | Rationale |
|---|---|---|
| `Space` | play / pause | universal transport. |
| `←` | **restart current sentence** if playhead > its start + ~1 s grace, **else previous sentence** | the media-player double-back norm (iPod/Spotify), and the shadowing replay loop in one key. |
| `→` | next sentence (seek to `startMs`, keep play state) | matches Arthur's own shadowing tool ("jump forward … sentence wise"). |
| `P` | toggle pinyin ruby | peelable scaffold (acquisition doctrine); matches old reader. |
| `]` | rate step up · `[` rate step down through {0.5, 0.75, 1, 1.25, 1.5} | core media control; shadowing wants slow-down. |
| `Esc` | close dict popup → else clear selection → else nothing | back out one layer; Esc is **never** pause (that is Space). |

**Conflict rules.**
- **Input/textarea/contenteditable focused** (ask panel, filter): *all* single-key shortcuts suppressed; native typing only.
- **Dict popup open:** `Esc` closes it first; `Space`/`←`/`→` stay live (pause/scan while reading a definition) unless the popup itself holds a focused input.
- **Modifier held** (Cmd/Ctrl/Meta): no media key fires — hand it to the browser.

## 3. Sync feedback

- **Playing highlight = warm background pill** on the active char, escalated to the whole **word**
  (via `classifyWord` segmentation) so multi-char words light as one unit. *Not* karaoke glyph-fill —
  progressive fill inside dense hanzi reads as mud; a pill stays legible. Hover wash (neutral/cool)
  and play pill (warm) are chromatically distinct: potential vs sounding-now.
- **Two-tier emphasis:** active **sentence** gets an ambient tint + inactive sentences dimmed
  (~0.6 opacity) = "where am I"; the active **word pill** inside it = "what's sounding now."
  Ambient answers orientation, focal answers attention.
- **Auto-scroll:** center-follow the active sentence in a reading band (~40% from top, not dead
  center). On manual user scroll, **detach** and show a persistent "↓ Jump to playing" affordance;
  tapping it (or the playhead) re-centers and re-attaches. Never yank the viewport out from under a
  reader scanning ahead/back; re-attach only on explicit request.
- **Degradation rule (the important one), keyed on `charTiming`:**
  - `"native"` → char/word pill karaoke enabled.
  - `"interpolated"` | `null` → **suppress the char/word pill**; highlight at **sentence level only**
    (ambient tint). Click still seeks best-effort to the interpolated time, but the *visual* never
    claims char precision it doesn't have. ⚠️ Current code keys the pill on `activeCharIdx` with no
    `charTiming` gate — that is the confident-wrong-char bug; gate it.
  - **Silence/gaps:** during inter-sentence silence (playhead past sentence `endMs`, next not begun),
    clear the word pill (nothing is sounding) but hold the just-finished sentence's ambient tint.
    Never show a pill during silence.

## 4. Video variant deltas

- **Placement:** video is a **sticky pane** — full-width top on phone, top-right on wide desktop —
  transcript flows below/beside it. Restrained, no heavy chrome.
- **Focus ownership:** the **transcript owns interaction**; the video is a viewport mirroring the
  playhead, not a control surface. Precise seeking happens on chars, exactly as audio.
- **Tap semantics split by surface:** tap a **transcript char = seek+play** (fine transport);
  tap the **video frame = play/pause** (coarse transport — the universal video norm). Frame = coarse,
  text = fine; each surface keeps its own norm, no contradiction.
- **Scrubber:** none by default (the transcript *is* the scrubber). Optional thin sentence-progress
  rail under the video; clicking it seeks to the nearest sentence start. Fullscreen/PiP via native
  controls, revealed on video-hover only.

## 5. Deviation ledger

| # | Deviation from norm | Verdict | Argument |
|---|---|---|---|
| 1 | **Hover plays audio** (Arthur's literal ask) | **REJECT** | Touch-blind (phone is first-class), machine-guns as the pointer transits a line, a11y-hostile (WCAG 1.4.13), audio churn. Intent delivered instead by hover-telegraph + shared highlight vocabulary. |
| 2 | Click char = seek+play (readers normally do nothing / select) | **WORTH IT** | It is the primary reading verb (audiobook press-to-play). Mitigated: drag still selects. |
| 3 | Dictionary on Alt-click / long-press, not plain tap (vs DuChinese) | **WORTH IT** | Plain tap is occupied by the higher-frequency seek/play; lookup takes the modifier. |
| 4 | `←` = restart-then-previous sentence, not fixed 5 s rewind | **WORTH IT** | Media-player track norm + sentence is the meaningful unit; 5 s is arbitrary on text. |
| 5 | `[`/`]` = playback rate (old reader used them for EN reveals) | **WORTH IT** | In media mode EN reveals are anti-doctrine; rate is a core transport. |
| 6 | Active highlight = word pill, not karaoke glyph-fill | **WORTH IT** | Legibility on dense hanzi; glyph-fill = mud. |
| 7 | No always-on scrubber; transcript is the timeline | **WORTH IT** | Text is a denser, more meaningful timeline; less chrome. Mitigated by thin sentence rail (video). |
| 8 | Sentence-only highlight when timing interpolated | **REQUIRED** | Honesty over false precision — the core invariant. |
| 9 | Tap video = play/pause but tap transcript = seek | **WORTH IT** | Each matches its surface's norm; coarse frame vs fine text. |

## 6. Taste forks for Arthur

1. **Hover** — telegraph-only *(pick)* vs literal hover-scrub audio (would be desktop-only, debounced, gated). I recommend telegraph; the felt sync is preserved without the anti-patterns.
2. **Dict modifier** — Alt/Option-click *(pick, macOS-safe)* vs Ctrl-click (macOS context-menu clash) vs also-enable double-click.
3. **Active highlight** — word pill *(pick)* vs char-only pill vs progressive karaoke fill on `native` sentences only.
4. **Inactive sentences** — dimmed spotlight *(pick, app-like)* vs full-opacity (book-like, calmer).
5. **`←` key** — restart-then-previous double-back *(pick)* vs `←` always previous + separate `R` = replay current.
