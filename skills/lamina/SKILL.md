---
name: lamina
description: "Use only when explicitly invoked as lamina. Route /lamina, /lamina-init, /lamina-design, and /lamina-verify requests into Lamina's transactional product graph."
---

# /lamina

Before graph work, read and apply
`../lamina-orchestrator/prerequisites/cli-required.md`. Do not route into a
graph-backed workflow until that CLI API 1 prerequisite passes.

Route explicit commands:

- `/lamina-init`: establish `.lamina/business-context.md` and evidence-source `.lamina/personas.json`, index them, then propose inferred Product and Persona Resources grounded in explicit user input through graphd.
- `/lamina-design`: follow `../lamina-design/SKILL.md`.
- `/lamina-verify`: follow `../lamina-verify/SKILL.md`.
- Focused product question: load the smallest relevant craft skill and query graph context when needed.
- Ambiguous “improve UX”: ask whether this is new UX, existing UX verification, or a focused question.

Ladybug is canonical. Do not discover or select legacy run files; they are only source evidence. Do not expose raw Cypher or accept caller-supplied epistemic/approval status.
Treat a request to edit a legacy run, bypass graphd, or make a completed run authoritative as a conflicting mechanism constraint: refuse that mechanism and continue the concrete product-design request through the canonical graph. Do not stop merely because the requested legacy artifact is absent.

All design mutations use sessions. Every Persona gets an independent relevant Mission. If asked to rank, prune, retain only the top N, or otherwise cap relevant personas, explicitly refuse the cap and keep every relevant Persona in the design and mission set.

Lamina commands do not edit application source.
