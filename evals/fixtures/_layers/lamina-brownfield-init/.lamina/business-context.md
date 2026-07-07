---
lamina:
  maturity: brownfield
  platform: [web]
  last_updated: 2026-07-07
---

# Business context

## Problem statement
**Answer:** Checkout abandonment is high on our existing Next.js commerce storefront; shoppers drop off before completing payment.
**Confidence:** medium
**Evidence:** analytics + user input
**Skill:** lamina-problem-framing

## Business goals
**Answer:** Increase completed checkout rate and reduce support tickets about payment confusion.
**Confidence:** medium
**Evidence:** user input
**Skill:** lamina-stakeholder-alignment

## Success metrics
**Answer:** Reduce checkout abandonment by 15% within one quarter after UX improvements ship.
**Confidence:** medium
**Evidence:** user input
**Skill:** lamina-quantitative-validation

## Scope
**Answer:** Brownfield Vercel Commerce storefront — cart, product pages, search; excludes replatforming or new payment provider.
**Confidence:** high
**Evidence:** repo context
**Skill:** lamina-feature-prioritization

## Users & market
**Answer:** Online shoppers comparing products; alternatives include Amazon and niche DTC brands with faster checkout.
**Confidence:** medium
**Evidence:** user input
**Skill:** lamina-competitive-analysis

## Product posture
**Answer:** Web storefront with sovereign role in product discovery and cart; checkout hosted via Shopify checkout URL.
**Confidence:** high
**Evidence:** repo context
**Skill:** lamina-platform-posture

## Constraints
**Answer:** Must ship UX improvements without rewriting Shopify integration; team capacity is one sprint for audit fixes.
**Confidence:** high
**Evidence:** user input
**Skill:** lamina-research-scoping

## Stakeholders
**Answer:** Product, engineering, and support need aligned priorities before changing cart or checkout affordances.
**Confidence:** medium
**Evidence:** user input
**Skill:** lamina-stakeholder-alignment

## Risks & unknowns
**Answer:** Payment friction may be upstream in Shopify checkout — need to validate where drop-off occurs.
**Confidence:** low
**Evidence:** assumption — needs validation
**Skill:** lamina-feature-discovery

## Research posture
**Answer:** Evaluative — audit existing cart-to-checkout flow and test revised affordances on staging.
**Confidence:** medium
**Evidence:** user input
**Skill:** lamina-research-scoping

## Triad check
**Answer:** Desirability is moderate — users want faster checkout; feasibility constrained by Shopify-hosted checkout.
**Confidence:** medium
**Evidence:** user input
**Skill:** lamina-product-behavior
