# Harness research

Research date: 2026-07-03

Scope: materials useful for improving the `~/agents` harness: persona/expertise encoding, context management, remote/server operation, and vault/research integration.

## Harness persona/expertise encoding

### Ryan Lopopolo / OpenAI harness engineering

Ryan Lopopolo's canonical OpenAI article frames the shift as: humans steer, agents execute. The durable product of engineering becomes the environment around the agent: repository-local knowledge, guardrails, observability, tests, review loops, and mechanical taste constraints. The local corpus already captures the important sources, including the OpenAI essay, Latent Space interview, AI Engineer Europe talk, OpenAI Build Hour, and Hyperbola posts. The strongest pattern for us is not “write a bigger prompt”; it is encode expert taste into short entrypoint instructions, deeper source-of-truth docs, lintable invariants, and repeatable proof loops.

Key takeaway for our harness: shrink root instructions into a map, move Arthur-specific taste into versioned docs/skills, and promote repeated corrections into mechanical checks or reusable skills instead of relying on memory.

URL/path: https://openai.com/index/harness-engineering/; `docs/research/lopopolo-agent-material/README.md`; `docs/research/lopopolo-agent-material/cleaned/openai-harness-engineering.md`

### Lopopolo source inventory and persona material

The local `lopopolo-agent-material` bundle is already a high-value persona corpus. It explicitly recommends asking agents to adopt Ryan's harness-engineering style and points them at the inventory, `AGENTS.md`, and repository docs before proposing changes. The inventory emphasizes agent legibility, verification, safe autonomy, local observability, review agents, and table-of-contents-style `AGENTS.md` files. It also notes gaps: X/Twitter is incomplete, OpenAI internal prompts and implementation details are not public, and the public corpus changes quickly.

Key takeaway for our harness: create a compact “harness engineer” persona/skill that cites this corpus and applies it only to harness work, with triggers like “agent legibility,” “verification loop,” “safe autonomy,” and “encode taste.”

URL/path: `docs/research/lopopolo-agent-material/README.md`; `docs/research/lopopolo-agent-material/cleaned/manifest.md`; https://www.latent.space/p/harness-eng

### Dex Horthy / context engineering and 12-factor agents

I did not find a distinct “Dex Harty” source; the useful hits for the requested `dexharty agents` query point to Dex Horthy / `dexhorthy` of HumanLayer, which appears to be the likely intended source. Horthy's Chroma interview and HumanLayer material treat agent engineering as context engineering: get the right information into the model while keeping it as small and dense as possible. He stresses learning one model/tool deeply, splitting work between orchestrators and subagents only when it helps, and building AI-native collaborative workspaces where humans and agents share a durable context layer. His examples favor Markdown/front matter as a flexible source of truth, deterministic slicing/filtering before model calls, and human-in-the-loop inbox patterns for approvals.

Key takeaway for our harness: keep the main thread dense and narrow; use subagents for bounded retrieval/implementation; make front matter, indexes, and deterministic context selectors first-class so agents do not re-read the world.

URL/path: likely intended source, not exact-name match: https://www.trychroma.com/interviews/dex-horthy-context-engineering-ep-1; https://www.humanlayer.dev/12-factor-agents

## Context management

### Official OpenAI Codex best practices

OpenAI's Codex best-practices guide recommends prompts with Goal, Context, Constraints, and Done when; planning before difficult tasks; reusable guidance in `AGENTS.md`; configuration for sandbox/approval/model consistency; tests and review loops; MCP for external live context; skills for repeatable workflows; automations only after workflows are reliable; and one thread per coherent unit of work. It explicitly warns against oversized durable prompts, missing build/test instructions, full permissions too early, live threads on the same files without worktrees, and one giant project thread.

Key takeaway for our harness: codify the assignment packet shape already used here, but keep permanent rules short; convert recurring prompts into skills; and make “one task, one thread/worktree, one proof artifact” the default for substantial work.

URL/path: https://developers.openai.com/codex/learn/best-practices

### OpenAI `AGENTS.md`, skills, MCP, and automations model

The official guidance treats `AGENTS.md` as durable project guidance, skills as scoped repeatable methods, MCP as connectors for external systems, and automations as schedules for stable workflows. This matches the harness split we want: global policy should stay minimal, skills should carry task-specific operating procedure, and MCP/browser/vault connectors should be added only when they remove a repeated manual loop.

Key takeaway for our harness: stop adding every preference to the global prompt. Add a small router that points to skills/docs, then invest in high-signal skills and targeted connectors.

URL/path: https://developers.openai.com/codex/learn/best-practices; https://developers.openai.com/codex/skills; https://developers.openai.com/codex/guides/agents-md

### Arthur vault notes and prompt material

Vault files found by name include `~/vault/codex-tasks.md`, `~/vault/prompt-injection.md`, `~/vault/_agent/AGENTS.vault-agent.md`, `~/vault/_agent/vault-agent-gitignore`, `~/vault/_agent/obsidian-config/snippets/agent-vault.css`, `~/vault/scripts/agent/`, `~/vault/prompts/flashcards.md`, `~/vault/prompts/poisoning.md`, `~/vault/prompts/learning/summary.md`, `~/vault/prompts/learning/The Math Academy Way.md`, `~/vault/Clippings/How to write good prompts.md`, and `~/vault/notes/prompting/`. The `codex-tasks.md` note contains raw goals about distilling session logs into personas, using different personas in code sessions, refining “souls,” and building a garbage-collection skill. The vault agent guidelines define a clean boundary: personal vault is read-mostly source material, generated notes belong in `~/vault-agent`, and promoted material needs provenance. The Andy Matuschak clipping is especially relevant: prompt design is task design; effective prompts are focused, precise, consistent, tractable, and effortful.

Key takeaway for our harness: vault integration should not dump notes into context. It should index note titles and front matter, retrieve narrow source ranges, write generated research to an agent workspace, and promote recurring Arthur intent into reviewed skills/personas.

URL/path: `~/vault/codex-tasks.md`; `~/vault/_agent/AGENTS.vault-agent.md`; `~/vault/prompts/`; `~/vault/Clippings/How to write good prompts.md`; symlink reference `streams/harness/inspiration/prompts`

## Remote/server operation

### Codex App Server / harness protocol

OpenAI's App Server article explains Codex as a reusable harness exposed through a bidirectional JSON-RPC API. The server owns thread lifecycle, persistence, config/auth, tool execution, approvals, and extension wiring. It models interactions as threads, turns, and typed items with started/delta/completed events. OpenAI recommends App Server for full harness embedding because it preserves session semantics, diffs, approvals, and event streams better than generic MCP-style invocation.

Key takeaway for our harness: if we build a local control plane, model it around stable event primitives: thread, turn, item, approval request, diff, terminal output, and completion. Do not make the TUI the source of truth.

URL/path: https://openai.com/index/unlocking-the-codex-harness/; https://developers.openai.com/codex/app-server

### Remote Codex connections and server mode

Official remote-connection docs describe controlling Codex from another device, SSH host, or always-on computer. The connected host supplies files, credentials, tools, plugins, MCP servers, browser access, permissions, and sandbox policy. OpenAI warns not to expose app-server transports directly on public/shared networks; use SSH, VPN, or mesh networking. Existing repo notes also identify product patterns: separate project/workspace from thread/run, use worktrees for safe parallelism, include diff/review surfaces, and keep terminal-native speed while adding control-plane legibility.

Key takeaway for our harness: remote operation should be “host-local authority, remote steering.” Keep credentials and tools on the host; expose a narrow authenticated control surface for prompts, approvals, status, diffs, screenshots, and logs.

URL/path: https://developers.openai.com/codex/remote-connections; `docs/research/pi-agent-control-plane/codex-app-features-notes.md`

### OpenAI Symphony orchestration

The local Symphony reuse map says upstream Symphony provides a language-agnostic spec plus a working Elixir/OTP reference: orchestrator, runner lifecycle, workspace-per-issue, Codex app-server runner, blocked-state handling, LiveView/JSON status API, and memory tracker tests. It should be reused conceptually, not imported blindly, because upstream is Linear-only, prototype-grade, and keeps blocked state in memory. The target adaptation is a SQLite-backed ledger, local task adapters, multiple runner adapters, and explicit human-in-loop unblock flows.

Key takeaway for our harness: use Symphony as the architecture reference for multi-agent scheduling, but make our durable ledger and local task sources the truth.

URL/path: `docs/research/openai-codex-symphony/reuse-map.md`; `docs/research/openai-codex-symphony/source-urls.txt`; https://github.com/openai/symphony

## Vault/research integration

### Kapafi / Claude with Obsidian vault

I did not find the requested Kapafi tweet directly. Searches for `kapafi claude obsidian vault research` and an X/Twitter scoped variant did not surface a Kapafi-authored result. Adjacent public material exists about using Claude Code with Obsidian vaults, including guides that recommend vault organization, symlinks, MCP bridges, and treating Obsidian as persistent memory. These are useful, but they are not the requested Kapafi source.

Key takeaway for our harness: treat the Kapafi item as unfound until an exact URL/archive is supplied or discovered through authenticated X search; meanwhile, the design principle is still supported by other sources: vault notes need indexing, provenance, and narrow retrieval rather than wholesale context injection.

URL/path: not found; adjacent: https://blog.starmorph.com/blog/obsidian-claude-code-integration-guide; https://github.com/AgriciDaniel/claude-obsidian

### Existing repo research notes

Existing `docs/research/` notes relevant to the harness include `lopopolo-agent-material`, `openai-codex-symphony`, and `pi-agent-control-plane/codex-app-features-notes.md`. I did not find a separate local remote-Codex/headless-API note beyond those. The local corpus is therefore already enough for a first harness iteration, but it needs a small index that tells agents which research bundle answers which question.

Key takeaway for our harness: add a research index or skill router so future agents discover these bundles without broad `docs/research` scans.

URL/path: `docs/research/lopopolo-agent-material/`; `docs/research/openai-codex-symphony/`; `docs/research/pi-agent-control-plane/codex-app-features-notes.md`

## Action items (pending Arthur approval)

1. Create a `harness-engineering` skill that routes to Lopopolo/OpenAI material and applies it to agent legibility, proof loops, and safe autonomy.
2. Slim the root harness instructions toward a table of contents; move long-lived taste and workflow details into linked docs/skills.
3. Add a lightweight research index for `docs/research/` with “when to read this” summaries.
4. Build a vault-note indexer that records title, path, front matter, and short excerpt, then retrieves narrow ranges on demand.
5. Codify the vault-agent boundary: treat `~/vault` as read-mostly, write generated notes/indexes to `~/vault-agent` or repo-local docs, and require provenance before promotion.
6. Encode recurring Arthur corrections from `codex-tasks.md` and session logs into reviewed personas/skills rather than global prompt bulk.
7. Use App Server/Symphony primitives for any control-plane work: project/workspace, thread/run, turn, item, approval, diff, blocked state, and durable event ledger.
8. Prefer remote steering over remote execution exposure: SSH/VPN/mesh access, host-local credentials, narrow authenticated status/approval APIs.
9. Re-run Kapafi/X search with authenticated browser access if Arthur specifically wants that source.

## Sources not found or only partially found

- Kapafi tweet about Claude with Obsidian vault: not found via public web search; only adjacent Obsidian/Claude materials found.
- Dex Harty exact-name source: not found; likely intended source is Dex Horthy / `dexhorthy`, summarized above.
- Remote Codex/headless API local notes: no dedicated `docs/research` note found beyond OpenAI Symphony and Pi control-plane Codex app feature notes.
- Ryan Lopopolo X/Twitter threads: local inventory reports public snippets and status URLs, but full text remains incomplete without logged-in/archive capture.
