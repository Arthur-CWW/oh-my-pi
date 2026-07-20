---
description: "AWAY-BRIEF: resituate me in this thread — what needs me, what happened while I was away, how long I was gone"
---

I've been away from this thread. Produce the AWAY-BRIEF per `skill://thread-brief` — FORMAT the pre-computed substrate below and do not dump or fully re-excavate journals. (If the blocks below still show literal `$NAMES`, this binary predates HR-195: fall back to the skill's manual excavation steps.)

## Session
$SESSION_META

## Away packet (exact clock + deltas since my last input — computed by the harness)
$AWAY_PACKET

## Fleet (compact, live peers only)
$FLEET_COMPACT

Format the fixed section order from the skill: header with the away clock → **1. Decision queue** (ranked, act-without-reading-further) → **2. Review surfaces & artifacts** (complete inventory) → **3. Delta while away** (outcomes only, from the packet) → **4. Current state** → **5. Cross-thread context** (from the fleet block; name overlapping sessions only) → **6. Depth pointers**. Empty sections say `— none`. Keep under 40 lines for a day away and under 15 for hours when possible, but completeness of the artifact inventory wins over that target.

Use the substrate first. When the review section needs facts not present in it, use exact targeted reads/checks named by the away packet or journal pointers. If the packet lacks any pointers needed to complete the inventory — artifact paths/URLs, proof outputs or indexes, service/UI references, or relevant error-log pointers — perform one bounded scan of this session's journal, limited to the away-window and only to locate the missing pointer types; this is a pointer lookup, not a journal dump or full re-excavation. Then read only the exact referenced paths/URLs: relevant reports/docs/data/manifests/screenshots/video/log paths, `services.yml` rows for registered services, and registered app error-log paths/state. Run a fresh `bun scripts/streams.ts status <stream>` for each relevant stream. For each registered service/site, keep human review URL separate from health endpoint, record health result plus running/ownership, checked-at evidence, app error-log state when applicable, and when down give the exact `cwd` + `cmd` from `services.yml`; never infer health from a URL or stale prose…

$ARGUMENTS
