# GitHub outage day: "we made our own SCM" — hundreds of agents break GitHub, "jj with a real backend"

- Author: xjdr (@_xjdr)
- Date: 2026-04-25 (12:40 / 15:37 / 16:15 UTC)
- URLs: https://x.com/_xjdr/status/2048019341480988678 , https://x.com/_xjdr/status/2048063844040479073 , https://x.com/_xjdr/status/2048073361839054932
- Type: three tweets in one conversation cluster (stitched)
- Retrieved: 2026-07-04 via nitter.tiekoetter.com + api.fxtwitter.com
- Tags: scm, git-for-agents, github-scaling, jj, monorepo

---

12:40 UTC:

> we haven't been using github for a while because it doesn't actually scale all that well with even hundreds of agents committing to the same repo at once but i always assumed we'd have a compat layer. i cant see going back to github for the foreseeable future after this

15:37 UTC (answering "What do you use instead?", with screenshot https://pbs.twimg.com/media/HGwuv5Ka4AA1i01.jpg):

> a few people asked the same question; we made our own SCM based on how Google and Meta do it internally to scale to thousands of agents operating in parallel in our monorepo

16:15 UTC (reply to @stochasticchasm @ludwigABAP):

> lol, no this one was actually with external collaborators cause we had to figure out the joint github collab dance which ended with "what i really want is just jj with a real backend"
