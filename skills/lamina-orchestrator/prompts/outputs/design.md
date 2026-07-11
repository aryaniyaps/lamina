### Domain and invariants
Brief summary. Machine-readable: `run.yaml` `domain` block.

### Actors and permissions
Brief summary. Machine-readable: `run.yaml` `actors` and `.lamina/personas.yaml`.

### Workflows
Brief summary. Machine-readable: `run.yaml` `workflows`.

### Dependencies
Brief summary. Machine-readable: `run.yaml` `domain.dependencies[]` and `workflows[].requires`.

### Scenarios
Brief summary. Machine-readable: `run.yaml` `scenarios[]` (including `dependency_ref` where applicable).

### UX surfaces
Brief summary. Machine-readable: `run.yaml` `screens[]` when applicable.

### Trade-offs and decisions
Material choices only.

### Implement brief
`.lamina/runs/<run_id>/implement.md` — stack-agnostic contract for external build, including build/setup order from dependency graph. **Status: ready_to_build.**

### Open questions
Unresolved gaps only.

### Next step
Implement with your chosen stack, then run `/lamina-verify`.
