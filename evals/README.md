# Lamina evals

The eval suite checks passive activation from ordinary product requests, init
gates, transactional graph behavior, pre-edit WorkMap coverage, terminal
WorkVerified receipts, live UI audit evidence, source-edit guardrails,
uncapped Persona Missions, and epistemic spoof resistance.

```bash
pnpm test:eval:spec
pnpm test:eval:validate
pnpm test:eval:smoke
pnpm test:eval:full
pnpm test:eval:redteam
```

`evals/scripts/merge-evals.mjs` generates the combined suite JSON.
Transactional assertions query live graphd state, require
session/GraphVersion publication and Mission evidence, and reject writes to
legacy run directories. Passive implementation cases do not force skill
invocation: the installed provider rule must activate Lamina, produce a
complete WorkStarted map before product edits, and finish with WorkVerified.
UI cases require distinct functional, visual, responsive, and accessibility
artifacts in both the WorkMap and live HarnessResult.

Design-only and explicit verification suites remain source-read-only override
tests. Other staged cases retain the write-boundary check, which permits
`.lamina/` evidence and the shared Git-common-dir `lamina/` runtime while
rejecting product-source writes.

Every eval run installs all 59 public Lamina skills and the supported
provider's managed passive rule before the first agent turn. A suite's
`skill_name` controls forced invocation only when the case requests it; all
cross-referenced sibling skills remain discoverable in the same workspace.

The current grader has no legacy run-artifact reader. Historical prompts may mention those files only to prove that they are ignored and never treated as runtime state.

The `Eval Spec` workflow runs the full repository unit suite plus strict eval validation on every pull request and every push to `main`, so runtime, benchmark, and test-only changes cannot bypass the clean-checkout gate.
