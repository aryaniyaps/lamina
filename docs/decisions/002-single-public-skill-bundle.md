# ADR-002: Ship one public skill with contained Lamina modules

## Status

Accepted

## Date

2026-07-27

## Context

Lamina's 59 sibling skill directories exposed implementation modules as
independent install targets. A normal GitHub skill installation could select
only a route module, omit required orchestration material, or flood an agent's
public skill catalog with internal craft capabilities.

The CLI and skill bundle have different release jobs. The independently
installed `@laminadev/cli` owns graphd, Ladybug, CocoIndex, and graph commands.
The GitHub skill installer must deliver every workflow and supporting craft
module needed to use that CLI without embedding a second runtime.

## Decision

`skills/lamina/SKILL.md` is the only public skill. It routes `/lamina`,
`/lamina-init`, `/lamina-design`, and `/lamina-verify`.

The 58 workflow and craft modules live under
`skills/lamina/skills/lamina-*`. They are private bundle contents, referenced
by the root skill through relative paths. The default skill discovery boundary
stops at the public root and recursively copies its contents, so a normal
installation exposes one skill while delivering all modules.

Installers, eval staging, benchmark packaging, and bundle validation must:

- select only `lamina` as the public skill;
- copy and inventory the root recursively;
- require exactly 58 valid contained modules; and
- avoid full-depth discovery, which would expose the modules as separate
  public skills.

## Alternatives Considered

### Keep all modules as sibling public skills

This preserves direct installation of individual modules, but makes partial
and incoherent Lamina installations normal. Rejected.

### Flatten every module into one `SKILL.md`

This produces one public target but removes progressive loading and makes the
root instruction file too large. Rejected.

### Embed the CLI runtime in the skill

This would make the bundle self-contained but creates two installation and
upgrade authorities for graph state. Rejected; the CLI remains an independent
npm package.

## Consequences

- Users install one public `lamina` skill and receive every required module.
- Internal module paths are an implementation detail, not catalog entries.
- Adding or removing a module requires updating the asserted module count,
  installer tests, eval staging, benchmark inventory, and this decision's
  implementation evidence.
- `--full-depth` is unsupported for normal Lamina installation because it
  intentionally breaks the public/private discovery boundary.
