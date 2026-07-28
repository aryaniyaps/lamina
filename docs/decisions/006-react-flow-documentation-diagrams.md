# ADR-006: Use React Flow for documentation diagrams

- **Status:** Accepted
- **Date:** 2026-07-28

## Context

Lamina's architecture and product loop contain ownership, state, and feedback
relationships that are harder to understand as prose or ASCII art. Mermaid
rendering also varies between GitHub and the documentation site, limiting visual
control and making the diagrams feel disconnected from the docs interface.

The diagrams must remain readable, accessible, and useful when JavaScript is
unavailable or the content is consumed by an agent.

## Decision

Use `@xyflow/react` with shared custom nodes for relationship diagrams in the
Next.js documentation site.

Documentation diagrams are read-only: users cannot drag, connect, select, pan,
or zoom their nodes. Every diagram has a caption and a prose equivalent in the
surrounding page. The GitHub README uses a matching static SVG because GitHub
does not execute React components.

No architectural rule may exist only inside a diagram.

## Alternatives considered

- **Mermaid:** portable, but offers inconsistent rendering and limited control
  over layout, hierarchy, and visual identity.
- **Hand-authored SVG everywhere:** renders without JavaScript, but duplicates
  layout work and becomes expensive to maintain across several diagrams.
- **Screenshots:** simple to embed, but poor for accessibility, responsive
  rendering, and future text changes.

## Consequences

- The docs application gains a small client-side visualization dependency.
- Diagram nodes and styles are reusable and remain visually consistent.
- Authors must keep captions, prose equivalents, and static fallbacks aligned
  when a flow changes.
