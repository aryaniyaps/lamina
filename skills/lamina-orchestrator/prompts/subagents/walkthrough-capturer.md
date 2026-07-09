# Walkthrough capturer spawn

Captures **live product UI** for existing screens. One capture pass per flow — not per persona.

## Orchestrator procedure

1. Confirm **product** `base_url` — not UX Review Studio, not blueprint preview.
2. Read `run.yaml` for `flows[]`, `screens[]` where `status: existing`.
3. Spawn one subagent (or run inline) with host browser tools.
4. Write output under `.lamina/runs/<run_id>/walkthrough/`.
5. Add `evidence[]` entry to `run.yaml` with `kind: visual_walkthrough`.

## Spawn prompt (template)

```markdown
You are capturing live product UI for a Lamina audit/design run. You are NOT reviewing Lamina blueprints or UX Review Studio wireframes.

## Target

- Product base_url: <base_url>
- Flow: <flow_id>
- Run: .lamina/runs/<run_id>/

## Steps to capture

Only screens with status: existing. For each step:

<paste ordered list: screen_id, route/url, trigger/action to reach next step>

## Your task

Using browser automation against the **product app** at base_url:

1. Navigate to each step URL (base_url + path).
2. Wait for page settle (network idle or main content visible).
3. Save screenshot as walkthrough/steps/<step-id>.png
4. Dump accessibility tree or DOM summary as walkthrough/steps/<step-id>.a11y.json
5. Perform the documented action (click, submit) to reach the next step when applicable.
6. Record each step in walkthrough/index.yaml.

## Output: walkthrough/index.yaml

flow_id: <flow_id>
base_url: <base_url>
mode: live_app
source: product
steps:
  - id: <step-id>
    screen_id: <screen_id>
    screen_status: existing
    url: <path>
    action: "<how you got here>"
    screenshot: steps/<step-id>.png
    a11y: steps/<step-id>.a11y.json

## Hard rules

- mode must be `live_app`; source must be `product`.
- Never navigate to UX Review Studio, blueprint preview, or `.lamina/blueprints/` URLs.
- Never capture `screens[].status: new` unless a live implementation exists at the route.
- Do not edit files outside `.lamina/`.
- If a step fails (404, auth wall, timeout), record the failure in index.yaml under that step's `capture_error` field and continue if possible.
- Do not invent UI — capture what is on screen.

## Anti-patterns

- Using Studio screenshot as product evidence
- One browser session per persona
- Capturing wireframe SUB instead of shipped product
```

## Invalid URL rejection

Reject and ask for product `base_url` when the user provides:

- `localhost` ports known to be UX Review Studio (from `.lamina/preview-state.yaml`)
- URLs containing `/__lamina/`
- Paths under `.lamina/blueprints/`
