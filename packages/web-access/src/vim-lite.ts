import { spawnSync } from "node:child_process"
import {
  CustomEditor,
  type ExtensionAPI,
  type ExtensionContext,
  type KeybindingsManager,
} from "@oh-my-pi/pi-coding-agent"
import type { EditorTheme, TUI } from "@oh-my-pi/pi-tui"
import { CURSOR_MARKER, Ellipsis, matchesKey, truncateToWidth, visibleWidth } from "@oh-my-pi/pi-tui"

type VimMode = "insert" | "normal" | "visual" | "visualLine"
type VimOperator = "d" | "c" | "y"
type VimRegisterName = "+"

export interface ClipboardAdapter {
  readText(): string | undefined
  writeText(text: string): boolean
}

type EditorInternals = {
  state: { lines: string[]; cursorLine: number; cursorCol: number }
  historyIndex?: number
  lastAction?: string | null
  segment?(text: string): Iterable<Intl.SegmentData>
  setCursorCol(col: number): void
  moveCursor(deltaLine: number, deltaCol: number): void
  moveToLineStart(): void
  moveToLineEnd(): void
  cancelAutocomplete(): void
  insertTextAtCursorInternal(text: string): void
  getText(): string
  pastes?: Map<number, string>
}

type CountInfo = { count: number; explicit: boolean }
type PendingOperator = {
  op: VimOperator
  count: number
  countText: string
  prefix?: "g"
  registerName?: VimRegisterName
}
type Register = { text: string; linewise: boolean }
type Pos = { line: number; col: number }
type EditorCompat = Partial<EditorInternals> & {
  actionHandlers?: Map<Parameters<KeybindingsManager["matches"]>[1], true>
  getCursor?(): Pos
  getLines?(): string[]
  getPaddingX?(): number
  insertText?(value: string): void
  moveToLineEnd?(): void
  moveToLineStart?(): void
  moveToMessageStart?(): void
}
type Snapshot = { text: string; cursor: Pos }
type VisualRange = { start: number; end: number; linewise: boolean; startLine: number; endLine: number }
type LayoutSegment = { line: number; startCol: number; endCol: number; text: string; hasCursor: boolean }
type ExpandedPaste = { marker: string; content: string; start: number; end: number }

const MAX_COUNT = 999
const MAX_HISTORY = 300
const PASTE_MARKER_PATTERN = /\[Paste #\d+(?:, (?:\+\d+ lines|\d+ chars))?\]|\[paste #\d+(?: (?:\+\d+ lines|\d+ chars))?\]/g
const graphemes = new Intl.Segmenter(undefined, { granularity: "grapheme" })
const KEY_UP = "\x1b[A"
const KEY_DOWN = "\x1b[B"
const KEY_RIGHT = "\x1b[C"
const KEY_LEFT = "\x1b[D"


const HELP_LINES = [
  "vim-lite: Esc normal · i/a/I/A insert · o/O new line · Enter submits",
  "motions: h j k l · w b e · 0 ^ $ · gg/G · counts like 3w or 2dd",
  "visual: v charwise · V linewise · o swap end · d/c/y/x/s operate on selection",
  "clipboard: y / yy / Y / visual y copy to system clipboard · p/P paste from it · deletes stay internal",
  "paste markers: gx toggles Pi large-paste marker expansion/collapse",
  "edits: x/X · d/c/y + motion · dd/cc/yy · D/C/Y · p/P · r<char> · s/S · u undo · Ctrl+r redo",
  "Pi keys still work: Ctrl+C clear/copy · Ctrl+D exit on empty · Ctrl+G external editor · Ctrl+P model",
]

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value))
}

function isSinglePrintable(data: string): boolean {
  return data.length === 1 && data.charCodeAt(0) >= 32
}

function isCountDigit(key: string, current: string): boolean {
  return /^[1-9]$/.test(key) || (current.length > 0 && key === "0")
}

function parseCount(text: string, defaultValue = 1): number {
  if (!text) return defaultValue
  const parsed = Number.parseInt(text, 10)
  if (!Number.isFinite(parsed)) return defaultValue
  return clamp(parsed, 1, MAX_COUNT)
}

function firstNonBlank(line: string): number {
  const idx = line.search(/\S/)
  return idx === -1 ? 0 : idx
}

function runClipboardCommand(command: string, args: string[], input?: string): string | undefined {
  const result = spawnSync(command, args, { encoding: "utf8", input, stdio: [input === undefined ? "ignore" : "pipe", "pipe", "ignore"] })
  if (result.status !== 0) return undefined
  return typeof result.stdout === "string" ? result.stdout : ""
}

function createSystemClipboard(): ClipboardAdapter {
  return {
    readText() {
      if (process.platform === "darwin") return runClipboardCommand("pbpaste", [])
      if (process.platform === "win32") return runClipboardCommand("powershell.exe", ["-NoProfile", "-Command", "Get-Clipboard -Raw"])
      return (
        runClipboardCommand("wl-paste", []) ??
        runClipboardCommand("xclip", ["-selection", "clipboard", "-out"]) ??
        runClipboardCommand("xsel", ["--clipboard", "--output"])
      )
    },
    writeText(text: string) {
      if (process.platform === "darwin") return runClipboardCommand("pbcopy", [], text) !== undefined
      if (process.platform === "win32") {
        return runClipboardCommand("powershell.exe", ["-NoProfile", "-Command", "Set-Clipboard"], text) !== undefined
      }
      return (
        runClipboardCommand("wl-copy", [], text) ??
        runClipboardCommand("xclip", ["-selection", "clipboard", "-in"], text) ??
        runClipboardCommand("xsel", ["--clipboard", "--input"], text)
      ) !== undefined
    },
  }
}

/**
 * A small modal editor for Pi's input box.
 *
 * It intentionally keeps app/control shortcuts in `CustomEditor` and only steals
 * printable keys while in normal mode. The implementation uses Pi's built-in
 * editor state/motion helpers where possible, but keeps a local undo+redo ring
 * because the stock editor currently exposes undo only.
 */
export class VimLiteEditor extends CustomEditor {
  private mode: VimMode = "insert"
  private countText = ""
  private pendingGoto: CountInfo | undefined
  private pendingOperator: PendingOperator | undefined
  private pendingReplaceCount = 0
  private pendingRegisterQuote = false
  private selectedRegister: VimRegisterName | undefined
  private visualAnchor: Pos | undefined
  private register: Register = { text: "", linewise: false }
  private readonly keybindingsManager: KeybindingsManager
  private readonly vimTui: TUI
  private readonly clipboard: ClipboardAdapter
  private vimUndoStack: Snapshot[] = []
  private vimRedoStack: Snapshot[] = []
  private visualScrollOffset: number | undefined
  private expandedPastes: ExpandedPaste[] = []
  private insertSessionStart: Snapshot | undefined
  private historyCommandThisInput = false

  decorateText = (text: string): string => text

  constructor(tui: TUI, theme: EditorTheme, keybindings: KeybindingsManager, clipboard: ClipboardAdapter = createSystemClipboard()) {
    super(theme)
    this.vimTui = tui
    this.keybindingsManager = keybindings
    this.clipboard = clipboard
    super.setUseTerminalCursor(false)
  }

  handleInput(data: string): void {
    if (this.mode === "normal" && !this.wouldRunAppAction(data) && matchesKey(data, "ctrl+r")) {
      this.performRedo(this.consumeCount().count)
      return
    }

    if (this.mode === "normal" && !this.wouldRunAppAction(data) && matchesKey(data, "ctrl+-")) {
      this.performUndo(this.consumeCount().count)
      return
    }

    if (this.mode === "insert") {
      if (matchesKey(data, "escape")) {
        if (this.isShowingAutocomplete()) {
          super.handleInput(data)
          return
        }
        this.finalizeInsertSession()
        this.enterNormalMode()
        return
      }

      const before = this.snapshot()
      super.handleInput(data)
      this.recordInsertChange(before, data)
      return
    }

    const before = this.snapshot()

    if (this.isVisualMode()) {
      if (this.handleVisualMode(data)) {
        this.recordChange(before, data)
        return
      }
      super.handleInput(data)
      this.recordChange(before, data)
      return
    }

    if (this.handleNormalMode(data)) {
      this.recordChange(before, data)
      return
    }

    super.handleInput(data)
    this.recordChange(before, data)
  }

  override setUseTerminalCursor(_useTerminalCursor: boolean): void {
    super.setUseTerminalCursor(false)
  }

  render(width: number): string[] {
    this.clampNormalCursor()
    const wasFocused = this.focused
    if (this.mode !== "insert") this.focused = false
    try {
      const lines = [...(this.isVisualMode() ? this.renderVisual(width) : super.render(width))]
      if (lines.length === 0) return lines

      const label = this.borderColor(` ${this.statusLabel()} `)
      const labelWidth = visibleWidth(label)
      if (labelWidth >= width) {
        lines[lines.length - 1] = truncateToWidth(label, width, Ellipsis.Omit)
        return lines
      }

      const last = lines[lines.length - 1]!
      lines[lines.length - 1] = truncateToWidth(last, width - labelWidth, Ellipsis.Omit) + label
      return lines
    } finally {
      this.focused = wasFocused
    }
  }


  private renderVisual(width: number): string[] {
    // Let the stock editor update width-dependent internals used by motions.
    super.render(width)

    const paddingX = Math.min(this.getPaddingXCompat(), Math.max(0, Math.floor((width - 1) / 2)))
    const contentWidth = Math.max(1, width - paddingX * 2)
    const layoutWidth = Math.max(1, contentWidth - (paddingX ? 0 : 1))
    const range = this.getVisualRange()
    const segments = this.layoutSegments(layoutWidth)
    const cursorIndex = Math.max(0, segments.findIndex((segment) => segment.hasCursor))
    const maxVisible = Math.max(5, Math.floor(this.vimTui.terminal.rows * 0.3))
    const maxStart = Math.max(0, segments.length - maxVisible)
    const maxVirtualStart = Math.max(0, segments.length - 1)
    const centeredStart = () => clamp(cursorIndex - Math.floor(maxVisible / 2), 0, maxVirtualStart)

    let start = this.visualScrollOffset ?? centeredStart()
    if (cursorIndex < start || cursorIndex >= start + maxVisible) {
      start = centeredStart()
    }
    start = clamp(start, 0, maxVirtualStart)
    this.visualScrollOffset = start

    const needsVirtualPadding = start > maxStart
    const visible = segments.slice(start, start + maxVisible)
    const pad = " ".repeat(paddingX)
    const lines: string[] = [this.borderColor("─".repeat(width))]

    for (const segment of visible) {
      const rendered = this.renderVisualSegment(segment, range)
      const renderedWidth = visibleWidth(rendered)
      const rightPad = " ".repeat(Math.max(0, contentWidth - renderedWidth))
      lines.push(`${pad}${rendered}${rightPad}${pad}`)
    }

    if (needsVirtualPadding) {
      for (let i = visible.length; i < maxVisible; i++) {
        lines.push(`${pad}${" ".repeat(contentWidth)}${pad}`)
      }
    }

    lines.push(this.borderColor("─".repeat(width)))
    return lines
  }

  private layoutSegments(layoutWidth: number): LayoutSegment[] {
    const e = this.e()
    const segments: LayoutSegment[] = []
    for (let lineIndex = 0; lineIndex < e.state.lines.length; lineIndex++) {
      const line = e.state.lines[lineIndex] ?? ""
      if (line.length === 0) {
        segments.push({ line: lineIndex, startCol: 0, endCol: 0, text: "", hasCursor: e.state.cursorLine === lineIndex })
        continue
      }

      let chunk = ""
      let chunkStart = 0
      let chunkWidth = 0
      for (const segment of this.segments(line)) {
        const part = segment.segment
        const partWidth = Math.max(1, visibleWidth(part))
        if (chunk && chunkWidth + partWidth > layoutWidth) {
          segments.push({
            line: lineIndex,
            startCol: chunkStart,
            endCol: segment.index,
            text: chunk,
            hasCursor: e.state.cursorLine === lineIndex && e.state.cursorCol >= chunkStart && e.state.cursorCol < segment.index,
          })
          chunk = ""
          chunkStart = segment.index
          chunkWidth = 0
        }
        chunk += part
        chunkWidth += partWidth
      }

      segments.push({
        line: lineIndex,
        startCol: chunkStart,
        endCol: line.length,
        text: chunk,
        hasCursor: e.state.cursorLine === lineIndex && e.state.cursorCol >= chunkStart && e.state.cursorCol <= line.length,
      })
    }
    return segments
  }

  private renderVisualSegment(segment: LayoutSegment, range: VisualRange | undefined): string {
    const e = this.e()
    const cursorCol = e.state.cursorLine === segment.line ? e.state.cursorCol : -1
    let out = ""

    if (segment.text.length === 0) {
      const selected = range?.linewise && segment.line >= range.startLine && segment.line <= range.endLine
      return selected ? "\x1b[7m \x1b[0m" : cursorCol === 0 ? "\x1b[7m \x1b[0m" : ""
    }

    for (const part of this.segments(segment.text)) {
      const col = segment.startCol + part.index
      const offset = this.posToOffset({ line: segment.line, col })
      const selected = range
        ? range.linewise
          ? segment.line >= range.startLine && segment.line <= range.endLine
          : offset >= range.start && offset < range.end
        : false
      out += selected ? `\x1b[7m${part.segment}\x1b[0m` : part.segment
    }

    if (cursorCol === segment.endCol && this.focused) out += "\x1b[7m \x1b[0m"
    return out
  }

  private handleNormalMode(data: string): boolean {
    if (!isSinglePrintable(data)) {
      if (matchesKey(data, "escape") && this.hasPendingInput()) {
        this.resetPending()
        this.requestRender()
        return true
      }

      this.resetPending()
      super.handleInput(data)
      this.clampNormalCursor()
      this.requestRender()
      return true
    }

    const key = data

    if (this.pendingReplaceCount > 0) {
      this.replaceChars(key, this.pendingReplaceCount)
      this.pendingReplaceCount = 0
      this.requestRender()
      return true
    }

    if (this.handleRegisterPrefix(key)) return true

    if (this.pendingOperator) {
      this.handlePendingOperator(key)
      return true
    }

    if (this.pendingGoto) {
      if (key === "g") {
        const line = this.pendingGoto.explicit ? this.pendingGoto.count - 1 : 0
        this.gotoLine(line)
      } else if (key === "x") {
        this.togglePasteExpansion()
      }
      this.pendingGoto = undefined
      this.requestRender()
      return true
    }

    if (isCountDigit(key, this.countText)) {
      this.countText += key
      this.requestRender()
      return true
    }

    const countInfo = this.consumeCount()
    const { count, explicit } = countInfo

    switch (key) {
      case "v":
        this.enterVisualMode("visual")
        return true
      case "V":
        this.enterVisualMode("visualLine")
        return true
      case "i":
        this.enterInsertMode()
        return true
      case "I":
        this.moveFirstNonBlank()
        this.enterInsertMode()
        return true
      case "a":
        this.moveRightForAppend()
        this.enterInsertMode()
        return true
      case "A":
        this.e().moveToLineEnd()
        this.enterInsertMode()
        return true
      case "o":
        this.openLineBelow(count)
        this.enterInsertMode()
        return true
      case "O":
        this.openLineAbove(count)
        this.enterInsertMode()
        return true
      case "h":
      case "j":
      case "k":
      case "l":
      case "w":
      case "b":
      case "e":
      case "0":
      case "^":
      case "$":
        this.applyMotion(key, count, explicit)
        this.requestRender()
        return true
      case "g":
        this.pendingGoto = countInfo
        this.requestRender()
        return true
      case "G":
        this.gotoLine(explicit ? count - 1 : this.e().state.lines.length - 1)
        this.requestRender()
        return true
      case "x":
        this.deleteCharsForward(count)
        this.requestRender()
        return true
      case "X":
        this.deleteCharsBackward(count)
        this.requestRender()
        return true
      case "D":
        this.deleteToLineEnd()
        this.requestRender()
        return true
      case "C":
        this.deleteToLineEnd()
        this.enterInsertMode()
        return true
      case "s":
        this.deleteCharsForward(count)
        this.enterInsertMode()
        return true
      case "S":
        this.operateLineSpan("c", this.e().state.cursorLine, this.e().state.cursorLine + count - 1)
        return true
      case "d":
      case "c":
      case "y":
        this.pendingOperator = { op: key, count, countText: "", registerName: this.consumeSelectedRegister() }
        this.requestRender()
        return true
      case "Y":
        this.operateLineSpan("y", this.e().state.cursorLine, this.e().state.cursorLine + count - 1)
        return true
      case "p":
        this.paste(false)
        this.requestRender()
        return true
      case "P":
        this.paste(true)
        this.requestRender()
        return true
      case "r":
        this.pendingReplaceCount = count
        this.requestRender()
        return true
      case "u":
        this.performUndo(count)
        return true
      default:
        this.resetPending()
        this.requestRender()
        return true
    }
  }

  private handleVisualMode(data: string): boolean {
    if (!isSinglePrintable(data)) {
      if (matchesKey(data, "escape")) {
        this.enterNormalMode()
        return true
      }
      this.resetPending()
      super.handleInput(data)
      return true
    }

    const key = data

    if (this.handleRegisterPrefix(key)) return true

    if (this.pendingGoto) {
      if (key === "g") {
        const line = this.pendingGoto.explicit ? this.pendingGoto.count - 1 : 0
        this.gotoLine(line)
      } else if (key === "x") {
        this.togglePasteExpansion()
      }
      this.pendingGoto = undefined
      this.requestRender()
      return true
    }

    if (isCountDigit(key, this.countText)) {
      this.countText += key
      this.requestRender()
      return true
    }

    const countInfo = this.consumeCount()
    const { count, explicit } = countInfo

    switch (key) {
      case "v":
        if (this.mode === "visual") this.enterNormalMode()
        else this.mode = "visual"
        this.requestRender()
        return true
      case "V":
        if (this.mode === "visualLine") this.enterNormalMode()
        else this.mode = "visualLine"
        this.requestRender()
        return true
      case "o":
        this.swapVisualEnd()
        return true
      case "h":
      case "j":
      case "k":
      case "l":
      case "w":
      case "b":
      case "e":
      case "0":
      case "^":
      case "$":
        this.applyMotion(key, count, explicit)
        this.requestRender()
        return true
      case "g":
        this.pendingGoto = countInfo
        this.requestRender()
        return true
      case "G":
        this.gotoLine(explicit ? count - 1 : this.e().state.lines.length - 1)
        this.requestRender()
        return true
      case "d":
      case "x":
        this.operateVisual("d")
        return true
      case "c":
      case "s":
        this.operateVisual("c")
        return true
      case "y":
        this.operateVisual("y")
        return true
      case "D":
        this.forceVisualLinewise()
        this.operateVisual("d")
        return true
      case "C":
        this.forceVisualLinewise()
        this.operateVisual("c")
        return true
      case "Y":
        this.forceVisualLinewise()
        this.operateVisual("y")
        return true
      case "u":
        this.enterNormalMode()
        this.performUndo(count)
        return true
      default:
        this.requestRender()
        return true
    }
  }

  private handleRegisterPrefix(key: string): boolean {
    if (this.pendingRegisterQuote) {
      this.pendingRegisterQuote = false
      if (key === "+") {
        this.selectedRegister = "+"
        this.requestRender()
        return true
      }
      this.selectedRegister = undefined
      this.requestRender()
      return true
    }

    if (key === '"') {
      this.pendingRegisterQuote = true
      this.requestRender()
      return true
    }

    return false
  }

  private handlePendingOperator(key: string): void {
    const pending = this.pendingOperator
    if (!pending) return

    if (isCountDigit(key, pending.countText)) {
      pending.countText += key
      this.requestRender()
      return
    }

    const motionExplicit = pending.countText.length > 0
    const motionCount = clamp(pending.count * parseCount(pending.countText), 1, MAX_COUNT)

    if (pending.prefix === "g") {
      if (key === "g") {
        const target = motionExplicit ? parseCount(pending.countText) - 1 : 0
        this.operateLineSpan(pending.op, this.e().state.cursorLine, target, pending.registerName)
      }
      this.resetPending()
      this.requestRender()
      return
    }

    if (key === "g") {
      pending.prefix = "g"
      this.requestRender()
      return
    }

    if (key === pending.op) {
      this.operateLineSpan(pending.op, this.e().state.cursorLine, this.e().state.cursorLine + motionCount - 1, pending.registerName)
      this.resetPending()
      return
    }

    if (key === "G") {
      const target = motionExplicit ? parseCount(pending.countText) - 1 : this.e().state.lines.length - 1
      this.operateLineSpan(pending.op, this.e().state.cursorLine, target, pending.registerName)
      this.resetPending()
      return
    }

    if (key === "j" || key === "k") {
      const startLine = this.e().state.cursorLine
      const targetLine = startLine + (key === "j" ? motionCount : -motionCount)
      this.operateLineSpan(pending.op, startLine, targetLine, pending.registerName)
      this.resetPending()
      return
    }

    if (["h", "l", "w", "b", "e", "0", "^", "$"].includes(key)) {
      this.operateByMotion(pending.op, key, motionCount, motionExplicit, pending.registerName)
      this.resetPending()
      return
    }

    this.resetPending()
    this.requestRender()
  }

  private operateVisual(op: VimOperator): void {
    const range = this.getVisualRange()
    if (!range) {
      this.enterNormalMode()
      return
    }

    const registerName = this.consumeSelectedRegister()

    if (range.linewise) {
      this.visualAnchor = undefined
      this.visualScrollOffset = undefined
      this.mode = "normal"
      this.operateLineSpan(op, range.startLine, range.endLine, registerName)
      return
    }

    const text = this.e().state.lines.join("\n")
    this.setRegister({ text: text.slice(range.start, range.end), linewise: false }, registerName, op === "y")

    if (op === "y") {
      this.setCursor(range.startLine, this.offsetToPos(this.e().state.lines, range.start).col)
      this.enterNormalMode()
      return
    }

    this.visualAnchor = undefined
    this.visualScrollOffset = undefined
    this.mode = "normal"
    this.replaceRange(range.start, range.end, "", range.start)
    if (op === "c") this.enterInsertMode()
    else this.requestRender()
  }

  private getVisualRange(): VisualRange | undefined {
    if (!this.visualAnchor) return undefined
    const anchor = this.visualAnchor
    const cursor = this.currentPos()
    const startLine = Math.min(anchor.line, cursor.line)
    const endLine = Math.max(anchor.line, cursor.line)

    if (this.mode === "visualLine") {
      return {
        start: this.posToOffset({ line: startLine, col: 0 }),
        end: this.posToOffset({ line: endLine, col: (this.e().state.lines[endLine] ?? "").length }),
        linewise: true,
        startLine,
        endLine,
      }
    }

    const anchorOffset = this.posToOffset(anchor)
    const cursorOffset = this.posToOffset(cursor)
    const min = Math.min(anchorOffset, cursorOffset)
    const max = Math.max(anchorOffset, cursorOffset)
    const text = this.e().state.lines.join("\n")
    const end = max >= text.length ? max : this.nextOffset(max)
    return { start: min, end, linewise: false, startLine, endLine }
  }

  private forceVisualLinewise(): void {
    if (this.isVisualMode()) this.mode = "visualLine"
  }

  private swapVisualEnd(): void {
    if (!this.visualAnchor) return
    const current = this.currentPos()
    this.setCursor(this.visualAnchor.line, this.visualAnchor.col)
    this.visualAnchor = current
    this.requestRender()
  }

  private togglePasteExpansion(): void {
    if (this.expandedPastes.length > 0) {
      const collapsed = this.collapseExpandedPasteText(this.e().getText())
      if (collapsed.changed) {
        const cursorOffset = this.posToOffset(this.currentPos())
        const collapsedPrefix = this.collapseExpandedPasteText(this.e().getText().slice(0, cursorOffset)).text
        this.applyWholeText(collapsed.text, collapsedPrefix.length)
        this.expandedPastes = []
        this.requestRender()
        return
      }
      this.expandedPastes = []
    }

    const expanded = this.expandPasteMarkerText(this.e().getText())
    if (!expanded.changed) return

    const cursorOffset = this.posToOffset(this.currentPos())
    const expandedPrefix = this.expandPasteMarkerText(this.e().getText().slice(0, cursorOffset)).text
    this.expandedPastes = expanded.expansions
    this.applyWholeText(expanded.text, expandedPrefix.length)
    this.requestRender()
  }

  private expandPasteMarkerText(text: string): { text: string; changed: boolean; expansions: ExpandedPaste[] } {
    const inferredPastes = this.inferPasteContents(text)
    const expansions: ExpandedPaste[] = []
    let offsetDelta = 0
    const expanded = text.replace(PASTE_MARKER_PATTERN, (marker: string, matchOffset: number) => {
      const idText = marker.match(/\d+/)?.[0]
      const content = idText === undefined
        ? undefined
        : this.e().pastes?.get(Number.parseInt(idText, 10)) ?? inferredPastes?.get(matchOffset)
      if (content === undefined) return marker
      const adjustedStart = matchOffset + offsetDelta
      const end = adjustedStart + content.length
      expansions.push({ marker, content, start: adjustedStart, end })
      offsetDelta += content.length - marker.length
      return content
    })
    return { text: expanded, changed: expansions.length > 0, expansions }
  }

  private inferPasteContents(text: string): Map<number, string> | undefined {
    const editorText = this.e().getText()
    if (text !== editorText && !editorText.startsWith(text)) return undefined

    const expandedText = this.getExpandedText()
    if (expandedText === editorText) return undefined

    const matches = [...editorText.matchAll(PASTE_MARKER_PATTERN)]
    if (matches.length === 0) return undefined

    const inferred = new Map<number, string>()
    let originalCursor = 0
    let expandedCursor = 0

    for (let index = 0; index < matches.length; index++) {
      const match = matches[index]!
      const markerStart = match.index
      const marker = match[0]
      const literalBefore = editorText.slice(originalCursor, markerStart)
      if (literalBefore) {
        if (!expandedText.startsWith(literalBefore, expandedCursor)) return inferred.size > 0 ? inferred : undefined
        expandedCursor += literalBefore.length
      }

      const markerEnd = markerStart + marker.length
      const nextMarkerStart = matches[index + 1]?.index ?? editorText.length
      const literalAfter = editorText.slice(markerEnd, nextMarkerStart)
      const contentEnd = literalAfter
        ? expandedText.indexOf(literalAfter, expandedCursor)
        : index === matches.length - 1
          ? expandedText.length
          : expandedCursor
      if (contentEnd < expandedCursor) return inferred.size > 0 ? inferred : undefined

      inferred.set(markerStart, expandedText.slice(expandedCursor, contentEnd))
      expandedCursor = contentEnd
      originalCursor = markerEnd
    }

    return inferred
  }

  private collapseExpandedPasteText(text: string): { text: string; changed: boolean } {
    let next = text
    let changed = false
    const pastes = [...this.expandedPastes].sort((a, b) => b.start - a.start)
    for (const paste of pastes) {
      if (next.slice(paste.start, paste.end) !== paste.content) continue
      next = `${next.slice(0, paste.start)}${paste.marker}${next.slice(paste.end)}`
      changed = true
    }
    return { text: next, changed }
  }

  private applyWholeText(text: string, cursorOffset: number): void {
    const e = this.e()
    e.cancelAutocomplete()
    e.historyIndex = -1
    e.lastAction = null
    const lines = text.length > 0 ? text.split("\n") : [""]
    this.replaceEditorLines(lines, this.offsetToPos(lines, clamp(cursorOffset, 0, text.length)))
    this.notifyChange()
  }

  private operateByMotion(op: VimOperator, motion: string, count: number, explicit: boolean, registerName?: VimRegisterName): void {
    const startPos = this.currentPos()
    const startOffset = this.posToOffset(startPos)

    this.applyMotion(motion, count, explicit)
    const endPos = this.currentPos()
    let endOffset = this.posToOffset(endPos)

    if (motion === "e" && endOffset >= startOffset) {
      endOffset = this.nextOffset(endOffset)
    }

    this.setCursor(startPos.line, startPos.col)

    const start = Math.min(startOffset, endOffset)
    const end = Math.max(startOffset, endOffset)
    if (start === end) {
      if (op === "c") this.enterInsertMode()
      return
    }

    const text = this.e().state.lines.join("\n")
    const affected = text.slice(start, end)
    this.setRegister({ text: affected, linewise: false }, registerName, op === "y")

    if (op === "y") {
      this.setCursor(startPos.line, startPos.col)
      this.requestRender()
      return
    }

    this.replaceRange(start, end, "", start)
    if (op === "c") this.enterInsertMode()
    else this.requestRender()
  }

  private applyMotion(motion: string, count: number, explicit: boolean): void {
    const e = this.e()
    switch (motion) {
      case "h":
        for (let i = 0; i < count; i++) e.moveCursor(0, -1)
        break
      case "l":
        for (let i = 0; i < count; i++) e.moveCursor(0, 1)
        break
      case "j":
        for (let i = 0; i < count; i++) e.moveCursor(1, 0)
        break
      case "k":
        for (let i = 0; i < count; i++) e.moveCursor(-1, 0)
        break
      case "w":
        for (let i = 0; i < count; i++) this.moveWordForward()
        break
      case "b":
        for (let i = 0; i < count; i++) this.moveWordBackward()
        break
      case "e":
        for (let i = 0; i < count; i++) this.moveWordEnd()
        break
      case "0":
        e.moveToLineStart()
        break
      case "^":
        this.moveFirstNonBlank()
        break
      case "$":
        if (count > 1 || explicit) {
          for (let i = 1; i < count; i++) e.moveCursor(1, 0)
        }
        e.moveToLineEnd()
        break
    }
  }

  private operateLineSpan(op: VimOperator, rawStartLine: number, rawEndLine: number, registerName: VimRegisterName | undefined = this.consumeSelectedRegister()): void {
    const e = this.e()
    const maxLine = Math.max(0, e.state.lines.length - 1)
    const startLine = clamp(Math.min(rawStartLine, rawEndLine), 0, maxLine)
    const endLine = clamp(Math.max(rawStartLine, rawEndLine), 0, maxLine)
    const affectedLines = e.state.lines.slice(startLine, endLine + 1)
    this.setRegister({ text: `${affectedLines.join("\n")}\n`, linewise: true }, registerName, op === "y")

    if (op === "y") {
      this.setCursor(startLine, firstNonBlank(e.state.lines[startLine] ?? ""))
      this.requestRender()
      return
    }

    e.cancelAutocomplete()
    e.historyIndex = -1
    e.lastAction = null

    const lines = e.state.lines
    if (op === "c") {
      const next = lines.slice()
      next.splice(startLine, endLine - startLine + 1, "")
      this.replaceEditorLines(next, { line: startLine, col: 0 })
      this.notifyChange()
      this.enterInsertMode()
      return
    }

    const next = lines.slice()
    next.splice(startLine, endLine - startLine + 1)
    if (next.length === 0) next.push("")
    const nextLine = clamp(startLine, 0, next.length - 1)
    this.replaceEditorLines(next, { line: nextLine, col: firstNonBlank(next[nextLine] ?? "") })
    this.notifyChange()
    this.requestRender()
  }

  private deleteCharsForward(count: number): void {
    const e = this.e()
    const line = e.state.lines[e.state.cursorLine] ?? ""
    if (e.state.cursorCol >= line.length) return

    let endCol = e.state.cursorCol
    for (let i = 0; i < count; i++) endCol = this.nextCol(line, endCol)

    const start = this.posToOffset({ line: e.state.cursorLine, col: e.state.cursorCol })
    const end = this.posToOffset({ line: e.state.cursorLine, col: endCol })
    this.setRegister({ text: line.slice(e.state.cursorCol, endCol), linewise: false })
    this.replaceRange(start, end, "", start)
  }

  private deleteCharsBackward(count: number): void {
    const e = this.e()
    const line = e.state.lines[e.state.cursorLine] ?? ""
    if (e.state.cursorCol <= 0) return

    let startCol = e.state.cursorCol
    for (let i = 0; i < count; i++) startCol = this.prevCol(line, startCol)

    const start = this.posToOffset({ line: e.state.cursorLine, col: startCol })
    const end = this.posToOffset({ line: e.state.cursorLine, col: e.state.cursorCol })
    this.setRegister({ text: line.slice(startCol, e.state.cursorCol), linewise: false })
    this.replaceRange(start, end, "", start)
  }

  private deleteToLineEnd(): void {
    const e = this.e()
    const line = e.state.lines[e.state.cursorLine] ?? ""
    if (e.state.cursorCol >= line.length) return

    const start = this.posToOffset({ line: e.state.cursorLine, col: e.state.cursorCol })
    const end = this.posToOffset({ line: e.state.cursorLine, col: line.length })
    this.setRegister({ text: line.slice(e.state.cursorCol), linewise: false })
    this.replaceRange(start, end, "", start)
  }

  private replaceChars(char: string, count: number): void {
    const e = this.e()
    const line = e.state.lines[e.state.cursorLine] ?? ""
    if (e.state.cursorCol >= line.length) return

    let endCol = e.state.cursorCol
    let replaced = 0
    for (; replaced < count && endCol < line.length; replaced++) endCol = this.nextCol(line, endCol)
    if (replaced === 0) return

    const start = this.posToOffset({ line: e.state.cursorLine, col: e.state.cursorCol })
    const end = this.posToOffset({ line: e.state.cursorLine, col: endCol })
    this.setRegister({ text: line.slice(e.state.cursorCol, endCol), linewise: false })
    this.replaceRange(start, end, char.repeat(replaced), start)
    this.setCursor(
      e.state.cursorLine,
      Math.min(e.state.cursorCol + Math.max(0, replaced - 1), (e.state.lines[e.state.cursorLine] ?? "").length),
    )
  }

  private setRegister(register: Register, registerName: VimRegisterName | undefined = this.consumeSelectedRegister(), yankToClipboard = false): void {
    this.register = register
    if (yankToClipboard || registerName === "+") this.clipboard.writeText(register.text)
  }

  private consumeSelectedRegister(): VimRegisterName | undefined {
    const registerName = this.selectedRegister
    this.selectedRegister = undefined
    this.pendingRegisterQuote = false
    return registerName
  }

  private refreshRegisterForPaste(registerName: VimRegisterName | undefined): void {
    if (registerName === "+" || registerName === undefined) {
      const text = this.clipboard.readText()
      if (text !== undefined) this.register = { text, linewise: text.endsWith("\n") }
    }
  }

  private paste(before: boolean): void {
    this.refreshRegisterForPaste(this.consumeSelectedRegister())

    if (!this.register.text) return
    const e = this.e()
    e.cancelAutocomplete()
    e.historyIndex = -1
    e.lastAction = null

    if (this.register.linewise) {
      const pastedLines = this.register.text.replace(/\n$/, "").split("\n")
      const insertAt = before ? e.state.cursorLine : e.state.cursorLine + 1
      const next = e.state.lines.slice()
      next.splice(insertAt, 0, ...pastedLines)
      this.replaceEditorLines(next, { line: insertAt, col: firstNonBlank(next[insertAt] ?? "") })
      this.notifyChange()
      return
    }

    if (!before) this.moveRightForAppend()
    e.insertTextAtCursorInternal(this.register.text)
  }

  private openLineBelow(count: number): void {
    const e = this.e()
    e.cancelAutocomplete()
    e.historyIndex = -1
    e.lastAction = null
    const lines = Array.from({ length: count }, () => "")
    const insertAt = e.state.cursorLine + 1
    const next = e.state.lines.slice()
    next.splice(insertAt, 0, ...lines)
    this.replaceEditorLines(next, { line: insertAt, col: 0 })
    this.notifyChange()
  }

  private openLineAbove(count: number): void {
    const e = this.e()
    e.cancelAutocomplete()
    e.historyIndex = -1
    e.lastAction = null
    const lines = Array.from({ length: count }, () => "")
    const insertAt = e.state.cursorLine
    const next = e.state.lines.slice()
    next.splice(insertAt, 0, ...lines)
    this.replaceEditorLines(next, { line: insertAt, col: 0 })
    this.notifyChange()
  }

  private replaceRange(start: number, end: number, replacement: string, cursorOffset: number): void {
    const e = this.e()
    e.cancelAutocomplete()
    e.historyIndex = -1
    e.lastAction = null

    const text = e.state.lines.join("\n")
    const next = text.slice(0, start) + replacement + text.slice(end)
    const lines = next.length > 0 ? next.split("\n") : [""]
    this.replaceEditorLines(lines, this.offsetToPos(lines, clamp(cursorOffset, 0, next.length)))
    this.notifyChange()
  }

  private moveWordForward(): void {
    const e = this.e()
    let lineIdx = e.state.cursorLine
    let col = e.state.cursorCol

    while (lineIdx < e.state.lines.length) {
      const line = e.state.lines[lineIdx] ?? ""
      let i = col

      if (i >= line.length) {
        if (lineIdx >= e.state.lines.length - 1) {
          this.setCursor(lineIdx, line.length)
          return
        }
        lineIdx++
        col = 0
        continue
      }

      const kind = this.charKindAt(line, i)
      if (kind === "space") {
        while (i < line.length && this.charKindAt(line, i) === "space") i = this.nextCol(line, i)
      } else {
        while (i < line.length && this.charKindAt(line, i) === kind) i = this.nextCol(line, i)
        while (i < line.length && this.charKindAt(line, i) === "space") i = this.nextCol(line, i)
      }

      if (i < line.length) {
        this.setCursor(lineIdx, i)
        return
      }

      if (lineIdx >= e.state.lines.length - 1) {
        this.setCursor(lineIdx, line.length)
        return
      }
      lineIdx++
      col = 0
    }
  }

  private moveWordBackward(): void {
    const e = this.e()
    let lineIdx = e.state.cursorLine
    let col = e.state.cursorCol

    while (lineIdx >= 0) {
      const line = e.state.lines[lineIdx] ?? ""
      let i = col

      if (i <= 0) {
        if (lineIdx === 0) {
          this.setCursor(0, 0)
          return
        }
        lineIdx--
        col = (e.state.lines[lineIdx] ?? "").length
        continue
      }

      while (i > 0 && this.charKindAt(line, this.prevCol(line, i)) === "space") i = this.prevCol(line, i)
      if (i <= 0) {
        this.setCursor(lineIdx, 0)
        return
      }

      const kind = this.charKindAt(line, this.prevCol(line, i))
      while (i > 0 && this.charKindAt(line, this.prevCol(line, i)) === kind) i = this.prevCol(line, i)
      this.setCursor(lineIdx, i)
      return
    }
  }

  private clampNormalCursor(): void {
    if (this.mode !== "normal") return
    const cursor = this.getEditorCursor()
    const lines = this.getEditorLines()
    const line = lines[cursor.line] ?? ""
    if (line.length === 0 || cursor.col < line.length) return
    this.setEditorCursor({ line: cursor.line, col: this.prevCol(line, line.length) })
  }

  private moveWordEnd(): void {
    const e = this.e()
    let lineIdx = e.state.cursorLine
    let col = e.state.cursorCol

    while (lineIdx < e.state.lines.length) {
      const line = e.state.lines[lineIdx] ?? ""
      let i = lineIdx === e.state.cursorLine ? Math.min(this.nextCol(line, col), line.length) : 0

      while (i < line.length && this.charKindAt(line, i) === "space") i = this.nextCol(line, i)
      if (i < line.length) {
        const kind = this.charKindAt(line, i)
        let end = i
        while (this.nextCol(line, end) < line.length && this.charKindAt(line, this.nextCol(line, end)) === kind) {
          end = this.nextCol(line, end)
        }
        this.setCursor(lineIdx, end)
        return
      }

      lineIdx++
      col = 0
    }

    const lastLine = e.state.lines.length - 1
    this.setCursor(lastLine, (e.state.lines[lastLine] ?? "").length)
  }

  private charKind(char: string): "space" | "word" | "punct" {
    if (/\s/u.test(char)) return "space"
    if (/[\p{L}\p{N}_]/u.test(char)) return "word"
    return "punct"
  }

  private charKindAt(line: string, col: number): "space" | "word" | "punct" {
    const first = this.segments(line.slice(col))[Symbol.iterator]().next().value as Intl.SegmentData | undefined
    return this.charKind(first?.segment ?? line[col] ?? "")
  }

  private moveRightForAppend(): void {
    const e = this.e()
    const line = e.state.lines[e.state.cursorLine] ?? ""
    if (e.state.cursorCol < line.length) e.moveCursor(0, 1)
  }

  private moveFirstNonBlank(): void {
    const e = this.e()
    const line = e.state.lines[e.state.cursorLine] ?? ""
    e.setCursorCol(firstNonBlank(line))
  }

  private gotoLine(line: number): void {
    const e = this.e()
    const target = clamp(line, 0, Math.max(0, e.state.lines.length - 1))
    this.setCursor(target, firstNonBlank(e.state.lines[target] ?? ""))
  }

  private currentPos(): Pos {
    const e = this.e()
    return { line: e.state.cursorLine, col: e.state.cursorCol }
  }

  private setCursor(line: number, col: number): void {
    const lines = this.getEditorLines()
    const cursorLine = clamp(line, 0, Math.max(0, lines.length - 1))
    this.setEditorCursor({ line: cursorLine, col: clamp(col, 0, (lines[cursorLine] ?? "").length) })
  }

  private posToOffset(pos: Pos): number {
    const lines = this.e().state.lines
    let offset = 0
    for (let i = 0; i < pos.line; i++) offset += (lines[i] ?? "").length + 1
    return offset + pos.col
  }

  private offsetToPos(lines: string[], offset: number): Pos {
    let rest = offset
    for (let i = 0; i < lines.length; i++) {
      const len = (lines[i] ?? "").length
      if (rest <= len) return { line: i, col: rest }
      rest -= len + 1
    }
    const last = Math.max(0, lines.length - 1)
    return { line: last, col: (lines[last] ?? "").length }
  }

  private nextOffset(offset: number): number {
    const text = this.e().state.lines.join("\n")
    if (offset >= text.length) return offset
    const first = this.segments(text.slice(offset))[Symbol.iterator]().next().value as Intl.SegmentData | undefined
    return offset + (first?.segment.length ?? 1)
  }

  private nextCol(line: string, col: number): number {
    if (col >= line.length) return col
    const pasteMarker = this.pasteMarkerAt(line, col)
    if (pasteMarker) return pasteMarker.end
    const first = this.segments(line.slice(col))[Symbol.iterator]().next().value as Intl.SegmentData | undefined
    return col + (first?.segment.length ?? 1)
  }

  private prevCol(line: string, col: number): number {
    if (col <= 0) return 0
    const pasteMarker = this.pasteMarkerAt(line, col - 1)
    if (pasteMarker) return pasteMarker.start
    let previous = 0
    for (const segment of this.segments(line)) {
      if (segment.index >= col) break
      previous = segment.index
    }
    return previous
  }

  private pasteMarkerAt(line: string, col: number): { start: number; end: number } | undefined {
    for (const match of line.matchAll(PASTE_MARKER_PATTERN)) {
      const start = match.index
      const end = start + match[0].length
      if (col >= start && col < end) return { start, end }
    }
    return undefined
  }

  private segments(text: string): Iterable<Intl.SegmentData> {
    return this.e().segment?.(text) ?? graphemes.segment(text)
  }

  private snapshot(): Snapshot {
    const e = this.e()
    return { text: e.getText(), cursor: { line: e.state.cursorLine, col: e.state.cursorCol } }
  }

  private recordChange(before: Snapshot, data: string): void {
    if (this.historyCommandThisInput) {
      this.historyCommandThisInput = false
      return
    }

    const after = this.snapshot()
    if (after.text === before.text) return

    // Submitting intentionally clears the editor; don't make the just-submitted
    // prompt reappear when the user hits vim undo on the next turn.
    if (after.text === "" && matchesKey(data, "enter")) {
      this.clearVimHistory()
      return
    }

    this.pushUndo(before)
  }

  private recordInsertChange(before: Snapshot, data: string): void {
    const after = this.snapshot()
    if (after.text === before.text) return

    if (after.text === "" && matchesKey(data, "enter")) {
      this.clearVimHistory()
      this.insertSessionStart = undefined
      return
    }

    this.insertSessionStart ??= before
  }

  private finalizeInsertSession(): void {
    if (!this.insertSessionStart) return
    const start = this.insertSessionStart
    this.insertSessionStart = undefined
    if (this.snapshot().text !== start.text) this.pushUndo(start)
  }

  private pushUndo(snapshot: Snapshot): void {
    this.vimUndoStack.push(snapshot)
    if (this.vimUndoStack.length > MAX_HISTORY) this.vimUndoStack.shift()
    this.vimRedoStack = []
  }

  private clearVimHistory(): void {
    this.vimUndoStack = []
    this.vimRedoStack = []
  }

  private performUndo(count: number): void {
    this.insertSessionStart = undefined
    const times = clamp(count, 1, MAX_COUNT)
    for (let i = 0; i < times; i++) {
      const previous = this.vimUndoStack.pop()
      if (!previous) break
      this.vimRedoStack.push(this.snapshot())
      if (this.vimRedoStack.length > MAX_HISTORY) this.vimRedoStack.shift()
      this.restoreSnapshot(previous)
    }
    this.historyCommandThisInput = true
    this.requestRender()
  }

  private performRedo(count: number): void {
    this.insertSessionStart = undefined
    const times = clamp(count, 1, MAX_COUNT)
    for (let i = 0; i < times; i++) {
      const next = this.vimRedoStack.pop()
      if (!next) break
      this.vimUndoStack.push(this.snapshot())
      if (this.vimUndoStack.length > MAX_HISTORY) this.vimUndoStack.shift()
      this.restoreSnapshot(next)
    }
    this.historyCommandThisInput = true
    this.requestRender()
  }

  private restoreSnapshot(snapshot: Snapshot): void {
    const e = this.e()
    e.cancelAutocomplete()
    e.historyIndex = -1
    e.lastAction = null
    this.replaceEditorLines(snapshot.text.length > 0 ? snapshot.text.split("\n") : [""], snapshot.cursor)
    this.notifyChange()
  }

  private notifyChange(): void {
    this.onChange?.(this.getText())
  }

  private enterNormalMode(): void {
    const e = this.e()
    if (e.getText().length > 0) {
      const line = e.state.lines[e.state.cursorLine] ?? ""
      if (e.state.cursorCol > 0 && e.state.cursorCol >= line.length) {
        e.setCursorCol(this.prevCol(line, e.state.cursorCol))
      }
    }
    this.mode = "normal"
    this.visualAnchor = undefined
    this.visualScrollOffset = undefined
    this.resetPending()
    this.requestRender()
  }

  private enterInsertMode(): void {
    this.mode = "insert"
    this.visualAnchor = undefined
    this.visualScrollOffset = undefined
    this.resetPending()
    this.requestRender()
  }

  private enterVisualMode(mode: "visual" | "visualLine"): void {
    this.mode = mode
    this.visualAnchor = this.currentPos()
    this.visualScrollOffset = undefined
    this.resetPending()
    this.requestRender()
  }

  private isVisualMode(): boolean {
    return this.mode === "visual" || this.mode === "visualLine"
  }

  private consumeCount(): CountInfo {
    const explicit = this.countText.length > 0
    const count = parseCount(this.countText)
    this.countText = ""
    return { count, explicit }
  }

  private resetPending(): void {
    this.countText = ""
    this.pendingGoto = undefined
    this.pendingOperator = undefined
    this.pendingReplaceCount = 0
    this.pendingRegisterQuote = false
    this.selectedRegister = undefined
  }

  private hasPendingInput(): boolean {
    return Boolean(this.countText || this.pendingGoto || this.pendingOperator || this.pendingReplaceCount || this.pendingRegisterQuote || this.selectedRegister)
  }

  private statusLabel(): string {
    if (this.mode === "insert") return "INSERT"
    const pieces = [this.mode === "visual" ? "VISUAL" : this.mode === "visualLine" ? "V-LINE" : "NORMAL"]
    if (this.pendingRegisterQuote) pieces.push('"')
    else if (this.selectedRegister) pieces.push(`"${this.selectedRegister}`)
    if (this.countText) pieces.push(this.countText)
    if (this.pendingGoto) pieces.push(`${this.pendingGoto.explicit ? this.pendingGoto.count : ""}g`)
    if (this.pendingOperator) {
      const op = this.pendingOperator.prefix ? `${this.pendingOperator.op}g` : this.pendingOperator.op
      const register = this.pendingOperator.registerName ? `"${this.pendingOperator.registerName}` : ""
      pieces.push(`${register}${this.pendingOperator.count > 1 ? this.pendingOperator.count : ""}${op}${this.pendingOperator.countText}`)
    }
    if (this.pendingReplaceCount) pieces.push(`${this.pendingReplaceCount > 1 ? this.pendingReplaceCount : ""}r`)
    return pieces.join(" ")
  }

  private requestRender(): void {
    this.clampNormalCursor()
    this.vimTui.requestRender()
  }

  private getPaddingXCompat(): number {
    return this.asEditorCompat().getPaddingX?.() ?? 2
  }

  private wouldRunAppAction(data: string): boolean {
    for (const action of this.asEditorCompat().actionHandlers?.keys() ?? []) {
      if (this.keybindingsManager.matches(data, action)) return true
    }
    return false
  }

  private asEditorCompat(): EditorCompat {
    return this as object as EditorCompat
  }

  private directEditorInternals(): EditorInternals | undefined {
    const editor = this.asEditorCompat()
    return editor.state && editor.setCursorCol && editor.moveCursor && editor.cancelAutocomplete && editor.insertTextAtCursorInternal
      ? (editor as object as EditorInternals)
      : undefined
  }

  private getEditorLines(): string[] {
    const direct = this.directEditorInternals()
    if (direct) return direct.state.lines
    const editor = this.asEditorCompat()
    return editor.getLines?.() ?? this.getText().split("\n")
  }

  private getEditorCursor(): Pos {
    const direct = this.directEditorInternals()
    if (direct) return { line: direct.state.cursorLine, col: direct.state.cursorCol }
    const editor = this.asEditorCompat()
    return editor.getCursor?.() ?? { line: 0, col: 0 }
  }

  private replaceEditorLines(lines: string[], cursor: Pos): void {
    const direct = this.directEditorInternals()
    if (direct) {
      direct.state.lines = lines
      this.setCursor(cursor.line, cursor.col)
      return
    }

    super.setText(lines.join("\n"))
    this.setEditorCursor(cursor)
  }

  private setEditorCursor(cursor: Pos): void {
    const direct = this.directEditorInternals()
    if (direct) {
      direct.state.cursorLine = clamp(cursor.line, 0, Math.max(0, direct.state.lines.length - 1))
      const currentLine = direct.state.lines[direct.state.cursorLine] ?? ""
      direct.setCursorCol(clamp(cursor.col, 0, currentLine.length))
      return
    }

    const lines = this.getEditorLines()
    const line = clamp(cursor.line, 0, Math.max(0, lines.length - 1))
    const col = clamp(cursor.col, 0, (lines[line] ?? "").length)
    const publicEditor = this.asEditorCompat()
    publicEditor.moveToMessageStart?.()
    this.moveToLineStartCompat()
    for (let i = 0; i < line; i++) super.handleInput(KEY_DOWN)
    this.moveToLineStartCompat()
    for (let i = 0; i < col; i++) super.handleInput(KEY_RIGHT)
  }

  private movePublicCursor(deltaLine: number, deltaCol: number): void {
    const verticalKey = deltaLine < 0 ? KEY_UP : KEY_DOWN
    for (let i = 0; i < Math.abs(deltaLine); i++) super.handleInput(verticalKey)
    const horizontalKey = deltaCol < 0 ? KEY_LEFT : KEY_RIGHT
    for (let i = 0; i < Math.abs(deltaCol); i++) super.handleInput(horizontalKey)
  }

  private moveToLineStartCompat(): void {
    this.asEditorCompat().moveToLineStart?.()
  }

  private moveToLineEndCompat(): void {
    this.asEditorCompat().moveToLineEnd?.()
  }

  private cancelAutocompleteCompat(): void {
    const direct = this.directEditorInternals()
    if (direct) {
      direct.cancelAutocomplete()
      return
    }
    super.handleInput("\x1b")
  }

  private insertTextCompat(text: string): void {
    const direct = this.directEditorInternals()
    if (direct) {
      direct.insertTextAtCursorInternal(text)
      return
    }
    this.asEditorCompat().insertText?.(text)
  }

  private e(): EditorInternals {
    const direct = this.directEditorInternals()
    if (direct) return direct

    return {
      state: {
        lines: this.getEditorLines(),
        cursorLine: this.getEditorCursor().line,
        cursorCol: this.getEditorCursor().col,
      },
      setCursorCol: (col) => this.setCursor(this.getEditorCursor().line, col),
      moveCursor: (deltaLine, deltaCol) => this.movePublicCursor(deltaLine, deltaCol),
      moveToLineStart: () => this.moveToLineStartCompat(),
      moveToLineEnd: () => this.moveToLineEndCompat(),
      cancelAutocomplete: () => this.cancelAutocompleteCompat(),
      insertTextAtCursorInternal: (text) => this.insertTextCompat(text),
      getText: () => this.getText(),
    }
  }
}

function installVimLite(ctx: ExtensionContext): void {
  if (!ctx.hasUI) return
  ctx.ui.setEditorComponent((tui, theme, keybindings) => new VimLiteEditor(tui, theme, keybindings))
}

export default function registerVimLite(pi: ExtensionAPI): void {
  let enabled = true

  pi.on("session_start", (_event, ctx) => {
    if (enabled) installVimLite(ctx)
  })

  pi.registerCommand("vim-lite", {
    description: "Toggle or show help for the vim-lite input editor",
    handler: async (args, ctx) => {
      const action = args.trim().toLowerCase()
      if (action === "off" || action === "disable") {
        enabled = false
        ctx.ui.setEditorComponent(undefined)
        ctx.ui.setWidget("vim-lite-help", undefined)
        ctx.ui.notify("vim-lite disabled", "info")
        return
      }

      if (action === "help" || action === "?") {
        ctx.ui.setWidget("vim-lite-help", HELP_LINES, { placement: "belowEditor" })
        ctx.ui.notify("vim-lite help shown below the editor; /vim-lite hide to hide it", "info")
        return
      }

      if (action === "hide") {
        ctx.ui.setWidget("vim-lite-help", undefined)
        return
      }

      enabled = true
      installVimLite(ctx)
      ctx.ui.notify("vim-lite enabled", "info")
    },
  })
}
