import { describe, expect, test } from "bun:test"
import { existsSync, readFileSync } from "node:fs"
import { join } from "node:path"
import { pathToFileURL } from "node:url"
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

const OMP_SYMBOLS = {
  cursor: "›",
  inputCursor: " ",
  boxRound: { topLeft: "╭", topRight: "╮", bottomLeft: "╰", bottomRight: "╯", horizontal: "─", vertical: "│" },
  boxSharp: {
    topLeft: "+",
    topRight: "+",
    bottomLeft: "+",
    bottomRight: "+",
    horizontal: "-",
    vertical: "|",
    teeDown: "+",
    teeUp: "+",
    teeLeft: "+",
    teeRight: "+",
    cross: "+",
  },
  table: {
    topLeft: "+",
    topRight: "+",
    bottomLeft: "+",
    bottomRight: "+",
    horizontal: "-",
    vertical: "|",
    teeDown: "+",
    teeUp: "+",
    teeLeft: "+",
    teeRight: "+",
    cross: "+",
  },
  quoteBorder: "│",
  hrChar: "─",
  spinnerFrames: ["-"],
}

const ompTheme = {
  borderColor: (text: string) => text,
  selectList: {
    selectedPrefix: (text: string) => text,
    selectedText: (text: string) => text,
    description: (text: string) => text,
    scrollInfo: (text: string) => text,
    noMatch: (text: string) => text,
    symbols: OMP_SYMBOLS,
  },
  symbols: OMP_SYMBOLS,
}

type OmpEditorFactory = (tui: TUI, theme: EditorTheme, keybindings: KeybindingsManager) => VimLiteEditor

type OmpExtensionContext = {
  hasUI: true
  ui: {
    setEditorComponent(factory: OmpEditorFactory): void
    notify(): void
    setWidget(): void
  }
}

type OmpExtension = {
  handlers: Map<string, Array<(event: object, ctx: OmpExtensionContext) => void | Promise<void>>>
}

type OmpLoaderModule = {
  loadExtensions(paths: string[], cwd: string): Promise<{ errors: Error[]; extensions: OmpExtension[] }>
}

type OmpKeybindingsModule = {
  getKeybindings(): KeybindingsManager
}

type OmpRuntime = {
  extensionPath: string
  loadExtensions: OmpLoaderModule["loadExtensions"]
  getKeybindings: OmpKeybindingsModule["getKeybindings"]
}

async function loadOmpRuntime(): Promise<OmpRuntime | undefined> {
  const home = process.env.HOME
  if (!home) return undefined

  const ompRoot = join(home, ".bun", "install", "global", "node_modules", "@oh-my-pi", "pi-coding-agent")
  const loaderPath = join(ompRoot, "src", "extensibility", "extensions", "loader.ts")
  const keybindingsPath = join(home, ".bun", "install", "global", "node_modules", "@oh-my-pi", "pi-tui", "src", "keybindings.ts")
  const extensionPath = join(home, ".pi", "agent", "extensions", "vim-lite.ts")
  if (!existsSync(loaderPath) || !existsSync(keybindingsPath) || !existsSync(extensionPath)) return undefined

  const loader = (await import(pathToFileURL(loaderPath).href)) as OmpLoaderModule
  const keybindings = (await import(pathToFileURL(keybindingsPath).href)) as OmpKeybindingsModule
  return { extensionPath, loadExtensions: loader.loadExtensions, getKeybindings: keybindings.getKeybindings }
}

async function createOmpEditor(): Promise<VimLiteEditor | undefined> {
  const runtime = await loadOmpRuntime()
  if (!runtime) return undefined

  let editorFactory: OmpEditorFactory | undefined
  const context: OmpExtensionContext = {
    hasUI: true,
    ui: {
      setEditorComponent(factory) {
        editorFactory = factory
      },
      notify() {},
      setWidget() {},
    },
  }

  const result = await runtime.loadExtensions([runtime.extensionPath], process.cwd())
  expect(result.errors).toEqual([])
  const sessionStart = result.extensions[0]?.handlers.get("session_start")?.[0]
  expect(sessionStart).toBeDefined()
  await sessionStart?.({}, context)
  expect(editorFactory).toBeDefined()

  const tui = { terminal: { rows: 24 }, requestRender() {} } as TUI
  return editorFactory?.(tui, ompTheme as EditorTheme, runtime.getKeybindings())
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

  test("loads through the installed OMP extension loader", async () => {
    const editor = await createOmpEditor()
    if (!editor) return

    press(editor, "hello")
    editor.handleInput("\x1b")
    press(editor, "0x")
    const rendered = renderSnapshot(editor)

    expect(editor.getText()).toBe("ello")
    expect(rendered).toContain("NORMAL")
  })

  test("actual OMP editor adapter survives fuzzed vim input", async () => {
    const editor = await createOmpEditor()
    if (!editor) return

    const inputs = [
      "a",
      "b",
      "c",
      " ",
      "\n",
      "\x1b",
      "i",
      "a",
      "A",
      "I",
      "o",
      "O",
      "h",
      "j",
      "k",
      "l",
      "0",
      "$",
      "w",
      "b",
      "e",
      "x",
      "X",
      "d",
      "c",
      "y",
      "p",
      "u",
      "v",
      "V",
      "g",
      "G",
      "r",
      ".",
      "\x12",
      "\x1b[A",
      "\x1b[B",
      "\x1b[C",
      "\x1b[D",
    ]
    let seed = 0x12345678
    const next = (): number => {
      seed = Math.imul(seed ^ (seed >>> 15), 2246822507) ^ Math.imul(seed ^ (seed >>> 13), 3266489909)
      return (seed >>> 0) / 2 ** 32
    }

    let sequence = ""
    for (let index = 0; index < 500; index++) {
      const input = inputs[Math.floor(next() * inputs.length)] ?? "\x1b"
      sequence += JSON.stringify(input)
      try {
        editor.handleInput(input)
        editor.render(50)
        editor.getText()
      } catch (error) {
        const message = error instanceof Error ? error.stack : String(error)
        throw new Error(`OMP vim-lite fuzz failed after ${sequence}: ${message}`)
      }
    }

    expect(typeof editor.getText()).toBe("string")
  })
})
