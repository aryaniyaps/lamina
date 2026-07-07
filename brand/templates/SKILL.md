---
name: lamina
description: >-
  UX reasoning layer for developers. Use when you need to figure out what to
  build before writing code or generating UI � defines user personas, maps
  flows, writes specs, and enumerates edge cases. Framework-agnostic. Invoke
  before any feature build, settings page, onboarding flow, or multi-step
  interaction. Do NOT use for visual design, pixel layouts, or code generation.
metadata:
  surfaces:
    - ide
    - cli
---

# Lamina � UX Reasoning Layer

**Design how it works.**

Lamina is the missing layer between AI UI tools and coding agents. It does not make things pretty and it does not write code. It figures out **what to build** and **how users move through it**.

## When to use

Invoke Lamina when the task involves:

- New features or pages where user behavior matters
- Multi-step flows (onboarding, checkout, settings, wizards)
- Permission-sensitive interactions
- Empty states, error handling, or edge cases
- "Build me a dashboard/settings/app" requests that skip UX thinking

Do **not** invoke Lamina for:

- Visual design, color, typography, or layout polish
- Generating React/Vue/Svelte components directly
- Code review or refactoring existing code
- Pure backend/API design with no user-facing flow

## Process

Follow this sequence every time:

### 1. Personas

Define 1�3 personas relevant to the feature:

```
### [Name] � [Role]
- Goal: [what they're trying to accomplish]
- Context: [when/where they use this]
- Fear: [what goes wrong for them]
- Frequency: [how often]
```

Only include personas that affect design decisions. Skip decorative personas.

### 2. Flows

Map primary and alternate paths as numbered steps:

```
## Flow: [Name]

**Trigger:** [what starts this flow]
**Success:** [what "done" looks like]

1. [Step]
2. [Step]
...

### Alternate paths
- [Condition] ? [different path]
```

Use ASCII flow diagrams for complex branching:

```
[Entry] ? [Step 1] ? [Decision]
                        ?? Yes ? [Path A] ? [Done]
                        ?? No  ? [Path B] ? [Done]
```

### 3. Spec

Write implementation-ready specs:

```
## Spec: [Feature name]

### Requirements
- [ ] [Testable requirement]

### States
| State | Trigger | UI behavior |
|-------|---------|-------------|
| default | page load | ... |
| loading | async fetch | ... |
| empty | no data | ... |
| error | fetch fails | ... |

### Dependencies
- [API, auth, feature flags, etc.]
```

### 4. Edge cases

Enumerate edge cases as a checklist. Categories:

- **Empty states** � no data yet
- **Errors** � network, validation, permissions
- **Concurrency** � two users, race conditions
- **Boundaries** � max limits, truncation, overflow
- **Permissions** � role-based visibility and actions
- **Recovery** � undo, retry, escape hatches

Format:

```
### Edge cases
- [ ] [Specific scenario] ? [Expected behavior]
```

## Output format

Always output in this order:

1. Personas
2. Flows (with diagrams if needed)
3. Spec
4. Edge cases

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
- Specs are testable � if you can't write a test for it, rewrite it
- Name things consistently (use IDs like `flow.invite-member.step-3`)

## Integration

Lamina is unopinionated. Output specs that work with:

- Any UI library (shadcn, MUI, Chakra, Radix, Tailwind)
- Any framework (React, Vue, Svelte, Next.js)
- Any coding agent (Cursor, Claude, Copilot, Windsurf)

Never prescribe component names from a specific library unless the user specifies one.

## Example invocation

**User:** "Build a team settings page for our SaaS app"

**Lamina output:**

1. Personas: Team Admin, Member, Guest
2. Flow: Change role, Remove member, Transfer ownership
3. Spec: States table, permission matrix, API dependencies
4. Edge cases: Last admin, pending invites, SSO conflicts
5. Handoff: Build permission matrix first, defer audit log

## Brand

- Tagline: *Design how it works.*
- Shorthand: *Flows before pixels.*
- Visual: Grey UX layer · Highlighter `#FACC15` accent · dotted annotations · 3D meerkat mascot
- Website: [lamina.dev](https://lamina.dev)
