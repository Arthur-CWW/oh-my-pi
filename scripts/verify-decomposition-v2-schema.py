#!/usr/bin/env python3
"""Run build-decomposition-v2-7642101474981367054.py, print its stdout, and
verify the emitted JSON conforms to the shape described in
docs/prompts/tiktok-video-decomposition-v2.md (required keys, types, and
controlled vocabularies). Stdlib only.

Usage:
    python3 scripts/verify-decomposition-v2-schema.py
"""
import json
import subprocess
import sys
from pathlib import Path

REPO = Path(__file__).resolve().parent.parent
BUILD = REPO / "scripts" / "build-decomposition-v2-7642101474981367054.py"

TRANSITIONS = {
    "hard_cut", "crossfade", "dip_to_black", "dip_to_white", "whip_pan",
    "match_cut", "push_in", "pull_out", "slide_left", "slide_right",
    "iris_in", "glitch", "none",
}
MUSIC_CATS = {"thinky", "feely", "fun"}
INTERRUPTS = {
    "sudden_silence_drop", "full_frame_text_card", "speed_ramp",
    "color_flash", "unexpected_closeup", "reverse_swell",
    "split_screen_comparison", "ken_burns_stop",
}
ASSET_CATEGORIES = {
    "map", "diagram", "counter", "graph", "document_callout",
    "iconography", "stock", "generated_scene", "silhouette", "other",
}


# Shape DSL: each node is either
#   - {"_t": "str" | "num" | "bool" | "any" | "num_or_str"}
#   - {"_t": "list_str"} / {"_t": "list_num"}
#   - {"_t": "list_of", "item": <node>}
#   - a plain dict mapping required keys -> node (object)
def STR(): return {"_t": "str"}
def NUM(): return {"_t": "num"}
def BOOL(): return {"_t": "bool"}
def ANY(): return {"_t": "any"}
def NUM_OR_STR(): return {"_t": "num_or_str"}
def LIST_STR(): return {"_t": "list_str"}
def LIST_OF(item): return {"_t": "list_of", "item": item}


SCENE_BLOCK = {
    "block_index": NUM(),
    "start_seconds": NUM(),
    "end_seconds": NUM(),
    "block_function": STR(),
    "dominant_a_roll_or_b_roll": STR(),
    "narration_summary": STR(),
    "visual_summary": STR(),
    "key_claims": LIST_STR(),
    "proof_required": LIST_STR(),
}

SHOT_BEAT = {
    "beat_index": NUM(),
    "start_seconds": NUM(),
    "end_seconds": NUM(),
    "target_cadence_seconds": STR(),
    "beat_function": STR(),
    "a_roll": {
        "active": BOOL(),
        "description": STR(),
        "presenter_type": STR(),
    },
    "b_roll": {
        "active": BOOL(),
        "description": STR(),
        "asset_category": STR(),
    },
    "motion_cue": STR(),
    "transition_in": STR(),
    "transition_out": STR(),
    "caption_emphasis": STR(),
}

MUSIC_ENTRY = {
    "scene_block_index": NUM(),
    "category": STR(),
    "rationale": STR(),
}

INTERRUPT_ENTRY = {
    "timestamp_seconds": NUM(),
    "device": STR(),
}

SHAPE = {
    "source_video_id": STR(),
    "transcript": {
        "verbatim_or_vtt_cleaned": STR(),
        "notable_asr_uncertainties": LIST_STR(),
    },
    "storytelling_diagnosis": {
        "format_family": STR(),
        "hook_pattern": STR(),
        "narrative_arc": LIST_STR(),
        "dominant_visual_language": LIST_STR(),
        "pacing_cadence_seconds": NUM_OR_STR(),
        "retention_devices": LIST_STR(),
        "pattern_interrupts": LIST_STR(),
        "johnny_harris_mechanics": {
            "claim_then_reveal": LIST_STR(),
            "data_to_emotion_transitions": LIST_STR(),
            "geographic_or_systemic_visuals": LIST_STR(),
            "closing_synthesis": STR(),
            "visual_promise_payoff": {
                "hook_question": STR(),
                "payoff_timestamp_seconds": NUM(),
                "visual_resolution": STR(),
            },
        },
    },
    "scene_blocks": LIST_OF(SCENE_BLOCK),
    "shot_beats": LIST_OF(SHOT_BEAT),
    "graphics_plan": {
        "maps_and_geography": LIST_OF({
            "claim": STR(),
            "map_type": STR(),
            "annotations": LIST_STR(),
            "style_notes": STR(),
        }),
        "diagrams": LIST_OF({
            "claim": STR(),
            "diagram_type": STR(),
            "elements": LIST_STR(),
            "style_notes": STR(),
        }),
        "counters_and_metrics": LIST_OF({
            "claim": STR(),
            "value": STR(),
            "unit": STR(),
            "animation_style": STR(),
        }),
        "graphs_and_time_series": LIST_OF({
            "claim": STR(),
            "graph_type": STR(),
            "axes": {"x": STR(), "y": STR()},
            "highlight_moments": LIST_STR(),
        }),
        "document_callouts": LIST_OF({
            "claim": STR(),
            "document_type": STR(),
            "extracted_quote": STR(),
            "visual_treatment": STR(),
        }),
        "iconography": LIST_OF({
            "concept": STR(),
            "icon_description": STR(),
            "usage": STR(),
        }),
    },
    "edit_fx_plan": {
        "cut_density_per_minute": NUM_OR_STR(),
        "dominant_transition_types": LIST_STR(),
        "motion_graphics": LIST_STR(),
        "color_grading": STR(),
        "overlay_system": STR(),
        "sound_design_guesses": LIST_STR(),
        "music_categories": LIST_OF(MUSIC_ENTRY),
        "pattern_interrupt_schedule": LIST_OF(INTERRUPT_ENTRY),
    },
    "caption_emphasis_plan": {
        "font_family_guess": STR(),
        "text_color": STR(),
        "highlight_color": STR(),
        "alignment": STR(),
        "animation_style": STR(),
        "key_phrases_to_emphasize": LIST_STR(),
        "caption_timing_rules": LIST_STR(),
    },
    "render_component_specs": LIST_OF({
        "component_id": STR(),
        "component_type": STR(),
        "used_in_beats": {"_t": "list_num"},
        "props": {"_t": "any"},
        "remotion_equivalent": STR(),
    }),
    "asset_generation_prompts": {
        "presenter_avatar_prompt": STR(),
        "presenter_description": STR(),
        "slide_or_b_roll_prompts": LIST_STR(),
        "icon_or_graphic_prompts": LIST_STR(),
        "clean_room_substitution_notes": STR(),
    },
    "pipeline_failures_to_watch": LIST_OF({
        "failure": STR(),
        "symptom": STR(),
        "mitigation": STR(),
    }),
    "recreation_recipe": {
        "research_input_slot": STR(),
        "script_generation_prompt": STR(),
        "remotion_layers": LIST_STR(),
        "provider_routes": LIST_OF({
            "layer": STR(),
            "primary": STR(),
            "fallbacks": LIST_STR(),
            "notes": STR(),
        }),
    },
    "slotok_artifacts": LIST_OF({
        "kind": STR(),
        "path_or_role": STR(),
        "viewer_hint": STR(),
    }),
    "comparison_metrics": LIST_STR(),
    "uncertainties": LIST_STR(),
}


def check_node(value, node, path, errors):
    t = node.get("_t")
    if t is None:
        # object: node is a dict of required keys
        if not isinstance(value, dict):
            errors.append(f"{path}: expected object, got {type(value).__name__}")
            return
        for k, sub in node.items():
            if k not in value:
                errors.append(f"{path}.{k}: missing required key")
            else:
                check_node(value[k], sub, f"{path}.{k}", errors)
        return
    if t == "str":
        if not isinstance(value, str):
            errors.append(f"{path}: expected str, got {type(value).__name__}")
    elif t == "num":
        if not isinstance(value, (int, float)) or isinstance(value, bool):
            errors.append(f"{path}: expected number, got {type(value).__name__}")
    elif t == "bool":
        if not isinstance(value, bool):
            errors.append(f"{path}: expected bool, got {type(value).__name__}")
    elif t == "num_or_str":
        if not isinstance(value, (int, float, str)) or isinstance(value, bool):
            errors.append(f"{path}: expected number or str, got {type(value).__name__}")
    elif t == "any":
        pass
    elif t == "list_str":
        if not isinstance(value, list):
            errors.append(f"{path}: expected list, got {type(value).__name__}")
        elif not all(isinstance(x, str) for x in value):
            errors.append(f"{path}: expected list[str], found non-str element")
    elif t == "list_num":
        if not isinstance(value, list):
            errors.append(f"{path}: expected list, got {type(value).__name__}")
        elif not all(isinstance(x, (int, float)) and not isinstance(x, bool) for x in value):
            errors.append(f"{path}: expected list[number], found non-number element")
    elif t == "list_of":
        if not isinstance(value, list):
            errors.append(f"{path}: expected list, got {type(value).__name__}")
        else:
            for i, item in enumerate(value):
                check_node(item, node["item"], f"{path}[{i}]", errors)
    else:
        raise AssertionError(f"unknown shape tag {t!r} at {path}")


def check_vocab(decomp, errors):
    for i, b in enumerate(decomp["shot_beats"]):
        if b["transition_in"] not in TRANSITIONS:
            errors.append(f"shot_beats[{i}].transition_in={b['transition_in']!r} not in transition vocabulary")
        if b["transition_out"] not in TRANSITIONS:
            errors.append(f"shot_beats[{i}].transition_out={b['transition_out']!r} not in transition vocabulary")
        cat = b["b_roll"]["asset_category"]
        if cat not in ASSET_CATEGORIES:
            errors.append(f"shot_beats[{i}].b_roll.asset_category={cat!r} not in asset-category vocabulary")
    for j, m in enumerate(decomp["edit_fx_plan"]["music_categories"]):
        if m["category"] not in MUSIC_CATS:
            errors.append(f"music_categories[{j}].category={m['category']!r} not in music-category vocabulary")
    for k, p in enumerate(decomp["edit_fx_plan"]["pattern_interrupt_schedule"]):
        if p["device"] not in INTERRUPTS:
            errors.append(f"pattern_interrupt_schedule[{k}].device={p['device']!r} not in interrupt vocabulary")


def check_invariants(decomp, errors):
    # Verification checklist invariants from the prompt
    n_blocks = len(decomp["scene_blocks"])
    n_music = len(decomp["edit_fx_plan"]["music_categories"])
    if n_music != n_blocks:
        errors.append(
            f"each scene block must be assigned a music category; "
            f"got {n_music} music entries vs {n_blocks} scene blocks"
        )
    distinct = {p["device"] for p in decomp["edit_fx_plan"]["pattern_interrupt_schedule"]}
    if len(distinct) < 4:
        errors.append(f"need >=4 distinct interrupt devices, got {len(distinct)}: {sorted(distinct)}")
    if len(decomp["pipeline_failures_to_watch"]) < 3:
        errors.append("need >=3 pipeline_failures_to_watch entries")
    pp = decomp["storytelling_diagnosis"]["johnny_harris_mechanics"]["visual_promise_payoff"]
    if not isinstance(pp["payoff_timestamp_seconds"], (int, float)):
        errors.append("visual_promise_payoff.payoff_timestamp_seconds must be numeric")
    if not decomp["scene_blocks"]:
        errors.append("scene_blocks must be non-empty")
    if not decomp["shot_beats"]:
        errors.append("shot_beats must be non-empty")


def main():
    proc = subprocess.run(
        ["python3", str(BUILD)],
        cwd=REPO,
        capture_output=True,
        text=True,
    )
    if proc.returncode != 0:
        sys.stderr.write(proc.stderr)
        sys.stderr.write(f"\nbuild script exited {proc.returncode}\n")
        sys.exit(proc.returncode)
    raw = proc.stdout
    print("=== build script stdout ===")
    sys.stdout.write(raw)
    if not raw.endswith("\n"):
        print()
    print("=== end build script stdout ===\n")

    try:
        data = json.loads(raw)
    except json.JSONDecodeError as e:
        print(f"FAIL: build script output is not valid JSON: {e}")
        sys.exit(1)

    errors = []
    check_node(data, SHAPE, "$", errors)
    check_vocab(data, errors)
    check_invariants(data, errors)

    if errors:
        print(f"FAIL: {len(errors)} conformance error(s) against docs/prompts/tiktok-video-decomposition-v2.md:")
        for e in errors:
            print(f"  - {e}")
        sys.exit(1)

    print(f"PASS: output conforms to the JSON schema in "
          f"docs/prompts/tiktok-video-decomposition-v2.md "
          f"({len(data['scene_blocks'])} scene blocks, "
          f"{len(data['shot_beats'])} shot beats).")


if __name__ == "__main__":
    main()