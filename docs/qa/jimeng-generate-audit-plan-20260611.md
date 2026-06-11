# Jimeng Generate Audit Plan - 2026-06-11

Purpose: promote the high-value G1 `/mweb/v1/execute_generate_audit` gap from opaque blocker to a dry-run, compare-ready request plan for generation material pre-audit.

Frontend evidence:

- Static trace: `data/jimeng-lab/proof-20260611-static-locate-media-helper-blockers/`
- The frontend `executeAudit` call posts `/mweb/v1/execute_generate_audit` with a `materialList` transformed by material type:
  - image: `materialType`, `uri`, optional `itemId`
  - video: `materialType`, `vid` from input `uri`, optional `itemId`
  - audio: `materialType`, `vid` from input `uri`, optional `itemId`
  - subject: `materialType`, `subjectDataId`
- The request is snake-cased before network submit, so the CLI dry-run body uses `material_list`, `material_type`, `item_id`, and `subject_data_id`.

CLI dry-run proof:

```bash
/Users/arthur/.local/share/mise/shims/bun packages/jimeng-client/src/browser-proxy-cli.ts generate-audit-plan \
  --materials '[{"type":"image","uri":"tos-cn-i-tb4s082cfz/persona.png","itemId":"image-item-1"},{"type":"video","uri":"v03870g10004d8k1u4nog65hb08dnhig","itemId":"video-item-1"},{"type":"audio","uri":"v0audio123"},{"type":"subject","subjectDataId":"subject-data-1"}]' \
  --body '{"audit_scene":"ImageGenerate"}' \
  --outDir data/jimeng-lab/proof-20260611-generate-audit-plan
```

Output:

- `data/jimeng-lab/proof-20260611-generate-audit-plan/raw/generate-audit-plan-20260611120753-dry-run-plan.json`
- `data/jimeng-lab/proof-20260611-generate-audit-plan/normalized/generate-audit-plan-20260611120753-summary.json`

Normalized summary:

- endpoint: `/mweb/v1/execute_generate_audit`
- request keys: `audit_scene`, `material_list`
- material counts: image `1`, video `1`, audio `1`, subject `1`
- live submit: `false`

Verification:

```bash
cd packages/jimeng-client
/Users/arthur/.local/share/mise/shims/bun run typecheck
/Users/arthur/.local/share/mise/shims/bun run test
/Users/arthur/.local/share/mise/shims/bun run test:vitest
```

Latest result:

- `typecheck`: pass
- `bun test ./test`: 254 pass
- `vitest run test-vitest`: 2 files / 3 tests pass

Next gate:

- Passively capture a frontend generation submit that includes `/mweb/v1/execute_generate_audit`.
- Compare the dry-run plan with:

```bash
jimeng-browser-proxy request-plan-compare \
  --plan data/jimeng-lab/proof-20260611-generate-audit-plan/raw/generate-audit-plan-20260611120753-dry-run-plan.json \
  --rawNetwork data/jimeng-captures/<fresh-generation-capture>/raw-network.jsonl \
  --outDir data/jimeng-lab/proof-<date>-generate-audit-compare
```

Live replay remains blocked until that passive capture compare passes. If the capture requires triggering generation, ask for explicit approval because it may spend credits.
