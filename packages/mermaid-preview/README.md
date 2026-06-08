# pi-mermaid-preview

Project-local Pi extension that auto-renders fenced Mermaid blocks as Unicode terminal previews.

## Why ASCII/Unicode instead of images?

Pi's TUI image support is disabled under tmux, so inline PNG previews are not reliable for the control-plane/tmux workflow. This extension uses `beautiful-mermaid` to render Mermaid to terminal-friendly box-drawing output instead.

## Behavior

- Watches user and assistant messages for fenced `mermaid` code blocks.
- Appends a visible preview message in TUI sessions.
- Filters those preview messages back out of LLM context, so they do not pollute future prompts.
