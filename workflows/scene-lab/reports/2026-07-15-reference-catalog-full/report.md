---
title: "Full Corpus Visual Reference Catalog Report"
date: 2026-07-15
agent: "RefCatalog"
status: done
---

# Full Corpus Visual Reference Catalog

## Progress

- Manifest items discovered: 313.
- Unique tweet IDs after media-variant dedupe: 307.
- Prior catalog entries skipped: 30.
- Items covered in this run: 277.
- Failed: 0; skipped: 30.
- Cost: $0.00 expected/observed; Antigravity subscription lane only.

### Per-handle counts

| Handle | Discovered | Completed | Failed | Skipped |
|---|---:|---:|---:|---:|
| SkyeSharkie | 60 | 60 | 0 | 0 |
| abelian_soup | 51 | 51 | 0 | 0 |
| pleometric | 133 | 103 | 0 | 30 |
| poetengineer__ | 60 | 60 | 0 | 0 |
| voooooogel | 3 | 3 | 0 | 0 |

## Failures / skips

- SKIPPED `2041310438583877970-1` (pleometric): already present in prior catalog (tweet ID dedupe)
- SKIPPED `2041711217677320452-1` (pleometric): already present in prior catalog (tweet ID dedupe)
- SKIPPED `2044829644910641471-1` (pleometric): already present in prior catalog (tweet ID dedupe)
- SKIPPED `2045554597280813392-1` (pleometric): already present in prior catalog (tweet ID dedupe)
- SKIPPED `2046685420142932151-1` (pleometric): already present in prior catalog (tweet ID dedupe)
- SKIPPED `2047074844483731515-1` (pleometric): already present in prior catalog (tweet ID dedupe)
- SKIPPED `2049658654538785254-1` (pleometric): already present in prior catalog (tweet ID dedupe)
- SKIPPED `2049999955834568734-1` (pleometric): already present in prior catalog (tweet ID dedupe)
- SKIPPED `2050364782411202781-1` (pleometric): already present in prior catalog (tweet ID dedupe)
- SKIPPED `2050907411259490462-1` (pleometric): already present in prior catalog (tweet ID dedupe)
- SKIPPED `2052979237678653532-1` (pleometric): already present in prior catalog (tweet ID dedupe)
- SKIPPED `2054594912717312476-1` (pleometric): already present in prior catalog (tweet ID dedupe)
- SKIPPED `2055420576714408309-1` (pleometric): already present in prior catalog (tweet ID dedupe)
- SKIPPED `2055621213431468424-1` (pleometric): already present in prior catalog (tweet ID dedupe)
- SKIPPED `2056378137831682359-1` (pleometric): already present in prior catalog (tweet ID dedupe)
- SKIPPED `2057289057483346095-1` (pleometric): already present in prior catalog (tweet ID dedupe)
- SKIPPED `2063699116991869299-1` (pleometric): already present in prior catalog (tweet ID dedupe)
- SKIPPED `2064045757515063502-1` (pleometric): already present in prior catalog (tweet ID dedupe)
- SKIPPED `2067252216130376109-1` (pleometric): already present in prior catalog (tweet ID dedupe)
- SKIPPED `2067386489403503090-1` (pleometric): already present in prior catalog (tweet ID dedupe)
- SKIPPED `2067431750951690447-1` (pleometric): already present in prior catalog (tweet ID dedupe)
- SKIPPED `2067433262159409208-1` (pleometric): already present in prior catalog (tweet ID dedupe)
- SKIPPED `2067662803721220310-1` (pleometric): already present in prior catalog (tweet ID dedupe)
- SKIPPED `2067714664348229948-1` (pleometric): already present in prior catalog (tweet ID dedupe)
- SKIPPED `2067715247679402255-1` (pleometric): already present in prior catalog (tweet ID dedupe)
- SKIPPED `2068025479026593909-1` (pleometric): already present in prior catalog (tweet ID dedupe)
- SKIPPED `2069782589171261567-1` (pleometric): already present in prior catalog (tweet ID dedupe)
- SKIPPED `2070631349778579630-1` (pleometric): already present in prior catalog (tweet ID dedupe)
- SKIPPED `2071047326869664178-1` (pleometric): already present in prior catalog (tweet ID dedupe)
- SKIPPED `2071346891367792806-1` (pleometric): already present in prior catalog (tweet ID dedupe)

## Exact resume command

```bash
python3 workflows/scene-lab/reference_catalog_full.py
```

## Artifacts

- `progress.json` tracks completed tweet/video IDs and failures.
- `results/` contains the raw and parsed per-video provider envelopes.
- Catalog rows are appended immediately after each successful pass.
