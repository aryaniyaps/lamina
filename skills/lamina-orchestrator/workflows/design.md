# Product graph workflow

## 1. Select depth

- Use `spark` when the idea itself is being shaped.
- Use `shape` when the next build needs a coherent product slice.
- Use `harden` when consequential behavior is approaching trusted release.

Do not increase depth merely because the schema supports more fields.

## 2. Establish intent

Record the user problem, outcome, target users, critical promises, constraints, success signals, and current scope. Ask at most three questions, only for high-impact ambiguity. In unattended work, label coherent assumptions and unresolved policy forks.

## 3. Build the minimum graph

Add:

- Actors with goals, ownership, and authority.
- Entities with identity, states, relationships, and lifecycle consequences.
- User-visible operations with preconditions, state transitions, effects, enforcement, failures, and recovery.
- End-to-end workflows with reachable terminal outcomes.
- Invariants at the trusted enforcement boundary.
- Dependencies with explicit unmet behavior.
- Surfaces only when they materially realize the workflow.

Every node declares criticality, provenance, confidence, and relevance. Defer non-current behavior.

## 4. Derive distinct risks

Run `graph-tool.mjs derive`. Cover declared failures, unmet dependencies, destructive actions, authority boundaries, concurrency, and recovery. Add only risks that produce meaningfully different product behavior.

## 5. Walk perspectives

Select the primary actor, most constrained actor, and operational actor when distinct. Use [the persona panel protocol](../patterns/persona-panel.md) and [its isolated reviewer contract](../prompts/subagents/persona-panel-spawn.md). Cite graph nodes and classify every finding. Promote structural, safety, contradiction, and evidence-backed findings; retain preference findings as research hypotheses.

## 6. Validate readiness

Resolve contradictions and blocking policy forks. Confirm each critical promise traces through actor, entity, operation, workflow, invariant, and scenario. Validate `run.json`, switch to `ready_to_build`, validate again, and render generated artifacts.
