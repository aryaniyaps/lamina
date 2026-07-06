After completing this section, offer the blueprint checkpoint (skip if user asked for a full pass in one shot):

*"Wireframe preview? Opens a local link — structure only, no styling."*

- **Yes** — generate or update `.lamina/blueprints/<id>/` and start `lamina-blueprint preview`
- **No** — continue with markdown only
- **Approve** — set `meta.yaml` status to `approved`, write handoff block to `requirements.md`

When starting a new feature, create a **new blueprint id** — never overwrite an in-progress blueprint.

On implementation complete, offer retirement: *"Delete `<id>` blueprint?"* → `lamina-blueprint retire <id>`.
