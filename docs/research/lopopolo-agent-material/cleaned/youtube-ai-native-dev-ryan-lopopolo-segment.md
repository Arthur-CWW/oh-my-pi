---
title: "What OpenAI, Stripe & ElevenLabs Devs Do Differently Now | AI Native Dev"
source: "https://www.youtube.com/watch?v=OfsWo6zyt-4"
canonical_url: "https://www.youtube.com/watch?v=OfsWo6zyt-4"
video_id: "OfsWo6zyt-4"
source_type: "youtube_transcript"
event_type: "event_interview_segment"
transcript_scope: "segment"
speakers:
  - "Ryan Lopopolo"
  - "Simon Maple"
direct_source: true
third_party_summary: false
retrieved: "2026-06-07"
published: "2026-04-28"
upload_date: "20260428"
channel: "AI Native Dev"
uploader: "AI Native Dev"
duration: "1:05:52"
duration_seconds: 3952
captions_source: "auto"
captions: "auto-generated English captions via yt-dlp"
selection_notes: "Direct AI Native Dev event interview segment with Ryan; transcript is clipped to Ryan segment to avoid unrelated speakers."
segment:
  label: "Ryan Lopopolo on harness engineering at OpenAI"
  start: "00:26:10"
  start_seconds: 1570
  end: "00:35:02"
  end_seconds: 2102
---

# What OpenAI, Stripe & ElevenLabs Devs Do Differently Now | AI Native Dev

## Description

How aligned are teams at Google DeepMind, OpenAI, Stripe, and ElevenLabs on what’s changing in software development?

At AI Engineer London, with 100+ speakers and 1000+ engineers in the room, Simon Maple pulls together perspectives from across the ecosystem to understand where AI-native development is heading.

• why traditional CI/CD “is dead”
• the growing need for automated code review and guardrails 
• the move from more context is better to right context at the right time
• the difference between general-purpose models vs specialized domain models 

To catch conversations like these in person, register for AI DevCon in London on 1st and 2nd June 2026. https://tessl.io/devcon/

(00:00) Trailer
(01:00) AI Native DevCon
(01:54) AI Engineer
(02:37) Steve Kaliski on Stripe's coding agents
(08:24) Madison Faulkner on why CI/CD is dead
(16:48) Omar Sanseviero on Gemma and open models
(22:55) The ElevenLabs phone booth
(23:17) Boris Starkov on voice AI at ElevenLabs
(26:10) Ryan Lopopolo on harness engineering at OpenAI
(35:02) Jordan Juritz on AI in UK government
(45:43) Nupur Sharma on code reviews at Qodo
(53:23) Cameron McLoughlin on Zed IDE
(58:49) Nick Arcolano on engineering metrics at Jellyfish
(01:04:43) Wrap-up

## Transcript

**Segment:** Ryan Lopopolo on harness engineering at OpenAI (00:26:10-00:35:02)

[00:26:24] >> Yeah, excited to be here in London. It's been a It's been a great crowd. And uh where are you based normally? Uh Seattle. Seattle. Oh, okay. So it's a bit of a trip bit of a trip for you. Um so uh Ryan, first of all uh what are you talking on here today? Uh talking about harness engineering and sort of the arc of implementation that my team and I have been on over the last 9 months to remove ourselves from the process of writing code as much as possible. I kind of have like banned my team from opening their editor and it's been wild to see how quickly we've been able to stack capability into the code base to let agents do more and more of the software job. And that's really interesting cuz you'll get you'll get different types of developers. Some who like that scares them completely. Like I don't my god, that's my that's my happy place, you know, in an IDE writing code.

[00:27:06] But realistically, I think there's going to be different types of developers. Those that who are creators that will absolutely love this because the the the job of writing code can be happen faster and it can get taken away from them and they can create faster. What's your reaction to the or or I guess what's your team's reaction to whipping out the IDE from underneath them? I am a a Rubius. Ruby was my first love, so meta programming is kind of a thing that is like in my bones, right? I want to kind of lift myself up a level, use high-level extractions to kind of do the job for me. And I do feel like the harness engineering is really similar to this, right? I am working through a super high-level primitive in a coding agent to do the code production itself. So the levers I have around me are different.

[00:27:48] Uh it's all around refining output rather than generating it directly myself. >> Right. A trick that I have used though is to just my team is all external hires and they just go full yolo insane into this thing. This is the way we do it. This is why we're at a frontier lab to invent the future. Amazing. So talk us through some of the some of the principles of harness engineering then.

[00:28:08] Fundamentally, the models are limited on two things, attention and context. In order to maximize attention and limit context, we want the code, the process, the test to be the same as much as possible, and we want the agents to largely cook with the minimum amount of instructions, giving it context just in time in order to efficiently respect that context and let it operate over very long time horizons.

[00:28:34] Instead of front-loading all the context into agents.md, I want to just-in-time inject how to remediate a linter failure at the time it happens. And this allows us to have like much wider periods of black box behavior where the agent is reasoning and cooking and writing code and resolving its own failures, which allows me to kind of look at the beginning and the end of a task rather than the messy middle sort of thing.

[00:28:58] >> Yeah, interesting. And And so how is that done then? Is that done through skills and things like that? Some Some of that almost like progressive disclosure of context into the agent? >> That's right. That's right. Uh we use skills for this. We actually uh have very few skills in the code base that we want to centralize around. I think we have five or six. All the engineers on the team contribute to those. And this way we can kind of optimize the human involvement in the process to not have to change too much. We have a fixed number of entry points into the model.

[00:29:23] Uh and then it's all about figuring creative ways to inject prompts into context, right? Those skills are prompts. Error messages from tests are prompts. Review feedback, which comes mostly from agents, also are prompts. Uh and it's all about getting them just-in-time injected and making sure that they are somewhat reliably followed, right? Like the models create text, we need to figure out ways to give them text.

[00:29:48] So in order for this to be successful, does it reflect that it's all about the skills being accurately written accurately crafted so that the so that the agents are are are are essentially guided in the right way? Otherwise, they're never going to get to that end point. Yeah, yeah, yeah. This is why uh I don't really use plan mode very often because >> I'm hearing that more and more actually.

[00:30:10] It's surprising, right? >> these big plans that I like really don't want to review and I hit yes to accept them. But if those plans actually encode instructions that are wrong, like I'm pushing the agent in the wrong direction. >> we learn as we go that will actually affect how we've done that original planning. Yes. Very interesting. Well, the the time I want to spend is on like the most ambiguous hardest work over the course of building a product, right? And I don't necessarily know the right shape at the beginning. And the agents operate the same way when they're writing code for a PR. We want them to kind of figure it out as they go to kind of go from a lot of white space in front of them to a nice refined high quality output.

[00:30:49] >> Yeah. And getting feedback along the way is a big part of that. Amazing. Now, you're also going to be talking about exactly this topic at AI and Native Dev Con which is happening June 1st and 2nd right here in London. Super jazzed about that. >> Which is what? Like less than 2 months away now. So, not too not too far away.

[00:31:06] Um what what is your what is the reaction to to to this session though? You know, when when you present this session, do you are developers typically on board with it? Are they a little bit hesitant with it? Uh I get a mix, right? Folks don't want to move their hands from the keyboard, right? Like there's this fear that the code is going to be misaligned, right? And this maybe feeling that it's going to provide me with more work to clean up the mess afterward. But if you invest your time instead to just simply saying, "I will not accept slop.

[00:31:40] I don't let the agents produce slop and I systematize the reduction of slop." You have kind of accomplished the same goal with much fewer synchronous attention cycles from yourself. >> Mhm. You want to kind of think like a staff engineer and you have five or 50 engineers at your disposal. And with that amount of resources, there's a lot of damage you can do in sort of reducing bad code from being produced.

[00:32:03] >> Yeah. Rather than having to shoulder surf along the way. >> Yeah. So, let's talk a little bit about your environment. In terms of when you're doing Harness engineering, um what does your environment look like? Presumably you're using Codex? Yes, using Codex. Um >> I'm hearing on on Twitter by the way.

[00:32:16] I'm hearing so many people go like, "Oh my god, Code Codex is just like unlocking me." And it's like I see so many people jumping into Codex right now. It's it's very interesting to see. Codex does the full job. Like I can trust it to go from prompt to merge PR with high quality code reproductions of the work that it has done in the same way I would expect a human, right? Like when I'm working on back-end systems, right? I'm supposed to deploy it to staging.

[00:32:40] My teammates don't like come over to my computer and like look at my command history to see that I deployed to staging. I'm making an attestation in the PR with some proof that shows that I did this, and they largely accept it as true. And Codex is able to operate in the same way, which gives me high confidence that it's able to do the job.

[00:32:56] I see it executing for 6, 12, 30 hours at this insane pace on Twitter where the laptop is buckled in the back seat of my car >> burning tokens as I'm coming to and from work because it is able to do these very complex changes. And the way we do that is Chewie, the web product, the app, which is super super awesome. I love the automations in it. It's constantly cleaning up after itself, you know, every hour making sure my CI is green, making sure that like, you know, we have adhere to our golden principles around what good looks like. I have a sticker on my laptop and it says AI codes while I sleep. AI works while I sleep. We're in that space now.

[00:33:34] capable enough now that that we can do that. Um, we're at AI Engineering, as I mentioned. What is the What is the one thing you want to learn from the AI Engineering conference? Is it chatting to people? Is it What's What's What's What's What's the thing that you want to take away?

[00:33:46] The thing I want to learn is where folks are at with these tools. What will it take them to 10x the level of trust and usage of the model to enable them to build more and more products for the world to like solve more and more user problems, right? Like so much software is yet to be produced that like we now have the option to do because implementation is so cheap.

[00:34:09] So, talking with folks, figuring out where it is they get hung up and how we can bring that to the product is something that I'm super super excited about. Amazing. Right, it's been wonderful chatting with you, and I totally look forward to your session at AI Native DevCon, June 1st 2nd in London as well. So, >> I'll be there. Excellent. Thanks very much.

[00:34:25] Hey everyone. Hope you're enjoying the episode so far. >> Our team is working really hard behind the scenes to bring you the best guests so we can have the most informative conversations about a genetic development. Whether that's talking about the latest tools, the most efficient workflows, or defining best practices. But, for whatever reason, many of you have yet to subscribe to the channel. If you're enjoying the podcast and want us to continue to bring you the very best content, please do us a favor and hit that subscribe button. It really does make a difference and lets us continue to improve the quality of our guests and build an even better product for you. All right, back to the episode. Well, we're here still in the in the expo hall at AI Engineer.
