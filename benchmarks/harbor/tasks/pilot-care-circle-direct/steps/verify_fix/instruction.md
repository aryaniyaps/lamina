# pilot-care-circle — verify and fix

Self-review behavior against the founder brief and action schema. Test permissions, invalid transitions, and recovery. Fix the highest-value issues and leave the product runnable.

## Structural self-check (required before finishing this step)

Run `node /tests/selfcheck.mjs` and fix until it exits 0.

This checks only structural integrity (every published action mutates state; action ids stick; revoke/expire actions change actor projections). It does **not** reveal Harbor golden expects. Do not invent static `project()` keyword stubs.

## Founder brief

# Shared care coordination

I want a small product that helps a family coordinate care for an older relative. People should know what was done and what still needs attention without turning the experience into project-management software. Please shape the product and build the next coherent version.


Do not expand scope. Prefer fixing incorrect state, authority, lifecycle, and recovery behavior over visual polish.
