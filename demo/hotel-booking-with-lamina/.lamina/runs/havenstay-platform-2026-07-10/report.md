# HavenStay — Design Report

**Run:** `havenstay-platform-2026-07-10`  
**Command:** `/lamina-design`  
**Status:** `ready_to_build`  
**Date:** 2026-07-10

---

## Executive summary

HavenStay is designed as a US-focused, commission-based OTA for independent and boutique hotels. The product splits into two primary surfaces: a **responsive traveler web app** for discovery through post-stay review, and a **desktop hotel dashboard** for onboarding, listing management, inventory/pricing, and reservation operations.

The design prioritizes **clarity and trust** over feature breadth — a deliberate contrast with inventory-maximizing incumbents. v1 intentionally stops short of PMS depth, channel managers, and multi-vertical travel, keeping the team of 6–8 deliverable within six months.

Machine contract: `.lamina/runs/havenstay-platform-2026-07-10/run.yaml`  
Build brief: `.lamina/runs/havenstay-platform-2026-07-10/implement.md`

---

## Domain and invariants

The domain centers on **property → room type → inventory block (per date) → booking**. Inventory integrity is the hardest system constraint: a 15-minute checkout hold prevents double-booking while giving travelers time to pay. Confirmation requires successful Stripe payment; cancellation policy terms are snapshotted at booking time and never retroactively changed.

Fifteen invariants govern marketplace integrity — from `no-double-booking` and `payment-before-confirm` to `verified-guest-review-only` and `hotel-payout-after-checkin`. These are non-negotiable for implementation.

---

## Actors and permissions

Five positive actors (from `.lamina/personas.yaml`):

| Actor | Primary surface | Core job |
|-------|-----------------|----------|
| Leisure traveler | Traveler web | Discover, book, manage, review |
| Business traveler | Traveler web | Fast book, receipt, reliable changes |
| Hotel operator | Hotel dashboard | Daily listing, inventory, reservations |
| Hotel owner | Hotel dashboard | Oversight across properties |
| Support agent | Admin console | Resolve tickets, assist refunds |
| Platform admin | Admin console | Full marketplace governance |

Four negative personas (vacation rental host, hostel operator, enterprise chain admin, multi-vertical traveler) are explicitly excluded to prevent scope creep.

---

## Key workflows

**Traveler journey:** Home search → results (filter/sort/map) → hotel detail → checkout (hold + pay) → confirmation → manage trip → cancel or review.

**Hotel journey:** Public List your property → self-serve register → Stripe Connect → property wizard with readiness checklist → admin approval → go live → manage calendar/pricing → handle reservations → respond to reviews. No sales-assisted onboarding path.

**Admin journey:** Dashboard → property approval queue → user/hotel/booking management → payment/payout monitoring → trust/review moderation → support escalations → platform config and audit logs.

**Support journey:** Ticket intake (email-primary) → context view → assist or escalate to admin for overrides.

The booking lifecycle is the critical path. Everything else supports or extends it.

---

## Scenarios and edge cases

Twenty scenarios cover concurrency (sold-out mid-checkout, hold expiry, overbooking races), payment failures and reconciliation, cancellation permutations, permission blocks, empty states, onboarding gates, and accessibility. The highest-risk area is **payment succeeded but confirmation failed** — the design mandates idempotent reconciliation with auto-refund fallback.

---

## UX surfaces

Twenty-four traveler/hotel screens plus **seventeen platform admin screens** and system email templates. Navigation model:

**Traveler (authenticated):**
```
Home ─ Search ─ Hotel Detail ─ Checkout ─ Confirmation
                    │
Account ─ My Trips ─ Reservation Detail ─ Cancel / Review
Help ─ Support / Trust Report
List your property ─→ Hotel onboarding (self-serve)
```

**Hotel dashboard:**
```
Dashboard Home
├── Onboarding Wizard (self-serve, readiness checklist)
├── Property Editor
├── Inventory Calendar
├── Reservations (list → detail)
├── Reviews
└── Support
```

**Platform admin console:**
```
Admin Dashboard
├── Property Approval Queue
├── Properties / Users / Hotels (search → detail → suspend)
├── Bookings (search → detail → override)
├── Payments & Payouts
├── Trust Queue / Reviews Moderation
├── Support Tickets / Escalations
├── Platform Settings
├── Audit Log / Notification Log
└── Admin User Management
```

Information density follows product posture: traveler surfaces stay low-to-medium density; hotel dashboard is medium density without enterprise PMS complexity.

---

## Trade-offs and decisions

| Decision | Choice | Why |
|----------|--------|-----|
| Checkout hold | 15 minutes | Fair inventory sharing vs completion time |
| Cancellation | 3 platform templates | Avoid free-form policy parsing in v1 |
| Payout timing | After check-in | Reduces dispute exposure |
| Property go-live | Manual admin approval | Quality/trust for boutique positioning |
| Guest-hotel comms | Contact info only; no in-app chat | Scope + moderation cost |
| Business travelers | Same account as leisure | Corporate features out of scope |
| Notifications | Email only | Per constraints |
| Sort default | Recommended blend | Differentiation vs price-only OTAs |
| **Hotel onboarding** | **Fully self-serve** | Stakeholder decision — minimize supply friction |
| **Platform admin** | **Full internal console** | Stakeholder decision — maximum ops depth |

Full log: `.lamina/decisions.md`

---

## Accessibility

Traveler web targets WCAG 2.1 AA on critical paths (search, detail, checkout, account). Keyboard navigation, focus management, form error association, hold-timer live regions, and non-color-dependent status indicators are specified in the implement brief.

---

## Open questions

Remaining unresolved items (defaults in implement brief §19):

- Commission rate (default 15% env config)
- Tax accuracy (estimated line item v1)
- Support tooling (built into admin console; Zendesk integration deferred)
- Recommended sort algorithm weights

**Resolved (2026-07-10):**
- Hotel onboarding → fully self-serve via List your property
- Platform admin → full internal console with dashboard, approvals, user/hotel/booking management, payments/payouts, trust, reviews, support, config, and audit logs

---

## Suggested next steps

1. **Implement** using `.lamina/runs/havenstay-platform-2026-07-10/implement.md` with your chosen stack
2. **Deploy** to a staging environment with Stripe test mode
3. **Run** `/lamina-verify` against the live product for actor walks, invariant probes, and accessibility checks
4. **Resolve** open questions (commission rate, tax) with stakeholders before production launch

---

## Work plan executed

**Workflow:** `/lamina-design`  
**Skills applied:** design-intake, design-evidence, design-domain, design-actors, design-workflows, design-scenarios, design-ux, design-risks  
**Order:** domain → actors → workflows → scenarios → screens → implement brief  
**Writes:** `.lamina/` only  
**Gaps:** deferred per open questions; defaults provided in implement brief
