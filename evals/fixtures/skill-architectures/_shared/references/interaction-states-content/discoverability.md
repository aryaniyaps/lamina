# discoverability

> Migrated intact from `skills/lamina-discoverability/SKILL.md` at `9a02ad51bbd294e3ee2ee1fd605f366297b9c43b`.

# Discoverability (agent-native)

Specify **what actors can perceive and do** on each screen — signifiers, primary actions, disabled reasons — so verify catches gulfs of execution and evaluation.

## Contract encoding

Per `surfaces[]`:
- `primary_actions[]` — visible, labeled
- `secondary_actions[]` — deferred or progressive disclosure
- `disabled_when` — guards linking to scenarios
- `feedback` — what actor sees after each action (ties to `feedback-and-status`)

## Diagnostic (verify)

| Gulf | Symptom in actor walk | Fix in contract |
|------|----------------------|-----------------|
| Execution | Can't find how to act | Add signifier / promote primary action |
| Evaluation | Can't tell if action worked | Add feedback scenario + screen state |

## Design checklists

1. Primary workflow actions visible without hunt.
2. Constraints prevent wrong actions; don't rely on warnings alone.
3. Mapping: control position relates to effect when spatial layout matters.
4. Consistent labels for same operation across screens.
5. Actor self-blame in simulation → design failure finding.

## Verify checks

- Primary actor completes workflow without instructions document.
- Walkthrough: mystery meat / hidden gestures flagged.

## Anti-patterns

- Invisible affordances (gestures with no signifier).
- Hidden modes changing control meaning.
- Identical unlabeled controls.
- Assuming actors learn internal jargon.

## Related

- Feedback And Status
- Onboarding
- Content Design
