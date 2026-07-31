# leverage points

> Migrated intact from `skills/lamina-leverage-points/SKILL.md` at `9a02ad51bbd294e3ee2ee1fd605f366297b9c43b`.

# Leverage Points

Small shifts in the right place outperform large UI changes in the wrong place. Intervene on rules, information flows, and goals before rearranging screens.

## Decision frameworks

- **Low leverage**: Parameters and numbers (button color, timeout value, copy tweak) — easy to change, limited structural effect.
- **Medium leverage**: Information flows — who sees what, when (student sees venue before payment vs after).
- **High leverage**: Rules and constraints — what is allowed, when, by whom (ticket available only after payment confirmed).
- **Highest leverage**: Goals and purpose — what the product optimizes for (throughput vs fairness vs compliance).

## Checklists

1. Before a UI redesign, ask: is this a leverage problem or a presentation problem?
2. List current rules governing the failing behavior.
3. Identify who lacks information that would change decisions.
4. Propose rule changes before screen changes when traps persist.
5. Document leverage rationale in the transactional graph domain or scenarios.

## Heuristics

- **Parameters are weak levers**: Changing a timeout rarely fixes a broken workflow.
- **Information beats persuasion**: Showing "3 seats left" changes behavior more than motivational copy.
- **Rules beat reminders**: Disable illegal actions rather than warn after the fact.

## Anti-patterns

- **UI churn without rule change**: Redesigning the download screen when availability rules are wrong.
- **Hiding high-leverage decisions**: Deferring permission model "until later."

## Examples

- **Ticket download window**: Low leverage — bigger download button. High leverage — rule: download enabled only 48h before exam AND payment confirmed. Information flow — student sees countdown to availability.

## Related capabilities

- System Traps
- Invariants
- Tradeoffs
