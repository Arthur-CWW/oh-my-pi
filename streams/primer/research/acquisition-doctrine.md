# Acquisition doctrine — Chinese (Primer Vertical One)

**Status:** doctrine brief, 2026-07-16. Gates the next build waves (reader popup,
enrichment output, review cards, ask panel). It does *not* specify the scheduler
(sibling doc / `SchedulerCore`, `DependencyGatingDesigner`) or pixel-level UI.
This is the theory of *acquisition-not-translation* for Arthur's Mandarin, mined
from his own recorded thinking. No invented pedagogy: every load-bearing claim is
tagged and traceable to a primary source.

**Provenance tiers** (per `PREFERENCES.md` evidence discipline):
`[A]` Arthur verbatim · `[A~]` Arthur paraphrase / his own repo design doc ·
`[I]` inference from the evidence · `[M]` model/theorist judgment added here.

> **Identity note:** `@pleometric` **is Arthur's own X account** (`VISION.md`
> §Research corpus; `docs/pleometric.md`). His tweets are therefore first-person
> primary source, cited by tweet id. Where a tweet is a public-facing statement
> of the same view he states privately, it is tagged `[A]`.

**Primary sources cited below**
- `[Arthur 2026-07-15]` — this session's transcribed words (see task context).
- Pleometric acquisition thread: tweets `2034995583958519950` (Mar 20 2026),
  `2036466514556064052` (Mar 24 2026), `2034998445862220278` (Mar 20 2026),
  `1996233612048359882` (deck translations "toggle to discourage EN<>CN
  mapping"), `2054744133437141247` (May 14 2026, 4 h/day immersion),
  `2034631133271355411` (HSK deck generator). Verbatim text in
  `data/twitter-archive/twitter-archive.sqlite` (`username='pleometric'`) and
  transcribed in `decks/hsk-deck/docs/pleometric.md`.
- `decks/hsk-deck/docs/mandarin-cantonese-card-design-report.md` — Arthur's own
  card-design report (the design keystone). Cited `[card-report:LINE]`.
- `decks/hsk-deck/docs/pleometric.md` — distilled Pleometric doctrine + full
  tweet transcripts. Cited `[pleometric.md:LINE]`.
- `decks/hsk-deck/docs/review-practice-guidelines.md`, `hsk1_sentences.md`,
  `anki-chinese-hover-dictionary-addon-design.md`, `README.md`.
- ASR recovery: `VISION.md` §Open recoveries #1; `research/recoveries.md` §1/§4.

---

## 0. The one claim (everything else is a corollary)

> "when you map back to English, context, and English words, you're not really
> acquiring the information. It's a bad crutch." `[A][Arthur 2026-07-15]`

Acquisition is building a **subconscious `hanzi/sound → concept` map through
repeated comprehensible exposure**, not a fast conscious `word → English word`
lookup. `[A]` Pleometric: "You're learning to map [word -> word] and not [word
-> concept]. This allows you move much more quickly ... with the downside of
giving your brain a quick heuristic instead of true acquisition."
(`2034995583958519950`). This is Krashen's acquisition/learning distinction:
"Krashen posits that learning interferes with acquisition ... the mechanisms
that allow children to learn are still fully functional in adults"
`[pleometric.md:155]`. `[M]` Every Primer surface is therefore judged by one
test: *does it grow the concept map, or does it install an English heuristic
that the concept map then has to overwrite?*

The honest metric for the whole vertical (from `VISION.md`):
**time-to-comprehension of the next chapter, trending down** — with fewer
lookups. `[A~]`

---

## a. Why `word ↔ EN-dict` mapping fails

1. **It teaches the wrong function.** The canonical SRS card
   `character → reading → translation` (大学生 → だいがくせい → College Student)
   "has the fundamental problem of primarily mapping your target language to
   your own language." `[A]` (`2034995583958519950`). You get fluent at
   *translating*, not at *understanding*. `[M]`

2. **Arthur has direct negative evidence — the Hanly failure.** "Previous Hanly
   experience: ~a few hundred characters memorised, but it didn't stick.
   Hanly's Heisig-style approach mapped characters to English keywords and
   stories. I recognised the characters but couldn't understand sentences —
   because the mapping was always character → English keyword, not character →
   meaning in a Chinese-language context." `[A][card-report:7]`. The endpoint of
   `word→EN` is "speaking English with Chinese words." `[A]`
   (`2034995583958519950`: "a lot of English Speakers who try to learn Japanese
   are just speaking English with Japanese words").

3. **The crutch is sticky.** Once English is the answer key, the eye reaches for
   it and the concept map never has to form. The goal state is the opposite:
   "very rarely does the english meaning pop up in my head when thinking about a
   word, and this accelerates the type of content I can parse." `[A]`
   (`2036466514556064052`). The rule Pleometric applies to himself: "At no point
   am I allowed to use dictionaries, unless they are CN <> CN ones."
   `[A][pleometric.md:144]`; "Ditch native-language assistance around ~500 words
   in." `[A~][pleometric.md:39]`.

4. **The glossing literature agrees, with a sharp caveat.** Glosses beat no
   glosses for vocabulary uptake, but "L1 glosses often outperform L2 glosses
   ... English definitions may be efficient for testable recall, but they push
   exactly the mapping Pleometric is trying to avoid." `[A~][card-report:129]`.
   `[M]` So the measured efficiency of English glosses is a *trap* for this
   goal: it optimizes the recall test while degrading acquisition. English is
   allowed only as an emergency **verification** layer, never the default
   answer. `[A][card-report:10,19]`

**Design consequence:** English is a debug layer, not the answer surface. Any
surface whose default reveal is an English gloss is mis-designed. `[A~]`

---

## b. The Cantonese-pivot alignment mechanism

Arthur is **not an English-L1 beginner**; he is a heritage Cantonese listener.
"I grew up with spoken Cantonese, so Cantonese sentences and audio are
immediately comprehensible to me in a way that English definitions never were
... When I translated Mandarin sentences into Cantonese ... I understood them
immediately. The meaning was already there in my Sinitic-language mental model.
English was the detour." `[A][card-report:5,8]`

This gives a bridge that stays **inside Sinitic language space**: `[A~][card-report:111-112]`
Cantonese maps a Mandarin sentence to a nearby Chinese conceptual/grammatical
world *without invoking English*. The concept map being built and the bridge
being used are the same map.

**How the bridge is built (from the repo).** The deck stacks the two Sinitic
readings **vertically, sentence-aligned**, so the eye maps one to the other in a
single glance. Format from `hsk1_sentences.md` (title: "Mandarin Sentences with
Cantonese Hints"):

```
M:  Zhè shì wǒ zuì xǐhuān de shū.      这是我最喜欢的书。
C:  ni1 bun2 hai6 ngo5 zeoi3 zung1 ji3 ge3 syu1.   呢本係我最鍾意嘅書。
```

`[A]` This session: "we use the Cantonese sentence ... vertical alignment, so
that I can easily map ... it's more one-to-one mapping." `[Arthur 2026-07-15]`.
The vertical M/C stack is exactly that: the Mandarin target on top, the
immediately-comprehensible Cantonese directly beneath, one sentence to one
sentence.

**Critical tension — resolve it, do not paper over it** `[M]`:
- `[A]` Arthur wants "one-to-one mapping" (this session).
- `[A~]` His own report warns: "Align by phrase/chunk rather than pretending it
  is one-to-one character alignment. Mandarin and Cantonese differ too much
  lexically and grammatically for reliable character-level alignment."
  (`[card-report:244]`).

**Reconciliation** `[I][M]`: the one-to-one Arthur is after is a **sentence- and
chunk-level** correspondence, not a character grid. It cannot be
character-by-character because the languages diverge exactly where it matters —
lexically (`的→嘅, 了→咗, 不→唔, 是→係, 什么→乜嘢`) and in word order (dative
`给 N V O` vs `V O 俾 N`; disposal `把` vs `將`; aspect `正在 V` vs `V 緊`; all
catalogued in `Cantonese Translation Analysis.md`, `grammar-drill-cards.md`).
The vertical stack delivers the *feeling* of one-to-one (his Sinitic model
resolves the whole sentence at a glance) while chunk alignment keeps it honest
where the grammars split. **Do not build a character-cell alignment UI for the
Canto pivot; align at sentence + phrase chunk.** `[A~][M]`

**Guardrail — the bridge is a controlled crutch, not a replacement.**
"visible Cantonese can also become the thing you read instead of Mandarin,
especially if it is easier for comprehension." `[A][card-report:113]`. So:
Mandarin is the target and stays visually dominant; the Canto pivot is a *first
reveal* (or a deliberately secondary line), not the default answer.
`[A][card-report:17,115-123]`. The self-check: "You are not fooling yourself if,
after Cantonese, the Mandarin sentence becomes clear. You may be fooling
yourself if Cantonese makes the meaning clear but the Mandarin still looks like
noise." `[A~][review-practice-guidelines.md:151-153]`

> **Open lane, do not lose it:** Arthur's *listening* Cantonese fails on
> colloquial media vocabulary that doesn't overlap HSK cognates (`VISION.md`
> §Vertical one). The pivot is strongest for HSK-cognate vocabulary and weakest
> exactly where cdrama Cantonese is most colloquial. `[A~]` A colloquial-Canto
> frequency lane is a separate build, not this doctrine's job.

---

## c. The monolingual scaffolding ladder

The bridges form a strict priority ladder — **use the highest rung that resolves
the meaning; fall to the next only on failure.** Descending the ladder = adding
scaffolding; the whole art is to *peel it off* as acquisition proceeds. Arthur:
"we have to get to the features which actually aid in learning, and slowly peel
them off." `[A][Arthur 2026-07-15]`

| Rung | Layer | Role | Source |
|---|---|---|---|
| 1 | **zh-only, in context** | Meaning emerges from the sentence + repeated exposure + non-verbal clues (image/scene/audio). The default. | `[A]` `2034995583958519950`; `[card-report:140]` (#1 "Sentence context") |
| 2 | **Cantonese pivot** (sentence + audio) | First semantic bridge; stays in Sinitic space. Arthur's "first definition where natural." | `[A][card-report:17,136,141]` |
| 3 | **zh-zh clue** (paraphrase / antonym / classifier) | Target language explaining itself once ≥HSK3 vocabulary allows. e.g. `不贵`, `很小`, `去某个地方`. | `[A][card-report:134,142]`; `[A]` `2036466514556064052` (便宜→不贵) |
| 4 | **radical / root decomposition (Hanly)** | *Repair tool for a stuck character*, not the learning method: `字形` component tree, `声旁` phonetic hint, `义旁` semantic hint, `易混` confusables, `例词` known word. On demand / after failure only. | `[A~][card-report:20,159-182]`; `[A][Arthur 2026-07-15]` "integrate the hanly approach ... radical + roots" |
| 5 | **English** (word meaning, sentence translation) | Emergency **verification** layer, behind an extra reveal. Confirms; never teaches. | `[A][card-report:19,144]` (#5 "English translation only if still unclear") |

Notes for builders:
- `[A~]` Radical/root decomposition (rung 4) is a **repair** layer, not a
  pre-reading drill: "Memorising isolated radicals before reading ... doesn't
  transfer to reading speed by itself." (`[card-report:272]`). Arthur still
  wants it as an *explorer* he can open — "ripoff the radical tree/explorer from
  hanly" (`todo.md`) — but gated behind demand/failure, never in the default
  front flow. `[A~][card-report:182]`
- `[A~]` Hanly data is high-coverage exactly where it's useful: decomposition +
  etymology present for 89–99% of HSK 1–6 characters (`[card-report:45,52]`).
  What to pull: decomposition, semantic/phonetic component, primitive→character
  clusters, and its HSK 1–4 word usage sentences. What to **drop**: its
  English-keyword Heisig *stories* — they "reinforce the wrong mapping."
  (`[card-report:309]`). Hanly is Mandarin-only, no Cantonese, English-only
  definitions (`[card-report:92-94]`).
- `[M]` The ladder is monotonic in "distance from the concept": rungs 1–4 stay
  inside meaning-in-Chinese; rung 5 leaves it. Every step down English-ward is a
  small acquisition tax, justified only when the rungs above genuinely failed.

`[A]` The debug walk Arthur actually does, in his own words:
"no idea" > "something about money" > "probably cheap" > "confirmed: cheap"
(`2036466514556064052`) — inferred from video/context, narrowed with a
component he knew (`钱` money), locked in with a **CN-CN** LLM antonym (`不贵`).
English never entered. This is the ladder in motion. `[A]`

---

## d. Input-first acquisition: volume, the 85% gate, and the drama/ASR channel

**Volume is the make-or-break variable, not card count.** "The most important
variable is still total hours of comprehensible Mandarin input." `[A~][card-report:22]`;
"Only massive comprehensible input does." `[A~][card-report:252]`. Pleometric's
own regimen: ~5 h/day audio input at 1 month (`[pleometric.md:123]`); "4 hours a
day of immersion work (watching / reading -> essays to be graded by deepseek)"
at HSK5 (`2054744133437141247`). SRS is a *bootstrapping/parsing* tool that must
**serve** input, not replace it: "it must serve acquisition—not replace massive
input or turn into word-to-word mapping." `[A~][pleometric.md:21]`

**Output is deferred until comprehension is fluent** `[A][pleometric.md:136]`:
"you do not output until you achieve fluent comprehension ... I do not even
attempt to speak or pronounce the language" (Krashen/ALG — J. Marvin Brown's
Automatic Language Growth, `[pleometric.md:157-167]`). `[M]` Implication: Primer
review is *comprehension-first*; do not build EN→CN production drills early.
(Tension recorded in `VISION.md` §Skycak absorbed: recognition ≠ production —
the scheduler may later add timed/production signals; that is the sibling's
call, not this doctrine's.)

**The 85% rule is the comprehensibility *gate* on generated input.** The deck's
"constrained sentence generation" is the enforcement machinery: each sentence
uses **only previously-learned words + a ~80-word function seed + the target
word** (`README.md` "Constrained Sentence Generation"; `2034631133271355411`).
`[A~]` Card-level rule (binding, from `VISION.md`): "the target word is THE new
thing ... at most ONE unknown beyond the target." This directly fixes Arthur's
named failure: "too many unknown words, and I get confused" / "why are so many
hsk cards filled with words (not focused) surrounding it which are high level"
(`todo.md`; `VISION.md`). `[A]`

- `[M]` Calibration inputs, kept distinct (per `VISION.md` §Research corpus):
  **Wilson et al. 2019 "85% rule"** = optimal *error rate in training* (~15%
  failures is where learning is fastest) — the review/scheduling knob.
  **Lexical-coverage reading research (Hu & Nation 98%; card-report uses
  ~90%+ known words per sentence, `[card-report:253]`)** = the *comprehensibility
  threshold for reading*. Both are inputs to generation; they are not the same
  number and should not be conflated. Treat "85% comprehensibility" as a
  **gate/target band**, tuned per surface, not a magic constant.

**Dramas + ASR are the volume channel that also produces text.** `[A~]`
Micro-dramas / cdramas are simultaneously comprehensible input at volume *and* a
source of level-appropriate text (text scarcity is real — "I can't find that
much text", `VISION.md`). Hard subs make the ASR self-verifying.

> ### Named recovery — the ASR model
> **FOUND: `FireRedASR2S`** (`github.com/FireRedTeam/FireRedASR2S`), Arthur's own
> recommended ASR for extracting character-wise Chinese subtitles; **NVIDIA
> Parakeet** for non-Mandarin languages (his own reply). `[A~]`
> - Evidence (`VISION.md` §Open recoveries #1 — marked SOLVED 2026-07-06;
>   `research/recoveries.md` §1 & §4):
>   - Shadowing-tool tweet **`2073920351541588446`** `[A]`: "I made a shadowing
>     tool to help me work on my pronunciation, it extracts character wise
>     subtitles using **FireRedASR2S**. It can slow down audio, repeat
>     sentences, jump forward or back sentence wise and let's you select between
>     pinyin, hanzi or both."
>   - Cdrama-verification tweet **`2073938546545529099`** `[A]`: "It does make
>     mistakes but since most cdramas come with hard subs anyway, it's not too
>     hard to verify."
>   - Browser substrate: `github.com/FireRedTeam/FireRedASR2S` viewed
>     2026-07-06 (`browser_context.sqlite` events 206813/207123); repo self-
>     describes as SOTA all-in-one ASR supporting Mandarin + 20+ dialects,
>     English, code-switching, speech + singing.
> - **Provenance caveat:** these two tweets are **NOT in the local
>   twitter-archive sqlite** (verified — see report). The recovery rests on the
>   browser substrate + `VISION.md`/`recoveries.md`, confidence HIGH.
> - In-house alignment prior art for the shadowing build: `hsk-align --backend
>   qwen` (per-character forced alignment) and `~/apps/bablefish`
>   (MFA forced-alignment-chinese). `[A~]` (build is the sibling shadowing lane,
>   not this doctrine).

---

## e. What this means for every Primer surface — do / don't

`[A~]` unless tagged. The invariant across all four: **Mandarin is the target
and stays dominant; every non-Mandarin aid is opt-in, gated, and peelable;
English is the last rung.**

| Surface | DO | DON'T |
|---|---|---|
| **Reader popup** (in-reader hover dictionary) | Default to **zh-zh** definition + pinyin + a zh example + audio; longest-match under cursor; one-gesture, unobtrusive (`Shift`-hover style), hide on leave. `[A~]` (`anki-chinese-hover-dictionary-addon-design.md:137` "Chinese definitions are mandatory ... English definitions are not shown"). Offer Canto pivot + English **behind an extra reveal**. In the *reader*, one-gesture lookup IS the capture mechanism — lookup should be cheap here (input volume is the goal, `VISION.md` §Skycak). | Show an English gloss as the default popup body. Force full-sentence English translation on hover. Make lookup a multi-step chore in the reader. |
| **Enrichment output** (agent-generated card/margin content) | Generate *through* the known-word model so output obeys the 85% gate (target = the one new thing, ≤1 extra unknown, glossed inline only if unavoidable). `[A]` (`VISION.md`). Prefer zh-zh paraphrase / antonym / classifier / Canto pivot over dictionary prose. Pull Hanly decomposition/etymology into a **collapsible** `character_repair` field. `[A~]` (`[card-report:174-182,303]`). Tag fields by reveal cost (`primary`/`bridge`/`reading`/`meaning_hint`/`english`/`character_repair`/`image`, `[card-report:280-286]`). | Emit English-keyword Heisig *stories* (`[card-report:309]`). Auto-explain on every card ("explanation is not acquisition", `[card-report:274]`). Stuff surrounding high-level vocabulary around the target (`todo.md`). Paraphrase what re-reading the source sentence would already give. |
| **Review cards** | Task = "see/hear Mandarin → understand meaning", no required English step (`[card-report:256]`). Mandarin word + sentence + audio on front; Canto pivot as *first reveal* (secondary), pinyin/jyutping **toggle** (default hidden for mature cards), English behind extra reveal. `[A][card-report:16-21,117-121,190-192]`. Grade by comprehension: "Good = you understand the target word and sentence gist before Cantonese/English." `[A~][review-practice-guidelines.md:62]`. Support a colour markup of characters by status (seen/unseen, POS, first-time) as a *peelable* learning aid `[A][Arthur 2026-07-15]`. | Turn review into a Mandarin→English **translation test** ("rebuilding the same trap Hanly fell into", `[card-report:256]`). Autoplay Cantonese on the front (`[review-practice-guidelines.md:114]`). Pin pinyin/English visible by default. Introduce several unknowns at once. Push EN→CN production drills early (output is deferred). |
| **Ask panel** (LLM helper in-context) | Answer **in Chinese** at the learner's level — the CN-CN LLM debug walk (definition → example → antonym), as Arthur does with DeepSeek (`2036466514556064052`; `[pleometric.md:144]` "unless they are CN <> CN"). Chain from what he already knows; escalate to English only as a final verification and say so. `[A]` | Default to English explanations. Answer with a dictionary dump. "Teach" via English keywords — that reinstalls the `word→EN` heuristic. |

---

## f. Falsifiers and open questions

**Falsifiers** — evidence that would force revising this doctrine `[M]`:
1. If, over a sustained window, cards/reader sessions that *hide* the Canto pivot
   and English produce **slower** next-chapter comprehension or *more* lookups
   than cards that show them — the "crutch is sticky" claim is wrong for Arthur
   and the reveal-cost ordering should flatten. (Metric already named:
   time-to-comprehension trending down, `VISION.md`.)
2. If Arthur consistently reads the Cantonese line *instead of* the Mandarin
   (self-check fails: Canto clear, Mandarin still noise, `review-practice
   -guidelines.md:153`) — then the pivot is a replacement, not a bridge, and must
   be demoted to a later reveal or dropped for that card class.
3. If comprehension plateaus despite high input hours — pure-CI/zero-output may
   be insufficient at his stage and Nation's "four strands" (some meaning-focused
   *output* + language-focused study) should be blended in (`[card-report:33]`).
4. If radical/root decomposition (rung 4) measurably speeds *reading* (not just
   recognition), its "repair-only" gating is too conservative and it earns a
   larger role.
5. If the 85%/98% generation gate makes sentences feel *too easy* (no productive
   struggle), the comprehensibility band is set too high and should drop toward
   the Wilson ~85%-success / ~15%-error training target.

**Open questions for Arthur (≤5):**
1. **Alignment granularity:** confirmed sentence+chunk (not character-grid) for
   the Canto pivot? Your "one-to-one" (this session) vs the report's
   char-alignment warning (`card-report:244`) — is the vertical M/C sentence
   stack the right unit, or do you want phrase-chunk highlighting on top?
2. **Colour markup scheme:** exact palette + dimensions for "mark up the
   character into different colours" — seen/unseen, POS (noun/verb/…),
   first-time-this-card. Which dimensions matter most, and is colour a review-only
   aid or reader-wide?
3. **English kill-switch depth:** should English be *one extra reveal* behind
   Cantonese+zh-zh (current design), or fully off by default with an explicit
   "debug" toggle you flip only when stuck?
4. **Cantonese for cdramas:** the pivot is HSK-cognate-strong but colloquial-
   Canto-weak (your listening gap). For the drama/ASR channel, do we build the
   colloquial-Cantonese frequency lane now, or keep the pivot HSK-scoped and
   accept it degrades on slangy media?
5. **zh-zh onset:** at what point (HSK level / known-word count) do zh-zh
   definitions become the *default* meaning layer over the Cantonese pivot? (You
   said "ditch native-language assistance around ~500 words in" for English —
   does an analogous threshold retire the Canto crutch too?)
