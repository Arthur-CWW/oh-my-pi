# @wirebabel/ugc-cli

Local-first open CLI for Arcads/Higgsfield-style AI UGC workflow planning.

This first cut is deliberately credit-safe: it creates JSON recipes, jobs,
manifests, timelines, prompt cards, caption sidecars, and review reports without
submitting paid generation jobs.

## Examples

```bash
bun packages/ugc-cli/src/cli.ts supercomputer modes
bun packages/ugc-cli/src/cli.ts model list

bun packages/ugc-cli/src/cli.ts arcads ugc-pack \
  --product-name "Demo App" \
  --product-url "https://example.com" \
  --product-description "A lightweight planning app for overloaded founders" \
  --variants 3 \
  --wait

bun packages/ugc-cli/src/cli.ts marketing-studio campaign \
  --product-name "Demo App" \
  --brief "Make app-install ads for indie founders" \
  --formats ugc_tutorial,show_app_creator,product_review \
  --variants 4 \
  --json
```

Machine-readable serialization is JSON only. Human-facing helper artifacts such
as `storyboard.md` and `captions.srt` are generated beside the JSON manifest.
