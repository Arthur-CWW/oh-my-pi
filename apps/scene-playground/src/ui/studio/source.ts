// ---------------------------------------------------------------------------
// Source editor — CodeMirror JSON editor, Editor/Source tab toggle, dirty dot
// State is a single object (no split closure / returned-object bug).
// ---------------------------------------------------------------------------

import { json } from "@codemirror/lang-json";
import { oneDark } from "@codemirror/theme-one-dark";
import { EditorView, basicSetup } from "codemirror";

export interface SourceState {
  editor: EditorView;
  dirty: boolean;
  mode: "editor" | "source";
}

export interface SourceCallbacks {
  onSave(): void;
  onSpecParsed(text: string): void;
}

export function createSourceEditor(
  container: HTMLElement,
  headContainer: HTMLElement,
  cbs: SourceCallbacks,
): SourceState {
  const state: SourceState = { editor: null as unknown as EditorView, dirty: false, mode: "editor" };

  // -- Head bar --
  headContainer.textContent = "";

  const specLabel = document.createElement("span");
  specLabel.className = "source-spec-label";
  specLabel.textContent = "no spec selected";

  const dirtyDot = document.createElement("span");
  dirtyDot.className = "dirty-dot hidden";

  const editorTab = document.createElement("button");
  editorTab.className = "tab-btn active";
  editorTab.textContent = "Editor";

  const sourceTab = document.createElement("button");
  sourceTab.className = "tab-btn";
  sourceTab.textContent = "Source";

  const saveBtn = document.createElement("button");
  saveBtn.className = "save-btn";
  saveBtn.textContent = "Save";
  saveBtn.addEventListener("click", cbs.onSave);

  headContainer.append(specLabel, dirtyDot, editorTab, sourceTab, saveBtn);

  // -- Editor pane (CodeMirror) --
  const editorPane = document.createElement("div");
  editorPane.className = "editor";

  // -- Source pane (read-only pre) --
  const sourcePane = document.createElement("pre");
  sourcePane.className = "source-view hidden";

  container.textContent = "";
  container.append(editorPane, sourcePane);

  // Create CodeMirror
  state.editor = new EditorView({
    parent: editorPane,
    doc: "",
    extensions: [basicSetup, json(), oneDark, EditorView.lineWrapping],
  });

  // Mark dirty on edit
  state.editor.contentDOM.addEventListener("input", () => {
    state.dirty = true;
    dirtyDot.classList.remove("hidden");
  });

  // -- Tab switching --
  editorTab.addEventListener("click", () => {
    if (state.mode === "editor") return;
    state.mode = "editor";
    editorPane.classList.remove("hidden");
    sourcePane.classList.add("hidden");
    editorTab.classList.add("active");
    sourceTab.classList.remove("active");
    // Sync source text back into CodeMirror
    const text = sourcePane.textContent ?? "";
    setDoc(state.editor, text);
    cbs.onSpecParsed(text);
    state.editor.requestMeasure();
  });

  sourceTab.addEventListener("click", () => {
    if (state.mode === "source") return;
    state.mode = "source";
    editorPane.classList.add("hidden");
    sourcePane.classList.remove("hidden");
    editorTab.classList.remove("active");
    sourceTab.classList.add("active");
    // Snapshot editor content into source pane
    sourcePane.textContent = state.editor.state.doc.toString();
  });

  return state;

  // State is the single source of truth for dirty/mode.
  // Main.ts reads state.dirty and calls markClean/setSpecLabel as needed.
}

// ---------------------------------------------------------------------------
// Helpers called by main.ts
// ---------------------------------------------------------------------------

export function setDoc(editor: EditorView, text: string): void {
  editor.dispatch({ changes: { from: 0, to: editor.state.doc.length, insert: text } });
}

export function getDoc(editor: EditorView): string {
  return editor.state.doc.toString();
}

export function setSpecLabel(headContainer: HTMLElement, path: string): void {
  const label = headContainer.querySelector<HTMLSpanElement>(".source-spec-label");
  if (label !== null) label.textContent = path || "no spec selected";
}

export function setDirtyDot(headContainer: HTMLElement, dirty: boolean): void {
  const dot = headContainer.querySelector<HTMLSpanElement>(".dirty-dot");
  if (dot !== null) dot.classList.toggle("hidden", !dirty);
}
