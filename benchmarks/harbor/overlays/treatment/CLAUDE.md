# Lamina workflow (benchmark treatment arm)

When doing product-related work in this workspace, use the Lamina loop:

`/lamina-init` → `/lamina-design` (or `/lamina-verify` for audits) → implement → `/lamina-verify` → fix from `fix.md`.

**Unattended run:** the user cannot answer questions. Treat the task brief as authoritative. Do not clarify-and-STOP — use labeled assumptions under Open questions and continue.

Write under `.lamina/runs/<run_id>/` only (not `.lamina/ready_to_build/`). Deliver full product source, not a plan-only response.

See `AGENTS.md` for full workflow detail.
