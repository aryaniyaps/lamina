# LaminaBench methodology

**Design B — SkillsBench-style paired comparison** (`design_b_skillsbench_paired`)

Machine-readable pin: [`methodology.json`](methodology.json) · Release pin: [`release.yaml`](release.yaml) · Runner: [Harbor](https://www.harborframework.com/)

---

## The question we answer

> **Given the same product brief, does installing Lamina skills and adopting the Lamina workflow conventions in AGENTS.md/CLAUDE.md produce better implemented product behavior than running without them?**

This is a **paired skills evaluation** in the spirit of [SkillsBench](https://github.com/benchflow-ai/SkillsBench): same task, two conditions, one continuous agent rollout each.

## What each arm represents

| | **Control** | **Treatment** |
|---|-------------|---------------|
| **Harbor task** | `taskNNN-control` | `taskNNN-treatment` |
| **Instruction** | `instruction.md` (product brief only) | Same `instruction.md` |
| **Lamina skills** | Not installed | Installed under agent skill path |
| **Workflow hint** | No AGENTS.md / CLAUDE.md | AGENTS.md + CLAUDE.md prescribe `/lamina-init` → `/lamina-design` → implement → `/lamina-verify` → fix |
| **Agent rollouts** | 1 continuous | 1 continuous |
| **Scored output** | Application source at trial end | Application source at trial end |

`instruction.md` **never names Lamina skills** (SkillsBench rule). Workflow guidance lives only in treatment project conventions.

## How Harbor runs trials

```bash
harbor run --path benchmarks/harbor/tasks \
  --agent claude-code \
  --model <pin> \
  --agent-kwarg prompt_template=benchmarks/harbor/prompt_template.j2
```

Harbor owns container isolation, parallelism, agent launch, and verification. LaminaBench tasks live in `benchmarks/harbor/tasks/`; `npm run bench:harbor:sync` refreshes fixture workspaces and verifier bundles before runs. Scoring uses golden coverage + LLM rubric on bundled source.

## Unattended runs (no mid-run user)

Peers assume unattended agents. Lamina skills can emit clarify-and-STOP in interactive use. For benchmarks:

1. **Prevent** — `prompt_template.j2` + treatment `AGENTS.md`/`CLAUDE.md` state the user cannot respond; the brief is authoritative; proceed with labeled assumptions instead of clarifying.
2. **Do not recover** — No synthetic auto-reply. If the agent exits after asking questions, the workspace is incomplete.
3. **Fail** — Verifier assigns reward `0` when deliverables are missing.
4. **Measure** — Post-hoc `clarify_stall` flag from agent output (secondary metric, not in composite).

High treatment stall rates are a real signal (skills not bench-safe unattended), not something to paper over.

## Fairness constraints

- Same agent, model pin, task brief, fixture, and Harbor `prompt_template` per paired comparison
- Control receives **no** Lamina skills and **no** workflow AGENTS.md/CLAUDE.md
- Blind LLM judging of source code (human review optional, not in composite)
- `claim_ready: false` until live runs and a real LLM judge (not heuristic-only)

## How to cite results honestly

**Do say:**

> Under Design B (SkillsBench-paired), the same agent with Lamina skills + workflow conventions scored higher on checklist coverage and LLM rubric scores of implemented source than the no-skills control on the same brief.

**Do not say:**

> The agent autonomously discovered Lamina without hints — treatment includes AGENTS.md/CLAUDE.md workflow guidance.

> Lamina won with harness-scripted slash commands — Design B uses one continuous rollout; the agent chooses when to invoke skills.

## Legacy Design A (removed)

The prior ecological adoption design (`design_a_ecological`) used harness-forced 2-phase control vs 5-phase treatment. It was removed in v1 in favor of Harbor-only Design B.

## Optional ablations (not primary)

- **Pure skill discovery** — skills installed, no AGENTS.md hint (multiturn-eval style)
- **Clarify auto-reply** — separate harness variant; do not mix with Design B primary results

Document any ablation under `releases/` with its own methodology id.
