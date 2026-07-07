<p align="center">
  <img src="brand/assets/wordmark/lamina-lockup-light.svg" alt="lamina" width="200" />
</p>

> The UX reasoning layer for AI dev tools.

**Design how it works.**

Lamina figures out what to build and how users move through it — before anyone opens a design tool or writes production code. Personas, flows, edge cases. Framework-agnostic. Packaged as a skill for every AI coding tool.

---

## The missing layer

| Layer | Tools | What they do |
|-------|-------|--------------|
| UI generation | Stitch, v0, Galileo | Make things *look* good |
| **UX reasoning** | **Lamina** | Figure out *what to build* and *how it works* |
| Code generation | Cursor, Copilot, Claude Code | Write the *code* |

AI UI tools make things pretty. Coding agents write the code. Nobody goes through user personas, maps the flows, or handles edge cases. Lamina is that layer.

---

## Install

### Skills CLI (recommended)

From GitHub:

```bash
npx skills add https://github.com/aryaniyaps/lamina -a cursor -a claude-code -a codex -a pi -y
```

From a local clone:

```bash
npx skills add . -a cursor -a claude-code -a codex -a pi -y
```

This installs:

| Path | Role |
|------|------|
| `commands/` | Slash commands (`/lamina`, `/lamina-init`, etc.) |
| `skills/` | Problem router, orchestrator, and ~40 capability skills |
| `agents/` | Subagents for parallel audit and research synthesis |

**Flags:** `-g` (global install), `--copy` (copy instead of symlink), `-y` (non-interactive).

**Maintain:**

```bash
npx skills list
npx skills update lamina
npx skills remove lamina
```

### Per-agent fallback

If the Skills CLI is unavailable, clone or copy into your agent's skills directory:

**Cursor**

```bash
# Project-level
git clone https://github.com/aryaniyaps/lamina.git .cursor/skills/lamina

# User-level
git clone https://github.com/aryaniyaps/lamina.git ~/.cursor/skills/lamina
```

**Claude Code**

```bash
git clone https://github.com/aryaniyaps/lamina.git .claude/skills/lamina
# or user-level: ~/.claude/skills/lamina
```

**Windsurf**

```bash
git clone https://github.com/aryaniyaps/lamina.git .windsurf/skills/lamina
```

**Copilot / generic**

Copy `commands/`, `skills/`, and `agents/` into your agent's skills directory, preserving relative paths so commands can reference `skills/lamina-orchestrator/` and `skills/lamina-<id>/`.

### Verify

```bash
npm run verify:bundle
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
| `/lamina-ideate` | Problem → full UX concept | Early exploration, greenfield |
| `/lamina-feature` | Feature → implementation-ready spec | Known feature to spec |
| `/lamina-optimize` | Flow audit → prioritized fixes | Improve existing UI or flows |

### `/lamina` — Intent router

One entry point that detects what you need and runs the right workflow — or answers a single-topic UX question directly.

**Router logic** (first strong match wins):

| Signal | Dispatch |
|--------|----------|
| Problem only, early exploration | `ideate` workflow |
| Specific feature to add | `feature` workflow |
| Audit or improve existing UI | `optimize` workflow |
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

**Output:** `.lamina/business-context.md` · contract: [`prompts/outputs/init.md`](prompts/outputs/init.md)

### `/lamina-ideate` — Problem → full UX concept

Start from a user problem and build a complete UX concept incrementally — nine sections: user model, journey, IA, flows, screens, interactions, copy, a11y, validation plan.

**Example:**

```
/lamina-ideate Mobile budgeting app for college students who overspend
```

**Output:** `.lamina/personas.yaml`, `.lamina/flows-inventory.yaml`, optional blueprint TSX · contract: [`prompts/outputs/ideate.md`](prompts/outputs/ideate.md)

### `/lamina-feature` — Feature → implementation-ready spec

Turn a feature idea into a spec with problem framing, JTBD, assumptions, goals, flows, edge cases, risks, a11y, metrics, and an implementation checklist.

**Example:**

```
/lamina-feature Add two-factor authentication to settings
```

**Output:** feature spec artifacts under `.lamina/` · contract: [`prompts/outputs/feature.md`](prompts/outputs/feature.md)

### `/lamina-optimize` — Audit existing flows

Audit one or more existing flows and return improvements ranked by impact vs effort.

**Example:**

```
/lamina-optimize Audit our checkout flow
```

**Output:** prioritized improvement list · contract: [`prompts/outputs/optimize.md`](prompts/outputs/optimize.md)

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
| Commands | [`commands/`](commands/) |
| Index / router | [`skills/lamina-core/SKILL.md`](skills/lamina-core/SKILL.md) |
| Orchestration | [`skills/lamina-orchestrator/`](skills/lamina-orchestrator/) |
| Capability skills | [`skills/lamina-*/SKILL.md`](skills/) (~40 skills) |
| Subagents | [`agents/`](agents/) |
| Reusable prompts | [`prompts/`](prompts/) |

---

## UX Blueprint preview (optional)

Semantic wireframe specs in `.lamina/blueprints/<id>/` with a local greyscale preview:

```bash
pnpm install
pnpm preview:example
# or: pnpm exec lamina-blueprint preview --root .lamina/blueprints --id <id>
# from repo root without install: node packages/lamina-blueprint/cli/index.js preview --root ...
```

| CLI command | Description |
|-------------|-------------|
| `preview` | Start greyscale wireframe preview server |
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
