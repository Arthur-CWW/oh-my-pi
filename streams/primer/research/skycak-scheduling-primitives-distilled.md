# Skycak scheduling / review-system primitives — distilled

Faithful distillation of the methods and primitives Justin Skycak (@justinskycak) describes across two chained X posts. Every claim is anchored to a tweet permalink; wording in quotes is verbatim. Organization is editorial; content is not.

- **T1** = https://x.com/justinskycak/status/2074331548342538696 (posted 2026-07-07T03:15:54Z)
- **T2** = https://x.com/justinskycak/status/2074376893067911436 (posted 2026-07-07T06:16:06Z, chained continuation of T1)

Extraction date: 2026-07-10. Both source files (full verbatim text) sit alongside this document.

---

## 1. Knowledge-graph / dependency structure

- The knowledge graph is the foundation: "The knowledge graph is the main ingredient in our secret sauce that empowers students to learn at breakneck speed." (T1)
- Scale and role, via the quote tweet embedded in T1 (Alex Smith, @ninja_maths): "This knowledge graph spans 3,000 math topics, from 4th grade to the university level, providing the perfect basis for mastery learning." (T1, quoted tweet)
- Prerequisite gating is a hard ordering constraint, justified mechanistically by working memory: a concept "needs to be introduced after the prerequisites have been learned (so that the prerequisite knowledge can be pulled from long-term memory without taxing WM)". (T2)
- Mastery gating must be measured, not attendance-based: systems that gate on prerequisite lessons often "don't actually measure tangible mastery … The student has to actually be getting problems right, and those problems have to be representative of the content covered in the lesson." (T1, reason 3)
- Anti-pattern: "Tons of systems allow students to move on to more material despite not demonstrating knowledge of prerequisite material." (T1, reason 3)

## 2. Scheduling-within-scheduling (implicit repetition credit)

The key compound-scheduling primitive: reviews of advanced topics implicitly review their prerequisites, and the scheduler must propagate that credit through the graph.

- Verbatim: the teacher (or system) "has to separately track each student's progress on each problem type, manage a spaced repetition schedule of when each student needs to review each topic, and continually update each schedule based on the student's performance (which can be incredibly complicated given that each time a student learns or reviews an advanced topic, they're implicitly reviewing many simpler topics, all of whose repetition schedules need to be adjusted as a result, depending on how the student performed). This is an inhuman amount of bookkeeping and computation." (T1, reason 2)
- Consequences stated in the threads: per-student × per-topic state, schedule updates conditioned on observed performance, and adjustment of *many* simpler topics' schedules per advanced-topic event. (T1, reason 2)
- [AMBIGUOUS] The threads do not specify the algorithm for how much implicit-review credit a prerequisite receives, how "depending on how the student performed" is quantified, or how conflicts between schedules are resolved. Skycak asserts elsewhere in T1 that forgetting "can [be modeled] precisely, mathematically, using a forgetting curve", but no formula or parameterization is given in these posts.

## 3. Spaced repetition core

- Spacing effect: "more long-term retention occurs when you space out your practice, even if it's the same amount of total practice." (T1)
- Expanding intervals: "the more reviews are completed (with appropriate spacing), the longer the memory will be retained, and the longer one can wait until the next review is needed." (T1)
- Unit definition: "A 'repetition' is a successful review at the appropriate time." (T1)
- Decay model: "if you don’t review information, you forget it. You can actually model this precisely, mathematically, using a forgetting curve" — with the caveat that these are "noisier stochastic processes (that also have noisier underlying variables)." (T1)
- Physical grounding: "The representations in LTM gradually, over time, decay and become harder to retrieve if they are not used, resulting in forgetting." (T2)

## 4. Retrieval practice (review must be closed-book)

- Testing effect: "To maximize the amount by which your memory is extended when solving review problems, it's necessary to avoid looking back at reference material unless you are totally stuck and cannot remember how to proceed." (T1)
- Combined primitive: "The testing effect can be combined with spaced repetition to produce an even more potent learning technique known as spaced retrieval practice." (T1)
- Mechanism: "Each time you successfully actively retrieve fuzzy information from LTM, you physically refresh and deepen the corresponding neural representation in your brain. But that doesn’t happen if you just passively re-ingest the information through your senses." (T2)

## 5. Interleaving (mixed practice) as a review-queue policy

- "During review, it's also best to spread minimal effective doses of practice across various skills. This is known as mixed practice or interleaving -- it's the opposite of 'blocked' practice, which involves extensive consecutive repetition of a single skill." (T1)
- Rationale: blocked practice "can give a false sense of mastery and fluency"; mixed practice "creates a 'desirable difficulty' that promotes vastly superior retention and generalization." (T1)
- Note the dosage primitive embedded here: "minimal effective doses" of practice per skill, spread across skills — i.e. many small heterogeneous review items rather than long homogeneous runs. (T1)

## 6. Task selection / prioritization (closest thing to a priority-queue idea)

- Per-student, per-moment selection: every student works "on the specific types of problems, and in the specific types of settings (e.g., with vs without reference material, blocked vs interleaved, timed vs untimed), that will move the needle the most for their personal learning progress at that specific moment in time." (T1, reason 2)
- Deliberate practice as the targeting rule: "individualized training activities specially chosen to improve specific aspects of a student's performance through repetition (effortful repetition, not mindless repetition) and successive refinement" — explicitly targeting "areas beyond one's repertoire" rather than comfort-zone practice. (T1)
- Remediation policy: when a student struggles, the system should "take actions that are most likely to strengthen a student's area of weakness and empower them to clear the bar fully and independently on their next attempt" — not lower the bar (e.g. hints). (T1, reason 3)
- [AMBIGUOUS] "Move the needle the most" implies a scoring/priority function over candidate tasks, but the threads never name a queue, a scoring formula, or a tie-breaking rule. Treat "priority/queueing" as an inference label; the verbatim primitive is argmax-style per-moment task selection.

## 7. Granularity: bite-sized scaffolding bounded by working memory

- Sizing rule: each concept "needs to be broken down into bite-sized pieces small enough that no piece overloads any student's WM." (T2)
- WM budget that motivates it: "about 7 digits (or more generally 4 chunks of coherently grouped items) simultaneously and only for about 20 seconds," less under mental manipulation; "Limited capacity makes WMC a bottleneck in the transfer of information into LTM." (T2)
- Overload is not a desirable difficulty: "a heavy load will decrease their performance and slow down their learning in a way that is NOT a desirable difficulty." (T2)
- Anti-corner-cutting constraint: bite-sized must not mean watered down — systems fake it "by watering down the content, cherry-picking the simplest cases of each problem type, and skipping lots of content." (T1, reason 3)

## 8. Variable practice-to-mastery (per student, per task)

- "each student needs to be given enough practice to achieve mastery on each piece (and that amount of practice may vary depending on the particular student and the particular learning task)." (T2)
- Same point in classroom terms: "different students will require different amounts of practice to master the solution technique. Some students will catch on quickly … while other students will require many more attempts." (T1, reason 2)
- Individual differences in WMC also modulate learning rate, but their impact "is diminished" once the task is consolidated into LTM. (T2)

## 9. Active learning envelope

- "actively solving problems produces more learning than passively watching a video/lecture or re-reading notes"; students should be "actively solving problems as soon as possible following a minimum effective dose of initial explanation." (T1)
- Automaticity as a prerequisite for freeing WM: "it's critical to practice low-level skills enough that they can be carried out without requiring conscious effort" (basketball analogy). (T1)
- Expertise reversal effect constrains method choice: "Beginners (i.e. students) learn most effectively through direct instruction," not expert-style open-ended group work. (T1)
- Immediate feedback on every attempt, "including remedial support when necessary." (T1, reason 2)

## 10. Why humans can't run this scheduler (motivation for automation)

- "In the absence of the proper technology, it is impossible for a single human teacher to deliver an optimal learning experience to a classroom of many students with heterogeneous knowledge profiles." (T1, reason 2)
- Desirable-difficulty economics: each strategy "increases the intensity of effort required … converted into an outsized gain in learning," while teachers are "incentivized to maximize the immediate performance and/or happiness of their students," feeding the "illusion of comprehension." (T1, reason 1)
- The system alone is insufficient: accountability is an external primitive — an adult must enforce daily progress and set incentive structures ("no video games tonight until you complete your work"). (T1, reason 4)

## 11. Physical/mechanistic grounding claimed for all of the above

- Goal function: "increase the quantity, depth, retrievability, and generalizability of mathematical concepts and skills in the student’s long-term memory." (T2)
- Consolidation: "creating strategic connections between neurons so that the brain can more easily, quickly, accurately, and reliably activate more intricate patterns of neurons." (T2)
- WM's real limit "is not a fixed number of storage units, but rather, the ability to sustain relevant neural activity while suppressing interference from irrelevant activity." (T2)

---

## Coverage caveats

- Reply discussion (33 replies on T1, 1 on T2) could not be rendered in the capture environment (offscreen WKWebView visibility throttling; see source files' Replies sections), so this distillation draws only on the two author posts and T1's embedded quote tweet.
- Both posts embed one image each (alt text "Image" only, not visually inspected); any diagrammatic detail in those images is not reflected here.
