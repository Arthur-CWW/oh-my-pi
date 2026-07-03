// ---------------------------------------------------------------------------
// Scene tree — hierarchical list (left panel)
// ---------------------------------------------------------------------------

import {
  type AssetEntry,
  type SceneSpec,
  type Selection,
  type SpecEntry,
  addObject,
  addOrEnsureAsset,
  addPass,
  escapeHtml,
  movePass,
  removeObject,
  removePass,
  selectionKey,
  stemFromPath,
} from "./state";

export interface TreeCallbacks {
  onSelect(sel: Selection): void;
  onMutate(): void;
  onLoadSpec(path: string): void;
}

export function renderTree(
  container: HTMLElement,
  spec: SceneSpec | null,
  selection: Selection,
  specs: SpecEntry[],
  selectedSpecPath: string,
  filesystemAssets: AssetEntry[],
  cbs: TreeCallbacks,
): void {
  container.textContent = "";
  if (spec === null) {
    container.textContent = "no spec loaded";
    return;
  }

  const root = el("div", "scene-tree");

  // -- Spec selector --
  const specSel = el("div", "tree-spec-selector");
  const specSelect = document.createElement("select");
  specSelect.className = "tree-spec-dropdown";
  for (const s of specs) {
    const opt = document.createElement("option");
    opt.value = s.path;
    opt.textContent = s.path.split("/").pop() ?? s.path;
    opt.selected = s.path === selectedSpecPath;
    specSelect.append(opt);
  }
  specSelect.addEventListener("change", () => cbs.onLoadSpec(specSelect.value));
  specSel.append(specSelect);
  root.append(specSel);

  // -- Camera --
  root.append(treeRow("\u{1F3A5} Camera", { type: "camera" }, selection, cbs));

  // -- Timeline --
  root.append(treeRow("\u23F1 Timeline", { type: "timeline" }, selection, cbs));

  // -- Audio --
  if (spec.audio !== undefined) {
    root.append(treeRow("\u{1F50A} Audio", { type: "audio" }, selection, cbs));
  }

  // -- Objects --
  const objHeader = sectionHeader("Objects", () => showAddMenu(root, spec, cbs));
  root.append(objHeader);
  for (const obj of spec.objects ?? []) {
    const sel: Selection = { type: "object", id: obj.id };
    const kindIcon = obj.kind === "plane" ? "\u25A3" : obj.kind === "sprite" ? "\u{1F5BC}" : obj.kind === "text" ? "\u{1F4DD}" : "\u{1F4C1}";
    const cloneBadge = obj.clone !== undefined && obj.clone.count > 1
      ? `<span class="clone-badge">\u00D7${obj.clone.count}</span>` : "";
    const row = el("div", `tree-row${matches(selection, sel) ? " active" : ""}`);
    row.innerHTML = `${kindIcon} <span class="tree-row-label">${escapeHtml(obj.id)}</span>${cloneBadge}`;
    row.addEventListener("click", () => cbs.onSelect(sel));
    row.tabIndex = 0;

    const del = el("button", "tree-delete");
    del.textContent = "\u00D7";
    del.title = "Delete object";
    del.addEventListener("click", (e) => {
      e.stopPropagation();
      removeObject(spec, obj.id);
      cbs.onMutate();
    });
    row.append(del);
    root.append(row);
  }

  // -- Post --
  const postHeader = sectionHeader("Post", () => showPassMenu(root, spec, cbs));
  root.append(postHeader);
  const posts = spec.post ?? [];
  for (let i = 0; i < posts.length; i += 1) {
    const pass = posts[i]!;
    const sel: Selection = { type: "pass", index: i };
    const row = el("div", `tree-row${matches(selection, sel) ? " active" : ""}`);
    row.innerHTML = `\u{1F3A8} <span class="tree-row-label">${escapeHtml(pass.pass)}</span>`;
    row.addEventListener("click", () => cbs.onSelect(sel));
    row.tabIndex = 0;

    const btns = el("span", "tree-row-btns");
    if (i > 0) {
      const up = el("button", "tree-mini-btn");
      up.textContent = "\u25B2";
      up.title = "Move up";
      up.addEventListener("click", (e) => { e.stopPropagation(); movePass(spec, i, i - 1); cbs.onMutate(); });
      btns.append(up);
    }
    if (i < posts.length - 1) {
      const down = el("button", "tree-mini-btn");
      down.textContent = "\u25BC";
      down.title = "Move down";
      down.addEventListener("click", (e) => { e.stopPropagation(); movePass(spec, i, i + 1); cbs.onMutate(); });
      btns.append(down);
    }
    const del = el("button", "tree-delete");
    del.textContent = "\u00D7";
    del.addEventListener("click", (e) => { e.stopPropagation(); removePass(spec, i); cbs.onMutate(); });
    btns.append(del);
    row.append(btns);
    root.append(row);
  }

  // -- Assets (filesystem, collapsible) --
  const assetsHeader = sectionHeader("Assets", null);
  let assetsOpen = true;
  assetsHeader.addEventListener("click", () => {
    assetsOpen = !assetsOpen;
    assetsBody.style.display = assetsOpen ? "" : "none";
    const toggle = assetsHeader.querySelector(".tree-toggle");
    if (toggle !== null) toggle.textContent = assetsOpen ? "\u25BE" : "\u25B8";
  });
  root.append(assetsHeader);

  const assetsBody = el("div", "tree-children");
  for (const asset of filesystemAssets) {
    const assetId = stemFromPath(asset.path);
    const sel: Selection = { type: "asset", id: assetId };
    const kindIcon = asset.kind === "audio" ? "\u{1F50A}" : "\u{1F5BC}";
    const row = el("div", `tree-row${matches(selection, sel) ? " active" : ""}`);
    row.innerHTML = `${kindIcon} <span class="tree-row-label">${escapeHtml(assetId)}</span><span class="tree-row-kind">${escapeHtml(asset.kind)}</span>`;
    row.title = asset.path;
    row.tabIndex = 0;
    row.addEventListener("click", () => cbs.onSelect(sel));
    row.addEventListener("dblclick", () => {
      // Insert as new plane object
      addOrEnsureAsset(spec, assetId, asset.kind, asset.path);
      addObject(spec, "plane", assetId);
      cbs.onMutate();
    });
    assetsBody.append(row);
  }
  root.append(assetsBody);

  container.append(root);
}

// ---------------------------------------------------------------------------
// Popup menus
// ---------------------------------------------------------------------------

function showAddMenu(anchor: HTMLElement, spec: SceneSpec, cbs: TreeCallbacks): void {
  removePopups();
  const menu = el("div", "popup-menu");
  for (const [kind, label] of [["plane", "\u25A3 Plane"], ["sprite", "\u{1F5BC} Sprite"], ["text", "\u{1F4DD} Text"]] as const) {
    const btn = document.createElement("button");
    btn.textContent = label;
    btn.addEventListener("click", () => {
      addObject(spec, kind);
      cbs.onMutate();
      menu.remove();
    });
    menu.append(btn);
  }
  positionPopup(menu, anchor);
}

function showPassMenu(anchor: HTMLElement, spec: SceneSpec, cbs: TreeCallbacks): void {
  removePopups();
  const menu = el("div", "popup-menu");
  for (const pass of ["bloom", "vhs", "chromaticAberration", "glitch"]) {
    const btn = document.createElement("button");
    btn.textContent = pass;
    btn.addEventListener("click", () => {
      addPass(spec, pass);
      cbs.onMutate();
      menu.remove();
    });
    menu.append(btn);
  }
  positionPopup(menu, anchor);
}

function positionPopup(menu: HTMLElement, anchor: HTMLElement): void {
  menu.style.position = "fixed";
  const rect = anchor.getBoundingClientRect();
  menu.style.left = `${rect.left}px`;
  menu.style.top = `${rect.bottom + 2}px`;
  document.body.append(menu);
  const dismiss = (e: MouseEvent) => {
    if (!menu.contains(e.target as Node)) {
      menu.remove();
      document.removeEventListener("mousedown", dismiss);
    }
  };
  // Delay so the current click doesn't dismiss immediately
  requestAnimationFrame(() => document.addEventListener("mousedown", dismiss));
}

function removePopups(): void {
  for (const p of document.querySelectorAll(".popup-menu")) p.remove();
}

// ---------------------------------------------------------------------------
// Shared helpers
// ---------------------------------------------------------------------------

function sectionHeader(label: string, plusAction: (() => void) | null): HTMLElement {
  const header = el("div", "tree-section-header");
  header.innerHTML = `<span class="tree-toggle">\u25BE</span><span>${label}</span>`;
  if (plusAction !== null) {
    const plus = el("button", "tree-plus");
    plus.textContent = "+";
    plus.title = `Add ${label.toLowerCase()}`;
    plus.addEventListener("click", (e) => { e.stopPropagation(); plusAction(); });
    header.append(plus);
  }
  return header;
}

function treeRow(label: string, sel: Selection, current: Selection, cbs: TreeCallbacks): HTMLElement {
  const row = el("div", `tree-row${matches(current, sel) ? " active" : ""}`);
  row.textContent = label;
  row.tabIndex = 0;
  row.addEventListener("click", () => cbs.onSelect(sel));
  return row;
}

function matches(current: Selection, candidate: Selection): boolean {
  return selectionKey(current) === selectionKey(candidate);
}

function el(tag: string, className: string): HTMLElement {
  const e = document.createElement(tag);
  e.className = className;
  return e;
}
