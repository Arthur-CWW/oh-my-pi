# Jimeng Value-Ranked Coverage Check

Date: 2026-06-11

## Command

```bash
bun packages/jimeng-client/src/browser-proxy-cli.ts triage-coverage \
  --decisions keep \
  --outDir data/jimeng-lab/triage-coverage-current
```

## Result

Latest normalized report:

- `data/jimeng-lab/triage-coverage-current/normalized/triage-coverage-20260611114223-summary.json`
- `data/jimeng-lab/triage-coverage-current/normalized/triage-coverage-20260611114223-summary.md`

Top value-ranked gaps:

1. `G1 /mweb/v1/aigc_draft/generate` - generation parity and artifact proof
2. `G1 /mweb/v1/execute_generate_audit` - generation material audit payload
3. `G2 /mweb/v1/mpack_image` - provider image/material packing
4. `V1 /mweb/v1/feed` - fresh built-in voice feed capture/replay
5. `V1 /mweb/v1/voice/query_task` - custom voice task lookup with real task id
6. `P1 /mweb/v1/dreamina_subject/generate_voice` - subject/persona voice generation

`R1 /mweb/v1/mget_story` is ranked as supporting metadata. It should not displace generation, persona/voice, lip-sync, reference-control, or template-mining work.

## Next Approval-Gated Step

The next highest-value proof should refresh a current frontend generation submit capture and compare it against the direct request builder before another paid live submit.

Planned capture/compare flow:

```bash
bun packages/jimeng-client/src/browser-proxy-cli.ts text2image-plan \
  --session data/jimeng-lab/raw/session-bundle-current.json \
  --prompt "韩系美妆UGC创作者在自然光卧室里展示补水精华，真实手机自拍视频感，无文字，无水印" \
  --modelVersion jimeng-5.0 \
  --resolution 2k \
  --ratio 9:16 \
  --sampleStrength 0.5 \
  --outDir data/jimeng-lab/value-ranked-text2image-plan

bun packages/jimeng-client/src/browser-proxy-cli.ts text2image-compare \
  --plan data/jimeng-lab/value-ranked-text2image-plan/raw/<plan>-dry-run-plan.json \
  --rawNetwork data/jimeng-captures/<fresh-generation-capture>/raw-network.jsonl \
  --outDir data/jimeng-lab/value-ranked-text2image-compare
```

Approval needed before creating the fresh frontend generation capture or running a live submit, because the flow may spend subscription credits or require background browser capture against the logged-in account.
