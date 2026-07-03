# Slotok Design Book Cluster

A ranked cluster of books adjacent to *Refactoring UI* and *The Design of Everyday Things*, mapped to Slotok's local-first three-panel agent workbench.

## Anchors

1. **Refactoring UI** — Adam Wathan & Steve Schoger
2. **The Design of Everyday Things** — Don Norman

## Ranked Adjacent Books

### Tier 1: Immediate workbench polish

3. **Don't Make Me Think, Revisited** — Steve Krug
   *Why adjacent:* Practical usability heuristic testing; same "fix the obvious stuff" energy as *Refactoring UI*.
   *Slotok problem:* Fake chrome / dead controls / honest UI.
   *Heuristic:* Every clickable element in the three-panel shell must either mutate real state or be visibly disabled; no ornamental buttons.

4. **Laws of UX** — Jon Yablonski
   *Why adjacent:* Short, evidence-based psychology laws (Fitts, Hick, Miller, Jakob, Peak-End) bridging Norman's cognitive framing to UI decisions.
   *Slotok problem:* Dense agent-state legibility and keyboard-fast review.
   *Heuristic:* Primary Batch Review actions (star/reject/fork) must sit within one Fitts-law distance of the keyboard home row and never require a mouse hunt.

5. **Designing Interfaces** — Jenifer Tidwell, Charles Brewer, Aynne Valencia
   *Why adjacent:* Pattern catalog for complex desktop/workbench UIs; the "patterns" sibling to *Refactoring UI*'s rules.
   *Slotok problem:* Repeated workbench chrome (sidebars, inspectors, command bars) is becoming one-off CSS.
   *Heuristic:* Promote any pattern used ≥3 times into `design-system/workbench.tsx` before adding new `.rugc-*` CSS.

6. **Microinteractions** — Dan Saffer
   *Why adjacent:* Focuses on the small feedback details that make state changes feel native and trustworthy.
   *Slotok problem:* Agent runs, provider jobs, and workflow events need honest, non-jarring state transitions.
   *Heuristic:* Every state transition (queued → running → completed/blocked) gets ≤150ms of feedback; no bouncing loaders for local operations.

7. **Practical UI** — Adham Dannaway
   *Why adjacent:* Developer-friendly visual design rules, very close in tone to *Refactoring UI*.
   *Slotok problem:* Inconsistent spacing/sizing/radii across parallel code sessions.
   *Heuristic:* Stick to the documented 4/8/12/16px spacing scale and 6–12px radii; reject ad-hoc 7/9/14px values in code review.

### Tier 2: Workbench philosophy and information architecture

8. **The Best Interface Is No Interface** — Golden Krishna
   *Why adjacent:* Pushes back on screen-first thinking; pairs well with Norman's "right thing happens" goal.
   *Slotok problem:* Provider jobs and workflow imports add unnecessary modal steps.
   *Heuristic:* If a workflow can run, report, and persist without opening a new surface, skip the modal.

9. **About Face** — Alan Cooper, Robert Reimann, David Cronin, Christopher Noessel
   *Why adjacent:* Deep interaction-design foundation for goal-directed design and "personas" as usage archetypes.
   *Slotok problem:* Persona Atlas conflates marketing personas with design personas.
   *Heuristic:* Model Persona Atlas entries as goal-directed archetypes (operator modes), not demographic segments.

10. **Universal Principles of Design** — William Lidwell, Kritina Holden, Jill Butler
    *Why adjacent:* Cross-disciplinary reference of 200 decision-making principles; Norman-style usability + visual design in one.
    *Slotok problem:* Hard to justify layout/priority tradeoffs under time pressure.
    *Heuristic:* Apply the 80/20 principle to the right inspector: surface the three most common actions; bury the rest in an overflow.

11. **100 Things Every Designer Needs to Know About People** — Susan M. Weinschenk
    *Why adjacent:* Translates cognitive psychology into concrete UI implications, much like *The Design of Everyday Things*.
    *Slotok problem:* Batch Review and workflow telemetry overload working memory.
    *Heuristic:* Keep the current candidate's decision history, status, and next action within one fixation area; don't scatter it across panels.

12. **Mismatch: How Inclusion Shapes Design** — Kat Holmes
    *Why adjacent:* Inclusive-design lens for preventing exclusion through mismatches between people and interfaces.
    *Slotok problem:* Dense agent state, error messages, and provider-job failures can exclude non-expert users.
    *Heuristic:* For every error state, provide a plain-language explanation plus an actionable recovery path; never show raw provider JSON as the only signal.

13. **Information Architecture for the World Wide Web** — Louis Rosenfeld & Peter Morville
    *Why adjacent:* Classic IA for organizing large, growing information spaces.
    *Slotok problem:* Personas, branches, candidates, reference archives, and workflow runs need predictable findability.
    *Heuristic:* Label every object family consistently across sidebar, inspector, and graph; if a term exists in the data model, it must match the UI label.

### Tier 3: Process, motivation, and typography

14. **Seductive Interaction Design** — Stephen P. Anderson
    *Why adjacent:* Motivation and curiosity layers on top of usable interfaces.
    *Slotok problem:* Creative search can feel like a slog; users need reasons to keep exploring.
    *Heuristic:* Show the next likely agent action as a subtle, non-blocking preview; reward genuine creative outcomes, not empty notifications.

15. **Just Enough Research** — Erika Hall
    *Why adjacent:* Lightweight research methods for teams that can't run full UX studies.
    *Slotok problem:* New views are added before validating actual creative workflows.
    *Heuristic:* Before adding a view, run a 30-minute task walkthrough with one real UGC-ads and one brainrot scenario.

16. **Continuous Discovery Habits** — Teresa Torres
    *Why adjacent:* Habitual customer touchpoints to keep product decisions grounded.
    *Slotok problem:* The workbench risks drifting toward internal tooling assumptions.
    *Heuristic:* Hold a 15-minute weekly touchpoint with Arthur or a synthetic user to test one three-panel layout hypothesis.

17. **The Elements of Typographic Style** — Robert Bringhurst
    *Why adjacent:* The canonical typography reference; brings polish to *Refactoring UI*-style rule-based UI.
    *Slotok problem:* Dense text-first workbench can feel ragged and hard to scan.
    *Heuristic:* Align body text to a 4px vertical rhythm; keep line-height ratios consistent within each label/body/title tier.

18. **Thinking with Type** — Ellen Lupton
    *Why adjacent:* Practical typography primer for screen UI, more accessible than Bringhurst.
    *Slotok problem:* Label hierarchy in the inspector is inconsistent.
    *Heuristic:* Enforce the documented type scale: 11–12px labels, 13–14px body, 15–17px titles; don't invent intermediate sizes.

19. **Grid Systems in Graphic Design** — Josef Müller-Brockmann
    *Why adjacent:* Foundational grid discipline for multi-panel tool layouts.
    *Slotok problem:* Three-panel proportions can collapse the central review canvas.
    *Heuristic:* Lock the shell to a 12-column grid where the central canvas never drops below 50% viewport width on desktop.

## Backlog Additions

From `docs/research/slotok-design-books-backlog.md`:

20. **The Elements of User Experience** — Jesse James Garrett
    *Why adjacent:* Classic UX stratification from strategy to surface.
    *Slotok problem:* Brainrot vs UGC-ads lanes need clear product-strategy separation without duplicating workbench chrome.
    *Heuristic:* Map each view to exactly one Garrett plane; if a view spans two planes, split it or pick the dominant one.

21. **Lean UX** — Jeff Gothelf, Josh Seiden
    *Why adjacent:* Lightweight hypothesis-driven design for fast-moving teams.
    *Slotok problem:* Features are built before validating creative-operator assumptions.
    *Heuristic:* Every new workbench view ships with a falsifiable hypothesis and one metric in local state.

22. **Orchestrating Experiences** — Chris Risdon, Patrick Quattlebaum
    *Why adjacent:* Cross-channel journey orchestration for complex tool ecosystems.
    *Slotok problem:* Workflow runs, provider jobs, and handoff imports span multiple views.
    *Heuristic:* Trace any workflow object from its origin view to its destination view in ≤3 clicks.

23. **Mental Models** — Indi Young
    *Why adjacent:* Task- and belief-based research for designing around how people think.
    *Slotok problem:* Persona/profile bibles may reflect invented demographics rather than operator tasks.
    *Heuristic:* Every persona attribute must map to at least one observable task in Batch Review or Final Editor.

24. **Articulating Design Decisions** — Tom Greever
    *Why adjacent:* How to explain and defend design choices to stakeholders.
    *Slotok problem:* Arthur's design-language preferences need to survive parallel code sessions.
    *Heuristic:* Every PR that changes workbench chrome includes a one-line rationale citing the design-language doc.

25. **Design for How People Think** — John Whalen
    *Why adjacent:* Cognitive psychology applied to digital product design.
    *Slotok problem:* Dense workflow telemetry competes for attention.
    *Heuristic:* Group related telemetry by cognitive load: primary status in the canvas, secondary context in the inspector, debug detail in a drawer.

26. **The Design of Sites** — Douglas K. van Duyne, James A. Landay, Jason I. Hong
    *Why adjacent:* Pattern-based web design with strong IA and interaction foundations.
    *Slotok problem:* UGC Studio views need consistent navigation and object-handling patterns.
    *Heuristic:* Reuse the same selection/inspect/edit pattern across Atlas, Batch Review, and Reference Archive.

27. **Designing Web Interfaces** — Bill Scott, Theresa Neil
    *Why adjacent:* Rich web interaction patterns for data-dense applications.
    *Slotok problem:* Drag/drop, inline editing, and keyboard shortcuts need consistent behavior.
    *Heuristic:* For every direct-manipulation feature, define the keyboard equivalent and the error-recovery path before shipping.

28. **Designing Products People Love** — Scott Hurff
    *Why adjacent:* Product-design craft for tools people actually adopt.
    *Slotok problem:* Slotok risks becoming an internal tool rather than a product.
    *Heuristic:* Evaluate each feature by whether a solo creator would miss it after one day away from the app.

29. **Designing for Behavior Change** — Stephen Wendel
    *Why adjacent:* Behavioral science for building habits without coercion.
    *Slotok problem:* Users need to form a daily creative-search habit.
    *Heuristic:* Trigger the next creative step from the previous outcome, not from a generic notification.

## Top 5 to Prioritize First

| # | Book | Why first |
|---|------|-----------|
| 1 | *Don't Make Me Think, Revisited* | Immediately removes fake chrome and dead controls; matches the "honest UI" V1-local mandate. |
| 2 | *Laws of UX* | Gives fast, testable rules for the Batch Review Player and three-panel density. |
| 3 | *Designing Interfaces* | Provides the pattern vocabulary to finish migrating workbench chrome into the owned design system. |
| 4 | *Microinteractions* | Fixes agent/provider-state feedback so the app feels native and trustworthy. |
| 5 | *Practical UI* | Locks down the spacing/type/radii system so future parallel code sessions don't drift. |

## Three-Panel Workbench Rubric

Use this rubric against any new or existing view in `apps/slotok-workbench`.

| Panel / Concern | Check | Key books |
|-----------------|-------|-----------|
| **Left nav / compact queue** | Is every nav item a real view? Is selection state obvious? Does it collapse cleanly? | *Don't Make Me Think*, *Information Architecture* |
| **Central review canvas** | Does the selected artifact/output dominate the screen? Are sidebars visually subordinate? Is the canvas usable at ≥50% viewport width? | *Design of Everyday Things*, *Grid Systems*, *Laws of UX* |
| **Right inspector / actions panel** | Are the top 3 actions visible? Are secondary actions tucked? Is there a visible disabled state for unavailable actions? | *Universal Principles of Design*, *Practical UI*, *About Face* |
| **Agent-state transitions** | Is queued/running/completed/blocked feedback immediate, honest, and ≤150ms? No phantom progress? | *Microinteractions*, *The Best Interface Is No Interface* |
| **Error tolerance** | Does every error explain what happened and how to recover? Is raw provider JSON a secondary debug view, never the primary signal? | *Mismatch*, *100 Things* |
| **Visual system consistency** | Are spacing, radii, type scale, and color usage consistent with the design-system tokens? | *Practical UI*, *Thinking with Type*, *Refactoring UI* |
| **Creative workflow motivation** | Does the UI make the next creative step obvious without nagging? Are rewards tied to real outcomes? | *Seductive Interaction Design*, *Designing for Behavior Change* |

## Sources Consulted

### Local docs
- `docs/state/slotok-design-language.md`
- `docs/state/ugc-studio-style-direction.md`
- `docs/state/ugc-studio-design-system.md`
- `docs/plans/slotok-gold-doc.md`
- `docs/plans/slotok-v1-done.md`
- `docs/plans/slotok-workstream.md`
- `workflows/slotok-creative-agents/README.md`
- `docs/research/slotok-design-books-backlog.md`

### Public metadata
- *Don't Make Me Think, Revisited* — Wikipedia / Peachpit
- *Laws of UX* — O'Reilly / lawsofux.com
- *Designing Interfaces* — O'Reilly / Google Books
- *Microinteractions* — O'Reilly / Google Books
- *Practical UI* — https://www.practical-ui.com/
- *The Best Interface Is No Interface* — https://www.nointerface.com/
- *About Face* — Wiley
- *Universal Principles of Design* — http://universalprinciplesofdesign.com/books
- *100 Things Every Designer Needs to Know About People* — Peachpit
- *Mismatch* — MIT Press
- *Information Architecture for the World Wide Web* — O'Reilly
- *Seductive Interaction Design* — Pearson / Google Books
- *Just Enough Research* — A Book Apart
- *Continuous Discovery Habits* — Product Talk
- *The Elements of Typographic Style* — Wikipedia
- *Thinking with Type* — Princeton Architectural Press
- *Grid Systems in Graphic Design* — Niggli publisher
