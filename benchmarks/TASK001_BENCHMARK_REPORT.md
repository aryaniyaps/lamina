# LaminaBench Task 001 Publication Result

Date: 2026-07-16

Release: `bench-v1`

Harness: `1.7.0`

Results contract: `2.3.0`

Model: `gpt-5.6-sol` through Codex subscription authentication

Methodology: `design_c_ecological_matched_phases`

## Claim status

**`claim_ready: true` — `publishable_for_declared_task_only`.**

This result supports a claim about registered Task 001 (Household Budgeting)
under the pinned protocol below. It does not support a LaminaBench core-suite
claim or generalization to other tasks, categories, models, or runtimes.

## Primary result

The frozen-before-execution aggregation uses the median of three independent
runs within each arm. Treatment achieved a median reward of **0.8210**, compared
with **0.7960** for control, for a task-specific lift of **+0.0250 (+2.50
percentage points)**.

| Run | Control | Treatment | Treatment - control |
|---:|---:|---:|---:|
| 1 | 0.7882 | 0.8210 | +3.28pp |
| 2 | 0.8041 | 0.8405 | +3.64pp |
| 3 | 0.7960 | 0.7590 | -3.70pp |
| **Protocol median** | **0.7960** | **0.8210** | **+2.50pp** |

All six scheduled cells completed. There were no agent failures, invalid
artifacts, incomplete scores, quality-probe failures, or excluded trials.

## Adversarial sensitivity and interpretation

The positive primary result is modest and not uniform:

- Treatment won two of the three matched replications, not all three.
- The arithmetic run mean was 0.8068 for treatment and 0.7961 for control, a
  smaller **+1.07pp** difference.
- Run 3 favored control by 3.70pp, showing meaningful run-to-run variation.
- The aggregate's task-level treatment win rate is 100% because the single
  registered task's treatment median is higher. It must not be described as a
  100% replication win rate.
- The generated bootstrap interval is `[+2.50pp, +2.50pp]` because the
  inference unit is one task. That degenerate interval contains no useful
  uncertainty information and must not be presented as evidence of precision.

The defensible conclusion is therefore that the Lamina treatment produced a
higher median judged reward on Task 001 under this protocol, with a +2.50pp
primary effect and a +1.07pp arithmetic-mean sensitivity effect. The experiment
does not establish a stable effect beyond Task 001.

## Fairness and provenance checks

- Exactly six unique cells were ingested: Task 001, two arms, runs 1-3.
- Each replication launched control and treatment concurrently from fresh,
  arm-specific workspaces; replications ran sequentially to avoid workspace
  collisions.
- Both arms used the same model pin, five phases, whole-trial timeout, task
  brief, base runtime, quality probe, verifier, and scoring contract.
- Every row records clean-worktree commit
  `1c450937015f1eeb536f31f4a53a3003bb0c6536`.
- Every row records protocol SHA-256
  `933fa0bba67e60f79a0bace9b0f9ced6fc852243dd38b95834a952868dfebcca`.
- Every row records runtime image
  `sha256:6de4cf0b8c830b34b2048e04c98fa0358bbf1add6d7e9d0cfffb76027bd55c14`.
- The treatment-only difference is the registered Lamina workflow/skill
  surface; arm identity is not supplied to the structured behavior judge.
- Independent quality checks passed for all cells, all implementation captures
  were valid, and each subscription judge succeeded on its first attempt.
- Intention-to-treat rules were active: an agent or artifact failure would have
  remained in its scheduled cell as a zero rather than being excluded.

## Claimable wording

> On LaminaBench Task 001 under the pinned `bench-v1` protocol, the Lamina
> treatment achieved a median reward of 0.821 across three runs versus 0.796
> for control, a +2.50 percentage-point task-specific difference. Treatment
> won two of three matched replications; the arithmetic-mean difference was
> +1.07 points. This is a Task 001 result, not a core-suite or general benchmark
> claim.

## Result files

- Raw trial index: `benchmarks/results/raw/index.jsonl`
- Raw rewards: `benchmarks/results/raw/rewards.jsonl`
- Generated aggregate: `benchmarks/results/aggregated/benchmark.json`
- Methodology: `benchmarks/METHODOLOGY.md`

