---
id: fix
title: Product fix brief
run_id: havenstay-platform-2026-07-10
source_run: .lamina/runs/havenstay-platform-2026-07-10/run.yaml
verify_report: .lamina/runs/havenstay-platform-2026-07-10/verify-report.md
confidence: high
sources:
  - .lamina/runs/havenstay-platform-2026-07-10/run.yaml
  - .lamina/runs/havenstay-platform-2026-07-10/verify-report.md
  - .lamina/runs/havenstay-platform-2026-07-10/walkthrough/index.yaml
---

# Fix brief: HavenStay platform

## Command boundary

This Lamina command produced UX artifacts only. **Do not edit app source in this session.**

Start a coding-agent session to implement the **product fixes** below. That session may edit app source; do not modify `.lamina/` while fixing.

## Product fixes

Prioritized from `run.yaml` `findings[]` where `fix_target` is `product` or unset.

### High priority

- **`mock-payments-only`** — high — Payments auto-confirm via mock PaymentIntent; no real Stripe or webhooks
  - **Repro:** Complete checkout; payment succeeds without card entry; no webhook handler
  - **Recommendation:** Integrate Stripe Payment Element and webhook reconciliation
  - **Context:** `checkout`, `traveler-book-and-pay`, invariant `payment-before-confirm`
  - **Acceptance:** Real card payment required; webhook confirms booking idempotently

- **`missing-stripe-webhook`** — high — No `/api/webhooks/stripe` for payment confirmation or auto-refund
  - **Repro:** Payment succeeds but fulfillment fails — no reconciliation path
  - **Recommendation:** Add webhook handler per implement brief §9
  - **Context:** scenario `payment-succeeded-confirm-failed`
  - **Acceptance:** Webhook confirms or refunds; duplicate events are idempotent

### Medium priority

- **`sign-in-no-redirect`** — medium — Session created but user stays on sign-in page
  - **Repro:** Sign in successfully; header updates; URL unchanged
  - **Recommendation:** Redirect after `signInAction` using `redirect` hidden field
  - **Context:** `sign-in`, `traveler-account-management`
  - **Acceptance:** Successful sign-in navigates to intended destination or home

- **`checkout-unverified-not-blocked-ui`** — medium — Confirm & pay enabled for unverified email
  - **Repro:** Amber banner shown; submit still enabled; server rejects
  - **Recommendation:** Disable checkout submit when `emailVerifiedAt` is null
  - **Context:** `checkout`, invariant `email-verified-book`
  - **Acceptance:** Submit disabled until email verified; clear CTA to verify

- **`missing-google-maps`** — medium — No map on search results or hotel detail
  - **Repro:** Search and detail pages lack map toggle/embed
  - **Recommendation:** Add map view with property pins and detail embed
  - **Context:** `search-results`, `traveler-discover-and-search`
  - **Acceptance:** Map toggle on search; location map on hotel detail

- **`admin-users-management-missing`** — medium — Admin user invite/deactivate not implemented
  - **Repro:** Admin nav lacks Users entry; no `/admin/admins` route
  - **Recommendation:** Add invite and deactivate actions
  - **Context:** `admin-users-management`, `admin-platform-config`
  - **Acceptance:** Platform admin can invite and deactivate admin users

- **`admin-retry-payout-missing`** — medium — No failed-payout retry on payments page
  - **Repro:** Payments list renders; no retry action for failed payouts
  - **Recommendation:** Add payout status tracking and retry per contract
  - **Context:** `admin-payments-payouts`
  - **Acceptance:** Failed payout shows retry with audit trail

- **`accessibility-skip-link-missing`** — medium — No skip-to-main-content link
  - **Repro:** Tab from page load does not reveal skip link
  - **Recommendation:** Add skip link as first focusable element in layout
  - **Context:** `home`, traveler pages
  - **Acceptance:** Skip link visible on focus; jumps to `main`

### Low priority

- **`missing-receipt-pdf`** — low — No PDF download on trip receipt
  - **Acceptance:** Business traveler can download receipt PDF from reservation detail

- **`search-sort-missing`** — low — Sort controls not exposed
  - **Acceptance:** Sort dropdown (recommended, price, rating) updates results

- **`search-filters-incomplete`** — low — Amenities and cancellation filters missing
  - **Acceptance:** All contract filter facets available on search

- **`accessibility-main-landmark`** — low — Skip navigation pattern incomplete
  - **Acceptance:** Keyboard focus order audited on critical traveler paths

### Resolved (verify after deploy)

- **`checkout-no-hold-timer`** — HoldTimer with aria-live deployed 2026-07-10
- **`hotel-cancel-booking-missing`** — Hotel cancel with full refund deployed 2026-07-10

## Contract deltas

Findings with `fix_target: contract` — run `/lamina-design`, do not patch in app code without design pass.

- **`missing-google-sso`** — `/lamina-design` prompt: Decide whether Google OAuth is required for v1 or remove from contract and implement brief
- **`admin-impersonate-missing`** — `/lamina-design` prompt: Defer `impersonate_read_only` to post-launch or spec read-only view-as with audit logging

## Non-goals

- Do not change `.lamina/` during product fixes
- Do not implement Google SSO or admin impersonation without a design delta
- SQLite → PostgreSQL migration is ops scope, not this fix pass

## Implementation session prompt

Copy into a new coding session:

> Implement product fixes from `.lamina/runs/havenstay-platform-2026-07-10/fix.md`.
> Read `run.yaml` for machine-readable `findings[]`.
> Prioritize high-priority findings first. Keep changes scoped.
> Do not modify `.lamina/`. After fixes, re-run `/lamina-verify`.

## Re-verify

After product fixes are deployed, run `/lamina-verify` against `http://localhost:3001`.
