---
name: lamina-design-process
description: "Agent-native design loop — domain contract, external build, verify, iterate. Not human workshop ceremony."
metadata:
  lamina:
    id: design-process
    problems:
      - "design workflow for agents"
      - "iterate after verify"
    related:
      - lamina-design
      - lamina-verify
      - lamina-evolutionary-rules
---
# Design Process (agent-native)

The loop for coding agents is passive after init: **prepare context → complete
design gaps → map obligations → implement → verify → fix → re-verify**.

## Loop

1. `/lamina-init` once — establish the domain and provider rules.
2. On an ordinary request, compile an ImplementationPacket from the exact graph closure.
3. Complete and publish any reported design gaps automatically.
4. Map every obligation to evidence, source targets, and verification; check the map before edits.
5. Implement in the project's stack.
6. Run isolated actor, invariant, functional, visual, responsive, and accessibility proof.
7. Fix failures and reverify until every obligation has current passing evidence.

`/lamina-design` and `/lamina-verify` remain advanced graph-only/source-read-only
overrides. Never recommend them as the normal next step.

## Anti-patterns

- **Workshop theater** — sticky notes, double-diamond ceremonies without contracts
- **Skip verify** — shipping without actor walks against live product
- **One-shot design** — no iteration after build

## Related

- [Design](../lamina-design/SKILL.md)
- [Verify](../lamina-verify/SKILL.md)
