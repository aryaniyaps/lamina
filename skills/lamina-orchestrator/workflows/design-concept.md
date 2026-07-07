# /lamina-design — concept track

Start from a user problem and build a complete UX concept incrementally — one layer at a time.

## Input

- User problem statement (required)
- Optional: target platform (web, mobile), constraints, existing context

## Steps

| Step | Section | Profile |
|---|---|---|
| 1 | User model | `ideate-step-1` |
| 2 | Journey | `ideate-step-2` |
| 3 | Information architecture | `ideate-step-3` |
| 4 | Flows | `ideate-step-4` |
| 5 | Screens | `ideate-step-5` |
| 6 | Interactions | `ideate-step-6` |
| 7 | Copy guidance | `ideate-step-7` |
| 8 | Accessibility considerations | `ideate-step-8` |
| 9 | Validation plan | `ideate-step-9` |

Resolve skill lists from [audit-profiles.yaml](../audit-profiles.yaml). Load each skill before writing its section.

Screens: structure and behavior only — no visual styling specs.

## Procedure

0. **Init gate** — run [init-required](../prerequisites/init-required.md). On failure: emit `outputs/init-blocked` and **STOP**. On success: read `.lamina/business-context.md` and ground all steps in business goals, scope, and constraints.
1. Emit work plan — prompt `work-plan`.
2. **Step 1 — Cast:** Write `.lamina/personas.yaml`. See [artifacts.md](../artifacts.md). Validate against Users & market in business-context.
3. Work through sections 1→9 in order.
4. **Step 4 — Flows + persona panel:** After flows, append entries to `.lamina/flows-inventory.yaml` (`status: draft`) per [artifacts.md](../artifacts.md). Run [persona-panel](../patterns/persona-panel.md). If no flow or screen target is described, list gaps — do not invent UI. Write `.lamina/personas/simulations/<run_id>.yaml`; reconcile into Flows section.
5. After sections 3 and 6, offer checkpoint — prompt `checkpoints/continue-or-revise` (skip if user asked for full pass).
6. **Steps 5, 6, and end (before merge):** Offer optional blueprint preview — prompt `checkpoints/blueprint-preview`. Load [lamina-blueprint](../../lamina-blueprint/SKILL.md). Step 5: generate `screens/` + `flows.tsx`. Step 6: add interaction `metadata` props. End: final review. Not offered at step 4.
7. **Step 9:** Map simulation blockers to real usability test tasks.
8. Merge into output contract — prompt `outputs/design-concept`.
9. On conflicts, load `lamina-decision-making` per [merge-rules.md](../merge-rules.md).

## Subagent hints

- **Fresh context:** large research docs → [fresh-context](../patterns/fresh-context.md) for step 1
- **Persona panel:** step 4
- Default: inline sequential
