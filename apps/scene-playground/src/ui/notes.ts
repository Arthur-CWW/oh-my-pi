// ---------------------------------------------------------------------------
// Reference-note panel — shared inline editor for GALLERY + LABEL
//
// A single fixed overlay (created once, reused) holds an auto-growing textarea
// for free-text reference notes (dictated via VoiceInk → pasted as text, so
// bodies can be paragraphs). One note per item, keyed by:
//   • corpus items  → media_path (e.g. "t1-1.mp4")
//   • gallery items → artifact repo-relative path (e.g. "renders/x/scene.mp4")
//
// Save semantics (documented for Arthur):
//   • ⌘/Ctrl+Enter  → server-confirmed save, then close
//   • blur          → server-confirmed save (clicking the backdrop blurs, so a
//                     click-away saves too)
//   • Esc           → close WITHOUT saving, but the unsaved draft is kept in a
//                     module cache keyed by item, so re-opening restores it —
//                     an accidental Esc never loses dictation.
//
// Persistence discipline: a save is only "done" once the server confirms it.
// Success flashes green in the caller's status strip; failure flashes red in
// the panel, keeps the panel open with the draft intact, and reports via
// reportClientError. Silent loss is the app's original sin — never reintroduced.
// ---------------------------------------------------------------------------

import { reportClientError } from "./error-report";

export interface NotePanelContext {
  /** Stable storage key: media_path (corpus) or artifact rel-path (gallery). */
  itemKey: string;
  /** Human title shown in the panel header. */
  title: string;
  /** Note body the caller already knows (from its notes map), or "". */
  initialBody: string;
  /** Called after a server-confirmed save with the persisted body ("" = cleared). */
  onSaved: (itemKey: string, body: string) => void;
}

let overlayEl: HTMLElement | null = null;
let titleEl: HTMLElement;
let textareaEl: HTMLTextAreaElement;
let statusEl: HTMLElement;

let open = false;
let exiting = false;
let ctx: NotePanelContext | null = null;

/** Unsaved drafts survive an Esc-cancel so accidental dismissals never lose dictation. */
const draftCache = new Map<string, string>();

export function isNotePanelOpen(): boolean {
  return open;
}

function ensurePanel(): void {
  if (overlayEl !== null) return;
  const overlay = document.createElement("div");
  overlay.className = "note-overlay hidden";
  overlay.innerHTML = `
    <div class="note-backdrop"></div>
    <div class="note-card" role="dialog" aria-label="Reference note" aria-modal="true">
      <div class="note-head">
        <span class="note-eyebrow">reference note</span>
        <span class="note-title"></span>
      </div>
      <textarea class="note-textarea" spellcheck="true"
        placeholder="Dictate the cultural references\u2026 (e.g. gigachad Sonic, Aschenbrenner orange, pernicious penguin)"></textarea>
      <div class="note-foot">
        <span class="note-hint"><kbd>\u2318/Ctrl+Enter</kbd> save <span class="hint-sep">\u00b7</span> <kbd>Esc</kbd> keep draft &amp; close <span class="hint-sep">\u00b7</span> saves on blur</span>
        <span class="note-status"></span>
      </div>
    </div>`;
  document.body.appendChild(overlay);
  overlayEl = overlay;
  titleEl = overlay.querySelector<HTMLElement>(".note-title")!;
  textareaEl = overlay.querySelector<HTMLTextAreaElement>(".note-textarea")!;
  statusEl = overlay.querySelector<HTMLElement>(".note-status")!;

  // Backdrop click blurs the textarea, which routes through the blur-save path.
  overlay.querySelector<HTMLElement>(".note-backdrop")!.addEventListener("click", () => {
    if (open) textareaEl.blur();
  });

  textareaEl.addEventListener("input", autoGrow);
  textareaEl.addEventListener("blur", () => { void commit(); });
  textareaEl.addEventListener("keydown", onTextareaKeydown);
}

function onTextareaKeydown(e: KeyboardEvent): void {
  // Isolate typing from the view-level vim keymaps that listen on window.
  e.stopPropagation();
  if ((e.metaKey || e.ctrlKey) && e.key === "Enter") {
    e.preventDefault();
    void commit();
    return;
  }
  if (e.key === "Escape") {
    e.preventDefault();
    cancel();
  }
}

function autoGrow(): void {
  textareaEl.style.height = "auto";
  const max = Math.round(window.innerHeight * 0.6);
  textareaEl.style.height = `${Math.min(textareaEl.scrollHeight, max)}px`;
}

export function openNotePanel(context: NotePanelContext): void {
  ensurePanel();
  if (open) return; // one note at a time
  ctx = context;
  open = true;
  exiting = false;
  titleEl.textContent = context.title;
  const draft = draftCache.get(context.itemKey);
  textareaEl.value = draft !== undefined ? draft : context.initialBody;
  statusEl.textContent = "";
  statusEl.className = "note-status";
  overlayEl!.classList.remove("hidden");
  autoGrow();
  textareaEl.focus();
  const end = textareaEl.value.length;
  textareaEl.setSelectionRange(end, end);
}

function hide(): void {
  if (overlayEl === null) return;
  textareaEl.blur();
  overlayEl.classList.add("hidden");
  open = false;
}

async function commit(): Promise<void> {
  if (!open || exiting || ctx === null) return;
  exiting = true;
  const key = ctx.itemKey;
  const body = textareaEl.value;
  const onSaved = ctx.onSaved;
  const ok = await persist(key, body);
  if (ok) {
    draftCache.delete(key);
    hide();
    ctx = null;
    onSaved(key, body);
  } else {
    // Keep the panel + draft; re-focus so a blur-retry is possible.
    textareaEl.focus();
  }
  exiting = false;
}

function cancel(): void {
  if (!open || exiting || ctx === null) return;
  exiting = true;
  draftCache.set(ctx.itemKey, textareaEl.value);
  hide();
  ctx = null;
  exiting = false;
}

async function persist(itemKey: string, body: string): Promise<boolean> {
  statusEl.textContent = "saving\u2026";
  statusEl.className = "note-status note-saving";
  try {
    const res = await fetch("/api/notes", {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ itemKey, body }),
    });
    if (!res.ok) {
      const b = (await res.json().catch(() => ({}))) as { error?: string };
      throw new Error(b.error ?? `HTTP ${res.status}`);
    }
    return true;
  } catch (err) {
    const detail = err instanceof Error ? err.message : "network error";
    statusEl.textContent = `\u2717 save failed: ${detail}`;
    statusEl.className = "note-status note-fail";
    reportClientError(`Note persistence failure (${itemKey}): ${detail}`);
    return false;
  }
}

export function noteCss(): string {
  return `
/* === Reference-note panel (shared) === */
.note-overlay { position: fixed; inset: 0; z-index: 300; display: grid; place-items: center; }
.note-overlay.hidden { display: none; }
.note-backdrop { position: absolute; inset: 0; background: rgba(6, 7, 9, 0.72); backdrop-filter: blur(2px); }
.note-card {
  position: relative;
  z-index: 1;
  width: min(680px, 88vw);
  display: flex;
  flex-direction: column;
  gap: var(--space-3);
  background: var(--panel-bg-elevated);
  border: 1px solid var(--panel-border-strong);
  border-radius: var(--radius-md);
  box-shadow: var(--elev-raised);
  padding: var(--space-4);
}
.note-head { display: flex; align-items: baseline; gap: var(--space-2); flex-wrap: wrap; }
.note-eyebrow {
  font-size: var(--text-xs);
  text-transform: uppercase;
  letter-spacing: var(--tracking-upper);
  color: var(--accent-2);
  font-weight: 700;
}
.note-title {
  font-size: var(--text-md);
  color: var(--text-primary);
  font-weight: 600;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  max-width: 100%;
}
.note-textarea {
  width: 100%;
  min-height: 96px;
  resize: none;
  overflow-y: auto;
  background: var(--control-bg);
  border: 1px solid var(--control-border);
  border-radius: var(--radius-sm);
  color: var(--text-primary);
  font-family: var(--font-mono);
  font-size: var(--text-md);
  line-height: var(--leading-body);
  padding: var(--space-2) var(--space-3);
}
.note-textarea:focus { outline: none; box-shadow: var(--focus-ring); border-color: var(--accent); }
.note-textarea::placeholder { color: var(--text-dim); }
.note-foot { display: flex; align-items: center; justify-content: space-between; gap: var(--space-3); min-height: 16px; }
.note-hint { font-family: var(--font-mono); font-size: var(--text-xs); color: var(--text-muted); }
.note-hint kbd {
  padding: 0 4px;
  border-radius: var(--radius-xs);
  background: var(--panel-bg-active);
  border: 1px solid var(--panel-border);
  color: var(--text-secondary);
}
.note-status { font-family: var(--font-mono); font-size: var(--text-xs); white-space: nowrap; }
.note-status.note-saving { color: var(--text-muted); }
.note-status.note-fail { color: var(--error); font-weight: 600; }
`;
}
