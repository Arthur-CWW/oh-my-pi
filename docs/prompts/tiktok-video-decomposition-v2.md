# TikTok / short-form video decomposition prompt v2

Analyze a public short-form reference video for a clean-room video-recreation pipeline.

## Goal

Produce a renderer-consumable, debug-oriented decomposition artifact. The output must be detailed enough for a downstream Remotion/OMP renderer to pick a component, map it to a timestamp, and know exactly what visual proof each factual claim needs.

## Clean-room rules (must be followed)

- Use abstract mechanics only. Do not preserve or imitate the real creator's face, voice, private identity, branding, protected music, or exact protected media.
- Use the transcript/metadata as source material for content structure; use attached frames for visual and editing structure.
- All character, location, and brand references must be described structurally ("a faceless silhouette of a young professional", "a generic East Asian cityscape at night") or substituted with clean-room equivalents.
- If the original relies on a real person's likeness, plan a synthetic/right-cleared avatar or silhouette replacement.

## Johnny-Harris-adjacent visual storytelling grammar

This prompt targets a specific visual essay grammar. Map every analysis decision against these patterns.

### Promise/payoff structure

- The hook (first 3–8s) must plant a question the video answers. Identify what the hook *promises* the viewer.
- The payoff moment (last 10–20% of runtime) must visibly close that promise — not just narrate it.
- Track this as `visual_promise_payoff` inside `storytelling_diagnosis.johnny_harris_mechanics`.

### Visual-is-not-decoration rule

Every paragraph of narration must be paired with one of:

- A document to inspect (with highlight/underline treatment)
- A map to orient (country outline, city pin, heatmap, route animation)
- A diagram showing a relationship (flow, pyramid, node network, loop)
- A counter or graph proving a numeric claim
- A generated cinematic scene carrying mood or stakes
- A full-frame text card that punctuates the argument
- A sudden audio/visual drop that controls emotion

If a line cannot be visualized, flag it in `pipeline_failures_to_watch`.

### Music as structural tool

Categorize sound into three buckets (Johnny Harris method):

- **THINKY** — neutral pulse, investigative arpeggio, muted piano; for explanation/history/mechanisms
- **FEELY** — spacious, emotional, reflective pads; for stakes, human consequences, closing synthesis
- **FUN** — lighter, mischievous, dry percussion; for absurdity, irony, counterintuitive reveals

Map each scene block to one of these categories in `edit_fx_plan.music_categories`.

### Pattern interrupt vocabulary

Use these specific devices for retention resets. Pick at least 4 distinct types across the video:

| Device | What it does | Best used when |
|---|---|---|
| sudden_silence_drop | Music cuts out abruptly for 0.5–1.5s | After an absurd or shocking claim |
| full_frame_text_card | Single phrase fills screen, no other visual | Before a major argument pivot |
| speed_ramp | Footage accelerates or decelerates sharply | Transitioning between scale levels (personal → systemic) |
| color_flash | Background flashes to accent color (red/white) for 2–4 frames | Highlighting a risk term or danger signal |
| unexpected_closeup | Sudden tight crop on a detail | Humanizing a statistic |
| reverse_swell | Audio builds backward into a hit | Revealing a document or number |
| split_screen_comparison | Two visuals side by side | Before/after, cause/effect, country vs country |
| ken_burns_stop | Slow push-in halts on a key detail | Freezing on a face, number, or document line |

### Transition taxonomy

Use this controlled vocabulary in `shot_beats.transition_in` and `shot_beats.transition_out`:

`hard_cut` | `crossfade` | `dip_to_black` | `dip_to_white` | `whip_pan` | `match_cut` | `push_in` | `pull_out` | `slide_left` | `slide_right` | `iris_in` | `glitch` | `none`

### Shot rhythm rules

- A-roll segments: max 6s uninterrupted, then B-roll must appear
- B-roll segments: max 8s before returning to A-roll or switching B-roll category
- Counters/graphs: minimum 2.5s on screen (viewers need time to read numbers)
- Pattern interrupts: exactly at argument pivots, never at random moments
- Closing synthesis: slow down cut rate by 30–50% vs. the body

### Visual motif system

- Define a small set of recurring motifs that tie the essay together. Examples:
  * A single accent color (e.g., red = danger/debt, blue = institution, white = fact).
  * A consistent map style with animated region highlights.
  * A repeated icon family for abstract concepts (pyramid, loop, scale, gate).
- Record these in `storytelling_diagnosis.dominant_visual_language` and `caption_emphasis_plan`.

## Input

- `@context`: metadata + transcript + title + description
- `@frames`: sampled keyframes with approximate timestamps
- Optional: VTT or full video if available

## Output instructions

- Return **valid compact JSON only**. No markdown outside the JSON.
- Do not wrap the JSON in code fences.
- Timestamps are in seconds and may be floats.
- Every factual claim in the transcript must be linked to a visual-proof strategy in `graphics_plan` or `shot_beats`.
- The prompt is tuned for a Johnny-Harris-adjacent visual storytelling feel: authoritative voiceover, frequent visual beats, maps/diagrams/counters/graphs, document callouts, and deliberate pattern interrupts.

## Required JSON shape

```json
{
  "source_video_id": "string",
  "transcript": {
    "verbatim_or_vtt_cleaned": "string",
    "notable_asr_uncertainties": ["string"]
  },
  "storytelling_diagnosis": {
    "format_family": "string",
    "hook_pattern": "string",
    "narrative_arc": ["string"],
    "dominant_visual_language": ["string"],
    "pacing_cadence_seconds": "number or range",
    "retention_devices": ["string"],
    "pattern_interrupts": ["string"],
    "johnny_harris_mechanics": {
      "claim_then_reveal": ["string"],
      "data_to_emotion_transitions": ["string"],
      "geographic_or_systemic_visuals": ["string"],
      "closing_synthesis": "string",
      "visual_promise_payoff": {
        "hook_question": "string",
        "payoff_timestamp_seconds": 0.0,
        "visual_resolution": "string"
      }
    }
  },
  "scene_blocks": [
    {
      "block_index": 0,
      "start_seconds": 0.0,
      "end_seconds": 0.0,
      "block_function": "string (e.g., hook, exposition, case study, mechanism, consequence, synthesis)",
      "dominant_a_roll_or_b_roll": "A-roll|B-roll|mixed",
      "narration_summary": "string",
      "visual_summary": "string",
      "key_claims": ["string"],
      "proof_required": ["string"]
    }
  ],
  "shot_beats": [
    {
      "beat_index": 0,
      "start_seconds": 0.0,
      "end_seconds": 0.0,
      "target_cadence_seconds": "2–4",
      "beat_function": "string",
      "a_roll": {
        "active": true,
        "description": "string",
        "presenter_type": "string"
      },
      "b_roll": {
        "active": true,
        "description": "string",
        "asset_category": "map|diagram|counter|graph|document_callout|iconography|stock|generated_scene|silhouette|other"
      },
      "motion_cue": "string (e.g., push_in, pan_left, zoom_out, match_cut, whip_pan, parallax, static)",
      "transition_in": "string",
      "transition_out": "string",
      "caption_emphasis": "string"
    }
  ],
  "graphics_plan": {
    "maps_and_geography": [
      {
        "claim": "string",
        "map_type": "string (e.g., country_outline, city_map, heatmap, route)",
        "annotations": ["string"],
        "style_notes": "string"
      }
    ],
    "diagrams": [
      {
        "claim": "string",
        "diagram_type": "string (e.g., flow_chart, node_network, pyramid, loop, comparison)",
        "elements": ["string"],
        "style_notes": "string"
      }
    ],
    "counters_and_metrics": [
      {
        "claim": "string",
        "value": "string",
        "unit": "string",
        "animation_style": "string (e.g., rolling_number, ticking_stat, scale_fill)"
      }
    ],
    "graphs_and_time_series": [
      {
        "claim": "string",
        "graph_type": "string (e.g., line, bar, stacked_area, scatter)",
        "axes": {"x": "string", "y": "string"},
        "highlight_moments": ["string"]
      }
    ],
    "document_callouts": [
      {
        "claim": "string",
        "document_type": "string (e.g., legal_text, news_headline, report_excerpt, social_post)",
        "extracted_quote": "string",
        "visual_treatment": "string"
      }
    ],
    "iconography": [
      {
        "concept": "string",
        "icon_description": "string",
        "usage": "string"
      }
    ]
  },
  "edit_fx_plan": {
    "cut_density_per_minute": "number",
    "dominant_transition_types": ["string"],
    "motion_graphics": ["string"],
    "color_grading": "string",
    "overlay_system": "string",
    "sound_design_guesses": ["string"],
    "music_categories": [
      {
        "scene_block_index": 0,
        "category": "thinky|feely|fun",
        "rationale": "string"
      }
    ],
    "pattern_interrupt_schedule": [
      {
        "timestamp_seconds": 0.0,
        "device": "string"
      }
    ]
  },
  "caption_emphasis_plan": {
    "font_family_guess": "string",
    "text_color": "string",
    "highlight_color": "string",
    "alignment": "string",
    "animation_style": "string",
    "key_phrases_to_emphasize": ["string"],
    "caption_timing_rules": ["string"]
  },
  "render_component_specs": [
    {
      "component_id": "string",
      "component_type": "string (e.g., VideoPresenter, KenBurnsImage, MapSlide, NodeDiagram, MetricCounter, Graph, DocumentCallout, CaptionOverlay, BackgroundGrid, AudioSpectrum)",
      "used_in_beats": [0],
      "props": {
        "key": "value"
      },
      "remotion_equivalent": "string"
    }
  ],
  "asset_generation_prompts": {
    "presenter_avatar_prompt": "string",
    "presenter_description": "string",
    "slide_or_b_roll_prompts": ["string"],
    "icon_or_graphic_prompts": ["string"],
    "clean_room_substitution_notes": "string"
  },
  "pipeline_failures_to_watch": [
    {
      "failure": "string",
      "symptom": "string",
      "mitigation": "string"
    }
  ],
  "recreation_recipe": {
    "research_input_slot": "string",
    "script_generation_prompt": "string",
    "remotion_layers": ["string"],
    "provider_routes": [
      {
        "layer": "string",
        "primary": "string",
        "fallbacks": ["string"],
        "notes": "string"
      }
    ]
  },
  "slotok_artifacts": [
    {
      "kind": "string",
      "path_or_role": "string",
      "viewer_hint": "string"
    }
  ],
  "comparison_metrics": ["string"],
  "uncertainties": ["string"]
}
```

## Style and cadence guidance

- Aim for a new visual beat every **2–4 seconds**.
- Each beat should either advance the argument or reset viewer attention.
- A-roll (presenter/talking head) should be broken up by B-roll (maps, diagrams, archival, generated scenes) at least every 6–10 seconds.
- Use contrast deliberately: wide/map/system shots vs. tight/human/detail shots; data vs. emotion; fast cuts vs. sustained reveals.
- Plan transitions that feel intentional: match cuts on shape or motion, whip pans between regions, push-ins on key numbers, cross-fades for emotional beats.
- Reserve pattern interrupts for moments when the argument pivots: a new region, a surprising number, a counterintuitive mechanism, a moral conclusion.

## Verification checklist for the model

- Did every numeric claim get a counter or graph?
- Did every geographic claim get a map annotation?
- Did every systemic mechanism get a diagram?
- Did every legal/documentary claim get a document callout?
- Are shot beats spaced at roughly 2–4 second intervals?
- Is A-roll/B-roll assignment explicit for each scene block?
- Are all faces/voices/brands replaced with clean-room equivalents?
- Did you list at least three likely pipeline failures and mitigations?
- Does each pattern interrupt have a specific device name from the vocabulary?
- Is each scene block assigned a music category?
- Is the hook question resolved at a specific payoff timestamp with a visual?

## Notes for downstream renderer

- `render_component_specs` is the bridge to Remotion. Each component must have enough props to be instantiated.
- If a beat is not visually representable with current components, flag it in `pipeline_failures_to_watch`.
- Keep `asset_generation_prompts` concrete and provider-agnostic where possible; include clean-room substitution notes so the asset lane does not reproduce real identities.
