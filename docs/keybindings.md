# Keybindings

Run `/hotkeys` inside an `omp` session for effective configurable bindings. Run `:commands` from a focused empty-editor view for the TUI/view-local command registry. Help is generated from the shared interaction registry; it is the source for command completion, `?` overlays, Hub legends, and this reference.

## Customize keybindings

User remaps live in `~/.omp/agent/keybindings.yml`. The file is a YAML mapping whose keys are action IDs and whose values are one chord string or an array of chord strings. It is not read from `~/.omp/agent/config.yml`, and there is no nested `keybindings` object.

```yaml
app.model.cycleForward: Ctrl+P
app.model.selectTemporary: Alt+P
app.plan.toggle: Alt+Shift+P
```

Chord names are case-insensitive and use the notation shown in the UI, such as `Ctrl+P`, `Alt+Shift+P`, `Shift+Enter`, and `Ctrl+Backspace`. Set an action to an empty array to disable it.

## Common action IDs

| Action ID | Default | Meaning |
| --- | --- | --- |
| `app.interrupt` | `Ctrl+Q` | Directly cancel active work |
| `app.message.followUp` | `Ctrl+Enter` | Queue a follow-up message |
| `app.message.dequeue` | `Alt+Up` | Dequeue a queued message back into the editor |
| `app.model.cycleForward` | `Ctrl+P` | Cycle role models forward |
| `app.model.cycleBackward` | `Shift+Ctrl+P` | Cycle role models backward |
| `app.model.selectTemporary` | `Alt+P` | Pick a model temporarily for this session |
| `app.model.select` | `Alt+M` | Open the model selector and set roles |
| `app.plan.toggle` | `Alt+Shift+P` | Toggle plan mode |
| `app.history.search` | `Ctrl+R` | Search prompt history |
| `app.tools.expand` | `Ctrl+O` | Toggle tool-output expansion |
| `app.thinking.toggle` | `Ctrl+T` | Toggle thinking-block visibility |
| `app.thinking.cycle` | `Shift+Tab` | Cycle thinking level |
| `app.editor.external` | `Ctrl+G` | Edit the draft in `$VISUAL` / `$EDITOR` |
| `app.agents.returnToParent` | `Alt+Shift+Left` | Return from a focused agent without cancelling it |
| `app.display.reset` | `Ctrl+L` | Reset terminal display |
| `app.clipboard.copyLine` | `Alt+Shift+L` | Copy the current line |
| `app.clipboard.copyPrompt` | `Alt+Shift+C` | Copy the whole prompt |
| `app.clipboard.pasteImage` | `Ctrl+V` (`Alt+V` fallback on Windows) | Paste clipboard image or text |
| `app.stt.toggle` | Unbound (hold `Space`) | Toggle speech-to-text |

`Ctrl+Q` is the cancellation action, not a follow-up alias. On Windows Terminal, `Ctrl+Enter` may be swallowed; bind or use `Ctrl+Q` only if you deliberately want the cancellation semantics, otherwise configure a follow-up chord explicitly. Existing legacy action names and `keybindings.json`/`keybindings.yaml` files are migrated, but new configuration should use namespaced IDs.

On Windows Terminal, `Ctrl+V` may be handled by the terminal before `omp` sees it; use `Alt+V` when clipboard image paste appears inert. When the clipboard holds no image, the paste action falls back to text. Hosts that implement OSC 5522 can send clipboard MIME data directly; image pastes appear as `[Image #N]`, while text/plain remains ordinary paste. A readable pasted single image-file path is also loaded as an image when OSC 5522 is unavailable.

## Shared Neovim grammar

Viewer surfaces open in **normal** mode. Writable full-TUI/editor surfaces use `i` for insert; `Esc` unwinds exactly one local layer (completion → input, input/search → normal, nested detail → parent, overlay → close) and does not cancel underlying work merely because a layer closes. `:` enters a distinct command-line insert mode, `/` enters a local search/filter mode, and `?` opens contextual help.

Normal viewer lanes use `j`/`k` for one-line movement, `J`/`K` for five-line movement, `g`/`G` for top/bottom, `[`/`]` for visible sibling cycling, and `za` for the local fold under the cursor. In the strict read-only Agent Hub preview, message input and follow-up are unavailable—no `i`, `Ctrl-Enter`, or queued follow-up; `Enter` attaches the selected session in the full TUI. `u`/`d` and `Ctrl+U`/`Ctrl+D` are half-page aliases only there; `PgUp`/`PgDn` remain full-page actions. Editors, selectors, command-line input, and writable overlays retain their own text/editing rules.

## Focused agents

In the attached full TUI for a live subagent, `Ctrl+Q` starts direct cancellation and returns to the parent immediately; cleanup continues without blocking the return. An idle focused agent is returned without an abort. The focused agent remains available for revival, and its draft/cursor are restored when focused again. `Alt+Shift+Left` returns without interrupting. `Ctrl+Enter` queues follow-up input.

## Agent Hub

Open the Agent Hub with `←←` (double-tap left arrow) from the main editor.

### Roster and preview lanes

| Key | Action |
| --- | --- |
| `n` / `p` | Select the next/previous roster row (Hub table exception) |
| `j` / `k` | Move the active read-only preview one line down/up |
| `J` / `K` | Move the active read-only preview five lines down/up |
| `u` / `d` | Half-page up/down in read-only Hub lanes only |
| `Ctrl+U` / `Ctrl+D` | Half-page up/down in read-only Hub lanes only |
| `PgUp` / `PgDn` | Full-page up/down |
| `g` / `G` | Jump to first/last row or top/bottom of the active lane |
| `[` / `]` | Cycle visible siblings |
| `H` / `L` | Move between root groups |
| `h` / `l` | Switch the focused Hub lane |
| `za` | Fold/unfold the selected tree branch or paste pill |
| `.` | Toggle historical/finished rows |
| `v` | Toggle rich/plain preview |
| `Enter` | Attach the selected session in the full TUI; the Hub preview remains read-only |
| `R` | Explicitly revive a parked child |
| `x` | Abort the selected active child |
| `/` | Search/filter the roster or transcript |
| `?` | Show contextual Hub help |
| `:` | Open the TUI command popup |
| `Esc` | Unwind one layer: clear search/input, leave detail, then close Hub |

Rosters and metadata remain one-line, width-bounded projections. Selected-child assistant tails, transcript bodies, and tool-result bodies are bounded projections of the journal and can stream or soft-wrap without becoming another authority.

### Command popup and namespace ontology

The `:` popup is for **TUI/view-local projection commands and shortcuts**. It currently includes `:commands`, `:wrap`, `:rich`, and `:version`; `:commands` autocompletes from the shared interaction registry, and `Tab`, arrows, `Enter`, `Esc`, and empty-backspace follow command-line-local semantics. `:wrap` soft-wraps IRC communication and tool-result bodies while keeping receipts, errors, metadata, and roster rows single-line. `:rich` switches rich/plain rendering for assistant, user, IRC, and tool-result bodies.

`/` is the **durable/mixed namespace** for session, runtime, model, queue, and other actions that may persist, mutate, or enter the transcript. Slash output is classified consistently as ephemeral TUI-only projection, session-visible non-model annotation, or queued model input. The journal remains truth.

## Media input

Native inline video is accepted only by the Antigravity native lane (`google-antigravity/gemini-3.5-flash`) and only for valid allowed-MIME base64 under `100MB`. Oversized, malformed, or unsupported-provider video fails explicitly; frame-sampling evaluation is a separate fallback path.
