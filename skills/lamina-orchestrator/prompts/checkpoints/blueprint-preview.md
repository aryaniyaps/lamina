After completing this section, offer the blueprint checkpoint (skip if user asked for a full pass in one shot):

*"Open wireframe preview to evaluate structure, flows, and scenarios? Structure only, no styling. Missing screens show as skeletons."*

- **Yes** — read `run.yaml` `flows`, `screens`, `scenarios`; author blueprint TSX by hand (no codegen), validate, start preview
- **No** — continue with `report.md` narrative only
- **Approve** — set blueprint `meta.yaml` status to `approved`, write `### Blueprint handoff` section in `runs/<run_id>/report.md`, set `blueprint_id` in `run.yaml`

**Generation order (required):**
1. Read `.lamina/runs/<run_id>/run.yaml` — source of truth for flows, screens, scenarios
2. Blueprint `meta.yaml` (include `run_id`) + complete `flows.tsx` (all transitions)
3. Screen TSX files — one flow at a time, entry screen first
4. Scenario variant TSX at `scenarios/<id>/screens/<screen>.tsx` for each `run.yaml` `scenarios[]` entry (not `alternate_flow`)
5. `lamina-blueprint validate .lamina/blueprints/<id>` — fix errors before preview
6. `lamina-blueprint preview --root .lamina/blueprints --id <id> --ensure --open`

**Brownfield (any existing screen in the flow):**
1. Use `run.yaml` `screens[]` with `status: existing`, `source`, and `elements`
2. Author `flows.tsx` — all steps
3. Hydrate existing screens from `source` + `elements`; design new screens directly
4. Validate → preview

Preview state persists in `.lamina/preview-state.yaml`. Read that file on later turns for the URL. Optional agent check: `curl http://localhost:<port>/__lamina/state?id=<id>`.

When starting a new feature, create a **new blueprint id** — never overwrite an in-progress blueprint.

On implementation complete, offer retirement: *"Delete `<id>` blueprint?"* → `lamina-blueprint retire <id>`.
