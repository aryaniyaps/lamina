# Skill load protocol

Explicit slash skills load the orchestrator workflow and only the craft skills activated by product risk.

Canonical runtime state is queried from graphd:

| Command | Role |
|---|---|
| `lamina graph status/query/diff/validate` | Resolve graph state |
| `lamina session start/query/publish/rebase/abort` | Transactional multi-mutation work |
| `lamina graph propose/patch/link` | Implicit one-shot mutations |
| `lamina mission compile/run` | Persona verification |
| `lamina graph backup/restore/rebuild-observations` | Local recovery/index maintenance |

`.lamina/business-context.md` and `.lamina/personas.json` are evidence inputs. Legacy run directories are neither command inputs nor canonical artifacts. Human Markdown is generated only as a query projection from a resolved GraphVersion.
