> Rescued 2026-07-13 from /Users/arthur/.omp/agent/sessions/-agents/2026-07-11T02-43-53-887Z_019f4f0f-599f-7000-827a-cb4f1ffded60/local/idea-soft-concurrent-threads.md

# Soft concurrent idea threads — exploration seed

## Source
Arthur, current harness session, 2026-07-12. This exploration was forked while Main continued Phase 2 orchestration.

## Raw intent
Arthur wants the main orchestrator to keep managing implementation while a separate, resumable interlocutor explores tangential ideas that arise inside the same user message. The side thread should anchor at the exact source point so it can reuse the parent prefix/cache where possible, carry nearby purpose instructions rather than change the system prompt, and checkpoint useful exploration into human-readable files. Later threads should retrieve those files rather than depend on indefinite KV-cache continuity.

## Candidate product concepts
- main execution thread versus concurrent inquiry thread
- a session/thread tree inspired by Neovim undotree
- inline mixed-message parsing so slash commands need not be the first token
- automatic capture versus explicit fork
- project-global idea log with provenance and states
- resumable conversational branch linked to a durable document
- exploration document, not rigid spec

## Constraints / pushback
- Do not derail or mutate the parent task.
- Do not automatically implement or promote ideas.
- Avoid a fork for every stray sentence.
- Provider KV-cache reuse is an optimization, not durable memory.
- The file artifact is the durable checkpoint; the conversational branch is a working surface.

## Open questions
1. What is the smallest explicit inline syntax that still feels ADHD-friendly?
2. Should automatic parsing only propose/capture tangents, while spawning remains explicit?
3. What does the undotree-like UI need to show to make branch switching legible?
4. When should a side thread checkpoint, compact, close, or rebase onto a document?

## Correction from Arthur
The branch visualization should emphasize inquiry threads anchored at different Main nodes. Multiple related ideas arising from the same anchor node are normally merged into one inquiry thread rather than displayed as sibling idea branches. Example: review-utility inquiry anchored at Main B; concurrent-thread inquiry anchored later at Main D. The primary orientation question is “from which Main node did this inquiry diverge?”
