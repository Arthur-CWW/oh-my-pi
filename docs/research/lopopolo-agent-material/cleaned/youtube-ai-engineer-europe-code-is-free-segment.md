---
title: "AIE Europe Keynotes & OpenClaw ft Deepmind, OpenAI, Vercel, @pragmaticengineer , @mattpocockuk"
source: "https://www.youtube.com/watch?v=O_IMsEg91g8"
canonical_url: "https://www.youtube.com/watch?v=O_IMsEg91g8"
video_id: "O_IMsEg91g8"
source_type: "youtube_transcript"
event_type: "conference_livestream_segment"
transcript_scope: "segment"
speakers:
  - "Ryan Lopopolo"
direct_source: true
third_party_summary: false
retrieved: "2026-06-07"
published: "2026-04-09"
upload_date: "20260409"
channel: "AI Engineer"
uploader: "AI Engineer"
duration: "9:11:00"
duration_seconds: 33060
captions_source: "auto"
captions: "auto-generated English captions via yt-dlp"
selection_notes: "Direct AI Engineer Europe livestream chapter with Ryan; transcript is clipped to Ryan chapter to avoid unrelated speakers."
segment:
  label: "Ryan Lopopolo (OpenAI): \"Code is free\", systems thinking and delegation for parallel AI coding agents"
  start: "01:07:08"
  start_seconds: 4028
  end: "01:25:48"
  end_seconds: 5148
---

# AIE Europe Keynotes & OpenClaw ft Deepmind, OpenAI, Vercel, @pragmaticengineer , @mattpocockuk

## Description

Timestamps
00:13:10 - Opening remarks by Phil Hawksworth
00:21:26 - Lia McBride (AI Engineer): AIE community's 900% growth and UK gov's AI infrastructure investment.
00:24:25 - Malte Ubl (Vercel): AI agents as the new application layer, custom automation now economically viable, APIs must be AI first.
00:42:39 - Raia Hadsell (Google DeepMind): DeepMind beyond language: Gemini Embeddings 2, AI cyclone prediction, and Project Genie 3.
01:07:08 - Ryan Lopopolo (OpenAI): "Code is free", systems thinking and delegation for parallel AI coding agents.
01:25:48 - Peter Steinberger (OpenAI): "State of the Claw": OpenClaw's explosive growth and AI generated security bounty overload.
01:45:12 - Break: Morning coffee

02:28:13 - swyx with Peter Steinberger (OpenAI): OpenAI on open source, "token maxing," and "taste" as the ultimate engineering moat.
02:55:01 - Vincent Koc (Comet ML): "Dark factories": 60+ parallel AI agents on overnight codebase refactoring.
03:14:07 - Radek Sienkiewicz (VelvetShark): Handing personal life to OpenClaw via Obsidian, email, and background tasks.
03:34:12 - Sally Ann O'Malley (Red Hat): Secure agent deployment with Podman, Docker, and K8s, isolation and state recovery.
03:57:05 - Nick Taylor (Pomerium): Hardening OpenClaw with Pomerium's identity aware proxy and live coding an MCP server from Discord.
04:14:35 - Break: Lunch

05:41:51 - Onur Solmaz (OpenClaw): ACP for standardized agent-to-client interactions and disposable enterprise agents on K8s.
06:02:17 - Merve Noyan (Hugging Face): HF ecosystem for local coding agents and model training via Hub skills.
06:22:36 - Fryderyk Wiatrowski (Viktor): "Viktor", Slack native AI employee with context across thousands of integrated tools.
06:42:09 - Break: Afternoon

07:42:39 - Gergely Orosz (The Pragmatic Engineer) with swyx: "Token Maxing", big tech engineers wasting AI inference to inflate productivity metrics.
08:09:26 - Kitze (Sizzy): Modern productivity apps roasted, and an OS where AI generates UI on demand.
08:29:42 - Matt Pocock (AI Hero): Why DDD and TDD matter more than ever against AI generated "slop."
08:48:31 - Sunil Pai (Cloudflare): "Code Mode", LLMs executing JavaScript in V8 isolates, bypassing slow JSON tool calls.
09:07:04 - Closing remarks by Phil Hawksworth

April 9, 2026 - all times in GMT+1 (UK Time)

EVENT OPENER
8:54am - Stream beings 
9:00am - Event Opener - opening video, MC, AIE welcome from Lia McBride, General Manager
AIE Welcome | AIE team, AI Engineer

OPENING KEYNOTES
* 9:10am - Keynote
Malte Ubl | CTO, Vercel
* 9:30am - Keynote
Raia Hadsell | VP of Research, Google DeepMind
* 9:50am - Harness Engineering: How to Build Software When Humans Steer and Agents Execute
Ryan Lopopolo | Member of Technical Staff, OpenAI
* 10:10am - OpenClaw update
Peter Steinberger | OpenClaw, OpenAI

OPENCLAW/PERSONAL AGENTS BREAKOUT 1

* 11:15am - OpenClaw AMA
Peter Steinberger | OpenClaw, OpenAI
Gergely Orosz | Moderator, The Pragmatic Engineer
* 11:40am - Breakout talk
Vincent Koc | AI Research Engineer, Evals, DevRel, Comet ML - OpenClaw
* 12:00pm - I Gave an AI Agent the Keys to My Life (Here's What Happened)
Radek Sienkiewicz | Developer Relations, LayerZero
* 12:20pm - Proving Agents Correct: Memory Architecture and Formal Verification for Clawdbot
Sally OMalley | Principal Software Engineer, Red Hat
* 12:40pm - Breakout talk
Nick Taylor | Developer Advocate, Pomerium

OPENCLAW/PERSONAL AGENTS BREAKOUT 2
Igor Karpovich | Senior Principal Engineer, Skyscanner
* 2:30pm - Scaling Agents on Kubernetes with acpx and ACP
Onur Solmaz | OpenClaw Maintainer, OpenClaw
* 2:50pm - What's new in AI Audio?
Thor Schaeff | Developer Relations Engineer, Google DeepMind
* 3:10pm - Viktor — AI Coworker That Lives in Slack
Fryderyk Wiatrowski | CEO, Viktor

CLOSING  KEYNOTES
* 4:30pm - Software Engineering + AI = ?
Gergely Orosz | Author, The Pragmatic Engineer
swyx | Founder, AI Engineer
* 5:00pm - Keynote
Kitze | AIE Top Speaker, Sizzy.co
* 5:20pm - It Ain't Broke: Why Software Fundamentals Matter More Than Ever
Matt Pocock | AI Hero, Total TypeScript
* 5:40pm - Keynote
Sunil Pai | Principal Systems Engineer, Cloudflare```

## Transcript

**Segment:** Ryan Lopopolo (OpenAI): "Code is free", systems thinking and delegation for parallel AI coding agents (01:07:08-01:25:48)

[01:07:45] And uh today I'm going to talk to you a little bit about what it means to lean into that and operationalize the way you work, the code spaces you live in, and the processes on your teams in order to get the agents to do the full job. I believe I'm preaching to the choir here when I say that the way we build software has changed. In the last six months, we have seen coding agents take over the world and capability has continually advanced at a super fast pace to have these models and the harnesses within which they live take more complex actions, do more complicated work with higher reliability over longer time horizons. And the place we've gotten to here is that implementation is no longer the scarce resource of what it means to do the job of software engineering. Code is free.

[01:08:36] We have an abundance of code to solve the problems that we come across in our day-to-day as we run our teams, build software, and solve user problems. Hiring the hands on the keyboards as part of our teams is only constrained by GPU capacity and token budgets. And each engineer today in this room has access to five, 50 or 5,000 engineers worth of capacity 247 every day of the year. The only thing that needs to happen, our roles is to figure out how to productively deploy these resources into our code and into our teams to make use of this new capacity.

[01:09:19] And in this world, skill sets are shifting more towards systems thinking, system design, and delegation in order to make use of this abundant capacity to produce code to solve problems. And there are three reasons that this happened, all of which happened in late 2025. For me, the magic moment was GPT 5.2, which when it came out was able to do the full job of a software engineer. The models at this point are good enough where they're isomeorphic to you and I in terms of the ability to produce code at high quality that solve real user problems in real code bases.

[01:09:59] Code is free and I know this is maybe a scary thing to hear because code carries maintenance burden but it's free to produce, free to refactor and it is not a thing to get hung up on anymore. We think of code as burden because it it's a synchronous attention drain on the human engineers on our team. But the models are incredibly patient. They are infinitely parallel. So the ability to produce, maintain, refactor, and delete code is no longer a forcing function on figuring out how to allocate resources on your engineering teams.

[01:10:36] So sort of be AGI pill here is to believe that the models are capable of producing every line of code we could ever possibly need. Figuring out when to delete them, figuring out when to refactor them or make them more reliable. And it's your role as software engineers to figure out how to unblock your team of agents and humans driving those agents from being able to drive them over long horizon work to do the full job.

[01:11:04] The idea here is that every one of you is a staff engineer. You have as many team members as you can possibly drive concurrently and have tokens to support. And you need to look one day, one week, six months into the future to figure out what structures you need to put in place to productively harness this infinite capacity to produce code.

[01:11:30] The scarce resources in this world that we see today are three things. Human time, human and model attention and model context window. And in the world where human time and attention is scarce, the role is to think about where that time is going, figure out ways to productively automate it, and move that synchronous human time into higher leverage activities.

[01:12:00] In a world where human time is scarce and human time is required to produce code, we have a stack rank. Things are either P 0 or P2s. Those P3s will never get done. However, in a world where code is free and infinitely abundant, all those P3s get kicked off immediately, maybe 4x in parallel. We pick one that solves the problem and in it goes.

[01:12:26] I've had the privilege of building a ton of agents internally at OpenAI to improve the productivity of my co-workers. And when code is free, all these internal tools can have good localization and internationalization from day one. I can make tools that my colleagues in London, Dublin, Paris, Brussels, Zurich, and Munich are able to experience in their native languages without really having to trade against any of my other teams capacity in order to make highquality tools.

[01:13:00] We should be working with the assumption that the best parts of software engineering that we all know, live, and breathe are available in any product that we could ever build all the time. Humans no need no longer need to concern themselves with implementation. The important thing is not the code but the prompt and the guardrails that got you there. This is why leaving breadcrumbs, documentation, ADRs, persona oriented documentation around what a good job looks like. All the historical logs of tickets and code reviews. This is the process that got you and your teams to the code and products that you have today. And this is what is need needs to happen in order to get your agents there as well. Your job is to build systems, software and structures that enable your team to be successful. And to do that, we need to make them legible to those agents that are driving the implementation. That means structuring them in a way that's native to the agents. Writing them in a way that is respecting of scarce context, which is this other scarce resource here, and figuring out ways to make the tokens that are required to do the job easy to predict. That means making things the same as much as possible so we can limit the amount of attention the model needs to activate in order to do the job.

[01:14:19] Large scale refactoring in this world is free. So making things the same is something that you are all able to do. There's never going to be a migration that hangs open for six months now that you can't get the last parts of the codebase to do because you can just fire off 15 agents to drive that work to completion. This is what it means to have a migration, right? We can finish them now. Come on. That's good. That's good. Clap.

[01:14:47] There's sort of this like metaepistical question here about like what it means to do a good job. And doing a good job as a software engineer is hard. It requires us years of being in the industry to fully internalize what it means to write highquality maintainable reliable code that our teammates are able to build on top of that is going to acrue leverage to the codebase.

[01:15:12] To do a single patch well probably requires 500 little decisions along the way around the underspecified non-functional requirements that go into producing good code. The agents, the models during their training have seen trillions of lines of code that make every possible choice of those non-functional requirements that you could ever imagine. So, it's our job to specify those non-functional requirements to write them down in a way that the agents can see this is what it is to do a good acceptable job that's going to produce a merged patch. And if the agents aren't doing that, it's our job to figure out ways to refine and restrict their output such that the code they write is acceptable. You can just simply say do not produce slop. Don't accept slop. You won't get slop in your codebase. But to do that requires taking short-term velocity hits in order to back up or doubleclick into a task to figure out what it is the agents are struggling with in your environment.

[01:16:15] Put the guardrails in place so they stop making those mistakes and then figure out ways to step back and spend your time on higher leverage activities once you solve some of the blockers in the short term. When I think about empowering my team in this way, everyone is an expert in what it is they bring. I have a diverse full stack team that is experts in front-end architecture, backend scalability, being product minded. And each one of those different personas fleshes out the skill set of my team by bringing a different understanding, a different set of solves for those non-functional requirements.

[01:16:53] Getting teammates to write those down actually means that every engineer driving agents gets the best of every single person on my team. I don't need to block on low signal code review in order to learn what it means to write a good QA plan. To have one engineer on my team document that in a durable way means every agent trajectory is going to get a good QA plan. And we can do this once in a high lever way that we're able to stack on top of.

[01:17:24] So how can we get the agents to do a good job? What are some of the tools and techniques we have in order to essentially prompt inject our agents and continually remind them of what it means to make those specific choices that we expect around those non-functional requirements. And there's a bunch of ways we can do this. We can write good agents.mmd files. However, with autocompaction, which is a thing that has continued to improve, GPT 5.4 and CEX is fantastic at autoco compaction, I essentially never have to write slashnew anymore. I've got some pictures on my Twitter of me strapping my laptop into the back of my car so I can continue do running inference while I'm commuting to and from work. And in this world, you have to kind of build for that expectation that context will get paged out over time. We need to be continually refreshing context as the agent goes about doing a task. And the ways we can do that are by having reviewer agents look at the code along the way through the lens of what it means to be successful. Right? We have security and reliability review agents in our codebase that are continually running as part of every push and CI that look at those documentations and the proposed patch and do simple things like say, are there timeouts and retries on this bit of network code? Has the code that has been introduced have a secure interface that is impossible to misuse?

[01:18:52] I'm sure everyone here has been paged at some point for network code that failed in production causing an outage that could have been remediated by a retry and a timeout. And I know I'm guilty of putting that retry and timeout in merging the bug fix and otherwise ignoring that. I am not a reliable reviewer or author of code with respect to this non-functional requirement.

[01:19:16] However, taking the time to write some docs, write a lint that is bespoke to my codebase that is going to look at every time I call fetch to make sure that there's a retry and a timeout wrapped around it means I've durably solved this problem and I'm able to do it because I lean on this axiom that code is free that the agents are able to do a good job that I can completely migrate the codebase to solve this problem durably once and for all. And in order to kind of operate in this way, we need to step back and look at the durable classes of failures that the agents and the humans in the codebase are making time after time. Figure out why we're spending time on it. Devise a solution to systematically eliminate this class of misbehavior and then continue to observe, refine, and make additional choices on those non-functional requirements.

[01:20:11] One really neat trick I use here is that you can write tests about the source code as well that are separate from lints. Right? If we know that context is limited, we can write a test that limits the fact that files are no longer than 350 lines. We're adapting our codebase to the harness to the models to do a little bit of engineering to be context efficient and squeeze more juice out of the model capability that we have today.

[01:20:41] The other things we can think about are providing good error messages that give actual remediation steps to the model and to humans for how to proceed next. It's not enough to say we've got a lint failure because we're awaiting in a loop or that we have an unknown at this deep part of the codebase and why is the model writing a function called is record. What we need to do is provide a prompt via a lint or a test failure that says no no no you shouldn't have an unknown here at all because we parse don't validate at the edge and you certainly have a type here which was derived from zot loadbearing infrastructure for our AI future prompt things I've talked about here today is a prompt you can do this without touching the model weights at all.

[01:21:39] Kind of a funny digression here is it seems like each advancement we've had in the complexity of the way we write code to interact with these models comes from both increasing capability in the models and increasingly niche ways for injecting prompts into those models. Prompts I'm sure you're aware are prompts. Powers prompts rules files prompts skills prompts. These lint error messages that I am talking about prompts. Review agents that inject comments onto the PR that we require the agent to address before it is able to propose it for merge. Prompts.

[01:22:17] You're going to find lots of ways to insert prompts into your code. And one way you can do that is by embedding agent SDKs into your tests that are going to review the codebase for acceptability using prompts that get embedded into the code. And if I find myself spending a ton of time writing prompts, we can actually shell out to the agent for that as well. Uh, I've pointed codecs at all of the prompting cookbooks we have on the OpenAI developer guide and told it to synthesize a skill out of them for how to write prompts. Which means when I find a need to write prompts in order to improve my agent performance locally in the code, I use the skill to write prompts that I wrote with the agent looking at the prompts to write the prompts.

[01:23:05] All the leverage that you're encoding in to your repository, your team, and the agents in this way stacks incredibly well. To kind of pull back to this idea that a single product-minded engineer on my team was able to give us a big lift, they know what it means to write a good QA plan. To write a good QA plan though, you have to document all the features that you have, the critical user journeys, and how users engage with your applications, web apps, APIs, and services.

[01:23:37] Once you write those down on how to write a good QA plan with the expectation that all userfacing work has a QA plan, now a review agent is able to assert expectations around what it means to prove that you have effectively written the feature. A QA plan indicates what media should be attached to the PR for the humans and agents to know that you've done a good job, which has the consequence of me trusting the output more, needing to shoulder surf the agent less, and removing myself from the loop even more to delegate more and more of the work to agents. And all of this is just making sure the agents have the tools and tokens and context to do the full job to remove myself from the need as a synchronous driver. The models crave tokens. We can operationalize our codebase to give them tokens to drive them forward using sub agents and all these other techniques to refine the agent output.

[01:24:40] I'm excited to let you all know today in the way you all do that you can just go build things. Do not hesitate to remove yourselves from the loop by getting the agents to do the full job because they can. Thank you. Our next presenter is the creator of Open Claw, the world's fastest growing open-source AI. He recently joined OpenAI to work on bringing agents to everyone. Please join me in welcoming to the stage Peter Steinberger.

[01:25:40] Good morning everyone. >> So Swiss asked me to do a state of the claw. Who here is running open claw? Give me some hands. Ah, it's like 30 or 40%. Very good. Um, yeah, it's been quite a few months. Um, the project is now 5 months old. I think it's fair to say by now that we are the fastest growing project in GitHub's history. Um if you've seen the graph usually it's some some projects look like a hockey stick but ours was just like a straight line and a friend called it stripper pole gross and that comes with it own challenges.
