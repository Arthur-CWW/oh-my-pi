# Vault integration

Date: 2026-07-03

Sources: `~/vault/codex-tasks.md`, `docs/plans/harness-research.md`, `~/vault/_agent/AGENTS.vault-agent.md`.

## Distilled backlog

- **Folder/project organization — partial.** Arthur's first note is that folders and projects are hard to find. `~/agents` now has stream folders, state docs, plans, and skill directories, but discovery is still uneven and no general repo/vault navigation index exists yet.

- **Garbage-collection skill — open.** The backlog asks to distill Refactoring UI, then use that skill to design and implement a garbage-collection skill for maintaining repo quality. No `garbage-collection` skill exists in `skills/` today; related repo-hygiene practices are scattered across harness docs and assignments.

- **Session-log personas — partial.** The backlog asks to mine the last week's session logs for Arthur's recurring requests and issues, then turn them into personas. `docs/plans/harness-research.md` identifies Lopopolo-style harness engineering and recurring corrections as persona/skill material, and `docs/plans/jimeng-workers/` preserves worker/session logs, but there is no finished persona distillation pipeline.

- **Run different personas in different code sessions — partial.** Current OMP assignments already use role-specialized subagents and reviewer personas, so the operating pattern exists. The missing piece is a reviewed, durable persona catalog distilled from Arthur's logs rather than one-off task roles.

- **Soul refinement / design tool for agents — partial.** The backlog wants a tool so agents can adopt and refine different “souls.” Existing agent roles, skills, and design guidance approximate this, but there is not yet a dedicated soul/persona refinement artifact or selector.

- **Creative-process acceleration — partial.** Arthur names babble-and-prune, an improv-book prompt, creativity books/resources, and better prompting. The repo has creative/video plans and multiple media workflows, but the specific improv/creativity distillation is not present as a skill.

- **Frontend spacing/design taste — partial.** The backlog complains that frontend spacing is consistently off. The harness has the `impeccable` frontend skill available in session context and design-state docs exist, but no repo-local Refactoring UI-derived spacing skill was found.

- **Kaggle/ARC and generated question sets — open.** The backlog proposes using GPT Pro on old ARC/math challenges and generating many alternative Q&A items. I found no current `~/agents` plan or skill that implements this loop.

- **Market/finance research and account setup — open.** Notes mention market-crash research, oil shocks, OpenAI/Anthropic competition, IPO liquidity, call options, IBKR/HK/Binance setup, and crypto-stock trading. Repo notes contain some market-data research prompts, but no approved implementation or account-operation workflow is present.

- **EA-adjacent charity index — open.** The backlog asks for an index of promising charities for an Anthropic IPO/liquidity scenario. No dedicated charity index exists in `~/agents` today.

- **Subscription/new-model/Twitter summarizer — open.** The backlog asks to enumerate subscription skills, track new model releases, and summarize Twitter themes. There are browser/research tools and Twitter-related packages, but no dedicated new-model-release/Twitter-theme summarizer workflow was found.

- **Formalize Arthur's methods — partial.** Many `docs/state/` and `docs/plans/` files capture operating preferences, proof loops, and workstream methods. The backlog's broader method-formalization remains unfinished because those notes are not yet consolidated into a compact reviewed ontology.

- **Consumer app ideas — open.** Astrology app for women, K-pop remix/collector tools, K-idol mobile game, and “Slack but good / Slack for agents” appear as raw product ideas. I found related media/agent-control-plane work, but no dedicated plans for these product concepts.

- **Team-building and Twitter value loop — open.** The backlog asks how to build a team, find people, provide value on Twitter, and move toward in-person collaboration. No current repo workflow directly implements recruiting or community-building.

- **Animation recreation, TikTok removal/fingerprinting, phone farm, residential IP workflow — partial.** Video recreation and provider-reversal work is active in the repo, including Jimeng/Dreamina and TikTok-adjacent pipelines. Fingerprinting removal, phone-farm operations, and residential-IP workflows are not approved as a finished harness capability.

- **Benchmarks for viral/Taobao/business/video/clips farms — open.** The backlog lists TikTok ViralBench, Taobao Bench, e2e business/ads/analytics, Remotion video editing bench, and clips-farm bench. Existing media and renderer packages provide ingredients, but these named benchmarks are not implemented.

- **Persona/game-theory/social-technology research — open.** Later notes explore masks, pivot tokens, persona incentives, legibility, fundraising games, revealed preferences, social technology, market forces, and moral ontology. These remain raw research themes unless promoted into a reviewed research plan.

- **Fable future-scenario exploration — partial.** The backlog mentions exploring futures through Fable/VRM. `docs/fable/` contains active Fable materials, so this is partially captured, but the specific future-scenario simulator is not finished.

## Vault boundary rules

- **Proposed, pending approval:** Keep `~/vault` mounted in the repo as `~/agents/vault`, but treat it as read-mostly source material. Agents should retrieve narrow ranges with provenance and should not bulk-inject the vault into context.

- **Proposed, pending approval:** Write generated notes, indexes, research outputs, and compiled artifacts to repo-local docs, an assigned workspace, or `~/vault-agent` when explicitly named. Do not scatter agent-generated output through Arthur's Obsidian notes.

- **Proposed, pending approval:** Promotion back into the personal vault should require review, provenance, and an explicit target path. High-value compact notes can be staged for promotion; nothing should be copied into `~/vault` without Arthur asking.

## Vault indexer proposal

- **Proposed, pending approval:** Build a lightweight vault-note indexer that records note title, path, front matter, and a short excerpt, then retrieves narrow source ranges on demand. This follows `docs/plans/harness-research.md` action items 4-5 and should make vault use deterministic without turning the whole vault into prompt context.
