# Arcads Alternative Research Project

Goal: clean-room blueprint for building an Arcads.ai-style AI UGC / AI influencer / product-to-ad video system, but with a modular graph/layer architecture and fast prototype path using open models and commodity APIs.

## Key files

- `source-digest.md` — concise source and pipeline digest for GPT Pro / Pi handoff.
- `arcads-source-urls.txt` — source URL manifest.
- `sources/arcads/README.md` — downloaded Arcads website/help/review Markdown index.
- `sources/arcads/api-openapi-summary.md` — extracted Arcads external API model/endpoint summary.
- `sources/arcads/raw-api/openapi.json` — extracted Arcads public external OpenAPI spec.
- `sources/alex/README.md` — downloaded Alex Nguyen X articles from Firefox open tabs.
- `prompts/` — queued/queueable GPT Pro prompts.
- `gpt-pro-sessions.md` — ChatGPT session URLs/results tracking.

## Research lanes

1. Arcads product/stack teardown.
2. Feature-by-feature replication blueprint.
3. Model/API menu: fastest, best, open/local, cheap scalable.
4. Alex Nguyen UGC/content-farm pipeline synthesis.
5. Prototype architecture for this repo.

## Niche / template-mining handoff (`T-2026-06-09-022`)

This research project feeds Slotok with abstract UGC templates, not scraped source media.

Current allowed inputs:

- Local niche/product brief.
- Manual notes from already-open/public product docs, user-owned clips, rights-cleared exports, or previously archived source digests.
- Existing local Arcads/UGC research summaries in this directory.
- Existing Slotok `referenceArchives` and artifact-library manifests.

Current non-goals: live Arcads/TikTok/X/CapCut scraping, paywalled template extraction, provider generation, credential/cookie inspection, or using source pixels/audio/transcripts as generation inputs.

Normalized output target:

```json
{
  "researchTarget": {
    "schemaVersion": "ugc-studio.research-target.v1",
    "platform": "web",
    "niche": "AI UGC product proof ad",
    "query": "local Arcads/public-doc notes: actor slot, product demo slot, caption CTA"
  },
  "templateSpec": {
    "schemaVersion": "ugc-studio.clean-room-template.v1",
    "category": "format",
    "preservedMechanics": {
      "hookFamily": "problem/proof",
      "sceneBeats": ["persona opens problem", "product appears", "proof/demo", "CTA"],
      "captionLayout": "safe-area subtitles plus claim/proof card",
      "assetSlots": ["synthetic persona", "product visual", "demo/proof asset", "caption layer"],
      "ctaPattern": "try/save/click prompt"
    },
    "swapSlots": ["persona", "product", "hook copy", "proof asset", "CTA copy", "voice"],
    "blockedFields": ["source actor", "source voice", "exact script", "source media", "brand marks"],
    "proofNotes": ["Derived from local notes and public behavior only."]
  }
}
```

SQLite/storage handoff:

- Write `research-targets` and `template-mining-jobs` rows to `data/ugc-studio/workspaces/<workspace_id>/workspace.sqlite`.
- Promote reusable mechanics into `referenceArchives[].candidateFormatOutputs[].manifestJson` for artifact-library discovery.
- Link downstream candidates only through `templateMiningJobs[].candidateIds` after a local dry-run or explicit capped provider job.

First local proof command/path:

```bash
cd apps/slotok-workbench && /Users/arthur/.bun/bin/bun test src/daemon/ugc-sqlite-store.bun.test.ts -t "keeps per-collection SQLite rows in sync after JSON store mutations"
```

Inspect proof path `apps/slotok-workbench/src/daemon/ugc-sqlite-store.bun.test.ts`; after daemon-backed proof inspect `data/ugc-studio/workspaces/<workspace_id>/workspace.sqlite`, `objects.collection IN ('research-targets', 'template-mining-jobs')`.

## Hard constraints

- Clean-room only: public behavior/docs, no code theft or bypassing.
- Clone high-level format mechanics, not private identities or protected videos.
- Keep the architecture modular: scripts, hooks, personas, product assets, video generation, voice, lipsync, captions, B-roll, overlays, renders, analytics all separable.
- Avoid platform-evasion implementation. Treat account warmup/geotargeting material as risk context, not product functionality.
