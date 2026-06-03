# How to Automate TikTok Slideshow Content Creation with Hermes Agent (Step-by-Step Guide)

- Author: Alex Nguyen / @alexcooldev
- Source tweet: https://x.com/alexcooldev/status/2054605442945569184
- X article: https://x.com/i/article/2054593147406262272
- X article alias: https://x.com/alexcooldev/article/2054605442945569184
- Extracted: 2026-06-03T14:13:19.367825+00:00

## X/Grok summary

- TikTok aggressively boosts slideshows as cheap, high-leverage content needing no filming, editing, or face.

- The assembly bottleneck—hook to niche, images, slides, caption, schedule—took 20 minutes per post manually.

- Hermes Agent runs an autonomous CLI pipeline of markdown skills triggered by cron jobs on a cheap VPS.

- Skills handle hook research, image routing and scraping from Pinterest, deterministic slide composition, and draft publishing via Postiz.

- New accounts use strict draft mode with iPhone farm publishing from real devices to avoid shadow bans during warmup.

## Cover

![cover](https://pbs.twimg.com/media/HINrVvSboAEOMDE.jpg)

## Full text

Currently, TikTok is heavily boosting views and engagement for slideshows, you can check out these channels.

![X article media 2054595631239540738](https://pbs.twimg.com/media/HINj10UaMAIYnux.jpg)

![X article media 2054595668434673664](https://pbs.twimg.com/media/HINj3-4a4AA8BqW.jpg)

![X article media 2054596371186163712](https://pbs.twimg.com/media/HINkg41boAAJhdG.jpg)

![X article media 2054596535170846720](https://pbs.twimg.com/media/HINkqbubUAA0GVk.jpg)

## Why this stack

Slideshows are the highest leverage format on TikTok right now:

- Algorithm still pushes them aggressively (cheap content, infinite supply problem on TT's side)
- No filming, no editing, no face required
- Hook-driven → you can A/B test 50 hooks/day
- Draft uploads bypass most bot detection that hits the direct-publish API
The bottleneck was never ideas. It was the assembly line. Hook → niche → image direction → 8 slide compositions → caption → schedule. Doing this manually = 20 mins per post. For 30 accounts = a full-time job you hate.

Hermes Agent is the right tool because it's not a framework you npm install and wire up it's an autonomous CLI agent that lives wherever you put it (my $5 Hetzner box), with built-in skills, cron, MCP, and subagent delegation. The whole pipeline is just skills that the agent loads + cron jobs that fire them on schedule. No queue infrastructure, no worker pool to manage.

## Step 1: Install Hermes Agent

One-liner install on the VPS:


Pick a provider:


I run with Anthropic via OAuth (Max plan) for the agent-y stages (hook research, image direction, caption) and a cheap OpenRouter fallback for high-volume polls. You can also wire Nous Portal, OpenAI Codex, DeepSeek, Z.AI, Kimi hermes model walks through it all.

Verify it works:


If that responds, you're past the hardest part. The full quickstart is at https://hermes-agent.nousresearch.com/docs/getting-started/quickstart.

Then install the gateway as a systemd service so cron jobs actually run when you're not logged in:


This is the daemon that ticks the scheduler every 60 seconds and runs due jobs in fresh agent sessions.

## Step 2: Mental model pipeline = skills + cron, not workers

Most automation tutorials reach for queues and workers. Hermes flips this. The unit of work is a skill (markdown file in ~/.hermes/skills/) and the trigger is a cron job that loads one or more skills and runs them.

Here's the mapping for the TikTok pipeline:

![X article media 2054600335759745024](https://pbs.twimg.com/media/HINoHqBboAAvU_A.jpg)

Each skill is a markdown file the agent loads on demand. Cron jobs chain them via context_from. The Hermes scheduler runs each job in a fresh isolated session, so no state corruption between accounts.

## Step 3: Create the skills

Skills live in ~/.hermes/skills/<category>/<skill-name>/SKILL.md. The agent can create them itself via skill_manage, or you can author them by hand. I do a mix I draft the structure, then let Hermes refine after watching it run.

Hook Researcher skill

bash


~/.hermes/skills/tiktok/hook-researcher/SKILL.md:


Image Source Router skill

This decides Pinterest vs AI gen per slot.

~/.hermes/skills/tiktok/source-router/SKILL.md:


Pinterest Scraper skill

This one needs a helper script because the agent shouldn't be doing HTTP rotation logic in-context.


~/.hermes/skills/tiktok/pinterest-scraper/SKILL.md:


~/.hermes/skills/tiktok/pinterest-scraper/scripts/scrape.py is a normal Python script. The agent invokes it via execute_code or terminal and parses stdout. The PROXY_POOL_URL declared above gets passed through automatically into execute_code sandboxes that's a Hermes feature that saved me a lot of env plumbing.

Slide Compositor no-agent mode

This stage is fully deterministic. No LLM needed. Hermes has no_agent mode for exactly this:

bash


~/.hermes/scripts/compose-slides.py:


Then schedule it as a no_agent cron job wakeAgent never fires, no LLM cost on this step.

Publisher skill

~/.hermes/skills/tiktok/publisher/SKILL.md:


## Step 4: The shadow ban killer always draft mode

This is the part most tutorials skip and it's the biggest reason new accounts die.

If an account is less than 30 days old, ALWAYS post as draft. No exceptions.

New accounts on TikTok are on probation. The algorithm profiles:

- Publishing through the Content Posting API → bot risk score +1
- Publish IP not matching the account's usual device IP → +1
- Suspiciously regular intervals → +1
- Stripped or inconsistent metadata vs on-device capture → +1
Stack 2-3 of those on a fresh account and you get shadow banned silently. No notification. Videos stuck at 50-200 views forever. You'll think your content sucks. It doesn't the account is dead.

The Publisher skill above hardcodes draft mode for any account under 30 days / under 20 posts. Postiz uploads it as a draft, then my iPhone farm picks up the draft (via WebDriverAgent automation) and hits Publish from a real device with a real IP. TikTok sees a human-initiated publish from a known device clean.

Warmup protocol:

- Days 1-7: account does nothing but scroll, like, follow
- Days 8-14: post 1 draft/day, published from device 2-4 hours after draft creation
- Days 15-30: ramp to 2-3 drafts/day, randomize publish times within ±90 min
- Day 30+: full pipeline cadence, still draft mode
Hermes cron + Postiz Cloud + iPhone farm device publish = indistinguishable from organic behavior to TikTok's classifiers.

## Step 5: Chain everything together with cron + context_from

This is the magic of Hermes' cron system. Each pipeline stage is a separate cron job. Job N reads the most recent output of Job N-1 via context_from. The chain runs end-to-end without me orchestrating anything.

I create the chain from a single chat session with Hermes:

text

hermes --tui
> I need to set up the TikTok pipeline for account acc_42, niche=fitness.
> Schedule the pipeline to run every day at 09:00 UTC.
> Chain: hook research → source routing → pinterest scrape → compose → caption → publish.
> Each stage should use the matching skill and receive context from the previous stage.

Hermes uses the cronjob tool internally and creates the chain. Here's what the equivalent direct calls look like (Hermes does this for you):


A few key things:

context_from chains the outputs. Hermes reads each upstream job's most recent saved output from ~/.hermes/cron/output/{job_id}/ and prepends it to the next job's prompt as context. No databases, no queues, no glue code.

workdir runs the job inside the project directory. This means AGENTS.md, .cursorrules, and any local context files get auto-loaded. Useful when you keep account configs and prompt overrides in a project repo.

no_agent=True on the compositor. Pure deterministic Sharp/PIL work. No reason to pay for an LLM turn. The script's stdout becomes the job's output and chains to the next stage normally.

deliver="telegram" pings me when the publish completes. I use "all" for the final stage on the high-value account so I get the success ping on every connected channel.

## Step 6: Per-stage toolset control (cost saver)

By default cron jobs inherit the toolsets you configured for the cron platform via hermes tools. But for cost control on high-frequency stages, lock toolsets per job:


Hook research doesn't need browser, terminal, or delegation toolsets — those bloat the tool-schema prompt on every LLM call. Locking the hook job to ["file"] cut my hook-gen tokens by ~40%. Across 30 accounts × 1 post/day × 30 days = real money.

The Pinterest scrape job needs ["terminal", "file"] to call the script. The compositor in no_agent mode doesn't load any toolsets (no agent runs). The publisher needs ["terminal", "file"] for postiz-cli.

## Step 7: Skip the agent when nothing changed

Hermes has a pre-check script pattern that's perfect for the daily hook job. If the niche performance data hasn't changed since yesterday, there's no reason to generate fresh hooks yesterday's top 3 are still the top 3.

~/.hermes/scripts/hook-precheck.py:


Attach via the script parameter when creating the cron job. The agent only wakes when performance data actually changed. On a typical day where I haven't manually logged anything new, this skips the LLM entirely. Free.

## Step 8: Postiz setup cloud (or you can self hosted) + the official Hermes skill

I tried self-hosting Postiz in Docker for 2 months. Spent more time fixing the container than building features OAuth token refreshes failing, media disk filling up, schedule worker dying silently. Postiz Cloud at $29/mo bought back ~5 hrs/week of debugging.

The 60-second setup:

bash


The Postiz skill exposes itself to Hermes through this SKILL.md (lives in ~/.hermes/skills/postiz-agent/SKILL.md after install):


Hermes reads this on session start, registers the postiz binary as a tool, and now any cron job that loads this skill can call it.

API basics worth knowing

![X article media 2054604882758586368](https://pbs.twimg.com/media/HINsQU6b0AAS2Ka.jpg)

The two-layer mode system trips people up. Postiz has its own type: "draft" for posts that sit in Postiz's UI without going anywhere. That's NOT what we want. We want type: "schedule" with content_posting_method: "UPLOAD" Postiz schedules the post, pushes it to TikTok at the scheduled time, but as a TikTok-side draft that lands in the account's inbox for the iPhone farm to publish from a real device.

Wrong combination = wrong outcome. Test this on one account first.

Self-host only if you have compliance reasons or you're posting at volume that justifies it. Cloud has a real cost (30 req/hr cap per key), but self-host eats your hours.What I learned the hard way

Don't trust your first hooks. I ran the pipeline for 2 weeks blasting hook-archetype #1. Flat. Switched to A/B testing 3 archetypes per niche with a daily eval loop reading back from TikTok's view counts → killed the dead archetypes, doubled down on winners. CTR jumped within a week.

Pinterest beats AI for authentic niches. I spent 3 months optimizing image gen prompts for fitness transformation slides. Then tested 50/50 against Pinterest-scraped equivalents. Pinterest slides got 2.3x the saves. Real photos hit different. The fix: route per-niche.

Draft mode is non-negotiable for new accounts. I lost 4 accounts before I accepted this. Direct publish on a fresh account = silent shadow ban within the first week. You won't know until you've wasted 2 months of content on a dead account.

Resource:

- Hermes Agent: https://hermes-agent.nousresearch.com/
- Postiz: https://postiz.com/
Good luck guys [💪](https://abs.twimg.com/emoji/v2/svg/1f4aa.svg)
