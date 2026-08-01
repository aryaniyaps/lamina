# Skill load protocol

Explicit workflow skills load internal orchestration plus only the compact
capabilities and exact topic references activated by product risk. Audit
profiles name both; never preload every reference in a capability.

Canonical runtime state is queried from graphd:

| Command | Role |
|---|---|
| `lamina graph status/query/diff/validate` | Resolve graph state |
| `lamina session start/query/publish/rebase/abort` | Transactional multi-mutation work |
| `lamina graph propose/patch/link` | Implicit one-shot mutations |
| `lamina design prepare-walk/record-walk` | Run coverage-bound Persona simulation before implementation |
| `lamina work prepare/map/check/verify` | Compile context, derive every WorkMap row, and enforce immutable modify/create file mappings |
| `lamina mission compile/run` | Persona verification |
| `lamina graph backup/restore/rebuild-observations` | Local recovery/index maintenance |

`.lamina/business-context.md` and `.lamina/personas.json` are evidence inputs. Legacy run directories are neither command inputs nor canonical artifacts. Human Markdown is generated only as a query projection from a resolved GraphVersion.

For a new or changed Workflow, prepare and record one isolated design walk for
every active Persona before compiling implementation context. Union discoveries
into the graph and repeat the full Persona round whenever the coverage digest
changes. Any non-empty discovery matrix blocks implementation until it is
expanded and rerun. These design simulations work from proposed operations and
states; they do not require application source. Runtime Missions remain a
separate, post-implementation verification mechanism.
