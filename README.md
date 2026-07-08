<p align="center">
  <img src="brand/assets/wordmark/lamina-lockup-readme.svg" alt="lamina" width="360" />
</p>

<p align="center"><em>The UX reasoning layer for AI dev tools.</em></p>

<p align="center"><strong>Design how it works.</strong></p>

<p align="center">
  Lamina figures out what to build and how users move through it — before anyone opens a design tool or writes production code. Personas, flows, edge cases. Framework-agnostic. Packaged as a skill for every AI coding tool.
</p>

---

## The missing layer

| UI generation | Code generation | **UX reasoning** |
|---------------|-----------------|------------------|
| Impeccable, frontend-design | Cursor, Copilot, Claude Code | **Lamina** |
| Make things *look* good | Write the *code* | Figure out *how it works* |

AI UI tools make things pretty. Coding agents write the code. Nobody goes through user personas, maps the flows, or handles edge cases. Lamina is that layer.

---

## Install

### Skills CLI (recommended)

From GitHub:

```bash
npx skills add https://github.com/aryaniyaps/lamina -a cursor -a claude-code -a codex -a pi -y
```

From a local clone (run from **your app repo**, or use the published GitHub URL above — do not install from the Lamina repo root during development):

```bash
npx skills add /path/to/lamina -a cursor -a claude-code -a codex -a pi -y
```

**Contributors:** do not run `npx skills add .` from the Lamina repo root — it duplicates skills into `.agents/`, `.windsurf/`, etc. Eval harnesses install via [`evals/harness-sandbox/`](evals/harness-sandbox/). If polluted, run `bash evals/scripts/clean-root-pollution.sh`.

This installs:

| Path | Role |
|------|------|
| `skills/lamina/`, `skills/lamina-init/`, … | Slash commands (`/lamina`, `/lamina-init`, etc.) as `disable-model-invocation` skills |
| `skills/lamina-*/` | Problem router, orchestrator, and ~40 capability skills |
| `skills/lamina-orchestrator/agents/` | Subagent definitions bundled with the orchestrator skill |

**Flags:** `-g` (global install), `--copy` (copy instead of symlink), `-y` (non-interactive).

**Maintain:**

```bash
npx skills list
npx skills update lamina
npx skills remove lamina
```

---

## Quickstart

1. **Install** — run the Skills CLI command above.
2. **Bootstrap context** — establish business goals, scope, users, and metrics:

   ```
   /lamina-init We're building a team collaboration app for small engineering teams
   ```

   → Creates `.lamina/business-context.md`

3. **Run a workflow** — let the router pick the right path, or call a command directly:

   ```
   /lamina Add a member invite flow with role-based permissions
   ```

4. **Review artifacts** — specs land under `.lamina/` (business context, personas, flows inventory, and more depending on the workflow).

5. **Optional: preview wireframes** — if blueprint artifacts were generated:

   ```bash
   pnpm install
   pnpm preview:example
   ```

Then invoke with `/lamina` or ask: *"Use Lamina to spec out the onboarding flow."*

---

## Slash commands

**Guardrail:** UX artifacts only. No product code or visual styling specs.

| Command | Summary | When to use |
|---------|---------|-------------|
| `/lamina` | Intent router | Unsure which workflow; general UX question |
| `/lamina-init` | Business context bootstrap | New project or pivot |
| `/lamina-design` | Net-new UX — concept or feature track | Greenfield product or scoped feature spec |
| `/lamina-audit` | Flow audit → prioritized fixes | Improve existing UI or flows |

### `/lamina` — Intent router

One entry point that detects what you need and runs the right workflow — or answers a single-topic UX question directly.

**Router logic** (first strong match wins):

| Signal | Dispatch |
|--------|----------|
| Problem only, early exploration | `design` workflow → concept track |
| Specific feature to add | `design` workflow → feature track |
| Audit or improve existing UI | `audit` workflow |
| Single clear topic (forms, navigation, etc.) | **Direct mode** → `lamina-core` Problem Router → one skill |
| Ambiguous | Ask one clarifying question, then dispatch |

**Examples:**

```
/lamina We don't know what problem to solve yet
/lamina Add a wishlist feature
/lamina Audit our checkout flow
/lamina Help with form validation UX
```

### `/lamina-init` — Business context bootstrap

Answer the business questions UX work depends on and persist them in `.lamina/business-context.md`. Run once per project, or again when the business use case changes.

**Modes:**

- **establish** (default) — first-time bootstrap
- **update** — pivot, new market, or scope change; merges into existing file and appends changelog

**Examples:**

```
/lamina-init
/lamina-init update We're pivoting to enterprise teams
```

**Output:** `.lamina/business-context.md` · contract: [`skills/lamina-orchestrator/prompts/outputs/init.md`](skills/lamina-orchestrator/prompts/outputs/init.md)

### `/lamina-design` — Net-new UX

Design net-new UX — whole product from a problem (concept track) or one capability on an existing product (feature track). Auto-routes from prompt signals; say `concept for …` or `add … feature` to disambiguate.

**Examples:**

```
/lamina-design Mobile budgeting app for college students who overspend
/lamina-design Add two-factor authentication to settings
/lamina-design Add wishlist feature to our storefront
```

**Output:** `.lamina/runs/<run_id>/` (`run.yaml`, `report.md`), `.lamina/personas.yaml` (concept track), optional blueprint TSX · contracts: [`design-concept.md`](skills/lamina-orchestrator/prompts/outputs/design-concept.md), [`design-feature.md`](skills/lamina-orchestrator/prompts/outputs/design-feature.md)

### `/lamina-audit` — Audit existing flows

Audit one or more existing flows and return improvements ranked by impact vs effort.

**Example:**

```
/lamina-audit Audit our checkout flow
```

**Output:** prioritized improvement list · contract: [`skills/lamina-orchestrator/prompts/outputs/audit.md`](skills/lamina-orchestrator/prompts/outputs/audit.md)

---

## Example output

```markdown
## Personas

### Alex — Team Admin
- Goal: Configure workspace without breaking existing workflows
- Fear: Accidental data loss from bulk changes
- Frequency: Weekly

## Flow: Invite team member

1. Admin opens Settings → Team
2. Clicks "Invite member"
3. Enters email, selects role
4. System sends invite email
5. Invitee accepts → appears in member list

### Edge cases
- Email already on team → inline error, suggest role change
- Invite expires after 7 days → resend option
- SSO-enforced org → invite redirects to IdP flow
- Last admin demotion → blocked with explanation
```

Output is framework-agnostic. Hand it to your coding agent with shadcn, MUI, Tailwind, or whatever you use.

---

## Philosophy

- **Design is how it works** — not how it looks
- **Flows before pixels** — structure before surface
- **Unopinionated** — your stack, your UI library, your agent
- **Edge cases are the product** — happy paths are easy; Lamina lives in the gaps

---

## Plugin structure

| Layer | Path |
|-------|------|
| Slash commands | [`skills/lamina/`](skills/lamina/), [`skills/lamina-init/`](skills/lamina-init/), [`skills/lamina-design/`](skills/lamina-design/), [`skills/lamina-audit/`](skills/lamina-audit/) |
| Index / router | [`skills/lamina-core/SKILL.md`](skills/lamina-core/SKILL.md) |
| Orchestration | [`skills/lamina-orchestrator/`](skills/lamina-orchestrator/) |
| Capability skills | [`skills/lamina-*/SKILL.md`](skills/) (~40 skills) |
| Subagents | [`agents/`](agents/) |
| Reusable prompts | [`skills/lamina-orchestrator/prompts/`](skills/lamina-orchestrator/prompts/) |

---

## UX Review Studio (optional)

Semantic wireframe specs in `.lamina/blueprints/<id>/` with a local **UX Review Studio** — People, Flows, Screens, and Scenarios views:

```bash
pnpm install
pnpm preview:example
# or: pnpm exec lamina-blueprint review --root .lamina/blueprints --run <run_id> --id <id>
# from repo root without install: node packages/lamina-blueprint/cli/index.js review --root ...
```

| CLI command | Description |
|-------------|-------------|
| `review` / `preview` | Start UX Review Studio server |
| `validate` | Validate blueprint directory structure |
| `export-graph` | Export flow graph as Mermaid |
| `retire` | Delete a blueprint directory |

See [`skills/lamina-blueprint/SKILL.md`](skills/lamina-blueprint/SKILL.md) and [`examples/minimal-blueprint/`](examples/minimal-blueprint/).

---

## Links

- Website: [lamina.dev](https://lamina.dev)
- Docs: [lamina.dev/docs](https://lamina.dev/docs)
- Brand: [`brand/README.md`](brand/README.md) — UX layer grey + Highlighter accent

---

## License

MIT
