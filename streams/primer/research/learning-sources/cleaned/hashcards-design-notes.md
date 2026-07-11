# Hashcards — source-grounded design notes for Primer

Status: source notes and Primer recommendations, synthesized 2026-07-11. This is not a specification and does not imply that Primer currently exports decks or schedules reviews.

## Observed in Hashcards

- **Human-owned content, machine-owned review state.** Hashcards calls itself a plain-text SRS: cards live in Markdown files suitable for an editor and version control, while its SQLite schema stores card hashes, FSRS state, sessions, and review rows—not card text. Sources: [canonical README](https://github.com/eudoxia0/hashcards/blob/91fecff2dd7339398be0bdca8c23823e6f262622/README.md), local [`../../../repos/hashcards/README.md`](../../../repos/hashcards/README.md), and local [`../../../repos/hashcards/src/schema.sql`](../../../repos/hashcards/src/schema.sql).
- **Minimal notation and rich rendering.** The text format has only `Q:`/`A:` and bracketed `C:` clozes. Ordinary Markdown media, audio, and KaTeX math are supported. Source: [canonical README](https://github.com/eudoxia0/hashcards/blob/91fecff2dd7339398be0bdca8c23823e6f262622/README.md#format) and local [`../../../repos/hashcards/README.md`](../../../repos/hashcards/README.md).
- **Content-addressed identity and cloze families.** A basic card hash covers its type, question, and answer. A cloze card hash also covers its text and deletion offsets; clozes derived from the same text share a separate family hash. The README says editing content therefore resets progress. Sources: [canonical `card.rs`](https://github.com/eudoxia0/hashcards/blob/91fecff2dd7339398be0bdca8c23823e6f262622/src/types/card.rs), local [`../../../repos/hashcards/src/types/card.rs`](../../../repos/hashcards/src/types/card.rs), and [canonical README](https://github.com/eudoxia0/hashcards/blob/91fecff2dd7339398be0bdca8c23823e6f262622/README.md).
- **Inspectable lifecycle.** `check` inspects collection integrity; `orphans list/delete` exposes database cards absent from the Markdown collection instead of silently erasing them. Sources: [canonical README commands](https://github.com/eudoxia0/hashcards/blob/91fecff2dd7339398be0bdca8c23823e6f262622/README.md#commands), local [`../../../repos/hashcards/README.md`](../../../repos/hashcards/README.md), and local [`../../../repos/hashcards/src/cmd/orphans.rs`](../../../repos/hashcards/src/cmd/orphans.rs).
- **Keyboard-first review over a deliberately boring scheduler.** Space reveals, `1`–`4` grade, and `u` undoes. FSRS supplies scheduling; progress is persisted only when the session ends or the user clicks End. Sources: [canonical README tutorial](https://github.com/eudoxia0/hashcards/blob/91fecff2dd7339398be0bdca8c23823e6f262622/README.md#tutorial), local [`../../../repos/hashcards/README.md`](../../../repos/hashcards/README.md), local [`../../../repos/hashcards/src/fsrs.rs`](../../../repos/hashcards/src/fsrs.rs), and local [`../../../repos/hashcards/src/cmd/drill/post.rs`](../../../repos/hashcards/src/cmd/drill/post.rs).
- **A personal repository convention, not Hashcards’ core schema.** Borretti’s checked-in collection separates `Cards` (actual cards), `Inbox` (WIP decks), `Sources`, and `Scripts`. Source: local [`../../../repos/hashcards/flashcards/README.md`](../../../repos/hashcards/flashcards/README.md). Treat this as workflow inspiration rather than a required Primer storage layout.

Borretti’s design rationale is the canonical essay [“Hashcards: A Plain-Text Spaced Repetition System”](https://borretti.me/article/hashcards-plain-text-spaced-repetition); the implementation is [eudoxia0/hashcards](https://github.com/eudoxia0/hashcards).

## Primer recommendations (not claims about Hashcards)

### Borrow now

- Make approved Markdown a **downstream artifact** of the existing candidate workflow, never the candidate store itself. Promotion must remain explicit: candidate → Arthur accept/edit → approved artifact.
- Keep provenance and structured metadata in Primer’s ledger; render only the human-editable learning content into Markdown.
- Preserve inspectability through CLI status, integrity checks, and orphan reporting. Use a **family/lemma** concept to relate sibling formulations or clozes without pretending they are one card.
- Apply this only to the existing global inbox and one-chapter workbench. Primer currently has candidate/status plumbing; scheduler and deck export are deferred, not silently assumed. Current local anchors: [`../../../../../packages/primer-daemon/README.md`](../../../../../packages/primer-daemon/README.md), [`../../../../../packages/primer-daemon/src/ledger.ts`](../../../../../packages/primer-daemon/src/ledger.ts), and [`../../../HANDOFF-LIVE-2026-07-10.md`](../../../HANDOFF-LIVE-2026-07-10.md).

### Adapt later

- Give each Primer card a stable ID plus a versioned content hash. Identity survives wording edits; content versions remain auditable.
- Append review events atomically as they happen, then derive current FSRS state. Do not rely on an end-of-session commit boundary.
- Let due timing remain the boring FSRS core, but layer explicit policies for new-card priority, prerequisite/dependency readiness, and due/new interleaving.
- Sync human-owned Markdown and machine-owned review events separately; never sync a hot SQLite file as the protocol.

### Do not copy

- A raw content hash as the sole durable card identity.
- Automatic review-state reset on every wording edit.
- End-of-session-only persistence.
- Random shuffle as the complete ordering policy.
- Hot SQLite-file synchronization.
- Any path from generated candidate to review deck that bypasses human approval.
