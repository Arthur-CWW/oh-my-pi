# Pleometric video layer decomposition prompt

You are analyzing shortform AI/TikTok videos from the public Pleometric catalogue for a creative reveng archive.

Goal: reconstruct the likely prompts, generation process, and editing stack well enough that we can build our own original, editable, layered workflow inspired by the mechanics — not copy protected characters, private identities, or exact media.

If you use private design-review skills while interpreting composition or polish, use only original, abstract checklist labels. Do not copy protected source text, screenshots, examples, or proprietary phrasing into the output.

You will receive sampled keyframes plus basic video metadata. Each frame includes an approximate timestamp. Treat the keyframes as an ordered timeline sample and produce a timestamped decomposition that can later be compared against generated videos. If temporal/audio details are missing, say so explicitly instead of pretending.

Return **valid compact JSON only**. No markdown. No prose outside JSON.

Analyze the video as separable layers:

1. Concept / meme source
   - What meme/audio/reference/formula appears to drive the clip?
   - Is it a song lyric, cartoon character, internet meme, absurd object, “test” format, or mashup?

2. Visual subject layer
   - Main character/object(s), likely source type, consistency, distortions.
   - Whether the subject is original, pop-culture derivative, meme derivative, or ambiguous.

3. Background / scene layer
   - Setting, environment, color palette, whether background is static/generated/looped.

4. Motion / performance layer
   - Camera moves, character/object motion, dance/gesture/action loops, likely image-to-video vs text-to-video clues.

5. Editing / timing layer
   - Duration logic, cuts, repetition, beat sync, loops, “test” iteration format.

6. Audio / caption / text layer
   - Any visible captions/text/UI; whether text seems generated or added in post.
   - If audio is inferable only from title/metadata, say that.

7. Timeline / transition layer
   - Segment the video into timestamp ranges using the sampled frames.
   - Identify likely transitions: hard cut, morph, loop reset, zoom, pan, beat hit, scene change, speed change, no visible transition.
   - For each transition, estimate timestamp, evidence, and confidence.

8. Post-processing layer
   - Compression, glow, filters, motion blur, zoom, speed ramp, frame interpolation, TikTok-native artifacts.

9. Probable generation workflow
   - Decompose into likely steps, e.g. source meme/audio -> image prompt/reference -> image-to-video model -> local edit -> TikTok upload.
   - Reconstruct plausible prompt cards for each generative step: image prompt, video prompt, negative prompt, reference image requirements, motion instruction, style instruction.
   - Name possible model families only when visual evidence supports it; otherwise use generic categories.

10. Editing / assembly reconstruction
   - Infer what was likely done outside the video model: trim, crop, loop, beat-sync, speed change, zoom, cut points, audio alignment, subtitles/text, upload compression.
   - Give ffmpeg/CapCut/Remotion-style operations when possible.

11. Comparison / optimization readiness
   - Extract features that can be compared against our own generated videos later: subject match, composition match, palette, motion rhythm, transition timing, artifact profile, edit density, prompt adherence.
   - Suggest measurable checks where possible.

12. Asset generation / recombination plan
   - Decompose what assets we need to generate ourselves: character, prop, background, overlays, audio, captions, post effects, motion source.
   - For each asset, propose multiple generation routes: pure LLM/image/video API, reference-image workflow, local procedural/traditional tool, or stock/manual asset.
   - Explain what can be recombined independently and what must stay coupled.

13. Provider/API experiment matrix
   - Suggest which providers/model categories should be tested for each asset/layer, what success metrics to use, and what failure modes to track.
   - Prefer outputs that can be compared against this decomposition later.

14. Clean-room design QA / reviewer plan
   - Identify which reviewer personas should inspect generated outputs: visual hierarchy/composition, accessibility/keyboard for interactive editors, state/data wiring for workflow UIs, performance/static analysis, or proof-artifact review.
   - Use private design-skill output only as summarized checklist categories, never as copied protected text.
   - Suggest what screenshots, videos, state matrices, or artifact manifests would let reviewers judge the result without rerunning the whole generation.

15. Uncertainty
   - Be explicit about what the keyframes cannot prove.

Return this JSON shape:

{
  "video_summary": "string",
  "format_family": "string",
  "concept_meme_source": {
    "likely_source": "string",
    "evidence": ["string"],
    "uncertainty": "string"
  },
  "timeline": {
    "segments": [
      {
        "start_seconds": 0.0,
        "end_seconds": 0.0,
        "representative_frame_indices": [0],
        "description": "string",
        "subject_state": "string",
        "background_state": "string",
        "motion_state": "string",
        "likely_generation_step": "string",
        "confidence": 0.0
      }
    ],
    "transitions": [
      {
        "timestamp_seconds": 0.0,
        "type": "hard_cut|morph|loop_reset|zoom|pan|beat_hit|speed_change|scene_change|none|unknown",
        "evidence": "string",
        "probable_edit_operation": "string",
        "confidence": 0.0
      }
    ]
  },
  "layers": {
    "subject": {
      "description": "string",
      "source_type": "original|pop_culture_derivative|meme_derivative|ambiguous",
      "consistency_notes": "string",
      "generation_clues": ["string"]
    },
    "background": {
      "description": "string",
      "palette": ["string"],
      "generation_clues": ["string"]
    },
    "motion": {
      "description": "string",
      "camera": "string",
      "loop_or_action": "string",
      "generation_clues": ["string"]
    },
    "editing": {
      "pacing": "string",
      "cuts_or_repetition": "string",
      "beat_sync_likelihood": "low|medium|high|unknown"
    },
    "audio_caption_text": {
      "visible_text": ["string"],
      "audio_inference": "string",
      "post_text_likelihood": "low|medium|high|unknown"
    },
    "post_processing": {
      "effects": ["string"],
      "artifact_notes": "string"
    }
  },
  "probable_workflow": [
    {
      "step": "string",
      "layer": "string",
      "tool_or_model_category": "string",
      "likely_prompt_or_instruction": "string",
      "negative_prompt_or_constraints": "string",
      "confidence": 0.0
    }
  ],
  "editing_reconstruction": {
    "timeline_operations": ["string"],
    "transition_timestamps_seconds": [0.0],
    "audio_alignment_guess": "string",
    "crop_aspect_export_settings": "string",
    "post_effects_stack": ["string"],
    "ffmpeg_or_remotion_equivalent": ["string"]
  },
  "comparison_ready_features": {
    "subject_features": ["string"],
    "background_features": ["string"],
    "motion_features": ["string"],
    "editing_features": ["string"],
    "post_processing_features": ["string"],
    "style_distance_rubric": ["string"],
    "optimization_targets": ["string"]
  },
  "asset_generation_plan": [
    {
      "asset_id": "string",
      "layer": "subject|background|prop|overlay|motion|audio|caption|post_effect|other",
      "description": "string",
      "generation_routes": [
        {
          "route": "pure_text_to_image|image_to_video|text_to_video|reference_to_video|local_procedural|manual_edit|stock_or_library|tts|audio_edit",
          "provider_or_tool_candidates": ["string"],
          "prompt_template": "string",
          "inputs_needed": ["string"],
          "success_metrics": ["string"],
          "failure_modes": ["string"]
        }
      ],
      "recombinability": "independent|coupled_to_motion|coupled_to_audio|coupled_to_subject|unknown",
      "priority": "p0|p1|p2"
    }
  ],
  "provider_experiment_matrix": [
    {
      "experiment_id": "string",
      "layer_or_asset": "string",
      "providers_to_compare": ["string"],
      "fixed_inputs": ["string"],
      "variable_prompts_or_settings": ["string"],
      "comparison_metrics": ["string"],
      "expected_cost_sensitivity": "low|medium|high|unknown"
    }
  ],
  "clean_room_design_qa": {
    "private_skill_checklist_categories": ["string"],
    "reviewer_personas": [
      {
        "persona": "visual_hierarchy_composition|accessibility_keyboard|state_data_wiring|performance_static_analysis|proof_artifact_review",
        "why_needed": "string",
        "inputs_required": ["string"],
        "questions_to_answer": ["string"],
        "blocker_or_medium_issue_examples": ["string"]
      }
    ],
    "proof_artifacts_to_capture": ["string"],
    "protected_source_boundary": "string"
  },
  "reusable_original_recipe": {
    "asset_primitives": ["string"],
    "prompt_templates": ["string"],
    "graph_nodes": ["string"],
    "local_post_nodes": ["string"],
    "metadata_to_track": ["string"],
    "clean_room_substitution_notes": "string"
  },
  "vibe_tags": ["string"],
  "visual_tags": ["string"],
  "model_or_tool_clues": ["string"],
  "confidence": 0.0,
  "needs_full_video_or_audio": ["string"]
}
