# Compact skill architecture migration

This directory records the measured migration from Lamina's 59 public sibling
skills toward the smallest public interface that preserves routing, authority,
provider installation, and lazy context loading.

The production architecture remains the ADR-003 sibling layout until the
experiment selects a winner and every release gate passes. Candidate manifests
belong under `evals/fixtures/skill-architectures/`, never beside production
skills during evaluation.

## Review stack

| Layer | Scope | Production behavior |
|---|---|---|
| 1. Decision contract | Proposed ADR, thresholds, weights, stack boundaries | Unchanged |
| 2. Baseline and traceability | Reproducible inventory, normative ledger, coverage checks | Unchanged |
| 3. Candidate fixtures | Shared internal references plus isolated six- and one-skill manifests | Unchanged |
| 4. Comparative evaluation | Routing, context, safety, mutation, install-fixture, and score reports | Unchanged |
| 5. Decision | Recorded automated and developer-study evidence; accepted or rejected ADR | Unchanged |
| 6. Production migration | Winning layout, verifier, eval/benchmark staging, installer, doctor, docs | Changes only after approval |
| 7. Release and compatibility | Alpha through GA, migration and rollback evidence | Release-gated |

Each pull request is based on the preceding branch. Reviewers should review and
merge from the bottom of the stack upward. When a lower layer changes, higher
layers must be rebased and their generated evidence refreshed.

## Evidence ownership

- `decision-criteria.json` owns fixed thresholds, context budgets, weights, and
  disqualifying failures.
- `baseline-inventory.json` and `baseline-report.md` will own measurements from
  the pinned baseline commit.
- `normative-ledger.json` will own rule identifiers, source locations,
  classifications, destinations, loading conditions, and tests.
- Candidate architecture manifests will own public roots, references, routing
  profiles, legacy names, expected install inventory, and context budgets.
- Comparison reports will name the Git commit, variant, provider, model, loaded
  references, instruction estimate, and outcomes.

Generated reports must be reproducible from committed source and must identify
the baseline commit. Human-study results remain separate from automated results
and may not be fabricated or inferred from repository tests.

## Exit boundaries

The experimental stack may add fixtures and evaluators, but it may not:

- remove or nest a production public skill;
- change the documented public installation command;
- claim that one or six has won;
- mark ADR 003 superseded;
- remove a historical installation directory;
- publish a compact release.

Those actions belong to the post-decision production and release layers.
