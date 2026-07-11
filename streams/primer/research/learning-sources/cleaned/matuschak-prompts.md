# How to write good prompts: using spaced repetition to create understanding

- Source: https://andymatuschak.org/prompts
- Author: Andy Matuschak (2020)
- Retrieved: 2026-07-11
- Source type: canonical public web source

---

![](metamorphosis.jpg)

Excerpt from M. C. Escher, *Metamorphosis III* (1968)

## How to write good prompts: using spaced repetition to create understanding

December 2020



Contents

* [The central role of retrieval practice](#retrieval)
  + [Properties of effective retrieval practice prompts](#properties)
* [A recipe for chicken stock](#recipe)
* [Factual knowledge](#factual-procedural)
  + [Simple facts](#simple-facts)
  + [Lists](#lists)
  + [Cues and elaborative encoding](#cues-and-elaborative-encoding)
  + [Interpretation; the “more than you think” rule of thumb](#interpretation)
* [Procedural knowledge](#procedural-knowledge)
* [Conceptual knowledge](#conceptual)
* [Open lists](#open-lists)
* [Salience prompts](#prompting-salience)
* [Prompt-writing, in practice](#prompts-in-practice)
  + [Iterative prompt-writing](#iterative-prompts)
  + [Litmus tests](#litmus)
  + [Revising prompts over time](#revising)

This guide and its embedded spaced repetition system were made possible by a crowd-funded research grant from [my Patreon community](https://patreon.com/quantumcountry). If you find my work interesting, you can [become a member](https://patreon.com/quantumcountry) to get ongoing behind-the-scenes updates and early access to new work.

As a child, I had a goofy recurring daydream: maybe if I type just the right sequence of keys, the computer would beep a few times in sly recognition, then a hidden world would suddenly unlock before my eyes. I’d find myself with new powers which I could use to transcend my humdrum life.

Such fantasies probably came from playing too many video games. But the feelings I have when using spaced repetition systems are strikingly similar. At their best, these systems feel like magic.This guide assumes basic familiarity with spaced repetition systems. For an introduction, see Michael Nielsen, [Augmenting Long-term Memory](http://augmentingcognition.com/ltm.html) (2018), which is also the source of the phrase "makes memory a choice." Memory ceases to be a haphazard phenomenon, something you hope happens: spaced repetition systems make memory a choice. Used well, they can accelerate learning, facilitate creative work, [and more](https://notes.andymatuschak.org/Spaced_repetition_systems_can_be_used_to_program_attention). But like in my childhood daydreams, these wonders unfold only when you press just the right sequence of keys, producing just the right incantation. That is, when you manage to write good prompts—the questions and answers you review during practice sessions.

Spaced repetition systems work only as well as the prompts you give them. And especially when new to these systems, you're likely to give them mostly bad prompts. It often won’t even be clear which prompts are bad and why, much less how to improve them. My early experiments with spaced repetition systems felt much like my childhood daydreams: prodding a dusty old artifact, hoping it’ll suddenly spring to life and reveal its magic.

Happily, prompt-writing does not require arcane secrets. It's possible to understand somewhat systematically what makes a given prompt effective or ineffective. From that basis, you can understand how to write good prompts. Now, there are many ways to use spaced repetition systems, and so there are many ways to write good prompts. This guide aims to help you *create understanding* in the context of an informational resource like an article or talk. By that I mean writing prompts not only to durably internalize the overt knowledge presented by the author, but also to produce and reinforce understandings of your own, understandings which you can carry into your life and creative work.

For readers who are new to spaced repetition, this guide will help you overcome common problems that often lead people to abandon these systems. In later sections, we'll cover some unusual prompt-writing perspectives which may help more experienced readers deepen their practice.If you don't have a spaced repetition system, I'd suggest downloading [Anki](https://apps.ankiweb.net/) and reading [Michael's aforementioned essay](http://augmentingcognition.com/ltm.html). Our discussion will focus on high-level principles, so you can follow along using any spaced repetition system you like. Let's get started.

## The central role of retrieval practice

No matter the application, it’s helpful to remember that when you write a prompt in a spaced repetition system, you are giving your future self a recurring task. Prompt design is task design.

If a prompt “works,” it’s because performing that task changes you in some useful way. It’s worth trying to understand the mechanisms behind those changes, so you can design tasks which produce the kind of change you want.

The most common mechanism of change for spaced repetition learning tasks is called *retrieval practice.* In brief: when you attempt to recall some knowledge from memory, the act of retrieval tends to reinforce those memories.For more background, see Roediger and Karpicke, [The Power of Testing Memory](Roediger2006.pdf) (2006). Gwern Branwen's [article on spaced repetition](https://www.gwern.net/Spaced-repetition) is a good popular overview. You’ll forget that knowledge more slowly. With a few retrievals strategically spaced over time, you can effectively halt forgetting. The physical mechanisms are not yet understood, but hundreds of cognitive scientists have explored this effect experimentally, reproducing the central findings across various subjects, knowledge types (factual, conceptual, procedural, motor), and testing modalities (multiple choice, short answer, oral examination).

The value of fluent recall isn't just in memorizing facts. Many of these experiments tested students not with parroted memory questions but by asking them to make inferences, draw concept mapsSee e.g. Karpicke and Blunt, [Retrieval Practice Produces More Learning than Elaborative Studying with Concept Mapping](Karpicke2011.pdf) (2011); and Blunt and Karpicke, [Learning With Retrieval-Based Concept Mapping](Blunt2014.pdf) (2014)., or answer open-ended questions. In these studies, improved recall translated into improved general understanding and problem-solving ability.

*Retrieval* is the key element which distinguishes this effective mode of practice from typical study habits. Simply *reminding* yourself of material (for instance by re-reading it) yields much weaker memory and problem-solving performance. The learning produced by retrieval is called the “testing effect” because it occurs when you explicitly test yourself, reaching within to recall some knowledge from the tangle of your mind. Such tests look like typical school exams, but in some sense they’re the opposite: retrieval practice is about testing your knowledge to *produce* learning, rather than to assess learning.

Spaced repetition systems are designed to facilitate this effect. If you want prompts to reinforce your understanding of some topic, you must learn to write prompts which collectively invoke retrieval practice of all the key details.

We'll have to step outside the scientific literature to understand how to write good prompts: existing evidence stops well short of exact guidance. In lieu of that, I’ve distilled the advice in this guide from my personal experience writing thousands of prompts, grounded where possible in experimental evidence.

For more background on the mnemonic medium, see Matuschak and Nielsen, [How can we develop transformative tools for thought?](https://numinous.productions/ttft/) (2019).This guide is an example of what Michael Nielsen and I have called a *mnemonic medium*. It exemplifies its own advice through spaced repetition prompts interleaved directly into the text. If you're reading this, you've probably already used a spaced repetition system. This guide's system, [Orbit](https://withorbit.com/), works similarly.If you have an existing spaced repetition practice, you may find it annoying to review prompts in two places. As Orbit matures, we'll release import / export tools to solve this problem. But it has a deeper aspiration: by integrating expert-authored prompts into the reading experience, authors can write texts which readers can deeply internalize with relatively little effort. If you're an author, then, this guide may help you learn how to write good prompts both for your personal practice and also for publications you write using [Orbit](https://withorbit.com/). You can of course read this guide without answering the embedded prompts, but I hope you'll give it a try.



These embedded prompts are part of an ongoing research project. The first experiment in the mnemonic medium was *[Quantum Country](https://quantum.country/)*, a primer on quantum computation. Quantum Country is concrete and technical: definitions, notation, laws. By contrast, this guide mostly presents heuristics, mental models, and advice. The embedded prompts therefore play quite different roles in these two contexts. You may not need to memorize precise definitions here, but I believe the prompts will help you internalize the guide's ideas and put them into action. On the other hand, this guide's material may be too contingent and too personal to benefit from author-provided prompts. It's an experiment, and I invite you to [tell me about your experiences](mailto:andy@andymatuschak.org).

One important limitation is worth noting. This guide describes how to write prompts which produce and reinforce understandings of your own, going beyond what the author explicitly provides. Orbit doesn't yet offer readers the ability to remix author-provided prompts or add their own. Future work will expand the system in that direction.

### Properties of effective retrieval practice prompts

Writing good prompts feels surprisingly similar to translating written text. When translating prose into another language, you’re asking: which words, when read, would light a similar set of bulbs in readers’ minds? It’s not a rote operation. If the passage involves allusion, metaphor, or humor, you won’t translate literally. You’ll try to find words which recreate the experience of reading the original for a member of a foreign culture.

When writing spaced repetition prompts meant to invoke retrieval practice, you’re doing something similar to language translation. You’re asking: which tasks, when performed in aggregate, require lighting the bulbs which are activated when you have that idea “fully loaded” into your mind?

The retrieval practice mechanism implies some core properties of effective prompts. We'll review them briefly here, and the rest of this guide will illustrate them through many examples.

These properties aren't laws of nature. They're more like rules you might learn in an English class. Good writers can (and should!) strategically break the rules of grammar to produce interesting effects. But you need to have enough experience to understand *why* doing something different makes sense in a given context.

Retrieval practice prompts should be **focused.** A question or answer involving too much detail will dull your concentration and stimulate incomplete retrievals, leaving some bulbs unlit. Unfocused questions also make it harder to check whether you remembered all parts of the answer and to note places where you differed. It’s usually best to focus on one detail at a time.

Retrieval practice prompts should be **precise** about what they're asking for. Vague questions will elicit vague answers, which won’t reliably light the bulbs you’re targeting.

Retrieval practice prompts should produce **consistent** answers, lighting the same bulbs each time you perform the task. Otherwise, you may run afoul of an interference phenomenon called “retrieval-induced forgetting”This effect has been produced in many experiments but is not yet well understood. For an overview, see Murayama et al, [Forgetting as a consequence of retrieval: a meta-analytic review of retrieval-induced forgetting](Murayama2014.pdf) (2014).: what you remember during practice is reinforced, but other related knowledge which you *didn’t* recall is actually inhibited. Now, there is a useful type of prompt which involves generating new answers with each repetition, but such prompts leverage a different theory of change. We'll discuss them briefly later in this guide.

SuperMemo's algorithms (also used by most other major systems) are tuned for 90% accuracy. Each review would likely have a larger impact on your memory if you targeted much lower accuracy numbers—see e.g. Carpenter et al, [Using Spacing to Enhance Diverse Forms of Learning](Carpenter2012.pdf) (2012). Higher accuracy targets trade efficiency for reliability.Retrieval practice prompts should be **tractable**. To avoid interference-driven churn and recurring annoyance in your review sessions, you should strive to write prompts which you can almost always answer correctly. This often means breaking the task down, or adding cues.

Retrieval practice prompts should be **effortful**. It’s important that the prompt actually involves retrieving the answer from memory. You shouldn’t be able to trivially infer the answer. Cues are helpful, as we’ll discuss later—just don’t “give the answer away.” In fact, effort appears to be an important factor in the effects of retrieval practice.For more on the notion that difficult retrievals have a greater impact than easier retrievals, see the discussion in Bjork and Bjork, [A New Theory of Disuse and an Old Theory of Stimulus Fluctuation](Bjork1992.pdf) (1992). Pyc and Rawson, [Testing the retrieval effort hypothesis: Does greater difficulty correctly recalling information lead to higher levels of memory?](Pyc2009.pdf) (2009) offers some focused experimental tests of this theory, which they coin the "retrieval effort hypothesis." That’s one motivation for spacing reviews out over time: if it’s too easy to recall the answer, retrieval practice has little effect.

Achieving these properties is mostly about writing tightly-scoped questions. When a prompt’s scope is too broad, you’ll usually have problems: retrieval will often lack a focused target; you may produce imprecise or inconsistent answers; you may find the prompt intractable. But writing tightly-scoped questions is surprisingly difficult. You’ll need to break knowledge down into its discrete components so that you can build those pieces back up as prompts for retrieval practice. This decomposition also makes review more efficient. The schedule will rapidly remove easy material from regular practice while ensuring you frequently review the components you find most difficult.

Now imagine you’ve just read a long passage on a new topic. What, specifically, would have to be true for you to say you “know” it? To continue the translation metaphor, you must learn to “read” the language of knowledge—recognizing nouns and verbs, sentence structures, narrative arcs—so that you can write their analogues in the translated language. Some details are essential; some are trivial. And you can't stop with what's on the page: a good translator will notice allusions and draw connections of their own.

So we must learn two skills to write effective retrieval practice prompts: how to characterize exactly what knowledge we’ll reinforce, and how to ask questions which reinforce that knowledge.



## A recipe for chicken stock

Our discussion so far has been awfully abstract. We'll continue by analyzing a concrete example: a recipe for chicken stock.

A recipe may seem like a fairly trivial target for prompt-writing, and in some sense that's true. It's a conveniently short and self-contained example. But in fact, my spaced repetition library contains hundreds of prompts capturing foundational recipes, techniques, and observations from the kitchen. This is itself an essential prompt-writing skill to build—noticing unusual but meaningful applications for prompts—so I'll briefly describe my experience.

I'd cooked fairly seriously for about a decade before I began to use spaced repetition, and of course I naturally internalized many core techniques and ratios. Yet whenever I was making anything complex, I'd constantly pause to consult references, which made it difficult to move with creativity and ease. I rarely felt "flow" while cooking. My experiences felt surprisingly similar to my first few years learning to program, in which I encountered exactly the same problems. With years of full-time attention, I automatically internalized all the core knowledge I needed day-to-day as a programmer. I'm sure that I'd eventually do the same in the kitchen, but since cooking has only my part-time attention, the process might take a few more decades.

I started writing prompts about core cooking knowledge three years ago, and it's qualitatively changed my life in the kitchen. These prompts have accelerated my development of a deeply satisfying ability: to show up at the market, choose what looks great in that moment, and improvise a complex meal with confidence. If the sunchokes look good, I know they'd pair beautifully with the mustard greens I see nearby, and I know what else I need to buy to prepare those vegetables as I imagine. When I get home, I already know how to execute the meal; I can move easily about the kitchen, not hesitating to look something up every few minutes. Despite what this guide's lengthy discussion might suggest, these prompts don't take me much time to write. Every week or two I'll trip on something interesting and spend a few minutes writing prompts about it. That's been enough to produce a huge impact.

At a decent restaurant, even simple foods often taste much better than most home cooks’ renditions. Sautéed vegetables seem richer; grains seem richer; sauces seem more luscious. One key reason for this is *stock*, a flavorful liquid building block. Restaurants often use stocks in situations where home cooks might use water: adding a bit of steam to sautéed vegetables, thinning a purée, simmering whole grains, etc. Stocks are also the base of many sauces, soups, and braises.

Stock is made by simmering flavorful ingredients in water. By varying the ingredients, we can produce different types of stock: chicken stock, vegetable stock, mushroom stock, pork stock, and so on. But unlike a typical broth, stock isn’t meant to have a distinctive flavor that can stand on its own. Instead, its job is to provide a versatile foundation for other preparations.

One of the most useful stocks is chicken stock. When used to prepare vegetables, chicken stock doesn’t make them taste like chicken: it makes them taste more savory and complete. It also adds a luxurious texture because it’s rich in gelatin from the chicken bones. Chicken stock takes only a few minutes of active time to make, and in a typical kitchen, it’s basically free: the primary ingredient is chicken bones, which you can naturally accumulate in your freezer if you cook chicken regularly.

### Recipe

* 2lbs (~1kg) chicken bones
* 2qt (~2L) water
* 1 onion, roughly chopped
* 2 carrots, roughly chopped
* 2 ribs of celery, roughly chopped
* 4 cloves garlic, smashed
* half a bunch of fresh parsley

1. Combine all the ingredients in a large pot.
2. Bring to a simmer on low heat (this will take about an hour). We use low heat to produce a bright, clean flavor: at higher temperatures, the stock will both taste and look duller.
3. Lower heat to maintain a bare simmer for an hour and a half.
4. Strain, wait until cool, then transfer to storage containers.

Chicken stock will keep for a week in the fridge or indefinitely in the freezer. There will be a cap of fat on the stock; skim that off before using the stock, and deploy the fat in place of oil or butter in any savory cooking situation.

This recipe can be scaled up or down to the quantity of chicken bones you have. The basic ratio is a pound of bones to a quart of water. The vegetables are flexible in choice and ratio.

### Variations

For a more French flavor profile, replace the celery with leeks and add any/all of bay leaves, black peppercorns, and thyme. For a deeper flavor, roast the bones and vegetables first to make what’s called a “brown chicken stock” (the recipe above is for a “white chicken stock,” which is more delicate but also more versatile).

### What to do with chicken stock

A few ideas for what you might do with your chicken stock:

* Cook barley, farro, couscous and other grains in it.
* Purée with roasted vegetables to make soup.
* Wilt hearty greens like kale, chard, or collards in oil, then add a bit of stock and cover to steam through.
* After roasting or pan-searing meat, deglaze the pan with stock to make a quick sauce.

To organize our efforts, it’s helpful to ask: what would it mean to “know” this material? I’d suggest that someone who “knows” this material should:

* know how to make and store chicken stock
* know what stock is and (at least shallowly) understand why and when it matters
* know the role and significance of chicken stock, specifically
* know some ways one might use chicken stock, both generally and with some specific examples
* know of a few common variations and when they might be used

Some of this knowledge is factual; some of it is procedural; some of it is conceptual. We’ll see strategies for dealing with each of these types of knowledge.

But understanding is inherently personal. Really “knowing” something often involves going beyond what’s on the page to connect it to your life, other ideas you’re exploring, and other activities you find meaningful. We’ll also look at how to write questions of that kind.

If you're a vegetarian, I hope you can look past the discussion of bones: choosing this example involved many trade-offs.In this guide, we’ll imagine that you’re an interested home cook who’s never made stock before. Naturally, if you're an experienced cook, you'd probably need only a few of these prompts. And of course, if you don't cook at all, you'd write none of these prompts! Try to read the examples as demonstrations of how you might internalize a resource deeply without much prior fluency.

To demonstrate a wide array of principles, we’ll treat this material quite exhaustively. But it’s worth noting that in practice, you usually won’t study resources as systematically as this. You’ll jump around, focusing only on the parts which seem most valuable. You may return to a resource on a few occasions, writing more prompts as you understand what's most relevant. That’s good! Exhaustiveness may seem righteous in a shallow sense, but an obsession with completionism will drain your gumption and waste attention which could be better spent elsewhere. We'll return to this issue in greater depth later.

## Writing prompts, in practice

### Iterative prompt-writing

This guide aspires to demonstrate a wide variety of techniques, so I've deliberately analyzed the chicken stock recipe quite exhaustively. But in practice, if you were examining a recipe for the first time, I certainly wouldn’t recommend writing dozens of prompts at once like we've done here. If you try to analyze everything you read so comprehensively, you’re likely to waste time and burn yourself out.

Those issues aside, it's hard to write good prompts on your first exposure to new ideas. You’re still developing a sense of which details are important and which are not—both objectively, and to you personally. You likely don’t know which elements will be particularly challenging to remember (and hence worth extra reinforcement). You may not understand the ideas well enough to write prompts which access their “essence”, or which capture subtle implications. And you may need to live with new ideas for a while before you can write prompts which connect them vibrantly with whatever really matters to you.

All this suggests an iterative approach.

Say you’re reading an article that seems interesting. Try setting yourself an accessible goal: on your first pass, aim to write a small number of prompts (say, 5-10) about whatever seems most important, meaningful, or useful.

I find that such goals change the way I read even casual texts. When first adopting spaced repetition practice, I felt like I "should" write prompts about everything. This made reading a chore. By contrast, it feels quite freeing to aim for just a few key prompts at a time.As [Michael Nielsen notes](http://augmentingcognition.com/ltm.html), similar lightweight prompt-writing goals can enliven seminars, professional conversations, events, and so on. I read a notch more actively, noticing a tickle in the back of my mind: “Ooh, that’s a juicy bit! Let's get that one!”

If the material is fairly simple, you may be able to write these prompts while you read. But for texts which are challenging or on an unfamiliar topic, it may be too disruptive to switch back and forth. In such cases it’s better to highlight or make note of the most important details. Then you can write prompts about your understanding of those details in a batch at the end or at a suitable stopping point. For these tougher topics, I find it’s best to focus initially on prompts about basic details you can build on: raw facts, terms, notation, etc.

Books are more complicated: there are many kinds of books and many ways to read them. This is true of articles, too, of course, but books amplify the variance. For one thing, you're less likely to read a book linearly than an article. And, of course, they're longer, so a handful of prompts will rarely suffice. The best prompt-writing approach will depend on how and why you're reading the book, but in general, if I'm trying to internalize a non-fiction book, I'll often begin by aiming to write a few key prompts on my first pass through a chapter or major section.

For many resources, one pass of prompt-writing is all that’s worth doing, at least initially. But if you have a rich text which you're trying to internalize thoroughly, it’s often valuable to make multiple passes, even in the first reading session. That doesn’t necessarily mean doubling down on effort: just write another handful of apparently-useful prompts each time. For a vivid account of this process in mathematics, see Michael Nielsen, [Using spaced repetition systems to see through a piece of mathematics](http://cognitivemedium.com/srs-mathematics) (2019).With each iteration, you’ll likely find yourself able to understand (and write prompts for) increasingly complex details. You may notice your attention drawn to patterns, connections, and bigger-picture insights. Even better: you may begin to focus on your own observations and questions, rather than those of the author. But it’s also important to notice if you feel yourself becoming restless. There’s no deep virtue in writing a prompt about every detail. In fact, it’s much more important to remain responsive to your sense of curiosity and interest.

Piotr Wozniak, a pioneer of spaced repetition, has been developing a system he calls [incremental reading](https://supermemo.guru/wiki/Incremental_reading) which attempts to actively support this kind of iterative, incremental prompt writing.If you notice a feeling of duty or completionism, remind yourself that you can always write more prompts later. In fact, they’ll probably be better if you do: motivated by something meaningful, like a new connection or a gap in your understanding.

Let’s consider our chicken stock recipe again for a moment. If I were an aspiring cook who had never heard of stock before, I’d probably write a few prompts about what stock is and why it matters: those details seem useful beyond the scope of this single recipe, and they connect to happy dining experiences I’ve had. That’s probably all I’d do until I actually made a batch of stock for myself. At that point, I’d know which steps were obvious and which made me consult the recipe. If I found I wanted to make stock again, I’d write another batch of prompts to recall details like ingredient ratios and times. I'd try to notice places where I found myself straining, vaguely aware that I'd "read something about this" but unsure of the details. As I used my first batch of stock in subsequent dishes, I might then write prompts about those experiences. And so on.



### Litmus tests

While you’re drafting prose, a spell checker and grammar checker can help you avoid some simple classes of error. Such tools don't yet exist for prompt-writing, so it’s helpful to collect simple tests which can serve a similar function.

**False positives:** How might you produce the correct answer without really knowing the information you intend to know?

*Discourage pattern matching.* If you write a long question with unusual words or cues, you might eventually memorize the *shape* of that question and learn its corresponding answer—not because you’re really thinking about the knowledge involved, but through a mechanical pattern association. Cloze deletions seem particularly susceptible to this problem, especially when created by copying and editing passages from texts. This is best avoided by keeping questions short and simple.

*Avoid binary prompts.* Questions which ask for a yes/no or this/that answer tend to require little effort and produce shallow understanding. I find I can often answer such questions without really understanding what they mean. Binary prompts are best rephrased as more open-ended prompts. For instance, the first of these can be improved by transforming it into the second:

> Q. Does chicken stock typically make vegetable dishes taste like chicken?
>
> A. No.
>
> Q. How does chicken stock affects the flavor of vegetable dishes? (according to Andy's recipe)
>
> A. It makes them taste more "complete."

Improving a binary prompt often involves connecting it to something else, like an example or an implication. The lenses in the conceptual knowledge section are useful for this.

**False negatives:** How might you know the information the prompt intends to capture but *fail* to produce the correct answer? Such failures are often caused by not including enough context.

It’s easy to accidentally write a question which has correct answers besides the one you intend. You must include enough context that reasonable alternative answers are clearly wrong, while not including so much context that you encourage pattern matching or dilute the question’s focus.

For example, if you've just read a recipe for making an omelette, it might feel natural to ask: “What’s the first step to cook an omelette?” The answer might seem obvious relative to the recipe you just read: step one is clearly “heat butter in pan”! But six months from now, when you come back to this question, there are many reasonable answers: whisk eggs; heat butter in a pan; mince mushrooms for filling; etc.

One solution is to give the question extremely precise context: “What’s the first step in the Bon Appetit Jun ’18 omelette recipe?” But this framing suggests the knowledge is much more provincial than it really is. When possible, general knowledge should be expressed generally, so long as you can avoid ambiguity. This may mean finding another angle on the question; for instance: “When making an omelette, how must the pan be prepared before you add the eggs?”

False negatives often feel like the worst nonsense from school exams: "Oh, yes, that answer is correct—but it's not the one we were looking for. Try again?" [Soren Bjornstad points out](https://controlaltbackspace.org/memory/designing-precise-cards/#allowing-correct-but-irrelevant-answers) that a prompt which fails to exclude alternative correct answers requires that you also memorize “what the prompt is asking.”



### Revising prompts over time

It’s often tough to diagnose issues with prompts while you're writing them. Problems may become apparent only upon review, and sometimes only once a prompt's repetition interval has grown to many months. Prompt-writing involves long feedback loops. So just as it's important to write prompts incrementally over time, it’s also important to revise prompts incrementally over time, as you notice problems and opportunities.

In your review sessions, be alert to feeling an internal “sigh” at a prompt. Often you’ll think: “oh, jeez, this prompt—I can never remember the answer.” Or “whenever this prompt comes up, I know the answer, but I don’t really understand what it means.” Listen for those reactions and use them to drive your revision. To avoid disrupting your review session, most spaced repetition systems allow you to flag a prompt as needing revision during a review. Then once your session is finished, you can view a list of flagged prompts and improve them.

The analogy to sentences is drawn from Matuschak and Nielsen, [How can we develop transformative tools for thought?](https://numinous.productions/ttft/) (2019).Learning to write good prompts is like learning to write good sentences. Each of these skills sometimes seems trivial, but each can be developed to a virtuosic level. And whether you're writing prompts or writing sentences, revision is a holistic endeavor. When editing prose, you can sometimes focus your attention on a single sentence. But to fix an awkward line, you may find yourself merging several sentences together, modifying your narrative devices, or changing broad textual structures. I find a similar observation applies to editing spaced repetition prompts. A prompt can sometimes be improved in isolation, but as my understanding shifts I'll often want to revise holistically—merge a few prompts here, reframe others there, split these into finer details. If you've attempted the exercises, you may notice that it's easier to revise across question boundaries when composing multiple questions in the same text field. As an experiment, [I've written](https://notes.andymatuschak.org/z5ARNXtS5VxteskEW91S1yYTgAcLABNXsZuJE) almost all new prompts in 2020 as simple "Q. / A." lines (like the examples in this guide) embedded in plaintext notes, using an old-fashioned text editor instead of a dedicated interface. I find I prefer this approach in most situations. In the future, I may release tools which allow others to write prompts in this way.Unfortunately, most spaced repetition interfaces treat each prompt as a sovereign unit, which makes this kind of high-level revision difficult. It's as if you're being asked to write a paper by submitting sentence one, then sentence two, and so on, revising only by submitting a request to edit a specific sentence number. Future systems may improve upon this limitation, but in the meantime, I've found I can revise prompts more effectively by simply keeping a holistic aspiration in mind.

In this guide, I've analyzed an example quite exhaustively to illustrate a wide array of principles, and I've advised you to write more prompts than might feel natural. So I'd like to close by offering a contrary admonition.

I believe the most important thing to "optimize" in spaced repetition practice is the emotional connection to your review sessions and their contents. It's worth learning how to create prompts which effectively represent many different kinds of understanding, but a prompt isn't worth reviewing just because it satisfies all the properties I've described here. If you find yourself reviewing something you don't care about anymore, you should act. Sometimes upon reflection you'll remember why you cared about the idea in the first place, and you can revise the prompt to cue that motivation. But most of the time the correct way to revise such prompts is to delete them.

Another way to approach this advice is to think about its reverse: what material *should* you write prompts about? When are these systems worth using? Many people feel paralyzed when getting started with spaced repetition, intrigued but unsure where it applies in their life. Others get started by trying to memorize trivia they feel they "should" know, like the names of all the U.S. presidents. Boredom and abandonment typically ensue. The best way to begin is to use these systems to help you do something that really matters to you—for example, as a lever to more deeply understand ideas connected to your core creative work. With time and experience, you'll internalize the benefits and costs of spaced repetition, which may let you identify other useful applications (like I did with cooking). If you don't see a way to use spaced repetition systems to help you do something that matters to you, then you probably shouldn't bother using these systems at all.



## Further reading

These resources have been especially useful to me as I've developed an understanding of how to write good prompts:

* Piotr Wozniak’s [Effective learning: Twenty rules of formulating knowledge](http://www.supermemo.com/articles/20rules.htm) and the more detailed [Knowledge structuring and representation in learning based on active recall](https://www.supermemo.com/en/archives1990-2015/english/ol/ks) tackle the same topic as this guide from a different perspective.
* Michael Nielsen’s [Augmenting Long-term Memory](http://augmentingcognition.com/ltm.html): a thorough review of how spaced repetition works and why you should care; more details on how to practically integrate prompt-writing into your reading practices, particularly when reading academic literature; notes on creative applications; and much more.
* Michael Nielsen’s [Using spaced repetition systems to see through a piece of mathematics](http://cognitivemedium.com/srs-mathematics) demonstrates how to iteratively deepen one’s understanding of a piece of mathematics, using spaced repetition prompts as a lever.

For more perspectives on this and related topics, see:

* Soren Bjornstad’s [series on memory systems](https://controlaltbackspace.org/memory/designing-precise-cards/) helpfully covers many practical topics in maintaining a prompt library, including some advice on prompt-writing.
* Nicky Case’s [How To Remember Anything Forever-ish](https://ncase.me/remember/) introduces spaced repetition and covers some prompt-writing techniques through delightful illustrations.
* [How can we develop transformative tools for thought?](https://numinous.productions/ttft/) (from Michael Nielsen and me) discusses the challenges of prompt-writing with particular focus on the "mnemonic medium," which involves embedding prompts in narrative prose.

## Acknowledgements

My thanks to Peter Hartree, Michael Nielsen, Ben Reinhardt, and Can Sar for helpful feedback on this guide; to the many attendees of the prompt-writing workshops I held while developing this guide; and to Gwern Branwen and Taylor Rogalski for helpful discussions on prompt-writing which informed this work. I'm particularly grateful to Michael Nielsen for years of conversations and collaborations around memory systems, which have shaped all aspects of how I think about the subject.

This guide (and Orbit, its embedded spaced repetition system) were made possible by a crowd-funded research grant from [my Patreon community](https://patreon.com/quantumcountry). If you find my work interesting, you can [become a member](https://patreon.com/quantumcountry) to get ongoing behind-the-scenes updates and early access to new work.

## Licensing and attribution

This work is licensed under [CC BY-NC 4.0](https://creativecommons.org/licenses/by-nc/4.0/), which means that you can copy, share, and build on this essay (with attribution), but not sell it.

In academic work, please cite this as:

Andy Matuschak, "How to write good prompts: using spaced repetition to create understanding", https://andymatuschak.org/prompts, San Francisco (2020).