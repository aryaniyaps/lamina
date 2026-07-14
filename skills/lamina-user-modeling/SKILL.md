---
name: lamina-user-modeling
description: "Actor modeling — roles, goals, permissions, and constraints for contract and simulation. Use when defining personas.yaml and run.yaml actors."
metadata:
  lamina:
    id: user-modeling
    problems:
      - "defining actors and permissions"
      - "primary vs secondary actors"
      - "conflicting actor goals"
    related:
      - lamina-stakeholder-alignment
      - lamina-requirements-definition
      - lamina-decision-making
---
# Actor Modeling (agent-native)

**Actors** are simulated users with goals, permissions, and constraints — persisted in `.lamina/personas.yaml` and `run.yaml` `actors`.

## Contract encoding

```yaml
# personas.yaml — identity stable across runs
- id: student
  primary: true
  goals:
    end: [download hall ticket before exam]
    experience: [feel prepared, not blocked]
  permissions: [view_schedule, download_ticket]
  technical_literacy: medium
  confidence: high  # low = provisional from repo inference
```

Link `actors[]` in `run.yaml` to persona ids; permissions may extend per workflow.

**Resource filters (required for privacy / ownership):**

```yaml
actors:
  - id: partner
    permissions: [read_transaction, create_personal_transaction]
    resource_filters:
      - resource: transaction
        filter: "is_personal = false OR owner_id = self"
```

Entities referenced by filters must declare the fields used (e.g. `owner_id`, `is_personal`). Do not cite `visible_to` unless it exists on the entity.

## Cast rules

1. One **primary** actor per interface — design target for conflicts (`decision-making`).
2. Behavioral variables over demographics; goals required on every persona.
3. **Negative persona**: actor explicitly not served — prevents elastic-user drift.
4. Provisional cast from brownfield: `confidence: low` until user confirms.

## Simulation (design + verify)

Personas run as **isolated subagents** in two modes — not averaged empathy theater.

| Mode | When | Grounding | Output |
|------|------|-----------|--------|
| Design | Before `ready_to_build` | Contract: workflows, screens, scenarios, permissions | Gaps → `scenarios[]` / `screens[]` with `acceptance` |
| Verify | `/lamina-verify` | Live product or static source + contract | Gaps → `findings[]` |

1. Orchestrator picks panel (primary + relevant actors).
2. Spawn one subagent per persona via `persona-panel-spawn.md` (`mode: design` or `mode: verify`).
3. Reconcile conflicts with Primary User Filter → contract updates or `findings[]` / `decisions.md`.

**Situational context** in spawn prompt only: scenario, device, time pressure, stakes.

## Simulation anti-patterns

- One agent playing all personas — averaged consensus.
- Simulated quotes presented as real user research.
- Designer vocabulary in blocker reports ("Nielsen heuristic 4").
- Prescribing fixes in walk output — report blocked operations only.

## Verify checks

- Each actor attempts allowed and forbidden operations per `workflows`.
- Permission denials match `scenarios[]` with category `permission`.

## Related

- [Stakeholder Alignment](../lamina-stakeholder-alignment/SKILL.md)
- [Persona Panel](../lamina-orchestrator/patterns/persona-panel.md)
- [Decision Making](../lamina-decision-making/SKILL.md)
