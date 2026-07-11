# Visual walkthrough

**When:** Audit of existing UI, or brownfield design where `screens[].status: existing` screens need grounded understanding — and a **product** `base_url` is available (user-provided URL or local dev server).

**What:** One shared live-app capture per flow. Screenshots + a11y/DOM dumps saved under `.lamina/runs/<run_id>/walkthrough/`. Persona panel and (v1) orchestrator consume the pack — personas do **not** each drive a browser.

**Never when:**
- Evaluating only Lamina blueprints or UX Review Studio wireframes
- Target URL is Studio preview / blueprint render
- Run has only `screens[].status: new` with no live counterpart
- No product `base_url` or app is unreachable

**Hard rule:** Capture source is always the **product app** — never Studio, never `.lamina/blueprints/` SUB render.

## Orchestrator procedure

1. **Gate:** Confirm product `base_url` (e.g. `http://localhost:3000`). If user offers Studio/blueprint URL, refuse and ask for product URL. If routes exist but no `base_url`, ask once; on skip → `evidence.visual.status: unavailable`, text path only.
2. **Identify steps:** From `run.yaml` `workflows[]` and `screens[]` where `status: existing`. Legacy `flows[]` may exist in older runs — prefer `workflows[]`. Mixed flows: capture **existing** steps only; `new` screens stay text/SUB.
3. **Capture:** Spawn walkthrough capturer from `prompts/subagents/walkthrough-capturer.md` (or run inline with host browser tools). One pass per flow.
4. **Write pack:** Save `walkthrough/index.yaml` + `walkthrough/steps/*`. Add `evidence[]` entry with `kind: visual_walkthrough`.
5. **Capability ladder** (pick once per run before persona panel):
   - **Multimodal personas** — attach step PNGs via host `file_attachments`; optional `.desc.yaml` if already computed. Set `capability: multimodal`, `status: captured`.
   - **Text-only personas + vision available** — run `prompts/subagents/screen-describer.md` on each screenshot → `.desc.yaml`. Set `capability: vision_described`, `status: described`.
   - **No vision anywhere** — build descriptions from a11y/DOM JSON only. Set `capability: a11y_only`, `status: structural_only`.
   - **Capture failed** — skip visual path; `status: unavailable`, `capability: text_fallback`.
6. **Persona panel:** Run [persona-panel](persona-panel.md) with visual evidence from the pack.

## With parallel review

In audit, order is: **capture → (describe if needed) → persona panel + expert lenses in parallel**. Lenses stay text-only in v1; they may consume structured descriptions in a future extension.

## Mixed flows (design)

| Screen status | Persona evidence |
|---------------|------------------|
| `existing` + in walkthrough pack | Live screenshot or `.desc.yaml` from pack |
| `new` / not captured | Text/SUB "What you're evaluating" block (today's path) |

Load [artifacts.md](../artifacts.md) for pack schema and [merge-rules.md](../merge-rules.md) for grounding rules.
