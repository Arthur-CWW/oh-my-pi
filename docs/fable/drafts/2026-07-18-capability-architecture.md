# Capability architecture — the four layers (DRAFT for Arthur's read)

Status: DRAFT — categorization only, per Arthur 2026-07-18 ("don't start on the stuff yet, we need to categorise it a bit"). No implementation until he's read and ruled.

Origin: Arthur voice memo, 2026-07-18 — "I'm stuffing a lot of things into the harness. Maybe we need better separation of the different abstraction layers... I don't interact with most of these systems. The reason I'm building a lot of these tools is so that agents and models can interact with the different systems."

## The four layers

| # | Layer | Contents | Interacts | Change velocity | Where it lives |
|---|---|---|---|---|---|
| 1 | **Kernel** | sessions, journals, ownership, runners, wire protocol, quota, start/restart | nobody directly (tmux-server analogy — Arthur's own ruling on HR-026) | slow, contract-gated (H1/H2 program) | the fork core, and ONLY this + layer 3 |
| 2 | **Capabilities** | world-facing agent tools: browser control, phone/ADB computer-use, video/art generation, scraping, GPU dispatch, email | agents only | fast, additive — new one every week | self-contained packages registering INTO the fork, never fork core |
| 3 | **Control plane** | fleet overview/labels, IRC, pause/resume, policy store, triage ledger, briefs/digests, ownership claims | Arthur AND agents symmetrically | medium | fork core (it IS the product for the fleet) |
| 4 | **Surfaces** | TUI views/HUDs, slash commands, phone/Discord bridges | Arthur only | fast, taste-driven | declared by capabilities + control plane, rendered by the fork |

Diagnostic that motivated this: capabilities keep landing as core-fork code, and surfaces keep landing as hand-wired one-offs. The fork should be layers 1+3; layers 2+4 should REGISTER.

## The capability provider contract (HR-196)

One documented pattern so "integrate X into OMP" is a pointer, not a project. A capability is one self-contained package (per the 2026-07-03 self-contained-packages rule) with one manifest declaring:

1. **Tool surface** — typed tools agents call (extension tool or MCP server; Effect Schema at the boundary; no `unknown`).
2. **Doctrine** — the skill: when to reach for it, safety rules, escalation (today's SKILL.md, unchanged in spirit).
3. **User surfaces** — slash commands, HUD lanes, dashboard cards it wants — DECLARED in the manifest, wired by the loader, never hand-registered in fork code.
4. **Registration** — services.yml entry / health endpoint where a daemon exists; fleet-overview visibility; capability advertisement (so HR-181 capability-aware handoff knows which sessions can drive a phone).
5. **Proof** — QA artifacts per proof-of-work-qa.

Substrate that already exists: the discovery system (loads skills/commands from .omp, .agent, claude, codex, opencode ecosystems), the extensions runner, services.yml + portless, the register culture. The missing 20%: the contract DOC, a scaffold (`omp capability init`?), and manifest→registry emission.

Immediate candidates to migrate/land under the contract once approved: phone/ADB computer-use (the ndnvmf thread's output), video/art generation, cua/cuadriver, the scraping stack.

## Unified capability manifest — skill + command + tool as ONE artifact (HR-197)

Arthur: "I'd rather have it all in one thing... an orchestrator agent could get a brief from another agent... I can also call this from the tool. I also want to keep the skill and the command probably in sync."

Today `/brief` = two hand-synced files (skills/fleet/thread-brief/SKILL.md + .omp/commands/brief.md). Under the manifest: one source with `doctrine:` (agent-facing), `commands:` (user-facing), and `tool: expose` (A2A-callable) sections; the existing skill loader, command loader, and tool registry all consume the one source. `/brief` is the migration exemplar. Sync problem dissolves — there is nothing to sync.

## Globally-referencable history:// (HR-198)

Agent ids are session-local, so `history://<agentId>` resolves only inside the spawning session — cross-agent briefs/digests fail exactly where Arthur wants them ("I'd rather have the agents be able to look at other agents' history"). Direction: fully-qualified `history://<session-id>/<agent-id>` (and `history://<session-id>` for a whole session) resolved read-only through the sessions index; short form stays session-local; fleet overview --json already carries session ids + journal paths as the discovery layer. Consumers: /brief cross-thread section, A2A stream briefs, HR-181 digests, the metaorchestrator (HR-182 variant B).

## Open questions for Arthur

1. Manifest format: extend SKILL.md frontmatter vs a new `capability.yml` beside it? (Frontmatter extension = fewer files; yml = cleaner for multi-command/multi-tool capabilities.)
2. Do capabilities live in `packages/` (monorepo) or also externally (dotfiles/extensions)? Both loaders exist; picking ONE default avoids a second convention.
3. Access control on global history://: any session may read any session's transcript (current trust model — single-user machine), or scoped (streams own paths)?
4. Does the phone/ADB thread become the first contract-conformant capability (reference implementation), or migrate an existing simple one (transcribe? youtube-transcript) first as the low-risk exemplar?
