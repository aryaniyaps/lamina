# Simulation Planning (agent-native)

Plan the **verify pass** before spawning subagents.

## Checklist

1. Which active Persona and assumed Actor Resources get independent walks?
2. Which workflows and operations must each attempt (allowed + forbidden)?
3. Which invariants get explicit probe scenarios?
4. Is `base_url` available for walkthrough?
5. Parallel groups: actor walks + a11y

## Output

Record the plan against the Mission/Run scope; if rendered to Markdown, make it
a GraphVersion query projection rather than a product implementation checklist.
