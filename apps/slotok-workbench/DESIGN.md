---
name: Slotok Workbench
description: Chorus-inspired local-first creative workflow workbench for UGC and brainrot pipelines
colors:
  background: "#fafafa"
  sidebar: "#f5f5f7"
  surface: "#ffffff"
  surface-muted: "#fafafa"
  border: "#e4e4e7"
  border-strong: "#d4d4d8"
  foreground: "#1f2328"
  muted-foreground: "#6d7278"
  faint-foreground: "#969ba1"
  primary: "#2f6fed"
  primary-soft: "#eef5ff"
  success: "#2f9e44"
  danger: "#d64545"
typography:
  title:
    fontFamily: "SF Pro Text, Aptos, Segoe UI, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, sans-serif"
    fontSize: "14px"
    fontWeight: 600
    lineHeight: 1.43
    letterSpacing: "0"
  body:
    fontFamily: "SF Pro Text, Aptos, Segoe UI, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, sans-serif"
    fontSize: "12px"
    fontWeight: 400
    lineHeight: 1.67
    letterSpacing: "0"
  label:
    fontFamily: "SF Pro Text, Aptos, Segoe UI, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, sans-serif"
    fontSize: "11px"
    fontWeight: 500
    lineHeight: 1.45
    letterSpacing: "0"
  mono:
    fontFamily: "SF Mono, ui-monospace, Menlo, Consolas, monospace"
    fontSize: "11px"
    fontWeight: 400
    lineHeight: 1.55
    letterSpacing: "0"
rounded:
  hairline: "3px"
  micro: "4px"
  compact: "5px"
  control: "6px"
  control-soft: "7px"
  panel: "8px"
  row: "10px"
  canvas: "12px"
  card: "14px"
  overlay: "16px"
  pill: "999px"
spacing:
  xs: "4px"
  sm: "8px"
  md: "12px"
  lg: "16px"
components:
  button-primary:
    backgroundColor: "{colors.primary}"
    textColor: "#ffffff"
    rounded: "{rounded.control}"
    height: "36px"
    padding: "0 12px"
  button-selected:
    backgroundColor: "{colors.primary-soft}"
    textColor: "{colors.primary}"
    rounded: "{rounded.control}"
    height: "32px"
    padding: "0 10px"
  panel:
    backgroundColor: "{colors.surface}"
    textColor: "{colors.foreground}"
    rounded: "{rounded.panel}"
    padding: "12px"
---

# Design System: Slotok Workbench

## 1. Overview

**Creative North Star: "The Creative Flight Recorder"**

Slotok is a Chorus-inspired, Slotok-owned product workbench. It should feel like a calm native tool for creative engineering: dense, precise, and trustworthy, with the active workflow/chat/event stream as the center of gravity. The interface serves long debugging and review sessions, so it should privilege legibility, provenance, and next-action clarity over visual novelty.

The system rejects generic AI dashboard aesthetics. Sidebars and inspectors are supporting context; they may collapse or appear contextually, but the center workbench must remain the place where the user understands what happened and what to do next.

**Key Characteristics:**

- Light product register with restrained color and native UI familiarity.
- Center-first layout: workflow/chat log and selected artifact state dominate.
- Side panels are contextual, optional, and lower visual weight.
- Dense information is acceptable when structured with local scrolling and clear labels.
- Provider cost, dry-run/live status, provenance, and reference-only state stay visible at decision points.

## 2. Colors

The palette is restrained zinc/off-white with one blue primary accent for selection, current view, and primary actions.

### Primary

- **Operational Blue** (#2f6fed): current selection, primary buttons, focused rings, and active state. Use sparingly; if blue is everywhere, nothing is selected.

### Neutral

- **Workbench Background** (#fafafa): app backdrop and quiet inactive canvas regions.
- **Sidebar Zinc** (#f5f5f7): left rail and secondary support surfaces.
- **Panel White** (#ffffff): cards, inspector panels, tables, and command surfaces.
- **Border Zinc** (#e4e4e7): default boundaries, dividers, and control strokes.
- **Ink** (#1f2328): primary text.
- **Muted Ink** (#6d7278): labels and secondary metadata.

### Named Rules

**The ≤10% Accent Rule.** Blue is for selection, focus, and primary actions only. Never use it as decoration.

**The No Beige Drift Rule.** Do not reintroduce warm cream/beige body surfaces as a generic AI polish move.

## 3. Typography

**Display Font:** SF Pro Text / Aptos / Segoe UI / system sans
**Body Font:** SF Pro Text / Aptos / Segoe UI / system sans
**Label/Mono Font:** SF Mono / ui-monospace / Menlo / Consolas only for IDs, paths, JSON, payloads, and timeline/code data

**Character:** Product-native, compact, and readable. No display-font theatrics; hierarchy comes from weight, spacing, and placement.

### Hierarchy

- **Title** (600, 14-16px, 20-24px line-height): active view names, panel titles, selected object names.
- **Body** (400, 12-13px, 20px line-height): workflow events, review copy, descriptions, notes.
- **Label** (500, 11px, 16px line-height): metadata labels, chips, table headers, status descriptors.
- **Data/Code** (400, 11-12px mono, 17px line-height): IDs, file paths, JSON, provider payload snippets, and timeline/code data.

### Named Rules

**The Shortcut Quiet Rule.** Keyboard shortcuts are useful, but visual shortcut noise is secondary. Show shortcuts where they teach navigation; hide them when they crowd the workbench.

## 4. Elevation

Slotok uses tonal layering first and shallow shadows second. Static surfaces are mostly flat. Shadows appear on floating command surfaces, dialogs, selected cards, and hover/focus states that need depth.

### Shadow Vocabulary

- **Panel Soft** (`0 1px 2px rgba(20,22,25,0.04)`): workbench buttons/cards that need a faint edge.
- **Floating Medium** (`0 8px 28px rgba(20,22,25,0.06)`): command surfaces and overlays.
- **Selected Outline** (`0 0 0 1.5px hsl(var(--primary))`): selected card emphasis without adding mass.

### Named Rules

**The Flat-At-Rest Rule.** Most surfaces are flat at rest. Elevation must signal floating, selection, or active interaction.

## 5. Components

### Buttons

- **Shape:** 6px radius, compact 28-36px heights. Pills use 999px only for chips, tags, and tiny status dots.
- **Primary:** blue fill with white text, reserved for spendful/live/apply actions or the main submit affordance.
- **Selected:** blue-tinted fill with blue text and subtle border; used for active nav, selected filters, and current mode.
- **Hover / Focus:** subtle background shift plus tight blue focus ring. Do not invent new button shapes per view.

### Chips

- **Style:** low-saturation tinted backgrounds with matching subtle borders.
- **State:** chips identify status, provider, lane, or safety mode; they should not become decorative confetti.

### Cards / Containers

- **Corner Style:** 8px panels, 12px canvases/command surfaces.
- **Background:** white for real content, zinc/off-white for support surfaces.
- **Shadow Strategy:** shallow or none; selected state uses outline before shadow.
- **Internal Padding:** 8-16px depending on density.

### Inputs / Fields

- **Style:** white fill, zinc border, 6px radius, compact height.
- **Focus:** blue border/ring. Placeholder text must remain legible.
- **Error / Disabled:** semantic state color or opacity; never rely on color alone.

### Navigation

- **Desktop:** left navigation may collapse, but the collapsed state must remain obvious and reversible. Left nav is stable; right inspector is contextual and may hide when it does not help.
- **Tablet / Mobile:** preserve primary navigation and workflow visibility; drawer/sheet behavior is acceptable only when it is obvious and keyboard/screen-reader reachable.
- **Tabs:** short labels are allowed in dense toolbars, but full labels must exist in accessible names or sidebar rows.

### Workflow Log

- **Role:** signature component and center priority. Events should read like an operational transcript: status, actor/provider, artifact link, cost/risk, and next action.
- **Behavior:** local scrolling, clear selected run, visible dry-run/live state, and no document-level overflow.

## 6. Do's and Don'ts

### Do:

- **Do** make the workflow/chat/event stream the default center of gravity.
- **Do** keep side panels visually lighter than the center workbench.
- **Do** show local/dry-run/live/provider cost/reference-only status where actions happen.
- **Do** use local scroll containers for tables, logs, maps, and inspectors.
- **Do** keep responsive behavior structural: collapse panels, wrap actions, and preserve navigation.
- **Do** prefer familiar product UI controls over clever custom affordances.

### Don't:

- **Don't** use dark AI-dashboard shells, neon/cyberpunk accents, or chunky card soup.
- **Don't** use warm beige/cream surfaces as default polish.
- **Don't** make side panels compete with the center workflow.
- **Don't** use decorative glassmorphism, ornamental gradients, or hero-metric SaaS templates.
- **Don't** hide spendful/live/provider actions behind ambiguous labels.
- **Don't** allow document-level horizontal overflow on desktop, tablet, or phone widths.
