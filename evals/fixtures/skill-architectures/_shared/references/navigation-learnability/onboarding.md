# onboarding

> Migrated intact from `skills/lamina-onboarding/SKILL.md` at `9a02ad51bbd294e3ee2ee1fd605f366297b9c43b`.

# Onboarding (agent-native)

Onboarding = **primary actor completes first valuable workflow** without documentation — verified by actor walk, not tutorial copy alone.

## Contract encoding

- First-run workflow flagged in `workflows[]` (e.g. `onboarding: true`)
- `empty_states` + `surfaces[]` for first dashboard visit
- Power features in `secondary_actions` / progressive disclosure notes
- Optional `scenarios[]` for skipped onboarding — actor still reaches goal

## Frameworks

- **Working set**: optimize discoverability for daily operations after day one.
- **Command modalities**: pedagogic (visible labels) → immediate (shortcuts) — spec accelerators in `implement.md`, not required for pass.
- **Idioms over metaphors**: consistent patterns across screens — reference in `decisions.md`.

## Design checklists

1. First productive action obvious on empty state (`empty-states`).
2. No mandatory feature tour blocking primary workflow.
3. Help/docs are fallback — interface teaches via signifiers.
4. Novice path ⊆ expert path (experts aren't forced through wizards).
5. Onboarding workflow has full scenario coverage.

## Verify checks

- Fresh-actor subagent (low `technical_literacy` persona if defined) completes first workflow.
- No dead ends before first value delivered.

## Anti-patterns

- Multi-step modal tour before any action.
- Expert-only shortcuts with no discovery path.
- Metaphor-bound IA that breaks at scale.

## Related

- Empty States
- Discoverability
- Platform Posture
