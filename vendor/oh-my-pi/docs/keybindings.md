# Keybindings

Run `/hotkeys` inside an `omp` session to see the active chords for your current build. The list reflects any remaps loaded from disk and any bindings added by extensions.

## Customize keybindings

User remaps live in `~/.omp/agent/keybindings.yml`. The file is a YAML mapping whose keys are keybinding action IDs and whose values are either one chord string or an array of chord strings. It is not read from `~/.omp/agent/config.yml`, and there is no nested `keybindings` object.

```yaml
app.model.cycleForward: Ctrl+P
app.model.selectTemporary: Alt+P
app.plan.toggle: Alt+Shift+P
```

Chord names are case-insensitive and use the same notation shown in the UI, such as `Ctrl+P`, `Alt+Shift+P`, `Shift+Enter`, and `Ctrl+Backspace`.

Set an action to an empty array to disable it:

```yaml
app.history.search: []
```

## Common action IDs

| Action ID                   | Default                                | Meaning                                       |
| --------------------------- | -------------------------------------- | --------------------------------------------- |
| `app.model.cycleForward`    | `Ctrl+P`                               | Cycle role models forward                     |
| `app.model.cycleBackward`   | `Shift+Ctrl+P`                         | Cycle role models backward                    |
| `app.model.selectTemporary` | `Alt+P`                                | Pick a model temporarily for this session     |
| `app.model.select`          | `Alt+M`                                | Open the model selector and set roles         |
| `app.plan.toggle`           | `Alt+Shift+P`                          | Toggle plan mode                              |
| `app.history.search`        | `Ctrl+R`                               | Search prompt history                         |
| `app.tools.expand`          | `Ctrl+O`                               | Toggle tool-output expansion                  |
| `app.thinking.toggle`       | `Ctrl+T`                               | Toggle thinking-block visibility              |
| `app.thinking.cycle`        | `Shift+Tab`                            | Cycle thinking level                          |
| `app.editor.external`       | `Ctrl+G`                               | Edit the draft in `$VISUAL` / `$EDITOR`       |
| `app.message.followUp`      | `Ctrl+Q`, `Ctrl+Enter`                 | Queue a follow-up message                     |
| `app.message.dequeue`       | `Alt+Up`                               | Dequeue a queued message back into the editor |
| `app.agents.returnToParent` | `Alt+Shift+Left`                       | Return from a focused agent to its parent     |
| `app.display.reset`         | `Ctrl+L`                               | Reset terminal display                        |
| `app.clipboard.copyLine`    | `Alt+Shift+L`                          | Copy the current line                         |
| `app.clipboard.copyPrompt`  | `Alt+Shift+C`                          | Copy the whole prompt                         |
| `app.clipboard.pasteImage`  | `Ctrl+V` (`Alt+V` fallback on Windows) | Paste from the clipboard (image preferred, text fallback) |
| `app.stt.toggle`            | Unbound (hold `Space`)                 | Toggle speech-to-text. By default there is no key chord — hold the space bar to record (push-to-talk) and release to transcribe; bind a chord here for a press-to-toggle alternative |

On Windows Terminal, `Ctrl+V` may be handled by the terminal paste command before `omp` sees it; use the `Alt+V` fallback when clipboard image paste appears to do nothing. When the clipboard holds no image, `app.clipboard.pasteImage` pastes the clipboard text instead, so hosts that deliver only this chord (VS Code's integrated terminal when configured to forward `Ctrl+V`, Windows clipboard history via `Win+V`) work for both payload kinds. Windows Terminal also swallows `Ctrl+Enter`, so the follow-up shortcut also binds `Ctrl+Q` — the same chord GitHub Copilot CLI uses. If your existing `keybindings.yml` already assigns `Ctrl+Q` to another action, that user remap wins and follow-up keeps `Ctrl+Enter` unless you explicitly bind `app.message.followUp`.

Terminals that implement OSC 5522 enhanced paste can send clipboard MIME data directly to `omp`; image pastes are attached as `[Image #N]`, while text/plain paste events keep normal paste behavior. When OSC 5522 is unavailable, bracketed paste still handles text, and a pasted single image-file path is loaded as an image when the file is readable from the `omp` host.

Older unqualified action names are migrated when `keybindings.yml` is loaded, but new docs and new configs should use the namespaced action IDs above. Existing `keybindings.json` files are still accepted and migrated to `keybindings.yml`; `keybindings.yaml` is also accepted.

## Focused agents

While viewing a subagent, `Ctrl+Q` interrupts its active turn with the normal user-interrupt reason, keeps the agent available for revival, and returns to its parent (or Main). When the agent is idle, it only returns. In either case, the focused agent's draft and cursor are restored when you focus it again. `Alt+Shift+Left` returns to the parent without interrupting, even when the editor contains a draft. `Esc` still clears a nonempty draft first; double-tap `Left` on an empty editor remains the legacy return gesture.

## Agent Hub

Open the Agent Hub with `←←` (double-tap left arrow) from the main editor.

### Table (roster) view

| Key       | Action                                                   |
| --------- | -------------------------------------------------------- |
| `j` / `↓` | Select next row                                          |
| `k` / `↑` | Select previous row                                      |
| `g`       | Jump to first row                                        |
| `G`       | Jump to last row (newest agent)                          |
| `Enter`   | Focus live agent / open parked agent transcript          |
| `r`       | Revive a parked agent                                    |
| `x`       | Kill (abort + release) the selected agent                |
| `/`       | Incremental filter — matches id, display name, task, model, status (case-insensitive) |
| `Esc`     | Clear active filter; if none, close hub                  |
| `←←`      | Close hub (double-tap left arrow)                        |

Selection anchors on the agent's stable ID: adding, removing, or reordering agents does not retarget the cursor. The hub opens with the newest agent pre-selected.

### Chat (transcript) view

| Key       | Action                                                   |
| --------- | -------------------------------------------------------- |
| `j` / `↓` | Scroll down                                              |
| `k` / `↑` | Scroll up                                                |
| `g`       | Scroll to top                                            |
| `G`       | Scroll to bottom                                         |
| `PgUp`    | Page up                                                  |
| `PgDn`    | Page down                                                |
| `/`       | Search full transcript text (case-insensitive)           |
| `n`       | Jump to next search match                                |
| `N`       | Jump to previous search match                            |
| `R`       | Revive a parked agent (without focusing main view)       |
| `Ctrl+O`  | Toggle tool-output expansion                             |
| `Enter`   | Send message (revives parked agents)                     |
| `Esc`     | Clear search → close chat → close hub (unwinds in order) |
| `←←`      | Hop to parent agent / close hub                          |
