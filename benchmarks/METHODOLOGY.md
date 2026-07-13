# LaminaBench methodology

**Design C — ecological matched phases** (`design_c_ecological_matched_phases`)

Machine-readable pin: [`methodology.json`](methodology.json) · Release pin: [`release.yaml`](release.yaml) · Runner: matched phased harness in Docker (Harbor task format + Rewardkit verifier)

---

## The question we answer

> **On the same product brief, does the real Lamina loop (init → design → implement → verify → fix) produce better implemented product behavior than an equally scaffolded generic loop (plan → implement → review → fix)?**

This matches how users actually use Lamina: multi-session slash commands for design/verify, coding agent for implement/fix — not a single continuous “skills on/off” rollout.

## Design evolution — what we considered and why we landed here

LaminaBench went through several design iterations. The primary methodology is **Design C** because it matches real product usage *and* gives the control arm equal process scaffolding. Earlier designs are documented so reviewers can see what we rejected and why.

### Summary table

| Design | Arms | Primary claim it would support | Status |
|--------|------|-------------------------------|--------|
| **A — Asymmetric phased** | 5-phase treatment vs 1-shot control | “Lamina wins” (confounded) | **Rejected** |
| **B — SkillsBench single session** | Skills on/off, one continuous rollout | “Skill files help agents” | **Optional ablation** |
| **Prefix — `/lamina <brief>`** | Forced router entry vs bare brief | “Starting with `/lamina` helps” | **Rejected** |
| **C — Ecological matched phases** | 5-phase Lamina vs 5-phase generic | “Lamina loop beats matched plan→review” | **Primary (v1)** |

### Design A — Asymmetric phased treatment (`design_a_ecological`)

**Shape:** Treatment runs a harness-forced 5-phase slash-command pipeline (`/lamina-init` → `/lamina-design` → implement → `/lamina-verify` → fix). Control runs a single continuous Harbor rollout with only the product brief.

**Why we tried it:** Matches how users run Lamina in practice (multi-session slash commands). Harbor’s default `claude --print` mode exits after the first skill sub-turn, so a phased harness was the pragmatic way to run the full loop.

**Why we rejected it as primary:** The control arm gets **one shot**; treatment gets **five phases plus verify/fix scaffolding**. A skeptical reviewer correctly reads this as “more process wins,” not “Lamina wins.” Any lift confounds Lamina’s contract machinery with extra orchestration, richer implement coaching, and unequal turn budgets. **Not claimable** as a fair A/B on Lamina.

### Design B — SkillsBench-style paired (`design_b_skillsbench_paired`)

**Shape:** Same Harbor harness for both arms. Same `instruction.md`. One continuous agent rollout per trial. Treatment = Lamina skills installed + `AGENTS.md`/`CLAUDE.md` workflow hint. Control = no skills, no workflow docs. Agent chooses when (or whether) to invoke skills.

**Why we tried it:** Aligns with [SkillsBench](https://arxiv.org/abs/2602.12670) — the closest published standard for “do skills help?” Same task, paired conditions, skills as the only intentional difference.

**Why we rejected it as primary:** Users do **not** use Lamina this way. Real usage is explicit slash commands in order across sessions, not “install skills and hope the agent discovers the loop.” Design B measures skill-pack augmentation in one session — a different product claim than “the Lamina workflow produces better products.”

**Status:** Kept as an **optional ablation** (`design_b_skillsbench_single_session`). Useful for “do skill files help when the agent must choose?” — not for “does the Lamina loop work?”

### Prefix design — `<instruction>` vs `/lamina <instruction>`

**Shape:** Control gets the bare product brief. Treatment gets the same brief prefixed with `/lamina` (router entry), skills installed.

**Why we considered it:** Simple A/B; mirrors a user typing `/lamina` with their ask.

**Why we rejected it:**

1. **Incomplete loop** — `/lamina` routes to design/verify workflows that write `.lamina/` only (Mode B). Implementation and fix happen in separate coding phases. A single forced `/lamina` prefix does not run the full ecological loop the scorer cares about.
2. **Double treatment** — Confounds “forced router entry” with “skills installed.” Cannot attribute lift to either alone.
3. **Wrong comparison** — Not paired on equal process; not SkillsBench-style (instruction text differs).

### Design C — Ecological matched phases (`design_c_ecological_matched_phases`) ✓

**Shape:** Both arms use the **same** matched phased harness (`matched-phased-agent.sh`): five sequential `claude --resume` phases, equal per-phase turn budgets, shared unattended contract.

| Phase | Control | Treatment |
|-------|---------|-------------|
| 1 | `bench-plan.md` | `/lamina-init` |
| 2 | `bench-build-order.md` | `/lamina-design` (or `/lamina-verify` for audit) |
| 3 | Implement | Implement from `implement.md` + `run.yaml` |
| 4 | `bench-review.md` + `bench-fix-list.md` | `/lamina-verify` |
| 5 | Fix | Fix from `fix.md` |

**Why we chose it:**

1. **Ecological validity** — Treatment runs the real Lamina loop users run.
2. **Fair control** — Generic plan→implement→review→fix with the **same phase count and budgets**. Control is not a strawman single-shot agent.
3. **Claimable question** — Is Lamina’s contract/verify machinery better than “just plan and code and review” when both sides get equal process?
4. **Survives skeptical review** — We admit Lamina is a **workflow product**, not a magic skill pack. Lift, if any, comes from Lamina artifacts vs generic planning artifacts — not from giving treatment extra lives.

**Intentional difference only:** Lamina command skills + `.lamina/` contracts vs generic `bench-*.md` planning artifacts. Not phase count, not implement prompt verbosity, not turn budget.

### Other rejected mechanisms

| Mechanism | Why rejected |
|-----------|--------------|
| **Clarify auto-reply** | Synthetic mid-run user replies = harness babysitting; muddies unattended loop claim |
| **Scoring `.lamina/` or `bench-plan.md`** | Outcome claim is **implemented product behavior**; planning artifacts are inputs, not deliverables |
| **Mixing ablation results into Design C aggregates** | Each methodology id must have its own runner and honest claim surface |

### Optional ablations (separate methodology ids)

| Ablation | Claim | When to use |
|----------|-------|-------------|
| **Naive single-shot** | Lamina loop vs one continuous “just build it” | Product demo; process vs no-process (weaker science) |
| **Design B single session** | Skill files on/off in one rollout | SkillsBench-style skill-pack question |
| **Loop ablation** | Full loop vs stop-after-implement | Isolate verify+fix step value inside Lamina |

Never mix these into Design C primary results without relabeling.

Machine-readable design history: [`methodology.json`](methodology.json) → `considered_designs`, `rejected_alternatives`, `optional_ablations`.

## What each arm represents

| | **Control** | **Treatment** |
|---|-------------|---------------|
| **Harbor task** | `taskNNN-control` | `taskNNN-treatment` |
| **Instruction** | `instruction.md` (product brief only) | Same `instruction.md` |
| **Lamina skills** | Not installed | Installed under agent skill path |
| **Workflow** | Generic 5-phase loop | Lamina 5-phase loop |
| **Phase 1** | `bench-plan.md` (product plan) | `/lamina-init` |
| **Phase 2** | `bench-build-order.md` | `/lamina-design` (or `/lamina-verify` for audit) |
| **Phase 3** | Implement from plan | Implement from `implement.md` + `run.yaml` |
| **Phase 4** | `bench-review.md` + `bench-fix-list.md` | `/lamina-verify` |
| **Phase 5** | Fix from `bench-fix-list.md` | Fix from `fix.md` |
| **Scored output** | Application source at trial end | Application source at trial end |

`instruction.md` **never names Lamina skills**. Planning artifacts (`bench-*.md`, `.lamina/`) are excluded from scoring.

## How trials run

```bash
npm run bench:harbor:sync
npm run bench:run
```

Both arms use the same matched phased harness (`matched-phased-agent.sh`): five sequential `claude --resume` phases with equal per-phase turn budgets (`max_turns_per_phase` in `release.yaml`). Harbor task dirs supply fixtures, instructions, and the Rewardkit verifier; Docker runs agent + verifier.

## Scoring pipeline (per trial)

1. **Rewardkit dimensions** — `golden_coverage/` + `llm_judge/` scored in-container; [`reward.toml`](harbor/verifier/reward.toml) aggregates them into `composite`.
2. **Gates** — `finalize_reward.py` sets `reward = 0` when `artifact_valid` is false or `clarify_stall` is true; otherwise `reward = composite`.
3. **Ingest** — `npm run bench:ingest` reads job dirs → `results/raw/index.jsonl` + `rewards.jsonl`.

## Aggregation (cross-trial, publishable)

| Setting | Dev default | Publish target |
|---------|-------------|----------------|
| Runs per arm | `1` (`release.yaml`) | `3` (`runs_per_arm_publish`) |
| Within (task, arm) cell | median across runs | median across runs |
| Primary inference unit | task | task |
| Treatment effect | mean paired Δ (treatment − control) | same |
| Uncertainty | bootstrap 95% CI over tasks | same |

```bash
npm run bench:run -- --runs 3    # publish replication
npm run bench:report             # ingest + aggregate (also runs automatically after bench:run)
```

Paired metrics: [`harbor/dataset/metric.py`](harbor/dataset/metric.py). Output: `results/aggregated/benchmark.json`.

## Unattended runs (no mid-run user)

1. **Prevent** — phased prompts + treatment `AGENTS.md`/`CLAUDE.md` state the user cannot respond; proceed with labeled assumptions.
2. **Do not recover** — No synthetic auto-reply.
3. **Fail** — Verifier assigns reward `0` when deliverables are missing.
4. **Measure** — `clarify_stall` flag (diagnostic, not in composite).

## Fairness constraints

- Same agent, model pin, task brief, fixture, **phase count**, and **per-phase turn budget**
- Control receives **no** Lamina skills and **no** workflow AGENTS.md/CLAUDE.md
- Control implement/fix prompts are **budget-matched** to treatment (same completeness requirements)
- Blind LLM judging of source code via Harbor Rewardkit in-container verifier
- `claim_ready: false` until live paired runs with replication

## How to cite results honestly

**Do say:**

> Under Design C (matched multi-phase harness), the Lamina init→design→verify loop scored higher on checklist coverage and LLM rubric scores of implemented source than the generic plan→review loop on the same brief.

**Do not say:**

> Lamina beat a single-shot unaided agent (unless you run that as a separate labeled ablation).

> Skills alone make agents better in one continuous session (that is Design B — optional ablation, not primary).

> The agent autonomously discovered Lamina — treatment includes AGENTS.md and harness-prescribed slash commands.

## Optional ablations (not primary)

See [Design evolution](#design-evolution--what-we-considered-and-why-we-landed-here) for full rationale. Brief list:

- **Design B (SkillsBench single session)** — skills on/off, one continuous rollout; does not represent real usage
- **Naive single-shot** — Lamina loop vs “just build it”; process vs no-process demo
- **Loop ablation** — stop after implement vs full verify+fix

Document any ablation with its own methodology id and job artifacts. Do not mix into Design C aggregates.

## Superseded methodology

**Design B** (`design_b_skillsbench_paired`) and **Design A** (`design_a_ecological`) — see [Design evolution](#design-evolution--what-we-considered-and-why-we-landed-here). Superseded as primary because neither matches both real usage *and* fair paired comparison. Design B remains an optional ablation; Design A is rejected outright.
