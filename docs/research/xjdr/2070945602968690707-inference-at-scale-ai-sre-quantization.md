# Inference at scale week: AI system runs ops, models promoted to SRE roles, fp8/NVFP4 findings

- Author: xjdr (@_xjdr)
- Date: 2026-06-27 19:01–19:10 UTC
- URLs: https://x.com/_xjdr/status/2070945602968690707 , https://x.com/_xjdr/status/2070946038287122537 , https://x.com/_xjdr/status/2070947967574663249
- Type: three tweets posted in sequence (stitched)
- Retrieved: 2026-07-04 via nitter.tiekoetter.com + api.fxtwitter.com
- Tags: scaling-troubles, infra, ai-ops, ai-sre, quantization, scm

---

19:01 UTC:

> on top of building the SCM features you are about to see (more on this soon), this week has been focused on building out the AI system to run, operate and automate our public facing inference system. we are now serving tens of thousands of users, thousands of simultaneous user sessions, and millions of tokens a second from our cluster.
>
> if there is sufficient interest in 'how to run a production grade inference system at scale', i will write something up but its just as much about the custom serving layer (bespoke, rust based, grpc, etc) as it is the engine itself (the engine is less important than you would think) .
>
> optimizing disagg, balancing prefill vs decode node, efficient kv caching and transfer over the pool, per token tracing to find bugs, layers of security features and profiles to restrict abusive users while not having heavy handed rate limits .
>
> its been a wild ass week

19:03 UTC (quote of the above):

> as an announcement, principal sre gpt 5.5 has been promoted to sr tech lead and sr staff sre glm 5.2 has been promoted to principal sre and has taken over day to day operations of all of our inference systems (and soon all of our scm / vcs clusters as well)

19:10 UTC:

> we've been running GLM 5.2 in bf16 and in fp8 (experts and kvcache only, attention is always bf16) and have recorded virtually 0 measurable quality difference in our A/B tests and audits (very surprisingly)
> NVFP4 has shown a slight performance regression but could probably be fixed with proper L/DoRA and might also totally be worth it given your hardware and serving constraints. of note, i have not had enough hours or tokens with NVFP4 GLM 5.2 to make any definitive determinations as to overall quality / perf (yet) (this is the nvidia checkpoint i am referring to)
