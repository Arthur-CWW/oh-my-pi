import { describe, expect, test } from "bun:test"
import { existsSync, readFileSync } from "node:fs"
import { join } from "node:path"
import { pathToFileURL } from "node:url"
import type { KeybindingsManager } from "@oh-my-pi/pi-coding-agent"
import type { EditorTheme, TUI } from "@oh-my-pi/pi-tui"
import { getKeybindings } from "@oh-my-pi/pi-tui"
import { type ClipboardAdapter, VimLiteEditor } from "../src/vim-lite"

const symbols: EditorTheme["symbols"] = {
  cursor: ">",
  inputCursor: "▌",
  boxRound: { topLeft: "╭", topRight: "╮", bottomLeft: "╰", bottomRight: "╯", horizontal: "─", vertical: "│" },
  boxSharp: { topLeft: "+", topRight: "+", bottomLeft: "+", bottomRight: "+", horizontal: "-", vertical: "|", teeDown: "+", teeUp: "+", teeLeft: "+", teeRight: "+", cross: "+" },
  table: { topLeft: "+", topRight: "+", bottomLeft: "+", bottomRight: "+", horizontal: "-", vertical: "|", teeDown: "+", teeUp: "+", teeLeft: "+", teeRight: "+", cross: "+" },
  quoteBorder: "|",
  hrChar: "-",
  spinnerFrames: ["-"],
}

const theme: EditorTheme = {
  borderColor: (text: string) => text,
  symbols,
  selectList: {
    selectedPrefix: (text: string) => text,
    selectedText: (text: string) => text,
    description: (text: string) => text,
    scrollInfo: (text: string) => text,
    noMatch: (text: string) => text,
    symbols,
  },
}

function createEditor(clipboard?: ClipboardAdapter): VimLiteEditor {
  const tui = {
    terminal: { rows: 24 },
    requestRender() {},
  } as TUI
  const editor = new VimLiteEditor(tui, theme, getKeybindings() as KeybindingsManager, clipboard)
  editor.focused = false
  return editor
}

function seedPaste(editor: VimLiteEditor, id: number, text: string): void {
  const pastes = Reflect.get(editor, "pastes")
  if (pastes instanceof Map) {
    pastes.set(id, text)
    return
  }

  if (id !== 1) throw new Error("OMP paste cache seeding only supports the next paste marker")
  const currentText = editor.getText()
  editor.handleInput(`\x1b[200~${text}\x1b[201~`)
  editor.setText(currentText)
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
  const extensionPath = join(home, ".omp", "agent", "extensions", "vim-lite.ts")
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

  test("plain paste reads from system clipboard", () => {
    let clipboardText = "system paste"
    const clipboard: ClipboardAdapter = {
      readText: () => clipboardText,
      writeText(text: string) {
        clipboardText = text
        return true
      },
    }

    const charwiseEditor = createEditor(clipboard)
    charwiseEditor.handleInput("\x1b")
    press(charwiseEditor, "p")
    expect(charwiseEditor.getText()).toBe("system paste")

    clipboardText = "line paste\n"
    const linewiseEditor = createEditor(clipboard)
    linewiseEditor.setText("base")
    linewiseEditor.handleInput("\x1b")
    press(linewiseEditor, "p")
    expect(linewiseEditor.getText()).toBe("base\nline paste")
  })

  test("normal mode operations treat large paste markers atomically", () => {
    const editor = createEditor()
    const pasted = largePasteText()

    editor.handleInput(`\x1b[200~${pasted}\x1b[201~`)
    expect(editor.getText()).toBe("[Paste #1, +12 lines]")
    expect(editor.getExpandedText()).toBe(pasted)

    editor.handleInput("\x1b")
    press(editor, "0x")

    expect(editor.getText()).toBe("")
    expect(editor.getExpandedText()).toBe("")
  })

  test("gx collapse restores the marker at its expanded span", () => {
    const editor = createEditor()
    const pasted = largePasteText()

    editor.setText(`${pasted}\n[Paste #1, +12 lines]`)
    seedPaste(editor, 1, pasted)
    editor.handleInput("\x1b")

    press(editor, "gx")
    expect(editor.getText()).toBe(`${pasted}\n${pasted}`)

    press(editor, "gx")
    expect(editor.getText()).toBe(`${pasted}\n[Paste #1, +12 lines]`)
  })
  test("normal mode line motions stay logical before word motions on wrapped input", () => {
    const editor = createEditor()
    editor.setText(`${`firstword ${"longword ".repeat(12)}tail`}\nsecond alpha beta\nthird gamma delta`)
    editor.handleInput("\x1b")

    press(editor, "gg")
    editor.render(24)
    press(editor, "j")
    expect(editor.getCursor()).toEqual({ line: 1, col: 0 })

    press(editor, "w")
    expect(editor.getCursor()).toEqual({ line: 1, col: "second ".length })

    press(editor, "b")
    expect(editor.getCursor()).toEqual({ line: 1, col: 0 })
    expect(renderSnapshot(editor, 24)).toContain("[s]econd alpha beta")
  })

  test("expanded large-paste line motions feed the same cursor to word motions", () => {
    const editor = createEditor()
    const pasted = Array.from({ length: 12 }, (_, index) => `row${index + 1} ${"longword ".repeat(6)}alpha beta`).join("\n")

    editor.handleInput(`\x1b[200~${pasted}\x1b[201~`)
    editor.handleInput("\x1b")
    press(editor, "gx")

    editor.render(24)
    press(editor, "j")
    expect(editor.getCursor()).toEqual({ line: 1, col: 0 })

    press(editor, "w")
    expect(editor.getCursor()).toEqual({ line: 1, col: "row2 ".length })

    press(editor, "b")
    expect(editor.getCursor()).toEqual({ line: 1, col: 0 })
    expect(renderSnapshot(editor, 24)).toContain("[r]ow2")
  })

  test("normal and visual WORD motions use Vim whitespace semantics", () => {
    const text = "foo-bar baz_qux zap"
    const normalCases = [
      { keys: "0W", cursor: { line: 0, col: "foo-bar ".length } },
      { keys: "0E", cursor: { line: 0, col: "foo-bar".length - 1 } },
      { keys: "0WW", cursor: { line: 0, col: "foo-bar baz_qux ".length } },
      { keys: "0WB", cursor: { line: 0, col: 0 } },
      { keys: "0wB", cursor: { line: 0, col: 0 } },
    ]

    for (const { keys, cursor } of normalCases) {
      const editor = createEditor()
      editor.setText(text)
      editor.handleInput("\x1b")
      press(editor, keys)
      expect(editor.getCursor()).toEqual(cursor)
    }

    let clipboardText = ""
    const clipboard: ClipboardAdapter = {
      readText: () => clipboardText,
      writeText(text: string) {
        clipboardText = text
        return true
      },
    }
    const yank = (keys: string): string => {
      const editor = createEditor(clipboard)
      clipboardText = ""
      editor.setText(text)
      editor.handleInput("\x1b")
      press(editor, keys)
      press(editor, "y")
      return clipboardText
    }

    expect(yank("0vW")).toBe("foo-bar b")
    expect(yank("0vE")).toBe("foo-bar")
    expect(yank("0vWW")).toBe("foo-bar baz_qux z")
    expect(yank("0vWB")).toBe("f")
    expect(yank("0WvE")).toBe("baz_qux")
  })

  test("visual line and word motions share one logical cursor on wrapped input", () => {
    let clipboardText = ""
    const clipboard: ClipboardAdapter = {
      readText: () => clipboardText,
      writeText(text: string) {
        clipboardText = text
        return true
      },
    }
    const firstLine = `firstword ${"longword ".repeat(12)}tail`
    const editor = createEditor(clipboard)
    editor.setText(`${firstLine}\nsecond alpha beta\nthird gamma delta`)
    editor.handleInput("\x1b")

    press(editor, "gg")
    editor.render(24)
    press(editor, "vjw")

    expect(editor.getCursor()).toEqual({ line: 1, col: "second ".length })
    press(editor, "y")
    expect(clipboardText).toBe(`${firstLine}\nsecond a`)
  })

  test("normal mode word motions render one clamped cursor", () => {
    const editor = createEditor()
    editor.focused = true
    press(editor, "hello world")
    editor.handleInput("\x1b")

    press(editor, "ww")
    const rendered = editor.render(40).join("\n")

    expect(editor.getCursor()).toEqual({ line: 0, col: 10 })
    expect(rendered).not.toContain("\u001b_pi:c\u0007")
    expect(renderSnapshot(editor, 40)).toContain("hello worl[d]")
    press(editor, "v")
    expect(editor.render(40).join("\n")).not.toContain("\u001b_pi:c\u0007")

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
  test("actual OMP editor uses system clipboard for default yank and paste", async () => {
    const editor = await createOmpEditor()
    if (!editor) return

    let clipboardText = "omp paste"
    const clipboard: ClipboardAdapter = {
      readText: () => clipboardText,
      writeText(text: string) {
        clipboardText = text
        return true
      },
    }
    expect(Reflect.set(editor, "clipboard", clipboard)).toBe(true)

    editor.handleInput("\x1b")
    press(editor, "p")
    expect(editor.getText()).toBe("omp paste")

    clipboardText = "external"
    editor.setText("copy")
    editor.handleInput("\x1b")
    press(editor, "0v$y")
    expect(clipboardText).toBe("copy")
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
