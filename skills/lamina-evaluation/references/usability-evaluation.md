# Actor Evaluation (agent-native)

**Usability** = simulated actors completing workflows on the **built product** during `/lamina-verify`.

## Method

1. Load personas + graph-backed Workflows
2. Spawn parallel actor-walk subagents (persona-panel)
3. Each attempts happy path + edge probes
4. Record blockers: cannot find affordance, wrong feedback, dead end
5. Propose severity-ranked finding Resources linked to the tested Experience
   Cases and Mission evidence

Requires a validated GraphVersion or post-build deployment — not wireframe review.

## Anti-patterns

- **Lab recruitment** — N users in a room
- **Pre-build usability** — judging flows without runnable product
- **Heuristic-only** — checklist without actor attempts
