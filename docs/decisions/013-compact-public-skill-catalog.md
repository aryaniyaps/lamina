# ADR-013: Compact the public skill catalog

## Status

Accepted

## Date

2026-07-31

## Supersedes

ADR-002 and ADR-003 for public skill packaging and discovery.

## Context

The 59-sibling catalog made every focused craft topic independently
discoverable. It also presented end users with a long, implementation-shaped
list and forced every consumer to reason about dozens of names. Flattening all
guidance into one router would reduce discovery at the cost of an oversized
always-loaded prompt.

The focused instructions remain useful. The problem is their public packaging,
not their content.

## Decision

Expose exactly 10 public skills:

- Workflow: `lamina`, `lamina-init`, `lamina-design`, `lamina-verify`.
- Capabilities: `lamina-research`, `lamina-product-discovery`, `lamina-ux`,
  `lamina-product-behavior`, `lamina-systems`, `lamina-evaluation`.

Each capability has a concise `SKILL.md` and keeps focused guidance under one
level of `references/`. The router and audit profiles select exact references,
so unrelated material is not loaded. Orchestration support moves inside
`lamina/orchestrator/` and is no longer a public skill.

This is a hard cutover. Former names are not public aliases. A versioned
`skills/migration-map.json` maps each of the former 59 names exactly once to a
public destination and topic. Validation enforces the 10-name inventory,
migration coverage, reference existence, catalog parity, and portable install.

Historical benchmark reports and frozen manifests retain the inventory they
actually measured. Active builders and qualification checks use the compact
catalog.

## Alternatives considered

### Keep all 59 public siblings

This preserves direct focused discovery but leaves the end-user catalog noisy
and makes related capability boundaries hard to understand.

### One monolithic public skill

This creates the smallest list but loses useful trigger boundaries and tends to
load unrelated guidance.

### Retain deprecated alias skills

Aliases ease name migration but keep the public catalog large and make the
cutover impossible to validate exactly.

## Consequences

- Users choose among 10 understandable entrypoints.
- Focused guidance remains available on demand rather than being discarded or
  loaded globally.
- Audit profiles name both a compact skill and an exact topic reference.
- Installers must preserve nested files inside each public skill.
- Adding, removing, or moving a topic requires updating the migration map or
  profile references when applicable.
