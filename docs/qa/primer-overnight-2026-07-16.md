# Proof — Overnight batch 2026-07-16 (unsupervised)

Eight parallel lanes while Arthur slept. Gate: `bun run check` → **159 tests / 576 expects, 0 fail**. All surfaces on the new `https://<name>.localhost` scheme.

## Media shelf (docs 53–57 + existing 42)

| Doc | Title | Alignment |
|---|---|---|
| 53 | 庆余年 S1E1 · 第一集 | 525 sentences / 44.8 min, faster-whisper-large-v3 (no native zh subs on the official upload — verified), 3 spot-checks independently recovered |
| 54 | 习近平·2025新年贺词 · 官方视频 | 45 sentences, **known-transcript Qwen forced alignment** (highest-quality path — official transcript doc 19 as text source) |
| 55–57 | 大耳朵图图 S2E13/14/16 | 224/209/195 sentences, 100% coverage, explicit charTiming, full provenance |

Batch details + timings: `streams/primer/research/video-pipeline-pilot.md` §Overnight batch.

## FireRedASR2S verdict (`research/firered-asr-trial.md`)

**Blocked on Apple Silicon before inference**: official pins are CUDA-only (`torch==2.1.0+cu118`, no arm64 wheel), `.cuda()` hardcoded, AED weights 4.41 GiB vs 2.9 GiB free disk at trial time, Linux-only tested upstream. Verdict: FireRedASR2S is a **GPU-box workload** (fits Arthur's "use local gpu" directive); faster-whisper-large-v3 is the working Mac fallback (used for 庆余年). Report includes install recipe, timestamp format, and the TensorRT benchmark for the box.

## Code shipped (all self-tested + union-gated)

1. **zh ask segmentation** — Chinese questions now produce terms (CEDICT greedy + bigram fallback + stopwords): `我最近在读什么？` → `最近/读` → real evidence hits (live-verified; was zero-hit short-circuit).
2. **Failure-reason capture (scheduler v2.2)** — `again` grade optionally tags why: `d` 读不懂 / `s` 太慢 / default 忘了, via non-blocking 2.5s overlay; append-only (`fail_reason` set on insert or one-shot annotate ≤60s, 409 on overwrite); X-ray tail shows reasons. Observe-only.
3. **Exposure logging (v2.3, observe-only)** — `exposure_events` append-only; reader logs queued-word exposures on sustained focus / media sentence completion; X-ray shows count; zero review-table writes (tested).
4. **`#/cards` Mochi-style deck overview** — 370 candidates as free-form card table (masonry, deterministic jitter, hover peek), status filters, detail popover with provenance, enroll-from-card (`POST /api/review/enroll`, 409 unapproved), j/k/Enter/Esc.
5. **Hanly → simple-zh pilot** — 50/50 HSK1-2 chars generated on the cheap lane (`hanly_zh` table, `primer hanly-zh generate|list`): 部件 meanings, ≤30-char 字源一句话 (source-derived only), 联想-marked mnemonics, confidence. **Calibration sheet with 10 blanks awaits Arthur**: `streams/primer/experiments/hanly-zh/pilot-report.md`.
6. **Portless 443 migration** — all living primer code/docs off `:1355` (dated proofs untouched); `services.yml` gains `primer-daemon` + `meltdown` per OPERATIONS.md (not started under supervisor — running instances left alone).

## Incidents (all resolved, logged honestly)

- Portless proxy died mid-night (worker pkill sweep) → sequence of restarts ended in the fleet-wide Arthur-approved 443 migration; all four primer surfaces re-verified 200.
- Two budget-cancelled workers (LiangSweep earlier, FailureReasonCapture) — both had already delivered; work verified in-tree, nothing lost.
- 庆余年 official upload has no native zh subs → ASR fallback (marked honestly in `asr` field).
- Warden flagged portless auto-elevation as the Touch-ID spammer — primer runs no portless loops; morning fork HR-168 is fleet-level.

## Rerun

```bash
cd packages/primer-daemon && bun run check
open https://primer.localhost/#/cards          # deck overview
open https://primer.localhost/#/read/53        # 庆余年 ep 1
bun src/cli.ts hanly-zh list | head
```
