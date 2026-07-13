# Lamina workflow (benchmark treatment arm)

Lamina commands write `.lamina/` contracts only (`/lamina-init` → `/lamina-design` or `/lamina-verify` → …). They do not edit app source.

After design: implement app source from `run.yaml` + `implement.md` + the task brief. After verify: fix app source from `fix.md`.

**Unattended:** the user cannot answer. During implement/fix, finish the full product in this session — do not wait for proceed, do not stop at a scaffold or task list.

Write under `.lamina/runs/<run_id>/` for Lamina artifacts (not `.lamina/ready_to_build/`).

See `AGENTS.md` for full workflow detail.
