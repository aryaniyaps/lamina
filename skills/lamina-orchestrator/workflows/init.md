# /lamina-init workflow

## Establish

1. Read repository context for brownfield work; otherwise use the supplied idea and research.
2. Capture the problem, desired outcome, users, product posture, current scope, constraints, and success signals in `.lamina/business-context.md`.
3. Identify up to three questions whose answers would materially change ownership, trust, lifecycle, monetization, destructive behavior, or regulatory posture.
4. In an interactive session, ask those questions together. In unattended work, continue with labeled assumptions when the brief already identifies goals, users, scope, and constraints.
5. Write `.lamina/personas.json` with `contract_version: "2.0"` and evidence-grounded personas. Every persona includes role, goals, constraints, evidence references, confidence, and whether it is primary.
6. Keep provisional or inferred personas at low or medium confidence. Never claim simulation replaces research.

## Update

Merge new evidence into business context, append a dated decision note, update persona evidence/confidence, and flag prior runs whose intent or actors may now be stale. Do not rewrite historical run artifacts.

## Blocking rule

Stop only when problem, target users, current scope, or a consequential constraint is absent and guessing would materially change the product. Do not stop for reversible defaults or details that the design graph can label as assumptions.
