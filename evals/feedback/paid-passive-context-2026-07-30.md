# Paid passive-context eval evidence — 2026-07-30

Base revision: `2d1ea2fba0466471ab0b7b82af1ff2614ff471a0`

This run sampled the three new passive-context cases across all three supported
paid agent adapters. It was a representative cross-agent matrix, not a full
three-by-three repetition.

## Results

| Agent | Model | Eval | Run ID | Duration | Tokens | Cost | Raw result |
| --- | --- | --- | --- | ---: | ---: | ---: | ---: |
| Codex | configured paid Codex model | `passive-feature-implementation` | `b4bc742f` | 1,512 s | 14,134,726 | unavailable | 6/7 |
| OpenCode | `openai/gpt-5.5` | `passive-design-gap-before-edit` | `12a58902` | 578 s | reported by adapter | $5.093096 | 3/4 |
| Claude Code adapter | `gpt-5.5` through the local Anthropic-compatible proxy | `passive-ui-live-verification` (pre-publication fix) | `7094aa67` | 1,370 s | 7,321,835 | $49.568775 | 4/6 |
| Claude Code adapter | `gpt-5.5` through the local Anthropic-compatible proxy | `passive-ui-live-verification` (final) | `74959cd4` | 688 s agent / 705 s total | 4,429,386 | $27.813125 | **6/6** |

The raw misses were reviewed against the emitted receipts and artifacts:

- Codex produced a real `WorkStarted`, ran tests and builds, completed desktop
  and mobile audits, executed two independent Persona missions, and ended with
  `work_verified_c6561961b5d5b34d90d34372898f137d` at GraphVersion
  `version_fcd2bfbd86340629dbe8832f600739b8`. The failed assertion required
  obsolete packet prose despite the lifecycle receipt proving the same gate.
- OpenCode added three invariants and four scenarios before editing source,
  then completed observation and `WorkVerified` at GraphVersion
  `version_5a5fa4367559080e940fe7156558ba6b`. The failed assertion required the
  literal text `implementation_ready: true` instead of accepting `WorkStarted`.
- The corrected Claude run emitted four distinct passing audit artifacts
  (functional, visual, responsive, and accessibility), desktop and mobile
  screenshots, four normalized `audit_passed` events, and terminal receipt
  `work_verified_e37d78ec218c96aaa392731cb3830aad` for packet
  `packet_da4838bb52c8581223e697cecc38b450` at GraphVersion
  `version_3746ae158b7dfcae4cff084d4dc42d22`. Its mission remained staged, so the
  old grader ignored the verified standalone WorkMap and demanded the same
  evidence from a published `HarnessResult`.

The final paid rerun closed that lifecycle instead of weakening the grader. It
checked packet `packet_bc07ee6c1c22b12e33b42cfa603cb8f4`, ran real desktop and
mobile Chromium interactions, compiled Persona Mission
`mission_66efdcb769bc196061b395d50e36fc7e`, and published Run session
`session_519c6651b3e5b136f23f4880cb45280b` before `work verify`. The
deterministic post-grade hook confirmed a terminal `WorkVerified`, a published
HarnessResult containing all four `audit_passed` classes, four distinct
reproducible artifacts, and no explicit phase-command handoff.

The CLI now accepts implementation readiness from `WorkStarted`, snapshots the
verified WorkMap in the terminal receipt, and requires published current-source
Mission evidence for every active UI Persona. Each accepted run must contain
`oracle_passed`, no failure/capability event, all four audit kinds, and four
distinct artifacts retained in the evidence CAS. A staged mission or standalone
files cannot satisfy `work verify`. Regression tests cover the positive
publication lifecycle, rejection of staged evidence, and rejection of an
unbound map. The table preserves every original paid-run score rather than
rewriting history.

## Failed first UI attempt and fixes

Claude run `83decfe5` timed out after 1,800 seconds with 2/6. It exposed harness
problems rather than a retrieval failure: dependence on external Shopify data,
Next.js root inference, stateful mock sequencing, an image request to a private
local address, and a persistent dev server racing cleanup of `.next/dev`.

The eval now installs a self-contained local HTTPS Shopify mock and Next app,
uses a data-URL image, documents deterministic cart-cookie setup for each
browser context, provides a Playwright wrapper backed by the repository cache,
and keeps long-running audit processes scoped to the fixture. The `pnpm`
adapter also adds `--ignore-workspace` for installs inside eval workspaces so a
nested fixture cannot mutate the Lamina root workspace.

## Retrieval decision

No vector database was added. The paid failures were lifecycle, fixture, and
grading failures—not evidence of product-graph recall loss. Implementation
packets already combine exact graph closure and provenance with request-ranked
source candidates, while observations now exclude Lamina runtime and installed
skill noise. Dense retrieval remains an explicit degraded capability in packet
metadata. Add vector search only when scale-focused recall evals show that
exact graph traversal plus scoped lexical source ranking omits relevant product
constraints; adding it pre-emptively would weaken provenance without addressing
the failures observed here.
