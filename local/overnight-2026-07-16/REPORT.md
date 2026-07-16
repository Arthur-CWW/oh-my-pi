# Morning report — primer overnight 2026-07-16

早上好. Eight lanes ran; everything gated (159 tests green) and committed. Full proof: `docs/qa/primer-overnight-2026-07-16.md`.

## Try in 5 minutes

1. **https://primer.localhost/#/read/53** — 庆余年 第一集, click a character mid-scene. (Also: docs 54 Xi 新年贺词 video force-aligned to the official transcript; 55–57 three more 图图 episodes.)
2. **https://primer.localhost/#/cards** — your Mochi-style deck table: 370 HSK5 cards laid out physically, hover to peek, Enter for detail, enroll approved ones.
3. **Review something and fail it** — press 1, then `d` (读不懂) or `s` (太慢): your failure taxonomy is live, observe-only.
4. **Ask in Chinese** — `我最近在读什么？` now finds evidence (segmentation fixed).

## Note: URLs changed overnight (fleet-wide, you approved via the other session)

`http://<name>.localhost:1355` → **`https://<name>.localhost`**. All primer docs/code migrated; services registered in `services.yml` (`mise run up primer` to run under the new supervisor — currently still on my nohup processes).

## Needs your taste (the actual gates, ~30 min total)

1. **Calibration sheet** — `READER/experiments/meltdown-machinic/runs/2026-07-11…/labels-arthur-TODO.md` (unlocks prompt-v1 + Meltdown import + annotation waves)
2. **Hanly pilot labels** — 10 rows in `streams/primer/experiments/hanly-zh/pilot-report.md` (unlocks batch zh etymology into the dictionary)
3. **UX forks** — `experiments/media-reader-ux/control-grammar.md` (5) + `experiments/scheduler-language-v2/design-brief.md` (5)
4. **庆余年 confirm** — watch 2 min of doc 53: is this the drama you remembered? (If it was really a 竖屏短剧, say so and I re-hunt.)
5. **HR-168 fleet fork** (warden-recorded): portless 1355-only (zero sudo) vs attended root 443 service

## Blocked / deferred with reasons

- **FireRedASR2S**: CUDA-only pins + 4.4GB weights vs disk — it's a GPU-box workload (your "use local gpu"); recipe + verdict in `research/firered-asr-trial.md`. faster-whisper worked as fallback (庆余年).
- **GPU box migration**: not attempted unattended (SSH + your no-sudo night rules); ready to dispatch when you're up.
- Stale portless routes `primer-qa2/3` left for cleanup.
