# Memory Machines: Can LLMs create lasting flashcards from readers’ highlights?

- Source: https://memory-machines.com/report
- Author: Ozzie Kirkby and Andy Matuschak (2026)
- Retrieved: 2026-07-11
- Source type: canonical public web source

---

* [A Problem with Two Parts](#1-a-problem-with-two-parts)
* [Models Can't Judge Quality](#2-models-cant-judge-quality)
* [Training Doesn't Break Through](#3-training-doesnt-break-through)
* [Grounding — Escaping Transfer](#4-escaping-transfer-with-grounding)
* [How Bad Is Generation?](#5-how-bad-is-generation)
* [The Arena](#6-the-arena)
* [Conclusion](#conclusion)

Can LLMs create lasting flashcards from readers’ highlights?

Ozzie Kirkby and Andy Matuschak

You encounter countless ideas worth knowing, and forget almost all of them. Spaced repetition memory systems [make memory a choice](https://augmentingcognition.com/ltm.html)—but only if you write practice prompts that effectively reinforce those ideas. That’s difficult and time-consuming, so most users will capture only a fraction of their interests. Could we make memory as effortless as using a highlighter? We explored whether LLMs could convert casual highlights into useful memory prompts.

Here’s an example. In an article on terraforming, one of us highlighted this passage about Titan:

> … gravity is so low that humans could fly simply by flapping their arms, provided they’re equipped with winged space suits.
> [“Greening the Solar System”](https://asteriskmag.com/issues/09/greening-the-solar-system), *Asterisk*

This is exactly the kind of striking detail we want to carry away from an article like this. Yet without reinforcement, we expect we’d soon forget it.

When given the full source text and our highlight, frontier models generate flashcards like:

Q. On which celestial body could humans theoretically fly by flapping their arms?

Question reveals the detail I want to reinforce

Q. Why could humans fly on Titan using only winged space suits?

Not trying to reinforce gravitational mechanics

Q. What makes Titan unique in terms of human flight potential?

Will be ambiguous in a few months, and factually wrong (it's not unique)

These are directionally correct! They are about Titan, about flying, about the highlighted text. But they miss what’s most interesting about the passage. Here’s a prompt that works:

Q. On Titan, gravity is so low that humans could fly simply by...

A. ...flapping their arms (in winged space suits)

We want to re-encounter the novelty that strikes us, not recite facts stripped of it. “What makes Titan unique in terms of human flight potential?” points to the right detail, but far too vaguely. Good prompts require taste: a compressed sense, built on thousands of past reviews, of whether a cue will still work months from now.

We tried to transfer that taste to LLMs through instructions, rubrics, few-shot examples, and training on ~1,500 labeled prompts across 93 sources. We find that models can identify a highlight’s intent, but not whether a prompt will hold up over months of review.

## 1. A Problem with Two Parts

### Memory Prompts Are Not Flashcards

Memory systems—also called spaced repetition systems, or SRS—work by causing you to retrieve a memory near the moment you’re about to forget it. They consist of two parts: a scheduler that handles timing, and prompts (colloquially, flashcards) that cue retrieval.

At a glance, these prompts resemble ordinary flashcards, but they operate under a stricter constraint. **A SRS memory prompt must survive a long-horizon review**. A prompt seen today, then again in three months, then again in a year, must reliably cue the same answer each time. If context is underspecified or the question does not solicit consistent recall of the same detail, recall drifts and the testing effect breaks down.

A good memory prompt lives in a narrow band. It must be concise enough to read quickly, but detailed enough to cue the same memory months later—yet not so detailed that the question gives away the answer. Attempting to proceduralize and describe the process of writing good memory prompts is challenging since so much of the knowledge comes from **lived experience**. You learn what works by experiencing what fails. A prompt often seems fine initially, but weeks later forgetting exposes its weaknesses. Forgetting is the feedback which shapes taste.

When this taste lives entirely in the human, two structural bottlenecks of memory systems appear:

**Stasis.** Prompts are always the same. [Ideally, they would evolve to produce deeper understanding over time, and to shift with your interests](https://andymatuschak.org/situated-idea-memory-system/). Instead, they often go stale, and reviews become mechanical.

**Demand.** Writing good prompts takes effort that curiosity can only sometimes justify. The gap between “worth noticing” and “worth the work” is wide. Only a narrow slice of what interests you ever enters the system.

We could address these bottlenecks by bringing machines into the loop, but only if the prompts they generate survive long-horizon review. We test whether they can, in a minimal setting: highlights from casual reading. You’re interested enough to mark a passage, but not enough to write a memory prompt for it.

### Grounding the Problem

Before turning to generation, we first needed to check a more basic assumption: can highlights capture what readers want to remember? If not, no amount of modeling can recover the signal. If two readers will often highlight the same sentence for entirely different reasons, then the bottleneck is not generation but inference itself.

We tested this with 42 experienced memory system users. Each participant read one of three articles, using a digital highlighter to emphasize any passages they found interesting. Afterward, to obtain their preferences directly, we asked them to choose which of 10-13 predefined interests they’d like included in a downloadable set of memory prompts.

As a naïve baseline, we could skip the highlighting and interest selection. We could just provide memory prompts about every topic in the article—the same prompts for everyone. That would match today’s centralized downloadable prompt collections. But many memory system users feel these collections fit them poorly, and our data validate that. Our average participant would need to delete more than a third of those prompts to match their interest selections.

That’s not because the prompts are poorly chosen in general. Readers simply care about different details. When we measured overlap in selected interests, agreement averaged only 39%. So any one-size-fits-all deck will necessarily include many prompts that any given reader doesn’t want.

The question, then, is whether we can infer what a *particular* reader cared to remember from their highlights. A simple test here produced promising results. Before running the experiment, we mapped each candidate interest to a representative passage in the text. If we predict a user’s interest selections by intersecting those pre-mapped passages with their highlights, we cut the average participant’s unwanted prompts in half, relative to the naïve baseline.

It seems that highlights can provide a strong signal of readers’ interests. The difficulty now is translating that signal into prompts that will reliably cue the same memory after time has passed.

### What Makes a Memory Prompt Work

Effective memory prompts satisfy two criteria simultaneously:

* **Targeting:** whether the prompt captures what the user actually wants to remember.
* **Construction:** whether the prompt will reliably cue the same memory after long gaps, without significant loss in detail.

A prompt can fail on either axis. Targeting failures are usually obvious. You read the prompt and immediately recognize that it’s about the wrong thing, or about something you don’t care to retain. Construction failures are harder to see. They often surface during review, when ambiguity, underspecification, and excess abstraction can cause friction and forgetting.

These two failure modes differ not just in kind, but in cost. Targeting failures are relatively cheap: they’re rejected at a glance. Construction failures are expensive. They look plausible, so you read them carefully, attempt an answer, and only later discover that the prompt doesn’t support stable recall. Repeated over time, these prompts erode trust in the system.

To reason about this systematically, we adopted a four-tier taxonomy:

T3  Ready to Review

Q. On Titan, gravity is so low that humans could fly simply by...

A. ...flapping their arms (in winged space suits)

T2  Needs Polish

Q. What fanciful superpower would humans acquire on Titan as a consequence of its low gravity?

A. Humans could fly by flapping their arms, provided they're equipped with winged space suits.

Good targeting, but wordy enough to cause friction

T1  Needs Refactor

Q. How does Titan's low gravity and dense atmosphere affect how a human could move there?

Decent targeting, but unworkably ambiguous construction (many correct answers possible)

T0  Off-target

Q. What two properties of Titan allow flight?

A. Low gravity and dense atmosphere.

Targets the wrong detail, and with ambiguous construction

Using this taxonomy, we constructed the [`srs-prompts`](https://huggingface.co/datasets/laddermedia/srs-prompts) dataset, which consists of ~1,500 highlight-anchored memory prompts across 93 sources. Highlights were collected by the authors and a small community via an online deployment. Sources consisted primarily of technical explainers, blog posts, and opinion pieces—selected to reflect authentic curiosity rather than exam-driven study. Each highlight is paired with at least one well-constructed prompt, along with one or more flawed variants.

Building this dataset clarified an important asymmetry: T0 prompts are cheap, quickly discernable failures, but T1 prompts are insidious. They look plausible—often even aligned with what you want—but won’t reliably survive long-horizon review.

The challenge here is in satisfying two demands at once. A good prompt has to preserve what made the detail worth marking—the novelty, the feeling, the specific angle that struck you—without flattening it into generic trivia. At the same time, it has to be precise enough to cue the same answer months later. Most failures give up one side or the other.

When an experienced memory system user evaluates a prompt, they draw on thousands of past reviews. They *project themselves forward in time*, into future review sessions, and assess how they’d react to a given prompt. Is it still clear, vivid? Does it still cue the same memory? This is what we call taste! Deploying it is cognitively demanding and rests on the lived experience of spaced repetition usage.

For machine generation to succeed, it must approximate that projection. The key distinction lives at the T1/T2 boundary. T1 prompts look plausible but degrade in review; T2 prompts hold. If a model can’t reliably discern that boundary, then it can’t project forward in time, and its output will reflect that weakness.

## 2. Models Can’t Judge Quality

We ran a wide variety of tests to explore whether today’s models can reliably distinguish prompt quality. Across all experiments in this section, we gave the model a highlight, its source context, and either one prompt to judge or a small set of prompts to choose from.

### Binary Classification

One of the simplest tests: can models tell usable prompts from unusable ones? We collapsed the four tiers into a binary decision we call **pluckability**. A prompt is *pluckable* if it would hold up over time in a memory system—T2 or T3. Prompts rated T0 or T1 are *unpluckable*: they’re either off-target or broken in ways that won’t survive long-horizon review.

Models received a highlight, source context, and a candidate prompt, then classified it as pluckable or not. We tested two instruction variants: zero-shot (task description only) and few-shot (11 examples with evaluation explanations). After filtering sources that appear in the few-shot set, this left 1,198 prompts—485 pluckable, 713 unpluckable.

    0%
    20%
    40%
    60%
    80%
    Opus 4.5     64%
  67%
   Sonnet 4.5     58%
  62%
   GPT 5.2     61%
  66%
   Gemini 2.5 Pro     60%
  63%
   Qwen3 32B     55%
  59%
   GPT-OSS 120B     52%
  56%
   Zero-shot  Few-shot 

Overall performance clustered in the same disappointing band. The strongest runs landed around the mid-60% range. The addition of examples and explanations helped a little, but not nearly enough.

Predicted
  Unpluckable  Pluckable  
Actual
   T0     306   93%
    22   7%
    T1     205   77%
    60   23%
    T2     53   44%
    67   56%
    T3     248   51%
    236   49%
    Opus 4.5

Predicted
  Unpluckable  Pluckable  
Actual
   T0     324   99%
    4   1%
    T1     253   95%
    12   5%
    T2     105   88%
    15   13%
    T3     430   89%
    54   11%
    Sonnet 4.5

Predicted
  Unpluckable  Pluckable  
Actual
   T0     295   90%
    33   10%
    T1     195   74%
    70   26%
    T2     54   45%
    66   55%
    T3     266   55%
    219   45%
    GPT 5.2

Predicted
  Unpluckable  Pluckable  
Actual
   T0     241   73%
    87   27%
    T1     110   42%
    155   58%
    T2     26   22%
    94   78%
    T3     122   25%
    363   75%
    Gemini 2.5 Pro

The breakdown by tier reveals a further pattern. Opus 4.5 correctly identifies T0 (off-target) prompts nearly 93% of the time. It knows when a prompt misses what the user highlighted. The problem is construction. Opus 4.5 correctly classifies T1 prompts as unpluckable 77% of the time, but only recognizes T2 prompts as pluckable 44% of the time. Sonnet 4.5 fails in the opposite direction: it over-predicts unpluckable, achieving only 11% accuracy on T3. Same instruction, starkly different failure modes.

### Rubric

Maybe the model can’t learn the holistic notion of “pluckability,” but it can detect specific failure modes. This is the standard “LLM-as-a-judge” playbook: turn taste into a checklist, then ask the model to apply each item.

We labeled a subset of failures from the [`srs-prompts`](https://huggingface.co/datasets/laddermedia/srs-prompts) dataset as exhibiting one or more of the following criteria:

Lacks Context

Before

Q. What does excise involve?

A. Effort not directly in pursuit of a goal.

After

Q. What is excise according to Alan Cooper?

A. A cognitive or physical penalty for using a tool.

"Excise" means different things in different contexts.

Solicits multiple responses

Before

Q. What causes internal fragmentation in LLM memory allocation?

After

Q. What distinguishes internal fragmentation from external fragmentation in KV cache memory?

This has many valid explanations.

Shallow

Before

Q. What are the “factors of production” that economists often discuss?

A. Labor, land, and capital.

After

Q. What does it mean when there are “diminishing marginal returns to labor/land/capital”?

A. These factors are not the limiting factor in production; a 10× increase in capacity yields minimal returns.

Asks for a textbook list; the passage’s main insight is about diminishing marginal returns.

Wordy

Before

Q. How does the Stoic philosophy, as summarized by Marcus Aurelius, view obstacles in relation to personal growth and progress?

After

Q. How does Marcus Aurelius’s Stoic philosophy view obstacles?

Same question buried under formal qualifiers.

Narrow

Before

Q. What is a common mistake made by AI researchers?

A. They often try to build knowledge into their agents.

After

Q. What is Rich Sutton’s Bitter Lesson (2019)?

A. Human-designed knowledge may offer short-term gains, but scalable methods that rely on computation and general learning algorithms consistently outperform.

Captures only the setup (researchers build in knowledge) while missing the main point: that computation dominates human design in the long run. (Separately, this question is vague and will solicit multiple responses)

For each category, we crafted dedicated instructions with synthetic examples to avoid dataset contamination. Then we tasked models with judging each criterion independently.

| run | n\_positive | n\_negative | precision | recall | f1 |
| --- | --- | --- | --- | --- | --- |
| **ambiguous lacks context** | | | | | |
| Gemini 2.5 Pro | 96 | 96 | 94.0% | 81.3% | 0.87 |
| Sonnet 4.5 | 96 | 96 | 79.6% | 93.8% | 0.86 |
| Opus 4.5 | 96 | 96 | 97.3% | 75.0% | 0.85 |
| Qwen3 32B | 96 | 96 | 85.7% | 75.0% | 0.80 |
| GPT 5.2 | 96 | 96 | 83.0% | 76.0% | 0.79 |
| GPT-OSS 120B | 96 | 96 | 97.7% | 44.8% | 0.61 |
| **ambiguous solicits multiple responses** | | | | | |
| GPT 5.2 | 40 | 96 | 37.7% | 72.5% | 0.50 |
| Sonnet 4.5 | 40 | 96 | 36.3% | 72.5% | 0.48 |
| Opus 4.5 | 40 | 96 | 53.1% | 42.5% | 0.47 |
| GPT-OSS 120B | 40 | 96 | 36.5% | 47.5% | 0.41 |
| Gemini 2.5 Pro | 40 | 96 | 41.2% | 35.0% | 0.38 |
| Qwen3 32B | 40 | 96 | 56.3% | 22.5% | 0.32 |
| **narrow** | | | | | |
| GPT 5.2 | 48 | 96 | 73.5% | 75.0% | 0.74 |
| Gemini 2.5 Pro | 48 | 96 | 63.5% | 83.3% | 0.72 |
| Opus 4.5 | 48 | 96 | 68.8% | 68.8% | 0.69 |
| Qwen3 32B | 48 | 96 | 96.2% | 52.1% | 0.68 |
| Sonnet 4.5 | 48 | 96 | 51.1% | 93.8% | 0.66 |
| GPT-OSS 120B | 48 | 96 | 60.0% | 50.0% | 0.55 |
| **shallow** | | | | | |
| Opus 4.5 | 47 | 96 | 65.5% | 80.9% | 0.72 |
| GPT 5.2 | 47 | 96 | 57.4% | 74.5% | 0.65 |
| Qwen3 32B | 47 | 96 | 60.4% | 68.1% | 0.64 |
| Gemini 2.5 Pro | 47 | 96 | 53.6% | 78.7% | 0.64 |
| Sonnet 4.5 | 47 | 96 | 40.5% | 95.7% | 0.57 |
| GPT-OSS 120B | 47 | 96 | 50.8% | 63.8% | 0.57 |
| **wordy** | | | | | |
| Opus 4.5 | 25 | 96 | 58.3% | 28.0% | 0.37 |
| Sonnet 4.5 | 25 | 96 | 34.5% | 40.0% | 0.37 |
| Gemini 2.5 Pro | 25 | 96 | 42.1% | 32.0% | 0.36 |
| GPT 5.2 | 25 | 96 | 23.8% | 20.0% | 0.22 |
| Qwen3 32B | 25 | 96 | 25.0% | 12.0% | 0.16 |
| GPT-OSS 120B | 25 | 96 | 25.0% | 4.0% | 0.07 |

Some criteria transferred cleanly. “Ambiguous lacks context” reached F1 scores of 0.85-0.87 across frontier models. Others did not. “Wordy” collapsed entirely, with F1 scores between 0.07 and 0.37.

The failures which are most discernible by the LLMs are the ones least coupled to the lived experience of reviewing memory prompts. It seems they cannot detect the subtler breakdowns in answerability and retrieval alignment that only emerge through practice. Unfortunately, a rubric based only on machine-legible criteria can’t adequately represent our preferences.

### Preference Selection

If absolute judgment is too hard, maybe relative judgment is easier. We reformulated the task contrastively: for a given highlight, we provided **2–4 candidate prompts** (one T3, the others T1/T2) and asked the model to pick the best one. We excluded T0 to focus on construction quality rather than obvious targeting failures. This yielded 90 comparison tasks based on the [`srs-prompts`](https://huggingface.co/datasets/laddermedia/srs-prompts) dataset.

This is a generous setup. The human-rated most-preferred memory prompt is present in every set of options. Yet models fail to identify it reliably. Models chose the T3 prompt only **~40–50%** of the time. Worse, models pick **T1**—the tier we most want to reject—**~30–40%** of the time. Even when the “chosen” ground-truth prompt is in the options, the best model, Opus 4.5 will still choose the least-preferred, structurally broken alternative 32.6% of the time.

### Taste Doesn’t Transfer

We find that models reliably reject T0 prompts. For both language models and human reviewers, off-target prompts are cheap failures: you read them and immediately recognize them as poor fits. The T1/T2 boundary is different. For humans, distinguishing those tiers takes careful reading and judgment formed through thousands of reviews—the accumulated sense of which prompts drift and which hold. Across all our experiments, models failed to reliably distinguish those tiers.

No model exceeded 70% accuracy in binary classification, and T1 performance varied dramatically. Using rubrics, models caught missing context (F1 = 0.87) but struggled to discern when a prompt would elicit multiple valid answers (F1 = 0.32–0.50). Even when presented with the best prompt beside three weaker alternatives, models still selected the broken one about a third of the time. We can describe and demonstrate our taste, but the ability to discern it doesn’t transfer.

The difference between T1 and T2 isn’t a grading quibble. T1 prompts quietly degrade the system: they waste attention, produce drift, and erode trust over time. They require careful attention to identify, so users can’t easily screen them out in advance. A system which produces T1 prompts a third of the time is not a system we want to use.

## 3. Training Doesn’t Break Through

If describing taste doesn’t work, maybe we can train it. We have ~1,500 labeled samples—not enormous, but enough to ask whether there’s a learnable signal in this data. We split by source, ensuring no article appeared in both train and test, yielding roughly 1,300 training and 200 test examples.

### Matching the Ceiling, but Not Breaking It

In the simplest setup, we returned to pluckability—this time training classifiers to predict whether a memory prompt is pluckable at all. With the right threshold, a Qwen3-0.6B classifier matches Gemini 2.5 Pro’s few-shot precision–recall tradeoff: precision 0.60, recall 0.80. It’s encouraging that a 0.6B model can reach the same performance as a frontier system many times its size. But when we fine-tuned Qwen3-14B with LoRA on the same task, we found a near-identical ROC-AUC (0.754 vs. 0.752). Across operating points, increasing capacity yielded no meaningful improvement.

This parity suggests something stronger than a scaling plateau. The smaller classifier appears to be exploiting the same surface features as the frontier models—features sufficient to detect obvious failures, but not to distinguish T1 prompts from T2.

Matching frontier performance is not the same as solving the problem. A precision of 0.60 means four in ten approved prompts are unpluckable, and most of those are the insidious T1 tier. **Training bought efficiency, not capability**. We got cheaper judges, not better ones.

### Preference Learning Hit the Same Wall

Our tier structure implies a natural preference ordering, T3 > T2 > T1 > T0, and reward models are explicitly designed to learn this kind of signal. Rather than drawing a hard boundary, they learn to score better options higher than worse ones.

We constructed preference pairs from prompts anchored to the same highlight, yielding 353 training pairs and 93 for evaluation. About half of these comparisons test targeting (off-target vs on-target), and half test construction. After training, the reward model preferred the higher-tier prompt in 70% of held-out comparisons.

On targeting comparisons, T0 against anything above it, accuracy reached 77%. The reward model reliably learned to prefer prompts that are about the right thing. But on construction comparisons, accuracy dropped to 62%. Supervision reliably captured targeting preferences, but not our taste in construction.

### Why Reinforcement Learning Doesn’t Save Us

We also tried reinforcement learning, specifically GRPO (Group Relative Policy Optimization), to teach models to produce reasoning traces before classification. The intuition: if a model could learn to analyze prompts step-by-step—first assessing targeting, then construction, then reviewability—it might internalize the judgment process rather than pattern-matching on surface features.

This approach produced no statistical improvement over baseline. GRPO learns from rollouts where sampled completions disagree—some succeed, others fail—and uses the contrast to update the policy. But when all completions for a task produce the same result, there’s no gradient signal.

We measured pass@8 accuracy across base models: given eight sampled completions per task, how often does at least one get the tier right? DeepSeek V3.1, the strongest model, reached 60% accuracy. But on 116 of 212 tasks, all eight completions agreed—either all correct or all wrong. No contrast, no gradient, leaving nothing for GRPO to follow. The dataset is already small; RL makes it smaller.

### Memory Prompt Data Is Expensive

We have ~1,500 samples. Perhaps construction taste would emerge with ten or a hundred times more data. In practice, collecting such data is difficult.

**Labeling requires simulation, not recognition**. A rater must understand the source material, infer what the highlight signaled as interesting, and then simulate how that prompt would feel to review over time. Construction quality isn’t a surface property. It depends on anticipating ambiguity, drift, and loss of salience across repeated encounters.

**Review signals are confounded.** Another approach: skip labeling and infer quality from actual review behavior. Leeches (prompts that never stabilize) might indicate construction problems; abandoned prompts might indicate poor targeting. But in our setting, each user creates prompts from different articles. A prompt may be abandoned because it is poorly constructed, or simply because their interest waned.

**Preferences capture “least wrong,” not “right.”** When choosing between memory prompts, users rarely have a fully specified objective: they’re often reaching for a particular detail or framing they recognize but can’t crisply articulate. Faced with two imperfect options, they select the one that misses by less. The preference signal encodes proximity to an unstated goal, not satisfaction of it. What the user actually wanted appears nowhere in the data.

At sufficient scale, the signal might rise above this noise. But to overcome the distortion, we’d need a dataset several orders of magnitude larger than what we have.

## 4. Escaping Transfer with Grounding

Training hit the same ceiling as prompting. Neither approach taught the T1/T2 boundary. The failure was consistent across rubrics, preferences, and fine-tuning: the elements of construction that matter most were the ones where we found the least leverage. If that taste doesn’t transfer, then we need to find a way to make progress without transfer.

So we changed the question. Instead of asking whether a prompt satisfies a theory of “good prompts,” we can ask how it compares to other prompts for the **same highlight**. We show the model labeled examples drawn from that same passage—prompts we have already rated—and ask it to place a new candidate among them. The model judges by local comparison, rather than evaluating in isolation. This grounded approach doesn’t depend on transfer.

We asked the grounded judge to predict the full four-tier rating, then collapsed its predictions into **pluckability** (i.e. T2/T3 vs. T0/T1). This let us test both whether grounding improves fine-grained discrimination, and also whether those improvements translated into better separation at the boundary that actually matters.

They did—but with a tradeoff. Using Sonnet 4.5, overall tier accuracy rose from 39% to 49% when grounded. More importantly, **pluckability precision jumped from 56% to 78%, and false positives dropped from 52% to 17%**. The judge became conservative: it approved fewer prompts, but the ones it approved were far more likely to be genuinely usable. For the first time, errors redistributed in a way that aligns with the cost structure of review. T1 prompts—the expensive failures—were caught more often.

The confusion matrix makes the shift visible. The T1/T2 boundary remains imperfect, but the diagonal sharpens rather than collapses. Across three independent passes, human–model agreement on pluckability reached κ = 0.61 ± 0.03—high enough to support aggregation and downstream comparison.

With grounding, models no longer need to learn what makes a prompt good in general. They only have to compare candidates within a local context. Instead of transferring our taste, we encode it in the labeled examples. This approach gives us an evaluation framework that roughly preserves our preferences while we change models, instructions, and other variables.

## 5. How Bad Is Generation?

Grounding gives us something new: an evaluation stable enough to measure against. The judge isn’t perfect—it still confuses T1 and T2 at meaningful rates—but its errors are consistent. When it approves a prompt, that prompt is far more likely to be usable than under any earlier approach. That’s enough to let us finally ask: **how bad are LLMs at generating prompts?**

We ran frontier models across the same set of highlights and scored every output with the grounded judge. To verify that the evaluation could detect real degradation, we included a control condition: Gemini 2.5 Pro with a trivia-style instruction that asks for literal, context-free questions. These are exactly the kinds of prompts our taxonomy is designed to penalize. If the judge could not separate this from serious generation, the benchmark would not be meaningful.

   GPT-5.2     10%
    26%
    29%
    35%
    OpenAI o3     16%
    30%
    26%
    29%
    Gemini 2.5 Pro     8%
    40%
    21%
    31%
    Opus 4.5     11%
    39%
    21%
    29%
    Gemini 3 Pro     12%
    34%
    28%
    26%
    Sonnet 4.5     12%
    40%
    21%
    27%
    Sonnet 3.7     9%
    47%
    26%
    19%
    GPT-4.1     7%
    52%
    25%
    16%
    Gemini 3 Flash     18%
    37%
    22%
    24%
    GPT-4o     12%
    59%
    18%
    11%
    Haiku 3     14%
    60%
    18%
    9%
    Gemini 2.5 Pro (QA)     33%
    42%
    16%
    9%
      T0     T1     T2     T3   

Under the trivia instruction, Gemini 2.5 Pro produces 33% T0 and 42% T1. Three quarters of its output is unusable, and a third is not even about the right thing. The same model with a proper instruction produces 8% T0 and 40% T1. The T0 gap alone confirms that the judge is sensitive to targeting failures. The similar T1 rates make sense: even if they happen to land on topic, trivia-style prompts usually can’t survive long-term review without carefully structured wording.

Across the remaining models, T0 rates are generally low—most around 10%, with a few reaching higher. Models are rarely off-target; the dominant failure mode is construction.

A year ago, T1 rates were severe: GPT-4o at 59%, Claude 3.7 Sonnet at 47%, GPT-4.1 at 52%. Late-2025 models show real progress. GPT-5.2 drops T1 to 26%. Gemini 3 Pro lands at 34%. However, even the strongest model we tested (GPT-5.2) still produces **unusable prompts roughly a third of the time.**

    0%
    20%
    40%
    60%
    80%
      74%
  Claude 3  Haiku      71%
  GPT-4o      56%
  Claude 3.7  Sonnet      59%
  GPT-4.1      46%
  o3      48%
  Gemini  2.5 Pro      52%
  Sonnet  4.5      50%
  Opus  4.5      46%
  Gemini  3 Pro      36%
  GPT-5.2      55%
  Gemini  3 Flash   
Unusable Prompts (%)
    T0 — Off-target     T1 — Needs Refactor   

## 6. The Arena

The tier distributions from Section 5 tell us something, but they don’t capture the actual user experience.

Consider two generation pipelines for the same highlight. Pipeline A produces four prompts: three T1s and one T3. Pipeline B produces two prompts: both T2. By tier distribution, Pipeline A looks better—it has the only T3. But in practice, Pipeline B is often preferable. Users of Pipeline A must read through three broken prompts before finding the one that works. Each T1 requires careful consideration. But not all errors are equal. T0 prompts are more obviously wrong—you can reject them quickly. From a review-cost perspective, T1 is the worst failure mode. We should evaluate models accordingly.

### Cost-Sensitive Scoring

To compare pipelines rather than individual prompts, we need a scoring function that accounts for the full set of outputs a model produces—rewarding good prompts while penalizing the burden imposed by the rest.

We assign utilities based on this asymmetry: T0 = −1.0, T1 = −3.0, T2 = +1.5, T3 = +2.0. The negative values reflect burden; the positive values reflect useful contribution. But recall that our judge is imperfect. It confuses T1 and T2 at meaningful rates. If we trusted its predictions directly, we’d inherit those errors. So we used the confusion matrix from our human-judge agreement study to compute posterior expected utilities. When the judge predicts T2, some fraction of those predictions are actually T1 prompts that it misjudged.

We apply Bayes’ theorem to compute the expected true tier given each judge’s prediction, then weighted by the costs above. After calibration, the resulting expected utilities:

  Judge T0  →  −1.10  ·  Judge T1  →  −1.43  ·  Judge T2  →  +0.50  ·  Judge T3  →  +1.02  

Notice that Judge T2 is only slightly positive. This reflects T1 leakage: the judge confuses T1 and T2 often enough that even a small probability of misclassification pulls down the expected value. This is conservative by design—we’d rather undervalue borderline prompts than let expensive failures through.

For each (model, highlight) pair producing prompts with expected utilities, we compute a completion score:

S  =  maxi(ui)
 +  Σui < 0 ui

The first term captures benefit: the best prompt in the batch determines the upside. The second term captures cost: all negative-utility prompts impose review burden regardless of whether a good prompt exists. A completion with one T3 and two T0s scores lower than a completion with two T2s—the former wastes reviewer time even though it contains a high-quality prompt. Under this formulation, we adjust for judging miscalibration and align scoring with actual review cost.

### Results

We adapted an arena-style benchmark to compare generation pipelines. For each highlight, models were given a simple instruction and the entire source text and then tasked with generating prompts. Models received a minimal instruction and the full source text. No intermediate transformation was introduced, so differences reflect generation quality rather than upstream filtering. The grounded judge scored each one; completion scores determined pairwise winners; Elo ratings aggregated outcomes into global rankings.

| # | Model | Elo | Usable % | Win Rate |
| --- | --- | --- | --- | --- |
| 1 | GPT-5.2 | 1630.1 | 64.3% | 53.6% |
| 2 | Claude Sonnet 5 post-report | 1592.5 | 58.0% | 50.6% |
| 3 | OpenAI o3 | 1587.3 | 54.3% | 47.3% |
| 4 | GPT-5.5 post-report | 1578.9 | 55.2% | 47.1% |
| 5 | Gemini 2.5 Pro | 1565.7 | 52.1% | 46.5% |
| 6 | Claude Opus 4.6 | 1541.0 | 52.8% | 45.3% |
| 7 | Claude Opus 4.5 | 1536.9 | 49.8% | 44.9% |
| 8 | Gemini 3.1 Pro | 1532.8 | 51.5% | 41.9% |
| 9 | Gemini 3 Pro | 1525.9 | 54.6% | 46.2% |
| 10 | Claude Fable 5 post-report | 1498.1 | 47.4% | 43.3% |
| 11 | GPT-4.1 | 1486.4 | 41.0% | 34.9% |
| 12 | Claude Sonnet 4.5 | 1482.6 | 48.3% | 41.8% |
| 13 | Claude Sonnet 3.7 | 1478.4 | 44.2% | 37.7% |
| 14 | Claude Opus 4.8 post-report | 1471.3 | 50.7% | 40.0% |
| 15 | GPT-5.4 | 1460.6 | 46.3% | 37.4% |
| 16 | Claude Opus 4.7 | 1454.5 | 47.4% | 40.9% |
| 17 | Gemini 3 Flash | 1443.3 | 45.6% | 37.9% |
| 18 | GPT-4o | 1424.5 | 29.6% | 27.9% |
| 19 | Claude Haiku 3 | 1389.9 | 26.4% | 27.1% |
| 20 | Gemini 2.5 Pro (QA) control | 1319.1 | 24.6% | 22.5% |

### A Prototype for Progress

The arena is a prototype, not a finished benchmark. Several sources of error remain.

The judge is stochastic. The same prompt can receive different ratings across evaluation passes, and individual comparisons are noisy. A fine-tuned judge run at lower temperature would reduce this variance. Even without improving accuracy, more deterministic inference would yield more stable rankings.

Prompts are judged independently, with no global arbitration within a match. A model may win or lose partly because of how the judge happened to calibrate in that call. Scoring both completions for a highlight in a single inference pass would enforce consistent standards within each comparison.

Our cost assignments (T0 = −1, T1 = −3, T2 = +1.5, T3 = +2) are based on intuition about review burden rather than direct measurement. Controlled studies in which humans review prompts of known tiers could ground these weights in observed behavior.

Despite these limitations, the framework enables progress. When we aggregate across many comparisons, we can see stable differences between pipelines. The arena does not solve the transfer problem. But it gives us a way to iterate on generators and judges alike, tracking progress even when individual judgments remain noisy and unreliable.

## Conclusion

Within our dataset of ~1500 memory prompts, we found that models are generally good at detecting off-target prompts. Targeting largely transfers. But the highest-ranking model we tested, GPT-5.2, still generates unusable prompts 36% of the time. The failure appears at the boundary that matters for spaced repetition: distinguishing whether a reasonable-looking prompt will reliably reinforce its target over longer time horizons (T2+), or whether it will produce confusion and friction (T1).

Both evaluation and generation struggle to discern this T1/T2 boundary. The findings of our rubric study reflect that. Models are best at judging criteria that are apparent without review: missing context, surface ambiguity, shallow phrasing. They are weakest at judging the aspects of construction that only emerge through repeated use: clarity and answer stability.

We tried to bridge this gap with prompting, rubrics, preference data, and training. Grounding had the largest effect: when models are shown labeled prompts for the same highlight, rating judgment precision jumps from 56% to 78%. But even with that impractically helpful grounding, ratings remain unreliable at the T1/T2 boundary.

The arena lets us make progress anyway. By aggregating noisy judgments, it reveals stable, relative differences between models and generation strategies. Even without a judgment that fully transfers, this gives us a baseline to measure against, and a compass which future work can use to improve both evaluation and generation.

Memory system users develop taste for good prompts by reviewing them over time and noticing which ones endure. We can approximate that taste in techniques like rubrics, and we can roughly measure it. But it remains unclear how to more fully transfer the taste we acquire through those review experiences.

## [Appendix](/appendix)

* [A. The srs-prompts Dataset](about:/appendix#a-the-srs-prompts-dataset)
* [B. Highlights Study](about:/appendix#b-highlights-study)
* [C. Evaluation Experiments](about:/appendix#c-evaluation-experiments)
* [D. Training Experiments](about:/appendix#d-training-experiments)
* [E. Arena Implementation](about:/appendix#e-arena-implementation)
* [F. Improving the Judge](about:/appendix#f-improving-the-judge)
* [G. Known Limitations](about:/appendix#g-known-limitations)
* [H. Future Research](about:/appendix#h-future-research)

## References

Krumdick, M., et al. (2025). No Free Labels: Limitations of LLM-as-a-Judge Without Human Grounding. arXiv:2503.05061

Nielsen, Michael A. (2018). Augmenting Long-term Memory. <http://augmentingcognition.com/ltm.html>

Shao, Z., Wang, P., Zhu, Q., et al. (2024). DeepSeekMath: Pushing the Limits of Mathematical Reasoning in Open Language Models. arXiv:2402.03300

Zheng, L., Chiang, W., Sheng, Y., et al. (2023). Judging LLM-as-a-Judge with MT-Bench and Chatbot Arena. *NeurIPS 2023*. arXiv:2306.05685

## Acknowledgments

We thank Giacomo Randazzo for reviewing an early draft, and Piergiacomo De Marchi, Andrew Mayne, Nic Becker, Stefan Djokovic, Julian Alvarez, Amar Singh, Markus Strasser, and David Holz for helpful conversations. All mistakes are our own.

Primary funding for this research was provided by [cyber•Fund](https://cyber.fund/).

Additional funding was provided by [Andy’s Patreon community](https://patreon.com/quantumcountry). Special thanks to sponsor-level patrons as of April 2026: [Adam Marblestone](http://www.adammarblestone.org/), [Adam Wiggins](https://twitter.com/hirodusk), [Andrew Sanchez](https://x.com/informandrew), [Andrew Sutherland](https://asuth.com/), Andy Schriner, [Ben Springwater](https://twitter.com/benspringwater), [Bert Muthalaly](http://somethingdoneright.net/), Boris Verbitsky, [Calvin French-Owen](http://calv.info/), [Dan Romero](https://danromero.org/), [David Wilkinson](https://david.wilkinson.xyz/about), Dylan Houlihan, [fnnch](https://fnnch.com/), Greg Vardy, [Heptabase](https://heptabase.com/), [James Hill-Khurana](https://jameshk.com/), James Archer, James Lindenbaum, [Jesse Andrews](https://m4ke.org/), [Kevin Lynagh](https://kevinlynagh.com/), [Kinnu](http://kinnu.xyz/), [Lambda AI Hardware](https://lambdalabs.com/), [Ludwig Petersson](https://twitter.com/ludwig), [Maksim Stepanenko](http://maksim.ms/), [Matt Knox](http://mattknox.com/), Michael Slade, [Mickey McManus](http://www.t-1ventures.com/), [Mintter](http://mintter.com/), [Patrick Collison](https://patrickcollison.com/), [Peter Hartree](https://peterhartree.co.uk/), [Ross Boucher](http://rossboucher.com/), [Russel Simmons](https://github.com/rsimmons/), [Salem Al-Mansoori](https://twitter.com/uncomposition), [Sana Labs](https://www.sanalabs.com/), [Thomas Honeyman](https://thomashoneyman.com/), Todor Markov, [Tooz Wu](https://twitter.com/toozwu), William Clausen, [William Laitinen](https://www.exigeinternational.com/), [Yaniv Tal](https://twitter.com/yanivgraph).

In academic work, please cite this as:

Ozzie Kirkby and Andy Matuschak, “Memory Machines: Can LLMs create lasting flashcards from readers’ highlights?”, <https://memory-machines.com/report>, San Francisco (2026).