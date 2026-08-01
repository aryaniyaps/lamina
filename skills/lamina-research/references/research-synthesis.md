# Simulation Synthesis (agent-native)

After independent verification walks return, **merge evidence** into actionable
finding Resources and Statements.

## Framework

1. Collect persona-walk JSON, walkthrough captures, and accessibility evidence
2. Cluster by: invariant violation, permission gap, UX blocker, a11y issue
3. Deduplicate same root cause across actors
4. Rank: blocking build trust vs polish
5. Link each finding to `scenario_id`, `screen_id`, or invariant id

## Anti-patterns

- **Quote theater** — fabricated user quotes from simulated sessions
- **Insight without repro** — findings without steps or contract ref
