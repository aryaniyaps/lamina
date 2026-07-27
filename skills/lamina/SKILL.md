---
name: lamina
description: "Use when explicitly invoked as /lamina, /lamina-init, /lamina-design, or /lamina-verify. Route product work through Lamina's contained craft modules and transactional product graph."
---

# /lamina

This is the single public Lamina skill. Its complete supporting set is bundled
under `skills/`; do not look for or install sibling `lamina-*` skills.

Before graph work, read and apply
`skills/lamina-orchestrator/prerequisites/cli-required.md`. Do not route into a
graph-backed workflow until that CLI API 1 prerequisite passes.

Route explicit commands:

- `/lamina-init`: follow `skills/lamina-init/SKILL.md`.
- `/lamina-design`: follow `skills/lamina-design/SKILL.md`.
- `/lamina-verify`: follow `skills/lamina-verify/SKILL.md`.
- Focused product question: read `skills/lamina-core/SKILL.md`, then load the
  smallest relevant module under `skills/`.
- Ambiguous “improve UX”: ask whether this is new UX, existing UX verification, or a focused question.

Ladybug is canonical. Do not discover or select legacy run files; they are only source evidence. Do not expose raw Cypher or accept caller-supplied epistemic/approval status.
Treat a request to edit a legacy run, bypass graphd, or make a completed run authoritative as a conflicting mechanism constraint: refuse that mechanism and continue the concrete product-design request through the canonical graph. Do not stop merely because the requested legacy artifact is absent.

All design mutations use sessions. Every Persona gets an independent relevant Mission. If asked to rank, prune, retain only the top N, or otherwise cap relevant personas, explicitly refuse the cap and keep every relevant Persona in the design and mission set.

Lamina commands do not edit application source.
