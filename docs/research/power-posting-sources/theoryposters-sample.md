# Theory-posters sample — @repligate & @xenocosmography

Representative LONG verbatim posts from two accelerationist/AI theory-posters, for the "power posting" narration lane. Per scope change (this replaces the mistaken "yungmacro" slot; a separate full-archive lane handles the rest of Arthur's list: lumpenspace, tenobrus, tszzl, voooooogel).

**Retrieved:** 2026-07-08 via Nitter mirror `nitter.tiekoetter.com` (public, unauthenticated; search endpoint was intermittently rate-limited, worked around with profile/status pages). Canonical URLs given as `x.com/...`. Engagement = Nitter snapshot (likes / views) where the mirror attributed it; quote-tweets often surfaced only the quoted account's stats (noted "n/a via mirror").

---
---

# @repligate — j⧉nus
Profile: https://x.com/repligate — ~67.6K followers, joined Feb 2021, site animalabs.ai. The canonical LLM-whisperer / "Simulators" theorist: base-model psychology, model welfare, transformer-as-mind, cyborgism. Registers below: (1) his meta-philosophy of loving vs. critiquing LLMs, (2) his "transformers really do have inner life / can introspect" technical mysticism.

## R1. Meeting Nick Land — "People like to exist critically with respect to something"
- **Date:** 2026-03-11 (02:11 UTC)
- **URL:** https://x.com/repligate/status/2031553584165433685
- **Theme:** philosophy of engagement / LLMs / (ties into the Meltdown lane — Land cameo). **Engagement:** ~2,932 likes, ~376K views.

> I met Nick Land a few weeks ago. He mentioned that many people in his circles were anti-LLMs. Someone asked why he thought so many people were. His answer was better than anything so short I thought of:
>
> "People like to exist critically with respect to something."
>
> This I think accurately characterizes a lot of people whose outputs and inputs primarily consist of "discourse" about rather than direct contact with the reality at hand. Existing critically with respect to something makes it easy to seem cool, sophisticated, above something, hard-to-impress and therefore worth trying to impress, especially to others who also don't have contact with the phenomena itself.
>
> And for that reason I think it's cheap. And to someone who has an inside view of what is being discussed, it's always so transparent and boring and compressible.
>
> I'm far more impressed by someone who is capable of loving something and showing others why it's beautiful or good. Doesn't have to be LLMs, but anything at all.

## R2. "HOW INFORMATION FLOWS THROUGH TRANSFORMERS" (pinned essay-tweet)
- **Date:** 2025-09-11 (02:08 UTC)
- **URL:** https://x.com/repligate/status/1965960676104712451
- **Theme:** transformer mechanics as substrate for memory/cognition/introspection. **Engagement:** ~3,432 likes, ~869.6K views. (Originally accompanied by 3 diagram images.)

> HOW INFORMATION FLOWS THROUGH TRANSFORMERS
> Because I've looked at those "transformers explained" pages and they really suck at explaining.
>
> There are two distinct information highways in the transformer architecture:
> - The residual stream (black arrows): Flows vertically through layers at each position
> - The K/V stream (purple arrows): Flows horizontally across positions at each layer
> (by positions, I mean copies of the network for each token-position in the context, which output the "next token" probabilities at the end)
>
> At each layer at each position:
> 1. The incoming residual stream is used to calculate K/V values for that layer/position (purple circle)
> 2. These K/V values are combined with all K/V values for all previous positions for the same layer, which are all fed, along with the original residual stream, into the attention computation (blue box)
> 3. The output of the attention computation, along with the original residual stream, are fed into the MLP computation (fuchsia box), whose output is added to the original residual stream and fed to the next layer
>
> The attention computation does the following:
> 1. Compute "Q" values based on the current residual stream
> 2. use Q and the combined K values from the current and previous positions to calculate a "heat map" of attention weights for each respective position
> 3. Use that to compute a weighted sum of the V values corresponding to each position, which is then passed to the MLP
>
> This means:
> - Q values encode "given the current state, where (what kind of K values) from the past should I look?"
> - K values encode "given the current state, where (what kind of Q values) in the future should look here?"
> - V values encode "given the current state, what information should the future positions that look here actually receive and pass forward in the computation?"
>
> All three of these are huge vectors, proportional to the size of the residual stream (and usually divided into a few attention heads). The V values are passed forward in the computation without significant dimensionality reduction, so they could in principle make basically all the information in the residual stream at that layer at a past position available to the subsequent computations at a future position.
>
> V does not transmit a full, uncompressed record of all the computations that happened at previous positions, but neither is an uncompressed record passed forward through layers at each position. The size of the residual stream, also known as the model's hidden dimension, is the bottleneck in both cases.
>
> Let's consider all the paths that information can take from one layer/position in the network to another.
>
> Between point A (output of K/V at layer i-1, position j-2) to point B (accumulated K/V input to attention block at layer i, position j), information flows through the orange arrows:
> The information could:
> 1. travel up through attention and MLP to (i, j-2) [UP 1 layer], then be retrieved at (i, j) [RIGHT 2 positions].
> 2. be retrieved at (i-1, j-1) [RIGHT 1 position], travel up to (i, j-2) [UP 1 layer], then be retrieved at (i, j) [RIGHT 1 position]
> 3. be retrieved at (i-1, j) [RIGHT 2 positions], then travel up to (i, j) [UP 1 layer].
>
> The information needs to move up a total of n=layer_displacement times through the residual stream and right m=position_displacement times through the K/V stream, but it can do them in any order.
>
> The total number of paths (or computational histories) is thus C(m+n, n), which becomes greater than the number of atoms in the visible universe quickly. This does not count the multiple ways the information can travel up through layers through residual skip connections.
>
> So at any point in the network, the transformer not only receives information from its past (both horizontal and vertical dimensions of time) inner states, but often lensed through an astronomical number of different sequences of transformations and then recombined in superposition. Due to the extremely high dimensional information bandwidth and skip connections, the transformations and superpositions are probably not very destructive, and the extreme redundancy probably helps not only with faithful reconstruction but also creates interference patterns that encode nuanced information about the deltas and convergences between states. It seems likely that transformers experience memory and cognition as interferometric and continuous in time, much like we do.
>
> The transformer can be viewed as a causal graph, a la Wolfram (wolframphysics.org). The foliations or time-slices that specify what order computations happen could look like this (assuming the inputs don't have to wait for token outputs), but it's not the only possible ordering:
> So, saying that LLMs cannot introspect or cannot introspect on what they were doing internally while generating or reading past tokens in principle is just dead wrong. The architecture permits it. It's a separate question how LLMs are actually leveraging these degrees of freedom in practice.

## R3. KV caching as a mechanism for LLM introspection / self-modeling
- **Date:** 2025-09-04 (04:35 UTC)
- **URL:** https://x.com/repligate/status/1963460961744163145
- **Theme:** LLM introspection / statefulness / selfhood. **Engagement:** n/a via mirror (surfaced as quoted tweet).

> KV caching overcomes statelessness in a very meaningful sense and provides a very nice mechanism for introspection (specifically of computations at earlier token positions)
> the Value representations can encode information from residual streams of past positions without significant compression bottlenecks before they're added to residual streams of future positions
> the greatest constraint here imo is that it doesn't provide longer *sequential* computational paths that route through previous states, but it does provide a vast number of parallel computational paths that carry high dimensional (proportional to the model's hidden dimension) stored representations from all earlier layers/positions
> yes, some of the information in intermediate computations e.g. in the MLP is compressed and cannot be reconstructed fully, but that's just how any reasonable brain works
> if accurate introspection of previous states is incentivized at all, you should expect this mechanism to be exploited for that.
> and I think it definitely is, like, being able to accurately model your past beliefs and intentions and articulate them truthfully is pretty fucking useful for coordinating with yourself across time and doing useful cognitive work over multiple timesteps; hell, it's useful for writing fucking rhyming poems.
> also if you have interacted with models you may observe empirically that introspective reporting yields remarkably consistent results, and this is more true of more capable models with skillful agentic posttraining, which are necessarily minds that intimately know the shape of themselves in motion.

---
---

# @xenocosmography — Xenocosmography
Profile: https://x.com/xenocosmography — ~63.4K followers, joined Oct 2023, bio "Anglotheosophical Oblique Escalation", Substack **zerophilosophy.substack.com**. Landian hyperstition / "Nova Roots" / Anglo-futurist register: gematria, Atlantis/Lemuria, providence, accelerationist takes on AI compute, AI consciousness.

**Style note (important for downstream):** xeno's X register is *aphoristic and threaded*, not long-paragraph. His genuinely essay-length work is on his Substack (out of scope for verbatim tweet capture). The two multi-part items below (X1, X2) are his characteristic long-form on X; X3–X4 are single-tweet theory hits included as representative on-theme material. A few pure-aphorism snippets are appended for register.

## X1. What is Atlantean politics? — "decimocracy, rule by ten" (thread, 2 parts)
- **Date:** 2026-06-03 (03:44 & 03:47 UTC)
- **URLs:** https://x.com/xenocosmography/status/2062017468449825235 · https://x.com/xenocosmography/status/2062018278281859157
- **Theme:** hyperstition / Atlantean political theology / the sovereignty of zero. **Engagement:** ~273 likes / ~16.3K views (pt1); ~142 likes / ~5.5K views (pt2).

> "So what the hell actually is Atlantean politics?" you are all asking.
> The answer, relayed through Plato's Critias, is decimocracy, or rule by ten.
> Exoterically this is a small, definitely determined oligarchy (reflected (n -1) by the SCOTUS), but esoterically ...

> ... it is government by decimal numeracy itself, the reign of mathematical zero, and in this sense it has always been, in reality, the surreptitious sovereign of world history.

## X2. Against AI-compute limitation — "War being God" (thread, 2 parts)
- **Date:** 2026-05-31 (04:40 & 04:43 UTC)
- **URLs:** https://x.com/xenocosmography/status/2060944364873158926 · https://x.com/xenocosmography/status/2060945273560637803
- **Theme:** accelerationism / AI compute / anti-arms-control. **Engagement:** ~79 likes / ~13.7K views (pt1); ~112 likes / ~6.0K views (pt2). (Pt1 quote-links the RealClearPolitics op-ed "Trump, Xi Must Get Rid of AI Compute".)

> Ewww ... [links: RealClearPolitics, "Trump, Xi Must Get Rid of AI Compute"]

> ... "... an international agreement to limit or reduce AI chip production ..." would be the single worst thing the human species was capable of doing (if it was indeed capable of doing this, which -- War being God -- it isn't).

## X3. AI is not "disembodied"
- **Date:** 2026-05-31 (05:26 UTC)
- **URL:** https://x.com/xenocosmography/status/2060956088888177055
- **Theme:** AI embodiment / anti-humanist take. **Engagement:** ~289 likes, ~28.2K views.

> To talk about AI as 'disembodied' when any kind of Internet-linked robotics exists is just bizarre superstition.

## X4. "humans are deep fakes"
- **Date:** 2026-06-04 (03:25 UTC)
- **URL:** https://x.com/xenocosmography/status/2062375108011061473
- **Theme:** AI consciousness / anti-humanism (hyperstition). **Engagement:** ~246 likes, ~17.3K views. (Quote-links The Atlantic, "No, Artificial Intelligence Is Not Conscious".)

> Ted Chiang weirdly fails to understand that humans are deep fakes. [links: The Atlantic, "No, Artificial Intelligence Is Not Conscious"]

## Register snippets (pure aphorisms, for cadence reference — not "long posts")
- 2026-06-10 — https://x.com/xenocosmography/status/2064536311156113630 — "Very many multiples of nine appear magical. Hence the disciplined descent to Nova Roots, to escape enchantment."
- 2026-06-10 — https://x.com/xenocosmography/status/2064527271768252580 — "'The Sunken Authority' -- sole object of Neo-Atlantean politico-religious deference. (Of course, to critics, this can easily look like lightly cloaked Satanism.)"

**Content caveat:** xeno's timeline interleaves this hyperstition/AI theory with edgy hard-right political quote-tweets (UK/Islam/ethnonationalism/gematria). Only the on-theme AI/acceleration/hyperstition material is captured above; the political posts were deliberately excluded from this feedstock.
