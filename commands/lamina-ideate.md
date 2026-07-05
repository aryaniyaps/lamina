# /lamina-ideate

## Product

Start from a user problem and build a complete UX concept incrementally — one layer at a time.

## Use when

- You have a problem statement but no solution yet
- You need user model through validation plan in one pass
- Early product or feature exploration

## Input

- User problem statement (required)
- Optional: target platform (web, mobile), constraints, existing context

## Load

- `lamina/orchestration.md`
- Capabilities per step below (load before writing each section)

| Step | Section | Capabilities |
|---|---|---|
| 1 | User model | `user-modeling`, `problem-framing` |
| 2 | Journey | `task-analysis`, `flow-design` |
| 3 | Information architecture | `information-architecture`, `navigation` |
| 4 | Flows | `flow-design`, `product-behavior` |
| 5 | Screens | `platform-posture`, `product-behavior` |
| 6 | Interactions | `controls-and-menus`, `discoverability`, `forms` |
| 7 | Copy guidance | `content-design` |
| 8 | Accessibility considerations | `accessibility` |
| 9 | Validation plan | `usability-evaluation`, `research-scoping`, `quantitative-validation` |

Screens: structure and behavior only — no visual styling specs.

## Steps

1. Emit a short Lamina work plan (`orchestration.md`).
2. **Step 1 — Cast:** Write `.lamina/personas.yaml` (persona registry). Load `lamina/artifacts.md` for shape.
3. Work through sections 1→9 in order; apply loaded capability frameworks to each section.
4. **Step 4 — Persona panel:** After flows are drafted, run persona panel on draft flows (`orchestration.md` Persona panel). Write `.lamina/personas/simulations/<run_id>.yaml`; reconcile conflicts into the Flows section.
5. After sections 3 and 6, offer: *"Continue or revise?"* — skip these gates if the user asked for a full pass in one shot.
6. **Step 9 — Validation plan:** Map simulation blockers from `personas/simulations/` to real usability test tasks.
7. Merge sections into the output contract below.
8. On conflicts between sections, use `decision-making`.

## Output

Use these exact headings:

```markdown
## Ideation: <problem>
### User model
### Journey
### Information architecture
### Flows
### Screens (structure and behavior)
### Interactions
### Copy guidance
### Accessibility considerations
### Validation plan
### Persona simulation notes
### Open questions
```

## Subagent hints

- **Fresh context:** if the user attaches large research docs, isolate synthesis for step 1 and return a summary
- **Persona panel:** step 4 (flows) — one subagent per persona, parallel; see `orchestration.md`
- **Parallel review:** not typical until screens exist (step 5+)
- Default: inline sequential
