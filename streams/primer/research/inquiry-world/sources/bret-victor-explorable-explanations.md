# Explorable Explanations

- Canonical URL: https://worrydream.com/ExplorableExplanations/
- Author: Bret Victor
- Retrieval date: 2026-07-11
- Source type: Public essay with interactive examples; reader-extracted Markdown from canonical author site.
- Retained: compact passages on active reading, text as an environment to think in, reactive documents, authored models, multiple coordinated representations, reader trust/critique, contextual information, reader agency, and the 2024 clarification about model-grounded written arguments.
- Omitted: site navigation; images; interactive controls; most worked example body text and equations; external linked examples; exhaustive implementation details not needed for the explorable-knowledge prototype brief.

## Cleaned excerpts

### Active reading and text as an environment

> What does it mean to be an **active reader**?
>
> An active reader asks questions, considers alternatives, questions assumptions, and even questions the trustworthiness of the author. An active reader tries to generalize specific examples, and devise specific examples for generalities. An active reader doesn't passively sponge up information, but uses the author's argument as a springboard for critical thought and deep understanding.
>
> Do our reading environments encourage active reading? Or do they utterly oppose it? A typical reading tool, such as a book or website, displays the author's argument, and nothing else. The reader's line of thought remains internal and invisible, vague and speculative. We form questions, but can't answer them. We consider alternatives, but can't explore them. We question assumptions, but can't verify them. And so, in the end, we blindly trust, or blindly don't, and we miss the deep understanding that comes from dialogue and exploration.
>
> Explorable Explanations is my umbrella project for ideas that *enable and encourage truly active reading*. The goal is to change people's relationship with text. People currently think of text as *information to be consumed*. I want text to be used as an *environment to think in*.

### Initial families of explorable reading

> This essay presents examples of a few initial ideas:
>
> A **reactive document** allows the reader to play with the author's assumptions and analyses, and see the consquences.
>
> An **explorable example** makes the abstract
> concrete, and allows the reader to develop an intuition for how a system works.
>
> **Contextual information** allows the reader to learn related material just-in-time, and cross-check the author's claims.

### Reactive documents, modeling, and authored structure

> [Ten Brighter Ideas](/TenBrighterIdeas/) was my early prototype of a **reactive document**. The reader can play with the premise and assumptions of various claims, and see the consequences update immediately. It's like a spreadsheet without the spreadsheet. [Give it a try.](/TenBrighterIdeas/)

> Notice how the consequences of your adjustments are reflected in the following paragraph. The reader can explore alternative scenarios, understand the tradeoffs involved, and come to a more confident conclusion about whether the proposition is a good decision.

> There's nothing new about scenario modeling. The authors of this proposition surely had an Excel spreadsheet which answered the same questions. But a spreadsheet is not an *explanation*. It is merely a dataset and model; it cannot be *read*. An explanation requires an **author**, to interpret the results of the model, and present them to the reader via language and graphics.
>
> The reactive document integrates spreadsheet-like models into authored text. It can be read at multiple levels, depending on the reader's level of interest. The hurried reader can skim it. The casual reader can read it as-is. The curious reader can adjust the author's scenarios. The engaged reader can explore scenarios of their own devising.
>
> Unlike a spreadsheet, the barrier to exploration here is extremely low -- simply click and drag. This invites casual readers to become engaged and start exploring. It transforms readers from passive to active.

### Transparency, evidence, and debate

> On the author's side, this form encourages a sort of transparency. The author's argument cannot simply be a hodge-podge of soundbites and unsourced data. A reactive document requires the author to disclose the models behind their argument, to open them up for scrutiny. (In [Ten Brighter Ideas](/TenBrighterIdeas/), the reader can even directly edit the source code of the model, as well as visit the primary sources for all data.)
>
> Dishonest authors will always exist. They might use models based on faulty reasoning or data, but transparency means that the faulty model is available to be examined and refuted. Or they might offer no model at all, but perhaps readers will learn to be skeptical of non-explorable arguments.

> Multiple authors could model the same situation, and readers could compare. If you look at the groups [for](http://www.yesforstateparks.com/) and [against](http://www.voteno21.com/) the above proposition, you'll see they're basically just hurling around unsourced soundbites, leaving readers little to go on besides emotional appeal. What if both sides were expected to offer reactive documents, and the reader could critically explore their predicted scenarios?
>
> What if readers *wanted* to explore such scenarios, because it was actually **fun?**

### Intuition and multiple coordinated representations

> We aren't restricted to the author's choice of examples -- we can see the filter's response for any parameters we want. We can make **discoveries** that the author didn't bother to mention. (For instance, we see that this filter can have stability problems at low Q.) As we play, we think of **questions** (In which regions is this filter stable? Where do we start losing the lowpass response?) and we can experiment to answer those questions immediately.

> By watching the result change as we adjust parameters, we can develop an **intuition** for the system's behavior. This is helped by the figure's use of **multiple representations**. We are shown *six* different ways of characterizing the filter:
>
> Each representation gives a unique insight. By watching how they all respond to our experimentation, and how they dance with one another, we can develop a deep understanding -- of not just this filter topology, but digital filtering in general. Exploring the filter space becomes a game.

### Integrated explanation, not sandbox-only interactivity

> It's tempting to be impressed by the novelty of an interactive widget such as this, but the interactivity itself is not really the point.
> The primary point of this example -- the reason I call it an "explorable explanation" -- is the subtlety with which **the explorable is integrated with the explanation**.
>
> Like the proposition example earlier, the filter description works as a static explanation -- it can be **read like normal text**. The reader is not *forced* to interact in order to learn. The reader interacts if they wants to *go deeper*, if they have piqued curiosity or unanswered questions. There are no UI elements screaming for attention. The reader is not transported off to a separate "interactive" context. Instead, the reader simply nudges the examples that the author has already presented.
>
> Most interactive widgets dump the user in a sandbox and say "figure it out for yourself". *Those are not explanations.* To me, an essential aspect of the "explorable explanation" concept is that **the author holds up their end of the conversation**. The author must guide the reader, and provide a structure for the learning experience. Only then can the reader respond, by asking and answering the questions that the author provokes.

### Contextual information and reader agency

> As much as we might wish authors to write explorable explanations, many won't. And even authors with good intentions can't predict everything that the reader will want to explore. And some authors, again, don't have good intentions. So, let's ask:
>
> How do we make existing documents explorable? How can active readers ask questions and question assumptions while **reading normal text?**

> There's nothing new about looking up related information. You probably do it frequently -- by selecting a word, copying it to the clipboard, opening a new tab, pasting the word into the Google search field, scanning through the Google results, clicking on the Wikipedia article, scanning the article for what you want to know, closing the tab, and finally trying to find your place in the original article.
>
> The example above does essentially just that, except it's almost effortless and you don't lose your place.
>
> This makes a huge difference. I believe that readers are constantly making tradeoffs between **curiosity and laziness**, constantly evaluating the effort required to be an active reader. Dramatically lowering the effort barrier can encourage readers to ask every question that comes to mind.
>
> Again, the point is not about the particular interactions of this particular example. It's the larger goal of giving control to the reader. Encouraging readers to ask questions, verify assumptions, make connections, and follow their own interests. Treating the author's text as a base layer for hosting the reader's own explorations.

### 2024 postscript: model-grounded argument, not generic interactive pedagogy

> Since this was written, the term "explorable explanation" has gained some currency (at least partially due to a [workshop](https://dynamicland.org/archive/2014/Explorable_Explanations_workshop) I organized). It has now been applied so broadly that it seems to mean "any article with interactive pictures".
>
> Some of these articles are fun, and you can find a lot of them on the [explorabl.es](https://explorabl.es) page. I particularly recommend looking through the [Distill](https://distill.pub) journal, and the work of [Nicky Case](https://ncase.me), [Amit Patel](https://www.redblobgames.com), and [Jack Schaedler](https://jackschaedler.github.io). See also the platforms [Observable](https://observablehq.com) and [Nextjournal](https://nextjournal.com).
>
> However, almost all of these articles are pedagogical, and that's not really what I was going for here. What I meant by "explorable explanation" was more like, "a written *argument* whose assertions are backed by explorable computational models, whose *facts, assumptions, and calculations* are all visible and editable".
>
> The author's role here is not just to teach, but to convince. The reader's role is not to believe, but to critically evaluate, rebut, and come to a broad understanding. The reader rebuts by modifying the models.

> At the time that essay was written, I had already given up on the computer screen as a medium for model-grounded discussion. A better approach seemed to be integrating explorable models into the everyday spatial environment, and that remains one of my primary motivations for [Dynamicland](https://dynamicland.org/).
