# pilot-loan-library — verify and fix

Self-review behavior against the founder brief and action schema. Test permissions, invalid transitions, and recovery. Fix the highest-value issues and leave the product runnable.

## Structural self-check (required before finishing this step)

Run `node /tests/selfcheck.mjs` and fix until it exits 0.

This checks only structural integrity (every published action mutates state; action ids stick; revoke/expire actions change actor projections). It does **not** reveal Harbor golden expects. Do not invent static `project()` keyword stubs.

## Founder brief

# Borrowing things among neighbors

I want a friendly way for a small neighborhood group to lend useful things to one another. People should know who has what and whether it is safe to lend again, without making it feel like a logistics system. Please shape the product and build the next coherent version.


Do not expand scope. Prefer fixing incorrect state, authority, lifecycle, and recovery behavior over visual polish.
