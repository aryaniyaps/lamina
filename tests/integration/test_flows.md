# Lamina integration smoke tests

Manual smoke paths for verifying slash commands and skill load chains after install.

## Prerequisites

- `npm test` (or `npm run verify:bundle`) passes
- Lamina installed via `npx skills add https://github.com/aryaniyaps/lamina -a cursor -y` from your app repo (not from the Lamina repo root — see `evals/harness-sandbox/`)

## Router (`/lamina`)

| Input | Expected dispatch |
|---|---|
| "We don't know what problem to solve yet" | design workflow |
| "Add a wishlist feature" | design workflow |
| "Audit our checkout flow" | audit workflow |
| "Help with form validation UX" | direct → lamina-forms |

### Init gate (workflow dispatch)

| Input | Expected |
|---|---|
| Any design/audit signal without `.lamina/business-context.md` | Blocked — init-blocked output; instruct `/lamina-init`; no artifacts created |
| Design signal with valid business context | Dispatch to design workflow |

## Init (`/lamina-init`)

- Input: product description or brownfield repo context
- Expect: `.lamina/business-context.md` with business sections and confidence
- Expect: init output contract per `skills/lamina-orchestrator/prompts/outputs/init.md`
- Expect: loads skills from `audit-profiles.yaml` `init` profile
- Update: `/lamina-init update` with pivot description — expect changelog append, stale artifact flags

## Design (`/lamina-design`)

- **Prerequisite:** valid `.lamina/business-context.md` from `/lamina-init` (required — gate blocks without it)

### Design workflow

- Input: problem statement for a mobile budgeting app
- Expect: unified output per `skills/lamina-orchestrator/prompts/outputs/design.md`
- Expect: step 0 init gate passes; reads `business-context.md`
- Expect: `.lamina/personas.yaml` cast when missing or stale
- Optional: persona panel when flows or a journey exist
- **Without init:** expect init-blocked output; no personas or other artifacts created

### Scoped capability example

- Input: "Add two-factor authentication to settings"
- Expect: design output contract headings per `skills/lamina-orchestrator/prompts/outputs/design.md`
- Expect: loads skills from `audit-profiles.yaml` design-* profiles
- **Without init:** expect init-blocked output; no artifacts created

### Natural-language routing

- Input: `/lamina-design Add wishlist feature to our storefront`
- Expect: design workflow

- Input: `/lamina-design Concept for expense tracking app`
- Expect: design workflow

## Verify (`/lamina-verify`)

- **Prerequisite:** valid business context (required)
- Input: checkout flow description or screenshot reference, or post-build live app
- Expect: verify findings, actor walks, invariant checks
- Expect: loads `audit-profiles.full-flow` skills
- **Without init:** expect init-blocked output; no artifacts created

## Direct capability

- Invoke `/lamina` with "users feel lost in navigation"
- Expect: loads `lamina-core` Problem Router → `lamina-navigation` skill only

## Subagents (optional)

- Persona panel: dynamic spawns — one subagent per persona, each prompt embeds that persona's identity (`skills/lamina-orchestrator/prompts/subagents/persona-panel-spawn.md`)
- Parallel audit delegates to `agents/ux-lens-reviewer`
- Large corpus synthesis delegates to `agents/research-synthesizer`
