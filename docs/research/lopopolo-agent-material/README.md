# Ryan Lopopolo agent-material inventory

Research date: 2026-06-04

This is a public-source inventory of Ryan Lopopolo / `@_lopopolo` material that is likely useful for improving coding-agent output. It prioritizes primary sources: Ryan's site, OpenAI posts/docs, GitHub repos, conference pages/videos, and publisher-hosted podcast transcripts.

## Bottom line

I found the high-value public corpus, but not literally everything.

Known gaps:

- X/Twitter is incomplete. Exact status URLs and snippets are discoverable, but full thread text is often behind dynamic rendering/login. Ryan's Hyperbola lifestream is much easier to crawl when a short-form post exists there.
- OpenAI internal repo docs, prompts, generated PRs, review-agent prompts, and Frontier/Symphony implementation details are not public.
- Some 2026 conference pages are JS-heavy and may not expose slides/transcripts yet.
- The public corpus will keep changing; re-run the searches in `source-urls.txt` periodically.

## Repo-local source bundles

Prefer these local files before re-fetching the web:

- `cleaned/manifest.md` — canonical URL → cleaned local file map
- `cleaned/openai-harness-engineering.md` — cleaned OpenAI article copy
- `cleaned/youtube-*.md` — cleaned transcripts pulled from the original YouTube sources
- `youtube-2026-direct-sources.md` — audit of 2026 direct Ryan YouTube sources and excluded third-party summaries/slop
- `cleaned/frantic-slow-then-suddenly.md` — related Alex Kotliarskyi article on infrastructure/harness investment compounding suddenly
- `raw/ryan-lopopolo-openai/` — imported third-party bundle kept only for comparison/fallback

## Highest-priority ingestion list

Use these first when asking an agent to adopt Ryan's harness-engineering style.

| Priority | Source | URL | Why it matters |
|---:|---|---|---|
| 1 | OpenAI: Harness engineering | https://openai.com/index/harness-engineering/ | Canonical essay: humans steer, agents execute; repo docs, guardrails, observability, review agents, and proof loops become the durable artifact. |
| 2 | Latent Space interview transcript | https://www.latent.space/p/harness-eng | Best long-form interview on the 1M LOC / 1B token/day experiment, build-loop discipline, agent legibility, review agents, Symphony, and org patterns. |
| 3 | AI Engineer Europe talk | https://www.youtube.com/watch?v=am_oeAoUhew | Public talk: "Harness Engineering: How to Build Software When Humans Steer, Agents Execute." |
| 4 | Aakash Gupta / Growth Podcast interview | https://www.news.aakashg.com/p/ryan-lapopolo-podcast | Product/PM/designer angle: PRDs, tests, painted doors, and non-engineers shipping through a harness. |
| 5 | Hyperbola AI-agent posts | https://hyperbo.la/w/ | Ryan's own ongoing writing; especially 2025-2026 posts on Codex, MCP, code-as-non-artifact, utilization, and verification. |
| 6 | Codex Auto-review research/docs | https://alignment.openai.com/auto-review/ and https://developers.openai.com/codex/concepts/sandboxing/auto-review | Ryan-endorsed safety/permission pattern: separate reviewer agent at sandbox boundary, reducing need for YOLO/full-access mode. |
| 7 | Artichoke Ruby repo/docs | https://github.com/artichoke/artichoke | Large Rust/Ruby systems corpus with architecture/build/contributing/spec docs; useful for systems-agent taste. |
| 8 | RubyConf 2019 Artichoke talk | https://www.rubyevents.org/talks/building-a-ruby-artichoke-is-a-ruby-made-with-rust | Transcript and talk on building a Ruby VM in Rust/Wasm. |
| 9 | AWS billing / FinOps talks and writing | https://stripe.com/blog/aws-reserved-instances and https://www.usenix.org/conference/srecon19asia/presentation/lopopolo | Engineering-finance, observability, infrastructure cost, and org-design material. |

## Ryan-authored / primary writing

### OpenAI

- **Harness engineering: leveraging Codex in an agent-first world** — https://openai.com/index/harness-engineering/ — 2026-02-11.
  - Primary harness-engineering essay.
  - Key ideas: code is downstream of specs/guardrails; `AGENTS.md` as table of contents; docs as system of record; mechanical invariants; local observability; review agents; humans focus on intent, validation, and feedback-loop design.

### Hyperbola blog index

Primary index: https://hyperbo.la/w/

High-value AI/agent posts:

- **Enabling Codex to Upgrade My Robot Vacuum** — https://hyperbo.la/w/robot-vacuum-canary-tailscale/ — 2026-04-19.
- **What Does It Mean to Do a Good Job?** — https://hyperbo.la/w/what-does-it-mean-to-do-a-good-job/ — 2026-04-10.
- **Coding Agents for Technical Non-Engineers** — https://hyperbo.la/w/coding-agents-for-technical-non-engineers/ — 2026-04-09.
- **A Lazy Prompt Turned Into a RustSec Advisory** — https://hyperbo.la/w/lazy-prompt-rustsec/ — 2026-03-30.
- **Agent Utilization Is the New Performance Ceiling** — https://hyperbo.la/w/agents-agents-agents/ — 2026-03-13.
- **Stop Treating Code as the Artifact** — https://hyperbo.la/w/code-is-not-the-artifact/ — 2026-03-13.
- **Software Work Is No Longer Scheduled** — https://hyperbo.la/w/software-work-not-scheduled/ — 2026-03-13.
- **The Production Function Changed** — https://hyperbo.la/w/production-function-changed/ — 2026-03-13.
- **Harness Engineering the Blog Build (Again)** — https://hyperbo.la/w/harness-engineering-the-blog-build/ — 2026-02-17.
- **It's Not Codex, It's Codex/GPT-5-Codex** — https://hyperbo.la/w/codex-copypasta/ — 2025-12-13.
- **MCP Solves Tool Discovery for LLMs** — https://hyperbo.la/w/tool-discovery/ — 2025-08-10.
- **I Wrote 4,000 Lines of Code with ChatGPT in a Weekend** — https://hyperbo.la/w/chatgpt-4000/ — 2023-06-13.

Systems/leadership posts that are useful for agent taste:

- **Winding Down Artichoke Ruby** — https://hyperbo.la/w/winding-down-artichoke-ruby/ — 2026-02-15.
- **Ruby Enumerable: Manifest Destiny** — https://hyperbo.la/w/iterator-destiny/ — 2025-08-10.
- **Service meshes are organization tools, not technical ones** — https://hyperbo.la/w/service-mesh/ — 2025-08-03.
- **Debazeling the blog** — https://hyperbo.la/w/debazeling/ — 2025-08-03.
- **Do the Simplest Thing That Could Possibly Work** — https://hyperbo.la/w/do-the-simplest-thing/ — 2023-08-25.
- **Scaling Myself by Letting My Team Fail** — https://hyperbo.la/w/scaling-impact-senior-staff/ — 2023-07-27.
- **Feedback Windows** — https://hyperbo.la/w/feedback-windows/ — 2023-06-14.
- **Debugging an mruby Heap Corruption in Artichoke with Pernosco** — https://hyperbo.la/w/artichoke-pernosco/ — 2021-09-19.
- **Source-level Polymorphism in Rust** — https://hyperbo.la/w/source-level-polymorphism/ — 2020-12-24.
- **Communicating with the Synthesis Step** — https://hyperbo.la/w/synthesis/ — 2019-08-20.
- **Cactus Harvesting: Cycle-Aware Reference Counting in Rust** — https://hyperbo.la/w/cactus-harvesting/ — 2019-07-15.
- **Senior Engineers Build Consensus** — https://hyperbo.la/w/nemawashi/ — 2019-03-03.
- **Postmortem: 502s During Parameter Store Rollout** — https://hyperbo.la/w/secrets-in-parameter-store-postmortem/ — 2018-11-16.
- **Blue-Green Deployments With Autoscaling Groups and Terraform** — https://hyperbo.la/w/terraform-blue-green/ — 2018-11-05.
- **AWS Is Your Org Chart** — https://hyperbo.la/w/aws-org-chart/ — 2018-10-27.
- **Productive Engineering-Finance Partnership** — https://hyperbo.la/w/engineering-finance-partnership/ — 2018-10-27.

Other site pages:

- Homepage — https://hyperbo.la/
- Contact/bio — https://hyperbo.la/contact/
- Lifestream — https://hyperbo.la/lifestream/
- RSS feed — https://hyperbo.la/w/feed.xml

## Podcasts, interviews, and talks

- **Extreme Harness Engineering for Token Billionaires** — https://www.latent.space/p/harness-eng — 2026-04-07.
  - Mirrors: https://www.youtube.com/watch?v=CeOXx-XTYek, https://open.spotify.com/episode/0JRaE28Y7W3lBXcfn6YQvX, Apple Podcasts episode.
- **Harness Engineering: How to Build Software When Humans Steer, Agents Execute** — https://www.youtube.com/watch?v=am_oeAoUhew — AI Engineer Europe 2026.
- **AI Engineer Europe livestream Ryan chapter: “Code is free”** — https://www.youtube.com/watch?v=O_IMsEg91g8 — 2026-04-09; archived as Ryan's chapter only.
- **How PMs Ship 100K Lines of Code at OpenAI with Ryan Lopopolo** — https://www.news.aakashg.com/p/ryan-lapopolo-podcast — 2026-05-25.
  - YouTube: https://youtu.be/8suwvrF0Lv0
- **Build Hour: API & Codex** — https://www.youtube.com/watch?v=rhsSqr0jdFw — OpenAI Build Hour panel with Ryan, Charlie Guo, and Mitch Troyanovsky.
- **AI Native Dev event interview segment** — https://www.youtube.com/watch?v=OfsWo6zyt-4 — archived as Ryan's segment only.
- **AI Native DevCon London: Harness Engineering** — https://www.youtube.com/watch?v=c8bE0cj7vHY — 2026-06-02.
- **Code Is Free: Securing Software** — https://www.youtube.com/watch?v=U2O14Jd3MBU — [un]prompted 2026 talk with Paul McMillan and Ryan.
- **Using Codex Across the Software Development Lifecycle** — https://webinar.openai.com/on-demand/3cc11df5-dfbf-4d9c-926e-a9ee7d0b25bd — OpenAI webinar with Ryan Lopopolo and Charlie Weems; direct source, but not YouTube.
- **Building a Ruby: Artichoke is a Ruby Made with Rust** — https://www.rubyevents.org/talks/building-a-ruby-artichoke-is-a-ruby-made-with-rust — RubyConf 2019.
  - YouTube: https://www.youtube.com/watch?v=QMni48MBqFw
  - Slides: https://artichoke.github.io/rubyconf/2019/
- **The AWS Billing Machine and Optimizing Cloud Costs** — https://www.usenix.org/conference/srecon19asia/presentation/lopopolo — SREcon19 Asia/Pacific.
  - Slides PDF: https://www.usenix.org/sites/default/files/conference/protected-files/srecon19apac_slides_lopopolo.pdf
  - YouTube: https://www.youtube.com/watch?v=I4BLfY54SsY
- **DevOpsDays Seattle 2019: The AWS Billing Machine and Optimizing Cloud Costs** — https://www.youtube.com/watch?v=QBpP3KpdM9c
- **Monitorama PDX 2019: The AWS Billing Machine and Optimizing Cloud Costs** — https://vimeo.com/341148381

## GitHub and repo corpus

Primary profiles/orgs:

- Ryan profile — https://github.com/lopopolo
- Artichoke org — https://github.com/artichoke
- Hyperbola org — https://github.com/hyperbola

High-value repos/docs:

- Artichoke Ruby — https://github.com/artichoke/artichoke
  - README — https://github.com/artichoke/artichoke/blob/trunk/README.md
  - ARCHITECTURE — https://github.com/artichoke/artichoke/blob/trunk/ARCHITECTURE.md
  - BUILD — https://github.com/artichoke/artichoke/blob/trunk/BUILD.md
  - CONTRIBUTING — https://github.com/artichoke/artichoke/blob/trunk/CONTRIBUTING.md
  - RUBYSPEC — https://github.com/artichoke/artichoke/blob/trunk/RUBYSPEC.md
  - VISION — https://github.com/artichoke/artichoke/blob/trunk/VISION.md
- Symphony spec/reference implementation — https://github.com/openai/symphony and https://github.com/openai/symphony/blob/main/SPEC.md
- Codex repository for Auto-review policy — https://github.com/openai/codex
  - Policy docs referenced by OpenAI: `codex-rs/core/src/guardian/policy_template.md` and `codex-rs/core/src/guardian/policy.md`.
- Artichoke supporting crates/projects: `cactusref`, `strftime-ruby`, `intaglio`, `jasper`, `playground`, `rubyconf`, `rand_mt`, `sysdir-rs`, `known-folders-rs`, `boba`, `focaccia`, `roe`, `strudel`, `qed`, `raw-parts`.
- Personal repos: https://github.com/lopopolo/dotfiles, https://github.com/lopopolo/bazel_tools_demo, https://github.com/lopopolo/punchtop.

## Related harness-engineering context

These are not Ryan-authored, but are useful adjacent mental models for the same agent-harness setup.

- **Slow, Then Suddenly** — https://frantic.im/suddenly/ — Alex Kotliarskyi, 2026-02-16. Local cleaned copy: `cleaned/frantic-slow-then-suddenly.md`.
  - Relevance: up-front investment in infrastructure/CI/dev-ex loops looks like "no progress" until it unlocks rapid product iteration; this maps directly to the slow-first-month/sudden-leverage pattern Ryan describes for Codex harness engineering.

## X/Twitter items found

Exact status URLs found from public search snippets. Treat as incomplete until verified with a logged-in/archive capture.

- Original "point their agents at my writing..." post — https://x.com/_lopopolo/status/2050698864542482709
- Auto-review endorsement — https://x.com/_lopopolo/status/2051039991686660584
- Earlier typo variant of same auto-review thought — https://x.com/_lopopolo/status/2051035122326208816
- Tibo Auto-Review launch post quoted by Ryan — https://x.com/thsottiaux/status/2050989326570532919
- "All agents are coding agents" — https://x.com/_lopopolo/status/2043495733375230026
- ODSC harness session post — https://x.com/_lopopolo/status/2044441368957993042
- Codex canary/Tailscale robot vacuum post — https://x.com/_lopopolo/status/2045318364537790777
- Codex autocompaction post — https://x.com/_lopopolo/status/2042626474750988487
- Codex long-horizon/autocompaction post — https://x.com/_lopopolo/status/2046606006470533299
- Codex workout sessions post — https://x.com/_lopopolo/status/2047052450604212728
- Symphony excitement/open issues with Codex agents — https://x.com/_lopopolo/status/2048828518625370271
- Alternative harnesses/bitter lesson post — https://x.com/_lopopolo/status/2050705271840989347
- Writing guardrails into agent files post — https://x.com/_lopopolo/status/2054044894000509052
- Self-assembling harness post — https://x.com/_lopopolo/status/2054056036873744594
- ChatGPT Record/vibe-coded feature post — https://x.com/_lopopolo/status/2057223578236735518

## How to use this corpus with agents

Prompt skeleton:

```text
Adopt Ryan Lopopolo's harness-engineering style for this repo. Read:

@docs/research/lopopolo-agent-material/README.md
@AGENTS.md
@README.md

Then propose changes that improve agent legibility, verification, and safe autonomy without adding heavy process.
Focus on: concise root AGENTS.md as table-of-contents, docs as system of record, mechanical guardrails, proof-of-work loops, reviewer-agent prompts, local observability, and safe sandbox/network policy.
Do not blindly copy OpenAI's internal setup; adapt patterns to this repo's Pi/web-access workflow.
```

For coding tasks, add a task-specific instruction:

```text
Before editing, identify which project docs are the source of truth for this change.
After editing, update those docs if behavior changed.
Prove the change with the narrowest command from AGENTS.md, and report exact command output.
If the repo lacks a guardrail that would have caught your mistake, propose one small linter/test/doc check.
```
