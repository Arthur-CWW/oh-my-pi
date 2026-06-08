import { describe, expect, test } from "bun:test"
import { readFileSync } from "node:fs"
import { join } from "node:path"
import type { KeybindingsManager } from "@earendil-works/pi-coding-agent"
import type { EditorTheme, TUI } from "@earendil-works/pi-tui"
import { getKeybindings } from "@earendil-works/pi-tui"
import { type ClipboardAdapter, VimLiteEditor } from "../src/vim-lite"

const theme: EditorTheme = {
  borderColor: (text: string) => text,
  selectList: {
    selectedPrefix: (text: string) => text,
    selectedText: (text: string) => text,
    description: (text: string) => text,
    scrollInfo: (text: string) => text,
    noMatch: (text: string) => text,
  },
}

function createEditor(clipboard?: ClipboardAdapter): VimLiteEditor {
  const tui = {
    terminal: { rows: 24 },
    requestRender() {},
  } as unknown as TUI
  const editor = new VimLiteEditor(tui, theme, getKeybindings() as KeybindingsManager, clipboard)
  editor.focused = false
  return editor
}

function press(editor: VimLiteEditor, input: string): void {
  for (const char of input) editor.handleInput(char)
}

function renderSnapshot(editor: VimLiteEditor, width = 32): string {
  return editor
    .render(width)
    .map((line) =>
      line
        .replace(/\u001b_pi:c\u0007/g, "")
        .replace(/\x1b\[7m([^\x1b]*)\x1b\[0m/g, "[$1]")
        .replace(/\x1b\[[0-9;]*m/g, "")
        .trimEnd(),
    )
    .join("\n")
}

function largePasteText(): string {
  return Array.from({ length: 12 }, (_, index) => `line-${index + 1}`).join("\n")
}

describe("VimLiteEditor", () => {
  test("visual mode render/edit undo/redo snapshot", () => {
    const editor = createEditor()

    press(editor, "hello world")
    editor.handleInput("\x1b")
    press(editor, "0ve")
    const visual = renderSnapshot(editor)

    press(editor, "d")
    const afterDelete = `${editor.getText()}\n${renderSnapshot(editor)}`

    press(editor, "u")
    const afterUndo = `${editor.getText()}\n${renderSnapshot(editor)}`

    editor.handleInput("\x12") // Ctrl+r
    const afterRedo = `${editor.getText()}\n${renderSnapshot(editor)}`

    const lineEditor = createEditor()
    lineEditor.setText("one\ntwo\nthree")
    lineEditor.handleInput("\x1b")
    press(lineEditor, "ggVj")
    const visualLine = renderSnapshot(lineEditor)
    press(lineEditor, "d")
    const afterLineDelete = `${lineEditor.getText()}\n${renderSnapshot(lineEditor)}`

    let clipboardText = ""
    const clipboard: ClipboardAdapter = {
      readText: () => clipboardText,
      writeText(text: string) {
        clipboardText = text
        return true
      },
    }

    const clipboardEditor = createEditor(clipboard)
    clipboardEditor.setText("copy me")
    clipboardEditor.handleInput("\x1b")
    press(clipboardEditor, "0v$y")
    const afterClipboardYank = `clipboard=${JSON.stringify(clipboardText)}\n${clipboardEditor.getText()}\n${renderSnapshot(clipboardEditor)}`

    const clipboardPasteEditor = createEditor(clipboard)
    clipboardPasteEditor.handleInput("\x1b")
    press(clipboardPasteEditor, "\"+p")
    const afterClipboardPaste = `${clipboardPasteEditor.getText()}\n${renderSnapshot(clipboardPasteEditor)}`

    const lineClipboardEditor = createEditor(clipboard)
    lineClipboardEditor.setText("one\ntwo")
    lineClipboardEditor.handleInput("\x1b")
    press(lineClipboardEditor, "ggyy")
    const afterLineClipboardYank = `clipboard=${JSON.stringify(clipboardText)}\n${lineClipboardEditor.getText()}\n${renderSnapshot(lineClipboardEditor)}`

    const lineClipboardPasteEditor = createEditor(clipboard)
    lineClipboardPasteEditor.setText("base")
    lineClipboardPasteEditor.handleInput("\x1b")
    press(lineClipboardPasteEditor, "\"+p")
    const afterLineClipboardPaste = `${lineClipboardPasteEditor.getText()}\n${renderSnapshot(lineClipboardPasteEditor)}`

    const wrapEditor = createEditor()
    wrapEditor.setText(`${"abcdefghij-".repeat(18)}tail`)
    wrapEditor.handleInput("\x1b")
    press(wrapEditor, "v")
    const visualWrapped = renderSnapshot(wrapEditor, 12)

    const pasteEditor = createEditor()
    const pasted = Array.from({ length: 12 }, (_, index) => `line-${index + 1}`).join("\n")
    pasteEditor.handleInput(`\x1b[200~${pasted}\x1b[201~`)
    const collapsedPaste = pasteEditor.getText()
    pasteEditor.handleInput("\x1b")
    press(pasteEditor, "gx")
    const expandedPaste = pasteEditor.getText()
    press(pasteEditor, "gx")
    const recollapsedPaste = pasteEditor.getText()

    const actual = [
      "--- visual ---",
      visual,
      "--- after-delete ---",
      afterDelete,
      "--- after-undo ---",
      afterUndo,
      "--- after-redo ---",
      afterRedo,
      "--- visual-line ---",
      visualLine,
      "--- after-line-delete ---",
      afterLineDelete,
      "--- clipboard-yank ---",
      afterClipboardYank,
      "--- clipboard-paste ---",
      afterClipboardPaste,
      "--- line-clipboard-yank ---",
      afterLineClipboardYank,
      "--- line-clipboard-paste ---",
      afterLineClipboardPaste,
      "--- visual-wrapped-centered ---",
      visualWrapped,
      "--- paste-toggle ---",
      `collapsed=${JSON.stringify(collapsedPaste)}`,
      `expanded=${JSON.stringify(expandedPaste)}`,
      `recollapsed=${JSON.stringify(recollapsedPaste)}`,
    ].join("\n")

    const expected = readFileSync(join(import.meta.dir, "__snapshots__", "vim-lite-visual.snap.txt"), "utf8").trimEnd()
    expect(actual).toBe(expected)
  })

  test("plain yanks write to system clipboard", () => {
    let clipboardText = ""
    const clipboard: ClipboardAdapter = {
      readText: () => clipboardText,
      writeText(text: string) {
        clipboardText = text
        return true
      },
    }

    const visualEditor = createEditor(clipboard)
    visualEditor.setText("copy me")
    visualEditor.handleInput("\x1b")
    press(visualEditor, "0v$y")
    expect(clipboardText).toBe("copy me")

    const lineEditor = createEditor(clipboard)
    lineEditor.setText("one\ntwo")
    lineEditor.handleInput("\x1b")
    press(lineEditor, "ggyy")
    expect(clipboardText).toBe("one\n")

    clipboardText = "external"
    const deleteEditor = createEditor(clipboard)
    deleteEditor.setText("one\ntwo")
    deleteEditor.handleInput("\x1b")
    press(deleteEditor, "ggdd")
    expect(clipboardText).toBe("external")
  })

  test("normal mode operations treat large paste markers atomically", () => {
    const editor = createEditor()
    const pasted = largePasteText()

    editor.handleInput(`\x1b[200~${pasted}\x1b[201~`)
    expect(editor.getText()).toBe("[paste #1 +12 lines]")
    expect(editor.getExpandedText()).toBe(pasted)

    editor.handleInput("\x1b")
    press(editor, "0x")

    expect(editor.getText()).toBe("")
    expect(editor.getExpandedText()).toBe("")
  })

  test("gx collapse restores the marker at its expanded span", () => {
    const editor = createEditor()
    const pasted = largePasteText()

    editor.setText(`${pasted}\n[paste #1 +12 lines]`)
    ;(editor as unknown as { pastes: Map<number, string> }).pastes.set(1, pasted)
    editor.handleInput("\x1b")

    press(editor, "gx")
    expect(editor.getText()).toBe(`${pasted}\n${pasted}`)

    press(editor, "gx")
    expect(editor.getText()).toBe(`${pasted}\n[paste #1 +12 lines]`)
  })
})
