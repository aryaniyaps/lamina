### Dependencies / reachability
First-class. Machine-readable: `run.yaml` `domain.dependencies[]` with `mode`, linked scenarios, `workflows[].requires`.

### Actors and permissions
Brief summary. Machine-readable: `actors` + `resource_filters` and `.lamina/personas.yaml`.

### Workflows
Brief summary including success/degraded/failure. Machine-readable: `run.yaml` `workflows`.

### Scenarios
Brief summary. Machine-readable: `scenarios[]` with `acceptance` and `dependency_ref` where applicable.

### UX surfaces
Brief summary. Machine-readable: `screens[]` with **`a11y`** on every `status: new` screen.

### Seed / out of scope
Fixture world + bans. Machine-readable: `seed`, `out_of_scope`, `forbidden_content`.

### Contract simulation
Persona-panel gaps folded into deps/scenarios/screens (ids touched) — including unmet-dependency walks.

### Trade-offs and decisions
Machine-readable: `tradeoffs[]` with **stable brief-aligned ids** (`choice`, `cost`, `surfaces`). Do not list CI/CD, deploy, or push infra as design decisions unless the brief requires them.

### Implement brief
`.lamina/runs/<run_id>/implement.md` — ship pack with **Reachability graph** + **Must-implement checklist**. Validator passed. **Status: ready_to_build.**

### Open questions
Unresolved gaps only.

### Next step
Implement from `run.yaml` + `implement.md` (any stack that fits the brief), then run `/lamina-verify`.
