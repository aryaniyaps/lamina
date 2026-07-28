# ADR-003: Expose Lamina skills as public siblings

## Status

Accepted

## Date

2026-07-28

## Context

ADR-002 nested 58 workflow and craft skills inside a single public `lamina`
router. That guaranteed an all-or-nothing installation, but it also hid valid
skills from normal discovery and made direct triggering dependent on the
router's internal path knowledge.

The skills already have independent trigger metadata and reference one another
by skill name. They benefit from the agent skill system's normal progressive
loading model. The installation and eval harnesses can still guarantee that
the complete set is present without collapsing the public catalog.

The independently installed standalone `lamina` executable remains the sole owner of graphd,
Ladybug, CocoIndex, and graph commands. This decision changes only skill
discovery and packaging.

## Decision

Expose 59 public sibling skills directly under `skills/`:

- `skills/lamina` remains the command router.
- The 58 focused `skills/lamina-*` directories remain independently
  discoverable and triggerable.
- Normal installation selects `--skill '*'` and installs the complete set.
- Eval setup installs all 59 skills before every run. A suite may force-invoke
  one primary skill, but all cross-referenced siblings remain available in the
  same agent workspace.
- Benchmark treatment bundles inventory and stage all 59 skills.
- Validation rejects a nested `skills/lamina/skills` boundary and checks every
  public skill's frontmatter and local references.

## Alternatives Considered

### Keep the single nested bundle

This prevents partial installation, but hides real capabilities from skill
discovery and works against progressive loading. Superseded.

### Allow selective installation as the default

This preserves catalog visibility but can omit skills referenced by a selected
workflow. Rejected for the documented install and eval paths; install all 59
by default.

### Flatten all instructions into the router

This would guarantee availability at the cost of an oversized prompt and lost
trigger specificity. Rejected.

## Consequences

- Users and agents see approximately 60 Lamina skills in the public catalog.
- Focused skills can trigger directly without routing every request through
  `lamina`.
- Cross-skill references remain valid because supported installs and every eval
  workspace contain the full set.
- Adding or removing a skill requires updating the asserted public count,
  grouped catalog, benchmark inventory, and install/eval tests.
- The CLI and skills remain independently installable and releasable.
