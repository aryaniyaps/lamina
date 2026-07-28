# Lamina evals

The eval suite checks routing, init gates, transactional graph behavior, source-edit guardrails, uncapped Persona Missions, and epistemic spoof resistance.

```bash
pnpm test:eval:spec
pnpm test:eval:validate
pnpm test:eval:smoke
pnpm test:eval:full
pnpm test:eval:redteam
```

`evals/scripts/merge-evals.mjs` generates the combined suite JSON. Transactional assertions query live graphd state, require session/GraphVersion publication and Mission evidence, and reject writes to legacy run directories. The write-boundary checker permits `.lamina/` evidence and the shared Git-common-dir `lamina/` runtime while rejecting product-source writes.

Every eval run installs all 59 public Lamina skills before the first agent
turn. A suite's `skill_name` controls the primary forced invocation only; all
cross-referenced sibling skills remain discoverable in the same workspace.

The current grader has no legacy run-artifact reader. Historical prompts may mention those files only to prove that they are ignored and never treated as runtime state.

The `Eval Spec` workflow runs the full repository unit suite plus strict eval validation on every pull request and every push to `main`, so runtime, benchmark, and test-only changes cannot bypass the clean-checkout gate.
