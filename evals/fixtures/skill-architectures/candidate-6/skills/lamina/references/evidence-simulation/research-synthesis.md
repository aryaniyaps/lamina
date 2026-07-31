# research synthesis

> Migrated intact from `skills/lamina-research-synthesis/SKILL.md` at `9a02ad51bbd294e3ee2ee1fd605f366297b9c43b`.

# Simulation Synthesis (agent-native)

After parallel verify subagents return, **merge evidence** into actionable `findings[]`.

## Framework

1. Collect persona-walk JSON, walkthrough captures, and accessibility evidence
2. Cluster by: invariant violation, permission gap, UX blocker, a11y issue
3. Deduplicate same root cause across actors
4. Rank: blocking build trust vs polish
5. Link each finding to `scenario_id`, `screen_id`, or invariant id

## Anti-patterns

- **Quote theater** — fabricated user quotes from simulated sessions
- **Insight without repro** — findings without steps or contract ref

## Related

- Findings Communication
- Verify
