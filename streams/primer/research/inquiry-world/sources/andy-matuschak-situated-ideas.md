# A primitive for enabling environments: early work on machine-generated prompts

- Canonical URL: https://andymatuschak.org/situated-idea-memory-system/
- Author: Andy Matuschak
- Retrieval date: 2026-07-11
- Source type: Public essay / public "Letters from the Lab" article on Andy Matuschak's canonical site.
- Retained: compact passages on the limits of flashcards, memory systems as learning/metabolization environments, situated ideas as a primitive, source-context pointers, varied/deepening/recontextualized activities, learner control, highlighting as participation, and review-time feedback.
- Omitted: duplicated site navigation; Patreon index links; audio link; implementation details about classifier workflow except where directly relevant to source-context provenance and dynamic tasks; acknowledgements and funding note.

## Cleaned excerpts

### The need for a different primitive than flashcards

> I want to create a new kind of spaced repetition system—a new kind of enabling environment—with a different central primitive.

> The central primitive of existing spaced repetition systems is the flashcard. If you want to remember some fact, you transform it into flashcard form and add it to your system. The system doesn’t know about the fact you want to remember, and it certainly doesn’t know how that fact connects to other things you’re thinking about. The system knows about flashcards.

> When you want to learn a simple fact, like the capital of a country or some foreign-language vocabulary, that arrangement works well enough. But spaced repetition systems are important because they can be used to support all kinds of learning, to help you internalize all kinds of ideas more deeply. The trouble is that—in my experience—the further you get from that simple fact–flashcard correspondence, the less well these systems work, and the more difficult they are to use.

### Robust memory through varied cues, angles, and connections

> Michael Nielsen and I [have argued](https://numinous.productions/ttft) that “memory system” is a more powerful framing for this problem space than “spaced repetition system”. The latter phrase emphasizes one tactic. Cognitive psychologists have characterized a wide variety of deep facts about human memory, and we should exploit as many as possible. But another reason to prefer “memory system” is that this phrase is closer to what you actually want. You want a system which causes you to robustly remember. (And in fact, you want even more, as we’ll soon discuss.)
>
> For robust memory of vocabulary, mere spaced repetition may be enough. But for more complex ideas, I find that flashcards alone often produce a brittle memory. Once I’ve seen a flashcard a few times, the specific wording will often act as a strong cue. I’ll remember the answer not because I’m actually processing what the words mean, but through kneejerk pattern matching. An effective memory system would help me build robust memory by presenting the idea with different cues, from different angles, through different connections, so that I encode the memory in many ways.

### Learning, metabolization, and becoming different

> We can zoom the frame back again. Most of the time, I don’t just want to remember; I want to *learn*. I want those topics I’m practicing to be alive and functional. I want to be able to apply the material flexibly and fluently. I want my understanding to deepen over time. I want to see new implications and have new ideas. Piotr Wozniak, inventor of the modern spaced repetition system, [has written that you should learn before you memorize](https://www.supermemo.com/en/blog/twenty-rules-of-formulating-knowledge). But as I see it—both from experience and from my understanding of cognitive architecture—this is an ongoing parallel process. As we exercise and elaborate material we’ve learned, we make new connections and understand more deeply. Memorization is intertwined with that process, not something that happens before or after.

> All this is awfully cognitive. Much of what I put in my spaced repetition system isn’t. I’ll capture an insightful observation from a friend over dinner, or a beautiful quote, or something someone did that surprised me. The point here isn’t really to memorize. It’s to be changed—to metabolize an experience so that I feel or act differently in the future. But that point is also true of much of my more traditional learning. When I study music theory, I don’t just want to learn; I want to feel and act differently when I play music. When I study a historical figure, I don’t just want to learn; I want to add their way of looking at the world to my own set of lenses, so that I experience the world differently. So that, in some small but real way, I become a different person.

### Situated ideas as source-grounded objects

> With those lofty goals articulated, I can now state my central complaint about flashcards: they’re static. They’re ”[dead fish](https://vimeo.com/64895205)″. Robust memory requires varied cues and connectivity; robust learning requires rising depth and complexity; robust metabolization requires contextuality and vividness.
>
> To bring dynamism to these systems, I think we need new central primitives. Today’s spaced repetition systems are structured around flashcards—adding them, organizing them, scheduling them. I think we need to move upstream. If we want our review sessions to vary and deepen and connect over time, we can’t just supply a static task. In fact, if the goal is to support transfer learning, we can’t write the task ourselves at all: transfer requires surprise. We need to somehow point to the idea which inspired that task, situated within the context which inspired us, so that a stream of varying and deepening tasks can emanate from it over time.

> If I’m reading a book, a natural way to point at an idea is by literally pointing at some part of the prose, perhaps with a highlighter, and perhaps with some marginal comments about what we found meaningful. If I’m reflecting on a conversation or experience, the same approach might work for my journal or notes.
>
> More concretely, instead of question/answer fields, the primitive I have in mind—a *“situated idea”*?—would store:
>
> - a pointer to relevant context, with full text; e.g. a book, a journal, etc.
> - a range (or ranges?) within that context representing the idea to be metabolized; i.e. like a highlight you made in your book
> - an optional extra comment clarifying your intent or interest; i.e. like marginalia you wrote next to your highlight
>
> And then the system would synthesize appropriate activities over time, based on that input, and on connections with other situated ideas in related contexts.

### Learner control and different goals/backgrounds

> All this roughly mimics the work that professional instructional designers do: given a set of “knowledge points” introduced in a text, they construct a series of activities (worked examples, exercises, reflections) and present them in varying and deepening ways over time. In some cases, that sequence may even respond to your performance, though few courses will reinforce your memory as effectively as a spaced repetition system.
>
> The key difference in the system I’m proposing is that it shifts the locus of control from the instructional designer to the user. That was the most important lesson from my work with the mnemonic medium these past few years: [self-motivated adult readers rarely want to passively study whatever an author tells them](https://www.patreon.com/posts/revamping-medium-55309960). People want different things from a text. They have different goals. One learner wants to learn the theorems; another wants to be able to prove them. They have different backgrounds. One learner will need a lot of reinforcement in one spot; another in a different spot. And they’re interested in different subtopics. One learner will skim a section which another will eagerly devour, and vice versa.

### Highlighting as participation and learner-authored structure

> Those insights led me to [last year’s experiments with a “magic” highlighter](https://www.patreon.com/posts/highlight-driven-90101210), and the delightful frame: what if we could make highlighters actually do what people *wish* they did? When students are polled about their favorite study practices, the most common responses are usually re-reading and highlighting. Meanwhile, if you make a list of the most effective study practices, those two methods are usually at the bottom. But highlighting feels great: it’s a way of indicating interest, a way of participating, of literally making your mark on the text. People imagine that highlighting will help them internalize the material. It (mostly) doesn’t. But maybe it could: you could use a special highlighter to add “situated ideas” to your library, and then the system would ensure that you’d internalize that material.

### Dynamic review, depth, connections, and recontextualization

> The opportunity for a new primitive is a much more interesting frame. I want something like a spaced repetition system, but where review activities vary and deepen and connect over time. Such a system would necessarily require extremely expensive content-by-content labor, or machine-generated tasks. And only machine-generated tasks afford the possibility of activities tailored to idiosyncratic personal contexts.

> Even within the limited frame of traditional flashcard generation, good integration with existing systems will eventually require more invasive changes. In an ideal integration, the user wouldn’t evaluate the machine-generated tasks while they’re reading. They would just read, and highlight, and then later review. The trouble here is that sometimes a given highlight could reasonably point to several distinct ideas—and you probably don’t want all of them. Users will need to give the system feedback on targeting, on their desired level of depth, and so on.
>
> The easy way to implement that is to make the user evaluate machine-generated tasks during their reading session, but I can tell you from experience: that’s unpleasant. It would be better to provide feedback at review time. That will require more complex integration. And longer-term, if I get my way, it wouldn’t make sense to have the user evaluate and approve the machine-generated tasks, because the task will change with each review. It’s a different conceptual model.
>
> For this kind of dynamic review, machine-generated tasks are necessary but not sufficient. Some early experiments suggest that LLMs can pretty reliably generate simple surface variations of known-good tasks, to avoid the pattern-matching problem. But we want tasks which deepen, connect, and recontextualize over time. Those will need separate investigations and pipelines.
