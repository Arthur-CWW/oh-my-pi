# De-risking git/GitHub and Claude Code: the jj + sapling SCM and vertically integrated ncode stack

- Author: xjdr (@_xjdr)
- Date: 2026-06-18 13:12 UTC
- URL: https://x.com/_xjdr/status/2067596405162848386
- Type: long-form post (note tweet) + two author follow-ups same day
- Retrieved: 2026-07-04 via nitter.tiekoetter.com (full text) and api.fxtwitter.com (raw JSON)
- Stats at capture: 987 likes, 144,780 views
- Tags: jj, sapling, scm, git-for-agents, harness, vertical-integration, ncode, noumena

---

I've spent a lot of hours using AI for work. In fact, i'd wager i have as many hours and tokens logged as _anyone_ using AI in a professional capacity where the outcome was critical to doing my job or achieving a specific business objective. Over the last year or so, it became very clear that there were 2 major systematic risks to the way i had grown reliant on working:

1) git and github - git is poorly suited to ai work. when you spin up multiple agents at the same time, branches and worktrees become stale, after dozens of changes and PRs, reviews diverge causing constant conflicts, repos become large and unwieldy and adrift in drity state. On top of that, cloning giant repos and setting up dev envs every time i wanted to spin up an agent became cumbersome. sure you can use docker to help but its still stale and required packaging and cloning step(s). neither git or github was designed for my new ai centric, dozens to hundreds of agents working on large repos / monorepos simultaneously, workflows. managing state and envs and conflicts and iops became a full time job.

2) claude code and anthropic - i had grown reliant on a model and a powerful harness and on that model being trained to be an expert in that harness. I needed to be able to fine tune a model for my use cases but also have it be a master of the tools and flows of a specific harness. vertically integrating and fine tuning the model on the harness and tasks you want to accomplish is one of the most important aspects to actually being productive with these systems.

When i took a step back to figure out how to aggressively de-risk but also how to actually be productive as a single dev managing tons of semi-supervised AI, i figured i needed to go back to the beginning.

Lets try to take an example from Google who has similar issues with scale and tooling and setup (albeit with human developers at least when i was there) . If you wanted to build a system that was based on their best practices to manage all those moving parts and thousands of developers working in large monorepos, how would you do it? It wouldn't just be a simple git forge, git itself is a huge part of the problem. if you were starting from scratch, you'd want to make sure you designed the system from the ground up for ai agents and workflows for the new world.

Well to start, you'd make shallow virtual checkouts and clones so you never had to pull the full repo to disk and your clones would be instant. then you'd use jj to keep track of your draft state with a real jj native persistence layer and backend. You'd use sapling to create commit stacks and you'd keep all of your workspaces automatically in sync with a cloud sync system. You'd optimize this system from the ground up to make ai agents and reviewers first class citizens , you'd reduce startup time to seconds and you'd have per file ACLs so you never had agents run wild.

And if you were going to do all of that, you'd also want to vertically integrate EVERYTHING from the model to coding harness to scm to tools to remote cloud runtimes and platforms to optimize end to end for this new world and its new workflows.

So thats what i built and i've been using it exclusively to build and run our research lab and company for the last 6 months or so. This was not only a great way to pressure test the models, tools and the workflows but it was also an interesting research project on its own. Could a single developer use AI to be productive enough to launch a real, high quality product that would normally take a team of hundreds of engineers to build, launch and operate? I suppose you will have to be the judge of how successful it ultimately was but the project as of today is ~25 million lines of code and dozens of services and automation. in my opinion it has been an overwhelming success and i cant imagine going back to working any other way.

So, today I am starting the process of making the same tools i have been using internally for the last 6 months available to all of you. this will start with the code app that i released a few days ago and access to our inference engine to power that app. soon we will announce more tools and features including access to the ncode scm and ncode platform. there will be more formal announcements about these new platforms, tools and features over the coming days / weeks as we begin rolling out access. I hope y'all find them as useful as i have.

code.noumena.com

---

## Follow-up reply (same day, 14:28 UTC) — https://x.com/_xjdr/status/2067615356735406215

> Yes, I'm going to do some write ups and videos as I release the core scm tools and we open up access to the platform

## Quote-tweet clarification (same day, 23:17 UTC) — https://x.com/_xjdr/status/2067748582397263959

> Just to clarify after a few questions from people, we are releasing the code cli and the inference platform today, in the next few weeks we will release the scm / vcs (github alternative) and following that we will release the remote sessions, cloud sync, etc features
