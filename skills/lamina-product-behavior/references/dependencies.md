# Dependencies

Represent a dependency as a typed Statement when one Resource's behavior relies
on another Resource or state. Dependencies prevent silent happy paths when
setup, ownership, state, or another Workflow is missing.

Example: link the Accept Invitation Workflow to the Invitation Entity with a
`lamina:dependsOn` Statement. Put `type=prerequisite`,
`required_state=pending`, criticality, and observable unmet behavior in typed
qualifiers. The Resource ids remain stable; aliases such as
`workflow.accept-invite` are human lookup handles.

## Procedure

1. Inspect every critical workflow and relationship.
2. Add only dependencies that change reachability, fidelity, lifecycle, or recovery.
3. Use typed subject/object Resource ids and a namespaced dependency predicate.
4. State observable `unmet_behavior`; do not use vague precondition prose.
5. Add one Scenario Resource with a distinct risk classification when the
   unmet behavior materially affects the product.
6. During verification, force the unmet state and confirm the product blocks, degrades, or recovers exactly as contracted.
7. For timezone data, schedulers, identity, delivery, storage, or runtime-version-specific APIs, name the current-slice adapter/runtime, owner, activation path, health check, cadence/tolerance, and fail-closed production posture.

Avoid infrastructure/vendor dependencies unless they alter user-visible product behavior.
