# @lamina/blueprint

Semantic UX blueprint components and **UX Review Studio** — visual review of personas, flows, edge-case coverage, and greyscale wireframes for Lamina.

## CLI

```bash
lamina-blueprint review --root .lamina/blueprints --run <run_id> --id <id>
lamina-blueprint preview --root .lamina/blueprints --id <id>   # legacy alias; add --run
lamina-blueprint export-graph --root .lamina/blueprints --id <id> --stdout
lamina-blueprint validate .lamina/blueprints/<id>
lamina-blueprint validate run .lamina/runs/<run_id>/run.yaml
lamina-blueprint retire <id> --root .lamina/blueprints
```

## UX Review Studio

Four views at one local URL:

| View | Source |
|------|--------|
| **People** | `personas.yaml`, `run.yaml` simulation |
| **Flows** | `run.yaml` flows + blueprint `flows.tsx` |
| **Screens** | Blueprint SUB TSX wireframes + annotation pins |
| **Scenarios** | `run.yaml` scenarios — Gaps, Matrix, Gallery |

```bash
lamina-blueprint review --root .lamina/blueprints --run demo --id demo --ensure --open
```

Writes `.lamina/preview-state.yaml`. `--ensure` starts background server if not running; `--open` uses system browser.

People, Flows, and Scenarios work with `--run` alone. Screens requires linked blueprint SUB TSX.

### Agent API

- `GET /__lamina/runs` — list runs
- `GET /__lamina/run?run=<run_id>` — run metadata + screen inventory
- `GET /__lamina/coverage?run=<run_id>` — gaps, matrix, coverage score
- `GET /__lamina/flow-graph?run=<run_id>` — flow graph data
- `GET /__lamina/scenarios?run=<run_id>` — scenario entries
- `GET /__lamina/personas?run=<run_id>` — persona + simulation data
- `GET /__lamina/state?id=<id>&flowId=<flow>` — per-screen blueprint completeness

## Components

Import from `@lamina/blueprint`. See `skills/lamina-blueprint/SKILL.md` for the full SUB taxonomy and generation rules.

## Validation

- Blueprint structure, flow wiring, trigger matching
- Brownfield fidelity via `run.yaml` `screens[]` with `status: existing`
- `run.yaml` `scenarios[]` field validation
- Scenario variant TSX is **optional** — validated only when present
