After completing this section, offer the UX Review Studio checkpoint (skip if user asked for a full pass in one shot):

*"Open UX Review Studio to review personas, flows, edge-case coverage, and wireframes? Structure only — no styling. People, Flows, and Scenarios work from `run.yaml`; Screens need blueprint SUB TSX."*

- **Yes** — read `run.yaml` `flows`, `screens`, `scenarios`; author blueprint screen TSX by hand (no codegen), validate, start studio
- **No** — continue with `report.md` narrative only
- **Approve** — set blueprint `meta.yaml` status to `approved`, write `### Blueprint handoff` section in `runs/<run_id>/report.md`, set `blueprint_id` in `run.yaml`

**Generation order (required):**
1. Read `.lamina/runs/<run_id>/run.yaml` — source of truth for flows, screens, scenarios, simulation
2. Blueprint `meta.yaml` (include `run_id`) + complete `flows.tsx` (all transitions)
3. Screen TSX files — one flow at a time, entry screen first (`screens/<id>.tsx`)
4. Scenario variant TSX at `scenarios/<id>/screens/<screen>.tsx` is **optional** — only when documenting a second wireframe state. Coverage and annotations use happy-path screens by default.
5. `lamina-blueprint validate .lamina/blueprints/<id>` — fix errors before opening studio
6. `lamina-blueprint review --root .lamina/blueprints --run <run_id> --id <id> --ensure --open`

**Brownfield (any existing screen in the flow):**
1. Use `run.yaml` `screens[]` with `status: existing`, `source`, and `elements`
2. Author `flows.tsx` — all steps
3. Hydrate existing screens from `source` + `elements`; design new screens directly
4. Validate → open studio

Studio state persists in `.lamina/preview-state.yaml`. Read that file on later turns for the URL. Optional agent checks:

- `curl http://localhost:<port>/__lamina/coverage?run=<run_id>` — gaps, matrix, coverage score
- `curl http://localhost:<port>/__lamina/run?run=<run_id>` — run metadata + screen inventory
- `curl http://localhost:<port>/__lamina/state?id=<id>` — per-screen blueprint completeness

When starting a new feature, create a **new blueprint id** — never overwrite an in-progress blueprint.

On implementation complete, offer retirement: *"Delete `<id>` blueprint?"* → `lamina-blueprint retire <id>`.
