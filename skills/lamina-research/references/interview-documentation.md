# Walkthrough Evidence (agent-native)

Document **observable evidence** from live product sessions — structured for verify and findings.

## Capture format

Per step:
- `screen_id` / URL
- Action taken (click, fill, navigate)
- Expected vs observed (contract ref)
- Screenshot or DOM snapshot ref (walkthrough pack)
- Blocker flag if actor cannot proceed

Persona perspective walks output structured JSON per `persona-panel-spawn.md`.

## Anti-patterns

- **Narrative notes** — prose without reproducible steps
- **Paraphrased feelings** — replace with blocked operation + screen
