After completing this section, offer the blueprint checkpoint (skip if user asked for a full pass in one shot):

*"Wireframe preview? Opens a local link — structure only, no styling. Missing screens show as skeletons."*

- **Yes** — scaffold then hydrate blueprint (see generation order below), validate, start preview
- **No** — continue with markdown only
- **Approve** — set `meta.yaml` status to `approved`, write handoff block to `requirements.md`

**Generation order (required):**
1. `meta.yaml` + complete `flows.tsx` (all transitions)
2. Screen TSX files — one flow at a time, entry screen first
3. `lamina-blueprint validate .lamina/blueprints/<id>` — fix errors before preview
4. `lamina-blueprint preview --root .lamina/blueprints --id <id> --ensure --open`

**Brownfield (any existing screen in the flow):**
1. Classify steps: **existing** (shipped UI / evidence path) vs **new** (no production page)
2. `structure-manifest.yaml` — rows for **existing screens only** (`source` + `elements`)
3. `flows.tsx` — all steps
4. Hydrate existing screens from manifest; design new screens directly (no manifest row)
5. Validate → preview

Partial manifest is valid — new screens are not listed and skip fidelity checks.

Preview state persists in `.lamina/preview-state.yaml`. Read that file on later turns for the URL. Optional agent check: `curl http://localhost:<port>/__lamina/state?id=<id>`.

When starting a new feature, create a **new blueprint id** — never overwrite an in-progress blueprint.

On implementation complete, offer retirement: *"Delete `<id>` blueprint?"* → `lamina-blueprint retire <id>`.
