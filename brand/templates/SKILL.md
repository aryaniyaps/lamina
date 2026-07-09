---
name: lamina
description: >-
  Product design skill for developers who build with AI coding agents. Use when
  you need to know what to build before prompting your agent — domain model,
  workflows, edge cases, product states, and UX gaps handled upfront. Works
  alongside Cursor, Claude Code, Codex, Gemini, Pi. Any stack, any UI library.
  Do NOT use for visual styling, pixel layouts, or writing app source.
metadata:
  surfaces:
    - ide
    - cli
---

# Lamina — For Developers Who Build with AI

**Design how it works.**

Lamina runs alongside your AI coding agent — Cursor, Claude Code, Codex, Gemini, Pi. It helps you know what to build before you prompt: edge cases, UX gaps, product states, and invariants in a design contract your agent implements. Verified visually after you ship. Does not write your app source.

## When to use

Invoke Lamina when the task involves:

- New features where domain rules, user behavior, and system invariants all matter
- Multi-step flows (onboarding, checkout, settings, wizards)
- Permission-sensitive or multi-actor interactions
- Empty states, error handling, or edge cases tied to business rules
- Post-build verification against a design contract
- "Build me a dashboard/settings/app" requests that skip product thinking

Do **not** invoke Lamina for:

- Visual design, color, typography, or layout polish (use your UI design skill)
- Generating React/Vue/Svelte components directly
- Pure backend/API design with no user-facing flow

## Process

Follow this sequence for design:

### 1. Domain

Define entities, states, and invariants:

```
### Entity: [Name]
- States: [list]
- Invariants: [rules that must never break]
- Permissions: [who can do what]
```

### 2. Actors & workflows

Map who does what across the system:

```
### Actor: [Role]
- Goal: [what they're trying to accomplish]
- Operations: [what they can trigger]

## Workflow: [Name]
1. [Actor] → [Operation] → [Side effect]
```

### 3. UX flows

Map primary and alternate paths as numbered steps:

```
## Flow: [Name]

**Trigger:** [what starts this flow]
**Success:** [what "done" looks like]

1. [Step]
2. [Step]

### Alternate paths
- [Condition] → [different path]
```

### 4. Scenarios & edge cases

Enumerate violations and recovery:

```
### Scenarios
- [ ] [Specific scenario] → [Expected behavior]
```

Categories: empty states, errors, concurrency, boundaries, permissions, recovery.

## Verify

After implementation, run verification:

1. Actor walks against `run.yaml` contract
2. Visual walkthrough capture from live app (screenshots + a11y)
3. Persona simulations consume visual evidence
4. Findings written to `.lamina/runs/<id>/`

## Output format

Always output in this order:

1. Domain (entities, invariants)
2. Actors & workflows
3. UX flows
4. Scenarios & edge cases

End with a **handoff block** for the coding agent:

```
## Handoff

Framework: [user's stack, or "agnostic"]
Priority: [what to build first]
Defer: [what can wait]
```

## Voice

- Precise, structural, dev-native
- No marketing language, no "revolutionary AI"
- Specs are testable — if you can't write a test for it, rewrite it
- Name things consistently (use IDs like `flow.invite-member.step-3`)

## Integration

Lamina is unopinionated. Works alongside:

- Any UI design skill (Impeccable, UI UX Pro Max, etc.)
- Any UI library (shadcn, MUI, Chakra, Radix, Tailwind)
- Any framework (React, Vue, Svelte, Next.js, Angular, Astro, mobile)
- Any coding agent (Cursor, Claude Code, Codex, Gemini, Pi)

Never prescribe component names from a specific library unless the user specifies one. Never opinionated about context management or memory.

## Brand

- Tagline: *Design how it works.*
- Position: *Know what to build. Iterate faster.*
- Visual: Grey UX layer · Highlighter `#FACC15` accent · dotted annotations · 3D meerkat mascot
- Website: [lamina.dev](https://lamina.dev)
