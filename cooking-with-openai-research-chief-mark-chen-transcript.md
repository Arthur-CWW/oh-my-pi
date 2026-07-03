# Cooking with OpenAI’s Research Chief: AGI, o1, Evals, and Scaling Laws — Mark Chen

Source: https://www.youtube.com/watch?v=fpAthTtha8c

Duration: 41:17

Notes: Cleaned from auto-generated English captions. The video description/title were used to correct obvious caption errors such as Mark Chen, Latent Space, o1, SWE-bench Pro, Codex, Lee Sedol, AGI, evals, and flambé shrimp.

## Cleaned transcript

**[00:00:03]**  
**Host:** Cheers.  
**Mark Chen:** Cheers.

**Host:** Hey guys, welcome to the Latent Space Cooking Series, where we invite founders and researchers and just let them cook. Today we have a very special guest: the Chief Research Officer of OpenAI, Mark Chen. Welcome.

**Mark:** Thanks for inviting me, Alan.

**Host:** Thank you for coming. To begin, this all started from the inspiration after hearing a story that Mark Zuckerberg would make soup to try to poach researchers. In response, you brought soup to researchers. Is this true? Did this happen? Did it work?

**Mark:** It’s absolutely a true story. I have brought soup to our own researchers. I think that made us calm down a little bit. I think we came out on top. But it’s still a very funny story in the craziness of how AI has evolved.

**Host:** How often do you cook? Is it something you’re familiar with?

**Mark:** I do enjoy cooking, but I don’t have the luxury of doing it often. I usually have a work dinner every night of the week. Maybe post-AGI, this is going to be my hobby. I’ve always joked I’m going to start a noodle stand once it’s all over.

**Host:** Looking at what we have in front of us, do you have an idea generally of what we’re making?

**Mark:** Korean tofu soup, maybe?

**Host:** Yeah, that’s generally what it is. We were inspired by the story of you bringing soup to researchers, so we’re making a Korean tofu stew, and then we have prawns that we’ll be cooking. Are you ready to go?

**Mark:** Yeah, let’s do it.

---

**[00:01:32]**  
**Host:** The first thing we should do is separate the vegetables and cut them. Basically, we want to cut the dirty part off, with the dirt, and then separate them across.

**Mark:** That I know.

**Host:** While that’s going, I’ll ask more about your background. In a previous life, you were once a trader. Sam also tweeted that if you’re a high-frequency trader, you should consider joining OpenAI to build AGI. Do you think there’s a relation between being a trader and being a researcher, or is it just a very technical and competitive area where a lot of great employees can come from?

**Mark:** The most important thing is that a lot of researchers started out without formal training in machine learning or AI research. We very much believe in training people up to do this.

The real hard thing is the ability to creatively solve problems and think outside the box. It’s not so much that you have to do a PhD, even though that brings a valuable skill set.

With trading in particular, I don’t know that it’s that special of a profession. We’ve had great mathematicians join, great physicists join. But trading is something where it’s very unhackable. You can’t cheat the real world. It’s a hard metric to optimize.

There are also characteristics where attention to detail really matters. It’s brutal hard optimization — squeezing the juice out of a system. Some of those skills transfer over.

---

**[00:03:17]**  
**Host:** For people who want to get into research who don’t have a PhD, what are the main attributes or things they can learn to develop research taste?

**Mark:** I think research taste is a little overrated. It is something you have to develop, but the best mechanism I’ve found is replication.

Take papers that you really look up to and try to fully replicate them. A lot of replication stood out in my mind. Back in 2018, there was ResNet, PixelCNNs — I learned so much trying to replicate the training curves exactly, getting to the exact training loss or perplexity the papers hinted toward.

It teaches you a lot of techniques people don’t really talk about. Once you dive a couple layers deeper, you learn those techniques.

The first thing that got me into the field was when AlphaGo played Lee Sedol. That was the turning point for so many people. It was inspirational. The first big project I really went after was: can I get a DQN working?

**Host:** Move 37 was insane to watch. It’s crazy seeing where we’ve gotten today.

**Mark:** Isn’t it crazy that you’re seeing Move 37s in almost every field now? There are Move 37s in math, in computer science, in coding. It feels like a lot of people woke up at the start of this year and realized agents are working in their profession. They’re realizing these models can do long-horizon, meaningful work for them.

---

**[00:05:17]**  
**Host:** Next, we’ll dice the onion. Do you think there are jobs where RL will have a much harder time breaking in? Coding may be easier because the context is accessible — codebases, the work you’re trying to do. But for something like a junior consultant, where the context is scattered, maybe it’s more difficult. How do you assess those scenarios?

**Mark:** RL has traditionally had headwinds in fields that are more subjective than objective.

One example is creative writing. You can take two pieces of creative writing and two experts can have wildly different opinions. In fields where things are hard to grade, RL has the least ability to directly apply.

A lot of people are developing techniques to apply RL in those settings. But for now, where there’s cold hard truth — math and computer science, where you implement something correctly or wrong — that’s where you see it really taking off.

---

**[00:06:43]**  
**Host:** As models get much more powerful and saturate benchmarks like IMO questions, how do you evaluate superhuman intelligence? How do we push past the frontier when models are better than the top 0.1% of humans?

**Mark:** A lot of it centers on interfacing with the real world.

When we’ve thought about how to evolve past programming contexts, a lot of the initial direction was moving to real-world research. We’ve seen models get better at discovering novel theorems and pushing the frontiers of hard sciences.

Even today, that’s no longer a surprise. We almost take it for granted that these models can solve very difficult problems, make contributions, and draw novel, insightful relationships between fields.

We think of coding and coworking as domains that test if our models can learn in high-context settings and in real-world, long-horizon settings.

---

**[00:08:11]**  
**Host:** Since the vegetables are done, we’ll sauté them. We’ll use the induction stove.

**Host:** On research views: are there commonly accepted ideas you disagree with? Things like “pre-training is dead” or “language models will never get us to AGI”?

**Mark:** I firmly believe in the exponential and in scaling laws. Any of those bear takes, I fairly strongly disagree with.

When it comes to “pre-training is dead,” that narrative only started spreading more widely in the last one or two years. But many times in the history of developing LLMs, people have said this. There have always been bottlenecks where people said, “You can’t scale past this because of this bottleneck.”

We’ve always found some technique — better engineering, a new research insight — that helps break past the boundary. It’s more of the same: more careful research engineering, more careful data engineering, more careful scaling. It always unlocks the next ability to scale further.

It’s held for almost 10 orders of magnitude. There’s no reason it should not keep holding.

---

**[00:10:15]**  
**Host:** Were there specific research bets that helped you scale beyond, where people said, “This isn’t going to work”?

**Mark:** Reasoning is one of the biggest examples. The first breakthrough we launched to the world was o1, but it wasn’t easy to get that off the ground.

The world we were living in then was one where pre-training plus post-training felt like such a promising paradigm. Even at OpenAI, people naturally asked: why do something else when you have a machine that works?

It’s to the credit of Jakub, Ilya, and many people who had conviction and vision in this space that we started pushing on this in earnest. Even then, it took a lot of steering to get the whole company behind this as a fundamental bet.

---

**[00:11:11]**  
**Host:** How do you develop the ability to motivate researchers? Some bets will pan out, but how do you build trust in the team that eventually some will have power-law effects?

**Mark:** What’s cool about OpenAI is that research feels like a meritocracy.

Often, the research managers are people who have done the best research in the past. A lot of steering can come top-down. If your manager says, “I’m really convinced this is the path forward,” people take that into heavy consideration, because this is someone whose research taste and execution they’ve respected for a long time.

At the same time, OpenAI has bottom-up elements. We like to be convinced that we’re wrong. Someone can come with cold hard evidence, and many things like that have turned into core parts of our research roadmap — things no one was steering, but where a researcher on the ground had heavy conviction. That’s a big delight to see.

---

**[00:12:22]**  
**Host:** You’ve said your internal research roadmap hasn’t really changed, even with model development and other companies. How often do you reassess it?

**Mark:** The high-level research roadmap should be stable. People need something to ground in. People need to see a path to what we’re building.

But implementation details can change over time. Sequencing matters, relative resourcing matters, and the exact threats on the ground matter.

We have points in time that force us to reconsider these things. One example is compute allocation. Part of the job is figuring out how to allocate compute to projects. That’s a time to ask: are we putting compute and people toward the highest-priority events?

At the highest level, we have an org that focuses on pre-training — giving models world knowledge. We focus on RL — teaching models how to reason with that knowledge and chain insights together. And then alignment and post-training.

We’re always looking at both how to scale the mainline in each of these domains and also new bets that unlock different or more aggressive scaling properties.

---

**[00:14:32]**  
**Host:** Every one to two months, you go through hundreds of research projects that could be followed through on. How do you hone that decision-making?

**Mark:** In the spirit of focus, we’re focusing our bets at OpenAI and doing more directive compute allocation.

I don’t like micromanaging managers. It’s important to empower them. But you can give big swaths of compute to the big bets you want to make, and also give them flexible pools of compute they can freely allocate to things they believe in, or use to adjust the allocations we prescribe.

It’s tying a small number of bets — say three to five bets from each org — into the main research roadmap, then letting the managers and org leads take things from there.

---

**[00:15:31]**  
**Host:** For rising researchers, in an interview setting, are there tells that someone has potential to impact an org? Or is it mostly their previous research?

**Mark:** It’s a hard problem before someone comes to OpenAI.

For the best research managers, they’ve worked with so many researchers over time that they develop an intuition. The things someone says, the ideas they bring up — do they hit the same mark? Are they the things you would be thinking about personally?

There’s a gut check: does their intuition match the intuition you have?

But it’s really hard to tell out of the gate. Usually in six months to a year, it’s pretty clear who has the strongest trajectory and who’s going to make a lot of impact.

Not every researcher is the same. There are many types of impact. Some people take a clear idea and implement it before anyone else. Some people come up with crazy, almost too-crazy moonshot ideas — but somehow not that crazy — and convince you of a different way of seeing the world. There are many ways to make impact.

---

**[00:17:43]**  
**Host:** Are there similarities between top engineers and top researchers?

**Mark:** The thing about research is that the path forward is often unclear. What differentiates researchers is how often they’re pointed in the right direction — research taste.

In engineering, there are patterns that work. If you want to build a product that looks a certain way, the engineering principles can be pretty similar.

For research, what’s different is the ability to have good research taste, to convince other people that what you’re doing is promising, and then integrate it into the core research roadmap.

---

**[00:18:54]**  
**Host:** We’re going to pour water into the pots to get the base of the soup going. While this simmers, we’ll cook the prawns.

One area that seems interesting is evals. Have there been instances where vibe checks suggest a model is really good, but benchmarks are poor? Or are benchmarks like SWE-bench Pro heavily correlated with your vibe check on coding tasks?

**Mark:** There is this phenomenon — internally, I’m not sure if this is an externally used word — of “benchmaxing.” You can overfit onto certain distributions, and it won’t reflect how well you generalize.

Easy ways to do this: take a benchmark, find very similar types of instances to the benchmark, and overtrain on those instances.

The other scary thing in the field is that the number of canonical gold-standard benchmarks is low. We’re really in an evals crisis. All the great evals we grew up with, like the SAT, are fully saturated. We need good new ways to benchmark models.

One great thing about tools like Codex is that they enable fast iteration on evals. One person can very quickly put together a high-quality eval.

Another interesting thing about deploying models is that you can see them evaluated as people use them. In math, coding, and software, you get a sense for where they fall over and what task horizon they can handle from broad deployment.

---

**[00:21:27]**  
**Host:** How do you balance doing well on benchmarks but not “benchmaxing”? If your score is lower than a competitor’s, consumers may think the model isn’t good.

**Mark:** You have to operate over representative mixtures of evals and always invest in creating new evals.

There’s a philosophy that once an eval is out in the world, it’s already not a good eval. Another thing is partnering with external organizations to create evals. In hard math and science evals, we’ve partnered with external organizations that can craft gold standards.

There’s an interesting philosophy: separate the teams creating evals from the teams optimizing the models. The evals team is trying to build evals that are hard for the model. There’s an adversarial process, and the incentives are aligned in the right way.

**Host:** Do you contribute to deciding what evals to develop?

**Mark:** Yes. A lot of the work Jakub and I do involves steering the direction evals go. We notice gaps or capabilities we want. Every capability, on the flip side, needs an eval that measures whether you’ve elicited that capability well.

---

**[00:23:43]**  
**Host:** You said in a previous interview that Jakub is a very funny guy. Do you have any fun stories?

**Mark:** He told me a joke yesterday that I thought was very funny.

In many ways, we jointly manage the research efforts. Apparently, some researcher came up to him and said, “It feels like I now just have an army of really dumb IMO gold medalists.” And Jakub was like, “That feels like the situation I’m in in real life.”

He’s brutally sarcastic and funny.

---

**[00:24:33]**  
**Host:** Models can perform very well on IMO or IOI but struggle with mundane tasks humans can easily do. How do you deal with that?

**Mark:** What’s intuitive for models is often not intuitive for humans.

There’s the jagged frontier analogy: some things the model is inherently good at, maybe based on the data it sees or what we can teach it easily.

A lot boils down to context. Models don’t have a lot of context that humans have. Vision is more naturally biologically wired for humans.

There are jagged capabilities that models are better at than humans and vice versa. But context — being able to take a single task, learn lessons from it, and apply them to future tasks — is something many people are working toward. It’s very natural for humans.

---

**[00:25:52]**  
**Host:** On context: a low-hanging fruit example is increasing the context window. But there’s complexity. Even with a large context window, there can be bloat or context rot. How do you navigate that?

**Mark:** The canonical way to solve very long-horizon learning is to naively increase the context window. That makes sense.

But there’s a difference between implementing long context and implementing long context well. There are “needle in the haystack” style evals to measure that.

Beyond that, there are engineering and research shortcuts. Many coding products today have features like compaction, where you compress insights or working state. That shortcuts a lot of the brutally difficult and expensive primitives you’d need to build with native long context.

---

**[00:27:11]**  
**Host:** Now we’re doing the fun part. We’ll lower the heat, add more oil, and torch the shrimp to get more flavor. I’ll show you first.

**Mark:** One-shot learning.

**Host:** Exactly. Pour a little bourbon in, heat is off, then torch it.

**Mark:** Awesome. I think I got this.

---

**[00:28:31]**  
**Host:** In terms of research ideas, do you think there’s still a lot of low-hanging fruit — optimizing small parts of existing work — or do we need completely new bets?

**Mark:** There are new bets, but probably not that many.

Hopefully you feel like AGI is coming soon. Everyone sees these models are getting really capable. If you imagine the implications, we’re getting closer to a world where models can come up with more innovations on their own. They can do self-sustained research. This is one of the big goals we’ve set for our research work.

What really matters is whether there are big bets before that point in time. I think the window is small, but there are still some fairly significant ideas we’re trying.

**Host:** Some researchers say to get to AGI, we still need two or three breakthroughs — continual learning or other ideas. Do you share that view?

**Mark:** I don’t know if I share that framing. Continual learning is a basic primitive you have to unlock, but there are many techniques. We’re trying a lot of adaptations of it. I don’t know what counts as a breakthrough versus not. But there are clearly many shots on goal, and I’m pretty sure it’ll work.

---

**[00:31:32]**  
**Host:** We have our shrimp cooked and some fire. Now we add the vegetables to the water.

**Mark:** I’m impressed by your multitasking abilities. That’s one thing we need our models to get better at: doing a thread like this and also having a conversation with people.

**Host:** Do you think images, audio, video, and text should all be under one model, or will there be specialized audio models, video models, etc.?

**Mark:** For a research lab, there are a lot of advantages to having it under one model.

You only have to maintain one infrastructure stack. The cost of maintaining and scaling many infrastructure stacks at once is something you shouldn’t underestimate.

There are benefits to doing core research in your fundamental stack and having that carry over to whatever modality or thing you want. We have a strong bias to keep it in as few architectures as possible.

---

**[00:32:34]**  
**Host:** You’ve mentioned “vibe researcher.” We have vibe coders, obviously. What’s the end state of vibe researching? Is the main value research taste — coming up with the right idea — or execution?

**Mark:** We’re moving toward this world very quickly.

At OpenAI and other labs, a lot of work is becoming orchestration-focused. The researcher comes up with ideas, and the model is good enough to do the implementation and execution by itself.

Both ideas and execution are still important, but there’s a marked shift toward being able to come up with lots of ideas while the model does the execution and orchestration.

Earlier we said models don’t quite have taste yet. That’s why you still need researchers coming up with ideas. It’s hard to teach models good taste. But in terms of accelerating research, there are already clear tangible benefits.

**Host:** Do you think there will ever be parity in research taste with models?

**Mark:** I think so. In our three-year roadmap, the end goal is models doing end-to-end research. Part of that problem is being able to have the model come up with good taste: you point it at a generic benchmark or something, and it finds the right solutions.

---

**[00:34:34]**  
**Host:** How do you handle postmortems when a research bet doesn’t turn out well?

**Mark:** That’s a big part of OpenAI’s alpha.

One thing that differentiates us from other labs is that we take a lot of high-risk bets. It’s allowed us to stay at the frontier consistently over time. But it also means some bets won’t pan out.

When a bet doesn’t pan out, you can’t delude yourself into thinking it will work. You have to disconnect from it. You look back and say, “This was promising at the time, but it’s less important than we thought,” or “Some other approach works better.”

A lot of that work is still fruitful. Even when people fail to prove out a technique, their writeups are very important. Often it’s a natural idea, and you can save a lot of people from going through the same thing.

---

**[00:36:00]**  
**Host:** How do you balance a positive view on failure with a researcher who takes consecutive bets and none pan out?

**Mark:** I’ve seen people fall into this. But I’ve also seen cases where bet after bet doesn’t pan out, and just when you’re at the brink of frustration, they have a mega-hit.

It depends on whether the ideas themselves are sound. They can be ambitious, but they still have to be sound. Some people take a lot of ideas on the riskier frontier, and that’s okay because they only have to justify it once in a while for it to make sense.

Maybe that’s a very trading-like lens on the world, but on expectation, they need to add value.

---

**[00:37:05]**  
**Host:** We’re basically assembled. Now it’s finishing touches. Taste your soup and add soy sauce if it’s not salty enough. If it’s too salty, add water.

**Mark:** It’s pretty good. Healthy.

**Host:** How did that feel?

**Mark:** This is student distillation. You’re clearly better than I am at this point.

**Host:** No, you did a great job, especially with the shrimp and flaming.

---

**[00:37:39]**  
**Host:** More generally, are there areas in research that are overrated or underrated?

**Mark:** If you still have a “pre-training is dead” view of the world, I think pre-training is definitely not dead. It’s underrated.

Honestly, products and thinking about end uses — how you tie all the primitives you build in research to real agentic use cases in the world — are also underrated. You can’t just build everything in a vacuum and not connect it to utility.

---

**[00:38:39]**  
**Host:** We’re ready to taste. We have our shrimp.

**Mark:** Cheers.

**Host:** Cheers. It may be a little sweet.

**Mark:** It’s good for me.

**Host:** Sean, do you want to come taste our tofu soup?

**Sean:** Smells so good. By the way, you guys can’t smell it.

**Host:** We’ll pretend you’re a researcher being approached. I’m Zuck, and Mark is trying to get you with soup.

**Sean:** Soup is really going to sway a decision here.

**Host:** What was the artistic direction?

**Mark:** Mimicry, I think.

**Host:** Just letting them cook.

**Sean:** Good. Strong. The savory and spice go together, and the seafood flavor really goes into it.

**Host:** Are you supposed to pick a winner?

**Mark:** This is an eval.

**Host:** Yes. SWE-bench.

**Sean:** External evals. I’ve got to say, I feel like there’s too much water in this one. I’d go for this one. You’re our respected guest, but I want to be objective. The density of flavor really matters. I’d do half the water.

**Mark:** Makes sense. It’s personal taste.

**Host:** Even with cooking, taste matters.

**Mark:** I know a couple recipes. I follow them to the T. If you tell me to cook something slightly different, I’m completely lost.

**Host:** I’m not going to lie — I looked up a couple things in ChatGPT beforehand as prep.

**Mark:** No worries.

**Host:** It was great having you. You’re leading the field with a lot of research taste, and it’s great seeing the work. Hopefully it was fun.

**Mark:** A lot of fun.
