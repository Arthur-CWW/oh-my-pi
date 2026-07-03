# Video understanding provider benchmark

Goal: compare cost/reliability/quality for tagging and reveng many shortform videos.

## Current default stance

Use API-based batch evaluation, not Gemini subscription UI automation, for large video-tagging runs.

Why:

- API calls give request IDs, token usage, retry/error handling, cache keys, and reproducible JSON outputs.
- Gemini app subscriptions have compute-based limits that refresh over time and may change; they are useful for manual spot checks but awkward for a large automated corpus.
- Kie.ai is cheaper/convenient as a gateway, but its public docs do not clearly guarantee Gemini context caching. Treat Kie as cheap routing plus logs, not as cache infrastructure.

## Keys

Do not paste keys into chat. Put them in the shell environment or a local untracked env file:

```bash
export GOOGLE_API_KEY='...'
export KIE_API_KEY='...'
```

Optional model overrides:

```bash
export GOOGLE_GEMINI_MODEL='gemini-2.5-flash'
export KIE_GEMINI_MODEL='gemini-2.5-flash'
# Kie pricing rows imply 1 credit ~= $0.005. Override if dashboard says otherwise.
export KIE_CREDIT_USD='0.005'
```

## Dry run

No provider calls, no spend:

```bash
bun scripts/eval-video-understanding.ts \
  --videos data/tiktok-catalogue/pleometric \
  --limit 3 \
  --max-frames 6 \
  --providers google,kie
```

## Live benchmark

Start tiny:

```bash
bun scripts/eval-video-understanding.ts \
  --videos data/tiktok-catalogue/pleometric \
  --limit 5 \
  --max-frames 6 \
  --frame-every 3 \
  --providers google,kie \
  --live
```

Outputs go under `data/provider-evals/video-understanding/runs/<timestamp>/` by default, with a shared cache/SQLite DB under `data/provider-evals/video-understanding/`:

- `summary.json` — provider-level counts, latency, billed estimated cost, and avoided cache-hit cost.
- `results.json` — per-video provider result paths and usage.
- `provider-run-log.jsonl` — append-only log of cache misses, hits, completions, and failures.
- `artifacts/*/frame_*.jpg` — sampled keyframes.
- `cache/<provider>/<requestHash>.json` — raw provider response cache.
- `cache/<provider>/<requestHash>.parsed.json` — parsed analysis object when possible.
- `evals.sqlite` — durable SQLite metrics (`eval_runs`, `eval_results`) for provider/model/status/cache/token/latency/cost comparisons.

Useful SQLite queries:

```bash
sqlite3 -header -column data/provider-evals/video-understanding/evals.sqlite \
  "select provider, model, status, cache_status, prompt_tokens, completion_tokens, total_tokens, latency_ms, estimated_cost_usd, avoided_cost_usd, raw_credits_consumed, finish_reason, parsed_ok from eval_results order by created_at desc limit 20;"
```

## Cost notes

Direct Google API has explicit token pricing and context caching. Relevant examples from official Google pricing checked 2026-06-08:

| Model | Input | Output | Cached input |
|---|---:|---:|---:|
| Gemini 2.5 Flash-Lite | $0.10 / 1M | $0.40 / 1M | $0.01 / 1M |
| Gemini 2.5 Flash | $0.30 / 1M | $2.50 / 1M | $0.03 / 1M |
| Gemini 2.5 Pro | $1.25 / 1M <=200k | $10 / 1M <=200k | ~$0.125 / 1M |
| Gemini 3.5 Flash | $1.50 / 1M | $9 / 1M | $0.15 / 1M |

Kie pricing checked 2026-06-08:

- Kie docs show logs/task details and retention, and pricing examples.
- Kie pricing explicitly describes Anthropic prompt caching, but not a clear Gemini context-cache API/guarantee.
- Kie Gemini 3.5 Flash pricing page row: input $0.45 / 1M, output $2.70 / 1M.
- For Kie live runs, prefer the actual `credits_consumed` field and dashboard logs over estimates.

## First live smoke result

2026-06-08 tiny run over one Pleometric video with 2 sampled frames, `max_output_tokens=4096`:

| Provider | Model | Status | Latency | Tokens / credits | Est. cost | Parse quality |
|---|---|---:|---:|---:|---:|---|
| Google direct | `gemini-2.5-flash` | completed | ~24s | 2,978 prompt / 2,144 completion / 1,938 thoughts | ~$0.0063 | hit `MAX_TOKENS`; JSON truncated |
| Kie | `gemini-2.5-flash` | completed | ~9.9s | 4,640 prompt / 1,863 completion / 0.36 credits | ~$0.0018 | usable JSON |
| Shared local cache re-run | both | cache hit | 0 provider latency | no new provider call | $0 billed, avoided cost recorded | cache hit preserved prior parse status |

Earlier malformed Kie request used an empty JSON schema and no max-token cap; it returned `{ ...huge whitespace... }`, consumed 7.84 credits (~$0.0392 if $0.005/credit), and is a good example of why we log malformed completions and parsed quality.

## Important caveat

The benchmark script uses local keyframe extraction as the common denominator. That is intentionally robust for cheap tagging, but it is not the same as a full-video temporal understanding call. If keyframe-only misses timing/audio details, add a second benchmark lane for:

- direct Google full-video upload / Files API,
- Kie video URL input if we have a safe public file URL,
- transcript/audio-derived features from local Whisper.
