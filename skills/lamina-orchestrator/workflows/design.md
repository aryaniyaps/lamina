# Transactional product-graph design

1. Resolve HEAD with `lamina graph status`.
2. Query the active graph and source observation coverage.
3. Start one explicit session for the design slice.
4. Propose generic Resources and normalized Statements. Workflow ordering is a `lamina:hasStep` Statement with a `position` qualifier. Preconditions, outcomes, states, recovery, classification, dependencies, proof coverage, and surface realization are Statements rather than duplicate node types.
5. Preserve epistemic separation. Public agent proposals remain inferred; Persona interpretation is simulated; callers cannot select intended ingress.
6. Model every relevant Persona and compile an independent Mission for each. Never cap Persona count.
7. Validate the full affected closure. If completeness cannot be proven, validate the whole branch.
8. Preserve conflicts and create Contradictions. Contradictions block approval, not history.
9. Publish atomically. Rebase after a compare-and-swap failure.
10. Render implementation Markdown only from a resolved GraphVersion query.
