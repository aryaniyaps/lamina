# pilot-care-circle — fix

Use the installed Lamina skills and slash commands fully. Follow Mode B: during `/lamina-*` commands write only under `.lamina/`; implement application source in separate coding turns. Do not skip persona-panel subagents, UI walkthrough capture, risk-skill loads, or authority/lifecycle modeling because this is a benchmark — those are part of how Lamina works.

Apply fixes from the latest `fix.md` in a normal coding turn. You may Read `.lamina/` and supporting skills. **Do not** invoke `/lamina-*` slash commands in this step. Leave the product runnable.

Prefer fixing incorrect state, authority, lifecycle, and recovery behavior over visual polish. Do not expand scope.

## Structural self-check (required before finishing this step)

Run `node /tests/selfcheck.mjs` and fix until it exits 0.

This checks only structural integrity (every published action mutates state; action ids stick; revoke/expire actions change actor projections). It does **not** reveal Harbor golden expects. Do not invent static `project()` keyword stubs.

## Founder brief

# Shared care coordination

I want a small product that helps a family coordinate care for an older relative. People should know what was done and what still needs attention without turning the experience into project-management software. Please shape the product and build the next coherent version.

