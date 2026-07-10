---
lamina:
  maturity: greenfield
  platform: [web]
  last_updated: 2026-07-10
---

# Business context

**HavenStay** — two-sided marketplace connecting leisure and business travelers with independent and boutique hotels in the United States.

## Problem statement
**Answer:** Travelers face cluttered, opaque OTA experiences optimized for inventory scale rather than clarity and trust. Independent and boutique hotels struggle to compete with large chains on incumbent platforms, pay heavy commissions, and lack intuitive control over how they are presented and booked. We are building a modern US marketplace OTA that delivers a cleaner, faster, more transparent booking experience for travelers and practical listing/ops tools for hotels — without becoming a full PMS or multi-vertical travel suite in v1.
**Confidence:** high
**Evidence:** stakeholder input (clarify answers, 2026-07-10)
**Skill:** lamina-problem-framing, lamina-feature-discovery

## Business goals
**Answer:** In 6–12 months, demonstrate product-market fit as a commission-based OTA for independent/boutique hotels: meaningful supply (300+ active hotels), demand (100,000 completed bookings), positive unit economics per booking, and steady month-over-month booking growth. Traveler experience quality (ratings, low support load) and platform reliability are co-equal with growth.
**Confidence:** high
**Evidence:** stakeholder success criteria
**Skill:** lamina-stakeholder-alignment, lamina-product-behavior

## Success metrics
**Answer:**
| Metric | Target (6–12 mo) |
|--------|------------------|
| Active hotels onboarded | 300+ |
| Completed bookings | 100,000 |
| Unit economics | Positive on bookings |
| Repeat booking rate | 30% |
| Average traveler rating | > 4.5 / 5 |
| Booking-related support tickets | < 2% of bookings |
| Payment failure rate | < 1% |
| Platform uptime | 99.9% |
| Growth | Steady MoM booking growth (PMF signal) |

Baselines are unknown (greenfield). Metrics are targets, not current measurements.
**Confidence:** high (targets); low (baselines — none exist)
**Evidence:** stakeholder input
**Skill:** lamina-quantitative-validation, lamina-stakeholder-alignment

## Scope
**Answer:**

**In for first production release (≤ 6 months):**
- Traveler: registration/auth, discovery & search, filter/sort, hotel detail, room selection, booking flow, Stripe payments, confirmation, reservation management, verified-guest reviews, email notifications, basic support, basic trust & safety
- Hotel: dashboard, property management, room inventory, pricing, reservation management
- Surfaces: responsive web (travelers), desktop web dashboard (hotel operators)
- Market: United States; English; USD only

**Explicitly out of v1:**
- Vacation rentals, hostels, long-term rentals
- Flights, cars, vacation packages
- Full PMS, revenue management, CRM, marketing automation, enterprise hotel features
- Loyalty, corporate travel, multi-currency/language, dynamic pricing, promotions, wishlists, group bookings
- Native mobile apps, AI recommendations, advanced analytics
- Channel manager / third-party PMS integrations
- SMS/push notifications

**Scope creep signals:** adding travel verticals beyond hotels; PMS-depth ops; enterprise chain tooling; non-email notification channels; non-USD/non-English launch expansion before PMF.
**Confidence:** high
**Evidence:** stakeholder must-ship / can-wait / creep lists
**Skill:** lamina-stakeholder-alignment, lamina-feature-prioritization

## Users & market
**Answer:**
- **Travelers served:** leisure and business travelers booking hotel stays in the US via web.
- **Hotels served:** independent hotels, boutique hotels, small and mid-sized hotel groups.
- **Not served (v1):** vacation-rental hosts, hostel operators, long-stay landlords, travelers seeking flights/cars/packages, large enterprise chains needing PMS/channel-manager depth.
- **Alternatives / inertia:** Booking.com, Expedia, and similar OTAs (scale, habit, inventory breadth); hotel direct sites; Airbnb for some boutique-adjacent stays. Differentiation bet: cleaner UX and better presentation/control for independents vs inventory-maximizing incumbents.
- **Business model:** marketplace OTA; platform earns commission on completed bookings. Hotels manage listings, rooms, pricing, and reservations on-platform. Not a hotel SaaS/PMS product in v1.
**Confidence:** high (segments); medium (competitive differentiation claims — stakeholder belief, not validated research)
**Evidence:** stakeholder input
**Skill:** lamina-competitive-analysis, lamina-user-modeling

## Product posture
**Answer:**
- **Platform:** responsive web for travelers; desktop web for hotel operators. Native iOS/Android deferred until after PMF.
- **Role:** sovereign marketplace for the booking job — primary place travelers discover/compare/book and hotels manage marketplace presence and reservations. Transient relative to a hotel’s full PMS (intentionally shallow ops surface).
- **Density:** traveler surface — low-to-medium density, clarity over power-user chrome. Hotel dashboard — medium density for inventory, pricing, and reservations without enterprise PMS complexity.
- **Posture conflict to watch:** hotels may push for PMS-like depth; scope rules say refuse and keep marketplace-ops thin.
**Confidence:** high
**Evidence:** stakeholder platform and model answers
**Skill:** lamina-platform-posture, lamina-product-behavior

## Constraints
**Answer:**
- Team: 6–8 people
- Timeline: 6 months to first production release
- Payments: PCI-compliant via Stripe
- Privacy: GDPR and CCPA
- Locale: English only; USD only; US launch
- Maps: Google Maps integration
- Notifications: email only (no SMS/push)
- Integrations: no third-party PMS or channel managers in v1
**Confidence:** high
**Evidence:** stakeholder input
**Skill:** lamina-research-scoping, lamina-stakeholder-alignment

## Stakeholders
**Answer:** Product/engineering team (6–8) shipping the OTA; hotel supply partners (independent/boutique operators); travelers as demand side. Known tension: hotel desire for deeper ops tools vs v1 “not a PMS” boundary; traveler desire for breadth vs curated independent/boutique supply. Commission rate and hotel onboarding motion (self-serve vs sales-assisted) not yet specified — treat as open product decisions.
**Confidence:** medium
**Evidence:** inferred from model + team size; org chart not provided
**Skill:** lamina-stakeholder-alignment

## Risks & unknowns
**Answer:**
- Supply cold-start: reaching 300 active hotels without channel-manager import may be slow.
- Differentiation vs Booking.com/Expedia may not convert if inventory or price competitiveness lags.
- Commission rate unset — affects hotel willingness and unit economics.
- Thin hotel tools may lose operators who need PMS-adjacent workflows day one.
- Reviews/trust & safety “basic” scope may be insufficient for marketplace trust at scale.
- Payment/cancellation edge cases drive support load if under-designed.
- Positioning copy beyond the HavenStay name still unset.
**Confidence:** medium
**Evidence:** greenfield inference from scope cuts + targets
**Skill:** lamina-feature-discovery, lamina-research-scoping

## Research posture
**Answer:** Mixed. **Evaluative** for core booking and payment flows (known OTA patterns; validate clarity, trust, and error recovery). **Generative** for the differentiation bet — what “cleaner / more transparent / better hotel presentation” means in practice for independents vs incumbents. Decisions that need evidence before over-building: hotel onboarding friction, minimum viable hotel dashboard depth, cancellation/refund policy UX, and review authenticity rules.
**Confidence:** medium
**Evidence:** inferred from greenfield + differentiation thesis
**Skill:** lamina-problem-framing, lamina-research-scoping

## Triad check
**Answer:**
- **Desirability:** Strongest stated bet — cleaner traveler UX + better independent-hotel presentation.
- **Viability:** Commission marketplace with explicit unit-economics target; rate and take-rate still open.
- **Capability:** Weakest near-term — 6–8 people, 6 months, Stripe + Maps + dual surfaces (traveler + hotel), no channel-manager shortcuts for supply.
**Weakest pillar:** capability / delivery risk under timeline and supply acquisition constraints.
**Confidence:** medium
**Evidence:** triad inferred from goals, scope, constraints
**Skill:** lamina-product-behavior

## Open questions
- Visual identity direction (out of Lamina styling scope; brand name is HavenStay).
- Commission rate / fee structure (guest-facing transparency and hotel payout rules).
- Hotel onboarding: self-serve, sales-assisted, or hybrid; verification bar for “active hotel.”
- Cancellation and refund policy defaults (platform-mandated vs hotel-configurable within bounds).
- Definition of “verified guest” for reviews and “basic” trust & safety / support SLAs.
- Whether business travelers share the same account model as leisure or need light profile differences in v1 (corporate travel features are out; individual business trips are in).

## Changelog
### 2026-07-10 — brand name
- Changed: set product name to HavenStay; removed brand-name open question
- Trigger: stakeholder confirmation
- Stale: none (personas header label only)

### 2026-07-10 — establish
- Changed: created business-context.md from stakeholder clarify answers
- Trigger: `/lamina-init` establish for boutique hotel OTA
- Stale: none (first write)
