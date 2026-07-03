# The Easiest Way to Build an AI Influencer That Sells Your App (or Any Product)

- Author: Alex Nguyen / @alexcooldev
- Source tweet: https://x.com/alexcooldev/status/2045853080034672683
- X article: https://x.com/i/article/2045839989607641088
- X article alias: https://x.com/alexcooldev/article/2045853080034672683
- Extracted: 2026-06-03T14:13:23.643150+00:00

## X/Grok summary

- Apps like looksmaxing, height growth, hair growth, and weight loss generate strong revenue by building armies of AI influencers on TikTok, driving $20k–$40k/month organically from one app with high profit margins.

- Design consistent character using JSON prompt from Nano Banana by reveng successful looksmaxing accounts via Claude, including negative constraints for realistic bedroom selfie vibe and tired, serious mood.

- Animate with restraint in Veo 3 using minimal micro-motion like slow head tilt or subtle blink to avoid face morphing, then stitch short clips for implied transformations.

- Add hook with Arcads AI voiceover using casual script under 15 seconds, specific numbers, and DM CTA to match detached confidence and drive installs.

- Funnel works through bio CTA, pinned videos, and DM replies that turn curiosity into app downloads and subscriptions without hard selling.

## Cover

![cover](https://pbs.twimg.com/media/HGRS8NfbwAAMIpj.jpg)

## Full text

As you’ve seen, apps like looksmaxing, height growth, hair growth, weight loss, etc. are performing extremely well with AI influencers. These apps generate strong revenue and profit compared to typical apps by building an army of AI influencers on TikTok.

And today, I’ll guide you step by step on how to create a workflow for an AI influencer. Now, first, let’s take a look at the AI influencers below.

![X article media 2045840859544109056](https://pbs.twimg.com/media/HGRJbCQbQAAorY5.jpg)

![X article media 2045840915546374144](https://pbs.twimg.com/media/HGRJeS4aAAA1lhd.jpg)

![X article media 2045840978322587648](https://pbs.twimg.com/media/HGRJh8vbAAAg4pv.jpg)

![X article media 2045841067409547264](https://pbs.twimg.com/media/HGRJnInaIAAQ_EA.jpg)

![X article media 2045841712984244224](https://pbs.twimg.com/media/HGRKMtkaQAALnm1.jpg)

All of these AI influencers are promoting a single app, and that app is making $20k/month (Usually, Sensor Tower estimates with small app revenue about 1.5x–2x lower than the actual numbers, so the real revenue could be around $30k–$40k/month) and it’s all from organic content. (That’s crazy, because without running ads and just building an army of AI influencers, the profit margins are extremely high)

So now I’m going to guide you step by step on how to create an AI influencer like this.

## Step 1: Design the character with a JSON prompt (Nano Banana)

The failure mode for 90% of AI influencer attempts: the face changes every post.

Day 1 he has a strong jaw. Day 3 his nose is different. Day 5 he looks 10 years older. Viewers notice instantly and the account dies.

The fix is treating your character like a brand spec. Not a prompt, a schema.

Pro tip before you start writing the spec from scratch: you don't have to. Find a looksmaxing account whose aesthetic is already working (high likes, strong engagement, clean visual identity) and download their TikTok slideshow images. Drop those images into Claude and ask it to generate a structured JSON prompt that captures the character, lighting, mood, and camera style. You get a battle-tested aesthetic spec in 30 seconds instead of guessing what "looksmaxing lighting" means.

This is reveng at its finest. The algorithm already told you which faces and which lighting work, you're just extracting the recipe. From there, tweak the JSON to make the character your own (different face structure, different hair, different wardrobe) while keeping the proven aesthetic dialed in.

Here's what a good spec looks like once you have it:


Result:

![X article media 2045846042189668353](https://pbs.twimg.com/media/HGROItHaoAEPqlS.jpg)

Read the negative constraints again. This is where most people lose.

Looksmaxing content does NOT look like a model shoot. It looks like a 19-year-old took a selfie at 2am in his bedroom. If your output looks like a Calvin Klein ad, it reads as fake instantly. "No CGI skin. No airbrush. No perfect symmetry. No model smile." These make the character feel like a real kid, not a stock photo.

The "mood" field is underrated. Looksmaxing aesthetic is tired, serious, slightly detached. Not happy. Not energetic. The face does the selling the vibe has to match or the account feels off.

Once you have this spec locked, you can generate:

- Bedroom selfie, overhead light, tired stare
- Car mirror selfie, golden hour, slight smirk
- Bathroom mirror, harsh fluorescent, side profile
- Gas station at night, flash on, backwards cap
Same character. Different scenes. That's your content library.

## Step 2: Animate with restraint (Veo 3)

Looksmaxing videos are 90% static face + 10% micro-motion. That's the formula.

Feed your Nano Banana image into Veo 3 with a minimal motion prompt:

- slow head tilt to reveal jawline
- slight blink, no smile
- subtle camera drift (as if phone is propped)
- barely visible breath
Do NOT write prompts like "character walks into frame and turns to camera with a smile." Veo 3 will morph the face mid-motion and you lose the character. Every frame of motion is a chance for the identity to break.

The trick is to think like a TikTok editor, not a film director. Looksmaxing clips are:

- 2-4 seconds of a still face
- A slow zoom on the jaw or side profile
- A single head turn at the end
- Text overlay doing the actual narrative work
Your video doesn't need to "do" anything. The caption does the work. "They said I was mid at 16. Now I mog them all." The video just has to be the face, staying in character, for 10 seconds. Veo 3 is perfect for this if you don't over-prompt it.

Pro move: generate 3-4 short clips of the same character in different lighting, then stitch them as a "transformation" montage. 2 seconds of "before" vibes (dim, slouched, tired) → 2 seconds of "after" vibes (harsh light, chin up, serious). The viewer's brain fills in the story. You didn't animate a transformation you implied one.

## Step 3: Add the hook with voice (Arcads AI)

Most looksmaxing accounts don't even use voice. They use text overlay + trending audio.

But when voice works, it crushes. Especially for the "DM me your score" angle.

Feed your Veo 3 clip into Arcads. Script stays under 15 seconds. Write it like a TikTok hook, not an ad:

> "Bro everyone's been asking what app I use to rate my face. It's called [app]. Scored a 7.2 last week, now I'm locked in. Link's in bio, DM me your score."

Three things to get right in the script:

1. Open with "bro" or "ngl" or "gang." Matches the demographic. Formal openings kill the vibe.

2. Drop a specific number. "Scored a 7.2" is 10x more credible than "got a good score." Numbers make it feel real.

3. End with the CTA wrapped in social proof. "DM me your score" is a challenge, not a sales pitch. It makes the viewer want to compete.

Arcads handles voice + lipsync. Pick a voice that matches the character — young, slightly monotone, a little raspy. NOT an announcer voice. NOT a hype voice. Looksmaxing voice is detached confidence.

## The funnel: what actually prints installs

Content is the top of funnel. Here's the rest of the Jake_Ryder playbook:

Bio structure:

- Scripture or aspirational quote (builds "real person" trust)
- One-line CTA: "Download [App] and DM me your score"
- Linktree with one link
Pinned content:

- 3 pinned videos is the standard. Highest-view clip + most emotional hook + strongest transformation.
- Pin the ones with the highest DM conversion, not the highest views.
DM funnel:

- Viewer downloads app, gets their rating, DMs you
- You reply with a compliment + a tip that hints at the app's premium features
- Soft push to subscription or affiliate link
This is why looksmaxing apps pay creators (real or AI) so well. Every install is a potential subscriber. Every DM is a warm lead. The character doesn't need to sell it just needs to exist and make viewers curious enough to download the app and see their own score.

You can check out how to create an AI workflow here, I’ve made a post about it and included a video.


This post is sponsored by Arcards AI, so you can still look for similar tools that fit your needs. [💪](https://abs.twimg.com/emoji/v2/svg/1f4aa.svg)
