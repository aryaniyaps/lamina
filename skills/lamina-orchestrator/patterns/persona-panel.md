# Persona perspective panel

Use after an initial graph exists and before readiness, or during evidence-grounded verification.

## Fast path (preferred)

1. Run `node <lamina-orchestrator>/lib/graph-tool.mjs persona-packs .lamina/runs/<run_id>/run.json` to select ≤3 personas and pre-scope graph slices.
2. Spawn **all packs in one parallel batch** when the host supports Task/Agent (one turn, multiple subagents). Pass each pack JSON as the subagent prompt body; do not re-read the full `run.json` in reviewers.
3. Require the JSON format in `prompts/subagents/persona-panel-spawn.md`.
4. Merge results into `persona_findings[]` in a single orchestrator pass.

Sequential fallback: run the same packs one at a time with separated context. Never inline-fake the panel in the parent turn when subagents are available.

## Selection and merge

1. Select no more than three personas with materially different goals, authority, vulnerability, or context (`persona-packs` applies primary → critical-actor-linked → distinct role).
2. Give each isolated reviewer one persona, critical promises, and only the relevant graph slice or product evidence.
3. Merge structural defects, contradictions, missing recovery, and evidence-backed accessibility failures.
4. Keep reversible UX observations, policy suggestions, and desirability claims explicitly classified.
5. Never describe the result as user research or customer evidence.

In Harbor LaminaBench runs, the **agent** owns reviewer spawning (Task/Agent subagents) with the same persona-panel contract as normal Lamina. The harness does not pre-spawn reviewers.
