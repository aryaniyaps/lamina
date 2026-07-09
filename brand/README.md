# Lamina.dev — Brand Package v3

Complete brand identity for [lamina.dev](https://lamina.dev) — know what to build, iterate faster. Grey UX layer system, Highlighter accent, dotted annotation language, layer mark logo, 3D meerkat mascot (separate).

## Deliverables

| File | Description |
|------|-------------|
| [`lamina-brand-identity.pdf`](./lamina-brand-identity.pdf) | **Master PDF** — full brand identity (17 pages) |
| [`lamina-brand-identity.html`](./lamina-brand-identity.html) | HTML source for PDF regeneration |
| [`logo.svg`](./logo.svg) | **Master logo mark** — vector source |
| [`assets/colors/palette.json`](./assets/colors/palette.json) | Grey scale + Highlighter tokens |
| [`WORDMARK.md`](./WORDMARK.md) | Logo + wordmark construction rules |
| [`templates/SKILL.md`](./templates/SKILL.md) | Cursor / Claude skill template |
| [`templates/README.md`](./templates/README.md) | GitHub repo README template |
| [`assets/logo/`](./assets/logo/) | Logo mark SVG |
| [`assets/wordmark/`](./assets/wordmark/) | Header lockup SVGs |
| [`assets/favicon/`](./assets/favicon/) | Favicon SVG |
| [`assets/mascot/`](./assets/mascot/) | 3D meerkat pose renders (add here) |

## Regenerate PDF

```bash
cd lamina.dev/brand
node scripts/generate-pdf.cjs
```

## Brand system v3

| Element | Decision |
|---------|----------|
| **Position** | Product design skill for developers who build with AI — know what to build, iterate faster |
| **ICP** | Developers using AI coding agents (Cursor, Claude Code, Codex, Gemini, Pi) — not designers or PMs |
| **Principle** | Grey = UX layer. Highlighter = only accent. Dots = UX thinking. |
| **Grey scale** | `#09090B` → `#3F3F46` (8 steps) |
| **Accent** | Highlighter `#FACC15` — UX markup semantics |
| **Logo mark** | Layer mark — leaf / L / wireframe cards (vector SVG) |
| **Mascot** | 3D meerkat — landing & empty states only (never in logo) |
| **Wordmark** | `lamina` flat lowercase |
| **Annotation** | Dashed borders + uppercase mono labels |
| **Tagline** | Design how it works. |
| **Subline** | Know what to build. Iterate faster. |

## PDF contents

1. Strategic foundation
2. Verbal identity
3. UX layer principle
4. Color system (grey + highlighter)
5. Dotted line language
6. 3D meerkat mascot + poses
7. Logo, wordmark & icon
8. Typography
9. Landing page wireframe + copy
10. Voice & touchpoints
11. Asset inventory + CSS tokens
12. Launch checklist
