---
description: "AWAY-BRIEF: resituate me in this thread — what needs me, what happened while I was away, how long I was gone"
---

I've been away from this thread. Produce the AWAY-BRIEF per `skill://thread-brief` — FORMAT the pre-computed substrate below; do not re-excavate journals or dump fleet JSON. (If the blocks below still show literal `$NAMES`, this binary predates HR-195: fall back to the skill's manual excavation steps.)

## Session
$SESSION_META

## Away packet (exact clock + deltas since my last input — computed by the harness)
$AWAY_PACKET

## Fleet (compact, live peers only)
$FLEET_COMPACT

Format per the skill: header with the away clock → Decision queue (ranked, act-without-reading-further) → Delta while away (outcomes only, from the packet) → Current state → Cross-thread context (from the fleet block; name overlapping sessions only) → Depth pointers. Under 40 lines for a day away, under 15 for hours; empty sections "— none". Only if a decision-relevant gap remains, read the exact `history://` or file the packet points at.

$ARGUMENTS
