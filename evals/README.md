# Lamina evals

The eval suite checks passive activation from ordinary product requests, init
gates, transactional graph behavior, pre-edit WorkMap coverage, terminal
WorkVerified receipts, live UI audit evidence, source-edit guardrails,
uncapped Persona Missions, and epistemic spoof resistance.

```bash
pnpm test:eval:spec
pnpm test:eval:validate
pnpm test:eval:references
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

Every eval run installs the exact 10-skill catalog for Codex, Claude Code, and
OpenCode, including every mapped nested topic. When the CLI supports a managed
passive rule for that provider, the harness installs it before the first agent
turn. A suite's
`skill_name` controls forced invocation only when the case requests it; all
cross-referenced compact skills remain discoverable in the same workspace.

`test:eval:references` is the compact cross-provider qualification matrix: one
root-router case per capability across Claude Code, Codex, and OpenCode. Each
case must show an actual read of the selected capability and exact topic,
identify the topic in the response, apply topic-specific rules, and avoid every
deprecated public skill name. The portable config also stages a direct suite
for each of the six capabilities, with two topic-selection cases apiece.
The compatibility matrix pins the local Claude proxy and OpenCode adapter to
`gpt-5.6-terra` by default; environment overrides remain explicit in the
generated report.

The current grader has no legacy run-artifact reader. Historical prompts may mention those files only to prove that they are ignored and never treated as runtime state.

The `Eval Spec` workflow runs the full repository unit suite plus strict eval validation on every pull request and every push to `main`, so runtime, benchmark, and test-only changes cannot bypass the clean-checkout gate.
