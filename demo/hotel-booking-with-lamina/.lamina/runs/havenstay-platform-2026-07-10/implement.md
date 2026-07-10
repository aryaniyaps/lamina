# HavenStay — Implement Brief

**Run:** `havenstay-platform-2026-07-10`  
**Status:** `ready_to_build`  
**Contract:** `.lamina/runs/havenstay-platform-2026-07-10/run.yaml`  
**Business context:** `.lamina/business-context.md`

Build a production-ready US hotel booking marketplace. Use any stack, any UI library, any database. This brief is the source of truth for behavior — not visual styling.

---

## 1. Product summary

**HavenStay** is a commission-based OTA for independent and boutique hotels in the United States.

| Surface | Users | Platform |
|---------|-------|----------|
| Traveler web | Leisure + business travelers | Responsive web |
| Hotel dashboard | Operators + owners | Desktop web |
| Platform admin | Platform admins | Desktop web (full internal console) |
| Support | Support agents | Internal (within admin console) |

**Out of scope v1:** vacation rentals, hostels, flights/cars/packages, PMS depth, channel managers, loyalty, corporate travel, multi-currency/language, native apps, SMS/push, dynamic pricing, promotions, wishlists, group bookings, in-app messaging.

---

## 2. Architecture guidance (non-binding)

Suggested logical modules — adapt to your stack:

```
┌─────────────────────────────────────────────────────────────┐
│  Traveler Web App                                           │
│  (search, detail, checkout, account, trips, reviews)        │
└──────────────────────────┬──────────────────────────────────┘
                           │
┌──────────────────────────▼──────────────────────────────────┐
│  Hotel Dashboard                                            │
│  (onboarding, property, inventory, reservations, reviews)   │
└──────────────────────────┬──────────────────────────────────┘
                           │
┌──────────────────────────▼──────────────────────────────────┐
│  Platform Admin Console                                     │
│  (approvals, users, hotels, bookings, payouts, trust, ops)  │
└──────────────────────────┬──────────────────────────────────┘
                           │
┌──────────────────────────▼──────────────────────────────────┐
│  API / Backend                                              │
│  Auth · Search · Booking · Inventory · Payments · Notify    │
└──────┬──────────────┬──────────────┬──────────────┬─────────┘
       │              │              │              │
   PostgreSQL      Redis          Stripe        SendGrid/SES
   (or similar)   (holds/cache)  (pay+connect)  (email)
       │
   Google Maps API (geocoding, map display)
```

**Critical backend concerns:**
- Atomic inventory holds and booking confirmation (transactions + row locks or equivalent)
- Idempotent payment webhook handling (Stripe)
- Background jobs: hold expiry, booking status transitions, payout scheduling, email queue
- Audit log for admin actions and refund overrides

---

## 3. Data model (implement from `run.yaml` domain)

Implement all entities in `run.yaml` `domain.entities`. Key relationships:

- `hotel_account` 1→N `property`
- `property` 1→N `room_type` 1→N `inventory_block` (per date)
- `user` 1→N `booking` 1→N `booking_line` → `room_type`
- `booking` 1→1 `payment` 0→N `refund`
- `property` 1→1 `cancellation_policy` (template)
- `booking` 0→1 `review`

**Indexes required for performance:**
- Search: property geo, city, state, live status
- Inventory: (room_type_id, date) unique
- Bookings: user_id, property_id, status, check_in_date
- Holds: expires_at for sweeper job

---

## 4. Invariants (must never violate)

| ID | Rule |
|----|------|
| `no-double-booking` | confirmed + active holds ≤ inventory per room-night |
| `payment-before-confirm` | confirmed only after payment succeeded |
| `price-transparency` | checkout total = charged amount; fees disclosed |
| `policy-snapshot-immutable` | freeze cancellation policy on booking |
| `verified-guest-review-only` | one review per completed booking |
| `live-property-only` | only `live` properties in search |
| `hold-expiry-release` | 15-min holds auto-release |
| `email-verified-book` | block payment until email verified |
| `hotel-payout-after-checkin` | Stripe Connect transfer after check-in |
| `usd-english-us-only` | USD, English, US addresses |
| `review-window` | 30 days post check-out |
| `suspended-user-blocked` | no new bookings for suspended users |

---

## 5. Actors and permissions

Load `.lamina/personas.yaml`. Enforce permissions at API layer.

**Auth separation:**
- Traveler auth (email/password + Google SSO)
- Hotel staff auth (separate login or unified with role claim — either works; enforce dashboard route guard)
- Platform admin auth (internal only; separate admin login; MFA recommended)
- Support agent auth (subset of admin console permissions or shared admin role)

**Admin auth requirements:**
- All admin routes behind role guard (`platform_admin`)
- Every override action (refund, cancel, suspend, approve) writes to `admin_audit_log` with actor, target, reason, timestamp
- Read-only impersonation (view-as) if implemented — never allow impersonated write actions

**Role matrix (high level):**

| Action | Traveler | Hotel staff | Support | Admin |
|--------|----------|-------------|---------|-------|
| Search/book | ✓ | — | — | — |
| Manage own trips | ✓ | — | assist | — |
| Manage property | — | ✓ | view | approve |
| Manage inventory | — | ✓ | — | — |
| View reservations | own | own properties | ✓ | ✓ |
| Cancel booking | per policy | rare (full refund) | assist | — |
| Moderate reviews | — | respond only | flag | ✓ |
| Trust reports | file | — | escalate | resolve |
| Platform config | — | — | — | ✓ |
| Audit log | — | — | — | ✓ |

---

## 6. Workflows to implement

Implement every workflow in `run.yaml` `workflows`. Priority order for build:

### Phase 1 — Core loop (weeks 1–8)
1. `traveler-account-management` — auth, email verification
2. `hotel-onboarding` — **fully self-serve** wizard from List your property; readiness checklist; Stripe Connect
3. `admin-review-property` — property approval queue (needed before hotels go live)
4. `hotel-manage-inventory-pricing` — room types, calendar, rates
5. `traveler-discover-and-search` — home, search, filters, map
6. `traveler-view-hotel-detail` — gallery, rooms, reviews, policies
7. `traveler-book-and-pay` — checkout, hold, Stripe, confirmation
8. `hotel-manage-reservations` — list, detail, check-in

### Phase 2 — Lifecycle (weeks 9–14)
9. `traveler-manage-reservation` — trips, detail, receipt
10. `traveler-cancel-reservation` — refund preview, Stripe refund
11. `traveler-write-review` — prompt, form, publish
12. `hotel-manage-property` — edit, pause/resume
13. `hotel-respond-to-review`

### Phase 3 — Trust, support & admin depth (weeks 15–22)
14. `traveler-contact-support` + `hotel-contact-support`
15. `support-resolve-ticket` + `admin-support-escalations`
16. `traveler-file-trust-report` + `admin-trust-and-reviews`
17. Email notification system (all templates in `screens.email-templates`)
18. `admin-platform-operations` — full admin dashboard
19. `admin-manage-users-and-hotels` — user/hotel search, suspend/reinstate
20. `admin-manage-bookings-payments` — booking search, overrides, payouts
21. `admin-platform-config` — commission rate, audit log, notification log, admin user management

### Phase 4 — Hardening (weeks 23–26)
- Concurrency and payment edge cases (all `scenarios` with category `concurrency` or `payment`)
- Accessibility pass
- Performance (search < 500ms p95, checkout hold reliability)
- Monitoring and alerting (payment failures, hold sweeper, email bounces)

---

## 7. Screen inventory

Implement all screens in `run.yaml` `screens`. Structural requirements per screen:

### Traveler web

**`home`**
- Search hero: destination autocomplete (city/neighborhood/hotel name), date range picker, guests selector
- Featured destinations (curated static or algorithmic from popular cities)
- Value props: transparency, boutique focus, secure payments
- Global nav: Sign in | Sign up | (authenticated: Trips, Account)
- Footer: Help, Terms, Privacy, List your property

**`search-results`**
- Sticky search bar (editable criteria)
- Result cards: photo, name, location, guest rating, price per night (for dates), cancellation badge
- Filters: price range slider, star rating, amenities (WiFi, parking, pool, pet-friendly, etc.), cancellation type, guest rating minimum
- Sort: recommended (default), price ↑↓, rating
- Map toggle: pins sync with list; click pin → card highlight
- Pagination or infinite scroll
- Empty state per scenario `search-zero-results`

**`hotel-detail`**
- Photo gallery (swipe/lightbox)
- Overview, amenities, location map pin, check-in/out times
- Room list for selected dates: name, occupancy, price, select CTA
- Reviews section: average, distribution, individual reviews + hotel responses
- Policies: cancellation template summary, house rules
- If dates not set: prompt to enter dates before room prices shown

**`checkout`**
- Steps: Review → Guest details → Payment (can be single page with sections)
- Trip summary sidebar (sticky on desktop)
- Price breakdown: nightly rates × nights × rooms, taxes, service fee (if guest-facing), **total**
- Hold timer (countdown from 15:00)
- Policy acknowledgment checkbox (required)
- Stripe payment (Checkout Session or Payment Element)
- Loading/error states for payment

**`booking-confirmation`**
- Confirmation code (human-readable, e.g. `HVN-XXXXXX`)
- Summary, hotel contact, add-to-calendar link (ICS)
- CTA: View trip, Back to home

**`my-trips`**
- Tabs: Upcoming | Past
- Cards: hotel name, dates, status badge, thumbnail

**`reservation-detail`**
- Full booking info, hotel address/map, contact
- Cancel CTA (if eligible)
- Download receipt (PDF: booking details, payment amount, dates — suitable for expense reports)
- Policy display (snapshot text)

**`cancel-flow`**
- Refund preview with policy explanation
- Confirm button; loading state during Stripe refund
- Confirmation with refund amount and timeline

**`write-review`**
- Star rating (1–5, required)
- Optional sub-ratings: cleanliness, location, service
- Text (min 20 chars, max 2000)
- Guidelines link (no profanity, honest stay)

**`sign-in` / `sign-up`**
- Email/password + Google SSO
- Forgot password flow
- Terms of service + privacy policy links on signup

**`account-settings`**
- Profile edit, password change
- Email verification status + resend

**`help-center`**
- FAQ categories: Booking, Payment, Cancellation, Account, Reviews
- Contact form → creates `support_ticket`
- Logged-in users see ticket status list

**`trust-report-form`**
- Report type, description, optional booking/listing link
- Confirmation message (no promise of outcome timeline to user beyond "we'll review")

### Hotel dashboard (desktop)

**`hotel-dashboard-home`**
- Property selector (if multiple)
- Widgets: today's arrivals, upcoming 7 days, unread reviews, open support tickets
- Quick links: Calendar, Reservations, Edit listing

**`list-your-property`** (public)
- Value props for independent/boutique hotels
- Self-serve CTA → hotel sign-up (no invite code, no sales contact)
- Requirements summary: US property, Stripe Connect, 5+ photos, room types
- FAQ links

**`hotel-onboarding-wizard`**
- Multi-step with progress indicator
- Steps: Account → Stripe Connect → Property details → Rooms → Policy → Readiness checklist → Submit
- **Self-serve only** — no sales-assisted path; save draft at each step
- Readiness checklist gates submit:
  - Stripe Connect complete
  - US address with valid geocode
  - Minimum 5 photos
  - At least 1 active room type with rate and inventory
  - Cancellation policy selected
  - Check-in/out times set
- After submit: `pending_review` status tracker on dashboard
- Rejection/change-request: show admin notes inline; resubmit without leaving wizard flow
- Email at: submit, approve, reject, change-request

**`property-editor`**
- All profile fields from domain
- Photo upload (min 5 photos to submit; reorder, delete)
- Amenities multi-select
- Pause listing toggle with warning if upcoming bookings

**`inventory-calendar`**
- Grid: dates (columns) × room types (rows)
- Cell shows: available count, rate
- Click cell → edit rate and availability
- Bulk select date range → apply rate or close dates
- Optimistic UI with conflict handling

**`hotel-reservations-list`**
- Table: guest, dates, room, status, booking date
- Filters: date range, status
- Export CSV

**`hotel-reservation-detail`**
- Guest name, email, phone, special requests
- Mark checked in (check-in date or later)
- Cancel (rare): reason required, triggers full guest refund

**`hotel-reviews`**
- List with rating, text, date
- Response form (one per review, max 500 chars)

**`hotel-support`**
- Same pattern as traveler help center

### Platform admin console (desktop)

Full internal operations console at `/admin/*`. Separate auth. All write actions audit-logged.

**`admin-dashboard`**
- KPI cards: bookings today/7d/30d, GMV, active hotels, pending approvals, open trust reports, failed payouts
- Queue shortcuts to approval, trust, escalations, payouts
- Charts: bookings over time, GMV over time
- Recent admin activity feed

**`admin-property-approval-queue`**
- Table: property name, hotel, submitted date, checklist status, Stripe status
- Side panel: full listing preview (photos, rooms, policies)
- Actions: Approve → live | Reject (reason required) | Request changes (notes required)
- SLA indicator (3 business days)

**`admin-properties-list`** / **`admin-property-detail`**
- Search/filter by name, city, status, hotel account
- Detail: listing preview, booking stats, payout status, suspension history
- Actions: suspend, reinstate, force pause

**`admin-users-list`** / **`admin-user-detail`**
- Search travelers by email, name, id
- Detail: profile, booking history, reviews, trust flags
- Actions: suspend, reinstate

**`admin-hotels-list`** / **`admin-hotel-detail`**
- Search hotel accounts by business name, email
- Detail: properties, staff, Stripe Connect status, payout overview
- Actions: suspend account, reinstate

**`admin-bookings-list`** / **`admin-booking-detail`**
- Search by confirmation code, guest email, property, date range, status
- Detail: full booking, payment/refund history, policy snapshot, notification log
- Override actions: admin cancel, custom refund amount (reason required, audit logged)

**`admin-payments-payouts`**
- Tabs: Payments | Payouts | Failed
- Payment table: booking, amount, status, Stripe ID
- Payout table: hotel, amount, scheduled/completed date, Stripe transfer ID
- Retry action for failed payouts

**`admin-trust-queue`**
- Reports by status, type, severity
- Investigation panel with linked booking/listing/review context
- Actions: dismiss, warn, suspend listing/user, remove content

**`admin-reviews-moderation`**
- Flagged/reported reviews queue
- Remove or restore with reason

**`admin-support-tickets`** / **`admin-support-escalations`**
- Full ticket queue (all tickets, not just escalated)
- Escalated filter for admin-only overrides
- Override panel: refund/cancel beyond support_agent limits

**`admin-platform-settings`**
- Commission rate configuration (applies to new bookings)
- Cancellation policy templates (read-only display v1)
- System flags if needed

**`admin-audit-log`**
- Searchable table: timestamp, admin actor, action, target type/id, reason
- Immutable; no delete

**`admin-notification-log`**
- Email delivery log: recipient, template, booking link, sent/failed/bounced
- Resend action for failed transactional emails

**`admin-users-management`**
- Platform admin user table
- Invite new admin (email)
- Deactivate admin accounts

---

## 8. Scenarios to handle

Implement UX for every entry in `run.yaml` `scenarios`. Highest severity:

1. `inventory-sold-out-mid-checkout`
2. `hold-expired-during-payment`
3. `payment-succeeded-confirm-failed` (idempotent reconciliation)
4. `payment-failed`
5. `overbooking-prevention-race`
6. `cancel-strict-no-refund` (clear $0 refund UX)
7. `hotel-cancels-booking` (100% refund)
8. `network-error-mid-booking`
9. `search-zero-results`
10. `accessibility-keyboard-nav`

---

## 9. Payments (Stripe)

**Traveler payments:**
- Payment Intent or Checkout Session per booking
- Capture on success; amount = checkout total
- Store `stripe_payment_intent_id` on payment record
- Webhook handlers: `payment_intent.succeeded`, `payment_intent.payment_failed`, `charge.refunded`

**Hotel payouts:**
- Stripe Connect Express or Standard
- Onboarding during hotel onboarding wizard
- Transfer to connected account after check-in date (scheduled job)
- Deduct platform commission (rate from config — use env var until decided)
- On cancellation: reverse or adjust transfer

**Refunds:**
- Full or partial per cancellation policy snapshot
- Initiate via Stripe Refund API
- Update booking, payment, refund entities
- Email traveler confirmation

---

## 10. Notifications (email only)

Implement all templates listed under `screens.email-templates` in `run.yaml`.

**Requirements:**
- Transactional provider (SendGrid, SES, Postmark, etc.)
- Queue + retry on failure
- Log in `notification` entity
- Unsubscribe: transactional emails exempt; marketing N/A v1

**Key triggers:**
| Event | Template |
|-------|----------|
| Booking confirmed | `booking_confirmation_traveler` + `booking_confirmation_hotel` |
| 24h before check-in | `pre_arrival_reminder` |
| Cancelled | `cancellation_traveler` + `cancellation_hotel` |
| Check-out + 1 day | `review_prompt` |
| Review published | `review_published_hotel` |
| Signup | `email_verification` |
| Support reply | `support_ticket_update` |

---

## 11. Search and discovery

**Search inputs:** destination (text → match city, state, neighborhood, property name), check-in, check-out, guests

**Query logic:**
- Only `live` properties
- Has at least one room type with availability for all nights in range (check_out exclusive)
- guest_count ≤ max_occupancy for available room types
- Price = sum of nightly rates for stay (show "from $X/night" on cards)

**Filters:** client-side or server-side; server preferred for pagination correctness

**Map:** Google Maps — property pins from geo_coordinates; cluster when zoomed out

**Sort — recommended (default):** blend of guest rating, booking count (popularity), distance from search center if geo resolved. Document weights in config for tuning.

---

## 12. Cancellation policies

Three templates (hotel picks one per property):

| Template | Full refund | Partial | No refund |
|----------|-------------|---------|-----------|
| **Flexible** | Until 24h before check-in | — | < 24h |
| **Moderate** | Until 5 days before | 50% until 24h before | < 24h |
| **Strict** | Until 7 days before | 50% until 7 days | < 7 days |

At booking confirmation, snapshot template + computed deadline timestamps onto booking. Refund calculator uses snapshot only.

---

## 13. Reviews and trust

**Review eligibility:** booking `completed`, within 30 days of check-out, no existing review

**Moderation v1:** post-publish flagging; `support_agent` and `platform_admin` can flag/remove. No AI moderation required v1.

**Trust reports:** store and queue for admin review; auto-acknowledge user

**Hotel responses:** one per review, editable within 24h of posting response

---

## 14. Accessibility requirements

Target WCAG 2.1 AA for traveler web:

- Semantic HTML landmarks (header, main, nav, footer)
- All interactive elements keyboard accessible
- Visible focus indicators
- Form labels, `aria-describedby` for errors
- Color contrast 4.5:1 minimum for text
- Images: alt text; decorative `alt=""`
- Modals: focus trap, Escape to close
- Date picker: accessible fallback
- Skip to main content link
- Screen reader announcements for hold timer updates (live region)
- Don't rely on color alone for status (icons + text)

Hotel dashboard: keyboard navigable; table semantics for reservations

---

## 15. SEO and public pages (traveler)

- `/` home
- `/search?...` results (indexable city pages optional stretch)
- `/hotels/[slug]` property detail (SSR/SSG recommended for SEO)
- `/help`, `/terms`, `/privacy`
- `/list-your-property` → hotel signup CTA

---

## 16. Security and compliance

- HTTPS everywhere
- Password hashing (bcrypt/argon2)
- CSRF protection on cookie-based auth
- Rate limiting: auth endpoints, search, booking
- PCI: never store raw card data (Stripe handles)
- GDPR/CCPA: privacy policy, data export/delete for user accounts (basic v1)
- Input sanitization on all text fields
- Hotel staff can only access own property data (authorization checks)

---

## 17. Observability

Log and alert on:
- Payment webhook failures
- Hold sweeper failures
- Booking confirmation failures after payment
- Email send failures > threshold
- Search error rate
- API p95 latency

---

## 18. Test plan (for implementer)

**Unit:** refund calculator per policy, inventory availability check, hold expiry

**Integration:** booking flow end-to-end, Stripe webhooks, double-booking race (concurrent requests)

**E2E (critical paths):**
1. Search → book → pay → confirm → email received
2. Cancel with refund
3. Complete stay → review
4. Hotel onboarding → approval → live → receive booking
5. Hold expiry → inventory released
6. Payment failure → retry

**Accessibility:** axe-core on checkout, search, hotel detail

---

## 19. Open questions (use defaults below if unresolved)

| Question | Default for build |
|----------|-------------------|
| Commission rate | 15% configurable via `PLATFORM_COMMISSION_RATE` env |
| Guest service fee | None v1 (commission from hotel side only) |
| Tax | Display "taxes and fees" as estimated 12–15% line; refine later |
| Hotel onboarding | **Self-serve only** — public List your property flow |
| Admin UI | **Full platform admin console** — all screens in run.yaml |
| Support tooling | Built into admin console (ticket tables + escalations) |

---

## 20. Definition of done

- [ ] All workflows in `run.yaml` implemented (including all `admin-*` workflows)
- [ ] All invariants enforced with tests
- [ ] All screens functional on target platforms (traveler, hotel, **platform admin**)
- [ ] All scenarios have defined UX
- [ ] Stripe payments and Connect payouts working
- [ ] Email notifications for all templates
- [ ] Admin audit log for all override actions
- [ ] Self-serve hotel onboarding end-to-end without sales assistance
- [ ] WCAG 2.1 AA on traveler critical paths
- [ ] No app features outside business-context scope

**After implementation:** run `/lamina-verify` against deployed product.
