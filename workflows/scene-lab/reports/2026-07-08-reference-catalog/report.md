---
title: "Video-Understanding Reference Catalog Report"
author: "ReferenceCatalog Subagent (Gemini Lane via Antigravity)"
date: "2026-07-08"
target_videos: 30
actual_spend_usd: 0.00
---

# Video-Understanding Reference Catalog Report

## Method

To catalog the visual and cultural mashup references in the Pleometric corpus, we performed the following:

1. **Metadata Triage**: Cross-referenced `data/inspiration/pleometric/manifest.json` and `data/inspiration/pleometric/transcripts.json` for tweet text and transcript excerpts.
2. **Frame Sampling**: Used ffmpeg to extract 8 evenly-spaced keyframes per video (scaled to 640px width), stored in `/tmp/pleometric_frames`.
3. **Provider Execution**: Ran `omp -p --model google-antigravity/gemini-3.5-flash --no-tools --no-session @frame1 ... @frame8 "PROMPT"` for each video sequentially with modest pacing. All calls were routed through the Antigravity subscription lane (OAuth brokered by `omp token google-antigravity`). No paid API keys or KIE credits were used.
4. **Parsing**: Tolerated fenced/wrapped output; extracted strict JSON from the model response; wrote per-video results to `data/provider-evals/video-understanding/runs/reference-catalog-antigravity/{id}.json`.
5. **Coverage**: 30/30 targeted videos completed successfully through the subscription lane. No retries needed for the final batch.

## Cost Actually Spent

- **Total Spend**: **$0.00 USD** — all consumption was on the Google Antigravity subscription lane.

## Ground-Truth Hit Rate (Visual Pass)

We validated the visual pass against Arthur's known references:

- **Sonic / Peach / Gigachad (Miss)** on `2070631349778579630-1` (Arthur's "favorite" video). The visual pass returned `seedance`, `All-Seeing Eye`, and `Three Wise Monkeys`; it did not surface Sonic, Peach, or Gigachad. The transcript mentions "Check out seedance 2," which likely pulled the model away from the character mashup visuals.
- **Penguin (2/2 Hit)** on `2044829644910641471-1` and `2046685420142932151-1`. Both videos were tagged `Club Penguin` with high confidence (0.95 and 0.99 respectively), matching the known low-poly penguin motif.
- **Aschenbrenner×orange (Hit)** on `2056378137831682359-1`. The model returned `Leopold Aschenbrenner` (0.99) and also a spurious `Club Penguin` co-reference; the primary known reference was captured.

**Overall hit rate on the four known reference checks: 3/4** (penguin ×2, Aschenbrenner ×1; Sonic/Peach/Gigachad ×0).

## Top Recurring References (Asset Backlog)

| Reference Name | Kind | Target Video Count | Notes |
|---|---|---|---|
| Club Penguin | brand/character | 10 | Strongest recurring visual motif; high-priority low-poly penguin rig. |
| Leopold Aschenbrenner | person | 3 | Financial/tech-doomer figure; captured on the orange-grade slide video. |
| Pleometric | brand/meme | 2 | Creator persona / brand mascot. |
| Kevin Kelly | person | 2 | Interview-clip talking head in AI-race discussion. |
| Amtrak | brand | 2 | Spurious background brand in the Kevin Kelly clips. |

## Verdict on Tool Usefulness

**Recommended with caveats**. The visual pass is genuinely useful for surfacing non-textual references (e.g., Club Penguin, Subway Surfers gameplay, specific 3D avatars) that are invisible to transcripts, and it did so at zero cost through the subscription lane. However, the miss on Arthur's Sonic/Peach/Gigachad video shows that visual understanding can be derailed by transcript-adjacent text in the prompt or by abstract/surreal framing that does not match the model's training priors. For Pleometric work, video understanding is best used as a **second-pass enrichment** on top of tweet/transcript metadata, not as a replacement for it, especially for high-stakes known references that should be verified manually.

## Rerun Commands

```bash
# 1. Mint the Antigravity token (sensitive, never commit)
omp token google-antigravity

# 2. Run the catalog driver (reads manifest/transcripts, samples 8 frames, calls omp -p)
python3 /tmp/catalog_antigravity.py
```

Per-video JSON outputs are written to `data/provider-evals/video-understanding/runs/reference-catalog-antigravity/`.
