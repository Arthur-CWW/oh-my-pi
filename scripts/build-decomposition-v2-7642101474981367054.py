#!/usr/bin/env python3
"""Build the v2 decomposition artifact for 2026-05-20_7642101474981367054.

Reads the real TikTok context.json for this video id, merges the transcript
(China overbearing-CEO ban) with the description (South Korea fertility/spend
comparative context + overarching narrative), and emits the exact JSON shape
described in docs/prompts/tiktok-video-decomposition-v2.md as valid compact
JSON on stdout. Validates all controlled vocabularies before printing.
"""
import json
import sys
from pathlib import Path

CONTEXT_PATH = Path(__file__).resolve().parent.parent / (
    "data/video-recreation/samuelszuchan/bootstrap-20260620/"
    "2026-05-20_7642101474981367054.context.json"
)
VIDEO_ID = "2026-05-20_7642101474981367054"
DURATION = 129.0

TRANSITIONS = {"hard_cut", "crossfade", "dip_to_black", "dip_to_white", "whip_pan",
               "match_cut", "push_in", "pull_out", "slide_left", "slide_right",
               "iris_in", "glitch", "none"}
MUSIC_CATS = {"thinky", "feely", "fun"}
INTERRUPTS = {"sudden_silence_drop", "full_frame_text_card", "speed_ramp",
              "color_flash", "unexpected_closeup", "reverse_swell",
              "split_screen_comparison", "ken_burns_stop"}
ASSET_CATEGORIES = {"map", "diagram", "counter", "graph", "document_callout",
                     "iconography", "stock", "generated_scene", "silhouette", "other"}


def load_context():
    d = json.loads(CONTEXT_PATH.read_text())
    assert d["id"] == VIDEO_ID, f"unexpected id: {d.get('id')!r}"
    return {
        "id": d["id"],
        "title": d.get("title", ""),
        "description": d.get("description", ""),
        "transcript": d.get("transcript", ""),
        "duration": float(d.get("duration", DURATION)),
        "view_count": d.get("view_count"),
        "like_count": d.get("like_count"),
        "comment_count": d.get("comment_count"),
        "frames": d.get("frames", []),
    }


def scene_blocks():
    return [
        {
            "block_index": 0, "start_seconds": 0.0, "end_seconds": 7.0,
            "block_function": "hook",
            "dominant_a_roll_or_b_roll": "A-roll",
            "narration_summary": "China banned Cinderella stories - here's why.",
            "visual_summary": "Full-frame text card punching the hook promise; red accent on 'banned'.",
            "key_claims": ["China banned a genre of romance dramas."],
            "proof_required": ["Text card: 'China banned Cinderella stories.'"],
        },
        {
            "block_index": 1, "start_seconds": 7.0, "end_seconds": 24.0,
            "block_function": "exposition",
            "dominant_a_roll_or_b_roll": "mixed",
            "narration_summary": "A decade of Chinese streaming dominated by 'ba dao zong shi' - the overbearing CEO genre.",
            "visual_summary": "Genre title card with romanized + translated name; decade-span timeline 2013-2021 of genre dominance.",
            "key_claims": ["Genre named 'ba dao zong shi' (overbearing CEO).",
                           "Dominated Chinese streaming for ~a decade."],
            "proof_required": ["Genre title card with romanization + translation.",
                               "Decade-span timeline graphic."],
        },
        {
            "block_index": 2, "start_seconds": 24.0, "end_seconds": 52.0,
            "block_function": "case study",
            "dominant_a_roll_or_b_roll": "B-roll",
            "narration_summary": "The trope: a girl drops something in a lobby; a 28-year-old billionaire catches it; Maybach, Pudong penthouse with glass-walled wine cellar, company worth 15 billion yuan.",
            "visual_summary": "Generated silhouette lobby drop scene; CEO dossier card (age 28, 15B yuan company, Maybach, Pudong penthouse).",
            "key_claims": ["CEO is 28 years old.", "Company worth 15 billion yuan.",
                           "Drives a Maybach.", "Pudong penthouse with glass-walled wine cellar."],
            "proof_required": ["CEO dossier counter (age, net worth).",
                               "Generated scene of penthouse/wine cellar (clean-room silhouette)."],
        },
        {
            "block_index": 3, "start_seconds": 52.0, "end_seconds": 72.0,
            "block_function": "mechanism",
            "dominant_a_roll_or_b_roll": "B-roll",
            "narration_summary": "Audience: women 18-35 in tier-2/3 cities, 4-12,000 yuan/month, many without local hukou (controls schools, healthcare, right to buy property); tier-1 home prices 15-25x median salary.",
            "visual_summary": "China map with tier-2/3 city pins; income counter 4-12k yuan; hukou icon stack; housing-affordability bar.",
            "key_claims": ["Audience women 18-35 in tier-2/3 cities.", "Income 4-12,000 yuan/month.",
                           "Many lack local hukou.", "Tier-1 home prices 15-25x median salary."],
            "proof_required": ["China map with tier city pins.", "Income counter (4-12k yuan).",
                               "Hukou iconography diagram.", "Housing-to-income ratio graph."],
        },
        {
            "block_index": 4, "start_seconds": 72.0, "end_seconds": 88.0,
            "block_function": "mechanism",
            "dominant_a_roll_or_b_roll": "mixed",
            "narration_summary": "Female lead never works her way up - the genre told its audience your situation won't be resolved by your own action but by something that happens to you.",
            "visual_summary": "Comparison diagram: 'own action' node crossed out vs 'something happens to you' node highlighted; loop diagram of rescue trope.",
            "key_claims": ["Female lead never starts a business or passes a difficult exam.",
                           "Genre message: resolution comes from an event, not action."],
            "proof_required": ["Loop diagram of the rescue mechanism.",
                               "Comparison node diagram (own-action vs rescue)."],
        },
        {
            "block_index": 5, "start_seconds": 88.0, "end_seconds": 106.0,
            "block_function": "mechanism",
            "dominant_a_roll_or_b_roll": "mixed",
            "narration_summary": "In 2021 regulators issued directives against 'money worship': luxury logos blurred, penthouse sets reshot to look austere; by 2023 the contemporary CEO drama was gone, replaced by rural revival, military romances, tang-dynasty palace intrigue.",
            "visual_summary": "Timeline 2021->2023 of regulatory directives; before/after split screen (ostentatious vs austere set); replacement-genre grid.",
            "key_claims": ["2021 directives against money worship.",
                           "Luxury logos blurred; penthouse sets reshot austere.",
                           "By 2023 contemporary CEO drama effectively gone.",
                           "Replacements: rural revival, military romances, tang-dynasty palace intrigue."],
            "proof_required": ["Split-screen before/after of set treatment.",
                               "Replacement-genre icon grid.", "Regulatory timeline."],
        },
        {
            "block_index": 6, "start_seconds": 106.0, "end_seconds": 122.0,
            "block_function": "consequence",
            "dominant_a_roll_or_b_roll": "mixed",
            "narration_summary": "South Korea never banned its CEO dramas (Boys Over Flowers, The Heirs, Crash Landing on You) yet fertility hit 0.72, Seoul 0.64, $270B spent over 16 years with negligible effect - demographics haven't slowed, so whatever drives women out operates below drama regulation.",
            "visual_summary": "Korea vs China split screen; Korea fertility line graph to 0.72; $270B counter; K-drama title callouts.",
            "key_claims": ["SK fertility 0.72 in 2023; Seoul 0.64.",
                           "$270B+ spent over 16 years on pronatalist incentives.",
                           "Korea never banned CEO dramas (Boys Over Flowers, The Heirs, Crash Landing on You).",
                           "Korea demographic collapse hasn't slowed."],
            "proof_required": ["Korea fertility line graph with 0.72/0.64 marked.",
                               "$270B rolling counter.", "K-drama title document callouts.",
                               "Korea/China comparison split screen."],
        },
        {
            "block_index": 7, "start_seconds": 122.0, "end_seconds": 129.0,
            "block_function": "synthesis",
            "dominant_a_roll_or_b_roll": "A-roll",
            "narration_summary": "Each ban is a small admission of anxiety about which story is winning; China's official youth unemployment crossed 16% in March (suspected higher); adjusting fiction only adjusts what the economy feels like.",
            "visual_summary": "Youth-unemployment counter crossing 16%; closing text card 'adjusting the fiction adjusts what the economy feels like'; slow push-in on silhouette.",
            "key_claims": ["China official youth unemployment crossed 16% in March.",
                           "Real number suspected higher.",
                           "Bans are admissions of anxiety about which story is winning.",
                           "Description cites 21.3% by June 2023 before publication was suspended."],
            "proof_required": ["Youth-unemployment counter (16%).", "Closing full-frame text card."],
        },
    ]


# (start, end, fn, a_roll_active, asset_cat, motion, t_in, t_out, interrupt, caption)
def shot_beat_specs():
    return [
        (0.0, 3.5, "hook text card", False, "generated_scene", "push_in", "none", "hard_cut", "full_frame_text_card", "'China banned Cinderella stories.'"),
        (3.5, 7.0, "hook promise sustained", True, "other", "static", "hard_cut", "hard_cut", "ken_burns_stop", "'Here's why.'"),
        (7.0, 10.5, "genre name reveal", False, "document_callout", "push_in", "hard_cut", "hard_cut", "reverse_swell", "'ba dao zong shi - overbearing CEO'"),
        (10.5, 14.0, "decade timeline", False, "graph", "pan_left", "match_cut", "hard_cut", "none", "2013-2021 dominance bar"),
        (14.0, 18.0, "trope setup: lobby drop", False, "generated_scene", "push_in", "crossfade", "hard_cut", "speed_ramp", "'A girl drops something in a lobby.'"),
        (18.0, 22.0, "CEO catches - silhouette closeup", False, "silhouette", "static", "whip_pan", "hard_cut", "unexpected_closeup", "'28-year-old billionaire catches it.'"),
        (22.0, 26.0, "CEO dossier card", False, "counter", "static", "hard_cut", "hard_cut", "none", "age 28"),
        (26.0, 30.0, "15B yuan company metric", False, "counter", "push_in", "hard_cut", "hard_cut", "ken_burns_stop", "15 billion yuan"),
        (30.0, 34.0, "Maybach / penthouse iconography", False, "iconography", "pan_right", "crossfade", "hard_cut", "none", "Maybach icon"),
        (34.0, 38.0, "Pudong penthouse generated scene", False, "generated_scene", "push_in", "match_cut", "hard_cut", "none", "glass-walled wine cellar"),
        (38.0, 42.0, "audience map: tier-2/3 cities", False, "map", "zoom_out", "whip_pan", "hard_cut", "split_screen_comparison", "China map pins"),
        (42.0, 46.0, "audience demo: women 18-35", False, "diagram", "static", "hard_cut", "hard_cut", "none", "18-35 cohort"),
        (46.0, 50.0, "income counter 4-12k yuan", False, "counter", "push_in", "hard_cut", "hard_cut", "ken_burns_stop", "4-12,000 yuan/month"),
        (50.0, 54.0, "hukou mechanism diagram", False, "diagram", "push_in", "crossfade", "hard_cut", "none", "hukou gates: schools/healthcare/property"),
        (54.0, 58.0, "housing affordability graph", False, "graph", "pan_right", "hard_cut", "hard_cut", "ken_burns_stop", "15-25x median"),
        (58.0, 62.0, "female-lead never advances", False, "diagram", "static", "match_cut", "hard_cut", "color_flash", "crossed-out 'own action'"),
        (62.0, 66.0, "rescue loop diagram", False, "diagram", "push_in", "crossfade", "hard_cut", "none", "loop: event rescues you"),
        (66.0, 70.0, "genre message text card", False, "other", "static", "hard_cut", "hard_cut", "full_frame_text_card", "'Resolved by something that happens to you.'"),
        (70.0, 74.0, "regulation pivot 2021", True, "document_callout", "push_in", "whip_pan", "hard_cut", "sudden_silence_drop", "2021 directive"),
        (74.0, 78.0, "before/after set split screen", False, "generated_scene", "static", "match_cut", "hard_cut", "split_screen_comparison", "ostentatious -> austere"),
        (78.0, 82.0, "logo blur visual treatment", False, "generated_scene", "push_in", "hard_cut", "hard_cut", "color_flash", "blurred luxury logo"),
        (82.0, 86.0, "timeline by 2023 gone", False, "graph", "pan_left", "hard_cut", "hard_cut", "none", "2023 removal marker"),
        (86.0, 90.0, "replacement genre grid", False, "iconography", "static", "crossfade", "hard_cut", "none", "rural / military / tang palace"),
        (90.0, 94.0, "referendum on official story", True, "diagram", "push_in", "hard_cut", "hard_cut", "ken_burns_stop", "official-story nodes"),
        (94.0, 98.0, "youth unemployment counter 16%", False, "counter", "push_in", "hard_cut", "hard_cut", "color_flash", "16% in March"),
        (98.0, 102.0, "real number suspected higher", False, "graph", "zoom_out", "crossfade", "hard_cut", "unexpected_closeup", "uncertainty band"),
        (102.0, 106.0, "ban = anxiety admission", True, "other", "static", "hard_cut", "hard_cut", "full_frame_text_card", "'which story is winning'"),
        (106.0, 110.0, "Korea vs China split screen", False, "map", "static", "whip_pan", "hard_cut", "split_screen_comparison", "Korea | China"),
        (110.0, 114.0, "Korea fertility line graph", False, "graph", "pan_right", "hard_cut", "hard_cut", "ken_burns_stop", "0.72 / 0.64 marks"),
        (114.0, 118.0, "$270B counter over 16y", False, "counter", "push_in", "hard_cut", "hard_cut", "reverse_swell", "$270 billion"),
        (118.0, 122.0, "K-drama title callouts", False, "document_callout", "static", "crossfade", "hard_cut", "none", "Boys Over Flowers / The Heirs / Crash Landing on You"),
        (122.0, 126.0, "below regulation diagram", False, "diagram", "zoom_out", "crossfade", "hard_cut", "speed_ramp", "demographics below drama-regulation layer"),
        (126.0, 129.0, "closing text card synthesis", True, "other", "push_in", "hard_cut", "dip_to_black", "full_frame_text_card", "'adjusting the fiction adjusts what the economy feels like.'"),
    ]


def shot_beats():
    beats = []
    for i, (s, e, fn, a_roll_active, asset_cat, motion, t_in, t_out, interrupt, caption) in enumerate(shot_beat_specs()):
        beats.append({
            "beat_index": i,
            "start_seconds": s,
            "end_seconds": e,
            "target_cadence_seconds": "2-4",
            "beat_function": fn,
            "a_roll": {
                "active": a_roll_active,
                "description": "faceless narrator silhouette over document/map" if a_roll_active else "no A-roll; pure B-roll visual",
                "presenter_type": "synthetic_silhouette",
            },
            "b_roll": {
                "active": True,
                "description": fn,
                "asset_category": asset_cat,
            },
            "motion_cue": motion,
            "transition_in": t_in,
            "transition_out": t_out,
            "caption_emphasis": caption,
            "_interrupt": interrupt,
        })
    return beats


def graphics_plan():
    return {
        "maps_and_geography": [
            {"claim": "Audience concentrated in China tier-2/3 cities", "map_type": "city_map",
             "annotations": ["tier-2 cluster", "tier-3 cluster", "shadow hukou exclusion zones"],
             "style_notes": "flat outline, accent pins, animated highlight sweep"},
            {"claim": "Korea vs China regulatory divergence", "map_type": "country_outline",
             "annotations": ["South Korea", "China", "split-screen comparison line"],
             "style_notes": "two-panel outline to contrast drama policy"},
        ],
        "diagrams": [
            {"claim": "Hukou gates access to schools/healthcare/property", "diagram_type": "flow_chart",
             "elements": ["hukou gate", "schools", "healthcare", "property right"],
             "style_notes": "gate icon blocking each branch"},
            {"claim": "Rescue loop: situation resolved by an event", "diagram_type": "loop",
             "elements": ["female lead", "drop event", "billionaire rescue", "status quo restored"],
             "style_notes": "circular arrows, accent on 'no own-action' path"},
            {"claim": "Demographic drivers operate below drama regulation", "diagram_type": "node_network",
             "elements": ["drama regulation", "housing prices", "youth unemployment", "fertility"],
             "style_notes": "drama-regulation node dimmed to show limited reach"},
        ],
        "counters_and_metrics": [
            {"claim": "CEO company worth", "value": "15", "unit": "billion yuan", "animation_style": "rolling_number"},
            {"claim": "Audience income", "value": "4000-12000", "unit": "yuan/month", "animation_style": "ticking_stat"},
            {"claim": "Housing-to-income ratio tier-1", "value": "15-25", "unit": "x median salary", "animation_style": "scale_fill"},
            {"claim": "China official youth unemployment", "value": "16", "unit": "percent (March)", "animation_style": "rolling_number"},
            {"claim": "China youth unemployment by June 2023 (description)", "value": "21.3", "unit": "percent (June, suspended)", "animation_style": "rolling_number"},
            {"claim": "SK fertility rate", "value": "0.72", "unit": "births/woman (Seoul 0.64)", "animation_style": "rolling_number"},
            {"claim": "SK pronatalist spending", "value": "270", "unit": "billion USD over 16 years", "animation_style": "rolling_number"},
        ],
        "graphs_and_time_series": [
            {"claim": "CEO genre dominance decade then 2021 regulatory cliff", "graph_type": "line",
             "axes": {"x": "year (2013-2023)", "y": "genre share of streaming"},
             "highlight_moments": ["2021 directive", "2023 near-zero contemporary CEO drama"]},
            {"claim": "SK fertility decline despite no drama ban", "graph_type": "line",
             "axes": {"x": "year", "y": "fertility rate"},
             "highlight_moments": ["2023: 0.72 national / 0.64 Seoul", "pronatalist spend window"]},
            {"claim": "Tier-1 home price to median salary ratio", "graph_type": "bar",
             "axes": {"x": "city tier", "y": "price-to-income multiple"},
             "highlight_moments": ["tier-1: 15-25x"]},
        ],
        "document_callouts": [
            {"claim": "Genre name 'ba dao zong shi'", "document_type": "report_excerpt",
             "extracted_quote": "ba dao zong shi - the overbearing CEO",
             "visual_treatment": "romanization + translation, underline"},
            {"claim": "2021 regulatory directives against money worship", "document_type": "legal_text",
             "extracted_quote": "directives against what they considered money worship",
             "visual_treatment": "austere document, highlight on 'money worship'"},
            {"claim": "Korea never banned CEO dramas", "document_type": "news_headline",
             "extracted_quote": "Boys Over Flowers, The Heirs, Crash Landing on You still dominate streaming charts",
             "visual_treatment": "three title cards"},
        ],
        "iconography": [
            {"concept": "hukou gate", "icon_description": "gate with three locked branches", "usage": "access to schools/healthcare/property"},
            {"concept": "Maybach / penthouse", "icon_description": "luxury car + skyline silhouette", "usage": "CEO wealth motif, logos blurred"},
            {"concept": "replacement genres", "icon_description": "rural / military / palace icons", "usage": "post-ban content grid"},
            {"concept": "accent danger color", "icon_description": "red = banned / risk", "usage": "pattern-interrupt color_flash and key terms"},
        ],
    }


def edit_fx_plan(blocks, beats):
    return {
        "cut_density_per_minute": 22.0,
        "dominant_transition_types": ["hard_cut", "match_cut", "crossfade", "whip_pan"],
        "motion_graphics": ["rolling_number counters", "map pin sweeps", "timeline bars", "loop diagrams", "split-screen comparison"],
        "color_grading": "cool institutional blue base; red accent only on risk/ban beats; austere desaturation on post-ban set shots",
        "overlay_system": "lower-third captions + key-phrase highlight underline; document callout overlay with extracted quote",
        "sound_design_guesses": ["foley lobby drop on speed_ramp", "paper rustle on document callouts", "subtle UI ticks on counters", "silence drop at 2021 directive"],
        "music_categories": [
            {"scene_block_index": 0, "category": "fun", "rationale": "mischievous hook irony: 'China banned Cinderella stories'"},
            {"scene_block_index": 1, "category": "thinky", "rationale": "exposition of genre mechanics"},
            {"scene_block_index": 2, "category": "fun", "rationale": "absurd CEO trope reveal"},
            {"scene_block_index": 3, "category": "thinky", "rationale": "demographic/economic mechanism mapping"},
            {"scene_block_index": 4, "category": "thinky", "rationale": "genre-message mechanism analysis"},
            {"scene_block_index": 5, "category": "thinky", "rationale": "regulatory mechanism walk-through"},
            {"scene_block_index": 6, "category": "feely", "rationale": "Korea demographic stakes and human consequence"},
            {"scene_block_index": 7, "category": "feely", "rationale": "closing synthesis on anxiety and limits of fiction control"},
        ],
        "pattern_interrupt_schedule": [
            {"timestamp_seconds": b["start_seconds"], "device": b["_interrupt"]}
            for b in beats if b["_interrupt"] != "none"
        ],
    }


def caption_emphasis_plan():
    return {
        "font_family_guess": "geometric sans (e.g. Inter / Sohne)",
        "text_color": "#F2F2F2",
        "highlight_color": "#E63946",
        "alignment": "lower-center with left-justified document callouts",
        "animation_style": "fade-up with accent underline grow on key phrases",
        "key_phrases_to_emphasize": [
            "banned Cinderella stories", "overbearing CEO", "15 billion yuan", "hukou",
            "15 to 25 times median salary", "money worship", "0.72", "270 billion",
            "Boys Over Flowers", "adjusting the fiction adjusts what the economy feels like",
        ],
        "caption_timing_rules": [
            "on-screen min 2.5s for numeric claims",
            "highlight accent appears 0.3s after caption",
            "text cards hold full-frame 1.5-2.5s",
        ],
    }


def render_component_specs():
    return [
        {"component_id": "TextCard", "component_type": "CaptionOverlay", "used_in_beats": [0, 1, 17, 26, 33], "props": {"text": "", "full_frame": True}, "remotion_equivalent": "<CaptionOverlay/>"},
        {"component_id": "GenreTitleCard", "component_type": "DocumentCallout", "used_in_beats": [2], "props": {"quote": "ba dao zong shi - overbearing CEO", "romanized": True}, "remotion_equivalent": "<DocumentCallout/>"},
        {"component_id": "DecadeTimeline", "component_type": "Graph", "used_in_beats": [3, 21], "props": {"graph_type": "line", "x": "year", "y": "genre share"}, "remotion_equivalent": "<Graph/>"},
        {"component_id": "LobbyDropScene", "component_type": "VideoPresenter", "used_in_beats": [4, 5], "props": {"style": "silhouette_generated_scene"}, "remotion_equivalent": "<VideoPresenter/>"},
        {"component_id": "CEODossier", "component_type": "MetricCounter", "used_in_beats": [6, 7], "props": {"age": 28, "company_worth_yuan_bn": 15}, "remotion_equivalent": "<MetricCounter/>"},
        {"component_id": "PenthouseScene", "component_type": "KenBurnsImage", "used_in_beats": [9], "props": {"motion": "push_in", "asset": "generated_penthouse"}, "remotion_equivalent": "<KenBurnsImage/>"},
        {"component_id": "ChinaCityMap", "component_type": "MapSlide", "used_in_beats": [10], "props": {"country": "CN", "pins": "tier2_tier3"}, "remotion_equivalent": "<MapSlide/>"},
        {"component_id": "IncomeCounter", "component_type": "MetricCounter", "used_in_beats": [12], "props": {"value": "4000-12000", "unit": "yuan/month"}, "remotion_equivalent": "<MetricCounter/>"},
        {"component_id": "HukouDiagram", "component_type": "NodeDiagram", "used_in_beats": [13], "props": {"nodes": ["hukou", "schools", "healthcare", "property"]}, "remotion_equivalent": "<NodeDiagram/>"},
        {"component_id": "HousingGraph", "component_type": "Graph", "used_in_beats": [14], "props": {"graph_type": "bar", "y": "price-to-income multiple"}, "remotion_equivalent": "<Graph/>"},
        {"component_id": "RescueLoop", "component_type": "NodeDiagram", "used_in_beats": [15, 16], "props": {"diagram_type": "loop"}, "remotion_equivalent": "<NodeDiagram/>"},
        {"component_id": "DirectiveDoc", "component_type": "DocumentCallout", "used_in_beats": [18], "props": {"quote": "money worship", "treatment": "austere"}, "remotion_equivalent": "<DocumentCallout/>"},
        {"component_id": "SplitScreen", "component_type": "BackgroundGrid", "used_in_beats": [19, 27], "props": {"panels": 2}, "remotion_equivalent": "<BackgroundGrid/>"},
        {"component_id": "ReplacementGrid", "component_type": "DocumentCallout", "used_in_beats": [22], "props": {"genres": ["rural revival", "military romance", "tang palace"]}, "remotion_equivalent": "<DocumentCallout/>"},
        {"component_id": "UnemploymentCounter", "component_type": "MetricCounter", "used_in_beats": [24], "props": {"value": 16, "unit": "percent"}, "remotion_equivalent": "<MetricCounter/>"},
        {"component_id": "KoreaFertilityGraph", "component_type": "Graph", "used_in_beats": [28], "props": {"graph_type": "line", "marks": [0.72, 0.64]}, "remotion_equivalent": "<Graph/>"},
        {"component_id": "SKSpendingCounter", "component_type": "MetricCounter", "used_in_beats": [29], "props": {"value": 270, "unit": "billion USD/16y"}, "remotion_equivalent": "<MetricCounter/>"},
        {"component_id": "KDramaCallouts", "component_type": "DocumentCallout", "used_in_beats": [30], "props": {"titles": ["Boys Over Flowers", "The Heirs", "Crash Landing on You"]}, "remotion_equivalent": "<DocumentCallout/>"},
    ]


def asset_generation_prompts():
    return {
        "presenter_avatar_prompt": "faceless silhouette of a young professional narrator, neutral lighting, clean institutional background, no identifiable likeness or branding",
        "presenter_description": "synthetic right-cleared silhouette avatar, neutral posture, used for A-roll only; no real creator resemblance",
        "slide_or_b_roll_prompts": [
            "clean-room generated scene: modern glass lobby, a dropped object on polished floor, no faces, anonymized corporate aesthetic",
            "clean-room generated scene: austere Pudong-style penthouse interior with glass-walled wine cellar, no logos, desaturated luxury",
            "split-screen before/after: ostentatious luxury set vs austere reshot set, no real brand marks",
            "two-panel country outline: South Korea and China side by side, flat institutional style",
        ],
        "icon_or_graphic_prompts": [
            "hukou gate icon with three locked branches (schools, healthcare, property)",
            "rescue-loop diagram with crossed-out 'own action' path and highlighted 'event' path",
            "replacement-genre icon grid: rural revival, military romance, tang-dynasty palace intrigue",
        ],
        "clean_room_substitution_notes": "All real K-drama and Chinese drama titles referenced only as factual claims (document_callouts), never reproduced as media. CEO/penthouse/Maybach imagery rendered as anonymized silhouettes with logos blurred. No real creator face, voice, or brand is imitated.",
    }


def pipeline_failures_to_watch():
    return [
        {"failure": "KIE plate prompt bakes text and wrong map", "symptom": "generated plate shows whole-peninsula map and hardcoded captions", "mitigation": "pass explicit single-country outline and leave captions to CaptionOverlay layer"},
        {"failure": "Large MP4 skipped by native video probe", "symptom": "OMP @mp4 prompt returns no segments", "mitigation": "use sampled frames + VTT lane; do not depend on native full-video probe"},
        {"failure": "ASR transcript romanization errors", "symptom": "'ba dao zong shi' transcribed inconsistently; '15 billion yen' misunit'd for yuan", "mitigation": "flag in uncertainties; correct unit to yuan in counters"},
        {"failure": "Numeric counter reads too fast", "symptom": "viewers can't read 15B yuan in 2s", "mitigation": "hold counters min 2.5s, use ticking_stat with underlay caption"},
        {"failure": "K-drama titles reproduced as media", "symptom": "asset lane renders real show stills", "mitigation": "render titles as text callouts only; never as reproduced footage"},
        {"failure": "Genre-message beat not visualizable", "symptom": "abstract claim lacks a concrete visual", "mitigation": "use loop diagram + full-frame text card fallback; already planned"},
    ]


def recreation_recipe():
    return {
        "research_input_slot": "ctx.description (SK/China arc) + ctx.transcript (China ban mechanics) + ctx.frames (editing structure)",
        "script_generation_prompt": "rewrite as clean-room narration preserving the SK/China comparison arc and the CEO-ban mechanism; abstract all identities; keep numeric claims for counters",
        "remotion_layers": ["CaptionOverlay", "MetricCounter", "Graph", "MapSlide", "NodeDiagram", "DocumentCallout", "KenBurnsImage", "VideoPresenter", "BackgroundGrid", "AudioSpectrum"],
        "provider_routes": [
            {"layer": "narration", "primary": "MiniMax TTS (male-qn-qingse)", "fallbacks": ["ElevenLabs", "locale TTS"], "notes": "English voice override; ~1563 chars expected"},
            {"layer": "b-roll generated scenes", "primary": "Jimeng Dreamina", "fallbacks": ["KIE plate generation", "stock silhouette"], "notes": "generation concurrency 1; stop on risk-control 1019"},
            {"layer": "presenter avatar", "primary": "Jimeng synthetic persona", "fallbacks": ["silhouette SVG"], "notes": "right-cleared, no real likeness"},
            {"layer": "render", "primary": "Remotion renderer", "fallbacks": ["OMP render lane"], "notes": "1080x1920 @30fps; direct-audio or audio-manifest"},
            {"layer": "decomposition", "primary": "Antigravity Gemini 3.5-flash frame+VTT lane", "fallbacks": ["this v2 merged decomposition"], "notes": "native full-video probe blocked by large-file skip"},
        ],
    }


def slotok_artifacts():
    return [
        {"kind": "handoff", "path_or_role": "slotok-handoff-v5.json", "viewer_hint": "provider jobs + manifests import"},
        {"kind": "manifest", "path_or_role": "manifest.json", "viewer_hint": "bootstrap run provenance"},
        {"kind": "decomposition", "path_or_role": "this artifact (v2 merged)", "viewer_hint": "renderer-consumable scene/beat/graphics plan"},
        {"kind": "renders", "path_or_role": "renders/2026-05-20_7642101474981367054*/recreate.mp4", "viewer_hint": "clean-room Remotion output"},
    ]


def comparison_metrics():
    return [
        "SK fertility 0.72 / Seoul 0.64 vs China official youth unemployment 16%",
        "SK $270B pronatalist spend over 16y vs nil measurable effect",
        "Korea: no CEO-drama ban vs China: 2021 ban -> 2023 genre gone",
        "tier-1 housing 15-25x median salary vs audience income 4-12k yuan/month",
    ]


def uncertainties():
    return [
        "Transcript says '15 billion yen' - corrected to yuan per description; confirm unit.",
        "'ba dao zong shi' romanization from ASR; may be 'ba dao zongshi' / 'badao zongshi'.",
        "Transcript cites youth unemployment 'crossed 16% in March'; description cites 21.3% by June 2023 before publication suspended - reconcile.",
        "'tong dynasty' likely 'Tang dynasty'.",
        "Frame sampling is 8 frames across 129s; beat cadence inferred, not frame-locked.",
        "Exact hook payoff timestamp inferred from scene_block 7 start (~122s) within 129s runtime.",
    ]


def build(ctx):
    blocks = scene_blocks()
    beats = shot_beats()
    decomposition = {
        "source_video_id": ctx["id"],
        "transcript": {
            "verbatim_or_vtt_cleaned": ctx["transcript"],
            "notable_asr_uncertainties": [
                "'ba dao zong shi' romanization drift",
                "'15 billion yen' likely 'yuan'",
                "'tong dynasty' likely 'Tang dynasty'",
                "'BA dao zong Shi' capitalization inconsistent",
            ],
        },
        "storytelling_diagnosis": {
            "format_family": "johnny-harris-adjacent visual essay (explainer / comparative systems)",
            "hook_pattern": "counterintuitive policy one-liner ('China banned Cinderella stories')",
            "narrative_arc": [
                "Hook: China banned Cinderella stories - here's why",
                "Exposition: the overbearing CEO genre dominated a decade",
                "Case study: the trope (billionaire rescues a girl in a lobby)",
                "Mechanism: audience profile + blocked economic path (hukou, housing)",
                "Mechanism: genre message - resolution by event, not own action",
                "Mechanism: 2021 ban -> austere sets -> 2023 genre gone",
                "Consequence: South Korea comparison - no ban, fertility 0.72, $270B no effect",
                "Synthesis: bans are anxiety admissions; fiction regulation can't reach demographics",
            ],
            "dominant_visual_language": [
                "accent red = banned/risk, institutional blue = data, white = fact",
                "flat country/city maps with animated pins",
                "rolling-number counters for every numeric claim",
                "loop/node diagrams for mechanisms",
                "split-screen Korea vs China comparison",
            ],
            "pacing_cadence_seconds": "2-4",
            "retention_devices": ["full_frame_text_card", "split_screen_comparison", "rolling counters", "map pin sweeps", "whip_pan between regions", "color_flash on risk terms"],
            "pattern_interrupts": ["full_frame_text_card", "sudden_silence_drop", "color_flash", "split_screen_comparison", "reverse_swell", "speed_ramp", "unexpected_closeup", "ken_burns_stop"],
            "johnny_harris_mechanics": {
                "claim_then_reveal": [
                    "claim: China banned Cinderella stories -> reveal: the overbearing CEO genre and its message",
                    "claim: Korea never banned its CEO dramas -> reveal: demographics still collapsed",
                ],
                "data_to_emotion_transitions": [
                    "15-25x housing ratio -> human consequence of closed path",
                    "0.72 fertility -> feely music + K-drama still-streaming irony",
                ],
                "geographic_or_systemic_visuals": [
                    "China tier-2/3 city map of the audience",
                    "Korea vs China split-screen regulatory divergence",
                    "demographic-drivers node network placing drama regulation below the real drivers",
                ],
                "closing_synthesis": "adjusting the fiction adjusts what the economy feels like - but Korea shows the drivers operate below drama regulation",
                "visual_promise_payoff": {
                    "hook_question": "Why did China ban Cinderella stories, and did it work?",
                    "payoff_timestamp_seconds": 126.0,
                    "visual_resolution": "closing full-frame text card 'adjusting the fiction adjusts what the economy feels like', preceded by Korea fertility graph proving demographics unchanged",
                },
            },
        },
        "scene_blocks": blocks,
        "shot_beats": [{k: v for k, v in b.items() if k != "_interrupt"} for b in beats],
        "graphics_plan": graphics_plan(),
        "edit_fx_plan": edit_fx_plan(blocks, beats),
        "caption_emphasis_plan": caption_emphasis_plan(),
        "render_component_specs": render_component_specs(),
        "asset_generation_prompts": asset_generation_prompts(),
        "pipeline_failures_to_watch": pipeline_failures_to_watch(),
        "recreation_recipe": recreation_recipe(),
        "slotok_artifacts": slotok_artifacts(),
        "comparison_metrics": comparison_metrics(),
        "uncertainties": uncertainties(),
    }
    return decomposition, beats


def validate(decomposition, beats):
    for b in beats:
        assert b["transition_in"] in TRANSITIONS, f"bad transition_in: {b['transition_in']}"
        assert b["transition_out"] in TRANSITIONS, f"bad transition_out: {b['transition_out']}"
        assert b["_interrupt"] in INTERRUPTS or b["_interrupt"] == "none", f"bad interrupt: {b['_interrupt']}"
        assert b["b_roll"]["asset_category"] in ASSET_CATEGORIES, f"bad asset_category: {b['b_roll']['asset_category']}"
    for m in decomposition["edit_fx_plan"]["music_categories"]:
        assert m["category"] in MUSIC_CATS, f"bad music category: {m}"
    for p in decomposition["edit_fx_plan"]["pattern_interrupt_schedule"]:
        assert p["device"] in INTERRUPTS, f"bad interrupt device: {p}"
    assert len(decomposition["edit_fx_plan"]["music_categories"]) == len(decomposition["scene_blocks"]), "music not assigned per scene block"
    distinct = {p["device"] for p in decomposition["edit_fx_plan"]["pattern_interrupt_schedule"]}
    assert len(distinct) >= 4, f"need >=4 interrupt types, got {len(distinct)}: {distinct}"
    assert len(decomposition["pipeline_failures_to_watch"]) >= 3, "need >=3 pipeline failures"
    counter_text = json.dumps(decomposition["graphics_plan"]["counters_and_metrics"])
    for needle in ["15", "12000", "0.72", "270", "16"]:
        assert needle in counter_text, f"missing numeric proof for {needle}"
    # numeric claim vs counter/graph coverage spot-checks
    counters_blob = json.dumps(decomposition["graphics_plan"]["counters_and_metrics"])
    for needle in ["\"value\": \"15\"", "\"value\": \"270\"", "\"value\": \"0.72\"", "\"value\": \"16\""]:
        assert needle in counters_blob, f"missing counter value: {needle}"


def main():
    ctx = load_context()
    decomposition, beats = build(ctx)
    validate(decomposition, beats)
    compact = json.dumps(decomposition, separators=(",", ":"), ensure_ascii=False)
    json.loads(compact)  # prove validity
    sys.stdout.write(compact)
    sys.stdout.write("\n")


if __name__ == "__main__":
    main()