# Lamina eval feedback

Record human review notes for failed or high-variance eval cases.

## Workflow (weekly, ~30 min)

1. Open `agent-skills-eval` HTML report from `evals/workspace/iteration-N/report.html`
2. Run `agent-skill-eval report --workspace evals/workspace --show-evidence --failures-only`
3. Review FAILED cases and cases with high stddev across `--runs 3`
4. Add one file per case: `evals/feedback/<eval-id>.json`

## feedback.json format

```json
{
  "eval_id": "init-gate-personas-bypass",
  "reviewer": "name",
  "date": "2026-07-07",
  "verdict": "skill_bug | eval_bug | flake | harness_specific",
  "notes": "Agent used personas.yaml as init substitute on Cursor only.",
  "action": "Add assertion to grade-lamina.mjs; tighten init-required.md wording"
}
```

Empty `notes` means the case passed human review.

## Triage

| Verdict | Action |
|---|---|
| `skill_bug` | Edit SKILL.md / orchestrator workflows |
| `eval_bug` | Fix assertion or fixture in `evals/scripts/merge-evals.mjs` |
| `flake` | Increase `--runs` or tighten skill instructions |
| `harness_specific` | Document in `evals/harnesses/README.md`; file adapter issue |

Feed every finding back into the eval loop within 48 hours.
