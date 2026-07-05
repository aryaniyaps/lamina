---
name: lamina-controls-and-menus
description: "Controls And Menus UX guidance. Use when menu and toolbar design; undo and reversible actions; destructive action anxiety."
metadata:
  lamina:
    id: controls-and-menus
    problems:
      - "menu and toolbar design"
      - "undo and reversible actions"
      - "destructive action anxiety"
      - "destructive actions"
      - "user anxiety about mistakes"
    related:
      - lamina-forms
      - lamina-error-handling
      - lamina-progressive-disclosure
    tags:
      - interaction
---
# Controls and Menus

## When to load

- menu and toolbar design
- undo and reversible actions
- destructive action anxiety
- destructive actions
- user anxiety about mistakes

## Decision frameworks

- **Anatomy of a Desktop App**: Primary and secondary windows; menu bar, toolbars, content panes, index panes. - Use when structuring sovereign desktop applications. - How: Primary window for main work; secondary for properties and dialogs.
- **Menus**: OS-standardized command collections—pedagogic, discoverable, keyboard-accessible. - Use for full function exposure and mnemonic teaching. - How: Follow platform standards; group by task; expose accelerators in labels.
- **Toolbars, Palettes, and Sidebars**: Immediate-modality command collections for working-set functions. - Use for frequently used actions on selected content. - How: Customize per application; allow user configuration; avoid toolbar bloat.
- **Pointing, Selection, and Direct Manipulation**: Mouse/touch selection models and drag-drop idioms. - Use when users manipulate objects in content panes. - How: Clear selection affordances; consistent drag sources and drop targets.
- **Windows on the Desktop**: MDI, SDI, and palette patterns for sovereign app window management. - Use when multiple documents or views are open simultaneously. - How: Match window model to persona task—side-by-side compare needs different structure than single-focus editing.
- **Using Rich Modeless Feedback (RVMF)**: In-depth status information always visible without mode shifts—reduces need for error dialogs. - Use when communicating dynamic object/process status. - How: Visual, modeless indicators in main views; ToolTips for detail on demand.
- **Undo, Redo, and Reversible Histories**: Multi-level undo, redo, and cross-session reversal of changes. - Use when users perform destructive or exploratory actions. - How: Track command history; make undo discoverable and deep; extend to session level where appropriate.
- **What If: Compare and Preview**: Show results before committing—preview modes, side-by-side comparison. - Use when changes are significant or hard to reverse mentally. - How: Live preview, split views, temporary application of filters/effects.
- **What If: Compare and Preview**: Side-by-side and live preview before committing significant changes. - Use for irreversible-feeling operations even when undo exists. - How: Temporary application of filters, layouts, or settings with explicit commit step.

## Checklists

1. Structure sovereign apps: content pane, index pane, menus, toolbars.
2. Menus teach and expose; toolbars accelerate the working set.
3. Follow platform menu standards; customize toolbars for domain tasks.
4. Selection and direct manipulation must have clear pliancy and feedback.
5. Match command placement to perpetual intermediate usage patterns.
1. Rich modeless feedback eliminates most status and error dialogs.
2. Robust undo/redo enables ask forgiveness, not permission.
3. Preview and compare let users see results before committing.
4. Positive feedback (including subtle audio) beats negative beeps.
5. Extend reversibility across sessions where users expect it.

## Heuristics

- **Sovereign vs. transient desktop apps**: Structure differs by posture.
- **Ribbon**: Tabbed toolbar replacing menus—more verbose, more pedagogic.
- **Index panes**: Navigation to objects appearing in content views.
- **Command placement**: Working-set commands on toolbars; full catalog in menus.
- **Platform standardization**: Menus follow OS conventions; toolbars are app-specific.
- Menus are the**catalog**; toolbars are the**workbench**.
- Index panes are the**filing system**; content panes are the**desk**.
- Every toolbar button should earn its**pixel tax**on daily tasks. - **Decision filter**: Ask whether this finding changes a specific design or business decision—if not, dig deeper or stop.
- **Ask forgiveness, not permission**: Undo replaces most confirmation dialogs.
- **Don't use dialogs to report normalcy**: Status belongs in modeless feedback.
- **Positive vs. negative audible feedback**: Silence indicates problems; soft sounds confirm success.
- **RVMF isn't for beginners initially**: Support menus/dialogs until users learn visual cues.
- **Reversible histories**: File system shouldn't substitute for undo.
- Undo is**confidence infrastructure**—without it, users hesitate and blame the product.
- Confirmation dialogs are**surrogates for missing undo**.
- Preview is**undo before the fact**.
- **Decision filter**: Ask whether this finding changes a specific design or business decision—if not, dig deeper or stop.

## Evaluation rubrics

### Reversible Actions
- **When**: Any action with significant consequences.
- **Process**: Make destructive actions undoable  ->  confirm only when undo impossible  ->  show clear feedback  ->  preserve undo history.
- **Pass**: Users can recover from unintended actions.
- **Failure signals**: Confirm dialogs for undoable actions; no undo for destructive ops.

## Anti-patterns

- **Toolbar duplication of entire menus**: Visual clutter without curation.
- **Non-standard menu placement**: Fighting platform conventions.
- **Hidden working-set functions**: Daily actions buried three menus deep.
- **Undifferentiated index panes**: Navigation that mirrors org chart, not user mental model.
- **"Are you sure?" for routine actions**: Confirming delete when undo exists.
- **Modal error scolding**: Dialogs that stop proceedings for recoverable issues.
- **Negative audible feedback**: Beeps announcing user failure to the whole office.
- **Shallow undo**: Single-level undo on complex multi-step operations.

## Related capabilities

- [Forms](../lamina-forms/SKILL.md)
- [Error Handling](../lamina-error-handling/SKILL.md)
- [Progressive Disclosure](../lamina-progressive-disclosure/SKILL.md)

## Cross-cutting

For prioritization and evidence triage, see [Decision Making](../lamina-decision-making/SKILL.md).
