# Lamina integration smoke tests

Manual smoke paths for verifying slash commands and skill load chains after install.

## Prerequisites

- `npm test` (or `npm run verify:bundle`) passes
- Lamina installed via `npx skills add . -a cursor -y` or manual copy

## Router (`/lamina`)

| Input | Expected dispatch |
|---|---|
| "We don't know what problem to solve yet" | ideate workflow |
| "Add a wishlist feature" | feature workflow |
| "Audit our checkout flow" | optimize workflow |
| "Help with form validation UX" | direct → lamina-forms |

## Init (`/lamina-init`)

- Input: product description or brownfield repo context
- Expect: `.lamina/business-context.md` with business sections and confidence
- Expect: init output contract per `prompts/outputs/init.md`
- Expect: loads skills from `audit-profiles.yaml` `init` profile
- Update: `/lamina-init update` with pivot description — expect changelog append, stale artifact flags

## Ideate (`/lamina-ideate`)

- Input: problem statement for a mobile budgeting app
- Expect: 9-section output per `prompts/outputs/ideate.md`
- Expect: step 0 reads `business-context.md` when present
- Expect: `.lamina/personas.yaml` cast at step 1
- Optional: persona panel at step 4 when flows exist

## Feature (`/lamina-feature`)

- Input: "Add two-factor authentication to settings"
- Expect: feature output contract headings
- Expect: loads skills from `audit-profiles.yaml` feature-* profiles

## Optimize (`/lamina-optimize`)

- Input: checkout flow description or screenshot reference
- Expect: prioritized improvements table
- Expect: loads `audit-profiles.full-flow` skills

## Direct capability

- Invoke `/lamina` with "users feel lost in navigation"
- Expect: loads `lamina-core` Problem Router → `lamina-navigation` skill only

## Subagents (optional)

- Persona panel: dynamic spawns — one subagent per persona, each prompt embeds that persona's identity (`prompts/subagents/persona-panel-spawn.md`)
- Parallel audit delegates to `agents/ux-lens-reviewer`
- Large corpus synthesis delegates to `agents/research-synthesizer`
