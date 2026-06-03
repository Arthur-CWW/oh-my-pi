# My 2 apps have 390K Users With AI and My Total Bill Is Only $1,679/Month. Here's My Entire Playbook.

- Author: Alex Nguyen / @alexcooldev
- Source tweet: https://x.com/alexcooldev/status/2044454751556014113
- X article: https://x.com/i/article/2044300305047924737
- X article alias: https://x.com/alexcooldev/article/2044454751556014113
- Extracted: 2026-06-03T14:13:27.030948+00:00

## X/Grok summary

- I run two apps serving 390K users and generating $30K/month revenue with total operational costs of only $1,679/month, including $703/month in AI expenses for 14K DAU.

- The biggest mistake was routing every request through expensive frontier models like GPT-5 or Claude Opus, spiking costs to $1.20 per DAU.

- Fix: route simple tasks (classification, extraction) to cheap models like GPT-4.1 Nano and GPT-5 Mini, medium to GPT-5 Mini, complex to GPT-5; this cut AI bill by 60%.

- Additional savings from prompt caching, semantic/result caching, self-hosted Llama for background tasks, lean prompts with structured outputs, batch API for non-real-time work, and switching speech to DeepInfra.

- Infra uses Railway ($289) and Supabase ($187) for lean scaling; monitor costs, kill waste, and optimize after product-market fit to achieve $0.05 AI cost per DAU.

## Cover

![cover](https://pbs.twimg.com/media/HF7c8BAasAE2GUD.jpg)

## Full text

I shared my operational bill: $1,679/month running apps that serve 390K users and generate $30K/month in revenue.


People lost their minds.

"How is your AI cost so low?"

"You're running OpenAI + Claude + Llama for under $900?"

"What's the trick?"

There's no single trick. It's a system. And I learned most of it the hard way - by burning money first.

Here's everything I know about keeping AI costs as low as humanly possible.

## The Mistake Everyone Makes

When I first integrated AI into my apps, I did what every developer does: I picked the biggest, most capable model available - GPT-5 - routed every single request through it, and watched my bill climb like a rocket.

Let me give you some context. GPT-5 costs $1.25 per million input tokens and $10.00 per million output tokens. That sounds cheap until you multiply it by thousands of requests per day. Every classification, every summary, every "extract this one field from a JSON" - all going through a $10/M output model.

$2,400 in the first month. For maybe 2,000 daily active users.

That's $1.20 per DAU per month. At that rate, scaling to 14K DAU would cost me $16,800/month just on AI. More than half my revenue - gone.

I panicked. Started thinking about removing AI features entirely.

Then I stepped back and actually studied what my users were doing.

## Step 1: Not Every Request Deserves a Big Model

This is the single highest-impact change you can make. And in 2025/2026, OpenAI has made it embarrassingly easy with their model lineup.

I audited every AI call in my app and categorized them:

- Simple tasks (60% of requests): Classification, extraction, formatting, short summaries
- Medium tasks (30%): Conversational responses, content generation, moderate reasoning
- Complex tasks (10%): Long-form analysis, multi-step reasoning, creative writing
I was sending 100% of these to GPT-5.

The fix was embarrassingly simple: route simple tasks to smaller, cheaper models.

Let me break down the current OpenAI model lineup and what each one actually costs, because this is where most developers leave money on the table:

GPT-5 - The flagship. $1.25/M input, $10.00/M output. This is the smartest model OpenAI offers. It handles text, images, structured output - the works. But it's also the most expensive. You do NOT need this for "extract the user's name from this sentence."

GPT-5 Mini - The sweet spot. $0.25/M input, $2.00/M output. This is 5x cheaper than full GPT-5 on input and 5x cheaper on output. For most medium-complexity tasks - chatbot responses, content generation, summarization - GPT-5 Mini is indistinguishable from the full model. I route about 30% of my traffic here.

GPT-4.1 Nano - The workhorse. $0.10/M input, $0.40/M output. This tiny model is absurdly cheap. For simple classification, entity extraction, formatting, and anything that doesn't require deep reasoning - Nano handles it perfectly. I route 50-60% of all my AI requests through Nano. At $0.10/M input tokens, you'd have to process 10 million tokens to spend a single dollar on input.

GPT-4.1 Mini - The middle ground. $0.40/M input, $1.60/M output. Sits between Nano and GPT-5 Mini. Good for tasks that need a bit more intelligence than Nano but don't justify GPT-5 Mini pricing.

Here's roughly what my routing looks like in practice:

![X article media 2044311252277833729](https://pbs.twimg.com/media/HF7aQLJasAEBSXy.png)

Just this one change cut my AI bill by about 60%.

And here's the thing people miss: OpenAI also offers prompt caching now. If you send the same system prompt repeatedly (which you do - every request to the same feature has the same system prompt), cached input tokens cost only 10% of the normal price. So that $0.10/M for Nano? It becomes $0.01/M for the cached portion. Essentially free.

On top of that, I also use Claude Haiku ($0.25/M input, $1.25/M output) from Anthropic for certain tasks where I want a different "personality" in responses, and Llama (self-hosted, $0/token) for background processing. The multi-provider approach isn't just about redundancy - it's about matching each request to the cheapest model that can handle it well.

The key insight: your users cannot tell the difference on simple tasks. Nobody notices that their text got summarized by a $0.10/M token model instead of a $10/M token model. The output is identical for 90% of use cases.

Here's a practical example. I have a feature that classifies user input into one of 8 categories. The prompt is simple: "Classify this text into one of the following categories: [list]. Respond with only the category name."

- Running this on GPT-5: costs ~$10 per million outputs
- Running this on GPT-4.1 Nano: costs ~$0.40 per million outputs
- Accuracy difference: literally 0%. Both get it right 99%+ of the time.
That's a 25x cost reduction on a single feature. Multiply that across every simple task in your app, and you start to understand why model routing is step #1.

A rant I need to get off my chest: Stop using Opus for everything.

I see this constantly in indie dev communities. Someone builds an app, plugs in Claude Opus - the most powerful (and most expensive) model Anthropic offers - and uses it for everything. Summarizing a paragraph. Extracting a name from a string. Classifying a support ticket. Formatting a date.

That's like hiring a $500/hour lawyer to proofread your grocery list.

Claude Opus costs $15/M input and $75/M output. GPT-5 is $1.25/$10. These are frontier models designed for the hardest problems: deep research, complex multi-step reasoning, nuanced creative work, tasks where the quality difference between a top-tier model and a mid-tier model actually matters.

But here's the uncomfortable truth: for 80-90% of tasks in a typical app, the quality difference between Opus and Haiku is zero. Not small. Zero. Your classification task doesn't get "more classified" because you used a $75/M output model instead of a $1.25/M one.

I made this exact mistake. Early on, I had Claude Opus handling some conversational features because I wanted "the best quality." I was spending roughly $400/month on those calls alone. Then I ran a blind comparison - I routed the same 1,000 requests through Opus and through Haiku, had users rate the responses, and the satisfaction scores were statistically identical. Same user happiness. 60x price difference.

Here's my rule of thumb for choosing models:

Use frontier models (Opus, GPT-5, o3) when:

- The task requires genuine multi-step reasoning or deep analysis
- You're building a product where AI quality IS the product (writing tools, research assistants)
- Errors are expensive (medical, legal, financial contexts)
- You're prototyping and need to figure out if AI can even solve the problem
Use mid-tier models (Sonnet, GPT-5 Mini) when:

- Conversational responses that need to sound natural
- Content generation (blog drafts, social posts, descriptions)
- Moderate reasoning tasks (comparisons, recommendations)
Use cheap models (Haiku, Nano, Llama) when:

- Classification, tagging, categorization
- Data extraction and formatting
- Simple summarization
- Any task with a deterministic or near-deterministic answer
- Background processing users never see
The model you choose should match the complexity of the task - not your ego, not your anxiety about quality, not your assumption that "bigger is always better." Use the right tool for the right job. Your margin will thank you.

## Step 2: Cache Like Your Wallet Depends on It

Because it does.

I found that roughly 25-30% of my AI requests were nearly identical. Users asking the same types of questions, requesting the same transformations, generating similar content.

My caching strategy:

Semantic caching - I hash the core intent of a request (not the exact wording) and check if I've seen something similar in the last 24 hours. If the similarity score is above 0.92, I serve the cached response.

Result caching - For deterministic tasks (classification, extraction, formatting), I cache the output keyed to the input. Same input = same output = no reason to call the API again.

Template caching - For common workflows, I pre-generate responses during off-peak hours and serve them instantly. Users think the AI is fast. It is - because it already ran 3 hours ago.

This saved me another 20-25% on API costs. And it made the app faster, which users actually noticed and loved.

## Step 3: Self-Host Where It Makes Sense

This is where Llama enters the picture.

I run Llama for a specific subset of tasks that are:

- High volume
- Low complexity
- Latency-tolerant (user isn't staring at a loading spinner)
Background processing, batch summarization, content tagging - these all run on self-hosted Llama. The marginal cost per request is essentially zero after the server cost.

My Railway server ($289/month) handles both my application backend AND local Llama inference for lightweight tasks. That's a fixed cost regardless of how many requests I process.

Compare that to paying per-token for every single request. At 14K DAU, the math is brutal if you're using only API-based models.

When to self-host vs. use APIs:

- Self-host: High volume, simple tasks, background processing, when you need data privacy
- Use APIs: Complex reasoning, low volume, when you need cutting-edge quality, when you can't afford GPU infra
Don't self-host everything. Don't API everything. Mix and match based on the actual workload.

## Step 4: Your Infrastructure Stack Is a Cost Decision Too

People obsess over AI model pricing but completely ignore the infrastructure underneath. Let me break down my actual infra stack because these numbers matter just as much.

Railway: $289/month

Railway is where my entire backend lives. NestJS API server, background workers, cron jobs, Redis for queuing, and lightweight Llama inference. All on one platform.

Why Railway and not AWS or GCP? Because I'm a solo developer, not a DevOps team. Railway gives me one-click deploys from GitHub, automatic scaling, built-in logging, and zero infrastructure management. I push code, it deploys. That's it.

Could I run the same thing on a $50/month VPS? Technically yes. But I'd spend 10-15 hours a month managing servers, debugging Docker issues, handling SSL certificates, setting up monitoring, and dealing with downtime at 2am. My time is worth more than $239/month. Railway lets me focus on building the product instead of babysitting servers.

That said, here's my honest take on Railway's pricing: it's not the cheapest option. If you're running a very compute-heavy workload or you need GPU instances, Railway gets expensive fast. For those cases, look at alternatives like Fly.io (great for edge deployments), Coolify on Hetzner (self-hosted PaaS on cheap European servers, as low as $4-5/month for a decent VPS), or just a raw VPS from DigitalOcean or Hetzner if you're comfortable with server management.

My rule: if your time is expensive and your server bill is under $500/month, use a managed platform. If your server bill crosses $500/month, it's time to consider self-hosting on cheaper hardware.

Supabase: $187/month

Supabase is my database, auth, and file storage. All in one. PostgreSQL under the hood, which means I get a real database with real SQL, not some proprietary NoSQL thing I'll regret later.

Here's why Supabase is a steal at $187/month for what I'm getting:

- PostgreSQL database handling 390K users and 10-14K DAU with zero issues
- Built-in auth (email, OAuth, magic links) that would cost me $100+/month on Auth0 at my scale
- File storage for user uploads that would be another $20-30/month on S3 + CloudFront
- Realtime subscriptions for live features
- Edge functions for lightweight serverless logic
- Row Level Security built into the database layer, not bolted on as middleware
If I built all of this separately: managed PostgreSQL on AWS RDS ($100-200/month), Auth0 or Clerk ($100+/month), S3 + CloudFront ($20-50/month), a realtime service like Pusher ($50-100/month)... I'd easily be paying $300-500/month for the same functionality. Supabase bundles it all for $187.

The Pro plan ($25/month) covers most startups. I'm on a higher tier because of my database size and bandwidth, but even at $187 it's one of the best deals in my entire stack.

My infra advice for different stages:

Just starting out (0-1K users, $0-50/month budget):

- Supabase free tier (generous limits, 500MB database, 1GB storage)
- Railway free tier or a $5/month starter plan
- Total: $0-30/month. Seriously. You can launch a real product for the cost of a Netflix subscription.
Growing (1K-10K users, $50-200/month budget):

- Supabase Pro at $25/month
- Railway at $50-100/month
- Start separating your background workers from your API server
- Total: $75-125/month. Still incredibly lean for thousands of active users.
Scaling (10K+ users, $200-500/month budget):

- Supabase Pro + usage-based scaling ($100-200/month)
- Railway with dedicated resources ($200-300/month)
- Consider adding a caching layer (Redis on Railway or Upstash)
- This is where I am. Total infra: $476/month serving 14K DAU.
The trap to avoid: Don't over-engineer your infra from day one. I've seen solo devs set up Kubernetes clusters, multi-region databases, and load balancers for apps with 50 users. That's not engineering, that's procrastination. Start simple. Supabase + Railway. Two services. One database. One server. Ship the product. You can always migrate later when the revenue justifies it.

And here's something nobody tells you: most infra costs scale sub-linearly with users. Going from 1K to 10K users doesn't 10x your server bill. My Railway cost barely changed when I went from 5K to 14K DAU because most of the compute is AI inference (which scales with API calls, not server size). Your database gets bigger, your bandwidth goes up, but the base infrastructure cost stays relatively flat.

That's the beauty of building on managed platforms. You pay for what you use, and the pricing scales way more gracefully than "I need a bigger server."

## Step 5: Prompt Engineering Is Cost Engineering

Nobody talks about this enough.

A badly written prompt doesn't just give worse results - it costs more. Longer prompts = more input tokens = higher bills. Verbose outputs you don't need = more output tokens = higher bills.

Things I did:

Trimmed system prompts. My original system prompts were 800-1,200 tokens each. I got them down to 200-400 without losing quality. That's a 60% reduction in input cost on every single request.

Specified output format. Instead of letting the model ramble, I tell it exactly what format I want. "Respond in JSON with these 3 fields." No preamble, no explanation, no fluff. Shorter outputs = cheaper outputs.

Removed redundant context. I was stuffing conversation history into every request "just in case." Now I only include what's relevant to the current query. This alone cut input tokens by 40%.

Used structured outputs. When I need JSON back, I use the structured output features (function calling, JSON mode). The model generates less garbage, which means fewer retries, which means fewer API calls.

## Step 6: Batch and Debounce Everything

Real-time AI is expensive. Not-quite-real-time AI is cheap.

If your feature doesn't need a response in under 2 seconds, batch it.

- User uploads 5 images? Don't make 5 separate API calls. Batch them into one.
- User is typing a message? Don't call the AI on every keystroke. Debounce and wait until they stop typing.
- User generates content and then immediately regenerates? Queue the second request and cancel the first.
- Background analytics and tagging? Run them in a nightly batch job, not on every user action.
OpenAI's Batch API gives you 50% off for non-real-time workloads. That applies to every model - GPT-5, GPT-5 Mini, Nano, all of them. I route all my background processing through it. That's a straight 50% discount for literally the same output, just delivered within 24 hours instead of seconds.

Let me do the math for you. GPT-5 Mini normally costs $0.25/M input. Through the Batch API, that drops to $0.125/M. Combined with prompt caching (which gives you 90% off on cached input tokens), your effective cost for repeated batch operations becomes almost negligible. I'm talking fractions of a cent per request.

I batch everything I can: nightly content tagging, user behavior analysis, bulk summarization of user-generated content, automated moderation. None of these need real-time responses. Users don't even know these processes run. But they make the product better - and they cost almost nothing through batch processing.

## Step 7: Switch to DeepInfra for Speech Models - This Was My Biggest "Why Didn't I Do This Sooner" Moment

Let me tell you about the $190/month line item on my bill: Speech-to-text.

I was using a combination of ElevenLabs and OpenAI's Whisper API for transcription and text-to-speech. Both are great products. Both are also expensive when you're processing thousands of audio minutes per month.

OpenAI's Whisper API costs around $0.006 per minute. ElevenLabs charges based on characters with subscription tiers - and once you exceed your plan's limits, the overages add up fast. My TTS costs alone were creeping toward $300/month.

Then I discovered DeepInfra.

Here's the thing - I use Whisper v3 for all my speech-to-text. It's the same model whether I call it through OpenAI's API or through DeepInfra. Literally the same open-source Whisper Large v3 model, same weights, same accuracy, same everything. The only difference? OpenAI charges $0.006 per minute. DeepInfra charges $0.00045 per minute. That's 13x cheaper. For the exact same model. Same transcription quality. I switched and not a single user noticed - because nothing changed except the bill.

DeepInfra also hosts a bunch of great TTS models - Kokoro TTS, Qwen3-TTS, Inworld TTS, and more. Instead of paying ElevenLabs' per-character rates, I switched to open-source TTS models on DeepInfra like Kokoro (82M parameters, surprisingly good quality) and Inworld TTS for multilingual needs. The cost dropped from dollars to cents per thousand characters.

Here's what the migration looked like:

![X article media 2044311016243347456](https://pbs.twimg.com/media/HF7aCb2aQAAI1rY.png)

The best part? DeepInfra's API is OpenAI-compatible. Literally change the base URL and API key in your code. That's it. A 5-minute migration that saved me over $150/month.


The quality tradeoff? For speech-to-text, there is none - it's literally the same Whisper model. For TTS, the open-source models are maybe 90% as natural-sounding as ElevenLabs' premium voices. But for my use case - in-app audio feedback and content narration - that 90% is more than enough. My users never noticed the switch.

If you're spending $100+/month on speech APIs through premium providers, check DeepInfra (or similar inference platforms like Groq, Fireworks, Together.ai). The open-source speech model ecosystem has gotten incredibly good, and these platforms let you use them without managing your own GPU infrastructure.

This single switch brought my speech-related costs from $190/month down to roughly $30/month. That's $160/month saved by changing two lines of code.

(Quick note: I'm not sponsored by DeepInfra. Nobody's paying me to say this. I'm sharing it because I'm actually using it and the pricing is absurdly cheap. That's it.)

## Step 8: Monitor, Measure, and Kill Waste

You can't optimize what you don't measure.

I track:

- Cost per feature: Which AI features cost the most? Are users actually using them?
- Cost per user: What's my average AI cost per DAU? (Currently around $0.06/day)
- Cache hit rate: Am I caching effectively? (Target: >30%)
- Error/retry rate: Failed requests that get retried are pure waste
I found one feature that cost $180/month and was used by 12 people. Killed it. Nobody complained.

I found another feature with a 15% retry rate because of bad prompt design. Fixed the prompt, saved $80/month in wasted calls.

Small leaks sink big ships. Audit your costs monthly.

## Step 9: Negotiate and Use Credits

This one is straightforward but people forget:

- Startup credits: Anthropic, OpenAI, Google - they all have startup programs. Apply. I've received thousands in free credits.
- Committed use discounts: If you're spending $500+/month on an API, reach out and ask for volume pricing. The worst they can say is no.
- Multi-provider strategy: I use OpenAI, Claude, AND Llama. Not because I love complexity - because I can route each request to whichever provider offers the best price-to-quality ratio for that specific task.
Let me be real about the 2026 landscape - it's a buyer's market and you should take advantage:

OpenAI has GPT-5 at $1.25/$10, but Nano at $0.10/$0.40 for bulk work. Anthropic has Claude Haiku at $0.25/$1.25 which is excellent for lightweight tasks. Google has Gemini Flash at $0.30/M which is competitive for high-volume use. And then there's DeepSeek V3 at $0.14/$0.28 per million tokens - absurdly cheap for tasks that don't need frontier intelligence.

The point isn't to use every provider. The point is to know what's available so you can make informed routing decisions. I personally stick to OpenAI (GPT-5 Mini + Nano) for most tasks, Claude Sonnet for complex creative/analytical work, Llama for self-hosted background jobs, and DeepInfra for speech. Four providers, zero loyalty, maximum savings.

Competition between providers is your leverage. Use it.

## The Full Picture

Here's what my AI cost optimization looks like as a system:

1. Route by complexity → Right model for the right task
2. Cache aggressively → Never pay twice for the same answer
3. Self-host commodity tasks → Fixed cost beats per-token at scale
4. Pick the right infra stack → Railway + Supabase, lean and managed
5. Engineer lean prompts → Every token costs money
6. Batch non-urgent work → 50% off for patience
7. Use inference platforms for speech → Same models, 10x cheaper
8. Monitor and kill waste → Audit monthly, cut ruthlessly
9. Negotiate and diversify → Use credits, volume pricing, multi-provider
The result: $703/month in AI costs (OpenAI + Claude + Llama + DeepInfra speech) serving 14K daily active users.

That's about $0.05 per DAU per month. Down from $1.20 when I started.

A 96% reduction.

## The Real Lesson

Here's what I want you to take away from this:

Don't optimize prematurely.

When I had 200 users, I should have been focused on getting to 2,000 users - not shaving $50 off my AI bill. The time I spent optimizing at small scale was time I could have spent on marketing and product.

My original post said it: Marketing + build first, optimize costs later.

That's still true. But "later" eventually arrives. And when it does - when you're at 10K+ DAU and your AI bill is eating your margins - this playbook is how you fix it.

Build first. Grow first. Then optimize like your profitability depends on it.

Because it does.

## A Note for Indie Hackers, Solo Founders, and Small Teams

This part is specifically for you - because I was you not that long ago.

When you're a solo founder or running a 2-3 person team with a tight budget, you don't have the luxury of a VC-funded runway to burn through. Every dollar matters. You're not optimizing for "nice to have" efficiency - you're optimizing for survival.

And here's the thing that took me way too long to understand: when your budget is small, cutting costs IS increasing profit. They're the same thing.

Think about it. If your app makes $5,000/month and your AI costs are $1,200/month, that's 24% of your revenue gone before you even pay for hosting, domains, and your own rent. Cut that AI bill to $300/month using the strategies in this article, and you just gave yourself a $900/month raise. That's $10,800/year back in your pocket - without acquiring a single new user.

Big companies can afford to be wasteful. They have entire finance teams to figure it out later. You don't. For indie hackers, operational cost optimization is the most underrated growth lever there is. It's not glamorous. Nobody posts on X about "I switched from Opus to Haiku and saved $400/month." But that $400 can fund your marketing budget for the month. Or buy you another month of runway. Or let you hire a part-time contractor to build that feature you've been putting off.

Here's what I'd tell my past self:

Month 1-3: Use whatever model works. Ship fast. Validate the idea. Don't even think about costs yet - you have bigger problems (like finding users).

Month 3-6: You have users now. Look at your AI bill for the first time. Implement model routing (Step 1). Switch simple tasks to Nano or Haiku. This alone will cut your bill by 50-60% in a single afternoon.

Month 6-12: Implement caching, switch to DeepInfra for speech, set up the Batch API for background jobs. By now, your cost per user should be low enough that scaling doesn't scare you anymore.

Month 12+: You're printing money. Your operational costs are lean. Every new user is almost pure profit on the AI side. Now you can reinvest those savings into marketing, new features, or - wild idea - paying yourself more.

The indie hackers who win aren't the ones with the biggest budgets. They're the ones who squeeze the most value out of every dollar. Optimizing AI costs isn't boring backend work - it's a competitive advantage. It's the difference between running out of money in month 8 and being profitable in month 6.

Every dollar you save on infrastructure is a dollar that goes straight to your bottom line. For a solo founder, that's not just a number on a spreadsheet. That's rent. That's freedom. That's another month you get to keep building.

Don't sleep on this.

Good luck guys [🫡](https://abs-0.twimg.com/emoji/v2/svg/1fae1.svg)
