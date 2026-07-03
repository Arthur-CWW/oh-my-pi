# RevEng

Case studies and unpacked extension sources live here. Keep extraction notes and source snapshots separate from reusable implementation code.

## Current cases

- `vidiq-vision/` - installed vidIQ Vision for YouTube extension snapshot imported from the local Chrome profile.

## vidIQ focus

The target UI behavior is YouTube augmentation: injected badges, thumbnail metrics, channel stat panels, and outlier/view velocity labels. Keep notes focused on DOM insertion points, message/API flow, and cacheable data payloads rather than copying proprietary implementation into reusable packages.

## Convention

- Put reusable TypeScript under `packages/`.
- Put reusable CLI or agent tooling under `tools/`.
- Put reveng workflow docs and scripts under `skills/chrome-extension-reveng/`.
- Keep copied extension source free of `.git`, browser profiles, build outputs, and local secrets.
