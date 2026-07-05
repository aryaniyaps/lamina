# /lamina-optimize

## Product

Audit one or more existing flows and return improvements ranked by impact vs effort.

## Use when

- You want a comprehensive UX audit of live or designed flows
- You need prioritized fixes (quick wins vs strategic bets)
- Improving something that already exists

## Input

- At least one of: flow name(s), screenshots, routes, URLs, or written description (required)
- Optional: primary user, business goals, known pain points

## Load

- `lamina/orchestration.md`
- Audit capabilities:

`flow-design`, `heuristic-review`, `navigation`, `discoverability`, `forms`, `error-handling`, `content-design`, `accessibility`, `trust`, `feedback-and-status`, `decision-making`

Paths: `lamina/capabilities/<id>.md`

- Optional reasoning rubrics — load when `lamina/reasoning/<file>.md` exists (skip missing files; capabilities above are sufficient):

| Dimension | Reasoning file (if present) |
|---|---|
| Navigation | `navigation-orientation-audit.md` |
| Discoverability | `discoverability-checklist.md` |
| Heuristics | `heuristic-expert-review.md` |
| Forms | `form-design-pattern.md` |
| Errors | `error-message-design.md`, `slip-vs-mistake-response.md` |
| Copy / scan | `scan-first-layout.md`, `concise-copy-principle.md` |
| Flow / effort | `cognitive-effort-minimization.md`, `execution-evaluation-gaps.md` |
| Feedback | `action-feedback-cycle.md` |
| Prioritization | `evidence-prioritization.md`, `primary-user-filter.md` |

## Steps

1. Emit a short Lamina work plan.
2. Summarize each flow under audit (scope, primary user goal, key steps).
3. Run audit lenses per flow — inline or **parallel review** per flow if the host supports it. In parallel with expert lenses, run **persona panel** per flow if `.lamina/personas.yaml` exists (one subagent per persona; see `orchestration.md`).
4. Load `decision-making` — score each finding: **impact** (high / med / low) × **effort** (high / med / low). Reconcile persona panel conflicts via primary-user filter.
5. Sort recommendations: high impact + low effort first; group into quick wins and strategic bets.
6. Write persona simulation results to `.lamina/personas/simulations/<run_id>.yaml` when panel runs.
7. Merge into output contract.

## Output

Use these exact headings:

```markdown
## UX audit: <flow(s)>
### Executive summary
### Findings by flow
### Prioritized improvements

| Priority | Finding | Impact | Effort | Recommendation |
|----------|---------|--------|--------|----------------|
| … | … | … | … | … |

### Quick wins
### Strategic bets
### Persona simulation notes
### Open questions
```

## Subagent hints

- **Parallel review** across audit lenses is the main win (same flows, independent rubrics)
- **Persona panel** per flow in parallel with expert lenses when `personas.yaml` exists
- Default: inline if parallel is unavailable
