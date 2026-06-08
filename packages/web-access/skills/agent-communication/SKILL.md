---
name: agent-communication
description: Coordinate with other local agents by editing shared repo docs/state and appending a simple coordination log entry. Use when asked to notify another agent, change another agent's owned files, or leave cross-agent handoff context.
---

# Agent Communication via Repo State

Keep this simple. Do **not** build Slack, queues, inboxes, or broker semantics unless explicitly asked again.

## Default protocol

When you need to communicate with another local agent:

1. **Edit the shared source-of-truth file directly** if that is the real state change.
2. **Add a small local note in the edited file** only if the ownership/scope changed and the next reader needs context.
3. **Append one entry to the global coordination log** with who/what/why.
4. **Rely on git diff/log** as the durable audit trail.
5. Optionally use `tmux display-message` only to point a pane at the changed file/log entry. Do not paste into another Pi editor.

## Global coordination log

Use:

```txt
docs/coordination/agent-edit-log.md
```

Append concise entries:

```md
## 2026-06-08 — <agent/session label>

Changed:
- `path/to/file.md`

Reason:
- <why this agent edited another agent's/shared scope>

Notes for owner/next agent:
- <what to inspect, what changed, any follow-up>
```

## When editing another agent's owned scope

Be explicit but brief:

- identify yourself as another Pi/agent session if known
- state the reason for the edit
- avoid rewriting large sections unless necessary
- preserve the owning agent's pending work where possible
- if the change is risky, add a TODO instead of taking over

## Do not

- invent per-agent message queues
- require acknowledgement for every note
- create direct agent-to-agent chat
- poll inboxes mid-task
- paste instructions into an active Pi editor
- duplicate the same notification across many files

## Tmux notification, optional

Only after writing the file/log entry:

```bash
tmux display-message -t %1 -d 10000 'Coordination update: docs/coordination/agent-edit-log.md'
```

If a pane has an active Pi prompt/editor, do not use `send-keys`.
