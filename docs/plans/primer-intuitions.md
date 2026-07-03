# Primer intuitions — distilled from Arthur's OMP deep-dives

> Captured from two session clusters: the wrapped-commentary-reader build-out and the browser-context-sync / Arthur-Primer conversations. Direct quotes preserve Arthur's speech-like phrasing, including STT artifacts.

## 1. Wrapped commentary reader ("Talmud-style" reader)

Origin. Arthur wanted richer annotations for Nick Land's *Meltdown* (`ccru.net/swarm1/1_melt.htm`). He kept describing a layout he saw in a Twitter video: "they basically made the Talmud ... used Pretext, like the JavaScript library ... to read some book." The reference turned out to be `x.com/poetengineer__/status/2055341457116975115/video/1`. He asked: "i like this website but need better annotations / the whole meltdown bookf ... can you use pretext to wrap your annotations to explain different things like the talmud, cire text inside and annotations wrapped to suround it."

Core shape. The reader is a dense, laptop-first canvas for hard prose: source text stays central at ~60–75 characters per line (`coreMeasureCh` in the JSON contract), with typed commentary wrapped around it in left/right/top/bottom lanes. The source is primary, normalized into immutable chunks with stable IDs; the PDF is a facsimile, not the main substrate. Annotations are ontology-typed (glossary, source, ontology, interpretive, cross-reference, warning) and carry provenance/confidence. SQLite is the source of truth; JSON/Markdown/IR files are exports.

Arthur's quality model. He repeatedly corrects agents by giving basin-shaping examples rather than literal rules:
- "Do not explain ROM" = respect the reader profile; spend scarce margin on missing context.
- "Explain Foucault" = explain the non-obvious imported machinery, not the obvious name.
- "Color code by author" = provenance is often more useful than abstract taxonomy.
- "Kennedy -> Apollo -> Star Wars -> information superhighway" = the desired compression style: chain, relation, context, no wasted grammar.
- Good marginalia should read the whole unit first, extract the local thesis, explain the anchor in relation to that thesis, add reusable conceptual atoms, and avoid repeating source text, title, author, or visible chips. Bad marginalia paraphrases the source or treats each card as an isolated dictionary entry.

Human + agent workflow. Arthur wants "Cursor for reading": select text, the UI knows `block_key`, `reading_unit_key`, page, offsets, surrounding text; the selection becomes a saved event, a prompt context, an annotation target, or a flashcard candidate. The agent should receive structured context packs (reader profile, agent context, whole unit, local source block, current card fields, nearby cards, user feedback), not raw copied prose. Chat should be event-sourced and tied to the substrate, not a toy chat box. The reader should also become a reusable second brain: concepts, thinkers, neologisms, quotes, historical episodes, and edges like `imports`, `mutates`, `contrasts`, `compresses`, `exemplifies`, `genealogy`, `etymology`, `historical_sequence`.

Voice from sessions. "I want different kinds of annotations ... some file format for these ... I can take some arbitrary book or PDF and feed it into this system, and then it will auto-generate more context on different parts, on the different ontologies"; "the core text should be like, everything should be readable"; "woaw you stilll going, * PM voice*, um, how are we doing, buddy?"; "an we do this shit in parralel?"; "mvoe this to a better folder, not ~/agents".

## 2. Browser history as agent memory (browser-context-sync / Arthur Primer)

Origin. Arthur felt ordinary browser history is too flat: "when I open the Firefox history, it doesn't appear to show the threads and like which windows, like the parents and stuff ... it's just like, it's just one column. But the actual ... doesn't match my actual experience of using different browsers ... it's like a tree of tabs." He wanted richer browser context encoded locally: "like i just want extended firefox/chrome history encoded so it's easily explorable maybe in the sqlite itself." And later: "keep track of how long I spend on a specific website or a specific URL."

Core shape. The system passively mirrors browser state (profiles, windows, tabs, tab trees, tab groups, navigation entries, raw events) into `~/state/browser-context/browser_context.sqlite`. The importer stores raw facts only — no dwell, attention, or importance scores. Agents derive interpretations later from `events` and `tabs.last_accessed`. The optional browser extension/native host records `tab_activated`, `tab_updated`, `window_focus_changed`, `idle_state_changed`, etc. Agents query the sync DB; they read Firefox/Chrome native DBs read-only only when older history or visit-parent chains are needed.

Arthur Primer. The larger goal is an agent-facing externalized intuition layer, not a profile, dashboard, or quantified-self shrine. Arthur wants future agents to have broad background context without over-fixating on one explicit fact: "I always think that they have insufficient context about me, but even just specifying, I think it's too, it collapses too much things when I specify exactly." The Primer should be local, searchable, doctrine-plus-index: Markdown carries readable wisdom, SQLite carries labels/joins, search/embeddings recover messy context, simple graph edges express relationships. He explicitly rejected GraphRAG: "Maybe in like a graph rag or some shit. But I don't really like graph rag ... I just wanna have it all local and then have it so that an agent can search through all of this, all these preferences."

Source-trust model. Expertise is domain-scoped; there is no global credibility score. Arthur distinguishes field trust from person trust: some fields have long, noisy, incentive-distorted feedback loops (education research, nutrition, psychology, China-watcher punditry), so credentials are not enough. Causal models, mechanisms, replication, selection effects, and incentives matter more than statistical decoration. Some people are narrow experts; others are transferable autodidacts; some are followed as search-index nodes (`follow_reason:search_index`) even though their feed is low-value. B2B SaaS founders are useful only for their specific operating domain; "almost everything they say is low signal, if it's not about their specific B2B SaaS." Crypto is currently a very low-trust domain for Arthur because of incentive contamination. A followed account is not an endorsement; attention is not value.

Voice from sessions. "So, the end goal ... is to, um, essentially so that we can have some weekly routine ... automatically look through what do I spend my time on? ... what ideas do we want to resurface later? Kind of like the spaced repetition thing." "Wait, don't do the thing that I asked for you to do immediately. I want to talk about it first ... high level first, Only dive into the sufficient things you need to accomplish the high-level goal. Because I don't want to spam this, this long thread." "these are rants. These are like, they're not hard preferences. ... the dark matter, the tacit knowledge of how I approach things." "i don't want to overfixate on anyone intuition, since it's more a bag hueristics with some theoretical/empirical backing from my own experience."

## 3. Dangling ideas and open threads

- Real attention/dwell. The sync DB records raw focus events but cannot yet compute per-domain dwell reliably; needs the optional extension/native host plus idle state.
- Intent labels. Browser history shows what was visited, not why. A lightweight annotation or weekly labeling loop is needed to separate research, wandering, drift, and task support.
- Phone/TikTok integration. Mac Chrome sees TikTok visits, but phone usage is not integrated yet.
- Source graph. No follow graph, mutual-follow ratio, quote/reply graph, or cluster membership yet; these are central to Arthur's trust heuristics.
- Follow-through. The system can see research trails but not whether they became Obsidian notes, Anki cards, code, or product decisions.
- Agent bridge for the reader. The `Reader Agent` UI captures prompts but does not yet run a local agent against the same SQLite substrate and write back events/cards.
- Annotation pipeline robustness. Some OMP runs produced empty output; book-level parallelism had to be split into prompt-range parallelism to avoid one bad prompt stalling a whole book.
- Borges library as unified source. Arthur wants one pipeline that can pull from LibGen, Anna's Archive, arXiv, archive.org, and local vault; the CLI should auto-discover mirrors, cache them, and be easy enough that an agent can use it without reading the code. He wants to be honest about what it is: "just call it downloads, and be honest, just not about the source of where it's from."
- Reading lists. Chinese philosophy (Machiavelli, Han Feizi, Confucius, Analects), pivotal economics papers (Paul Romer, Dwarkesh/Ege Erdil "cornerstone papers"), Land-specific reading order, Jung's 4chan reading order, Culture/Accelerando/Iain M. Banks, Jorge Luis Borges collected works, and "Redscare" subreddit lit charts were all mentioned as targets.
- Teaching-agent / learning-card harness. A separate but related thread (Justin/Math Academy/HSK) produced a card schema, tacit-moves JSON, and LadybugDB graph exports — a boundary-aware tutor that gives concrete examples before explanation.
- "Cyborgmaxxing." Arthur's desired assistant posture: helpful executive assistant, mentor, friend, fellow explorer, and researcher — keeping human browser exploration and agent work in one shared memory surface.

## 4. Source sessions and not-found list

Primary session files read (sampled, not bulk-loaded):
- `~/.omp/agent/sessions/-exploratory/2026-06-28T02-54-42-069Z_019f0c26-9195-7000-8055-86edb42b78bc.jsonl` — origin of the Talmud/Pretext reader request.
- `~/.omp/agent/sessions/-exploratory/2026-06-28T03-08-17-738Z_019f0c33-03ca-7000-afbf-8674ca7e98c8.jsonl` — browser-context-sync / Arthur Primer origin and ontology.
- `~/.omp/agent/sessions/-exploratory-systems-wrapped-commentary-reader/2026-06-29T07-43-05-571Z_019f1254-f563-7000-96c6-97cb8f4bb595.jsonl` — main build-out of the reader, library downloads, and OMP annotation pipeline.
- `~/.omp/agent/sessions/-exploratory-systems-wrapped-commentary-reader/2026-06-30T00-10-44-907Z_019f15dd-2f2b-7000-b27f-c78c0a6542b2.jsonl` — continuation of reader/library work and Borges skill hardening.
- `~/.omp/agent/sessions/-exploratory-systems-wrapped-commentary-reader/2026-06-30T12-52-14-922Z_019f1896-5bca-7000-a7f9-290669e05e1d.jsonl` — Culture/Accelerando downloads, Borges/4chan reading-order exploration, download pipeline improvements.
- Smaller related sessions in the same directory were noted but not sampled in depth: `2026-06-30T07-33-50-754Z_...`, `2026-06-30T07-46-37-732Z_...`, `2026-06-30T12-57-51-153Z_...`, `2026-06-30T13-08-40-830Z_...`.

Reference docs read:
- `~/exploratory/systems/wrapped-commentary-reader/annotation-format.md` — JSON v0 contract (`work`, `reading`, `chunks`, `annotations`, `edges`, `coreMeasureCh`).
- `~/exploratory/systems/wrapped-commentary-reader/annotation-guide.md` — PreTeXt three-column layout guide.
- `~/exploratory/systems/wrapped-commentary-reader/manifest.md` — source package manifest.
- `~/exploratory/systems/wrapped-commentary-reader/references/agent-context.md` — Arthur's quality model for marginalia.
- `~/exploratory/systems/wrapped-commentary-reader/references/workstreams.md` — parallel workstreams for the reader.
- `~/exploratory/systems/wrapped-commentary-reader/references/project-conversation-brief.md` — overall project brief.
- `~/.omp/agent/managed-skills/browser-context-sync/SKILL.md` — agent skill body.
- `~/exploratory/browser-context-sync/docs/vision.md` — browser-context-sync vision.
- `~/exploratory/browser-context-sync/docs/collaboration-preferences.md` — "high level first" mode contract.
- `~/exploratory/browser-context-sync/docs/arthur-primer-seed-context.md` — seed source-trust heuristics.
- `~/exploratory/browser-context-sync/docs/attention-datamine-2026-06-28.md` — app/browser attention data.
- `~/exploratory/browser-context-sync/docs/source-trust-ontology.md` — source-trust ontology.
- `~/exploratory/browser-context-sync/docs/arthur-primer-ontology-v0.md` — top-level objects.
- `~/exploratory/browser-context-sync/docs/primer-agent-use-contract-v0.md` — agent-use contract.
- `~/exploratory/browser-context-sync/docs/source-card-template-v0.md` — minimal source card.
- `~/exploratory/browser-context-sync/agent_skill/browser_context_sync.md` — agent skill body.

Not found / unresolved:
- The nickname "rat commentary reader" was not located in the sessions or repo; it appears to be a typo for "wrapped-commentary-reader."
- The exact Twitter video was found via Arthur's direct link (`x.com/poetengineer__/status/2055341457116975115/video/1`), not by searching his Firefox history as he originally suggested.
- The original "Talmud Pretext JavaScript library" Arthur mentioned was not identified as a specific named library; the team shifted to a React/PreTeXt-based custom viewer.
- The exact Firefox session where the Talmud video was first encountered was not recovered from the sampled history.
- Full implementation of the reader agent bridge (agent reads/writes the same SQLite) is still pending.
- Per-domain dwell time and follow-through tracking are still instrumentation gaps, not solved by the current schema.
- Whether the Arthur Primer will later include embeddings, a full source graph, or a dashboard was left as a deliberate "not yet" decision.
