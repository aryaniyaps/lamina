# Lamina

> Know what to build. Iterate faster.

**Design how it works.**

For **developers who build with AI coding agents** — Lamina is the open-source skill that handles product thinking (edge cases, UX gaps, product states) upfront, then verifies visually after you ship. Works with Cursor, Claude Code, Codex, Gemini, Pi, and any stack.

---

## Why Lamina

Stop doing edge-case archaeology mid-sprint. Lamina front-loads product thinking into a build contract your coding agent can implement — so you move faster without worrying about what you missed.

| | |
|---|---|
| **Design is how it works** | The only AI skill for product behavior — not pixels or code |
| **100% open source** | MIT. Inspect, fork, extend |
| **Any UI design skill** | Impeccable, UI UX Pro Max, your own |
| **Any framework** | Next.js, Angular, Astro, Svelte, React Native, Flutter |
| **Any UI library** | Tailwind, Chakra UI, shadcn, MUI |
| **Any AI coding tool** | Cursor, Claude Code, Codex, Gemini, Pi |
| **Fits your stack** | Not opinionated about context management, memory, or UI workflow |

---

## The loop

```text
/lamina-design  →  run.yaml + implement.md (ready_to_build)
       ↓
  You implement (any stack)
       ↓
/lamina-verify  →  actor walks, visual flow capture, invariants → findings
```

---

## Install

### Cursor

```bash
npx skills add https://github.com/aryaniyaps/lamina -a cursor -y
```

Then invoke with `/lamina-design`, `/lamina-verify`, or ask: *"Use Lamina to design the onboarding flow."*

### Claude Code

```bash
npx skills add https://github.com/aryaniyaps/lamina -a claude-code -y
```

### Codex / Pi / Generic

```bash
npx skills add https://github.com/aryaniyaps/lamina -a codex -a pi -y
```

Lamina outputs structured specs your agent already knows how to consume — unopinionated on how you manage context or memory.

---

## Usage

```
/lamina-design Build a settings page for a team collaboration app.
```

Lamina will:

1. **Model the domain** — entities, states, invariants, permissions
2. **Define actors** — roles, goals, and what they can do
3. **Map workflows** — primary paths, alternate paths, side effects
4. **Specify UX surfaces** — flows, forms, error/empty recovery tied to domain rules
5. **Enumerate scenarios** — violations, edge cases, recovery paths

After you build, `/lamina-verify` runs actor walks and visual flow capture against your live app.

Output is framework-agnostic. Hand it to your coding agent with shadcn, MUI, Tailwind, or whatever you use.

---

## Philosophy

- **Design is how it works** — not how it looks
- **Know what to build** — iterate faster, fewer rewrites
- **Edge cases upfront** — not discovered in production
- **Unopinionated** — your stack, your UI library, your design skill, your agent
- **Verify visually** — subagents read flows from screenshots, not just text specs

---

## Links

- Website: [lamina.dev](https://lamina.dev)
- Brand: UX layer grey + Highlighter accent · 3D meerkat mascot

---

## License

MIT
