# Worker C: Template Mining Gap Review

Brief version: `2026-06-12.wave1.c`

Repo: `/Users/arthur/agents/web-access`

Mode: read-only. Do not edit files.

## Read First

- `docs/plans/jimeng-dreamina-cli-goal.md`
- `docs/plans/jimeng-fast-contract-extraction.md`
- `docs/provider/jimeng-api-triage.md`
- `TASKS.md`

## Task

Classify template-mining gaps and identify any implementable no-live-spend slice.

This is part of the `template-mining` packet. We care about hooks, captions, commercial templates, faceless formats, and reusable UGC profile patterns.

## Inspect

- `packages/jimeng-client/src/capcut-templates.ts`
- `packages/jimeng-client/test/capcut-templates.test.ts`
- `docs/provider/jimeng-api-triage.md`
- available proof references under `data/jimeng-lab/proof-20260610-capcut-*`

Endpoints:

- `/lv/v1/cc_web/replicate/get_search_words`
- `/lv/v1/cc_web/replicate/search_templates`
- `/lv/v1/cc_web/plane/batch_get_collection_templates`
- `/lv/v1/cc_web/plane/get_collection_presets`
- `/lv/v1/cc_web/plane/preset_template_detail`
- `/lv/v1/cc_web/plane/fuzzy_search_templates`

## Return

Write:

```txt
data/jimeng-lab/worker-results/template-mining-gap-review.md
```

Include:

- endpoint-by-endpoint status
- evidence path for each endpoint
- whether existing fixtures are enough
- exact files a later worker would own if implementable
- tests/fixtures/snapshots needed
- recommended passive capture command if capture is required
- any endpoints that should stay blocked or back burner
- agent id, model, brief version

Do not modify source files.
