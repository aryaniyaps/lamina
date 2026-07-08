# Product

## Register

product

## Users

**Primary — product engineer / developer using Lamina in Cursor**
- Runs `/lamina-design` or `/lamina-audit`, receives `run.yaml` and optional blueprint SUB wireframes
- Needs fast validation: personas, flow connections, edge-case coverage, screen structure
- Comfortable with CLI; values agent HTTP API (`/__lamina/*`) for automation

**Secondary — beginner (PM, founder, junior dev new to UX)**
- Intimidated by YAML and Lamina artifact contracts
- Needs guided, visual exploration with plain-language labels
- May not author blueprints; still benefits from People, Flows, and Scenarios views

**Context of use:** Local desktop, single-project, file-system-backed. User deliberately opens Studio to review UX artifacts between Lamina command output and implementation handoff.

## Product Purpose

UX Review Studio makes Lamina's scattered UX artifacts — `run.yaml`, `personas.yaml`, `report.md`, and optional blueprint wireframes — legible in one interactive surface.

Success looks like:
- A new user orients to a run's scope (personas + flows + scenarios) in under five minutes without opening raw YAML
- Beginners can navigate all four views with simple defaults (`--run` alone)
- Power users can drill into coverage gaps, persona lenses, flow graphs, and agent APIs without friction
- Studio dogfoods Lamina: the tool that visualizes Lamina artifacts is designed using Lamina itself

## Brand Personality

**Calm expert** — confident, precise, no fluff.

Voice aligns with Lamina's tagline: *Design how it works.* Studio chrome should feel like a trustworthy review instrument, not a playful dashboard or a developer debug console. Warmth appears only where beginners need reassurance (empty states, onboarding), not in dense workflow chrome.

## Anti-references

Studio must **not** feel like:

- **Generic SaaS dashboards** — dense sidebars, hero-metric cards, purple gradients, identical card grids
- **Diagramming tools** — Miro/FigJam infinite-canvas clutter, decoration over structure
- **Raw data viewers** — YAML/JSON dumps, developer-only affordances as the primary interface

Also avoid Lamina brand forbidden patterns: blue/purple/green-primary UI, rainbow chrome, mascot in logo lockup or navbar.

Studio is a **structure-first review tool**, not a visual design canvas or a general diagramming product.

## Design Principles

1. **Orient before depth** — show what matters first (run, counts, current view); hide advanced matrices and APIs behind progressive disclosure
2. **Structure over styling** — wireframes and SUB blueprints stay greyscale; brand identity lives in Studio chrome only
3. **Defaults work alone** — `--run` should be enough for People, Flows, and Scenarios; blueprint link is optional depth for Screens
4. **Artifacts are sovereign** — read `.lamina/` contracts without breaking downstream Lamina skills; visualize, don't regenerate
5. **Practice what you preach** — improve Studio using the same Lamina workflow it displays

## Accessibility & Inclusion

- **Target:** WCAG 2.1 AA
- Keyboard navigation for all primary views, tabs, and interactive controls
- Visible focus rings (Highlighter accent acceptable on chrome)
- Color contrast ≥ 4.5:1 for body text, ≥ 3:1 for large text on Studio chrome
- Respect `prefers-reduced-motion` for any transitions or reveal animations
- Do not rely on color alone for scenario severity, coverage gaps, or flow state
