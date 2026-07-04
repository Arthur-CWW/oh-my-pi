# Agent scaling limits: review/merge is the bottleneck past ~10 sessions; then disk I/O

- Author: xjdr (@_xjdr)
- Dates: 2026-03-29 20:39 UTC and 2026-03-30 17:10 UTC
- URLs: https://x.com/_xjdr/status/2038355375486017634 , https://x.com/_xjdr/status/2038665211503374448
- Type: two standalone tweets (first quotes @vitrupo's Jeff Dean clip)
- Retrieved: 2026-07-04 via nitter.tiekoetter.com + api.fxtwitter.com
- Tags: scaling-troubles, agent-orchestration, review-bottleneck, disk-io, git-for-agents

---

Mar 29 (quoting Jeff Dean via @vitrupo: "we're going to have to re-engineer our tools because they were designed for human speed… Amdahl's law still applies"):

> this is probably the main thing i fight with when trying to scale agents beyond a maybe 10 unique simultaneous and parallel sessions. if you let them run, the complexity comes at review and merge time. if you review at each turn, you are the bottleneck

Mar 30:

> new ai agent scaling limit reached: random disk access and disk i/o which means at a certain point these agents need to run on multiple machines but also stay in sync like they are on a single machine.
> ... neat ...
