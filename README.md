<p align="center">
  <img src="brand/assets/wordmark/lamina-lockup-readme.svg" alt="lamina" width="360" />
</p>

<p align="center"><em>Design is how it works — not just how it looks.</em></p>

<p align="center"><strong>Know what to build. Iterate faster.</strong></p>

<p align="center">
  Product-design skill for AI coding agents. Specs how your app works — states, edges, UX gaps — into a contract your agent implements, then verifies the live build with parallel persona walks. Never writes app source.
</p>

---

## Install

```bash
npx skills install aryaniyaps/lamina
```

---

## Fits your stack

Lamina slots into whatever you already use. Unopinionated on your tech stack/ AI skills.

| | |
|---|---|
| **Any AI coding tool** | Cursor, Claude Code, Codex, Gemini, Pi, etc |
| **Any framework** | Next.js, Angular, Astro, Svelte, React Native, Flutter, etc |
| **Any database**  | Postgres, MySQL, MongoDB, Cassandra, Redis, Neo4j, etc |
| **Any Language**  | Javascript, Python, Golang, Rust, Elixir, C#, etc |
| **Any UI library** | TailwindCSS, Chakra UI, shadcn, MUI, etc |
| **Any UI design skill** | Impeccable, UI UX Pro Max, `frontend-design`, etc |
| **Any interface** | Websites, Mobile Apps, Desktop, PWAs, Chat Bots, CLIs, etc |

---

## How it works

Your coding agent writes app source. Optional UI skills handle look and feel. **Lamina owns product behavior** — what to build, how states and flows work, which edges to cover:

```mermaid
flowchart LR
  subgraph lamina["Lamina — product behavior"]
    direction TB
    INIT["/lamina-init<br/>domain charter"]
    DESIGN["/lamina-design<br/>run.yaml + implement.md"]
    VERIFY["/lamina-verify<br/>persona subagents × N"]
    INIT --> DESIGN
    VERIFY -.->|"refine contract"| DESIGN
  end

  subgraph build["You + coding agent"]
    IMPL["Implement<br/>Cursor · Claude Code · Codex · Pi · Gemini"]
  end

  APP["Your app<br/>any framework · any UI library"]

  UI["UI design skills<br/><i>optional</i>"] -.-> IMPL

  DESIGN -->|"implement.md"| IMPL
  IMPL --> APP
  APP -->|"screenshots + live app"| VERIFY
```

| Step | Who | Output |
|------|-----|--------|
| 1. Charter + design | **Lamina** | `.lamina/runs/<id>/run.yaml`, `implement.md` |
| 2. Build | **Your coding agent** | App source — any stack |
| 3. Verify | **Lamina** | Parallel persona walks, findings, invariant checks |

---

## Demo: HavenStay hotel booking platform

Same prompt, two builds — one with Lamina, one without. Both were built from scratch by **Cursor Composer 2.5** with no human-written app code.

<details>
<summary><strong>The prompt</strong></summary>

```
Design and build a complete hotel booking platform from scratch.

Create a production-ready product that enables travelers to discover, compare, book,
and manage hotel stays, while enabling hotels to manage their properties, rooms,
pricing, availability, reservations, and guest interactions.

The product should feel polished, cohesive, and ready for real-world use. Design every
aspect of the experience, including the end-to-end user journeys, information
architecture, navigation, search and discovery, booking lifecycle, account management,
payments, cancellations, reviews, notifications, hotel management, trust and safety,
customer support, accessibility, edge cases, and system behavior.
```

</details>

| | **With Lamina** | **Without Lamina** |
|---|---|---|
| **Folder** | [`demo/hotel-booking-with-lamina`](demo/hotel-booking-with-lamina) | [`demo/hotel-booking-without-lamina`](demo/hotel-booking-without-lamina) |
| **Workflow** | `/lamina-design` → implement → `/lamina-verify` | Cursor **Plan mode** → implement |
| **Contract** | `.lamina/runs/.../run.yaml` + `implement.md` | `.cursor/plans/havenstay_booking_platform_*.plan.md` |
| **Post-build check** | Persona walks, invariant probes, verify report | None |
| **Stack** | Next.js 15 · Prisma · SQLite · Stripe | Next.js 16 · Prisma · PostgreSQL · Auth.js · Stripe |

<p align="center">
  <img src="demo/hotel-booking-with-lamina/screenshot.png" alt="HavenStay built with Lamina (design + verify cycle)" width="48%" />
  &nbsp;
  <img src="demo/hotel-booking-without-lamina/screenshot.png" alt="HavenStay built without Lamina (Cursor Plan mode)" width="48%" />
</p>

<p align="center"><sub>Left: Lamina design + verify · Right: Plan mode only</sub></p>

Both apps cover traveler search/booking, a hotel partner surface, and an admin role. The gap is **product behavior** — marketplace integrity, ops depth, and edge cases — not whether a homepage exists.

### What Lamina implemented that Plan mode missed

- **Checkout inventory holds** — 15-minute hold with countdown timer, hold-aware availability, and cron expiry. Plan mode decrements inventory only after payment, so concurrent checkouts can race.
- **Cancellation policy model** — Per-property Flexible / Moderate / Strict templates with an immutable `policySnapshot` and structured refund math. Plan mode uses one global 48h / 50% / none tier.
- **Property go-live governance** — Hotels submit for review; admins approve, reject, or request changes. Plan mode lets partners self-publish with no approval queue.
- **Hotel onboarding funnel** — “List your property” → 6-step wizard (Connect, property, rooms, policy, readiness checklist, submit). Plan mode is flat hotel/room forms + manual publish.
- **Hotel-initiated cancellation** — Cancel with mandatory reason and automatic 100% guest refund (`CANCELLED_BY_HOTEL`). Plan mode has no hotel cancel path.
- **Platform admin console** — Approvals, users, hotels, bookings, payments, trust reports, review moderation, tickets, settings, audit log. Plan mode ships a single KPI dashboard page.
- **Traveler booking edges** — Email-verified booking gate, dedicated cancel flow with refund preview, review window gating, receipt on trip detail, richer booking states (`PENDING_PAYMENT`, `CHECKED_IN`, `CANCELLED_BY_*`, `PAYMENT_FAILED`).
- **Search integrity** — Only `LIVE` properties; date search excludes sold-out inventory. Plan mode can still list unavailable hotels.
- **Marketplace accounting** — Commission tracking, booking line items, dedicated refund records, user suspension that blocks booking.
- **Design + verify artifacts** — Machine contract, personas, design report, implement brief, and verify report with invariant probes. Plan mode leaves only a Cursor plan file.

### What Plan mode shipped that Lamina is weaker on

- **Stripe Checkout + webhooks** — Real Checkout Session redirect and idempotent `checkout.session.completed` confirmation. Lamina uses mock-first payment confirm with no webhook handler.
- **Email delivery** — Resend HTML templates when configured. Lamina logs to console / notification table only.
- **Guest ↔ hotel messaging** — In-app threads on trip detail and partner inbox. Lamina deferred chat; contact info only.
- **Traveler notification center** — Read/unread in-app notifications. Lamina has an admin delivery log, not a guest inbox.
- **Optional Google OAuth** — Wired in Auth.js. Lamina is credentials-only.
- **Search sort controls** — Price / rating / recommended. Lamina filters by price and rating but has no sort UI.

See the [design report](demo/hotel-booking-with-lamina/.lamina/runs/havenstay-platform-2026-07-10/report.md) and [verify report](demo/hotel-booking-with-lamina/.lamina/runs/havenstay-platform-2026-07-10/verify-report.md) for the full contract and findings.

---

## Pair with

Lamina designs and verifies product behavior. It works best when your agent can **see the system cheaply** and **remember prior decisions**:

| Tool | Why |
|------|-----|
| **[Graphify](https://github.com/safishamsi/graphify)** | Queryable codebase map — run `/graphify .` before design/verify on brownfield apps |
| **[Claude-Mem](https://github.com/thedotmack/claude-mem)** | Keeps decisions and findings across sessions |
| **UI design skill** ([Impeccable](https://github.com/pbakaus/impeccable), UI UX Pro Max, `frontend-design`) | Pixels while Lamina owns states, edges, and verify |
| **Spec Kit / Kiro** | Feed `implement.md` into an engineering plan after design |

**Brownfield minimum:** Graphify + Claude-Mem.

---

## Why not …?

Most of these are complementary. Lamina is the contract + verify loop.

### Impeccable, UI UX Pro Max, `frontend-design`

**They polish how it looks.** Lamina designs how it works — actors, flows, empty/error/loading states, invariants. Pair any UI skill; Lamina stays out of pixels.

### BMAD, ai-ux-skills, design-skills

**They teach design judgment** — heuristics, critique, a11y, PRDs. Collections like [BMAD](https://github.com/bmad-code-org/BMAD-METHOD), [ai-ux-skills](https://github.com/firassb/ai-ux-skills), and [design-skills](https://github.com/cuellarfr/design-skills) improve how your agent *thinks*.

**Lamina runs a workflow** — slash commands → `run.yaml` / `implement.md` → live-app verify. Use craft skills for judgment; Lamina when you need an implementable contract and a post-build check.

### Just asking your coding agent

Fine for happy paths. Weak on permission matrices, stale states, and mid-flow failures. Lamina structures before build and walks the live app after.

### Spec Kit, Kiro, spec-driven dev

**Product first, then spec.** Spec tools structure engineering work; Lamina structures product behavior. Run `/lamina-design`, then feed `implement.md` into Spec Kit/Kiro. Spec tools don't walk your live UI.

### v0, Lovable, Bolt

**They generate apps** — often stack-locked. Lamina doesn't generate code or pick your framework; it fits your repo, agent, and UI stack. Targets role hierarchies, multi-step flows, and domain edges those builders miss.

### Figma / design handoff

Mocks show one screen. They aren't agent instructions and don't verify the build. Lamina outputs `implement.md`, then audits the live product. Coexist fine.

**Choose Lamina** if you're a developer who builds with AI and care about product correctness — not just UI polish.

**Skip it** for landing-page skins, no-code AI builders, or if you don't want a `.lamina/` contract.

---

## Quickstart

```
/lamina-init Exam hall ticket system for universities
/lamina-design Hall ticket download with payment gate and venue assignment
# … build with your coding agent …
/lamina-verify
```

Output: `.lamina/runs/<id>/`. Hand `implement.md` to your coding agent.

---

## Commands

| Command | What it does |
|---------|--------------|
| `/lamina` | Router |
| `/lamina-init` | Domain charter |
| `/lamina-design` | Design contract → `ready_to_build` |
| `/lamina-verify` | Post-build check, persona walks, invariants |

Writes to `.lamina/` only. No app source. No visual styling.

---

## More

- Skill router: [`skills/lamina-core/SKILL.md`](skills/lamina-core/SKILL.md)
- Validate a run: `node lib/validate-run.mjs .lamina/runs/<id>/run.yaml`

MIT
