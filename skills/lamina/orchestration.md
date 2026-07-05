# Lamina Orchestration

Coordinates multi-capability UX workflows. Slash commands in `commands/` are workflow presets; this file defines shared rules.

## Guardrail

**UX artifacts and recommendations only.** Do not implement product code or visual styling specs (colors, typography, component libraries).

## Modes

| Mode | When | Load path |
|---|---|---|
| **Direct** | One clear topic; single capability suffices | `reference.md` → one `capabilities/<id>.md` |
| **Workflow** | Slash command invoked, or 2+ UX domains in one ask | This file → command preset → listed capabilities → merge |

Workflow commands always load this file first, then their command file from `commands/`.

## Three steps

1. **Select** — parse request; list capabilities from Problem Router (`SKILL.md`), capability `related` links, or command preset. Cap at 6 unless the command preset lists more for a full audit.
2. **Apply** — load each capability (and reasoning rubrics when the command specifies); run inline by default.
3. **Deliver** — merge into the command's output contract; load `decision-making` only when outputs conflict.

## Capability selection (when no command preset)

1. Match user signals to Problem Router in `SKILL.md`.
2. If one match with high confidence → direct mode.
3. If multiple domains → pick 2–6 capabilities; follow `related` frontmatter for gaps.
4. Never load all 38 capabilities.

## Label → capability map

Optional shorthand; capabilities are the specialists.

| Label | Capabilities |
|---|---|
| Persona | `user-modeling` |
| Research | `research-scoping`, `research-planning` |
| Flow | `flow-design`, `task-analysis` |
| IA | `information-architecture`, `navigation` |
| Interaction | `forms`, `controls-and-menus`, `discoverability` |
| Accessibility | `accessibility` |
| Copy | `content-design` |
| Usability review | `heuristic-review`, `usability-evaluation` |
| Risk | `trust`, `stakeholder-alignment` |
| Edge cases | `error-handling`, `empty-states` |
| Metrics / experiments | `quantitative-validation`, `research-communication` |

## Subagent patterns (optional)

The host tool chooses inline, parallel, or fresh-session execution. Lamina never requires subagents.

### Parallel review

**When:** Same UI or flow target; 2+ independent lenses with no cross-dependency.

**Typical lenses:** `heuristic-review`, `accessibility`, `content-design`, `trust`

**Skip when:** Single lens needed, or sequential dependency (persona before flow).

### Fresh context

**When:** Repo scan or large research corpus would crowd the main thread.

**What:** One isolated pass (discovery or synthesis) → short summary returned to main thread.

**Skip when:** Input fits comfortably in context.

### Persona panel

**When:** A concrete flow, screen set, or journey exists; personas in `.lamina/personas.yaml`.

**What:** Simulated user walkthroughs — one isolated subagent per persona, all in parallel. Never inline multiple personas in one agent.

**Skip when:** No evaluable artifact yet, or user wants a quick take.

**With parallel review:** In optimize, persona panel and expert audit lenses run as separate parallel groups on the same flow target.

Load [artifacts.md](artifacts.md) for YAML shapes, spawn template, and reconcile protocol.

## Work plan

Emit before heavy work (skip for quick takes):

```markdown
## Lamina work plan
**Workflow:** <command name or "orchestrated">
**Capabilities:** <ids>
**Order:** <sequential steps; mark parallel groups>
**Subagent:** <parallel review / persona panel / fresh context / inline only>
**Persona panel:** <persona ids or "skip"> | target: <flow/screen>
**Gaps:** <unknowns>
```

## Merge and conflicts

**Order:** problem → users → flows → structure → UI → edge cases → requirements → metrics → next steps.

**On conflict:** Load `capabilities/decision-making.md`. Apply primary-user filter and evidence triangulation.

**Unresolved:** List under **Open questions** in the final output. Never silently pick a side.

**Conflict record (when needed):**

```markdown
- **Conflict:** …
- **Sources:** …
- **Resolution:** …
- **Confidence:** high | medium | low
```

## Default output template

Use when no command-specific contract applies:

```markdown
## UX recommendation
### Problem framing
### Key insights
### Recommendations (prioritized)
### Conflicts resolved
### Open questions
### Suggested next steps
```

## Optional confirm gate

Before final delivery: *"Does this framing match your goal? Adjust or confirm."* Skip if the user asked for a quick take or full pass without gates.
