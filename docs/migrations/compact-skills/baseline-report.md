# Compact skills baseline report

- Source commit: `9a02ad51bbd294e3ee2ee1fd605f366297b9c43b`
- Public skills: 59
- Installed files: 91
- Installed bytes: 190978
- Public catalog metadata: approximately 3048 tokens
- Skill bodies: approximately 34912 tokens total
- Average skill body: approximately 592 tokens
- Largest skill body: approximately 2096 tokens
- Ledger entries: 1566

## Largest public skill bodies

| Skill | Bytes | Approximate tokens |
|---|---:|---:|
| `lamina-business-context` | 8435 | 2096 |
| `lamina-design` | 7620 | 1905 |
| `lamina-core` | 6295 | 1571 |
| `lamina` | 5973 | 1493 |
| `lamina-verify` | 5570 | 1393 |
| `lamina-time-semantics` | 4648 | 1156 |
| `lamina-init` | 4180 | 1045 |
| `lamina-system-structure` | 3981 | 988 |
| `lamina-side-effects` | 3809 | 948 |
| `lamina-invariants` | 3593 | 895 |

## Machine classification

| Classification | Entries |
|---|---:|
| capability | 1067 |
| example | 19 |
| output | 38 |
| prerequisite | 59 |
| procedure | 94 |
| safety | 128 |
| workflow | 161 |

## Behavioral measurements

Routing accuracy, passive activation, missed activation, loaded-body counts,
instruction tokens per task, benchmark completion, and provider install success
are intentionally recorded as `null` in the inventory until the comparative
evaluation harness runs. Structural measurements must not be presented as
behavioral evidence.

## Interpretation boundary

Token counts use a deterministic four-characters-per-token estimate and are for
relative architecture comparison, not model billing. The ledger intentionally
captures every prose block outside fenced examples to avoid silently dropping
short imperatives. Its destinations and classifications are machine-seeded and
must receive manual semantic review before the Phase A traceability exit gate.
