# LaminaBench Exploratory Development Results (Not Claim-Ready)

Date: 2026-07-16

Release: `bench-v1`

Historical harness label: `1.5.1`

Historical results contract: `2.1.0` (superseded by frozen-forward contract `2.3.0`)

Model: `gpt-5.6-sol` through Codex subscription authentication

Methodology: `design_c_ecological_matched_phases`

## Claim status

**`claim_ready: false` — exploratory development evidence only. Do not cite this
file as the LaminaBench core publication result.**

The observed rows cover Tasks 001–005. That is a mixed convenience set, not the
predeclared core (`001`, `003`, `005`, `007`, `009`). It has one run per arm,
while the frozen publish requirement is three. It also lacks per-trial protocol,
clean-worktree, runtime-image, and schedule attestations required by contract
`2.3.0`.

More importantly, Tasks 001–003 were agent-run before the structured scorer was
finalized and were rescored later from sealed artifacts; benchmark verifier and
Lamina skill hardening were committed after outputs were available. All observed
pairs also ran control before treatment. Those facts make this a useful
retrospective development analysis, but not a frozen-protocol causal comparison.

## Exploratory summary

Treatment achieved a mean reward of **0.8452**, compared with **0.6439** for
control, for an exploratory mean lift of **+0.2013 (+20.13 percentage points)**.
Treatment won four of five task pairs. The task-level bootstrap 95% interval for
the mean lift was **+3.74 to +36.52 percentage points**.

These numbers are descriptive and hypothesis-generating, not the publication
result. They do not establish run-to-run stability or generalization. Treatment
also did not win uniformly:
Task 004 was an effective tie, with treatment lower by 0.15 points on a
100-point scale.

## Observed development aggregate

| Metric | Result |
|---|---:|
| Paired tasks | 5/5 |
| Included trials | 10 |
| Judge-incomplete rows | 0 |
| Control mean reward | 0.6439 |
| Treatment mean reward | 0.8452 |
| Mean treatment lift | +0.2013 (+20.13pp) |
| Descriptive task bootstrap interval | +3.74pp to +36.52pp |
| Treatment win rate | 80% (4/5 tasks) |
| Agent failures | 0 |
| Invalid artifacts | 0 |
| Incomplete judge results | 0 |

## Per-task scorecard

| Task | Category | Control | Treatment | Delta | Control judge | Treatment judge | Control coverage | Treatment coverage |
|---|---|---:|---:|---:|---:|---:|---:|---:|
| 001 Household Budgeting | Greenfield design | 0.7140 | 0.8326 | +11.86pp | 3.58/5 | 4.00/5 | 86.11% | 98.61% |
| 002 Clinic Scheduling | Greenfield design | 0.4500 | 0.9111 | +46.11pp | 3.75/5 | 4.50/5 | 97.06% | 98.53% |
| 003 Plane Recurring Tasks | OSS feature | 0.7905 | 0.8261 | +3.56pp | 3.83/5 | 3.92/5 | 93.10% | 100.00% |
| 004 Commerce Wishlist | OSS feature | 0.8317 | 0.8302 | -0.15pp | 4.00/5 | 4.08/5 | 98.33% | 95.00% |
| 005 Commerce Checkout Audit | OSS audit | 0.4333 | 0.8258 | +39.25pp | 2.83/5 | 4.08/5 | 40.38% | 92.31% |

## Task findings

### Task 001 — Household Budgeting

Treatment improved reward from 0.7140 to 0.8326. The calibrated judge moved
from 3.58/5 to 4.00/5, while checklist coverage rose by 12.50 percentage points.
The control artifact scored 3/5 on product rules, workflow quality, edge
coverage, UX expression, and overall product behavior. Treatment raised every
strict dimension to 4/5. Both arms passed their independent build and test
checks, so the +11.86pp delta is behavioral rather than a quality-cap effect.

### Task 002 — Clinic Scheduling

Treatment produced the largest observed lift: 0.4500 to 0.9111 (+46.11pp). Its
judge mean reached 4.50/5, including 5/5 scores for domain structure, product
rules, permissions, data integrity, brownfield fit, and implementation
readiness. The treatment artifact independently built and tested successfully.

Control received a 0.45 quality cap because its declared build required `pnpm`
but the runnable artifact did not make that package-manager path available in
the independent environment. Its implementation-readiness dimension was 2/5.
The cap is a general buildability rule and was not introduced or changed after
seeing this task's output.

### Task 003 — Plane Recurring Tasks

Treatment improved reward from 0.7905 to 0.8261 (+3.56pp). Checklist coverage
reached 100%, and accessibility improved from 3/5 to 4/5. The remaining strict
dimensions were broadly tied, including a shared 3/5 implementation-readiness
score.

The full Plane fixture's build check failed in both arms because Turborepo could
not locate the package-manager binary. This check is configured as optional for
the pinned brownfield fixture, so neither arm was capped. The symmetric failure
does not explain the treatment delta.

### Task 004 — Commerce Wishlist

This pair was an effective tie. Treatment's strict-dimension result was slightly
better: judge mean 4.08/5 versus 4.00/5, driven by a 5/5 brownfield-fit score.
However, its checklist coverage was lower (95.00% versus 98.33%), producing a
final reward of 0.8302 versus 0.8317 (-0.15pp).

Both artifacts independently built and tested, neither received a cap, and
neither had a critical behavior marked missing. The first results were retained;
there was no score-driven rerun or task-specific skill change to manufacture a
treatment win.

### Task 005 — Commerce Checkout Audit

Treatment improved reward from 0.4333 to 0.8258 (+39.25pp). Its judge mean rose
from 2.83/5 to 4.08/5, checklist coverage more than doubled, and product-rule
quality reached 5/5. The treatment implementation included the required
shipping, payment, confirmation, declined-payment recovery, address-validation
recovery, totals integrity, and durable/idempotent checkout behavior. Its build
and tests passed independently.

Control built and tested, but implemented a strong cart and hosted-checkout
handoff rather than the requested end-to-end checkout. The verifier found six
critical omissions: payment-before-confirmation, shipping entry, payment,
confirmation, payment-decline recovery, and address-validation recovery. The
general critical-behavior rule applied a 0.55 ceiling; the calculated reward was
already below that ceiling at 0.4333.

## Historical scoring contract used for this retrospective analysis

The benchmark changes in this release make the result harder to game and more
focused on implemented product behavior:

1. **Calibrated application-source scoring.** The reward combines 65% strict
   product-behavior dimensions with 35% brief-derived item coverage. The judge
   evaluates domain structure, enforceable rules, permissions, workflows,
   recovery, data integrity, systems judgment, UX, accessibility, brownfield
   fit, readiness, and overall behavior.
2. **Independent quality gates.** A separate build/test probe runs after the
   agent. Required build failures and critical missing product behavior can cap
   otherwise fluent artifacts. Optional fixture-level checks are recorded
   without asymmetrically capping both arms.
3. **Delta-aware artifact capture.** Brownfield trials use a pre-agent baseline
   and capture every changed application file plus representative context.
   Generated outputs, dependencies, caches, plans, and verifier-owned files are
   excluded from the scored application artifact.
4. **Artifact-first scoring.** Each arm gets one agent invocation
   and its first sealed artifact is judged. Judge retries are permitted only for
   provider/infrastructure failure; low scores do not trigger agent reruns.
5. **Nominally matched resources.** Both arms used the same model name, five
   phases, whole-trial timeout, task fixture, and judge contract. The historical
   run did not attest one pinned runtime image or counterbalanced schedule, so
   runtime/order equality cannot be claimed from these rows alone.
6. **Generic skill hardening.** Lamina skills now emphasize complete executable
   chains, trusted enforcement, multi-actor handoffs, production-shaped local
   adapters, identity proof, concurrency and durable-commit safety, organically
   reachable recovery states, and dynamic accessibility.
7. **Anti-leak discipline.** Shared skills and verifier logic avoid task IDs,
   golden phrases, evaluator-oriented identifiers, and task-specific score
   coaching. Regression coverage checks the synchronized task verifier surface.

## Artifact and capture integrity

All ten scored artifacts were valid. For the three brownfield tasks, every
detected changed file was included:

| Trial | Capture mode | Changed files included | Captured files | Artifact size |
|---|---|---:|---:|---:|
| 003 control | delta + context | 44/44 | 93 | 180,542 bytes |
| 003 treatment | delta + context | 44/44 | 93 | 180,505 bytes |
| 004 control | delta + context | 41/41 | 96 | 154,143 bytes |
| 004 treatment | delta + context | 30/30 | 92 | 168,254 bytes |
| 005 control | delta + context | 25/25 | 82 | 153,442 bytes |
| 005 treatment | delta + context | 40/40 | 97 | 155,302 bytes |

Tasks 001 and 002 are greenfield fixtures and used representative-tree capture.
Their artifact sizes ranged from 78,085 to 174,173 bytes.

Task 005 control judging completed before an interactive parent-runner session
was interrupted, but the final job metadata and workspace snapshot had not yet
been written. Its sealed verifier output, reward, quality record, manifest, and
agent log were preserved. Only `result.json` ingestion metadata was reconstructed
from those records, with an explicit recovery marker and
`workspace_snapshot: false`; the artifact and score were not changed, and the
agent was not rerun.

## Historical validation record

The repository-level validation completed successfully:

- `npm test`
- `node tests/harbor_sync_test.mjs`
- `python3 -m unittest tests/rewardkit_criteria_test.py`
- `python3 -m py_compile benchmarks/harbor/verifier/*.py`
- `git diff --check`
- Under contract 2.1.0, `npm run bench:report` ingested 10/10 historical trials
  and rebuilt this mixed-set 5/5 paired aggregate

## Adversarial audit findings

- **Wrong published sample:** observed Tasks 001–005 do not equal the declared
  core Tasks 001, 003, 005, 007, and 009.
- **Post-hoc contract evolution:** early artifacts were rescored after verifier,
  capture, quality-cap, and skill changes. This is legitimate exploratory
  reanalysis but not preregistered evaluation.
- **Fixed arm order:** control always preceded treatment, confounding assignment
  with temporal service and repository drift.
- **Insufficient replication:** one run per arm cannot estimate run variance.
- **Historical survivorship risk:** the old aggregator excluded agent failures;
  contract 2.2.0 uses intention-to-treat zeroes and blocks claims on judge
  missingness.
- **No immutable provenance:** the old rows record version strings but not a
  clean commit, protocol digest, runtime image, or schedule position.
- **Judge scope:** the score is one model-based structured rubric, not an
  empirically human-calibrated measure or objective proof of product quality.
- **Small public corpus:** the five-task interval is descriptive, and benchmark-
  guided product development limits out-of-sample claims.

## Interpretation and limitations of the observed rows

- The treatment workflow materially outperformed control on this five-task
  sample, with the largest gains on clinic scheduling and checkout auditing.
- The Wishlist tie shows that stronger strict-dimension judgment does not
  guarantee a higher composite when brief-item coverage falls. The benchmark is
  sensitive to both depth and breadth, as intended.
- The next valid release step is `npm run bench:run -- --publish --fresh` from a
  committed clean tree. It runs the exact core three times per arm under the
  frozen protocol, pinned runtime, and counterbalanced schedule.
- The positive bootstrap interval is exploratory because it is based on only
  five task pairs and does not capture within-task model variance.
- The completed historical scope is the convenience set Tasks 001–005. It is not
  the declared five-task core and must not be relabeled as such.

## Reproduction and result files

- Raw trial index: `benchmarks/results/raw/index.jsonl`
- Raw rewards: `benchmarks/results/raw/rewards.jsonl`
- Generated aggregate: `benchmarks/results/aggregated/benchmark.json`
- Methodology: `benchmarks/METHODOLOGY.md`
- Release configuration: `benchmarks/release.yaml`

Recompute the exploratory aggregate from the preserved raw rows without
re-ingesting old jobs under the new contract:

```bash
npm run bench:aggregate
```

`npm run bench:report` is reserved for new contract-2.3.0 jobs; old artifacts do
not satisfy its provenance and rubric gates.
