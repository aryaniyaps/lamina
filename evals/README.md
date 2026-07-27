# Lamina evals

The eval suite checks routing, init gates, transactional graph behavior, source-edit guardrails, uncapped Persona Missions, and epistemic spoof resistance.

```bash
pnpm test:eval:spec
pnpm test:eval:validate
pnpm test:eval:smoke
pnpm test:eval:full
pnpm test:eval:redteam
```

`evals/scripts/merge-evals.mjs` is the source for generated suite JSON. Transactional assertions require graphd/session/GraphVersion behavior and reject writes to legacy run directories. The write-boundary checker permits `.lamina/` evidence and the shared Git-common-dir `lamina/` runtime while rejecting product-source writes.

Legacy artifact graders remain only for historical fixture compatibility; current cases do not treat those artifacts as runtime state.
