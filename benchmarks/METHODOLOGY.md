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

**Why we tried it:** Matches how users run Lamina in practice (multi-phase skill invocations). A phased Codex resume harness preserves one conversation while running the full loop.

**Why we rejected it as primary:** The control arm gets **one shot**; treatment gets **five phases plus verify/fix scaffolding**. A skeptical reviewer correctly reads this as “more process wins,” not “Lamina wins.” Any lift confounds Lamina’s contract machinery with extra orchestration, richer implement coaching, and unequal turn budgets. **Not claimable** as a fair A/B on Lamina.

### Design B — SkillsBench-style paired (`design_b_skillsbench_paired`)

**Shape:** Same Harbor harness for both arms. Same `instruction.md`. One continuous agent rollout per trial. Treatment = Lamina skills installed + workflow hint. Control = no skills and no workflow hint. Agent chooses when (or whether) to invoke skills.

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

**Shape:** Both arms use the **same** matched phased harness (`matched-phased-agent.sh`): five sequential `codex exec` / `codex exec resume` phases in **one session**, with one shared whole-trial safety timeout and no per-phase timeout. The harness explicitly invokes treatment skills with Codex `$skill` syntax; the following user turn asks for implement/fix from `implement.md` / `fix.md` (ordinary coding).

| Phase | Control | Treatment |
|-------|---------|-------------|
| 1 | `product-plan.md` | `/lamina-init` |
| 2 | `product-build-order.md` | `/lamina-design` (or `/lamina-verify` for audit) |
| 3 | Implement | Implement from `implement.md` + `run.yaml` |
| 4 | `product-review.md` + `product-fix-list.md` | `/lamina-verify` |
| 5 | Fix | Fix from `fix.md` |

**Why we chose it:**

1. **Ecological validity** — Treatment runs the real Lamina loop users run.
2. **Fair control** — Generic plan→implement→review→fix with the **same phase count and budgets**. Control is not a strawman single-shot agent.
3. **Claimable question** — Is Lamina’s contract/verify machinery better than “just plan and code and review” when both sides get equal process?
4. **Survives skeptical review** — We admit Lamina is a **workflow product**, not a magic skill pack. Lift, if any, comes from Lamina artifacts vs generic planning artifacts — not from giving treatment extra lives.

**Intentional difference only:** Lamina skills + `.lamina/` contracts vs generic `product-*.md` planning artifacts. Not phase count, model, whole-trial timeout, or implement opportunity.

**Equal opportunity ≠ equal phase workload (documented):** Both arms get the same five phases and the same two-hour whole-trial safety timeout; neither has a per-phase cap. Treatment skill phases are cognitively heavier than control plan/review phases — that asymmetry is the ecological product under test, not a fairness bug. Fairness means the same agent, model, task, phase count, and total time opportunity, not equal tool-call volume.

**Independent replications:** Every `(task, arm, run)` cell starts from a freshly synced workspace. `--runs N` trials do not reuse prior agent artifacts.

### Other rejected mechanisms

| Mechanism | Why rejected |
|-----------|--------------|
| **Clarify auto-reply** | Synthetic mid-run user replies = harness babysitting; muddies unattended loop claim |
| **Scoring `.lamina/` or planning markdown** | Outcome claim is **implemented product behavior**; `product-*.md` / `.lamina/` are inputs, not deliverables |
| **Brief injection parity** | Every phased prompt includes the task brief for both arms; control no longer references brief without text |
| **Meta-priming (`bench-*` filenames)** | Control artifacts renamed to `product-*`; harness says "unattended trial" not "benchmark" |
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
| **Workflow docs** | None | None (harness sends `/lamina-*`) |
| **Workflow** | Generic 5-phase loop | Lamina 5-phase loop |
| **Phase 1** | `product-plan.md` (product plan) | `/lamina-init` |
| **Phase 2** | `product-build-order.md` | `/lamina-design` (or `/lamina-verify` for audit) |
| **Phase 3** | Implement from plan | Implement from `implement.md` + `run.yaml` |
| **Phase 4** | `product-review.md` + `product-fix-list.md` | `/lamina-verify` |
| **Phase 5** | Fix from `product-fix-list.md` | Fix from `fix.md` |
| **Scored output** | Application source at trial end | Application source at trial end |

`instruction.md` **never names Lamina skills**. Planning artifacts (`product-*.md`, legacy `bench-*.md`, `.lamina/`) are excluded from scoring.

## How trials run

```bash
npm run bench:harbor:sync
npm run bench:run
```

Both arms use the same matched phased harness (`matched-phased-agent.sh`): five sequential Codex exec/resume phases with one equal whole-trial timeout and no per-phase cap. Treatment skills are harness-invoked with `$lamina-*`; implement/fix are the next user turns in the same session. Harbor task dirs supply fixtures, instructions, and the Rewardkit verifier; Docker runs agent + verifier.

## Scoring pipeline (per trial)

1. **Hidden verifier boundary** — the agent receives the task brief and phase harness, but not `/tests`, the golden checklist, judge prompt, or scoring code. Verifier files are mounted only after the agent exits.
2. **Independent quality probe** — the verifier runs a bounded discovered build/typecheck and, when declared, the product test command. It records every command, exit status, and output. A declared test failure is counterevidence; a pass is never treated as product proof. Any failed quality step caps reward at `0.45`; a greenfield product with no discoverable required build/typecheck is capped at `0.70`.
3. **Calibrated behavior judge** — agent-authored tests and planning files are excluded. The blind judge scores executable application source on strict 1–5 anchors (a solid implementation is 4; 5 is exceptional), and separately scores every hidden checklist item `0/1/2` with real-path evidence and counterevidence.
4. **Complete-when-bounded capture** — when the application source fits within the bounded judge context, every eligible source file is captured in full. Larger repositories use content-addressed representative excerpts across file interiors/tails and logical subtrees so neither monoliths nor alphabetically early folders dominate evidence.
5. **Composite** — `65%` weighted behavior dimensions + `35%` item-level coverage. A missing critical invariant, persona, rule, primary flow, or scenario caps reward at `0.55`.
6. **Gates** — `finalize_reward.py` sets `reward = 0` when `artifact_valid` is false, `clarify_stall` is true, or the judge is degraded (`scoring_incomplete`). Incomplete trials are excluded from claim aggregates.
7. **Ingest** — `npm run bench:ingest` reads job dirs → `results/raw/index.jsonl` + `rewards.jsonl`, including dimension score, checklist coverage, missing critical items, and quality caps. Only the exact current results contract and rubric version are claim-compatible.
8. **Model pin** — Runner uses `release.yaml` `model`; `CODEX_MODEL` may only differ when `LAMINA_BENCH_ALLOW_MODEL_OVERRIDE=1`. Codex reasoning effort is pinned high; temperature/top_p remain intent-only.

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

1. **Do not recover** — No synthetic auto-reply if a Lamina skill clarify-and-STOPs.
2. **Fail** — Verifier assigns reward `0` on clarify stall / missing deliverables; agent phase errors (non-zero exit, max-turns) fail the trial (no soft complete).
3. **Measure** — `clarify_stall` flag (diagnostic, not in composite).

Product skills already define agent-primary behavior after `ready_to_build` / verify (Mode B). The harness does not override clarify-and-STOP.

## Fairness constraints

- Same agent, model pin, task brief, fixture, **phase count**, and **whole-trial timeout**
- Control receives **no** Lamina skills and **no** Lamina workflow overlay
- Treatment receives Lamina skills only; workflow is harness-sent `$lamina-*` invocations (no workflow overlay)
- Control implement/fix prompts are **budget-matched** to treatment (same completeness requirements)
- Implement framing (both arms) asks for a **working product codebase** for scored behaviors; CI/CD and production ops are explicitly out of scope — reduces scope-refusals without weakening product requirements
- Blind calibrated judging of application source plus verifier-produced build evidence; hidden checklist and verifier files are never available to the coding agent
- `claim_ready: false` until live paired runs with replication

## How to cite results honestly

**Do say:**

> Under Design C (matched multi-phase harness), compare the Lamina init→design→verify loop against the generic plan→review loop only when both cells use the exact same current results contract and rubric version. Report the observed paired delta; do not mix legacy scores into the claim.

**Do not say:**

> Lamina beat a single-shot unaided agent (unless you run that as a separate labeled ablation).

> Skills alone make agents better in one continuous session (that is Design B — optional ablation, not primary).

> The agent autonomously discovered Lamina — treatment is driven by harness-prescribed slash commands.

## Optional ablations (not primary)

See [Design evolution](#design-evolution--what-we-considered-and-why-we-landed-here) for full rationale. Brief list:

- **Design B (SkillsBench single session)** — skills on/off, one continuous rollout; does not represent real usage
- **Naive single-shot** — Lamina loop vs “just build it”; process vs no-process demo
- **Loop ablation** — stop after implement vs full verify+fix

Document any ablation with its own methodology id and job artifacts. Do not mix into Design C aggregates.

## Superseded methodology

**Design B** (`design_b_skillsbench_paired`) and **Design A** (`design_a_ecological`) — see [Design evolution](#design-evolution--what-we-considered-and-why-we-landed-here). Superseded as primary because neither matches both real usage *and* fair paired comparison. Design B remains an optional ablation; Design A is rejected outright.
