import * as Popover from "@radix-ui/react-popover"
import * as Select from "@radix-ui/react-select"
import { Command } from "cmdk"
import { useCallback, useEffect, useId, useMemo, useRef, useState, type KeyboardEvent, type ReactElement } from "react"

export interface ReaderSortOption {
  readonly value: string
  readonly label: string
}

export interface ReaderControlsIslandProps {
  readonly command: string
  readonly sortMode: string
  readonly sortOptions: readonly ReaderSortOption[]
  readonly suggestions: readonly string[]
  readonly usernameSuggestionCount: number
  readonly builderControlsSql: boolean
  readonly tokenChips: readonly string[]
  readonly sortLabel: string
  readonly onCommandChange: (command: string) => void
  readonly onSortModeChange: (sortMode: string) => void
}

interface ActiveToken {
  readonly start: number
  readonly end: number
  readonly text: string
}

const MAX_VISIBLE_SUGGESTIONS = 10

export function ReaderControlsIsland({
  command,
  sortMode,
  sortOptions,
  suggestions,
  usernameSuggestionCount,
  builderControlsSql,
  tokenChips,
  sortLabel,
  onCommandChange,
  onSortModeChange,
}: ReaderControlsIslandProps): ReactElement {
  const inputRef = useRef<HTMLInputElement | null>(null)
  const [cursorIndex, setCursorIndex] = useState(command.length)
  const [inputFocused, setInputFocused] = useState(false)
  const [open, setOpen] = useState(false)
  const [dismissedTokenKey, setDismissedTokenKey] = useState<string | undefined>()
  const [activeSuggestion, setActiveSuggestion] = useState("")
  const commandLabelId = useId()
  const sortLabelId = useId()

  const activeToken = useMemo(() => tokenAtCursor(command, cursorIndex), [command, cursorIndex])
  const activeTokenKey = `${activeToken.start}:${activeToken.end}:${activeToken.text}`
  const visibleSuggestions = useMemo(
    () => suggestionsForToken(activeToken.text, suggestions),
    [activeToken.text, suggestions],
  )
  const hasExactSuggestion = visibleSuggestions.some((suggestion) => suggestion.toLocaleLowerCase() === activeToken.text.toLocaleLowerCase())
  const canOpen = inputFocused && activeToken.text.length > 0 && visibleSuggestions.length > 0 && !hasExactSuggestion

  useEffect(() => {
    setCursorIndex((current) => Math.min(current, command.length))
  }, [command.length])

  useEffect(() => {
    if (!visibleSuggestions.includes(activeSuggestion)) {
      setActiveSuggestion(visibleSuggestions[0] ?? "")
    }
  }, [activeSuggestion, visibleSuggestions])

  useEffect(() => {
    if (canOpen && dismissedTokenKey !== activeTokenKey) {
      setOpen(true)
      return
    }
    setOpen(false)
  }, [activeTokenKey, canOpen, dismissedTokenKey])

  const updateCursorFromInput = useCallback(() => {
    const selectionStart = inputRef.current?.selectionStart
    if (typeof selectionStart === "number") {
      setCursorIndex(selectionStart)
    }
  }, [])

  const completeSuggestion = useCallback((suggestion: string) => {
    if (!suggestion) return

    const suffix = command.slice(activeToken.end)
    const spacer = suffix.length === 0 ? " " : ""
    const nextCommand = `${command.slice(0, activeToken.start)}${suggestion}${spacer}${suffix}`
    const nextCursorIndex = activeToken.start + suggestion.length + spacer.length

    onCommandChange(nextCommand)
    setCursorIndex(nextCursorIndex)
    setDismissedTokenKey(`${activeToken.start}:${activeToken.start + suggestion.length}:${suggestion}`)
    setOpen(false)
    window.requestAnimationFrame(() => {
      inputRef.current?.setSelectionRange(nextCursorIndex, nextCursorIndex)
      inputRef.current?.focus()
    })
  }, [activeToken.end, activeToken.start, command, onCommandChange])

  const handleCommandChange = useCallback((value: string) => {
    onCommandChange(value)
    setDismissedTokenKey(undefined)
    window.requestAnimationFrame(updateCursorFromInput)
  }, [onCommandChange, updateCursorFromInput])

  const handleKeyDown = useCallback((event: KeyboardEvent<HTMLInputElement>) => {
    if (event.nativeEvent.isComposing) return

    const selectedSuggestion = visibleSuggestions.includes(activeSuggestion) ? activeSuggestion : visibleSuggestions[0] ?? ""
    const menuActive = (open || canOpen) && visibleSuggestions.length > 0

    if (event.key === "Escape" && menuActive) {
      event.preventDefault()
      event.stopPropagation()
      setDismissedTokenKey(activeTokenKey)
      setOpen(false)
      return
    }

    if ((event.key === "ArrowDown" || event.key === "ArrowUp") && menuActive) {
      event.preventDefault()
      const currentIndex = visibleSuggestions.indexOf(selectedSuggestion)
      const fallbackIndex = currentIndex >= 0 ? currentIndex : 0
      const nextIndex = event.key === "ArrowDown"
        ? (fallbackIndex + 1) % visibleSuggestions.length
        : (fallbackIndex - 1 + visibleSuggestions.length) % visibleSuggestions.length
      setActiveSuggestion(visibleSuggestions[nextIndex] ?? visibleSuggestions[0] ?? "")
      setOpen(true)
      return
    }

    if ((event.key === "Enter" || event.key === "Tab") && menuActive && selectedSuggestion) {
      event.preventDefault()
      event.stopPropagation()
      completeSuggestion(selectedSuggestion)
    }
  }, [activeSuggestion, activeTokenKey, canOpen, completeSuggestion, open, visibleSuggestions])

  const handleOpenChange = useCallback((nextOpen: boolean) => {
    if (!nextOpen) {
      setDismissedTokenKey(activeTokenKey)
      setOpen(false)
      return
    }
    if (canOpen) setOpen(true)
  }, [activeTokenKey, canOpen])

  const helperText = usernameSuggestionCount > 0
    ? `${usernameSuggestionCount} usernames available from the local SQLite archive. Try filter:long, has:media, has:quote, or min_likes:100. Editing SQL switches to manual mode.`
    : "Username suggestions load from the local SQLite archive. Try filter:long, has:media, has:quote, or min_likes:100. Editing SQL switches to manual mode."

  return (
    <div className="reader-builder" data-builder-mode={builderControlsSql ? "builder" : "manual"}>
      <div className="reader-field reader-command-field">
        <span id={commandLabelId}>Filter builder</span>
        <Command
          className="reader-command-shell"
          shouldFilter={false}
          loop
          value={activeSuggestion}
          onValueChange={setActiveSuggestion}
        >
          <Popover.Root open={open} onOpenChange={handleOpenChange}>
            <Popover.Anchor asChild>
              <Command.Input
                ref={inputRef}
                aria-labelledby={commandLabelId}
                className="reader-command-input"
                value={command}
                placeholder="from:voooooogel filter:long"
                autoComplete="off"
                spellCheck={false}
                onValueChange={handleCommandChange}
                onFocus={() => {
                  setInputFocused(true)
                  setDismissedTokenKey(undefined)
                  updateCursorFromInput()
                }}
                onBlur={() => {
                  window.setTimeout(() => {
                    if (document.activeElement !== inputRef.current) {
                      setInputFocused(false)
                    }
                  }, 0)
                }}
                onClick={updateCursorFromInput}
                onKeyUp={updateCursorFromInput}
                onSelect={updateCursorFromInput}
                onKeyDown={handleKeyDown}
              />
            </Popover.Anchor>
            <Popover.Portal>
              <Popover.Content
                className="reader-command-popover"
                align="start"
                sideOffset={6}
                collisionPadding={12}
                onOpenAutoFocus={(event) => event.preventDefault()}
              >
                <Command.List className="reader-command-list" aria-label="Reader filter suggestions">
                  {visibleSuggestions.map((suggestion) => (
                    <Command.Item
                      key={suggestion}
                      className="reader-command-item"
                      value={suggestion}
                      onSelect={completeSuggestion}
                    >
                      <span className="reader-command-item-value">{suggestion}</span>
                      <span className="reader-command-item-hint">{suggestionHint(suggestion)}</span>
                    </Command.Item>
                  ))}
                </Command.List>
              </Popover.Content>
            </Popover.Portal>
          </Popover.Root>
        </Command>
      </div>

      <div className="reader-field reader-sort-field">
        <span id={sortLabelId}>Sort</span>
        <Select.Root value={sortMode} onValueChange={onSortModeChange}>
          <Select.Trigger className="reader-sort-trigger" aria-labelledby={sortLabelId}>
            <Select.Value />
          </Select.Trigger>
          <Select.Portal>
            <Select.Content className="reader-select-content" position="popper" sideOffset={6} collisionPadding={12}>
              <Select.Viewport className="reader-select-viewport">
                {sortOptions.map((option) => (
                  <Select.Item key={option.value} className="reader-select-item" value={option.value}>
                    <Select.ItemText>{option.label}</Select.ItemText>
                  </Select.Item>
                ))}
              </Select.Viewport>
            </Select.Content>
          </Select.Portal>
        </Select.Root>
      </div>

      <div className="reader-builder-helper">{helperText}</div>
      <div className="reader-token-chips" aria-label="Active Reader tokens">
        {builderControlsSql ? (
          tokenChips.length > 0 ? (
            <>
              {tokenChips.map((token) => <span key={token} className="reader-token-chip">{token}</span>)}
              <span className="reader-token-chip reader-token-muted">sort:{sortLabel}</span>
            </>
          ) : (
            <>
              <span className="reader-token-chip reader-token-muted">No filters</span>
              <span className="reader-token-chip reader-token-muted">sort:{sortLabel}</span>
            </>
          )
        ) : (
          <span className="reader-token-chip reader-token-muted">Manual SQL</span>
        )}
      </div>
    </div>
  )
}

function tokenAtCursor(command: string, cursorIndex: number): ActiveToken {
  const safeCursorIndex = Math.max(0, Math.min(cursorIndex, command.length))
  let start = safeCursorIndex
  let end = safeCursorIndex

  while (start > 0 && !isWhitespace(command[start - 1])) {
    start -= 1
  }
  while (end < command.length && !isWhitespace(command[end])) {
    end += 1
  }

  return { start, end, text: command.slice(start, end) }
}

function suggestionsForToken(token: string, suggestions: readonly string[]): readonly string[] {
  const normalizedToken = token.toLocaleLowerCase()
  if (!normalizedToken) return []

  const matches: string[] = []
  const seen = new Set<string>()
  for (const suggestion of suggestions) {
    const normalizedSuggestion = suggestion.toLocaleLowerCase()
    if (normalizedSuggestion.startsWith(normalizedToken) && !seen.has(normalizedSuggestion)) {
      matches.push(suggestion)
      seen.add(normalizedSuggestion)
      if (matches.length >= MAX_VISIBLE_SUGGESTIONS) break
    }
  }
  return matches
}

function suggestionHint(suggestion: string): string {
  if (suggestion.startsWith("from:")) return "author"
  if (suggestion.startsWith("filter:")) return "filter"
  if (suggestion.startsWith("has:")) return "content"
  if (suggestion.startsWith("min_likes:")) return "threshold"
  return "token"
}

function isWhitespace(value: string | undefined): boolean {
  return value === undefined || /\s/.test(value)
}
