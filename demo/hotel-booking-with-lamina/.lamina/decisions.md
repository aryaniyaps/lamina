# Lamina decisions log

Material product decisions with run references.

---

## havenstay-platform-2026-07-10

### checkout-hold-duration
**Choice:** 15-minute inventory hold during checkout  
**Alternatives considered:** No hold (race conditions); 30-minute hold (inventory lock too long)  
**Rationale:** Balance fairness vs payment completion time. Hold sweeper job releases expired inventory.  
**Confidence:** high  
**Run:** havenstay-platform-2026-07-10

### cancellation-policy-templates
**Choice:** Three platform templates (flexible / moderate / strict); hotel selects one per property  
**Alternatives considered:** Free-form hotel policies; single platform-wide policy  
**Rationale:** Simplifies refund calculator, UX copy, and legal review for v1. Policy snapshotted at booking.  
**Confidence:** high  
**Run:** havenstay-platform-2026-07-10

### hotel-payout-timing
**Choice:** Stripe Connect payout after check-in date  
**Alternatives considered:** Payout at booking; payout at check-out  
**Rationale:** Reduces chargeback/dispute exposure; aligns with cancellation windows.  
**Confidence:** high  
**Run:** havenstay-platform-2026-07-10

### search-default-sort
**Choice:** Recommended (rating + popularity + distance blend)  
**Alternatives considered:** Price low-to-high default; pure distance  
**Rationale:** Supports differentiation thesis (quality over cheapest); weights tunable post-launch.  
**Confidence:** medium  
**Run:** havenstay-platform-2026-07-10

### single-traveler-account-model
**Choice:** Leisure and business travelers share one account model; receipt PDF for expenses  
**Alternatives considered:** Separate business profile; company billing fields  
**Rationale:** Corporate travel explicitly out of v1 scope.  
**Confidence:** high  
**Run:** havenstay-platform-2026-07-10

### property-approval-gate
**Choice:** Manual platform admin approval before property goes live  
**Alternatives considered:** Instant self-serve publish; automated checks only  
**Rationale:** Trust and listing quality for boutique positioning; acceptable at 300-hotel scale.  
**Confidence:** medium  
**Run:** havenstay-platform-2026-07-10

### no-guest-messaging-v1
**Choice:** No in-app guest–hotel messaging; show hotel contact on reservation  
**Alternatives considered:** Built-in chat; email relay  
**Rationale:** Scope control, moderation burden, sufficient for v1 with phone/email.  
**Confidence:** high  
**Run:** havenstay-platform-2026-07-10

### commission-default
**Choice:** 15% platform commission via env config (placeholder until stakeholder decides)  
**Alternatives considered:** 10%, 18%, guest-facing service fee  
**Rationale:** Industry-range placeholder; must be configurable without code change.  
**Confidence:** low (placeholder)  
**Run:** havenstay-platform-2026-07-10

### tax-display-v1
**Choice:** Estimated "taxes and fees" line item (~12–15%); not jurisdiction-precise  
**Alternatives considered:** Full tax API integration; tax included in nightly rate  
**Rationale:** Tax accuracy is complex; estimate acceptable for v1 with clear labeling.  
**Confidence:** medium  
**Run:** havenstay-platform-2026-07-10

### hotel-onboarding-self-serve
**Choice:** Fully self-serve hotel onboarding via public List your property flow  
**Alternatives considered:** Sales-assisted onboarding; hybrid with invite codes  
**Rationale:** Stakeholder decision — minimize supply friction and sales ops overhead at launch.  
**Confidence:** high  
**Run:** havenstay-platform-2026-07-10

### platform-admin-full-console
**Choice:** Full platform admin web console with dashboard, approvals, user/hotel/booking management, payments/payouts, trust/reviews moderation, support escalations, config, and audit/notification logs  
**Alternatives considered:** Minimal CLI for approvals only; support-only internal tools  
**Rationale:** Stakeholder decision — maximize operational depth for marketplace governance.  
**Confidence:** high  
**Run:** havenstay-platform-2026-07-10
