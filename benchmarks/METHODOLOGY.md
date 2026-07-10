# LaminaBench methodology

**Design A — ecological adoption comparison** (`design_a_ecological`)

Machine-readable pin: [`methodology.json`](methodology.json) · Release pin: [`release.yaml`](release.yaml)

---

## The question we answer

> **If I adopt Lamina, will my agent produce better product behavior in code than if I plan in the IDE and implement — the path we already document as “without Lamina”?**

That is the decision a developer actually faces. LaminaBench is built to answer it, not a narrower lab question.

## What each arm represents

| | **Control** | **Treatment** |
|---|-------------|---------------|
| **Real-world analogue** | Cursor **Plan mode → implement** | **Lamina loop** (init → design → implement → verify → fix) |
| **Agent turns** | 2 | 5 |
| **Lamina installed** | No | Yes |
| **Scored output** | Source after **implement** | Source after **fix** |
| **Precedent** | [Hotel demo without Lamina](../demo/) | [Hotel demo with Lamina](../demo/) |

Control does **not** receive Lamina’s verify/fix loop, because that loop is **what Lamina adds**. Giving it to control would smuggle Lamina’s methodology into the baseline.

## Why unequal turns is the right design (not a loophole)

### 1. Ecological validity over artificial parity

Benchmarks that match turn counts but force both arms through the same process shape answer:

*“Does Lamina tooling beat manually copying Lamina’s workflow?”*

That is a valid **ablation study**, but it is **not** the adoption question. Real teams without Lamina do not spontaneously run a five-phase design→verify→fix loop with bench markdown stand-ins. They plan (or prompt) and build.

LaminaBench intentionally uses **unequal turns** because **extra structure is part of the treatment** — the same way a CI pipeline’s value includes the jobs it runs, not just the compiler flags.

### 2. Treatment is scored where Lamina finishes

Treatment runs through verify and fix because that is the [agent-native design loop](../skills/lamina-design-process/SKILL.md) Lamina implements. Scoring post-fix measures **delivered product behavior after the loop completes**, not an intermediate artifact.

Control is scored post-implement because **that is where Plan+implement naturally stops**. Scoring control post-fix would require inventing a verify/fix process Lamina owns — which would no longer be “without Lamina.”

### 3. Same artifact type, natural stopping points

Both arms submit **application source** for judgment. Judges and golden coverage evaluate **code**, not `.lamina/` files or `bench-plan.md`.

Different stopping points reflect **different products**, not a hidden scoring advantage:

| Arm | Stopping point | Rationale |
|-----|----------------|-----------|
| Control | After implement | No verify/fix tooling exists in this arm |
| Treatment | After fix | Lamina’s loop is incomplete until fixes land |

### 4. What we rejected (and why)

**Matched 5-phase control** — Control would run context → brief → implement → post-verify report → fix, mirroring Lamina without slash commands. Rejected because the **loop itself is Lamina’s contribution**. That design measures tooling inside Lamina’s process, which flatters the control arm and mislabels the comparison as “with vs without Lamina.”

**Single-turn control (prompt → implement only)** — Rejected because it understates competent without-Lamina practice and diverges from our own public demo baseline.

## Fairness constraints we do enforce

- Same **agent**, **model pin**, **task**, and **fixture** per paired run
- **No Lamina skills** on control
- **Blind** LLM judging of source code (human review optional, not in composite)
- **Disclosed** methodology in every report (`methodology.json` + this document)
- **`claim_ready: false`** until live runs and a real LLM judge (not heuristic-only)

## How to cite results honestly

**Do say:**

> Under Design A, the same agent with Lamina scored higher on checklist coverage and LLM rubric scores of implemented source than Plan mode + implement (treatment includes verify/fix by design).

**Do not say:**

> Lamina won with equal agent turns — turn counts are intentionally unequal.

> Lamina beat agents that already used Lamina’s workflow — control does not use that loop.

> Lamina improved runtime product behavior — unless behavior-probe oracles include runtime checks you trust and report separately.

## Optional ablation (not primary)

If you need matched-turn tooling ablation (Lamina commands vs manual loop), run a **separate** benchmark variant — do not reinterpret Design A results as that narrower claim. Document any ablation under `releases/` with its own methodology id.
