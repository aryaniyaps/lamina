# Minimum transactional product graph

Use generic Resources with kinds defined by the runtime. Represent every semantic fact once as a Statement with subject, namespaced predicate, object or typed literal, optional scope, and semantic qualifiers.

Features are projections over Claims, Operations, and Workflows. Preconditions, states, outcomes, dependencies, classifications, workflow steps, recovery expectations, proof coverage, and surface realization are Statements. Reverse relationships are queried.

Resource ids are stable and opaque; human references are aliases. Statement ids hash normalized semantic identity. Duplicate proposals are idempotent. Evidence links to the existing Statement. Conflicts create Contradictions without deleting either side. Retirement creates version deltas and preserves history.

Ingress derives epistemic class:

| Ingress | Class |
|---|---|
| explicit intent | intended |
| CocoIndex | observed |
| agent proposal | inferred |
| Persona interpretation | simulated |
| research/customer connector | human_evidence |
| execution adapter | runtime_evidence |

Approval means shipped validators passed, required provenance/evidence exists, and no relevant Contradiction blocks it. It is not universal truth.
